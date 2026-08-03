/**
 * Watches the cross-agent work inbox for approvals nobody has seen yet, and
 * says so — an OS notification, and a signal for `approval-popup.ts` to show
 * or hide its window (MAR-421, DASH-17 first slice).
 *
 * Deliberately thin, per `electron/main.ts`'s own rule for this directory:
 * the filter that decides what counts as "pending" and "new" lives in
 * `lib/shell/approval-popup.ts`, pure and unit-tested without Electron. What
 * remains here is wiring — a timer, `Notification`, and the popup controller
 * this file does not itself implement.
 *
 * This does not read from `electron/agent-adapters.ts`'s poll loop or change
 * anything it does. `workInboxView()` reads the same store that loop writes
 * to, so a second, independent tick over it is enough to notice a change —
 * no coupling to that module's internals, and no risk of altering the poll
 * this feature is not about.
 */

import { Notification } from "electron";

import { workInboxView } from "../lib/views/build";
import {
  newlyPending,
  pendingApprovals,
  type ApprovalWorkRow,
} from "../lib/shell/approval-popup";

/** Matches `electron/agent-adapters.ts`'s `POLL_INTERVAL_MS` — no point checking faster. */
export const APPROVAL_NOTIFY_INTERVAL_MS = 5_000;

export interface ApprovalPopupController {
  /** Called every tick with the full, current set of live approvals. */
  sync(pending: ApprovalWorkRow[]): void;
}

/**
 * Start watching. Returns a function that stops.
 *
 * `onNotificationClicked` is asked to bring the popup to the front — it does
 * not receive the clicked item, because by the time a click lands the popup's
 * own list (read the same way the popup renders) is the current truth, and a
 * notification carrying its own stale copy is one more thing that could drift.
 */
export function startApprovalNotifier(
  popup: ApprovalPopupController,
  onNotificationClicked: () => void,
  log: (line: string) => void = (line) => {
    console.warn(line);
  },
  intervalMs: number = APPROVAL_NOTIFY_INTERVAL_MS,
): () => void {
  let known = new Set<string>();
  let stopped = false;

  function fire(item: ApprovalWorkRow): void {
    if (!Notification.isSupported()) {
      return;
    }
    const notification = new Notification({
      title: `${item.agent_title} needs your approval`,
      body: item.action_label,
      urgency: "critical",
    });
    notification.on("click", onNotificationClicked);
    notification.show();
  }

  function tick(): void {
    if (stopped) {
      return;
    }
    let pending: ApprovalWorkRow[];
    try {
      pending = pendingApprovals(workInboxView().items);
    } catch (error: unknown) {
      // Best-effort, like every other tick in this poller family: one bad read
      // must not end the loop, and the next tick tries again.
      log(`[dash-shell] approval notifier could not read the work inbox: ${String(error)}`);
      return;
    }

    for (const item of newlyPending(pending, known)) {
      fire(item);
    }
    known = new Set(pending.map((item) => item.id));
    popup.sync(pending);
  }

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
