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

import type { GroundingAnalysis, RunAnalysis } from "../analyze";
import type { EvidenceNotice } from "../copy/evidence";
import type { ArtifactCardView } from "./artifacts";
import type { InputRoleView } from "./inputs";
import type { Recovery } from "../copy/recovery";
import type { ConnectionRequirementRow } from "../connections";
import type { ManifestPermissions, PermissionGrant, RunArtifact, RunEvent } from "../contracts";
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
  /**
   * Rows the store holds and could not read back, worded as a recovery, or null
   * when there are none.
   *
   * On the agents view rather than on every view, because this is the page the
   * loss is *about*: a damaged manifest is a missing agent, and the agents list
   * is where a user would notice one had gone. Repeating the same notice on the
   * runs list and the Connection Center would report one fault four times and
   * still not be the page that could act on it.
   *
   * A `Recovery` rather than the raw names, so the boundary carries the sentence
   * the page renders instead of asking each host to compose one — the same
   * argument `AgentOriginView` makes about projecting rather than passing
   * through.
   */
  damage: Recovery | null;
}

/* ---------------------------------------------------------------------- *
 * Runs
 * ---------------------------------------------------------------------- */

export interface RunRow extends RunSummary {
  analysis: RunAnalysis | null;
}

export interface RunsView {
  runs: RunRow[];
  /**
   * How complete this list is, when DASH has something qualified to say
   * (MAR-488).
   *
   * Null is the ordinary answer and means the record has nothing to disclose —
   * not that it is guaranteed complete. `lib/copy/evidence.ts` owns the
   * difference, and for a runner on another machine the notice is
   * unconditional, because the evidence a user's own server has already
   * discarded increments no counter.
   */
  evidence: EvidenceNotice | null;
}

/**
 * The two verdicts a run carries, side by side and never merged.
 *
 * `analysis` judges the run against its safety contract; `grounding` judges the
 * digest against the sources the run said it read. See `lib/analyze.ts` for why
 * a missing citation must never render in the same red as an unapproved
 * irreversible action.
 */
export interface RunArtifactsView {
  artifacts: RunArtifact[];
  grounding: GroundingAnalysis | null;
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
      /** What the run produced, newest first. Empty for a run that produced nothing. */
      artifacts: RunArtifact[];
      /**
       * The same outputs with their role, provenance receipt and availability
       * resolved (MAR-434) — what the Outputs panel draws.
       *
       * Alongside `artifacts` rather than replacing it: `electron/smoke.ts`
       * reads that field as proof 6k, and a blocking release gate is not
       * something to break for a tidier shape.
       */
      artifact_cards: ArtifactCardView[];
      /**
       * The newest artifact's grounding, or null when the run produced none.
       *
       * The newest is judged because it is the one on screen: a run that revised
       * its digest corrected it, and grading the superseded copy would report a
       * finding against text the user cannot see.
       */
      grounding: GroundingAnalysis | null;
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
  /**
   * Whether DASH will actually put this credential in the agent's environment.
   *
   * **False for every brokered connection, whatever the manifest asked for**
   * (MAR-458). It used to mean "the manifest names somewhere to deliver it",
   * which was the same thing until ADR 0002 and is now a different thing: a
   * manifest can still name an environment variable for its OAuth field and
   * DASH will not fill it. Reporting the manifest's wish here would tell a user
   * their sign-in is handed to the agent when it is not.
   */
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
  /** The permission card, for a connection DASH brokers. Null otherwise. */
  broker: BrokerRowView | null;
}

/**
 * One capability on a permission card (MAR-458).
 *
 * `label` is what a person reads. `id` travels for the code and is never
 * rendered — `lib/copy/identifiers.ts` forbids an operation id appearing on a
 * guided surface.
 */
export interface BrokerCapabilityView {
  id: string;
  label: string;
  access: "read" | "write";
  /**
   * What will exist in the user's account because this ran, or null for a read
   * (MAR-469).
   *
   * A write's label is a verb phrase — "Save a reply in your Gmail drafts" — and
   * a person approving one needs the sentence after it: where the thing ends up,
   * who can act on it, and what DASH still cannot do. Rendered under the
   * capability rather than in a tooltip, because a consequence a user has to
   * hover to discover is one they will approve without reading.
   */
  consequence: string | null;
}

/**
 * What the permission broker has to say about one connection row.
 *
 * Present only for a connection DASH brokers — a typed-secret row has none,
 * because DASH holds a value for it and performs nothing on the user's behalf.
 * That absence is the honest one: a card promising narrow operations for an API
 * key DASH hands straight to an agent would be describing a boundary that is not
 * there.
 *
 * **Nothing here opens the vault.** `requested` comes from the manifest,
 * `receipt` and `recent` from the store. `lib/connection-actions.ts` explains
 * why that matters: a vault read per row would pop an OS unlock prompt at the
 * moment a user merely looked at this page.
 */
export interface BrokerRowView {
  /** Who actually holds the credential, in a sentence. */
  custody_sentence: string;
  /** Whose consent screen this connection uses, or null when not OAuth. */
  client_sentence: string | null;
  /**
   * What the agent is asking to be able to do, from its own manifest.
   *
   * Shown before a sign-in as well as after, because a user deciding whether to
   * connect needs to know what is being asked for — which is a different
   * question from what has been granted.
   */
  requested: BrokerCapabilityView[];
  /**
   * How the provider permission behind a granted write is wider than the write
   * itself, or null when nothing on this connection writes (MAR-469).
   *
   * Beside the capability list rather than inside it, because it is not a
   * capability — it is a fact about the user's account at the provider that DASH
   * cannot change and must not conceal. For Gmail it says that the permission
   * allowing a draft also allows sending, and that DASH builds nothing on that.
   *
   * Derived from the manifest's declared operations, so it appears on the card
   * *before* a sign-in as well as after. A disclosure that only shows up once a
   * user has already granted the permission has told them nothing.
   */
  wider_permission_sentence: string | null;
  /**
   * When this agent keeps running while DASH is closed: what this connection
   * is worth to it during that window, or null for an agent that stops with
   * DASH (MAR-482, ADR 0006's option-3 copy).
   *
   * On the card before a sign-in as well as after, for the same reason as
   * `wider_permission_sentence`: the person who has not yet granted anything
   * is the one deciding, and a disclosure that appears only once they have is
   * a lapse row wearing better clothes. Null is the honest absence — warning
   * that requests will go unanswered while DASH is closed, about an agent
   * that does not run then, would describe a window in which there is nobody
   * to be warned about.
   */
  dash_closed_sentence: string | null;
  /** ADR 0002 invariant 4, once there is a grant to receipt. */
  receipt: {
    account_hint: string | null;
    granted_at: string;
    last_used_at: string | null;
    capabilities: BrokerCapabilityView[];
  } | null;
  /** Recent brokered calls, newest first. Bounded. */
  recent: Array<{
    /** The operation's plain-language label, or a fallback for a retired one. */
    label: string;
    decision: "allowed" | "refused";
    /** The refusal's headline sentence, when it was refused. */
    refusal_headline: string | null;
    result_count: number | null;
    decided_at: string;
    /**
     * True when DASH could not confirm this answer reached the agent (MAR-467).
     *
     * Rendered as a note *on* the decision rather than as a separate entry,
     * because it is one: DASH really did decide this, and the decision is
     * exactly as auditable as every other row. What failed happened afterwards.
     */
    undelivered: boolean;
  }>;
}

/**
 * Something that kept an agent's request from being adjudicated (MAR-467).
 *
 * Carried beside the connection rows rather than inside a `BrokerRowView`, and
 * the reason is a fact about what DASH knows rather than a layout preference:
 * none of these can be attributed to a connection. The runner does not parse a
 * brokered request, so a dropped one names no connection; a window in which DASH
 * was closed names nothing at all. Rendering them under a particular connection
 * card would invent the one detail that was never observed.
 *
 * ADR 0005 records why this is a separate shape from `recent` rather than more
 * entries in it. `recent` is the audit trail, and the audit trail is worth
 * believing because every line of it is a decision DASH made.
 */
export interface BrokerLapseView {
  kind: "dropped_by_runner" | "dash_closed";
  /** The sentence a person reads. Complete on its own. */
  sentence: string;
  /** The caveat that keeps the sentence from overclaiming, when there is one. */
  qualifier: string | null;
  from_at: string;
  until_at: string | null;
}

export interface AgentConnections {
  name: string;
  rows: ConnectionRowWithCredential[];
  /**
   * What the permission cards above cannot account for (MAR-467). Newest first,
   * bounded, and empty in the ordinary case where nothing went wrong.
   */
  lapses: BrokerLapseView[];
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
  /** Null on a task that belongs to no run — see the Agent DOM state contract. */
  run_id: string | null;
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
      /**
       * The most recent digest, across every run — and deliberately a sibling of
       * `snapshot` rather than a field inside it.
       *
       * The snapshot is what the agent published about itself and is null until
       * it has published anything. A digest is DASH's own record and outlives
       * the process that made it. Nesting it would make the last thing the user
       * cares about vanish whenever the agent was stopped or unreachable.
       */
      latest_digest: RunArtifact | null;
      latest_digest_grounding: GroundingAnalysis | null;
      /**
       * Everything the run that produced `latest_digest` produced, with each
       * output's availability resolved by the same producer the run detail page
       * uses (MAR-434).
       *
       * **Not "every output this agent has ever made".** The workspace answers
       * "what happened last time?", and a list that grew without bound would
       * turn the page a person opens to check on an agent into an archive. The
       * run detail page is where a specific run's outputs live, and every card
       * here links there.
       *
       * Empty rather than absent when there are none, so the panel can say
       * "nothing was produced" — which is a different thing to learn from a
       * panel that is not shown, and is the distinction
       * `app/_components/outputs.tsx` already argues for.
       */
      outputs: ArtifactCardView[];
      /**
       * The run those outputs belong to, for the link to its detail page. Null
       * exactly when `outputs` is empty.
       */
      outputs_run_id: string | null;
      /** What the manifest declares it may do without an account. */
      permissions: PermissionGrant[];
      /**
       * The kinds of file this agent declares it accepts (MAR-507), in the
       * author's own plain-language names.
       *
       * A projection of the manifest and nothing else. It carries no task, no
       * admitted file and no path, because none of those are facts DASH holds:
       * the runner owns the task workspace, and what is in it is the answer to a
       * command rather than a field on a view. Empty means the agent takes no
       * files, which is not the same as taking anything — see `buildInputRoles`.
       */
      input_roles: InputRoleView[];
    };

export type WorkInboxRow = InboxItem & {
  agent: string;
  agent_title: string;
  observed_at: string;
};

/**
 * A schedule-triggered agent past its expected window, alongside choices and
 * approvals (MAR-441).
 *
 * Deliberately not an `InboxItem`: that type's shape is built around a
 * concrete deadline (`expires_at`/`expired`), and a stalled agent has no
 * deadline — there is nothing expiring, only a gap since the last activity
 * this module could find evidence of. Forcing it into that shape would mean
 * inventing an expiry the agent never declared.
 */
export interface StalledAgentRow {
  agent: string;
  agent_title: string;
  last_activity_at: string | null;
  next_action: string;
}

export interface WorkInboxView {
  items: WorkInboxRow[];
  stalled: StalledAgentRow[];
}
