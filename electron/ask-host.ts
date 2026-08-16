/**
 * One question, from a person's keyboard to a provider and back (MAR-545).
 *
 * The wiring beside `electron/notify-settings.ts` and `electron/folder-update.ts`,
 * and thin for the reason every module in this directory is: what is here cannot
 * be unit-tested without launching Electron, so everything that could be decided
 * elsewhere is. Selection, the request's shape, what a reply means and what a
 * refusal is called are all in `lib/ai/ask.ts` and `lib/broker/operations.ts`,
 * where tests drive them with no vault, no key and no provider.
 *
 * ## The one thing this file decides
 *
 * That a question DASH asks is a question a **person** asked. It is the only
 * caller in the repository that passes `"person"` to `broker.handle`, and every
 * other caller — there is exactly one, the drain loop in
 * `electron/broker-host.ts` — passes `"agent"`. `BrokerOrigin` argues why that
 * distinction exists and what has to be built before it can be relaxed.
 *
 * The gates are the same three `performModelAction` states for itself, and they
 * are here for its reason: a rule stated at a seam is a rule a second
 * implementation could forget, and a rule stated beside the call is unavoidable
 * by anything that actually calls.
 */

import { randomUUID } from "node:crypto";

import {
  ASK_MAX_OUTPUT_TOKENS,
  askFailureFor,
  citations,
  readAnswer,
  readCharge,
  renderMaterial,
  selectMaterial,
  type AnswerCharge,
  type AskFailureReasonName,
} from "../lib/ai/ask";
import { recordExchange } from "../lib/ai/ask-store";
import { readEffectiveModelChoice } from "../lib/ai/model-store";
import { aiProviderById } from "../lib/ai/providers";
import { agentPrincipal } from "../lib/broker/principal";
import type { ConnectionSourceManifest } from "../lib/connections";
import { resolveCredentialTarget } from "../lib/connection-credentials";
import { describeAskFailure } from "../lib/copy/ask";
import type { Recovery } from "../lib/copy/recovery";
import { readAgentManifest } from "../lib/store";
import { savedThingsForAgent } from "../lib/views/ask";
import { hostBroker } from "./broker-host";

export interface AskActionResult {
  ok: boolean;
  detail?: string;
  recovery?: Recovery;
}

/**
 * Ask this agent's model a question about what the agent has saved.
 *
 * Returns whether the question was asked, not what it answered. The answer lands
 * in `agent_questions` and reaches the page on its next poll — see
 * `DispatchContext.askAction` for why there is exactly one path by which an
 * answer becomes something on screen.
 */
export async function performAskAction(
  target: { agent_id: string; connection_id: string; field_id: string; question: string },
): Promise<AskActionResult> {
  const manifest = readAgentManifest(target.agent_id) as ConnectionSourceManifest | null;
  if (manifest === null) {
    return refused("dash_error", "this agent");
  }

  // The same resolution the connect flow and `performModelAction` use, so a
  // renderer cannot name a connection this manifest does not declare, or one
  // belonging to a different agent, or an ordinary secret field.
  const resolution = resolveCredentialTarget(
    target.agent_id,
    manifest,
    target.connection_id,
    target.field_id,
  );
  if (!resolution.ok || resolution.target.kind !== "provider_key") {
    return refused("dash_error", "this agent's model provider");
  }
  const profile = aiProviderById(resolution.target.ai_provider_id);
  if (profile === null) {
    return refused("dash_error", resolution.target.service);
  }
  /*
   * DASH's name for the provider, not the author's name for the connection.
   *
   * The scrollback words every stored row from the profile, and this is the
   * sentence a person sees the instant they press Ask — two spellings of the
   * same failure, one saying "Your model provider is not connected" and the
   * next line down saying "OpenRouter is not connected", is the kind of drift
   * that makes somebody wonder whether they are two different things. It is
   * also the more useful of the two here: the next action sends them to the
   * provider's own site.
   */
  const service = profile.label;

  // Read in main from the row a person set, never taken from the request. A
  // renderer that could name a model would be a renderer that could spend
  // somebody's money on the most expensive thing their key reaches.
  //
  // MAR-642: "the row a person set" is now two rows with a precedence between
  // them — this agent's own choice, then DASH's default. The precedence is
  // `applyFleetDefault`'s and the provider handed in is `profile.id`, resolved
  // above from this agent's own manifest, so a default belonging to another
  // provider cannot put its model id into a request bound for this one.
  const choice = readEffectiveModelChoice(target.agent_id, profile.id).choice;
  if (choice.kind !== "one_model") {
    return refused("dash_error", service);
  }

  const selection = selectMaterial(savedThingsForAgent(target.agent_id), target.question);
  const material = renderMaterial(selection);
  if (material.length === 0) {
    // Refused here rather than sent. An empty question is a charge for nothing,
    // and the surface already says an agent that has saved nothing cannot be
    // asked — reaching this means the page was open while that changed.
    return refused("dash_error", service);
  }

  const askedAt = new Date().toISOString();
  const chosen = citations(selection);
  const statesCost = profile.completion.prices_its_own_answer;

  const response = await hostBroker().handle(
    agentPrincipal(target.agent_id),
    {
      // Fresh per question and never derived from the question's text: the
      // broker's replay memory refuses a repeat, and two people asking the same
      // thing twice on purpose is an ordinary act rather than a duplicate.
      request_id: `ask-${randomUUID()}`,
      connection_id: target.connection_id,
      operation: `${profile.id}.chat.completion`,
      input: {
        model: choice.model_id,
        question: target.question,
        material,
        max_output_tokens: ASK_MAX_OUTPUT_TOKENS,
      },
    },
    // The whole point of this file. See the note at the top.
    "person",
  );

  /**
   * Write one row, and say whether it landed.
   *
   * The return value is read on the success path and only there, which is the
   * asymmetry worth stating: a failed question whose row is lost costs the
   * person nothing, and an **answered** one whose row is lost costs them the
   * charge and leaves them with nothing to show for it. That is the one outcome
   * this whole feature can produce where somebody is out of pocket and DASH has
   * no record — so it gets its own sentence rather than a cheerful `ok: true`.
   */
  const write = (
    answer: string | null,
    failure: AskFailureReasonName | null,
    model: string | null,
    charge: AnswerCharge | null,
  ): boolean => {
    return recordExchange({
      agent: target.agent_id,
      asked_at: askedAt,
      question: target.question,
      answer,
      failure,
      basis: selection.basis,
      provider_id: profile.id,
      model_id: model,
      tokens_in: charge?.tokens_in ?? null,
      tokens_out: charge?.tokens_out ?? null,
      amount_usd: charge?.amount_usd ?? null,
      citations: chosen,
    }) !== null;
  };

  if (!response.ok) {
    const reason = askFailureFor(response.refusal);
    write(null, reason, null, null);
    return refused(reason, service);
  }

  const answer = readAnswer(response.result, statesCost);
  if (answer === null) {
    // A reply with no text in it. The charge is still recorded, because a
    // provider that billed for an empty answer billed for it — and a row saying
    // the question failed with no cost beside it would be a false statement
    // about somebody's money.
    write(null, "empty_answer", null, readCharge(response.result, statesCost));
    return refused("empty_answer", service);
  }

  if (!write(answer.text, null, answer.model, answer.charge)) {
    return refused("answer_lost", service);
  }
  return { ok: true };
}

function refused(reason: AskFailureReasonName, service: string): AskActionResult {
  const recovery = describeAskFailure(reason, { service });
  return { ok: false, detail: recovery.headline, recovery };
}
