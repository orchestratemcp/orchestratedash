/**
 * The OAuth primitives: PKCE, the authorization URL, the token exchange, and
 * what DASH keeps afterwards (MAR-446, DASH-29).
 *
 * Two things here are worth more than the rest.
 *
 * The PKCE challenge is checked against **RFC 7636's own appendix B vector**
 * rather than against DASH's own output. A generator tested only against itself
 * passes for an implementation that hashes nothing, and the failure would be
 * invisible until Google rejected an exchange with a message about the code.
 *
 * The `invalid_grant` classification is checked because MAR-446 requires it in
 * as many words: *"Revocation at Google's end surfaces as `revoked` with
 * recovery copy, not as a generic failure."* That is a property of how a `400`
 * body is read, and the only way to pin it is a fetch that returns exactly that
 * body.
 */

import { describe, expect, it } from "vitest";

import { describeAuthorizationFailure } from "../lib/copy/recovery";
import {
  missingScopes,
  parseOAuthCredential,
  serializeOAuthCredential,
  type OAuthCredential,
} from "../lib/oauth/credential";
import {
  accountFromIdToken,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  isOAuthError,
  refreshAccessToken,
  revokeCredential,
} from "../lib/oauth/flow";
import { base64Url, challengeFor, createPkcePair, createState, statesMatch } from "../lib/oauth/pkce";
import {
  authorizationScopes,
  checkRequestedScopes,
  describePermissions,
  oauthProviderById,
  oauthProviderFor,
} from "../lib/oauth/providers";
import { isMaskedAccountHint, maskAccount } from "../lib/secret-refs";
import { expectPlainLanguage } from "./helpers/plain-language";

const google = oauthProviderById("google");
if (google === null) {
  throw new Error("The Google provider must exist for these tests.");
}

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

/** A fetch that answers once with a given status and body. */
function respondingWith(status: number, body: unknown): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    )) as unknown as typeof fetch;
}

describe("PKCE", () => {
  /**
   * RFC 7636 appendix B. The verifier and its expected challenge are the
   * document's, not ours.
   */
  it("derives the challenge in the RFC's own worked example", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(challengeFor(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("encodes base64url with no padding and no unsafe characters", () => {
    // 0xFB 0xFF 0xFE would be "+//+" in standard base64 — every character this
    // has to substitute, in one input.
    const encoded = base64Url(Buffer.from([0xfb, 0xff, 0xbe]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("produces a 43-character verifier and never reuses one", () => {
    const first = createPkcePair();
    const second = createPkcePair();

    expect(first.verifier).toHaveLength(43);
    expect(first.method).toBe("S256");
    expect(first.verifier).not.toBe(second.verifier);
    expect(first.challenge).toBe(challengeFor(first.verifier));
  });

  it("matches states only when they are equal", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    // Length differences must not throw or match on a prefix.
    expect(statesMatch("abc", "ab")).toBe(false);
    expect(statesMatch(createState(), createState())).toBe(false);
  });
});

describe("the provider registry", () => {
  it("maps the Gmail example's providers onto one Google flow", () => {
    expect(oauthProviderFor("google-gmail")?.id).toBe("google");
    expect(oauthProviderFor("google-calendar")?.id).toBe("google");
  });

  /**
   * The refusal MAR-383 had for every OAuth field, kept for the providers it is
   * still true of. A registry that answered for anything would turn "DASH signs
   * in to Google" into "DASH will try to sign in to whatever a manifest names".
   */
  it("has no flow for a provider nobody wrote one for", () => {
    expect(oauthProviderFor("synthetic-project-service")).toBeNull();
    expect(oauthProviderFor("google-drive")).toBeNull();
  });

  it("refuses a scope it has no plain-language sentence for", () => {
    expect(checkRequestedScopes(google, GMAIL_SCOPES)).toEqual([]);
    expect(checkRequestedScopes(google, ["https://mail.google.com/"])).toEqual([
      "https://mail.google.com/",
    ]);
  });

  /**
   * MAR-423's rule applied to the one screen that exists to be read before a
   * decision. A consent summary listing `gmail.compose` would be the exact
   * failure `lib/copy/identifiers.ts` was written to catch.
   */
  it("describes permissions in plain language, write access first", () => {
    const described = describePermissions(google, GMAIL_SCOPES);

    expect(described[0]).toBe("Write and save Gmail drafts, and send them");
    expectPlainLanguage(described);
  });

  it("always adds identity scopes, and never duplicates one", () => {
    const scopes = authorizationScopes(google, [...GMAIL_SCOPES, "openid"]);

    expect(scopes).toContain("openid");
    expect(scopes).toContain("email");
    expect(new Set(scopes).size).toBe(scopes.length);
  });
});

describe("the authorization URL", () => {
  const url = new URL(
    buildAuthorizationUrl(google, {
      redirect_uri: "http://127.0.0.1:51234/callback",
      scopes: GMAIL_SCOPES,
      challenge: "test-challenge",
      state: "test-state",
      login_hint: "henrik@example.com",
    }),
  );

  it("asks for a code with S256 and offline access", () => {
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("test-challenge");
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  /**
   * The verifier is what makes a public client safe. If it ever reached the
   * URL, the URL — which goes to a browser, into history, and through whatever
   * the OS logs about opened links — would carry the secret that binds the code.
   */
  it("never carries the verifier", () => {
    const pair = createPkcePair();
    const built = buildAuthorizationUrl(google, {
      redirect_uri: "http://127.0.0.1:51234/callback",
      scopes: GMAIL_SCOPES,
      challenge: pair.challenge,
      state: "s",
    });

    expect(built).not.toContain(pair.verifier);
    expect(built).toContain(pair.challenge);
  });

  it("requests exactly the declared scopes plus identity", () => {
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(
      ["email", "openid", ...GMAIL_SCOPES].sort(),
    );
  });
});

describe("exchanging and refreshing", () => {
  const idToken = `header.${Buffer.from(JSON.stringify({ email: "henrik@example.com" })).toString(
    "base64url",
  )}.signature`;

  it("turns a token response into a storable credential", async () => {
    const exchanged = await exchangeAuthorizationCode(
      google,
      {
        code: "auth-code",
        verifier: "verifier",
        redirect_uri: "http://127.0.0.1:1/callback",
        scopes: GMAIL_SCOPES,
      },
      respondingWith(200, {
        access_token: "access-value",
        refresh_token: "refresh-value",
        expires_in: 3599,
        scope: GMAIL_SCOPES.join(" "),
        id_token: idToken,
      }),
      new Date("2026-07-30T10:00:00.000Z"),
    );

    expect(exchanged.credential.refresh_token).toBe("refresh-value");
    expect(exchanged.credential.account).toBe("henrik@example.com");
    expect(exchanged.credential.provider).toBe("google");
    expect(exchanged.access.access_token).toBe("access-value");
    expect(exchanged.access.expires_at).toBe("2026-07-30T10:59:59.000Z");
  });

  /**
   * A grant with no refresh token works for an hour and then cannot be renewed —
   * a connection that would pass every check on the day it was made and fail
   * silently afterwards. Better to refuse it while the user is still watching.
   */
  it("refuses a response with no refresh token", async () => {
    await expect(
      exchangeAuthorizationCode(
        google,
        { code: "c", verifier: "v", redirect_uri: "r", scopes: GMAIL_SCOPES },
        respondingWith(200, { access_token: "only-access", expires_in: 3599 }),
      ),
    ).rejects.toMatchObject({ code: "malformed_response" });
  });

  /**
   * The MAR-446 acceptance criterion, at the layer that decides it.
   */
  it("classifies invalid_grant as revoked rather than a generic failure", async () => {
    const credential = storedCredential();

    await expect(
      refreshAccessToken(google, credential, respondingWith(400, { error: "invalid_grant" })),
    ).rejects.toMatchObject({ code: "revoked" });

    // And the code has to reach words that say somebody took the access away,
    // not words that say something went wrong.
    const recovery = describeAuthorizationFailure("revoked", { service: "Gmail" });
    expect(recovery.headline).toBe("Access to Gmail was withdrawn.");
    expectPlainLanguage([recovery.headline, recovery.meaning, recovery.next_action]);
  });

  it("keeps other provider refusals distinct from revocation", async () => {
    await expect(
      refreshAccessToken(google, storedCredential(), respondingWith(403, { error: "forbidden" })),
    ).rejects.toMatchObject({ code: "provider_refused" });
  });

  it("reports an unreachable provider as a network failure, not a revocation", async () => {
    const failing = (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as unknown as typeof fetch;

    await expect(refreshAccessToken(google, storedCredential(), failing)).rejects.toMatchObject({
      code: "network",
    });
  });

  /**
   * A rejected fetch can carry the request it failed on, and that request's body
   * has the refresh token in it. The wrapper must not keep the original.
   */
  it("does not carry the refresh token into the error it throws", async () => {
    const credential = storedCredential();
    const failing = (() =>
      Promise.reject(new Error(`failed to POST body=${credential.refresh_token}`))) as unknown as typeof fetch;

    try {
      await refreshAccessToken(google, credential, failing);
      expect.unreachable("the refresh should have failed");
    } catch (error: unknown) {
      expect(isOAuthError(error)).toBe(true);
      expect(JSON.stringify(error instanceof Error ? error.stack : error)).not.toContain(
        credential.refresh_token,
      );
    }
  });

  it("treats an unreachable revocation as not done rather than as a failure", async () => {
    const failing = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    expect(await revokeCredential(google, storedCredential(), failing)).toBe(false);
    expect(await revokeCredential(google, storedCredential(), respondingWith(200, {}))).toBe(true);
  });

  it("reads an account from an id token and shrugs at anything else", () => {
    expect(accountFromIdToken(idToken)).toBe("henrik@example.com");
    expect(accountFromIdToken("not-a-jwt")).toBeNull();
    expect(accountFromIdToken(undefined)).toBeNull();
    expect(accountFromIdToken("a.!!!not-base64!!!.c")).toBeNull();
  });
});

describe("the stored envelope", () => {
  it("survives a round trip", () => {
    const credential = storedCredential();
    expect(parseOAuthCredential(serializeOAuthCredential(credential))).toEqual(credential);
  });

  /**
   * The realistic causes are ordinary: a manifest whose field changed from a
   * typed secret to a sign-in leaves an API key under the name this parses.
   * "DASH cannot use what is here" must be a state, not a crash.
   */
  it("returns null for anything that is not one of ours", () => {
    expect(parseOAuthCredential("sk-live-an-api-key-left-behind")).toBeNull();
    expect(parseOAuthCredential("{}")).toBeNull();
    expect(parseOAuthCredential(JSON.stringify({ ...storedCredential(), version: 99 }))).toBeNull();
    expect(
      parseOAuthCredential(JSON.stringify({ ...storedCredential(), refresh_token: "" })),
    ).toBeNull();
  });

  /**
   * Consent screens have checkboxes. A user can grant read and decline write,
   * and a sign-in that "worked" is not the same as an agent that can do its job.
   */
  it("notices a partial grant", () => {
    const partial = storedCredential({
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });

    expect(missingScopes(partial, GMAIL_SCOPES)).toEqual([
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
    expect(describePermissions(google, missingScopes(partial, GMAIL_SCOPES))).toEqual([
      "Write and save Gmail drafts, and send them",
    ]);
  });
});

describe("the account hint", () => {
  it("shows enough to recognise an account and not enough to use one", () => {
    const masked = maskAccount("henrik@example.com");

    expect(masked).toBe("he••••@example.com");
    expect(masked).not.toContain("nrik");
    expect(isMaskedAccountHint(masked)).toBe(true);
  });

  /**
   * The structural guarantee `lib/secret-refs.ts` relies on: both accepted hint
   * shapes require the literal four-bullet run, and no credential contains one.
   */
  it("cannot be satisfied by a raw credential", () => {
    expect(isMaskedAccountHint("1//0gLrefreshtokenvalue")).toBe(false);
    expect(isMaskedAccountHint("henrik@example.com")).toBe(false);
    expect(isMaskedAccountHint("sk-live-0123456789")).toBe(false);
  });

  it("falls back to the value mask for something that is not an address", () => {
    expect(maskAccount("no-at-sign-here")).toBe("••••here");
  });
});

function storedCredential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    version: 1,
    provider: "google",
    refresh_token: "1//0gLrefreshtokenvalue",
    scopes: ["openid", "email", ...GMAIL_SCOPES],
    account: "henrik@example.com",
    obtained_at: "2026-07-30T09:00:00.000Z",
    ...overrides,
  };
}
