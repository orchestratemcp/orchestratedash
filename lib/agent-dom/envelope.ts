/**
 * The Agent DOM command envelope: construction and idempotency derivation.
 *
 * `contracts/agent-command.schema.json` has been specified since MAR-382 and
 * has never been built by anything. This module is the first thing that builds
 * one, and it is pure — no clock, no randomness, no I/O. The caller injects
 * `now`, the nonce and the command id, exactly as `lib/workspace.ts` injects
 * `now`, because every interesting property of an envelope (expiry, replay,
 * duplication) is a boundary case that a module reading `Date.now()` internally
 * cannot be tested at.
 *
 * Two rules are structural here rather than defended at runtime:
 *
 * 1. **The actor is an input, never a payload field.** `buildEnvelope` takes an
 *    already-authenticated `CommandActor` from its caller, which in DASH is
 *    Electron main binding the transport principal. There is no code path that
 *    reads an actor out of a request, so the contract's "the runner binds
 *    `actor` to the transport-authenticated principal rather than trusting an
 *    unverified actor string" is enforced by there being no string to trust.
 * 2. **The idempotency key is derived, never random.** See `idempotencyKey`.
 *
 * The envelope is a document, not a decision. Whether it may run is
 * `lib/agent-dom/enforce.ts`; whether it has run before is
 * `lib/agent-dom/store.ts`.
 */

import { createHash } from "node:crypto";

import type { AgentCommand } from "../workspace";

/**
 * Who is asking. Shaped by the contract's `actor` object.
 *
 * `authenticated_by` is the honest part: DASH's local shell can only claim
 * `dash_session`, which means "the OS user running this copy of DASH". It is
 * not a multi-user identity and nothing here pretends otherwise.
 */
export interface CommandActor {
  id: string;
  type: "user" | "service";
  authenticated_by: "dash_session" | "signed_identity" | "runtime_adapter";
  display_name?: string;
}

export interface CommandTarget {
  agent_id: string;
  run_id?: string;
  task_id?: string;
  choice_id?: string;
  approval_id?: string;
  action_id?: string;
}

export interface AgentCommandEnvelope {
  command_version: 1;
  manifest_version: 2;
  command_id: string;
  command: AgentCommand;
  actor: CommandActor;
  target: CommandTarget;
  issued_at: string;
  expires_at: string;
  nonce: string;
  idempotency_key: string;
  payload?: {
    /** `choose` only. */
    option_id?: string;
    /**
     * The user's own words, forwarded to the runner for its record. Carried by
     * the envelope and deliberately *not* copied into DASH's command audit —
     * see `lib/agent-dom/store.ts`, which logs keys and never values.
     */
    reason?: string;
    /**
     * The `observed_at` of the Agent DOM state snapshot the control was
     * rendered from. Additive under the contract's forward-compatibility rule,
     * and load-bearing three times over: it scopes the idempotency key (below),
     * it lets the runner detect a stale display, and it is what makes "the
     * approval expired between display and execution" a checkable claim rather
     * than a guess.
     */
    observed_at?: string;
  };
  audit: { correlation_id: string; causation_id?: string };
}

/**
 * How long a freshly built envelope stays valid.
 *
 * Two minutes. DASH builds and submits in the same process, so this is slack
 * for a slow adapter round trip and nothing else — a longer window would only
 * widen the period in which a captured envelope is still replayable, and buys
 * a user who walked away from the screen nothing they want.
 */
export const COMMAND_TTL_MS = 120_000;

export interface EnvelopeInputs {
  command: AgentCommand;
  target: CommandTarget;
  /** Bound by the caller from the transport. Never read out of a request. */
  actor: CommandActor;
  /** The state snapshot the user acted on. */
  observed_at: string;
  option_id?: string;
  reason?: string;
  correlation_id: string;
  causation_id?: string;
  command_id: string;
  nonce: string;
  now: Date;
  ttl_ms?: number;
}

export function buildEnvelope(inputs: EnvelopeInputs): AgentCommandEnvelope {
  const issuedAt = inputs.now;
  const expiresAt = new Date(issuedAt.getTime() + (inputs.ttl_ms ?? COMMAND_TTL_MS));

  const payload: NonNullable<AgentCommandEnvelope["payload"]> = {
    observed_at: inputs.observed_at,
  };
  if (inputs.option_id !== undefined) {
    payload.option_id = inputs.option_id;
  }
  if (inputs.reason !== undefined) {
    payload.reason = inputs.reason;
  }

  return {
    command_version: 1,
    manifest_version: 2,
    command_id: inputs.command_id,
    command: inputs.command,
    actor: inputs.actor,
    target: inputs.target,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    nonce: inputs.nonce,
    idempotency_key: idempotencyKey(inputs),
    payload,
    audit:
      inputs.causation_id === undefined
        ? { correlation_id: inputs.correlation_id }
        : { correlation_id: inputs.correlation_id, causation_id: inputs.causation_id },
  };
}

/**
 * Length-prefix each field rather than joining on a separator.
 *
 * The contract puts no character restriction on an id, so any separator we
 * picked could in principle appear inside one — and then two different targets
 * could serialise to the same tuple and share an idempotency key, which for an
 * irreversible command means one of them silently never runs. Prefixing each
 * field with its length makes the encoding unambiguous whatever the ids hold.
 */
function canonical(fields: readonly string[]): string {
  return fields.map((field) => `${field.length}:${field}`).join("");
}

/** Bump when the tuple below changes, so old and new keys cannot collide. */
const IDEMPOTENCY_SCHEME = "dash-idem-v1";

/**
 * Derive the idempotency key from the *intent*, not from chance.
 *
 * A randomly generated key would make every duplicate a distinct command and
 * the whole mechanism dead on arrival — the second click of a double click
 * would sail through and perform the irreversible action twice. So the key is a
 * hash of what the user asked for, and two identical asks produce one key.
 *
 * The tuple includes `observed_at`, which is what makes it work in both
 * directions:
 *
 * - **A double click** happens against one snapshot, so both attempts derive
 *   the same key and the second returns the stored result without acting.
 * - **A deliberate second attempt** — the user watches a retry fail and retries
 *   again — happens against a *new* snapshot, so it derives a new key and is
 *   correctly allowed. Without a snapshot in the tuple, idempotency and
 *   legitimate repetition are irreconcilable: any rule strong enough to stop
 *   the double click also permanently bars the honest retry.
 *
 * `reason` is deliberately excluded. Editing a free-text note must not mint a
 * fresh key and thereby buy a second execution of an irreversible command.
 *
 * `observed_at` arrives from the renderer, which is untrusted, so on its own it
 * would be caller-controlled entropy: forge a value, get a new key, act twice.
 * That is closed in `lib/agent-dom/enforce.ts`, which requires the snapshot to
 * be one DASH actually holds. The derivation here is only half the defence.
 */
export function idempotencyKey(inputs: {
  command: AgentCommand;
  target: CommandTarget;
  observed_at: string;
  option_id?: string;
}): string {
  const tuple = canonical([
    IDEMPOTENCY_SCHEME,
    inputs.command,
    inputs.target.agent_id,
    inputs.target.run_id ?? "",
    inputs.target.task_id ?? "",
    inputs.target.choice_id ?? "",
    inputs.target.approval_id ?? "",
    inputs.target.action_id ?? "",
    inputs.option_id ?? "",
    inputs.observed_at,
  ]);

  return createHash("sha256").update(tuple, "utf8").digest("hex");
}

/**
 * Has this envelope outlived its own expiry?
 *
 * An unparseable `expires_at` counts as expired, which is the opposite of the
 * choice `lib/workspace.ts` makes for a display deadline — and deliberately so.
 * There, treating a bad timestamp as live keeps an item visible and lets the
 * runner decide; here, this *is* the decision, and the safe reading of "we
 * cannot tell when this stops being valid" is to refuse it.
 */
export function commandHasExpired(envelope: AgentCommandEnvelope, now: Date): boolean {
  const expiry = Date.parse(envelope.expires_at);
  return Number.isNaN(expiry) || expiry <= now.getTime();
}
