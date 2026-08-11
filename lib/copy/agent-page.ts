/**
 * Every word the rebuilt agent page says about itself (MAR-609).
 *
 * ## Why this module exists at all
 *
 * Henrik's verdict on the old page was *"still very cluttred. Lots of random
 * text"* and, the sentence that actually names the defect, *"you get no
 * overview."* The page explained itself at length in prose written inline in
 * `app/agents/detail/page.tsx`, which is exactly how it got that way: a
 * paragraph added beside the feature it describes is a paragraph nobody ever
 * reads next to the eleven others.
 *
 * Putting the strings here does two things beyond tidiness. It makes the total
 * volume of prose on the page *countable* — the thing being complained about is
 * a quantity, and a quantity spread across a 1500-line component cannot be
 * seen. And it puts the page's copy where the guided-path gate can reach it:
 * `tests/copy-agent-page.test.ts` asserts every string here against
 * `lib/copy/identifiers.ts`, which is the rule that no raw identifier reaches a
 * surface a normal person reads.
 *
 * ## The rule these strings are written to
 *
 * **A label names a thing; it does not explain the thing.** The old page had a
 * sentence under every control justifying the control. Where an explanation is
 * genuinely owed it now sits behind the disclosure that shows the detail, so
 * the person who wants it finds it and the person who does not is not charged
 * for it on every visit.
 */

/** The identity block at the top, and the controls beside it. */
export const AGENT_HEADER_COPY = {
  /** Above the name. Replaces the old "Agent workspace" eyebrow. */
  eyebrow: "Agent",
  refresh: "Refresh",
  settings: "Settings",
  /**
   * The label on the id chip beside the name (MAR-589).
   *
   * The id is a *value* under the ruling, so it renders in a monospace slot
   * with a word in front of it saying what it is. Without the word a slug
   * beside a name reads as a second name.
   */
  id_label: "ID",
  /** Announced while DASH is following a run. `{time}` is a clock time. */
  following: (time: string): string => `Following this run. Updated ${time}.`,
} as const;

/**
 * The control panel — Henrik's *"controlpanel to start, pause, check status"*.
 *
 * The three verbs are not invented here. `pause`, `resume` and `cancel` already
 * arrive per run as `WorkspaceRunView.controls`, worded by the agent's own
 * state machine, and this page hoists them next to Run now rather than leaving
 * them inside a run card five sections down. What this module adds is only the
 * words for the states where there is *no* control, which is the state a new
 * agent is in and the one the old page said nothing at all about.
 */
export const AGENT_CONTROL_COPY = {
  heading: "Controls",
  run_now: "Run now",
  run_now_with_files: "Send files and run now",
  running: "Starting…",
  /**
   * The pressed state of a per-server run button (MAR-602).
   *
   * "Asking…" rather than "Starting…", and the difference is ADR 0014's: DASH
   * asks a machine it does not own to start something, and what comes back is
   * that the request was accepted. Saying "Starting" would claim an outcome
   * DASH did not observe.
   */
  asking: "Asking…",
  /**
   * What the panel says when there is nothing to press, per reason.
   *
   * Every one of these is a state the old page rendered as *empty space*:
   * `RunNow` returned null for a missing snapshot and for a missing pending
   * task alike, so a freshly added agent showed no run control and no
   * explanation of why. A control surface whose controls silently vanish is the
   * opposite of a control surface.
   */
  idle: {
    /**
     * No Agent DOM snapshot has arrived. The state every new agent is in.
     *
     * **"on this computer" is load-bearing and was added after MAR-602's
     * per-server buttons moved into this panel.** Without it the panel could
     * read "DASH has nothing to start" directly under a *Run on Hostinger*
     * button, which is a flat contradiction: these three sentences are all
     * about the local run, and a remote one needs neither a snapshot nor a
     * pending task. ADR 0014's rule that a control names its machine, applied
     * to the sentence where a control is absent.
     */
    not_reported:
      "This agent has not reported its state yet, so DASH has nothing to start on this computer.",
    /** A snapshot, but no task waiting to be run. */
    nothing_waiting: "Nothing is waiting to be run on this computer.",
    /** The window cannot act — a browser tab rather than the installed shell. */
    read_only: "This window can show this agent but cannot control it.",
  },
  /** Under the buttons. The one sentence about cadence, said once. */
  manual_note: "It runs only when you ask. Nothing happens on a timer.",
} as const;

/**
 * The four tiles, reusing MAR-570's Connections move.
 *
 * That issue turned per-agent connection cards into service tiles with the
 * capability card as *the receipt one click away*, against the same complaint
 * in the same words — *"cluttered and a lot of text."* The shape transfers
 * exactly: the tile answers the question, the disclosure holds the paperwork.
 *
 * Four and not more. Each is a question a person actually asks about an agent
 * they are looking at, and a fifth tile would be a row of chips nobody reads.
 */
export const AGENT_TILE_COPY = {
  /*
   * There is no `status` label here and there was one until the first capture.
   * The frame showed a Status tile reading "Not reported" a few hundred pixels
   * under a status pill reading NOT REPORTED — one fact, twice, on the page
   * whose complaint is redundant text. The pill kept it: it is in the header
   * beside the controls the status governs, and it renders in every state
   * including the ones with no snapshot at all.
   */
  trigger: "Starts when",
  model: "Model",
  where: "Runs on",
  /** The disclosure under the tiles. */
  details_summary: "Show the full record",
  /**
   * The model tile's value in the three cases where it is not a model id.
   *
   * `AgentModelSettingsView` words its `headline` as a whole sentence —
   * "Connect your OpenRouter key to choose a model" — which is right for the
   * picker's own heading and far too long for a tile. These are the same three
   * facts at tile length. They are here rather than derived from the headline
   * because truncating somebody else's sentence is how a surface ends up
   * asserting half a claim.
   */
  model_value: {
    /** `no_model_needed`: the plan is all fixed steps. */
    none: "None needed",
    /** A model is required and DASH cannot pick or hold one. */
    unavailable: "Not set",
    /** A choice exists and no single model overrides the per-step levels. */
    per_step: "Matches each step",
  },
  /** The trigger tile, when the agent's manifest declares nothing. */
  trigger_default: "On command",
  /** The "Runs on" tile, when there is no snapshot to name a runtime. */
  where_unknown: "Not reported",
} as const;

/**
 * The trigger switcher — Henrik's *"switch trigger. Trigger on command or set a
 * time or how often it should trigger."*
 *
 * ## What this is allowed to offer, and why it is one option
 *
 * ADR 0014 weighed trigger configuration and declined it, in terms this module
 * has to respect rather than reinterpret: *"Trigger configuration — 'on
 * command, at a time, on an interval' — is a separate decision and a larger
 * one. It is blocked on restart-on-boot, which ADR 0007 left open on purpose,
 * and it needs a scheduler that exists nowhere in this repository."*
 *
 * So there is no schedule executor behind this control and this page does not
 * build one. What it does instead is the honest half that was missing: the old
 * page printed a `trigger_label` in a definition list two thirds of the way
 * down and offered nothing, so a person who wanted to change it had no idea
 * whether DASH could. Now the choice is *shown* — on command, at a time, on an
 * interval — with the two DASH cannot honour marked as not built and saying
 * what they are waiting on.
 *
 * **A disabled radio is not a dead control here, and the distinction matters.**
 * `lib/workspace.ts`'s rule is about buttons that would fire nothing while
 * looking like they would fire something. These are the opposite: they are the
 * page telling the truth about a capability the product does not have, which is
 * information, and hiding them would leave the person believing DASH had
 * silently ignored the ask.
 */
export const AGENT_TRIGGER_COPY = {
  heading: "When this agent starts",
  on_command: {
    label: "On command",
    detail: "You press Run now. This is the only way DASH starts an agent today.",
  },
  at_a_time: {
    label: "At a set time",
    detail: "Not built yet. DASH has no scheduler, and nothing would start it while DASH is closed.",
  },
  on_an_interval: {
    label: "Every so often",
    detail: "Not built yet, for the same reason as a set time.",
  },
  /**
   * What the agent's own manifest says, when it disagrees with what DASH can
   * do. An author may declare a schedule; DASH still only starts on command,
   * and the page says both rather than picking the flattering one.
   */
  declared: (label: string): string => `This agent's author describes its trigger as “${label}”.`,
  declared_conflict:
    "DASH starts it on command regardless. Nothing in DASH runs it on a timer.",
} as const;

/**
 * The settings drawer — Henrik's *"settings button. Swap notification channel,
 * avatar, name etc"*.
 *
 * ## Three of the named items cannot be written from here, and it says so
 *
 * This is the honest shape rather than the asked-for one, and the gap is worth
 * stating plainly because it is not a design preference:
 *
 * - **Name.** MAR-589's ruling makes the display name first-class, and the
 *   `agents` table has no column for one — the name shown is the *author's*
 *   `display_name` off the manifest. Renaming needs a migration and a write
 *   path.
 * - **Avatar.** Per-agent avatar choice is MAR-615's second piece, filed with
 *   the animation work by Henrik's own request for a dedicated session.
 * - **Notification channel.** DASH has one Discord webhook for the whole
 *   product, not one per agent — `NotificationsView` carries `configured`,
 *   `send_approvals`, `send_reports` and no agent at all. So there is no
 *   per-agent channel to swap; there is a global one to open.
 *
 * Each therefore renders as a read-only row that names where the value comes
 * from and where it is changed. That is deliberately not the same as omitting
 * them: a settings drawer missing the three things somebody asked for reads as
 * a drawer that forgot, and one that shows them with their provenance reads as
 * a product that knows what it does not do yet.
 *
 * What *is* writable here is real and was already scattered across the page:
 * which model the agent uses, its folder, and removing it.
 */
export const AGENT_SETTINGS_COPY = {
  heading: "Settings",
  close: "Close settings",
  identity: {
    heading: "Name and character",
    name_label: "Name",
    /** Under the name, in its read state (MAR-589). Says where it came from. */
    name_source: "Set by whoever wrote this agent, until you rename it.",
    /** Under the name while it is a stored rename rather than the author's own. */
    name_source_renamed: "Renamed. The agent's own manifest still calls it something else.",
    rename_edit: "Rename",
    rename_save: "Save",
    rename_cancel: "Cancel",
    rename_reset: "Use the agent's own name",
    rename_placeholder: "Name",
    rename_read_only: "Open the installed DASH app to rename an agent.",
    id_label: "ID",
    id_source: "How DASH refers to this agent internally. It never changes.",
    avatar_label: "Character",
    avatar_source: "Assigned when the agent was added. Choosing one is not built yet.",
  },
  notifications: {
    heading: "Notifications",
    /** The truth about the scope, before the link. */
    scope: "DASH sends notifications for every agent to one channel, not one channel per agent.",
    link: "Open notification settings",
  },
  danger: {
    heading: "Remove this agent",
    /**
     * Above the two removal buttons. The old page had these as two unlabelled
     * buttons at the very bottom of eighteen sections, which is why Henrik
     * asked for a remove button that already existed (MAR-595 shipped it).
     */
    detail: "This cannot be undone.",
  },
} as const;

/**
 * The outputs list — Henrik's *"list of the latest outputs (if an news agent
 * then the latest digest/newsletter it made)"*.
 *
 * The heading changed and the change is the feature. The old panel said
 * "Outputs" and showed only the outputs of *one* run, because the view carried
 * `outputs` plus a single `outputs_run_id`. A person who ran their scout on
 * Monday and again on Tuesday could not see Monday's digest on this page at
 * all — they had to know Runs existed and go and find it.
 */
export const AGENT_OUTPUTS_COPY = {
  heading: "Latest outputs",
  /**
   * The empty state, and the most-read sentence on this page.
   *
   * It is the first thing every new user meets — MAR-609's closing note is that
   * whatever is built must be sized for the empty case first — so it says what
   * is true and what to do, in two short sentences, and does not apologise.
   */
  empty_headline: "Nothing made yet",
  empty_detail: "When this agent runs, what it produces appears here.",
  /**
   * Above each card once the list spans runs (MAR-434's card, MAR-609's list).
   *
   * `ArtifactReceipt` deliberately omitted the producing run on the grounds
   * that "this panel only renders on that run's page". That was already untrue
   * for `app/_components/panel.tsx`, which has drawn cross-run cards from
   * `artifactRecordsForAgent` since MAR-548, and it is now untrue here too. So
   * both renderers name the run — see the note on `made_at` in
   * `lib/views/artifacts.ts`.
   */
  open_run: "Open the full run",
} as const;

/*
 * There is deliberately no chat copy in this module.
 *
 * Henrik asked for *"a chat window to communicate with the agent"* on a page
 * that already had one — `AskAgent`, MAR-545 — which owns every word it says
 * through `lib/copy/ask.ts`. The fix was placement, not vocabulary: it sat
 * sixth of eleven sections, under the outputs, the inputs panel and Run now,
 * and it is now directly under the agent's own output.
 *
 * An earlier draft of this file carried a `jump: "Chat"` string for a header
 * link down to it. That link was never built and the constant went with it:
 * chat is the second thing on the page now, and a jump link to something
 * already in view is exactly the chrome this issue exists to remove.
 */
