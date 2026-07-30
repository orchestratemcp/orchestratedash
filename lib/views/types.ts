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
import type {
  AvailableControl,
  InboxItem,
  WorkspaceOverview,
} from "../workspace";

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

/**
 * A checklist row, plus what DASH holds for it (MAR-383).
 *
 * Kept as an extension of `ConnectionRequirementRow` rather than folded into it:
 * that type is a pure function of the manifest and is used where no store
 * exists, and giving it fields that only a database can fill would make it lie
 * in those places.
 */
export interface ConnectionRowWithCredential extends ConnectionRequirementRow {
  /** Whether DASH may take a credential for this row at all. */
  dash_can_hold: boolean;
  /** Which declared field a Connect acts on, or null when there is none. */
  field_id: string | null;
  /**
   * The masked hint stored when the credential was — four trailing characters
   * of a typed secret, or a masked account for a sign-in (MAR-446). Never a
   * value either way.
   */
  masked_hint: string | null;
  /** Whether the manifest names somewhere for DASH to deliver it. */
  delivered_to_agent: boolean;
  /**
   * Whether Connect opens a text box or a provider sign-in (MAR-446).
   *
   * Null when DASH cannot hold this row at all. The page needs it because the
   * two produce different sentences for the same situation: an API key DASH
   * holds but cannot deliver has to be fetched by the agent some other way,
   * while a sign-in DASH holds but cannot deliver is one DASH will keep renewing
   * and the agent will reach through its own means.
   */
  credential_kind: "secret" | "oauth" | null;
}

export interface AgentConnections {
  name: string;
  rows: ConnectionRowWithCredential[];
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

/* ---------------------------------------------------------------------- *
 * Live workspace
 * ---------------------------------------------------------------------- */

export interface WorkspaceRunView {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  current_step: string | null;
  progress: number | null;
  /**
   * Run-scoped controls only. Approval and choice controls live on their
   * concrete inbox item, where the target ids and side-effect preview exist.
   */
  controls: AvailableControl[];
}

export interface WorkspaceTaskView {
  id: string;
  run_id: string;
  label: string;
  status: string;
  created_at: string | null;
  detail: string | null;
}

export interface WorkspaceConnectionView {
  connection_id: string;
  state: string;
  masked_account: string | null;
  checked_at: string;
  reauthorization_required: boolean;
  detail: string | null;
}

export interface WorkspaceMemoryView {
  id: string;
  label: string;
  summary: string;
  provenance: string;
  retention: "descriptor_only" | "user_approved";
  updated_at: string;
}

export interface WorkspaceApprovalDecisionView {
  id: string;
  request_id: string;
  decision: "approved" | "rejected";
  actor_id: string;
  decided_at: string;
  correlation_id: string;
}

export interface WorkspaceAuditEventView {
  id: string;
  type: string;
  actor_id: string;
  target_id: string;
  ts: string;
  correlation_id: string;
}

export interface WorkspaceCommandAuditView {
  command: string;
  decision: "allowed" | "denied" | "duplicate";
  reason: string | null;
  actor_id: string;
  actor_type: string;
  authenticated_by: string;
  run_id: string | null;
  correlation_id: string;
  decided_at: string;
}

export interface WorkspacePlanView {
  run_id: string;
  planned_components: string[];
  executed_components: string[];
  deviations: Array<{ kind: string; detail: string }>;
}

export interface WorkspaceSnapshotView {
  observed_at: string;
  received_at: string;
  overview: WorkspaceOverview;
  inbox: InboxItem[];
  runs: WorkspaceRunView[];
  tasks: WorkspaceTaskView[];
  connections: WorkspaceConnectionView[];
  memory: WorkspaceMemoryView[];
  approval_decisions: WorkspaceApprovalDecisionView[];
  audit_events: WorkspaceAuditEventView[];
  command_audit: WorkspaceCommandAuditView[];
  plan_vs_actual: WorkspacePlanView | null;
}

/**
 * An imported agent can legitimately have no live Agent DOM snapshot yet.
 * Keeping that as `snapshot: null` lets the workspace explain "not connected"
 * without pretending the agent itself is absent.
 */
export type WorkspaceView =
  | { found: false }
  | {
      found: true;
      agent: string;
      title: string;
      goal: string;
      snapshot: WorkspaceSnapshotView | null;
    };

export type WorkInboxRow = InboxItem & {
  agent: string;
  agent_title: string;
  observed_at: string;
};

export interface WorkInboxView {
  items: WorkInboxRow[];
}
