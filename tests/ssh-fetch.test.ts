/**
 * HTTP over a child process's stdio (MAR-484, ADR 0007).
 *
 * ADR 0007 claims this transport is provable in CI and says exactly how far
 * that claim reaches:
 *
 * > The stdio dialer is a `fetch` over a child process's pipes. A test can spawn
 * > a local child that speaks HTTP over its own stdio and exercise every
 * > property `ipcFetch` is tested for — the byte ceiling, the abort path, the
 * > `unavailable`/`failed` split — with no SSH, no host and no network. What
 * > stays unproven by that is `ssh` itself: authentication, the far-side helper,
 * > and the host's socket.
 *
 * This file is the first half, and the second half is deliberately absent
 * rather than simulated. Nothing here starts `ssh`, and no assertion below
 * should ever be read as evidence about a host.
 *
 * The tests run the real `httpAdapter` and `fetchAgentDomState` over the dialer
 * wherever they can, rather than only calling `stdioFetch` directly. The point
 * of a third dialer is that **nothing above it changes**, and a test that only
 * exercised the dialer would be a test of the one part that is new.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { IPC_ORIGIN } from "../lib/agent-dom/ipc-fetch";
import { remoteRunnerChannel } from "../lib/agent-dom/runner-channel";
import { stdioFetch, type StdioChannel } from "../lib/agent-dom/ssh-fetch";
import { fetchAgentDomState, MAX_RESPONSE_BYTES } from "../lib/agent-dom/transport";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(repoRoot, "tests", "fixtures", "stdio-http-runner.mjs");

/**
 * One child per request, which is what the real transport does.
 *
 * `ssh` is spawned per request rather than pooled — see `ssh-fetch.ts` for why
 * — so the fixture is opened the same way. A test that reused one child would
 * be testing a transport DASH does not have.
 */
function openFixture(): StdioChannel {
  const child = spawn(process.execPath, [FIXTURE], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}

const dial = stdioFetch(openFixture);

describe("the stdio dialer", () => {
  it("carries a request and brings back a parsed answer", async () => {
    const response = await dial(`${IPC_ORIGIN}/agents`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; path: string; method: string };
    expect(body).toMatchObject({ ok: true, path: "/agents", method: "GET" });
  });

  it("carries a method, a body and headers the caller set", async () => {
    const response = await dial(`${IPC_ORIGIN}/telemetry/drain`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer host-channel-secret" },
      body: JSON.stringify({ hello: "host" }),
    });
    const body = (await response.json()) as { method: string; body: string; authorization: string };
    expect(body.method).toBe("POST");
    expect(JSON.parse(body.body) as unknown).toEqual({ hello: "host" });
    expect(body.authorization).toBe("Bearer host-channel-secret");
  });

  /**
   * The taxonomy `transport.ts` keeps, over a pipe rather than a socket. A user
   * whose host is unreachable needs to check the host; a user whose runner
   * answered 401 needs to reconnect it. Collapsing the two would lose that, and
   * it would be easy to lose here because both arrive as a dead child.
   */
  it("reports a status the far end chose rather than treating it as unreachable", async () => {
    const response = await dial(`${IPC_ORIGIN}/unauthorized`);
    expect(response.status).toBe(401);
  });

  it("fails as a transport error when the child cannot be started at all", async () => {
    const broken = stdioFetch(() => {
      throw new Error("ssh is not on this machine");
    });
    await expect(broken(`${IPC_ORIGIN}/agents`)).rejects.toThrow(TypeError);
  });

  it("aborts with an AbortError, which is what distinguishes a timeout downstream", async () => {
    const controller = new AbortController();
    const pending = dial(`${IPC_ORIGIN}/slow`, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses a body that is not a string, rather than sending an empty one", async () => {
    await expect(
      dial(`${IPC_ORIGIN}/agents`, { method: "POST", body: new Uint8Array([1, 2, 3]) }),
    ).rejects.toThrow(TypeError);
  });
});

describe("what the layers above it do, unchanged", () => {
  /**
   * The whole argument for a third dialer: `transport.ts`'s properties hang off
   * an injectable `fetch`, so moving the bytes changes none of them. If this
   * test needed anything the local one does not, the seam would be in the wrong
   * place.
   */
  it("hands `fetchAgentDomState` a state document over the pipe", async () => {
    const result = await fetchAgentDomState(
      { uri: `${IPC_ORIGIN}/agents/host-agent`, token: "host-channel-secret" },
      { fetch: dial },
    );
    expect(result.ok).toBe(true);
  });

  it("still refuses a body past the ceiling, on this transport too", async () => {
    const result = await fetchAgentDomState(
      { uri: `${IPC_ORIGIN}/huge`, token: "host-channel-secret" },
      { fetch: dial },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("failed");
      expect(result.detail).toContain(String(MAX_RESPONSE_BYTES));
    }
  });

  it("names the local runner rather than a host when there is no host to name", async () => {
    // A remote channel carries no `ipc_path`, so `describeTransportError` names
    // the uri's authority — which is the placeholder. That is the honest answer
    // until MAR-498 gives a channel the host record it belongs to, and it is
    // asserted here so the gap is visible rather than assumed away.
    const result = await fetchAgentDomState(
      { uri: `${IPC_ORIGIN}/agents/host-agent`, token: "t" },
      {
        fetch: stdioFetch(() => {
          throw new Error("no ssh");
        }),
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unavailable");
      // Never the error's own text: an `ssh` failure names a host, a user, a
      // port and a key path, and this string reaches a log and a UI.
      expect(result.detail).not.toContain("no ssh");
    }
  });
});

describe("a remote channel built on it", () => {
  it("attaches the host runner's own channel secret to every call", async () => {
    const channel = remoteRunnerChannel({ token: "the-host-runners-own-secret", dial });
    const response = await channel.call("/agents");
    const body = (await response.json()) as { authorization: string };
    expect(body.authorization).toBe("Bearer the-host-runners-own-secret");
  });

  it("reaches the evidence routes a host is there to answer", async () => {
    const channel = remoteRunnerChannel({ token: "t", dial });
    for (const route of ["/telemetry/drain", "/artifacts/drain", "/workspace-artifacts"] as const) {
      const response = await channel.call(route, { method: "POST" });
      const body = (await response.json()) as { path: string };
      expect(body.path).toBe(route);
    }
  });
});
