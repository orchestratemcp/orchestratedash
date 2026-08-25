"use client";

import Link from "next/link";
import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { AGENT_SETTINGS_COPY, AGENT_TRIGGER_COPY } from "../../lib/copy/agent-page";
import { O_FLEET, type OName } from "../../lib/brand/o-cast";
import type { AgentScheduleView } from "../../lib/views/agent-schedule";
import type { StandingAnswerView } from "../../lib/views/types";
import {
  clearAgentSchedule,
  clearStandingAnswer,
  renameAgent,
  setAgentAvatar,
  setAgentSchedule,
} from "../_data/source";
import { OAvatar } from "./o-avatar";

/**
 * Henrik's settings button (MAR-609), and an honest account of what is behind
 * it.
 *
 * ## What he asked for
 *
 * > *"I want a settings button. Swap notification channel, avatar, name etc"*
 *
 * ## What is actually here
 *
 * Two of the three items he named by name are **read-only** in this drawer,
 * each for a different reason worth writing down rather than discovering:
 *
 * 1. **Name.** MAR-589's ruling — taken by Henrik during this issue — is that
 *    the display name is first-class and the id is a value. This row now
 *    carries both halves of that ruling: the reading half (the name is prose,
 *    the id sits below it in `<code>`) shipped with this drawer, and the
 *    writing half — a `display_name` column, a rename command, this row
 *    becoming an input — is what MAR-589's own follow-up pass built. See
 *    `AgentNameField`.
 * 2. **Avatar.** Per-agent avatar choice is MAR-615's second piece. Henrik
 *    asked for a dedicated session for the cast work, so taking the picker
 *    here would fragment it.
 * 3. **Notification channel.** There is no per-agent channel to swap.
 *    `NotificationsView` is `configured`, `masked_hint`, `configured_at`,
 *    `send_approvals`, `send_reports` — one Discord webhook for the whole
 *    product. The drawer says so and links to the page that owns it, which is
 *    more use than a per-agent control that would quietly write a global one.
 *
 * **Showing the still-read-only two as read-only is the point, not a
 * consolation.** A settings drawer that simply omitted what somebody asked for
 * reads as a drawer that forgot it. One that shows each with its provenance
 * and where it is changed reads as a product that knows its own edges — the
 * same discipline `ManifestGapNotice` applies when DASH is about to do less
 * than it could.
 *
 * ## What is genuinely writable, and why it moved here
 *
 * The model picker, the folder controls and the two removal actions were three
 * separate full-width sections on the page, at positions eight, nine and
 * eighteen. All three are settings — things you change once and then do not
 * look at — and all three were competing with the agent's own output for
 * vertical space. They are rendered by their existing components, unchanged, as
 * `children`: this drawer owns placement, not their behaviour.
 */
export function AgentSettings({
  avatar,
  canAct,
  id,
  onAvatarChanged,
  onClose,
  onRenamed,
  renamed,
  schedule,
  setFeedback,
  title,
  trigger,
  children,
  danger,
}: {
  avatar: OName | null;
  /** Whether this window may act, `ModelChoice`'s own gate. */
  canAct: boolean;
  /** A value under MAR-589, and rendered as one. */
  id: string;
  onClose: () => void;
  /** Re-read the workspace, so the row redraws with the character it just saved (MAR-615). */
  onAvatarChanged: () => void;
  /** Re-read the workspace, so the drawer redraws with the name it just saved. */
  onRenamed: () => void;
  /** Whether `title` is a stored rename rather than the manifest's own name. */
  renamed: boolean;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
  /** The display name, from `agentDisplayName`. */
  title: string;
  /** What the agent's own manifest calls its trigger, or null if it says nothing. */
  trigger: string | null;
  /**
   * When DASH starts this agent on its own, and what became of the last time
   * (MAR-742 item 8, ADR 0029).
   *
   * Never null: the view's "nothing standing" state carries its own sentence, so
   * this drawer never has to decide what an absent schedule means.
   */
  schedule: AgentScheduleView;
  /** `ModelChoice`, `FolderUpdate` — the settings that can actually be written. */
  children?: ReactNode;
  /** `RemoveAgent`. Last, under its own heading. See the danger block below. */
  danger?: ReactNode;
}): ReactNode {
  return (
    <section className="agent-settings" aria-labelledby="agent-settings-heading">
      <div className="section-heading">
        <h2 id="agent-settings-heading">{AGENT_SETTINGS_COPY.heading}</h2>
        <button className="button-secondary" onClick={onClose} type="button">
          {AGENT_SETTINGS_COPY.close}
        </button>
      </div>

      <section className="agent-settings-block">
        <h3>{AGENT_SETTINGS_COPY.identity.heading}</h3>
        <dl className="facts">
          <div>
            <dt>{AGENT_SETTINGS_COPY.identity.name_label}</dt>
            {/* Not `.value`. Under MAR-589 the name is prose and only the id
                gets the monospace face — that distinction is the whole ruling,
                and a drawer that set them in the same type would undo it in the
                one place a person comes to look at both. */}
            <AgentNameField
              agentId={id}
              canAct={canAct}
              onRenamed={onRenamed}
              renamed={renamed}
              setFeedback={setFeedback}
              title={title}
            />
            <dd className="muted">
              {renamed
                ? AGENT_SETTINGS_COPY.identity.name_source_renamed
                : AGENT_SETTINGS_COPY.identity.name_source}
            </dd>
          </div>
          <div>
            <dt>{AGENT_SETTINGS_COPY.identity.id_label}</dt>
            <dd className="value">{id}</dd>
            <dd className="muted">{AGENT_SETTINGS_COPY.identity.id_source}</dd>
          </div>
          <div>
            <dt>{AGENT_SETTINGS_COPY.identity.avatar_label}</dt>
            <AgentAvatarField
              agentId={id}
              avatar={avatar}
              canAct={canAct}
              onChanged={onAvatarChanged}
              setFeedback={setFeedback}
            />
            <dd className="muted">{AGENT_SETTINGS_COPY.identity.avatar_source}</dd>
          </div>
        </dl>
      </section>

      {/* MAR-742 item 8, ADR 0029. `onRenamed` is the re-read this drawer
          already has — the panel needs the workspace re-read for the same reason
          a rename does, so it rides the same one rather than adding a second
          callback that means the same thing. */}
      <TriggerSwitch
        agentId={id}
        canAct={canAct}
        declared={trigger}
        onChanged={onRenamed}
        schedule={schedule}
        setFeedback={setFeedback}
      />

      <section className="agent-settings-block">
        <h3>{AGENT_SETTINGS_COPY.notifications.heading}</h3>
        <p className="muted wrap">{AGENT_SETTINGS_COPY.notifications.scope}</p>
        <p>
          <Link href="/settings/notifications">{AGENT_SETTINGS_COPY.notifications.link}</Link>
        </p>
      </section>

      {children}

      {danger === undefined ? null : (
        <section className="agent-settings-block agent-settings-danger">
          <h3>{AGENT_SETTINGS_COPY.danger.heading}</h3>
          <p className="muted">{AGENT_SETTINGS_COPY.danger.detail}</p>
          {danger}
        </section>
      )}
    </section>
  );
}

/**
 * The name row's write half (MAR-589).
 *
 * `ModelChoice`'s shape: its own `busy` and its own outcome, reported through
 * the shared `setFeedback` rather than a private notice, so a rename and a
 * model change in the same drawer visit do not draw two separate banners.
 *
 * ## Editing is opt-in, and closes on either outcome
 *
 * The row opens as prose plus a *Rename* button rather than as a standing
 * input — a text box sitting open on a name nobody is changing would be the
 * dead-looking control `lib/workspace.ts` closes its vocabulary to prevent for
 * run commands, applied here to a field instead of a button. Saving or
 * cancelling both return it to prose; only a save also calls `onRenamed`,
 * since a cancel changed nothing worth re-reading the workspace for.
 */
function AgentNameField({
  agentId,
  canAct,
  onRenamed,
  renamed,
  setFeedback,
  title,
}: {
  agentId: string;
  canAct: boolean;
  onRenamed: () => void;
  renamed: boolean;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
  title: string;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);

  if (!canAct) {
    /*
     * Said rather than drawn as a disabled button, `ModelChoice`'s reason: a
     * greyed-out Rename here would read as a claim about this agent, and the
     * true statement is about which window this is.
     */
    return (
      <dd className="agent-name-field">
        <span>{title}</span>
        <span className="muted wrap">{AGENT_SETTINGS_COPY.identity.rename_read_only}</span>
      </dd>
    );
  }

  async function commit(displayName: string | undefined): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await renameAgent({ agent_id: agentId, display_name: displayName });
    setBusy(false);
    setFeedback({
      ok: result.ok,
      message: result.ok
        ? "Saved."
        : (result.detail ?? "DASH could not rename this agent."),
    });
    if (result.ok) {
      setEditing(false);
      onRenamed();
    }
  }

  if (!editing) {
    return (
      <dd className="agent-name-field">
        <span>{title}</span>
        <span className="button-row">
          <button
            type="button"
            className="button-link"
            disabled={busy}
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
          >
            {AGENT_SETTINGS_COPY.identity.rename_edit}
          </button>
          {/* Only once a rename exists to undo — an agent nobody has renamed
              has nothing here for this to put back. */}
          {renamed ? (
            <button
              type="button"
              className="button-link"
              disabled={busy}
              onClick={() => void commit(undefined)}
            >
              {AGENT_SETTINGS_COPY.identity.rename_reset}
            </button>
          ) : null}
        </span>
      </dd>
    );
  }

  return (
    <dd className="agent-name-field">
      <label className="visually-hidden" htmlFor={`agent-name-${agentId}`}>
        {AGENT_SETTINGS_COPY.identity.rename_placeholder}
      </label>
      <input
        id={`agent-name-${agentId}`}
        className="field"
        value={draft}
        disabled={busy}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      <span className="button-row">
        <button
          type="button"
          className="button-primary"
          disabled={busy || draft.trim() === ""}
          onClick={() => void commit(draft)}
        >
          {AGENT_SETTINGS_COPY.identity.rename_save}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy}
          onClick={() => {
            setEditing(false);
          }}
        >
          {AGENT_SETTINGS_COPY.identity.rename_cancel}
        </button>
      </span>
    </dd>
  );
}

/**
 * The avatar row's write half (MAR-615).
 *
 * `AgentNameField`'s shape: closed as prose plus a button rather than a
 * standing-open control, and closes on either outcome. Unlike the name field
 * there is no text to draft — choosing *is* saving, so a press on one of the
 * eleven options both picks it and commits it, the way a picker reads
 * everywhere else in DASH (`FolderUpdate`'s own radios).
 *
 * Offers `O_FLEET`, never `O_NAMES`: the chief is cast but not fleet, and a
 * grid that offered him here would be the one surface where an ordinary
 * agent could end up in the orchestrator's own costume. `lib/store.ts`'s
 * `setAgentAvatar` refuses him too, so this is belt-and-suspenders rather
 * than the only gate — but the belt is what keeps the grid from ever
 * rendering the option in the first place.
 */
function AgentAvatarField({
  agentId,
  avatar,
  canAct,
  onChanged,
  setFeedback,
}: {
  agentId: string;
  avatar: OName | null;
  canAct: boolean;
  /** Re-read the workspace, so the row redraws with the character it just saved. */
  onChanged: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  /* 50, not 48. `OSize` is `50 | 100 | 200` and the union is the guard rather
     than a style preference: `image-rendering: pixelated` upscales by nearest
     neighbour, so an off-scale size lands some source pixels on two screen
     pixels and some on three, and the sprite stops reading as pixel art and
     starts reading as a rendering fault. Half the header's 100. */
  const portrait =
    avatar === null ? (
      <span className="o-portrait-empty" aria-hidden="true" />
    ) : (
      <OAvatar name={avatar} size={50} action />
    );

  if (!canAct) {
    /* Said rather than drawn as a disabled button, `ModelChoice`'s reason: a
       greyed-out Change here would read as a claim about this agent, and the
       true statement is about which window this is. */
    return (
      <dd className="agent-avatar-field">
        {portrait}
        <span className="muted wrap">{AGENT_SETTINGS_COPY.identity.avatar_read_only}</span>
      </dd>
    );
  }

  async function choose(character: (typeof O_FLEET)[number]): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await setAgentAvatar({ agent_id: agentId, avatar: character });
    setBusy(false);
    setFeedback({
      ok: result.ok,
      message: result.ok ? "Saved." : (result.detail ?? "DASH could not change this agent's avatar."),
    });
    if (result.ok) {
      setPicking(false);
      onChanged();
    }
  }

  if (!picking) {
    return (
      <dd className="agent-avatar-field">
        {portrait}
        <button type="button" className="button-link" disabled={busy} onClick={() => setPicking(true)}>
          {AGENT_SETTINGS_COPY.identity.avatar_edit}
        </button>
      </dd>
    );
  }

  return (
    <dd className="agent-avatar-field">
      <ul className="avatar-picker" aria-label={AGENT_SETTINGS_COPY.identity.avatar_label}>
        {O_FLEET.map((character) => (
          <li key={character}>
            <button
              type="button"
              className="avatar-picker-option"
              aria-pressed={character === avatar}
              disabled={busy}
              onClick={() => void choose(character)}
            >
              {/* Decorative, like every other avatar in DASH — the accessible
                  name is on the button, not the picture, `fleet-strip.tsx`'s
                  own pattern for a costume inside an interactive control. */}
              <OAvatar name={character} size={50} action />
              <span className="visually-hidden">{AGENT_SETTINGS_COPY.identity.avatar_choose(character)}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="button-secondary" disabled={busy} onClick={() => setPicking(false)}>
        {AGENT_SETTINGS_COPY.identity.avatar_cancel}
      </button>
    </dd>
  );
}

/**
 * "Always answer this way", revocable (MAR-681).
 *
 * Henrik's own words, on the walk where the competitor scout's question
 * expired unanswered: *"I want both all the time."* Each row is a receipt —
 * the question and the chosen option in the agent's own words, never DASH's
 * paraphrase — plus the one control this drawer offers over it: forget it, so
 * DASH asks again next time.
 *
 * Renders nothing for an agent nobody has answered this way for, `identity`'s
 * reason: a heading over an empty list is the wall MAR-609 was filed on.
 */
export function StandingAnswers({
  agent,
  answers,
  canAct,
  onChanged,
  setFeedback,
}: {
  agent: string;
  answers: StandingAnswerView[];
  canAct: boolean;
  /** Re-read the workspace, so the row a Forget press removed actually goes. */
  onChanged: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  if (answers.length === 0) {
    return null;
  }
  return (
    <section className="agent-settings-block">
      <h3>{AGENT_SETTINGS_COPY.standing_answers.heading}</h3>
      <p className="muted wrap">{AGENT_SETTINGS_COPY.standing_answers.detail}</p>
      <ol className="row-list">
        {answers.map((answer) => (
          <StandingAnswerRow
            agent={agent}
            answer={answer}
            canAct={canAct}
            key={answer.question_key}
            onChanged={onChanged}
            setFeedback={setFeedback}
          />
        ))}
      </ol>
    </section>
  );
}

function StandingAnswerRow({
  agent,
  answer,
  canAct,
  onChanged,
  setFeedback,
}: {
  agent: string;
  answer: StandingAnswerView;
  canAct: boolean;
  onChanged: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [busy, setBusy] = useState(false);

  async function forget(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await clearStandingAnswer({ agent_id: agent, question_key: answer.question_key });
    setBusy(false);
    setFeedback({
      ok: result.ok,
      message: result.ok ? "Forgotten." : (result.detail ?? "DASH could not forget this answer."),
    });
    if (result.ok) {
      onChanged();
    }
  }

  return (
    <li>
      <article className="row-card">
        <h3>{answer.question_label}</h3>
        <p>{answer.option_label}</p>
        <div className="button-row">
          <p className="muted">{AGENT_SETTINGS_COPY.standing_answers.set_on(answer.chosen_at)}</p>
          {/* Said rather than drawn as a disabled button, `AgentNameField`'s
              reason: a greyed-out Forget here would read as a claim about this
              agent, and the true statement is about which window this is. */}
          {canAct ? (
            <button
              className="button-link"
              disabled={busy}
              onClick={() => void forget()}
              type="button"
            >
              {AGENT_SETTINGS_COPY.standing_answers.forget}
            </button>
          ) : null}
        </div>
      </article>
    </li>
  );
}

/**
 * The trigger switcher — the sixth ask, and the packet that finally answers it.
 *
 * > *"I want to be able to switch trigger. Trigger on command or set a time or
 * > how often it should trigger."*
 *
 * ## What this used to be, and why the change is careful
 *
 * MAR-641 built this with **one working option and two disabled ones**, because
 * ADR 0014 had declined trigger configuration: *"It is blocked on
 * restart-on-boot, which ADR 0007 left open on purpose, and it needs a scheduler
 * that exists nowhere in this repository."* The disabled radios said "Not built
 * yet" and named what they were waiting on, and for four months that was the
 * most useful thing this panel could do.
 *
 * MAR-742 item 8 built the scheduler (ADR 0029) and the middle option became a
 * control. **The restart-on-boot half of ADR 0014's sentence did not change**,
 * which is why this component is not simply a time picker: a schedule fires from
 * the runner, the runner is started by DASH, and a computer that has been off
 * comes back with nothing running until DASH is opened once. The three liveness
 * sentences under the control are that fact, and they are the reason this is an
 * honest control rather than a promise.
 *
 * ## The things on screen that are not the control
 *
 * `liveness` and `spend_line` are shown **only while a schedule is standing**.
 * Under a panel with no schedule they would be DASH explaining the limits of a
 * feature nobody has asked for, which is the *"describing its own internals at
 * somebody who came to look at their agent"* failure `ModelChoice` names. Once
 * one is standing they are load-bearing: the person has just decided to depend
 * on something, and these are the ways that dependence can surprise them.
 *
 * `spend_bound` is a third, shown only when there is an allowance for it to
 * bound (MAR-784, ADR 0029 amendment 1). It is the sentence that costs this
 * feature something — *a scheduled run can use your model while DASH is open,
 * and not while it is closed* — and it is on screen for the same reason the
 * third liveness sentence is: the person setting a 03:00 schedule is exactly the
 * person it is about.
 *
 * ## The switch beside the time
 *
 * MAR-784, on Henrik's ruling that *"some agents really need to use AI and some
 * don't"*. It is **inside** the timed option's block and **above** Save, which
 * makes it part of one press rather than a control of its own: the ceiling and
 * the cadence are one decision, and a switch that saved on its own would be a
 * machine given permission to spend by a stray click on a list.
 *
 * Off is the default and off is what every existing schedule reads as. What the
 * switch writes is a *number* — see `AgentScheduleView.allowance_choice` — so
 * that offering the quantity later is a control rather than a migration.
 *
 * ## The disabled radio that remains
 *
 * A written schedule — cron — is still not offered, and the copy gives the new
 * reason rather than keeping the old one, because the old one stopped being
 * true. `lib/workspace.ts`'s rule against dead controls is not violated by it,
 * for MAR-641's own reason: this radio does not look like it would act, it
 * states a limit of the product, and hiding it would leave a person believing
 * DASH had silently ignored half of what they asked for.
 *
 * ## The declared-trigger line
 *
 * An agent's author may declare a cadence in its manifest — `WorkspaceTrigger`
 * carries `type`, `label` and an optional `expected_interval_seconds`, and
 * `lib/workspace.ts` uses the interval only to decide whether an agent looks
 * stalled. **DASH still keeps no cadence it was not told to keep here.** When
 * the author's word and DASH's behaviour disagree, both are shown: reporting
 * only the manifest would promise something nothing delivers, and reporting only
 * DASH's behaviour would hide why the agent's own documentation says otherwise.
 */
export function TriggerSwitch({
  agentId,
  canAct,
  declared,
  onChanged,
  schedule,
  setFeedback,
}: {
  agentId: string;
  /** Whether this window may act, `ModelChoice`'s own gate. */
  canAct: boolean;
  declared: string | null;
  /** Re-read the workspace, so the panel redraws with what it just saved. */
  onChanged: () => void;
  schedule: AgentScheduleView;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const standing = schedule.at_local !== null;
  /*
   * The draft starts at what is standing, or at a default nobody has to think
   * about. 08:00 rather than the current time: a schedule is a morning habit far
   * more often than it is "whenever I happened to open this drawer", and a
   * default that changed with the clock would make two people setting the same
   * thing get different answers.
   */
  const [draft, setDraft] = useState(schedule.at_local ?? "08:00");
  /*
   * MAR-784. The ceiling, as a switch rather than a number.
   *
   * The stored value is a count of model calls and the panel offers exactly two
   * of them — off, and `allowance_choice`, which is what a person's own press of
   * Run now buys. That is the novice-first reading of Henrik's ruling: the
   * question somebody actually has is *"may this one use AI?"*, and a number
   * field would ask them to have an opinion about a quantity whose only honest
   * ceiling is a constant they cannot see. The column stays a number so that
   * offering the quantity later is a control and not a migration — the argument
   * `agent_schedules.kind` already makes about itself.
   *
   * Seeded from what is standing so the switch reflects the store on open, and
   * re-seeded by nothing: like `draft`, this is a draft, and a poll landing
   * mid-edit must not move a control somebody is looking at.
   */
  const [allow, setAllow] = useState(schedule.allowance_calls > 0);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await setAgentSchedule({
      agent_id: agentId,
      at_local: draft,
      /*
       * Stated on every save, never omitted. `schedule.set` replaces the whole
       * row, so leaving this out would switch a ceiling off as a side effect of
       * changing a time — see the field's own note in `electron/preload.ts`.
       */
      allowance_calls: allow ? schedule.allowance_choice : 0,
    });
    setBusy(false);
    setFeedback({
      ok: result.ok,
      message: result.ok
        ? AGENT_TRIGGER_COPY.standing(draft)
        : (result.detail ?? result.reason ?? "DASH could not save this schedule."),
    });
    if (result.ok) {
      onChanged();
    }
  }

  async function turnOff(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await clearAgentSchedule({ agent_id: agentId });
    setBusy(false);
    setFeedback({
      ok: result.ok,
      message: result.ok
        ? AGENT_TRIGGER_COPY.none_standing
        : (result.detail ?? result.reason ?? "DASH could not turn this schedule off."),
    });
    if (result.ok) {
      onChanged();
    }
  }

  /*
   * A manual trigger's label is already what the radio says, so repeating it
   * would print "On command" twice under itself. Compared case-insensitively
   * and loosely on purpose: this is a cosmetic de-duplication, and being wrong
   * in either direction costs one redundant line rather than a wrong claim.
   */
  const conflicts =
    declared !== null && !/^\s*(on\s+)?(command|demand|request|manual)/i.test(declared);

  return (
    <section className="agent-settings-block agent-trigger">
      <h3>{AGENT_TRIGGER_COPY.heading}</h3>
      <p className="wrap">{schedule.standing_line}</p>

      <ul className="trigger-options">
        <TriggerOption
          available
          checked={!standing}
          detail={AGENT_TRIGGER_COPY.on_command.detail}
          label={AGENT_TRIGGER_COPY.on_command.label}
          onSelect={standing && canAct && !busy ? () => void turnOff() : undefined}
        />
        <TriggerOption
          available
          checked={standing}
          detail={AGENT_TRIGGER_COPY.at_a_time.detail}
          label={AGENT_TRIGGER_COPY.at_a_time.label}
          /*
           * Selecting this radio does not save. It is the same press as typing
           * a time and pressing Save, and firing on the radio would mean a
           * schedule created by a stray click on a list — for a control whose
           * whole subject is a machine starting a process without anybody
           * watching, the confirmation is the point.
           */
          onSelect={undefined}
        >
          {canAct ? (
            <div className="trigger-time">
              <label htmlFor={`agent-schedule-${agentId}`}>{AGENT_TRIGGER_COPY.time_label}</label>
              <input
                className="field"
                disabled={busy}
                id={`agent-schedule-${agentId}`}
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                type="time"
                value={draft}
              />
              <span className="button-row">
                <button
                  className="button-primary"
                  disabled={busy || draft.trim() === ""}
                  onClick={() => void save()}
                  type="button"
                >
                  {busy ? AGENT_TRIGGER_COPY.saving : AGENT_TRIGGER_COPY.save}
                </button>
                {standing ? (
                  <button
                    className="button-link"
                    disabled={busy}
                    onClick={() => void turnOff()}
                    type="button"
                  >
                    {AGENT_TRIGGER_COPY.turn_off}
                  </button>
                ) : null}
              </span>
              <p className="muted wrap">{AGENT_TRIGGER_COPY.time_hint}</p>
              {/* MAR-784. Where the time is set, because that is where the
                  decision is — the ceiling and the cadence are one press. It is
                  above Save and inside the same block for that reason: turning
                  it on is not a save on its own, exactly as picking the radio
                  is not, and for the same argument spelled out on `onSelect`
                  above. A control whose subject is a machine spending money
                  without anybody watching gets a confirmation. */}
              <label className="trigger-allowance" htmlFor={`agent-schedule-spend-${agentId}`}>
                <input
                  checked={allow}
                  disabled={busy}
                  id={`agent-schedule-spend-${agentId}`}
                  onChange={(event) => {
                    setAllow(event.target.checked);
                  }}
                  type="checkbox"
                />
                <span>{AGENT_TRIGGER_COPY.allowance_label}</span>
              </label>
              <p className="muted wrap">
                {AGENT_TRIGGER_COPY.allowance_hint(schedule.allowance_choice)}
              </p>
            </div>
          ) : (
            /*
             * Said rather than drawn as a disabled field, `AgentNameField`'s
             * reason: a greyed-out time picker here would read as a claim about
             * this agent, and the true statement is about which window this is.
             */
            <p className="muted wrap">{AGENT_SETTINGS_COPY.identity.rename_read_only}</p>
          )}
        </TriggerOption>
        <TriggerOption
          available={false}
          checked={false}
          detail={AGENT_TRIGGER_COPY.on_an_interval.detail}
          label={AGENT_TRIGGER_COPY.on_an_interval.label}
        />
      </ul>

      {/* Only while something is standing. See the header. */}
      {standing ? (
        <>
          <ul className="trigger-liveness">
            {schedule.liveness.map((sentence) => (
              <li className="muted wrap" key={sentence}>
                {sentence}
              </li>
            ))}
          </ul>
          <p className="muted wrap">{schedule.spend_line}</p>
          {/* Only under the allowance sentence, and never under the no-spend
              one. See `AgentScheduleView.spend_bound` — an empty string here is
              the view saying there is nothing to bound, not a missing value. */}
          {schedule.spend_bound === "" ? null : (
            <p className="muted wrap">{schedule.spend_bound}</p>
          )}
        </>
      ) : null}

      {/* The record, and it outlives the schedule on purpose — somebody who
          switched a cadence off because it kept failing is exactly the person
          who still wants to read that it kept failing. Renders nothing at all
          for a schedule that has not yet come round, which is every schedule on
          the day it is set. */}
      {schedule.last === null ? null : (
        <div className="trigger-history">
          <h4>{AGENT_TRIGGER_COPY.history_heading}</h4>
          <p>
            <span className={`chip chip-${schedule.last.outcome_tone}`}>
              {schedule.last.outcome_label}
            </span>{" "}
            <time dateTime={schedule.last.due_at}>{schedule.last.due_at}</time>
          </p>
          <p className="muted wrap">{schedule.last.detail}</p>
          {/* MAR-784. The receipt, and it is absent rather than zeroed for a
              window that was allowed nothing — which is every window under the
              default. `ceiling_line` appears only when DASH actually refused a
              call in that window, so it names a degrade that happened rather
              than one the arithmetic implies. */}
          {schedule.last.spend === null ? null : (
            <>
              <p className="muted wrap">{schedule.last.spend.line}</p>
              {schedule.last.spend.ceiling_line === null ? null : (
                <p className="muted wrap">{schedule.last.spend.ceiling_line}</p>
              )}
            </>
          )}
        </div>
      )}

      {conflicts ? (
        <div className="notice" role="status">
          <p>{AGENT_TRIGGER_COPY.declared(declared)}</p>
          <p>{AGENT_TRIGGER_COPY.declared_conflict}</p>
        </div>
      ) : null}
    </section>
  );
}

function TriggerOption({
  available,
  checked,
  children,
  detail,
  label,
  onSelect,
}: {
  available: boolean;
  checked: boolean;
  children?: ReactNode;
  detail: string;
  label: string;
  onSelect?: () => void;
}): ReactNode {
  return (
    <li className={available ? "trigger-option" : "trigger-option is-unavailable"}>
      <label>
        {/*
          A real radio, checked and disabled rather than a styled div. The group
          is one group, so a screen reader reads "1 of 3" and hears the one it
          cannot pick as disabled — which is exactly the fact that option exists
          to communicate.

          `readOnly` when there is nothing for a change handler to do, which is
          both the disabled option and the enabled one whose selection is
          confirmed by a button rather than by the radio. React warns on a
          checked input with neither.
        */}
        <input
          checked={checked}
          disabled={!available}
          name="agent-trigger"
          onChange={onSelect === undefined ? undefined : () => { onSelect(); }}
          readOnly={onSelect === undefined}
          type="radio"
        />
        <span className="trigger-option-label">{label}</span>
      </label>
      <p className="muted wrap">{detail}</p>
      {children}
    </li>
  );
}
