"use client";

import { useState, type ReactNode } from "react";

import { plainDay } from "../../../lib/copy/when";
import {
  NOTIFY_CONTENTS,
  NOTIFY_CUSTODY,
  NOTIFY_LIVENESS,
  NOTIFY_SETUP_STEPS,
} from "../../../lib/notify/settings";
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
 * ## The order of the page is an argument
 *
 * Liveness first, then what goes in the channel, and only then the field. That
 * is the reverse of how a settings page usually reads and it is the whole point:
 * this asks somebody for a credential and then sends messages about their work
 * to a place other people may be able to read. Both facts belong *before* the
 * button, where they can change the decision, rather than under it where they
 * confirm one already made.
 *
 * `lib/notify/settings.ts` owns every sentence. Nothing on this page composes
 * copy from state — `state_sentence` arrives already worded — for the reason
 * `AgentRow.glance` gives about its own chips.
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
        it, which is the whole subject of the lede below.
      */}
      <h1>Discord alerts</h1>
      <p className="lede">
        DASH can post to a Discord channel when one of your agents is waiting for
        you, or has published a report.
      </p>
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

  return (
    <>
      <section aria-labelledby="notify-state">
        <h2 id="notify-state">Right now</h2>
        <p>{view.state_sentence}</p>
        {view.configured ? (
          <p className="muted">
            {/* The hint, never the address. `masked_hint` is four characters of
                the webhook's token — see `lib/secret-refs.ts` — and it is here
                so somebody who has set this up twice can tell which of the two
                DASH is holding.

                The date goes through `plainDay` rather than being printed: a
                stored timestamp is DASH's own machine record, and an ISO string
                on a guided surface is the same defect as an identifier on one.
                A null — an unparseable stored date — drops the clause rather
                than rendering the raw value as a fallback. */}
            Channel address ending {view.masked_hint}
            {view.configured_at === null || plainDay(view.configured_at) === null
              ? null
              : ` · added ${String(plainDay(view.configured_at))}`}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="notify-liveness">
        <h2 id="notify-liveness">When messages arrive, and when they do not</h2>
        <ul className="plain-list">
          {NOTIFY_LIVENESS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="notify-contents">
        <h2 id="notify-contents">What goes in the channel</h2>
        <ul className="plain-list">
          {NOTIFY_CONTENTS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      {view.configured ? null : (
        <section aria-labelledby="notify-setup">
          <h2 id="notify-setup">Getting the address</h2>
          <ol className="plain-list">
            {NOTIFY_SETUP_STEPS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="notify-actions">
        <h2 id="notify-actions">{view.configured ? "Your channel" : "Set it up"}</h2>
        <p className="muted">{NOTIFY_CUSTODY}</p>

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
                Send a test message
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
        </div>

        {outcome === null ? null : (
          <p className={outcome.ok ? "notice-ok" : "notice-warn"} role="status">
            {outcome.detail}
          </p>
        )}
      </section>

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
    </>
  );
}
