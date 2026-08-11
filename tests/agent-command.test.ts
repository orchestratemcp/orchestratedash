/**
 * The Agent DOM command channel, end to end through the seam (MAR-417).
 *
 * These are the acceptance criteria written as tests, and they are written
 * against the real store, the real contract validators and the real
 * `lib/workspace.ts` rules — only the adapter is a fake, because no adapter
 * exists to be real yet (MAR-415/DASH-11 builds the bundled runner).
 *
 * What that means for honesty: everything up to and including "DASH decided to
 * send this envelope, and recorded why" is proven here. "The runner received it
 * and a process stopped" is not, and no test below pretends otherwise.
 *
 * Each of the five rejections the issue names has its own case, and each one
 * asserts the audit row as well as the refusal — a rejection that is not
 * written down is the failure this issue exists to prevent, and it would pass a
 * test that only checked the return value.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { AgentCommandEnvelope, CommandActor } from "../lib/agent-dom/envelope";
import type { AdapterOutcome, AgentCommandInput } from "../lib/agent-dom/runner";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-command-"));
process.env.DASH_DATA_DIR = dataDir;

const { closeDb } = await import("../lib/db");
const { importManifest, resetStore } = await import("../lib/store");
const { putAgentDomState, readAgentDomState, readCommandAudit, readCommandResult } = await import(
  "../lib/agent-dom/store"
);
const { runAgentCommand, localPrincipal } = await import("../lib/agent-dom/runner");
const { validateCommand } = await import("../lib/contracts");
const { db } = await import("../lib/db");

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
const OBSERVED_AT = "2026-07-16T09:05:00Z";
/** The correlation the example approval request carries. Not one DASH invents. */
const CORRELATION = "corr-meeting-01";

/** After the snapshot, before every deadline in it. */
const WHILE_LIVE = new Date("2026-07-16T09:06:00Z");
/** After the approval's own `expires_at` (2026-07-17T09:00:00Z). */
const AFTER_APPROVAL_EXPIRY = new Date("2026-07-18T09:00:00Z");

/** A distinctive value: if it appears anywhere, it got there from this test. */
const SECRET = "sk-live-51H8kQrZ2vNpXwT9dEaLmB4c";

const PRINCIPAL: CommandActor = localPrincipal("test-user");

/**
 * Records what it was asked to send and reports success.
 *
 * Success is the fake's *choice*, not a claim about the world — see the module
 * header. `noAdapter` is what ships.
 */
function recordingAdapter(outcome: AdapterOutcome = { ok: true, detail: "delivered" }) {
  const sent: AgentCommandEnvelope[] = [];
  return {
    sent,
    submit(envelope: AgentCommandEnvelope): Promise<AdapterOutcome> {
      sent.push(envelope);
      return Promise.resolve(outcome);
    },
  };
}

function approveInput(overrides: Partial<AgentCommandInput> = {}): AgentCommandInput {
  return {
    request_id: "req-1",
    command: "approve",
    target: { agent_id: AGENT, task_id: TASK, approval_id: APPROVAL, action_id: ACTION },
    observed_at: OBSERVED_AT,
    payload_keys: ["agent_id", "task_id", "approval_id", "action_id", "observed_at"],
    mutates: true,
    irreversible: true,
    ...overrides,
  };
}

/** A copy of the example snapshot with fields replaced. */
function stateWith(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(STATE), ...patch };
}

beforeEach(() => {
  resetStore();
  expect(importManifest(MANIFEST).ok).toBe(true);
  expect(putAgentDomState(STATE).ok).toBe(true);
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("an accepted command", () => {
  it("builds an envelope that satisfies agent-command.schema.json", async () => {
    const adapter = recordingAdapter();
    const result = await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter,
      now: () => WHILE_LIVE,
    });

    expect(result.ok).toBe(true);
    expect(adapter.sent).toHaveLength(1);
    // The first execution of a contract specified in MAR-382 and never built.
    expect(validateCommand(adapter.sent[0]).ok).toBe(true);
  });

  it("binds the actor to the principal, not to anything in the request", async () => {
    const adapter = recordingAdapter();
    await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter,
      now: () => WHILE_LIVE,
    });

    expect(adapter.sent[0]!.actor).toEqual({
      id: "test-user",
      type: "user",
      authenticated_by: "dash_session",
      display_name: "test-user",
    });
  });

  it("takes the audit correlation from the approval request rather than minting one", async () => {
    const adapter = recordingAdapter();
    const result = await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter,
      now: () => WHILE_LIVE,
    });

    expect(result.correlation_id).toBe(CORRELATION);
    expect(adapter.sent[0]!.audit).toEqual({
      correlation_id: CORRELATION,
      causation_id: APPROVAL,
    });
  });

  it("audits the acceptance with the actor, the run and the keys", async () => {
    await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter: recordingAdapter(),
      now: () => WHILE_LIVE,
    });

    const audit = readCommandAudit({ agent: AGENT });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      decision: "allowed",
      command: "approve",
      run_id: RUN,
      actor_id: "test-user",
      authenticated_by: "dash_session",
      correlation_id: CORRELATION,
      irreversible: true,
      mutates: true,
    });
  });
});

describe("the five rejections, each audited and each distinguishable", () => {
  it("rejects an expired command", async () => {
    const adapter = recordingAdapter();
    const result = await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter,
      now: () => WHILE_LIVE,
      // Expires the moment it is issued.
      ttl_ms: 0,
    });

    expect(result).toMatchObject({ ok: false, reason: "expired_command" });
    expect(adapter.sent).toHaveLength(0);
    expect(readCommandAudit({ agent: AGENT })[0]).toMatchObject({
      decision: "denied",
      reason: "expired_command",
    });
  });

  it("rejects a replayed nonce", async () => {
    const adapter = recordingAdapter();
    const runtime = {
      principal: PRINCIPAL,
      adapter,
      now: () => WHILE_LIVE,
      // A nonce the caller reuses is exactly the replay the contract's threat
      // model names. Fixing it here is what makes the second submission a
      // replay rather than a fresh command.
      newNonce: () => "nonce-fixed-for-this-test",
    };

    const first = await runAgentCommand(approveInput(), runtime);
    expect(first.ok).toBe(true);

    /*
     * A different snapshot, so the idempotency key differs and the *nonce* is
     * the only thing that can refuse it.
     *
     * The task's detail moves, not just the clock. Since MAR-464 a snapshot
     * whose only difference is `observed_at` is held at the value it already
     * had, so moving the timestamp alone would leave the key identical and this
     * test would quietly become a proof about duplicates instead of replays.
     */
    expect(
      putAgentDomState(
        stateWith({
          observed_at: "2026-07-16T09:07:00Z",
          tasks: [
            {
              id: TASK,
              run_id: RUN,
              label: "Schedule a synthetic project review",
              status: "waiting_for_approval",
              created_at: "2026-07-16T09:01:20Z",
              detail: "A second proposed time is ready for approval",
            },
          ],
        }),
      ).ok,
    ).toBe(true);
    const second = await runAgentCommand(
      approveInput({ request_id: "req-2", observed_at: "2026-07-16T09:07:00Z" }),
      runtime,
    );

    expect(second).toMatchObject({ ok: false, reason: "replayed_nonce" });
    expect(adapter.sent).toHaveLength(1);
    expect(readCommandAudit({ agent: AGENT }).at(-1)).toMatchObject({
      decision: "denied",
      reason: "replayed_nonce",
    });
  });

  it("rejects a command targeting an unknown agent, and still audits it", async () => {
    const adapter = recordingAdapter();
    const result = await runAgentCommand(
      approveInput({ target: { agent_id: "no-such-agent", task_id: TASK, approval_id: APPROVAL } }),
      { principal: PRINCIPAL, adapter, now: () => WHILE_LIVE },
    );

    expect(result).toMatchObject({ ok: false, reason: "unknown_target" });
    expect(adapter.sent).toHaveLength(0);
    // The row exists at all: this is why `command_audit` has no foreign key to
    // `runs`. A constraint here would make the attempts most worth recording
    // the exact ones that could not be written down.
    expect(readCommandAudit({ agent: "no-such-agent" })).toMatchObject([
      { decision: "denied", reason: "unknown_target", run_id: null },
    ]);
  });

  it("rejects a run id the snapshot does not contain", async () => {
    const result = await runAgentCommand(
      {
        ...approveInput({ request_id: "req-3", command: "cancel" }),
        target: { agent_id: AGENT, run_id: "run-that-never-existed" },
      },
      { principal: PRINCIPAL, adapter: recordingAdapter(), now: () => WHILE_LIVE },
    );

    expect(result).toMatchObject({ ok: false, reason: "unknown_target" });
  });

  it("rejects a capability the manifest never declared", async () => {
    // The dash-managed example declares retry/pause/resume/cancel and no
    // approve. Pointed at the same state, an approve is a command this agent
    // never offered.
    const readOnlyManifest = structuredClone(MANIFEST) as Record<string, any>;
    readOnlyManifest["agent_dom"]["control"]["commands"] = ["pause", "cancel"];
    expect(importManifest(readOnlyManifest).ok).toBe(true);

    const adapter = recordingAdapter();
    const result = await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter,
      now: () => WHILE_LIVE,
    });

    expect(result).toMatchObject({ ok: false, reason: "undeclared_capability" });
    expect(adapter.sent).toHaveLength(0);
    expect(readCommandAudit({ agent: AGENT })[0]).toMatchObject({
      reason: "undeclared_capability",
    });
  });

  it("rejects a declared command the run's status does not make meaningful", async () => {
    // `resume` is declared by this manifest, but the run is waiting for an
    // approval rather than paused. Same rejection, and deliberately so: from
    // the command channel's side "you never offered this" and "you are not
    // offering it now" are the same refusal.
    const result = await runAgentCommand(
      {
        ...approveInput({ request_id: "req-4", command: "resume" }),
        target: { agent_id: AGENT, run_id: RUN },
      },
      { principal: PRINCIPAL, adapter: recordingAdapter(), now: () => WHILE_LIVE },
    );

    expect(result).toMatchObject({ ok: false, reason: "undeclared_capability" });
  });

  it("rejects an approval that expired between display and execution", async () => {
    const adapter = recordingAdapter();
    // The snapshot still says `pending` — it was true when it was observed.
    // The deadline simply passed while the user was deciding.
    const result = await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter,
      now: () => AFTER_APPROVAL_EXPIRY,
    });

    expect(result).toMatchObject({ ok: false, reason: "approval_expired" });
    expect(adapter.sent).toHaveLength(0);
    expect(readCommandAudit({ agent: AGENT })[0]).toMatchObject({
      decision: "denied",
      reason: "approval_expired",
    });
  });

  /** The distinction the taxonomy exists for: two expiries, two codes. */
  it("tells an expired envelope apart from an expired approval", async () => {
    await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter: recordingAdapter(),
      now: () => WHILE_LIVE,
      ttl_ms: 0,
    });
    await runAgentCommand(approveInput({ request_id: "req-5" }), {
      principal: PRINCIPAL,
      adapter: recordingAdapter(),
      now: () => AFTER_APPROVAL_EXPIRY,
    });

    expect(readCommandAudit({ agent: AGENT }).map((row) => row.reason)).toEqual([
      "expired_command",
      "approval_expired",
    ]);
  });
});

describe("the rejections the workspace rules already knew about", () => {
  it("withholds retry when an irreversible component already executed", async () => {
    const failed = stateWith({
      observed_at: "2026-07-16T10:00:00Z",
      runs: [
        {
          id: RUN,
          status: "failed",
          started_at: "2026-07-16T09:01:00Z",
          progress: 0.8,
        },
      ],
      plan_vs_actual: {
        run_id: RUN,
        planned_components: ["human_approval_gate", "calendar_event_create"],
        // The manifest marks this irreversible. Retrying could create the event
        // a second time, so `retryIsSafe` says no and the command layer obeys.
        executed_components: ["human_approval_gate", "calendar_event_create"],
        deviations: [],
      },
    });
    expect(putAgentDomState(failed).ok).toBe(true);

    const result = await runAgentCommand(
      {
        ...approveInput({ request_id: "req-6", command: "retry" }),
        target: { agent_id: AGENT, run_id: RUN },
        observed_at: "2026-07-16T10:00:00Z",
      },
      { principal: PRINCIPAL, adapter: recordingAdapter(), now: () => WHILE_LIVE },
    );

    // Distinct from `undeclared_capability`: the agent does offer retry, and
    // this particular run is the reason it is being withheld.
    expect(result).toMatchObject({ ok: false, reason: "retry_unsafe" });
  });

  it("rejects an approval the runner will not enforce", async () => {
    const unenforceable = stateWith({
      observed_at: "2026-07-16T11:00:00Z",
      actions: [
        {
          id: ACTION,
          task_id: TASK,
          label: "Create invite and save Gmail draft",
          command: "approve",
          approval_required: false,
          // DASH would be offering to approve something nothing enforces.
          approval: { enforcement: "none" },
        },
      ],
    });
    expect(putAgentDomState(unenforceable).ok).toBe(true);

    const result = await runAgentCommand(
      approveInput({ request_id: "req-7", observed_at: "2026-07-16T11:00:00Z" }),
      { principal: PRINCIPAL, adapter: recordingAdapter(), now: () => WHILE_LIVE },
    );

    expect(result).toMatchObject({ ok: false, reason: "approval_unenforceable" });
  });

  it("rejects a snapshot DASH does not hold, which is how a forged one arrives", async () => {
    const adapter = recordingAdapter();
    const result = await runAgentCommand(
      approveInput({ observed_at: "2099-01-01T00:00:00Z" }),
      { principal: PRINCIPAL, adapter, now: () => WHILE_LIVE },
    );

    // Without this, a caller could invent an `observed_at`, derive a fresh
    // idempotency key and buy a second execution of an irreversible command.
    expect(result).toMatchObject({ ok: false, reason: "stale_snapshot" });
    expect(adapter.sent).toHaveLength(0);
  });
});

describe("duplicates", () => {
  it("returns the stored result instead of acting twice", async () => {
    const adapter = recordingAdapter();
    const runtime = { principal: PRINCIPAL, adapter, now: () => WHILE_LIVE };

    const first = await runAgentCommand(approveInput(), runtime);
    const second = await runAgentCommand(approveInput({ request_id: "req-2" }), runtime);

    expect(first.ok).toBe(true);
    expect(second.duplicate).toBe(true);
    // The whole point: one envelope reached the adapter, not two.
    expect(adapter.sent).toHaveLength(1);
    expect(second.detail).toBe("delivered");
  });

  it("audits the duplicate as its own outcome, not as an acceptance", async () => {
    const runtime = {
      principal: PRINCIPAL,
      adapter: recordingAdapter(),
      now: () => WHILE_LIVE,
    };
    await runAgentCommand(approveInput(), runtime);
    await runAgentCommand(approveInput({ request_id: "req-2" }), runtime);

    expect(readCommandAudit({ agent: AGENT }).map((row) => row.decision)).toEqual([
      "allowed",
      "duplicate",
    ]);
  });

  it("lets a deliberate second attempt through once the state has moved on", () => {
    return (async () => {
      const adapter = recordingAdapter();
      const runtime = { principal: PRINCIPAL, adapter, now: () => WHILE_LIVE };
      // `cancel` is declared by the manifest and meaningful while a run waits
      // for approval, so this exercises duplication rather than availability.
      const cancel = (requestId: string, observedAt: string): AgentCommandInput => ({
        request_id: requestId,
        command: "cancel",
        target: { agent_id: AGENT, run_id: RUN },
        observed_at: observedAt,
        payload_keys: ["agent_id", "run_id", "observed_at"],
        mutates: true,
        irreversible: false,
      });

      await runAgentCommand(cancel("req-1", OBSERVED_AT), runtime);
      // Repeating it against the same snapshot is the double click.
      await runAgentCommand(cancel("req-2", OBSERVED_AT), runtime);
      expect(adapter.sent).toHaveLength(1);

      /*
       * A poll that found the same world is not a new thing the user looked at
       * (MAR-464).
       *
       * This assertion used to be the opposite. It moved `observed_at` alone,
       * called that "the state has moved on", and expected a second delivery —
       * which passed, and meant the anti-duplication defence lapsed roughly
       * five seconds after any control was drawn, because the runner re-mints
       * `observed_at` on every build. The run's `progress` and `current_step`
       * move here too, deliberately: they are the fields that genuinely churn
       * during a run, and neither changes whether `cancel` is valid.
       */
      const ticked = stateWith({
        observed_at: "2026-07-16T09:20:00Z",
        runs: [
          {
            id: RUN,
            status: "waiting_for_approval",
            started_at: "2026-07-16T09:01:00Z",
            progress: 0.83,
            current_step: "human_approval_gate",
          },
        ],
      });
      expect(putAgentDomState(ticked).ok).toBe(true);
      expect(readAgentDomState(AGENT)?.observed_at).toBe(OBSERVED_AT);
      await runAgentCommand(cancel("req-3", OBSERVED_AT), runtime);
      expect(adapter.sent).toHaveLength(1);

      /*
       * A decision the user could now make differently *is* a new snapshot.
       *
       * The run moved from waiting for approval to paused. `cancel` is declared
       * and meaningful under both, so what this proves is the freshness rule
       * rather than availability — the same care the fixture above takes.
       */
      const moved = stateWith({
        observed_at: "2026-07-16T09:30:00Z",
        runs: [
          {
            id: RUN,
            status: "paused",
            started_at: "2026-07-16T09:01:00Z",
            progress: 0.83,
            current_step: "human_approval_gate",
          },
        ],
      });
      expect(putAgentDomState(moved).ok).toBe(true);
      expect(readAgentDomState(AGENT)?.observed_at).toBe("2026-07-16T09:30:00Z");
      await runAgentCommand(cancel("req-4", "2026-07-16T09:30:00Z"), runtime);

      expect(adapter.sent).toHaveLength(2);
    })();
  });

  it("reports an unknown outcome rather than acting again after a crash mid-dispatch", async () => {
    // An adapter that never answers is indistinguishable, from the store's
    // point of view, from a process that died mid-flight: the claim row is
    // written and never settled.
    const stuck = {
      submit: (): Promise<AdapterOutcome> => new Promise<AdapterOutcome>(() => {}),
    };
    const runtime = { principal: PRINCIPAL, adapter: stuck, now: () => WHILE_LIVE };

    void runAgentCommand(approveInput(), runtime);
    await new Promise((resolve) => setImmediate(resolve));

    const retryAfterCrash = await runAgentCommand(
      approveInput({ request_id: "req-2" }),
      { principal: PRINCIPAL, adapter: recordingAdapter(), now: () => WHILE_LIVE },
    );

    expect(retryAfterCrash.duplicate).toBe(true);
    expect(retryAfterCrash.ok).toBe(false);
    // Honest about not knowing, rather than acting a second time to find out.
    expect(retryAfterCrash.detail).toMatch(/has not recorded how it ended/);
  });
});

describe("audit correlation", () => {
  it("files an accepted and a rejected attempt under the same correlation", async () => {
    await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter: recordingAdapter(),
      now: () => WHILE_LIVE,
    });
    // The same approval, later, after its deadline: a different decision about
    // the same piece of work.
    await runAgentCommand(approveInput({ request_id: "req-2", command: "reject" }), {
      principal: PRINCIPAL,
      adapter: recordingAdapter(),
      now: () => AFTER_APPROVAL_EXPIRY,
    });

    const trail = readCommandAudit({ correlation_id: CORRELATION });
    expect(trail).toHaveLength(2);
    expect(trail.map((row) => row.decision)).toEqual(["allowed", "denied"]);
    expect(trail.every((row) => row.correlation_id === CORRELATION)).toBe(true);
  });
});

describe("an adapter that cannot deliver", () => {
  it("records the authorisation and the delivery failure as two events", async () => {
    const result = await runAgentCommand(approveInput(), {
      principal: PRINCIPAL,
      adapter: recordingAdapter({
        ok: false,
        reason: "adapter_unavailable",
        detail: "No adapter is installed for this agent.",
      }),
      now: () => WHILE_LIVE,
    });

    expect(result).toMatchObject({ ok: false, reason: "adapter_unavailable" });
    // Two rows, not one edited row: DASH did authorise it, and it did fail to
    // arrive. Overwriting the first would claim DASH refused something it
    // in fact allowed.
    expect(readCommandAudit({ agent: AGENT }).map((row) => row.decision)).toEqual([
      "allowed",
      "denied",
    ]);
  });
});

describe("no secret crosses the command channel", () => {
  it("keeps a free-text reason out of the audit table", async () => {
    await runAgentCommand(
      approveInput({
        // Users type things into a reason box. Whatever they type, it is a
        // payload value, and payload values are not audited.
        reason: SECRET,
        payload_keys: ["agent_id", "task_id", "approval_id", "observed_at", "reason"],
      }),
      { principal: PRINCIPAL, adapter: recordingAdapter(), now: () => WHILE_LIVE },
    );

    const audit = readCommandAudit({ agent: AGENT });
    expect(JSON.stringify(audit)).not.toContain(SECRET);
    // The key is recorded; the value is not.
    expect(audit[0]!.payload_keys).toContain("reason");
  });

  it("writes no payload value into the database at all", async () => {
    await runAgentCommand(
      approveInput({
        reason: SECRET,
        payload_keys: ["agent_id", "task_id", "approval_id", "observed_at", "reason"],
      }),
      { principal: PRINCIPAL, adapter: recordingAdapter(), now: () => WHILE_LIVE },
    );

    // The envelope is never persisted — only the decision about it is.
    const rows = db()
      .prepare("SELECT * FROM command_audit")
      .all()
      .concat(db().prepare("SELECT * FROM command_results").all());
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it("stores the outcome under the idempotency key without the envelope", async () => {
    const adapter = recordingAdapter();
    await runAgentCommand(approveInput({ reason: SECRET }), {
      principal: PRINCIPAL,
      adapter,
      now: () => WHILE_LIVE,
    });

    const stored = readCommandResult(db(), adapter.sent[0]!.idempotency_key);
    expect(stored?.status).toBe("settled");
    expect(JSON.stringify(stored)).not.toContain(SECRET);
  });
});

/* ---------------------------------------------------------------------- *
 * The snapshot a command is judged against (MAR-602, ADR 0014)
 * ---------------------------------------------------------------------- */

/**
 * A run on a host is judged against the **host's** snapshot, not this
 * machine's.
 *
 * `agent_dom_state` is keyed by agent id alone, and a deployed agent has the
 * same id in both places — so there is exactly one row and it belongs to the
 * copy on this computer. Judging a remote command against it asks whether a task
 * on a server exists on this PC, which it never does.
 *
 * ADR 0014 puts the real decision on the far side: `runner/execute.ts`
 * adjudicates against the host's own store, and "the two stores never consult
 * each other". So what is proven here is narrower and is the half DASH owns —
 * that substituting the evidence substitutes it **completely**, through the same
 * pipeline, with the same audit rows, and with no leakage in either direction.
 */
describe("a command judged against a snapshot DASH does not hold", () => {
  /** The same agent, as a second machine would describe it: a different task. */
  const REMOTE_TASK = "task-meeting-on-the-server";

  function remoteState(): Record<string, unknown> {
    const state = structuredClone(STATE) as Record<string, any>;
    state["tasks"] = [{ ...state["tasks"][0], id: REMOTE_TASK }];
    // The approval hangs off the task, so it moves with it. A snapshot whose
    // approval still named the old task would be an incoherent document rather
    // than another machine's view of the same agent, and the refusal it produced
    // would be about the fixture instead of about the substitution.
    state["approval_requests"] = (state["approval_requests"] as Array<Record<string, unknown>>).map(
      (approval) => ({ ...approval, task_id: REMOTE_TASK }),
    );
    return state;
  }

  it("allows a target the substituted snapshot published", async () => {
    const adapter = recordingAdapter();
    const result = await runAgentCommand(
      approveInput({ request_id: "req-remote-1", target: { agent_id: AGENT, task_id: REMOTE_TASK, approval_id: APPROVAL, action_id: ACTION } }),
      {
        principal: PRINCIPAL,
        adapter,
        now: () => WHILE_LIVE,
        snapshot: remoteState() as never,
      },
    );

    expect(result.ok).toBe(true);
    // The envelope really carried the other machine's target, so what was
    // posted is what the host published rather than a local id renamed.
    expect(adapter.sent[0]?.target.task_id).toBe(REMOTE_TASK);
  });

  it("refuses the target this machine's own row holds", async () => {
    /*
     * The substitution is total, and this is the assertion that says so. With
     * the host's snapshot in hand, `TASK` — which is in the store, and which
     * every other test in this file uses successfully — is a target that does
     * not exist. A partial substitution that consulted both would pass the test
     * above and fail this one.
     */
    const result = await runAgentCommand(approveInput({ request_id: "req-remote-2" }), {
      principal: PRINCIPAL,
      adapter: recordingAdapter(),
      now: () => WHILE_LIVE,
      snapshot: remoteState() as never,
    });

    expect(result).toMatchObject({ ok: false, reason: "unknown_target" });
  });

  it("treats an explicit absence of snapshot as no evidence, not as a fallback", async () => {
    /*
     * `undefined` means "read the store" and `null` means "the other machine
     * had nothing to say". They are different answers and the second must not
     * quietly become the first — a remote runner that answered with no snapshot
     * would otherwise have its command judged against, and possibly allowed by,
     * the copy on this computer.
     */
    const result = await runAgentCommand(approveInput({ request_id: "req-remote-3" }), {
      principal: PRINCIPAL,
      adapter: recordingAdapter(),
      now: () => WHILE_LIVE,
      snapshot: null,
    });

    expect(result.ok).toBe(false);
    // And the store still holds the row it always did: reading through it
    // changed nothing.
    expect(readAgentDomState(AGENT)?.state.tasks?.[0]?.id).toBe(TASK);
  });

  it("still writes an audit row for a command judged against another machine", async () => {
    /*
     * The property the whole pipeline was reused for. A second, thinner remote
     * path would have been the one reaching a machine DASH does not administer,
     * with none of this.
     */
    await runAgentCommand(
      approveInput({ request_id: "req-remote-4", target: { agent_id: AGENT, task_id: REMOTE_TASK, approval_id: APPROVAL, action_id: ACTION } }),
      {
        principal: PRINCIPAL,
        adapter: recordingAdapter(),
        now: () => WHILE_LIVE,
        snapshot: remoteState() as never,
      },
    );

    const audit = readCommandAudit({ agent: AGENT });
    expect(audit.some((record) => record.request_id === "req-remote-4")).toBe(true);
  });

  it("cannot collide with a local press of the same agent", async () => {
    /*
     * `idempotencyKey` hashes the snapshot's `observed_at`, and the two machines
     * publish their own. So a remote press and a local press are different
     * commands even when everything a person did was identical — which is what
     * stops one press returning the other's stored result.
     */
    const local = recordingAdapter();
    const remote = recordingAdapter();
    await runAgentCommand(approveInput({ request_id: "req-local-5" }), {
      principal: PRINCIPAL,
      adapter: local,
      now: () => WHILE_LIVE,
    });
    await runAgentCommand(
      approveInput({
        request_id: "req-remote-5",
        target: { agent_id: AGENT, task_id: REMOTE_TASK, approval_id: APPROVAL, action_id: ACTION },
        observed_at: "2026-07-16T09:05:30Z",
      }),
      {
        principal: PRINCIPAL,
        adapter: remote,
        now: () => WHILE_LIVE,
        snapshot: { ...remoteState(), observed_at: "2026-07-16T09:05:30Z" } as never,
      },
    );

    expect(local.sent[0]?.idempotency_key).not.toBe(remote.sent[0]?.idempotency_key);
  });
});
