/**
 * The runner's endpoint: a socket or a pipe, never a port (MAR-430).
 *
 * The headline assertion is the dullest one in the file — that `address()`
 * returns a path rather than an object with a port on it. Everything else in
 * this suite is about the two things a real deployment gets wrong: two runners
 * racing for one endpoint, and a crash leaving something behind that the next
 * launch has to reason about safely.
 *
 * Platform coverage is asymmetric on purpose. The Windows branch is a named
 * pipe, which is a kernel object that cannot go stale, so it has nothing to
 * recover and one extra guarantee (`FILE_FLAG_FIRST_PIPE_INSTANCE`) to prove.
 * The POSIX branch is a file, so it can be orphaned, and that is where the
 * reclamation tests live. CI runs Linux; this developer machine runs Windows;
 * between them both branches are exercised.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import http, { type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import {
  EndpointError,
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
  type RunnerEndpoint,
} from "../runner/endpoint";

const workDir = mkdtempSync(path.join(tmpdir(), "dash-endpoint-"));
const onWindows = process.platform === "win32";

const open: { server: Server; endpoint: RunnerEndpoint }[] = [];

afterAll(async () => {
  for (const { server, endpoint } of open) {
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    releaseEndpoint(endpoint);
  }
  rmSync(workDir, { recursive: true, force: true });
});

function freshDir(): string {
  return mkdtempSync(path.join(workDir, "data-"));
}

function freshId(): string {
  return randomBytes(8).toString("hex");
}

/** A trivial server on a real endpoint, torn down in `afterAll`. */
async function serve(endpoint: RunnerEndpoint): Promise<Server> {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await prepareEndpoint(endpoint);
  await listenOnEndpoint(server, endpoint);
  open.push({ server, endpoint });
  return server;
}

/* ---------------------------------------------------------------------- *
 * Shape
 * ---------------------------------------------------------------------- */

describe("runnerEndpoint", () => {
  it("names a platform-appropriate endpoint", () => {
    const endpoint = runnerEndpoint(freshDir(), "abc123");
    if (onWindows) {
      expect(endpoint.transport).toBe("pipe");
      expect(endpoint.path).toBe(String.raw`\\.\pipe\orchestratedash-runner-abc123`);
    } else {
      expect(endpoint.transport).toBe("unix");
      expect(endpoint.path).toMatch(/runner-abc123\.sock$/);
    }
  });

  it("gives two installs different endpoints", () => {
    // The anti-squatting property. A name a local process can guess in advance
    // is a name it can create first.
    const dataDir = freshDir();
    expect(runnerEndpoint(dataDir, freshId()).path).not.toBe(
      runnerEndpoint(dataDir, freshId()).path,
    );
  });

  it.skipIf(onWindows)("refuses a socket path longer than sockaddr_un can carry", async () => {
    // Fails at `bind` with a message that reads like a permissions problem, so
    // it is caught here where the cause can be named.
    const deep = path.join(freshDir(), "d".repeat(120));
    await expect(prepareEndpoint({ path: deep, transport: "unix" })).rejects.toThrow(
      /platform limit/,
    );
  });
});

/* ---------------------------------------------------------------------- *
 * No port
 * ---------------------------------------------------------------------- */

describe("the endpoint is not a port", () => {
  it("binds to a path and reports one", async () => {
    // MAR-430's acceptance criterion in one assertion: `address()` on a TCP
    // listener is `{ address, family, port }`. On a socket or a pipe it is the
    // path. A runner that regressed to a port would fail here and nowhere else.
    const endpoint = runnerEndpoint(freshDir(), freshId());
    const server = await serve(endpoint);
    expect(typeof server.address()).toBe("string");
    expect(server.address()).toBe(endpoint.path);
  });

  it("serves HTTP over it", async () => {
    const endpoint = runnerEndpoint(freshDir(), freshId());
    await serve(endpoint);
    const response = await ipcFetch(endpoint.path)(`${IPC_ORIGIN}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

/* ---------------------------------------------------------------------- *
 * Exactly one runner
 * ---------------------------------------------------------------------- */

describe("two runners, one endpoint", () => {
  it("refuses the second rather than letting it join", async () => {
    // On Windows this is the OS: libuv passes FILE_FLAG_FIRST_PIPE_INSTANCE, so
    // the second bind is EADDRINUSE. On POSIX it is `prepareEndpoint`'s live
    // probe. Either way the answer is a refusal with a reason, not a silent
    // share of the command channel.
    const endpoint = runnerEndpoint(freshDir(), freshId());
    await serve(endpoint);

    const second = http.createServer(() => {});
    try {
      await expect(
        prepareEndpoint(endpoint).then(() => listenOnEndpoint(second, endpoint)),
      ).rejects.toBeInstanceOf(EndpointError);
    } finally {
      second.close();
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Crash recovery
 * ---------------------------------------------------------------------- */

describe.skipIf(onWindows)("a socket left behind by a crash", () => {
  it("is reclaimed when nothing is listening on it", async () => {
    // A runner that died without unlinking. Nothing answers, so the file is
    // litter and taking the name back is safe.
    const dataDir = freshDir();
    const endpoint = runnerEndpoint(dataDir, freshId());
    await prepareEndpoint(endpoint);
    writeFileSync(endpoint.path, "", "utf8");

    await expect(prepareEndpoint(endpoint)).resolves.toBeUndefined();
    expect(existsSync(endpoint.path)).toBe(false);
  });

  it("is left alone when a runner is still answering on it", async () => {
    // The other half of the same rule. "Delete it if it exists" would be a race
    // with a runner that is merely busy, and losing that race means displacing
    // a process that is holding somebody's agents.
    const endpoint = runnerEndpoint(freshDir(), freshId());
    await serve(endpoint);

    await expect(prepareEndpoint(endpoint)).rejects.toThrow(/already listening/);
    expect(existsSync(endpoint.path)).toBe(true);
  });

  it("leaves nothing behind after a clean shutdown", async () => {
    const endpoint = runnerEndpoint(freshDir(), freshId());
    const server = http.createServer(() => {});
    await prepareEndpoint(endpoint);
    await listenOnEndpoint(server, endpoint);

    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
    releaseEndpoint(endpoint);
    expect(existsSync(endpoint.path)).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * Owner-only, where the filesystem can say so
 * ---------------------------------------------------------------------- */

describe.skipIf(onWindows)("POSIX permissions", () => {
  it("puts the socket in a 0700 directory", async () => {
    // The belt. A socket nobody can traverse to is not connectable whatever its
    // own mode says, which is what closes the window between `listen` and the
    // `chmod` that cannot happen until the file exists.
    const endpoint = runnerEndpoint(freshDir(), freshId());
    await serve(endpoint);
    expect(statSync(path.dirname(endpoint.path)).mode & 0o777).toBe(0o700);
  });

  it("makes the socket itself 0600", async () => {
    const endpoint = runnerEndpoint(freshDir(), freshId());
    await serve(endpoint);
    expect(statSync(endpoint.path).mode & 0o777).toBe(0o600);
  });
});
