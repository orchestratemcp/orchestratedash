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
/* A value import, and safe for the same reason `app/_components/digest.tsx`'s
   is: `lib/copy/when.ts` has no imports at all, so it reaches no Node builtin
   and drags nothing into the renderer bundle — the rule
   `tests/client-bundle.test.ts` enforces over everything reachable from `app/`. */
import { plainMoment } from "./when";

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
  /*
   * The provenance receipt's disclosure label (MAR-576).
   *
   * The receipt used to sit between the card's title and the output itself, so
   * the first four facts under "News from 3 sources" were a name, two timestamps
   * and a byte count — and on a 375px viewport the first headline began 1166px
   * down an 812px screen. That is exactly the shape of the report this issue was
   * filed on: "I get no AI news from it. Only some text about that it ran."
   *
   * Worded as a question about DASH rather than about the output, because that
   * is what is inside it: `Made by`, the agent's own time, when it reached DASH
   * and the size DASH stored. Every one of those is custody, not content.
   */
  receipt_summary: "How DASH got this",
  receipt: {
    agent: "Made by",
    stated_at: "The agent’s own time",
    received_at: "Reached DASH",
    size: "Size stored",
  },
} as const;

const HISTORY_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
});

const HISTORY_DAY_WITH_YEAR = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * A short date for navigating an agent's older outputs (MAR-622).
 *
 * This is deliberately relative only for Today and Yesterday. The label is
 * navigation, not evidence: the exact, absolute agent and DASH times remain in
 * the receipt. Taking `today` as data keeps render tests deterministic while
 * production uses this computer's local calendar, as every other DASH date
 * does.
 */
export function describeArtifactHistoryDay(generatedAt: string, today = new Date()): string {
  const made = new Date(generatedAt);
  if (Number.isNaN(made.getTime()) || Number.isNaN(today.getTime())) {
    return "Earlier output";
  }

  const calendarDay = (value: Date): number =>
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
  const daysAgo = calendarDay(today) - calendarDay(made);

  if (daysAgo === 0) {
    return "Today";
  }
  if (daysAgo === 1) {
    return "Yesterday";
  }
  if (made.getFullYear() === today.getFullYear()) {
    return HISTORY_DAY.format(made);
  }
  return HISTORY_DAY_WITH_YEAR.format(made);
}

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
  | "deleted"
  /**
   * DASH copied it off a server and then removed the server's copy (MAR-611).
   *
   * Not a failure, and the only member here that is not. It still returns a
   * notice rather than null, for the reason `downloadable` is computed from
   * `recovery === null`: the bytes are genuinely no longer anywhere DASH can
   * reach, so an enabled Save button would be a control that cannot work. The
   * notice's job is to say where the file actually went.
   */
  | "brought_home";

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

    case "brief":
      return {
        label: "Briefing",
        // Says what it is *about* as well as what it is, because a run now
        // produces two outputs and the pair only makes sense together: this
        // one is written, the roundup beside it is everything collected.
        // ADR 0025 amendment 1 is the reason there are two — Henrik's "one RAW
        // and one curated", and a label that said only "Briefing" would leave
        // a reader wondering which of the two cards they were looking at.
        purpose: "Written up from everything this agent collected on this run.",
        // True since MAR-674 packet 3: `BriefBody` draws it, in both
        // renderers. It was false for exactly one packet, during which a brief
        // showed the "Show what arrived" disclosure rather than an empty pane.
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

    case "brought_home":
      return {
        // Present tense about a folder on this computer is safe in a way present
        // tense about a server never is — this is the one recovery whose subject
        // is a place the person chose and DASH wrote to.
        headline: `${title} was made on a server and came home.`,
        meaning:
          "DASH saved it to the folder you picked when you brought this agent home, then took the agent off that server. The record stays here; the file itself is yours now.",
        next_action: "Look for it in the folder you chose.",
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

/**
 * A receipt's moment, in DASH's words rather than the machine's (MAR-548).
 *
 * **Found by a proof rather than by reading.** MAR-548's smoke check 6o asserts
 * that no `YYYY-MM-DDTHH:MM:SS.sssZ` reaches the declarative panel, and it went
 * red on the receipt — `stated_at` and `received_at` were interpolated exactly
 * as stored, sitting beside a `size` that `describeRecordSize` has worded since
 * MAR-434. One field in a struct being raw while its sibling is worded is an
 * oversight rather than a decision, and this is that oversight closed.
 *
 * Three surfaces from one place, because `buildArtifactCards` feeds all of them:
 * the run detail page, the workspace Outputs area, and the panel's `report` and
 * `outputs` sections. It is MAR-571's fix pointed at the other value in the same
 * card — that one was the digest item's `published_at`, this is the receipt
 * around it — and both are MAR-533's rule, which `lib/copy/when.ts`'s own header
 * states: a timestamp with a `T` and a `Z` in it is the same failure as a raw
 * identifier, because a person made to read a machine's spelling of something
 * has been handed the machine's problem.
 *
 * **The two moments stay two.** `stated_at` is the agent's claim and
 * `received_at` is DASH's record, and wording them changes how each reads and
 * not which is which — a receipt that collapsed them would be the promotion the
 * labels in `OUTPUTS_PANEL_COPY.receipt` exist to prevent.
 *
 * Unreadable becomes `"unknown"` rather than the input, which is
 * `describeRecordSize`'s answer four lines up for the same slot and the same
 * reason: a value that cannot be computed is absent, and `lib/copy/when.ts`'s
 * rule is that no function there ever hands its input back to the screen.
 */
export function describeReceiptMoment(iso: string): string {
  return plainMoment(iso) ?? "unknown";
}
