/**
 * The audited-command chokepoint.
 *
 * ADR 0001's "Gained" section claims the IPC boundary "gives the 'audited
 * commands' requirement a natural, enforceable chokepoint". This module is
 * where that claim is cashed in — and it is pure, so the enforcement can be
 * tested without launching Electron.
 *
 * The shape that makes it a chokepoint rather than a suggestion:
 *
 * - **One channel, not one per command.** `electron/main.ts` registers exactly
 *   one `ipcMain.handle`. A future command is a new entry in `COMMANDS` below,
 *   which means it passes through `reviewCommand` and produces an audit record
 *   by construction. Per-command handlers would let the next command be added
 *   without ever touching the audit path — the failure this design exists to
 *   prevent.
 * - **Allowlist, not denylist.** An unknown command is denied and audited.
 * - **No secrets cross this boundary.** The renderer never sends or receives a
 *   credential; `SecureStore` lives in main and stays there. That is enforced
 *   below, not merely intended: payloads are restricted to declared, non-secret
 *   fields, so a command *cannot* be given a secret-shaped argument.
 *
 * MAR-383 shipped one command, `shell.ping`, which does nothing. MAR-417 adds
 * the seven Agent DOM commands, and adds them *here* — the point of the design
 * above being that there was no other way to add them.
 *
 * What the renderer may say about an agent command is deliberately thin:
 * which agent, which run or task, which approval or choice, and which snapshot
 * it was looking at. It cannot name an actor, mint a nonce, set an expiry,
 * choose a correlation id or supply an idempotency key — not because those are
 * rejected, but because no command declares a payload key for them. They are
 * minted in `lib/agent-dom/runner.ts`, on the trusted side, which is what ADR
 * 0001 means by the IPC boundary being the auditable seam.
 */

import type {
  AgentCommandInput,
  AgentCommandResult,
} from "../agent-dom/runner";
import type { AgentCommand } from "../workspace";

/** The single IPC channel. Everything audited goes through it. */
export const SHELL_COMMAND_CHANNEL = "dash:shell-command";

/* ---------------------------------------------------------------------- *
 * Command catalogue
 * ---------------------------------------------------------------------- */

export interface CommandSpec {
  /**
   * Plain-language description of what invoking this does, written for the
   * audit log's human reader rather than for a developer.
   */
  effect: string;
  /**
   * Payload keys this command accepts. Every accepted value must be a string,
   * number or boolean — see `reviewCommand`. Commands needing anything richer
   * should be reviewed on their own merits rather than by loosening this.
   */
  payload_keys: readonly string[];
  /**
   * Keys without which the command is meaningless. Absent ones are a denial,
   * not a default.
   *
   * Added in MAR-417: until then every command's fields were optional, which
   * was fine for a no-op and is not fine for a command that names the approval
   * it is about. Filling in a missing target with a guess is how a command aimed
   * at nothing becomes a command aimed at something.
   */
  required_keys: readonly string[];
  /**
   * True when the command changes state anywhere: disk, vault, an agent, the
   * network. `shell.ping` is the only command that can honestly say false, and
   * marking it explicitly keeps "does nothing" an asserted property rather than
   * an assumption.
   */
  mutates: boolean;
  /**
   * True when running it twice could do harm no one can undo — a second
   * calendar invite, a second payment.
   *
   * Duplicate suppression in `lib/agent-dom/runner.ts` applies to every command
   * regardless; this flag records which ones it *matters* for, and is written
   * into the audit trail so a reader can tell a repeated pause from a repeated
   * approval without knowing the catalogue by heart.
   */
  irreversible: boolean;
}

/**
 * Every command the renderer may invoke. Adding an entry here is the *only*
 * way to add a command, and is a deliberate review event.
 *
 * The Agent DOM entries are exactly the seven verbs of
 * `contracts/agent-command.schema.json` and `agent.manifest.v2.schema.json`.
 * There is no `agent.start`, `agent.stop` or `agent.trigger`: the contract's
 * command vocabulary does not contain them, and inventing a name here for
 * something no manifest can declare would give DASH a button no adapter is
 * obliged to honour. Starting and stopping a locally hosted process is runner
 * lifecycle, not an Agent DOM command, and belongs to MAR-415 (DASH-11).
 */
export const COMMANDS = {
  "shell.ping": {
    effect: "Confirm the shell's command boundary is reachable. Changes nothing.",
    payload_keys: ["issued_at"],
    required_keys: [],
    mutates: false,
    irreversible: false,
  },

  "agent.approve": {
    effect: "Approve a guarded action the agent is waiting on. The runner performs it.",
    payload_keys: ["agent_id", "task_id", "approval_id", "action_id", "observed_at", "reason"],
    required_keys: ["agent_id", "task_id", "approval_id", "observed_at"],
    mutates: true,
    irreversible: true,
  },
  "agent.reject": {
    effect: "Refuse a guarded action the agent is waiting on. The runner will not perform it.",
    payload_keys: ["agent_id", "task_id", "approval_id", "action_id", "observed_at", "reason"],
    required_keys: ["agent_id", "task_id", "approval_id", "observed_at"],
    mutates: true,
    irreversible: true,
  },
  "agent.choose": {
    effect: "Answer a choice the agent is waiting on with one of the options it offered.",
    payload_keys: ["agent_id", "task_id", "choice_id", "option_id", "observed_at"],
    required_keys: ["agent_id", "task_id", "choice_id", "option_id", "observed_at"],
    mutates: true,
    irreversible: true,
  },
  "agent.retry": {
    effect: "Ask the agent to run a failed or cancelled run again.",
    payload_keys: ["agent_id", "run_id", "task_id", "observed_at", "reason"],
    required_keys: ["agent_id", "observed_at"],
    mutates: true,
    // Retry is the command `retryIsSafe` exists for: a run that already
    // executed an irreversible component could execute it a second time.
    irreversible: true,
  },
  "agent.pause": {
    effect: "Ask the agent to stop working on a run until it is resumed.",
    payload_keys: ["agent_id", "run_id", "task_id", "observed_at", "reason"],
    required_keys: ["agent_id", "observed_at"],
    mutates: true,
    irreversible: false,
  },
  "agent.resume": {
    effect: "Ask the agent to continue a paused run.",
    payload_keys: ["agent_id", "run_id", "task_id", "observed_at", "reason"],
    required_keys: ["agent_id", "observed_at"],
    mutates: true,
    irreversible: false,
  },
  "agent.cancel": {
    effect: "Ask the agent to stop a run and not continue it.",
    payload_keys: ["agent_id", "run_id", "task_id", "observed_at", "reason"],
    required_keys: ["agent_id", "observed_at"],
    mutates: true,
    // Cancelling twice leaves a run cancelled. Terminal is not the same as
    // irreversible: nothing new happens in the world on the second attempt.
    irreversible: false,
  },
} as const satisfies Record<string, CommandSpec>;

/**
 * The renderer-facing command name for each contract verb.
 *
 * Kept as data rather than as a string transformation (`name.slice(6)`) so that
 * the mapping is something a reviewer reads rather than something they compute,
 * and so a typo produces a compile error instead of a command that addresses a
 * verb nobody meant.
 */
export const AGENT_COMMAND_VERBS = {
  "agent.approve": "approve",
  "agent.reject": "reject",
  "agent.choose": "choose",
  "agent.retry": "retry",
  "agent.pause": "pause",
  "agent.resume": "resume",
  "agent.cancel": "cancel",
} as const satisfies Record<string, AgentCommand>;

export type AgentCommandChannelName = keyof typeof AGENT_COMMAND_VERBS;

export function isAgentCommandName(value: CommandName): value is AgentCommandChannelName {
  return Object.hasOwn(AGENT_COMMAND_VERBS, value);
}

/**
 * Every command is either local or an Agent DOM command.
 *
 * This is a compile-time assertion, not a runtime one: adding an entry to
 * `COMMANDS` without routing it produces a type error here. The `never` check in
 * `executeCommand` catches the same class of mistake for local commands, and
 * this catches it for the dispatcher.
 */
type UnroutedCommand = Exclude<CommandName, AgentCommandChannelName | "shell.ping">;
const _allCommandsAreRouted: UnroutedCommand extends never ? true : never = true;
void _allCommandsAreRouted;

export type CommandName = keyof typeof COMMANDS;

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === "string" && Object.hasOwn(COMMANDS, value);
}

/* ---------------------------------------------------------------------- *
 * Requests, decisions and audit records
 * ---------------------------------------------------------------------- */

/** What the renderer sends. Treated as fully untrusted — it is `unknown` until reviewed. */
export interface CommandRequest {
  command: string;
  /** Correlates the renderer's call with its audit record. */
  request_id: string;
  payload?: Record<string, unknown>;
}

export type DenialReason =
  | "unknown_command"
  | "malformed_request"
  | "unexpected_payload_field"
  | "unsupported_payload_value"
  | "missing_payload_field";

/**
 * The audit record. Deliberately contains no payload *values* — only the keys
 * that were present.
 *
 * The reason is the rule above: a command may not carry a secret. Logging keys
 * proves what was asked without betting the log's safety on that rule holding
 * forever. If a future command does need a value audited, it should opt in
 * explicitly, in review.
 */
export interface CommandAuditRecord {
  request_id: string;
  /** The raw string as received — an unknown command's name is worth knowing. */
  command: string;
  decision: "allowed" | "denied";
  reason?: DenialReason;
  /** Keys only, never values. */
  payload_keys: string[];
  mutates: boolean;
}

export type CommandReview =
  | {
      decision: "allowed";
      command: CommandName;
      spec: CommandSpec;
      /**
       * The payload, narrowed to the declared keys and to primitives.
       *
       * Carried on the *review* and never on the audit record — the boundary
       * between "what the command layer may act on" and "what gets written
       * down" is the whole "keys, never values" rule, and putting the values
       * one field away from the record keeps that distinction visible at every
       * call site.
       */
      payload: Record<string, string | number | boolean>;
      audit: CommandAuditRecord;
    }
  | { decision: "denied"; reason: DenialReason; audit: CommandAuditRecord };

function denied(
  reason: DenialReason,
  command: string,
  requestId: string,
  payloadKeys: string[] = [],
): CommandReview {
  return {
    decision: "denied",
    reason,
    audit: {
      request_id: requestId,
      command,
      decision: "denied",
      reason,
      payload_keys: payloadKeys,
      // A denied command ran nothing, so it mutated nothing.
      mutates: false,
    },
  };
}

/**
 * The gate. Given anything at all from the renderer, decide whether it may run
 * and produce the record of that decision.
 *
 * Every path returns an audit record — including the malformed ones. A request
 * so broken it has no usable id still gets logged (with `request_id: ""`),
 * because "someone sent garbage down the command channel" is exactly the event
 * an audit log should show.
 */
export function reviewCommand(request: unknown): CommandReview {
  if (typeof request !== "object" || request === null) {
    return denied("malformed_request", "", "");
  }

  const { command, request_id: requestId, payload } = request as Partial<CommandRequest>;
  const safeId = typeof requestId === "string" ? requestId : "";
  const safeCommand = typeof command === "string" ? command : "";

  if (safeCommand === "" || safeId === "") {
    return denied("malformed_request", safeCommand, safeId);
  }

  if (!isCommandName(safeCommand)) {
    return denied("unknown_command", safeCommand, safeId);
  }

  if (payload !== undefined && (typeof payload !== "object" || payload === null)) {
    return denied("malformed_request", safeCommand, safeId);
  }

  const spec: CommandSpec = COMMANDS[safeCommand];
  const keys = payload === undefined ? [] : Object.keys(payload);

  for (const key of keys) {
    if (!spec.payload_keys.includes(key)) {
      // Denying the *whole* request rather than dropping the extra field: a
      // caller sending a field we do not understand has a different model of
      // this command than we do, and silently ignoring it hides that.
      return denied("unexpected_payload_field", safeCommand, safeId, keys);
    }
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      // Primitives only. Objects and arrays are where a credential blob, a
      // buffer or a prototype-pollution payload would arrive.
      return denied("unsupported_payload_value", safeCommand, safeId, keys);
    }
    if (value === "") {
      // An empty string is a present-but-absent field. The contract gives every
      // id `minLength: 1`, so accepting one here would only move the failure to
      // envelope validation, where it would be reported as a DASH bug rather
      // than as the caller's missing argument.
      return denied("missing_payload_field", safeCommand, safeId, keys);
    }
  }

  for (const required of spec.required_keys) {
    // Required keys must be non-empty strings. Presence alone is not enough:
    // every required field names something (an agent, an approval, a snapshot)
    // and a number cannot name any of them.
    if (typeof (payload as Record<string, unknown> | undefined)?.[required] !== "string") {
      return denied("missing_payload_field", safeCommand, safeId, keys);
    }
  }

  return {
    decision: "allowed",
    command: safeCommand,
    spec,
    payload: (payload ?? {}) as Record<string, string | number | boolean>,
    audit: {
      request_id: safeId,
      command: safeCommand,
      decision: "allowed",
      payload_keys: keys,
      mutates: spec.mutates,
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Execution
 * ---------------------------------------------------------------------- */

export interface CommandResult {
  ok: boolean;
  request_id: string;
  /**
   * Present only on denial. The renderer gets the reason code, nothing more.
   *
   * The two families are deliberately one field. A caller does not care whether
   * its command died at the IPC allowlist or at the runner's approval check —
   * it cares what to tell the user — and giving the two seams separate fields
   * would push that distinction into the UI, which is the layer least able to
   * make anything of it.
   */
  reason?: DenialReason | string;
  /** Command-specific, non-secret result data. `shell.ping` returns nothing. */
  data?: Record<string, string | number | boolean>;
  /** Agent commands only: the audit correlation this attempt was filed under. */
  correlation_id?: string;
  /** Agent commands only: true when an earlier identical command's result was returned. */
  duplicate?: boolean;
  /** Agent commands only: plain-language detail, safe to render. */
  detail?: string;
}

/**
 * Run a reviewed command.
 *
 * Takes a `CommandReview` rather than a raw request, so it is impossible to
 * execute something that was never reviewed — the type system enforces the
 * ordering that the audit depends on.
 *
 * `shell.ping` returns only its own request id: proof the round trip worked,
 * carrying nothing about the machine, the user or any connection.
 */
export function executeCommand(review: CommandReview): CommandResult {
  if (review.decision === "denied") {
    return { ok: false, request_id: review.audit.request_id, reason: review.reason };
  }

  if (isAgentCommandName(review.command)) {
    // Not a denial and not a result: a caller that reached here bypassed the
    // trusted side entirely. Throwing is the only honest answer — returning a
    // failure would let a miswired call site look like a refused command, and
    // returning success would be a lie about an effect nothing performed.
    throw new Error(
      `${review.command} carries an effect and must go through dispatchCommand, not executeCommand.`,
    );
  }

  switch (review.command) {
    case "shell.ping":
      return { ok: true, request_id: review.audit.request_id, data: { pong: true } };
    default: {
      // Exhaustiveness: adding a command to COMMANDS without handling it here
      // is a compile error, not a runtime surprise.
      const unreachable: never = review.command;
      throw new Error(`Unhandled command: ${String(unreachable)}`);
    }
  }
}

/**
 * What the dispatcher needs from the trusted side.
 *
 * An injected function rather than a direct import, so this module stays pure
 * and free of I/O — `lib/agent-dom/runner.ts` opens the database and reaches an
 * adapter, and dragging that in here would make the command allowlist
 * untestable without a store and unimportable from the preload. Electron main
 * supplies the real one; tests supply a fake.
 */
export interface DispatchContext {
  runAgentCommand(input: AgentCommandInput): Promise<AgentCommandResult>;
  /**
   * Where the IPC-level audit record goes.
   *
   * Injected rather than written to `console` here for the same reason as
   * above — but also so that "the record is emitted on every path" is a thing a
   * test can observe, instead of a thing a reviewer has to trace by eye through
   * the one call site in `electron/main.ts`.
   */
  audit(record: CommandAuditRecord): void;
}

/**
 * The single entry point: review, then route.
 *
 * Both families of command pass through `reviewCommand` first, so the
 * allowlist, the payload rules and the IPC audit record apply to an Agent DOM
 * command exactly as they applied to `shell.ping`.
 *
 * An allowed agent command therefore produces *two* audit records: one at the
 * IPC boundary saying the request was well-formed and permitted to be built,
 * and one in `command_audit` saying what the runner decided about it. They can
 * legitimately disagree — the boundary allows a shape, the runner judges a
 * meaning — and keeping both is what lets an auditor tell "the renderer asked
 * for something it should not have" from "the renderer asked reasonably and the
 * agent's state said no".
 */
export async function dispatchCommand(
  request: unknown,
  context: DispatchContext,
): Promise<CommandResult> {
  const review = reviewCommand(request);
  // Before the branch, so there is no route out of this function — denied,
  // local or agent — that skips it.
  context.audit(review.audit);

  if (review.decision === "denied") {
    return { ok: false, request_id: review.audit.request_id, reason: review.reason };
  }

  if (isAgentCommandName(review.command)) {
    const result = await context.runAgentCommand(
      toAgentCommandInput(review, AGENT_COMMAND_VERBS[review.command]),
    );
    return {
      ok: result.ok,
      request_id: result.request_id,
      reason: result.reason,
      correlation_id: result.correlation_id,
      duplicate: result.duplicate,
      detail: result.detail,
    };
  }

  return executeCommand(review);
}

/**
 * Turn a reviewed request into the runner's input.
 *
 * Every field is copied explicitly. A spread of the payload would be shorter
 * and would also mean that the day someone adds a payload key, it silently
 * becomes part of the envelope's target without anyone deciding that it should.
 */
function toAgentCommandInput(
  review: Extract<CommandReview, { decision: "allowed" }>,
  command: AgentCommand,
): AgentCommandInput {
  const payload = review.payload;
  const optional = (key: string): string | undefined =>
    typeof payload[key] === "string" ? (payload[key] as string) : undefined;
  // Guaranteed a non-empty string by `required_keys`; `String` is a no-op that
  // states the guarantee rather than asserting it away with `!`.
  const required = (key: string): string => String(payload[key] ?? "");

  const target = {
    agent_id: required("agent_id"),
    run_id: optional("run_id"),
    task_id: optional("task_id"),
    choice_id: optional("choice_id"),
    approval_id: optional("approval_id"),
    action_id: optional("action_id"),
  };

  return {
    request_id: review.audit.request_id,
    command,
    target,
    observed_at: required("observed_at"),
    option_id: optional("option_id"),
    reason: optional("reason"),
    payload_keys: review.audit.payload_keys,
    mutates: review.spec.mutates,
    irreversible: review.spec.irreversible,
  };
}

/**
 * Render an audit record as one log line.
 *
 * Kept here beside the record so the "keys, never values" rule is enforced at
 * the point of formatting too — the place where a well-meaning
 * `JSON.stringify(payload)` would otherwise creep in.
 */
export function formatAuditLine(record: CommandAuditRecord): string {
  const keys = record.payload_keys.length > 0 ? ` keys=[${record.payload_keys.join(",")}]` : "";
  const reason = record.reason ? ` reason=${record.reason}` : "";
  return `[dash-shell] ${record.decision} command=${record.command} id=${record.request_id}${keys}${reason} mutates=${record.mutates}`;
}
