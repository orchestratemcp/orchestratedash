/**
 * The narrow preload.
 *
 * ADR 0001's standing obligation is "a narrow preload" — narrow meaning the
 * renderer gets named, fixed operations and nothing generic. What is
 * deliberately *not* exposed matters more than what is:
 *
 * - not `ipcRenderer` itself, and not `invoke` — either would let page script
 *   address any channel, which is the whole attack;
 * - not the channel name;
 * - nothing that reads, writes or names a secret. `SecureStore` lives in main
 *   and never crosses this boundary.
 *
 * Every method here maps to exactly one entry in `COMMANDS`, and reaches it
 * through the single audited channel.
 */

import { contextBridge, ipcRenderer } from "electron";

import { SHELL_COMMAND_CHANNEL } from "../lib/shell/ipc";
import type { CommandResult } from "../lib/shell/ipc";

/**
 * Request ids are generated here rather than in main so the renderer can
 * correlate its own call with the reply. They are opaque and carry no meaning —
 * a UUID, not anything derived from the user or the machine.
 */
function requestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * What the renderer may say about an agent command.
 *
 * Note what is not here and cannot be added by a caller: an actor, a nonce, an
 * expiry, a correlation id, an idempotency key. Those are minted in main. The
 * renderer's whole vocabulary is "which thing, and which snapshot was I looking
 * at when I decided" — `observed_at` being the snapshot the control was
 * rendered from, which is what lets main tell a double click apart from a
 * deliberate second attempt.
 */
interface AgentCommandArgs {
  agent_id: string;
  observed_at: string;
  run_id?: string;
  task_id?: string;
  approval_id?: string;
  action_id?: string;
  choice_id?: string;
  option_id?: string;
  reason?: string;
}

function send(command: string, payload: Record<string, string>): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command,
    request_id: requestId(),
    payload,
  }) as Promise<CommandResult>;
}

/** Drop unset optional fields: the boundary denies a payload key it did not declare. */
function fields(args: AgentCommandArgs, keys: readonly (keyof AgentCommandArgs)[]): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}

const RUN_FIELDS = ["agent_id", "observed_at", "run_id", "task_id", "reason"] as const;
const APPROVAL_FIELDS = [
  "agent_id",
  "observed_at",
  "task_id",
  "approval_id",
  "action_id",
  "reason",
] as const;
const CHOICE_FIELDS = ["agent_id", "observed_at", "task_id", "choice_id", "option_id"] as const;

const dashShell = {
  /**
   * Proves the boundary end to end — preload to review to audit to reply —
   * while doing nothing at all.
   */
  ping(): Promise<CommandResult> {
    return send("shell.ping", { issued_at: new Date().toISOString() });
  },

  /**
   * The seven Agent DOM commands, one named method each.
   *
   * One method per command rather than a single `command(name, payload)`: a
   * generic method would let page script address any entry in the catalogue,
   * including ones added later for something else, which is the same argument
   * that keeps `invoke` and the channel name off this object.
   */
  approve: (args: AgentCommandArgs) => send("agent.approve", fields(args, APPROVAL_FIELDS)),
  reject: (args: AgentCommandArgs) => send("agent.reject", fields(args, APPROVAL_FIELDS)),
  choose: (args: AgentCommandArgs) => send("agent.choose", fields(args, CHOICE_FIELDS)),
  retry: (args: AgentCommandArgs) => send("agent.retry", fields(args, RUN_FIELDS)),
  pause: (args: AgentCommandArgs) => send("agent.pause", fields(args, RUN_FIELDS)),
  resume: (args: AgentCommandArgs) => send("agent.resume", fields(args, RUN_FIELDS)),
  cancel: (args: AgentCommandArgs) => send("agent.cancel", fields(args, RUN_FIELDS)),
};

export type DashShellApi = typeof dashShell;

contextBridge.exposeInMainWorld("dashShell", dashShell);
