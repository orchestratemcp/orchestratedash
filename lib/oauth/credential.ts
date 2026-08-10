/**
 * What DASH keeps in the vault for an OAuth connection (MAR-446, DASH-29).
 *
 * One entry, under the same `dash.connection.{agent}.{connection}.{field}` name
 * `lib/connection-credentials.ts` already computes for an API key. MAR-446 is
 * explicit that OAuth must reuse the MAR-383 seam rather than invent a second
 * store, and this is the shape that lets one `SecureStore` value carry what an
 * OAuth connection needs: a refresh token plus the small amount of context that
 * makes it usable and describable.
 *
 * ## Why a JSON envelope rather than several vault entries
 *
 * A refresh token, the scopes it was granted for, and which account granted them
 * are one fact that was true at one moment. Split across three vault names they
 * could be written at three times and read in three states — a token from
 * today's sign-in beside scopes from last month's, with nothing in the vault
 * able to say they disagree. One entry is written once, atomically, or not at
 * all.
 *
 * It also keeps `connection_secrets` honest: that table records *where* a
 * credential is, one row per field, and a field whose credential lived in three
 * vault entries would need three rows or a lie in one.
 *
 * ## The whole envelope is a secret
 *
 * Not just the `refresh_token` member. The account address is personal data and
 * the granted scopes describe exactly what DASH can do to that account — neither
 * belongs in a log, and putting the object in the vault whole means no caller
 * has to remember which member was the sensitive one. The only thing that ever
 * leaves is a masked account, produced by `maskAccount` at the moment of
 * storing.
 */

/**
 * The current envelope version.
 *
 * Present from the first release rather than added at the first migration.
 * A stored credential outlives the code that wrote it — that is the point of a
 * vault — and a value with no version is one a future reader has to guess about.
 */
export const OAUTH_CREDENTIAL_VERSION = 1;

/**
 * The installed-app client that obtained a grant (MAR-594).
 *
 * Google requires both values again when a refresh token is exchanged. Keeping
 * them beside the refresh token makes a stored grant self-contained: the broker
 * does not depend on the environment of whichever PowerShell happened to launch
 * DASH on the day the user signed in.
 *
 * The client secret is inside the same vault envelope as the refresh token. A
 * desktop client cannot keep this value confidential from its user, but it is
 * still a credential Google asks DASH to present and it belongs nowhere in
 * SQLite, renderer state, logs, or the repository.
 */
export interface OAuthClientCredential {
  client_id: string;
  client_secret: string;
}

export interface OAuthCredential {
  version: typeof OAUTH_CREDENTIAL_VERSION;
  /** The `OAuthProvider.id` that issued it, e.g. `google`. */
  provider: string;
  /**
   * The long-lived token. Never delivered to an agent, never rendered, never
   * logged — `lib/oauth/flow.ts` exchanges it for a short-lived access token at
   * the moment one is needed.
   */
  refresh_token: string;
  /** What the provider actually granted, which may be less than was asked. */
  scopes: string[];
  /** The account that granted it, for the row's identity. Null if unknown. */
  account: string | null;
  /** When this credential was obtained, ISO-8601. For display only. */
  obtained_at: string;
  /**
   * The client that obtained this grant, when its provider requires one.
   *
   * Optional for backwards compatibility with grants written before MAR-594
   * and for proof providers that genuinely need no client secret. New Google
   * grants always carry it.
   */
  client?: OAuthClientCredential;
}

/**
 * Serialize for the vault.
 *
 * Deliberately not pretty-printed. Nothing reads this by eye — if someone is
 * looking at it in a keychain viewer, the useful property is that it is one
 * opaque line rather than a labelled list of what DASH can do to their mail.
 */
export function serializeOAuthCredential(credential: OAuthCredential): string {
  return JSON.stringify(credential);
}

/**
 * Read a vault value back, or null when it is not one of ours.
 *
 * Null rather than a throw, because the realistic causes are ordinary rather
 * than exceptional: a manifest whose field changed from a typed secret to an
 * OAuth sign-in leaves an API key sitting under a name this now tries to parse,
 * and a credential written by a future version may carry a version this one does
 * not know. Both mean "DASH cannot use what is here", which is a state the
 * Connection Center already renders — `not_connected` with an invitation to
 * connect — rather than an error worth crashing a page over.
 *
 * Nothing about the offending value is included in any signal this returns. A
 * parse failure that quoted what it failed to parse would put a credential in
 * whatever caught it.
 */
export function parseOAuthCredential(stored: string): OAuthCredential | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate["version"] !== OAUTH_CREDENTIAL_VERSION) {
    return null;
  }
  if (typeof candidate["provider"] !== "string" || candidate["provider"] === "") {
    return null;
  }
  if (typeof candidate["refresh_token"] !== "string" || candidate["refresh_token"] === "") {
    return null;
  }

  const scopes = candidate["scopes"];
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) {
    return null;
  }

  const account = candidate["account"];
  if (account !== null && typeof account !== "string") {
    return null;
  }

  const obtainedAt = candidate["obtained_at"];
  if (typeof obtainedAt !== "string") {
    return null;
  }

  const client = candidate["client"];
  let parsedClient: OAuthClientCredential | undefined;
  if (client !== undefined) {
    if (typeof client !== "object" || client === null || Array.isArray(client)) {
      return null;
    }
    const clientCandidate = client as Record<string, unknown>;
    if (
      typeof clientCandidate["client_id"] !== "string" ||
      clientCandidate["client_id"] === "" ||
      typeof clientCandidate["client_secret"] !== "string" ||
      clientCandidate["client_secret"] === ""
    ) {
      return null;
    }
    parsedClient = {
      client_id: clientCandidate["client_id"],
      client_secret: clientCandidate["client_secret"],
    };
  }

  return {
    version: OAUTH_CREDENTIAL_VERSION,
    provider: candidate["provider"],
    refresh_token: candidate["refresh_token"],
    scopes: scopes as string[],
    account,
    obtained_at: obtainedAt,
    ...(parsedClient === undefined ? {} : { client: parsedClient }),
  };
}

/**
 * Does a stored credential still cover everything the manifest asks for?
 *
 * Consent screens have checkboxes. A user can grant Calendar read and decline
 * Calendar write, and Google will happily issue a refresh token for the subset —
 * so "the sign-in worked" and "the agent can do its job" are different
 * questions, and only asking the first is how an agent ends up failing at step
 * five of a plan the checklist said was ready.
 *
 * Missing scopes are returned rather than a boolean so the row can say which
 * permission is absent, in the provider's own plain-language words.
 */
export function missingScopes(
  credential: OAuthCredential,
  required: readonly string[],
): string[] {
  const granted = new Set(credential.scopes);
  return required.filter((scope) => !granted.has(scope));
}
