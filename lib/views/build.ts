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

import { analyzeGrounding } from "../analyze";
import { isDigestArtifact } from "../contracts";
import type { ManifestPermissions, PermissionGrant } from "../contracts";
import { heldCredentials } from "../connection-actions";
import { connectableFields } from "../connection-credentials";
import { describeStoreDamage } from "../copy/recovery";
import { deriveConnectionRequirements, type ConnectionSourceManifest } from "../connections";
import {
  readAgentDomState,
  readCommandAudit,
} from "../agent-dom/store";
import { dataDir } from "../db";
import {
  analysisForRun,
  complianceForAgent,
  eventsForRun,
  listAnalyzedRuns,
} from "../insights";
import { listRegistrations, type ManagedRegistration } from "../registration";
import {
  artifactsForRun,
  latestArtifactForAgent,
  listAgents,
  listAgentNames,
  listConnectionCapableAgents,
  readAgentManifest,
  readStore,
  type StoreShape,
} from "../store";
import {
  availableControls,
  buildOverview,
  buildWorkInbox,
  type AgentDomState,
  type WorkspaceManifest,
} from "../workspace";
import type {
  AgentOriginView,
  AgentsView,
  ConnectionsView,
  PlannedStepView,
  RunView,
  RunsView,
  WorkInboxView,
  WorkspaceSnapshotView,
  WorkspaceView,
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
    // Composed here rather than in the page, so both hosts hand the renderer the
    // same sentence — the property this module exists to keep.
    damage: describeStoreDamage(store.unreadable),
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

  // Newest first, and the newest is the one judged. A run that revised its
  // digest corrected it; grading the superseded copy would report a finding the
  // user cannot see on the page in front of them.
  const artifacts = artifactsForRun(agent, runId);

  return {
    found: true,
    agent,
    run_id: runId,
    events,
    analysis,
    planned_route: plannedRoute,
    manifest_imported: manifest !== undefined,
    unplanned_component_ids: unplanned,
    artifacts,
    // Only a digest is graded (MAR-458). A draft has no items and no
    // `sources_fetched`, so there is nothing to check its citations against —
    // and a null verdict renders as no chip, which is the honest outcome. The
    // independent record of what a draft's agent was actually allowed to read is
    // the broker's audit trail, not a grounding score.
    grounding:
      artifacts[0] === undefined || !isDigestArtifact(artifacts[0])
        ? null
        : analyzeGrounding(artifacts[0]),
  };
}

/**
 * What DASH holds for one agent, folded onto the checklist rows (MAR-383).
 *
 * Two facts per row, and they answer different questions: `credential` says
 * whether DASH may take a credential for it at all — which is a property of the
 * manifest — and `held` says whether it currently has one, which is a property
 * of the vault reference table. A row can be connectable and unheld (the
 * ordinary first-run state), or held and no longer connectable (a manifest that
 * changed under a credential), and the UI needs to tell those apart.
 *
 * Reads `connection_secrets` and never the vault itself. Opening the vault here
 * would mean an OS unlock prompt every time somebody looked at this page — see
 * `heldCredentials` for the same argument at its own layer.
 */
function credentialStatus(
  agentName: string,
  manifest: ConnectionSourceManifest,
): Map<
  string,
  { field_id: string; masked_hint: string | null; deliverable: boolean; kind: "secret" | "oauth" }
> {
  const held = new Map<string, string | null>(
    heldCredentials(agentName).map((entry): [string, string | null] => [
      `${entry.connection_id} ${entry.field_id}`,
      entry.masked_hint,
    ]),
  );

  const status = new Map<
    string,
    {
      field_id: string;
      masked_hint: string | null;
      deliverable: boolean;
      kind: "secret" | "oauth";
    }
  >();

  for (const target of connectableFields(agentName, manifest)) {
    // First connectable field per connection wins. A v2 connection may declare
    // several, but the checklist is one row per connection, and a row with two
    // Connect buttons is a design decision nobody has made yet — so the row
    // acts on the first field the manifest declared, in the author's order.
    if (status.has(target.connection_id)) {
      continue;
    }
    status.set(target.connection_id, {
      field_id: target.field_id,
      masked_hint: held.get(`${target.connection_id} ${target.field_id}`) ?? null,
      deliverable: target.environment_name !== null,
      kind: target.kind,
    });
  }

  return status;
}

export function connectionsView(store: StoreShape = readStore()): ConnectionsView {
  return {
    agents: listConnectionCapableAgents(store).map(({ name, manifest }) => {
      const status = credentialStatus(name, manifest);
      return {
        name,
        rows: deriveConnectionRequirements(manifest).map((row) => {
          const credential = status.get(row.connection_id);
          return {
            ...row,
            dash_can_hold: credential !== undefined,
            field_id: credential?.field_id ?? null,
            masked_hint: credential?.masked_hint ?? null,
            delivered_to_agent: credential?.deliverable ?? false,
            credential_kind: credential?.kind ?? null,
          };
        }),
      };
    }),
    older_agent_names: listAgents(store)
      .filter((agent) => agent.manifest_version === 1)
      .map((agent) => agent.name),
  };
}

/* ---------------------------------------------------------------------- *
 * Live workspace (MAR-384, DASH-09)
 * ---------------------------------------------------------------------- */

/** A bounded screen, not an export of the audit tables. */
const WORKSPACE_AUDIT_LIMIT = 100;

function workspaceSnapshot(
  manifest: WorkspaceManifest,
  stored: NonNullable<ReturnType<typeof readAgentDomState>>,
  now: Date,
): WorkspaceSnapshotView {
  const state: AgentDomState = stored.state;

  return {
    observed_at: stored.observed_at,
    received_at: stored.received_at,
    overview: buildOverview(manifest, state, now),
    inbox: buildWorkInbox(manifest, state, now),
    runs: (state.runs ?? []).map((run) => ({
      id: run.id,
      status: run.status,
      started_at: run.started_at ?? null,
      finished_at: run.finished_at ?? null,
      current_step: run.current_step ?? null,
      progress: run.progress ?? null,
      // Approval/choice commands require concrete resource ids and therefore
      // render on inbox items, never as broad run controls.
      controls: availableControls(manifest, state, run.id).filter(
        ({ command }) => command !== "approve" && command !== "reject" && command !== "choose",
      ),
    })),
    tasks: (state.tasks ?? []).map((task) => ({
      id: task.id,
      run_id: task.run_id ?? null,
      label: task.label,
      status: task.status,
      created_at: task.created_at ?? null,
      detail: task.detail ?? null,
    })),
    connections: (state.connections ?? []).map((connection) => ({
      connection_id: connection.connection_id,
      state: connection.state,
      masked_account: connection.masked_account ?? null,
      checked_at: connection.checked_at,
      reauthorization_required: connection.reauthorization_required,
      detail: connection.detail ?? null,
    })),
    memory: (state.memory ?? []).map((entry) => ({
      id: entry.id,
      label: entry.label,
      summary: entry.summary,
      provenance: entry.provenance,
      retention: entry.retention,
      updated_at: entry.updated_at,
    })),
    approval_decisions: (state.approval_decisions ?? []).map((decision) => ({
      id: decision.id,
      request_id: decision.request_id,
      decision: decision.decision,
      actor_id: decision.actor_id,
      decided_at: decision.decided_at,
      correlation_id: decision.audit.correlation_id,
    })),
    // The state contract permits a short `detail`, but the audit screen does
    // not need it. Omitting agent-supplied prose keeps this read surface to
    // identity, actor, target, time and correlation.
    audit_events: (state.audit_events ?? [])
      .slice(-WORKSPACE_AUDIT_LIMIT)
      .reverse()
      .map((event) => ({
        id: event.id,
        type: event.type,
        actor_id: event.actor_id,
        target_id: event.target_id,
        ts: event.ts,
        correlation_id: event.audit.correlation_id,
      })),
    command_audit: readCommandAudit({ agent: state.agent_id })
      .slice(-WORKSPACE_AUDIT_LIMIT)
      .reverse()
      .map((record) => ({
        command: record.command,
        decision: record.decision,
        reason: record.reason ?? null,
        actor_id: record.actor_id,
        actor_type: record.actor_type,
        authenticated_by: record.authenticated_by,
        run_id: record.run_id,
        correlation_id: record.correlation_id,
        decided_at: record.decided_at,
      })),
    plan_vs_actual:
      state.plan_vs_actual === undefined
        ? null
        : {
            run_id: state.plan_vs_actual.run_id,
            planned_components: [...(state.plan_vs_actual.planned_components ?? [])],
            executed_components: [...(state.plan_vs_actual.executed_components ?? [])],
            deviations: (state.plan_vs_actual.deviations ?? []).map((deviation) => ({
              kind: deviation.kind,
              detail: deviation.detail,
            })),
          },
  };
}

/**
 * One imported agent's safe live workspace.
 *
 * The manifest and Agent DOM snapshot stay in main. The renderer receives only
 * fields a workspace renders, and command availability is already narrowed by
 * manifest capability plus current state before it crosses the boundary.
 */
export function workspaceView(
  agent: string,
  now: Date = new Date(),
): WorkspaceView {
  const manifest = readAgentManifest(agent);
  if (manifest === null) {
    return { found: false };
  }

  const workspaceManifest = manifest as WorkspaceManifest;
  const stored = readAgentDomState(agent);
  const digest = latestArtifactForAgent(agent);

  // Outside the snapshot, deliberately. The snapshot is what the *agent*
  // published about itself and is null until it has published anything; a digest
  // from a run last week is DASH's own record and survives the agent being
  // stopped, restarted or temporarily unreachable. Nesting it would make the
  // last thing the user cares about disappear whenever the process did.
  return {
    found: true,
    agent,
    title: workspaceManifest.agent.display_name ?? workspaceManifest.agent.name,
    goal: workspaceManifest.agent.goal,
    snapshot: stored === null ? null : workspaceSnapshot(workspaceManifest, stored, now),
    latest_digest: digest,
    latest_digest_grounding:
      digest === null || !isDigestArtifact(digest) ? null : analyzeGrounding(digest),
    permissions: declaredPermissions(manifest),
  };
}

/**
 * What the agent's manifest declares it may do without an account (MAR-457).
 *
 * Read straight from the manifest rather than from anything DASH derived: this
 * is a receipt for what the user was shown at consent, and a receipt that
 * disagreed with the dialog would be worse than no receipt. Empty for a manifest
 * that declares nothing.
 */
function declaredPermissions(manifest: unknown): PermissionGrant[] {
  const dom = (manifest as { agent_dom?: { permissions?: ManifestPermissions } }).agent_dom;
  return [...(dom?.permissions?.read ?? []), ...(dom?.permissions?.write ?? [])];
}

/**
 * Pending choices and approvals across all imported agents.
 *
 * This intentionally does not call `workspaceView`: the global inbox has no
 * reason to read command audit rows, tasks, memory or connections for every
 * agent. It asks for exactly the document it renders.
 */
export function workInboxView(now: Date = new Date()): WorkInboxView {
  const items = listAgentNames().flatMap((agent) => {
    const manifest = readAgentManifest(agent);
    const stored = readAgentDomState(agent);
    if (manifest === null || stored === null) {
      return [];
    }
    const workspaceManifest = manifest as WorkspaceManifest;
    const title = workspaceManifest.agent.display_name ?? workspaceManifest.agent.name;
    return buildWorkInbox(workspaceManifest, stored.state, now).map((item) => ({
      ...item,
      agent,
      agent_title: title,
      observed_at: stored.observed_at,
    }));
  });

  return {
    items: items.sort(
      (a, b) =>
        a.expires_at.localeCompare(b.expires_at) ||
        a.agent.localeCompare(b.agent) ||
        a.id.localeCompare(b.id),
    ),
  };
}
