/**
 * Starting a stopped agent and running it, in one press (MAR-657).
 *
 * ## The gap this closes
 *
 * DASH could not start an agent. Not "had no button for it" — could not do it
 * at all from any surface a person can reach. `runner.start` has been in the
 * command catalogue since MAR-415 and reaches
 * `POST /agents/{id}/lifecycle {"action":"start"}`, but its only caller in the
 * whole product was `ensureRunning` in `lib/handoff-flow.ts`, at the end of the
 * add-agent flow. An agent was started once, on the day it was installed, and
 * never again: `runner/main.ts` adopts every registration with `child: null`
 * and calls `start` on none of them, and `runner/README.md` says why on purpose
 * — *"An agent that exits stays exited. Supervision here means 'knows it died
 * and says so', not 'brings it back'."*
 *
 * So every agent in a real store sat at `status: "offline"`, `tasks: []`, and
 * `buildAgentControl` correctly reported that there was nothing to press.
 *
 * ## Why the sequence is two acts and the press is one
 *
 * Starting the process does **not** run the agent. The kit template starts idle
 * and stays idle by design (MAR-457), publishing one pending task — `"Waiting
 * to be run"` — which is what Run now binds. `electron/smoke.ts` has proved
 * exactly this order for as long as the template has existed: start, wait for
 * the task, then `retry`.
 *
 * A person does not have two intentions here. Henrik asked for *"a run button.
 * One that triggers the agent to go through all its steps"*, and a control that
 * only spawned would leave them looking at a status change and a second button
 * that appeared a poll later. So the press performs both acts, in the order the
 * smoke proves, and reports which one it got to.
 *
 * ## What this deliberately does not move
 *
 * **ADR 0016.** The spend allowance still opens in the one place it has ever
 * opened — `input.command === "retry"` in `electron/main.ts` — because the
 * second act *is* a retry going through `runAgentCommand`. Nothing here spends,
 * and a lifecycle press on its own still spends nothing. If this module minted
 * its own path to the runner it would have had to reproduce the allowance, the
 * nonce, the expiry and the audit row, and the copy that skipped them would be
 * the one that starts processes.
 *
 * **ADR 0010 and ADR 0014.** Every port here is the local one. Nothing reads
 * `agent_deploys`, nothing names a host, and `buildAgentControl` only offers
 * this control for a status the *runner* published about its own child.
 *
 * ## Why it is a function with injected ports rather than code in the page
 *
 * Because it has five outcomes and four of them are failures, and a sequence
 * whose failure modes only exist inside a React event handler is a sequence
 * nobody tests. `tests/agent-start.test.ts` drives every branch with no
 * browser, no bridge and no runner.
 */

import type { CommandResult } from "./shell/ipc";

/** The pending task a freshly started agent published, and its freshness token. */
export interface WaitingTask {
  task_id: string;
  /**
   * The snapshot the task was seen in, never a re-read one.
   *
   * `retry` is judged against `observed_at`, so it has to be the value from the
   * same read that found the task — pairing a task id with a newer timestamp
   * would assert a freshness DASH did not observe.
   */
  observed_at: string;
}

/**
 * Everything this sequence needs from the world, injected.
 *
 * All three are the local channels DASH already has. None of them is invented
 * here: `start` is `runner.start`, `retry` is one of the seven Agent DOM verbs,
 * and `readWaitingTask` is a read of the same workspace view the page is
 * already polling.
 */
export interface StartAndRunPorts {
  /** `runner.start` — asks the runner to spawn this agent's process. */
  start(agentId: string): Promise<CommandResult>;
  /**
   * The pending task with no run attached, if the agent has published one yet.
   *
   * Null means "not yet", not "never": this is polled, and the difference
   * between the two is only ever how long we waited.
   */
  readWaitingTask(agentId: string): Promise<WaitingTask | null>;
  /** The existing Run now press, unchanged. */
  retry(agentId: string, task: WaitingTask): Promise<CommandResult>;
  /** Injected so the test suite does not sleep. */
  wait(ms: number): Promise<void>;
}

/**
 * How long to wait for a started agent to offer something to run.
 *
 * The runner is not in this loop — the agent publishes its task down its own
 * stdout and DASH sees it on the next poll of the workspace view, so the bound
 * that matters is a small number of polls rather than a process's startup time.
 *
 * Chosen to outlast a cold Node start on a slow machine and to stay well inside
 * the patience of somebody who just pressed a button. Falling off the end is
 * not an error — see `nothing_offered`.
 */
export const START_RUN_TIMEOUT_MS = 20_000;
export const START_RUN_POLL_MS = 500;

/**
 * What the press did, named by how far it got.
 *
 * A union rather than an `ok` boolean, for `AgentRunControl`'s reason: "the
 * process would not start" and "the process started and offered nothing" are
 * different facts about somebody's agent, and a shape that collapsed them would
 * put one sentence on screen for two situations again.
 */
export type StartAndRunOutcome =
  /** The process would not start. Nothing ran, and `result` says why. */
  | { kind: "start_refused"; result: CommandResult }
  /**
   * The process started and published nothing to run before the timeout.
   *
   * Not a failure of DASH and not necessarily a failure at all: an agent that
   * was not built from the kit has no obligation to publish a pending task, and
   * this is the honest end of that road. The process is up and stays up.
   */
  | { kind: "nothing_offered" }
  /** Both acts completed. `result` is the run command's own answer. */
  | { kind: "ran"; result: CommandResult };

/**
 * Start the agent's process, wait for it to offer a run, and ask for it.
 *
 * The order is the argument, exactly as it is in `Supervisor.start`: a run
 * asked for before the process exists is refused with `not_running`, which is
 * the after-the-press refusal this whole area of the product is built to avoid.
 */
export async function startAndRun(
  agentId: string,
  ports: StartAndRunPorts,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<StartAndRunOutcome> {
  const started = await ports.start(agentId);
  if (!started.ok) {
    return { kind: "start_refused", result: started };
  }

  const timeoutMs = options.timeoutMs ?? START_RUN_TIMEOUT_MS;
  const pollMs = options.pollMs ?? START_RUN_POLL_MS;

  /*
   * Read first, then wait — never wait, then read.
   *
   * An agent that published its task while the start call was still returning
   * would otherwise cost a person a poll interval of nothing happening, and the
   * sample agent on a warm machine is exactly that fast. It also makes the
   * zero-timeout case in the tests mean "one read", which is the honest reading
   * of "do not wait" rather than "do not look".
   */
  for (let waited = 0; ; waited += pollMs) {
    const waiting = await ports.readWaitingTask(agentId);
    if (waiting !== null) {
      return { kind: "ran", result: await ports.retry(agentId, waiting) };
    }
    if (waited >= timeoutMs) {
      return { kind: "nothing_offered" };
    }
    await ports.wait(pollMs);
  }
}
