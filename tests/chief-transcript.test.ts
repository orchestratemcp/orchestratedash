/**
 * The chief's conversation, kept (MAR-659, ADR 0023 decision 6).
 *
 * MAR-648 made the scrollback session-only on an argument this ADR accepts and
 * narrows: *"a stored answer would be a sentence that was true last Tuesday
 * sitting in a scrollback looking like a sentence about today."* That is an
 * argument against **undated re-presentation**, not against storage — so what
 * this file establishes is that the date is really there and really computed:
 *
 * - a turn keeps the briefing rows it was built from, frozen, and reading them
 *   back never recomputes them;
 * - DASH marks a turn when a fact in those rows no longer matches its own
 *   records, and leaves it unmarked when nothing has moved;
 * - a free answer and a paid one land in the same thread, distinguishable, with
 *   no invented price on the free one.
 *
 * Against a real database in a temporary directory, because the interesting
 * halves are the migration, the null-provider column and the JSON round trip —
 * none of which a fake would exercise.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-chief-"));
process.env.DASH_DATA_DIR = dataDir;

const { clearChiefThread, readChiefTurns, recentChiefContext, recordChiefTurn } = await import(
  "../lib/chief/store"
);
const { chiefRoomView } = await import("../lib/views/chief");
const { writeFleetModelDefault, clearFleetModelDefault } = await import("../lib/ai/model-store");
const { closeDb, db } = await import("../lib/db");
const { briefingFor } = await import("../lib/chief/briefing");

type AgentRowish = Parameters<typeof briefingFor>[0][number];

function row(over: Record<string, unknown> = {}): AgentRowish {
  return {
    name: "ai-agent-news",
    title: "AI News Scout",
    goal: "Collect AI agent news every morning and summarise it.",
    capabilities: ["public_feed_fetch", "digest_compose"],
    run_count: 3,
    last_run_at: "2026-08-14T09:00:00.000Z",
    glance: [
      {
        question: "all_clear",
        label: "All clear",
        meaning: "DASH has nothing waiting for you on this agent.",
        tone: "muted",
      },
    ],
    running: false,
    hosted_on: [],
    ...over,
  } as unknown as AgentRowish;
}

beforeEach(() => {
  db().exec("DELETE FROM chief_messages");
  clearFleetModelDefault();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a turn survives the page closing", () => {
  it("keeps the question, the answer and the receipt as it stood", () => {
    const receipt = briefingFor([row()]);
    const written = recordChiefTurn({
      asked_at: "2026-08-16T10:00:00.000Z",
      question: "what agents run local and what on the cloud",
      answer: "One agent runs on this computer and none on a server.",
      failure: null,
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
      tokens_in: 90,
      tokens_out: 30,
      amount_usd: 0.0001,
      receipt,
      evidence: { kind: "none" },
      origin: "window",
    });
    expect(written).not.toBeNull();

    const [read] = readChiefTurns();
    expect(read?.question).toContain("local");
    expect(read?.answer).toContain("this computer");
    expect(read?.receipt).toEqual(receipt);
    expect(read?.amount_usd).toBe(0.0001);
  });

  /*
   * ADR 0023 decisions 5 and 6, at the schema. A standing question is answered
   * from records with no model, no charge and no latency; its row has a null
   * provider, and reading it back must keep it rather than treating "no
   * provider" the way `projectExchange` treats "a provider this build dropped".
   * Those two nulls mean opposite things and collapsing them would silently
   * delete every free turn from the thread.
   */
  it("keeps a free answer beside a paid one", () => {
    const receipt = briefingFor([row()]);
    recordChiefTurn({
      asked_at: "2026-08-16T10:00:00.000Z",
      question: "what needs me",
      answer: "Here is where your fleet stands. Nothing is waiting on you.",
      failure: null,
      provider_id: null,
      model_id: null,
      tokens_in: null,
      tokens_out: null,
      amount_usd: null,
      receipt,
      evidence: { kind: "none" },
      origin: "window",
    });
    recordChiefTurn({
      asked_at: "2026-08-16T10:01:00.000Z",
      question: "hi",
      answer: "Hello. Ask me anything about your fleet.",
      failure: null,
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
      tokens_in: 12,
      tokens_out: 8,
      amount_usd: null,
      // ADR 0023 decision 7: a greeting reads no records, and its receipt says
      // so rather than being absent.
      receipt: [],
      evidence: { kind: "none" },
      origin: "window",
    });

    const turns = readChiefTurns();
    expect(turns).toHaveLength(2);
    // Oldest first, so the thread reads downwards.
    expect(turns[0]?.question).toBe("what needs me");
    expect(turns[0]?.provider_id).toBeNull();
    expect(turns[1]?.receipt).toEqual([]);
  });

  it("forgets everything when the person clears it", () => {
    recordChiefTurn({
      asked_at: "2026-08-16T10:00:00.000Z",
      question: "hi",
      answer: "Hello.",
      failure: null,
      provider_id: null,
      model_id: null,
      tokens_in: null,
      tokens_out: null,
      amount_usd: null,
      receipt: [],
      evidence: { kind: "none" },
      origin: "window",
    });
    clearChiefThread();
    expect(readChiefTurns()).toEqual([]);
    // Deleted rather than hidden. A "clear" that kept a copy of a conversation
    // somebody asked DASH to forget would not be one.
    const left = db().prepare("SELECT COUNT(*) AS n FROM chief_messages").get() as { n: number };
    expect(Number(left.n)).toBe(0);
  });
});

/* ---------------------------------------------------------------------- *
 * What the model is told about the past
 * ---------------------------------------------------------------------- */

describe("the context sent with a fresh question", () => {
  /*
   * ADR 0023 decision 6: *"the last few turns of this thread as text, and never
   * an old receipt."* Feeding a stale briefing into a fresh answer is precisely
   * how a sentence about last Tuesday gets written in the present tense.
   */
  it("carries what was said and never the facts behind it", () => {
    const receipt = briefingFor([row({ title: "The Scout Nobody Should Repeat" })]);
    recordChiefTurn({
      asked_at: "2026-08-16T10:00:00.000Z",
      question: "how many agents do I have",
      answer: "You have one.",
      failure: null,
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
      tokens_in: 10,
      tokens_out: 4,
      amount_usd: null,
      receipt,
      evidence: { kind: "none" },
      origin: "window",
    });

    const context = recentChiefContext();
    expect(context).toContain("how many agents do I have");
    expect(context).toContain("You have one.");
    // The frozen facts stay frozen and out of the next request.
    expect(context).not.toContain("The Scout Nobody Should Repeat");
    expect(context).not.toContain("Runs on:");
  });

  it("skips a turn that produced no answer", () => {
    recordChiefTurn({
      asked_at: "2026-08-16T10:00:00.000Z",
      question: "what is going on",
      answer: null,
      failure: "provider_unavailable",
      provider_id: "openrouter",
      model_id: null,
      tokens_in: null,
      tokens_out: null,
      amount_usd: null,
      receipt: [],
      evidence: { kind: "none" },
      origin: "window",
    });
    expect(recentChiefContext()).toBe("");
  });
});

/* ---------------------------------------------------------------------- *
 * The staleness marker, end to end
 * ---------------------------------------------------------------------- */

describe("the room a returning reader sees", () => {
  function storeOne(receipt: ReturnType<typeof briefingFor>): void {
    recordChiefTurn({
      asked_at: "2026-08-16T10:00:00.000Z",
      question: "what agents run local and what on the cloud",
      answer: "One agent runs on this computer.",
      failure: null,
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
      tokens_in: 90,
      tokens_out: 30,
      amount_usd: 0.0001,
      receipt,
      evidence: { kind: "none" },
      origin: "window",
    });
  }

  it("leaves a turn unmarked while its facts still hold", () => {
    storeOne(briefingFor([row()]));
    const view = chiefRoomView([row()]);
    expect(view.turns[0]?.stale).toBe(false);
    expect(view.turns[0]?.receipt).toHaveLength(1);
    expect(view.turns[0]?.from_records).toBe(false);
    expect(view.turns[0]?.charge).not.toBeNull();
  });

  /*
   * The whole of MAR-648's objection, answered. The turn is drawn with the facts
   * it was written from and DASH says the fleet has moved since — which is a
   * fact DASH observed by comparing two of its own records, so it is inside the
   * facts-only rule.
   */
  it("marks a turn whose fleet has moved, and still shows the old facts", () => {
    storeOne(briefingFor([row()]));
    const view = chiefRoomView([
      row({ hosted_on: [{ host_id: "h", label: "My VPS", sent_on: "16 August 2026" }] }),
    ]);
    expect(view.turns[0]?.stale).toBe(true);
    // Frozen, not recomputed: the receipt still says what the answer was built
    // on rather than what is true now.
    expect(view.turns[0]?.receipt[0]?.place).toBe("Local");
  });

  /*
   * ADR 0023 decision 4. No fleet default is the shipped state, and the room has
   * to say so without disabling itself — the standing question is answered from
   * records whatever this says.
   */
  it("says it has no model until a fleet default is set", () => {
    expect(chiefRoomView([row()]).can_ask).toBe(false);
    expect(chiefRoomView([row()]).blocked?.meaning).toContain("AI tab");

    writeFleetModelDefault("openrouter", "openai/gpt-5-mini", "2026-08-16T10:00:00.000Z");
    const ready = chiefRoomView([row()]);
    expect(ready.can_ask).toBe(true);
    expect(ready.model_id).toBe("openai/gpt-5-mini");
    expect(ready.blocked).toBeNull();
  });

  /*
   * A free turn carries no price and no invented zero. `describeCharge` is not
   * called for one, because there is no provider whose number it could be
   * quoting — and a zero here would be DASH making its own claim about money,
   * which is the one thing no surface in this product does.
   */
  it("puts no number on an answer nobody was charged for", () => {
    recordChiefTurn({
      asked_at: "2026-08-16T10:00:00.000Z",
      question: "what needs me",
      answer: "Nothing is waiting on you.",
      failure: null,
      provider_id: null,
      model_id: null,
      tokens_in: null,
      tokens_out: null,
      amount_usd: null,
      receipt: briefingFor([row()]),
      evidence: { kind: "none" },
      origin: "window",
    });
    const turn = chiefRoomView([row()]).turns[0];
    expect(turn?.from_records).toBe(true);
    expect(turn?.charge).toBeNull();
    expect(turn?.model).toBeNull();
  });

  /*
   * MAR-648's hand-off, kept (decision 8). The chief never answers *from* an
   * agent's saved material, so a question about what one found is named and
   * linked — and the link is DASH's, recomputed over the fleet as it is now
   * rather than read out of the model's sentence.
   */
  it("names the agent a question really belongs to, from DASH's own routing", () => {
    recordChiefTurn({
      asked_at: "2026-08-16T10:00:00.000Z",
      question: "what is the latest ai agent news",
      answer: "Your scout is the one set up for that.",
      failure: null,
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
      tokens_in: 20,
      tokens_out: 10,
      amount_usd: null,
      receipt: briefingFor([row()]),
      evidence: { kind: "none" },
      origin: "window",
    });
    const turn = chiefRoomView([row()]).turns[0];
    expect(turn?.handoffs.map((one) => one.agent)).toEqual(["ai-agent-news"]);
    expect(turn?.matched.length).toBeGreaterThan(0);
  });

  /*
   * MAR-690. The reported case exactly: three agents share a `local_*`
   * capability word by coincidence, the model already answered the fleet-wide
   * question in full, and DASH's own recompute must not append a "which did
   * you mean?" to an answer that was never ambiguous in the first place.
   */
  it("does not offer to disambiguate a fleet-wide question the model already answered", () => {
    const fleet = [
      row({ name: "ai-news-scout", title: "Ai news scout", capabilities: ["local_file_write"] }),
      row({ name: "invoice-filer", title: "Invoice filer", capabilities: ["local_file_read"] }),
      row({ name: "receipt-sorter", title: "Receipt sorter", capabilities: ["local_file_move"] }),
    ];
    recordChiefTurn({
      asked_at: "2026-08-17T10:00:00.000Z",
      question: "what agents run local and what runs in the cloud",
      answer: "All three run locally, none in the cloud.",
      failure: null,
      provider_id: "openrouter",
      model_id: "anthropic/claude-sonnet-5",
      tokens_in: 799,
      tokens_out: 72,
      amount_usd: 0.0023,
      receipt: briefingFor(fleet),
      evidence: { kind: "none" },
      origin: "window",
    });
    const turn = chiefRoomView(fleet).turns[0];
    expect(turn?.handoffs).toEqual([]);
    expect(turn?.matched).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * The evidence column (MAR-744)
 * ---------------------------------------------------------------------- */

describe("what a tool read or fetched survives with the turn", () => {
  const CITED = {
    kind: "outputs" as const,
    basis: "newest" as const,
    terms: [],
    available: 2,
    citations: [
      {
        index: 1,
        agent: "ai-agent-news",
        agent_title: "AI agent news",
        from: "digest" as const,
        headline: "Tariffs reshape the chip supply chain",
        source_name: "Google News",
        item_url: "https://collected.example/story",
        report_title: "AI agents roundup",
        run_id: "run-2",
        artifact_id: "artifact-digest",
      },
    ],
  };

  const FETCHED = {
    kind: "sources" as const,
    topic: "tariffs",
    sources: [
      {
        id: "google-news",
        name: "Google News",
        address: "https://news.google.com/rss/search?q=tariffs",
        status: "ok" as const,
        item_count: 1,
      },
      { id: "arxiv", name: "arXiv", address: null, status: "unreachable" as const, item_count: 0 },
    ],
    citations: [
      {
        index: 1,
        source_name: "Google News",
        headline: "Fresh tariff ruling lands",
        item_url: "https://news.google.example/fresh",
        published_at: "2026-08-24T08:00:00.000Z",
      },
    ],
  };

  function write(evidence: Parameters<typeof recordChiefTurn>[0]["evidence"]): void {
    recordChiefTurn({
      asked_at: "2026-08-24T10:00:00.000Z",
      question: "pull out the most current news",
      answer: "Your scout found one thing worth reading.",
      failure: null,
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
      tokens_in: 90,
      tokens_out: 30,
      amount_usd: 0.0001,
      receipt: [],
      evidence,
      origin: "window",
    });
  }

  /*
   * The migration and the JSON round trip, which is what this file is against a
   * real database for. A column added by `addColumn` on an existing store is
   * the case a fake would never exercise.
   */
  it("round-trips a citation through the column", () => {
    write(CITED);
    expect(readChiefTurns()[0]?.evidence).toEqual(CITED);
  });

  it("round-trips a fetch, including the source that did not answer", () => {
    write(FETCHED);
    const back = readChiefTurns()[0]?.evidence;
    expect(back).toEqual(FETCHED);
    if (back?.kind === "sources") {
      expect(back.sources[1]?.status).toBe("unreachable");
      expect(back.sources[1]?.address).toBeNull();
    }
  });

  /*
   * One representation of nothing. A turn with no tool writes NULL, which is
   * what every row already in somebody's store says, so a reader cannot tell a
   * pre-MAR-744 row from a tool-less one -- and does not need to.
   */
  it("writes no evidence at all for a turn where no tool ran", () => {
    write({ kind: "none" });
    const stored = db()
      .prepare("SELECT evidence_json FROM chief_messages ORDER BY id DESC LIMIT 1")
      .get() as { evidence_json: string | null };
    expect(stored.evidence_json).toBeNull();
    expect(readChiefTurns()[0]?.evidence).toEqual({ kind: "none" });
  });

  /*
   * The weaker claim, `projectExchange`'s rule. Unreadable JSON, and a `kind`
   * this build does not know, both mean *nothing to show* rather than taking
   * the room down -- which is `readStore`'s whole design.
   */
  it("reads an unreadable or unknown evidence column as nothing to show", () => {
    write(CITED);
    for (const stored of ['{"kind":"outputs"', "null", '{"kind":"telepathy","citations":[]}', "[]"]) {
      db().prepare("UPDATE chief_messages SET evidence_json = ?").run(stored);
      expect(readChiefTurns()[0]?.evidence).toEqual({ kind: "none" });
    }
  });

  /*
   * The receipt and the evidence are different claims, and only one of them can
   * go stale. A news answer must not report *your fleet changed* the next time
   * somebody imports an agent.
   */
  it("does not mark a tool turn stale when the fleet moves", () => {
    write(CITED);
    const view = chiefRoomView([row({ name: "someone-new", title: "Someone new" })]);
    expect(view.turns[0]?.stale).toBe(false);
    expect(view.turns[0]?.evidence?.kind).toBe("outputs");
    expect(view.turns[0]?.evidence?.citations[0]?.href).toBe("https://collected.example/story");
  });
});
