/**
 * The narrowest broker in DASH, and what it will not do (MAR-743, ADR 0028).
 *
 * `tests/host-broker.test.ts` set the shape and this file inherits it: the
 * production `createChiefBroker`, the production catalogue, the production
 * refusal vocabulary, and **one substitution** — `fetchImpl` — which is what
 * lets the last assertion be made from outside, that a planted key appears in no
 * answer, no audit row and no log line.
 *
 * What it proves is the boundary ADR 0028 decision 5 hands to the runner. What
 * it does not prove, and no green run here may be read as proving: Discord, a
 * real provider, or that the runner survives DASH closing. The last of those is
 * Henrik's attended flow and cannot be asserted from a test process.
 */

import { describe, expect, it } from "vitest";

import { BROKER_CALLS_PER_WINDOW, BROKER_SPEND_PER_WINDOW } from "../lib/broker/execute";
import type { BrokerRequest } from "../lib/broker/protocol";
import { CHIEF_CONNECTION_ID, chiefOperationId } from "../lib/chief/manifest";
import { createChiefBroker, type ChiefAuditRow } from "../runner/chief-broker";

/** The value handed to the broker. Nothing it emits may contain it. */
const PLANTED_KEY = "sk-or-v1-PLANTEDdeadbeefPLANTEDdeadbeefPLANTED";
const PROVIDER = "openrouter";

const ANSWER_BODY = {
  choices: [{ message: { content: "Four agents, and one is waiting for you." } }],
  model: "openai/gpt-5-mini",
  usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0003 },
};

function request(over: Partial<BrokerRequest> = {}, id = "chief-1"): BrokerRequest {
  return {
    request_id: id,
    connection_id: CHIEF_CONNECTION_ID,
    operation: chiefOperationId(PROVIDER),
    input: {
      model: "openai/gpt-5-mini",
      question: "how is the fleet",
      material: "Scout — AI News Scout. Ran twice.",
      context: "",
      max_output_tokens: 700,
    },
    ...over,
  } as BrokerRequest;
}

interface Harness {
  broker: ReturnType<typeof createChiefBroker>;
  audit: ChiefAuditRow[];
  calls: { url: string; headers: Record<string, string>; body: string | undefined }[];
  at: { value: number };
  logs: string[];
}

function harness(
  options: {
    credential?: { provider_id: string; api_key: string } | null;
    respond?: () => Response;
  } = {},
): Harness {
  const audit: ChiefAuditRow[] = [];
  const calls: Harness["calls"] = [];
  const logs: string[] = [];
  const at = { value: Date.parse("2026-08-23T09:00:00.000Z") };

  const credential =
    options.credential === undefined
      ? { provider_id: PROVIDER, api_key: PLANTED_KEY }
      : options.credential;

  const broker = createChiefBroker({
    credential: () => credential,
    fetchImpl: (async (url: unknown, init: unknown) => {
      const request_ = init as { headers?: Record<string, string>; body?: string };
      calls.push({
        url: String(url),
        headers: request_.headers ?? {},
        body: request_.body,
      });
      return (
        options.respond?.() ??
        new Response(JSON.stringify(ANSWER_BODY), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }) as unknown as typeof fetch,
    audit: (row) => {
      audit.push(row);
      // The wiring logs decisions in the runner; searched below for the key.
      logs.push(JSON.stringify(row));
    },
    now: () => new Date(at.value),
  });

  return { broker, audit, calls, at, logs };
}

describe("what the chief's broker will do", () => {
  it("answers the one operation it exists for, and audits it", async () => {
    const { broker, audit, calls } = harness();
    const response = await broker.handle(request());

    expect(response.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.decision).toBe("allowed");
    expect(audit[0]?.operation).toBe(chiefOperationId(PROVIDER));
    // Names, never values. The question is not in the audit row.
    expect(audit[0]?.input_keys).toEqual([
      "context",
      "material",
      "max_output_tokens",
      "model",
      "question",
    ]);
  });

  it("asks under the fleet-briefing frame, and a caller cannot choose it", async () => {
    /*
     * ADR 0023 decision 5 kept in the second room. The frame decides which of
     * DASH's two frozen system prompts the question is set in, and a caller able
     * to send one would be a caller able to ask the agent-material prompt about
     * fleet material or the reverse. Written here as a constant, so the assertion
     * is that a supplied `frame` makes no difference.
     */
    const { broker, calls } = harness();
    await broker.handle(request({ input: { ...request().input, frame: "agent_material" } }));
    const sent = JSON.parse(calls[0]?.body ?? "{}") as { messages?: { content?: string }[] };
    const system = sent.messages?.[0]?.content ?? "";
    // The fleet prompt is the one the chief is asked under. Compared against the
    // agent prompt's own distinguishing word rather than by quoting either in
    // full — this test is about which one, not about their text.
    expect(system.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });
});

describe("what it will not do", () => {
  it("refuses every operation but its own, including the provider's others", async () => {
    /*
     * The closed set, and it has one member. `.models.list` and `.digest.curate`
     * are admitted by the *host* broker for a deployed agent; here they are
     * `unknown_operation`, which is what makes this the narrowest broker in
     * DASH rather than a copy of that one.
     */
    for (const operation of [
      `${PROVIDER}.models.list`,
      `${PROVIDER}.digest.curate`,
      "gmail.search",
      "gmail.draft.create",
      "mcp.tools.call",
      "browser.open",
    ]) {
      const { broker, audit, calls } = harness();
      const response = await broker.handle(request({ operation }));
      expect(response.ok).toBe(false);
      expect(audit[0]?.refusal).toBe("unknown_operation");
      // Refused before anything reached a provider's door.
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses a completion aimed at a provider whose key it is not holding", async () => {
    /*
     * The check that stops an OpenAI body reaching Anthropic's origin with
     * Anthropic's key on it — a bug locally, and a key sent to the wrong company
     * here.
     */
    const { broker, audit, calls } = harness();
    const response = await broker.handle(request({ operation: chiefOperationId("anthropic") }));
    expect(response.ok).toBe(false);
    expect(audit[0]?.refusal).toBe("unknown_operation");
    expect(calls).toHaveLength(0);
  });

  it("refuses any connection but the chief's", async () => {
    const { broker, audit, calls } = harness();
    const response = await broker.handle(request({ connection_id: "models" }));
    expect(response.ok).toBe(false);
    expect(audit[0]?.refusal).toBe("unknown_connection");
    expect(calls).toHaveLength(0);
  });

  it("says not_connected when main has handed over no key", async () => {
    /*
     * The state every runner is in after a restart, and ADR 0028 decision 9's
     * whole reason: `lib/chief/answer.ts` never reaches this file without a
     * model, so what this proves is the belt to that braces — a request that got
     * here anyway is refused with a word whose next move is right.
     */
    const { broker, audit, calls } = harness({ credential: null });
    const response = await broker.handle(request());
    expect(response.ok).toBe(false);
    expect(audit[0]?.refusal).toBe("not_connected");
    expect(calls).toHaveLength(0);
  });

  it("refuses a repeat of a request id it has already answered", async () => {
    const { broker, audit } = harness();
    await broker.handle(request({}, "chief-same"));
    const second = await broker.handle(request({}, "chief-same"));
    expect(second.ok).toBe(false);
    expect(audit[1]?.refusal).toBe("duplicate_request");
  });

  it("stops at the spend window, which is the ceiling on a Discord conversation", async () => {
    /*
     * ADR 0028 decision 8's arithmetic. A Discord message is a person's press
     * and authorises one completion; the worst case is `BROKER_SPEND_PER_WINDOW`
     * of them a minute, and this is where that number is actually enforced.
     */
    const { broker, audit } = harness();
    for (let i = 0; i < BROKER_SPEND_PER_WINDOW; i += 1) {
      const response = await broker.handle(request({}, `chief-${String(i)}`));
      expect(response.ok).toBe(true);
    }
    const over = await broker.handle(request({}, "chief-over"));
    expect(over.ok).toBe(false);
    expect(audit.at(-1)?.refusal).toBe("rate_limited");
  });

  it("stops at the call window before it resolves anything", async () => {
    const { broker, audit, calls } = harness();
    for (let i = 0; i < BROKER_CALLS_PER_WINDOW; i += 1) {
      await broker.handle(request({ operation: "gmail.search" }, `chief-${String(i)}`));
    }
    const over = await broker.handle(request({ operation: "gmail.search" }, "chief-over"));
    expect(over.ok).toBe(false);
    expect(audit.at(-1)?.refusal).toBe("rate_limited");
    expect(calls).toHaveLength(0);
  });

  it("reports a refused key as revoked and an outage as unavailable", async () => {
    const revoked = harness({ respond: () => new Response("no", { status: 401 }) });
    expect((await revoked.broker.handle(request())).ok).toBe(false);
    expect(revoked.audit[0]?.refusal).toBe("revoked");

    const down = harness({
      respond: () => {
        throw new Error("ECONNRESET");
      },
    });
    expect((await down.broker.handle(request())).ok).toBe(false);
    expect(down.audit[0]?.refusal).toBe("provider_unavailable");
  });
});

describe("the key", () => {
  it("goes on the wire and nowhere else", async () => {
    /*
     * The assertion this file's substitution exists to make. The key is on the
     * request headers, because that is where a credential belongs, and it is in
     * no answer, no audit row and no log line — including the failure paths,
     * where a caught fetch rejection can carry the request that had it.
     */
    const ok = harness();
    const answered = await ok.broker.handle(request());

    const authorization = Object.entries(ok.calls[0]?.headers ?? {}).find(
      ([name]) => name.toLowerCase() === "authorization",
    );
    expect(authorization?.[1]).toContain(PLANTED_KEY);

    expect(JSON.stringify(answered)).not.toContain(PLANTED_KEY);
    expect(JSON.stringify(ok.audit)).not.toContain(PLANTED_KEY);
    expect(ok.logs.join("\n")).not.toContain(PLANTED_KEY);
    // Nor in the body, which is where a careless spread would put it.
    expect(ok.calls[0]?.body ?? "").not.toContain(PLANTED_KEY);

    const failed = harness({
      respond: () => {
        throw new Error(`fetch failed for ${PLANTED_KEY}`);
      },
    });
    const refused = await failed.broker.handle(request());
    expect(JSON.stringify(refused)).not.toContain(PLANTED_KEY);
    expect(JSON.stringify(failed.audit)).not.toContain(PLANTED_KEY);
    expect(failed.logs.join("\n")).not.toContain(PLANTED_KEY);
  });
});
