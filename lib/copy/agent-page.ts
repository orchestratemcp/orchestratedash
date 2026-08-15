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
  heading: "Quick commands",
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
  /**
   * No longer a tile (MAR-641). It labels the runtime row in the Logs stage's
   * State facts, where `WorkspaceOverview.runtime_label` always had a value to
   * put under it — the tile's version had to invent `where_unknown` for the
   * agents with no snapshot, which is most of the ones a person is looking at
   * when they ask.
   */
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
  /**
   * Kept, and read by nothing since MAR-641 moved the runtime into the record.
   *
   * `WorkspaceOverview.runtime_label` is never absent — it words its own
   * unknown as "Unknown runtime" — so the row in the Logs stage has no gap for
   * this to fill. It stays because the copy tests assert this whole object
   * against the guided-path rule, and deleting a string to keep a test honest
   * is the wrong direction: the next surface that needs a tile-length "where"
   * should find this rather than invent a second one.
   */
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
  heading: "Generated assets",
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

/**
 * The live output feed — timestamped lines from telemetry v1 (MAR-635).
 *
 * This is the mockup's biggest win and the closest to free: every run already
 * posts `step_started` / `step_completed` (and the run/gate events around
 * them), and the agent page already follows a run in flight. The feed is those
 * records, worded, in order. It does not invent a log the store does not have.
 *
 * Empty copy is two short sentences, same rule as the assets panel: this is
 * the state every new user meets.
 */
export const AGENT_FEED_COPY = {
  heading: "Live output",
  empty_headline: "Nothing has run yet",
  empty_detail: "When this agent works, each step appears here.",
  open_run: "Open this run",
  /**
   * Verbs for each telemetry v1 event type. Exhaustive on `RunEventType`, so
   * a new member is a compile error here rather than a raw `step_started`
   * leaking onto a page a person reads.
   */
  verb: {
    run_started: "Started",
    run_completed: "Finished",
    run_failed: "Failed",
    gate_requested: "Waiting for you",
    gate_resolved: "You answered",
    step_started: (step: string): string => `Started ${step}`,
    step_completed: (step: string): string => `Finished ${step}`,
  },
} as const;

/**
 * Performance numbers, only where a record backs them (MAR-635, MAR-547).
 *
 * Latency is a difference of two recorded timestamps. Tokens and cost are
 * sums of fields the run actually posted. A meter whose field never appeared
 * is omitted, not drawn at zero — a zero would claim the run was free or
 * silent, which is a different fact from "nobody said".
 *
 * There is no empty-state paragraph. An agent that has reported no numbers
 * draws no panel, which is the empty-agent size MAR-609 still requires.
 */
export const AGENT_TELEMETRY_COPY = {
  heading: "Performance",
  duration: "Time",
  duration_so_far: "Time so far",
  tokens_in: "Read",
  tokens_out: "Written",
  cost: "Cost",
  model: "Model",
  sparkline_written: "Written per step",
  sparkline_cost: "Cost per step",
  /**
   * Under the cost meter. The same attribution `describeReportedRunSpend`
   * makes in a sentence: this is the agent's own figure, not a bill DASH
   * observed.
   */
  cost_note: "The agent reported this. It is not something DASH watched.",
} as const;

/**
 * How long a run took, from two recorded timestamps.
 *
 * Whole seconds only: telemetry v1 timestamps are date-times, not a
 * stopwatch, and a millisecond figure would pretend at a precision the
 * record does not have. Null rather than "0 seconds" when the two instants
 * cannot be read or do not move forward.
 */
export function describeFeedDuration(fromIso: string, untilIso: string): string | null {
  const from = Date.parse(fromIso);
  const until = Date.parse(untilIso);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until < from) {
    return null;
  }
  const seconds = Math.floor((until - from) / 1000);
  if (seconds < 1) {
    return "less than a second";
  }
  if (seconds < 60) {
    return seconds === 1 ? "1 second" : `${String(seconds)} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) {
    if (rest === 0) {
      return minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
    }
    const minuteWord = minutes === 1 ? "1 minute" : `${String(minutes)} minutes`;
    const secondWord = rest === 1 ? "1 second" : `${String(rest)} seconds`;
    return `${minuteWord} ${secondWord}`;
  }
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  const hourWord = hours === 1 ? "1 hour" : `${String(hours)} hours`;
  if (minuteRest === 0) {
    return hourWord;
  }
  const minuteWord = minuteRest === 1 ? "1 minute" : `${String(minuteRest)} minutes`;
  return `${hourWord} ${minuteWord}`;
}

/**
 * The cockpit frame — the header band, the rail and the chat bar (MAR-641).
 *
 * ## What the frame is allowed to be
 *
 * Henrik's wireframe replaced a long scroll with a frame that never moves
 * around one centre that swaps. Everything named here is *chrome*: it is DASH
 * speaking about an agent, in the band that is on screen whatever the person is
 * looking at. That makes it the most-read copy in the product per visit, so
 * every string is a label and none of them is a sentence — the rule at the top
 * of this module, applied where it costs the most to break.
 *
 * ## The four-cell action grid has three cells today
 *
 * The wireframe's grid is *Trigger run · Health check · Settings · Logs*, and
 * three of those four are here. Health is a stage that aggregates five recorded
 * facts nothing in this repository computes yet (see `AGENT_STAGES`), and a
 * fourth button leading to an empty room is the dead control
 * `lib/workspace.ts` refuses. The grid is authored as a two-column grid whose
 * odd last cell spans both, so it reads as finished at three and becomes the
 * wireframe's square the day the fourth arrives.
 */
export const AGENT_COCKPIT_COPY = {
  /** The accessible name of the frame's action grid. */
  actions_label: "Agent actions",
  /**
   * The first cell, in its two truthful states.
   *
   * `trigger_run` starts a run **and** moves the stage to it, which is what the
   * wireframe means by a button that both acts and switches. `open_run` is what
   * the same cell says when there is nothing to start — a run already in
   * flight, an agent that has reported no state, a window that cannot act. It
   * names a destination rather than promising an action, because the Run stage
   * carries `AGENT_CONTROL_COPY.idle`'s sentence for each of those and a button
   * reading "Trigger run" that triggers nothing is the exact defect MAR-609 was
   * filed on.
   */
  trigger_run: "Trigger run",
  open_run: "Run",
  settings: "Settings",
  logs: "Logs",
  /**
   * The overflow menu — three actions that are real and rare.
   *
   * A `<details>` rather than a popup: it needs no click-outside handler, it is
   * reachable from a keyboard without one being written, and nothing inside it
   * is destructive. **Remove is a link into the Settings stage, not a button.**
   * The removal controls live under their own heading with the sentence saying
   * it cannot be undone, and a destructive control inside something that closes
   * on a stray press is the wrong container for it — the argument MAR-609 made
   * when it declined to put `RemoveAgent` in a modal.
   */
  more: "More",
  more_label: "More actions",
  refresh: "Refresh",
  open_folder: "Open folder",
  remove: "Remove this agent",
  /** Where this agent lives, above the chip that says Local or Cloud. */
  place_label: "Lives on",
  /**
   * The rail. Two panels, both of which say nothing when they hold nothing.
   *
   * The outputs list is titles only by design: the stage is where an output is
   * read, and a rail that rendered bodies would be a second, narrower copy of
   * the Output stage competing with it.
   */
  rail_label: "This agent at a glance",
  outputs_heading: "Latest output",
  outputs_empty: "Nothing made yet.",
  /** On the newest entry, for a reader who cannot see the accent edge. */
  outputs_newest: "Newest",
  /** Under the Overview stage's one output, when there are more of them. */
  outputs_all: "Open every output",
  work_heading: "Action needed",
  /** Each row of the action-needed panel takes the reader to the decision. */
  work_open: "Open this decision",
  /**
   * What kind of thing is waiting, in the rail and on the card it points at.
   *
   * Named here because two surfaces now say it about the same item, and the
   * rail row and the card it opens disagreeing about what a person is being
   * asked would be the three-cards defect of MAR-624 in miniature.
   * `app/approval-popup/page.tsx` says "Guarded action" too and is deliberately
   * left alone: it is a separate window with one question in it and no list to
   * be consistent with.
   */
  work_kind: { approval: "Guarded action", choice: "Choice" },
  /**
   * The chat bar, pinned to the bottom of the frame.
   *
   * `ask` owns every word of the conversation itself (`lib/copy/ask.ts`); these
   * are the two strings the *bar* needs and the thread does not — the label on
   * a box that is one line tall, and the way into the thread when a person
   * cannot type in it yet.
   */
  chat_label: "Message this agent",
  chat_open: "Open chat",
  /**
   * The stage names, for the region's accessible name.
   *
   * A screen reader announces the region a person has just moved into, and
   * "Output" is what it should say rather than the label of whatever heading
   * happens to be first inside it.
   */
  stage: {
    overview: "Overview",
    run: "Run",
    output: "Output",
    chat: "Chat",
    settings: "Settings",
    logs: "Logs",
  },
  /**
   * The guided checklist for an agent that has never run (MAR-609's rule, still
   * binding, and MAR-641's restatement of it).
   *
   * > *"the never-run agent gets a guided Overview checklist, not eight empty
   * > sections."*
   *
   * Three items at most, each a fact DASH already holds rather than a step in a
   * tutorial. The first is ticked on arrival on purpose: a checklist whose
   * every line is undone reads as a list of failures, and "this agent is here"
   * is both true and the thing a person just did.
   */
  checklist: {
    heading: "Getting started",
    /** Read out instead of the tick and the bullet, which say nothing aloud. */
    done: ". Done",
    todo: ". Still to do",
    added: {
      label: "This agent is here",
      detail: "DASH holds its plan and can start it on this computer.",
    },
    model: {
      label: "It has a model",
      /** When there is nothing more to do, and the view has no sentence. */
      ready: "A model is set for this agent.",
      action: "Open settings",
    },
    first_run: {
      label: "It has run once",
      detail: "Press Trigger run. It runs only when you ask.",
      action: "Go to Run",
    },
  },
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
