/**
 * Why proofs 3c/3d/3g failed on the installed smoke, intermittently (MAR-466).
 *
 * The suspicion in the issue was that `runs[].progress` and `runs[].current_step`
 * were reaching `decisionIdentity()` after all, or that something else wrote a
 * snapshot for the synthetic agent mid-proof. Neither is true. The store the
 * smoke runs against is the installed one, and it carries state between runs.
 *
 * Proof 3h ends by writing a snapshot dated `observed_at + 120s`, deliberately:
 * it needs a decision context that has demonstrably moved on. Nothing removes
 * that row. `putAgentDomState` refuses any snapshot older than the newest the
 * runner has said — the rollback guard, which is correct and stays — so for the
 * next **two minutes** every seed for that agent is refused as out of order.
 *
 * The seed is refused as `{ ok: true, superseded: true }`, and proof 3b only
 * read `ok`. So the harness reported "seeded a live state snapshot" while the
 * store still held the *previous run's* snapshot, and every proof downstream
 * failed against a world the seed never established:
 *
 *     FAIL 3c ... {"reason":"stale_snapshot"}
 *     FAIL 3d ... ["denied/stale_snapshot"]
 *
 * Which makes the intermittency a stopwatch. Run the smoke again more than two
 * minutes later and it passes; run it back to back and it fails. That is the
 * same defect class as MAR-458's proof 7, where a constant run id let a previous
 * run's artifact satisfy the assertion — a proof that is not independent of what
 * earlier runs left behind is not a proof.
 *
 * These tests are the unit-level statement of it. The smoke's own repair is to
 * forget the synthetic agent before seeding and again when done; the case for
 * that living here too is that this file fails in seconds and says why.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AdapterOutcome, AgentCommandInput } from "../lib/agent-dom/runner";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-carryover-"));
process.env.DASH_DATA_DIR = dataDir;

const { closeDb } = await import("../lib/db");
const { importManifest, resetStore, forgetAgent } = await import("../lib/store");
const { putAgentDomState, readAgentDomState, readCommandAudit } = await import(
  "../lib/agent-dom/store"
);
const { runAgentCommand, localPrincipal } = await import("../lib/agent-dom/runner");

function example<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as T;
}

const MANIFEST = example<Record<string, unknown>>(
  "gmail-meeting-assistant.manifest.v2.example.json",
);

const AGENT = "synthetic-gmail-meeting-assistant";
const TASK = "task-meeting-01";
const APPROVAL = "approval-meeting-01";
const ACTION = "action-create-invite-draft";

/** `electron/smoke.ts`'s `liveSnapshot`, reproduced so the two cannot drift. */
function liveSnapshot(observedAt: string, expiresAt: string): Record<string, unknown> {
  const state = example<Record<string, unknown>>("gmail-meeting-assistant.state.example.json");
  const approvals = state["approval_requests"] as Array<Record<string, unknown>>;
  const choices = state["choices"] as Array<Record<string, unknown>>;
  return {
    ...state,
    observed_at: observedAt,
    approval_requests: approvals.map((request) => ({
      ...request,
      requested_at: observedAt,
      expires_at: expiresAt,
    })),
    choices: choices.map((choice) => ({ ...choice, expires_at: expiresAt })),
  };
}

/** One smoke run's proof-3 timeline, as the harness computes it. */
function runTimeline(startedAt: string) {
  const observedAt = startedAt;
  const expiresAt = new Date(Date.parse(startedAt) + 60 * 60 * 1000).toISOString();
  return {
    observedAt,
    expiresAt,
    seed: (): Record<string, unknown> => liveSnapshot(observedAt, expiresAt),
    /** Proof 3h's final write: a context that has genuinely moved, dated +120s. */
    movedOn: (): Record<string, unknown> => ({
      ...liveSnapshot(observedAt, expiresAt),
      observed_at: new Date(Date.parse(observedAt) + 120_000).toISOString(),
      tasks: (
        liveSnapshot(observedAt, expiresAt)["tasks"] as Array<Record<string, unknown>>
      ).map((task) => ({ ...task, detail: "A different time is ready" })),
    }),
  };
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

/** A first smoke run, ending where proof 3h ends. */
const FIRST_RUN_AT = "2026-08-02T11:58:20.274Z";
/** A second run starting inside the two-minute shadow the first one cast. */
const SECOND_RUN_AT = "2026-08-02T11:59:50.274Z";
/** And one starting outside it, which is why this was ever intermittent. */
const LATER_RUN_AT = "2026-08-02T12:05:00.000Z";

beforeEach(() => {
  resetStore();
  expect(importManifest(MANIFEST).ok).toBe(true);
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/** Replays one smoke run's proof 3, returning what the harness would observe. */
function replayProofThree(startedAt: string, { isolate }: { isolate: boolean }) {
  const timeline = runTimeline(startedAt);
  if (isolate) {
    forgetAgent(AGENT);
    expect(importManifest(MANIFEST).ok).toBe(true);
  }
  const seeded = putAgentDomState(timeline.seed());
  return { timeline, seeded, held: readAgentDomState(AGENT)?.observed_at };
}

describe("a smoke run that follows another within two minutes", () => {
  beforeEach(() => {
    // The first run, through proof 3h, exactly as it leaves the installed store.
    const first = runTimeline(FIRST_RUN_AT);
    expect(putAgentDomState(first.seed()).ok).toBe(true);
    expect(putAgentDomState(first.movedOn()).ok).toBe(true);
  });

  it("leaves a snapshot dated two minutes after the run that wrote it", () => {
    // The carried state, named. Nothing in the harness removes this row, and
    // `runner_observed_at` is what the next run's seed is ordered against.
    expect(readAgentDomState(AGENT)?.runner_observed_at).toBe("2026-08-02T12:00:20.274Z");
  });

  it("has its seed refused as out of order while reporting ok", () => {
    const { timeline, seeded, held } = replayProofThree(SECOND_RUN_AT, { isolate: false });

    // Proof 3b asserted only `ok`, so it passed here — with nothing written.
    expect(seeded).toMatchObject({ ok: true, superseded: true });
    expect(held).not.toBe(timeline.observedAt);
    expect(held).toBe("2026-08-02T12:00:20.274Z");
  });

  it("then fails proofs 3c and 3d with the reported signature", async () => {
    const { timeline } = replayProofThree(SECOND_RUN_AT, { isolate: false });

    const adapter = recordingAdapter();
    const decided = await runAgentCommand(approveInput(timeline.observedAt), {
      principal: localPrincipal("smoke"),
      adapter,
      now: () => new Date(Date.parse(SECOND_RUN_AT) + 1_000),
    });

    // `electron/smoke.ts` 3c expects `adapter_unavailable`; MAR-466 reported
    // `stale_snapshot`. This is that failure, reproduced from store state alone.
    expect(decided).toMatchObject({ ok: false, reason: "stale_snapshot" });
    expect(readCommandAudit({ agent: AGENT }).map((row) => `${row.decision}/${row.reason ?? "-"}`))
      .toEqual(["denied/stale_snapshot"]);
  });

  it("is not the decision identity treating progress as a change", () => {
    /*
     * The hypothesis in the issue, ruled out rather than assumed away. Within a
     * single run the churning fields still do not move `observed_at` — so the
     * MAR-464 fix is intact and the intermittency is carried state, not a
     * regression in what a decision context is.
     */
    forgetAgent(AGENT);
    expect(importManifest(MANIFEST).ok).toBe(true);
    const timeline = runTimeline(SECOND_RUN_AT);
    expect(putAgentDomState(timeline.seed()).ok).toBe(true);

    const repolled = (offsetMs: number): Record<string, unknown> => {
      const base = timeline.seed();
      const runs = base["runs"] as Array<Record<string, unknown>>;
      return {
        ...base,
        observed_at: new Date(Date.parse(timeline.observedAt) + offsetMs).toISOString(),
        runs: runs.map((entry) => ({
          ...entry,
          progress: 0.83,
          current_step: "a_later_step",
        })),
      };
    };

    expect(putAgentDomState(repolled(5_000)).ok).toBe(true);
    expect(putAgentDomState(repolled(10_000)).ok).toBe(true);
    expect(readAgentDomState(AGENT)?.observed_at).toBe(timeline.observedAt);
  });
});

describe("the same run, made independent of what came before", () => {
  beforeEach(() => {
    const first = runTimeline(FIRST_RUN_AT);
    expect(putAgentDomState(first.seed()).ok).toBe(true);
    expect(putAgentDomState(first.movedOn()).ok).toBe(true);
  });

  it("seeds cleanly when the agent is forgotten first", () => {
    const { timeline, seeded, held } = replayProofThree(SECOND_RUN_AT, { isolate: true });

    expect(seeded).toMatchObject({ ok: true, superseded: false });
    expect(held).toBe(timeline.observedAt);
  });

  it("no longer depends on how long ago the previous run was", () => {
    /*
     * The property that makes this fixed rather than lucky. Both a run inside
     * the previous run's shadow and one well outside it now reach the same
     * state — which is what "the proof is independent of earlier runs" means,
     * and what the passing half of two-in-four was quietly relying on.
     */
    for (const startedAt of [SECOND_RUN_AT, LATER_RUN_AT]) {
      const { timeline, seeded, held } = replayProofThree(startedAt, { isolate: true });
      expect(seeded).toMatchObject({ ok: true, superseded: false });
      expect(held).toBe(timeline.observedAt);
    }
  });

  it("keeps refusing a genuine rollback for an agent that was not forgotten", () => {
    /*
     * The guard the harness must not have widened to fix its own hygiene.
     * Isolation belongs to the proof; out-of-order snapshots are still refused
     * for any agent whose history DASH actually holds.
     */
    const late = runTimeline(SECOND_RUN_AT);
    expect(putAgentDomState(late.seed())).toMatchObject({ ok: true, superseded: true });
    expect(readAgentDomState(AGENT)?.observed_at).toBe("2026-08-02T12:00:20.274Z");
  });
});
