/**
 * Build the Agent DOM state document the runner serves.
 *
 * Pure. Takes what the runner observed about a process and what the agent said
 * about itself, and produces one snapshot. The whole design is in which of
 * those two wins.
 *
 * ## The runner is authoritative about the process; the agent is not
 *
 * The agent contributes runs, tasks, choices, approvals — things only it knows.
 * It does **not** get to say whether it is alive. That is the difference
 * between a monitor and a press release, and it is the entire content of the
 * issue's acceptance criterion that killing an agent process must show it as
 * stopped "not as healthy": a dead agent's last self-report says `running`, and
 * any design that trusts it reports a healthy agent forever.
 *
 * So three fields are taken from the runner and can never be overridden:
 *
 * - `agent_id`, because an agent that could name a different agent could write
 *   state over its neighbour's. The runner knows which child this is.
 * - `observed_at`, because a snapshot's freshness is what DASH's stale-display
 *   check binds to, and an agent choosing its own timestamps could make an old
 *   snapshot look current.
 * - `status`, whenever the process is not running.
 *
 * ## What happens to a run when its process dies
 *
 * It is reported `failed`, not left `running`. A run whose process no longer
 * exists is not going to progress, and "running" is the one status that would
 * make DASH draw a live, healthy agent. `failed` is a claim, and it is the
 * honest one: the run did not complete and nothing is going to complete it.
 */

import type { AgentCommand } from "../lib/workspace";

/**
 * What the supervisor knows about a child, independent of anything the child
 * said. See `runner/supervisor.ts`.
 */
export interface ProcessFacts {
  agent_id: string;
  /** The real OS process id, or null when nothing is running. */
  pid: number | null;
  lifecycle: "starting" | "running" | "stopping" | "stopped" | "exited" | "failed_to_start";
  exit_code: number | null;
  exit_signal: string | null;
  started_at: string | null;
}

/** The state document, as served. Validated before it leaves the runner. */
export type AgentDomStateDocument = Record<string, unknown>;

/**
 * The keys an agent may contribute. Anything else it sends is dropped.
 *
 * An allowlist rather than a merge: the schema tolerates unknown additive
 * fields, so a blind spread would let an agent inject keys DASH's later
 * versions might start reading. What the agent is for is the resource lists.
 */
const AGENT_OWNED_ARRAYS = [
  "runs",
  "tasks",
  "choices",
  "actions",
  "approval_requests",
  "approval_decisions",
  "memory",
  "audit_events",
] as const;

/** Statuses that mean the process is genuinely up. */
const LIVE_LIFECYCLES: ReadonlySet<ProcessFacts["lifecycle"]> = new Set(["starting", "running", "stopping"]);

export function buildAgentDomState(
  facts: ProcessFacts,
  report: Record<string, unknown> | null,
  now: Date,
): AgentDomStateDocument {
  const live = LIVE_LIFECYCLES.has(facts.lifecycle);
  const arrays = collectArrays(report);

  const runs = live ? arrays["runs"] : terminateRuns(arrays["runs"]);

  return {
    state_version: 1,
    manifest_version: 2,
    agent_id: facts.agent_id,
    observed_at: now.toISOString(),
    status: resolveStatus(facts, report, live),
    // The runner brokers no connections and has no credential of the agent's to
    // check, so it declares none rather than guessing at health it cannot see.
    // Under the contract that renders as "not configured here", which is true.
    connections: [],
    runs,
    tasks: arrays["tasks"],
    choices: live ? arrays["choices"] : [],
    actions: live ? arrays["actions"] : [],
    approval_requests: live ? arrays["approval_requests"] : [],
    approval_decisions: arrays["approval_decisions"],
    memory: arrays["memory"],
    audit_events: arrays["audit_events"],
    plan_vs_actual: resolvePlanVsActual(report, runs),
  };
}

/**
 * The agent's status, with the runner holding the veto.
 *
 * A live process may describe itself — it is the only thing that knows whether
 * it is `running` or `needs_attention`. A dead one gets the runner's verdict:
 * `error` when it exited badly, `offline` when it stopped or was stopped. That
 * asymmetry is the point.
 */
function resolveStatus(
  facts: ProcessFacts,
  report: Record<string, unknown> | null,
  live: boolean,
): string {
  if (!live) {
    if (facts.lifecycle === "failed_to_start") {
      return "error";
    }
    // A non-zero exit code or a terminating signal is a crash. A clean exit, or
    // a stop DASH asked for, is simply not running.
    const crashed =
      (facts.exit_code !== null && facts.exit_code !== 0) || facts.exit_signal !== null;
    return crashed ? "error" : "offline";
  }

  if (facts.lifecycle === "starting") {
    return "ready";
  }

  const claimed = report?.["status"];
  if (typeof claimed === "string" && SELF_REPORTABLE_STATUSES.has(claimed)) {
    return claimed;
  }
  return "running";
}

/**
 * What a *live* agent is allowed to call itself.
 *
 * `offline` and `error` are missing on purpose. Both are claims about the
 * process, which is the runner's to make — an agent reporting itself offline
 * while its process runs is describing something the contract has no word for,
 * and letting it through would put a status in DASH that no observation
 * supports.
 */
const SELF_REPORTABLE_STATUSES: ReadonlySet<string> = new Set([
  "inactive",
  "ready",
  "running",
  "paused",
  "needs_attention",
]);

/**
 * Close out runs whose process is gone.
 *
 * Only `running` is rewritten. A run the agent already called `completed`,
 * `failed` or `cancelled` reached that state under its own power and the
 * runner has nothing to add; a `queued` or `paused` run was not making progress
 * anyway and saying it failed would invent an event.
 */
function terminateRuns(runs: unknown[]): unknown[] {
  return runs.map((run) => {
    if (typeof run !== "object" || run === null) {
      return run;
    }
    const record = run as Record<string, unknown>;
    if (record["status"] !== "running") {
      return run;
    }
    return { ...record, status: "failed" };
  });
}

function collectArrays(report: Record<string, unknown> | null): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const key of AGENT_OWNED_ARRAYS) {
    const value = report?.[key];
    out[key] = Array.isArray(value) ? value : [];
  }
  return out;
}

/**
 * `plan_vs_actual` is required by the schema and needs a `run_id`.
 *
 * The agent's own block is used when it supplied a usable one. Otherwise the
 * most recent run names it, and an agent that has never run gets the literal
 * `"none"` — a placeholder rather than a fabricated id, because the alternative
 * is inventing a run identifier that resolves to nothing and that a command
 * could then be aimed at.
 */
function resolvePlanVsActual(
  report: Record<string, unknown> | null,
  runs: unknown[],
): Record<string, unknown> {
  const supplied = report?.["plan_vs_actual"];
  if (typeof supplied === "object" && supplied !== null && !Array.isArray(supplied)) {
    const candidate = supplied as Record<string, unknown>;
    const runId = candidate["run_id"];
    if (typeof runId === "string" && runId.length > 0) {
      return {
        run_id: runId,
        planned_components: asStringArray(candidate["planned_components"]),
        executed_components: asStringArray(candidate["executed_components"]),
        deviations: Array.isArray(candidate["deviations"]) ? candidate["deviations"] : [],
      };
    }
  }

  const latest = runs.at(-1);
  const runId =
    typeof latest === "object" && latest !== null
      ? ((latest as Record<string, unknown>)["id"] as string | undefined)
      : undefined;

  return {
    run_id: typeof runId === "string" && runId.length > 0 ? runId : "none",
    planned_components: [],
    executed_components: [],
    deviations: [],
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/* ---------------------------------------------------------------------- *
 * Process facts, for the runner's own status endpoint
 * ---------------------------------------------------------------------- */

/**
 * The honest process report.
 *
 * PID and liveness only. **CPU and memory are deliberately absent**: the issue
 * asks the runner to report them and says it can do so honestly because it
 * started the process, which is true of the PID and not yet true of the rest —
 * reading a child's CPU and RSS portably needs either a native dependency or
 * shelling out per poll, and neither was worth adding to this slice. An absent
 * field is honest; a zero would not be. See `runner/README.md`.
 */
export interface ProcessReport {
  agent_id: string;
  pid: number | null;
  lifecycle: ProcessFacts["lifecycle"];
  started_at: string | null;
  exit_code: number | null;
  exit_signal: string | null;
  /** Commands supported per the agent's own manifest, as the runner read it. */
  commands: AgentCommand[];
}
