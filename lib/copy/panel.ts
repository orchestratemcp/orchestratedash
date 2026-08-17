/**
 * What the declarative panel says, in words (MAR-554, ADR 0008 slice 3).
 *
 * `lib/panel-spec.ts` decides what a panel *is*; `lib/views/panel.ts` decides
 * what DASH can draw from one. This is the third of the three and it holds every
 * fixed string, for the reason `lib/copy/artifacts.ts` states about the Outputs
 * panel: a plain-language test that retyped the sentences would be checking a
 * copy of the copy, which is the exact failure `lib/copy/identifiers.ts` calls
 * "verified by inspection".
 *
 * ## The panel is the author's, and every sentence here is DASH's
 *
 * ADR 0008 puts the whole security argument for the panel on attribution: an
 * author can still *lie* in a `note`, and "the mitigation is attribution, not
 * censorship". So this module holds a hard line that is easy to lose sight of
 * while writing friendly copy — **nothing in here may sound like the agent**.
 * The region's own heading, the empty states, the truncation sentence and the
 * two attribution labels are DASH speaking about a declaration it did not make.
 * The only author strings on the surface are the panel's title, each section's
 * label, a `note`'s text and the values the agent itself produced, and every one
 * of those arrives as data through `lib/views/panel.ts` rather than from here.
 *
 * ## Why an empty section is four sentences rather than a blank
 *
 * MAR-434's rule, inherited verbatim: "a binding with no artifact behind it yet
 * renders a stated empty state, not a blank." A section that vanished when it
 * had nothing in it would leave a reader unable to tell *the agent has not made
 * this yet* from *DASH is not showing me what it made*, and those are very
 * different things to learn about an agent you are deciding to trust.
 *
 * The states are kept apart for the same reason `describeArtifactAvailability`
 * keeps four ways of being gone apart: they are different facts. "Nothing has
 * arrived" and "something arrived and it is not a list of rows" would collapse
 * into one comfortable sentence that is wrong half the time.
 */

import { plainMoment } from "./when";

/**
 * The region's own frame — the header ADR 0008 requires DASH to own.
 *
 * `attribution` is the load-bearing sentence and it says two things on purpose:
 * what is inside (the author's declaration and the agent's output) and what is
 * deliberately outside (DASH's own findings). A reader who takes a `note` for a
 * DASH verdict has been misled by this surface, and this sentence is the whole
 * of what stops that.
 */
export const PANEL_COPY = {
  /** Never the author's words. The eyebrow is what marks the box as theirs. */
  eyebrow: "Declared by this agent’s author",
  /** Used when the author declared no title of their own. */
  heading: "The agent’s own panel",
  attribution:
    "Everything in this box is what the author declared and what the agent itself produced. DASH’s own findings — approvals, compliance and receipts — are outside it.",
} as const;

/**
 * A stated card, in the shape `lib/copy/recovery.ts` established.
 *
 * Three fields rather than one string precisely so a surface cannot render two
 * and drop the third — and the third is always the part that tells a person
 * where they now stand.
 */
export interface PanelCard {
  headline: string;
  meaning: string;
  next_action: string | null;
}

/**
 * A panel written in a version DASH has never heard of.
 *
 * ADR 0008's own sentence, kept as close to the ADR's wording as a rendered
 * string can be: one stated card, "never partially, because a half-drawn panel
 * is a guess rendered as a fact". `PanelResolution`'s `newer_version` case
 * carries no sections at all, so there is nothing here for a renderer to be
 * tempted by — this card is the entire render.
 *
 * There is no next action, and that is honest rather than an omission. Nothing
 * the person can do on this machine turns a newer declaration into one this
 * build can draw, and inventing a step would be sending them somewhere that
 * ends in the same sentence.
 */
export const PANEL_NEWER_VERSION: PanelCard = {
  headline: "This agent’s author declared a panel in a newer format than this DASH can draw.",
  meaning:
    "DASH is showing you that rather than drawing part of it and letting the missing half pass for nothing. Everything else on this page is unaffected.",
  next_action: null,
};

/**
 * A panel DASH cannot read at all.
 *
 * Unreachable through the import doors, which refuse a malformed panel before a
 * row is written. It is here for the document that arrived some other way — a
 * folder edited on disk while DASH was running, a row from a store that has
 * taken damage — and it renders because ADR 0008's rule for two stores that
 * disagree is that the disagreement is **surfaced, never silently repaired**.
 *
 * This one does have a next action, because there genuinely is one: what DASH
 * holds is replaceable by importing the agent again.
 */
export const PANEL_UNREADABLE: PanelCard = {
  headline: "This agent’s author declared a panel DASH cannot read.",
  meaning:
    "Rather than guess at what it was meant to contain, DASH is drawing none of it. Everything else on this page is unaffected.",
  next_action: "Add this agent again to replace what DASH is holding.",
};

/**
 * An agent DASH scaffolded, whose saved document predates the panel (MAR-576).
 *
 * The third member of this family and the only one that renders **outside** the
 * attributed region, because there is no region: the author declared no panel,
 * so `PanelView` is `none` and `AgentPanel` correctly draws nothing at all. This
 * card is DASH speaking in DASH's own voice about DASH's own gap, which is why
 * it sits with the workspace's other notices rather than inside a box marked as
 * somebody else's.
 *
 * ## Why this is not shown for every panel-less agent
 *
 * Most agents declare no panel and most of them never will. For them the
 * absence is a choice, and a notice about it would be DASH nagging an author
 * about a feature they never asked for — the rule that an agent which declared
 * no panel "is not an agent that gets a default one", applied to copy.
 *
 * What makes this case different is that **DASH wrote the document itself**.
 * `agent-kit/scaffold.ts` declares a panel today, so a manifest carrying DASH's
 * own `create-dash-agent` provenance and no panel is a copy of DASH's own
 * template from before the template had one. DASH is not reporting an author's
 * omission here; it is reporting that its own scaffold has moved on — a fact
 * only DASH can know and only DASH can fix.
 *
 * ## The silence it replaces
 *
 * MAR-553's migration deliberately never rewrites an author's manifest, which
 * is the right rule and left this consequence unowned: the one agent DASH ships
 * renders panel-less on every machine that added it before MAR-548, with
 * nothing on screen saying why. That is silent degradation, and it is the same
 * failure `MANIFEST_ONLY_DEPLOY_REFUSAL` refuses on the deploy path — say it
 * plainly, and offer the way forward.
 */
/*
 * ## Short, because it sits above the news
 *
 * The first draft of this card ran to a headline, a five-line explanation, a
 * next action, a button and a four-line reassurance. Rendered at 375px it was
 * 400px tall and it put the first headline 1156px down the page — which is
 * within 10px of where the defect had it. A notice that explains why you cannot
 * see something, by covering it, has not fixed anything.
 *
 * So it is one sentence, and the issue asked for exactly that. Two things paid
 * for the cut and neither is missed:
 *
 * - The old `meaning` ended "everything it has already produced is below, and
 *   none of it has been lost". With the output now directly underneath, that
 *   sentence describes what the reader can already see. Reassurance about a
 *   visible thing is noise.
 * - The old `next_action` said to update it, one line above a button that says
 *   "Update this agent". It is now the way forward for the reader who has *no*
 *   button — a browser tab, or a shell too old to have the command — and
 *   `ManifestGapNotice` renders it only then. Same field, no longer a duplicate.
 */
export const PANEL_PREDATES_CAPABILITY: PanelCard = {
  headline: "This agent was added before DASH could show its own reports.",
  meaning: "Updating it adds the summary a freshly added copy would draw for you.",
  next_action: "Add this agent again from its own folder to bring it up to date.",
};

/**
 * The control beside the card above, and what it promises (MAR-576).
 *
 * `detail` is neither a scare sentence nor a shrug. Re-importing genuinely does
 * replace the saved document, and the two things a person actually worries about
 * — losing what the agent produced, and losing the agent they recognise — are
 * named as surviving, because `importManifest` really does preserve them: its
 * `ON CONFLICT DO UPDATE` deliberately omits `avatar`, and runs, outputs and
 * credentials live in tables it does not touch at all.
 *
 * One line rather than the three it took to say the same thing. It is a caption
 * under a button, not a consent dialog: the action is reversible, nothing leaves
 * this computer, and a paragraph of comfort would be its own kind of alarm.
 */
export const SAMPLE_REFRESH_COPY = {
  action: "Update this agent",
  pending: "Updating…",
  detail: "Keeps its name, its character, everything it has produced and any connected accounts.",
  ok: "Updated. This agent now shows its own report.",
  failed: "DASH could not update this agent, and nothing was changed.",
} as const;

/**
 * Where a metric's number came from, said out loud beside it.
 *
 * ADR 0008 is explicit that collapsing these two "would let an agent's own
 * number wear DASH's voice" — the `stated_at`/`received_at` split applied to a
 * value. So the renderer is handed two different words rather than a flag, and
 * a surface that wanted to drop the distinction would have to delete a visible
 * label rather than merely stop passing a boolean.
 */
export const PANEL_ATTRIBUTION = {
  /** A field of something the agent made. Its claim, not DASH's finding. */
  artifact_field: "The agent’s report",
  /** Something DASH observed for itself and would say with or without the agent. */
  dash_fact: "DASH’s record",
} as const;

/** The one thing a metric says when there is no value behind it. */
export const PANEL_METRIC_EMPTY = "Not reported yet";

/**
 * A cell with nothing in it, named for anything that is not looking at the
 * screen.
 *
 * Drawn as an em dash, because two hundred rows of "Not reported" is a table
 * nobody can read past. The accessible name is the words, because a screen
 * reader announcing "dash" for an absent value has said something about
 * punctuation rather than about the data — and a cell read as silence would be
 * indistinguishable from a cell the reader skipped.
 */
export const PANEL_CELL_ABSENT = "Not reported";

/**
 * Every way a section can have nothing in it, kept apart.
 *
 * `kind` is not rendered; it exists so a test can assert that each case is
 * reachable and that no two of them share a sentence.
 */
export type PanelEmptyKind =
  /** No artifact of the bound role has arrived at all. */
  | "no_artifact"
  /** An artifact arrived and its body is not a list of rows. */
  | "not_rows"
  /** The body is a list and every entry in it was something other than a row. */
  | "no_readable_rows";

export interface PanelEmptyState {
  kind: PanelEmptyKind;
  headline: string;
  meaning: string;
}

/**
 * The only disclosure label admitted inside the author's declared region.
 *
 * ADR 0008 amendment 1 makes the speaker visible in the affordance itself:
 * "DASH" is not implied by colour, placement or a class name. The manifest
 * cannot replace this string, and `StatedEmpty` accepts only DASH's fixed
 * `PanelEmptyState`, so an author cannot borrow the disclosure for their own
 * prompt or make their words look like DASH's explanation.
 */
export const PANEL_EMPTY_DISCLOSURE = "DASH explains this empty section";

/**
 * What the author's section says about an output DASH has already drawn in
 * full on the same stage (MAR-668).
 *
 * ## The duplication two correct rules produced
 *
 * MAR-641 put the author's panel *below* DASH's own record of the same
 * artifacts deliberately — the author gets to present their work — and ADR 0008
 * protects that region from DASH adding controls to it. A well-formed manifest
 * is encouraged to declare a `report` section bound to the role its agent
 * produces. Both of those are right, and together they draw the same briefing
 * twice. On the competitor scout it was three times, because an `outputs`
 * section resolves the same newest artifact a third time: *"Now it renders the
 * output 3 times 😜"*, and Henrik's want is the narrow one — *"I would only
 * want the curated (by AI) newsletter style brief we ask for."*
 *
 * ## Which surface yields, and why it is this one
 *
 * MAR-668 offered three answers. DASH's card yielding was tempting and costs
 * four things the author's region does not have and may not have: the grounding
 * verdict, Save a copy, the developer reference and the link to the producing
 * run. Deleting DASH's own record of an artifact to resolve a duplication would
 * take away the half a person needs in order to *check* the thing they are
 * reading.
 *
 * So the author's section yields the **body** and keeps everything else: its
 * own label, its position, its role and title, and — for anything DASH is not
 * already drawing — the whole card exactly as before. A `metrics`, `table` or
 * `note` section is untouched in every case. What a reader loses is a second
 * copy of a briefing they have just scrolled past.
 *
 * ## Why this sentence may sit inside the author's region
 *
 * It is DASH's, in DASH's own words, naming DASH's own heading. ADR 0008
 * amendment 1 already admits `PANEL_EMPTY_DISCLOSURE` on exactly that footing —
 * a fixed string no manifest can replace, saying something about what DASH is
 * doing rather than about the agent. This is the same kind of thing, and like
 * that one it is read-only: it submits no command and navigates nowhere.
 */
export const PANEL_ALREADY_SHOWN =
  "Shown in full at the top of this page, under Generated assets.";

/**
 * What a `report` or an `outputs` section says when nothing has arrived.
 *
 * Said about the agent, never about the person reading it: an agent that has not
 * produced its output yet is not a user who has done something wrong, and the
 * commonest reason to be looking at this box is that the agent has not been run.
 *
 * **`scoped` is not a nicety.** A `report` is always bound to one named role and
 * an `outputs` section declaring no `artifact_role` is bound to *every* role, so
 * one sentence covering both would tell the reader of an unscoped section that
 * the author picked a kind of output — which they did not, and which sends
 * somebody looking for a filter that is not there. The distinction costs a
 * boolean and the wrong version of it is a small lie on the surface DASH's whole
 * argument is about not telling.
 */
export function describeEmptyOutputSection(scoped: boolean): PanelEmptyState {
  return {
    kind: "no_artifact",
    headline: "Nothing has arrived for this section yet.",
    meaning: scoped
      ? "The author bound it to one kind of output, and this agent has not produced that kind yet. It fills in the next time it does."
      : "It shows everything this agent makes, and it has not made anything yet. It fills in the first time it does.",
  };
}

/**
 * What an empty `table` says, and the three of them are different facts.
 *
 * MAR-554's own bar — "an empty table says in plain language what would fill
 * it" — is met by the second sentence of each, and the split exists because a
 * single "this table is empty" would be true in all three cases and useful in
 * none. The middle one in particular is a fact about the *agent's output shape*
 * and is the one a person building an agent needs to be told.
 */
export function describeEmptyTable(kind: PanelEmptyKind): PanelEmptyState {
  switch (kind) {
    case "no_artifact":
      return {
        kind,
        headline: "This table has no rows yet.",
        meaning:
          "Its rows come from an output this agent has not produced yet. It fills in the next time the agent makes one.",
      };
    case "not_rows":
      return {
        kind,
        headline: "The agent’s latest output for this table is not a list of rows.",
        meaning:
          "DASH keeps it and shows it elsewhere on this page. It is not drawn here, because a table built out of something that is not a list would be a shape DASH invented.",
      };
    case "no_readable_rows":
      return {
        kind,
        headline: "The agent’s latest output for this table has a list in it, and nothing in that list is a row.",
        meaning:
          "A row is a set of named values. DASH draws the ones it can read and says so when there are none, rather than filling a table with blanks.",
      };
  }
}

/**
 * The row cap, stated (ADR 0008).
 *
 * "Rows past 200 are truncated **with the count stated**, because a silent cap
 * reads as a complete record." That last clause is the whole reason this
 * function exists rather than a `slice` in the renderer: the number a person
 * needs is the one they are *not* being shown.
 *
 * Plain digits with no thousands separator on purpose. `toLocaleString` answers
 * differently depending on the machine's locale, which would make the same panel
 * render two ways and make a render test assert nothing — the same argument
 * `lib/copy/when.ts` makes about relative time.
 */
export function describeRowCap(shown: number, total: number): string | null {
  if (total <= shown) {
    return null;
  }
  return `Showing the first ${String(shown)} of ${String(total)} rows.`;
}

/**
 * Entries in the list that were not rows, counted rather than dropped quietly.
 *
 * MAR-507's rule is that an entry missing what it needs is dropped rather than
 * rendered with a stand-in, and that is what happens. What that rule does not
 * license is dropping it *silently*: a table that quietly rendered nine of
 * twelve entries would read as a complete record of nine.
 */
export function describeSkippedRows(skipped: number): string | null {
  if (skipped <= 0) {
    return null;
  }
  return skipped === 1
    ? "One entry in that list was not a row, so it is not drawn."
    : `${String(skipped)} entries in that list were not rows, so they are not drawn.`;
}

/**
 * An `outputs` section that has more behind it than its author asked to show.
 *
 * The author's own `max_items` is a display choice rather than a limit on what
 * exists, so the cap is stated the same way the row cap is. Where the rest of
 * them can be read is named, because otherwise this sentence tells a person
 * something is missing and leaves them there.
 */
export function describeOutputsCap(shown: number, total: number): string | null {
  if (total <= shown) {
    return null;
  }
  return `The author chose to show ${String(shown)} of ${String(total)}. The rest are in this agent’s outputs.`;
}

/**
 * The last run's outcome, as a fact DASH observed.
 *
 * `failed` becomes "Did not finish" rather than anything sharper. This value
 * renders **inside the author's panel**, and a red-sounding word in a box the
 * author controls the framing of is the one place DASH's own alarm could be
 * borrowed by somebody else's copy. DASH's verdict surfaces are outside the box
 * and stay as loud as they are.
 */
export function describeRunVerdict(status: string | null): string | null {
  switch (status) {
    case "completed":
      return "Finished";
    case "failed":
      return "Did not finish";
    case "running":
      return "Running now";
    default:
      // Includes null — no run yet — and any status a later build adds. Both
      // render as the metric's own empty state, which is true in both cases.
      return null;
  }
}

/**
 * A moment DASH recorded, in DASH's own words.
 *
 * Routed through `plainMoment` rather than rendered as stored: MAR-533 found
 * `2026-08-07T13:58:28.037Z` on the Connections page and named it the same
 * failure as a raw identifier — "a person who has to read a machine's own
 * spelling of something has been handed the machine's problem". A `dash_fact`
 * is DASH's to word, so DASH words it.
 */
export function describeFactMoment(iso: string | null): string | null {
  return iso === null ? null : plainMoment(iso);
}
