/**
 * Who actually holds the tokens behind a connection, and where its API lives
 * (MAR-458, ADR 0002).
 *
 * ADR 0002 says the broker is "the common boundary for native OAuth connections
 * and authenticated MCP servers", rendered with "the same permission receipt,
 * health, audit, revocation, and recovery model". The temptation in a first
 * slice is to hard-code Gmail and discover later that the grammar it grew does
 * not fit an MCP server. So the profile below carries the one field that makes
 * the two genuinely different — **who has custody of the credential** — from the
 * start, even though only one value of it is reachable today.
 *
 * That is not headroom invented in advance. It is the field ADR 0002 requires a
 * receipt to be honest about: "Installing a Gmail MCP server changes who owns
 * token custody; it does not remove OAuth consent or permission review." A card
 * grammar with no place to say that would have to be changed before it could be
 * shared, and a card that could not say it would be lying to the user in exactly
 * the case the ADR calls out.
 */

/**
 * Where the credential behind a capability actually lives.
 *
 * `dash_vault` is the only reachable value in this slice, and the type is the
 * shared vocabulary rather than a plan. The distinction is a user-facing fact,
 * not an implementation detail: with `dash_vault` a disconnect really does end
 * DASH's access, and with `remote_mcp_server` it does not, because the token was
 * never DASH's to delete.
 */
export type TokenCustodian =
  /** DASH holds the refresh token in this machine's OS vault. */
  | "dash_vault"
  /** A remote MCP server holds it. Disconnecting in DASH does not revoke it. */
  | "remote_mcp_server"
  /** A hosted token broker holds it, e.g. an optional deployment choice. */
  | "hosted_broker";

/**
 * Whose OAuth client the consent screen belongs to.
 *
 * ADR 0002 records the open problem plainly: "The Google desktop client ID is
 * currently compiled into DASH… this means DASH's Google Cloud project owns the
 * consent screen." That is a fact about the connection a user is entitled to see
 * on the card, and it is not the same fact as who holds the token afterwards —
 * so it is a separate field rather than a fifth custodian value.
 *
 * Bring-your-own-client *onboarding* — settings, validation, guided setup, the
 * honest weekly-expiry story — is explicitly ordered after this slice by ADR
 * 0002's own rollout. What this slice owes is that the card stops being silent
 * about which of the two is in force.
 */
export type OAuthClientOwner =
  /** DASH's own Google Cloud project. The consent screen says DASH. */
  | "dash_project"
  /** A client the user configured themselves. */
  | "user_project"
  /** Not applicable: this connection is not a native OAuth one. */
  | "not_oauth";

export interface BrokerProviderProfile {
  /** The manifest's `provider` string, e.g. `google-gmail`. */
  connection_provider: string;
  /** The `OAuthProvider.id` whose grant authorizes it, e.g. `google`. */
  oauth_provider_id: string;
  /** Friendly service name for a card, e.g. "Gmail". */
  label: string;
  token_custodian: TokenCustodian;
  client_owner: OAuthClientOwner;
  /**
   * The API origin every operation for this profile is built against.
   *
   * An origin and not a base path: `lib/broker/execute.ts` re-checks the planned
   * URL's origin against this value before it attaches a token, so a bug in an
   * operation's `plan` that produced an off-origin URL is refused rather than
   * sent — with the user's live access token attached — to whatever host the bug
   * named.
   */
  api_origin: string;
}

const GMAIL: BrokerProviderProfile = {
  connection_provider: "google-gmail",
  oauth_provider_id: "google",
  label: "Gmail",
  token_custodian: "dash_vault",
  client_owner: "dash_project",
  api_origin: "https://gmail.googleapis.com",
};

/**
 * The loopback profile the installed proof runs against.
 *
 * ## Why this exists at all
 *
 * MAR-458's required evidence is an installed proof that "drives a real read →
 * local-draft round trip and confirms no provider token is observable from the
 * agent process". Every link in that chain is DASH's — the agent's request, the
 * runner's relay, the grant check, the token mint, the HTTP call, the
 * projection, the audit row, the artifact — except the last one, which is
 * Google. And Google cannot be in an unattended proof: it needs a real account,
 * a real consent screen, a human, and a restricted-scope verification DASH does
 * not have (see ADR 0002's Google release path).
 *
 * A proof that stopped short of the HTTP call would be exactly the kind of
 * source-level claim `AGENTS.md` forbids: "Never claim an installed journey
 * works from source-level tests alone." So the harness stands up a provider on
 * loopback and DASH really calls it. What is proven is the boundary. What is not
 * proven, and is not claimed anywhere, is that Google's API behaves as modelled.
 *
 * ## Why it cannot be turned on by an agent
 *
 * Three conditions, all of which must hold:
 *
 * 1. `DASH_BROKER_PROOF_ORIGIN` is set **in the DASH process**. The `DASH_`
 *    namespace is refused into every child environment by
 *    `runner/supervisor.ts`, twice, so a hosted agent cannot set it for itself
 *    or read one that is set.
 * 2. The value parses as a URL whose scheme is `http:` and whose host is
 *    `127.0.0.1`. Anything else — a hostname, a public address, https, a path —
 *    is ignored entirely rather than sanitised, so a partially-valid value
 *    yields no profile rather than a profile pointed somewhere unintended.
 * 3. A manifest declares `provider: "dash-loopback-mail"`, which is not a
 *    service that exists, and a user has connected it. No real agent's manifest
 *    names it and no real provider answers for it.
 *
 * Anyone who can set an environment variable on the DASH process can already
 * replace DASH. The conditions above are not defence against that; they are what
 * stops the profile existing by accident on a machine nobody is running a proof
 * on, which is the realistic failure.
 */
const PROOF_CONNECTION_PROVIDER = "dash-loopback-mail";

function proofProfile(): BrokerProviderProfile | null {
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

  return {
    connection_provider: PROOF_CONNECTION_PROVIDER,
    oauth_provider_id: "google",
    label: "Loopback mail (proof harness)",
    token_custodian: "dash_vault",
    client_owner: "dash_project",
    api_origin: parsed.origin,
  };
}

/**
 * The profile for a manifest's provider string, or null.
 *
 * Resolved on every call rather than cached in a module constant, because the
 * proof profile's existence depends on an environment variable that the harness
 * sets before it seeds anything — and a cached list computed at import time
 * would be built before the harness had run.
 */
export function brokerProfileFor(connectionProvider: string): BrokerProviderProfile | null {
  if (connectionProvider === GMAIL.connection_provider) {
    return GMAIL;
  }
  const proof = proofProfile();
  if (proof !== null && connectionProvider === proof.connection_provider) {
    return proof;
  }
  return null;
}

/**
 * Whether a profile's operations are the Gmail ones.
 *
 * The proof profile borrows Gmail's operation set deliberately: a harness that
 * exercised operations nothing ships would prove a boundary that no user
 * crosses. `lib/broker/operations.ts` keys on `google-gmail`, so this is the one
 * place the borrowing is written down.
 */
export function operationProviderFor(profile: BrokerProviderProfile): string {
  return profile.connection_provider === PROOF_CONNECTION_PROVIDER
    ? GMAIL.connection_provider
    : profile.connection_provider;
}

/** Plain-language custody sentence for a card. Never an identifier. */
export function describeCustody(profile: BrokerProviderProfile): string {
  switch (profile.token_custodian) {
    case "dash_vault":
      return "DASH holds the sign-in for this connection in this computer's vault. The agent never receives it.";
    case "remote_mcp_server":
      return "A remote server holds the sign-in for this connection, not DASH. Disconnecting here stops DASH using it and does not withdraw the server's own access.";
    case "hosted_broker":
      return "A hosted service holds the sign-in for this connection, not this computer. Disconnecting here stops DASH using it.";
  }
}

/** Plain-language sentence about whose consent screen a user will see. */
export function describeClientOwner(profile: BrokerProviderProfile): string | null {
  switch (profile.client_owner) {
    case "dash_project":
      return "The sign-in screen is DASH's own, so this connection is registered to DASH rather than to you.";
    case "user_project":
      return "The sign-in screen is your own registered application, so this connection is registered to you.";
    case "not_oauth":
      return null;
  }
}
