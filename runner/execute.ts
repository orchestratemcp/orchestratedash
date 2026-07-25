/**
 * The runner's own adjudication of a command.
 *
 * `lib/agent-dom/runner.ts` already ran a version of these checks before the
 * envelope left DASH. **That does not discharge them.** The Agent DOM v2
 * contract puts the obligation on the runner explicitly — it "validates
 * commands, checks authorization, persists approvals and replay records,
 * enforces gates immediately before side effects" — and the reason is in the
 * threat model: the entry for a compromised DASH assumes it "can request any
 * displayed action", and the mitigation is that "the runner still authenticates,
 * authorizes, checks expiry/replay/approval". A runner that trusted DASH's
 * checks would be the mitigation not existing.
 *
 * So the order below deliberately repeats DASH's, against the runner's own
 * durable state, and the two stores never consult each other.
 *
 * ## What the runner can and cannot authenticate
 *
 * It authenticates the **channel**: the bearer token proves the caller is the
 * DASH installation this runner was enrolled with. It cannot independently
 * authenticate the *human*, because there is nothing to check them against —
 * DASH's own principal is `dash_session`, which means "the OS user running this
 * copy of DASH", and no token, signature or directory backs it.
 *
 * That is a real gap and it is named rather than papered over: the runner
 * enforces that the channel may only assert the kinds of actor it is enrolled
 * to assert, records the actor as DASH's claim, and stops there. Adapter
 * enrollment and concrete session authentication are on the contract's deferred
 * list, and `assertableActorTypes` is the function that changes when they land.
 */

import type { DatabaseSync } from "node:sqlite";

import { validateCommand } from "../lib/contracts";
import { commandHasExpired, type AgentCommandEnvelope } from "../lib/agent-dom/envelope";
import { buildAgentDomState } from "./state";
import {
  claimResult,
  readResult,
  recordApprovalDecision,
  recordNonce,
  settleResult,
  transact,
  writeRunnerAudit,
  type RunnerOutcome,
} from "./store";
import type { Supervisor } from "./supervisor";

/**
 * Why the runner refused.
 *
 * Overlaps DASH's `CommandRejection` by design — the same conditions have the
 * same names on both sides of the channel so an investigator reading two audit
 * trails is reading one vocabulary — but this is a separate type because the
 * runner has refusals DASH cannot have (`unauthenticated_channel`,
 * `unassertable_actor`, `agent_not_running`) and lacks ones only DASH can make.
 */
export type RunnerRejection =
  | "invalid_envelope"
  | "unassertable_actor"
  | "expired_command"
  | "replayed_nonce"
  | "unknown_target"
  | "undeclared_capability"
  | "approval_not_open"
  | "approval_expired"
  | "agent_not_running"
  | "delivery_unacknowledged"
  | "agent_refused";

export interface ChannelPrincipal {
  /** Which enrolled channel this is. One per adapter; `dash-local` for the shell. */
  channel_id: string;
  /**
   * The `authenticated_by` values this channel may put in an envelope's actor.
   *
   * The local shell may assert `dash_session` and nothing else. A channel
   * claiming `signed_identity` would be claiming a verification nobody
   * performed, and the runner refuses it rather than storing the claim.
   */
  may_assert: readonly string[];
}

export const DASH_LOCAL_PRINCIPAL: ChannelPrincipal = {
  channel_id: "dash-local",
  may_assert: ["dash_session"],
};

export interface ExecuteResult {
  ok: boolean;
  command_id: string;
  reason?: RunnerRejection;
  detail?: string;
  duplicate?: boolean;
}

export interface ExecuteContext {
  database: DatabaseSync;
  supervisor: Supervisor;
  principal: ChannelPrincipal;
  now?: () => Date;
}

/**
 * Adjudicate one envelope and, if it survives, deliver it.
 *
 * Written as one readable function for the same reason DASH's is: the order of
 * the checks is the security argument, and an auditor should be able to read it
 * without following a chain of helpers.
 */
export async function executeCommand(
  input: unknown,
  context: ExecuteContext,
): Promise<ExecuteResult> {
  const now = context.now?.() ?? new Date();
  const decidedAt = now.toISOString();
  const { database, supervisor } = context;

  // 0. The envelope must satisfy the contract. Unlike DASH, which built the
  //    document it validates, the runner genuinely received this from another
  //    process — so this is the check doing its actual job rather than
  //    guarding against our own bug.
  const validation = validateCommand(input);
  if (!validation.ok) {
    // Nothing here is safe to correlate on: an envelope that failed validation
    // has no trustworthy correlation id to file the refusal under.
    return {
      ok: false,
      command_id: "unknown",
      reason: "invalid_envelope",
      detail: validation.errors.slice(0, 5).join("; "),
    };
  }
  const envelope = validation.value;
  const agentId = envelope.target.agent_id;

  const finish = (
    decision: "accepted" | "refused" | "duplicate",
    result: ExecuteResult,
  ): ExecuteResult => {
    transact(database, () =>
      writeRunnerAudit(database, {
        command_id: envelope.command_id,
        correlation_id: envelope.audit.correlation_id,
        agent: agentId,
        command: envelope.command,
        actor_id: envelope.actor.id,
        decision,
        reason_code: result.reason,
        // The free-text reason is never in an audit row, here or in DASH. It is
        // in `approval_decisions`, which is the record it belongs to.
        detail: result.detail,
        decided_at: decidedAt,
      }),
    );
    return result;
  };

  // 1. May this channel assert this kind of actor at all? Before anything
  //    durable: a channel that is not entitled to speak for this actor should
  //    not get to burn a nonce on the attempt.
  if (!context.principal.may_assert.includes(envelope.actor.authenticated_by)) {
    return finish("refused", {
      ok: false,
      command_id: envelope.command_id,
      reason: "unassertable_actor",
      detail:
        `Channel "${context.principal.channel_id}" may not assert an actor ` +
        `authenticated by "${envelope.actor.authenticated_by}".`,
    });
  }

  // 2. A known duplicate returns the first attempt's answer and performs
  //    nothing — the contract's "returns the same result for duplicates",
  //    enforced where the effect actually happens.
  const existing = readResult(database, envelope.idempotency_key);
  if (existing !== null) {
    return finish("duplicate", {
      ok: existing.outcome.ok,
      command_id: envelope.command_id,
      detail: existing.outcome.detail,
      duplicate: true,
    });
  }

  // 3. Expiry, before anything durable is written.
  if (commandHasExpired(envelope, now)) {
    return finish("refused", {
      ok: false,
      command_id: envelope.command_id,
      reason: "expired_command",
      detail: "This command outlived its own expires_at before the runner saw it.",
    });
  }

  // 4. Replay, on the runner's own nonce table. DASH's nonce table proves
  //    nothing here: a replay that never went through DASH would not be in it.
  const fresh = transact(database, () =>
    recordNonce(database, envelope.nonce, agentId, envelope.command_id, decidedAt),
  );
  if (!fresh) {
    return finish("refused", {
      ok: false,
      command_id: envelope.command_id,
      reason: "replayed_nonce",
      detail: "This nonce has been used before.",
    });
  }

  // 5. Is this an agent the runner supervises, and is it up?
  const facts = supervisor.facts(agentId);
  if (facts === null) {
    return finish("refused", {
      ok: false,
      command_id: envelope.command_id,
      reason: "unknown_target",
      detail: `No agent is registered as "${agentId}".`,
    });
  }

  // 6. Capability, from the agent's *own* manifest as the runner read it at
  //    start. The contract's "recheck capability at execution", against the
  //    document the agent author wrote rather than the one DASH imported.
  if (!supervisor.commands(agentId).includes(envelope.command)) {
    return finish("refused", {
      ok: false,
      command_id: envelope.command_id,
      reason: "undeclared_capability",
      detail: `"${agentId}" does not declare the "${envelope.command}" command.`,
    });
  }

  // 7. Is the process up? Before the approval recheck, not after, because a
  //    stopped agent publishes no approvals — so checking the approval first
  //    would refuse with "there is no such approval" when the true and far more
  //    useful answer is "the agent is not running". Both are refusals; only one
  //    tells the user what to do about it.
  if (facts.lifecycle !== "running" && facts.lifecycle !== "starting") {
    return finish("refused", {
      ok: false,
      command_id: envelope.command_id,
      reason: "agent_not_running",
      detail: `"${agentId}" is not running, so the command cannot be delivered.`,
    });
  }

  // 8. Approvals get rechecked immediately before the effect, against both the
  //    runner's durable decisions and the agent's live state. This is the
  //    contract's "The runner rechecks the approval status, expiry, selected
  //    option, actor authorization, and target immediately before the side
  //    effect", and it is the check DASH's equivalent cannot substitute for:
  //    DASH tested a snapshot that was already old when it was sent.
  if (envelope.command === "approve" || envelope.command === "reject") {
    const state = buildAgentDomState(facts, supervisor.report(agentId), now);
    const problem = recheckApproval(database, envelope, state, now);
    if (problem !== null) {
      return finish("refused", { ok: false, command_id: envelope.command_id, ...problem });
    }
  }

  // 9. Claim the key before the effect, per the contract.
  const claimed = transact(database, () =>
    claimResult(
      database,
      envelope.idempotency_key,
      agentId,
      envelope.command,
      envelope.command_id,
      decidedAt,
    ),
  );
  if (claimed !== null) {
    return finish("duplicate", {
      ok: claimed.outcome.ok,
      command_id: envelope.command_id,
      detail: claimed.outcome.detail,
      duplicate: true,
    });
  }

  // 10. Deliver, and wait to be told it was handled.
  const delivery = await supervisor.deliver(agentId, {
    command_id: envelope.command_id,
    command: envelope.command,
    target: envelope.target,
    payload: {
      option_id: envelope.payload?.option_id,
      reason: envelope.payload?.reason,
    },
  });

  const outcome: RunnerOutcome = delivery.ok
    ? { ok: true, detail: delivery.detail }
    : { ok: false, detail: delivery.detail };
  transact(database, () => {
    settleResult(database, envelope.idempotency_key, outcome, new Date().toISOString());

    // The approval decision is recorded *after* the agent acknowledged, not
    // before. A decision written for a command the agent never received would
    // close the approval against a retry that ought to succeed — and the human
    // did decide, but nothing acted on it, so the honest record is the one that
    // says so only once something did.
    if (delivery.ok && (envelope.command === "approve" || envelope.command === "reject")) {
      const approvalId = envelope.target.approval_id;
      if (approvalId !== undefined) {
        recordApprovalDecision(database, {
          request_id: approvalId,
          agent: agentId,
          decision: envelope.command === "approve" ? "approved" : "rejected",
          actor_id: envelope.actor.id,
          command_id: envelope.command_id,
          reason: envelope.payload?.reason,
          decided_at: decidedAt,
        });
      }
    }
  });

  if (!delivery.ok) {
    return finish("refused", {
      ok: false,
      command_id: envelope.command_id,
      reason: delivery.problem === "refused" ? "agent_refused" : "delivery_unacknowledged",
      detail: delivery.detail,
    });
  }

  return finish("accepted", {
    ok: true,
    command_id: envelope.command_id,
    detail: delivery.detail,
  });
}

/**
 * The approval recheck: the runner's durable record first, the agent's live
 * state second.
 *
 * Order matters. The durable record is the runner's own and cannot have been
 * rewritten by a confused or hostile agent; the live state is the agent's claim
 * and is only consulted for things the runner does not itself track, like when
 * the request expires.
 */
function recheckApproval(
  database: DatabaseSync,
  envelope: AgentCommandEnvelope,
  state: Record<string, unknown>,
  now: Date,
): { reason: RunnerRejection; detail: string } | null {
  const approvalId = envelope.target.approval_id;
  if (approvalId === undefined) {
    return {
      reason: "unknown_target",
      detail: "An approve or reject command must name the approval it decides.",
    };
  }

  const decided = readApprovalDecisionRow(database, approvalId);
  if (decided !== null) {
    return {
      reason: "approval_not_open",
      detail: `Approval "${approvalId}" was already ${decided} by this runner.`,
    };
  }

  const requests = state["approval_requests"];
  const request = Array.isArray(requests)
    ? (requests.find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          (candidate as Record<string, unknown>)["id"] === approvalId,
      ) as Record<string, unknown> | undefined)
    : undefined;

  if (request === undefined) {
    return {
      reason: "unknown_target",
      detail: `The agent has no open approval "${approvalId}".`,
    };
  }
  if (request["status"] !== "pending") {
    return {
      reason: "approval_not_open",
      detail: `Approval "${approvalId}" is ${String(request["status"])}.`,
    };
  }

  const expiresAt = Date.parse(String(request["expires_at"]));
  // An unparseable expiry counts as expired, matching `commandHasExpired`: the
  // safe reading of "we cannot tell when this stops being valid" is to refuse.
  if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) {
    return {
      reason: "approval_expired",
      detail: `Approval "${approvalId}" expired before the runner could act on it.`,
    };
  }

  return null;
}

function readApprovalDecisionRow(database: DatabaseSync, requestId: string): string | null {
  const row = database
    .prepare("SELECT decision FROM approval_decisions WHERE request_id = ?")
    .get(requestId);
  return row === undefined ? null : String(row["decision"]);
}
