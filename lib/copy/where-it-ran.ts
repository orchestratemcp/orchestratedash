/**
 * Which machine a run will use, and which machine a run happened on
 * (MAR-602, ADR 0014).
 *
 * ## The silence this module exists to end
 *
 * MAR-489's attended run put one agent in two places — imported here, deployed
 * to a VPS — and found that nothing on any screen said which of them anything
 * referred to. Pressing Run now started the copy on this computer, produced a
 * digest here, and read exactly like the deployed copy having worked. Finding
 * 30 states the consequence: *"with the agent present in both places, one
 * button silently means the local one, and nothing on screen says which machine
 * a run happened on."*
 *
 * Both halves are here because they are one question asked in two tenses —
 * *which machine will this use* and *which machine did this use* — and the
 * honest answers come from different places, which is the whole difficulty.
 *
 * ## Where each answer is allowed to come from
 *
 * **The future tense is DASH's own decision** and needs no evidence: ADR 0014
 * fixes the copy on this computer as the permanent target of the existing
 * control, so the sentence is derived from the deploy record only to know
 * whether there is a second place worth naming.
 *
 * **The past tense may only come from the pull that produced the run**, and
 * never from the deploy record. ADR 0010 is explicit that a deploy row is
 * evidence DASH sent bytes on a date and is not evidence anything ran — *"this
 * agent is running on marketing-vps"* is on its list of sentences that stay
 * permanently unavailable. So this module reads `evidence_pulls`, which is
 * DASH's record of its own looking, and says nothing a pull cannot support.
 *
 * ## Why the past tense is a statement about the list and not about a row
 *
 * A run's machine of origin is a property of that run, and that is where the
 * fact belongs. DASH does not hold it yet: `runs` has no column for it, because
 * until MAR-602 there was only ever one machine and the question could not be
 * asked. What DASH does hold is every source it has ever pulled from, so the
 * two answers it can give honestly are "every source so far has been this
 * computer, therefore so was every run" and "there is now more than one source
 * and DASH cannot tell you which run came from which".
 *
 * The second sentence is a limit rather than a fact, and it is said out loud
 * rather than papered over with a plausible guess. It is deliberately the
 * *opposite* call to `lib/copy/evidence.ts`'s notice, which sits above the list
 * because it is a claim about which runs exist; this one sits there because
 * DASH's answer is currently only good at list scale, and it stops sitting
 * there on the day a run carries its own origin.
 *
 * ## Rendering rules this file is held to
 *
 * Plain language per `lib/copy/identifiers.ts`: no source ids, no host ids, no
 * route names, no field names. A server's **label** is a name the person chose
 * and is content, in the same category `lib/copy/identifiers.ts` puts a folder
 * the user picked; a host id is not, and never appears in a sentence here.
 */

import type { EvidencePullRecord } from "../store";

/* ---------------------------------------------------------------------- *
 * Future tense — which machine a control will use
 * ---------------------------------------------------------------------- */

/**
 * The one thing this module needs to know about a server an agent was sent to.
 *
 * Structural rather than `AgentDeployTarget` imported from `lib/views/types.ts`,
 * and not for tidiness: that module imports this one for `RunOriginNotice`, and
 * a pair of files that each name the other's types is a cycle a reader has to
 * hold in their head even where the compiler erases it. The narrower shape is
 * also the honest one — nothing about *when* a bundle was sent, or whether it
 * is behind, may reach a sentence about which machine a button will use.
 */
export interface RunTargetPlace {
  /** What the person calls this server. Their words, so it is content. */
  label: string;
}

/**
 * What the run control says about the machine it will use, or null when there
 * is only one machine and naming it would be noise.
 *
 * Null for the overwhelming majority of agents, which live in exactly one
 * place. ADR 0014's rule is that a control says which machine it will use *when
 * an agent exists in two* — a product that appended "on this computer" to every
 * button would be teaching people to read past it by the time it mattered.
 *
 * **It names the control rather than sitting beside it**, and that is why it is
 * a sentence rather than a suffix on the label. A run button is uppercase and
 * letter-spaced, so "Send files and run now on this computer" is a control
 * wearing a sentence; naming "Run now" inside the sentence ties the two
 * together without that, and it leaves room for the second clause.
 *
 * That second clause is DASH admitting a limit and is the load-bearing half.
 * Without it the first sentence reads as a complete account of the options, and
 * a person would reasonably conclude that starting the deployed copy is
 * somewhere else on the page.
 *
 * ## What changed when the route was wired (MAR-602)
 *
 * ADR 0014 wrote both versions of this sentence in advance and said which is
 * true when. The limit — *"DASH cannot start that one yet"* — was the honest
 * wording for the day the ADR landed, and it stopped being true the moment
 * `host.run` had a caller. What replaces it is not a smaller sentence: the
 * second clause still does the load-bearing work, and it is now ADR 0007's pull
 * cost rather than an admission of a missing feature.
 *
 * > Run on Hostinger starts the copy that is there. DASH will show what it did
 * > the next time it can reach that server, and only what the server still has
 * > then.
 *
 * Said **before** the press, for amendment 2's reason — a disclosure that
 * arrives after has told them nothing — and it is why "nothing appeared" reads
 * as the arrangement rather than as a fault.
 */
export function describeRunTarget(targets: readonly RunTargetPlace[]): string | null {
  const labels = targets.map((target) => target.label).filter((label) => label.length > 0);
  if (labels.length === 0) {
    return null;
  }
  const where = joinLabels(labels);
  const starts =
    labels.length === 1
      ? `${describeRunOnHost(where)} starts the copy that is there.`
      : `${labels.map((label) => describeRunOnHost(label)).join(", ")} each start the copy on that server.`;
  return (
    `Run now uses the copy on this computer. ${starts} DASH will show what ` +
    `${labels.length === 1 ? "it" : "they"} did the next time it can reach ` +
    `${labels.length === 1 ? "that server" : "those servers"}, and only what the ` +
    `${labels.length === 1 ? "server" : "servers"} still ${labels.length === 1 ? "has" : "have"} then.`
  );
}

/**
 * What the second control is called.
 *
 * A named action rather than a mode of the first, which is ADR 0014's choice
 * after rejecting "run both", "run the remote when one exists" and "ask each
 * time". The machine is *in the name* here and deliberately not appended to the
 * first button's label — a run button is uppercase and letter-spaced, so
 * "Send files and run now on this computer" would be a control wearing a
 * sentence, while "Run on Hostinger" is four words that say what they do.
 *
 * The label is the person's own word for their server and is content, in the
 * category `lib/copy/identifiers.ts` puts a folder the user picked. A host id
 * never appears here.
 */
export function describeRunOnHost(label: string): string {
  return `Run on ${label}`;
}

/* ---------------------------------------------------------------------- *
 * Past tense — which machine a run happened on
 * ---------------------------------------------------------------------- */

/**
 * What a list of runs may claim about the machines they happened on.
 *
 * Two parts rather than one string, matching `EvidenceNotice`'s shape next
 * door: a headline somebody skims and the meaning underneath it. There is no
 * countable third part, because neither answer this module can give has a
 * number in it.
 */
export interface RunOriginNotice {
  headline: string;
  meaning: string;
  /**
   * True when DASH is naming a limit of its own record rather than stating
   * where the runs happened. Drives emphasis, never colour — the same rule
   * `EvidenceNotice.standing` carries, and for the same reason: an honest
   * caveat rendered as a failure teaches people to ignore failures.
   */
  unknown: boolean;
}

/**
 * Where the runs in this list happened, or null when DASH has never collected
 * anything and so has nothing to go on.
 *
 * Null is not "they all ran here". A store can hold runs that predate DASH ever
 * recording a pull, and a page that read an empty record as a local guarantee
 * would be inventing the one fact this module exists to stop inventing.
 */
export function describeRunOrigin(
  pulls: readonly EvidencePullRecord[],
): RunOriginNotice | null {
  if (pulls.length === 0) {
    return null;
  }

  const remote = pulls.filter((pull) => pull.kind === "another_machine");
  if (remote.length === 0) {
    return {
      headline: "Everything below ran on this computer.",
      meaning:
        "DASH collects what your agents did from the agents it runs here, and from any " +
        "server you have connected. So far it has only ever collected from this computer, " +
        "so every run in this list happened on it.",
      unknown: false,
    };
  }

  return {
    headline: "Some of these ran on a server, and DASH cannot tell you which.",
    meaning:
      `DASH now collects what your agents did from this computer and from ` +
      `${countServers(remote.length)}. It does not yet keep a note of which machine each ` +
      `run happened on, so this list mixes them. Treat the machine as unknown here rather ` +
      `than assuming — DASH would rather say it does not know than guess.`,
    unknown: true,
  };
}

/* ---------------------------------------------------------------------- *
 * Small shared pieces
 * ---------------------------------------------------------------------- */

/**
 * Names in a sentence, as a person would write them.
 *
 * A bare comma-joined list reads as a table someone pasted in. This is the same
 * treatment every other multi-item sentence in `lib/copy/` gets, and it is here
 * rather than at the call site so both tenses join the same way.
 */
function joinLabels(labels: readonly string[]): string {
  if (labels.length === 1) {
    return labels[0] ?? "";
  }
  const last = labels[labels.length - 1] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${last}`;
}

/**
 * How many servers DASH collects from, counted and never named.
 *
 * A count rather than a list of labels, and that is deliberate rather than
 * lazy: the label lives on the host record and the pull record holds only the
 * source it asked, so naming them here would mean this module resolving an
 * identifier into a name — which is a join it should not be doing to write one
 * sentence, and which would put a host id one refactor away from a screen.
 */
function countServers(count: number): string {
  return count === 1 ? "one server you own" : `${String(count)} servers you own`;
}
