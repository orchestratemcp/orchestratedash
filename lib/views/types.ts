/**
 * What a page is given, and nothing else (MAR-432, DASH-20).
 *
 * Every page in DASH used to be a server component that called `lib/store.ts`
 * directly, which worked because the page and the database were in the same
 * process. The packaged app breaks that: the renderer is a static export and the
 * database is in Electron main. So the pages now render a *view* — a document
 * built on the trusted side and handed across a boundary.
 *
 * ## Why the shapes live here rather than being inferred
 *
 * Two callers must produce byte-identical answers: the IPC read handler in
 * `electron/main.ts` and the developer path's GET routes under `app/api/views/`.
 * A shape that is whatever `readStore()` happened to return is a shape those two
 * can drift apart on. Naming it once is what makes "the browser tab and the
 * installed app render the same thing" a checkable claim instead of a hope.
 *
 * ## Two rules every type in this file obeys
 *
 * 1. **Structured-clone safe.** These cross `contextBridge`, which clones rather
 *    than passing references. Plain objects, arrays, strings, numbers, booleans
 *    and `null`. No `Date`, no `Map`, no class instance, no function — each of
 *    which would either throw at the boundary or arrive as something else.
 * 2. **Narrowed on purpose, not by accident.** A view carries what a page
 *    renders. It is not a window onto the store, and the difference matters most
 *    where the underlying record holds more than the page shows — see
 *    `AgentOriginView`.
 */

import type { RunAnalysis } from "../analyze";
import type { ConnectionRequirementRow } from "../connections";
import type { RunEvent } from "../contracts";
import type { AgentCompliance } from "../insights";
import type { RunSummary } from "../store";

/* ---------------------------------------------------------------------- *
 * Agents
 * ---------------------------------------------------------------------- */

/**
 * Where an agent came from, reduced to the three states the UI distinguishes.
 *
 * **This is the narrowing that matters most in this file.** The page used to be
 * handed a whole `ManagedRegistration`, which was harmless while the page and
 * the registration were in the same process. That record carries `command`,
 * `args` and an optional `env` block — extra environment for the agent's child
 * process, which is somebody else's configuration and can hold anything they put
 * in it. Sending it to a renderer would be sending the renderer a set of values
 * no screen displays and nobody reviewed for that purpose.
 *
 * So the projection is the three facts `AgentOrigin` actually renders, and the
 * rest never crosses. `source_project` is deliberately kept: it is a folder the
 * user chose, which `docs/design-brief.md` states is content rather than an
 * identifier, and the origin column is meaningless without it.
 */
export interface AgentOriginView {
  kind: "added_through_dash" | "set_up_by_hand" | "watched_only";
  /** The folder the agent's own code lives in. Absent unless DASH added it. */
  source_project?: string;
}

export interface AgentRow {
  name: string;
  goal: string;
  plan_source: string;
  build_target: string;
  planned_steps: number;
  automation_clearance: string;
  run_count: number;
  origin: AgentOriginView;
  compliance: AgentCompliance;
}

export interface AgentsView {
  agents: AgentRow[];
}

/* ---------------------------------------------------------------------- *
 * Runs
 * ---------------------------------------------------------------------- */

export interface RunRow extends RunSummary {
  analysis: RunAnalysis | null;
}

export interface RunsView {
  runs: RunRow[];
}

/** One planned step, joined to whether the run executed it. */
export interface PlannedStepView {
  step: number;
  component_id: string;
  risk_level: string;
  model_tier: string;
  executed: boolean;
}

/**
 * One run's detail, or the fact that there is no such run.
 *
 * `found: false` rather than `null`, because the two hosts report absence
 * differently and the page should not have to care: a server component called
 * `notFound()`, an HTTP route returns 404, and the IPC channel returns a
 * document. One shape means one branch in the page.
 */
export type RunView =
  | { found: false }
  | {
      found: true;
      agent: string;
      run_id: string;
      events: RunEvent[];
      analysis: RunAnalysis | null;
      planned_route: PlannedStepView[];
      /**
       * Whether the agent's manifest has been imported. `analysis` being null
       * already implies it, but a page that has to infer "there is no plan" from
       * a null is a page that will eventually infer something else.
       */
      manifest_imported: boolean;
      /**
       * Component ids that ran but were not in the plan. Computed here, where
       * the manifest is, rather than in the page from two sets it would have to
       * be given anyway.
       */
      unplanned_component_ids: string[];
    };

/* ---------------------------------------------------------------------- *
 * Connections
 * ---------------------------------------------------------------------- */

export interface AgentConnections {
  name: string;
  rows: ConnectionRequirementRow[];
}

export interface ConnectionsView {
  agents: AgentConnections[];
  /**
   * Names of imported agents whose manifest is too old to declare connections.
   *
   * Carried separately rather than folded in as empty checklists, for the reason
   * `listConnectionCapableAgents` states: "declares no connections" and "is too
   * old to declare any" are different claims and the Connection Center must not
   * make the first when it means the second.
   */
  older_agent_names: string[];
}
