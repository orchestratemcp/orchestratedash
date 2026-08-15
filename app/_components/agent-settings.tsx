"use client";

import Link from "next/link";
import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { AGENT_SETTINGS_COPY, AGENT_TRIGGER_COPY } from "../../lib/copy/agent-page";
import type { OName } from "../../lib/brand/o-cast";
import { renameAgent } from "../_data/source";
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
  onClose,
  onRenamed,
  renamed,
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
  /** Re-read the workspace, so the drawer redraws with the name it just saved. */
  onRenamed: () => void;
  /** Whether `title` is a stored rename rather than the manifest's own name. */
  renamed: boolean;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
  /** The display name, from `agentDisplayName`. */
  title: string;
  /** What the agent's own manifest calls its trigger, or null if it says nothing. */
  trigger: string | null;
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
            <dd>
              {/* 50, not 48. `OSize` is `50 | 100 | 200` and the union is the
                  guard rather than a style preference: `image-rendering:
                  pixelated` upscales by nearest neighbour, so an off-scale size
                  lands some source pixels on two screen pixels and some on
                  three, and the sprite stops reading as pixel art and starts
                  reading as a rendering fault. Half the header's 100. */}
              {avatar === null ? (
                <span className="o-portrait-empty" aria-hidden="true" />
              ) : (
                <OAvatar name={avatar} size={50} action />
              )}
            </dd>
            <dd className="muted">{AGENT_SETTINGS_COPY.identity.avatar_source}</dd>
          </div>
        </dl>
      </section>

      <TriggerSwitch declared={trigger} />

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
 * The trigger switcher — the sixth ask, built to what ADR 0014 actually allows.
 *
 * > *"I want to be able to switch trigger. Trigger on command or set a time or
 * > how often it should trigger."*
 *
 * ## Why there is one working option and two disabled ones
 *
 * ADR 0014 settled this in the same week and settled it against building the
 * other two: *"Trigger configuration — 'on command, at a time, on an interval'
 * — is a separate decision and a larger one. It is blocked on restart-on-boot,
 * which ADR 0007 left open on purpose, and it needs a scheduler that exists
 * nowhere in this repository."*
 *
 * So this control does not schedule anything, and no schedule executor was
 * built behind it. What it does is the half that was missing and cost nothing:
 * the old page printed a trigger label in a definition list and offered no way
 * to reason about it, so *"can I make this run daily?"* had no answer on screen
 * at all. Now the three choices are visible, the one DASH honours is selected,
 * and the two it does not each say what they are waiting on.
 *
 * **These disabled radios are not the dead controls `lib/workspace.ts` forbids.**
 * That rule is about a control that looks like it would act and would not. These
 * are the page stating a limit of the product — information a person cannot get
 * any other way, and the alternative is that DASH silently appears to have
 * ignored the request.
 *
 * ## The declared-trigger line
 *
 * An agent's author may declare a schedule in its manifest — `WorkspaceTrigger`
 * carries `type`, `label` and an optional `expected_interval_seconds`, and
 * `lib/workspace.ts` uses the interval only to decide whether an agent looks
 * stalled. DASH still starts it on command and nothing else. When the author's
 * word and DASH's behaviour disagree, both are shown: reporting only the
 * manifest would promise a cadence nothing delivers, and reporting only DASH's
 * behaviour would hide why the agent's own documentation says otherwise.
 */
export function TriggerSwitch({ declared }: { declared: string | null }): ReactNode {
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
      <ul className="trigger-options">
        <TriggerOption
          available
          detail={AGENT_TRIGGER_COPY.on_command.detail}
          label={AGENT_TRIGGER_COPY.on_command.label}
        />
        <TriggerOption
          available={false}
          detail={AGENT_TRIGGER_COPY.at_a_time.detail}
          label={AGENT_TRIGGER_COPY.at_a_time.label}
        />
        <TriggerOption
          available={false}
          detail={AGENT_TRIGGER_COPY.on_an_interval.detail}
          label={AGENT_TRIGGER_COPY.on_an_interval.label}
        />
      </ul>
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
  detail,
  label,
}: {
  available: boolean;
  detail: string;
  label: string;
}): ReactNode {
  return (
    <li className={available ? "trigger-option" : "trigger-option is-unavailable"}>
      <label>
        {/*
          A real radio, checked and disabled rather than a styled div. The group
          is one group, so a screen reader reads "1 of 3" and hears the two it
          cannot pick as disabled — which is exactly the fact this control
          exists to communicate. `readOnly` because there is one enabled option
          and therefore nothing for a change handler to do; React warns on a
          checked input with neither.
        */}
        <input
          checked={available}
          disabled={!available}
          name="agent-trigger"
          readOnly
          type="radio"
        />
        <span className="trigger-option-label">{label}</span>
      </label>
      <p className="muted wrap">{detail}</p>
    </li>
  );
}
