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
 * **Two bridges, and they are separate on purpose (MAR-432).** `dashShell`
 * carries effects: every method maps to exactly one entry in `COMMANDS` and
 * reaches it through the single audited channel. `dashData` carries documents,
 * on its own channel, and changes nothing — see `lib/shell/read.ts` for why
 * reads cannot ride the command channel and why they are not audited.
 *
 * They are two objects rather than one with a `read` sub-object so that "can
 * this page do anything, or only look?" is answerable by checking which globals
 * exist. The developer path's browser tab has neither, which is what makes it
 * read-only by construction rather than by discipline.
 */

import { contextBridge, ipcRenderer } from "electron";

import { SHELL_COMMAND_CHANNEL } from "../lib/shell/ipc";
import type { CommandResult } from "../lib/shell/ipc";
import { SHELL_READ_CHANNEL } from "../lib/shell/read";
import type { DashReadApi, ReadResponse, ReadResults } from "../lib/shell/read";

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

/**
 * What the renderer may say about a connection command (MAR-383).
 *
 * Three ids and nothing else. There is deliberately no field for a value, and
 * adding one would be refused at the boundary anyway — `connection.connect`
 * declares exactly these three payload keys.
 */
interface ConnectionArgs {
  agent_id: string;
  connection_id: string;
  field_id: string;
}

/**
 * The four facts a page may offer for a server. Main mints both opaque names
 * and the key; there is deliberately no key, key-name or path field here.
 */
interface HostCreateArgs {
  label: string;
  address: string;
  username: string;
  port: number;
}

/** A saved host is addressed by DASH's opaque id, never by a filesystem path. */
interface HostTarget {
  host_id: string;
}

/** The page chooses two stored identities and no file, command or path. */
interface HostDeployTarget extends HostTarget {
  agent_id: string;
}

/**
 * A saved host plus the identity code the person was shown (MAR-572).
 *
 * The fingerprint is a fact about the *server's* key. It names nothing on this
 * machine, and it travels this way — back through the same boundary it came
 * out of — so that main can check what is answering now against what was on
 * screen when somebody said yes.
 */
interface HostTrustTarget extends HostTarget {
  fingerprint: string;
}

function send(command: string, payload: Record<string, string>): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command,
    request_id: requestId(),
    payload,
  }) as Promise<CommandResult>;
}

/**
 * The same call for a payload of numbers (MAR-440).
 *
 * A separate function rather than widening `send`'s value type, so that every
 * existing caller stays constrained to strings and only the one command that
 * needs a coordinate can send one.
 */
function sendNumbers(command: string, payload: Record<string, number>): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command,
    request_id: requestId(),
    payload,
  }) as Promise<CommandResult>;
}

/**
 * A mixed string/number payload for the host-creation form.
 *
 * Kept separate from `send` so existing methods stay string-only and so this
 * is the one place a page can name a port. Every field is copied explicitly:
 * spreading the caller's object would let a page pass a private key or path to
 * the command boundary merely to have it refused later.
 */
function sendHostCreate(args: HostCreateArgs): Promise<CommandResult> {
  return ipcRenderer.invoke(SHELL_COMMAND_CHANNEL, {
    command: "host.create",
    request_id: requestId(),
    payload: {
      label: args.label,
      address: args.address,
      username: args.username,
      port: args.port,
    },
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
   * Show the application menu, under the button the user pressed (MAR-440).
   *
   * The bar is ours since the native one was hidden; the menu behind it is
   * still main's. This carries two numbers and cannot name an item, so pressing
   * the button is a request to *display*, never to invoke — which is what keeps
   * "the renderer cannot reach a menu action directly" true after the bar it
   * used to reach them through stopped being drawn.
   */
  openAppMenu(at?: { x: number; y: number }): Promise<CommandResult> {
    return sendNumbers("shell.menu", at === undefined ? {} : { x: at.x, y: at.y });
  },

  /**
   * The seven Agent DOM commands, one named method each.
   *
   * One method per command rather than a single `command(name, payload)`: a
   * generic method would let page script address any entry in the catalogue,
   * including ones added later for something else, which is the same argument
   * that keeps `invoke` and the channel name off this object.
   */
  /**
   * The three connection commands (MAR-383).
   *
   * `connect` asks main to *ask* the user for a credential — it does not carry
   * one, cannot be given one, and does not receive one back. The value is typed
   * into a window main opens with a different preload
   * (`electron/credential-preload.ts`), so the bridge this file exposes still
   * satisfies the rule at the top: nothing here reads, writes or names a secret.
   *
   * Named methods for the same reason as everything above. Three entries a
   * reviewer can count beats a `connection(action, target)` that would let page
   * script address whatever the fourth one turns out to be.
   */
  connectConnection: (args: ConnectionArgs) => send("connection.connect", { ...args }),
  testConnection: (args: ConnectionArgs) => send("connection.test", { ...args }),
  disconnectConnection: (args: ConnectionArgs) => send("connection.disconnect", { ...args }),

  /**
   * The host actions (MAR-536/MAR-556), one named method each.
   *
   * `createHost` receives only ordinary connection facts and returns only the
   * public half of a newly minted key. The private half never enters this
   * preload, and probe/forget take only DASH's opaque host id. Named methods
   * keep a page from addressing a future host action by string.
   */
  createHost: ({ label, address, username, port }: HostCreateArgs) =>
    sendHostCreate({ label, address, username, port }),
  probeHost: ({ host_id }: HostTarget) => send("host.probe", { host_id }),
  /**
   * The first pin, and the setup text (MAR-572, MAR-573).
   *
   * `trustHost` carries the fingerprint the person was shown back to main,
   * which asks the server again and refuses if the two disagree.
   *
   * `hostSetupScript` takes only an id and returns text. It cannot be given a
   * path, a key or a command; what comes back is composed in main from DASH's
   * own public half and the helper this build ships.
   */
  trustHost: ({ host_id, fingerprint }: HostTrustTarget) =>
    send("host.trust", { host_id, fingerprint }),
  hostSetupScript: ({ host_id }: HostTarget) => send("host.setup", { host_id }),
  deployAgentToHost: ({ host_id, agent_id }: HostDeployTarget) =>
    send("host.deploy", { host_id, agent_id }),
  forgetHost: ({ host_id }: HostTarget) => send("host.forget", { host_id }),

  /**
   * The three task-workspace commands (MAR-507).
   *
   * `selectInput` asks main to *ask* the user for a file. It does not carry a
   * path, cannot be given one, and does not receive one back — the same shape
   * `connectConnection` has and for a sharper reason: a credential this bridge
   * could name is one page script already held, while a path it could name is
   * one nobody chose.
   *
   * What comes back about an admitted file is its own display name and its
   * size, both facts about the copy the runner now owns.
   *
   * Named methods, like everything above. Three a reviewer can count beats a
   * `workspace(action, target)` that would let page script address whatever the
   * fourth one turns out to be.
   */
  openAgentTask: (args: { agent_id: string }) => send("workspace.openTask", { ...args }),
  selectAgentInput: (args: { agent_id: string; task_id: string; role_id: string }) =>
    send("workspace.selectInput", { ...args }),
  dispatchAgentTask: (args: { agent_id: string; task_id: string; run_id: string }) =>
    send("workspace.dispatchTask", { ...args }),
  /**
   * Save one of an agent's outputs where the user asks (MAR-434).
   *
   * Two opaque ids and nothing else. There is no path in the payload and none in
   * the reply: main raises the operating system's own save dialog, so the
   * destination is chosen in a window this renderer did not draw and cannot
   * read. A named method rather than a generic `workspace(action, target)`, for
   * the reason the connection trio above are three methods.
   */
  downloadOutput: (args: { agent_id: string; artifact_id: string }) =>
    send("workspace.download", { ...args }),

  /**
   * The runner's own health, and its one repair (MAR-518).
   *
   * `status` carries no payload — it is a fact about the runner as a whole,
   * not about any one agent, which is also why `retireStore` carries no
   * `agent_id`: `runner.retireStore` reaches `POST /store/retire` directly,
   * never an agent's own `/lifecycle` route.
   */
  runnerStatus: () => send("runner.status", {}),
  retireRunnerStore: () => send("runner.retireStore", {}),

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

/* ---------------------------------------------------------------------- *
 * The read surface (MAR-432)
 * ---------------------------------------------------------------------- */

function read<K extends keyof ReadResults>(
  name: K,
  params?: Record<string, string>,
): Promise<ReadResponse<ReadResults[K]>> {
  return ipcRenderer.invoke(SHELL_READ_CHANNEL, { read: name, params }) as Promise<
    ReadResponse<ReadResults[K]>
  >;
}

/**
 * One named method per readable document, and nothing generic.
 *
 * The same argument that keeps `invoke` off `dashShell` applies here with no
 * discount: a `read(name)` method would let page script address any entry in the
 * catalogue, including entries added later for something else. That the
 * catalogue currently holds only four harmless documents is not the property
 * being protected — the property is that widening it stays a review event.
 *
 * No method takes a callback, returns a subscription, or accepts anything but
 * strings. A page that wants fresher data asks again.
 */
const dashData = {
  agents: () => read("view.agents"),
  runs: () => read("view.runs"),
  run: (agent: string, runId: string) => read("view.run", { agent, run_id: runId }),
  connections: () => read("view.connections"),
  inbox: () => read("view.inbox"),
  workspace: (agent: string) => read("view.workspace", { agent }),
  // `satisfies`, so the pages and this bridge cannot drift: the shape is
  // declared in `lib/shell/read.ts`, which a client component may import and
  // this file may not be imported by.
} satisfies DashReadApi;

export type DashDataApi = typeof dashData;

contextBridge.exposeInMainWorld("dashData", dashData);
