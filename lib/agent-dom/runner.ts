/**
 * The runner: the one path from a reviewed renderer intent to an Agent DOM
 * command that actually leaves DASH.
 *
 * ADR 0001 puts the command client in Electron main "on the trusted side of the
 * process boundary", so that "a compromised renderer cannot forge a command
 * without crossing an auditable seam". This module is that side. Everything it
 * needs that the renderer could lie about — who is asking, what time it is,
 * what nonce to use, which snapshot exists — it obtains here and never accepts.
 *
 * The sequence below is the whole security argument, and it is written as one
 * readable function on purpose: an auditor should be able to see the order of
 * the checks without following a chain of helpers. The order matters:
 *
 * 1. **A known duplicate short-circuits everything.** A second click must
 *    return the first click's answer, not a fresh opinion about it.
 * 2. **Expiry before anything durable.** An expired envelope must not burn a
 *    nonce or claim an idempotency key; those would penalise the honest
 *    re-issue that follows.
 * 3. **Nonce before enforcement.** Replay is the attack, so it is detected on
 *    its own terms rather than as a side effect of some later check happening
 *    to fail.
 * 4. **Enforcement before the key is claimed.** A refused command has performed
 *    no effect, so it must leave no idempotency record to block the corrected
 *    attempt.
 * 5. **The key is claimed before the adapter is called**, per the contract's
 *    "store the idempotency result before or with an irreversible effect".
 *
 * Every one of those outcomes is written to `command_audit`. The issue's
 * requirement is that rejections are audited, not merely accepted commands, and
 * the way that is guaranteed here is that `finish()` is the only way out of
 * this function.
 */

import { isManifestV2, validateCommand } from "../contracts";
import { db, transact } from "../db";
import { readAgentManifest } from "../store";
import type { AgentCommand, WorkspaceManifest } from "../workspace";
import {
  correlationFor,
  enforceCommand,
  type CommandRejection,
} from "./enforce";
import {
  buildEnvelope,
  commandHasExpired,
  type AgentCommandEnvelope,
  type CommandActor,
  type CommandTarget,
} from "./envelope";
import {
  claimIdempotencyKey,
  formatCommandAuditLine,
  readAgentDomState,
  readCommandResult,
  recordNonce,
  settleCommandResult,
  writeCommandAudit,
  type AgentCommandAuditRecord,
  type CommandOutcome,
} from "./store";

/* ---------------------------------------------------------------------- *
 * The adapter seam
 * ---------------------------------------------------------------------- */

export type AdapterOutcome =
  | { ok: true; detail?: string }
  | { ok: false; reason: "adapter_unavailable" | "adapter_failed"; detail?: string };

/**
 * What carries a command to the runner that owns the agent.
 *
 * An injected port, like `lib/vault.ts`'s `safeStorage` port, for the same
 * reason: the rules around it can then be tested exhaustively without the thing
 * behind it existing. **Nothing in this repository implements it yet.** The
 * bundled runner is MAR-415 (DASH-11) and the HTTP transport profile v0 is a
 * later slice; until one of those lands, every command DASH accepts stops at
 * this interface.
 *
 * That is stated plainly rather than papered over with a stub that returns
 * success: a command channel that reports "done" for an effect nothing
 * performed is precisely the dishonesty this issue's rules exist to prevent.
 */
export interface AgentDomAdapter {
  submit(envelope: AgentCommandEnvelope): Promise<AdapterOutcome>;
}

/**
 * The adapter used when an agent has none.
 *
 * A remote agent-managed agent with no control endpoint stays visibly
 * read-only; this is what "read-only" means once a command has somehow been
 * constructed anyway. It refuses, and the refusal is audited like any other.
 */
export const noAdapter: AgentDomAdapter = {
  submit(): Promise<AdapterOutcome> {
    return Promise.resolve({
      ok: false,
      reason: "adapter_unavailable",
      detail: "No adapter is installed for this agent, so DASH cannot reach its runner.",
    });
  },
};

/* ---------------------------------------------------------------------- *
 * Inputs and outputs
 * ---------------------------------------------------------------------- */

/**
 * A reviewed renderer intent.
 *
 * Produced by `lib/shell/ipc.ts` after the payload has passed the command
 * allowlist. Note what is absent and cannot be supplied: an actor, a nonce, an
 * expiry, a correlation id, an idempotency key. Those are minted here, so the
 * renderer has no way to express them even incorrectly.
 */
export interface AgentCommandInput {
  request_id: string;
  command: AgentCommand;
  target: CommandTarget;
  /** The `observed_at` of the snapshot the control was rendered from. */
  observed_at: string;
  option_id?: string;
  /** Travels to the runner in the envelope; never enters the audit table. */
  reason?: string;
  /** Names only, for the audit record. */
  payload_keys: string[];
  mutates: boolean;
  irreversible: boolean;
}

export interface CommandRuntime {
  /**
   * The transport-authenticated principal, bound by the caller.
   *
   * In Electron main this comes from the process's own session, never from the
   * request. The contract's rule is that "the runner binds `actor` to the
   * transport-authenticated principal rather than trusting an unverified actor
   * string", and passing it in as a parameter is how that is made true here.
   */
  principal: CommandActor;
  adapter: AgentDomAdapter;
  /** Injected so expiry can be tested at the boundary. Defaults to the wall clock. */
  now?: () => Date;
  /** Injected so ids are deterministic under test. Defaults to a random UUID. */
  newId?: () => string;
  /** Injected likewise. Defaults to 32 bytes of CSPRNG output. */
  newNonce?: () => string;
  /**
   * How long the envelope stays valid. Defaults to `COMMAND_TTL_MS`.
   *
   * A knob rather than a constant because the transport decides what a sane
   * window is: an in-process dispatch wants seconds, the contract's HTTP
   * profile over a slow link wants more. It is also the only way to observe the
   * expiry rejection on the real audited path, since a command built and
   * checked against the same clock is otherwise never old enough to fail.
   */
  ttl_ms?: number;
}

export interface AgentCommandResult {
  ok: boolean;
  request_id: string;
  command_id: string;
  correlation_id: string;
  reason?: CommandRejection;
  /** True when the stored result of an earlier identical command was returned. */
  duplicate?: boolean;
  detail?: string;
}

/* ---------------------------------------------------------------------- *
 * The pipeline
 * ---------------------------------------------------------------------- */

export async function runAgentCommand(
  input: AgentCommandInput,
  runtime: CommandRuntime,
): Promise<AgentCommandResult> {
  const now = runtime.now?.() ?? new Date();
  const decidedAt = now.toISOString();
  const commandId = runtime.newId?.() ?? randomId();
  const database = db();

  const snapshot = readAgentDomState(input.target.agent_id);
  const state = snapshot?.state ?? null;
  const manifest = workspaceManifest(input.target.agent_id);

  // Resolved from the targeted resource, not supplied by the caller, so that
  // every attempt against one approval — the accepted one and the rejected
  // ones — files under the same correlation.
  const correlation = correlationFor(input.target, state, commandId);

  const envelope = buildEnvelope({
    command: input.command,
    target: input.target,
    actor: runtime.principal,
    observed_at: input.observed_at,
    option_id: input.option_id,
    reason: input.reason,
    correlation_id: correlation.correlation_id,
    causation_id: correlation.causation_id,
    command_id: commandId,
    nonce: runtime.newNonce?.() ?? randomNonce(),
    now,
    ttl_ms: runtime.ttl_ms,
  });

  /** The single exit. Every return below goes through it, so nothing escapes unaudited. */
  const finish = (
    decision: AgentCommandAuditRecord["decision"],
    outcome: { reason?: CommandRejection; detail?: string; duplicate?: boolean },
    runId: string | null,
  ): AgentCommandResult => {
    const record: AgentCommandAuditRecord = {
      command_id: commandId,
      request_id: input.request_id,
      correlation_id: correlation.correlation_id,
      causation_id: correlation.causation_id,
      agent: input.target.agent_id,
      run_id: runId,
      command: input.command,
      actor_id: runtime.principal.id,
      actor_type: runtime.principal.type,
      authenticated_by: runtime.principal.authenticated_by,
      decision,
      reason: outcome.reason,
      payload_keys: input.payload_keys,
      mutates: input.mutates,
      irreversible: input.irreversible,
      issued_at: envelope.issued_at,
      expires_at: envelope.expires_at,
      decided_at: decidedAt,
    };
    transact(database, () => writeCommandAudit(database, record));
    console.warn(formatCommandAuditLine(record));

    return {
      ok: decision === "allowed",
      request_id: input.request_id,
      command_id: commandId,
      correlation_id: correlation.correlation_id,
      reason: outcome.reason,
      duplicate: outcome.duplicate,
      detail: outcome.detail,
    };
  };

  // 0. The envelope must satisfy the contract it claims to be. DASH built this
  //    one, so a failure here is a DASH bug — which is exactly why it is
  //    checked rather than assumed, and why the same seam can later accept an
  //    envelope built somewhere else.
  const validation = validateCommand(envelope);
  if (!validation.ok) {
    return finish("denied", { reason: "invalid_envelope" }, null);
  }

  // 1. A duplicate returns the first attempt's answer and performs nothing.
  const existing = readCommandResult(database, envelope.idempotency_key);
  if (existing !== null) {
    return finish(
      "duplicate",
      { duplicate: true, detail: existing.outcome.detail, reason: existing.outcome.reason },
      null,
    );
  }

  // 2. Expiry, before anything durable is written.
  if (commandHasExpired(envelope, now)) {
    return finish("denied", { reason: "expired_command" }, null);
  }

  // 3. Replay. The INSERT is the check; see `recordNonce`.
  const fresh = transact(database, () => recordNonce(database, envelope, decidedAt));
  if (!fresh) {
    return finish("denied", { reason: "replayed_nonce" }, null);
  }

  // 4. The rules: target, capability, approval and choice state. All of it
  //    delegated to `lib/workspace.ts` where those rules already live.
  const decision = enforceCommand({ envelope, manifest, state, now });
  if (!decision.accepted) {
    return finish("denied", { reason: decision.reason }, null);
  }

  // 5. Claim the key before the effect. Losing the race means another
  //    submission owns the effect and this one is a duplicate after all.
  const claimed = transact(database, () =>
    claimIdempotencyKey(database, envelope, decidedAt),
  );
  if (claimed !== null) {
    return finish(
      "duplicate",
      { duplicate: true, detail: claimed.outcome.detail, reason: claimed.outcome.reason },
      decision.run_id,
    );
  }

  // The decision is audited before the dispatch rather than after it. If DASH
  // dies mid-flight, the trail still shows that it allowed the command, and the
  // `in_flight` result row shows that the outcome is unknown. Auditing only on
  // completion would lose the more important of those two facts.
  const allowed = finish("allowed", {}, decision.run_id);

  const outcome = await runtime.adapter.submit(envelope);
  const settled: CommandOutcome = outcome.ok
    ? { ok: true, detail: outcome.detail }
    : { ok: false, reason: outcome.reason, detail: outcome.detail };
  transact(database, () =>
    settleCommandResult(
      database,
      envelope.idempotency_key,
      settled,
      (runtime.now?.() ?? new Date()).toISOString(),
    ),
  );

  if (!outcome.ok) {
    // A second audit row, not an edit of the first. Two things happened — DASH
    // allowed the command, and it could not be delivered — and an audit trail
    // that overwrote the first with the second would be claiming DASH refused
    // something it in fact authorised.
    return finish("denied", { reason: outcome.reason, detail: outcome.detail }, decision.run_id);
  }

  return { ...allowed, detail: outcome.detail };
}

/* ---------------------------------------------------------------------- *
 * Identity and randomness
 * ---------------------------------------------------------------------- */

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * The contract requires a nonce of at least 16 characters and calls it
 * "high-entropy". 32 bytes of CSPRNG output, base64url, is both.
 */
function randomNonce(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

/**
 * The manifest as `lib/workspace.ts` wants to see it, or null.
 *
 * v1 manifests return null rather than an empty Agent DOM. A v1 manifest is too
 * old to declare any command, and the contract is explicit that "missing
 * controls mean read-only, not inferred controls" — so a v1 agent is not an
 * agent with no commands, it is an agent DASH cannot command at all.
 */
function workspaceManifest(agent: string): WorkspaceManifest | null {
  const manifest = readAgentManifest(agent);
  if (manifest === null || !isManifestV2(manifest)) {
    return null;
  }
  return manifest as unknown as WorkspaceManifest;
}

/**
 * The principal for DASH's own local shell.
 *
 * `dash_session` is the honest claim: there is one OS user running this copy of
 * DASH, DASH did not authenticate them, and the operating system did. It is not
 * a multi-user identity, there is no session token behind it, and nothing here
 * pretends otherwise. When adapter enrollment and real session authentication
 * arrive (both listed as deferred in the Agent DOM v2 contract), this is the
 * function that changes.
 */
export function localPrincipal(userName: string): CommandActor {
  return {
    id: userName,
    type: "user",
    authenticated_by: "dash_session",
    display_name: userName,
  };
}
