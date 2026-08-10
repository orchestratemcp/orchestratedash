/**
 * Fake provider sign-ins for `performConnectionAction` (MAR-446).
 *
 * `lib/connection-actions.ts` takes its OAuth operations as a dependency for the
 * same reason it takes `promptForSecret`: the real ones open a browser, bind a
 * loopback port and talk to Google, and the behaviour worth testing is which
 * sentence each outcome produces.
 *
 * `refusingOAuth` is the more important of the two. Every pre-existing test in
 * `tests/connection-actions.test.ts` drives an API-key manifest, and passing a
 * fake that throws on contact turns "the OAuth path is not involved in the
 * secret path" from something a reader checks by eye into something the suite
 * fails on.
 */

import type { OAuthOperations, AuthorizationOutcome } from "../../lib/connection-actions";
import type { OAuthCredential } from "../../lib/oauth/credential";
import { OAUTH_CREDENTIAL_VERSION } from "../../lib/oauth/credential";
import type { AuthorizationFailureCode } from "../../lib/copy/recovery";
import type { OAuthClientConfiguration } from "../../lib/oauth/providers";

/** Operations that fail the test if anything reaches them. */
export function refusingOAuth(): OAuthOperations {
  const refuse = (name: string) => (): never => {
    throw new Error(`The OAuth ${name} path must not be reached for a typed-secret field.`);
  };
  return {
    authorize: refuse("authorize"),
    check: refuse("check"),
    revoke: refuse("revoke"),
  };
}

export interface OAuthScript {
  /** What a sign-in returns. Defaults to a working Google grant. */
  authorize?: AuthorizationOutcome;
  /** What checking a stored grant returns. Defaults to accepted. */
  check?: { ok: true } | { ok: false; code: AuthorizationFailureCode };
  /** Whether revocation reached the provider. Defaults to true. */
  revoke?: boolean;
}

export interface ScriptedOAuth extends OAuthOperations {
  /** Which operations were called, in order. */
  readonly calls: string[];
  /** The `login_hint` the last `authorize` was given. */
  readonly hints: Array<string | null>;
  /** The stored client the last `authorize` was given. */
  readonly clients: Array<OAuthClientConfiguration | null>;
}

export function oauthCredential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    version: OAUTH_CREDENTIAL_VERSION,
    provider: "google",
    refresh_token: "1//refresh-token-value-that-must-never-be-rendered",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    account: "henrik@example.com",
    obtained_at: "2026-07-30T09:00:00.000Z",
    client: {
      client_id: "desktop-client.apps.googleusercontent.com",
      client_secret: "desktop-client-secret",
    },
    ...overrides,
  };
}

export function scriptedOAuth(script: OAuthScript = {}): ScriptedOAuth {
  const calls: string[] = [];
  const hints: Array<string | null> = [];
  const clients: Array<OAuthClientConfiguration | null> = [];
  return {
    calls,
    hints,
    clients,
    authorize: (_target, options) => {
      calls.push("authorize");
      hints.push(options.login_hint);
      clients.push(options.client);
      return Promise.resolve(script.authorize ?? { ok: true, credential: oauthCredential() });
    },
    check: () => {
      calls.push("check");
      return Promise.resolve(script.check ?? { ok: true });
    },
    revoke: () => {
      calls.push("revoke");
      return Promise.resolve(script.revoke ?? true);
    },
  };
}
