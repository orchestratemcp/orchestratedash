"use client";

import type { ReactNode } from "react";

import { AGENT_CONTROL_COPY, AGENT_HEADER_COPY } from "../../lib/copy/agent-page";
/* MAR-602. Safe as a value in this bundle: `lib/copy/where-it-ran.ts` imports
   nothing that reaches a disk, and its one reference to `lib/store.ts` is a
   type. The same arrangement the agent page itself relies on. */
import { describeRunOnHost } from "../../lib/copy/where-it-ran";
import type { AgentControlView } from "../../lib/views/agent-control";
import type { AgentDeployTarget } from "../../lib/views/types";
import type { AvailableControl } from "../../lib/workspace";
import type { OName } from "../../lib/brand/o-cast";
import { OAvatar } from "./o-avatar";

/**
 * Who this agent is, and the buttons that act on it — in one block, above
 * everything (MAR-609).
 *
 * ## What this replaces
 *
 * The old page opened with a portrait, a name, a goal and a **Refresh state**
 * button, and then put the things a person came to do at positions four, six
 * and eleven of eighteen sections. Henrik's complaint was *"you get no
 * overview"*, and the header was the clearest instance of it: the one region
 * guaranteed to be on screen was spent entirely on identity, with a single
 * control on it, and that control was the one that does the least.
 *
 * Five of his six asks are things you *do*. So the header is now identity **and**
 * the control panel, and the page below it is what the agent has made.
 *
 * ## The id, under MAR-589's ruling
 *
 * Henrik ruled that the display name is first-class and the id is a value. So
 * the name is the `<h1>` and the id sits beside it in a monospace chip with the
 * word "ID" in front of it. The chip is not decoration: this page is where
 * somebody reads the name, and the fleet card, the deploy picker and the
 * connector tiles all still print the id — until the cross-surface pass lands,
 * the chip is what lets a person match this page to those.
 */
export function AgentHeader({
  avatar,
  control,
  goal,
  id,
  live,
  onRefresh,
  onSettings,
  title,
}: {
  avatar: OName | null;
  control: AgentControlView;
  goal: string;
  /** The agent's id — a value, never a label. See MAR-589. */
  id: string;
  /** The clock time of the last poll while a run is being followed, else null. */
  live: string | null;
  onRefresh: () => void;
  onSettings: () => void;
  /** The display name, from `agentDisplayName`. Never the raw id. */
  title: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <header className="agent-header">
      <div className="agent-identity agent-portrait">
        <AgentPortrait avatar={avatar} />
        <div className="agent-identity-text">
          <p className="eyebrow">{AGENT_HEADER_COPY.eyebrow}</p>
          <h1>{title}</h1>
          {/* One line, and it is the author's sentence about what the agent is
              for. Everything else that used to be prose up here is now either a
              tile or behind the settings button. */}
          <p className="lede">{goal}</p>
          <p className="agent-id-chip">
            <span className="agent-id-label">{AGENT_HEADER_COPY.id_label}</span>{" "}
            <code className="value">{id}</code>
          </p>
        </div>
      </div>

      <div className="agent-header-controls">
        <div className="agent-status-line">
          <StatusPill control={control} />
          <div className="button-row">
            <button className="button-secondary" onClick={onSettings} type="button">
              {AGENT_HEADER_COPY.settings}
            </button>
            <button className="button-secondary" onClick={onRefresh} type="button">
              {AGENT_HEADER_COPY.refresh}
            </button>
          </div>
        </div>
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
      <section className="section agent-controls agent-controls-idle">
        {hostButtons === null ? null : <div className="button-row">{hostButtons}</div>}
        <p className="muted">{AGENT_CONTROL_COPY.idle[run.reason]}</p>
      </section>
    );
  }

  if (run.kind === "live") {
    return (
      <section className="section agent-controls">
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
    <section className="section agent-controls">
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
      {/* The one sentence about cadence, said once and here rather than under
          every control. The trigger tile and the switcher in Settings are where
          a person goes to change it. */}
      <p className="muted">{AGENT_CONTROL_COPY.manual_note}</p>
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
export function AgentPortrait({ avatar }: { avatar: OName | null }): ReactNode {
  if (avatar === null) {
    return <span className="o-portrait-empty" aria-hidden="true" />;
  }
  return <OAvatar name={avatar} size={100} />;
}
