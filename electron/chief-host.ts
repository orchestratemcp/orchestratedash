/**
 * The chief, hosted in DASH's window (MAR-659, ADR 0023; moved by MAR-743, ADR
 * 0028 decision 1).
 *
 * `electron/ask-host.ts` for the other room, and deliberately its shape: thin,
 * because what is here cannot be unit-tested without launching Electron, so
 * everything that could be decided elsewhere is. Which questions records can
 * answer is `lib/chief/records-answer.ts`, what the model is told is
 * `lib/chief/briefing.ts` and `lib/broker/operations.ts`, what a reply means is
 * `lib/ai/ask.ts`, what a refusal is called is `lib/copy/ask.ts` — and, since
 * ADR 0028, **the answering procedure itself** is `lib/chief/answer.ts`.
 *
 * That last move is the change worth reading. This file used to be the chief.
 * It is now one of two hosts for it: main, here, and `runner/chief.ts`, which
 * answers the same questions in the same order while DASH is closed. What is
 * left in this file is the three things only main can supply.
 *
 * ## The three things this file supplies
 *
 * **The store.** `agentsView()` is the same document the fleet page is drawn
 * from, read once per question — which is what makes ADR 0023's briefing rule
 * mechanical rather than aspirational: the rows are `AgentRow`s, the same ones
 * the cards use, and `briefingFor` only picks fields off them. The runner cannot
 * do this and must not try; ADR 0028 decision 6 keeps `dash.sqlite` to one
 * writer.
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
 * nothing in DASH can schedule one. ADR 0028 decision 8 says the same thing
 * about a Discord message, in the runner, with the same bound.
 *
 * ## Records first, and it is free
 *
 * A standing question never reaches the broker at all. It is answered from the
 * same records the cards are drawn from, stored with no provider and no charge,
 * and returns in a millisecond. See `answeredFromRecords`, one file over.
 */

import { readEffectiveChiefModel } from "../lib/ai/model-store";
import { aiProviderById } from "../lib/ai/providers";
import { CHIEF } from "../lib/broker/principal";
import { answerChiefQuestion, type ChiefAnswerDeps } from "../lib/chief/answer";
import { briefingFor } from "../lib/chief/briefing";
import { chiefFleetFrom } from "../lib/chief/records-answer";
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

  const outcome = await answerChiefQuestion(target.question ?? "", "window", mainDeps());

  switch (outcome.kind) {
    case "empty":
      return { ok: false, detail: "Nothing was asked." };
    case "answered":
      /*
       * `blocked` is the room's own no-model notice, on the one path that needs
       * it — a question the model would have answered, asked on a DASH with no
       * model set. The answer beneath it is real, and the notice says what DASH
       * could not add to it rather than replacing it with a refusal.
       */
      return outcome.no_model ? { ok: true, detail: describeChiefNoModel().headline } : { ok: true };
    case "refused":
      return refused(outcome.reason, outcome.service);
    case "not_recorded":
      // `dash_error` is the ordinary DASH fault — nothing was spent and a free
      // answer did not land. `answer_lost` is the much worse one and says so.
      return refused(outcome.reason, outcome.service);
  }
}

/**
 * Main's world, as the shared procedure needs it.
 *
 * Built per question rather than once, because every field of it is a read: the
 * fleet moves, the model row can change under a settings press, and a snapshot
 * captured at startup would answer this afternoon's question with this morning's
 * agents. In the runner the same value is a *pushed* snapshot and can be stale;
 * ADR 0028 decision 6 states that cost and requires the runner to say so.
 */
function mainDeps(): ChiefAnswerDeps {
  const agents = agentsView().agents;
  /*
   * MAR-696's pin, read first (`readEffectiveChiefModel`).
   *
   * This said `readFleetModelDefault` until MAR-743, which is a defect rather
   * than a decision: `lib/views/chief.ts` draws the room's model line from
   * `readEffectiveChiefModel`, so a chief with its own pin set was *shown* one
   * model and *asked* another. Corrected here rather than carried into a second
   * host, where it would have become two files disagreeing instead of one.
   */
  const chosen = readEffectiveChiefModel();
  const profile = chosen === null ? null : aiProviderById(chosen.provider_id);

  return {
    snapshot: {
      fleet: chiefFleetFrom(agents),
      briefing: briefingFor(agents),
      // Null: main reads the store at the moment it answers, so there is no age
      // to declare. See `ChiefSnapshot.taken_at`.
      taken_at: null,
    },
    model: chosen === null || profile === null ? null : { profile, model_id: chosen.model_id },
    context: recentChiefContext(),
    ask: (request) => hostBroker().handle(CHIEF, request, "person"),
    record: (draft) => recordChiefTurn(draft) !== null,
    now: () => new Date(),
  };
}

function refused(reason: Parameters<typeof describeAskFailure>[0], service: string): ChiefActionResult {
  const recovery = describeAskFailure(reason, { service, model_setting: MODEL_SETTING });
  return { ok: false, detail: recovery.headline, recovery };
}
