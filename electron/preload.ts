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

const dashShell = {
  /**
   * The one command in this slice. Proves the boundary end to end — preload to
   * review to audit to reply — while doing nothing at all.
   */
  ping(): Promise<CommandResult> {
    return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
      command: "shell.ping",
      request_id: requestId(),
      payload: { issued_at: new Date().toISOString() },
    }) as Promise<CommandResult>;
  },
};

export type DashShellApi = typeof dashShell;

contextBridge.exposeInMainWorld("dashShell", dashShell);
