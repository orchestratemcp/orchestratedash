/**
 * The half of the chief's voice that costs nothing (MAR-659, ADR 0023
 * decision 5).
 *
 * > **Records first, model second.**
 *
 * `answerChief` stays, and stays in front. A question that matches
 * `STANDING_WORDS` is answered from DASH's own records with no model, no charge
 * and no latency, and MAR-547's exactness is intact for the question people
 * actually ask most. The model is reached for what records alone cannot phrase.
 *
 * This module is the join between that decision and the durable transcript: it
 * turns a `ChiefReply` into the sentence that gets stored, so a free answer and
 * a paid one land in the same table and a person scrolling back sees one
 * conversation rather than two interleaved ones.
 *
 * ## What is deliberately *not* flattened into the stored sentence
 *
 * An agent's `goal` — its **author's** sentence. `lib/copy/chief-chat.ts`'
 * standing rule is that author text travels beside DASH's copy in `quoted` and
 * is attributed by the renderer, never folded into a paragraph where a reader
 * cannot tell which of the two is DASH speaking. `describeRouted` already keeps
 * them apart and this keeps `sentence` alone, so the stored text can never carry
 * an author's words. The quotation is drawn from the live fleet at render time,
 * beside the hand-off link — see `ChiefHandoffView`.
 *
 * ## Pure
 *
 * No store, no clock, no React. Electron main calls it to decide and to write
 * the row; nothing else does.
 */

import { describeFleetSummary } from "../copy/chief";
import {
  describeAmbiguous,
  describeRouted,
  describeStanding,
  describeUndeclared,
} from "../copy/chief-chat";
import { describeFleetCardStatus } from "../copy/fleet-status";
import type { AgentRow } from "../views/types";
import { answerChief, asksAboutStanding, type ChiefFleetAgent } from "./reply";

/**
 * The fleet as `answerChief` needs it, from the rows the page already holds.
 *
 * Lifted out of `ChiefChat` (MAR-648) so that Electron main can build the same
 * value from the same document. It was a `map` inside a component while the only
 * caller was that component; the chief now answers in main, and two copies of
 * this projection would be two chances for the routing corpus and the stored
 * answer to disagree about what an agent declares.
 */
export function chiefFleetFrom(agents: readonly AgentRow[]): ChiefFleetAgent[] {
  return agents.map((agent) => ({
    name: agent.name,
    title: agent.title,
    goal: agent.goal,
    avatar: agent.avatar,
    capabilities: agent.capabilities,
    glance: agent.glance,
    status:
      describeFleetCardStatus({
        running: agent.running,
        run_count: agent.run_count,
        glance: agent.glance,
      })?.id ?? null,
  }));
}

/**
 * Whether this question is one DASH answers from records alone.
 *
 * `asksAboutStanding`, re-exported under the name the decision uses so that the
 * two places consulting it — Electron main, which decides, and the composer,
 * which decides only whether to draw a loader — are visibly asking the same
 * question of the same function.
 *
 * The composer's use is a **prediction about latency, not a decision about the
 * answer**. If the two ever disagreed, the worst outcome is a loader that was
 * not needed or one missing for a moment; the answer is main's either way.
 */
export function answeredFromRecords(question: string): boolean {
  return asksAboutStanding(question);
}

/**
 * The chief's own answer to one question, as the sentence that gets stored.
 *
 * Null when records have nothing to say that a model could not say better —
 * `undeclared`, the arm that fires when nothing an author declared covers the
 * question. That is exactly the case ADR 0023 hands to the model, and it is the
 * case station 11 failed on: *"which agents run locally and which on the
 * cloud"* is a join over `describeFleetPlace` per agent, which no single record
 * can be quoted for.
 *
 * The caller decides what to do with a null: ask the model when there is one,
 * and fall back to `describeUndeclaredAnswer` when there is not.
 */
export function recordsAnswer(
  question: string,
  fleet: readonly ChiefFleetAgent[],
): string | null {
  const reply = answerChief(question, fleet);
  switch (reply.kind) {
    case "nothing_asked":
      return null;
    case "standing":
      return standingText(reply.summary, reply.demands.length);
    case "routed":
      return describeRouted(reply.agent.title, reply.agent.goal).sentence;
    case "ambiguous":
      return describeAmbiguous(reply.agents.map((agent) => agent.title)).sentence;
    case "undeclared":
      return null;
  }
}

/**
 * The answer when nothing is declared and there is no model to ask.
 *
 * Today's chief, unchanged, and it is the fallback rather than the norm: with a
 * fleet default set this arm is never reached, because the model answers it.
 * Kept because a DASH with no default must still answer something, and *"here is
 * everything your agents are set up to do"* is more use than an apology.
 */
export function undeclaredAnswer(
  question: string,
  fleet: readonly ChiefFleetAgent[],
): string {
  const reply = answerChief(question, fleet);
  if (reply.kind !== "undeclared") {
    // Only reachable if `recordsAnswer` and this disagree about the same
    // question, which they cannot — both call `answerChief` once with the same
    // arguments. The standing sentence is the safe answer either way: it is the
    // one arm that makes no claim about what any agent is for.
    return standingText(describeFleetSummary(fleet.map((agent) => agent.status)), 0);
  }
  const declared = describeUndeclared(reply.declared);
  const capabilities =
    declared.values.length === 0 ? "" : `\n\n${declared.values.join(", ")}`;
  return `${declared.sentence}\n\n${reply.summary}${capabilities}`;
}

/**
 * The standing answer as one block of text.
 *
 * The lead-in sentence and the counted summary, and **not** the per-agent demand
 * lines: those are the receipt's rows, which carry every chip's `meaning`
 * verbatim under every answer now. Repeating them in the sentence above would
 * print the same words twice on one turn, which is the defect MAR-609 took a
 * Status tile off the agent page for.
 */
function standingText(summary: string, demands: number): string {
  return `${describeStanding(demands).sentence}\n\n${summary}`;
}
