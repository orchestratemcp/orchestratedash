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
    trigger?: { type: string; label: string };
    locations?: { runtime?: { offline_behavior?: string } };
    control?: { supported: boolean; commands?: AgentCommand[] };
  };
}

export interface AgentDomState {
  agent_id: string;
  observed_at: string;
  status: AgentStatus;
  runs?: Array<{ id: string; status: RunStatus; current_step?: string; progress?: number }>;
  tasks?: Array<{ id: string; run_id: string; label: string; status: string; detail?: string }>;
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
    expires_at: string;
    runner_enforced: boolean;
  }>;
  plan_vs_actual?: { run_id: string; executed_components?: string[] };
}

/* ---------------------------------------------------------------------- *
 * Overview
 * ---------------------------------------------------------------------- */

export interface WorkspaceOverview {
  agent_id: string;
  /** `display_name` when the manifest offers one — never the slug if avoidable. */
  title: string;
  goal: string;
  status: AgentStatus;
  /** One plain-language sentence explaining the status to a non-technical user. */
  status_detail: string;
  runtime_label: string;
  /** What happens to in-flight work when DASH is closed. */
  continues_when_dash_closed: boolean;
  offline_behavior: string | null;
  trigger_label: string;
  /** The single thing the user should do next, or null when nothing is waiting. */
  next_action: string | null;
}

const STATUS_DETAIL: Record<AgentStatus, string> = {
  inactive: "This agent is set up but has not been started.",
  ready: "This agent is connected and ready to run.",
  running: "This agent is working now.",
  paused: "This agent is paused and will not act until you resume it.",
  needs_attention: "This agent is waiting for you before it can continue.",
  offline: "DASH cannot reach this agent right now.",
  error: "This agent stopped because something went wrong.",
};

export function buildOverview(
  manifest: WorkspaceManifest,
  state: AgentDomState,
  now: Date,
): WorkspaceOverview {
  const dom = manifest.agent_dom;
  const waiting = buildWorkInbox(manifest, state, now);

  return {
    agent_id: state.agent_id,
    title: manifest.agent.display_name ?? manifest.agent.name,
    goal: manifest.agent.goal,
    status: state.status,
    status_detail: STATUS_DETAIL[state.status],
    runtime_label: dom?.runtime?.label ?? "Unknown runtime",
    // Absent means unknown, and unknown is not the same as false. A user
    // deciding whether to close DASH deserves the honest answer.
    continues_when_dash_closed: dom?.runtime?.continues_when_dash_closed ?? false,
    offline_behavior: dom?.locations?.runtime?.offline_behavior ?? null,
    trigger_label: dom?.trigger?.label ?? "Unknown trigger",
    next_action: describeNextAction(waiting, state.status),
  };
}

function describeNextAction(waiting: InboxItem[], status: AgentStatus): string | null {
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
  return null;
}

/* ---------------------------------------------------------------------- *
 * Work inbox
 * ---------------------------------------------------------------------- */

export type InboxItemKind = "choice" | "approval";

export interface InboxItem {
  kind: InboxItemKind;
  id: string;
  task_id: string;
  /** The task's own label, so the inbox reads as work rather than as ids. */
  task_label: string;
  run_id: string | null;
  label: string;
  expires_at: string;
  expired: boolean;
  /** Choices only. Empty for approvals. */
  options: Array<{ id: string; label: string; detail?: string }>;
}

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
  runId: string,
): AvailableControl[] {
  const control = manifest.agent_dom?.control;
  if (control === undefined || !control.supported) {
    return [];
  }
  const declared = new Set(control.commands ?? []);
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
  runId: string,
): boolean {
  const irreversible = new Set(manifest.safety_contract?.irreversible_components ?? []);
  if (irreversible.size === 0) {
    return true;
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
