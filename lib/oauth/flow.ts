/**
 * The three requests DASH makes to an authorization server (MAR-446, DASH-29).
 *
 * Build a URL, exchange a code for tokens, exchange a refresh token for an
 * access token — plus revocation, which is the fourth and the one a disconnect
 * owes the user. Everything network-facing about OAuth is here; everything
 * policy-facing is in `lib/oauth/providers.ts` and everything storage-facing is
 * in `lib/oauth/credential.ts`.
 *
 * ## `fetch` is a parameter
 *
 * Not for mockability as an end in itself. The behaviour worth testing is the
 * *classification* — that Google's `400 {"error":"invalid_grant"}` becomes
 * `revoked` and not a generic failure, which is a MAR-446 acceptance criterion
 * in as many words; and, since MAR-542, that `{"error":"invalid_client"}`
 * becomes `client_misconfigured` rather than the same report-this sentence
 * every other malformed request gets. Pinning either needs a server that
 * returns exactly that body, and a real one cannot be asked to — nor can
 * `electron/smoke.ts`'s loopback fixture, whose `/token` route answers every
 * request with `200` and cannot produce either shape (MAR-508).
 *
 * ## Nothing here logs
 *
 * Not the request, not the response, not the failure. Every one of these calls
 * has a token in the body or the reply, and a `console.error(error)` on a failed
 * exchange is the classic way one reaches a log file — the error objects this
 * throws carry a code and a sentence, and never the response body they came
 * from.
 */

import { parseOAuthCredential, type OAuthCredential, OAUTH_CREDENTIAL_VERSION } from "./credential";
import { authorizationScopes, type OAuthProvider } from "./providers";

/**
 * Why an OAuth request failed, in the four kinds that need different words.
 *
 * `revoked` is separated from the rest because MAR-446 requires it: someone
 * withdrawing access at Google's end must read as a deliberate act with a
 * recovery, not as "something went wrong". `lib/copy/recovery.ts` already had
 * the sentence for it since MAR-423 and nothing had ever been able to produce
 * the condition.
 */
export type OAuthFailureCode =
  /** The refresh token is dead: withdrawn at the provider, or expired by policy. */
  | "revoked"
  /** DASH could not reach the provider at all. */
  | "network"
  /** The provider answered, and said no for some other reason. */
  | "provider_refused"
  /**
   * The provider rejected DASH's own client id or secret — RFC 6749 §5.2's
   * `invalid_client` (MAR-542). Distinct from `provider_refused` because the
   * fix is concrete and belongs to whoever configured DASH: the client secret
   * is wrong or was never set. Every other malformed-request code stays under
   * `provider_refused`, because none of the rest names the client
   * credentials specifically the way `invalid_client` does — see the
   * `postForm` note below.
   */
  | "client_misconfigured"
  /** The provider answered with something that was not a token response. */
  | "malformed_response";

export class OAuthError extends Error {
  readonly code: OAuthFailureCode;

  constructor(code: OAuthFailureCode, message: string) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
  }
}

export function isOAuthError(value: unknown): value is OAuthError {
  return value instanceof OAuthError;
}

/** A short-lived token, as delivered to an agent. */
export interface AccessToken {
  access_token: string;
  /** Absolute expiry, ISO-8601. Absolute rather than a duration because it is
   * computed here and read somewhere else, and a duration would silently mean
   * "from whenever you happen to read this". */
  expires_at: string;
  scopes: string[];
}

/* ---------------------------------------------------------------------- *
 * Authorization
 * ---------------------------------------------------------------------- */

export interface AuthorizationRequest {
  redirect_uri: string;
  scopes: readonly string[];
  challenge: string;
  state: string;
  /**
   * The account to prefer on the consent screen, when reconnecting one DASH
   * already knows. A hint only — the user can pick another, and DASH records
   * whichever one comes back rather than the one it suggested.
   */
  login_hint?: string | null;
}

/**
 * The URL the system browser is sent to.
 *
 * Built with `URLSearchParams` rather than string concatenation because two of
 * these values are base64url and one is a space-separated list of URLs; a
 * hand-built query string gets that wrong in a way that surfaces as a consent
 * screen missing a permission rather than as an error.
 */
export function buildAuthorizationUrl(
  provider: OAuthProvider,
  request: AuthorizationRequest,
): string {
  const url = new URL(provider.authorization_endpoint);
  const params: Record<string, string> = {
    ...provider.authorization_params,
    client_id: provider.client_id,
    response_type: "code",
    redirect_uri: request.redirect_uri,
    scope: authorizationScopes(provider, request.scopes).join(" "),
    code_challenge: request.challenge,
    code_challenge_method: "S256",
    state: request.state,
  };
  if (request.login_hint != null && request.login_hint !== "") {
    params["login_hint"] = request.login_hint;
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/* ---------------------------------------------------------------------- *
 * Token requests
 * ---------------------------------------------------------------------- */

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  id_token?: unknown;
  error?: unknown;
}

/**
 * POST a form to a token endpoint and classify whatever comes back.
 *
 * The classification is the whole job. A transport failure and a `400
 * invalid_grant` are both "it did not work" to a caller that only checks for a
 * throw, and they mean opposite things to a user: one is "try again in a
 * minute", the other is "your access was taken away and trying again will not
 * help".
 */
async function postForm(
  endpoint: string,
  body: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // The caught value is dropped rather than wrapped. A fetch rejection can
    // carry the request — which has a refresh token in its body — and an error
    // chain that reached a log would take it along.
    throw new OAuthError("network", "Could not reach the sign-in service.");
  }

  let parsed: TokenResponse;
  try {
    parsed = (await response.json()) as TokenResponse;
  } catch {
    throw new OAuthError("malformed_response", "The sign-in service sent an unreadable reply.");
  }

  if (!response.ok) {
    // The one error code with a specific meaning. RFC 6749 §5.2 defines
    // `invalid_grant` as the grant being invalid, expired or revoked, and
    // Google returns it for a refresh token the user withdrew in their account
    // settings — which is exactly the case MAR-446 says must not read as
    // generic.
    if (parsed.error === "invalid_grant") {
      throw new OAuthError("revoked", "The sign-in is no longer valid.");
    }
    // MAR-542: the second error code with a specific meaning, and the one this
    // used to fall through with everything else. RFC 6749 §5.2 defines
    // `invalid_client` as client authentication failing — an unknown client,
    // none included, or an unsupported method — which for this flow means
    // exactly one thing: the client secret DASH sent does not match what
    // Google has on file, or DASH sent none. That is not a report-this fault
    // and not the account's — it is whoever configured DASH's own client
    // secret, and the recovery in `lib/copy/recovery.ts` says so by name.
    // `invalid_request`, `unauthorized_client` and `unsupported_grant_type`
    // stay under `provider_refused` below: none of them names the client
    // credentials the way `invalid_client` does, and RFC 6749 §5.2 lets
    // `invalid_request` cover a missing parameter, a duplicated one, or any
    // other malformed field, so narrowing it here would be a guess dressed as
    // a diagnosis.
    if (parsed.error === "invalid_client") {
      throw new OAuthError(
        "client_misconfigured",
        "The sign-in service rejected DASH's own client credentials.",
      );
    }
    // Deliberately does not include `parsed.error_description`. It is
    // provider-written text landing in a DASH surface, and the codes above are
    // enough to choose a sentence with.
    throw new OAuthError("provider_refused", "The sign-in service refused the request.");
  }

  return parsed;
}

function readScopes(scope: unknown, fallback: readonly string[]): string[] {
  // Google echoes the granted scopes on the token response, and they may be
  // fewer than were asked for. When it says nothing, the request's scopes are
  // the honest assumption — but `missingScopes` still checks them against what
  // the manifest needs, so an over-assumption here cannot claim a permission
  // the provider silently withheld without the row noticing.
  return typeof scope === "string" && scope !== "" ? scope.split(" ") : [...fallback];
}

function expiresAt(expiresIn: unknown, now: Date): string {
  // A conservative default when the provider omits it. Underestimating an
  // expiry costs one extra refresh; overestimating means handing an agent a
  // token that is already dead.
  const seconds = typeof expiresIn === "number" && expiresIn > 0 ? expiresIn : 3600;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/**
 * The email an id token claims, or null.
 *
 * The signature is not verified, and that is correct here rather than a
 * shortcut: this token did not arrive from a browser or a third party, it came
 * back in the body of a TLS request DASH made directly to the provider's token
 * endpoint. OpenID Connect Core §3.1.3.7 says exactly this — a client that
 * obtains the id token over a direct, authenticated channel to the issuer may
 * skip signature validation.
 *
 * Anything unexpected returns null, and null degrades to a row that says
 * "connected" without naming an account. Never a throw: a missing display detail
 * must not fail a sign-in that otherwise worked.
 */
export function accountFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") {
    return null;
  }
  const segments = idToken.split(".");
  if (segments.length !== 3 || segments[1] === undefined) {
    return null;
  }
  try {
    const payload: unknown = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const email = (payload as Record<string, unknown>)["email"];
    return typeof email === "string" && email !== "" ? email : null;
  } catch {
    return null;
  }
}

/**
 * Trade an authorization code for a credential DASH can keep.
 *
 * Returns the whole envelope rather than a raw token response, so the only
 * shape that ever reaches the vault is the one `lib/oauth/credential.ts`
 * defines. A missing refresh token is a hard failure: without it DASH holds
 * something that stops working within the hour and cannot be renewed, which is
 * a connection that would look fine on the checklist and fail later.
 */
export async function exchangeAuthorizationCode(
  provider: OAuthProvider,
  request: { code: string; verifier: string; redirect_uri: string; scopes: readonly string[] },
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<{ credential: OAuthCredential; access: AccessToken }> {
  const response = await postForm(
    provider.token_endpoint,
    {
      client_id: provider.client_id,
      ...(provider.client_secret !== undefined ? { client_secret: provider.client_secret } : {}),
      code: request.code,
      code_verifier: request.verifier,
      grant_type: "authorization_code",
      redirect_uri: request.redirect_uri,
    },
    fetchImpl,
  );

  if (typeof response.access_token !== "string" || response.access_token === "") {
    throw new OAuthError("malformed_response", "The sign-in service sent no access token.");
  }
  if (typeof response.refresh_token !== "string" || response.refresh_token === "") {
    throw new OAuthError(
      "malformed_response",
      "The sign-in service did not offer a way to stay connected.",
    );
  }

  const scopes = readScopes(response.scope, authorizationScopes(provider, request.scopes));

  return {
    credential: {
      version: OAUTH_CREDENTIAL_VERSION,
      provider: provider.id,
      refresh_token: response.refresh_token,
      scopes,
      account: accountFromIdToken(response.id_token),
      obtained_at: now.toISOString(),
      ...(provider.client_secret === undefined
        ? {}
        : {
            client: {
              client_id: provider.client_id,
              client_secret: provider.client_secret,
            },
          }),
    },
    access: {
      access_token: response.access_token,
      expires_at: expiresAt(response.expires_in, now),
      scopes,
    },
  };
}

/**
 * Mint a short-lived access token from a stored credential.
 *
 * Called at two moments and no others: when checking a connection, and when
 * spawning an agent that declared somewhere to receive one. It does not update
 * the stored envelope — providers may rotate a refresh token, but Google does
 * not for this grant type, and a vault write on every agent start would be a
 * write path running with no user watching it.
 */
export async function refreshAccessToken(
  provider: OAuthProvider,
  credential: OAuthCredential,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<AccessToken> {
  // MAR-594. A Google grant remembers the desktop client that obtained it.
  // Falling back keeps pre-MAR-594 and no-secret proof credentials readable,
  // while every new real-Google refresh is independent of the process
  // environment that happened to exist during consent.
  const clientId = credential.client?.client_id ?? provider.client_id;
  const clientSecret = credential.client?.client_secret ?? provider.client_secret;
  const response = await postForm(
    provider.token_endpoint,
    {
      client_id: clientId,
      ...(clientSecret !== undefined ? { client_secret: clientSecret } : {}),
      refresh_token: credential.refresh_token,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );

  if (typeof response.access_token !== "string" || response.access_token === "") {
    throw new OAuthError("malformed_response", "The sign-in service sent no access token.");
  }

  return {
    access_token: response.access_token,
    expires_at: expiresAt(response.expires_in, now),
    scopes: readScopes(response.scope, credential.scopes),
  };
}

/**
 * Tell the provider to forget this grant.
 *
 * Best-effort by design, and the caller proceeds regardless. Disconnect's
 * promise to the user is that DASH no longer holds their credential, and DASH
 * can keep that promise offline; revoking at the provider is the stronger thing
 * to do when the network allows, not a precondition for the weaker one.
 *
 * Returns whether it succeeded so the copy can be accurate about which of the
 * two happened — "removed and access withdrawn" is a different sentence from
 * "removed from this computer".
 */
export async function revokeCredential(
  provider: OAuthProvider,
  credential: OAuthCredential,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(provider.revocation_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: credential.refresh_token }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Read a vault value as an OAuth credential.
 *
 * A thin re-export so callers outside this directory have one import for "the
 * OAuth things" rather than reaching into two modules to do one job.
 */
export { parseOAuthCredential };
