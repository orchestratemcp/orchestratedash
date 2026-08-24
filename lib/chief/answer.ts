/**
 * One question to the chief, decided once and hosted twice (MAR-743, ADR 0028
 * decision 1).
 *
 * This was the body of `electron/chief-host.ts` and is now a procedure with its
 * world handed in. Two callers construct it: main, which passes its store, its
 * broker and its clock and behaves exactly as it did; and `runner/chief.ts`,
 * which passes the snapshot main pushed, its own narrow broker, and a spool.
 *
 * ## Why a shared procedure rather than a second chief
 *
 * The obvious alternative is a chief in the runner that does roughly the same
 * thing, and the failure it invites is specific rather than aesthetic. Four
 * things below were argued once and are easy to get subtly wrong a second time:
 *
 * - **Records first, and free.** A standing question never reaches a broker and
 *   its row carries no provider and no money columns.
 * - **The conversation travels in its own field**, bounded, rather than being
 *   folded into the question — which is what stops a question nobody can finish
 *   typing after three turns.
 * - **An empty answer is still charged.** A provider that billed for a reply
 *   with no text in it billed for it, and the row says so.
 * - **The model is read where the caller is trusted**, never taken from the
 *   request.
 *
 * A second copy is a place for one of those to quietly not be true, on the path
 * where nobody is watching.
 *
 * ## Pure of everything except the deps it is given
 *
 * No store, no vault, no clock, no `fetch`, and — importantly — nothing from
 * `electron/`. It is imported by a plain Node process, so an import of main's
 * broker here would be an import of Electron in the runner, which is the whole
 * class of mistake `tests/client-bundle.test.ts` exists to catch one layer up.
 *
 * ## What this file does not decide
 *
 * How the outcome is *said*. `ChiefOutcome` is a value, and each host renders
 * it: main into `ChiefActionResult` with a `Recovery` the room draws, the runner
 * into a Discord message that always says something (ADR 0028 decision 9). The
 * two rooms owe the person different things, and a single rendering here would
 * be one of them wearing the other's clothes.
 */

import { randomUUID } from "node:crypto";

import {
  ASK_MAX_OUTPUT_TOKENS,
  askFailureFor,
  readAnswer,
  readCharge,
  type AskFailureReasonName,
} from "../ai/ask";
import type { AiProviderProfile } from "../ai/providers";
import type { BrokerRequest, BrokerResponse } from "../broker/protocol";
import {
  describeChiefCannotSearch,
  describeChiefFetched,
  describeChiefFoundNoSources,
  describeChiefItemsOnly,
  describeChiefNoTopic,
  describeChiefSourcesUnreachable,
} from "../copy/chief-sources";
import { renderBriefing, type ChiefBriefingRow } from "./briefing";
import {
  outputsEvidence,
  renderFetchedMaterial,
  renderOutputsMaterial,
  sourcesEvidence,
  type ChiefEvidence,
} from "./evidence";
import type { FetchedSource } from "./fetch-sources";
import type { ChiefItem } from "./library";
import { selectChiefMaterial } from "./library";
import { CHIEF_CONNECTION_ID, chiefOperationId } from "./manifest";
import { answeredFromRecords, recordsAnswer, undeclaredAnswer } from "./records-answer";
import type { ChiefFleetAgent } from "./reply";
import type { ChiefTurnDraft, ChiefTurnOrigin } from "./store";
import { chiefToolFor } from "./tools";

/* ---------------------------------------------------------------------- *
 * What one host has to supply
 * ---------------------------------------------------------------------- */

/**
 * The fleet, as of some moment, plus the rows that get frozen onto the turn.
 *
 * One value rather than two arguments because they are two projections of the
 * same read and must describe the same instant. Main builds both from one
 * `agentsView()`; the runner receives both in one pushed snapshot. A caller
 * that could pass a fresh fleet with a stale briefing would be a caller that
 * could store a receipt for facts the answer was not built from.
 */
export interface ChiefSnapshot {
  fleet: readonly ChiefFleetAgent[];
  briefing: readonly ChiefBriefingRow[];
  /**
   * What the fleet has produced, newest first (MAR-744).
   *
   * The third projection of the same read, and it travels on the same value for
   * `ChiefSnapshot`'s own reason: a caller able to pass a fresh library with a
   * stale briefing would be a caller able to store a receipt for facts the
   * answer was not built from.
   *
   * Empty is an ordinary state and not a fault — a fleet whose agents have never
   * run has produced nothing, and the chief says so rather than implying a
   * failure. `chiefLibrary` bounds it at `MAX_LIBRARY_ITEMS` before it gets
   * here, which is what keeps the runner's pushed snapshot a small object.
   */
  library: readonly ChiefItem[];
  /**
   * When this was read, ISO-8601 — or null for a snapshot taken now.
   *
   * Null in main, because main reads the store at the moment it answers. A
   * timestamp in the runner, because the snapshot was pushed and may be old,
   * and ADR 0028 decision 6 requires an answer built from a stale snapshot to
   * carry its age rather than imply freshness. Nothing here renders it; the
   * runner does.
   */
  taken_at: string | null;
}

export interface ChiefAnswerDeps {
  snapshot: ChiefSnapshot;
  /**
   * Which provider and model to ask under, or null when this DASH has none.
   *
   * Resolved by the host from a row a person set — `readEffectiveChiefModel` in
   * main, the pushed value in the runner — and never from the question. A
   * question that could name a model would be a question that could spend
   * somebody's money on the most expensive thing their key reaches.
   */
  model: { profile: AiProviderProfile; model_id: string } | null;
  /** The last few turns as plain text, oldest first. Empty when there are none. */
  context: string;
  /**
   * Put the request to a broker as the chief, on a person's behalf.
   *
   * The principal and the origin are the host's to bind, and both are
   * deliberately absent from this signature. Main passes `CHIEF` and
   * `"person"`; the runner's broker answers only the chief and has no other
   * principal to be given. Nothing on this line is a string an agent could aim
   * at by choosing a name.
   */
  ask(request: BrokerRequest): Promise<BrokerResponse>;
  /**
   * Read the allowlisted public sources for one subject, or null if this host
   * cannot (MAR-744, issue item 3).
   *
   * The topic has already passed `topicFrom`, so an implementation receives a
   * string that is known to build an address on the allowlist — and receives
   * nothing else, which is the whole of why a fetched page cannot aim the next
   * fetch. `lib/chief/fetch-sources.ts` is the one implementation; a host
   * supplies it a `fetch` and an audit sink.
   *
   * Nullable because a host without one is a real and honest state rather than a
   * bug: the chief then says it cannot search from here, which is item 4's
   * *"honest 'I can't reach that' instead of a generic refusal"*.
   */
  fetchSources: ((topic: string) => Promise<readonly FetchedSource[]>) | null;
  /** Write the turn. False means the write failed — never that the question did. */
  record(draft: ChiefTurnDraft): boolean;
  now(): Date;
}

/* ---------------------------------------------------------------------- *
 * What one question becomes
 * ---------------------------------------------------------------------- */

/**
 * The outcome of one question, before anybody has decided how to say it.
 *
 * `answered` is the only arm that carries text, and it carries it on every path
 * that produced one — including the two free ones, where `from` is `"records"`.
 *
 * `no_model` is a flag and not a sentence, deliberately. It is true on exactly
 * one path — a question the model would have answered, asked on a DASH with no
 * model to ask — and the answer under it is real; what it marks is what could
 * not be *added* to that answer. Each host says so in its own words, because
 * "set a default on the AI tab in Settings" is a true sentence in the window and
 * an odd one in a chat room with no tab to open. Prose lives in `lib/copy/`.
 */
export type ChiefOutcome =
  | {
      kind: "answered";
      text: string;
      from: "records" | "model";
      no_model: boolean;
      /**
       * What the tool on this turn produced, or that there was no tool
       * (MAR-744).
       *
       * On the outcome as well as on the stored row, because each host has to
       * *say* it and the two say it differently: the window draws citations
       * under the answer, and Discord has no panel to draw them in and appends
       * them as lines. Both read this one value, so a link a person can click
       * came from DASH's record in either room.
       */
      evidence: ChiefEvidence;
    }
  /**
   * A broker or a provider said no. The turn is recorded with no answer.
   *
   * It still carries the evidence, and that is deliberate rather than tidy: a
   * fetch that succeeded and a model that then refused is a turn where DASH
   * genuinely has six new sources for somebody, and throwing them away because
   * the paragraph over them failed would be losing work the person can use.
   */
  | { kind: "refused"; reason: AskFailureReasonName; service: string; evidence: ChiefEvidence }
  /** Nothing was asked. Not a refusal: there is no request to refuse. */
  | { kind: "empty" }
  /**
   * The answer exists and could not be written down.
   *
   * Its own arm rather than a `refused` with a made-up reason, because the two
   * are opposite facts about somebody's money: `answer_lost` means a provider
   * was paid and DASH dropped what it bought, and `dash_error` means nothing was
   * spent and a free answer did not land.
   */
  | { kind: "not_recorded"; reason: "answer_lost" | "dash_error"; service: string };

/**
 * Answer one question, and write the turn down.
 *
 * The order is ADR 0023's and is preserved exactly: empty, then records, then
 * no-model, then the broker. Every arm that produced anything a person could
 * read writes a row before returning, so a transcript is a record of what was
 * asked rather than of what succeeded.
 */
export async function answerChiefQuestion(
  question: string,
  origin: ChiefTurnOrigin,
  deps: ChiefAnswerDeps,
): Promise<ChiefOutcome> {
  const asked = question.trim();
  if (asked.length === 0) {
    // The composer will not submit one and the bridge drops one before it gets
    // here, so this is a guard rather than a state anybody reaches. Nothing is
    // stored: an empty question is not a thing somebody said.
    return { kind: "empty" };
  }

  const askedAt = deps.now().toISOString();
  const { fleet, briefing, library } = deps.snapshot;

  const free = (
    text: string | null,
    noModel = false,
    evidence: ChiefEvidence = { kind: "none" },
    receipt: readonly ChiefBriefingRow[] = briefing,
  ): ChiefOutcome => {
    if (text === null) {
      return { kind: "empty" };
    }
    /*
     * A turn nobody was charged for. `provider_id` is null and every money
     * column with it — the free arm, written into the row rather than left for
     * a reader to infer from an absent price.
     *
     * The receipt is what was actually sent. That used to be *always* the full
     * briefing, on the argument that a records answer read those rows too. It
     * is now the caller's, because MAR-744 introduced a turn where it is not:
     * a question answered from the agents' own reports does not send the
     * briefing at all, and freezing it anyway would store a receipt for facts
     * the answer was not built from — which is the one thing this field exists
     * to prevent.
     */
    const stored = deps.record({
      asked_at: askedAt,
      question: asked,
      answer: text,
      failure: null,
      provider_id: null,
      model_id: null,
      tokens_in: null,
      tokens_out: null,
      amount_usd: null,
      receipt: [...receipt],
      evidence,
      origin,
    });
    return stored
      ? { kind: "answered", text, from: "records", no_model: noModel, evidence }
      : { kind: "not_recorded", reason: "dash_error", service: "DASH" };
  };

  /* Records first, and free (ADR 0023 decision 5). */
  if (answeredFromRecords(asked)) {
    return free(recordsAnswer(asked, fleet));
  }

  /* ------------------------------------------------------------------ *
   * The declared command set (MAR-744)
   * ------------------------------------------------------------------ *
   *
   * After records and before the model, which is the only order that works.
   * Before records would answer *"is my news agent failing"* by reading its
   * headlines; after the model would mean deciding what to send after having
   * sent it.
   *
   * DASH dispatches, DASH reads, and the model's whole job is prose over
   * material DASH selected. `lib/chief/tools.ts` argues why it is not a
   * provider tool-calling loop. Every arm below either sets `material` and
   * `evidence` together or returns a free answer saying honestly why it could
   * not — there is no path that fetches and then discards, and none that cites
   * something it did not send.
   */
  let material = renderBriefing(briefing);
  let evidence: ChiefEvidence = { kind: "none" };
  let receipt: readonly ChiefBriefingRow[] = briefing;

  const tool = chiefToolFor(asked);

  if (tool.kind === "sources_without_topic") {
    return free(describeChiefNoTopic().sentence);
  }

  if (tool.kind === "sources") {
    if (deps.fetchSources === null) {
      return free(describeChiefCannotSearch().sentence);
    }
    const fetched = await deps.fetchSources(tool.topic);
    /*
     * The receipt becomes the fetch and stops being the briefing. A person
     * asking for more sources is asking about the world, not about their
     * fleet, and `fleetChangedSince` over an empty array is false — so a turn
     * like this is never marked *your fleet changed*, which would be a true
     * sentence about an irrelevant fact.
     */
    evidence = sourcesEvidence(tool.topic, fetched);
    receipt = [];

    const found = fetched.reduce((total, source) => total + source.items.length, 0);
    if (found === 0) {
      /*
       * Nothing to write prose over, so nothing is bought. Which of the two
       * sentences it is turns on whether DASH was reached and told nothing or
       * could not get through — see `describeChiefFoundNoSources`, and the
       * paragraph in `lib/copy/chief-sources.ts` about why collapsing them
       * would be the wrong answer.
       */
      const reached = fetched.filter((source) => source.status === "ok" || source.status === "empty");
      const names = fetched.map((source) => source.name);
      return free(
        reached.length === 0
          ? describeChiefSourcesUnreachable(names).sentence
          : describeChiefFoundNoSources(names).sentence,
        false,
        evidence,
        [],
      );
    }
    material = renderFetchedMaterial(tool.topic, fetched);
  } else if (tool.kind === "outputs") {
    const selection = selectChiefMaterial(library, asked);
    const read = renderOutputsMaterial(selection.chosen);
    evidence = outputsEvidence(selection);
    if (read.length > 0) {
      material = read;
      receipt = [];
    }
    /*
     * An empty library falls through to the briefing on purpose. The fleet has
     * saved nothing, and *"here is what your agents are set up to do"* is more
     * use than a refusal — `undeclaredAnswer`'s own argument. The evidence is
     * still recorded, with `basis: "nothing_saved"` and no citations, so the
     * receipt says why the answer had no reports in it.
     */
  }

  if (deps.model === null) {
    /*
     * No model to ask.
     *
     * The chief falls back to what it could always do — route the question to
     * the agent whose author declared the subject, or name what the fleet
     * declares — rather than refusing. That is MAR-648's chief exactly, and it
     * is a real answer rather than an apology.
     *
     * Since MAR-744 there is a better fallback when a tool ran: the items or
     * the sources themselves, which DASH found without spending anything. The
     * paragraph is what is missing, not the work.
     *
     * In the runner this arm carries a second meaning the window never has: the
     * machine restarted and main has not handed the key over yet. ADR 0028
     * decision 9 is why that lands here rather than in silence.
     */
    if (evidence.kind === "sources") {
      const answered = evidence.sources.filter((source) => source.item_count > 0);
      const missed = evidence.sources.filter((source) => source.item_count === 0);
      return free(
        describeChiefFetched(
          evidence.citations.length,
          answered.map((source) => source.name),
          missed.map((source) => source.name),
        ).sentence,
        true,
        evidence,
        receipt,
      );
    }
    if (evidence.kind === "outputs" && evidence.citations.length > 0) {
      return free(describeChiefItemsOnly(evidence.citations.length).sentence, true, evidence, receipt);
    }
    const routed = recordsAnswer(asked, fleet);
    return free(routed ?? undeclaredAnswer(asked, fleet), routed === null, evidence, receipt);
  }

  const { profile, model_id: modelId } = deps.model;
  const statesCost = profile.completion.prices_its_own_answer;

  const response = await deps.ask({
    // Fresh per question and never derived from its text: the broker's replay
    // memory refuses a repeat, and asking the same thing twice on purpose is an
    // ordinary act rather than a duplicate.
    request_id: `chief-${randomUUID()}`,
    connection_id: CHIEF_CONNECTION_ID,
    operation: chiefOperationId(profile.id),
    input: {
      // Read by the host from a row a person set, never taken from the request.
      model: modelId,
      // The person's own words, and only those. The conversation so far travels
      // in its own field with its own bound — folding it in here would have
      // meant a question nobody can finish typing after three turns.
      question: asked,
      // The briefing, or what a tool read or fetched. One field, because the
      // operation has one and its frame's whole instruction is *answer only
      // from this* — which is the right instruction for all three.
      material,
      context: deps.context,
      max_output_tokens: ASK_MAX_OUTPUT_TOKENS,
    },
    // Note what is absent: no `frame`. The broker writes it from the principal,
    // so nothing here can choose which of DASH's two frozen system prompts its
    // question is set in.
  });

  const spent = (
    answer: string | null,
    failure: AskFailureReasonName | null,
    model: string | null,
    charge: { tokens_in: number | null; tokens_out: number | null; amount_usd: number | null } | null,
  ): boolean =>
    deps.record({
      asked_at: askedAt,
      question: asked,
      answer,
      failure,
      provider_id: profile.id,
      model_id: model,
      tokens_in: charge?.tokens_in ?? null,
      tokens_out: charge?.tokens_out ?? null,
      amount_usd: charge?.amount_usd ?? null,
      receipt: [...receipt],
      evidence,
      origin,
    });

  if (!response.ok) {
    const reason = askFailureFor(response.refusal);
    spent(null, reason, null, null);
    return { kind: "refused", reason, service: profile.label, evidence };
  }

  const answer = readAnswer(response.result, statesCost);
  if (answer === null) {
    // A reply with no text in it. The charge is still recorded, because a
    // provider that billed for an empty answer billed for it — this is about
    // somebody's money rather than about which room they were standing in.
    spent(null, "empty_answer", null, readCharge(response.result, statesCost));
    return { kind: "refused", reason: "empty_answer", service: profile.label, evidence };
  }

  if (!spent(answer.text, null, answer.model, answer.charge)) {
    return { kind: "not_recorded", reason: "answer_lost", service: profile.label };
  }
  return { kind: "answered", text: answer.text, from: "model", no_model: false, evidence };
}
