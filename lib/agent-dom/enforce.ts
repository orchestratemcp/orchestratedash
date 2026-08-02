/**
 * The enforcement decision: may this envelope run, right now, against this
 * agent's declared manifest and its current state?
 *
 * Pure, and takes `now` explicitly, for the same reason `lib/workspace.ts`
 * does — every rule in here has an expiry boundary and a boundary you cannot
 * stand exactly on is a boundary you cannot test.
 *
 * **This module re-implements none of the control rules.** "No dead controls"
 * and "no unenforceable approvals" already exist as pure logic in
 * `lib/workspace.ts`, and they are *called* here rather than restated:
 * `availableControls` decides whether the command is declared and meaningful,
 * `retryIsSafe` decides whether a retry could duplicate an irreversible write,
 * and `buildWorkInbox` decides whether an approval is one DASH may honestly
 * offer. A second copy of those rules in the command layer is exactly how the
 * button and the enforcement drift apart, which would turn a usability measure
 * into a security boundary by accident.
 *
 * The contract's own words for what a runner does: it "rejects expired
 * commands, unknown targets, unauthorized capabilities, used nonces, and stale
 * approvals". Used nonces are the one item not here, because a nonce is a
 * durable fact rather than a property of the documents — see
 * `lib/agent-dom/store.ts`.
 */

import { createHash } from "node:crypto";

import {
  availableControls,
  buildWorkInbox,
  retryIsSafe,
  type AgentDomState,
  type WorkspaceManifest,
} from "../workspace";
import { commandHasExpired, type AgentCommandEnvelope, type CommandTarget } from "./envelope";

/**
 * Why a command was refused.
 *
 * Every member is a *distinguishable* outcome, which is the point: the issue
 * asks for five rejections that can be told apart, and collapsing any two of
 * these would leave a user — or an auditor reading the log after the fact —
 * unable to tell "you waited too long" from "someone replayed your click" from
 * "this agent never offered that button". They also need different recoveries,
 * the same argument `SecureStoreErrorCode` makes for its members.
 */
export type CommandRejection =
  /** The envelope does not satisfy `agent-command.schema.json`. */
  | "invalid_envelope"
  /** The envelope outlived its own `expires_at` before reaching enforcement. */
  | "expired_command"
  /** This nonce has been seen before. Someone is replaying a command. */
  | "replayed_nonce"
  /** No such agent, run, task, approval or choice in anything DASH holds. */
  | "unknown_target"
  /** The snapshot the user acted on is not one DASH holds. */
  | "stale_snapshot"
  /** The manifest never declared this command, or it is not meaningful now. */
  | "undeclared_capability"
  /** Retrying could repeat an irreversible component that already executed. */
  | "retry_unsafe"
  /** The approval's own deadline passed between display and execution. */
  | "approval_expired"
  /** The approval was already decided or cancelled. Not expired — resolved. */
  | "approval_not_open"
  /** The approval exists but the runner will not independently enforce it. */
  | "approval_unenforceable"
  /** The choice's deadline passed between display and execution. */
  | "choice_expired"
  /** The choice was already answered. */
  | "choice_already_made"
  /** The chosen option is not one this choice offered. */
  | "unknown_option"
  /** No adapter could be reached to carry the command to its runner. */
  | "adapter_unavailable"
  /** The adapter was reached and the runner refused or failed. */
  | "adapter_failed";

export type EnforcementDecision =
  /**
   * `run_id` is null when the command targets something that belongs to no run
   * — the waiting task of an agent that only acts when asked (MAR-457). The
   * audit row then records no run rather than borrowing one, which is the point:
   * a correlation invented to fill a column is worse than an empty column.
   */
  | { accepted: true; run_id: string | null }
  | { accepted: false; reason: CommandRejection };

export interface EnforcementInputs {
  envelope: AgentCommandEnvelope;
  /** The imported manifest for the targeted agent, or null when unknown. */
  manifest: WorkspaceManifest | null;
  /** The latest snapshot DASH holds for that agent, or null when it holds none. */
  state: AgentDomState | null;
  now: Date;
}

function reject(reason: CommandRejection): EnforcementDecision {
  return { accepted: false, reason };
}

/* ---------------------------------------------------------------------- *
 * Decision identity
 * ---------------------------------------------------------------------- */

/**
 * What a user's decision actually depended on, reduced to one comparable value.
 *
 * ## Why this exists
 *
 * The freshness check below binds a command to "the snapshot DASH holds". Until
 * MAR-464 the thing it compared was `observed_at`, and `observed_at` is minted
 * by `runner/state.ts` on **every build** while `electron/agent-adapters.ts`
 * rebuilds every `POLL_INTERVAL_MS`. So the value moved on a timer whether or
 * not anything about the world had changed, and every control bound to a
 * rendered snapshot had roughly five seconds before it was refused as
 * `stale_snapshot`.
 *
 * That was not a bug in the rule. The rule — *"refuse a decision taken against
 * a world that has since moved"* — is the right rule, and it is worth most in
 * front of exactly the irreversible actions where the churn hurt most. The bug
 * was in what the rule was bound to: a **build timestamp is the identity of a
 * poll, not the identity of a decision context**, and binding to it conflated
 * "something changed" with "five seconds passed".
 *
 * This function is the honest binding. `lib/agent-dom/store.ts` holds
 * `observed_at` still while this value is unchanged, so the timestamp advances
 * when the decision context advances and not before.
 *
 * ## What is in, and why what is out is out
 *
 * In: everything any control decision reads. `availableControls` reads `status`
 * and run *statuses*; `buildWorkInbox` reads `choices`, `actions` and
 * `approval_requests`; `retryIsSafe` reads `plan_vs_actual.executed_components`;
 * `resolveTarget` reads `runs` and `tasks`. `connections` and
 * `approval_decisions` are in as well — no enforcement rule reads them today,
 * and a field left out because nothing happens to read it yet is a field that
 * silently stops invalidating decisions the day something does.
 *
 * Out, and each one deliberately:
 *
 * - `observed_at` itself, which is the whole point.
 * - `memory` and `audit_events`, which **grow while an agent works**. An agent
 *   writing an audit row must not invalidate a pending approval; if it did,
 *   this change would fix the idle case and leave the busy one broken, which is
 *   the failure mode most likely to reach a user.
 * - A run's `progress`, `current_step`, `started_at` and `finished_at`. These
 *   tick continuously during exactly the run an approval is usually blocking,
 *   and none of them changes whether any control is valid. `status` carries
 *   every transition that does, and it stays in.
 *
 * ## Canonical, not merely stringified
 *
 * Keys are sorted at every depth. A plain `JSON.stringify` would make the
 * identity depend on the key order an agent happened to serialise with, so an
 * agent that rebuilt a task from a `Map` between polls would churn the digest
 * with identical content — reintroducing the defect through a back door that no
 * test would obviously be about.
 */
export function decisionIdentity(state: AgentDomState): string {
  const projection = {
    agent_id: state.agent_id,
    status: state.status,
    connections: state.connections ?? [],
    runs: (state.runs ?? []).map((run) => ({ id: run.id, status: run.status })),
    tasks: state.tasks ?? [],
    choices: state.choices ?? [],
    actions: state.actions ?? [],
    approval_requests: state.approval_requests ?? [],
    approval_decisions: state.approval_decisions ?? [],
    plan_vs_actual: state.plan_vs_actual ?? null,
  };

  return createHash("sha256").update(canonicalJson(projection), "utf8").digest("hex");
}

/** `JSON.stringify` with object keys sorted at every depth. Arrays keep order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      // `undefined` is absent rather than null in a parsed document, but an
      // in-memory state object can carry it; dropping it here keeps the two
      // spellings of "this field is not set" from producing different digests.
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Decide, in the order that refuses the cheapest and most dangerous things
 * first.
 *
 * Expiry precedes target resolution so a stale envelope never gets to probe
 * which agents exist; snapshot freshness precedes target resolution because a
 * target resolved against a snapshot the user was not looking at is a target
 * resolved against the wrong world.
 */
export function enforceCommand(inputs: EnforcementInputs): EnforcementDecision {
  const { envelope, manifest, state, now } = inputs;

  if (commandHasExpired(envelope, now)) {
    return reject("expired_command");
  }

  // An agent DASH has never imported, or one it holds no state for, is a target
  // it cannot reason about at all. Both are `unknown_target` rather than a
  // "connect this agent first" hint: the command channel is not the place to
  // teach the caller what exists.
  if (manifest === null || state === null) {
    return reject("unknown_target");
  }
  if (state.agent_id !== envelope.target.agent_id) {
    return reject("unknown_target");
  }

  // The renderer supplies the snapshot it rendered from, and the renderer is
  // untrusted. Requiring the value to match a snapshot DASH actually holds is
  // what stops a forged `observed_at` from minting a fresh idempotency key and
  // buying a second execution of an irreversible command.
  //
  // The comparison is still exact, and deliberately so. What changed in MAR-464
  // is the value on both sides: `lib/agent-dom/store.ts` advances `observed_at`
  // only when `decisionIdentity` changes, so this now reads "the decision
  // context you acted on is the one DASH holds" rather than "you clicked within
  // one poll interval". Widening the comparison instead would have been the
  // tempting fix and the wrong one — a tolerance window is a window an attacker
  // aims at, and it would not have restored idempotency, which needs the two
  // clicks to derive the *same* key rather than merely both be accepted.
  if (envelope.payload?.observed_at !== state.observed_at) {
    return reject("stale_snapshot");
  }

  const target = resolveTarget(envelope, state);
  if (target.kind === "unknown") {
    return reject("unknown_target");
  }
  // Null means "this target belongs to no run", which is a real answer and not
  // a missing one. See `resolveTarget`.
  const runId = target.kind === "run" ? target.run_id : null;

  // Checked before `availableControls`, which folds retry safety into its
  // answer. Asking `retryIsSafe` first is what makes "this would repeat a
  // calendar invite" distinguishable from "this agent never offered retry".
  if (envelope.command === "retry" && !retryIsSafe(manifest, state, runId)) {
    return reject("retry_unsafe");
  }

  const offered = availableControls(manifest, state, runId);
  if (!offered.some((control) => control.command === envelope.command)) {
    return reject("undeclared_capability");
  }

  if (envelope.command === "approve" || envelope.command === "reject") {
    const decision = checkApproval(envelope, manifest, state, now);
    if (decision !== null) {
      return decision;
    }
  }

  if (envelope.command === "choose") {
    const decision = checkChoice(envelope, manifest, state, now);
    if (decision !== null) {
      return decision;
    }
  }

  return { accepted: true, run_id: runId };
}

/**
 * Which run this command acts on — or the fact that it acts on none.
 *
 * The contract lets a run-scoped command name either a `run_id` or a `task_id`,
 * so both are resolved here. A run named directly still has to exist in the
 * snapshot: accepting an id merely because it was well-formed is how "unknown
 * target" stops meaning anything.
 *
 * ## Why three answers rather than two
 *
 * This returned `string | null` until MAR-457, and `null` meant "no such
 * target". That conflated two different facts the moment a task could exist
 * before any run did: a `task_id` nobody has heard of, and a task that is
 * genuinely real and genuinely belongs to no run — which is exactly what an
 * agent waiting to be started publishes.
 *
 * Collapsing them made "Run now" indistinguishable from a forged target and it
 * was rejected as `unknown_target`. Reported by the installed smoke on its
 * first honest run, which is the entire argument for MAR-454.
 */
type ResolvedTarget =
  | { kind: "run"; run_id: string }
  /** The target exists and belongs to no run. A real answer, not a missing one. */
  | { kind: "no_run" }
  /** Nothing in the snapshot matches. */
  | { kind: "unknown" };

function resolveTarget(envelope: AgentCommandEnvelope, state: AgentDomState): ResolvedTarget {
  const { run_id: runId, task_id: taskId } = envelope.target;

  if (runId !== undefined) {
    const known = (state.runs ?? []).some((run) => run.id === runId);
    if (!known) {
      return { kind: "unknown" };
    }
    // When both are given they must agree. A command naming a task from one run
    // and a run id from another is either a bug or an attempt to aim an
    // authorised-looking command at a different run.
    if (taskId !== undefined) {
      const task = (state.tasks ?? []).find((candidate) => candidate.id === taskId);
      if (task === undefined || task.run_id !== runId) {
        return { kind: "unknown" };
      }
    }
    return { kind: "run", run_id: runId };
  }

  if (taskId !== undefined) {
    const task = (state.tasks ?? []).find((candidate) => candidate.id === taskId);
    if (task === undefined) {
      return { kind: "unknown" };
    }
    if (task.run_id === undefined) {
      // The waiting task of an agent that only acts when asked. Inventing a
      // correlation here would attach this command's audit trail to somebody
      // else's run, so it is reported as belonging to none.
      return { kind: "no_run" };
    }
    // A task naming a run the agent has not published is a target DASH cannot
    // verify, which is a different thing from a task with no run at all.
    return (state.runs ?? []).some((run) => run.id === task.run_id)
      ? { kind: "run", run_id: task.run_id }
      : { kind: "unknown" };
  }

  return { kind: "unknown" };
}

/**
 * Approval checks. Returns a rejection, or null when the approval is good.
 *
 * The work inbox is the authority on whether an approval is one DASH may offer,
 * because it is the same function the UI renders from. If the inbox would not
 * show it, the command layer will not run it — which is the honest reading of
 * "DASH never offers to approve an action the runner will not independently
 * enforce", applied at the moment it actually matters.
 */
function checkApproval(
  envelope: AgentCommandEnvelope,
  manifest: WorkspaceManifest,
  state: AgentDomState,
  now: Date,
): EnforcementDecision | null {
  const approvalId = envelope.target.approval_id;
  if (approvalId === undefined) {
    return reject("unknown_target");
  }

  const request = (state.approval_requests ?? []).find(
    (candidate) => candidate.id === approvalId,
  );
  if (request === undefined) {
    return reject("unknown_target");
  }
  if (request.task_id !== envelope.target.task_id) {
    return reject("unknown_target");
  }
  if (request.status !== "pending") {
    // Already approved, rejected, cancelled — or marked expired by the runner
    // itself, which is a real expiry and reported as one.
    return request.status === "expired"
      ? reject("approval_expired")
      : reject("approval_not_open");
  }

  const item = buildWorkInbox(manifest, state, now).find(
    (candidate) => candidate.kind === "approval" && candidate.id === approvalId,
  );
  if (item === undefined) {
    // Pending, present, and still filtered out: the only remaining reason is
    // that the runner does not enforce it.
    return reject("approval_unenforceable");
  }
  if (item.expired) {
    // The case the issue names: the button was live when it was drawn and the
    // deadline passed before the click reached enforcement.
    return reject("approval_expired");
  }

  return null;
}

function checkChoice(
  envelope: AgentCommandEnvelope,
  manifest: WorkspaceManifest,
  state: AgentDomState,
  now: Date,
): EnforcementDecision | null {
  const choiceId = envelope.target.choice_id;
  const optionId = envelope.payload?.option_id;
  if (choiceId === undefined || optionId === undefined) {
    return reject("unknown_target");
  }

  const choice = (state.choices ?? []).find((candidate) => candidate.id === choiceId);
  if (choice === undefined || choice.task_id !== envelope.target.task_id) {
    return reject("unknown_target");
  }
  if (choice.selected_option_id !== undefined) {
    return reject("choice_already_made");
  }
  if (!choice.options.some((option) => option.id === optionId)) {
    // The contract has the runner recheck "the selected option" before the side
    // effect. This is DASH doing the same check it will be held to.
    return reject("unknown_option");
  }

  const item = buildWorkInbox(manifest, state, now).find(
    (candidate) => candidate.kind === "choice" && candidate.id === choiceId,
  );
  if (item === undefined) {
    return reject("unknown_target");
  }
  if (item.expired) {
    return reject("choice_expired");
  }

  return null;
}

/**
 * The audit correlation to use for a command, accepted or refused.
 *
 * Taken from the targeted resource when it carries one — approval requests
 * carry an `audit.correlation_id` by contract — so that a command shares an id
 * with the request that prompted it *and with every other attempt against the
 * same approval*. That is what makes "accepted and rejected attempts share the
 * supplied audit correlation" true of the correlation the contract documents
 * supplied, rather than of one DASH invented for each attempt.
 *
 * It is also why the renderer is never asked for this value. A correlation
 * chosen by the caller is a correlation an attacker can use to file their
 * attempts under someone else's investigation.
 *
 * Resolution happens *before* the envelope is built, so it takes a target
 * rather than an envelope. `fallback` is used when there is no resource to
 * inherit from, which is honest: there was nothing to correlate it with.
 */
export function correlationFor(
  target: CommandTarget,
  state: AgentDomState | null,
  fallback: string,
): { correlation_id: string; causation_id?: string } {
  const approvalId = target.approval_id;
  if (state !== null && approvalId !== undefined) {
    const request = (state.approval_requests ?? []).find(
      (candidate) => candidate.id === approvalId,
    );
    // `lib/workspace.ts` declares only the approval fields it renders, and
    // `audit` is not one of them — the state schema requires it regardless, so
    // it is read defensively rather than assumed present.
    const correlation = (request as { audit?: { correlation_id?: string } } | undefined)?.audit
      ?.correlation_id;
    if (typeof correlation === "string" && correlation.length > 0) {
      return { correlation_id: correlation, causation_id: approvalId };
    }
  }
  return { correlation_id: fallback };
}
