/**
 * The gate MAR-545 left closed, and what opening it is bounded by (MAR-619,
 * ADR 0016).
 *
 * `tests/broker-spend.test.ts` proves the standing this file changes: a spend
 * from an agent is refused with `needs_a_person`, before the vault, with its own
 * code. That test still passes unchanged, which is the first thing worth saying
 * about this one — **the default did not move.** An agent with no allowance
 * behind it is refused exactly as it was.
 *
 * What this file holds is the narrow thing that is now possible and the four
 * bounds on it:
 *
 * 1. **A press opens it.** Only `allowRunSpend` does, and it is called from one
 *    line in `electron/main.ts` on the `retry` verb.
 * 2. **It runs out.** `SPEND_ALLOWANCE_CALLS` calls and no more, counted on the
 *    attempt rather than on success.
 * 3. **It expires.** `SPEND_ALLOWANCE_MS` after the press, on DASH's clock.
 * 4. **It cannot be stacked.** A second press replaces the first.
 *
 * Plus the two things the model does not get to decide: which model it runs
 * under, and what ends up in the digest.
 */

import { describe, expect, it } from "vitest";

import {
  isSpendOperation,
  operationById,
  planCall,
  readCuration,
  spendPaths,
  type SpendOperation,
} from "../lib/broker/operations";
import {
  SPEND_ALLOWANCE_CALLS,
  SPEND_ALLOWANCE_MS,
  openRunSpend,
  spendAllowed,
  spendOne,
} from "../lib/broker/spend-allowance";
import { aiProviders } from "../lib/ai/providers";
import type { ConnectionSourceManifest } from "../lib/connections";
import { everyString, harness, keyCredential, PLANTED_PROVIDER_KEY } from "./fakes/broker-harness";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "ai-news-scout";

function curate(providerId: string): SpendOperation {
  const operation = operationById(`${providerId}.digest.curate`);
  if (operation === null || !isSpendOperation(operation)) {
    throw new Error(`no curate operation for ${providerId}`);
  }
  return operation;
}

/** A manifest declaring the scout's own model-provider key. */
function keyManifest(provider: string): ConnectionSourceManifest {
  return {
    agent_dom: {
      connections: [
        {
          id: "model_provider",
          provider,
          label: "Your model provider",
          purpose: "Summarise what this agent found",
          ownership: "dash_managed",
          capabilities: [
            { id: `${provider}.digest.curate`, label: "Summarise", access: "spend" },
          ],
          fields: [
            {
              id: "api_key",
              label: "API key",
              purpose: "So DASH can reach the provider for this agent",
              kind: "secret",
              required: true,
            },
          ],
          validation_action: { id: "test", label: "Check the key", behavior: "test" },
        },
      ],
    },
  } as unknown as ConnectionSourceManifest;
}

const CURATED_REPLY = [
  "OVERVIEW: Two threads today: model releases and one funding round.",
  "GROUP: New models",
  "SUMMARY: Two labs shipped something this week.",
  "ITEMS: 1, 3",
  "GROUP: Money",
  "SUMMARY: One round closed.",
  "ITEMS: 2",
].join("\n");

const REPLY_BODY = {
  choices: [{ message: { content: CURATED_REPLY } }],
  model: "openai/gpt-5-mini",
  usage: { prompt_tokens: 400, completion_tokens: 80, cost: 0.0004 },
};

const INPUT = {
  material: "[1] A model shipped\n\n[2] A round closed\n\n[3] Another model shipped",
  max_output_tokens: 700,
};

function curateHarness(
  provider: "openrouter" | "anthropic" | "openai" = "openrouter",
  options: { modelChoice?: string | null } = {},
): ReturnType<typeof harness> {
  return harness({
    manifest: keyManifest(provider),
    credential: { kind: "found", credential: keyCredential({ provider }) },
    respond: () => ({ status: 200, body: REPLY_BODY }),
    ...options,
  });
}

function request(id: string, input: Record<string, unknown> = INPUT) {
  return {
    request_id: id,
    connection_id: "model_provider",
    operation: "openrouter.digest.curate",
    input,
  };
}

/* ---------------------------------------------------------------------- *
 * The allowance, on its own
 * ---------------------------------------------------------------------- */

describe("a run press is what pays for a model call", () => {
  it("is closed until somebody presses, and open for a bounded number of calls", () => {
    const at = 1_000;
    expect(spendAllowed(undefined, at)).toBe(false);

    let allowance = openRunSpend(at);
    for (let call = 0; call < SPEND_ALLOWANCE_CALLS; call += 1) {
      expect(spendAllowed(allowance, at)).toBe(true);
      allowance = spendOne(allowance);
    }
    // And no further. The whole point of a per-run budget.
    expect(spendAllowed(allowance, at)).toBe(false);
  });

  it("expires on DASH's clock, not on anything an agent says", () => {
    const at = 1_000;
    const allowance = openRunSpend(at);
    expect(spendAllowed(allowance, at + SPEND_ALLOWANCE_MS - 1)).toBe(true);
    expect(spendAllowed(allowance, at + SPEND_ALLOWANCE_MS)).toBe(false);
  });

  it("is small enough to be worth reading, and pinned by value", () => {
    /*
     * Pinned for `WRITE_PATHS`' reason: this number is the ceiling on what one
     * press of a button can cost somebody, and widening it should be a diff a
     * reviewer reads rather than a constant that drifts.
     */
    expect(SPEND_ALLOWANCE_CALLS).toBe(2);
    expect(SPEND_ALLOWANCE_MS).toBe(600_000);
  });
});

/* ---------------------------------------------------------------------- *
 * The allowance, through the broker
 * ---------------------------------------------------------------------- */

describe("the broker honours an allowance and nothing else", () => {
  it("still refuses an agent that no one asked for a run from", async () => {
    const broker = curateHarness();
    const answer = (await broker.handle(AGENT, request("req-1"), "agent")) as {
      ok: boolean;
      refusal?: string;
    };
    expect(answer.ok).toBe(false);
    expect(answer.refusal).toBe("needs_a_person");
    // Before the vault, so asking costs nothing but a counter.
    expect(broker.calls).toEqual([]);
    expect(broker.audit.at(-1)?.decision).toBe("refused");
  });

  it("answers the same request once a person has pressed Run now", async () => {
    const broker = curateHarness();
    broker.allowRunSpend(AGENT);

    const answer = (await broker.handle(AGENT, request("req-2"), "agent")) as {
      ok: boolean;
      result?: Record<string, unknown>;
    };
    expect(answer.ok).toBe(true);
    expect(broker.calls).toHaveLength(1);
    expect(new URL(broker.calls[0]?.url ?? "").pathname).toBe("/api/v1/chat/completions");
    // And the path it reached is one of the three DASH declares it can spend at.
    expect(spendPaths()).toContain(new URL(broker.calls[0]?.url ?? "").pathname);
  });

  it("opens for one agent and not for its neighbour", async () => {
    const broker = curateHarness();
    broker.allowRunSpend("some-other-agent");

    const answer = (await broker.handle(AGENT, request("req-3"), "agent")) as {
      ok: boolean;
      refusal?: string;
    };
    expect(answer.ok).toBe(false);
    expect(answer.refusal).toBe("needs_a_person");
  });

  it("runs out after the allowance, and a refused call still costs one", async () => {
    const broker = curateHarness();
    broker.allowRunSpend(AGENT);

    for (let call = 0; call < SPEND_ALLOWANCE_CALLS; call += 1) {
      const answer = (await broker.handle(AGENT, request(`ok-${String(call)}`), "agent")) as {
        ok: boolean;
      };
      expect(answer.ok).toBe(true);
    }

    const spent = (await broker.handle(AGENT, request("one-too-many"), "agent")) as {
      ok: boolean;
      refusal?: string;
    };
    expect(spent.ok).toBe(false);
    expect(spent.refusal).toBe("needs_a_person");
    expect(broker.calls).toHaveLength(SPEND_ALLOWANCE_CALLS);
  });

  it("expires, so an agent that outlives its run cannot spend on the way out", async () => {
    const broker = curateHarness();
    broker.allowRunSpend(AGENT);
    broker.advance(SPEND_ALLOWANCE_MS);

    const answer = (await broker.handle(AGENT, request("late"), "agent")) as {
      ok: boolean;
      refusal?: string;
    };
    expect(answer.ok).toBe(false);
    expect(answer.refusal).toBe("needs_a_person");
    expect(broker.calls).toEqual([]);
  });

  it("cannot be stacked by pressing twice", async () => {
    const broker = curateHarness();
    broker.allowRunSpend(AGENT);
    broker.allowRunSpend(AGENT);

    /*
     * A second press replaces the first. If it topped one up, this loop would
     * get `2 * SPEND_ALLOWANCE_CALLS` answers — which is the failure mode worth
     * a test, because "press it again" is what a person does when a run looks
     * stuck.
     */
    let answered = 0;
    for (let call = 0; call < SPEND_ALLOWANCE_CALLS * 2; call += 1) {
      const answer = (await broker.handle(AGENT, request(`press-${String(call)}`), "agent")) as {
        ok: boolean;
      };
      if (answer.ok) {
        answered += 1;
      }
    }
    expect(answered).toBe(SPEND_ALLOWANCE_CALLS);
  });

  it("leaks no key through an allowed agent-origin call", async () => {
    const broker = curateHarness();
    broker.allowRunSpend(AGENT);
    const answer = await broker.handle(AGENT, request("leak-check"), "agent");

    /*
     * The threat model's search, run over the path this issue opened. The key
     * goes on the wire — that is what `aiAuthHeaders` is for — and it must
     * appear in nothing that comes back to the agent and nothing DASH writes
     * down about the call.
     */
    for (const value of [...everyString(answer), ...everyString(broker.audit)]) {
      expect(value).not.toContain(PLANTED_PROVIDER_KEY);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Whose model
 * ---------------------------------------------------------------------- */

describe("the model an agent spends under is its owner's", () => {
  it("substitutes the owner's choice for whatever the agent asked for", async () => {
    const broker = curateHarness("openrouter", { modelChoice: "meta-llama/llama-3.3-70b" });
    broker.allowRunSpend(AGENT);

    await broker.handle(
      AGENT,
      // The agent asks for something expensive. ADR 0011 decision 1 says it does
      // not get to.
      request("req-model", { ...INPUT, model: "anthropic/claude-opus-4" }),
      "agent",
    );

    const body = JSON.parse(broker.calls[0]?.body ?? "{}") as { model?: string };
    expect(body.model).toBe("meta-llama/llama-3.3-70b");
  });

  it("refuses with its own code when the owner has named no model", async () => {
    const broker = curateHarness("openrouter", { modelChoice: null });
    broker.allowRunSpend(AGENT);

    const answer = (await broker.handle(AGENT, request("req-nomodel"), "agent")) as {
      ok: boolean;
      refusal?: string;
    };
    expect(answer.ok).toBe(false);
    // Not `not_granted`, and not a model DASH picked. The next move is one
    // press on the agent's own page.
    expect(answer.refusal).toBe("no_model_chosen");
    expect(broker.calls).toEqual([]);
  });

  it("leaves a person's own question alone", async () => {
    /*
     * The substitution is scoped to an agent-origin spend. MAR-545's chat
     * resolves the model itself and passes it, and a broker that overwrote it
     * would be a second opinion about the same row — harmless while they agree
     * and a silent divergence the moment they do not.
     */
    const broker = curateHarness("openrouter", { modelChoice: "an-owner-model" });
    await broker.handle(
      AGENT,
      {
        request_id: "person-1",
        connection_id: "model_provider",
        operation: "openrouter.chat.completion",
        input: {
          model: "openai/gpt-5-mini",
          question: "What have you found?",
          material: "[1] Something happened",
          max_output_tokens: 700,
        },
      },
      "person",
    );

    const body = JSON.parse(broker.calls[0]?.body ?? "{}") as { model?: string };
    expect(body.model).toBe("openai/gpt-5-mini");
  });
});

/* ---------------------------------------------------------------------- *
 * What DASH sends
 * ---------------------------------------------------------------------- */

describe("the request DASH builds to summarise a digest", () => {
  it("carries DASH's own frame and no question member", () => {
    for (const provider of aiProviders()) {
      const planned = planCall(curate(provider.id), provider.api_origin, {
        model: "a-model",
        material: "[1] Something happened",
      });
      expect(planned.ok).toBe(true);
      if (!planned.ok || planned.call.method !== "POST") {
        throw new Error("a curate operation must plan a POST");
      }
      const sent = JSON.stringify(planned.call.json);
      // DASH's instruction, not an agent's.
      expect(sent).toContain("You group and summarise news items");
      // And the fence that labels the untrusted span as quoted material.
      expect(sent).toContain("COLLECTED ITEMS");
      // Deterministic, for `completionOperation`'s reason sharpened: a grouping
      // is a reading of a list, and creativity is another word for an invented
      // item.
      expect(planned.call.json["temperature"]).toBe(0);
      expect(planned.call.json["stream"]).toBe(false);
    }
  });

  it("refuses material DASH would not send", () => {
    const operation = curate("openrouter");
    // No material at all.
    expect(operation.compose({ model: "a-model" }).ok).toBe(false);
    // A model id that is a traversal wearing a model's clothes.
    expect(
      operation.compose({ model: "../../etc/passwd", material: "[1] x" }).ok,
    ).toBe(false);
    // More material than one request may carry.
    expect(
      operation.compose({ model: "a-model", material: "x".repeat(24_001) }).ok,
    ).toBe(false);
  });

  it("says what it does to somebody in plain language", () => {
    for (const provider of aiProviders()) {
      const operation = curate(provider.id);
      expectPlainLanguage([operation.label, operation.consequence]);
      // The load-bearing half of the sentence: it is the person's own account.
      expect(operation.consequence).toContain("your own");
    }
  });
});

/* ---------------------------------------------------------------------- *
 * What comes back, and what DASH will read out of it
 * ---------------------------------------------------------------------- */

describe("reading a model's grouping", () => {
  it("reads the format it asked for", () => {
    const read = readCuration(CURATED_REPLY);
    expect(read.overview).toBe("Two threads today: model releases and one funding round.");
    expect(read.groups).toEqual([
      { label: "New models", summary: "Two labs shipped something this week.", items: [1, 3] },
      { label: "Money", summary: "One round closed.", items: [2] },
    ]);
  });

  it("tolerates a small model's punctuation", () => {
    const read = readCuration(
      ["GROUP: Anything", "SUMMARY: Some things.", "ITEMS: 1 and 2, and 3."].join("\n"),
    );
    expect(read.groups[0]?.items).toEqual([1, 2, 3]);
  });

  it("drops a group whose title carries an address", () => {
    /*
     * The prompt forbids links and this is the enforcement, because an
     * instruction is not a boundary. A group title carrying a URL would put an
     * unchecked address on a guided surface, which is what
     * `lib/copy/identifiers.ts` exists to prevent — and the model is the one
     * party on this page nobody can hold to a rule.
     */
    const read = readCuration(
      ["GROUP: See https://example.invalid/deal", "ITEMS: 1"].join("\n"),
    );
    expect(read.groups).toEqual([]);
  });

  it("keeps a group whose sentence it had to drop", () => {
    // The grouping is the useful part. Losing the items over a line of prose
    // would be the wrong trade.
    const read = readCuration(
      ["GROUP: Models", "SUMMARY: go to www.example.invalid", "ITEMS: 1"].join("\n"),
    );
    expect(read.groups).toEqual([{ label: "Models", summary: "", items: [1] }]);
  });

  it("carries no headline a model wrote, because there is no field for one", () => {
    const read = readCuration(
      ["GROUP: Invented", "ITEMS: 1", "Also: a story nobody collected"].join("\n"),
    );
    expect(JSON.stringify(read.groups)).not.toContain("a story nobody collected");
  });

  it("drops an item number that could not be an item", () => {
    const read = readCuration(["GROUP: Anything", "ITEMS: 0, 9999, 2, 2"].join("\n"));
    // Zero is not a number this list starts at, 9999 is past the ceiling, and
    // the repeat is a repeat. What survives is the one plausible item.
    expect(read.groups[0]?.items).toEqual([2]);
  });

  it("reads a minus sign as punctuation, which is the price of tolerating punctuation", () => {
    /*
     * Stated rather than left to be discovered. Splitting on anything that is
     * not a digit is what makes `1, 4 and 7` and `1 4 7` read the same, and the
     * consequence is that `-3` reads as item 3.
     *
     * Harmless by construction rather than by luck: the number is an index into
     * a list the agent already has, so it either names an item that exists — in
     * which case grouping it is a fine outcome — or it names nothing and the
     * agent drops it. There is no reading of a stray minus sign that puts
     * something in a digest that was not already in it.
     */
    expect(readCuration(["GROUP: Anything", "ITEMS: -3"].join("\n")).groups[0]?.items).toEqual([3]);
  });

  it("returns nothing at all for a reply in no format DASH knows", () => {
    // Which the caller reports as `not_curated` with reason `unreadable`, not as
    // a curated digest with no groups in it. Two different claims.
    expect(readCuration("Sure! Here are the groups you asked for.").groups).toEqual([]);
    expect(readCuration("").groups).toEqual([]);
  });

  it("projects a real provider reply into groups, tokens and a stated cost", () => {
    const projected = curate("openrouter").project(REPLY_BODY);
    expect(projected["groups"]).toHaveLength(2);
    expect(projected["model"]).toBe("openai/gpt-5-mini");
    expect(projected["tokens_in"]).toBe(400);
    expect(projected["tokens_out"]).toBe(80);
    expect(projected["cost_usd"]).toBe(0.0004);
  });

  it("states no cost for a provider that does not price its own answers", () => {
    // Anthropic reports what was read and written and never a price. DASH
    // reports the same two numbers and no third.
    const projected = curate("anthropic").project({
      content: [{ text: CURATED_REPLY }],
      model: "claude-haiku-4-5",
      usage: { input_tokens: 400, output_tokens: 80 },
    });
    expect(projected["groups"]).toHaveLength(2);
    expect(projected["cost_usd"]).toBeNull();
  });
});
