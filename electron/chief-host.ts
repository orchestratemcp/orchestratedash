/**
 * One question to the chief, from a person's keyboard to a provider and back
 * (MAR-659, ADR 0023).
 *
 * `electron/ask-host.ts` for the other room, and deliberately its shape: thin,
 * because what is here cannot be unit-tested without launching Electron, so
 * everything that could be decided elsewhere is. Which questions records can
 * answer is `lib/chief/records-answer.ts`, what the model is told is
 * `lib/chief/briefing.ts` and `lib/broker/operations.ts`, what a reply means is
 * `lib/ai/ask.ts`, and what a refusal is called is `lib/copy/ask.ts`.
 *
 * ## The two things this file decides
 *
 * **That the asker is the chief**, by passing `CHIEF` — a value with no agent id
 * in it, which is the whole of ADR 0023 decision 1. There is no string here that
 * an agent could contrive to match.
 *
 * **That the question is a person's.** It passes `"person"` to `broker.handle`,
 * as `ask-host.ts` does and as the drain loop never does. A chief question is
 * `origin: "person"` because somebody pressed send in the composer; ADR 0016's
 * run allowance is an agent-side mechanism and the chief has none, so an
 * unattended chief spend is not refused-by-policy — it is unreachable, and
 * nothing in DASH can schedule one.
 *
 * ## Records first, and it is free
 *
 * A standing question never reaches the broker at all. It is answered from the
 * same records the cards are drawn from, stored with no provider and no charge,
 * and returns in a millisecond. See `answeredFromRecords`.
 */

import { randomUUID } from "node:crypto";

import {
  ASK_MAX_OUTPUT_TOKENS,
  askFailureFor,
  readAnswer,
  readCharge,
  type AnswerCharge,
  type AskFailureReasonName,
} from "../lib/ai/ask";
import { readFleetModelDefault } from "../lib/ai/model-store";
import { aiProviderById } from "../lib/ai/providers";
import { CHIEF } from "../lib/broker/principal";
import { briefingFor, renderBriefing, type ChiefBriefingRow } from "../lib/chief/briefing";
import { CHIEF_CONNECTION_ID, chiefOperationId } from "../lib/chief/manifest";
import {
  answeredFromRecords,
  chiefFleetFrom,
  recordsAnswer,
  undeclaredAnswer,
} from "../lib/chief/records-answer";
import { clearChiefThread, recentChiefContext, recordChiefTurn } from "../lib/chief/store";
import { describeAskFailure } from "../lib/copy/ask";
import { describeChiefNoModel } from "../lib/copy/chief-chat";
import type { Recovery } from "../lib/copy/recovery";
import { agentsView } from "../lib/views/build";
import { hostBroker } from "./broker-host";

export interface ChiefActionResult {
  ok: boolean;
  detail?: string;
  recovery?: Recovery;
}

/** What the renderer may ask this file to do. Two verbs, and neither takes an id. */
export type ChiefActionName = "ask" | "clear";

/**
 * Where a failure sentence sends somebody for the model setting.
 *
 * The chief has no picker of its own — ADR 0023 decision 4, and ADR 0012
 * decision 4 behind it: DASH does not choose a model for anybody, and a second
 * selector would be a fourth place a model is decided.
 */
const MODEL_SETTING = "the default model on the AI tab in Settings";

export async function performChiefAction(
  action: ChiefActionName,
  target: { question?: string },
): Promise<ChiefActionResult> {
  if (action === "clear") {
    clearChiefThread();
    return { ok: true };
  }

  const question = (target.question ?? "").trim();
  if (question.length === 0) {
    // The composer will not submit one, so this is a guard rather than a state
    // anybody reaches. Nothing is stored: an empty question is not a thing
    // somebody said.
    return { ok: false, detail: "Nothing was asked." };
  }

  /*
   * The same document the fleet page is drawn from, read once.
   *
   * ADR 0023's briefing rule is that every field on a row is a string DASH
   * already renders on a screen, and this is what makes that mechanical rather
   * than aspirational: the rows are `AgentRow`s, the same ones the cards use,
   * and `briefingFor` only picks fields off them.
   */
  const agents = agentsView().agents;
  const fleet = chiefFleetFrom(agents);
  const askedAt = new Date().toISOString();

  /* Records first, and free (ADR 0023 decision 5). */
  if (answeredFromRecords(question)) {
    return fromRecords(question, recordsAnswer(question, fleet), briefingFor(agents), askedAt);
  }

  const fleetDefault = readFleetModelDefault();
  const profile = fleetDefault === null ? null : aiProviderById(fleetDefault.provider_id);
  if (fleetDefault === null || profile === null) {
    /*
     * No default model, which is every DASH today.
     *
     * The chief falls back to what it could always do — route the question to
     * the agent whose author declared the subject, or name what the fleet
     * declares — rather than refusing. That is MAR-648's chief exactly, and it
     * is a real answer rather than an apology.
     *
     * When even that has nothing (`recordsAnswer` returns null for the
     * undeclared arm, because that is the arm the model exists for), the
     * fallback answers with the declared list and the standing, and the room's
     * own blocked notice says why there is no sentence of DASH's own. No
     * provider is named on the row, because none was asked.
     */
    const routed = recordsAnswer(question, fleet);
    return fromRecords(
      question,
      routed ?? undeclaredAnswer(question, fleet),
      briefingFor(agents),
      askedAt,
      routed === null ? describeChiefNoModel() : null,
    );
  }

  const receipt = briefingFor(agents);
  const briefing = renderBriefing(receipt);
  const context = recentChiefContext();
  const statesCost = profile.completion.prices_its_own_answer;

  const response = await hostBroker().handle(
    /*
     * The chief, as a value with no id in it. `lib/broker/principal.ts` is the
     * argument; the consequence here is that there is nothing on this line an
     * agent author could aim at by choosing a name.
     */
    CHIEF,
    {
      // Fresh per question and never derived from its text, `performAskAction`'s
      // reason: the broker's replay memory refuses a repeat, and asking the same
      // thing twice on purpose is an ordinary act rather than a duplicate.
      request_id: `chief-${randomUUID()}`,
      connection_id: CHIEF_CONNECTION_ID,
      operation: chiefOperationId(profile.id),
      input: {
        // Read in main from the row a person set, never taken from the request.
        // A renderer that could name a model would be a renderer that could
        // spend somebody's money on the most expensive thing their key reaches.
        model: fleetDefault.model_id,
        // The person's own words, and only those. The conversation so far
        // travels in its own field with its own bound — see
        // `MAX_CHIEF_CONTEXT_CHARS`, and note that folding it in here would
        // have meant a question nobody can finish typing after three turns.
        question,
        material: briefing,
        context,
        max_output_tokens: ASK_MAX_OUTPUT_TOKENS,
      },
      // Note what is absent: no `frame`. `lib/broker/execute.ts` writes it from
      // the principal, so this file cannot choose which of DASH's two frozen
      // system prompts its question is set in — and neither can anything else.
    },
    "person",
  );

  const write = (
    answer: string | null,
    failure: AskFailureReasonName | null,
    model: string | null,
    charge: AnswerCharge | null,
  ): boolean =>
    recordChiefTurn({
      asked_at: askedAt,
      question,
      answer,
      failure,
      provider_id: profile.id,
      model_id: model,
      tokens_in: charge?.tokens_in ?? null,
      tokens_out: charge?.tokens_out ?? null,
      amount_usd: charge?.amount_usd ?? null,
      receipt,
    }) !== null;

  if (!response.ok) {
    const reason = askFailureFor(response.refusal);
    write(null, reason, null, null);
    return refused(reason, profile.label);
  }

  const answer = readAnswer(response.result, statesCost);
  if (answer === null) {
    // A reply with no text in it. The charge is still recorded, because a
    // provider that billed for an empty answer billed for it — `ask-host.ts`'
    // own reasoning, and it is about somebody's money rather than about which
    // room they were standing in.
    write(null, "empty_answer", null, readCharge(response.result, statesCost));
    return refused("empty_answer", profile.label);
  }

  if (!write(answer.text, null, answer.model, answer.charge)) {
    return refused("answer_lost", profile.label);
  }
  return { ok: true };
}

/**
 * Write a turn nobody was charged for.
 *
 * `provider_id` is null, and every money column with it. The receipt is still
 * the full briefing: a records answer read those rows too, and showing what was
 * read is not a property of having paid for it.
 *
 * `blocked` carries the room's own no-model notice on the one path that needs it
 * — a question the model would have answered, asked on a DASH with no default.
 * The answer beneath it is real, and the notice says what DASH could not add to
 * it rather than replacing it with a refusal.
 */
function fromRecords(
  question: string,
  answer: string | null,
  receipt: ChiefBriefingRow[],
  askedAt: string,
  blocked: { headline: string; meaning: string } | null = null,
): ChiefActionResult {
  if (answer === null) {
    return { ok: false, detail: "Nothing was asked." };
  }
  const stored = recordChiefTurn({
    asked_at: askedAt,
    question,
    answer,
    failure: null,
    provider_id: null,
    model_id: null,
    tokens_in: null,
    tokens_out: null,
    amount_usd: null,
    receipt,
  });
  if (stored === null) {
    // The write failed and nothing was charged, so this is the ordinary DASH
    // fault rather than `answer_lost`'s much worse one. Said with the same
    // sentence every other DASH-side failure gets.
    return refused("dash_error", "DASH");
  }
  return blocked === null ? { ok: true } : { ok: true, detail: blocked.headline };
}

function refused(reason: AskFailureReasonName, service: string): ChiefActionResult {
  const recovery = describeAskFailure(reason, { service, model_setting: MODEL_SETTING });
  return { ok: false, detail: recovery.headline, recovery };
}
