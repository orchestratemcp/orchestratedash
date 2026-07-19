import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  availableControls,
  buildOverview,
  buildWorkInbox,
  retryIsSafe,
} from "../lib/workspace";
import type { AgentDomState, WorkspaceManifest } from "../lib/workspace";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as T;
}

const manifest = example<WorkspaceManifest>(
  "gmail-meeting-assistant.manifest.v2.example.json",
);
const state = example<AgentDomState>("gmail-meeting-assistant.state.example.json");

/** Before every deadline in the example fixture. */
const BEFORE_EXPIRY = new Date("2026-07-16T10:00:00Z");
/** After every deadline in the example fixture. */
const AFTER_EXPIRY = new Date("2026-07-18T10:00:00Z");

const RUN_ID = "run-synthetic-20260716-01";

describe("buildOverview", () => {
  const overview = buildOverview(manifest, state, BEFORE_EXPIRY);

  it("prefers the display name over the agent slug", () => {
    expect(overview.title).toBe("Meeting Assistant");
  });

  it("explains the status in plain language, without jargon", () => {
    expect(overview.status).toBe("needs_attention");
    expect(overview.status_detail).toBe(
      "This agent is waiting for you before it can continue.",
    );
  });

  it("surfaces runtime honesty fields the user needs to close DASH safely", () => {
    expect(overview.continues_when_dash_closed).toBe(true);
    expect(overview.offline_behavior).toBe(
      "No requests are processed while the worker is offline",
    );
  });

  it("names the pending work as the next action", () => {
    expect(overview.next_action).toBe("Review 1 item waiting for you");
  });

  it("treats absent runtime declarations as unknown, not as false confidence", () => {
    const bare: WorkspaceManifest = {
      agent: { name: "bare", goal: "do a thing" },
    };
    const overview = buildOverview(
      bare,
      { agent_id: "bare", observed_at: "2026-07-16T09:00:00Z", status: "ready" },
      BEFORE_EXPIRY,
    );
    expect(overview.runtime_label).toBe("Unknown runtime");
    expect(overview.offline_behavior).toBeNull();
    expect(overview.next_action).toBeNull();
  });

  it("still gives a next action when the only waiting item has expired", () => {
    const overview = buildOverview(manifest, state, AFTER_EXPIRY);
    expect(overview.next_action).toBe("Reopen this agent's expired request");
  });

  it("points at recovery when the agent is in error with nothing pending", () => {
    const overview = buildOverview(
      manifest,
      { ...state, status: "error", choices: [], approval_requests: [] },
      BEFORE_EXPIRY,
    );
    expect(overview.next_action).toBe("Check what went wrong and retry the run");
  });
});

describe("buildWorkInbox", () => {
  it("lists the pending approval and excludes the already-answered choice", () => {
    const inbox = buildWorkInbox(manifest, state, BEFORE_EXPIRY);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].kind).toBe("approval");
    expect(inbox[0].id).toBe("approval-meeting-01");
    expect(inbox[0].expired).toBe(false);
  });

  it("carries the task's label so the inbox reads as work, not as ids", () => {
    const inbox = buildWorkInbox(manifest, state, BEFORE_EXPIRY);
    expect(inbox[0].task_label).toBe("Schedule a synthetic project review");
    expect(inbox[0].run_id).toBe(RUN_ID);
  });

  it("keeps expired items and flags them rather than dropping them silently", () => {
    const inbox = buildWorkInbox(manifest, state, AFTER_EXPIRY);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].expired).toBe(true);
  });

  it("includes an unanswered choice with its options", () => {
    const unanswered: AgentDomState = {
      ...state,
      choices: [{ ...state.choices![0], selected_option_id: undefined }],
    };
    const inbox = buildWorkInbox(manifest, unanswered, BEFORE_EXPIRY);
    const choice = inbox.find((item) => item.kind === "choice");
    expect(choice?.options.map((option) => option.label)).toEqual([
      "Tuesday at 10:00",
      "Wednesday at 14:30",
    ]);
  });

  it("hides an approval the runner will not enforce", () => {
    const unenforced: AgentDomState = {
      ...state,
      actions: [
        { ...state.actions![0], approval: { enforcement: "none" } },
      ],
    };
    expect(buildWorkInbox(manifest, unenforced, BEFORE_EXPIRY)).toEqual([]);
  });

  it("hides an approval whose action is missing, since the effect cannot be previewed", () => {
    expect(buildWorkInbox(manifest, { ...state, actions: [] }, BEFORE_EXPIRY)).toEqual([]);
  });

  it("excludes resolved approvals", () => {
    const resolved: AgentDomState = {
      ...state,
      approval_requests: [{ ...state.approval_requests![0], status: "approved" }],
    };
    expect(buildWorkInbox(manifest, resolved, BEFORE_EXPIRY)).toEqual([]);
  });

  it("orders by soonest deadline first", () => {
    const many: AgentDomState = {
      ...state,
      choices: [
        { ...state.choices![0], id: "late", expires_at: "2026-07-20T09:00:00Z", selected_option_id: undefined },
        { ...state.choices![0], id: "soon", expires_at: "2026-07-16T18:00:00Z", selected_option_id: undefined },
      ],
    };
    const inbox = buildWorkInbox(manifest, many, BEFORE_EXPIRY);
    expect(inbox.map((item) => item.id)).toEqual([
      "soon",
      "approval-meeting-01",
      "late",
    ]);
  });

  it("treats an unparseable deadline as live rather than expired", () => {
    const broken: AgentDomState = {
      ...state,
      approval_requests: [{ ...state.approval_requests![0], expires_at: "not-a-date" }],
    };
    expect(buildWorkInbox(manifest, broken, AFTER_EXPIRY)[0].expired).toBe(false);
  });
});

describe("availableControls — no dead controls", () => {
  it("offers approve, reject and cancel while waiting for approval", () => {
    expect(availableControls(manifest, state, RUN_ID).map((c) => c.command)).toEqual([
      "approve",
      "reject",
      "cancel",
    ]);
  });

  it("renders nothing for a read-only agent", () => {
    const readOnly: WorkspaceManifest = {
      ...manifest,
      agent_dom: { ...manifest.agent_dom, control: { supported: false, commands: [] } },
    };
    expect(availableControls(readOnly, state, RUN_ID)).toEqual([]);
  });

  it("never offers a command the manifest did not declare", () => {
    const limited: WorkspaceManifest = {
      ...manifest,
      agent_dom: { ...manifest.agent_dom, control: { supported: true, commands: ["cancel"] } },
    };
    expect(availableControls(limited, state, RUN_ID).map((c) => c.command)).toEqual([
      "cancel",
    ]);
  });

  it("offers resume, not pause, for a paused run", () => {
    const paused: AgentDomState = {
      ...state,
      runs: [{ id: RUN_ID, status: "paused", progress: 0.5 }],
    };
    expect(availableControls(manifest, paused, RUN_ID).map((c) => c.command)).toEqual([
      "resume",
      "cancel",
    ]);
  });

  it("offers no controls for a completed run", () => {
    const done: AgentDomState = {
      ...state,
      runs: [{ id: RUN_ID, status: "completed", progress: 1 }],
    };
    expect(availableControls(manifest, done, RUN_ID)).toEqual([]);
  });

  it("returns nothing for a run it has never seen", () => {
    expect(availableControls(manifest, state, "no-such-run")).toEqual([]);
  });

  it("uses plain-language labels", () => {
    const failed: AgentDomState = {
      ...state,
      runs: [{ id: RUN_ID, status: "failed", progress: 0.2 }],
      plan_vs_actual: { run_id: RUN_ID, executed_components: ["gmail_meeting_request_read"] },
    };
    expect(availableControls(manifest, failed, RUN_ID)).toEqual([
      { command: "retry", label: "Try again" },
    ]);
  });
});

describe("retryIsSafe — retry cannot duplicate an irreversible write", () => {
  it("withholds retry once an irreversible component has executed", () => {
    const afterInvite: AgentDomState = {
      ...state,
      runs: [{ id: RUN_ID, status: "failed", progress: 0.9 }],
      plan_vs_actual: {
        run_id: RUN_ID,
        // calendar_event_create is irreversible in this manifest.
        executed_components: ["gmail_meeting_request_read", "calendar_event_create"],
      },
    };
    expect(retryIsSafe(manifest, afterInvite, RUN_ID)).toBe(false);
    expect(availableControls(manifest, afterInvite, RUN_ID)).toEqual([]);
  });

  it("allows retry when no irreversible component has run yet", () => {
    const early: AgentDomState = {
      ...state,
      plan_vs_actual: { run_id: RUN_ID, executed_components: ["gmail_meeting_request_read"] },
    };
    expect(retryIsSafe(manifest, early, RUN_ID)).toBe(true);
  });

  it("withholds retry when there is no execution record to judge", () => {
    const noRecord: AgentDomState = { ...state, plan_vs_actual: undefined };
    expect(retryIsSafe(manifest, noRecord, RUN_ID)).toBe(false);
  });

  it("withholds retry when the execution record belongs to another run", () => {
    const otherRun: AgentDomState = {
      ...state,
      plan_vs_actual: { run_id: "some-other-run", executed_components: [] },
    };
    expect(retryIsSafe(manifest, otherRun, RUN_ID)).toBe(false);
  });

  it("allows retry freely when the plan declares nothing irreversible", () => {
    const safe: WorkspaceManifest = { ...manifest, safety_contract: { irreversible_components: [] } };
    expect(retryIsSafe(safe, { ...state, plan_vs_actual: undefined }, RUN_ID)).toBe(true);
  });
});
