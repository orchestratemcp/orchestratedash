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
import { brokeredField, requestedOperations } from "../broker/grant";
import { operationById, type BrokerOperation } from "../broker/operations";
import { describeClientOwner, describeCustody, describeDashClosedWindow } from "../broker/providers";
import { listReceipts, readBrokerAudit, readBrokerLapses, type BrokerLapse } from "../broker/store";
import { describeBrokerRefusal } from "../copy/recovery";
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
  artifactRecordsForRun,
  latestArtifactForAgent,
  listAgents,
  listAgentNames,
  listConnectionCapableAgents,
  readAgentManifest,
  resolveArtifactAvailability,
  readStore,
  type StoreShape,
} from "../store";
import { buildArtifactCards, type ArtifactCardView } from "./artifacts";
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
  BrokerCapabilityView,
  BrokerLapseView,
  BrokerRowView,
  ConnectionsView,
  PlannedStepView,
  RunView,
  RunsView,
  StalledAgentRow,
  WorkInboxRow,
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
  const artifactRecords = artifactRecordsForRun(agent, runId);
  const artifacts = artifactRecords.map((record) => record.artifact);
  const availabilityForArtifact = resolveArtifactAvailability(agent, runId);

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
    /*
     * The same artifacts, dressed for the Outputs panel (MAR-434).
     *
     * `artifacts` stays because `electron/smoke.ts` reads it as proof 6k — the
     * installed check that a digest reached the run detail page — and a release
     * gate must not be broken to tidy a field away. The two share the same
     * artifact objects in memory; only a serialised view pays for both, which
     * is a local channel and a price worth one working blocking proof.
     *
     * Availability now asks the real producer: `resolveArtifactAvailability`
     * reads `workspace_artifacts`, which `runner/workspace.ts` (MAR-434's
     * protected-workspace half) populates. See `lib/views/artifacts.ts` for why
     * an artifact `resolveArtifactAvailability` has never heard of still reads
     * `available`.
     */
    artifact_cards: buildArtifactCards(artifactRecords, (record) =>
      availabilityForArtifact(record.artifact.artifact_id),
    ),
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
      // MAR-458: an OAuth target is never delivered, whatever its manifest
      // named. This used to be `environment_name !== null` alone, which was the
      // same answer until the broker existed and is now a claim about the agent's
      // environment that would not be true.
      deliverable: target.kind === "secret" && target.environment_name !== null,
      kind: target.kind,
    });
  }

  return status;
}

/** How many brokered calls one connection row shows. A screen, not an export. */
const BROKER_HISTORY_LIMIT = 20;

/**
 * The agent's own name for itself, for recovery copy that addresses it by name.
 *
 * Falls back to the id, which is the honest degradation: a sentence reading
 * "ai-news-scout asked to do something it is not allowed to do" is worse than
 * one naming a display name and much better than one naming nothing.
 */
function displayNameOf(manifest: ConnectionSourceManifest, fallback: string): string {
  const agent = (manifest as { agent?: { display_name?: unknown; name?: unknown } }).agent;
  const display = agent?.display_name ?? agent?.name;
  return typeof display === "string" && display.length > 0 ? display : fallback;
}

/**
 * The permission card for one connection row (MAR-458, ADR 0002 invariant 4).
 *
 * Null for anything DASH does not broker, which is the honest absence: a typed
 * secret is handed to the agent, and a card describing narrow operations for one
 * would be describing a boundary that is not there.
 *
 * Everything comes from the manifest or the store, and nothing from the vault —
 * `heldCredentials` makes the same choice for the same reason, and the
 * consequence is that this card shows the *receipt* of the grant rather than a
 * live re-resolution of it. That is the right trade for a render: the live
 * resolution happens per brokered call, in `lib/broker/execute.ts`, so a stale
 * card can only ever show a user out-of-date wording and can never grant
 * anything.
 */
function brokerCard(
  agentName: string,
  displayName: string,
  manifest: ConnectionSourceManifest,
  connectionId: string,
  receipts: ReturnType<typeof listReceipts>,
  audit: ReturnType<typeof readBrokerAudit>,
): BrokerRowView | null {
  const field = brokeredField(manifest, connectionId);
  if (!field.ok) {
    return null;
  }
  const { profile } = field.field;

  const describe = (id: string): BrokerCapabilityView => {
    const operation = operationById(id);
    return operation === null
      ? // A receipt naming an operation this build no longer has. Said plainly
        // rather than dropped: an approval the user gave for something DASH has
        // since removed is a fact about their account worth showing.
        {
          id,
          label: "An action this version of DASH no longer offers",
          access: "read",
          consequence: null,
        }
      : {
          id: operation.id,
          label: operation.label,
          access: operation.access,
          consequence: operation.access === "write" ? operation.consequence : null,
        };
  };

  const receipt = receipts.find((entry) => entry.connection_id === connectionId) ?? null;
  const rows = audit.filter((entry) => entry.connection_id === connectionId);
  const requested = requestedOperations(manifest, connectionId);

  return {
    custody_sentence: describeCustody(profile),
    client_sentence: describeClientOwner(profile),
    // From what the manifest *asks for*, not from what has been granted
    // (MAR-469). A user reading this card before they sign in is the one who
    // most needs to know that the permission behind the draft action also allows
    // sending, because they are the one who has not granted it yet.
    wider_permission_sentence: widerPermissionSentence(requested),
    // Same before-the-grant reasoning, for time rather than breadth (MAR-482):
    // an agent that runs around the clock can use this connection only while
    // DASH is open, and the person deciding whether to connect is the one who
    // needs that said. Gated on the manifest's own claim to keep running,
    // because for an agent that stops with DASH the warning would describe a
    // window in which the agent does not exist.
    dash_closed_sentence: survivesDashClosing(manifest) ? describeDashClosedWindow(profile) : null,
    requested: requested.map((operation) => ({
      id: operation.id,
      label: operation.label,
      access: operation.access,
      consequence: operation.access === "write" ? operation.consequence : null,
    })),
    receipt:
      receipt === null
        ? null
        : {
            account_hint: receipt.account_hint,
            granted_at: receipt.granted_at,
            last_used_at: receipt.last_used_at,
            capabilities: receipt.operations.map(describe),
          },
    recent: rows.slice(0, BROKER_HISTORY_LIMIT).map((entry) => ({
      label: describe(entry.operation).label,
      decision: entry.decision,
      refusal_headline:
        entry.refusal === null
          ? null
          : describeBrokerRefusal(entry.refusal, { service: profile.label, agent: displayName })
              .headline,
      result_count: entry.result_count,
      decided_at: entry.decided_at,
      // `=== false` and not a truthiness test: null means DASH never found out,
      // which is the ordinary state of almost every row, and rendering a warning
      // on it would put a caution on the entire history (MAR-467).
      undelivered: entry.delivered === false,
    })),
  };
}

/**
 * The wider-permission disclosure for a set of operations, or null (MAR-469).
 *
 * Deduplicated and joined, so two writes on one scope say the uncomfortable
 * thing once. `lib/broker/grant.ts` does the same for the card built from a
 * resolved grant; this one is built from the manifest, because the card renders
 * before a sign-in and there is no grant yet.
 */
function widerPermissionSentence(operations: readonly BrokerOperation[]): string | null {
  const sentences: string[] = [];
  for (const operation of operations) {
    if (operation.access !== "write" || operation.wider_permission === null) {
      continue;
    }
    if (!sentences.includes(operation.wider_permission)) {
      sentences.push(operation.wider_permission);
    }
  }
  return sentences.length === 0 ? null : sentences.join(" ");
}

/** How many lapses one agent shows. A notice, not a log viewer. */
const BROKER_LAPSE_LIMIT = 5;

/**
 * Does this agent keep running while DASH is closed?
 *
 * Absent or malformed reads as `false`, which is the safe direction here: a
 * `dash_closed` window is only worth showing a user for an agent that could
 * plausibly have been asking during it, and claiming one for an agent that stops
 * with DASH would be a warning about something that cannot have happened.
 */
function survivesDashClosing(manifest: ConnectionSourceManifest): boolean {
  const runtime = (
    manifest as { agent_dom?: { runtime?: { continues_when_dash_closed?: unknown } } }
  ).agent_dom?.runtime;
  return runtime?.continues_when_dash_closed === true;
}

/**
 * The lapses worth showing beside one agent's connection cards (MAR-467).
 *
 * This is where a stored fact becomes a statement, and the two kinds become
 * statements in different ways. A drop is reported nearly as stored — the runner
 * observed it and counted it. A closed window is stored globally, with no agent
 * on it, and is *derived* into relevance here by asking whether this particular
 * agent keeps running while DASH does not. ADR 0005 explains why that derivation
 * lives at render time: the answer changes when a manifest changes, and a stored
 * answer would go on asserting yesterday's.
 *
 * Every sentence is written to survive the question "how do you know?". Neither
 * one says an agent asked for anything, because in neither case did DASH see a
 * request.
 */
function lapseViews(agent: string, manifest: ConnectionSourceManifest): BrokerLapseView[] {
  const survives = survivesDashClosing(manifest);
  const relevant = readBrokerLapses(agent, BROKER_LAPSE_LIMIT * 4).filter(
    (lapse: BrokerLapse) => lapse.kind !== "dash_closed" || survives,
  );

  return relevant.slice(0, BROKER_LAPSE_LIMIT).map((lapse) => {
    if (lapse.kind === "dropped_by_runner") {
      const attempts = lapse.attempts ?? 0;
      return {
        kind: "dropped_by_runner" as const,
        sentence:
          `${attempts === 1 ? "One request" : `${String(attempts)} requests`} from this agent ` +
          `${attempts === 1 ? "was" : "were"} discarded before DASH saw ` +
          `${attempts === 1 ? "it" : "them"}, because too many arrived at once.`,
        // The limit of what was observed, stated next to the observation rather
        // than left for a user to discover by looking for rows that are not
        // there.
        qualifier:
          "These are not in the history above and cannot be: DASH never received them, " +
          "so it made no decision about them and does not know what they asked for.",
        from_at: lapse.from_at,
        until_at: lapse.until_at,
      };
    }

    return {
      kind: "dash_closed" as const,
      sentence:
        "DASH was closed for this period, and this agent keeps running while DASH is closed. " +
        "The permission broker runs inside DASH, so nothing was there to answer it.",
      qualifier:
        "DASH has no record of whether this agent asked for anything during that time, and cannot have one.",
      from_at: lapse.from_at,
      until_at: lapse.until_at,
    };
  });
}

export function connectionsView(store: StoreShape = readStore()): ConnectionsView {
  return {
    agents: listConnectionCapableAgents(store).map(({ name, manifest }) => {
      const status = credentialStatus(name, manifest);
      // Read once per agent rather than once per row: both are indexed by agent
      // and a row-level read would be one query per connection on every render.
      const receipts = listReceipts(name);
      const audit = readBrokerAudit(name, BROKER_HISTORY_LIMIT * 4);
      const displayName = displayNameOf(manifest, name);

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
            broker: brokerCard(name, displayName, manifest, row.connection_id, receipts, audit),
          };
        }),
        lapses: lapseViews(name, manifest),
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

  /*
   * Everything that run produced, not only the newest thing it produced.
   *
   * `latest_digest` is one artifact, and the workspace rendered exactly it —
   * the same defect MAR-434 found on the run detail page, where an agent that
   * writes a digest *and* a reply had half its work invisible with nothing on
   * screen to say so. The run id comes from the digest rather than from the
   * snapshot because the snapshot is the agent's own account of itself and is
   * null whenever the agent is stopped, while DASH's record of what it made
   * outlives the process. That is the same argument `latest_digest` is a
   * sibling of `snapshot` for.
   *
   * The availability producer is `resolveArtifactAvailability`, which is the
   * one production already passes on the run detail page. Building a second
   * resolver here is how the two surfaces would come to disagree about whether
   * a person's file is still there.
   */
  const outputsRunId = digest?.run_id ?? null;
  let outputs: ArtifactCardView[] = [];
  if (outputsRunId !== null) {
    // Resolved once for the run, not once per record: it reads the whole
    // workspace index for that run and returns a lookup, so calling it inside
    // the map would query the store once per output.
    const availabilityForArtifact = resolveArtifactAvailability(agent, outputsRunId);
    outputs = buildArtifactCards(artifactRecordsForRun(agent, outputsRunId), (record) =>
      availabilityForArtifact(record.artifact.artifact_id),
    );
  }

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
    outputs,
    outputs_run_id: outputsRunId,
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
  const items: WorkInboxRow[] = [];
  const stalled: StalledAgentRow[] = [];

  for (const agent of listAgentNames()) {
    const manifest = readAgentManifest(agent);
    const stored = readAgentDomState(agent);
    if (manifest === null || stored === null) {
      continue;
    }
    const workspaceManifest = manifest as WorkspaceManifest;
    const title = workspaceManifest.agent.display_name ?? workspaceManifest.agent.name;

    items.push(
      ...buildWorkInbox(workspaceManifest, stored.state, now).map((item) => ({
        ...item,
        agent,
        agent_title: title,
        observed_at: stored.observed_at,
      })),
    );

    // The overview is already the single place `stalled` is derived (MAR-441);
    // recomputing that logic here would be a second copy to keep in sync.
    const overview = buildOverview(workspaceManifest, stored.state, now);
    if (overview.status === "stalled") {
      stalled.push({
        agent,
        agent_title: title,
        last_activity_at: overview.last_activity_at,
        // Non-null: `describeNextAction` always names one for `stalled`.
        next_action: overview.next_action ?? "Check why this agent hasn't run when scheduled",
      });
    }
  }

  return {
    items: items.sort(
      (a, b) =>
        a.expires_at.localeCompare(b.expires_at) ||
        a.agent.localeCompare(b.agent) ||
        a.id.localeCompare(b.id),
    ),
    // Longest-silent first: the agent that has been quiet longest is the one
    // most worth looking at. An agent with no activity timestamp at all sorts
    // last rather than first — there is no evidence it has ever been overdue.
    stalled: stalled.sort((a, b) => {
      if (a.last_activity_at === null) return 1;
      if (b.last_activity_at === null) return -1;
      return a.last_activity_at.localeCompare(b.last_activity_at) || a.agent.localeCompare(b.agent);
    }),
  };
}
