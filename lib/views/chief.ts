/**
 * The chief's room, joined from three places (MAR-659, ADR 0023).
 *
 * `lib/ai/model-store.ts` says whether DASH has a default model to ask under,
 * `lib/chief/store.ts` says what has already been asked and what it cost, and
 * the fleet rows this is handed say what is true *now* — which is the third one
 * and the interesting one, because comparing a turn's frozen receipt against
 * them is what marks a stored answer as older than the fleet it describes.
 *
 * `lib/views/ask.ts`' shape and its rule: writes no sentence of its own. Every
 * string here comes from `lib/copy/chief-chat.ts` or `lib/copy/ask.ts`, for the
 * reason that module states about itself — a sentence composed on the read path
 * is a sentence the copy sweep does not see.
 *
 * **Reads the store**, so it must never be imported by a page. A page imports
 * the types from `lib/views/types.ts`, which restate the two row shapes
 * structurally for exactly that reason.
 */

import { readChiefModelChoice, readFleetModelDefault } from "../ai/model-store";
import { aiProviderById } from "../ai/providers";
import { briefingFor, fleetChangedSince, type ChiefBriefingRow } from "../chief/briefing";
import type { ChiefEvidence } from "../chief/evidence";
import {
  describeChiefFetched,
  describeChiefItemsRead,
  describeChiefSourceStatus,
} from "../copy/chief-sources";
import { chiefFleetFrom } from "../chief/records-answer";
import { answerChief, type ChiefFleetAgent } from "../chief/reply";
import { readChiefTurns, type ChiefTurnRecord } from "../chief/store";
import { describeAskFailure, describeCharge, type AskFailureReason } from "../copy/ask";
import { describeChiefNoModel, describeChiefReceipt } from "../copy/chief-chat";
import { plainMoment } from "../copy/when";
import type { AgentRow, ChiefEvidenceView, ChiefRoomView, ChiefTurnView } from "./types";

/**
 * Where a person goes to fix the one thing that blocks this room.
 *
 * The AI tab in Settings. Named in `describeChiefNoModel`'s own words rather
 * than by a route constant, because the sentence has to read as a sentence and
 * the tab is the only place a fleet default is set.
 */
export function chiefRoomView(agents: readonly AgentRow[]): ChiefRoomView {
  const now = briefingFor(agents);
  const fleet = chiefFleetFrom(agents);
  const turns = readChiefTurns().map((turn) => toTurnView(turn, now, fleet));

  /*
   * MAR-696. The chief's own pin, read first — `readEffectiveChiefModel`'s
   * precedence, inlined here rather than called so this function can still
   * say *which* row answered (`model_is_own`), which the composer's swap
   * control needs and the reader does not.
   *
   * Still not a fallback to an *agent's* pinned model — ADR 0023's ruling is
   * unchanged, only which of the chief's own two rows wins is new.
   */
  const chiefPin = readChiefModelChoice();
  const fleetDefault = readFleetModelDefault();
  const effective = chiefPin ?? fleetDefault;
  if (effective === null) {
    /*
     * The shipped state, and every DASH today is in it. No default means no
     * provider, means no manifest, means the broker would refuse before it
     * touched a vault — so the room says so and points at the tab rather than
     * offering a button that produces `unknown_connection`.
     */
    return {
      can_ask: false,
      model_id: null,
      model_provider_id: null,
      model_is_own: false,
      blocked: describeChiefNoModel(),
      turns,
    };
  }
  if (aiProviderById(effective.provider_id) === null) {
    // A row naming a provider this build has dropped. `readChiefModelChoice`
    // and `readFleetModelDefault` already return null for one, so this is the
    // belt to that braces — and it reports the same state rather than a
    // fourth one, because from the room's side there is no difference: there
    // is nothing to ask.
    return {
      can_ask: false,
      model_id: null,
      model_provider_id: null,
      model_is_own: false,
      blocked: describeChiefNoModel(),
      turns,
    };
  }

  return {
    can_ask: true,
    model_id: effective.model_id,
    model_provider_id: effective.provider_id,
    model_is_own: chiefPin !== null,
    blocked: null,
    turns,
  };
}

/**
 * One stored turn, drawn.
 *
 * The receipt is read out of the row and **never recomputed** — that is the
 * whole point of the column. What is computed is only whether it still matches,
 * which is `fleetChangedSince`'s answer and a fact about two of DASH's own
 * records rather than about the answer above it.
 */
function toTurnView(
  turn: ChiefTurnRecord,
  now: readonly ChiefBriefingRow[],
  fleet: readonly ChiefFleetAgent[],
): ChiefTurnView {
  const profile = turn.provider_id === null ? null : aiProviderById(turn.provider_id);
  const label = profile?.label ?? turn.provider_id ?? "";
  /*
   * `answerChief` rather than `routeRequest`, so the projection down to the
   * three declared fields happens exactly once, in `lib/chief/reply.ts`, where
   * its own header promises it. Calling the router directly from here would pass
   * a `ChiefFleetAgent` in on structural typing — which compiles, and quietly
   * puts a glance chip and a status into the corpus that decides who a request
   * goes to. That is the rule `declaredOnly` exists to be a mechanism for.
   */
  const route = answerChief(turn.question, fleet);
  /*
   * MAR-690. A model-answered turn already gave a complete answer over the
   * whole fleet, so an `ambiguous` recompute — "which did you mean?" — is a
   * request to disambiguate *after* the question was already answered, which
   * is nonsensical. That is what "what agents run local and what runs in the
   * cloud" hit: three agents happen to share a `local_*` capability word, a
   * coincidence of vocabulary rather than a real ambiguity about the fleet-wide
   * question the model had just finished answering.
   *
   * A `routed` match is kept: a single, confident "agent X is the one built for
   * that" is a suggestion offered alongside the model's answer, never a demand
   * that the person clarify before getting one — so it does not carry the same
   * contradiction and stays exactly as it was for a question genuinely about one
   * agent's own work (`tests/chief-transcript.test.ts`'s "ai agent news" case).
   */
  const modelAnswered = turn.provider_id !== null;
  const handoffs =
    route.kind === "routed"
      ? [route.agent]
      : route.kind === "ambiguous" && !modelAnswered
        ? [...route.agents]
        : [];
  return {
    id: turn.id,
    question: turn.question,
    asked: plainMoment(turn.asked_at) ?? turn.asked_at,
    answer: turn.answer,
    failure:
      turn.answer === null
        ? describeAskFailure(failureReason(turn.failure), {
            service: label,
            // The chief has no picker of its own, so the one failure sentence
            // that sends somebody to a model setting has to send them to the
            // right one. See `describeAskFailure`'s `model_setting`.
            model_setting: "the default model on the AI tab in Settings",
          })
        : null,
    from_records: turn.provider_id === null,
    handoffs: handoffs.map((agent) => ({
      agent: agent.name,
      title: agent.title,
      goal: agent.goal,
    })),
    matched:
      route.kind === "routed" || (route.kind === "ambiguous" && !modelAnswered)
        ? [...route.matched]
        : [],
    receipt: turn.receipt.map((row) => ({ ...row, capabilities: [...row.capabilities] })),
    receipt_note: describeChiefReceipt(turn.receipt.length).sentence,
    evidence: evidenceView(turn.evidence),
    stale: fleetChangedSince(turn.receipt, now),
    model: turn.model_id,
    charge:
      profile === null
        ? null
        : describeCharge(
            {
              amount_usd: turn.amount_usd,
              tokens_in: turn.tokens_in,
              tokens_out: turn.tokens_out,
              provider_states_cost: profile.completion.prices_its_own_answer,
            },
            label,
          ),
  };
}

/**
 * A stored failure string as one of the reasons DASH has words for.
 *
 * `toExchangeView`'s rule, restated: a row written by a build that knew a reason
 * this one does not reads as `dash_error`, which is the only reason in the set
 * whose sentence claims nothing was charged **and** whose cause is on this
 * computer. Every other reason would assert something about a provider DASH
 * cannot check from a string.
 */
function failureReason(stored: string | null): AskFailureReason {
  switch (stored) {
    case "not_connected":
    case "answer_lost":
    case "key_refused":
    case "too_many":
    case "provider_unavailable":
    case "provider_refused":
    case "empty_answer":
      return stored;
    default:
      return "dash_error";
  }
}

/* ---------------------------------------------------------------------- *
 * The evidence under a turn (MAR-744)
 * ---------------------------------------------------------------------- */

/**
 * What the chief read or fetched, as the room draws it.
 *
 * Read out of the row and **never recomputed**, exactly as `receipt` is and for
 * the same reason: this is the record of what was actually sent, so a turn from
 * last Tuesday shows the six headlines that answer was built on rather than the
 * six that would be chosen for the same question today.
 *
 * The *sentences* are composed here from the stored facts rather than stored —
 * `toExchangeView`'s discipline. What is in the database is a basis, a count and
 * a status; the words come from `lib/copy/chief-sources.ts` on every render, so
 * correcting one corrects it for every answer already on screen.
 *
 * Null for a turn with no tool, which the room draws as nothing at all rather
 * than as an empty panel with a heading over it.
 */
function evidenceView(evidence: ChiefEvidence): ChiefEvidenceView | null {
  if (evidence.kind === "none") {
    return null;
  }

  if (evidence.kind === "outputs") {
    return {
      kind: "outputs",
      note: describeChiefItemsRead(evidence.basis, evidence.citations.length, evidence.terms)
        .sentence,
      citations: evidence.citations.map((citation) => ({
        index: citation.index,
        headline: citation.headline,
        /*
         * Which agent found it, and out of which source. Composed rather than
         * stored, so a renamed agent reads correctly under an old answer -- the
         * title comes off the citation, which froze `agentDisplayName`'s answer
         * at the time, and this only decides how the two are joined.
         */
        where:
          citation.source_name === null
            ? `${citation.agent_title} — ${citation.report_title}`
            : `${citation.source_name}, found by ${citation.agent_title}`,
        href: citation.item_url,
        agent: citation.agent,
        output: citation.artifact_id,
      })),
      sources: [],
    };
  }

  const answered = evidence.sources.filter((source) => source.item_count > 0);
  const missed = evidence.sources.filter((source) => source.item_count === 0);
  return {
    kind: "sources",
    note: describeChiefFetched(
      evidence.citations.length,
      answered.map((source) => source.name),
      missed.map((source) => source.name),
    ).sentence,
    citations: evidence.citations.map((citation) => ({
      index: citation.index,
      headline: citation.headline,
      where: citation.source_name,
      href: citation.item_url,
      // Nothing DASH fetched belongs to an agent, or to a report of one. Null
      // rather than an empty string, so a renderer linking out has one thing to
      // test.
      agent: null,
      output: null,
    })),
    sources: evidence.sources.map((source) => ({
      name: source.name,
      outcome: describeChiefSourceStatus(source.status, source.item_count),
      count: source.item_count,
    })),
  };
}
