"use client";

import type { ReactNode } from "react";

import { INPUTS_PANEL_COPY, describeInputState, type InputState } from "../../lib/copy/inputs";
import type { InputRoleView } from "../../lib/views/inputs";

/**
 * The files a person gives an agent, before it runs (MAR-507, MAR-434).
 *
 * `app/_components/outputs.tsx` is the other end of the same journey, and this
 * follows it deliberately: **cards, never a table**. MAR-491 measured every
 * table in DASH at 375px and found a 1425px scroller in a 341px viewport, so a
 * new surface starting as a table would be a new instance of a defect this
 * project has already paid to remove once.
 *
 * ## What is on screen, and what is not
 *
 * One card per **declared role**, from the manifest, in the author's own
 * plain-language names — never the role id. Under each, the files admitted so
 * far and the ones the runner would not take, each with the runner's own
 * sentence rather than a rewording of it.
 *
 * There is no path anywhere on this surface, and there is nothing that could
 * produce one: `InputRoleView` has no path field, and the command that chooses
 * a file returns a display name and a size. That is the same discipline
 * `ArtifactCardView` keeps at the other end — the runner owns the location and
 * DASH renders a receipt.
 *
 * ## Why there is no "remove"
 *
 * The runner has no route that takes an admitted input back out, deliberately —
 * see `runner/server.ts` on what the task routes do not offer. A control here
 * would be a control DASH cannot honour, and one that faked it by hiding the
 * card would be worse: the file would still be in the workspace and would still
 * reach the agent. What a person does instead is not press Run now.
 */

/** One file this page has handed to the runner, or tried to. */
export interface SelectedInput {
  /** Which declared role it was chosen for. */
  role_id: string;
  state: InputState;
  /** The runner's own name for the copy it took. Empty while still copying. */
  display_name: string;
  byte_size: number;
  /** The runner's own refusal sentence, when it refused. */
  detail?: string;
  /** Distinguishes two attempts at the same role. Never rendered. */
  key: string;
}

export function InputsPanel({
  roles,
  selected,
  onChoose,
  busyRole,
  canAct,
}: {
  roles: readonly InputRoleView[];
  selected: readonly SelectedInput[];
  onChoose: (roleId: string) => void;
  /** The role whose picker is open, or null. */
  busyRole: string | null;
  canAct: boolean;
}): ReactNode {
  if (roles.length === 0) {
    /*
     * Said about the agent, not about the user. Absence of `task_inputs` means
     * an agent that takes no files — including every agent shipped before the
     * block existed — and the schema's own description warns that it must never
     * be read as an agent that takes anything.
     */
    return null;
  }

  const anyCopied = selected.some((input) => input.state === "copied");

  return (
    <section className="section inputs-panel">
      <h2>{INPUTS_PANEL_COPY.heading}</h2>
      <ol className="row-list inputs-list">
        {roles.map((role) => (
          <InputRoleCard
            busy={busyRole === role.id}
            canAct={canAct}
            key={role.id}
            onChoose={onChoose}
            role={role}
            selected={selected.filter((input) => input.role_id === role.id)}
          />
        ))}
      </ol>
      {anyCopied ? <p className="muted">{INPUTS_PANEL_COPY.dispatch_note}</p> : null}
    </section>
  );
}

function InputRoleCard({
  busy,
  canAct,
  onChoose,
  role,
  selected,
}: {
  busy: boolean;
  canAct: boolean;
  onChoose: (roleId: string) => void;
  role: InputRoleView;
  selected: readonly SelectedInput[];
}): ReactNode {
  return (
    <li className="row-card input-card">
      <div className="input-identity">
        {/* The manifest's label, and never `role.id`. */}
        <h3>{role.label}</h3>
        {role.purpose === null ? null : <p>{role.purpose}</p>}
        <p className="muted">
          {role.requirement}
          {role.accepts === null ? "" : ` ${role.accepts}`}
        </p>
      </div>

      {selected.length === 0 ? null : (
        <ul className="input-files">
          {selected.map((input) => (
            <SelectedFile input={input} key={input.key} />
          ))}
        </ul>
      )}

      {canAct ? (
        <button
          className="button-secondary"
          disabled={busy}
          onClick={() => {
            onChoose(role.id);
          }}
          type="button"
        >
          {busy ? INPUTS_PANEL_COPY.choosing : INPUTS_PANEL_COPY.choose}
        </button>
      ) : null}
    </li>
  );
}

function SelectedFile({ input }: { input: SelectedInput }): ReactNode {
  const copy = describeInputState(input.state, { detail: input.detail });
  return (
    <li className={`input-file is-${input.state}`}>
      <div className="input-file-head">
        {/*
          The runner's own display name for the copy it took — a basename, and
          the only string on this surface that came from the user's disk. The
          runner stores nothing else about where it was.
        */}
        <span className="value">
          {input.display_name === "" ? copy.label : input.display_name}
        </span>
        <span className="chip">{copy.label}</span>
      </div>
      <p className="muted">{copy.sentence}</p>
      {input.state === "copied" && input.byte_size > 0 ? (
        // Mono, because it is a value — `app/tokens.css` scopes `--font-mono` to
        // counts, durations and names the user typed, never to DASH vocabulary.
        <p className="value input-size">{describeBytes(input.byte_size)}</p>
      ) : null}
    </li>
  );
}

/**
 * A size a person reads.
 *
 * Decimal units, because that is what a file manager shows and this number
 * exists to be compared with one. Rounded to one decimal above a kilobyte: the
 * exact byte count is a developer's fact and this is not a developer's surface.
 */
export function describeBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${String(bytes)} bytes`;
  }
  const units = ["kB", "MB", "GB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] as string}`;
}
