/**
 * One provider sign-in, from the button to the stored envelope
 * (MAR-446, DASH-29).
 *
 * This is the only place the four pure OAuth modules are wired to the two impure
 * things they need: a browser to send the user to, and a socket to hear back on.
 * Everything it decides — which provider, which scopes, what a failure means —
 * was decided in `lib/oauth/`; what happens here is sequencing and cleanup.
 *
 * ## Why the system browser and not a window
 *
 * RFC 8252 §8.12 says an installed app must use an external user-agent, and
 * Google enforces it: an embedded webview gets `disallowed_useragent` and never
 * reaches a consent screen. Both are right, and the reason is the one MAR-446
 * warns about from the other direction — a sign-in rendered inside DASH is a
 * DASH window asking for a Google password, which is indistinguishable from the
 * thing users are told never to trust, and it would put a page DASH controls
 * between a user and their credential.
 *
 * The system browser also means the user's existing Google session, password
 * manager and second factor are all where they already are.
 *
 * ## Cancellation
 *
 * Every path releases the port. The listener closes on success, on failure, on
 * the user pressing Cancel in the prompt window, and on the five-minute timeout
 * inside `startLoopback` — and `close()` is idempotent, so the `finally` here
 * does not have to know which of them happened first.
 */

import { shell } from "electron";

import type { AuthorizationOutcome, OAuthOperations } from "../lib/connection-actions";
import type { CredentialTarget } from "../lib/connection-credentials";
import type { AuthorizationFailureCode } from "../lib/copy/recovery";
import type { OAuthCredential } from "../lib/oauth/credential";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  isOAuthError,
  refreshAccessToken,
  revokeCredential,
  type AccessToken,
} from "../lib/oauth/flow";
import { isLoopbackError, startLoopback, type LoopbackListener } from "../lib/oauth/loopback";
import { createPkcePair, createState } from "../lib/oauth/pkce";
import { oauthProviderById, type OAuthProvider } from "../lib/oauth/providers";

/**
 * A sign-in in progress.
 *
 * Handed back so the prompt window can cancel it — the user pressing Cancel
 * while a browser tab sits open on a consent screen has to end the wait, and the
 * window is the only thing that knows they did.
 */
export interface AuthorizationSession {
  outcome: Promise<AuthorizationOutcome>;
  cancel(): void;
}

/**
 * Turn whatever went wrong into one of the codes `describeAuthorizationFailure`
 * has words for.
 *
 * The default is `provider_error` rather than a rethrow. An unclassified throw
 * escaping into the IPC dispatcher would surface as a command that failed with
 * no recovery at all, which is a worse answer than a slightly generic one — and
 * the two error types above cover every failure either of the modules below
 * actually produces.
 */
function classify(error: unknown): AuthorizationFailureCode {
  if (isOAuthError(error)) {
    return error.code;
  }
  if (isLoopbackError(error)) {
    return error.code;
  }
  return "provider_error";
}

/**
 * Start a sign-in: bind the port, open the browser, wait, exchange.
 *
 * The order matters and is the order below. Binding before opening means the
 * redirect cannot arrive before DASH is listening for it. Opening the browser
 * before waiting means the URL is out of DASH's hands before anything blocks.
 */
export function startAuthorization(
  provider: OAuthProvider,
  scopes: readonly string[],
  loginHint: string | null,
): AuthorizationSession {
  let listener: LoopbackListener | null = null;
  let cancelled = false;

  const outcome = (async (): Promise<AuthorizationOutcome> => {
    const state = createState();
    const pkce = createPkcePair();

    try {
      listener = await startLoopback(state);
      if (cancelled) {
        // Cancelled between the two awaits. Without this the port would be
        // bound with nobody waiting on it until the timeout.
        listener.close("cancelled");
        return { ok: false, code: "cancelled" };
      }

      const url = buildAuthorizationUrl(provider, {
        redirect_uri: listener.redirect_uri,
        scopes,
        challenge: pkce.challenge,
        state,
        login_hint: loginHint,
      });

      // The URL carries no credential — a client id, a redirect, a scope list,
      // a challenge and a state. The verifier that makes the exchange safe stays
      // in this process and is never in anything openable.
      await shell.openExternal(url);

      const code = await listener.wait();

      const exchanged = await exchangeAuthorizationCode(provider, {
        code,
        verifier: pkce.verifier,
        redirect_uri: listener.redirect_uri,
        scopes,
      });

      // The access token from the exchange is deliberately dropped. Spawn-time
      // delivery mints its own from the refresh token, so keeping this one would
      // mean a second copy of a live token in memory for no caller.
      return { ok: true, credential: exchanged.credential };
    } catch (error: unknown) {
      return { ok: false, code: classify(error) };
    } finally {
      listener?.close();
    }
  })();

  return {
    outcome,
    cancel: () => {
      cancelled = true;
      listener?.close("cancelled");
    },
  };
}

/**
 * Mint a short-lived access token for a stored grant.
 *
 * The one function outside this file's own flow, used by spawn-time delivery in
 * `electron/main.ts`. It throws rather than returning an outcome, because its
 * caller genuinely has nothing to say to a user — an agent is starting, and a
 * connection that cannot be refreshed is skipped rather than reported.
 */
export function mintAccessToken(credential: OAuthCredential): Promise<AccessToken> {
  const provider = oauthProviderById(credential.provider);
  if (provider === null) {
    throw new Error("No sign-in flow for the stored credential's provider.");
  }
  return refreshAccessToken(provider, credential);
}

/**
 * The `check` and `revoke` halves of `OAuthOperations`.
 *
 * `authorize` is not here: it needs a window to render the consent summary in,
 * so it is assembled in `electron/credential-prompt.ts` where the window is.
 * Splitting them this way keeps the only Electron `BrowserWindow` dependency in
 * the module that already owns one.
 */
export function providerOperations(): Pick<OAuthOperations, "check" | "revoke"> {
  return {
    check: async (credential) => {
      const provider = oauthProviderById(credential.provider);
      if (provider === null) {
        return { ok: false, code: "provider_error" };
      }
      try {
        // A refresh is the whole check. It is the same request delivery makes,
        // so a check that passes is evidence about the thing that will actually
        // happen — and the minted token is dropped here rather than cached,
        // because a token kept from a check is a token alive for an hour with
        // nobody using it.
        await refreshAccessToken(provider, credential);
        return { ok: true };
      } catch (error: unknown) {
        return { ok: false, code: classify(error) };
      }
    },

    revoke: async (credential) => {
      const provider = oauthProviderById(credential.provider);
      if (provider === null) {
        return false;
      }
      return revokeCredential(provider, credential);
    },
  };
}

export type { CredentialTarget };
