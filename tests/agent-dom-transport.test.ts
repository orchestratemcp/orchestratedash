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

import { describe, expect, it } from "vitest";

import { checkControlUrl, resolveControlLocation } from "../lib/agent-dom/control-location";
import type { AgentManifestV2 } from "../lib/contracts";
import type { AgentCommandEnvelope } from "../lib/agent-dom/envelope";
import { fetchAgentDomState, httpAdapter, safeDetail } from "../lib/agent-dom/transport";

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

  it("reports a server error with its status", async () => {
    const fetcher = fakeFetch(() => jsonResponse({}, 503));
    const outcome = await httpAdapter(CHANNEL, { fetch: fetcher.fn }).submit(ENVELOPE);
    expect(outcome).toMatchObject({ ok: false, reason: "adapter_failed", detail: "The runner answered 503." });
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
