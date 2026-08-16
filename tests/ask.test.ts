/**
 * Asking an agent about what it found (MAR-545).
 *
 * Five things, in the order somebody meets them:
 *
 * 1. **Which saved reports a question selects**, and that a question about a
 *    subject the agent has never covered says so rather than answering from
 *    whatever was newest and pretending it matched.
 * 2. **What those reports become**, including the one field deliberately left
 *    out of the material.
 * 3. **What DASH will say about the bill**, which is the part MAR-583 left
 *    unbuilt on purpose: every figure with a currency symbol comes from a
 *    provider, and DASH's own arithmetic produces none.
 * 4. **That the surface never dies quietly** — four reasons a question cannot be
 *    asked, each with a next action.
 * 5. **The scrollback**, over a real store, including what a question costs
 *    across many of them.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  ASK_MAX_OUTPUT_TOKENS,
  MAX_ITEMS_PER_QUESTION,
  MAX_MATERIAL_BUDGET,
  askFailureFor,
  citations,
  isSelectionBasis,
  questionTerms,
  readAnswer,
  readCharge,
  renderMaterial,
  savedItems,
  selectMaterial,
  type AskFailureReasonName,
} from "../lib/ai/ask";
import {
  describeAmount,
  describeAskFailure,
  describeChatSubject,
  describeCharge,
  describeEstimate,
  describeReportedRunSpend,
  describeSelection,
  describeUnavailable,
  type AskFailureReason,
} from "../lib/copy/ask";
import type { DigestArtifact } from "../lib/contracts";
import { expectPlainLanguage } from "./helpers/plain-language";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-ask-"));
process.env.DASH_DATA_DIR = dataDir;

const { closeDb } = await import("../lib/db");
const { forgetAgentQuestions, readExchanges, readSpendSummary, recordExchange } = await import(
  "../lib/ai/ask-store"
);

const AGENT = "ai-agent-news";

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------------- */

function digest(runId: string, at: string, items: Array<[string, string?, string?]>): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: AGENT,
    run_id: runId,
    artifact_id: `digest-${runId}`,
    title: `Morning briefing ${runId}`,
    generated_at: at,
    items: items.map(([headline, summary, source]) => ({
      headline,
      summary,
      source_name: source,
      item_url: `https://example.test/${encodeURIComponent(headline)}`,
    })),
  };
}

/** Newest report first, which is the order the store returns them in. */
const SAVED = savedItems([
  {
    run_id: "run-3",
    artifact: digest("run-3", "2026-08-10T06:00:00.000Z", [
      ["Chip makers brace for new tariffs", "The rate rises in September.", "Example Wire"],
      ["A quiet week for model releases", undefined, "Example Daily"],
    ]),
  },
  {
    run_id: "run-2",
    artifact: digest("run-2", "2026-08-09T06:00:00.000Z", [
      ["Regulator opens an inquiry", "Into pricing.", "Example Daily"],
    ]),
  },
  {
    run_id: "run-1",
    artifact: digest("run-1", "2026-08-08T06:00:00.000Z", [
      ["Tariffs on steel confirmed", "Effective immediately.", "Example Wire"],
    ]),
  },
]);

/* ---------------------------------------------------------------------- *
 * Selection
 * ---------------------------------------------------------------------- */

describe("choosing what a question is answered from", () => {
  it("searches on the words that distinguish, not on the words that ask", () => {
    // "what did you find about tariffs" selects on `tariffs` alone. Every other
    // word in it appears in every digest ever written, and matching on them
    // would match everything with equal force.
    expect(questionTerms("What did you find about tariffs?")).toEqual(["tariffs"]);
    expect(questionTerms("what is the latest news?")).toEqual([]);
    expect(questionTerms("EU AI Act")).toEqual(["act"]);
  });

  it("picks the saved things that mention it, best first", () => {
    const selection = selectMaterial(SAVED, "What have you found about tariffs?");
    expect(selection.basis).toBe("matched");
    expect(selection.terms).toEqual(["tariffs"]);
    expect(selection.chosen.map((one) => one.item.headline)).toEqual([
      "Chip makers brace for new tariffs",
      "Tariffs on steel confirmed",
    ]);
    expect(selection.available).toBe(4);
  });

  it("says so when nothing matches, rather than answering from the newest and calling it a match", () => {
    const selection = selectMaterial(SAVED, "What did you find about shipping containers?");
    expect(selection.basis).toBe("newest");
    // Still answers — an agent's newest reports are a real answer to "what have
    // you got" — but the sentence above the answer admits the subject is absent.
    expect(selection.chosen).toHaveLength(4);
    expect(describeSelection(selection.basis, selection.terms, selection.chosen.length)).toContain(
      "Nothing saved mentions",
    );
  });

  it("treats a question with no distinctive word as a request for the newest", () => {
    const selection = selectMaterial(SAVED, "What is the latest?");
    expect(selection.basis).toBe("newest");
    expect(selection.terms).toEqual([]);
    expect(describeSelection(selection.basis, selection.terms, 4)).toContain(
      "Nothing in particular was asked about",
    );
  });

  it("has nothing to answer from when the agent has saved nothing", () => {
    const selection = selectMaterial([], "Anything about tariffs?");
    expect(selection.basis).toBe("nothing_saved");
    expect(renderMaterial(selection)).toBe("");
  });

  it("stops at the count, and stops at the size, rather than reordering by length", () => {
    const many = savedItems([
      {
        run_id: "run-x",
        artifact: digest(
          "run-x",
          "2026-08-10T06:00:00.000Z",
          Array.from({ length: 40 }, (_, index) => [
            `Tariffs update ${String(index)}`,
            "x".repeat(1_000),
            "Example Wire",
          ] as [string, string?, string?]),
        ),
      },
    ]);
    const selection = selectMaterial(many, "tariffs");
    expect(selection.chosen.length).toBeLessThanOrEqual(MAX_ITEMS_PER_QUESTION);
    expect(renderMaterial(selection).length).toBeLessThanOrEqual(MAX_MATERIAL_BUDGET);
    // The first N in order, never "whichever ones were short enough".
    expect(selection.chosen[0]?.item.headline).toBe("Tariffs update 0");
  });
});

/* ---------------------------------------------------------------------- *
 * The material, and the field it leaves out
 * ---------------------------------------------------------------------- */

describe("what the model is given", () => {
  it("numbers each saved thing and labels its parts", () => {
    const material = renderMaterial(selectMaterial(SAVED, "tariffs"));
    expect(material).toContain("[1] Chip makers brace for new tariffs");
    expect(material).toContain("Source: Example Wire");
    expect(material).toContain("The rate rises in September.");
  });

  it("sends no link, and keeps every link in DASH's own record beside the answer", () => {
    // A URL in the material is a URL a model can repeat into an answer, and an
    // answer carrying a link out of a feed is a link somebody might click — which
    // turns "the answer drives nothing" into something a reader has to enforce.
    const selection = selectMaterial(SAVED, "tariffs");
    expect(renderMaterial(selection)).not.toContain("https://");
    const cited = citations(selection);
    expect(cited).toHaveLength(2);
    expect(cited[0]?.index).toBe(1);
    expect(cited[0]?.item_url).toContain("https://example.test/");
    expect(cited[0]?.headline).toBe("Chip makers brace for new tariffs");
  });

  it("keeps the answer's ceiling in DASH's hands", () => {
    expect(ASK_MAX_OUTPUT_TOKENS).toBeGreaterThan(0);
    expect(MAX_MATERIAL_BUDGET).toBeLessThan(24_000);
  });
});

/* ---------------------------------------------------------------------- *
 * What came back
 * ---------------------------------------------------------------------- */

describe("reading an answer", () => {
  it("keeps the text, the model and whatever the provider said it cost", () => {
    const answer = readAnswer(
      {
        answer: "  Two of the saved reports mention tariffs.  ",
        model: "openai/gpt-5-mini",
        tokens_in: 1200,
        tokens_out: 90,
        cost_usd: 0.0031,
      },
      true,
    );
    expect(answer?.text).toBe("Two of the saved reports mention tariffs.");
    expect(answer?.model).toBe("openai/gpt-5-mini");
    expect(answer?.charge).toEqual({
      amount_usd: 0.0031,
      tokens_in: 1200,
      tokens_out: 90,
      provider_states_cost: true,
    });
  });

  it("is null for a reply with no text, and the charge survives it", () => {
    // A provider that billed for an empty answer billed for it, and a record
    // saying the question failed with no cost beside it would be false about
    // somebody's money.
    expect(readAnswer({ answer: "   ", cost_usd: 0.0009 }, true)).toBeNull();
    expect(readCharge({ answer: "   ", cost_usd: 0.0009 }, true).amount_usd).toBe(0.0009);
  });

  it("invents no number when the provider stated none", () => {
    const answer = readAnswer({ answer: "x", tokens_in: 10, tokens_out: 2 }, false);
    expect(answer?.charge.amount_usd).toBeNull();
    expect(answer?.charge.provider_states_cost).toBe(false);
  });

  it("names a person's next step for every refusal the broker can produce", () => {
    // The one that must not read as a permission problem: a refused key needs a
    // new key, and "nothing was charged" has to be in the sentence.
    expect(askFailureFor("revoked")).toBe("key_refused");
    expect(askFailureFor("rate_limited")).toBe("too_many");
    expect(askFailureFor("duplicate_request")).toBe("too_many");
    // Anything DASH has no reading for is the only reason whose sentence claims
    // nothing about whether a provider was reached.
    expect(askFailureFor("needs_a_person")).toBe("dash_error");
    expect(askFailureFor("something-new")).toBe("dash_error");

    const reasons: AskFailureReason[] = [
      "not_connected",
      "answer_lost",
      "key_refused",
      "too_many",
      "provider_unavailable",
      "provider_refused",
      "empty_answer",
      "dash_error",
    ];
    for (const reason of reasons) {
      const recovery = describeAskFailure(reason, { service: "OpenRouter" });
      expect(recovery.next_action.length).toBeGreaterThan(0);
      expectPlainLanguage([recovery.headline, recovery.meaning, recovery.next_action]);
    }
    // The two names are restated across a module boundary to avoid a cycle. One
    // line of compile-time check, which is `AiKeyActionResult`'s mechanism.
    const pinned: AskFailureReason = "dash_error" as AskFailureReasonName;
    expect(pinned).toBe("dash_error");
  });

  it("tells somebody they were charged when DASH lost the answer", () => {
    // The one outcome where a person is out of pocket with nothing to show for
    // it. "It did not work" would be false about the charge, and the amount is
    // gone with the row, so the sentence cannot name one.
    const recovery = describeAskFailure("answer_lost", { service: "OpenRouter" });
    expect(recovery.meaning).toContain("You were charged");
    expect(recovery.headline).toContain("could not keep the answer");
  });

  it("never says the newest nothing went with a question", () => {
    // A packaged screenshot caught this: a question that failed before anything
    // was selected rendered "the newest 0 saved things went instead". The count
    // gets its own sentence rather than a grammar rule nobody would reach for.
    for (const basis of ["matched", "newest", "nothing_saved"] as const) {
      expect(describeSelection(basis, ["shipping"], 0)).toBe(
        "Nothing saved went with this question.",
      );
    }
  });

  it("recognises the three selection bases and no others", () => {
    expect(["matched", "newest", "nothing_saved"].every(isSelectionBasis)).toBe(true);
    expect(isSelectionBasis("everything")).toBe(false);
    expect(isSelectionBasis(undefined)).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * Money
 * ---------------------------------------------------------------------- */

describe("what DASH says about money", () => {
  it("writes a fraction of a cent as a fraction of a cent", () => {
    // Two decimal places would render a real charge as `$0.00`, which reads as
    // free — the one wrong answer available about a number like this.
    expect(describeAmount(0.0031)).toBe("$0.0031");
    expect(describeAmount(0.003)).toBe("$0.0030");
    expect(describeAmount(1.5)).toBe("$1.50");
    expect(describeAmount(0.00001)).toBe("less than $0.0001");
    expect(describeAmount(0)).toBe("nothing");
    expect(describeAmount(Number.NaN)).toBe("an amount DASH could not read");
  });

  it("quotes the provider when it priced the answer, and names it", () => {
    expect(
      describeCharge(
        { amount_usd: 0.0031, tokens_in: 1200, tokens_out: 90, provider_states_cost: true },
        "OpenRouter",
      ),
    ).toBe("OpenRouter charged $0.0031 for this answer: 1,200 pieces of text went, 90 pieces of text came back.");
  });

  it("shows no amount at all for a provider that states none", () => {
    const said = describeCharge(
      { amount_usd: null, tokens_in: 1200, tokens_out: 90, provider_states_cost: false },
      "OpenAI",
    );
    expect(said).not.toMatch(/[$€£]/);
    expect(said).toContain("does not tell DASH what that cost");
  });

  it("reports a missing figure as missing rather than as free", () => {
    const said = describeCharge(
      { amount_usd: null, tokens_in: 10, tokens_out: 2, provider_states_cost: true },
      "OpenRouter",
    );
    expect(said).not.toMatch(/[$€£]/);
    expect(said).toContain("did not say this time");
  });

  it("predicts nothing before a first question, and quotes the past after one", () => {
    const first = describeEstimate({
      items: 12,
      available: 40,
      provider_states_cost: true,
      provider_label: "OpenRouter",
      past_questions: 0,
      past_total_usd: null,
      past_typical_usd: null,
    });
    // No invented figure. DASH holds nobody's prices, so there is none to show.
    expect(`${first.headline} ${first.detail}`).not.toMatch(/[$€£]/);
    expect(first.headline).toContain("Up to 12 saved things of the 40");

    const later = describeEstimate({
      items: 12,
      available: 40,
      provider_states_cost: true,
      provider_label: "OpenRouter",
      past_questions: 5,
      past_total_usd: 0.0182,
      past_typical_usd: 0.0031,
    });
    expect(later.detail).toContain("usually cost $0.0031");
    // Past the cent, two places. A typical question is worth four decimals and a
    // running total is not: `$0.02 in all` is what somebody checking a bill
    // reads, and `$0.0182` would be precision about a number they will never
    // reconcile to that many places.
    expect(later.detail).toContain("$0.02 in all");
  });

  it("attributes the agent's own figure to the agent", () => {
    // Telemetry v1's `cost_usd`, read at last. The sentence's second half is the
    // whole reason it may be read: it says whose number this is.
    const said = describeReportedRunSpend(0.3142, 12, "ai-agent-news");
    expect(said).toContain("$0.31");
    expect(said).toContain("across 12 runs");
    expect(said).toContain("not something DASH watched");
    // Silence when the runs say nothing, rather than a zero claiming they were
    // free.
    expect(describeReportedRunSpend(null, 0, "ai-agent-news")).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * Nothing to ask with
 * ---------------------------------------------------------------------- */

describe("when a question cannot be asked", () => {
  it("gives every reason a sentence and exactly one next step", () => {
    for (const reason of ["no_provider", "no_key", "no_model_chosen", "nothing_saved"] as const) {
      const recovery = describeUnavailable(reason, { agent: "ai-agent-news", service: "OpenRouter" });
      expect(recovery.next_action.length).toBeGreaterThan(0);
      expectPlainLanguage([recovery.headline, recovery.meaning, recovery.next_action]);
    }
  });

  it("tells somebody a small model will do, on the one refusal that asks them to choose", () => {
    // MAR-583's own argument, handed to the person at the moment they need it:
    // answering from saved reports is summarising, which is the cheapest kind of
    // step, so the smallest thing their key reaches is enough.
    const recovery = describeUnavailable("no_model_chosen", {
      agent: "ai-agent-news",
      service: "OpenRouter",
    });
    expect(recovery.meaning).toContain("cheapest kind of work");
    expect(recovery.next_action).toContain("Pick a model");
  });
});

/* ---------------------------------------------------------------------- *
 * The scrollback
 * ---------------------------------------------------------------------- */

describe("the conversation, over a real store", () => {
  beforeEach(() => {
    forgetAgentQuestions(AGENT);
  });

  function ask(over: Partial<Parameters<typeof recordExchange>[0]> = {}): void {
    recordExchange({
      agent: AGENT,
      asked_at: "2026-08-10T09:00:00.000Z",
      question: "What have you found about tariffs?",
      answer: "Two of the saved reports mention tariffs.",
      failure: null,
      basis: "matched",
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
      tokens_in: 1200,
      tokens_out: 90,
      amount_usd: 0.003,
      citations: citations(selectMaterial(SAVED, "tariffs")),
      ...over,
    });
  }

  it("round-trips a question, its answer and what it was built from", () => {
    ask();
    const [exchange] = readExchanges(AGENT);
    expect(exchange?.question).toBe("What have you found about tariffs?");
    expect(exchange?.answer).toContain("mention tariffs");
    expect(exchange?.basis).toBe("matched");
    expect(exchange?.citations).toHaveLength(2);
    expect(exchange?.citations[0]?.headline).toBe("Chip makers brace for new tariffs");
  });

  it("reads oldest first, so a conversation reads downwards", () => {
    ask({ question: "first" });
    ask({ question: "second" });
    expect(readExchanges(AGENT).map((one) => one.question)).toEqual(["first", "second"]);
  });

  it("keeps a failed question, because the person asked it", () => {
    ask({ answer: null, failure: "provider_refused", amount_usd: null, tokens_in: null });
    const [exchange] = readExchanges(AGENT);
    expect(exchange?.answer).toBeNull();
    expect(exchange?.failure).toBe("provider_refused");
  });

  it("totals only the amounts a provider stated, and takes the middle rather than the mean", () => {
    ask({ amount_usd: 0.001 });
    ask({ amount_usd: 0.003 });
    ask({ amount_usd: 0.2 });
    // A provider that priced nothing contributes to the count and not to the
    // total, which is why `priced` is carried separately.
    ask({ amount_usd: null });

    const summary = readSpendSummary(AGENT);
    expect(summary.questions).toBe(4);
    expect(summary.priced).toBe(3);
    expect(summary.total_usd).toBeCloseTo(0.204, 6);
    // 0.003, not 0.068: one expensive question must not make "a question here
    // usually costs" false in the common case.
    expect(summary.typical_usd).toBe(0.003);
  });

  it("says nothing about money for an agent whose provider prices nothing", () => {
    ask({ amount_usd: null });
    ask({ amount_usd: null });
    const summary = readSpendSummary(AGENT);
    expect(summary.questions).toBe(2);
    expect(summary.total_usd).toBeNull();
    expect(summary.typical_usd).toBeNull();
  });

  it("forgets a person's questions when the agent goes", () => {
    ask();
    forgetAgentQuestions(AGENT);
    expect(readExchanges(AGENT)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * The composer's own visible name (MAR-659)
 * ---------------------------------------------------------------------- */

describe("the composer's subject", () => {
  it("names the agent, in plain language", () => {
    const subject = describeChatSubject("AI agent news");
    expect(subject).toBe("Message AI agent news");
    expectPlainLanguage([subject]);
  });

  it("falls back to a generic label rather than rendering nothing", () => {
    expect(describeChatSubject(null)).toBe("Message this agent");
  });
});
