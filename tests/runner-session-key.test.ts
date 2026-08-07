/**
 * A runner nobody can retire, and the record that fixes it (MAR-520).
 *
 * ## The fault this is written against, observed rather than imagined
 *
 * On 2026-08-07 a runner spawned by the attended Google proof was still alive
 * hours after its harness exited: `/health` answering `200`, three agents
 * supervised, `runner.json` in the installed data directory naming its pid and
 * its pipe — and `401` to the `runner.key` sitting in that same directory, on
 * `POST /shutdown` and on a read-only `GET /agents` alike. Two different key
 * files on the machine were tried and both were refused.
 *
 * The consequence is the part worth testing. `adopt` collapsed "nothing is
 * listening" and "a live runner is listening that we cannot authenticate to"
 * into one `null`, and `ensureRunner` reads `null` as permission to spawn. So
 * the next start would have put a **second runner** on the same `runner.sqlite`
 * — the two-writers-one-store pattern MAR-506's corruption is suspected to have
 * come from — and nothing would have looked wrong until the store did.
 *
 * These cases drive real files, a real endpoint and a real server. Nothing here
 * asserts against a hand-written string where a filesystem or a socket would do.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
  type RunnerEndpoint,
} from "../runner/endpoint";
import { DASH_LOCAL_PRINCIPAL } from "../runner/execute";
import { createRunnerServer } from "../runner/server";
import {
  channelSecretFingerprint,
  clearSessionKey,
  readSessionKey,
  sessionKeyPath,
  writeSessionKey,
} from "../runner/session-key";
import { Supervisor } from "../runner/supervisor";

const SECRET = randomBytes(32).toString("base64url");
const directories: string[] = [];
const servers: Array<{ server: Server; endpoint: RunnerEndpoint }> = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dash-session-key-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  for (const { server, endpoint } of servers.splice(0)) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    releaseEndpoint(endpoint);
  }
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------------- *
 * The record itself
 * ---------------------------------------------------------------------- */

describe("the credential a runner records for itself", () => {
  it("round-trips the secret the runner actually resolved", () => {
    const dir = freshDir();
    expect(readSessionKey(dir)).toBeNull();

    writeSessionKey(dir, SECRET);
    expect(readSessionKey(dir)).toBe(SECRET);
  });

  it("is a different file from runner.key, which is the entire point", () => {
    // `runner.key` is what the *spawner* believes. This is what the *runner* is
    // using. In the ordinary case they hold the same bytes and this file is
    // redundant; in every case where they diverge — a harness that supplied its
    // own value, a different data directory, a key replaced afterwards — this
    // is the only thing that can retire the process.
    const dir = freshDir();
    writeFileSync(path.join(dir, "runner.key"), `${randomBytes(32).toString("base64url")}\n`, "utf8");
    writeSessionKey(dir, SECRET);

    expect(sessionKeyPath(dir)).not.toBe(path.join(dir, "runner.key"));
    expect(readSessionKey(dir)).toBe(SECRET);
    expect(readFileSync(path.join(dir, "runner.key"), "utf8").trim()).not.toBe(SECRET);
  });

  it("refuses to hand back a value that is not one of ours", () => {
    // A caller is about to present this as a bearer token. Whatever a stray file
    // holds, it is not a credential this project minted, and offering it would
    // be sending an arbitrary string from disk to a process over a socket.
    const dir = freshDir();
    writeFileSync(sessionKeyPath(dir), "not-a-channel-secret\n", "utf8");
    expect(readSessionKey(dir)).toBeNull();
  });

  it("stops claiming a runner is alive once it is cleared", () => {
    const dir = freshDir();
    writeSessionKey(dir, SECRET);
    expect(existsSync(sessionKeyPath(dir))).toBe(true);

    clearSessionKey(dir);
    expect(readSessionKey(dir)).toBeNull();
    // Clearing what is already gone is the shutdown path running twice, which
    // must not be a failure.
    expect(() => {
      clearSessionKey(dir);
    }).not.toThrow();
  });
});

describe("the fingerprint runner.json publishes", () => {
  it("identifies a key without being one", () => {
    const other = randomBytes(32).toString("base64url");
    expect(channelSecretFingerprint(SECRET)).toBe(channelSecretFingerprint(SECRET));
    expect(channelSecretFingerprint(SECRET)).not.toBe(channelSecretFingerprint(other));
  });

  it("never contains the secret it describes", () => {
    // `runner.json` is readable by every process on the machine — its own header
    // says so and says why nothing secret goes in it. A fingerprint that leaked
    // any part of the preimage would quietly make that header false.
    const fingerprint = channelSecretFingerprint(SECRET);
    expect(SECRET).not.toContain(fingerprint);
    expect(fingerprint).not.toContain(SECRET);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

/* ---------------------------------------------------------------------- *
 * The runner it is supposed to be able to retire
 * ---------------------------------------------------------------------- */

/**
 * A real runner server on a real endpoint, holding a secret the caller does not
 * have — which is the 2026-08-07 machine, reproduced.
 */
async function serveWithSecret(
  dir: string,
  secret: string,
  onShutdown: () => void,
): Promise<{ call: typeof fetch; endpoint: RunnerEndpoint }> {
  const endpoint = runnerEndpoint(dir, randomBytes(6).toString("hex"));
  await prepareEndpoint(endpoint);
  const server = createRunnerServer({
    supervisor: new Supervisor([]),
    token: secret,
    principal: DASH_LOCAL_PRINCIPAL,
    shutdown: onShutdown,
    log: () => {
      /* quiet */
    },
  });
  await listenOnEndpoint(server, endpoint);
  servers.push({ server, endpoint });
  return { call: ipcFetch(endpoint.path), endpoint };
}

describe("retiring a runner whose secret is not the one on disk", () => {
  it("is refused with the wrong key and accepted with the recorded one", async () => {
    const dir = freshDir();
    const runnersSecret = randomBytes(32).toString("base64url");
    const keyOnDisk = randomBytes(32).toString("base64url");
    let stopped = false;
    const { call } = await serveWithSecret(dir, runnersSecret, () => {
      stopped = true;
    });

    // The observed failure: the only credential the product persisted is not
    // the one this runner is using, and every authenticated route says 401.
    const refused = await call(`${IPC_ORIGIN}/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${keyOnDisk}` },
    });
    expect(refused.status).toBe(401);
    expect(stopped).toBe(false);

    // The fix: the runner recorded what it was actually using, so a later
    // process can ask it to stop through the same authenticated route.
    writeSessionKey(dir, runnersSecret);
    const recorded = readSessionKey(dir);
    expect(recorded).toBe(runnersSecret);

    const accepted = await call(`${IPC_ORIGIN}/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${String(recorded)}` },
    });
    expect(accepted.status).toBe(202);
    expect(stopped).toBe(true);
  });

  it("tells a stale record from the live one before presenting it", async () => {
    // A session key left by a runner that crashed, beside a runner that is
    // running. Presenting it would spend a failed authentication against a
    // process this DASH may not own; the published fingerprint answers the
    // question without connecting at all.
    const dir = freshDir();
    const runnersSecret = randomBytes(32).toString("base64url");
    const crashedRunnersSecret = randomBytes(32).toString("base64url");
    writeSessionKey(dir, crashedRunnersSecret);

    const published = channelSecretFingerprint(runnersSecret);
    expect(channelSecretFingerprint(String(readSessionKey(dir)))).not.toBe(published);
  });
});
