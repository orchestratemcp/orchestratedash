"use client";

import { useState, type ReactNode } from "react";

import {
  LAB_TELEMETRY_CONTENTS,
  LAB_TELEMETRY_INTRO,
  LAB_TELEMETRY_PURPOSE,
  LAB_TELEMETRY_RECEIPT,
  LAB_TELEMETRY_REVOKE,
} from "../../../lib/lab/settings";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import {
  connectLabTelemetry,
  disconnectLabTelemetry,
  sendLabTelemetry,
  setLabTelemetryEnabled,
} from "../../_data/source";
import { useCanAct, useHost, useView } from "../../_data/use-view";
import type { CommandResult } from "../../../lib/shell/ipc";
import type { LabTelemetryView } from "../../../lib/views/types";

/**
 * Reporting: the one place anything about your agents leaves this computer on
 * DASH's own initiative (MAR-479, ADR 0026).
 *
 * ## The page is the receipt, and the order says so
 *
 * MAR-479's second constraint is not a policy document describing categories —
 * it is *the actual payload, in a place a suspicious person can look before
 * deciding and again afterwards*. So the payload box is above the switch and is
 * drawn on a DASH that has opted into nothing, which is the state it matters
 * most in. Everything else on this page is arranged around it: the purpose
 * sentence and the contents list explain what the reader is looking at, the
 * switch is under it, and the past sends are under that.
 *
 * This is `app/settings/notifications/page.tsx`' disclosure-before-the-control
 * argument, taken one step further because the stakes are one step higher.
 * That page discloses what *would* be sent in prose. This one shows the bytes.
 *
 * ## What this page may never word for itself
 *
 * Every sentence comes from `lib/lab/settings.ts` — the standing row, the
 * purpose, the contents, the receipt's three claims, and what revoking does.
 * `describeLabTelemetryStanding` in particular arrives already written, for
 * `AgentRow.glance`' reason.
 *
 * The third line of `LAB_TELEMETRY_RECEIPT` is the one that must never be
 * softened or dropped here: *this is DASH's record of what DASH sent, not a
 * promise about everything that leaves your computer*. A page that trimmed it
 * for space would be making the one claim this feature is not entitled to.
 *
 * ## Why the address is an input and the token is not
 *
 * A person types the address here and the token into a window main owns. That
 * is the same split every credential in DASH goes through, and it is why this
 * page can render the address back and can never render the token: there is no
 * field on `LabTelemetryView` a token could travel in.
 */
export default function ReportingPage(): ReactNode {
  const [refresh, setRefresh] = useState(0);
  const state = useView((source) => source.labTelemetry(), refresh);
  const host = useHost();
  const canAct = useCanAct();

  return (
    <>
      {/*
        Not "Reporting" again — the tab strip above already says that word. This
        says what the page is *about*, which is the one question somebody
        arriving here suspicious needs answered in the heading.
      */}
      <h1>What DASH tells your LAB</h1>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="your reporting settings" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <ReportingSettings
          view={state.data}
          canAct={canAct}
          onChanged={() => {
            setRefresh((value) => value + 1);
          }}
        />
      )}
    </>
  );
}

/**
 * The settings themselves, exported so `tests/reporting-render.test.tsx` can
 * render them against a view without a data source.
 *
 * A named export from a page file, `NotificationSettings`' arrangement and its
 * reason: this section is shared with nothing, and moving it to `_components`
 * would be splitting one surface across two files so a test could reach it.
 */
export function ReportingSettings({
  view,
  canAct,
  onChanged,
}: {
  view: LabTelemetryView;
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  const [outcome, setOutcome] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The address being edited, which starts as the one DASH holds.
   *
   * Local state rather than read straight off the view on every keystroke,
   * because a person half-way through typing an address has not changed
   * anything yet — nothing is stored until they press the button that opens the
   * credential window.
   */
  const [endpoint, setEndpoint] = useState(view.endpoint);

  const run = (command: () => Promise<CommandResult>): void => {
    setBusy(true);
    setOutcome(null);
    void command()
      .then((result) => {
        setOutcome({
          ok: result.ok,
          // Main words every refusal. A page supplying its own fallback for an
          // empty `detail` would be inventing the one sentence it is least
          // qualified to write — `electron/lab-telemetry.ts` returns one on
          // every branch.
          detail: result.detail ?? (result.ok ? "Done." : "DASH could not do that."),
        });
        onChanged();
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <>
      {/*
        MAR-742. This tab is invisible in the strip until a LAB is configured
        — `app/_components/settings-tabs.tsx` — so everyone who reaches this
        page typed an address in themselves and is owed the plain answer to
        "what is LAB" before anything else on it, `LAB_TELEMETRY_INTRO`'s
        reason.
      */}
      <p className="wrap">{LAB_TELEMETRY_INTRO}</p>

      {/*
        The whole state in one row, `NotificationSettings`' shape and its
        reasons. Both halves come from `describeLabTelemetryStanding`, already
        worded, so this page words none of it.
      */}
      <p className="notify-standing">
        <span className={view.standing_on ? "chip chip-ok" : "chip chip-muted"}>
          {view.standing_chip}
        </span>{" "}
        {view.standing_sentence}
      </p>

      <p className="wrap">{LAB_TELEMETRY_PURPOSE}</p>

      {/*
        The payload, above everything that could change it.

        `preview_count` of zero is its own sentence rather than an empty box: on
        a DASH whose agents have not run, "nothing to send" and "sending
        nothing" look identical in a `[]`, and only one of them is true.
      */}
      <section aria-labelledby="lab-preview">
        <h2 id="lab-preview">Exactly what DASH would send right now</h2>
        {view.preview_count === 0 ? (
          <p className="muted wrap">
            Nothing. No agent has run since DASH last reported, so there is no entry to send.
          </p>
        ) : (
          <pre className="wrap" aria-label="The message DASH would send">
            {view.preview_body}
          </pre>
        )}
        <ul className="plain-list">
          {LAB_TELEMETRY_CONTENTS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {/*
        Its own section rather than a second list under the one above, because
        the two answer different questions — *what is in it* and *how can I
        check that*. Run together they read as one eight-item list, and the item
        that gets lost in the middle of an eight-item list is the third one
        here, which is the only sentence on this page that limits a claim.
      */}
      <section aria-labelledby="lab-check">
        <h2 id="lab-check">How you can check it</h2>
        <ul className="plain-list">
          {LAB_TELEMETRY_RECEIPT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="lab-where">
        <h2 id="lab-where">Where it goes</h2>
        <p>
          <label>
            The LAB&rsquo;s address{" "}
            <input
              type="text"
              value={endpoint}
              disabled={!canAct || busy}
              onChange={(event) => {
                setEndpoint(event.target.value);
              }}
            />
          </label>
        </p>
        {/*
          The reach sentence is about the address DASH *holds*, not the one in
          the box — a person typing a new one has not changed where anything
          goes yet, and a sentence that tracked the input would claim a change
          nobody has made.
        */}
        <p className="muted wrap">{view.reach_sentence}</p>
        <p className="muted wrap">
          DASH would post to <code>{view.ingest_url}</code>.
        </p>
      </section>

      <div className="button-row">
        <button
          type="button"
          className="button-primary"
          disabled={!canAct || busy}
          onClick={() => {
            run(() => connectLabTelemetry(endpoint));
          }}
        >
          {view.masked_hint === null ? "Add a token" : "Replace the token"}
        </button>
        {view.masked_hint === null ? null : (
          <>
            <button
              type="button"
              className={view.enabled ? "button-secondary" : "button-primary"}
              disabled={!canAct || busy}
              onClick={() => {
                run(() => setLabTelemetryEnabled(!view.enabled));
              }}
            >
              {view.enabled ? "Stop sending" : "Start sending"}
            </button>
            {/*
              The one control in DASH whose effect leaves this machine and
              cannot be taken back. Its catalogue entry is marked
              `irreversible` for that reason, so pressing it goes through the
              same confirmation an irreversible agent command does — which is
              why this page does not add a second one of its own.
            */}
            <button
              type="button"
              className="button-secondary"
              disabled={!canAct || busy || !view.enabled}
              onClick={() => {
                run(sendLabTelemetry);
              }}
            >
              {busy ? "Sending…" : "Send now"}
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={!canAct || busy}
              onClick={() => {
                run(disconnectLabTelemetry);
              }}
            >
              Forget the token
            </button>
          </>
        )}
        {outcome === null ? null : (
          <p className={outcome.ok ? "notice-ok" : "notice-warn"} role="status">
            <span aria-hidden="true">{outcome.ok ? "✓ " : "✗ "}</span>
            {outcome.detail}
          </p>
        )}
      </div>

      <section aria-labelledby="lab-revoke">
        <h2 id="lab-revoke">Turning it off</h2>
        <ul className="plain-list">
          {LAB_TELEMETRY_REVOKE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {/*
        Every past send, failures included.

        MAR-479's "and again afterwards". Each row carries the literal body that
        was posted rather than a summary of it, because a summary is the thing
        the constraint exists to refuse — and the failed attempts are here
        beside the successful ones, because somebody auditing this is at least
        as interested in what DASH tried to send as in what landed.
      */}
      <section aria-labelledby="lab-sent">
        <h2 id="lab-sent">What DASH has sent</h2>
        {view.sends.length === 0 ? (
          <p className="muted wrap">DASH has not sent anything.</p>
        ) : (
          <ul className="plain-list">
            {view.sends.map((send) => (
              <li key={send.id}>
                <p>
                  <span className={send.ok ? "chip chip-ok" : "chip chip-muted"}>
                    {send.ok ? "Sent" : "Not sent"}
                  </span>{" "}
                  {send.sent_on} — {send.endpoint}
                  {send.status === null ? "" : ` (${String(send.status)})`}
                </p>
                <p className="muted wrap">{send.detail}</p>
                {send.body.length === 0 ? null : (
                  <details className="card-more">
                    <summary>The message</summary>
                    <pre className="wrap">{send.body}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
