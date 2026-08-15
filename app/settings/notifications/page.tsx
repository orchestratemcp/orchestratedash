"use client";

import { useState, type ReactNode } from "react";

import { plainDay } from "../../../lib/copy/when";
import {
  NOTIFY_CONTENTS,
  NOTIFY_CUSTODY,
  NOTIFY_LIVENESS,
  NOTIFY_SETUP_STEPS,
  describeNotificationStanding,
} from "../../../lib/notify/settings";
import { InfoNote } from "../../_components/info-note";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import {
  connectNotifications,
  disconnectNotifications,
  setNotificationKind,
  testNotifications,
} from "../../_data/source";
import { useCanAct, useHost, useView } from "../../_data/use-view";
import type { CommandResult } from "../../../lib/shell/ipc";
import type { NotificationsView } from "../../../lib/views/types";

/**
 * Notifications: where DASH tells you an agent needs you (MAR-588, outbound).
 *
 * ## Why this is its own surface rather than a panel somewhere
 *
 * It is the first setting in DASH that is about the *person* rather than about
 * an agent. Every other configuration surface — the Connection Center, a
 * server's card, an agent's page — is reached by first choosing which agent or
 * which machine you mean, and there is no agent to choose here: one channel
 * serves the whole fleet, deliberately, so that adding an agent never comes with
 * a notification setup step.
 *
 * ## The order of the page is an argument, and the argument has a scope
 *
 * MAR-588 put liveness first, then what goes in the channel, and only then the
 * field — the reverse of how a settings page usually reads, and the whole
 * point: this asks somebody for a credential and then sends messages about
 * their work to a place other people may be able to read. Both facts belong
 * *before* the button, where they can change the decision, rather than under it
 * where they only confirm one already made.
 *
 * **That is still true, and it is about one moment (MAR-642).** It is the
 * argument for the state where nothing is set up, where the decision is live.
 * On a DASH that already has an address, those same sections are documentation
 * about a decision already taken, and the person is here to send a test, switch
 * a kind of message off, or replace the address. So the sections move below the
 * controls — the same sections, the same order, the same words — and the page
 * a returning person meets is a status row, four controls and two checkboxes
 * rather than forty lines of prose around them.
 *
 * `lib/notify/settings.ts` owns every sentence. Nothing on this page composes
 * copy from state — `describeNotificationStanding` words the status row, as
 * `state_sentence` was already worded — for the reason `AgentRow.glance` gives
 * about its own chips.
 */
export default function NotificationsPage(): ReactNode {
  const [refresh, setRefresh] = useState(0);
  const state = useView((source) => source.notifications(), refresh);
  const host = useHost();
  const canAct = useCanAct();

  return (
    <>
      {/*
        MAR-599, the same fix MAR-593 made for Connections. The tab strip above
        this page already says "Notifications" — an `<h1>` repeating it is the
        word the reader just pressed, said back to them. "Discord alerts" says
        what is actually configured here: one channel, and what DASH sends to
        it. MAR-639 axes the lede that used to spell that out below the
        heading; the settings themselves say it in the doing.
      */}
      <h1>Discord alerts</h1>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="your notification settings" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <NotificationSettings
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
 * The settings themselves, exported so `tests/notifications-render.test.tsx` can
 * render them against a view without a data source.
 *
 * A named export from a page file, which the App Router permits — it reads
 * `default` and a fixed set of route exports and ignores the rest. The
 * alternative was a `_components` file, and this section is not shared with
 * anything: moving it would be splitting one surface across two files so that a
 * test could reach it, which is the tail wagging the dog.
 */
export function NotificationSettings({
  view,
  canAct,
  onChanged,
}: {
  view: NotificationsView;
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  /**
   * The last thing a command said, or null.
   *
   * One slot rather than one per button. Every command on this page settles into
   * the same sentence-shaped answer, and two of them can never be in flight at
   * once because each disables the page's controls while it runs.
   */
  const [outcome, setOutcome] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (command: () => Promise<CommandResult>): void => {
    setBusy(true);
    setOutcome(null);
    void command()
      .then((result) => {
        setOutcome({
          ok: result.ok,
          // Main words every refusal. A page that supplied its own fallback for
          // an empty `detail` would be inventing the one sentence it is least
          // qualified to write — see `electron/notify-settings.ts`, where every
          // branch returns one.
          detail: result.detail ?? (result.ok ? "Done." : "DASH could not do that."),
        });
        onChanged();
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const standing = describeNotificationStanding(
    {
      configured: view.configured,
      masked_hint: view.masked_hint,
      configured_at: view.configured_at,
      send_approvals: view.send_approvals,
      send_reports: view.send_reports,
    },
    // The date goes through `plainDay` rather than being printed, and an
    // unparseable one drops the clause rather than rendering the raw value: a
    // stored timestamp is DASH's own machine record, and an ISO string on a
    // guided surface is the same defect as an identifier on one.
    view.configured_at === null ? null : plainDay(view.configured_at),
  );

  return (
    <>
      {/*
        The whole state, in a row (MAR-642).

        What was here was a section called "Right now" with a sentence, and a
        second line under it carrying the masked hint and the date — three
        elements and a heading for a fact that fits on one line, at the top of a
        page whose next forty lines were prose. The chip is what somebody reads
        without reading; the sentence is those same facts, joined.

        Both come from `describeNotificationStanding`, so this page words none
        of it — the split `AgentRow.glance` states, and the reason MAR-588's own
        header gives for `state_sentence` arriving already written.
      */}
      <p className="notify-standing">
        <span className={standing.on ? "chip chip-ok" : "chip chip-muted"}>{standing.chip}</span>{" "}
        {standing.sentence}
      </p>

      {/*
        Before the button, while there is still a decision to inform (MAR-588,
        kept by MAR-642).

        MAR-588's order was an argument and it is still right where it applies:
        this page asks somebody for a credential and then sends messages about
        their work to a place other people may be able to read, and both facts
        belong *before* the control, where they can change the decision, rather
        than under it where they only confirm one already made.

        What MAR-642 changes is that the argument has a scope. It is about the
        moment an address is pasted — so on a DASH that has one, the same
        sections are documentation about a decision already taken, and they move
        below the controls a person actually came back for. The sections
        themselves are the same, in the same order, worded identically; only
        where they sit moves, and only once.
      */}
      {view.configured ? null : <NotificationNotes view={view} />}

      {/*
        The controls, in one row, immediately under the state they change.

        The custody line is an `InfoNote` on the control it is about — MAR-614's
        instrument, and this issue names this line for it. It is the one-line
        answer to "what is DASH about to do with this", so it belongs on the
        button that asks for the credential rather than above it as a paragraph
        everybody scrolls past.
      */}
      <div className="button-row">
        <button
          type="button"
          className="button-primary"
          disabled={!canAct || busy}
          onClick={() => {
            run(connectNotifications);
          }}
        >
          {view.configured ? "Replace the address" : "Add a channel address"}
        </button>
        {view.configured ? (
          <>
            <button
              type="button"
              className="button-secondary"
              disabled={!canAct || busy}
              onClick={() => {
                run(testNotifications);
              }}
            >
              {busy ? "Sending…" : "Send a test message"}
            </button>
            <button
              type="button"
              className="button-danger"
              disabled={!canAct || busy}
              onClick={() => {
                run(disconnectNotifications);
              }}
            >
              Stop posting
            </button>
          </>
        ) : null}
        {/*
          Beside the buttons rather than under them (MAR-642). A test message
          takes a second and its answer is one mark plus main's own sentence; a
          notice in a block below the row read as a page-level event rather than
          as this button's reply. The mark is decorative — the sentence is the
          answer, and `role="status"` is what announces it.
        */}
        {outcome === null ? null : (
          <p className={outcome.ok ? "notice-ok" : "notice-warn"} role="status">
            <span aria-hidden="true">{outcome.ok ? "✓ " : "✗ "}</span>
            {outcome.detail}
          </p>
        )}
      </div>
      <p className="muted wrap">
        The address is a credential.
        <InfoNote>{NOTIFY_CUSTODY}</InfoNote>
      </p>

      {view.configured ? (
        <section aria-labelledby="notify-kinds">
          <h2 id="notify-kinds">What to send</h2>
          <ul className="plain-list">
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={view.send_approvals}
                  disabled={!canAct || busy}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    run(() => setNotificationKind({ kind: "needs_approval", enabled }));
                  }}
                />{" "}
                When an agent is waiting for your approval
              </label>
            </li>
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={view.send_reports}
                  disabled={!canAct || busy}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    run(() => setNotificationKind({ kind: "new_report", enabled }));
                  }}
                />{" "}
                When an agent publishes a report
              </label>
            </li>
          </ul>
        </section>
      ) : null}

      {view.configured ? <NotificationNotes view={view} /> : null}
    </>
  );
}

/**
 * The three sections that are documentation (MAR-642).
 *
 * One component drawn in one of two places — above the controls while nothing
 * is set up, below them once something is — so that the sections themselves
 * cannot drift between the two states. `NotificationSettings` above argues
 * which side of the controls they belong on and why that depends on whether
 * there is still a decision to inform.
 *
 * **They were not simply relocated.** Hidden text is still in the markup and
 * costs the same reading to anybody who opens it, so the question for each was
 * whether it earns a row on this page — and the answers differ:
 *
 * - **What goes in the channel** is a consent disclosure, and its own note in
 *   `lib/notify/settings.ts` says it is what decides whether somebody picks a
 *   private channel or a shared one. So it is **open** while nothing is set up,
 *   and folded afterwards, when it has become the record of a decision already
 *   taken.
 * - **Where to find the address** is a walkthrough of somebody else's product,
 *   needed once. Folded always, and drawn only while it is useful — this is
 *   what replaces the old "Getting the address" section rather than moving it,
 *   because a numbered list of Discord's own menus is not what this page is
 *   for.
 * - **When messages arrive** was already folded, by MAR-614, for exactly this
 *   reason.
 *
 * A `<details>` rather than an `InfoNote` for each: these are sections of list
 * items rather than a sentence attached to a word, which is the split
 * `record-card.tsx` and `info-note.tsx` draw between them. The `<h2>` is inside
 * the `<summary>` — which takes heading content by spec precisely so this works
 * — so nobody navigating by heading loses a stop.
 */
function NotificationNotes({ view }: { view: NotificationsView }): ReactNode {
  return (
    <>
      <section aria-labelledby="notify-contents">
        <details className="card-more section-disclosure" open={!view.configured}>
          <summary>
            <h2 id="notify-contents">What goes in the channel</h2>
          </summary>
          <ul className="plain-list">
            {NOTIFY_CONTENTS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </section>

      {view.configured ? null : (
        <section aria-labelledby="notify-setup">
          <details className="card-more section-disclosure">
            <summary>
              <h2 id="notify-setup">Where to find the address in Discord</h2>
            </summary>
            <ol className="plain-list">
              {NOTIFY_SETUP_STEPS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          </details>
        </section>
      )}

      <section aria-labelledby="notify-liveness">
        <details className="card-more section-disclosure">
          <summary>
            <h2 id="notify-liveness">When messages arrive, and when they do not</h2>
          </summary>
          <ul className="plain-list">
            {NOTIFY_LIVENESS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </section>
    </>
  );
}
