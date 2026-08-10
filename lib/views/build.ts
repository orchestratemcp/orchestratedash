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
import { isDigestArtifact } from "../contracts";
import type { ManifestPermissions, PermissionGrant } from "../contracts";
import { brokeredField, requestedOperations, unrequestedOperations } from "../broker/grant";
import { operationById, type BrokerOperation } from "../broker/operations";
import { describeClientOwner, describeCustody, describeDashClosedWindow } from "../broker/providers";
import { listReceipts, readBrokerAudit, readBrokerLapses, type BrokerLapse } from "../broker/store";
import { describeBrokerRefusal } from "../copy/recovery";
import { heldCredentials } from "../connection-actions";
import { connectableFields, type CredentialKind } from "../connection-credentials";
import { describeEvidenceRecord } from "../copy/evidence";
import { describeStoreDamage } from "../copy/recovery";
import { deriveConnectionRequirements, type ConnectionSourceManifest } from "../connections";
import { sameHostIdentity } from "../hosts";
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
import { listRegistrations, readRegistration, type ManagedRegistration } from "../registration";
import {
  MANIFEST_ONLY_DEPLOY_REFUSAL,
  UNREADABLE_FOLDER_DEPLOY_REFUSAL,
  agentFolderPath,
  inspectAgentFolderStanding,
  storedDigestSummary,
} from "../agent-folders";
import { plainDay } from "../copy/when";
import { describeNotificationState } from "../notify/settings";
import { describeManifestGap } from "../sample-refresh";
import { glanceReader } from "./glance";
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
  readAgentManifest,
  readEvidencePulls,
  readHost,
  readNotificationSettings,
  resolveArtifactAvailability,
  readStore,
  type EvidencePullRecord,
  type StoreShape,
} from "../store";
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
  AgentDeployView,
  AgentOriginView,
  AgentsView,
  BrokerCapabilityView,
  BrokerLapseView,
  BrokerRowView,
  ConnectionRowWithCredential,
  ConnectionsView,
  HostsView,
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
 */
export function agentDeployStanding(agent: string): AgentDeployView {
  let standing: ReturnType<typeof inspectAgentFolderStanding>;
  try {
    standing = inspectAgentFolderStanding(dataDir, agent);
  } catch {
    return { deployable: false, refusal: UNREADABLE_FOLDER_DEPLOY_REFUSAL };
  }
  switch (standing.kind) {
    case "complete":
      return { deployable: true, refusal: null };
    case "manifest_only":
      return { deployable: false, refusal: MANIFEST_ONLY_DEPLOY_REFUSAL };
    case "unreadable":
      return { deployable: false, refusal: UNREADABLE_FOLDER_DEPLOY_REFUSAL };
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
      // MAR-501. Straight from the summary, which took it straight from the
      // column. Three surfaces draw this agent now and they must draw the same
      // character; the way to guarantee that is for all three to be reading one
      // stored value rather than each deriving its own.
      avatar: agent.avatar,
      // MAR-577. One folder inspection per row, beside the registration read
      // this function already does per row. It is what lets the Servers page's
      // deploy panel say which of these agents it could actually send.
      deploy: agentDeployStanding(agent.name),
      // MAR-586. The four questions a card answers at a glance, already worded.
      // Composed here rather than in the page for `damage`'s reason directly
      // below: both hosts must hand the renderer the same sentences.
      glance: glanceFor(agent.name),
    })),
    // Composed here rather than in the page, so both hosts hand the renderer the
    // same sentence — the property this module exists to keep.
    damage: describeStoreDamage(store.unreadable),
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
  return { runs: listAnalyzedRuns(store), evidence: describeEvidenceRecord(pulls) };
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
    // MAR-533. Everything DASH offers here that this agent did not ask for —
    // the third party in the grant, made visible. See `unrequestedOperations`.
    not_requested: unrequestedOperations(manifest, connectionId).map((operation) => ({
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
      };
    }),
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
  return {
    configured: settings.configured,
    masked_hint: settings.masked_hint,
    configured_at: settings.configured_at,
    send_approvals: settings.send_approvals,
    send_reports: settings.send_reports,
    state_sentence: describeNotificationState(settings),
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

  return {
    agents: capable.map(({ name, manifest }) => {
      const rows = connectionRowsFor(name, manifest, agentsByProvider);

      return {
        name,
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
    snapshot: stored === null ? null : workspaceSnapshot(workspaceManifest, stored, now),
    latest_digest: digest,
    latest_digest_grounding:
      digest === null || !isDigestArtifact(digest) ? null : analyzeGrounding(digest),
    outputs,
    outputs_run_id: outputsRunId,
    permissions: declaredPermissions(manifest),
    // MAR-507. From the manifest, like `permissions` directly above and for the
    // same reason: this is what the agent's author declared, and a projection
    // DASH derived from anything else would be DASH describing somebody else's
    // agent.
    input_roles: buildInputRoles(manifest),
    // MAR-548, ADR 0008 slice 3's wiring. The authoritative document, not the
    // row's copy — see `panelDocument` for which store answers and why.
    panel: buildPanelView(document, {
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
    manifest_gap: describeManifestGap(document),
    // MAR-577. The same fact the agents list carries, on the page where the
    // agent is already chosen — so its deploy section can refuse before it
    // offers a server rather than after somebody picks one.
    deploy: agentDeployStanding(agent),
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
