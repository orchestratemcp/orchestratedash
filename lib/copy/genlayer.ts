/**
 * The words around having a brief judged (MAR-863, ADR 0033).
 *
 * `lib/copy/brief.ts`' companion, and it keeps that file's two rules with one
 * added. A brief is the most model-authored thing DASH puts on a screen; a
 * **verdict on a brief** is model-authored twice over — a committee of models on
 * a network DASH does not run, reading a document a model wrote. Everything in
 * this file is DASH's own, and its job is to say whose the verdict is and what
 * DASH could and could not check about it.
 *
 * 1. **Attribute, never endorse.** *A committee on GenLayer judged this* — never
 *    *this brief is accurate*. DASH did not check the claims and neither did it
 *    check the judge; what it can say is who said what, and where the receipt is.
 * 2. **Say what is permanent, before it is.** The button's confirmation names the
 *    thing nobody can undo. Everything else DASH offers can be deleted by the
 *    person who made it; this cannot.
 * 3. **No verdict is a result, not a hang.** Roughly one judgement in ten ends
 *    with the committee refusing the leader's verdict, which writes nothing.
 *    That has a sentence of its own, an explanation, and a button — never a
 *    spinner. It is the single most likely way this feature disappoints somebody,
 *    and `describeAdjudication` is where it is answered.
 *
 * Pure, and it imports only types — the standing every `lib/copy/` module keeps
 * so a component can call it.
 */

import { STUDIONET_LABEL, STUDIONET_RPC_URL } from "../genlayer/connection";
import type { AdjudicationOutcome } from "../genlayer/receipt";
import type { AdjudicationFailure, AdjudicationStage } from "../genlayer/store";
import type { PayloadRefusal } from "../genlayer/payload";

/* ---------------------------------------------------------------------- *
 * The control
 * ---------------------------------------------------------------------- */

/**
 * The words on the button, and the sentence a person reads before pressing it.
 *
 * The label is the operation's card sentence in the imperative, and it is
 * short because `.button` uppercases every label globally — a long one wraps.
 *
 * `consequence` is the part that matters and it says the irreversible thing
 * first. A person is about to publish their agent's writing to a public network,
 * and the sentence that leaves that to the end is the sentence they skim.
 */
export const ADJUDICATE_COPY = {
  /** On the button, on DASH's own output card. Never on the author's panel. */
  action: "Have it judged",
  /**
   * On the same button once an attempt has settled.
   *
   * A second label rather than a second control, and it is the whole of the
   * route out of a no-verdict: the one press that starts a judgement is the one
   * press that starts another. `.button` uppercases every label globally, so
   * both are short enough not to wrap.
   */
  action_again: "Judge it again",
  /** On the button while an attempt is running. Never a spinner on its own. */
  action_running: "Being judged",
  /** The heading over the receipt once there is one. */
  receipt_heading: "Judged on GenLayer",
  /** Before the press. The whole of what a person is agreeing to. */
  consequence:
    "This publishes the briefing, the rows it cites and this run's fetch receipts to a public " +
    "test network. Anyone can read them there and nobody can take them down. A committee of " +
    "models judges the briefing against the terms and writes back a verdict. Nothing is charged " +
    "to you.",
  /** Under the consequence. What DASH deliberately does not send. */
  withheld:
    "No web addresses are sent. Each row travels as a receipt number that points back to this " +
    "run, so the judge can check a claim against the row it was written from.",
  /** The one line that names the wait, before it starts. */
  patience: "A judgement usually takes one to five minutes. You can leave this page.",
} as const;

/* ---------------------------------------------------------------------- *
 * While it is running
 * ---------------------------------------------------------------------- */

/**
 * What is happening right now, per stage.
 *
 * Five sentences rather than one spinner, because the measured span from press
 * to verdict is forty-five seconds to five minutes, and a progress indicator
 * that says nothing for four of those minutes is indistinguishable from a hang.
 *
 * Each says what DASH is doing and none claims to know how long it will take.
 * The judging line is the one that matters: it is the long stage, and it names
 * *why* it is long — a committee of models is reading — rather than asking
 * somebody to trust a bar.
 */
export function describeAdjudicationStage(stage: AdjudicationStage): string {
  switch (stage) {
    case "funding":
      return "Setting up a one-off account on the network for this judgement.";
    case "opening":
      return "Writing the terms this briefing will be judged against.";
    case "submitting":
      return "Publishing the briefing and the rows it cites.";
    case "judging":
      return "A committee of models is reading the briefing against the terms. This is the long part.";
    case "settled":
      return "Finished.";
  }
}

/* ---------------------------------------------------------------------- *
 * The verdict
 * ---------------------------------------------------------------------- */

/**
 * What a person reads when the verdict is in.
 *
 * Four shapes and they are not interchangeable, which is why this is a switch
 * and not a lookup table.
 */
export interface AdjudicationSentence {
  /** What happened, as a headline. Never an accusation and never a boast. */
  headline: string;
  /** What it means for them — the consequence, not the mechanism. */
  meaning: string;
  /** The single next action, or null when there is nothing to do. */
  next_action: string | null;
  /** The tone the card colours the chip with. Matches DASH's own vocabulary. */
  tone: "ok" | "warn" | "err" | "muted";
}

/**
 * The verdict, in DASH's own words.
 *
 * `verdict` is one of `ADJUDICATION_VERDICTS` or null, and `outcome` is DASH's
 * three-field reading of the receipt. **Both are needed and neither is
 * sufficient**, which is this function's whole reason for existing: a null
 * verdict with `outcome: "applied"` is a contract that stored nothing, and a
 * null verdict with `outcome: "no_consensus"` is a committee that refused its
 * leader. Those are different things to tell somebody.
 */
export function describeAdjudication(
  outcome: AdjudicationOutcome | null,
  verdict: string | null,
): AdjudicationSentence {
  if (outcome === "no_consensus") {
    /*
     * The one in ten, and the sentence this whole packet is shaped around.
     *
     * It is deliberately not worded as a failure, because it is not one: the
     * validators are supposed to be able to refuse a verdict they do not accept,
     * and that they did is the mechanism working. What a person needs to know is
     * that nothing was written, that their briefing was not judged badly, and
     * that asking again is a real and ordinary thing to do.
     */
    return {
      headline: "The validators did not agree on a verdict",
      meaning:
        "One model proposed a verdict and the others would not accept it, so nothing was " +
        "recorded. This is not a judgement on the briefing — it happens on about one judgement " +
        "in ten, and a second attempt usually settles.",
      next_action: "Ask for it to be judged again.",
      tone: "warn",
    };
  }
  if (outcome === "execution_failed") {
    return {
      headline: "The judgement did not run",
      meaning:
        "The network accepted the request and the judging itself did not complete, so there is " +
        "no verdict. Nothing about the briefing was decided.",
      next_action: "Ask for it to be judged again.",
      tone: "err",
    };
  }
  switch (verdict) {
    case "ACCEPTED":
      return {
        headline: "Accepted",
        meaning:
          "The committee found every paragraph supported by the rows it cites, and the briefing " +
          "meets the terms it was judged against.",
        next_action: null,
        tone: "ok",
      };
    case "REJECTED":
      return {
        headline: "Rejected",
        meaning:
          "The committee found something in the briefing that the rows it cites do not support. " +
          "The reasons below are the committee's own words.",
        next_action: null,
        tone: "err",
      };
    case "INSUFFICIENT_EVIDENCE":
      return {
        headline: "Not enough evidence",
        meaning:
          "The committee found paragraphs with no citation, or citations pointing at rows that " +
          "are not in the evidence. The reasons below are the committee's own words.",
        next_action: null,
        tone: "warn",
      };
    default:
      /*
       * A verdict outside the closed list, or none where one was expected. Said
       * rather than drawn as an empty card, `describeArtifactRole`'s rule: a
       * value this build has never heard of must render as something honest
       * rather than as nothing.
       */
      return {
        headline: "No verdict came back",
        meaning:
          "The judgement finished and the network did not return a verdict DASH can read.",
        next_action: "Ask for it to be judged again.",
        tone: "muted",
      };
  }
}

/**
 * The label over the committee's reasons.
 *
 * *The committee's reasons*, not *findings* and not *problems*: these are the
 * judge's own sentences about somebody else's document, and DASH is quoting
 * rather than agreeing. `describeBriefCitations`' register, one layer out.
 */
export const ADJUDICATION_REASONS_LABEL = "What the committee said";

/** What to say when an accepted verdict came back with no reasons on it. */
export const ADJUDICATION_NO_REASONS = "The committee gave no reasons beyond the verdict.";

/* ---------------------------------------------------------------------- *
 * When it did not get that far
 * ---------------------------------------------------------------------- */

/**
 * Why an attempt stopped, in the kinds that lead somewhere different.
 *
 * `lib/copy/recovery.ts`' discipline: five failures, five next actions, none
 * interchangeable. The temptation this resists is a single "the judgement
 * failed" that tells a person nothing about whether to press the button again.
 */
export function describeAdjudicationFailure(failure: AdjudicationFailure): AdjudicationSentence {
  switch (failure) {
    case "network_unreachable":
      return {
        headline: "The network did not answer",
        meaning:
          "DASH could not reach the judging network, so nothing was published and nothing was " +
          "judged.",
        next_action: "Try again in a minute.",
        tone: "err",
      };
    case "faucet_refused":
      return {
        headline: "The network would not set up an account",
        meaning:
          "Judging needs a one-off account on the test network and the network declined to " +
          "create one. Nothing was published.",
        next_action: "Try again in a minute.",
        tone: "err",
      };
    case "transaction_refused":
      return {
        headline: "The network refused the briefing",
        meaning:
          "The network checked the briefing against the fingerprint DASH sent with it and did " +
          "not accept the pair. Nothing was judged.",
        next_action: "Run the agent again and have the new briefing judged.",
        tone: "err",
      };
    case "payload_refused":
      return {
        headline: "DASH will not publish this briefing",
        meaning:
          "DASH could not match this briefing to the list of items it was written from, so " +
          "sending it would mean publishing citations that point at the wrong rows.",
        next_action: "Run the agent again, so the briefing and the list are from one run.",
        tone: "err",
      };
    case "abandoned":
      return {
        headline: "DASH stopped waiting",
        meaning:
          "The briefing was published and the judgement was still running when DASH stopped " +
          "watching it. The judgement may well have finished on the network.",
        next_action: "Ask for it to be judged again.",
        tone: "muted",
      };
  }
}

/**
 * Why DASH would not build a payload, when the surface knows which refusal.
 *
 * Narrower than `payload_refused` above and used before anything is published —
 * on the button, so a person is told *before* they press that this briefing
 * cannot be judged, rather than after.
 */
export function describePayloadRefusal(refusal: PayloadRefusal): string {
  switch (refusal) {
    case "digest_missing":
      return "DASH is not holding the list of items this briefing was written from, so there is nothing to judge it against.";
    case "items_mismatch":
      return "This briefing was written from a different list of items than the one DASH is holding, so its citations cannot be checked.";
    case "nothing_to_judge":
      return "This briefing has no paragraphs in it, so there is nothing for a committee to read.";
    case "citation_unresolvable":
      return "DASH could not line this briefing's citations up with the rows they point at.";
  }
}

/* ---------------------------------------------------------------------- *
 * The receipt
 * ---------------------------------------------------------------------- */

/**
 * The labels on the receipt's rows.
 *
 * A description list, `Receipt`'s own shape on the output card. What is on it is
 * what somebody would need to go and check this themselves — which network,
 * which transaction — and what the network claimed about its own work.
 *
 * The transaction hash is rendered as text and **never as a link**: DASH's
 * window denies every anchor by design, and an address in a receipt beside
 * model-authored prose is the exact thing `buildAdjudicationPayload` refuses to
 * send. A person who wants to look it up copies it.
 */
export const ADJUDICATION_RECEIPT_COPY = {
  network: "Network",
  transaction: "Transaction",
  judged_by: "Judged by",
  when: "Judged",
  /** When the network named no model. Its silence, not DASH's. */
  judged_by_unknown: "The network did not say which model wrote the verdict.",
} as const;

/**
 * Which network a judgement happened on, in words rather than as an endpoint.
 *
 * The row stores the `rpc_url` because that is the fact — a receipt has to say
 * which machine answered — and a person reading their own briefing wants the
 * network's *name*. "GenLayer Studionet" is what DASH ships and can vouch for;
 * anything else is the host of an endpoint somebody typed, and DASH does not
 * claim to know which network that is.
 *
 * The same ruling `resolveGenLayerConnection` makes when it builds
 * `network_label`, restated here because the label is not on the row: a stored
 * name would be a second copy free to disagree with the endpoint beside it, and
 * the endpoint is the thing that is actually true.
 */
export function describeAdjudicationNetwork(rpcUrl: string): string {
  if (rpcUrl === STUDIONET_RPC_URL) {
    return STUDIONET_LABEL;
  }
  try {
    return new URL(rpcUrl).host;
  } catch {
    // A row from a build that stored something else. Shown as it is rather than
    // replaced with a guess — `readRow`'s standing for a value it cannot read.
    return rpcUrl;
  }
}
