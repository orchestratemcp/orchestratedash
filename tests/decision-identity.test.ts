/**
 * What `observed_at` binds to (MAR-464).
 *
 * `lib/agent-dom/enforce.ts` refuses a command whose `observed_at` is not the
 * one DASH holds. That rule is right and stayed. What was wrong was the value:
 * `runner/state.ts` mints `observed_at` on every build and
 * `electron/agent-adapters.ts` rebuilds every `POLL_INTERVAL_MS`, so it tracked
 * the poll rather than the world, and every control bound to a rendered
 * snapshot was refused about five seconds after it was drawn.
 *
 * The headline case here is the one that fails on the pre-MAR-464 code: render
 * a snapshot, let the poll interval elapse, approve. It is a *unit* echo of
 * smoke proofs 3g and 3h, which are the ones that matter — this defect reached
 * an installed build with 878 unit tests green, so a unit test claiming to
 * close it would be making exactly the mistake ADR 0003 was written about.
 * These exist to say *why* it fails, quickly, when it fails again.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AdapterOutcome, AgentCommandInput } from "../lib/agent-dom/runner";
import type { AgentDomState } from "../lib/workspace";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-decision-"));
process.env.DASH_DATA_DIR = dataDir;

const { closeDb } = await import("../lib/db");
const { importManifest, resetStore } = await import("../lib/store");
const { putAgentDomState, readAgentDomState, readCommandAudit } = await import(
  "../lib/agent-dom/store"
);
const { decisionIdentity } = await import("../lib/agent-dom/enforce");
const { runAgentCommand, localPrincipal } = await import("../lib/agent-dom/runner");

function example<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as T;
}

const MANIFEST = example<Record<string, unknown>>(
  "gmail-meeting-assistant.manifest.v2.example.json",
);
const STATE = example<Record<string, unknown>>("gmail-meeting-assistant.state.example.json");

const AGENT = "synthetic-gmail-meeting-assistant";
const RUN = "run-synthetic-20260716-01";
const TASK = "task-meeting-01";
const APPROVAL = "approval-meeting-01";
const ACTION = "action-create-invite-draft";

/** The example snapshot's own timestamp, and a clock inside every deadline. */
const OBSERVED_AT = "2026-07-16T09:05:00Z";
const WHILE_LIVE = new Date("2026-07-16T09:06:00Z");

/** `electron/agent-adapters.ts`'s poll interval, as the defect experienced it. */
const POLL_INTERVAL_MS = 5_000;

function stateWith(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(STATE), ...patch };
}

/** The snapshot the runner would build `ms` later having observed no change. */
function rebuiltAfter(ms: number, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return stateWith({
    observed_at: new Date(Date.parse(OBSERVED_AT) + ms).toISOString(),
    ...patch,
  });
}

function recordingAdapter() {
  const sent: unknown[] = [];
  return {
    sent,
    submit: (envelope: unknown): Promise<AdapterOutcome> => {
      sent.push(envelope);
      return Promise.resolve({ ok: true, detail: "delivered" });
    },
  };
}

function approveInput(observedAt: string, requestId = "req-1"): AgentCommandInput {
  return {
    request_id: requestId,
    command: "approve",
    target: { agent_id: AGENT, task_id: TASK, approval_id: APPROVAL, action_id: ACTION },
    observed_at: observedAt,
    payload_keys: ["agent_id", "task_id", "approval_id", "action_id", "observed_at"],
    mutates: true,
    irreversible: true,
  };
}

const held = (): AgentDomState => {
  const snapshot = readAgentDomState(AGENT);
  if (snapshot === null) throw new Error("no snapshot held");
  return snapshot.state;
};

beforeEach(() => {
  resetStore();
  expect(importManifest(MANIFEST).ok).toBe(true);
  expect(putAgentDomState(STATE).ok).toBe(true);
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the decision context", () => {
  it("is unchanged when only the runner's clock moved", () => {
    expect(decisionIdentity(rebuiltAfter(POLL_INTERVAL_MS) as unknown as AgentDomState)).toBe(
      decisionIdentity(STATE as unknown as AgentDomState),
    );
  });

  it("is unchanged by the fields that churn while an agent works", () => {
    /*
     * Progress, the current step, memory and the audit trail all move
     * continuously during exactly the run a pending approval is blocking. If
     * any of them counted, this change would fix the idle case and leave the
     * busy one broken — the failure most likely to reach a user, and the one
     * least likely to be noticed by a test suite that only ever looks at a
     * stopped agent.
     */
    const busy = rebuiltAfter(POLL_INTERVAL_MS, {
      runs: [
        {
          id: RUN,
          status: "waiting_for_approval",
          started_at: "2026-07-16T09:01:00Z",
          progress: 0.91,
          current_step: "a_later_step",
        },
      ],
      memory: [],
      audit_events: [],
    });

    expect(decisionIdentity(busy as unknown as AgentDomState)).toBe(
      decisionIdentity(STATE as unknown as AgentDomState),
    );
  });

  it("changes when an approval stops being open", () => {
    const requests = structuredClone(
      STATE["approval_requests"] as Array<Record<string, unknown>>,
    );
    const cancelled = rebuiltAfter(POLL_INTERVAL_MS, {
      approval_requests: requests.map((request) => ({ ...request, status: "cancelled" })),
    });

    expect(decisionIdentity(cancelled as unknown as AgentDomState)).not.toBe(
      decisionIdentity(STATE as unknown as AgentDomState),
    );
  });

  it("changes when a run's status moves", () => {
    const paused = rebuiltAfter(POLL_INTERVAL_MS, {
      runs: [{ id: RUN, status: "paused", started_at: "2026-07-16T09:01:00Z" }],
    });

    expect(decisionIdentity(paused as unknown as AgentDomState)).not.toBe(
      decisionIdentity(STATE as unknown as AgentDomState),
    );
  });

  it("does not depend on the key order an agent happened to serialise with", () => {
    // An agent that rebuilds a task from a Map between polls emits the same
    // facts in a different order. Without canonical ordering that would churn
    // the identity with identical content, which is the original defect
    // reintroduced through a door no test would obviously be about.
    const reordered = Object.fromEntries(
      Object.entries(structuredClone(STATE)).reverse(),
    ) as Record<string, unknown>;

    expect(decisionIdentity(reordered as unknown as AgentDomState)).toBe(
      decisionIdentity(STATE as unknown as AgentDomState),
    );
  });
});

describe("the snapshot DASH holds", () => {
  it("keeps observed_at still across a poll that found nothing new", () => {
    expect(putAgentDomState(rebuiltAfter(POLL_INTERVAL_MS)).ok).toBe(true);
    expect(putAgentDomState(rebuiltAfter(POLL_INTERVAL_MS * 2)).ok).toBe(true);
    expect(putAgentDomState(rebuiltAfter(POLL_INTERVAL_MS * 60)).ok).toBe(true);

    expect(readAgentDomState(AGENT)?.observed_at).toBe(OBSERVED_AT);
    // The document agrees with the column. Enforcement compares against the
    // parsed document, so two spellings of one fact is how the halves drift.
    expect(held().observed_at).toBe(OBSERVED_AT);
  });

  it("still stores what the runner most recently said", () => {
    const latest = rebuiltAfter(POLL_INTERVAL_MS * 3);
    expect(putAgentDomState(latest).ok).toBe(true);

    expect(readAgentDomState(AGENT)?.runner_observed_at).toBe(latest["observed_at"]);
  });

  it("advances observed_at the moment the context does", () => {
    expect(putAgentDomState(rebuiltAfter(POLL_INTERVAL_MS)).ok).toBe(true);
    expect(readAgentDomState(AGENT)?.observed_at).toBe(OBSERVED_AT);

    const moved = rebuiltAfter(POLL_INTERVAL_MS * 2, {
      runs: [
        {
          id: RUN,
          status: "paused",
          started_at: "2026-07-16T09:01:00Z",
          progress: 0.57,
          current_step: "human_approval_gate",
        },
      ],
    });
    expect(putAgentDomState(moved).ok).toBe(true);

    expect(readAgentDomState(AGENT)?.observed_at).toBe(moved["observed_at"]);
  });

  it("still refuses a snapshot older than the newest the runner sent", () => {
    /*
     * The guard that the freeze could have quietly widened. Ordering is done on
     * `runner_observed_at`, so a snapshot that arrives out of order is refused
     * against what the runner last actually said — not against a frozen value
     * that may be minutes behind it, which would have let a stale document roll
     * a resolved approval back to pending.
     */
    expect(putAgentDomState(rebuiltAfter(POLL_INTERVAL_MS * 10)).ok).toBe(true);
    expect(readAgentDomState(AGENT)?.observed_at).toBe(OBSERVED_AT);

    const late = rebuiltAfter(POLL_INTERVAL_MS * 5, {
      approval_requests: [],
    });
    expect(putAgentDomState(late)).toMatchObject({ ok: true, superseded: true });
    expect(held().approval_requests).not.toHaveLength(0);
  });
});

describe("an approval reached from the work inbox", () => {
  it("still works after the poll interval elapses", async () => {
    /*
     * The defect, as a person met it: open the approval, read what it permits,
     * press Approve. Reading took longer than five seconds, so the runner
     * rebuilt in between and the click was refused as `stale_snapshot` with
     * nothing about the world having changed.
     *
     * This fails on the pre-MAR-464 code.
     */
    const rendered = readAgentDomState(AGENT)?.observed_at;
    expect(rendered).toBe(OBSERVED_AT);

    expect(putAgentDomState(rebuiltAfter(POLL_INTERVAL_MS)).ok).toBe(true);
    expect(putAgentDomState(rebuiltAfter(POLL_INTERVAL_MS * 2)).ok).toBe(true);

    const adapter = recordingAdapter();
    const decided = await runAgentCommand(approveInput(OBSERVED_AT), {
      principal: localPrincipal("test-user"),
      adapter,
      now: () => WHILE_LIVE,
    });

    expect(decided).toMatchObject({ ok: true });
    expect(adapter.sent).toHaveLength(1);
  });

  it("is still refused once the decision context has actually moved", async () => {
    /*
     * The half worth keeping, and the reason the fix is not "re-read the
     * snapshot before every command". "The world changed since you looked, look
     * again" is a property worth having in front of an irreversible action; it
     * was only ever the *trigger* that was wrong.
     */
    const cancelled = rebuiltAfter(POLL_INTERVAL_MS, {
      approval_requests: (
        structuredClone(STATE["approval_requests"]) as Array<Record<string, unknown>>
      ).map((request) => ({ ...request, status: "cancelled" })),
    });
    expect(putAgentDomState(cancelled).ok).toBe(true);

    const adapter = recordingAdapter();
    const decided = await runAgentCommand(approveInput(OBSERVED_AT), {
      principal: localPrincipal("test-user"),
      adapter,
      now: () => WHILE_LIVE,
    });

    expect(decided).toMatchObject({ ok: false, reason: "stale_snapshot" });
    expect(adapter.sent).toHaveLength(0);
  });

  it("collapses a slow double click, which the churning value did not", async () => {
    /*
     * `idempotencyKey` hashes `observed_at`. Under a value that moved every
     * five seconds, two presses either side of a poll derived *different* keys,
     * so the anti-duplication defence held for a fast double click and lapsed
     * for a slow one — on a command marked irreversible.
     *
     * Re-reading the snapshot before each command, the tempting fix, would have
     * removed the defence outright rather than restoring it: every press would
     * mint a fresh key by construction.
     */
    const runtime = {
      principal: localPrincipal("test-user"),
      adapter: recordingAdapter(),
      now: () => WHILE_LIVE,
    };

    await runAgentCommand(approveInput(OBSERVED_AT, "req-1"), runtime);
    expect(putAgentDomState(rebuiltAfter(POLL_INTERVAL_MS)).ok).toBe(true);
    await runAgentCommand(approveInput(OBSERVED_AT, "req-2"), runtime);

    expect(runtime.adapter.sent).toHaveLength(1);
    /*
     * The decision, not just the count. One delivery is what the *broken* code
     * produced too — it refused the second press as `stale_snapshot`, which
     * looks identical from the adapter's side and is a different fact. Asserting
     * `duplicate` is what makes this a proof about idempotency rather than a
     * proof that something, somewhere, said no.
     */
    expect(readCommandAudit({ agent: AGENT }).map((row) => row.decision)).toEqual([
      "allowed",
      "duplicate",
    ]);
  });
});
