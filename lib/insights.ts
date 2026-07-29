import { analyzeRun, type RunAnalysis } from "./analyze";
import type { RunEvent } from "./contracts";
import { listRuns, readStore, type RunSummary, type StoreShape } from "./store";

/**
 * The bridge between the file store and the pure plan-vs-actual analyzer.
 *
 * `analyze.ts` stays free of I/O so it can be unit-tested against literal
 * fixtures; this module is the only place that knows analysis findings come
 * from stored events joined to a stored manifest.
 */

/**
 * How many recent runs the agent card rolls up.
 *
 * Re-exported rather than defined here since MAR-432: the agents list renders it
 * in a column heading and is now a client component, which cannot import this
 * module. `lib/views/rollup.ts` holds the number so both sides read the same one.
 */
import { ROLLUP_RUN_COUNT } from "./views/rollup";
export { ROLLUP_RUN_COUNT };

export function eventsForRun(
  agent: string,
  runId: string,
  store: StoreShape = readStore(),
): RunEvent[] {
  return store.events
    .filter((event) => event.agent === agent && event.run_id === runId)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Analysis for a single run, or null when the agent's manifest has not been
 * imported. Without a plan there is nothing to judge the run against — DASH
 * says so rather than inventing a verdict.
 */
export function analysisForRun(
  agent: string,
  runId: string,
  store: StoreShape = readStore(),
): RunAnalysis | null {
  const stored = store.agents[agent];
  if (stored === undefined) {
    return null;
  }
  const events = eventsForRun(agent, runId, store);
  if (events.length === 0) {
    return null;
  }
  return analyzeRun(stored.manifest, events);
}

export interface AnalyzedRun extends RunSummary {
  analysis: RunAnalysis | null;
}

export function listAnalyzedRuns(store: StoreShape = readStore()): AnalyzedRun[] {
  return listRuns(store).map((run) => ({
    ...run,
    analysis: analysisForRun(run.agent, run.run_id, store),
  }));
}

export interface AgentCompliance {
  /** Runs considered, newest first, capped at ROLLUP_RUN_COUNT. */
  runs_considered: number;
  gate_violation_runs: number;
  drifted_runs: number;
  clearance_flagged_runs: number;
}

/** Rollup of an agent's most recent runs, for the at-a-glance agent card. */
export function complianceForAgent(
  agent: string,
  store: StoreShape = readStore(),
  limit: number = ROLLUP_RUN_COUNT,
): AgentCompliance {
  const analyses = listRuns(store)
    .filter((run) => run.agent === agent)
    .slice(0, limit)
    .map((run) => analysisForRun(run.agent, run.run_id, store))
    .filter((analysis): analysis is RunAnalysis => analysis !== null);

  return {
    runs_considered: analyses.length,
    gate_violation_runs: analyses.filter((a) => a.gate_violations.length > 0).length,
    drifted_runs: analyses.filter((a) => a.drift.length > 0).length,
    clearance_flagged_runs: analyses.filter((a) => a.clearance_findings.length > 0)
      .length,
  };
}
