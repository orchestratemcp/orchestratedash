"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  AGENT_ABOUT_COPY,
  AGENT_COCKPIT_COPY,
  AGENT_CONTROL_COPY,
  AGENT_HEADER_COPY,
} from "../../lib/copy/agent-page";
/* MAR-664. Pure — see the module's own docblock for why it is safe here,
   the same arrangement `lib/ai/model-levels.ts` has with `ModelChoice`. */
import { AGENT_PLAN_EMPTY_SENTENCE, AGENT_PLAN_MODEL_BOUNDARY, type AgentPlanStep } from "../../lib/agent-plan";
/* MAR-641. The fleet card's own two words for where an agent lives, imported
   rather than re-derived — the chip in this header and the chip on the card
   answer the same question about the same record, and two functions computing
   "Cloud" from `deploy_targets` is how they come to disagree. */
import { describeFleetPlace } from "../../lib/copy/fleet-status";
/* MAR-602. Safe as a value in this bundle: `lib/copy/where-it-ran.ts` imports
   nothing that reaches a disk, and its one reference to `lib/store.ts` is a
   type. The same arrangement the agent page itself relies on. */
import { describeRunOnHost } from "../../lib/copy/where-it-ran";
import type { AgentControlView } from "../../lib/views/agent-control";
import { agentStageHref } from "../_data/routes";
import type { AgentStage } from "../../lib/views/agent-stage";
import type { AgentDeployTarget } from "../../lib/views/types";
import type { AvailableControl } from "../../lib/workspace";
import type { OName } from "../../lib/brand/o-cast";
import { OAvatar } from "./o-avatar";

/**
 * Who this agent is, and the four ways into it — the band that never scrolls
 * (MAR-609, rebuilt as a frame by MAR-641).
 *
 * ## What this replaces, twice over
 *
 * MAR-609 replaced a header that was identity and one Refresh button with a
 * header that was identity *and* the control panel, because five of Henrik's
 * six asks were things you do. MAR-641 keeps that and moves the rest of the
 * page out from under it: the header is now one band of a fixed frame, and the
 * things it used to sit on top of are stages it switches between.
 *
 * So every control here does two jobs, which is the wireframe's own sentence
 * about the action grid — *"each both acts and switches the stage"*. Trigger
 * run starts a run and puts the run on screen. Settings and Logs are
 * destinations, and destinations are links: a person may open the Logs of an
 * agent in a second window, and a `<button>` that navigated would take that
 * away for no gain.
 *
 * ## The id, under MAR-589's ruling
 *
 * Henrik ruled that the display name is first-class and the id is a value. The
 * name is the `<h1>` and the id sits beside it in a monospace chip labelled
 * "ID". It survives the move into a denser band because the fleet card, the
 * deploy picker and the connector tiles all still print the id, and this chip
 * is what lets a person match this page to those.
 *
 * ## The portrait is 50px here and 100px was right before
 *
 * MAR-502 chose 100 because the agent page was the one surface where the
 * character is closest to being the subject. In a fixed band that also carries
 * a name, a status, a place, a description and six controls, 100px is a third
 * of the header at 375px — so this is the same portrait at the other exact
 * multiple of the 50px source, which is the only other size that upscales
 * without turning the sprite into a rendering fault.
 */
export function AgentCockpitHeader({
  agent,
  avatar,
  busy,
  canTrigger,
  control,
  goal,
  hasFolder,
  live,
  onOpenFolder,
  onRefresh,
  onTriggerRun,
  places,
  plan,
  stage,
  title,
}: {
  /** The agent's id, for the stage links. A value, never a label (MAR-589). */
  agent: string;
  avatar: OName | null;
  /** The pending command key, or null. Disables the acting controls. */
  busy: string | null;
  /**
   * Whether pressing the first cell would actually start something.
   *
   * False for a run already in flight, an agent that has reported no state, and
   * a window that cannot act — three different reasons, all of which leave the
   * cell as a way *to* the Run stage, where `AGENT_CONTROL_COPY.idle` has the
   * sentence for each.
   */
  canTrigger: boolean;
  control: AgentControlView;
  /** The author's own sentence about what this agent is for. Read inside About. */
  goal: string;
  /** Whether DASH holds a folder of its own to open (MAR-584's `folder_checkable`). */
  hasFolder: boolean;
  /** The clock time of the last poll while a run is being followed, else null. */
  live: string | null;
  onOpenFolder: () => void;
  onRefresh: () => void;
  onTriggerRun: () => void;
  /** Every server this agent has been sent to. Empty means it lives here. */
  places: readonly AgentDeployTarget[];
  /** Every step this agent's plan declares, in order (MAR-664). Read inside About. */
  plan: readonly AgentPlanStep[];
  /** The stage on screen, so the grid can say which one you are in. */
  stage: AgentStage;
  /** The display name, from `agentDisplayName`. Never the raw id. */
  title: string;
}): ReactNode {
  const place = describeFleetPlace(places);
  return (
    <header className="cockpit-header">
      <div className="cockpit-identity">
        {/*
          Status-tinted, per the wireframe, and tinted on the *frame* around the
          portrait rather than on the character. A costume that changed colour
          with a run would be status readable only from the picture, which is
          the fiction MAR-547 refused and `scripts/brand-rules.mjs` enforces;
          a border on the box beside a pill that says the same word in text is
          the calm version of the same idea.
        */}
        <span className={`cockpit-portrait tone-${control.status.tone}`}>
          <AgentPortrait avatar={avatar} size={50} />
        </span>
        <div className="agent-identity-text">
          <div className="cockpit-name-row">
            <h1>{title}</h1>
            <StatusPill control={control} />
            {/* Clicks through to the stage that owns where an agent lives.
                MAR-641's deploy move is not made here — this is a link to the
                block that already exists, not a claim about where deploying
                will live once the single-home decision is taken. */}
            <Link className={`place-chip is-${place.id}`} href={agentStageHref(agent, "settings")}>
              <span className="place-chip-label">{AGENT_COCKPIT_COPY.place_label}</span>
              <span className="place-chip-value">{place.label}</span>
            </Link>
            <span className="agent-id-chip">
              <span className="agent-id-label">{AGENT_HEADER_COPY.id_label}</span>{" "}
              <code className="value">{agent}</code>
            </span>
            {/*
              MAR-664. The goal prose used to sit here as a permanent line under
              the name; Henrik's words were "Too much text." It lives inside this
              disclosure now, beside the plan behind it, and nowhere else —
              `tests/agent-about.test.tsx` is the one-fact-one-home gate for that.
              A `<details>`, in `.cockpit-overflow`'s own shape: no click-outside
              handler to write, reachable from a keyboard without one, and
              nothing inside it is destructive.
            */}
            <details className="cockpit-about">
              <summary aria-label={AGENT_ABOUT_COPY.open_label} title={AGENT_ABOUT_COPY.open_label}>
                {AGENT_ABOUT_COPY.open}
              </summary>
              <div className="cockpit-about-panel">
                <section>
                  <h2 className="cockpit-about-heading">{AGENT_ABOUT_COPY.goal_heading}</h2>
                  <p className="wrap">{goal}</p>
                </section>
                <AgentPlanSection plan={plan} />
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="cockpit-header-actions">
        <div className="cockpit-action-grid" role="group" aria-label={AGENT_COCKPIT_COPY.actions_label}>
          {/*
            The one cell that acts. It is a `<button>` and not a link because
            pressing it starts a run; the page moves the stage itself, so the
            two halves of "acts and switches" cannot come apart in a browser
            that follows the link before the handler runs.
          */}
          <button
            className="cockpit-action is-primary"
            disabled={busy !== null}
            onClick={onTriggerRun}
            type="button"
          >
            {canTrigger ? AGENT_COCKPIT_COPY.trigger_run : AGENT_COCKPIT_COPY.open_run}
          </button>
          <StageAction
            agent={agent}
            current={stage}
            label={AGENT_COCKPIT_COPY.health}
            target="health"
          />
          <StageAction
            agent={agent}
            current={stage}
            label={AGENT_COCKPIT_COPY.settings}
            target="settings"
          />
          <StageAction
            agent={agent}
            current={stage}
            label={AGENT_COCKPIT_COPY.logs}
            target="logs"
          />
          {/*
            MAR-658. The fifth cell, and the odd one that spans — see
            `.cockpit-action-grid > :last-child:nth-child(odd)`, which sat
            unused since MAR-641 wrote it for exactly this.

            Every other cell here is a stage this agent's frame did not
            otherwise lead to. This one is a stage the frame used to lead to
            by accident, until MAR-646 sent a produced agent's plain link to
            `output` instead — after that, an agent with even one output had
            no button or link back to its Overview anywhere in the cockpit,
            only the URL bar. Named as a destination, not a direction, so it
            cannot strand a deep link the way `router.back()` would: a link
            straight to the Chat stage has no earlier stage of *this* agent
            behind it in history, but it always has an Overview.

            Drawn on the Overview stage too, marked current like the other
            three: a cell that vanished under its own destination would be
            one more control whose presence a person had to remember.
          */}
          <StageAction
            agent={agent}
            current={stage}
            label={AGENT_COCKPIT_COPY.overview}
            target="overview"
          />
        </div>

        {/*
          The rare three. A `<details>` rather than a popup: no click-outside
          handler to write, keyboard-reachable without one, and nothing inside
          it is destructive — Remove is a link into the Settings stage, where
          the removal controls sit under a heading and the sentence that says
          it cannot be undone.
        */}
        <details className="cockpit-overflow">
          <summary aria-label={AGENT_COCKPIT_COPY.more_label} title={AGENT_COCKPIT_COPY.more_label}>
            <span aria-hidden="true">···</span>
          </summary>
          <div className="cockpit-overflow-menu">
            <button
              className="button-link"
              disabled={busy !== null}
              onClick={onRefresh}
              type="button"
            >
              {AGENT_COCKPIT_COPY.refresh}
            </button>
            {/* Only where there is a folder to open. `lib/workspace.ts`'s rule
                about dead controls: an agent DASH holds no folder of its own
                for has nothing for this to reveal, and the refusal would arrive
                after the press. */}
            {hasFolder ? (
              <button
                className="button-link"
                disabled={busy !== null}
                onClick={onOpenFolder}
                type="button"
              >
                {AGENT_COCKPIT_COPY.open_folder}
              </button>
            ) : null}
            <Link className="button-link" href={agentStageHref(agent, "settings")}>
              {AGENT_COCKPIT_COPY.remove}
            </Link>
          </div>
        </details>

        {/*
          The design brief's rule — "nothing moves or refreshes without saying
          it did" — applied to the one place DASH refreshes on its own. A live
          region so it is announced rather than only seen, polite so it waits
          its turn, and it disappears with the run rather than becoming
          furniture.
        */}
        <p aria-live="polite" className="live-note">
          {live === null ? "" : AGENT_HEADER_COPY.following(live)}
        </p>
      </div>
    </header>
  );
}

/**
 * The plan behind the goal — every step the manifest declares, in order,
 * and what DASH does and does not do with its declared model (MAR-664).
 *
 * A read-only disclosure of manifest facts, never a control: ADR 0008 bars
 * controls from the author's own declared panel, and while this section is
 * not that panel, it holds itself to the same rule on purpose — nothing here
 * has a press in it. The per-step level control already lives on the
 * Settings stage's `ModelChoice`; this is the plan it is a control *for*,
 * not a second copy of it.
 */
function AgentPlanSection({ plan }: { plan: readonly AgentPlanStep[] }): ReactNode {
  const hasModelStep = plan.some((step) => step.model.kind !== "no_model");
  return (
    <section>
      <h2 className="cockpit-about-heading">{AGENT_ABOUT_COPY.steps_heading}</h2>
      {plan.length === 0 ? (
        <p className="muted wrap">{AGENT_PLAN_EMPTY_SENTENCE}</p>
      ) : (
        <>
          {/* Said once for the whole plan, not once per step — ADR 0011's
              answer to Henrik's fuller ask, "decide what model each step
              use": there is no per-step model picker, and this sentence is
              why. See `lib/agent-plan.ts`. */}
          {hasModelStep ? <p className="muted wrap">{AGENT_PLAN_MODEL_BOUNDARY}</p> : null}
          <ol className="row-list plan-step-list">
            {plan.map((step) => (
              <li key={step.step} className="plan-step">
                <div className="plan-step-head">
                  <span className="plan-step-number">{AGENT_ABOUT_COPY.step_label(step.step)}</span>
                  {/* The id travels but is never composed into a sentence — the
                      rule `AgentRow.capabilities` states and the plain-language
                      sweep in `tests/agent-plan.test.ts` enforces. It is a
                      labelled value here, the same standing the id chip above
                      gives the agent's own id. */}
                  <code className="value">{step.component_id}</code>
                  <span className={`chip chip-${step.risk_tone}`}>{step.risk_label}</span>
                </div>
                <p className="muted wrap">{step.model.sentence}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/**
 * One cell of the action grid that is purely a destination.
 *
 * `aria-current="page"` rather than a class alone, for the reason the sidebar
 * carries it: the solid block of accent is exactly as silent to somebody not
 * looking at it as no marking at all, and this attribute is the half that
 * actually says which view you are in.
 */
function StageAction({
  agent,
  current,
  label,
  target,
}: {
  agent: string;
  current: AgentStage;
  label: string;
  target: AgentStage;
}): ReactNode {
  const active = current === target;
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={active ? "cockpit-action is-active" : "cockpit-action"}
      href={agentStageHref(agent, target)}
    >
      {label}
    </Link>
  );
}

/**
 * The status, as one chip.
 *
 * The old page rendered this as an `<h2>` with a paragraph under it inside a
 * `workspace-overview` block halfway down, and only when a snapshot existed —
 * so the most basic question about an agent was both buried and, for a new
 * agent, absent. `buildAgentControl` guarantees a status in every state, which
 * is why this component has no null branch.
 *
 * The detail sentence is the chip's `title` and its accessible description
 * rather than a paragraph beside it. It is a clarification of a word that is
 * usually self-explanatory — "Running", "Paused" — and giving it permanent
 * screen space is precisely the tax MAR-609 is about.
 */
function StatusPill({ control }: { control: AgentControlView }): ReactNode {
  const { status } = control;
  return (
    <p className={`status-pill status-${status.tone}`} title={status.detail}>
      <span className="status-dot" aria-hidden="true" />
      <span>{status.label}</span>
      <span className="visually-hidden">. {status.detail}</span>
    </p>
  );
}

/**
 * The control panel — start, pause, cancel, or the reason there is none
 * (MAR-609).
 *
 * ## Never nothing
 *
 * Every branch renders. That is the entire behavioural change from the old
 * `RunNow`, which returned `null` for three different reasons and left a
 * freshly added agent with no control and no explanation. `AgentRunControl` is
 * a union with an `idle` arm carrying which sentence applies, so there is no
 * route through this component that draws empty space.
 *
 * ## The verbs are not this component's
 *
 * `controls` on a live run come from `lib/workspace.ts`'s state machine already
 * worded. This renders them in the order given and adds nothing — a panel that
 * decided for itself which of pause/resume/cancel to offer would be a second
 * opinion about a run's state, free to offer Resume on something already
 * finished.
 */
export function AgentControls({
  busy,
  hasFiles,
  hosts,
  onCancelKey,
  onRun,
  onRunControl,
  onRunOnHost,
  onStart,
  run,
  runSpend,
}: {
  /** The pending command key, or null. Disables the row while one is in flight. */
  busy: string | null;
  /** Whether files are staged, which changes only the label (MAR-507). */
  hasFiles: boolean;
  /**
   * Servers this agent has been sent to, already filtered to the ones with a
   * name (MAR-602, ADR 0014).
   *
   * Empty for almost every agent, and an empty list draws nothing.
   */
  hosts: AgentDeployTarget[];
  /** Builds the pending key for a run control, so the caller owns key shape. */
  onCancelKey: (command: AvailableControl["command"], runId: string) => string;
  onRun: (taskId: string, observedAt: string) => void;
  /**
   * Start this agent's process on this computer, then ask it to run (MAR-657).
   *
   * A separate callback from `onRun` rather than a mode on it, because they are
   * two different acts on two different channels — `runner.start` and the
   * lifecycle route for this one, an Agent DOM `retry` envelope for the other —
   * and one callback taking a flag would be a page one boolean away from
   * spawning a process when it meant to bind a task.
   *
   * It takes no task id, and that absence is the whole shape of the issue: the
   * task this press eventually binds does not exist yet and cannot, because the
   * agent that publishes it is not running.
   */
  onStart: () => void;
  /*
   * `AvailableControl["command"]` rather than `string`, so the page needs no
   * cast on the way to `submitAgentCommand`. A `string` here would have forced
   * one, and a cast at that boundary is how a verb the command schema does not
   * accept reaches the runner and is refused after the press.
   */
  onRunControl: (
    command: AvailableControl["command"],
    runId: string,
    observedAt: string,
  ) => void;
  /** Ask one server to start this agent (MAR-602). */
  onRunOnHost: (target: AgentDeployTarget) => void;
  run: AgentControlView["run"];
  /**
   * What pressing Run now will spend, or null (MAR-619, ADR 0016).
   *
   * `WorkspaceView.run_spend`, already worded — this component composes no
   * sentence of its own, which is the rule `lib/copy/` keeps and the reason a
   * page can be swept for plain language at all. Null on nearly every agent;
   * see the field's own note for the three ways a run cannot cost anything.
   */
  runSpend: string | null;
}): ReactNode {
  /*
   * MAR-602's per-server buttons, beside whatever the local control is.
   *
   * ## Why these are outside the three branches
   *
   * They arrived on master while this rebuild was in flight, living inside
   * `RunNow` — which meant they inherited all three of that component's early
   * returns and vanished when there was no snapshot, no pending task, or no
   * permission to act locally. Only the last of those has anything to do with
   * running an agent somewhere else: `submitHostCommand("run", …)` carries a
   * host id and an agent id and nothing from the local snapshot, so a missing
   * `observed_at` or an absent pending task cannot make it wrong.
   *
   * So they render whenever the panel does, which is always. That is a real
   * change to freshly merged work and it is the same correction this whole
   * issue is: a control that disappears for a reason unrelated to itself.
   *
   * `read_only` is the one state that suppresses them, and correctly —
   * `lib/workspace.ts`'s rule about dead controls. A browser tab cannot reach
   * the command boundary at all.
   */
  const canReachHosts = !(run.kind === "idle" && run.reason === "read_only");
  const hostButtons =
    !canReachHosts || hosts.length === 0 ? null : (
      <>
        {/* MAR-602, ADR 0014. One named control per server, beside the first
            and never instead of it.

            Deploying an agent does not change what the button to its left
            does — that is the rule the ADR chose over silent re-targeting, and
            it is why this is a sibling rather than a mode. The machine is in
            the name because "Run on Hostinger" is four words that say what they
            do, while appending a machine to the primary label would put a
            sentence inside a letter-spaced control.

            No files step in front of it, and that is a limit rather than an
            oversight: the dispatch path hands files to the runner **on this
            computer**, and there is no path today that puts a person's file on
            a server. A copy over there runs against what was deployed with it. */}
        {hosts.map((target) => (
          <button
            className="button-secondary"
            disabled={busy !== null}
            key={target.host_id}
            onClick={() => {
              onRunOnHost(target);
            }}
            type="button"
          >
            {busy === `host-run:${target.host_id}`
              ? AGENT_CONTROL_COPY.asking
              : describeRunOnHost(target.label)}
          </button>
        ))}
      </>
    );

  if (run.kind === "idle") {
    return (
      <section
        aria-labelledby="agent-commands-heading"
        className="section agent-controls agent-controls-idle"
      >
        <div className="section-heading">
          <h2 id="agent-commands-heading">{AGENT_CONTROL_COPY.heading}</h2>
        </div>
        {hostButtons === null ? null : <div className="button-row">{hostButtons}</div>}
        <p className="muted">{AGENT_CONTROL_COPY.idle[run.reason]}</p>
      </section>
    );
  }

  /*
   * The agent is registered here and its process is not running (MAR-657).
   *
   * Rendered as the primary control in the same slot Run now occupies, because
   * it is the same intention — *make this agent do its work* — and a person who
   * closed DASH yesterday should not have to learn that their agent's process is
   * a separate thing from their agent. The label says both verbs and
   * `start_here` says which machine, which is ADR 0014's rule met in the
   * sentence rather than in the button.
   *
   * It carries `runSpend` for the same reason the Run now branch does, and the
   * reason is sharper here: this press ends in a `retry`, so it opens the same
   * allowance and can spend the same money. A disclosure that appeared on one of
   * the two buttons that spend would be worse than none, because its absence
   * would read as "this one is free".
   */
  if (run.kind === "start") {
    return (
      <section aria-labelledby="agent-commands-heading" className="section agent-controls">
        <div className="section-heading">
          <h2 id="agent-commands-heading">{AGENT_CONTROL_COPY.heading}</h2>
        </div>
        <div className="button-row">
          <button
            className="button-primary"
            disabled={busy !== null}
            onClick={onStart}
            type="button"
          >
            {busy === "start" ? AGENT_CONTROL_COPY.running : AGENT_CONTROL_COPY.start_and_run}
          </button>
          {hostButtons}
        </div>
        <p className="muted">{AGENT_CONTROL_COPY.start_here}</p>
        {runSpend === null ? null : <p className="muted">{runSpend}</p>}
      </section>
    );
  }

  if (run.kind === "live") {
    return (
      <section aria-labelledby="agent-commands-heading" className="section agent-controls">
        <div className="section-heading">
          <h2 id="agent-commands-heading">{AGENT_CONTROL_COPY.heading}</h2>
        </div>
        <div className="button-row">
          {run.controls.map((control) => (
            <button
              className={control.command === "cancel" ? "button-danger" : "button-primary"}
              disabled={busy !== null}
              key={control.command}
              onClick={() => {
                onRunControl(control.command, run.run_id, run.observed_at);
              }}
              type="button"
            >
              {busy === onCancelKey(control.command, run.run_id)
                ? AGENT_CONTROL_COPY.running
                : control.label}
            </button>
          ))}
          {hostButtons}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="agent-commands-heading" className="section agent-controls">
      <div className="section-heading">
        <h2 id="agent-commands-heading">{AGENT_CONTROL_COPY.heading}</h2>
      </div>
      <div className="button-row">
        <button
          className="button-primary"
          disabled={busy !== null}
          onClick={() => {
            onRun(run.task_id, run.observed_at);
          }}
          type="button"
        >
          {busy === `run:${run.task_id}`
            ? AGENT_CONTROL_COPY.running
            : hasFiles
              ? AGENT_CONTROL_COPY.run_now_with_files
              : AGENT_CONTROL_COPY.run_now}
        </button>
        {hostButtons}
      </div>
      {/* MAR-646 took a sentence from here: *"It runs only when you ask.
          Nothing happens on a timer."* That is the trigger, and the trigger is
          a setting — the switcher on the Settings stage says it twice already,
          under a heading that says what it is and beside the control that would
          change it if DASH had a scheduler. A third statement of it under a
          button on a different stage is the echo this packet is about. */}
      {/* MAR-619, ADR 0016. What this press will spend, under the button that
          spends it.

          Under and not behind a note, which is the one placement decision here
          and `lib/copy/info-note.ts`'s question decides it flatly: a sentence
          saying the next thing you press costs money is the definition of
          decision-changing. It is also the only branch of this component that
          gets one — a live run has already been paid for, and an idle panel has
          no press to disclose. */}
      {runSpend === null ? null : <p className="muted">{runSpend}</p>}
    </section>
  );
}

/**
 * This agent's character, at 2x (MAR-502).
 *
 * 100px because a portrait is what this surface is — the one place in DASH
 * where the character is closest to being the subject rather than a marker in a
 * list. Never 1.5x and never a percentage: `image-rendering: pixelated`
 * upscales by nearest neighbour, so a fractional ratio lands some source pixels
 * on two screen pixels and some on three, and the sprite stops reading as pixel
 * art and starts reading as a rendering fault.
 *
 * **The empty case reserves the box rather than collapsing it.** `avatar` is
 * null only when DASH cannot read this agent's own row — the workspace is built
 * from the manifest, which is a different column — and a header that reflowed
 * when a database read came back short would move the agent's name under the
 * user's cursor for a reason that has nothing to do with them. Nothing is drawn
 * in the reserved space and nothing is announced: an invented character would
 * be a costume this agent might not be wearing on the card it came from, and
 * the whole value of one is that it is the same every time.
 *
 * Moved here from `app/agents/detail/page.tsx` unchanged, because the header it
 * belongs to is now a component and a portrait defined on the page but rendered
 * in the header is how the two drift apart.
 */
export function AgentPortrait({
  avatar,
  size = 100,
}: {
  avatar: OName | null;
  /**
   * 100 for a surface where the character is the subject, 50 in the cockpit's
   * fixed band (MAR-641).
   *
   * Only the two, and only because both are whole multiples of the 50px source
   * — the union in `lib/brand/o-cast.ts` is the guard, and the reason there is
   * no percentage here is in this function's own docblock.
   */
  size?: 50 | 100;
}): ReactNode {
  if (avatar === null) {
    return <span className="o-portrait-empty" aria-hidden="true" />;
  }
  return <OAvatar name={avatar} size={size} action />;
}
