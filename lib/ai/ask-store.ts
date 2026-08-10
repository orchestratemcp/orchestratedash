/**
 * The conversation, written down (MAR-545).
 *
 * The impure half of `lib/ai/ask.ts` and `lib/copy/ask.ts`, in
 * `lib/ai/model-store.ts`'s shape: it stores what those two decided and reads it
 * back for whoever is drawing the page. No policy here. A function in this file
 * that decided what an empty answer *meant* would be a second authority beside
 * `describeAskFailure`, free to drift from it.
 *
 * ## Why the whole question and the whole answer are kept
 *
 * `broker_audit` keeps the *names* of an agent's inputs and never their values,
 * and that is right for an agent: a durable table of every phrase a program
 * searched for is a record nobody asked DASH to keep. This table is the opposite
 * case and the reasoning inverts cleanly. A person typed these words, on their
 * own computer, into something shaped like a conversation — and a conversation
 * that forgets everything when the page closes is not one. The migration's own
 * note in `lib/db.ts` states the same split at the schema.
 *
 * ## The cost column
 *
 * `amount_usd` is written from one source and one only: a figure the provider
 * stated inside the reply it charged for. There is no rate table in this
 * repository, no multiplication of a token count, and therefore no code path
 * that could put DASH's own arithmetic in this column. `readSpendSummary` sums
 * and takes the middle of those figures, which is arithmetic **on the
 * provider's own numbers** rather than a derivation of new ones — a total of
 * quoted amounts is still quoted.
 */

import { isModelId } from "../broker/operations";
import { db } from "../db";
import { isSelectionBasis, type AskCitation, type SelectionBasis } from "./ask";
import { aiProviderById } from "./providers";

/* ---------------------------------------------------------------------- *
 * One exchange
 * ---------------------------------------------------------------------- */

/**
 * One question and whatever became of it.
 *
 * A single row for both outcomes rather than a table of questions and a table of
 * answers. A question that failed is still a thing the person asked and still
 * belongs in the scrollback where they can see it did not work — and, when the
 * provider charged for a reply with no text in it, it is the row the charge
 * hangs off.
 */
export interface AskExchange {
  id: number;
  agent: string;
  asked_at: string;
  question: string;
  /** Null exactly when `failure` is set. */
  answer: string | null;
  /** One of `AskFailureReason`, or null when there is an answer. */
  failure: string | null;
  /** Why these saved things went with the question. One of `SelectionBasis`. */
  basis: SelectionBasis;
  provider_id: string;
  model_id: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  /** The provider's own figure. Null when it stated none. */
  amount_usd: number | null;
  citations: AskCitation[];
}

/** Everything needed to write one row. `id` is the store's. */
export type AskExchangeDraft = Omit<AskExchange, "id">;

/**
 * How much scrollback one agent's chat keeps in view.
 *
 * A read limit rather than a retention rule: nothing is deleted, and a person
 * who has asked two hundred questions still has two hundred rows behind
 * `readSpendSummary`'s totals. What is bounded is how much a page draws at once,
 * because the agent page polls every five seconds and an unbounded read would
 * grow the cost of merely having it open.
 */
export const ASK_HISTORY_LIMIT = 20;

/**
 * Write one exchange, and hand back the row it became.
 *
 * Returns null when the write failed, which the caller reports as DASH's own
 * fault rather than as a failed question — the question may well have been
 * answered and charged for, and a sentence saying it failed would be false about
 * somebody's money. The answer is still shown; what is lost is the scrollback.
 */
export function recordExchange(draft: AskExchangeDraft): AskExchange | null {
  try {
    const result = db()
      .prepare(
        "INSERT INTO agent_questions " +
          "(agent, asked_at, question, answer, failure, basis, provider_id, model_id, " +
          "tokens_in, tokens_out, amount_usd, citations_json) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        draft.agent,
        draft.asked_at,
        draft.question,
        draft.answer,
        draft.failure,
        draft.basis,
        draft.provider_id,
        draft.model_id,
        draft.tokens_in,
        draft.tokens_out,
        draft.amount_usd,
        JSON.stringify(draft.citations),
      );
    return { ...draft, id: Number(result.lastInsertRowid) };
  } catch (error: unknown) {
    console.warn(`[dash] could not record a question: ${message(error)}`);
    return null;
  }
}

/**
 * This agent's recent exchanges, oldest first.
 *
 * Selected newest-first so the limit takes the *latest* twenty, then reversed so
 * the caller draws a conversation that reads downwards. Doing the reversal here
 * rather than in the component keeps the two decisions — which twenty, and in
 * what order — in one place.
 */
export function readExchanges(agent: string, limit = ASK_HISTORY_LIMIT): AskExchange[] {
  let rows: unknown[];
  try {
    rows = db()
      .prepare(
        "SELECT id, agent, asked_at, question, answer, failure, basis, provider_id, model_id, " +
          "tokens_in, tokens_out, amount_usd, citations_json FROM agent_questions " +
          "WHERE agent = ? ORDER BY id DESC LIMIT ?",
      )
      .all(agent, limit) as unknown[];
  } catch (error: unknown) {
    console.warn(`[dash] could not read this agent's questions: ${message(error)}`);
    return [];
  }

  const exchanges: AskExchange[] = [];
  for (const row of rows) {
    const exchange = projectExchange(row);
    if (exchange !== null) {
      exchanges.push(exchange);
    }
  }
  return exchanges.reverse();
}

/**
 * One stored row as an exchange, or null.
 *
 * A row whose provider this build no longer knows reads as absent, which is
 * `readAgentModelChoice`'s rule: a record this version cannot interpret should
 * read as the absence of a record rather than as a value every renderer
 * downstream needs a branch for.
 *
 * A model id that no longer passes `isModelId` drops to null while the rest of
 * the row survives. The distinction is deliberate — the provider decides whether
 * the row means anything at all, and the model is one field on it.
 */
function projectExchange(row: unknown): AskExchange | null {
  const record = row as Record<string, unknown>;
  const providerId = String(record["provider_id"]);
  if (aiProviderById(providerId) === null) {
    return null;
  }
  const modelId = record["model_id"];
  return {
    id: Number(record["id"]),
    agent: String(record["agent"]),
    asked_at: String(record["asked_at"]),
    question: String(record["question"]),
    answer: typeof record["answer"] === "string" ? record["answer"] : null,
    failure: typeof record["failure"] === "string" ? record["failure"] : null,
    // A basis this build does not know reads as `newest`, which is the weaker
    // of the three claims: it says the newest reports were used and promises
    // nothing about a match. Defaulting the other way would make an old row
    // assert a match nobody can check.
    basis: isSelectionBasis(record["basis"]) ? record["basis"] : "newest",
    provider_id: providerId,
    model_id: typeof modelId === "string" && isModelId(modelId) ? modelId : null,
    tokens_in: wholeOrNull(record["tokens_in"]),
    tokens_out: wholeOrNull(record["tokens_out"]),
    amount_usd: amountOrNull(record["amount_usd"]),
    citations: parseCitations(record["citations_json"]),
  };
}

/**
 * The stored citation list, or an empty one.
 *
 * Parsed defensively even though DASH wrote it. It is a JSON string in a
 * database file that survives upgrades, and `readStore`'s whole design is that a
 * row DASH cannot read must not take a page down with it — an answer whose
 * source list will not parse is still an answer worth showing.
 */
function parseCitations(value: unknown): AskCitation[] {
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
  const citations: AskCitation[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const one = entry as Record<string, unknown>;
    const headline = one["headline"];
    if (typeof headline !== "string" || headline.length === 0) {
      continue;
    }
    citations.push({
      index: Number(one["index"]) || citations.length + 1,
      headline,
      source_name: typeof one["source_name"] === "string" ? one["source_name"] : null,
      item_url: typeof one["item_url"] === "string" ? one["item_url"] : null,
      report_title: typeof one["report_title"] === "string" ? one["report_title"] : "",
      run_id: typeof one["run_id"] === "string" ? one["run_id"] : "",
      artifact_id: typeof one["artifact_id"] === "string" ? one["artifact_id"] : "",
    });
  }
  return citations;
}

/* ---------------------------------------------------------------------- *
 * What it has cost
 * ---------------------------------------------------------------------- */

/**
 * What this agent's questions have cost, from the figures providers stated.
 *
 * `priced` is how many of the questions came with an amount, and it is carried
 * separately from `questions` because the difference is the honest part: an
 * agent on a provider that prices nothing has asked twelve questions and has a
 * total of null, and a surface must be able to say that rather than showing a
 * zero.
 *
 * `typical` is the middle value rather than the mean. A mean is dragged by one
 * enormous question and would make "a question here usually costs" false in the
 * common case; the middle of what was actually charged is the number a person
 * can plan with.
 */
export interface AskSpendSummary {
  questions: number;
  priced: number;
  total_usd: number | null;
  typical_usd: number | null;
}

export function readSpendSummary(agent: string): AskSpendSummary {
  let rows: unknown[];
  try {
    rows = db()
      .prepare("SELECT amount_usd FROM agent_questions WHERE agent = ?")
      .all(agent) as unknown[];
  } catch (error: unknown) {
    console.warn(`[dash] could not read what this agent's questions cost: ${message(error)}`);
    return { questions: 0, priced: 0, total_usd: null, typical_usd: null };
  }

  const amounts: number[] = [];
  for (const row of rows) {
    const amount = amountOrNull((row as Record<string, unknown>)["amount_usd"]);
    if (amount !== null) {
      amounts.push(amount);
    }
  }
  if (amounts.length === 0) {
    return { questions: rows.length, priced: 0, total_usd: null, typical_usd: null };
  }

  amounts.sort((left, right) => left - right);
  const middle = amounts[Math.floor((amounts.length - 1) / 2)] ?? null;
  return {
    questions: rows.length,
    priced: amounts.length,
    total_usd: amounts.reduce((sum, amount) => sum + amount, 0),
    typical_usd: middle,
  };
}

/**
 * Forget one agent's conversation, when the agent itself goes.
 *
 * Deleted rather than kept, which is the opposite of the call `run_models` makes
 * about its own rows. Those record what DASH's setting was while a run happened
 * and are history about DASH; these are a person's own words, and keeping
 * somebody's questions about an agent they have removed would be DASH holding
 * onto their side of a conversation with something that no longer exists.
 */
export function forgetAgentQuestions(agent: string): void {
  try {
    db().prepare("DELETE FROM agent_questions WHERE agent = ?").run(agent);
  } catch (error: unknown) {
    console.warn(`[dash] could not clear this agent's questions: ${message(error)}`);
  }
}

function wholeOrNull(value: unknown): number | null {
  const count = Number(value);
  return typeof value === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

function amountOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
