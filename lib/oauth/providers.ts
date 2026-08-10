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

/**
 * The client values a desktop authorization server expects (MAR-594).
 *
 * They are kept separate from scopes and endpoints: a renderer may supply these
 * two values, but it can never influence where DASH sends them or what access
 * DASH asks for. `configureOAuthProvider` overlays only the client pair onto a
 * provider selected in main from the validated manifest.
 */
export interface OAuthClientConfiguration {
  client_id: string;
  client_secret: string;
}

export type OAuthClientConfigurationKind = "built_in" | "user_supplied";

export interface OAuthProvider {
  /** DASH's own id for the flow, e.g. `google`. */
  id: string;
  /** Friendly provider name for copy, e.g. "Google". */
  label: string;
  /** Public client id. Not a secret — see the note at the top of the file. */
  client_id: string;
  /**
   * The confidential half of the client, when the provider requires one
   * (MAR-508).
   *
   * Google does: PKCE does not replace a client secret for Google's own
   * Desktop app client type, and asked directly, with a deliberately invalid
   * code and exactly the parameters `lib/oauth/flow.ts` sent before this
   * field existed, Google refused with `client_secret is missing.` before it
   * looked at the code at all.
   *
   * Undefined, never a required field: a provider that does not ask for one
   * — the loopback proof provider, and any future provider that genuinely has
   * none — must be able to say so by omission rather than by an empty string
   * a careless caller could still send.
   */
  client_secret?: string;
  /**
   * Whether the client is part of this build or supplied by the person using
   * it. Google is user-supplied: a real desktop client is created in the user's
   * Cloud project and its values are stored with the grant in the OS vault.
   */
  client_configuration: OAuthClientConfigurationKind;
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
 *
 * ## Where the client secret comes from (MAR-508)
 *
 * `DASH_GOOGLE_CLIENT_SECRET`, read fresh on every call rather than once at
 * import — the same choice `loopbackProofOrigin` below makes, and for the same
 * reason: a module-load-time read would be invisible to a test that sets the
 * variable per case. It is never committed and never compiled in, unlike
 * `client_id` — see the option this picked in MAR-508's own note: supplied
 * locally, enough to execute the flow and the attended proof, prejudging
 * neither the compiled-secret option ADR 0002 already flags as a present-tense
 * problem nor the bring-your-own-client option MAR-471 owns.
 * `docs/real-google-proof-runbook.md` documents the variable for whoever runs
 * that proof next.
 */
function googleClientSecret(): string | undefined {
  const value = process.env["DASH_GOOGLE_CLIENT_SECRET"];
  return value !== undefined && value.length > 0 ? value : undefined;
}

function googleClientId(): string {
  const value = process.env["DASH_GOOGLE_CLIENT_ID"];
  return value !== undefined && value.length > 0
    ? value
    : "521961057282-69kbonobgup2vhhffqb2o6vds3figov7.apps.googleusercontent.com";
}

function googleProvider(): OAuthProvider {
  return {
    id: "google",
    label: "Google",
    client_id: googleClientId(),
    client_secret: googleClientSecret(),
    client_configuration: "user_supplied",
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
}

/* ---------------------------------------------------------------------- *
 * The loopback proof provider (MAR-458)
 * ---------------------------------------------------------------------- */

/**
 * The origin the installed proof harness serves a fake provider on, or null.
 *
 * **The single guard**, imported by `lib/broker/providers.ts` rather than
 * restated there. A security check written twice is a security check that can be
 * relaxed once, and this one decides whether DASH will send a token exchange
 * somewhere other than Google.
 *
 * Three things must all hold, and the second is the one that does the work:
 *
 * 1. `DASH_BROKER_PROOF_ORIGIN` is set **in the DASH process**. The `DASH_`
 *    namespace is refused into every child environment by
 *    `runner/supervisor.ts`, twice over, so a hosted agent can neither set this
 *    for itself nor read one that is set.
 * 2. The value parses as a URL whose scheme is `http:` and whose host is
 *    literally `127.0.0.1`. Not "resolves to loopback" — `localhost` is refused,
 *    because what `localhost` resolves to is a property of a hosts file. A
 *    partially-valid value yields null rather than being repaired.
 * 3. Something asks for the proof provider by a name no real service uses.
 *
 * Anyone able to set an environment variable on the DASH process can already
 * replace DASH outright; this is not a defence against that. It is what stops
 * the profile existing by accident on a machine nobody is running a proof on,
 * which is the failure that would actually occur.
 *
 * ## Why a fake provider exists at all
 *
 * MAR-458's required evidence is an installed proof of a real read → local-draft
 * round trip. Every link in that chain is DASH's except the last, and the last
 * cannot be in an unattended proof: it needs a Google account, a human at a
 * consent screen, and a restricted-scope verification DASH does not have (ADR
 * 0002, "Google release path"). A proof that stopped before the HTTP call would
 * be the source-level claim `AGENTS.md` forbids. So the harness serves the
 * provider and DASH really calls it. What is proven is the boundary; that
 * Google's API behaves as modelled is not proven and is not claimed.
 */
export function loopbackProofOrigin(): string | null {
  const configured = process.env.DASH_BROKER_PROOF_ORIGIN;
  if (configured === undefined || configured.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    return null;
  }
  return parsed.origin;
}

/** The `OAuthProvider.id` of the proof flow. Not a service that exists. */
export const LOOPBACK_PROOF_PROVIDER_ID = "dash-loopback";

/** The manifest `provider` string the proof flow serves. Also not a service. */
export const LOOPBACK_PROOF_MANIFEST_PROVIDER = "dash-loopback-mail";

/**
 * The proof flow, when the guard allows one.
 *
 * Built per call rather than held in a module constant, because its endpoints
 * depend on a port the harness binds after this module is imported.
 *
 * Its permissions map is Gmail's read and compose scopes, and nothing else.
 *
 * The read scope was the whole map until MAR-469, and the reason recorded here
 * was that "a proof provider that could be granted a write scope DASH has no
 * operation for would be modelling a situation the real one is designed to make
 * impossible". That reason expired the day `gmail.draft.create` shipped: DASH
 * now has an operation on the compose scope, so a proof that could not be
 * granted it would be the one modelling an impossible situation — a broker whose
 * only write is unreachable by its own installed proof.
 *
 * It is still deliberately *not* a copy of Gmail's whole map. Nothing here can
 * be granted a scope no operation is built on, which keeps the same property the
 * original note was reaching for: the harness cannot model a permission DASH
 * would never actually use.
 */
function proofProvider(): OAuthProvider | null {
  const origin = loopbackProofOrigin();
  if (origin === null) {
    return null;
  }
  return {
    id: LOOPBACK_PROOF_PROVIDER_ID,
    label: "Loopback mail (proof harness)",
    client_id: "dash-loopback-proof-client",
    client_configuration: "built_in",
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/token`,
    revocation_endpoint: `${origin}/revoke`,
    permissions: {
      "https://www.googleapis.com/auth/gmail.readonly": {
        label: "Read the messages in your mailbox",
        access: "read",
      },
      "https://www.googleapis.com/auth/gmail.compose": {
        label: "Write and save drafts in your mailbox, and send them",
        access: "write",
      },
    },
    identity_scopes: ["openid", "email"],
    authorization_params: { access_type: "offline", prompt: "consent" },
  };
}

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
  if (manifestProvider === LOOPBACK_PROOF_MANIFEST_PROVIDER) {
    return proofProvider();
  }
  const flowId = FLOW_BY_MANIFEST_PROVIDER[manifestProvider];
  if (flowId !== "google") {
    return null;
  }
  return googleProvider();
}

/** Look a flow up by its own id — used when reading a stored credential back. */
export function oauthProviderById(id: string): OAuthProvider | null {
  if (id === LOOPBACK_PROOF_PROVIDER_ID) {
    return proofProvider();
  }
  return id === "google" ? googleProvider() : null;
}

/**
 * Read a client pair received from the credential-only renderer.
 *
 * No coercion, no trimming, and no echo on failure. Whitespace and control
 * characters are refused rather than repaired so the exact bytes stored are the
 * exact bytes Google receives. The generous caps are denial-of-service bounds,
 * not guesses about Google's current format.
 */
export function parseOAuthClientConfiguration(value: unknown): OAuthClientConfiguration | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const clientId = candidate["client_id"];
  const clientSecret = candidate["client_secret"];
  if (
    typeof clientId !== "string" ||
    clientId.length === 0 ||
    clientId.length > 1024 ||
    clientId.trim() !== clientId ||
    typeof clientSecret !== "string" ||
    clientSecret.length === 0 ||
    clientSecret.length > 4096 ||
    clientSecret.trim() !== clientSecret ||
    /[\u0000-\u001f\u007f]/u.test(clientId) ||
    /[\u0000-\u001f\u007f]/u.test(clientSecret)
  ) {
    return null;
  }
  return { client_id: clientId, client_secret: clientSecret };
}

/**
 * Bind a user-supplied client to endpoints and policy selected by DASH.
 *
 * A built-in provider ignores renderer input entirely. For a user-supplied
 * provider the two client fields are the only members replaced; authorization,
 * token and revocation endpoints, scopes, copy and extra parameters remain the
 * provider registry's.
 */
export function configureOAuthProvider(
  provider: OAuthProvider,
  value: unknown,
): OAuthProvider | null {
  if (provider.client_configuration === "built_in") {
    return provider;
  }
  const configured = parseOAuthClientConfiguration(value);
  if (configured === null) {
    return null;
  }
  return {
    ...provider,
    client_id: configured.client_id,
    client_secret: configured.client_secret,
  };
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
