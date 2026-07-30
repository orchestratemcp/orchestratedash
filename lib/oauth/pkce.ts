/**
 * PKCE, and the two other random values the loopback flow depends on
 * (MAR-446, DASH-29).
 *
 * A desktop OAuth client is public: its id ships inside the app and it has no
 * secret. What stops another program on this machine from redeeming DASH's
 * authorization code is not confidentiality of the client id — it is that the
 * code is bound to a verifier only the process that started the flow ever held.
 * That is PKCE (RFC 7636), and for an installed app RFC 8252 §8.1 makes it
 * mandatory rather than advisable.
 *
 * ## Why this is a module and not four lines in the flow
 *
 * Because the failure mode is silent. A challenge derived with the wrong hash, a
 * verifier one character short of the minimum, base64 that was not made
 * URL-safe: every one of those still produces a string, still builds a URL, and
 * still fails at the token endpoint with a message about the *code* rather than
 * the verifier. Separating them makes each one a thing a test can pin, against
 * the vectors in the RFC itself.
 *
 * ## Randomness is injected
 *
 * Every function takes its bytes rather than reaching for `node:crypto`. That is
 * not testability for its own sake: it is what lets a test assert the *exact*
 * challenge for a known verifier — the RFC's own appendix B vector — instead of
 * asserting that two random strings differ, which would pass for an
 * implementation that hashed nothing at all.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Base64 with the three substitutions RFC 7636 §A requires.
 *
 * Padding is stripped rather than escaped. A `=` in a query parameter survives
 * one round trip and not always two, and the RFC specifies unpadded — an
 * implementation that leaves it on works against some authorization servers and
 * not others, which is the worst kind of working.
 */
export function base64Url(bytes: Buffer): string {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * 32 bytes, which base64url-encodes to 43 characters.
 *
 * The RFC allows 43–128 and recommends 32 bytes of entropy. Taking the minimum
 * length from the maximum practical entropy is the intended reading: length
 * beyond this adds encoding, not unpredictability.
 */
const VERIFIER_BYTES = 32;

/** The `state` parameter, and the loopback's own guard. 16 bytes is ample. */
const STATE_BYTES = 16;

export interface PkcePair {
  /** Kept in memory by the flow and sent only to the token endpoint. */
  verifier: string;
  /** Sent to the authorization endpoint, which is to say, put in a URL. */
  challenge: string;
  /**
   * Always `S256`. `plain` is in the RFC for clients that cannot hash, which
   * describes nothing that runs on Node, and offering it as an option would
   * make "which method did we use" a question rather than an invariant.
   */
  method: "S256";
}

/**
 * Derive the challenge for a verifier.
 *
 * Exported separately from `createPkcePair` so a test can drive it with the
 * RFC's published verifier and compare against the RFC's published challenge.
 * A generator that only ever produces its own inputs cannot be checked against
 * anything outside itself.
 */
export function challengeFor(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier, "ascii").digest());
}

export function createPkcePair(random: (size: number) => Buffer = randomBytes): PkcePair {
  const verifier = base64Url(random(VERIFIER_BYTES));
  return { verifier, challenge: challengeFor(verifier), method: "S256" };
}

/**
 * A fresh `state` value.
 *
 * Two jobs, and it is worth being clear that they are two. As an OAuth
 * parameter it ties the redirect back to the request that caused it. As the
 * loopback listener's guard it is the thing that makes a request arriving on
 * DASH's temporary port recognisably the browser DASH sent, rather than any
 * other local process that guessed the port — see `electron/oauth-loopback.ts`,
 * which refuses a callback whose state does not match.
 */
export function createState(random: (size: number) => Buffer = randomBytes): string {
  return base64Url(random(STATE_BYTES));
}

/**
 * Constant-time-ish comparison for the state check.
 *
 * The window is small and the value is single-use, so a timing attack here is
 * close to theoretical. It is written this way anyway because the alternative is
 * an `===` that a reader has to stop and think about, and "we thought about it
 * and it was fine" does not survive the next person editing the file.
 */
export function statesMatch(expected: string, received: string): boolean {
  if (expected.length !== received.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  }
  return difference === 0;
}
