/**
 * The approval popup's shared filter (MAR-421, DASH-17 first slice).
 *
 * `pendingApprovals` and `newlyPending` are the one piece of logic the OS
 * notifier and the popup page both depend on, so what is asserted here is
 * asserted for both surfaces at once: a case missed here is a case where the
 * notification and the popup's own list could disagree about what counts as
 * "worth showing".
 */

import { describe, expect, it } from "vitest";

import { newlyPending, pendingApprovals } from "../lib/shell/approval-popup";
import type { ApprovalWorkRow } from "../lib/shell/approval-popup";
import type { ChoiceInboxItem } from "../lib/workspace";
import type { WorkInboxRow } from "../lib/views/types";

function approval(overrides: Partial<ApprovalWorkRow> = {}): ApprovalWorkRow {
  return {
    kind: "approval",
    id: "approval-1",
    task_id: "task-1",
    task_label: "Send the digest",
    run_id: "run-1",
    label: "Send the digest",
    expires_at: "2026-07-16T11:00:00Z",
    expired: false,
    options: [],
    action_id: "action-1",
    action_label: "Send an email to the meeting attendees",
    agent: "meeting-assistant",
    agent_title: "Meeting Assistant",
    observed_at: "2026-07-16T10:00:00Z",
    ...overrides,
  };
}

function choice(overrides: Partial<ChoiceInboxItem> = {}): WorkInboxRow {
  return {
    kind: "choice",
    id: "choice-1",
    task_id: "task-2",
    task_label: "Pick a slot",
    run_id: "run-2",
    label: "Pick a slot",
    expires_at: "2026-07-16T11:00:00Z",
    expired: false,
    options: [{ id: "opt-1", label: "Tuesday" }],
    agent: "meeting-assistant",
    agent_title: "Meeting Assistant",
    observed_at: "2026-07-16T10:00:00Z",
    ...overrides,
  };
}

describe("pendingApprovals", () => {
  it("keeps a pending, unexpired approval", () => {
    const items = [approval()];
    expect(pendingApprovals(items)).toEqual(items);
  });

  it("drops an expired approval — an expired request is not one worth a notification", () => {
    expect(pendingApprovals([approval({ expired: true })])).toEqual([]);
  });

  it("drops a choice: the popup and the notifier are approvals only", () => {
    expect(pendingApprovals([choice()])).toEqual([]);
  });

  it("keeps ordering as given, which is `workInboxView`'s soonest-deadline-first order", () => {
    const soon = approval({ id: "a", expires_at: "2026-07-16T10:30:00Z" });
    const later = approval({ id: "b", expires_at: "2026-07-16T12:00:00Z" });
    expect(pendingApprovals([soon, later]).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("mixes choices and approvals, keeping only the approvals", () => {
    const wanted = approval({ id: "wanted" });
    expect(pendingApprovals([choice(), wanted]).map((item) => item.id)).toEqual(["wanted"]);
  });
});

describe("newlyPending", () => {
  it("reports an approval not in the known set", () => {
    const item = approval({ id: "fresh" });
    expect(newlyPending([item], new Set())).toEqual([item]);
  });

  it("does not renotify an approval already known, however many ticks pass", () => {
    const item = approval({ id: "already-notified" });
    expect(newlyPending([item], new Set(["already-notified"]))).toEqual([]);
  });

  it("reports only the new one when an already-known approval is still pending", () => {
    const known = approval({ id: "known" });
    const fresh = approval({ id: "fresh" });
    expect(
      newlyPending([known, fresh], new Set(["known"])).map((item) => item.id),
    ).toEqual(["fresh"]);
  });

  it("reports nothing when nothing is pending", () => {
    expect(newlyPending([], new Set(["stale"]))).toEqual([]);
  });
});
