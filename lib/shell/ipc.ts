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
import type { ConnectionActionResult } from "../connection-actions";
import type { Recovery } from "../copy/recovery";
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
 * There is still no `agent.start`, `agent.stop` or `agent.trigger`: the
 * contract's command vocabulary does not contain them, and inventing a name
 * here for something no manifest can declare would give DASH a button no
 * adapter is obliged to honour.
 *
 * MAR-415 added `runner.*` instead, and the separate prefix is the point.
 * Starting and stopping a hosted process is **runner lifecycle** — DASH
 * supervising something it launched — and it is routed to the runner's
 * `/lifecycle` endpoint, never built into an envelope, never validated against
 * `agent-command.schema.json`, and never mistaken for one of the seven verbs.
 */
export const COMMANDS = {
  "shell.ping": {
    effect: "Confirm the shell's command boundary is reachable. Changes nothing.",
    payload_keys: ["issued_at"],
    required_keys: [],
    mutates: false,
    irreversible: false,
  },

  // MAR-440. The window's own menu bar is gone, so something in the app has to
  // be able to show the menu that is still registered behind it.
  //
  // This rides the audited channel rather than arriving as a third
  // `contextBridge` surface, and the difference is the point. ADR 0001
  // amendment 7 makes a new bridge a review event; the command catalogue is the
  // extension point that already *is* one, and routing through it means the
  // request is allowlisted, its payload is constrained to two numbers, and it
  // produces an audit record — none of which a bridge method would have got.
  //
  // What crosses is a coordinate and nothing else. The renderer cannot name a
  // menu, an item, or an action: `applicationMenu()` builds the template in
  // main and main owns every click handler, exactly as it did when the bar was
  // visible. So this widens what can be *shown*, never what can be *done*.
  "shell.menu": {
    effect: "Show the application menu. Changes nothing by itself.",
    payload_keys: ["x", "y"],
    required_keys: [],
    // Displaying a menu is not a mutation. Whatever the user then picks is
    // main's own menu handler running, and is audited wherever that action is.
    mutates: false,
    irreversible: false,
  },

  "runner.start": {
    effect: "Start a registered agent's process on this machine. Not an Agent DOM command.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    // Starting twice is refused by the supervisor rather than starting a second
    // process, and starting an agent does nothing to the world that stopping it
    // does not undo.
    irreversible: false,
  },
  "runner.stop": {
    effect: "Stop a running agent's process on this machine. Not an Agent DOM command.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
  },
  "runner.status": {
    effect: "Report which agents the bundled runner is supervising, and their process ids.",
    payload_keys: [],
    required_keys: [],
    mutates: false,
    irreversible: false,
  },
  "runner.remove": {
    effect:
      "Stop an agent DASH added and delete DASH's registration for it. The agent's own folder is untouched.",
    payload_keys: ["agent_id"],
    required_keys: ["agent_id"],
    mutates: true,
    // Not irreversible in the sense this flag means — nothing happens in the
    // world that cannot be undone by adding the agent again from its folder,
    // which is one command. What *is* deleted is DASH's own record, and
    // `removeRegistration` refuses to touch a registration DASH did not create,
    // so the blast radius is bounded by ownership rather than by this flag.
    irreversible: false,
  },

  /*
   * MAR-434. Hand one of this agent's outputs back to the person who owns it.
   *
   * The route is `GET /artifacts/{id}/download` on the runner, which MAR-434
   * built and proof `9f` exercises against a real registered artifact. Nothing
   * about the contract is new here; what is new is that a page can reach it.
   *
   * **No path crosses this boundary in either direction.** The renderer names an
   * artifact by its opaque id, and main asks the *user* where to put the bytes
   * through the operating system's own save dialog — so the destination is
   * chosen in a window DASH does not draw, and the renderer neither supplies a
   * path nor learns one. That is the same discipline `runner/workspace.ts` keeps
   * when it refuses to return `stored_path`, extended to the surface that
   * finally calls it: the runner is still the only process that resolves an
   * opaque id to a location.
   *
   * `mutates` is false. This writes a file, and it writes it where the user just
   * pointed, from bytes DASH already holds — it changes nothing about the agent,
   * the store or the world the agent acts on, which is what this flag is for.
   */
  "workspace.download": {
    effect:
      "Save a copy of one output this agent produced, to a folder the user picks. Changes nothing about the agent.",
    payload_keys: ["agent_id", "artifact_id"],
    required_keys: ["agent_id", "artifact_id"],
    mutates: false,
    irreversible: false,
  },

  // MAR-383. Three commands that name a connection and carry no credential.
  //
  // The secret is deliberately absent from every payload below, and there is no
  // fourth command that would carry one. A user types a credential into a
  // separate window main owns (`electron/credential-prompt.ts`), which reaches
  // the vault without passing through this channel or the app's renderer. So
  // "no secrets cross this boundary" survives a feature whose whole subject is
  // secrets: `connection.connect` asks main to *ask* for one, and is the same
  // shape as a command that asks it to forget one.
  "connection.connect": {
    effect:
      "Ask for a credential for one declared connection and store it in this computer's vault.",
    payload_keys: ["agent_id", "connection_id", "field_id"],
    required_keys: ["agent_id", "connection_id", "field_id"],
    mutates: true,
    // Replacing a credential loses the old value, which cannot be recovered
    // from DASH — but nothing happens in the world, and the user still holds
    // whatever they pasted. `irreversible` is about the second invitation and
    // the second payment.
    irreversible: false,
  },
  "connection.test": {
    effect:
      "Check that this computer's vault still holds the credential for one connection. Contacts no provider.",
    payload_keys: ["agent_id", "connection_id", "field_id"],
    required_keys: ["agent_id", "connection_id", "field_id"],
    // Reads the vault and writes the result of that read to the connection's
    // row, which is state. Marked honestly rather than conveniently.
    mutates: true,
    irreversible: false,
  },
  "connection.disconnect": {
    effect: "Delete the credential for one connection from this computer's vault.",
    payload_keys: ["agent_id", "connection_id", "field_id"],
    required_keys: ["agent_id", "connection_id", "field_id"],
    mutates: true,
    // The credential is gone from DASH and cannot be recovered by DASH. That is
    // the point of the command, and the user re-enters it to undo — no external
    // effect happens either way.
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
 * The lifecycle commands, and what each one asks the runner to do.
 *
 * A separate map from `AGENT_COMMAND_VERBS` rather than more entries in it,
 * because they are not the same kind of thing and the type system should say
 * so: an agent command becomes an envelope and is adjudicated against a
 * manifest, a lifecycle command becomes a process operation and is not.
 */
export const RUNNER_LIFECYCLE = {
  "runner.start": "start",
  "runner.stop": "stop",
  "runner.status": "status",
  // MAR-428. Not forwarded to the runner's `/lifecycle` route: removing an
  // agent stops a process *and* deletes files DASH owns *and* forgets a store
  // row, which is a sequence only the shell can perform in the right order.
  // `electron/main.ts` handles this action itself. It lives in this map anyway
  // because it is the same *kind* of thing — DASH acting on something it
  // launched — and giving it a fourth command family would buy nothing but a
  // fourth place to forget the audit record.
  "runner.remove": "remove",
} as const;

export type RunnerCommandName = keyof typeof RUNNER_LIFECYCLE;

export function isRunnerCommandName(value: CommandName): value is RunnerCommandName {
  return Object.hasOwn(RUNNER_LIFECYCLE, value);
}

/**
 * The connection commands, and what each one asks main to do (MAR-383).
 *
 * A third family rather than more `runner.*` entries, for the reason the second
 * one exists: these are not process lifecycle and they are not Agent DOM verbs.
 * They touch the OS vault, which nothing else in this catalogue does, and
 * keeping that a separate route means the one place a credential is reachable
 * is a place a reviewer can find by name.
 */
export const CONNECTION_ACTIONS = {
  "connection.connect": "connect",
  "connection.test": "test",
  "connection.disconnect": "disconnect",
} as const;

export type ConnectionCommandName = keyof typeof CONNECTION_ACTIONS;
export type ConnectionAction = (typeof CONNECTION_ACTIONS)[ConnectionCommandName];

export function isConnectionCommandName(value: CommandName): value is ConnectionCommandName {
  return Object.hasOwn(CONNECTION_ACTIONS, value);
}

/**
 * The window-chrome commands (MAR-440).
 *
 * A fourth family for the reason the second and third exist: it is not an Agent
 * DOM verb, not runner lifecycle and not a credential. It asks main to draw
 * something on this machine's screen and reaches no agent, no store and no
 * provider — which is why it is the only family whose commands may declare
 * `mutates: false`.
 */
export const SHELL_UI_ACTIONS = {
  "shell.menu": "menu",
} as const;

export type ShellUiCommandName = keyof typeof SHELL_UI_ACTIONS;

export function isShellUiCommandName(value: CommandName): value is ShellUiCommandName {
  return Object.hasOwn(SHELL_UI_ACTIONS, value);
}

/**
 * The task-workspace commands (MAR-434).
 *
 * A fifth family, for the reason the second, third and fourth exist: this is not
 * an Agent DOM verb, not runner lifecycle, not a credential and not chrome. It
 * addresses the runner's *task workspace* — the files a run consumed and
 * produced — over routes the runner already serves and proof `9` already
 * exercises.
 *
 * One member so far. `workspace.download` is the half of MAR-434's acceptance
 * criterion that had a proven route and no way to reach it from a page; the
 * input-selection commands belong in this family when they are built, which is
 * the other reason it is a family rather than a stray entry.
 */
export const WORKSPACE_ACTIONS = {
  "workspace.download": "download",
} as const;

export type WorkspaceCommandName = keyof typeof WORKSPACE_ACTIONS;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[WorkspaceCommandName];

export function isWorkspaceCommandName(value: CommandName): value is WorkspaceCommandName {
  return Object.hasOwn(WORKSPACE_ACTIONS, value);
}

/**
 * Every command is local, an Agent DOM command, or runner lifecycle.
 *
 * This is a compile-time assertion, not a runtime one: adding an entry to
 * `COMMANDS` without routing it produces a type error here. The `never` check in
 * `executeCommand` catches the same class of mistake for local commands, and
 * this catches it for the dispatcher.
 */
type UnroutedCommand = Exclude<
  CommandName,
  | AgentCommandChannelName
  | RunnerCommandName
  | ConnectionCommandName
  | ShellUiCommandName
  | WorkspaceCommandName
  | "shell.ping"
>;
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
  /**
   * Connection commands only (MAR-383): what the user can do about a failure.
   *
   * A structured `Recovery` rather than a code, because the page renders a
   * headline, a meaning and a next action, and reducing it to a string here
   * would put the job of turning "vault_locked" into three sentences in the
   * renderer — the layer furthest from knowing which vault it was. Contains no
   * secret: `lib/copy/recovery.ts` is given a service name and a vault label.
   */
  recovery?: Recovery;
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

  if (
    isAgentCommandName(review.command) ||
    isRunnerCommandName(review.command) ||
    isConnectionCommandName(review.command) ||
    isShellUiCommandName(review.command) ||
    isWorkspaceCommandName(review.command)
  ) {
    // Not a denial and not a result: a caller that reached here bypassed the
    // trusted side entirely. Throwing is the only honest answer — returning a
    // failure would let a miswired call site look like a refused command, and
    // returning success would be a lie about an effect nothing performed.
    //
    // `shell.menu` is in this list despite mutating nothing (MAR-440). What it
    // needs from the trusted side is not permission but *capability*: this
    // module is pure and importable from a sandboxed preload, so it cannot
    // reach a `Menu`. Silently succeeding here would report that a menu opened
    // when none did.
    throw new Error(
      `${review.command} needs the trusted side and must go through dispatchCommand, not executeCommand.`,
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
export interface RunnerLifecycleResult {
  ok: boolean;
  detail?: string;
  /**
   * `runner.status` only, and primitives only — the same constraint every other
   * command result carries.
   *
   * Deliberately a summary rather than per-agent process facts. An agent's
   * status, pid and lifecycle belong in its Agent DOM state, which the poller
   * already writes to the store and the UI already renders; returning a second
   * copy down the IPC channel would be a parallel source of truth that drifts
   * the moment one of them is a poll interval behind the other.
   */
  data?: Record<string, string | number | boolean>;
}

export interface DispatchContext {
  runAgentCommand(input: AgentCommandInput): Promise<AgentCommandResult>;
  /**
   * Ask the bundled runner to start or stop a process, or report what it holds.
   *
   * Injected for the same reason `runAgentCommand` is: this module must stay
   * importable from a sandboxed preload, and the runner client reaches the
   * network. Supplying it here also means a build with no runner — the vault
   * was unavailable, say — passes one that refuses honestly, rather than this
   * module having to know that could happen.
   */
  runnerLifecycle(action: string, agentId: string | undefined): Promise<RunnerLifecycleResult>;
  /**
   * Connect, test or forget a credential for one declared connection (MAR-383).
   *
   * Injected like the two above, and for a sharper version of the same reason:
   * the real implementation opens a window and touches the OS vault, and this
   * module must stay importable from a sandboxed preload. It also means the
   * command allowlist can be tested against a fake that never holds a secret.
   *
   * Note the return type. Nothing a credential could be assigned to crosses
   * back — a state, a masked hint and a sentence, all of which are already safe
   * to render and to log.
   */
  connectionAction(
    action: ConnectionAction,
    target: { agent_id: string; connection_id: string; field_id: string },
  ): Promise<ConnectionActionResult>;
  /**
   * Show the application menu at a point in the window (MAR-440).
   *
   * Injected like the three above, and for the plainest version of the reason:
   * `Menu` is an Electron main API and this module must stay importable from a
   * sandboxed preload.
   *
   * It returns nothing. A menu that opened and a menu the user then dismissed
   * are the same outcome, and there is no result the renderer could act on —
   * every consequence of the menu happens in main, where the handlers are.
   */
  showApplicationMenu(at: { x: number; y: number } | undefined): void;
  /**
   * Save one of an agent's outputs where the user asks (MAR-434).
   *
   * Injected like the others, and this one has two reasons rather than one: the
   * implementation reaches the runner over its socket *and* raises a native save
   * dialog, and neither is available to a sandboxed preload.
   *
   * The result carries a sentence and nothing else — no path, no bytes, no
   * digest. A renderer that learned where the file went would be a renderer that
   * could print it, and the whole point of the workspace is that the runner owns
   * the mapping from an opaque id to a place on disk.
   */
  workspaceAction(
    action: WorkspaceAction,
    target: { agent_id: string; artifact_id: string },
  ): Promise<{ ok: boolean; detail: string }>;
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

  if (isConnectionCommandName(review.command)) {
    // Required keys guarantee all three are non-empty strings, so the target is
    // whole by the time it leaves this function. Main resolves it against the
    // validated manifest before touching the vault — naming a connection here
    // is not the same as being allowed to hold a credential for it.
    const result = await context.connectionAction(CONNECTION_ACTIONS[review.command], {
      agent_id: String(review.payload["agent_id"]),
      connection_id: String(review.payload["connection_id"]),
      field_id: String(review.payload["field_id"]),
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
      recovery: result.recovery,
      data: { state: result.state, masked_hint: result.masked_hint ?? "" },
    };
  }

  if (isShellUiCommandName(review.command)) {
    // Both coordinates or neither. A menu popped at a half-known point would
    // land somewhere nobody chose, and Electron's own default — the pointer's
    // position — is the better answer when we do not have both.
    const x = review.payload["x"];
    const y = review.payload["y"];
    const at =
      typeof x === "number" && typeof y === "number"
        ? { x: Math.round(x), y: Math.round(y) }
        : undefined;
    context.showApplicationMenu(at);
    return { ok: true, request_id: review.audit.request_id };
  }

  if (isWorkspaceCommandName(review.command)) {
    // Required keys guarantee both are non-empty strings. Neither is a path and
    // neither can become one: main asks the user where to save through the
    // operating system's own dialog, and the runner is the only process that
    // resolves the artifact id to a location on disk.
    const result = await context.workspaceAction(WORKSPACE_ACTIONS[review.command], {
      agent_id: review.payload["agent_id"] as string,
      artifact_id: review.payload["artifact_id"] as string,
    });
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
    };
  }

  if (isRunnerCommandName(review.command)) {
    // No envelope, no nonce, no idempotency key, no correlation. A lifecycle
    // command is not an Agent DOM command and does not borrow its machinery —
    // see the note on `COMMANDS`. The IPC audit record above is its audit.
    const agentId = review.payload["agent_id"];
    const result = await context.runnerLifecycle(
      RUNNER_LIFECYCLE[review.command],
      typeof agentId === "string" ? agentId : undefined,
    );
    return {
      ok: result.ok,
      request_id: review.audit.request_id,
      detail: result.detail,
      data: result.data,
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
