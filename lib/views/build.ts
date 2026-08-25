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

import { existsSync } from "node:fs";

import { analyzeGrounding } from "../analyze";
import { isBriefArtifact, isDigestArtifact } from "../contracts";
import type { DigestArtifact } from "../contracts";
import type { RunArtifactRecord } from "../store";
import { resolveBriefCitations } from "../brief/fingerprint";
import type { BriefCitations } from "../brief/citations";
import type { ManifestPermissions, PermissionGrant } from "../contracts";
import { brokeredField, requestedOperations, unrequestedOperations } from "../broker/grant";
import {
  hasFrozenPath,
  isSpendOperation,
  operationById,
  type BrokerOperation,
} from "../broker/operations";
import { describeClientOwner, describeCustody, describeDashClosedWindow } from "../broker/providers";
import { SPEND_ALLOWANCE_MS } from "../broker/spend-allowance";
import { listReceipts, readBrokerAudit, readBrokerLapses, type BrokerLapse } from "../broker/store";
import { describeRunSpend } from "../copy/curation";
import { describeBrokerRefusal } from "../copy/recovery";
import { agentDisplayName } from "../copy/agent-name";
import { heldCredentials } from "../connection-actions";
import { connectableFields, type CredentialKind } from "../connection-credentials";
import { describeEvidenceRecord } from "../copy/evidence";
import { describeRunOrigin } from "../copy/where-it-ran";
import { describeStoreDamage } from "../copy/recovery";
import { deriveConnectionRequirements, type ConnectionSourceManifest } from "../connections";
import {
  describeFleetDefault,
  describeLevelModelRow,
  describeLevelModels,
} from "../ai/model-choice";
import { DEFAULT_MODEL_LEVELS, levelLabel, levelMeaning } from "../ai/model-levels";
import { readFleetLevelModels, readFleetModelDefault } from "../ai/model-store";
import { decisionsView } from "./decisions";
import { fleetCatalogue } from "../fleet/catalogue";
import { describeFleetReach, fleetReach } from "../fleet/grants";
import {
  assignedFleetConnection,
  listFleetConnections,
  readFleetConnection,
  withheldAgents,
} from "../fleet/store";
import { describePermissions, oauthProviderById } from "../oauth/providers";
import { sameHostIdentity } from "../hosts";
import {
  readAgentDomState,
  readCommandAudit,
} from "../agent-dom/store";
import { readStandingAnswers } from "../agent-dom/standing-answers";
import { readAgentSchedule, readScheduleRuns, readScheduleSpend } from "../schedule/store";
import { buildAgentScheduleView } from "./agent-schedule";
import { dataDir } from "../db";
/* MAR-697. The exports folder and the two words DASH puts around a file in it.
   `listAgentExports` reaches `node:fs`, which is ordinary here — this module
   already reads the agent folder off disk through `inspectAgentFolderStanding`
   below. */
import { listAgentExports } from "../agent-exports";
import { describeReceiptMoment, describeRecordSize } from "../copy/artifacts";
import {
  analysisForRun,
  complianceForAgent,
  eventsForRun,
  listAnalyzedRuns,
} from "../insights";
import { listRegistrations, readRegistration, type ManagedRegistration } from "../registration";
import {
  MANIFEST_ONLY_DEPLOY_REFUSAL,
  UNREADABLE_FOLDER_DEPLOY_REFUSAL,
  agentFolderPath,
  inspectAgentFolderStanding,
  storedDigestSummary,
} from "../agent-folders";
import { assessConnectionTravel } from "../deploy/connection-travel";
import { plainDay } from "../copy/when";
import { payloadBody, pendingObservations } from "../lab/observation";
import { ingestUrl } from "../lab/send";
import { describeEndpointReach, describeLabTelemetryStanding } from "../lab/settings";
import { describeChiefDiscordStanding } from "../chief/discord";
import { describeNotificationState } from "../notify/settings";
import { describeManifestGap } from "../sample-refresh";
import { glanceReader } from "./glance";
import { buildAgentAsk } from "./ask";
import { chiefRoomView } from "./chief";
import {
  buildAgentModelSettings,
  buildRunModel,
  stepLevelLabel,
  type ModelSourceManifest,
} from "./models";
import {
  artifactRecordsForAgent,
  artifactRecordsForRun,
  latestArtifactForAgent,
  listAgents,
  listAgentNames,
  listConnectionCapableAgents,
  listRuns,
  readAgentAvatar,
  readAgentDeploys,
  readAgentFavourites,
  readHostDeploys,
  readHostKeyPlacements,
  readAgentManifest,
  readEvidencePulls,
  readHost,
  listLabSends,
  readLabSentKeys,
  readLabTelemetrySettings,
  readChiefDiscordSettings,
  readNotificationSettings,
  resolveArtifactAvailability,
  readStore,
  type ArtifactAvailability,
  type EvidencePullRecord,
  type StoreShape,
} from "../store";
import { describeAgentPlan } from "../agent-plan";
import { buildAgentFeed, buildAgentTelemetry } from "./agent-feed";
import { buildRunProgress } from "./run-progress";
import { buildAgentHealth } from "./agent-health-build";
import { buildArtifactCards, type ArtifactCardView } from "./artifacts";
import { buildInputRoles } from "./inputs";
import { buildPanelView, type PanelDashFacts, type PanelView } from "./panel";
import {
  availableControls,
  buildOverview,
  buildWorkInbox,
  type AgentDomState,
  type WorkspaceManifest,
} from "../workspace";
import type {
  AgentDeployTarget,
  AgentHostedOnView,
  AgentDeployView,
  AgentModelSettingsView,
  AgentOriginView,
  AgentRow,
  AgentsView,
  BrokerCapabilityView,
  BrokerLapseView,
  BrokerRowView,
  ConnectionRowWithCredential,
  ConnectionsView,
  FleetConnectorView,
  FleetLevelModelsView,
  FleetModelDefaultView,
  HostsView,
  KeyOfferView,
  PlacedKeyView,
  LabTelemetryView,
  NotificationsView,
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
 * Whether DASH holds enough of this agent to send it to a server (MAR-577).
 *
 * The same three-way answer `produceAgentFolderBundle` opens with, projected for
 * a renderer rather than acted on. Only `complete` is deployable: a migrated
 * agent has its author's document and no program, and the refusal for that is
 * MAR-553's own sentence, unchanged, because it is the one the trusted side will
 * give back if a page ignores this and presses anyway.
 *
 * Never throws. `inspectAgentFolderStanding` refuses an agent name that cannot
 * be a folder component — a legacy row is allowed to be one — and a view that
 * threw there would take the whole agents list down over a row that simply
 * cannot be deployed. That is the answer either way, so it is the answer given.
 *
 * `manifest` is passed in rather than read here (MAR-591). Both callers already
 * hold one — `workspaceView` from `readAgentManifest`, `agentsView` from the
 * store row it is already iterating — and a read inside this function would open
 * a file per row on a list that redraws while an agent runs.
 */
export function agentDeployStanding(
  agent: string,
  manifest: ConnectionSourceManifest | null = null,
): AgentDeployView {
  // MAR-591, corrected by MAR-626. Assessed for every standing, including the
  // ones that refuse for another reason: a person looking at a migrated agent
  // is entitled to the same account of what would not travel, and computing it
  // only on the deployable path would make the sentence appear when the folder
  // was fixed rather than when it was true.
  //
  // `heldCredentials` reads `connection_secrets`, never the vault — the same
  // "is it there" read `credentialStatus` below already does for this agent —
  // so this costs one more small-table lookup per row, not an OS unlock prompt.
  const travel = assessConnectionTravel(agent, manifest, heldCredentials(agent));

  let standing: ReturnType<typeof inspectAgentFolderStanding>;
  try {
    standing = inspectAgentFolderStanding(dataDir, agent);
  } catch {
    return { deployable: false, refusal: UNREADABLE_FOLDER_DEPLOY_REFUSAL, travel };
  }
  switch (standing.kind) {
    case "complete":
      return { deployable: true, refusal: null, travel };
    case "manifest_only":
      return { deployable: false, refusal: MANIFEST_ONLY_DEPLOY_REFUSAL, travel };
    case "unreadable":
      return { deployable: false, refusal: UNREADABLE_FOLDER_DEPLOY_REFUSAL, travel };
  }
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
  // MAR-586. Reads the looks table and the run list once for the whole fleet,
  // then answers per card — see `glanceReader` for why those two in particular
  // must not be asked per agent.
  const glanceFor = glanceReader(store, { connectionRows: connectionRowsFor });
  // MAR-639. One pass over the same run list `live` already walked, rather
  // than a second `listRuns(store)` — `glanceReader`'s own reason for reading
  // the looks table and the run list once for the whole fleet rather than
  // once per card. `listRuns` is newest first, so the first entry per agent
  // is its last run — `lib/views/glance.ts`'s own comment for its `lastRun`
  // map, read again here because that map is private to `glanceReader`.
  const live = new Set<string>();
  const lastRunAt = new Map<string, string>();
  for (const run of listRuns(store)) {
    if (run.status === "running") {
      live.add(run.agent);
    }
    if (!lastRunAt.has(run.agent)) {
      lastRunAt.set(run.agent, run.started_at);
    }
  }
  // MAR-640. One read of the whole starred set, `live`'s own reason: the
  // fleet page draws every card, so one statement beats one per row.
  const favourites = readAgentFavourites();

  const agents: AgentRow[] = listAgents(store).map((agent) => ({
      name: agent.name,
      // MAR-589. Straight from the summary for `avatar`'s own reason below: one
      // stored precedence, read once, rather than every surface deriving its
      // own and disagreeing with the one that just handled a rename.
      title: agent.title,
      goal: agent.goal,
      // MAR-648. What the author declared this agent does, for the chief to
      // route on. Off the manifest the store row already holds — `deploy` below
      // reads the same document, and the fleet list must not open a file per
      // card to answer a question about a plan it is already holding.
      capabilities: ((store.agents[agent.name]?.manifest?.planned_route ?? []) as
        readonly { component_id?: unknown }[]).flatMap((entry) =>
        typeof entry.component_id === "string" ? [entry.component_id] : [],
      ),
      plan_source: agent.plan_source,
      build_target: agent.build_target,
      planned_steps: agent.planned_steps,
      automation_clearance: agent.automation_clearance,
      run_count: agent.run_count,
      // MAR-639. Newest `started_at` DASH has an event for, or null for an
      // agent that has never run — the same map `running` below reads.
      last_run_at: lastRunAt.get(agent.name) ?? null,
      origin: agentOrigin(registrations.get(agent.name)),
      compliance: complianceForAgent(agent.name, store),
      // MAR-501. Straight from the summary, which took it straight from the
      // column. Three surfaces draw this agent now and they must draw the same
      // character; the way to guarantee that is for all three to be reading one
      // stored value rather than each deriving its own.
      avatar: agent.avatar,
      // MAR-577. One folder inspection per row, beside the registration read
      // this function already does per row. It is what lets the Servers page's
      // deploy panel say which of these agents it could actually send.
      //
      // MAR-591. The manifest comes from the store row rather than from
      // `readAgentManifest`, which is `glanceFacts`' own source for the same
      // document one function along — the fleet list must not open a file per
      // card to answer a question about connections it already holds.
      deploy: agentDeployStanding(
        agent.name,
        (store.agents[agent.name]?.manifest ?? null) as ConnectionSourceManifest | null,
      ),
      // MAR-586. The four questions a card answers at a glance, already worded.
      // Composed here rather than in the page for `damage`'s reason directly
      // below: both hosts must hand the renderer the same sentences.
      glance: glanceFor(agent.name),
      // A run in flight, from events (`RunStatus === "running"`). On the row so
      // a fleet card can mark Working without opening the runs view. MAR-544
      // already reads this fact for the strip; the card now reads it too.
      running: live.has(agent.name),
      // MAR-606. Where DASH has put this agent, from DASH's own record of doing
      // it. One more read of a small table per row, beside the registration and
      // folder reads this function already does per row — and, like them, it
      // asks no server anything. See `AgentRow.hosted_on` for why this reverses
      // `deploy_targets`'s deliberate absence from this view.
      hosted_on: agentHostedOn(agent.name),
      // MAR-640. The reader's own record, never the agent's — see
      // `AgentRow.favourite`.
      favourite: favourites.has(agent.name),
    }));

  return {
    agents,
    // Composed here rather than in the page, so both hosts hand the renderer the
    // same sentence — the property this module exists to keep.
    damage: describeStoreDamage(store.unreadable),
    /*
     * MAR-659, ADR 0023. The chief's room, built from the rows above rather
     * than from a second read of the store.
     *
     * That is not a saving, it is a correctness property: `chiefRoomView` marks
     * a stored turn stale by comparing its frozen receipt against the fleet as
     * it is now, and "as it is now" has to mean the same fleet the cards on the
     * same screen are drawn from. Two reads a frame apart could mark a turn
     * against a state the page never displays.
     */
    chief: chiefRoomView(agents),
    // MAR-673, ADR 0024. The decisions log, on `chief`'s terms exactly: its
    // supersession and drift markers are computed against this same store
    // read, so a marker cannot disagree with the cards beside it.
    decisions: decisionsView(store, agents),
  };
}

/**
 * Every run DASH holds, and how complete that list is (MAR-488).
 *
 * `evidence` is composed here for the reason `damage` is: both hosts must hand
 * the renderer the same sentence, and a page that built its own would be a
 * second place for the claim to be softened. It is normally null — the honest
 * default, when the only source is the runner on this machine and nothing was
 * lost — and `lib/copy/evidence.ts` owns exactly when it stops being.
 *
 * `pulls` is a parameter with a production default, the pattern
 * `resolveArtifactAvailability` established: production passes the producer, and
 * a test drives the states without a runner. It is read separately from `store`
 * rather than folded into `StoreShape` because it is not a projection of any
 * agent's work — it is DASH's record of its own reading, and the two are kept
 * apart in the data model as well as in the copy.
 */
export function runsView(
  store: StoreShape = readStore(),
  pulls: readonly EvidencePullRecord[] = readEvidencePulls(),
): RunsView {
  return {
    // MAR-583. The model setting each run started under, folded on here rather
    // than inside `listAnalyzedRuns`: that function is `lib/insights.ts`'s and
    // works on the store alone, while this needs the manifest to know whether a
    // model was ever part of the agent's work. See `buildRunModel` for the line.
    runs: listAnalyzedRuns(store).map((run) => ({
      ...run,
      model: buildRunModel(
        run.agent,
        run.run_id,
        store.agents[run.agent]?.manifest.planned_route,
        // The run's own events, filtered here rather than re-queried: `store`
        // already holds every event this list was derived from, and a second
        // read per row would turn one pass over the store into one per run.
        store.events.filter(
          (event) => event.agent === run.agent && event.run_id === run.run_id,
        ),
      ),
    })),
    evidence: describeEvidenceRecord(pulls),
    // MAR-602, ADR 0014. From the same `pulls` and never from `agent_deploys`:
    // a deploy row is evidence DASH sent bytes on a date, and reading a run's
    // machine out of one would be exactly the present-tense inference ADR 0010
    // exists to prevent.
    origin: describeRunOrigin(pulls),
  };
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
      // MAR-583. Null for a step that needs no model, which is the honest
      // absence the emitter writes rather than a fourth level meaning "none".
      model_level_label: stepLevelLabel(entry.default_model_level),
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
    // MAR-583. The same record the runs list carries, on the page with room for
    // the caveat that makes it honest. `events` is this run's own, already read
    // above — and it is where `model` comes from, the telemetry v1 field nothing
    // in DASH had ever drawn.
    model: buildRunModel(agent, runId, manifest?.planned_route, events),
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
    artifact_cards: buildArtifactCards(
      artifactRecords,
      (record) => availabilityForArtifact(record.artifact.artifact_id),
      citationResolverFor(artifactRecords),
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
  { field_id: string; masked_hint: string | null; deliverable: boolean; kind: CredentialKind }
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
      kind: CredentialKind;
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
 * MAR-589. Routed through `agentDisplayName` rather than reimplementing its
 * fallback — this was the third inline copy of `display_name ?? humanize(name)`
 * that MAR-609's consolidation missed. Manifest-only, not store-aware: a stored
 * rename is not threaded this deep, the same boundary `buildOverview`'s own
 * title draws in `lib/workspace.ts`, because nothing here is one of the label
 * surfaces the ruling named.
 */
function displayNameOf(manifest: ConnectionSourceManifest, fallback: string): string {
  const agent = (manifest as { agent?: { display_name?: unknown; name?: unknown } }).agent;
  const declared = agent?.display_name;
  return agentDisplayName({
    name: fallback,
    display_name: typeof declared === "string" ? declared : undefined,
  });
}

/**
 * The MAR-589 title for one fleet candidate: `agentDisplayName`'s answer, with
 * the stored rename column preferred over the manifest's own `display_name` —
 * the same precedence `connectionsView`'s own `agents` list applies three lines
 * below its call to this function, and the one every other title-bearing
 * surface applies (`AgentRow.title`, which is what the chief prints).
 *
 * MAR-690 found this precedence missing here specifically: a connector card's
 * "which agents reach this key" list was reading the manifest alone, so a
 * renamed (or, for an MCP-planned agent with no author-declared name, a
 * store-corrupted) agent showed one title on this list and a different one
 * everywhere else DASH names it — including the chief, which is the
 * `AgentRow.title` reader and therefore never disagreed with the rest of DASH
 * to begin with.
 *
 * `agentId` is `manifest.agent.name` in every caller — `listConnectionCapableAgents`
 * derives one from the other — so it is the correct fallback rather than a
 * second guess, and it means this never needs the manifest to have parsed
 * cleanly to produce a name a person can read.
 */
function fleetAgentTitle(
  agentId: string,
  manifest: ConnectionSourceManifest,
  storedDisplayName?: string | null,
): string {
  const agent = (manifest as { agent?: { display_name?: unknown } }).agent;
  const declared = typeof agent?.display_name === "string" ? agent.display_name : undefined;
  return agentDisplayName({ name: agentId, display_name: storedDisplayName ?? declared });
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
          consequence: hasFrozenPath(operation) ? operation.consequence : null,
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
      consequence: hasFrozenPath(operation) ? operation.consequence : null,
    })),
    // MAR-533. Everything DASH offers here that this agent did not ask for —
    // the third party in the grant, made visible. See `unrequestedOperations`.
    not_requested: unrequestedOperations(manifest, connectionId).map((operation) => ({
      id: operation.id,
      label: operation.label,
      access: operation.access,
      consequence: hasFrozenPath(operation) ? operation.consequence : null,
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
/**
 * @param brokered Whether this agent has any connection DASH actually stands in
 *   the middle of. See the `dash_closed` gate below.
 */
function lapseViews(
  agent: string,
  manifest: ConnectionSourceManifest,
  brokered: boolean,
): BrokerLapseView[] {
  /*
   * A `dash_closed` lapse says the permission broker was not running to answer
   * this agent's requests. Two things have to be true for that to mean anything,
   * and until MAR-533 only the first was checked.
   *
   * The second was found by photographing the rebuilt page: `ai-news-scout`
   * declares no connections at all, and its card read "there are 5 periods DASH
   * cannot account for" directly above "this agent asked to reach nothing
   * outside this computer". Both sentences were true and together they were
   * nonsense — DASH apologising for not having adjudicated requests that could
   * not have existed.
   *
   * `dropped_by_runner` is deliberately **not** gated the same way: those are
   * observations of requests that really were discarded, and an agent with no
   * declared connection that is somehow producing them is exactly the situation
   * nobody should be able to hide by tidying this list.
   */
  const survives = survivesDashClosing(manifest);
  const relevant = readBrokerLapses(agent, BROKER_LAPSE_LIMIT * 4).filter(
    (lapse: BrokerLapse) => lapse.kind !== "dash_closed" || (survives && brokered),
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

/**
 * Every saved server, oldest first, with the duplicates counted (MAR-574).
 *
 * The read the Servers page never had. `readStore()` has returned `hosts` since
 * MAR-536 and no view projected them, which is why a saved server could be in
 * the database and absent from the only page about servers.
 *
 * Two decisions are made here rather than in the page:
 *
 * **`key_name` is dropped.** It is the one field on a `HostRecord` that names a
 * credential on this computer, and a projection that carried it because it was
 * in the row would put it in a renderer's memory for no page to use. The rule
 * `AgentOriginView` states, applied where it has teeth.
 *
 * **The duplicate counting happens on the trusted side**, so both hosts get the
 * same numbers, and it counts rather than merges: those records are real and
 * each has its own key. See `lib/hosts.ts`'s `sameHostIdentity` for what makes
 * two rows one server, and `lib/server-card.ts` for what the page says about it.
 *
 * Oldest first, deliberately, and it is the choice `findDuplicateHost` makes for
 * the same reason: the record somebody has been using is the one they will
 * recognise, and a newest-first list would put four accidental retries above it.
 */
export function hostsView(store: StoreShape = readStore()): HostsView {
  const records = Object.values(store.hosts).sort(
    (one, other) =>
      one.added_at.localeCompare(other.added_at) || one.host_id.localeCompare(other.host_id),
  );

  return {
    servers: records.map((record) => {
      const sameServer = records.filter((other) => sameHostIdentity(other, record));
      return {
        host_id: record.host_id,
        label: record.label,
        address: record.address,
        username: record.username,
        port: record.port,
        added_at: record.added_at,
        fingerprint: record.host_fingerprint,
        // Derived from the same sorted list the page renders, so the position
        // a card claims and the position it has cannot drift apart.
        same_server_index: sameServer.indexOf(record) + 1,
        same_server_count: sameServer.length,
        /*
         * MAR-606. What DASH put here, out of DASH's own record of doing it.
         *
         * `readHostDeploys` returns newest-first already, and `plainDay` is
         * applied on this side for the reason every other date on a view is:
         * the renderer is handed the sentence's ingredient rather than a
         * timestamp to format, so both hosts say the date the same way.
         *
         * Note what is deliberately *not* joined in here. Nothing asks the
         * server anything — a view function runs on every read of this page,
         * and a probe per server on render is exactly the polling ADR 0015 and
         * the deploy panel's own copy both refuse. What the server said arrives
         * on the standing, when somebody presses Check.
         */
        // MAR-611, ADR 0017. Same filter as `agentDeployTargets`, on the same
        // table read from the other direction: a row DASH has brought home is
        // not a claim this server still holds a copy.
        sent: readHostDeploys(record.host_id)
          .filter((deploy) => deploy.brought_home_at === null)
          .map((deploy) => ({
            agent: deploy.agent,
            sent_at: deploy.sent_at,
            sent_on: plainDay(deploy.sent_at),
          })),
        ...keysOn(record.host_id, store),
      };
    }),
  };
}

/**
 * What a placed key is called when its agent no longer declares the connection.
 *
 * Never the id. A person reading a server card has never seen a connection id
 * and `lib/copy/identifiers.ts` forbids one on the guided path — and the id
 * would tell them nothing about the key anyway. What they need to know is that
 * something of theirs is on that machine, which is what this says, and the
 * orphan line beside it says what to do about it.
 */
const UNNAMED_PLACED_KEY = "A key you placed";

/**
 * What this server holds of yours, and what it could be given (MAR-794, ADR 0018).
 *
 * ## Two lists out of one join, because they are two halves of one question
 *
 * The placements are DASH's record; the offers are what the same three sources —
 * DASH's deploy record, the agent's document and `connection_secrets` — say
 * could still be sent. Built together so they cannot disagree about which slot
 * is already full: `already_placed` on an offer and the presence of a placement
 * are the same fact read twice, and reading it twice in two functions is how
 * a card comes to offer a first placement for a key it has just listed.
 *
 * ## Nothing here opens the vault, and nothing here asks the server
 *
 * `heldCredentials` reads `connection_secrets`, which records **where** a
 * credential is and never what it is — the same read every other consumer of it
 * on this page makes, and the reason a view function may make it at all.
 *
 * And no probe. A view runs on every read of this page, and a round trip per
 * server on render is the polling ADR 0015 refuses. Whether a placement has lost
 * the bundle it was placed for is therefore **not** decided here: it needs the
 * host's own account of what is installed, which arrives on the standing when
 * somebody presses Check. `standingForPlacements` is where the two are joined,
 * and it answers "nothing is orphaned" rather than "everything is" for a server
 * nobody has asked yet.
 */
function keysOn(
  hostId: string,
  store: StoreShape,
): { placed_keys: PlacedKeyView[]; key_offers: KeyOfferView[] } {
  const placements = readHostKeyPlacements(hostId);
  const placed = new Set(placements.map((one) => `${one.bundle_id} ${one.connection_id}`));

  /*
   * The friendly names, from each agent's own document. A connection the
   * document no longer declares resolves to nothing, and the id is used as the
   * last resort — which is the honest answer for a placement whose agent has
   * since been re-imported without that connection, and is exactly the state
   * the orphan line exists to make visible rather than pretty — so the fallback
   * is a plain phrase and never the id, which the guided-path copy rule forbids
   * on screen and which would tell a person nothing anyway.
   */
  const serviceOf = (agent: string, connectionId: string): string | null => {
    const manifest = store.agents[agent]?.manifest;
    if (manifest === undefined) {
      return null;
    }
    for (const target of connectableFields(agent, manifest)) {
      if (target.connection_id === connectionId) {
        return target.service;
      }
    }
    return null;
  };

  const here = readHostDeploys(hostId).filter((deploy) => deploy.brought_home_at === null);
  const offers: KeyOfferView[] = [];
  for (const deploy of here) {
    const manifest = store.agents[deploy.agent]?.manifest;
    if (manifest === undefined) {
      continue;
    }
    const held = new Set(
      heldCredentials(deploy.agent).map((one) => `${one.connection_id} ${one.field_id}`),
    );
    const seen = new Set<string>();
    for (const target of connectableFields(deploy.agent, manifest)) {
      if (target.kind !== "provider_key" || seen.has(target.connection_id)) {
        continue;
      }
      if (!held.has(`${target.connection_id} ${target.field_id}`)) {
        continue;
      }
      seen.add(target.connection_id);
      offers.push({
        agent: deploy.agent,
        connection_id: target.connection_id,
        service: target.service,
        need: target.purpose,
        already_placed: placed.has(`${deploy.agent} ${target.connection_id}`),
      });
    }
  }

  return {
    placed_keys: placements.map((one) => ({
      agent: one.bundle_id,
      connection_id: one.connection_id,
      service: serviceOf(one.bundle_id, one.connection_id) ?? UNNAMED_PLACED_KEY,
      placed_at: one.placed_at,
      placed_on: plainDay(one.placed_at),
    })),
    key_offers: offers,
  };
}

/**
 * Whether DASH is set up to post to Discord, and what it is posting (MAR-588).
 *
 * A projection of one row plus one sentence, and the sentence is why this is a
 * view function rather than a page reading the store shape directly: two hosts
 * build this document, and `describeNotificationState` is the one place the
 * wording of "what is DASH doing right now" is decided.
 *
 * **Nothing here opens the vault.** `readNotificationSettings` reads a masked
 * hint and two booleans out of SQLite; the address is never consulted. That
 * matters for the reason `BrokerRowView` gives about its own reads — a vault
 * read on a render would pop an OS unlock prompt at the moment somebody merely
 * looked at a settings page — and for the stronger one in `lib/views/types.ts`:
 * there is no field on the view it could travel in.
 */
export function notificationsView(): NotificationsView {
  const settings = readNotificationSettings();
  /*
   * MAR-743, ADR 0028. The second half of DASH's Discord, read on the same
   * render and under the same rule: a masked hint, two snowflakes and two
   * booleans out of SQLite, and the vault untouched. The bot token is not
   * consulted to answer "is this set up" — that would pop an OS unlock prompt at
   * the moment somebody merely looked at a settings page.
   */
  const chief = readChiefDiscordSettings();
  return {
    configured: settings.configured,
    masked_hint: settings.masked_hint,
    configured_at: settings.configured_at,
    send_approvals: settings.send_approvals,
    send_reports: settings.send_reports,
    state_sentence: describeNotificationState(settings),
    chief: {
      configured: chief.configured,
      enabled: chief.enabled,
      channel_id: chief.channel_id,
      allowed_user_id: chief.allowed_user_id,
      masked_hint: chief.masked_hint,
      configured_at: chief.configured_at,
      // Without the date: the page has `configured_at` and puts it through
      // `plainDay` itself, and a builder that resolved a day here would be a
      // second place a timestamp becomes prose.
      state_sentence: describeChiefDiscordStanding(chief, null).sentence,
      // Null here, always. This function is pure and has no runner to ask —
      // MAR-745's live fact is filled in at the read seam in
      // `electron/main.ts`, the only place that holds a runner handle.
      runner_holds: null,
    },
  };
}

/**
 * Whether DASH tells a LAB anything, what it would tell one, and what it has
 * (MAR-479, ADR 0026).
 *
 * **Nothing here opens the vault**, `notificationsView`' rule and its two
 * reasons — an unlock prompt on a render, and there being no field on the view a
 * token could travel in. The preview is composed from stored manifests and the
 * receipts are stored rows; neither needs the credential.
 *
 * **The preview runs on a DASH that has not opted in, deliberately.** That is
 * the whole of MAR-479's *before* half: a person has to be able to read exactly
 * what would be sent while the answer to "is it sending?" is still no. So this
 * builder branches on nothing — it always composes the payload, and `enabled`
 * is a field on the result rather than a gate in front of it.
 *
 * `payloadBody` is the single composer shared with `sendPending`, which is what
 * makes the preview and the bytes that would actually go the same string rather
 * than two renderings that could drift.
 */
export function labTelemetryView(): LabTelemetryView {
  const settings = readLabTelemetrySettings();
  const observations = pendingObservations(readStore(), readLabSentKeys());
  const standing = describeLabTelemetryStanding(
    settings,
    settings.configured_at === null ? null : plainDay(settings.configured_at),
  );

  return {
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    ingest_url: ingestUrl(settings.endpoint),
    masked_hint: settings.masked_hint,
    configured_at: settings.configured_at,
    standing_chip: standing.chip,
    standing_on: standing.on,
    standing_sentence: standing.sentence,
    reach_sentence: describeEndpointReach(settings.endpoint),
    preview_body: payloadBody(observations),
    preview_count: observations.length,
    sends: listLabSends().map((send) => ({
      id: send.id,
      sent_on: plainDay(send.sent_at) ?? send.sent_at,
      endpoint: send.endpoint,
      body: send.body,
      outcome: send.outcome,
      // Only a fully-accepted batch is the good state. A 207 took *some*, and a
      // row coloured as success would be the page rounding a partial answer up
      // — the one direction this feature must never round in.
      ok: send.outcome === "accepted",
      status: send.status < 0 ? null : send.status,
      detail: send.detail,
      accepted: send.accepted,
    })),
  };
}

/**
 * One agent's connection checklist, with what DASH holds folded onto each row.
 *
 * Lifted out of `connectionsView` for MAR-586 rather than copied into it, and
 * the reason is the one `lib/connection-requirements.ts` opens with: these rows
 * are what MAR-569's resolution intersects against, and a second implementation
 * of them would be a second place for the four standings to collapse into three.
 * A fleet card that computed its own "not connected" count would eventually
 * disagree with the Connections page about the same agent, on the same store, in
 * the same window.
 *
 * The whole read is per agent, which is why it is one function: `credentialStatus`,
 * the receipts and the audit are each indexed by agent, and a caller that fetched
 * them per row would run one query per connection on every render.
 */
export function connectionRowsFor(
  name: string,
  manifest: ConnectionSourceManifest,
  /**
   * Which agents name each provider, for `also_connects` (MAR-570).
   *
   * A parameter rather than a read, because the answer is a fact *between*
   * agents and this function is given one. `connectionsView` builds it over
   * every connection-capable agent; a caller that has no such list passes
   * nothing and gets an empty array, which is why the field's own docblock says
   * empty means "no other agent needs this provider" only when a sharing map
   * was supplied — the glance reader does not render the sentence and does not
   * supply one.
   */
  sharing: ReadonlyMap<string, string[]> = new Map(),
): ConnectionRowWithCredential[] {
  const status = credentialStatus(name, manifest);
  const receipts = listReceipts(name);
  const audit = readBrokerAudit(name, BROKER_HISTORY_LIMIT * 4);
  const displayName = displayNameOf(manifest, name);

  return deriveConnectionRequirements(manifest).map((row) => {
    const credential = status.get(row.connection_id);
    return {
      ...row,
      dash_can_hold: credential !== undefined,
      field_id: credential?.field_id ?? null,
      masked_hint: credential?.masked_hint ?? null,
      delivered_to_agent: credential?.deliverable ?? false,
      credential_kind: credential?.kind ?? null,
      broker: brokerCard(name, displayName, manifest, row.connection_id, receipts, audit),
      // MAR-570. Everyone else who names this provider, so both surfaces that
      // draw a Connect button can say what pressing it reaches beyond the agent
      // on screen. Excludes this agent: the sentence is about the ones a person
      // is *not* looking at.
      also_connects: (sharing.get(row.provider) ?? []).filter((other) => other !== name),
    };
  });
}

export function connectionsView(store: StoreShape = readStore()): ConnectionsView {
  const capable = listConnectionCapableAgents(store);

  /*
   * Which agents name each provider (MAR-570).
   *
   * Built once over every capable agent rather than per row, and keyed on
   * `provider` rather than on a connection id: `google-gmail` is one
   * authorization server and one consent screen, while the ids beside it are
   * author-chosen strings that two manifests have no reason to agree on. This is
   * the same key `findGrantSharers` fans a grant out over, so the sentence a
   * person reads before signing in and the thing that then happens are computed
   * from one fact.
   */
  const agentsByProvider = new Map<string, string[]>();
  for (const { name, manifest } of capable) {
    for (const row of deriveConnectionRequirements(manifest)) {
      const named = agentsByProvider.get(row.provider) ?? [];
      if (!named.includes(name)) {
        named.push(name);
      }
      agentsByProvider.set(row.provider, named);
    }
  }

  // MAR-690. Same map `agents` below reads from, handed to the fleet cards so
  // their own per-agent title matches it.
  const storedDisplayNames = new Map(
    capable.map(({ name }) => [name, store.agents[name]?.display_name ?? null]),
  );
  const fleet = fleetConnectorViews(capable, storedDisplayNames);

  return {
    // MAR-593. What DASH can connect, computed from the catalogue and the fleet
    // tables rather than from any of the agents above — which is the whole point
    // of it, and why this line still produces cards on a store holding no agents
    // at all.
    fleet,
    // MAR-642. The default, counted against the cards above rather than against
    // the catalogue: the sentence for somebody holding no key at all sends them
    // to the section under it, and it should say that only while that section
    // really is empty.
    model_default: fleetModelDefaultView(fleet),
    // MAR-654. The other half of the same question, read by the same section.
    level_models: fleetLevelModelsView(fleet),
    agents: capable.map(({ name, manifest }) => {
      const rows = connectionRowsFor(name, manifest, agentsByProvider);

      return {
        name,
        // MAR-589. The stored rename outranks the manifest's own
        // `display_name` — `AgentRow.title`'s own precedence, so the
        // Connections page cannot name an agent differently from the fleet
        // card a person picked it from.
        title: agentDisplayName({
          name,
          display_name: store.agents[name]?.display_name ?? manifest.agent.display_name,
        }),
        // MAR-533, and read rather than derived for MAR-502's reason exactly —
        // see the note on `AgentConnections.avatar`.
        avatar: readAgentAvatar(name),
        rows,
        lapses: lapseViews(
          name,
          manifest,
          rows.some((row) => row.broker !== null),
        ),
      };
    }),
    older_agent_names: listAgents(store)
      .filter((agent) => agent.manifest_version === 1)
      .map((agent) => agent.name),
  };
}

/**
 * The fleet cards (MAR-593, ADR 0013).
 *
 * Every connector DASH offers, whether or not it is connected and whether or not
 * any agent has asked for it. A catalogue entry with nothing connected is not an
 * empty state to be filtered out — it is the thing a person came to this page to
 * do, and the page that hid it is the one this issue exists to replace.
 *
 * The reach is computed with `fleetReach` rather than restated, so the sentence
 * a person reads before they press and the list the press actually walks are one
 * fact. `capable` arrives already read: this runs inside `connectionsView`, which
 * has the manifests in hand, and re-reading them per connector would be a query
 * per card on every render.
 *
 * `storedDisplayNames` carries the rename column per agent (MAR-690), keyed the
 * same way `connectionsView`'s own `agents` list reads `store.agents[name]?.display_name`
 * three lines above its call here — so this list and that one, on the same
 * page, cannot title the same agent two different ways. Defaulted to empty
 * rather than made required: every existing caller before MAR-690 had no rename
 * to give it, and an empty map falls through `fleetAgentTitle` to the manifest
 * exactly as it always did.
 */
export function fleetConnectorViews(
  capable: ReadonlyArray<{ name: string; manifest: ConnectionSourceManifest }>,
  storedDisplayNames: ReadonlyMap<string, string | null> = new Map(),
): FleetConnectorView[] {
  const candidates = capable.map(({ name, manifest }) => ({
    agent_id: name,
    manifest,
  }));
  const titleByAgent = new Map(
    candidates.map((candidate) => [
      candidate.agent_id,
      fleetAgentTitle(candidate.agent_id, candidate.manifest, storedDisplayNames.get(candidate.agent_id)),
    ]),
  );

  return fleetCatalogue().map((connector) => {
    const stored = readFleetConnection(connector.provider);
    const storedAccounts = listFleetConnections(connector.provider);
    const reach = fleetReach(connector, candidates, withheldAgents(connector.provider));
    const flow =
      connector.oauth === null ? null : oauthProviderById(connector.oauth.provider_id);

    const agents = reach.materializes.map((one) => {
      const assigned = assignedFleetConnection(connector.provider, one.agent_id);
      return {
      agent: one.agent_id,
      title: titleByAgent.get(one.agent_id) ?? one.agent_id,
      // Whether this agent holds it *now*, from the same reference table
      // `credentialStatus` reads — never from the fleet row, which says what the
      // person gave DASH and not what reached each agent.
      connected: heldCredentials(one.agent_id).some(
        (entry) =>
          entry.connection_id === one.target.connection_id &&
          entry.field_id === one.target.field_id &&
          entry.masked_hint !== null &&
          (assigned === null || assigned.masked_hint === null || entry.masked_hint === assigned.masked_hint),
      ),
      account_id: assigned?.account_id ?? null,
    };});

    return {
      provider: connector.provider,
      service: connector.service,
      connector_kind: connector.connector_kind,
      // MAR-642. What sends this card to the AI tab or leaves it on
      // Connections. Straight off the catalogue entry, never re-derived.
      ai_provider_id: connector.ai_provider_id,
      purpose: connector.purpose,
      help: connector.help,
      capabilities: connector.capabilities.map((capability) => ({
        id: capability.id,
        label: capability.label,
        access: capability.access,
        consequence: capability.consequence,
      })),
      wider_permissions: connector.wider_permissions,
      held:
        stored === null
          ? null
          : {
              masked_hint: stored.masked_hint,
              account_hint: stored.account_hint,
              since: plainDay(stored.connected_at) ?? null,
              // DASH's own sentences for what the consent issued. Raw scopes are
              // forbidden on a guided surface by `lib/copy/identifiers.ts`, and
              // an empty list for a key is the true answer rather than a gap —
              // ADR 0002 amendment 5: there is nothing to intersect.
              permissions: flow === null ? [] : describePermissions(flow, stored.scopes),
              /*
               * False here, and filled in afterwards by
               * `withFleetSecretStandings` (MAR-676).
               *
               * This function reads SQLite and is synchronous, and a vault read is
               * neither. So the projection states the only thing it can actually
               * prove — nothing has looked — and the one step that follows the
               * row's `secret_name` into the vault runs after it, where a vault
               * exists.
               *
               * **False rather than true is the load-bearing half.** A default of
               * true would make every path that skips the decoration claim a
               * successful read it never made, which is the defect this field was
               * added for wearing a new costume. False makes a skipped decoration
               * surface as an honest chip nobody expected, instead of the cheerful
               * one everybody believed.
               */
              secret_readable: false,
              // No sentence, because nothing looked. The store's own name for the
              // credential vault is not a fact this function has.
              unreadable: null,
            },
      accounts: storedAccounts.map((account) => ({
        id: account.account_id,
        masked_hint: account.masked_hint,
        account_hint: account.account_hint,
        since: plainDay(account.connected_at) ?? null,
        permissions: flow === null ? [] : describePermissions(flow, account.scopes),
        is_default: account.is_default,
      })),
      agents,
      skipped: reach.skipped.map((one) => ({
        agent: one.agent_id,
        title: titleByAgent.get(one.agent_id) ?? one.agent_id,
        reason: one.reason,
      })),
      // Only meaningful once something is connected: with nothing held, every
      // qualifying agent is waiting for a connection rather than for a share,
      // and a card offering to hand out a credential DASH does not have would be
      // the dead button this codebase keeps closing vocabularies to prevent.
      waiting: stored === null ? [] : agents.filter((one) => !one.connected).map((one) => one.agent),
      reach_sentence: describeFleetReach(connector, reach),
    };
  });
}

/**
 * DASH's default model, ready to draw (MAR-642).
 *
 * A stored default naming a provider this build no longer offers reads as no
 * default — `readFleetModelDefault`'s rule — and this adds the second half of
 * it: a default whose provider is not among the cards on the page is not shown
 * as being in force either, because the person cannot see the thing it names.
 * Both are the same discipline `readLivenessCheck` keeps: a record this build
 * cannot interpret should read as the absence of a record.
 */
function fleetModelDefaultView(fleet: readonly FleetConnectorView[]): FleetModelDefaultView {
  const keys = fleet.filter((connector) => connector.ai_provider_id !== null);
  const held = keys.filter((connector) => connector.held !== null).length;
  const stored = readFleetModelDefault();
  const card =
    stored === null
      ? undefined
      : keys.find((connector) => connector.ai_provider_id === stored.provider_id);

  const copy = describeFleetDefault(
    card?.service ?? null,
    card === undefined ? null : stored?.model_id ?? null,
    held,
  );
  return {
    provider_id: card === undefined ? null : stored?.provider_id ?? null,
    model_id: card === undefined ? null : stored?.model_id ?? null,
    headline: copy.headline,
    detail: copy.detail,
    in_force: copy.in_force,
  };
}

/**
 * What each kind of step runs on, ready to draw (MAR-654, A1.6).
 *
 * One entry per provider DASH **holds a key for**, and three rows in each,
 * always. A level nobody has mapped is not a missing row: it is a row whose
 * sentence says what happens instead, which is the difference between a control
 * a person can predict and a gap they have to test.
 *
 * The default's model id reaches a row's sentence **only when the default names
 * that row's provider**, `applyFleetDefault`'s own check applied to the copy: a
 * sentence promising that unmapped OpenRouter steps fall back to an Anthropic
 * model would describe a fallback that cannot happen.
 *
 * Providers with no key are left out rather than drawn empty. A row is picked
 * from a catalogue a key returned, so a section offering rows for a service DASH
 * cannot ask would be three dropdowns with nothing to put in them — the call
 * `ModelDefault` already makes about its own picker, one section along.
 */
function fleetLevelModelsView(fleet: readonly FleetConnectorView[]): FleetLevelModelsView {
  const held = fleet.filter(
    (connector) => connector.ai_provider_id !== null && connector.held !== null,
  );
  const stored = readFleetModelDefault();
  const copy = describeLevelModels(held[0]?.service ?? null);

  return {
    headline: copy.headline,
    detail: copy.detail,
    in_force: copy.in_force,
    by_provider: held.map((connector) => {
      const providerId = String(connector.ai_provider_id);
      const mapped = readFleetLevelModels(providerId);
      const fallback = stored?.provider_id === providerId ? stored.model_id : null;
      return {
        provider_id: providerId,
        rows: DEFAULT_MODEL_LEVELS.map((level) => {
          const modelId = mapped.get(level)?.model_id ?? null;
          return {
            level,
            label: levelLabel(level),
            meaning: levelMeaning(level),
            model_id: modelId,
            in_force: describeLevelModelRow(modelId, fallback),
          };
        }),
      };
    }),
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
  store: StoreShape = readStore(),
): WorkspaceView {
  const manifest = readAgentManifest(agent);
  if (manifest === null) {
    return { found: false };
  }

  const workspaceManifest = manifest as WorkspaceManifest;
  const stored = readAgentDomState(agent);
  const digest = latestArtifactForAgent(agent);
  /*
   * Resolved once. Two consumers now ask this document different questions —
   * `buildPanelView` what it declares, `describeManifestGap` how old it is — and
   * `panelDocument` reads the folder off disk, so calling it twice would open
   * the same file twice per render of a page that already polls.
   */
  const document = panelDocument(agent, manifest);

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
  /*
   * MAR-609. Every output this agent has made, not every output of its newest
   * run.
   *
   * Henrik asked for *"a list of the latest outputs (if an news agent then the
   * latest digest/newsletter it made)"* and this page could not answer it. The
   * scope above was one run — `artifactRecordsForRun` against the digest's own
   * run — so a scout run on Monday and again on Tuesday showed only Tuesday, and
   * Monday's digest existed on this machine with no route to it from the
   * agent's own page. The person had to know the Runs list existed.
   *
   * `artifactRecordsForAgent` is not a new query and that is the point: the
   * author's panel has read the agent's whole artifact history through it since
   * MAR-548, so the two surfaces on this page were already scoped differently,
   * and the narrower one was DASH's own.
   *
   * **The availability resolver is per run and is memoised rather than
   * widened.** It reads the workspace index for one run and returns a lookup;
   * calling it inside the map would query the store once per output, and
   * building an agent-wide variant would be a second resolver free to disagree
   * with the run detail page about whether somebody's file is still there —
   * which is the exact duplication the note below this one warns off.
   */
  const availabilityByRun = new Map<string, (artifactId: string) => ArtifactAvailability>();
  /*
   * Hoisted out of the call, because two things now read it.
   *
   * It was inline while `buildArtifactCards` had one resolver; a second one
   * needs the same list to find each brief's digest in, and calling
   * `artifactRecordsForAgent` twice would be two queries that could disagree
   * about what this agent has produced — the duplication the availability note
   * above this one warns off, one argument along.
   */
  const agentRecords = artifactRecordsForAgent(agent);
  const outputs: ArtifactCardView[] = buildArtifactCards(
    agentRecords,
    (record) => {
      const runId = record.artifact.run_id;
      let resolve = availabilityByRun.get(runId);
      if (resolve === undefined) {
        resolve = resolveArtifactAvailability(agent, runId);
        availabilityByRun.set(runId, resolve);
      }
      return resolve(record.artifact.artifact_id);
    },
    citationResolverFor(agentRecords),
  );

  /*
   * MAR-583's settings, taken once (MAR-619).
   *
   * Two fields read it now — the picker and the Run press's spend disclosure —
   * and it reads the vault reference table and the choice row, so calling it
   * twice would be two reads of the same rows on every five-second poll and
   * two chances for one page to disagree with itself about whether this agent
   * has a model.
   */
  /*
   * MAR-697. What DASH has saved for this agent, as sentences.
   *
   * Read off disk here rather than out of the store, because there is no row
   * to read: the folder *is* the record. That is the same authority argument
   * ADR 0008 makes about the agent folder, and it costs one `readdir` on a page
   * that already opens the manifest through `panelDocument` above.
   *
   * The wording happens here and not in `lib/agent-exports.ts` for the reason
   * `buildArtifactCards` words a receipt: that module answers what is on the
   * disk, this one answers what the screen says, and a size formatted beside a
   * `statSync` is a copy decision filed where nobody looks for one.
   */
  const exports = listAgentExports(dataDir, agent).map((entry) => ({
    file: entry.file,
    label: entry.label,
    when: describeReceiptMoment(entry.saved_at),
    size: describeRecordSize(entry.bytes),
  }));

  const modelSettings = buildAgentModelSettings(agent, manifest as ModelSourceManifest);
  const manifestGap = describeManifestGap(document);
  const health = buildAgentHealth({
    agent,
    manifest: manifest as ConnectionSourceManifest,
    manifest_gap: manifestGap,
    models: modelSettings,
    rows: connectionRowsFor(agent, manifest as ConnectionSourceManifest),
    store,
  });

  // Outside the snapshot, deliberately. The snapshot is what the *agent*
  // published about itself and is null until it has published anything; a digest
  // from a run last week is DASH's own record and survives the agent being
  // stopped, restarted or temporarily unreachable. Nesting it would make the
  // last thing the user cares about disappear whenever the process did.
  //
  // MAR-589. The stored column, when a rename has set one, outranks the
  // manifest's own `display_name` — that precedence is the whole reason the
  // column exists. `store` already holds it; recomputing from the manifest
  // alone would show a renamed agent's old name until the process restarted.
  const storedDisplayName = store.agents[agent]?.display_name ?? null;
  const title = agentDisplayName({
    name: workspaceManifest.agent.name,
    display_name: storedDisplayName ?? workspaceManifest.agent.display_name,
  });
  const agentEvents = store.events.filter((event) => event.agent === agent);
  /*
   * Built once and read twice (MAR-680).
   *
   * It was inline on `snapshot:` below, and `buildRunProgress` needs the same
   * object to tell a paused run from a slow one. Calling `workspaceSnapshot`
   * a second time would re-derive the whole overview, inbox and audit slice on
   * every five-second poll, and would let the run the progress panel describes
   * differ from the one the record below it lists.
   */
  const snapshot = stored === null ? null : workspaceSnapshot(workspaceManifest, stored, now);

  /*
   * MAR-784. Read once and named, because the receipt below needs the newest
   * row's own `settled_at` and `allowance_calls` and the panel needs the whole
   * list — and two reads of `agent_schedule_runs` on one page draw could
   * disagree about which window is newest if the drain landed between them.
   */
  const scheduleRuns = readScheduleRuns(agent);
  const newestScheduleRun = scheduleRuns[0] ?? null;

  return {
    found: true,
    agent,
    title,
    renamed: storedDisplayName !== null,
    goal: workspaceManifest.agent.goal,
    /*
     * MAR-502. Read from the store rather than from the manifest above, and
     * that is the load-bearing line of this issue.
     *
     * `title` is the *author's* `display_name` and changes when they publish a
     * new manifest. The character is DASH's own record, written once at import
     * and deliberately omitted from the re-import path's `ON CONFLICT DO
     * UPDATE` (`lib/store.ts`), so an author renaming their agent does not
     * re-costume something the user has already learned to recognise. Deriving
     * the portrait from anything on this manifest would undo that in one line.
     */
    avatar: readAgentAvatar(agent),
    snapshot,
    /*
     * MAR-703. Read from the registration rather than from the snapshot beside
     * it, and that is this issue's load-bearing line.
     *
     * The snapshot answers "what has this agent said", and after a store restore
     * — or on any agent that has never run here — the answer is nothing. The
     * registration answers "does DASH hold a program it could spawn", which
     * survives a rebuilt `agents` table because a registration is a file in
     * `agents/` rather than a row: MAR-553's re-projection reads those files, and
     * `runner/main.ts` loads them at boot. So an agent can be perfectly startable
     * while having reported nothing at all, and until this field existed the
     * control panel could not tell that state from a manifest-only agent.
     *
     * One small read on a five-second poll, beside the manifest, the folder and
     * the deploy rows this function already opens.
     */
    startable: readRegistration(dataDir, agent) !== null,
    latest_digest: digest,
    latest_digest_grounding:
      digest === null || !isDigestArtifact(digest) ? null : analyzeGrounding(digest),
    outputs,
    // MAR-697. DASH's own record of what it has saved for this agent, beside
    // DASH's own record of what the agent produced.
    exports,
    /*
     * MAR-635. The same events `buildAgentAsk` already reads, pointed at a
     * feed and a meter panel rather than at a cost sentence. Filtered here
     * once so the two projections cannot pick different runs from two walks
     * of the same array.
     */
    feed: buildAgentFeed(agentEvents),
    telemetry: buildAgentTelemetry(agentEvents),
    /*
     * MAR-680, MAR-685. The same events again, asked the question the feed
     * cannot answer: not *what happened* but *where is this now*.
     *
     * It is handed three things the feed is not, and each one buys a sentence
     * DASH could not otherwise say honestly. The **plan** supplies the steps
     * that have not run yet, which is what makes "Step 2 of 6" sayable. The
     * **snapshot's runs** are the agent's own state machine, which is the only
     * record that can tell a paused run from a slow one. And `now` decides the
     * one question neither can: whether a run that stopped reporting and never
     * wrote a terminal event is working or over — the exact state the run this
     * page displayed for five hours was in.
     */
    run_progress: buildRunProgress({
      events: agentEvents,
      now,
      plan: manifest.planned_route,
      runs: snapshot?.runs ?? [],
    }),
    permissions: declaredPermissions(manifest),
    // MAR-507. From the manifest, like `permissions` directly above and for the
    // same reason: this is what the agent's author declared, and a projection
    // DASH derived from anything else would be DASH describing somebody else's
    // agent.
    input_roles: buildInputRoles(manifest),
    // MAR-664. Every step the plan declares, read from the same manifest
    // `input_roles` and `permissions` above already have open. `lib/agent-
    // plan.ts` is pure and carries no policy of its own; this is the one call
    // that reads a real manifest into it.
    plan: describeAgentPlan(manifest.planned_route),
    // MAR-583. What each step asked for, what the person chose, and whether
    // there is anything to choose at all. Built here rather than in the page
    // because it reads the vault's reference table and the choice rows, and
    // because every sentence on it belongs to `lib/ai/model-choice.ts`.
    models: modelSettings,
    // MAR-681. DASH's own record of which of this agent's questions a person
    // has already answered "always this" for — read once here, alongside
    // every other setting on this page, rather than fetched by the Settings
    // drawer on its own round trip.
    standing_answers: readStandingAnswers(agent).map((answer) => ({
      question_key: answer.question_key,
      question_label: answer.question_label,
      option_label: answer.option_label,
      chosen_at: answer.chosen_at,
    })),
    // MAR-742 item 8, ADR 0029. `standing_answers`' neighbour and the same
    // reasoning: DASH's own record about this agent, read once here with every
    // other setting on this page. Two reads rather than one because the
    // instruction and what became of it are different rows with different
    // lifetimes — turning a schedule off keeps the history.
    //
    // MAR-784 makes it three, and the third is conditional on purpose. The
    // receipt is a scan of `broker_audit` over one ten-minute window, and the
    // only window it can be about is the newest settled one; asking for it when
    // that window was allowed nothing would be a query on every page draw whose
    // answer is always "nothing was allowed, so nothing was spent". See
    // `readScheduleSpend`.
    schedule: buildAgentScheduleView(
      readAgentSchedule(agent),
      scheduleRuns,
      newestScheduleRun === null || newestScheduleRun.allowance_calls <= 0
        ? null
        : readScheduleSpend(agent, newestScheduleRun.settled_at, SPEND_ALLOWANCE_MS),
    ),
    // MAR-645. A projection of records already read or stored, with no probe
    // and no provider call. The page draws it only on the Health stage.
    health,
    // MAR-619, ADR 0016. What the Run press will spend, said where the press
    // is. Derived from the settings directly above rather than from a second
    // read of the same rows, so the sentence and the picker cannot end up
    // disagreeing about whether this agent has a model to spend under.
    run_spend: describeRunSpend({
      agent: agentDisplayName(workspaceManifest.agent),
      service: spendingService(manifest, modelSettings),
    }),
    // MAR-545. Built here rather than fetched by the chat itself, so the whole
    // surface arrives with the rest of the page on the same five-second poll —
    // an answer that landed while somebody was reading appears without anything
    // asking for it.
    ask: buildAgentAsk(
      agent,
      manifest,
      agentEvents,
      // The agent's one name — the stored rename if there is one, never the id.
      // See `buildAgentAsk`.
      title,
    ),
    // MAR-548, ADR 0008 slice 3's wiring. The authoritative document, not the
    // row's copy — see `panelDocument` for which store answers and why.
    panel: buildPanelView(document, {
      // MAR-674. The panel is renderer-safe and cannot hash anything, so the
      // resolver is handed in from here, exactly as `facts` is.
      resolveCitations: citationResolverFor(agentRecords),
      artifacts: artifactRecordsForAgent(agent),
      facts: dashFactsForAgent(agent, store),
    }),
    // MAR-576. The same document the panel was resolved from, asked a different
    // question: not "what does this declare" but "is this older than what DASH
    // would write for it today". It has to be the authoritative copy for the
    // reason the panel does — a folder edited on disk is the document the user
    // actually has, and telling them their setup is stale on the strength of a
    // row that disagrees with it would be DASH reporting its own index back at
    // them as their agent.
    manifest_gap: manifestGap,
    // MAR-577. The same fact the agents list carries, on the page where the
    // agent is already chosen — so its deploy section can refuse before it
    // offers a server rather than after somebody picks one.
    //
    // MAR-591. `manifest` here and `store.agents[name].manifest` in `agentsView`
    // are the same column read two ways, which is what makes the two deploy
    // panels answer identically. Neither is the folder `produceAgentFolderBundle`
    // reads, and that gap is the arrangement MAR-577 already stated: main
    // assesses again and stays the authority, so a store that has drifted from
    // the folder costs a refusal after the press rather than a bad deploy.
    deploy: agentDeployStanding(agent, manifest as ConnectionSourceManifest),
    // MAR-584, ADR 0010. Where DASH has sent this agent, and whether what it
    // sent is still what this agent is. Both facts about DASH's own record;
    // neither about the servers.
    deploy_targets: agentDeployTargets(agent),
    // MAR-584. Whether there is a folder to open and compare. The comparison
    // itself is a command — see the field's own note for why it is not computed
    // here on a five-second poll.
    folder_checkable: agentFolderExists(agent),
  };
}

/**
 * The servers DASH has pushed this agent to, newest first (MAR-584, ADR 0010).
 *
 * ## What "behind" is computed from, and what it is not
 *
 * Two digests DASH holds: the ones recorded when the push finished, and the ones
 * on the registration now. Nothing here reaches the network, and nothing claims
 * the server still has what DASH sent it — the machine may have been rebuilt,
 * the agent stopped, the folder replaced by hand. What is being compared is
 * *DASH's own copy then* against *DASH's own copy now*, which is a comparison
 * DASH is entitled to make and is the one a person actually needs after
 * accepting an update.
 *
 * `comparable` is false whenever either side lacks a program digest. That is not
 * an edge case to be smoothed over: an agent registered before MAR-584 kept a
 * baseline has no `accepted_files`, so its pushes recorded a null program
 * digest, and a comparison of the manifests alone would report "up to date" over
 * a code change nobody could see. Saying DASH cannot tell is the only honest
 * answer available, and it is the one the surface renders.
 *
 * A row whose host DASH no longer holds is dropped. `host.forget` deletes these
 * rows, so this should never fire — it is here because the alternative to
 * dropping is rendering a server with no name.
 */
function agentDeployTargets(agent: string): AgentDeployTarget[] {
  const records = readAgentDeploys(agent);
  if (records.length === 0) {
    return [];
  }

  const registration = readRegistration(dataDir, agent);
  const currentManifest = registration?.dash.manifest_sha256 ?? "";
  const currentFiles = storedDigestSummary(registration?.dash.accepted_files ?? []);

  const targets: AgentDeployTarget[] = [];
  for (const record of records) {
    // MAR-611, ADR 0017. A row with a `brought_home_at` is DASH's memory that
    // it already took this agent back — the server side of that same fact is
    // that the copy is not there any more, so this list must not claim it is.
    if (record.brought_home_at !== null) {
      continue;
    }
    const host = readHost(record.host_id);
    if (host === null) {
      continue;
    }
    const comparable =
      currentManifest !== "" && currentFiles !== null && record.files_sha256 !== null;
    targets.push({
      host_id: record.host_id,
      label: host.label,
      sent_at: record.sent_at,
      sent_on: plainDay(record.sent_at),
      comparable,
      behind:
        comparable &&
        (record.manifest_sha256 !== currentManifest || record.files_sha256 !== currentFiles),
    });
  }
  return targets;
}

/**
 * Which servers DASH has put this agent on (MAR-606).
 *
 * The narrow half of `agentDeployTargets` next door, for the fleet card: which
 * servers and when, with no digest comparison. The comparison is real work —
 * it reads a registration and hashes a stored file list — and doing it per card
 * on the agents list would be paying for an answer that page has no room to
 * show and no control to act on.
 *
 * A row whose host DASH no longer holds is dropped, exactly as its sibling does
 * and for ADR 0010's reason: `host.forget` deletes these rows, so this should
 * never fire, and the alternative to dropping is rendering a server with no
 * name.
 */
function agentHostedOn(agent: string): AgentHostedOnView[] {
  const hosted: AgentHostedOnView[] = [];
  for (const record of readAgentDeploys(agent)) {
    // MAR-611, ADR 0017. Same skip `agentDeployTargets` already makes: a
    // brought-home row is DASH's memory that it took the copy back, so the
    // fleet mark must not still say Cloud. Local/Cloud reads this list
    // (MAR-630), never a live sighting (ADR 0015).
    if (record.brought_home_at !== null) {
      continue;
    }
    const host = readHost(record.host_id);
    if (host === null) {
      continue;
    }
    hosted.push({
      host_id: record.host_id,
      label: host.label,
      sent_on: plainDay(record.sent_at),
    });
  }
  return hosted;
}

/** Whether DASH holds a folder of its own for this agent, at all. */
function agentFolderExists(agent: string): boolean {
  try {
    return existsSync(agentFolderPath(dataDir, agent));
  } catch {
    // A legacy name that cannot be a path component has no folder by design —
    // the row-only standing MAR-553 keeps supported. There is nothing to open
    // and nothing to compare, which is exactly what `false` says here.
    return false;
  }
}

/**
 * Which stored copy of an author's document this page is drawn from
 * (MAR-548, ADR 0008 / MAR-553, and then MAR-584).
 *
 * ## It used to read the folder, and that was the silent swap
 *
 * MAR-548 read the folder here, because the folder is authoritative and the row
 * is a projection of it. That is still the ADR and it is still true — but it
 * produced a page that was **half live**: the panel was redrawn from the folder
 * on every five-second poll while the title, the goal, the permission receipt
 * and the input roles came from the row. An outside editor changing the folder
 * therefore changed half of this page immediately, with nothing on screen
 * saying so, and the other half at the next restart when
 * `reconcileAgentFolders` projected it over the row.
 *
 * MAR-584 is the issue that says a running agent's program must not swap
 * silently, and this was the swap. Both halves now read the row, which is
 * DASH's projection of the folder **as it was accepted** — kept that way by
 * `reconcileAgentFolders`, which no longer projects an externally edited folder
 * over it. The folder is still authoritative and is still where an update comes
 * from; what changed is that it arrives through `folder.adopt`, which a person
 * presses, instead of through a render.
 *
 * The function stays, rather than the call site being replaced with `row`,
 * because the question it answers — *which of DASH's two copies does a surface
 * show* — is the one ADR 0008 makes and is worth having an answer written down
 * for. A reader who goes looking for the folder read finds this instead of
 * finding nothing.
 */
function panelDocument(_agent: string, row: unknown): unknown {
  return row;
}

/**
 * The three facts `dash_fact` can name, in DASH's own voice (ADR 0008).
 *
 * Derived from `listRuns` rather than counted here, which is the same call
 * `complianceForAgent` makes two hundred lines up. Run status is decided in one
 * place — `run_failed` beats `run_completed` beats still running — and a panel
 * that derived its own would be a second authority free to disagree with the
 * verdict on the Runs page about the very same run.
 *
 * `listRuns` returns newest first, so the first entry for this agent is the last
 * run. `started_at` is what `last_run_at` means: when it last ran, not when the
 * last event about it happened to arrive.
 */
function dashFactsForAgent(agent: string, store: StoreShape): PanelDashFacts {
  const runs = listRuns(store).filter((run) => run.agent === agent);
  const last = runs[0];
  return {
    run_count: runs.length,
    last_run_at: last?.started_at ?? null,
    last_run_status: last?.status ?? null,
  };
}

/**
 * The provider a run of this agent would actually spend at, or null (MAR-619,
 * ADR 0016).
 *
 * Three things have to be true at once, and each of them being false is a
 * different, already-worded outcome rather than a gap this function papers
 * over:
 *
 * 1. **The agent asks.** Its manifest declares a capability whose id resolves,
 *    through the broker's own operation catalogue (`operationById`), to an
 *    operation whose `access` is `"spend"`. Read from the catalogue rather than
 *    matched by a suffix literal here, so a fourth spend operation joins this
 *    check the moment it joins `lib/broker/operations.ts` — the same place that
 *    decides what the agent's own request will actually cost.
 * 2. **A key is held.** `can_choose` is false without one, and a run in that
 *    state is refused before anything is sent — `describeNotCurated`'s
 *    `not_connected` says so on the digest afterwards.
 * 3. **A model is named.** `chosen_model_id` is null on *match each step*, and
 *    the broker refuses an agent-origin spend with `no_model_chosen` rather
 *    than picking one (ADR 0011 decision 1).
 *
 * So null means "this press cannot cost you anything", which is a claim worth
 * being exactly right about — it is the difference between a silent Run button
 * and one carrying a sentence about money.
 */
function spendingService(
  manifest: unknown,
  settings: AgentModelSettingsView,
): string | null {
  if (!settings.can_choose || settings.chosen_model_id === null) {
    return null;
  }
  const connections = (manifest as { agent_dom?: { connections?: unknown } }).agent_dom
    ?.connections;
  if (!Array.isArray(connections)) {
    return null;
  }
  const asks = connections.some((connection) => {
    const capabilities = (connection as { capabilities?: unknown }).capabilities;
    return (
      Array.isArray(capabilities) &&
      capabilities.some((capability) => {
        const id = (capability as { id?: unknown }).id;
        if (typeof id !== "string") {
          return false;
        }
        const operation = operationById(id);
        return operation !== null && isSpendOperation(operation);
      })
    );
  });
  return asks ? settings.provider_label : null;
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
  // MAR-589. Read once for the whole fleet rather than per agent — the same
  // rule `glanceReader` states for the tables it reads once for every card.
  const store = readStore();

  for (const agent of listAgentNames()) {
    const manifest = readAgentManifest(agent);
    const stored = readAgentDomState(agent);
    if (manifest === null || stored === null) {
      continue;
    }
    const workspaceManifest = manifest as WorkspaceManifest;
    // The stored rename outranks the manifest's own `display_name`, exactly as
    // `workspaceView` resolves it — the inbox names an agent it is not the
    // page for and must not disagree with the page that is.
    const title = agentDisplayName({
      name: workspaceManifest.agent.name,
      display_name: store.agents[agent]?.display_name ?? workspaceManifest.agent.display_name,
    });

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

/**
 * A citation resolver over one set of artifact records (MAR-674, ADR 0025
 * amendment 1).
 *
 * ## Why this is a closure over a list rather than a store query
 *
 * A brief points at a digest **of its own run**, and both arrive on the same
 * channel into the same table. Every caller here already holds the records it
 * needs — the run detail page holds one run's, the agent page holds the whole
 * history — so resolving means finding a sibling in an array rather than asking
 * the store again. A resolver that queried per card would be one query per
 * output on a page that polls.
 *
 * ## Why the digests are grouped by run
 *
 * The agent-wide caller's list spans runs, and `resolveBriefCitations` checks
 * `derived_from.run_id` as well as the artifact id — so handing it every digest
 * this agent ever wrote would be correct but wasteful, and grouping keeps the
 * lookup to the run in question. The run detail caller has one group and pays
 * nothing for the generality.
 *
 * Built once per call rather than per card: `buildArtifactCards` maps, and a
 * grouping rebuilt inside that map would be quadratic on an agent with a long
 * history.
 */
function citationResolverFor(
  records: readonly RunArtifactRecord[],
): (record: RunArtifactRecord) => BriefCitations | null {
  const digestsByRun = new Map<string, DigestArtifact[]>();
  for (const record of records) {
    const { artifact } = record;
    if (!isDigestArtifact(artifact)) {
      continue;
    }
    const group = digestsByRun.get(artifact.run_id);
    if (group === undefined) {
      digestsByRun.set(artifact.run_id, [artifact]);
    } else {
      group.push(artifact);
    }
  }

  return (record) => {
    const { artifact } = record;
    // Null for a digest and a draft, which is the type's own rule: a digest has
    // its own items and needs no join, and a draft cites messages rather than
    // items.
    if (!isBriefArtifact(artifact)) {
      return null;
    }
    return resolveBriefCitations(artifact, digestsByRun.get(artifact.run_id) ?? []);
  };
}
