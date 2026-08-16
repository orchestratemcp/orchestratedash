/**
 * The start-and-run sequence, driven without a browser, a bridge or a runner
 * (MAR-657).
 *
 * The whole reason `startAndRun` is a function with injected ports rather than
 * code in a React event handler is this file: the sequence has three outcomes,
 * two of them failures, and one ordering constraint that is the entire point of
 * the issue. None of that is reachable from a component test, and all of it is
 * reachable from here.
 */

import { describe, expect, it } from "vitest";

import { startAndRun, type StartAndRunPorts, type WaitingTask } from "../lib/agent-start";
import type { CommandResult } from "../lib/shell/ipc";

const OBSERVED = "2026-08-16T12:00:00.000Z";
const TASK: WaitingTask = { task_id: "waiting-to-be-run", observed_at: OBSERVED };

const ok: CommandResult = { ok: true, request_id: "req-1", detail: "Started as pid 4242." };

/**
 * A recording set of ports.
 *
 * `calls` is an ordered list of what happened, because the assertion that
 * matters most in this file is about **order** — a run asked for before the
 * process exists is refused with `not_running`, and no assertion about return
 * values catches that.
 */
function ports(
  over: Partial<StartAndRunPorts> & { publishesAfter?: number | null } = {},
): StartAndRunPorts & { calls: string[] } {
  const calls: string[] = [];
  let reads = 0;
  // `null` is an agent that never publishes a task — the hand-written case —
  // and is handled here rather than by overriding `readWaitingTask`, so that
  // every path through this helper still records the read it performed.
  const publishesAfter = over.publishesAfter === undefined ? 0 : over.publishesAfter;

  return {
    calls,
    start: over.start ?? ((agentId) => {
      calls.push(`start:${agentId}`);
      return Promise.resolve(ok);
    }),
    readWaitingTask: over.readWaitingTask ?? (() => {
      calls.push("read");
      const answer = publishesAfter !== null && reads >= publishesAfter ? TASK : null;
      reads += 1;
      return Promise.resolve(answer);
    }),
    retry: over.retry ?? ((agentId, task) => {
      calls.push(`retry:${agentId}:${task.task_id}`);
      return Promise.resolve({ ok: true, request_id: "req-2", detail: "The run started." });
    }),
    wait: over.wait ?? (() => {
      calls.push("wait");
      return Promise.resolve();
    }),
  };
}

describe("starting a stopped agent and running it", () => {
  it("starts the process before it asks for a run", async () => {
    const p = ports();

    const outcome = await startAndRun("competitor-scout", p);

    expect(outcome).toEqual({
      kind: "ran",
      result: { ok: true, request_id: "req-2", detail: "The run started." },
    });
    /*
     * The ordering assertion, and the reason this module exists.
     *
     * `Supervisor.deliver` answers `not_running` for a command sent to an agent
     * with no live child, so a retry issued before or beside the start would be
     * refused after the press — the failure `lib/views/agent-control.ts` is
     * written to prevent. Start, then look, then run.
     */
    expect(p.calls).toEqual(["start:competitor-scout", "read", "retry:competitor-scout:waiting-to-be-run"]);
  });

  it("does not ask for a run when the process would not start", async () => {
    const refused: CommandResult = {
      ok: false,
      request_id: "req-1",
      reason: "invalid_manifest",
      detail: "The manifest is v1. Hosting an agent requires a v2 manifest with an agent_dom block.",
    };
    const p = ports({ start: () => Promise.resolve(refused) });

    const outcome = await startAndRun("competitor-scout", p);

    expect(outcome).toEqual({ kind: "start_refused", result: refused });
    // Nothing was read and nothing was run. A sequence that polled for a task
    // after a refused start would spend its whole timeout finding nothing and
    // then report `nothing_offered`, which names the wrong failure.
    expect(p.calls).toEqual([]);
  });

  it("waits for an agent that has not published its task yet", async () => {
    const p = ports({ publishesAfter: 2 });

    const outcome = await startAndRun("competitor-scout", p, { timeoutMs: 100, pollMs: 10 });

    expect(outcome.kind).toBe("ran");
    expect(p.calls).toEqual([
      "start:competitor-scout",
      "read",
      "wait",
      "read",
      "wait",
      "read",
      "retry:competitor-scout:waiting-to-be-run",
    ]);
  });

  /**
   * The honest end of the road for an agent that is not built from the kit.
   *
   * The template publishes `waiting-to-be-run` on purpose and
   * `agent-kit/template/agent.mjs` calls it load-bearing, but nothing obliges an
   * agent written by hand to. Its process is up, which is the part worth saying,
   * and `AGENT_CONTROL_COPY.start_nothing_offered` is what says it.
   */
  it("reports that nothing was offered rather than inventing a failure", async () => {
    const p = ports({ publishesAfter: null });

    const outcome = await startAndRun("hand-written", p, { timeoutMs: 20, pollMs: 10 });

    expect(outcome).toEqual({ kind: "nothing_offered" });
  });

  /**
   * Look before waiting, never wait before looking.
   *
   * A zero timeout means "do not wait", not "do not look" — and the sample agent
   * on a warm machine publishes its task fast enough that the difference is a
   * poll interval of a person watching nothing happen.
   */
  it("reads once before it waits at all", async () => {
    const p = ports();

    const outcome = await startAndRun("competitor-scout", p, { timeoutMs: 0, pollMs: 10 });

    expect(outcome.kind).toBe("ran");
    expect(p.calls).not.toContain("wait");
  });

  it("gives up after the timeout rather than polling forever", async () => {
    const p = ports({ publishesAfter: null });

    await startAndRun("hand-written", p, { timeoutMs: 30, pollMs: 10 });

    // Four reads: one before the first wait, then one per interval up to and
    // including the read at `waited === timeoutMs`.
    expect(p.calls.filter((call) => call === "read")).toHaveLength(4);
  });
});
