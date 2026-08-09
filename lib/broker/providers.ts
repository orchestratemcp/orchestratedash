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

import { aiProviders, type AiProviderProfile } from "../ai/providers";
import {
  loopbackProofOrigin,
  LOOPBACK_PROOF_MANIFEST_PROVIDER,
  LOOPBACK_PROOF_PROVIDER_ID,
} from "../oauth/providers";

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

/**
 * What kind of credential sits behind a brokered connection (MAR-582).
 *
 * Added when a second kind arrived, and it is a distinction the broker genuinely
 * has to branch on rather than a label. The two differ in what DASH can *check*
 * before it acts: an OAuth grant carries the scopes the user actually consented
 * to, so `lib/broker/grant.ts` can intersect three independent parties. A
 * provider key carries nothing. It is a bearer of whatever the account can do,
 * and the third party in that intersection — the user, speaking through the
 * provider — has no way to say anything at all.
 *
 * So the narrowing DASH performs on a keyed connection is genuinely weaker than
 * the one it performs on a signed-in connection, and `describeKeyNarrowing`
 * exists so a card can say which of the two it is looking at. A grammar with no
 * place to state that would be the same failure `token_custodian` was added to
 * avoid: a receipt that cannot say what it does not know.
 */
export type BrokerCredentialKind =
  /** A refresh token DASH exchanges for scoped access, per connection. */
  | "oauth_grant"
  /** A key the user pasted, presented as-is. Carries no scopes to check. */
  | "provider_key";

export interface BrokerProviderProfile {
  /** The manifest's `provider` string, e.g. `google-gmail`. */
  connection_provider: string;
  /**
   * The `OAuthProvider.id` whose grant authorizes it, e.g. `google`, or null.
   *
   * Null exactly when `credential_kind` is `provider_key`. Nullable rather than
   * an empty string, so the one place that resolves a sign-in flow from it has
   * to say what it does with the absence instead of looking one up for `""`.
   */
  oauth_provider_id: string | null;
  /** Friendly service name for a card, e.g. "Gmail". */
  label: string;
  credential_kind: BrokerCredentialKind;
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
  credential_kind: "oauth_grant",
  token_custodian: "dash_vault",
  client_owner: "dash_project",
  api_origin: "https://gmail.googleapis.com",
};

/**
 * A model provider's profile, derived from the registry rather than restated
 * (MAR-582).
 *
 * `lib/ai/providers.ts` is the closed by-value list and it holds the facts that
 * decide a request: the origin, the path, the header scheme. This turns one of
 * those into the shape the broker's card grammar already speaks, and it is a
 * projection rather than a second table so the two cannot disagree about which
 * origin a key is sent to.
 *
 * `client_owner` is `not_oauth`, which is the true answer and also a useful one:
 * there is no consent screen at all here, so the question "whose application is
 * this registered to" has no meaning and `describeClientOwner` says nothing
 * rather than reassuring.
 */
function keyProfile(provider: AiProviderProfile): BrokerProviderProfile {
  return {
    connection_provider: provider.connection_provider,
    oauth_provider_id: null,
    label: provider.label,
    credential_kind: "provider_key",
    // The key really is in this machine's vault and a disconnect really does end
    // DASH's use of it — which is what `dash_vault` means. What it does not mean,
    // and `describeCustody` now says out loud for this kind, is that the key
    // stops existing at the provider.
    token_custodian: "dash_vault",
    client_owner: "not_oauth",
    api_origin: provider.api_origin,
  };
}

const KEY_PROFILES: readonly BrokerProviderProfile[] = Object.freeze(
  aiProviders().map(keyProfile),
);

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
const PROOF_CONNECTION_PROVIDER = LOOPBACK_PROOF_MANIFEST_PROVIDER;

function proofProfile(): BrokerProviderProfile | null {
  // The guard is `lib/oauth/providers.ts`'s, imported rather than restated. A
  // security check written twice is one that can be relaxed once, and this one
  // decides whether DASH sends a live token to something other than Google.
  const origin = loopbackProofOrigin();
  if (origin === null) {
    return null;
  }

  return {
    connection_provider: PROOF_CONNECTION_PROVIDER,
    oauth_provider_id: LOOPBACK_PROOF_PROVIDER_ID,
    label: "Loopback mail (proof harness)",
    credential_kind: "oauth_grant",
    token_custodian: "dash_vault",
    client_owner: "dash_project",
    api_origin: origin,
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
  const key = KEY_PROFILES.find(
    (profile) => profile.connection_provider === connectionProvider,
  );
  if (key !== undefined) {
    return key;
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
      // Two sentences for one custodian value, because the honest half differs.
      // A sign-in DASH deletes is one DASH can also ask the provider to
      // withdraw, and `lib/connection-actions.ts` does exactly that on
      // disconnect. A key DASH deletes goes on existing in the user's own
      // account, and there is no request DASH could make that would change
      // that — so the custody sentence has to stop one clause earlier than the
      // sign-in one, and say why (MAR-582).
      return profile.credential_kind === "provider_key"
        ? `DASH holds this ${profile.label} key in this computer's vault. The agent never receives it — ` +
            "it asks DASH, and DASH makes the request. Deleting it here stops DASH using it and does " +
            `not delete the key itself, which stays in your ${profile.label} account until you remove it there.`
        : "DASH holds the sign-in for this connection in this computer's vault. The agent never receives it.";
    case "remote_mcp_server":
      return "A remote server holds the sign-in for this connection, not DASH. Disconnecting here stops DASH using it and does not withdraw the server's own access.";
    case "hosted_broker":
      // Under ADR 0006 this value can only ever describe a third party's
      // hosted broker — DASH will not operate one — so the closing clause is
      // exactly as true here as for a remote server, and its absence was the
      // one custody description that under-stated, in the direction of
      // reassurance (MAR-483).
      return "A hosted service holds the sign-in for this connection, not this computer. Disconnecting here stops DASH using it and does not withdraw the service's own access.";
  }
}

/**
 * ADR 0006's option-3 sentence: what a brokered connection is worth to an
 * agent that keeps running while DASH is closed, said *before* the grant.
 *
 * The caller gates on `continues_when_dash_closed`, because for an agent that
 * stops with DASH the sentence would warn about a window in which the agent
 * does not exist. The shipped Gmail example is the shape this exists for: a
 * local agent, running around the clock, whose mailbox access nonetheless
 * begins and ends with DASH being open — legal, and until this sentence,
 * discovered afterwards as a lapse row rather than said up front.
 */
export function describeDashClosedWindow(profile: BrokerProviderProfile): string {
  return (
    `This agent can use your ${profile.label} connection only while DASH is open on this ` +
    "computer. When DASH is closed, the agent keeps running and its requests through this " +
    "connection go unanswered."
  );
}

/**
 * How much of the three-party check is actually available for this connection
 * (MAR-582).
 *
 * ADR 0002 amendment 1 states the rule a grant is decided by: DASH built the
 * operation, the author declared what it needs, and **the user, through the
 * provider**, granted it. The third is the one a user can see themselves giving,
 * on a consent screen with checkboxes, and it is the one that catches an agent
 * author widening their own access.
 *
 * A pasted key has no third party. There is no screen, no checkbox and no
 * per-connection consent — the key is a bearer of whatever the account behind it
 * can do, and no request DASH makes can narrow that. What remains is real and
 * worth saying plainly: DASH will only ever make the requests it has built, and
 * the key does not leave this computer. What must not be said is that the user
 * approved a narrow slice of their account, because they did not, and a card
 * implying it would be the "contract claim, not a technical firewall" ADR 0002
 * was written about, in the one place the user cannot check it.
 *
 * Null for a sign-in, where the intersection is whole and the card already
 * describes it through the granted capability list.
 */
export function describeKeyNarrowing(profile: BrokerProviderProfile): string | null {
  if (profile.credential_kind !== "provider_key") {
    return null;
  }
  return (
    `A ${profile.label} key is not like signing in: there is no screen where you tick what an agent ` +
    "may do, and the key can do everything your account can. What DASH can promise is narrower and " +
    "is the whole of it — the key stays on this computer, the agent never receives it, and DASH " +
    "will only make the requests it has been built to make. It cannot make the key itself smaller."
  );
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
