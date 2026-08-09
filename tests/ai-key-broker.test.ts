/**
 * The boundary between an agent and a model provider's key (MAR-582, ADR 0002).
 *
 * `tests/broker-threat-model.test.ts` establishes the shape of this argument for
 * a sign-in: plant a distinctive credential, drive the boundary from the agent's
 * side, and then search everything that came back — the response, every audit
 * row, every thrown error — for the planted value. A leak of any kind fails,
 * including one through a path nobody thought of.
 *
 * A model key deserves the same treatment and is in one way a harder case. An
 * access token is minted and expires; a key is the durable thing the user
 * pasted, it is worth money, and — unlike a bearer token DASH built — it is the
 * exact bytes that go on the wire. So the planted value here is both the thing
 * that must never escape and the thing that must arrive.
 *
 * The second half of this file uses a real loopback HTTP server, because the
 * liveness probe's whole job is to turn what a provider actually answered into
 * one of five states, and a mocked `fetch` would be asserting a translation of a
 * translation.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { classifyProbe } from "../lib/ai/liveness";
import { probeModelProvider } from "../lib/ai/probe";
import { aiProviderById, type AiProviderProfile } from "../lib/ai/providers";
import type { ConnectionSourceManifest } from "../lib/connections";
import {
  everyString,
  harness,
  keyCredential,
  PLANTED_PROVIDER_KEY,
} from "./fakes/broker-harness";

/* ---------------------------------------------------------------------- *
 * A manifest that declares one model-provider key
 * ---------------------------------------------------------------------- */

function keyManifest(provider = "openrouter"): ConnectionSourceManifest {
  return {
    agent_dom: {
      connections: [
        {
          id: "models",
          provider,
          label: "Your model provider",
          purpose: "Write the digest",
          ownership: "dash_managed",
          capabilities: [{ id: "model.completion", label: "Write text", access: "write" }],
          fields: [
            {
              id: "key",
              label: "API key",
              purpose: "So DASH can reach the provider for this agent",
              kind: "secret",
              required: true,
            },
          ],
          validation_action: { id: "check", label: "Check", behavior: "test" },
        },
      ],
    },
  };
}

const AGENT = "digest-writer";

function ask(operation: string, input: Record<string, unknown> = {}, id = "req-1") {
  return { request_id: id, connection_id: "models", operation, input };
}

const MODELS_BODY = {
  data: [
    { id: "anthropic/claude-opus-4", name: "Claude Opus" },
    { id: "openai/gpt-5", name: "GPT" },
  ],
};

function keyHarness(provider = "openrouter") {
  return harness({
    manifest: keyManifest(provider),
    credential: {
      kind: "found",
      credential: keyCredential({ provider: provider as "openrouter" | "anthropic" | "openai" }),
    },
    respond: () => ({ status: 200, body: MODELS_BODY }),
  });
}

/* ---------------------------------------------------------------------- *
 * What reaches the provider
 * ---------------------------------------------------------------------- */

describe("the request DASH builds with somebody's key", () => {
  it("goes to the provider's own origin and its own path", async () => {
    const broker = keyHarness();
    await broker.handle(AGENT, ask("openrouter.models.list"));
    expect(broker.calls).toHaveLength(1);
    expect(broker.calls[0]?.url).toBe("https://openrouter.ai/api/v1/models");
    expect(broker.calls[0]?.method).toBe("GET");
    // A read of a list has no body. Nothing an agent supplied reaches the wire.
    expect(broker.calls[0]?.body).toBeNull();
  });

  it("carries the key in the header its provider reads, and in no other", async () => {
    const bearer = keyHarness("openrouter");
    await bearer.handle(AGENT, ask("openrouter.models.list"));
    expect(bearer.calls[0]?.headers["authorization"]).toBe(`Bearer ${PLANTED_PROVIDER_KEY}`);
    expect(bearer.calls[0]?.headers["x-api-key"]).toBeUndefined();

    const keyed = keyHarness("anthropic");
    await keyed.handle(AGENT, ask("anthropic.models.list"));
    expect(keyed.calls[0]?.url).toBe("https://api.anthropic.com/v1/models");
    expect(keyed.calls[0]?.headers["x-api-key"]).toBe(PLANTED_PROVIDER_KEY);
    expect(keyed.calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
    expect(keyed.calls[0]?.headers["authorization"]).toBeUndefined();
  });

  it("never lets a credential header displace one DASH chose", async () => {
    const broker = keyHarness();
    await broker.handle(AGENT, ask("openrouter.models.list"));
    // The merge order is the guard: authorization headers are spread first, so
    // `accept` is always DASH's. A profile that tried to set it would also fail
    // the name check in `lib/broker/execute.ts` and at module load.
    expect(broker.calls[0]?.headers["accept"]).toBe("application/json");
  });
});

/* ---------------------------------------------------------------------- *
 * What comes back to the agent
 * ---------------------------------------------------------------------- */

describe("what the agent receives", () => {
  it("is model ids and nothing else", async () => {
    const broker = keyHarness();
    const answer = await broker.handle(AGENT, ask("openrouter.models.list"));
    expect(answer).toMatchObject({
      ok: true,
      result: { models: ["anthropic/claude-opus-4", "openai/gpt-5"] },
    });
    // Not the names, not the descriptions, not the prices. A projection that
    // carried a provider's own prose into an agent's reasoning is the injection
    // surface ADR 0002 invariant 7 is about.
    expect(JSON.stringify(answer)).not.toContain("Claude Opus");
  });

  it("drops an id the provider made up out of characters DASH will not name", async () => {
    const broker = harness({
      manifest: keyManifest(),
      credential: { kind: "found", credential: keyCredential() },
      respond: () => ({
        status: 200,
        body: {
          data: [
            { id: "good/model-1" },
            { id: "meta-llama/llama-3.3-70b:free" },
            { id: "gpt-4.1-mini" },
            // The one that mattered. A flat character class accepted this, and
            // no operation interpolates a model id into a URL today — so it was
            // a value that would have become an escape the moment somebody
            // built a completion call.
            { id: "../../etc/passwd" },
            { id: "vendor/../../etc/passwd" },
            { id: "a/b/c" },
            { id: "with space" },
            { id: "with\nnewline" },
            { id: 42 },
            { id: `${"x".repeat(200)}` },
          ],
        },
      }),
    });
    const answer = await broker.handle(AGENT, ask("openrouter.models.list"));
    expect(answer).toMatchObject({
      ok: true,
      result: {
        models: ["good/model-1", "meta-llama/llama-3.3-70b:free", "gpt-4.1-mini"],
      },
    });
  });

  it("caps how many ids one answer carries", async () => {
    const broker = harness({
      manifest: keyManifest(),
      credential: { kind: "found", credential: keyCredential() },
      respond: () => ({
        status: 200,
        body: { data: Array.from({ length: 500 }, (_, index) => ({ id: `m-${String(index)}` })) },
      }),
    });
    const answer = (await broker.handle(AGENT, ask("openrouter.models.list"))) as {
      result: { models: string[] };
    };
    expect(answer.result.models).toHaveLength(200);
  });

  it("never contains the key, in the answer or in any audit row", async () => {
    const broker = keyHarness();
    const answer = await broker.handle(AGENT, ask("openrouter.models.list"));

    for (const value of everyString(answer)) {
      expect(value).not.toContain(PLANTED_PROVIDER_KEY);
      expect(value).not.toContain("PLANTED-PROVIDER-KEY");
    }
    expect(broker.audit).toHaveLength(1);
    for (const value of everyString(broker.audit)) {
      expect(value).not.toContain(PLANTED_PROVIDER_KEY);
    }
    // And a key names nobody, so no account hint is invented from it.
    expect(broker.audit[0]?.account_hint).toBeNull();
    expect(broker.audit[0]).toMatchObject({
      decision: "allowed",
      operation: "openrouter.models.list",
      result_count: 2,
    });
  });
});

/* ---------------------------------------------------------------------- *
 * What the agent cannot do
 * ---------------------------------------------------------------------- */

describe("the operations that do not exist", () => {
  it("refuses every completion-shaped request by name", async () => {
    const broker = keyHarness();
    // The stage-1 argument, pointed at money instead of at a mailbox. Nothing is
    // built on a model key that can spend the account behind it, so every one of
    // these lands on the same refusal whatever the key is worth.
    for (const [index, operation] of [
      "openrouter.chat.completions",
      "openrouter.completion",
      "openrouter.chat",
      "openai.chat.completions",
      "anthropic.messages.create",
      "openrouter.models.delete",
    ].entries()) {
      const answer = await broker.handle(
        AGENT,
        ask(operation, {}, `req-${String(index + 10)}`),
      );
      expect(answer).toMatchObject({ ok: false, refusal: "unknown_operation" });
    }
    // Refused before any vault read, so none of them reached a provider.
    expect(broker.calls).toEqual([]);
  });

  it("refuses one provider's operation on another provider's connection", async () => {
    const broker = keyHarness("openrouter");
    const answer = await broker.handle(AGENT, ask("anthropic.models.list"));
    // The operation exists, and this grant does not reach it: the grant is
    // resolved from the connection's own profile, so an agent cannot borrow one
    // key to drive another provider's registry.
    expect(answer).toMatchObject({ ok: false, refusal: "not_granted" });
    expect(broker.calls).toEqual([]);
  });

  it("refuses a key presented for a connection DASH signs into", async () => {
    // The confusion `lib/ai/credential.ts` and `resolveGrant` refuse together: a
    // key envelope under a Gmail connection is never coerced into a bearer token
    // for Google.
    const broker = harness({
      credential: { kind: "found", credential: keyCredential() },
    });
    const answer = await broker.handle(AGENT, {
      request_id: "req-1",
      connection_id: "gmail",
      operation: "gmail.search",
      input: { query: "is:unread" },
    });
    expect(answer).toMatchObject({ ok: false, refusal: "not_granted" });
    expect(broker.calls).toEqual([]);
  });

  it("still counts against the agent's budget", async () => {
    const broker = keyHarness();
    for (let index = 0; index < 20; index += 1) {
      await broker.handle(AGENT, ask("openrouter.models.list", {}, `req-${String(index)}`));
    }
    const answer = await broker.handle(AGENT, ask("openrouter.models.list", {}, "req-over"));
    expect(answer).toMatchObject({ ok: false, refusal: "rate_limited" });
  });

  it("reports a refused key as needing a person rather than a retry", async () => {
    const broker = harness({
      manifest: keyManifest(),
      credential: { kind: "found", credential: keyCredential() },
      respond: () => ({ status: 401, body: { error: "invalid api key" } }),
    });
    const answer = await broker.handle(AGENT, ask("openrouter.models.list"));
    expect(answer).toMatchObject({ ok: false, refusal: "revoked" });
    // The provider's own words do not cross. An agent gets a code.
    expect(JSON.stringify(answer)).not.toContain("invalid api key");
  });
});

/* ---------------------------------------------------------------------- *
 * The liveness probe, against a real server
 * ---------------------------------------------------------------------- */

describe("the probe, over real HTTP", () => {
  let server: Server;
  let origin: string;
  let answer: { status: number; body: string } = { status: 200, body: "{}" };
  const seen: Array<{ url: string; headers: Record<string, string | string[] | undefined> }> = [];

  beforeAll(async () => {
    server = createServer((request: IncomingMessage, response: ServerResponse) => {
      seen.push({ url: request.url ?? "", headers: request.headers });
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(answer.body);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  /** The real OpenRouter profile, pointed at the loopback server. */
  function loopback(): AiProviderProfile {
    return { ...aiProviderById("openrouter")!, api_origin: origin };
  }

  it("presents the key and reads a count out of what came back", async () => {
    answer = { status: 200, body: JSON.stringify({ data: [{ id: "a" }, { id: "b" }] }) };
    const outcome = await probeModelProvider(loopback(), PLANTED_PROVIDER_KEY);

    expect(outcome).toEqual({ status: 200, model_count: 2 });
    const request = seen[seen.length - 1];
    expect(request?.url).toBe("/api/v1/models");
    expect(request?.headers["authorization"]).toBe(`Bearer ${PLANTED_PROVIDER_KEY}`);
    expect(classifyProbe(outcome, "2026-08-09T20:00:00.000Z")).toMatchObject({ state: "live" });
  });

  it("returns a status and never a body", async () => {
    answer = { status: 500, body: JSON.stringify({ error: "a message nobody should render" }) };
    const outcome = await probeModelProvider(loopback(), PLANTED_PROVIDER_KEY);

    expect(outcome).toEqual({ status: 500, model_count: null });
    expect(JSON.stringify(outcome)).not.toContain("nobody should render");
    expect(classifyProbe(outcome, "2026-08-09T20:00:00.000Z")).toMatchObject({
      state: "provider_error",
    });
  });

  it("calls a refusal a refusal", async () => {
    answer = { status: 403, body: "{}" };
    const outcome = await probeModelProvider(loopback(), PLANTED_PROVIDER_KEY);
    expect(classifyProbe(outcome, "2026-08-09T20:00:00.000Z")).toMatchObject({
      state: "key_refused",
    });
  });

  it("says it could not ask, rather than that the key is bad, when nothing answers", async () => {
    const dead: AiProviderProfile = {
      ...aiProviderById("openrouter")!,
      // A port nothing is listening on. The connection is refused, `fetch`
      // rejects, and the rejection is dropped rather than inspected — it can
      // carry the request, and this request has a key in its headers.
      api_origin: "http://127.0.0.1:1",
    };
    const outcome = await probeModelProvider(dead, PLANTED_PROVIDER_KEY);
    expect(outcome).toEqual({ status: null, model_count: null });
    expect(classifyProbe(outcome, "2026-08-09T20:00:00.000Z")).toMatchObject({
      state: "unreachable",
      model_count: null,
    });
  });

  it("does not treat an unreadable answer as an acceptance", async () => {
    answer = { status: 200, body: "not json at all" };
    const outcome = await probeModelProvider(loopback(), PLANTED_PROVIDER_KEY);
    expect(outcome).toEqual({ status: 200, model_count: null });
    expect(classifyProbe(outcome, "2026-08-09T20:00:00.000Z")).toMatchObject({
      state: "provider_error",
    });
  });

  it("never puts the key in the path or the query", async () => {
    answer = { status: 200, body: JSON.stringify({ data: [] }) };
    await probeModelProvider(loopback(), PLANTED_PROVIDER_KEY);
    expect(seen[seen.length - 1]?.url).not.toContain("PLANTED");
  });
});
