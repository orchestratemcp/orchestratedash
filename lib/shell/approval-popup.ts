/**
 * The approval popup (MAR-421, DASH-17 first slice).
 *
 * "Approval delivery is a safety feature, not a notification nicety" — the
 * issue's own framing. This module holds the one rule the popup and the OS
 * notifier both need and must agree on: which work-inbox rows are a live
 * approval worth surfacing outside the normal workspace page. Getting that
 * filter wrong in one of the two call sites (a notification for something the
 * popup does not show, or the reverse) is exactly the kind of drift a shared,
 * tested function exists to prevent.
 *
 * Nothing here constructs a command envelope, mints an actor or talks to
 * Electron. The popup page reuses `submitAgentCommand` — the same function
 * `app/agents/detail/page.tsx` uses — so approving here and approving from the
 * workspace page are the same call, not two implementations kept in sync by
 * hand.
 */

import type { ApprovalInboxItem } from "../workspace";
import type { WorkInboxRow } from "../views/types";

/** The popup's own route in the static export, same shape as `CREDENTIAL_PROMPT_ROUTE`. */
export const APPROVAL_POPUP_ROUTE = "/approval-popup";

/**
 * A work-inbox row narrowed to the approval branch of `InboxItem`.
 *
 * Built as an intersection of the concrete `ApprovalInboxItem`, not of the
 * `WorkInboxRow` union — intersecting a discriminated union with `{ kind:
 * "approval" }` distributes over both branches rather than eliminating the
 * choice one, which would make `context`, `action_id` and `action_label`
 * unreachable on the result. Naming the concrete member directly avoids that.
 */
export type ApprovalWorkRow = ApprovalInboxItem & {
  agent: string;
  agent_title: string;
  observed_at: string;
};

/**
 * Live approvals worth surfacing outside the workspace page: pending,
 * runner-enforced (already filtered by `buildWorkInbox`), and not expired.
 *
 * Ordering is inherited from `workInboxView`, which sorts soonest-deadline
 * first — the same order the popup shows them in and the same order a
 * notification would fire for a first appearance.
 */
export function pendingApprovals(items: readonly WorkInboxRow[]): ApprovalWorkRow[] {
  return items.filter(
    (item): item is ApprovalWorkRow => item.kind === "approval" && !item.expired,
  );
}

/**
 * Which currently-pending approvals were not pending a moment ago — the ones
 * worth one OS notification.
 *
 * Compared by id only. An approval that was already known and is still
 * pending is never renotified, however many ticks pass; one that resolved and
 * somehow reappeared under the same id (it should not) is treated as new,
 * because from the notifier's point of view it is.
 */
export function newlyPending(
  current: readonly ApprovalWorkRow[],
  previouslyKnownIds: ReadonlySet<string>,
): ApprovalWorkRow[] {
  return current.filter((item) => !previouslyKnownIds.has(item.id));
}
