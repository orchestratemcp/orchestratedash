/**
 * The four view projections, written once (MAR-432, DASH-20).
 *
 * Two callers, and the reason this module exists is that there are two:
 *
 * - `electron/main.ts`, answering the renderer's read channel in the packaged
 *   app;
 * - `app/api/views/*`, answering `fetch` on the developer path.
 *
 * MAR-432's design is "one renderer, two data sources", and the thing that keeps
 * the second source from quietly becoming second-class is that neither source
 * *builds* anything. Both call the functions below, on the same SQLite database,
 * and return what they get. Any difference between what a browser tab shows and
 * what the installed app shows would have to be a difference in transport, which
 * is a much smaller thing to keep honest than two renderings of the same data.
 *
 * **This module reads the disk and must never be imported by a page.** It
 * reaches `node:sqlite` through `lib/store.ts` and the filesystem through
 * `lib/registration.ts`. Pages import `./types` — type-only, erased at compile
 * time — and get their data across a boundary. `tests/views.test.ts` asserts the
 * separation from the other side by exercising these against a real store.
 */

import { deriveConnectionRequirements } from "../connections";
import { dataDir } from "../db";
import {
  analysisForRun,
  complianceForAgent,
  eventsForRun,
  listAnalyzedRuns,
} from "../insights";
import { listRegistrations, type ManagedRegistration } from "../registration";
import {
  listAgents,
  listConnectionCapableAgents,
  readStore,
  type StoreShape,
} from "../store";
import type {
  AgentOriginView,
  AgentsView,
  ConnectionsView,
  PlannedStepView,
  RunView,
  RunsView,
} from "./types";

/**
 * Where an agent came from, narrowed to what the origin column renders.
 *
 * See `AgentOriginView` for why this is a projection and not a pass-through: the
 * registration record carries the agent's command line and environment block,
 * and neither has any business crossing into a renderer.
 */
export function agentOrigin(registration: ManagedRegistration | undefined): AgentOriginView {
  if (registration === undefined) {
    return { kind: "watched_only" };
  }
  if (registration.dash.owner !== "dash_handoff") {
    return { kind: "set_up_by_hand" };
  }
  const project = registration.dash.source_project;
  return project === undefined
    ? { kind: "added_through_dash" }
    : { kind: "added_through_dash", source_project: project };
}

/**
 * The agents list.
 *
 * Registrations are read from the directory rather than from the store, for the
 * reason `app/page.tsx` gave when it was a server component: ownership is a fact
 * about a file the runner reads, and a second copy of it in the database would
 * be free to disagree with the thing that matters.
 */
export function agentsView(store: StoreShape = readStore()): AgentsView {
  const registrations = new Map(
    listRegistrations(dataDir).map((registration) => [registration.agent_id, registration]),
  );

  return {
    agents: listAgents(store).map((agent) => ({
      name: agent.name,
      goal: agent.goal,
      plan_source: agent.plan_source,
      build_target: agent.build_target,
      planned_steps: agent.planned_steps,
      automation_clearance: agent.automation_clearance,
      run_count: agent.run_count,
      origin: agentOrigin(registrations.get(agent.name)),
      compliance: complianceForAgent(agent.name, store),
    })),
  };
}

export function runsView(store: StoreShape = readStore()): RunsView {
  return { runs: listAnalyzedRuns(store) };
}

/**
 * One run's plan-vs-actual detail.
 *
 * The plan/actual join happens here rather than in the page. It used to be three
 * `Set`s built in the component from the manifest and the analysis; doing it on
 * this side means the page is handed the answer instead of the ingredients, and
 * that the answer is the same one in both hosts.
 */
export function runView(
  agent: string,
  runId: string,
  store: StoreShape = readStore(),
): RunView {
  const events = eventsForRun(agent, runId, store);
  if (events.length === 0) {
    return { found: false };
  }

  const analysis = analysisForRun(agent, runId, store);
  const manifest = store.agents[agent]?.manifest;
  const executed = new Set(analysis?.executed_route ?? []);
  const planned = new Set((manifest?.planned_route ?? []).map((entry) => entry.component_id));

  const plannedRoute: PlannedStepView[] = [...(manifest?.planned_route ?? [])]
    .sort((a, b) => a.step - b.step)
    .map((entry) => ({
      step: entry.step,
      component_id: entry.component_id,
      risk_level: entry.risk_level,
      model_tier: entry.model_tier,
      executed: executed.has(entry.component_id),
    }));

  // Only meaningful when there is a plan to be unplanned against: with no
  // manifest imported, every component would be "unplanned", which is an
  // accusation rather than a finding.
  const unplanned =
    manifest === undefined
      ? []
      : [
          ...new Set(
            events
              .filter((event) => event.type === "step_started")
              .map((event) => event.component_id)
              .filter((id): id is string => id !== undefined && !planned.has(id)),
          ),
        ];

  return {
    found: true,
    agent,
    run_id: runId,
    events,
    analysis,
    planned_route: plannedRoute,
    manifest_imported: manifest !== undefined,
    unplanned_component_ids: unplanned,
  };
}

export function connectionsView(store: StoreShape = readStore()): ConnectionsView {
  return {
    agents: listConnectionCapableAgents(store).map(({ name, manifest }) => ({
      name,
      rows: deriveConnectionRequirements(manifest),
    })),
    older_agent_names: listAgents(store)
      .filter((agent) => agent.manifest_version === 1)
      .map((agent) => agent.name),
  };
}
