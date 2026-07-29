/**
 * Approval copy, reviewed against real content (MAR-423).
 *
 * The acceptance criterion is *"Approval copy is reviewed against real content,
 * not lorem fixtures."* So the state under test is
 * `examples/gmail-meeting-assistant.state.example.json` — the shipped example
 * that the contract tests already validate against
 * `agent-dom-state.schema.json` — and not a hand-written object shaped the way
 * this module happens to want. A fixture written by the code's own author can be
 * made to say anything; the example has to satisfy the schema and the rest of
 * the suite.
 *
 * The pending approval in it is the hard case on purpose: an action whose real
 * content lives in a *different* resource, linked only through
 * `audit.causation_id`. If the copy layer cannot follow that link, the user is
 * asked to approve "Create invite and save Gmail draft" with no idea which
 * meeting, which is the failure this issue exists to prevent.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { describeApproval, type ApprovalSourceState } from "../lib/copy/approval";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const state = JSON.parse(
  readFileSync(
    path.join(repoRoot, "examples", "gmail-meeting-assistant.state.example.json"),
    "utf8",
  ),
) as ApprovalSourceState;

const APPROVAL_ID = "approval-meeting-01";
/** Every identifier in that example. None may reach the user. */
const IDENTIFIERS = [
  APPROVAL_ID,
  "action-create-invite-draft",
  "task-meeting-01",
  "choice-time-01",
  "time-a",
  "time-b",
  "run-synthetic-20260716-01",
  "corr-meeting-01",
  "synthetic-gmail-meeting-assistant",
  "gmail",
  "calendar",
];

/** A minute after the snapshot was taken, as a surface rendering it would be. */
const NOW = new Date("2026-07-16T09:05:00.000Z");

function question() {
  const copy = describeApproval(state, APPROVAL_ID, NOW);
  if (!copy.ok) {
    throw new Error(`the example's approval should be askable: ${copy.unavailable.headline}`);
  }
  return copy.question;
}

describe("asking for an approval", () => {
  it("asks about the change, in the agent author's own words", () => {
    expect(question().message).toBe("Create invite and save Gmail draft: Tuesday at 10:00?");
  });

  it("renders the actual content, followed from the choice that caused it", () => {
    // The proposed time is not in the approval request. It is in the choice the
    // request names as its cause, which is the whole point of the link.
    expect(question().content).toEqual([
      { label: "What happens", value: "Create invite and save Gmail draft" },
      { label: "Part of", value: "Schedule a synthetic project review" },
      { label: "Choose a meeting time", value: "Tuesday at 10:00 (30 minutes)" },
    ]);
  });

  it("says what happens if the user says no, and makes it as easy to read as yes", () => {
    const asked = question();
    expect(asked.decline_effect).toMatch(/Nothing is created and nothing is sent/);
    expect(asked.approve_label).toBe("Yes, do this");
    expect(asked.decline_label).toBe("No, do not");
  });

  it("says nothing happens until the user answers, because the runner enforces it", () => {
    expect(question().detail.join(" ")).toMatch(/Nothing happens until you answer/);
  });

  it("says how long is left, in words rather than a timestamp", () => {
    // Relative on purpose: an absolute time has to be rendered in some timezone,
    // and a test asserting one would depend on where CI runs.
    expect(question().detail.join(" ")).toContain("expires in about 24 hours");
  });

  it("never shows an identifier, asserted over everything it renders", () => {
    const asked = question();
    expectPlainLanguage(
      [
        asked.title,
        asked.message,
        asked.decline_effect,
        asked.approve_label,
        asked.decline_label,
        ...asked.content.flatMap((fact) => [fact.label, fact.value]),
        ...asked.detail,
      ],
      { forbid: IDENTIFIERS },
    );
  });
});

describe("an approval that cannot be asked about", () => {
  function requestWith(patch: Record<string, unknown>): ApprovalSourceState {
    const requests = (state.approval_requests ?? []).map((request) =>
      request.id === APPROVAL_ID ? { ...request, ...patch } : request,
    );
    return { ...state, approval_requests: requests };
  }

  it("says nothing was decided on the user's behalf when it has gone", () => {
    const copy = describeApproval(state, "approval-that-never-existed", NOW);
    expect(copy.ok).toBe(false);
    if (copy.ok) return;
    expect(copy.reason).toBe("unknown");
    expect(copy.unavailable.detail).toMatch(/Nothing was decided on your behalf/);
    expect(copy.unavailable.next_action).not.toBe("");
  });

  it("distinguishes already answered from expired, because they mean different things", () => {
    const answered = describeApproval(requestWith({ status: "approved" }), APPROVAL_ID, NOW);
    expect(answered.ok).toBe(false);
    if (!answered.ok) {
      expect(answered.reason).toBe("settled");
      expect(answered.unavailable.headline).toMatch(/already said yes/);
    }

    const late = describeApproval(state, APPROVAL_ID, new Date("2026-07-18T00:00:00.000Z"));
    expect(late.ok).toBe(false);
    if (!late.ok) {
      expect(late.reason).toBe("expired");
      expect(late.unavailable.headline).toMatch(/expired before it was answered/);
    }
  });

  it("carries no identifier in a refusal either", () => {
    const copy = describeApproval(state, APPROVAL_ID, new Date("2026-07-18T00:00:00.000Z"));
    if (copy.ok) throw new Error("expected an expired approval");
    expectPlainLanguage(
      [copy.unavailable.headline, copy.unavailable.detail, copy.unavailable.next_action],
      { forbid: IDENTIFIERS },
    );
  });
});

describe("an approval with no choice behind it", () => {
  it("still asks about the change, and still renders content", () => {
    const withoutChoices: ApprovalSourceState = { ...state, choices: [] };
    const copy = describeApproval(withoutChoices, APPROVAL_ID, NOW);
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    expect(copy.question.message).toBe("Create invite and save Gmail draft?");
    // Never empty: a question with nothing under it is a permission prompt.
    expect(copy.question.content.length).toBeGreaterThan(0);
  });
});
