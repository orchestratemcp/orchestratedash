/**
 * The providers DASH can sign in to, and the permissions it will ever ask for
 * (MAR-446, DASH-29).
 *
 * MAR-383 refused every `oauth_reauthorization` field with one sentence, because
 * DASH had no authorization flow. This module is what turns that blanket refusal
 * into a question with two answers: DASH has a flow for *this* provider, or it
 * does not and says so. Nothing else about the refusal changes — a provider
 * absent from this file is refused exactly as everything was before.
 *
 * It is pure data and pure functions. No network, no Electron, no vault, no
 * `process.env` — the same rule `lib/connections.ts` and
 * `lib/connection-credentials.ts` hold themselves to, and for the same reason:
 * the interesting decisions here are refusals, and refusals are worth testing
 * without a browser or a Google account.
 *
 * ## Why the scope allowlist exists
 *
 * A manifest names the scopes it wants under `fields[].technical.provider_scopes`.
 * That field is written by whoever built the agent, and DASH puts it in front of
 * a user as a consent screen it opened. Without an allowlist, a manifest could
 * ask for `https://mail.google.com/` — full mailbox control, including delete —
 * and DASH would faithfully request it while the checklist above went on saying
 * "Read meeting requests".
 *
 * So a scope DASH does not have a plain-language sentence for is a scope DASH
 * will not ask Google for. The allowlist is that set, and the sentence beside
 * each entry is what the user actually reads. Adding a scope means writing the
 * sentence, which is the point.
 *
 * ## Why the client id is in the source
 *
 * `521961057282-…apps.googleusercontent.com` is a **Desktop app** client. RFC
 * 8252 §8.5 and Google's own guidance are that such a client is public: it has
 * no secret, it cannot keep one, and its id is not a credential. What makes the
 * flow safe is PKCE (`lib/oauth/pkce.ts`), which binds the authorization code to
 * the one process that started the exchange — not the confidentiality of an id
 * that ships inside every copy of the app anyway.
 */

/** How a scope is described to the person approving it. Never the scope itself. */
export interface PermissionCopy {
  /** One sentence, plain language, no identifiers. Rendered on the prompt. */
  label: string;
  /**
   * Whether granting this lets the agent change something at the provider.
   * Drives ordering — the write permissions are shown first, because they are
   * the ones worth reading.
   */
  access: "read" | "write";
}

export interface OAuthProvider {
  /** DASH's own id for the flow, e.g. `google`. */
  id: string;
  /** Friendly provider name for copy, e.g. "Google". */
  label: string;
  /** Public client id. Not a secret — see the note at the top of the file. */
  client_id: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
  /**
   * Every scope DASH is willing to request, with the words shown for it.
   *
   * A manifest asking for anything outside this map is refused by
   * `checkRequestedScopes` before a browser is ever opened.
   */
  permissions: Readonly<Record<string, PermissionCopy>>;
  /**
   * Scopes DASH always adds, regardless of what the manifest asked for.
   *
   * Only identity here. DASH needs to be able to tell the user *which account*
   * they connected — a Connection Center row reading "connected ••••4f2a" for a
   * Google account would be useless, and a user with two Gmail accounts could
   * not tell which one an agent is about to send mail from.
   */
  identity_scopes: readonly string[];
  /** Extra authorization parameters this provider needs. */
  authorization_params: Readonly<Record<string, string>>;
}

/**
 * Google, as one flow.
 *
 * Gmail and Calendar are separate *connections* in a manifest and separate rows
 * in the Connection Center, but they are one authorization server, one client
 * and one consent screen shape. Splitting them into two providers here would
 * duplicate every endpoint so that two rows could disagree about them.
 *
 * They still get separate vault entries and separate sign-ins:
 * `connectionSecretName` keys on the connection id, so connecting Gmail does not
 * silently connect Calendar. That is deliberate — consenting to read mail is not
 * consenting to write calendar events, and one button that did both would be
 * DASH deciding the user meant more than they clicked.
 */
const GOOGLE: OAuthProvider = {
  id: "google",
  label: "Google",
  client_id: "521961057282-69kbonobgup2vhhffqb2o6vds3figov7.apps.googleusercontent.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  revocation_endpoint: "https://oauth2.googleapis.com/revoke",
  permissions: {
    "https://www.googleapis.com/auth/gmail.readonly": {
      label: "Read the messages in your Gmail",
      access: "read",
    },
    "https://www.googleapis.com/auth/gmail.compose": {
      label: "Write and save Gmail drafts, and send them",
      access: "write",
    },
    "https://www.googleapis.com/auth/calendar.readonly": {
      label: "See the events in your calendar",
      access: "read",
    },
    "https://www.googleapis.com/auth/calendar.events": {
      label: "Create and change events in your calendar",
      access: "write",
    },
  },
  // `openid` and `email` together are what make the id token carry an address.
  // Neither grants access to any user data beyond who the user is.
  identity_scopes: ["openid", "email"],
  authorization_params: {
    // Without this Google returns a refresh token on the first authorization
    // only, and never again for the same client and account. A user who
    // disconnected and reconnected would get an access token that worked for an
    // hour and then a connection that could never be renewed.
    access_type: "offline",
    // Forces the consent screen every time. The cost is a click on reconnect;
    // the benefit is that `access_type: offline` reliably yields a refresh
    // token, and that reconnecting is a moment the user actually sees what they
    // are granting rather than being silently re-approved.
    prompt: "consent",
  },
};

const PROVIDERS: readonly OAuthProvider[] = [GOOGLE];

/**
 * Which flow serves a manifest's `provider` string.
 *
 * Manifests name a service (`google-gmail`), not an authorization server
 * (`google`), because the checklist row is about the service. The mapping is
 * explicit rather than a prefix match: `google-gmail` and `google-calendar` are
 * listed by hand so that a manifest inventing `google-drive` is refused with
 * "DASH has no sign-in for this" instead of being quietly pointed at Google with
 * scopes nobody wrote copy for.
 */
const FLOW_BY_MANIFEST_PROVIDER: Readonly<Record<string, string>> = {
  "google-gmail": "google",
  "google-calendar": "google",
};

/**
 * The flow for a manifest's provider, or null when DASH has none.
 *
 * Null is the MAR-383 behaviour preserved exactly: no flow means the field is
 * refused and the row explains that the agent handles its own sign-in.
 */
export function oauthProviderFor(manifestProvider: string): OAuthProvider | null {
  const flowId = FLOW_BY_MANIFEST_PROVIDER[manifestProvider];
  if (flowId === undefined) {
    return null;
  }
  return PROVIDERS.find((provider) => provider.id === flowId) ?? null;
}

/** Look a flow up by its own id — used when reading a stored credential back. */
export function oauthProviderById(id: string): OAuthProvider | null {
  return PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/**
 * Scopes a manifest asked for that DASH will not request.
 *
 * Returns the offenders rather than a boolean so the refusal can be specific in
 * a log — though not in front of the user, where naming a scope would break the
 * plain-language rule `lib/copy/identifiers.ts` enforces.
 */
export function checkRequestedScopes(
  provider: OAuthProvider,
  scopes: readonly string[],
): string[] {
  return scopes.filter((scope) => !Object.hasOwn(provider.permissions, scope));
}

/**
 * What the consent prompt lists, in the order it lists them.
 *
 * Write permissions first. A consent screen is read top-down and abandoned
 * halfway, so the line that says an agent can send mail should not be under the
 * line that says it can read it. Within an access level the manifest's order is
 * kept, because that is the agent author's.
 *
 * Identity scopes are deliberately absent: "know who you are" on a screen the
 * user reached by pressing Connect on their own account is noise that pushes the
 * permissions that matter further down.
 */
export function describePermissions(
  provider: OAuthProvider,
  scopes: readonly string[],
): string[] {
  const copy = scopes
    .map((scope) => provider.permissions[scope])
    .filter((entry): entry is PermissionCopy => entry !== undefined);
  return [
    ...copy.filter((entry) => entry.access === "write"),
    ...copy.filter((entry) => entry.access === "read"),
  ].map((entry) => entry.label);
}

/**
 * The full scope string sent to the authorization endpoint.
 *
 * Deduplicated and stably ordered so that two authorizations asking for the same
 * access produce the same request — which makes the URL a thing a test can
 * assert on rather than a set with an arbitrary order.
 */
export function authorizationScopes(
  provider: OAuthProvider,
  scopes: readonly string[],
): string[] {
  return [...new Set([...provider.identity_scopes, ...scopes])];
}
