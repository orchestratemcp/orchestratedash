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
 * This slice ships one command, `shell.ping`, which does nothing. It exists so
 * the boundary is real enough to review: a reviewer can follow a call from the
 * preload through review, audit and back without any credential being involved.
 */

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
   * True when the command changes state anywhere: disk, vault, an agent, the
   * network. `shell.ping` is the only command that can honestly say false, and
   * marking it explicitly keeps "does nothing" an asserted property rather than
   * an assumption.
   */
  mutates: boolean;
}

/**
 * Every command the renderer may invoke. Adding an entry here is the *only*
 * way to add a command, and is a deliberate review event.
 */
export const COMMANDS = {
  "shell.ping": {
    effect: "Confirm the shell's command boundary is reachable. Changes nothing.",
    payload_keys: ["issued_at"],
    mutates: false,
  },
} as const satisfies Record<string, CommandSpec>;

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
  | "unsupported_payload_value";

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
  | { decision: "allowed"; command: CommandName; spec: CommandSpec; audit: CommandAuditRecord }
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
  }

  return {
    decision: "allowed",
    command: safeCommand,
    spec,
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
  /** Present only on denial. The renderer gets the reason code, nothing more. */
  reason?: DenialReason;
  /** Command-specific, non-secret result data. `shell.ping` returns nothing. */
  data?: Record<string, string | number | boolean>;
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
