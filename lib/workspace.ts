/**
 * Agent workspace projections: manifest + Agent DOM state → what the workspace
 * shows and which controls it may offer.
 *
 * Third pure module in the `lib/analyze.ts` family — no I/O, no clock, no
 * network. Time-dependent answers (expiry) take an explicit `now`, because a
 * projection that reads `Date.now()` internally cannot be tested at a boundary,
 * and every interesting expiry case *is* a boundary.
 *
 * Two safety rules are enforced here rather than in the UI, because a rule that
 * lives in a component is a rule that the next component forgets:
 *
 * 1. **No dead controls.** A control is offered only when the manifest declares
 *    the command *and* the current state makes it meaningful. Read-only agents
 *    therefore render no controls at all, rather than greyed-out ones.
 * 2. **No unenforceable approvals.** DASH never offers to approve an action the
 *    runner will not independently enforce. DASH observes and requests; the
 *    runner decides. Offering a button DASH cannot back would be theatre.
 *
 * As everywhere in DASH, nothing here can stop an agent. A finding is a finding.
 */

import { agentDisplayName } from "./copy/agent-name";

export type AgentCommand =
  | "approve"
  | "reject"
  | "choose"
  | "retry"
  | "pause"
  | "resume"
  | "cancel";

export type AgentStatus =
  | "inactive"
  | "ready"
  | "running"
  | "paused"
  | "needs_attention"
  | "offline"
  | "error";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_for_choice"
  | "waiting_for_approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/* ---------------------------------------------------------------------- *
 * Input shapes — the subset of agent.manifest.v2 and agent-dom-state v1
 * this module reads. Declared locally rather than imported from
 * `lib/contracts.ts`, which reads schema files off disk at import time and
 * still describes v1 only — importing it would drag I/O into a pure module.
 * ---------------------------------------------------------------------- */

export interface WorkspaceTrigger {
  type: string;
  label: string;
  /**
   * The longest gap DASH should expect between this agent's activity before
   * treating it as stalled (MAR-441). Meaningful only alongside
   * `type: "schedule"`. `schedule` itself stays free text ("weekdays at
   * 08:00 local time") and DASH does not parse it — parsing prose reliably
   * is not honest, so a schedule with no interval declared yields no
   * expectation and this agent is never marked stalled.
   */
  expected_interval_seconds?: number;
}

export interface WorkspaceManifest {
  agent: { name: string; display_name?: string; goal: string };
  safety_contract?: { irreversible_components?: string[] };
  agent_dom?: {
    runtime?: {
      class: string;
      label: string;
      availability: string;
      continues_when_dash_closed: boolean;
    };
    trigger?: WorkspaceTrigger;
    locations?: { runtime?: { offline_behavior?: string } };
    control?: { supported: boolean; commands?: AgentCommand[] };
  };
}

export interface AgentDomState {
  state_version?: 1;
  manifest_version?: 2;
  agent_id: string;
  observed_at: string;
  status: AgentStatus;
  connections?: Array<{
    connection_id: string;
    state: "not_configured" | "connected" | "degraded" | "expired" | "revoked" | "unknown";
    masked_account?: string;
    checked_at: string;
    reauthorization_required: boolean;
    detail?: string;
  }>;
  runs?: Array<{
    id: string;
    status: RunStatus;
    started_at?: string;
    finished_at?: string;
    current_step?: string;
    progress?: number;
  }>;
  tasks?: Array<{
    id: string;
    /** Absent on a task that exists before any run — see the state schema. */
    run_id?: string;
    label: string;
    status: string;
    created_at?: string;
    detail?: string;
  }>;
  choices?: Array<{
    id: string;
    task_id: string;
    label: string;
    options: Array<{ id: string; label: string; detail?: string }>;
    expires_at: string;
    selected_option_id?: string;
  }>;
  actions?: Array<{
    id: string;
    task_id: string;
    label: string;
    command: AgentCommand;
    approval_required: boolean;
    approval: { enforcement: "none" | "runner_enforced"; request_id?: string };
  }>;
  approval_requests?: Array<{
    id: string;
    task_id: string;
    action_id: string;
    label: string;
    status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
    requested_at?: string;
    expires_at: string;
    runner_enforced: boolean;
    audit?: { correlation_id: string; causation_id?: string };
  }>;
  approval_decisions?: Array<{
    id: string;
    request_id: string;
    decision: "approved" | "rejected";
    actor_id: string;
    decided_at: string;
    audit: { correlation_id: string; causation_id?: string };
  }>;
  memory?: Array<{
    id: string;
    label: string;
    summary: string;
    provenance: string;
    retention: "descriptor_only" | "user_approved";
    user_visible: true;
    updated_at: string;
  }>;
  audit_events?: Array<{
    id: string;
    type: string;
    actor_id: string;
    target_id: string;
    ts: string;
    detail?: string;
    audit: { correlation_id: string; causation_id?: string };
  }>;
  plan_vs_actual?: {
    run_id: string;
    planned_components?: string[];
    executed_components?: string[];
    deviations?: Array<{
      kind: "missing" | "unexpected" | "reordered" | "gate_violation" | "model_tier" | "none";
      detail: string;
    }>;
  };
}

/* ---------------------------------------------------------------------- *
 * Overview
 * ---------------------------------------------------------------------- */

/**
 * `AgentStatus` plus `stalled`, which is deliberately not part of that type.
 *
 * `AgentStatus` is the wire vocabulary: what an agent may claim about itself,
 * bounded further by `SELF_REPORTABLE_STATUSES` in `runner/state.ts`, and
 * what the runner asserts once a process is confirmed dead. `stalled` is
 * neither — no agent or runner ever mints it. It is DASH's own temporal
 * judgment, computed here from a schedule expectation and the state's own
 * timestamps, and only ever appears in what this module derives for display.
 * Keeping it out of `AgentStatus` keeps that distinction visible in the type
 * system rather than only in a comment.
 */
export type WorkspaceStatus = AgentStatus | "stalled";

export interface WorkspaceOverview {
  agent_id: string;
  /** `display_name` when the manifest offers one — never the slug if avoidable. */
  title: string;
  goal: string;
  status: WorkspaceStatus;
  /** One plain-language sentence explaining the status to a non-technical user. */
  status_detail: string;
  runtime_label: string;
  /** What happens to in-flight work when DASH is closed. */
  continues_when_dash_closed: boolean;
  offline_behavior: string | null;
  trigger_label: string;
  /**
   * The most recent timestamp this module can find evidence of activity for,
   * read from the state's own runs/tasks/audit_events (MAR-441). Null when
   * none of those carry a parseable timestamp yet — an agent that has never
   * reported anything, not an agent reported as "just now".
   */
  last_activity_at: string | null;
  /** The single thing the user should do next, or null when nothing is waiting. */
  next_action: string | null;
}

const STATUS_DETAIL: Record<WorkspaceStatus, string> = {
  inactive: "This agent is set up but has not been started.",
  ready: "This agent is connected and ready to run.",
  running: "This agent is working now.",
  paused: "This agent is paused and will not act until you resume it.",
  needs_attention: "This agent is waiting for you before it can continue.",
  offline: "DASH cannot reach this agent right now.",
  error: "This agent stopped because something went wrong.",
  stalled: "This agent has a schedule but has not reported activity within the window DASH expected.",
};

/**
 * Run statuses that mean the agent is doing something right now (MAR-441).
 *
 * Exported for MAR-586, which asks the same question from outside a workspace:
 * a fleet card must not call an agent overdue while a run of it is in flight,
 * and the definition of "in flight" should be this one rather than a second one
 * beside it.
 */
export function hasActiveRun(state: AgentDomState): boolean {
  return (state.runs ?? []).some(
    (run) => run.status === "running" || run.status === "queued",
  );
}

/**
 * Whether a schedule's own expectation has gone by (MAR-441's arithmetic,
 * MAR-586's second caller).
 *
 * Lifted out of `deriveStatus` below rather than copied into the fleet card, and
 * the split is where the responsibility sits. **This function answers only "is
 * the gap longer than the declared interval".** Every reason *not* to say so
 * anyway — a paused agent, a run happening now, a runner that has already
 * confirmed the process is gone — stays in `deriveStatus`, because those are
 * judgments about a status field and the fleet card makes its own.
 *
 * Three ways to answer false, and each is a refusal to guess rather than a
 * negative finding:
 *
 * - a trigger that is not a schedule has no expected window at all, and
 *   "has simply not been asked to run" is correct behaviour;
 * - a schedule with no declared interval yields no expectation, because
 *   `schedule` itself is free text DASH does not parse;
 * - no activity timestamp means there is nothing to measure a gap from.
 */
export function pastScheduleExpectation(
  trigger: WorkspaceTrigger | undefined,
  lastActivityAt: string | null,
  now: Date,
): boolean {
  if (trigger?.type !== "schedule" || trigger.expected_interval_seconds === undefined) {
    return false;
  }
  if (lastActivityAt === null) {
    return false;
  }
  const elapsedMs = now.getTime() - Date.parse(lastActivityAt);
  if (Number.isNaN(elapsedMs)) {
    return false;
  }
  return elapsedMs > trigger.expected_interval_seconds * 1000;
}

/**
 * The most recent timestamp this snapshot carries evidence of activity for.
 *
 * Reads only fields the state already exposes — run start/finish, task
 * creation, audit events — so this needs no new storage or polling: exactly
 * the "derive before extending the contract" the issue asks for. Unparseable
 * or absent timestamps are skipped rather than guessed at.
 */
function latestActivityAt(state: AgentDomState): string | null {
  const candidates: string[] = [];
  for (const run of state.runs ?? []) {
    if (run.started_at !== undefined) {
      candidates.push(run.started_at);
    }
    if (run.finished_at !== undefined) {
      candidates.push(run.finished_at);
    }
  }
  for (const task of state.tasks ?? []) {
    if (task.created_at !== undefined) {
      candidates.push(task.created_at);
    }
  }
  for (const event of state.audit_events ?? []) {
    candidates.push(event.ts);
  }

  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const candidate of candidates) {
    const ms = Date.parse(candidate);
    if (!Number.isNaN(ms) && ms > latestMs) {
      latestMs = ms;
      latest = candidate;
    }
  }
  return latest;
}

/**
 * Layer `stalled` on top of the wire status, or leave it untouched.
 *
 * Every guard here is a reason NOT to override, and each maps to one of the
 * issue's acceptance criteria:
 *
 * - `offline`/`error` already mean the runner confirmed the process is gone
 *   (`runner/state.ts`'s `resolveStatus`) — that is a stronger, more specific
 *   claim than "stalled" and must not be papered over by it. This is also
 *   what keeps "killed" distinguishable from "quiet" without DASH touching
 *   `ProcessFacts` at all: the runner already made that call before this
 *   snapshot ever arrived.
 * - `paused`/`needs_attention` are states the user or agent put it in on
 *   purpose; overriding them would hide a more relevant signal.
 * - An active run is activity happening right now, regardless of what the
 *   schedule expected.
 * - A manual (or any non-`schedule`) trigger has no expected window at all —
 *   "has simply not been asked to run" is correct behaviour, not staleness.
 * - No `expected_interval_seconds` means no derivable expectation; absent
 *   stays absent rather than becoming a guess.
 * - No activity timestamp anywhere in the snapshot means there is nothing to
 *   measure a gap from — a brand-new agent is not "overdue".
 */
function deriveStatus(
  baseStatus: AgentStatus,
  trigger: WorkspaceTrigger | undefined,
  state: AgentDomState,
  lastActivity: string | null,
  now: Date,
): WorkspaceStatus {
  const NEVER_OVERRIDE: ReadonlySet<AgentStatus> = new Set([
    "offline",
    "error",
    "paused",
    "needs_attention",
  ]);
  if (NEVER_OVERRIDE.has(baseStatus) || hasActiveRun(state)) {
    return baseStatus;
  }
  // The last three guards are `pastScheduleExpectation`'s own — a non-schedule
  // trigger, an undeclared interval, an unmeasurable gap — and they moved there
  // so the fleet card asks the same question rather than a similar one.
  return pastScheduleExpectation(trigger, lastActivity, now) ? "stalled" : baseStatus;
}

export function buildOverview(
  manifest: WorkspaceManifest,
  state: AgentDomState,
  now: Date,
): WorkspaceOverview {
  const dom = manifest.agent_dom;
  const waiting = buildWorkInbox(manifest, state, now);
  const lastActivity = latestActivityAt(state);
  const status = deriveStatus(state.status, dom?.trigger, state, lastActivity, now);

  return {
    agent_id: state.agent_id,
    // MAR-595 finding 10. Humanized rather than the raw slug — see
    // `lib/copy/agent-name.ts`.
    title: agentDisplayName(manifest.agent),
    goal: manifest.agent.goal,
    status,
    status_detail: STATUS_DETAIL[status],
    runtime_label: dom?.runtime?.label ?? "Unknown runtime",
    // Absent means unknown, and unknown is not the same as false. A user
    // deciding whether to close DASH deserves the honest answer.
    continues_when_dash_closed: dom?.runtime?.continues_when_dash_closed ?? false,
    offline_behavior: dom?.locations?.runtime?.offline_behavior ?? null,
    trigger_label: dom?.trigger?.label ?? "Unknown trigger",
    last_activity_at: lastActivity,
    next_action: describeNextAction(waiting, status),
  };
}

function describeNextAction(waiting: InboxItem[], status: WorkspaceStatus): string | null {
  const live = waiting.filter((item) => !item.expired);
  if (live.length > 0) {
    const noun = live.length === 1 ? "item" : "items";
    return `Review ${live.length} ${noun} waiting for you`;
  }
  // Expired work is still the user's next action — it just needs restarting
  // rather than answering, and saying nothing would strand the run silently.
  if (waiting.length > 0) {
    return "Reopen this agent's expired request";
  }
  if (status === "error") {
    return "Check what went wrong and retry the run";
  }
  if (status === "offline") {
    return "Bring this agent back online";
  }
  if (status === "stalled") {
    return "Check why this agent hasn't run when scheduled";
  }
  return null;
}

/* ---------------------------------------------------------------------- *
 * Work inbox
 * ---------------------------------------------------------------------- */

export type InboxItemKind = "choice" | "approval";

interface InboxItemBase {
  id: string;
  task_id: string;
  /** The task's own label, so the inbox reads as work rather than as ids. */
  task_label: string;
  run_id: string | null;
  label: string;
  expires_at: string;
  expired: boolean;
}

export interface ChoiceInboxItem extends InboxItemBase {
  kind: "choice";
  options: Array<{ id: string; label: string; detail?: string }>;
}

export interface ApprovalInboxItem extends InboxItemBase {
  kind: "approval";
  options: [];
  /** The exact action the user is being asked to permit. */
  action_id: string;
  action_label: string;
  /**
   * Human-readable choices already made for this task, so an approval can show
   * the concrete time/recipient/variant rather than only an action category.
   */
  context?: Array<{ label: string; detail?: string }>;
}

export type InboxItem = ChoiceInboxItem | ApprovalInboxItem;

/**
 * Everything currently waiting on the user, choices and approvals together.
 *
 * Answered choices (`selected_option_id` present) and resolved approvals are
 * excluded — they are history, not work. Expired items are *kept* and flagged:
 * silently dropping them would leave the user staring at a stalled run with an
 * empty inbox and no explanation.
 *
 * Approvals whose enforcement DASH cannot rely on are also excluded; see
 * `approvalIsEnforceable`.
 */
export function buildWorkInbox(
  manifest: WorkspaceManifest,
  state: AgentDomState,
  now: Date,
): InboxItem[] {
  const taskLabel = new Map((state.tasks ?? []).map((task) => [task.id, task.label]));
  const taskRun = new Map((state.tasks ?? []).map((task) => [task.id, task.run_id]));
  const actions = new Map((state.actions ?? []).map((action) => [action.id, action]));
  const items: InboxItem[] = [];

  for (const choice of state.choices ?? []) {
    if (choice.selected_option_id !== undefined) {
      continue;
    }
    items.push({
      kind: "choice",
      id: choice.id,
      task_id: choice.task_id,
      task_label: taskLabel.get(choice.task_id) ?? choice.label,
      run_id: taskRun.get(choice.task_id) ?? null,
      label: choice.label,
      expires_at: choice.expires_at,
      expired: hasExpired(choice.expires_at, now),
      options: choice.options,
    });
  }

  for (const request of state.approval_requests ?? []) {
    if (request.status !== "pending") {
      continue;
    }
    if (!approvalIsEnforceable(request, state)) {
      continue;
    }
    // `approvalIsEnforceable` already proved this exists. Looking it up again
    // keeps the proof local and avoids a non-null assertion at the boundary.
    const action = actions.get(request.action_id);
    if (action === undefined) {
      continue;
    }
    const context = (state.choices ?? []).flatMap((choice) => {
      if (choice.task_id !== request.task_id || choice.selected_option_id === undefined) {
        return [];
      }
      const selected = choice.options.find(
        (option) => option.id === choice.selected_option_id,
      );
      return selected === undefined
        ? []
        : [{ label: selected.label, ...(selected.detail === undefined ? {} : { detail: selected.detail }) }];
    });
    items.push({
      kind: "approval",
      id: request.id,
      task_id: request.task_id,
      task_label: taskLabel.get(request.task_id) ?? request.label,
      run_id: taskRun.get(request.task_id) ?? null,
      label: request.label,
      expires_at: request.expires_at,
      expired: hasExpired(request.expires_at, now),
      options: [],
      action_id: action.id,
      action_label: action.label,
      ...(context.length === 0 ? {} : { context }),
    });
  }

  // Soonest deadline first: the item most likely to expire is the one the user
  // most needs to see. Ties break on id so the order is stable across renders.
  return items.sort(
    (a, b) => a.expires_at.localeCompare(b.expires_at) || a.id.localeCompare(b.id),
  );
}

/**
 * An approval is only worth showing if the runner will independently enforce
 * it. The state contract already requires `runner_enforced: true` on requests,
 * but the *action* may declare `enforcement: "none"` — and a manifest is
 * something DASH receives, not something it controls, so this is checked rather
 * than assumed.
 */
function approvalIsEnforceable(
  request: { id: string; action_id: string; runner_enforced: boolean },
  state: AgentDomState,
): boolean {
  if (!request.runner_enforced) {
    return false;
  }
  const action = (state.actions ?? []).find((candidate) => candidate.id === request.action_id);
  if (action === undefined) {
    // A request with no action behind it describes a side effect DASH cannot
    // show the user. Approving an unpreviewable action is exactly what the
    // approval model forbids.
    return false;
  }
  return action.approval.enforcement === "runner_enforced";
}

function hasExpired(expiresAt: string, now: Date): boolean {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) {
    // An unparseable deadline is not evidence of expiry. Treat the item as live
    // and let the runner reject it; dropping it would be the worse failure.
    return false;
  }
  return expiry <= now.getTime();
}

/* ---------------------------------------------------------------------- *
 * Controls
 * ---------------------------------------------------------------------- */

export interface AvailableControl {
  command: AgentCommand;
  /** Plain-language button label. */
  label: string;
}

const CONTROL_LABEL: Record<AgentCommand, string> = {
  approve: "Approve",
  reject: "Reject",
  choose: "Choose",
  retry: "Try again",
  pause: "Pause",
  resume: "Resume",
  cancel: "Cancel",
};

/**
 * Which controls the workspace may render for a run, right now.
 *
 * Returns only *live* controls. Nothing disabled, nothing greyed out — the
 * acceptance criterion is that a read-only agent renders without dead controls,
 * and the cleanest way to guarantee that is to never emit one.
 *
 * Three gates, in order: the manifest must declare control support; the command
 * must be in the declared command list; and the current run status must make
 * the command meaningful.
 */
export function availableControls(
  manifest: WorkspaceManifest,
  state: AgentDomState,
  runId: string | null,
): AvailableControl[] {
  const control = manifest.agent_dom?.control;
  if (control === undefined || !control.supported) {
    return [];
  }
  const declared = new Set(control.commands ?? []);

  /*
   * No run at all: an agent that only acts when asked, waiting to be asked
   * (MAR-457).
   *
   * `retry` is the verb the command contract gives us for "run it" — there is
   * no separate `run` — and it is meaningful here only while nothing is already
   * in flight. The same three gates still apply: the manifest must support
   * control, must declare the command, and the state must make it meaningful.
   * What changes is that "meaningful" can now be true with no run to point at.
   */
  if (runId === null) {
    const busy = (state.runs ?? []).some(
      (candidate) => candidate.status === "running" || candidate.status === "queued",
    );
    if (busy || !retryIsSafe(manifest, state, null)) {
      return [];
    }
    return [...declared]
      .filter((command) => command === "retry")
      .map((command) => ({ command, label: CONTROL_LABEL[command] }));
  }

  const run = (state.runs ?? []).find((candidate) => candidate.id === runId);
  if (run === undefined) {
    return [];
  }

  const meaningful = new Set<AgentCommand>();
  switch (run.status) {
    case "queued":
    case "running":
      meaningful.add("pause");
      meaningful.add("cancel");
      break;
    case "waiting_for_choice":
      meaningful.add("choose");
      meaningful.add("cancel");
      break;
    case "waiting_for_approval":
      meaningful.add("approve");
      meaningful.add("reject");
      meaningful.add("cancel");
      break;
    case "paused":
      meaningful.add("resume");
      meaningful.add("cancel");
      break;
    case "failed":
    case "cancelled":
      if (retryIsSafe(manifest, state, runId)) {
        meaningful.add("retry");
      }
      break;
    case "completed":
      // A finished run has nothing left to drive. Retry is deliberately absent:
      // re-running a completed plan is a new run, started from the agent, not a
      // control on the old one.
      break;
  }

  return [...declared]
    .filter((command) => meaningful.has(command))
    .map((command) => ({ command, label: CONTROL_LABEL[command] }));
}

/**
 * Retry safety: "retry cannot duplicate an irreversible write."
 *
 * If any component the manifest marks irreversible has already executed in this
 * run, retrying could perform that write a second time — a duplicate calendar
 * invite, a second payment. DASH cannot know whether the runner is idempotent,
 * so it assumes the dangerous case and withholds the control.
 *
 * This is intentionally conservative. Withholding retry costs the user a manual
 * restart; offering it can cost them a duplicated irreversible action.
 */
export function retryIsSafe(
  manifest: WorkspaceManifest,
  state: AgentDomState,
  runId: string | null,
): boolean {
  const irreversible = new Set(manifest.safety_contract?.irreversible_components ?? []);
  if (irreversible.size === 0) {
    return true;
  }
  if (runId === null) {
    // Starting a fresh run of an agent that declares irreversible components.
    // DASH cannot see whether that run would perform one, so it withholds the
    // control — the same conservative default it applies to a run with no
    // execution record, and for the same reason: withholding costs a manual
    // start, offering can cost a duplicated irreversible action.
    //
    // Deliberately strict. An agent with irreversible components that wants a
    // start button needs a gate the runner enforces, which is a design question
    // rather than a default DASH should quietly assume the answer to.
    return false;
  }
  const planVsActual = state.plan_vs_actual;
  if (planVsActual === undefined || planVsActual.run_id !== runId) {
    // No execution record for this run means no evidence it is safe. Same
    // conservative default as above.
    return false;
  }
  return !(planVsActual.executed_components ?? []).some((component) =>
    irreversible.has(component),
  );
}
