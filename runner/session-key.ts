/**
 * The credential that stops *this* runner, written down by the runner itself
 * (MAR-520).
 *
 * ## The failure this exists for, observed rather than imagined
 *
 * On 2026-08-07 a runner spawned by the attended Google proof was still alive
 * hours after the harness exited — `/health` answering, three agents
 * supervised, `runner.json` in `%APPDATA%\orchestratedash` naming its pid and
 * its pipe. `POST /shutdown` with the `runner.key` sitting in that same
 * directory answered **401**, and so did a read-only `GET /agents`. The runner
 * was reachable, healthy, holding the store, and had no route out of the world
 * short of `Stop-Process`, which `AGENTS.md` forbids. An ordinary Windows
 * restart was the only remedy.
 *
 * `runner.json` is deliberately secret-free and stays that way — its own header
 * explains why a file every process on the machine can read is not where a
 * credential goes. The consequence nobody had drawn is that **nothing anywhere
 * recorded which secret a running runner had actually resolved.** DASH's own
 * spawn path re-derives it from `ensureChannelSecret(dataDir)` and is right
 * every time, right up until it is not: a runner started against a different
 * data directory, or from a harness that supplied its own value, or from a
 * `runner.key` that was replaced afterwards, becomes permanently unauthenticable
 * and there is no evidence on disk saying so.
 *
 * ## What is written, and why it is not just a second `runner.key`
 *
 * The runner writes the secret **it actually resolved**, at the moment it
 * resolved it, under `hardenOwnerOnly` — the same function, the same proven
 * ACL, the same refusal to continue when the ACL cannot be verified. That is
 * the whole difference and it is the load-bearing one: `runner.key` is what the
 * *spawner* believes, and this is what the *runner* is using. In the ordinary
 * case the two hold the same bytes and this file is redundant. In every case
 * where they diverge, this file is the only thing that can retire the process.
 *
 * It is removed on graceful shutdown, so a session key on disk means "a runner
 * was alive with this credential" rather than "a runner once was". A crash
 * leaves it, exactly as a crash leaves `runner.json`, and the pid recorded
 * beside it is what a caller checks.
 *
 * ## The fingerprint, which is not a secret
 *
 * `runner.json` gains `channel_secret_fingerprint`: SHA-256 over the secret,
 * truncated. A caller that holds a candidate key can tell **before it connects**
 * whether that key is the one this runner is using, which turns a bare 401 —
 * indistinguishable from a wedged runner, a foreign process on the pipe, or a
 * bug in the caller — into a named answer. Publishing a SHA-256 of 32 bytes of
 * CSPRNG output discloses nothing: there is no dictionary to run it against, and
 * the preimage is exactly the value the fingerprint exists to say you do not
 * have.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ChannelSecretError, hardenOwnerOnly } from "./channel-secret";

/** `{dataDir}/runner.session.key`. Sibling of `runner.key`, same protection. */
export function sessionKeyPath(dataDir: string): string {
  return path.join(dataDir, "runner.session.key");
}

/**
 * SHA-256 over the channel secret, first 16 hex characters.
 *
 * Truncated because the whole digest invites being mistaken for a credential by
 * a future reader, and 64 bits is far beyond what distinguishing two random
 * 32-byte values needs. It is an identity check, not a MAC.
 */
export function channelSecretFingerprint(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

/**
 * Record the secret this runner is using, owner-only and proven.
 *
 * Written before the endpoint file, so the ordering on disk is the ordering a
 * reader needs: by the time anything can find out *where* this runner listens,
 * the credential for talking to it is already recorded. The reverse order would
 * leave a window in which a runner is reachable and unretirable, which is the
 * exact state this module exists to abolish.
 *
 * @throws ChannelSecretError when the ACL cannot be applied or proven.
 */
export function writeSessionKey(dataDir: string, secret: string): void {
  const file = sessionKeyPath(dataDir);
  writeFileSync(file, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  hardenOwnerOnly(file);
}

/**
 * The recorded secret, or null when there is none.
 *
 * Never throws on a malformed or unreadable file: a caller asking this question
 * is trying to retire something politely, and the honest answer to "can I" is
 * no rather than an exception that stops the caller doing the next thing it
 * would have done anyway.
 */
export function readSessionKey(dataDir: string): string | null {
  const file = sessionKeyPath(dataDir);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const secret = readFileSync(file, "utf8").trim();
    // The same shape check `ensureChannelSecret` applies, and for the same
    // reason: a value that is not one of ours must not be presented as a bearer
    // token to anything. The value is never quoted into a log or an error.
    return /^[A-Za-z0-9_-]{40,}$/.test(secret) ? secret : null;
  } catch {
    return null;
  }
}

/**
 * Forget the recorded secret.
 *
 * Best-effort by construction. This runs on the shutdown path, where the thing
 * that matters is that the process exits; a session key that outlives its runner
 * is untidy, and a shutdown that hung trying to delete it would be a fault.
 */
export function clearSessionKey(dataDir: string): void {
  try {
    rmSync(sessionKeyPath(dataDir), { force: true });
  } catch {
    // Deliberately silent — see above.
  }
}

/** Re-exported so callers name one import for the whole credential story. */
export { ChannelSecretError };
