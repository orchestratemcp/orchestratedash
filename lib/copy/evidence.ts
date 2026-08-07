/**
 * What the Runs page is allowed to claim about its own completeness (MAR-488).
 *
 * ## The sentence this module exists to stop
 *
 * A list of runs reads as *the* list of runs. It is not, and on a host it is
 * furthest from it: a deployed agent keeps working while DASH is closed, its
 * runner holds evidence in a **bounded buffer**, and DASH sees whatever is left
 * when it next happens to look. MAR-488 states the consequence plainly — on a
 * host running a week against a DASH opened on Sundays, *dropped is the ordinary
 * case*.
 *
 * ## Why a zero is not silence
 *
 * The tempting design is to say nothing when nothing was dropped. That would
 * make the notice a **fault report**, and it is not one: the count is what DASH
 * happens to know it lost, and the things it cannot know it lost are exactly the
 * ones the sentence is about. A user administers the host; they may delete the
 * evidence directory, the disk may fill, the runner may be restarted. None of
 * that increments a counter.
 *
 * So for a runner on another machine the notice is **unconditional**, and the
 * counts are additional detail rather than its reason for existing. For the
 * runner on this machine it is conditional, and the asymmetry is the honest one:
 * DASH spawned that process, it dies when DASH's own installer says so, and its
 * buffer overflowing is a real, bounded, reportable event rather than a standing
 * uncertainty.
 *
 * That is the same distinction ADR 0005 draws between a decision DASH made and
 * an attempt nobody adjudicated, pointed at a record instead of at a request.
 *
 * ## Rendering rules this file is held to
 *
 * Plain language, per `lib/copy/identifiers.ts`: no route names, no `dropped`,
 * no source ids. `tests/evidence-copy.test.ts` sweeps every sentence this module
 * can produce, derived from the union rather than from a list somebody
 * maintains, so a kind added without being described is still seen.
 */

import type { EvidencePullRecord } from "../store";

/**
 * What a page shows above a list of runs, or null when there is nothing
 * qualified to say.
 *
 * Three parts rather than one string, matching `Recovery`'s shape in
 * `lib/copy/recovery.ts`: a headline somebody skims, the meaning underneath it,
 * and — where DASH has one — a fact with a number in it. The third is separate
 * so a renderer can set it in `--font-mono` (it is a value) while the first two
 * stay prose.
 */
export interface EvidenceNotice {
  headline: string;
  meaning: string;
  /**
   * The countable part, or null. Null is the common case and does not weaken
   * the two sentences above — see the note about zeros at the top of this file.
   */
  detail: string | null;
  /** When DASH last looked, ISO-8601. The renderer decides how to say it. */
  last_looked_at: string;
  /**
   * True when this is a standing limit of the arrangement rather than something
   * that went wrong. Drives emphasis, never colour: a permanent honest caveat
   * must not render in the same red as a failure.
   */
  standing: boolean;
}

/**
 * The notice for one set of pulls, or null.
 *
 * Takes every source rather than one, because a person reading Runs is reading
 * one list containing runs from everywhere. Where several sources have
 * something to say, the **oldest look** decides the timestamp: "DASH last
 * looked" is only true of a list if it is true of every source in it, and
 * quoting the most recent would be the flattering answer.
 */
export function describeEvidenceRecord(
  pulls: readonly EvidencePullRecord[],
): EvidenceNotice | null {
  const speaking = pulls.filter((pull) => worthSaying(pull));
  if (speaking.length === 0) {
    return null;
  }

  const remote = speaking.filter((pull) => pull.kind === "another_machine");
  const oldest = [...speaking].sort((a, b) => a.observed_at.localeCompare(b.observed_at))[0];
  const lost = speaking.reduce(
    (total, pull) => total + pull.telemetry_dropped + pull.artifacts_dropped,
    0,
  );
  const unreachable = speaking.filter((pull) => !pull.reached).length;

  if (remote.length > 0) {
    return {
      headline: "This is what the servers still had when DASH last looked.",
      meaning:
        "Agents on a server you own keep working while DASH is closed. The server holds " +
        "only so much of what they did, and DASH can show you what was still there when it " +
        "last asked — not everything that happened in between. Nothing here is a fault; it " +
        "is how much DASH can honestly promise about a computer it does not run.",
      detail: countSentence(lost, unreachable),
      last_looked_at: oldest?.observed_at ?? "",
      standing: true,
    };
  }

  return {
    headline: "Some of what your agents did was gone before DASH read it.",
    meaning:
      "Agents keep a limited amount of recent activity for DASH to collect, and DASH " +
      "collects it while it is open. When more happens than that limit holds, the oldest " +
      "goes first. The runs below are real and complete in themselves; the list of them is " +
      "not necessarily every run.",
    detail: countSentence(lost, unreachable),
    last_looked_at: oldest?.observed_at ?? "",
    standing: false,
  };
}

/**
 * Whether one source has anything to say.
 *
 * A remote one always does. A local one does when something was actually lost,
 * or when DASH could not reach it at all — an unreachable runner means the list
 * is as old as the last successful look, which is a different claim from "there
 * were no runs".
 */
function worthSaying(pull: EvidencePullRecord): boolean {
  if (pull.kind === "another_machine") {
    return true;
  }
  return (
    !pull.reached ||
    pull.telemetry_dropped > 0 ||
    pull.artifacts_dropped > 0 ||
    pull.workspace_truncated
  );
}

/**
 * The countable half, or null.
 *
 * "At least", always, and it is not hedging: the number is what DASH's sources
 * told it they threw away, which cannot include anything thrown away by
 * something that never reported. A bare count would read as the size of the gap.
 */
function countSentence(lost: number, unreachable: number): string | null {
  const parts: string[] = [];
  if (lost > 0) {
    parts.push(
      `At least ${String(lost)} piece${lost === 1 ? "" : "s"} of activity ` +
        `w${lost === 1 ? "as" : "ere"} discarded before DASH could read ${lost === 1 ? "it" : "them"}.`,
    );
  }
  if (unreachable > 0) {
    parts.push(
      unreachable === 1
        ? "One place DASH collects from did not answer the last time it asked."
        : `${String(unreachable)} places DASH collects from did not answer the last time it asked.`,
    );
  }
  return parts.length === 0 ? null : parts.join(" ");
}
