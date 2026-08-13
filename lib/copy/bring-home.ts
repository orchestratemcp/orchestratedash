/**
 * What DASH says when an agent comes home from a server (MAR-611, ADR 0017).
 *
 * Separate from `lib/deploy/bring-home.ts` because that module returns facts and
 * this one words them. The split is `lib/copy/evidence.ts`'s and it earns itself
 * here twice over: the sequence has nine ways to stop, each meaning a different
 * next step for the person, and a sequence that composed its own sentences would
 * be a file where a change to a rule and a change to a word look identical in a
 * diff.
 *
 * ## The bound every sentence here is inside
 *
 * ADR 0007's pull cost, ADR 0010's tense, ADR 0015's timestamp. DASH may say
 * what it did and what a server told it; it may never say what is on a server
 * now. So the success sentence below says *what that server still had when DASH
 * looked* rather than "everything it produced" — the second would be a claim
 * about a machine's whole history, and a bounded host buffer means DASH has
 * never been in a position to make one.
 *
 * ## Why the disclosure is a separate function
 *
 * Amendment 2 of ADR 0007: a disclosure that arrives after the act has told them
 * nothing. `describeBringHome` is what goes on screen *beside the control*, and
 * it names the three things a person cannot undo by pressing again — that the
 * agent leaves the server, that DASH will ask where the files go, and that
 * nothing on this computer is deleted. The third is the one Henrik asked for in
 * so many words, and it is the sentence that makes the two-step visible instead
 * of merely true.
 */

import type { BringHomeOutcome, BringHomeStop } from "../deploy/bring-home";

/** What the control says about itself, before anybody presses it. */
export interface BringHomeDisclosure {
  /** One line naming the act. */
  headline: string;
  /** What it will do, in the order it will do it. */
  meaning: string;
  /** The half that is deliberately *not* done. */
  afterwards: string;
}

/**
 * What Bring home will do, said before it is pressed.
 *
 * `label` is the name the person gave the server, which is the only way any
 * sentence here refers to a machine — never an address, never an id.
 */
export function describeBringHome(label: string): BringHomeDisclosure {
  return {
    headline: `Bring this agent home from ${label}.`,
    meaning:
      `DASH copies what the copy on ${label} still has — what it did there, and any files it ` +
      `made — and then removes it from that server. It will ask you where the files should go. ` +
      `If the copy there is not running, DASH starts it for a moment first so it can say what it did.`,
    afterwards:
      "Nothing on this computer is deleted. The agent stays here, with its history, and removing it is a separate step you can take whenever you want.",
  };
}

/**
 * What happened, said afterwards.
 *
 * One function over the whole outcome rather than one per stop, so that adding a
 * `BringHomeStop` without a sentence is a compile error in the switch below
 * instead of a case that renders an empty string on a page nobody tested.
 *
 * The server's own `detail` is appended rather than replaced wherever it exists.
 * The helper distinguishes a bundle that is not installed from a runner that
 * left no way to sign in to it, and those sentences were written on the machine
 * that knows which one is true.
 */
export function describeBringHomeOutcome(outcome: BringHomeOutcome, label: string): string {
  if (outcome.ok) {
    return succeeded(outcome, label);
  }
  const said = outcome.detail === null || outcome.detail.length === 0 ? "" : ` ${outcome.detail}`;
  return `${stopped(outcome.stopped_at, label, outcome.left_behind)}${said}`;
}

function stopped(at: BringHomeStop, label: string, leftBehind: readonly string[]): string {
  switch (at) {
    case "nothing_there":
      return `${label} said it has no copy of this agent. Nothing was changed.`;
    case "could_not_start":
      return `DASH could not get the copy on ${label} running, so it could not ask what it did. Nothing was removed.`;
    case "could_not_sign_in":
      return `DASH could not sign in to the copy on ${label}, so it has taken nothing off that server and removed nothing.`;
    case "could_not_read":
      return `The copy on ${label} did not say what it did, so DASH has taken nothing off that server and removed nothing.`;
    case "outputs_left_behind":
      /*
       * The list is the point. "Some files could not be copied" is a sentence
       * that leaves somebody staring at a server wondering which — and this is
       * the refusal that stands between them and losing the file, so it owes
       * them the name of it.
       */
      return (
        `DASH could not copy everything off ${label}, so it removed nothing. ` +
        `Still on that server: ${leftBehind.join("; ")}.`
      );
    case "cancelled":
      return `Nothing was changed. DASH needs somewhere to put this agent's files before it can take it off ${label}.`;
    case "could_not_save":
      return `DASH could not write this agent's files on this computer, so it removed nothing from ${label}.`;
    case "would_not_stop":
      return `The copy on ${label} would not stop, and DASH will not remove files a running agent is still using.`;
    case "helper_too_old":
      return (
        `Everything was copied home. ${label} was set up with an older copy of DASH's setup step, ` +
        `which cannot remove an agent — so the agent is still there. Run the setup step for this ` +
        `server again, then press this once more.`
      );
    case "could_not_remove":
      return `Everything was copied home, and ${label} would not remove the agent itself, so it is still there.`;
  }
}

function succeeded(
  outcome: Extract<BringHomeOutcome, { ok: true }>,
  label: string,
): string {
  /*
   * "still had when DASH looked", never "everything it did".
   *
   * ADR 0007 chose the pull model knowing its cost: a host's buffer is bounded,
   * `runner/supervisor.ts` drops past that bound, and DASH reads whatever
   * survived until it last looked. This is the sentence where that cost lands on
   * a person, so it is stated rather than rounded up into a reassurance.
   */
  const gone =
    outcome.removed
      ? `This agent is no longer on ${label}.`
      : `This agent is no longer on ${label} — it had already gone from there by the time DASH removed it.`;

  const brought = `Everything that server still had is on this computer now.`;

  if (outcome.files_saved === 0) {
    return `${gone} ${brought} It had no files there to bring back.`;
  }
  const files =
    outcome.files_saved === 1
      ? `Its one file was saved to ${outcome.saved_where ?? "the folder you chose"}.`
      : `Its ${String(outcome.files_saved)} files were saved to ${outcome.saved_where ?? "the folder you chose"}.`;
  return `${gone} ${brought} ${files}`;
}
