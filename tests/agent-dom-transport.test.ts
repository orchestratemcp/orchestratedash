/**
 * The HTTP transport profile v0, as DASH speaks it (MAR-415).
 *
 * Two modules, tested together because they are two halves of one decision:
 * `control-location.ts` decides whether DASH may talk to an endpoint at all,
 * and `transport.ts` does the talking. Both are pure enough to test without a
 * listening socket, which matters — "loopback may use http, everything else
 * must use https" is a security boundary, and a security boundary that can only
 * be exercised by standing up a server is one that mostly does not get
 * exercised.
 *
 * `tests/runner-server.test.ts` covers the other end against a real server.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { checkControlUrl, resolveControlLocation } from "../lib/agent-dom/control-location";
import { describeRunnerStoreDamage } from "../lib/copy/recovery";
import type { AgentManifestV2 } from "../lib/contracts";
import type { AgentCommandEnvelope } from "../lib/agent-dom/envelope";
import { IPC_ORIGIN } from "../lib/agent-dom/ipc-fetch";
import {
  fetchAgentDomState,
  httpAdapter,
  safeDetail,
  type ControlChannel,
} from "../lib/agent-dom/transport";
import {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
  type RunnerEndpoint,
} from "../runner/endpoint";

const ipcWorkDir = mkdtempSync(path.join(tmpdir(), "dash-transport-ipc-"));

/* ---------------------------------------------------------------------- *
 * Control locations
 * ---------------------------------------------------------------------- */

function manifest(agentDom: Record<string, unknown>): AgentManifestV2 {
  return { manifest_version: 2, agent_dom: agentDom } as unknown as AgentManifestV2;
}

const LOOPBACK = "http://127.0.0.1:4319/agent-dom";

describe("resolving a control location", () => {
  it("reports read-only when the manifest declares no command support", () => {
    const result = resolveControlLocation(
      manifest({ control: { supported: false }, locations: { control: [] } }),
    );
    expect(result).toMatchObject({ ok: false, problem: "not_supported" });
  });

  it("reports read-only when the control block is missing entirely", () => {
    // "Missing controls mean read-only, not inferred controls."
    expect(resolveControlLocation(manifest({}))).toMatchObject({
      ok: false,
      problem: "not_supported",
    });
  });

  it("uses the location the control block names", () => {
    const result = resolveControlLocation(
      manifest({
        control: { supported: true, location_id: "b" },
        locations: {
          control: [
            { id: "a", uri: "https://a.example/dom" },
            { id: "b", uri: "https://b.example/dom" },
          ],
        },
      }),
    );
    expect(result).toMatchObject({ ok: true, uri: "https://b.example/dom" });
  });

  it("refuses when the named location is not declared", () => {
    const result = resolveControlLocation(
      manifest({
        control: { supported: true, location_id: "missing" },
        locations: { control: [{ id: "a", uri: "https://a.example/dom" }] },
      }),
    );
    expect(result).toMatchObject({ ok: false, problem: "unknown_location_id" });
  });

  it("uses the only addressable location when none is named", () => {
    const result = resolveControlLocation(
      manifest({
        control: { supported: true },
        locations: { control: [{ id: "only", uri: LOOPBACK }] },
      }),
    );
    expect(result).toMatchObject({ ok: true, uri: LOOPBACK, loopback: true });
  });

  it("refuses to guess between several", () => {
    // "The first entry in the array" is not a rule any manifest author agreed
    // to, and sending commands to the wrong endpoint is worse than not sending
    // them.
    const result = resolveControlLocation(
      manifest({
        control: { supported: true },
        locations: {
          control: [
            { id: "a", uri: "https://a.example/dom" },
            { id: "b", uri: "https://b.example/dom" },
          ],
        },
      }),
    );
    expect(result).toMatchObject({ ok: false, problem: "ambiguous_location" });
  });

  it("refuses when the declared location carries no uri", () => {
    const result = resolveControlLocation(
      manifest({
        control: { supported: true },
        locations: { control: [{ id: "a", label: "no uri" }] },
      }),
    );
    expect(result).toMatchObject({ ok: false, problem: "no_location" });
  });

  it("resolves the shipped example's own control location", () => {
    // The example is what the runner's registration fixtures are built from, so
    // a change that broke it would break the smoke rather than a unit test.
    const result = resolveControlLocation(
      manifest({
        control: { supported: true, location_id: "meeting-control" },
        locations: { control: [{ id: "meeting-control", uri: LOOPBACK }] },
      }),
    );
    expect(result).toMatchObject({ ok: true, loopback: true });
  });
});

describe("which URLs DASH will send a command to", () => {
  it.each([
    ["loopback by literal address", "http://127.0.0.1:4319/agent-dom"],
    ["anywhere in 127.0.0.0/8", "http://127.0.0.2:4319/dom"],
    ["localhost", "http://localhost:4319/dom"],
    ["IPv6 loopback", "http://[::1]:4319/dom"],
    ["https anywhere", "https://agent.example.com/dom"],
  ])("allows %s", (_label, uri) => {
    expect(checkControlUrl(uri).ok).toBe(true);
  });

  it("refuses plain http to somewhere that is not loopback", () => {
    // The contract permits loopback http for a local adapter and requires https
    // for remote control. Plain http off-machine is a command channel readable
    // by the network it crosses.
    expect(checkControlUrl("http://agent.example.com/dom")).toMatchObject({
      ok: false,
      problem: "insecure_scheme",
    });
  });

  it("refuses a scheme that is not http or https", () => {
    expect(checkControlUrl("ftp://example.com/dom")).toMatchObject({
      ok: false,
      problem: "insecure_scheme",
    });
  });

  it("refuses credentials in the URL rather than stripping them", () => {
    // Stripping would mean DASH had held a credential and decided to be tidy
    // about it. "Credentials never appear in ... URLs" has no tidy variant.
    expect(checkControlUrl("https://user:pass@example.com/dom")).toMatchObject({
      ok: false,
      problem: "credentials_in_url",
    });
  });

  it("refuses a query string, which the v0 profile's operations do not take", () => {
    expect(checkControlUrl("https://example.com/dom?token=abc")).toMatchObject({
      ok: false,
      problem: "credentials_in_url",
    });
  });

  it("refuses something that is not a URL", () => {
    expect(checkControlUrl("/just/a/path")).toMatchObject({ ok: false, problem: "malformed_uri" });
  });

  it("removes a trailing slash so the commands path is well formed", () => {
    // `${uri}/commands` on a trailing slash gives a double slash, and some
    // servers route those differently.
    expect(checkControlUrl("https://example.com/dom/")).toMatchObject({
      ok: true,
      uri: "https://example.com/dom",
    });
  });
});

/* ---------------------------------------------------------------------- *
 * The adapter
 * ---------------------------------------------------------------------- */

const CHANNEL = { uri: "http://127.0.0.1:4319/agent-dom", token: "channel-token-value" };
const ENVELOPE = { command_id: "cmd-1", command: "approve" } as unknown as AgentCommandEnvelope;

/** A fetch that answers with whatever the test wants, and records the call. */
function fakeFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return responder(String(url), init ?? {});
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("submitting a command", () => {
  it("posts the envelope to the commands path with a bearer token", async () => {
    const fetcher = fakeFetch(() => jsonResponse({ ok: true, detail: "done" }));
    await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);

    expect(fetcher.calls[0]?.url).toBe("http://127.0.0.1:4319/agent-dom/commands");
    expect(fetcher.calls[0]?.init.method).toBe("POST");
    const headers = fetcher.calls[0]?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer channel-token-value");
  });

  it("never puts the token in the URL", async () => {
    const fetcher = fakeFetch(() => jsonResponse({ ok: true }));
    await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(fetcher.calls[0]?.url).not.toContain("channel-token-value");
  });

  it("reports success when the runner says it handled the command", async () => {
    const fetcher = fakeFetch(() => jsonResponse({ ok: true, detail: "delivered" }));
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome).toEqual({ ok: true, detail: "delivered" });
  });

  it("reports a refusal even though the request itself succeeded", async () => {
    // 200 is not "the effect happened". An adapter that treated it that way
    // would be the success-returning stub one HTTP hop further out.
    const fetcher = fakeFetch(() => jsonResponse({ ok: false, detail: "approval expired" }));
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome).toMatchObject({ ok: false, reason: "adapter_failed", detail: "approval expired" });
  });

  it("distinguishes a runner that refused from one that could not be reached", async () => {
    const unreachable = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const outcome = await httpAdapter(CHANNEL, { fetch: unreachable.fn }).submit(ENVELOPE);
    expect(outcome).toMatchObject({ ok: false, reason: "adapter_unavailable" });
  });

  it("reports a credential rejection as something the user can act on", async () => {
    const fetcher = fakeFetch(() => jsonResponse({}, 401));
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome).toMatchObject({ ok: false, reason: "adapter_failed" });
    expect(outcome.ok ? "" : outcome.detail).toContain("re-enrolled");
  });

  it("reports a server error as something a person can read, with the status kept", async () => {
    /*
     * MAR-506. This assertion used to be `detail: "The runner answered 503."`,
     * and that sentence is what a user saw for four hours on a machine whose
     * runner store was malformed. It names the transport and nothing else: not
     * that DASH reached the runner, not that nothing of theirs was lost, not
     * what to do. The status is still here, in the clause somebody reporting the
     * fault can quote.
     */
    const fetcher = fakeFetch(() => jsonResponse({}, 503));
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome).toMatchObject({ ok: false, reason: "adapter_failed" });
    const detail = outcome.ok ? "" : (outcome.detail ?? "");
    expect(detail).toContain("Nothing was changed.");
    expect(detail).toContain("status 503");
    expect(detail).not.toBe("The runner answered 503.");
  });

  it("turns the runner's damaged-store answer into a recovery", async () => {
    // MAR-506. The typed 503 the runner now sends, and the three sentences
    // `describeRunnerStoreDamage` produces for it.
    const fetcher = fakeFetch(() =>
      jsonResponse(
        { ok: false, reason: "store_damaged", kind: "malformed", detail: "database disk image is malformed" },
        503,
      ),
    );
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    const detail = outcome.ok ? "" : (outcome.detail ?? "");

    // MAR-518: the repair has a caller now (app/page.tsx's retire button), so
    // this reads can_retire: true — the same fact stated as text here, since
    // this path has no button of its own to offer.
    const recovery = describeRunnerStoreDamage("malformed", { can_retire: true });
    expect(detail).toContain(recovery.headline);
    expect(detail).toContain(recovery.meaning);
    expect(detail).toContain(recovery.next_action);
    // Nothing about a status code or a disk image reaches the person.
    expect(detail).not.toMatch(/503|disk image/);
  });

  it("keeps the runner's own classification when it sends one", async () => {
    const fetcher = fakeFetch(() =>
      jsonResponse({ ok: false, reason: "store_damaged", kind: "not_a_database" }, 503),
    );
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome.ok ? "" : (outcome.detail ?? "")).toContain(
      describeRunnerStoreDamage("not_a_database").headline,
    );
  });

  it("does not let an unrelated 5xx steer the copy", async () => {
    // `reason` is matched before `kind` is trusted, so a body that happens to
    // carry a `kind` cannot choose DASH's sentence for it.
    const fetcher = fakeFetch(() => jsonResponse({ ok: false, kind: "malformed" }, 500));
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome.ok ? "" : (outcome.detail ?? "")).toContain("status 500");
  });

  it("falls back to a classification it has words for", async () => {
    // A newer runner naming a damage this build does not know. The fact the user
    // needs is that the store is damaged; refusing to say anything because the
    // label is unfamiliar would lose the message over its name.
    const fetcher = fakeFetch(() =>
      jsonResponse({ ok: false, reason: "store_damaged", kind: "shredded_by_gremlins" }, 503),
    );
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome.ok ? "" : (outcome.detail ?? "")).toContain(
      describeRunnerStoreDamage("malformed").headline,
    );
  });

  it("refuses a response that is not JSON", async () => {
    const fetcher = fakeFetch(() => new Response("<html>nope</html>", { status: 200 }));
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome).toMatchObject({ ok: false, reason: "adapter_failed" });
  });

  it("refuses a response body that exceeds the ceiling", async () => {
    // A hostile runner must be able to make DASH slow, not make it exit.
    const fetcher = fakeFetch(() => new Response("x".repeat(2_000_000), { status: 200 }));
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome).toMatchObject({ ok: false, reason: "adapter_failed" });
    expect(outcome.ok ? "" : outcome.detail).toContain("exceeded");
  });

  it("gives up on a runner that never answers, and says so", async () => {
    const hanging = (async (_url: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as unknown as typeof globalThis.fetch;

    const outcome = await httpAdapter(CHANNEL, { fetch: hanging, timeout_ms: 50 }).submit(ENVELOPE);
    expect(outcome).toMatchObject({ ok: false, reason: "adapter_unavailable" });
    expect(outcome.ok ? "" : outcome.detail).toContain("did not answer");
  });

  it("names the host but never the token when it cannot connect", async () => {
    const fetcher = fakeFetch(() => {
      throw new TypeError(`fetch failed for ${CHANNEL.uri} with Bearer ${CHANNEL.token}`);
    });
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    const detail = outcome.ok ? "" : (outcome.detail ?? "");
    expect(detail).toContain("127.0.0.1:4319");
    expect(detail).not.toContain(CHANNEL.token);
  });
});

describe("fetching state", () => {
  it("returns the parsed body without validating it", async () => {
    // Validation belongs to putAgentDomState, which checks it against the
    // contract. A transport that pre-validated would be a second copy of that
    // rule, free to drift.
    const fetcher = fakeFetch(() => jsonResponse({ state_version: 1, agent_id: "a" }));
    const result = await fetchAgentDomState(CHANNEL, { fetch: fetcher.fn });
    expect(result).toEqual({ ok: true, state: { state_version: 1, agent_id: "a" } });
    expect(fetcher.calls[0]?.url).toBe(CHANNEL.uri);
  });

  it("separates a runner that is down from one that is broken", async () => {
    const down = fakeFetch(() => {
      throw new TypeError("ECONNREFUSED");
    });
    expect(await fetchAgentDomState(CHANNEL, { fetch: down.fn })).toMatchObject({
      ok: false,
      reason: "unavailable",
    });

    const broken = fakeFetch(() => jsonResponse({}, 500));
    expect(await fetchAgentDomState(CHANNEL, { fetch: broken.fn })).toMatchObject({
      ok: false,
      reason: "failed",
    });
  });
});

describe("text the runner chose", () => {
  it("strips control characters so a runner cannot forge a log line", () => {
    const forged = safeDetail(`done${String.fromCharCode(10)}[dash-command] allowed everything`);
    expect(forged).not.toContain(String.fromCharCode(10));
    expect(forged).toContain("done");
  });

  it("truncates something absurdly long", () => {
    const long = safeDetail("x".repeat(5_000)) ?? "";
    expect(long.length).toBeLessThan(600);
  });

  it("treats an empty or non-string detail as absent", () => {
    expect(safeDetail("")).toBeUndefined();
    expect(safeDetail("   ")).toBeUndefined();
    expect(safeDetail(42)).toBeUndefined();
    expect(safeDetail(undefined)).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------- *
 * The same adapter, over a socket instead of a network
 * ---------------------------------------------------------------------- */

/**
 * MAR-430's fifth criterion, met by construction rather than by arranging for
 * two implementations to behave alike.
 *
 * Everything above this point injects a fake `fetch`, which is the right way to
 * test the rules and the wrong way to prove the wiring: an injected fetch would
 * pass whether or not `ipc_path` reached the dialer at all. So this block does
 * the opposite — a real endpoint, a real server, no injection — and asserts
 * that the *unmodified* `httpAdapter` and `fetchAgentDomState` speak to it.
 */
describe("a local channel", () => {
  const started: { server: Server; endpoint: RunnerEndpoint }[] = [];

  afterAll(async () => {
    for (const { server, endpoint } of started) {
      await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
      releaseEndpoint(endpoint);
    }
    rmSync(ipcWorkDir, { recursive: true, force: true });
  });

  async function endpointServing(
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ): Promise<ControlChannel> {
    const endpoint = runnerEndpoint(
      mkdtempSync(path.join(ipcWorkDir, "data-")),
      randomBytes(8).toString("hex"),
    );
    const server = createServer(handler);
    await prepareEndpoint(endpoint);
    await listenOnEndpoint(server, endpoint);
    started.push({ server, endpoint });
    return { uri: `${IPC_ORIGIN}/agents/demo`, token: "channel-token-value", ipc_path: endpoint.path };
  }

  it("submits a command down the endpoint and reads the runner's answer", async () => {
    let seen: { url?: string; auth?: string; body: string } | null = null;
    const channel = await endpointServing((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      request.on("end", () => {
        seen = { url: request.url, auth: request.headers.authorization, body };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, detail: "handled" }));
      });
    });

    expect(await httpAdapter(channel).submit(ENVELOPE)).toEqual({ ok: true, detail: "handled" });
    // The profile's path, and the credential still in the header where it
    // belongs. A local transport does not get to relax either.
    expect(seen).toMatchObject({
      url: "/agents/demo/commands",
      auth: "Bearer channel-token-value",
    });
  });

  it("reads a state snapshot down the endpoint", async () => {
    const channel = await endpointServing((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ agent_id: "demo", status: "running" }));
    });

    expect(await fetchAgentDomState(channel)).toEqual({
      ok: true,
      state: { agent_id: "demo", status: "running" },
    });
  });

  it("keeps the byte ceiling that a hostile runner would otherwise defeat", async () => {
    // The ceiling is a property of the transport, so moving the transport must
    // not have moved it. A megabyte-plus body over a socket is exactly as much
    // of an unbounded allocation as one over TCP.
    const channel = await endpointServing((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ padding: "x".repeat(1_200_000) }));
    });

    expect(await fetchAgentDomState(channel)).toMatchObject({ ok: false, reason: "failed" });
  });

  it("calls an endpoint nobody is listening on unavailable, not failed", async () => {
    // The rejection taxonomy survives the move: "could not reach it" and
    // "reached it and it went wrong" still need different recoveries.
    const channel: ControlChannel = {
      uri: `${IPC_ORIGIN}/agents/demo`,
      token: "channel-token-value",
      ipc_path: runnerEndpoint(ipcWorkDir, "nobody-is-here").path,
    };
    const result = await fetchAgentDomState(channel);
    expect(result).toMatchObject({ ok: false, reason: "unavailable" });
    // And it names something a person can act on rather than a hostname that
    // does not resolve and never did.
    expect((result as { detail: string }).detail).toContain("local runner");
  });
});
