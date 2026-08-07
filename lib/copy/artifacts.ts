/**
 * What a run produced, in words (MAR-434).
 *
 * MAR-457 built the artifact seam and proved it: a run's output reaches DASH,
 * is stored under the stable `(agent, run, artifact)` triple, and is drawn on
 * the run detail page. What it did not build is the vocabulary for talking
 * about an output as a *thing a person owns* — what it is for, where it came
 * from, and what to do when it is not there any more.
 *
 * ## Roles, not kinds
 *
 * `RunArtifact.kind` is the producer's word, and it is one of DASH's internal
 * names. A person reading a run wants to know "is this the summary or the
 * reply?", which is a question about purpose. `describeArtifactRole` answers
 * that and never renders the kind itself — see `lib/copy/identifiers.ts`, which
 * forbids exactly this class of leak.
 *
 * It takes a `string` rather than the `RunArtifact["kind"]` union on purpose.
 * An artifact whose kind this build has never heard of must render as *an
 * output DASH cannot show* rather than crash the page a user is looking at, and
 * a narrowed parameter would make that unrepresentable at the call site while
 * leaving it perfectly possible at runtime — the schema and the union are two
 * different authorities, and only one of them ships in the renderer.
 *
 * ## The four ways an output can be gone
 *
 * `lib/copy/recovery.ts` keeps missing, locked, revoked and expired
 * credentials apart because *they lead somewhere different*. The same argument
 * decides this module, and the temptation it exists to resist is the single
 * "this output is unavailable" state that covers all four and helps nobody.
 *
 * Four states, four next actions, and none of them is interchangeable:
 *
 * - **Missing** — the record is here and the contents never arrived. Running
 *   the agent again is the whole recovery.
 * - **Moved** — it exists, somewhere else. Running the agent again is the
 *   *wrong* advice: it leaves the person with two, and the one they were
 *   looking for is still lost.
 * - **Quarantined** — security software on this machine took it. Running the
 *   agent again produces another one that is taken the same way, so the
 *   recovery is not in DASH at all.
 * - **Deleted** — somebody removed it on purpose, and that somebody was
 *   probably the user. This is the one that must never read as a fault. The
 *   next action is conditional for the same reason `describeAuthorizationFailure`
 *   refuses to treat a cancelled sign-in as an error: telling a person to
 *   re-make the thing they just chose to throw away is arguing with them.
 *
 * Only the first of those four has a producer in DASH today, and none of them
 * has one that watches a file. That is recorded in MAR-434 rather than implied
 * away here: the vocabulary is written before the workspace that would populate
 * it, exactly as `describeConnectionCondition`'s revoked sentence was written
 * before anything could produce the condition.
 */

import type { Recovery } from "./recovery";

/**
 * The panel's own fixed words.
 *
 * Here rather than inline in the component so that the plain-language test
 * asserts the strings the panel actually renders. A test that retyped them
 * would be checking a copy of the copy, which is the exact failure
 * `lib/copy/identifiers.ts` calls "verified by inspection".
 *
 * The receipt labels name *whose* fact each row is. "The agent's own time"
 * beside "Reached DASH" is the whole point of showing two timestamps: one is a
 * claim and the other is DASH's record, and a single "Created" would quietly
 * promote the first into the second.
 */
export const OUTPUTS_PANEL_COPY = {
  heading: "Outputs",
  empty: "This run produced nothing.",
  reveal: "Show what arrived",
  /*
   * "Save a copy", not "Download" (MAR-434).
   *
   * Download is what a browser does from somewhere else. This file is already
   * on this computer — the runner is holding it in a folder the agent cannot
   * reach — and what the button does is put a copy where the person can get at
   * it. Saying "download" would describe a journey across a network that is not
   * happening, and would quietly suggest the output has been somewhere else.
   */
  download: "Save a copy",
  developer_summary: "Reference for developers",
  receipt: {
    agent: "Made by",
    stated_at: "The agent’s own time",
    received_at: "Reached DASH",
    size: "Size stored",
  },
} as const;

/**
 * Whether the thing itself is still here.
 *
 * `available` is a member rather than an absence so that a caller has to name
 * the healthy case, and so the union can be exhaustively switched. The
 * describe function still returns `null` for it — a healthy output is not a
 * failure state, and a surface that rendered a recovery for one would be
 * teaching people to ignore recoveries.
 */
export type ArtifactAvailability =
  | "available"
  | "missing"
  | "moved"
  | "quarantined"
  | "deleted";

export interface ArtifactRole {
  /** What it is, in the user's terms. A short noun phrase, sentence case. */
  label: string;
  /** What it is for. One sentence, and never a description of the format. */
  purpose: string;
  /**
   * Whether DASH can show the thing itself.
   *
   * False means *show the facts and offer to reveal it*, never a preview pane
   * with an apology in it. A surface that renders an empty frame where a
   * preview goes has told the user their output is broken, when the truth is
   * only that this build does not know the shape of it.
   */
  previewable: boolean;
}

/**
 * What kind of thing this is, for somebody who did not write the agent.
 *
 * The fallback is the interesting branch. It says what DASH knows (an output
 * arrived, and it belongs to this run) and declines to guess at the rest,
 * which is the same shape of answer `describeConnectionCondition("unknown")`
 * gives — "it may be fine" beats a confident wrong sentence.
 */
export function describeArtifactRole(kind: string): ArtifactRole {
  switch (kind) {
    case "digest":
      return {
        label: "Summary",
        purpose: "A roundup the agent gathered and wrote for you to read.",
        previewable: true,
      };

    case "draft":
      return {
        label: "Draft reply",
        // Says the safeguard in the role itself, because the role is what a
        // person reads in a list before they open anything. The panel repeats
        // it at more length; neither placement is redundant, because the list
        // is where somebody decides whether to worry.
        purpose: "A message the agent wrote for you. Nothing has been sent.",
        previewable: true,
      };

    default:
      return {
        label: "Output",
        purpose:
          "Something this agent made. This version of DASH does not know how to show it, so it is kept as it arrived.",
        previewable: false,
      };
  }
}

/**
 * What to say when an output is not where it should be, or null when it is.
 *
 * `title` is the agent's own name for the output — the user's words by way of
 * the agent, and the only handle they have on which one this is. Nothing
 * derived from DASH's internal record appears in any of these sentences.
 */
export function describeArtifactAvailability(
  availability: ArtifactAvailability,
  context: { title: string },
): Recovery | null {
  const { title } = context;

  switch (availability) {
    case "available":
      return null;

    case "missing":
      return {
        headline: `DASH has a record of ${title}, but not the thing itself.`,
        meaning:
          "The run finished and said it made this, and the contents never arrived. Everything else on this page is complete.",
        next_action: "Run the agent again to make a fresh one.",
        actor: "user",
      };

    case "moved":
      return {
        headline: `${title} is not where DASH left it.`,
        meaning:
          // The sentence that stops the wrong recovery. Somebody who is told
          // to re-run ends up with two copies and still cannot find the one
          // they wanted, which is worse than being told nothing.
          "Something on this computer moved or renamed it after the run finished. It still exists, so making another one would leave you with two.",
        next_action: "Look for it where it was moved to.",
        actor: "user",
      };

    case "quarantined":
      return {
        headline: `Security software on this computer took ${title} away.`,
        meaning:
          "It is not lost, and it is not DASH's to hand back. Making another one would most likely produce a file that is taken in the same way.",
        // Outside DASH, and said plainly rather than dressed up as something
        // this page can do. `describeSecureStoreFailure` sends people to their
        // keyring on the same principle.
        next_action: "Release it in your security software, then reopen DASH.",
        actor: "user",
      };

    case "deleted":
      return {
        headline: `${title} was deleted.`,
        meaning:
          "Someone removed it on purpose — that may well have been you. DASH keeps no second copy, so there is nothing to put back.",
        // Conditional, and deliberately so. This is the one state that is
        // somebody's decision rather than a fault, and the copy does not
        // second-guess it.
        next_action: "Run the agent again if you want a new one.",
        actor: "user",
      };
  }
}

/**
 * How big the record is, as a value a person can read.
 *
 * This measures **what DASH is holding**, which is the only size DASH can
 * honestly report: the artifact is stored as the body the agent sent, and no
 * file on disk is being consulted. The receipt labels it accordingly.
 *
 * Decimal units rather than binary ones, because the audience is a person
 * looking at a summary and not somebody counting blocks.
 */
export function describeRecordSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    // Never a negative or a NaN in a slot the design gives a monospace face to.
    // A value that cannot be computed is absent, not zero.
    return "unknown";
  }
  if (bytes < 1000) {
    return bytes === 1 ? "1 byte" : `${String(Math.round(bytes))} bytes`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1000).toFixed(1)} kB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
