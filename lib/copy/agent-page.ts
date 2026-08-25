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
  /**
   * Announced while DASH is re-reading this agent. `{time}` is a clock time.
   *
   * It read *"Following this run"* until MAR-680 widened what DASH follows.
   * The line is driven by whether anything about the agent could change on its
   * own — a queued run, a gate waiting on a person, a press that has not
   * produced a run yet — and on an agent with an older run parked at an
   * approval it appeared beside a Run stage describing a *different*, finished
   * run. Two sentences about two runs, both true, reading as a contradiction.
   *
   * So it names what DASH is doing rather than what the agent is doing. Which
   * run is on the stage, and what state it is in, is
   * `AGENT_RUN_PROGRESS_COPY`'s to say, once, where the run is.
   */
  following: (time: string): string => `Watching for changes. Updated ${time}.`,
} as const;

/**
 * The About disclosure — the header's goal, and the plan behind it (MAR-664).
 *
 * Henrik: *"The agent description doesn't need to be in the header. Too much
 * text. Better add an about the agent button. Shows steps and description."*
 * `AGENT_HEADER_COPY.eyebrow` above is the one word the header keeps about
 * what this agent *is*; everything about what it *does* moved here, and
 * `tests/agent-about.test.tsx` is the gate that keeps it from moving back.
 *
 * Every sentence that depends on a step's own data — its risk, its declared
 * strength — is composed in `lib/agent-plan.ts`, not here. This module only
 * has the labels that do not depend on any agent's manifest.
 */
export const AGENT_ABOUT_COPY = {
  open: "About",
  open_label: "About this agent",
  goal_heading: "What it does",
  steps_heading: "Its plan",
  step_label: (step: number): string => `Step ${String(step)}`,
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
   * The primary control for an agent whose process is not running (MAR-657).
   *
   * Two verbs because the press is two acts — DASH starts the agent on this
   * computer, then asks it to run — and naming only the second would promise a
   * run to somebody whose agent might not start. Naming only the first would be
   * worse: it would be a button that changes a status and appears to do nothing,
   * which is the shape of the defect MAR-609 was filed on.
   *
   * No machine in the label, and that is ADR 0014's rule rather than an
   * omission: the copy on this computer is the permanent default target and the
   * named controls are the *other* machines' — "Run on Hostinger" beside it.
   * `start_here` below carries the machine into the sentence under the button,
   * where there is room to say it in words.
   */
  start_and_run: "Start and run",
  /**
   * Under the button, because a press that spawns a process is a fact about one
   * machine, and ADR 0014 says a control that starts a run names the one it will
   * use. It also answers the question the two-verb label raises — *why does this
   * one say something different from Run now* — in the place a person is already
   * looking.
   */
  start_here: "This agent is not running. DASH will start it on this computer, then ask it to run.",
  /**
   * The start worked and the agent offered nothing to run.
   *
   * Deliberately not worded as a failure. An agent built with DASH's kit
   * publishes a task the moment it starts; one written by hand or brought from
   * another toolchain has never been obliged to, and telling that person their
   * agent is broken would be DASH inventing a fault to explain its own silence.
   * The process is up, which is the part that is worth saying.
   */
  start_nothing_offered:
    "It started on this computer and is running now, but it has not offered anything to run.",
  /**
   * The start itself was refused and the runner said nothing about why.
   *
   * A fallback and rarely the sentence anybody sees: `runner.start` refuses with
   * its own detail — an unregistered agent, a manifest that does not validate, a
   * process that would not spawn — and that detail is better than this one every
   * time it exists.
   */
  start_failed: "DASH could not start this agent on this computer.",
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
     * No snapshot **and** no program DASH could start. Narrowed by MAR-703.
     *
     * ## What it used to answer, and why that was the defect
     *
     * It answered every agent with no Agent DOM snapshot — which, ADR 0022
     * having built starting-a-stopped-agent as exactly this door, was the one
     * population that most needed the door. A snapshot only ever arrives from a
     * running agent, so "nothing has reported" and "nothing can be started"
     * were being told apart by nothing at all, and the sentence below was shown
     * to both. Henrik met the consequence after the 2026-08-19 store restore:
     * the header read NOT REPORTED, the Overview checklist said to open Run and
     * press Run now, and the Run stage answered with this sentence and no
     * button. `buildAgentControl` now offers Start whenever DASH holds a
     * registration, so what is left here is the agent DASH genuinely cannot run
     * — ADR 0008's manifest-only standing, or a registration that has gone.
     *
     * ## Why the wording moved off "has not reported"
     *
     * Because that was never the reason a person could not press anything, and
     * saying it put the blame on the agent for DASH's own missing record. What
     * a person can act on is the true fact: DASH has no program saved for this
     * agent. `not_reported_exit` then names the way out, so this stops being a
     * state with no exit (MAR-705) — the pairing is the whole point, and a
     * sentence shipped without it would be the dead end again in new words.
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
      "DASH has no saved program for this agent, so there is nothing to start on this computer.",
    /** A snapshot, but no task waiting to be run. */
    nothing_waiting: "Nothing is waiting to be run on this computer.",
    /** The window cannot act — a browser tab rather than the installed shell. */
    read_only: "This window can show this agent but cannot control it.",
  },
  /**
   * The way out of `idle.not_reported` (MAR-705).
   *
   * ## Why a state with no exit is the thing being fixed
   *
   * Henrik, told that the way to repair an agent was `npm run open-in-dash`:
   * *"Okey, this redeploy of an faulty agent is to hard. Can you figure out how
   * we can do it from dash and not some terminal command?"* The sentence above
   * had been describing a situation and stopping, which on the one screen where
   * a person has no other control reads as DASH reporting that their agent is
   * over. Naming the door is what turns it back into a step.
   *
   * ## Why it points at Settings and does not act here
   *
   * ADR 0008 puts an agent's controls on the Settings stage and the repair is
   * one of them, so this moves the person to the control rather than growing a
   * second copy of it on the Run stage. Two buttons performing one repair is the
   * duplication `buildAgentControl` was written to end, and a repair that ran
   * from a sentence would run without the consent screen the Settings control
   * shows.
   *
   * The label is short because buttons are uppercased globally: a long honest
   * label reads as an alarm on a stage that is already telling somebody
   * something is wrong.
   */
  not_reported_exit: {
    detail: "If it should be able to run, DASH can set it up again from the copy it already has.",
    action: "Repair this agent",
  },
  /*
   * There is no `manual_note` here and there was one until MAR-646.
   *
   * It read *"It runs only when you ask. Nothing happens on a timer."* under the
   * Run now button, and it is the trigger — which is a setting, whose home is
   * `AGENT_TRIGGER_COPY` on the Settings stage. That switcher says the same
   * thing twice over already: `on_command.detail` is "This is the only way DASH
   * starts an agent today", and `declared_conflict` is "Nothing in DASH runs it
   * on a timer". One fact, three sentences, two stages — and the header's
   * Settings cell is one press from anywhere.
   */
} as const;

/**
 * What is left of the tile row, which is one label (MAR-570, MAR-609,
 * MAR-641, and now MAR-646).
 *
 * ## Four tiles, then two, then none
 *
 * MAR-570's move — the answer on a tile, the paperwork one click away — was
 * right for Connections and this page kept trying to make it fit. Each tile
 * went for the same reason and the reason is this issue's whole subject:
 *
 * - **Status** went when a capture showed a tile reading "Not reported" a few
 *   hundred pixels under a pill reading NOT REPORTED.
 * - **Runs on** went when the header gained a Local/Cloud chip and a capture
 *   showed the two contradicting each other.
 * - **Starts when** and **Model** go here. Both are *settings*, and the Settings
 *   stage owns them with the controls that change them: the trigger switcher
 *   names the trigger and says what DASH will do regardless, and `ModelChoice`
 *   carries the model with its own account of what is in force. A tile is a
 *   read-only copy of a fact a person cannot act on where they are reading it,
 *   which is what MAR-646 means by an echo.
 *
 * Nothing was lost with the last two, and that was checked rather than assumed.
 * The one case where a tile said something the Settings stage does not is an
 * agent whose plan uses no model at all — and `ModelChoice` draws nothing there
 * *on purpose*, because "a notice explaining an absence would be DASH
 * describing its own internals at somebody who came to look at their agent".
 * The tile was the one surface disagreeing with that decision.
 *
 * What survives is one label, and it is not a tile.
 */
export const AGENT_TILE_COPY = {
  /**
   * The runtime row in the Logs stage's State facts (MAR-641).
   *
   * `WorkspaceOverview.runtime_label` is never absent — it words its own
   * unknown as "Unknown runtime" — so this row needs no fallback value beside
   * it, which is why the tile-length `where_unknown` left with the tiles.
   */
  where: "Runs on",
} as const;

/**
 * The trigger switcher — Henrik's *"switch trigger. Trigger on command or set a
 * time or how often it should trigger."*
 *
 * ## What changed, and what had to survive changing
 *
 * MAR-641 built this control with **one** option enabled, because ADR 0014 had
 * weighed trigger configuration and declined it: *"It is blocked on
 * restart-on-boot, which ADR 0007 left open on purpose, and it needs a scheduler
 * that exists nowhere in this repository."* The two disabled radios said "Not
 * built yet" and named what they were waiting on, and that was the honest state
 * of the product for four months.
 *
 * MAR-742 item 8 built the scheduler (ADR 0029), so the middle option is now a
 * control. **The half of ADR 0014's sentence about restart-on-boot did not
 * change**, and that is why the rewrite here is careful rather than celebratory:
 * a schedule fires from the runner, the runner is started by DASH, and a
 * computer that has been switched off comes back with nothing running. Replacing
 * a true sentence about what DASH cannot do with a time picker and silence would
 * have taken information off the screen.
 *
 * So `liveness` is three sentences and they are not optional decoration. They
 * are ADR 0029's own liveness list, in the person's words, on the surface where
 * the decision to rely on a cadence is actually made.
 *
 * ## The disabled radio that stays
 *
 * A written schedule — cron — is still not offered, and now for a reason that is
 * about product rather than capability: it is a power-user affordance and the
 * novice default has to work first (ADR 0029 decision 9). The copy says the new
 * reason rather than keeping the old one, because the old one stopped being
 * true.
 *
 * **A disabled radio is not a dead control here, and the distinction matters.**
 * `lib/workspace.ts`'s rule is about buttons that would fire nothing while
 * looking like they would fire something. This is the opposite: it is the page
 * telling the truth about a capability the product does not have, which is
 * information, and hiding it would leave the person believing DASH had silently
 * ignored the ask.
 *
 * ## The sentences about money
 *
 * `spend.none` is here because ADR 0029 decision 6 refuses to open a spend
 * allowance on an unattended run, and a person whose agent curates through a
 * model would otherwise discover that from a refusal in a log at 03:00. It is
 * shown next to the control that causes it rather than in a document.
 *
 * MAR-784 makes that refusal a **default instead of a rule**, on Henrik's
 * ruling that *"some agents really need to use AI and some don't"* — so there are
 * now three sentences where there was one, and which of them is on screen is
 * decided by what the person has actually chosen:
 *
 * - `spend.none` — the default, unchanged, word for word. A schedule nobody
 *   opted in for says exactly what it said before this feature existed.
 * - `spend.allowed` — the swap. It states the ceiling as a number, because a
 *   person who has just permitted unattended spending is owed the size of what
 *   they permitted, and because a count of calls is the only unit DASH can
 *   promise (see `lib/broker/spend-allowance.ts` on why it is not a currency).
 * - `spend.needs_dash_open` — the sentence that costs this feature something to
 *   say and is said anyway. A schedule *starts* an agent with DASH closed, and
 *   an agent with DASH closed cannot reach a model, because the broker that
 *   holds the key runs in DASH's own process — `electron/broker-host.ts`'s
 *   header has said so since MAR-458. So an allowance is real at 08:00 with the
 *   window open and inert at 03:00 with it shut, and the panel says which.
 *
 * Not saying that third sentence was the tempting option and it is exactly the
 * failure ADR 0029's own "the bar this is being held to" section is about: a
 * product that replaces a true sentence with a control and silence has taken
 * information away. The person setting a nightly schedule is the person who most
 * needs to know that nightly is the case it does not cover.
 */
export const AGENT_TRIGGER_COPY = {
  heading: "When this agent starts",
  on_command: {
    label: "On command",
    detail: "You press Run now. Nothing starts this agent unless you do.",
  },
  at_a_time: {
    label: "Every day at a set time",
    detail: "DASH starts it for you, on this computer, at the time you pick.",
  },
  on_an_interval: {
    label: "On a schedule you write",
    detail:
      "Not built yet. Every day at a time covers what most agents need, and that had to work first.",
  },
  /** The field beside the enabled radio. */
  time_label: "Time of day",
  time_hint: "This computer's own clock. 24-hour, like 08:00 or 17:30.",
  save: "Save schedule",
  turn_off: "Turn off",
  saving: "Saving…",
  /** What is standing right now, said back in the person's own terms. */
  standing: (at: string): string => `DASH starts this agent every day at ${at}, on this computer.`,
  none_standing: "No schedule. This agent only runs when you press Run now.",
  /**
   * The three liveness sentences (ADR 0029).
   *
   * Third one included and not softened. It is the whole of what ADR 0007 left
   * open, and a person deciding whether to depend on a nightly run is owed it
   * before they decide rather than after they notice.
   */
  liveness: [
    "With DASH open, it runs at that time.",
    "With DASH closed and this computer on, it still runs — DASH leaves a small helper running that starts it.",
    "If this computer is asleep, off, or restarting, nothing runs. DASH will tell you it was missed, and it does not run it late.",
  ] as readonly string[],
  /**
   * ADR 0029 decision 6 and its amendment, said where the decision is made.
   *
   * Deliberately not hidden behind a disclosure. The agent these are most true
   * of is the one somebody is most likely to want on a timer.
   */
  spend: {
    /** The default. ADR 0029 decision 6, unchanged. */
    none: "A scheduled run cannot spend on a model. Steps that need one are skipped; press Run now for those.",
    /**
     * The swap, when a person has opted in (MAR-784).
     *
     * Says the number rather than "may use AI", because the number is the whole
     * of what was agreed to. "Per run" and not "per day": the agent may also be
     * run by hand, and each of those presses buys its own allowance — a sentence
     * implying a daily total would be describing a budget DASH does not keep.
     */
    allowed: (calls: number): string =>
      `A scheduled run may use your model up to ${String(calls)} ` +
      `time${calls === 1 ? "" : "s"} — the same as pressing Run now. Steps past that are skipped.`,
    /** The bound on the sentence above. See the header. */
    needs_dash_open:
      "That works while DASH is open. With DASH closed the run still starts and still publishes, but nothing can reach your model until you open DASH again.",
  },
  /** The opt-in itself, beside the time. MAR-784. */
  allowance_label: "Let a scheduled run use your model",
  /**
   * Under the switch, in its off state.
   *
   * Names the money and names whose it is, which is the one thing a switch
   * cannot say on its own. `curateOperation.consequence`'s register: what happens
   * to the person, in plain language, with no identifiers.
   */
  allowance_hint: (calls: number): string =>
    `Off by default. On, DASH may charge your own model account for up to ` +
    `${String(calls)} call${calls === 1 ? "" : "s"} each time this schedule starts the agent.`,
  /** The heading over what the schedule has actually done. */
  history_heading: "Scheduled runs",
  /**
   * What the last scheduled run actually spent (MAR-784).
   *
   * Counted from `broker_audit` rather than reported by the agent — see
   * `readScheduleSpend` — so this is a receipt and not a claim. Both numbers are
   * shown even when they are equal, because "used 2 of 2" and "used 2" are
   * different sentences to somebody deciding whether the ceiling is right.
   */
  spent: (used: number, allowed: number): string =>
    `Used ${String(used)} of ${String(allowed)} model call${allowed === 1 ? "" : "s"}.`,
  /**
   * The degrade, said in the person's terms rather than the broker's.
   *
   * A run that reaches its ceiling is refused with `needs_a_person` — the exact
   * refusal a schedule with no allowance at all gets, which is ADR 0029
   * amendment 1's stated intent: it degrades the way today's no-spend run
   * degrades, publishing what it could produce without spending. What this
   * sentence adds is the *reason*, which the refusal itself deliberately does not
   * carry (`spendAllowed` refuses to distinguish absent, expired and spent, so
   * an agent cannot learn the shape of the budget by probing it). DASH knows
   * which it was; the agent does not; the person is told.
   */
  ceiling_hit: (allowed: number): string =>
    `This run used all ${String(allowed)} of its model call${allowed === 1 ? "" : "s"} and then ` +
    "stopped asking, so the rest of its plan ran without one. It still published what it could.",
  /** One settled window, in the person's words rather than the store's. */
  outcome: {
    ran: "Ran",
    missed: "Missed",
    refused: "Did not start",
  },
  /**
   * What the agent's own manifest says, when it disagrees with what DASH is
   * doing. An author may declare a cadence DASH is not keeping; the page says
   * both rather than picking the flattering one.
   */
  declared: (label: string): string => `This agent's author describes its trigger as “${label}”.`,
  declared_conflict:
    "That is the author's description, not a schedule DASH is keeping. What DASH does is what this panel says.",
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
    avatar_source: "Assigned when the agent was added.",
    avatar_edit: "Change",
    avatar_cancel: "Cancel",
    avatar_read_only: "Open the installed DASH app to change an agent's avatar.",
    /** Named after the character, for a screen reader choosing between eleven identical-looking buttons. */
    avatar_choose: (name: string): string => `Use the ${name} character`,
  },
  notifications: {
    heading: "Notifications",
    /** The truth about the scope, before the link. */
    scope: "DASH sends notifications for every agent to one channel, not one channel per agent.",
    link: "Open notification settings",
  },
  /**
   * The Settings stage's list of "always answer this way" rows (MAR-681).
   *
   * Renders nothing at all for an agent with none — the ordinary state, and
   * `identity`'s own reason for showing what is genuinely absent rather than
   * a heading over an empty sentence.
   */
  standing_answers: {
    heading: "Standing answers",
    /** Above the list, when there is at least one row. */
    detail: "DASH will not ask these questions again until you forget the answer.",
    forget: "Forget",
    /** On the day this was set, under the question and the chosen option. */
    set_on: (date: string): string => `Set ${date}`,
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
 * Where a run has got to, said in words (MAR-680).
 *
 * ## The three things Henrik could not find out
 *
 * *"The only information we get is that it has started a new run. Not if it
 * finished, or if we can leave the page, or if we have to stand still here for
 * it not to break."* Three questions, and the page answered none of them: the
 * banner said a run had started, `AGENT_FEED_COPY` listed the events that had
 * happened, and nothing anywhere said which step was happening **now**, whether
 * the run was **over**, or whether walking away would **break** it.
 *
 * So there is a word per phase and a sentence per phase, and both come from
 * here rather than from the component — `lib/copy/`'s standing rule, and it
 * earns its keep on this surface in particular: seven phases each needing two
 * strings is exactly the population that ends up half-written inline.
 *
 * ## Why the safe-to-leave sentence is about the page and not about DASH
 *
 * A run happens in the runner's own process, and the renderer only reads it. So
 * *"you can leave this page"* is true by construction — there is no navigation
 * in DASH that could interrupt a run — and it is the question that was actually
 * asked. **Closing DASH is a different question with a different answer**, it
 * varies per agent (`WorkspaceOverview.continues_when_dash_closed`), and the
 * Logs stage's State facts already carry it. Saying both here would mean
 * composing a claim about the second from a field this sentence does not read,
 * which is how a reassurance becomes a false one.
 */
export const AGENT_RUN_PROGRESS_COPY = {
  heading: "Where this run is",
  /*
   * There is no empty state in this object, and that is deliberate.
   *
   * `AGENT_FEED_COPY.empty_headline` already says "Nothing has run yet" under
   * the log on the same stage. This panel renders nothing at all for an agent
   * with no run — see `RunProgress` — so the stage has one empty state rather
   * than two saying the same thing a few hundred pixels apart, which is the
   * shape MAR-646 spent a packet removing from this page.
   */
  step_label: "Step",
  /** On the row that is happening now, for a reader who cannot see the pips. */
  step_running: "Happening now",
  /** On a row the plan declares and the run has not reached. */
  step_todo: "Not started",
  step_done: "Done",
  step_failed: "Did not work",
  step_skipped: "Skipped",
  step_waiting: "Waiting for you",
  /**
   * A step that started and never reported an outcome, on a run that is over.
   *
   * Neither "Not started", which would be a flat untruth about a step that
   * visibly began, nor "Did not work", which is a verdict DASH did not observe.
   * See `markCurrent` in `lib/views/run-progress.ts`.
   */
  step_unfinished: "Did not finish",
  /**
   * The answer to *"can we leave the page?"*, said only while a run is going.
   *
   * See this module's note above for why the claim stops at the page.
   */
  safe_to_leave:
    "You can leave this page. The run keeps going, and what it makes will be here when you come back.",
  /** Under a finished run, when the agent produced something to read. */
  open_output: "See what it made",
  phase: {
    running: {
      headline: "Working",
      detail: "The agent is running its plan now.",
    },
    waiting: {
      headline: "Waiting for you",
      detail: "It has asked you something and cannot go on until you answer.",
    },
    paused: {
      headline: "Paused",
      detail: "It will not go on until you resume it.",
    },
    finished: {
      headline: "Finished",
      detail: "The run is over and nothing is running now.",
    },
    failed: {
      headline: "Stopped with a problem",
      detail: "The run ended early. The steps below say how far it got.",
    },
    stopped: {
      headline: "Cancelled",
      detail: "Somebody stopped this run before it finished.",
    },
    /**
     * The state MAR-685's stale run was in, worded as the absence it is.
     *
     * DASH observed a silence, not a failure. "Stopped with a problem" would be
     * a verdict on evidence DASH has not got, and the surface said "working"
     * about this exact run for five hours — which is the other wrong answer.
     */
    unfinished: {
      headline: "Stopped without finishing",
      detail:
        "It stopped reporting and never said how it ended. Running it again is the way to find out whether it works now.",
    },
  },
} as const;

/**
 * How far through the run this is, in the only two forms the record supports.
 *
 * "Step 3 of 6" needs a declared plan, and most agents have one — the manifest's
 * `planned_route` is what supplies the steps that have not happened yet. An
 * agent that declares none still gets a count of what it actually did, because
 * an agent brought from another toolchain is not one DASH should go quiet
 * about.
 *
 * The two tenses matter more than they look. While a run is going, the number a
 * person wants is *which step is happening*, which is one past the ones that are
 * done; once it is over, the number they want is *how many ran*. Using one form
 * for both would either overcount a finished run by one or describe a working
 * agent as being on the step it has already left.
 */
export function describeRunPosition(done: number, total: number, ongoing: boolean): string {
  if (total === 0) {
    return ongoing ? "Starting" : "No steps were reported";
  }
  if (!ongoing) {
    return done === total
      ? `All ${String(total)} steps ran`
      : `${String(done)} of ${String(total)} steps ran`;
  }
  return `Step ${String(Math.min(done + 1, total))} of ${String(total)}`;
}

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
 * ## The action grid is the wireframe's four-cell square
 *
 * The wireframe's grid is *Trigger run · Health check · Settings · Logs*.
 * Health joined only when MAR-645 supplied a real stage behind the cell; the
 * two-column grid now reads as the intended square.
 *
 * MAR-687 took the verb out of the first cell and left the destination. Every
 * cell in the grid is now a link to a stage of this agent and nothing in the
 * band acts — see `run` below for why that is a fix rather than a loss.
 */
export const AGENT_COCKPIT_COPY = {
  /** The accessible name of the frame's action grid. */
  actions_label: "Agent actions",
  /**
   * The first cell, which is now one word and one destination (MAR-687).
   *
   * ## Why the pair of labels went, and the press with them
   *
   * This cell read `trigger_run` — *Trigger run* — and it both started a run and
   * moved the stage to it, which is what MAR-641's wireframe meant by a button
   * that acts and switches. Henrik, on the 2026-08-17 walk: *"Clicked Trigger
   * run in the header. It swapped to the page and automatically triggered a run.
   * There is a button on that page. Let's make that the actual trigger. So we
   * can reach that page and then start."*
   *
   * Two triggers for one act is the same duplication `buildAgentControl` was
   * built to end, and the header's copy was the worse of the two: it fires
   * before the person has read anything, and it made the Run stage unreachable
   * without starting a run — so the one surface that shows what a run is doing
   * could not be revisited while one was going. The `open_run` half of the old
   * pair already existed for exactly the states where the cell was a destination
   * only; MAR-687 makes every state that one.
   *
   * So the cell names the stage, in the company of four other cells that name
   * stages, and `AGENT_CONTROL_COPY.run_now` on the far side of the press is the
   * only thing in DASH that starts a run.
   */
  run: "Run",
  health: "Health check",
  settings: "Settings",
  logs: "Logs",
  /**
   * The fifth cell, and the answer to a proof-pass finding (MAR-658).
   *
   * Every other cell in the grid names a destination this agent has, and
   * `overview` is the one the grid had never named. It was reachable by
   * accident until MAR-646 sent a produced agent's plain link to `output`
   * instead — after that, an agent with even one output had no button or link
   * anywhere back to its Overview stage, only the URL bar. A control that
   * always names this one destination cannot strand a deep link the way
   * `router.back()` would: see the comment on `onEscape` in
   * `app/agents/detail/page.tsx` for why the composer's Escape is a different
   * question with a different, correct answer.
   */
  overview: "Overview",
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
  /*
   * There is no `outputs_all` here and there was one until MAR-646.
   *
   * It read "Open every output" and sat under the Overview stage's copy of the
   * newest output — a link out of a block that no longer exists, because the
   * rail beside it was already the index of every output and pressing an entry
   * already opens it.
   */
  work_heading: "Action needed",
  /** Each row of the action-needed panel takes the reader to the decision. */
  work_open: "Open this decision",
  /**
   * What kind of thing is waiting, on the card that carries the decision.
   *
   * Said on one surface again since MAR-646. Both the rail row and the card it
   * opens carried it, which made the pointer read as a small copy of its own
   * destination; the card kept it, because there it sits beside the expiry and
   * the effect preview that make the word mean something, and the rail is now a
   * count and a title. `app/approval-popup/page.tsx` says "Guarded action" too
   * and is deliberately left alone: it is a separate window with one question
   * in it and no list to be consistent with.
   */
  work_kind: { approval: "Guarded action", choice: "Choice" },
  /**
   * The checkbox beside a choice's options (MAR-681): "I want both all the
   * time," Henrik's own words about the competitor scout's question. Answers
   * one occurrence and remembers the answer in the same press; revocable on
   * the Settings stage, `AGENT_SETTINGS_COPY.standing_answers`.
   */
  remember_choice: "Always answer this way",
  /**
   * The chat bar, pinned to the bottom of the frame.
   *
   * `ask` owns every word of the conversation itself (`lib/copy/ask.ts`),
   * including the bar's own visible name now (`describeChatSubject`, MAR-659)
   * — this is the one string the bar needs that is not about the conversation
   * at all: the way into the thread when a person cannot type in it yet.
   */
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
    health: "Health",
    output: "Output",
    chat: "Chat",
    settings: "Settings",
    logs: "Logs",
  },
  /**
   * The Overview stage when it has nothing on it (MAR-646).
   *
   * ## Why a stage that can be empty is not a mistake
   *
   * Overview stopped being a summary of the agent when the last echo left it:
   * the newest output is on the Output stage the rail points into, and the two
   * settings tiles are on the Settings stage that can change them. What is left
   * is the one thing that is nowhere else — a choice or an approval waiting on a
   * person — plus the first-run checklist and the manifest notice, and all three
   * of those are conditional.
   *
   * So a produced agent with a clear queue reaches this stage with nothing to
   * draw. It is not the stage a link lands on — `resolveAgentStage` sends a
   * produced agent to its output — but it is reachable, and the ordinary way to
   * reach it is by answering the last thing in the queue and staying where you
   * were. Two short lines, for `AgentRail`'s reason about the same absence: a
   * region that vanished would leave a reader unable to tell *nothing needs you*
   * from *this is broken*, and those are very different things to learn about an
   * agent you are deciding to trust.
   */
  overview_empty_headline: "Nothing needs you",
  overview_empty_detail:
    "When this agent has a choice or an approval for you, it appears here.",
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
      /* MAR-687. The header cell no longer starts anything, so the sentence
         that told a first-time reader to press it would send them somewhere
         that does nothing on arrival. Two presses, named in order. */
      detail: "Open Run and press Run now. It runs only when you ask.",
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
