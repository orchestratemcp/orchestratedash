/**
 * The chief's conversation, written down (MAR-659, ADR 0023 decision 6).
 *
 * `lib/ai/ask-store.ts` for the other room, and deliberately its shape: it
 * stores what the pure modules decided and reads it back for whoever is drawing
 * the page. No policy here. A function in this file that decided what a stale
 * receipt *meant* would be a second authority beside `fleetChangedSince`, free
 * to drift from it.
 *
 * ## Why this is a second table and not a column on the first
 *
 * ADR 0023 decision 8. The fleet page talks to the chief about every agent; an
 * agent's page talks to that agent about its own saved material. Semantically
 * **and** structurally: `{ kind: "chief" }` carries no agent id, so there is no
 * value a chief question could be aimed at an agent with, and no agent question
 * that can carry the fleet briefing. Two transcripts, two tables, no shared
 * thread — and `agent_questions.agent` is `NOT NULL`, so folding this in would
 * have meant inventing a name for the fleet and then teaching every reader of
 * that table to skip rows carrying it.
 *
 * ## The frozen receipt
 *
 * `receipt_json` is the briefing as it stood, and it is never recomputed on
 * read. That is the whole of what makes a stored answer honest: the turn renders
 * with the facts it was actually built from, and `fleetChangedSince` compares
 * them against DASH's records now. Recomputing would quietly rewrite history
 * into the present tense, which is the failure MAR-648 made the scrollback
 * session-only to avoid.
 */

import { isModelId } from "../broker/operations";
import { db } from "../db";
import { aiProviderById } from "../ai/providers";
import type { ChiefBriefingRow } from "./briefing";

/* ---------------------------------------------------------------------- *
 * One turn
 * ---------------------------------------------------------------------- */

/**
 * One question to the chief and whatever became of it.
 *
 * A single row for both outcomes, `AskExchange`'s reason: a question that failed
 * is still a thing the person asked and still belongs in the scrollback where
 * they can see it did not work — and, when the provider charged for a reply with
 * no text in it, it is the row the charge hangs off.
 */
export interface ChiefTurnRecord {
  id: number;
  asked_at: string;
  question: string;
  /** Null exactly when `failure` is set. */
  answer: string | null;
  /** One of `AskFailureReason`, or null when there is an answer. */
  failure: string | null;
  /**
   * Which provider answered, or null when none was asked.
   *
   * Null is the free arm: a standing question answered from DASH's own records,
   * with no model, no charge and no latency. See the column's own note in
   * `lib/db.ts`, and `lib/chief/records-answer.ts` for what decides it.
   */
  provider_id: string | null;
  model_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  /** The provider's own figure. Null when it stated none. */
  amount_usd: number | null;
  /** The briefing rows sent with this question, frozen. Empty for a greeting. */
  receipt: ChiefBriefingRow[];
}

export type ChiefTurnDraft = Omit<ChiefTurnRecord, "id">;

/**
 * How much of the chief's scrollback one page draws.
 *
 * `ASK_HISTORY_LIMIT`'s rule and its number: a read limit rather than a
 * retention rule. Nothing is deleted by this — clearing the thread is a thing
 * the person does, from a control in the room — and what is bounded is only how
 * much the fleet page pulls on each poll.
 */
export const CHIEF_HISTORY_LIMIT = 20;

/**
 * Write one turn, and hand back the row it became.
 *
 * Null when the write failed, which the caller reports as DASH's own fault
 * rather than as a failed question — `recordExchange`'s asymmetry exactly: the
 * question may well have been answered and charged for, and a sentence saying it
 * failed would be false about somebody's money.
 */
export function recordChiefTurn(draft: ChiefTurnDraft): ChiefTurnRecord | null {
  try {
    const result = db()
      .prepare(
        "INSERT INTO chief_messages " +
          "(asked_at, question, answer, failure, provider_id, model_id, " +
          "tokens_in, tokens_out, amount_usd, receipt_json) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        draft.asked_at,
        draft.question,
        draft.answer,
        draft.failure,
        draft.provider_id,
        draft.model_id,
        draft.tokens_in,
        draft.tokens_out,
        draft.amount_usd,
        JSON.stringify(draft.receipt),
      );
    return { ...draft, id: Number(result.lastInsertRowid) };
  } catch (error: unknown) {
    console.warn(`[dash] could not record a chief turn: ${message(error)}`);
    return null;
  }
}

/**
 * The recent turns, oldest first.
 *
 * Selected newest-first so the limit takes the *latest* twenty, then reversed so
 * the caller draws a conversation that reads downwards — `readExchanges`' own
 * arrangement, and for its reason: which twenty and in what order are two
 * decisions that belong in one place.
 */
export function readChiefTurns(limit = CHIEF_HISTORY_LIMIT): ChiefTurnRecord[] {
  let rows: unknown[];
  try {
    rows = db()
      .prepare(
        "SELECT id, asked_at, question, answer, failure, provider_id, model_id, " +
          "tokens_in, tokens_out, amount_usd, receipt_json FROM chief_messages " +
          "ORDER BY id DESC LIMIT ?",
      )
      .all(limit) as unknown[];
  } catch (error: unknown) {
    console.warn(`[dash] could not read the chief's conversation: ${message(error)}`);
    return [];
  }

  const turns: ChiefTurnRecord[] = [];
  for (const row of rows) {
    const turn = projectTurn(row);
    if (turn !== null) {
      turns.push(turn);
    }
  }
  return turns.reverse();
}

/**
 * The last few turns as plain text, oldest first, for the model (ADR 0023
 * decision 6).
 *
 * **The question and the answer, and never an old receipt.** Feeding a stale
 * briefing into a fresh answer is precisely how a sentence about last Tuesday
 * gets written in the present tense; current facts come only from a briefing
 * built at ask time. So this carries conversational continuity — what was just
 * being talked about — and no fleet facts at all.
 *
 * Deliberately short. A long history is a growing charge on every question for a
 * diminishing return, and the thing it buys is the ability to answer *"what
 * about the other one?"* — which needs the last exchange or two, not twenty.
 *
 * Failed turns are skipped: a question with no answer under it is not a thing
 * the two of them said to each other, and sending it would invite the model to
 * apologise for a provider outage in the middle of a fresh answer.
 */
export const CHIEF_CONTEXT_TURNS = 3;

export function recentChiefContext(limit = CHIEF_CONTEXT_TURNS): string {
  return readChiefTurns(limit * 2)
    .filter((turn) => turn.answer !== null)
    .slice(-limit)
    .map((turn) => `They asked: ${turn.question}\nYou answered: ${String(turn.answer)}`)
    .join("\n\n");
}

/**
 * Forget the whole conversation.
 *
 * The person's own control, from the chat room. Deleted rather than hidden, for
 * `forgetAgentQuestions`' reason: these are somebody's own words, and a "clear"
 * that only stopped drawing them would be DASH keeping a copy of a conversation
 * they asked it to forget.
 */
export function clearChiefThread(): void {
  try {
    db().prepare("DELETE FROM chief_messages").run();
  } catch (error: unknown) {
    console.warn(`[dash] could not clear the chief's conversation: ${message(error)}`);
  }
}

/* ---------------------------------------------------------------------- *
 * Reading a row back
 * ---------------------------------------------------------------------- */

/**
 * One stored row as a turn, or null.
 *
 * A row whose provider this build no longer knows reads as absent, which is
 * `projectExchange`'s rule: a record this version cannot interpret should read
 * as the absence of a record rather than as a value every renderer downstream
 * needs a branch for.
 */
function projectTurn(row: unknown): ChiefTurnRecord | null {
  const record = row as Record<string, unknown>;
  const stored = record["provider_id"];
  /*
   * Three cases, not two. No provider is a **free answer** and is kept; a
   * provider this build still knows is kept; a provider it has dropped reads as
   * the absence of a record and the row is skipped, which is
   * `projectExchange`'s rule.
   *
   * The order matters: checking `aiProviderById` first would drop every records
   * answer, because `aiProviderById(null)` is null and the two nulls mean
   * opposite things.
   */
  let providerId: string | null = null;
  if (typeof stored === "string" && stored.length > 0) {
    if (aiProviderById(stored) === null) {
      return null;
    }
    providerId = stored;
  }
  const modelId = record["model_id"];
  return {
    id: Number(record["id"]),
    asked_at: String(record["asked_at"]),
    question: String(record["question"]),
    answer: typeof record["answer"] === "string" ? record["answer"] : null,
    failure: typeof record["failure"] === "string" ? record["failure"] : null,
    provider_id: providerId,
    model_id: typeof modelId === "string" && isModelId(modelId) ? modelId : null,
    tokens_in: wholeOrNull(record["tokens_in"]),
    tokens_out: wholeOrNull(record["tokens_out"]),
    amount_usd: amountOrNull(record["amount_usd"]),
    receipt: parseReceipt(record["receipt_json"]),
  };
}

/**
 * The frozen briefing, or an empty one.
 *
 * Parsed defensively even though DASH wrote it, `parseCitations`' reason: it is
 * a JSON string in a database file that survives upgrades, and `readStore`'s
 * whole design is that a row DASH cannot read must not take a page down with it.
 *
 * **An unreadable receipt reads as empty, and empty means unmarked.** That is
 * the weaker of the two claims and therefore the right default: a turn with no
 * receipt says *nothing from your records was used*, which is visibly odd beside
 * an answer full of fleet facts, and a reader can tell something is wrong. The
 * other default would silently claim that facts nobody can name are still
 * current.
 */
function parseReceipt(value: unknown): ChiefBriefingRow[] {
  if (typeof value !== "string") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const rows: ChiefBriefingRow[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const one = entry as Record<string, unknown>;
    const agent = one["agent"];
    const title = one["title"];
    if (typeof agent !== "string" || agent.length === 0 || typeof title !== "string") {
      continue;
    }
    rows.push({
      agent,
      title,
      place: text(one["place"]),
      standing: text(one["standing"]),
      runs: text(one["runs"]),
      last_run: typeof one["last_run"] === "string" ? one["last_run"] : null,
      capabilities: Array.isArray(one["capabilities"])
        ? one["capabilities"].filter((id): id is string => typeof id === "string")
        : [],
    });
  }
  return rows;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function wholeOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function amountOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
