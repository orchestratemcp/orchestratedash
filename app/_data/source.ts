"use client";

/**
 * One renderer, two data sources, chosen at runtime (MAR-432, DASH-20).
 *
 * Every page below `app/` renders from this module and never from `lib/store.ts`.
 * That is the whole change: DASH's pages used to be server components in the
 * same process as SQLite, which the packaged app cannot be — the renderer there
 * is a static export with no server behind it.
 *
 * ## The two sources, and what is deliberately identical about them
 *
 * - **The installed app** reads over the preload bridge, `window.dashData`.
 * - **A browser tab** reads over `fetch`, from route handlers that exist only on
 *   the developer path.
 *
 * Neither source *builds* anything. Both end up calling the same functions in
 * `lib/views/build.ts`, on the same database, and return what they get. The only
 * difference between the two is transport, which is a much smaller thing to keep
 * honest than two renderings of the same data — and it is why "does the browser
 * tab show what the app shows" is a question with a structural answer rather than
 * a testing burden.
 *
 * ## What is *not* the same, and is not hidden
 *
 * A browser tab cannot act. `window.dashShell` is a preload bridge and a page
 * served over HTTP has no preload, so no command can be issued from one.
 * `capabilities.can_act` reports that,
 * and `lib/copy/host.ts` is what a page says about it. See that module for why
 * this is stated rather than quietly branched on.
 */

import { describeViewFailure, type Recovery } from "../../lib/copy/recovery";
import type { RenderHost } from "../../lib/copy/host";
import type { CommandResult } from "../../lib/shell/ipc";
import type { DashReadApi } from "../../lib/shell/read";
import type { AgentCommand } from "../../lib/workspace";
import type {
  AgentsView,
  ConnectionsView,
  RunView,
  RunsView,
  WorkInboxView,
  WorkspaceView,
} from "../../lib/views/types";

export interface AgentCommandArgs {
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
 * Three ids. There is no field for a value here and none in the preload: the
 * credential is typed into a window main owns, not into this page.
 */
export interface ConnectionCommandArgs {
  agent_id: string;
  connection_id: string;
  field_id: string;
}

/**
 * The unsecret server facts a renderer may offer DASH (MAR-536).
 *
 * Key material and paths are deliberately not representable. Main owns those
 * facts and returns the public key after it has stored the private half.
 */
export interface HostCreateCommandArgs {
  label: string;
  address: string;
  username: string;
  port: number;
}

export interface HostCommandTarget {
  host_id: string;
}

interface DashShellClient {
  /**
   * Show the application menu (MAR-440).
   *
   * The odd one out on this interface, and worth the sentence: every other
   * method here asks main to *do* something to an agent or a credential, and
   * this one asks it to draw a menu. It is on the same bridge because it goes
   * down the same audited channel — see the `shell.menu` entry in
   * `lib/shell/ipc.ts` for why that was preferred to a third `contextBridge`
   * surface.
   *
   * Optional on top of the bridge already being optional: a build of the shell
   * older than the title bar has a `dashShell` without it.
   */
  openAppMenu?(at?: { x: number; y: number }): Promise<CommandResult>;
  /**
   * Save one of an agent's outputs (MAR-434).
   *
   * Optional on top of the bridge already being optional, like `openAppMenu`
   * above and for the same reason: a shell built before this command exists has
   * a `dashShell` without it, and a page that assumed otherwise would throw in
   * front of the user rather than refuse honestly.
   */
  downloadOutput?(args: { agent_id: string; artifact_id: string }): Promise<CommandResult>;
  /**
   * The runner's own health, and its one repair (MAR-518).
   *
   * Optional on top of the bridge already being optional, like `openAppMenu`
   * and for the same reason: a shell built before this feature has a
   * `dashShell` without them, and a page that assumed otherwise would throw
   * rather than refuse.
   */
  runnerStatus?(): Promise<CommandResult>;
  retireRunnerStore?(): Promise<CommandResult>;
  connectConnection(args: ConnectionCommandArgs): Promise<CommandResult>;
  testConnection(args: ConnectionCommandArgs): Promise<CommandResult>;
  disconnectConnection(args: ConnectionCommandArgs): Promise<CommandResult>;
  /**
   * Optional for the same reason as the workspace and runner methods: a shell
   * built before the host command family has a bridge, but cannot make, check
   * or forget a server. Calling through would throw instead of refusing.
   */
  createHost?(args: HostCreateCommandArgs): Promise<CommandResult>;
  probeHost?(args: HostCommandTarget): Promise<CommandResult>;
  forgetHost?(args: HostCommandTarget): Promise<CommandResult>;
  /**
   * The task-workspace commands (MAR-507).
   *
   * Optional on top of the bridge already being optional, like `openAppMenu`
   * and for the same reason: a build of the shell older than this feature has a
   * `dashShell` without them, and a renderer that assumed otherwise would throw
   * rather than refuse.
   *
   * `selectAgentInput` carries no path and returns none — main opens the
   * picker.
   */
  openAgentTask?(args: { agent_id: string }): Promise<CommandResult>;
  selectAgentInput?(args: {
    agent_id: string;
    task_id: string;
    role_id: string;
  }): Promise<CommandResult>;
  dispatchAgentTask?(args: {
    agent_id: string;
    task_id: string;
    run_id: string;
  }): Promise<CommandResult>;
  approve(args: AgentCommandArgs): Promise<CommandResult>;
  reject(args: AgentCommandArgs): Promise<CommandResult>;
  choose(args: AgentCommandArgs): Promise<CommandResult>;
  retry(args: AgentCommandArgs): Promise<CommandResult>;
  pause(args: AgentCommandArgs): Promise<CommandResult>;
  resume(args: AgentCommandArgs): Promise<CommandResult>;
  cancel(args: AgentCommandArgs): Promise<CommandResult>;
}

declare global {
  interface Window {
    /**
     * The read bridge, present only inside the installed app. Optional in the
     * type because a browser tab genuinely does not have it, and code that has
     * to check is code that cannot forget to.
     */
    dashData?: DashReadApi;
    /**
     * The audited command bridge. Optional because the developer browser path
     * genuinely has no preload and is read-only by construction.
     */
    dashShell?: DashShellClient;
  }
}

/** A read either produced its document or it did not, and says which. */
export type ViewResult<T> = { ok: true; data: T } | { ok: false; recovery: Recovery };

export interface DashDataSource {
  host: RenderHost;
  /**
   * Whether this window can cause an effect.
   *
   * Derived from the bridge's presence rather than from the host, because the
   * bridge is the thing that would actually be used. A host string can be wrong
   * about itself; `window.dashShell` cannot.
   */
  can_act: boolean;
  agents(): Promise<ViewResult<AgentsView>>;
  runs(): Promise<ViewResult<RunsView>>;
  run(agent: string, runId: string): Promise<ViewResult<RunView>>;
  connections(): Promise<ViewResult<ConnectionsView>>;
  inbox(): Promise<ViewResult<WorkInboxView>>;
  workspace(agent: string): Promise<ViewResult<WorkspaceView>>;
}

/**
 * Turn the bridge's answer into the page's.
 *
 * A refused read is DASH's fault, not the user's: the renderer asked for a
 * document this build does not offer, which can only be a wiring mistake. It is
 * reported as such rather than as "something went wrong".
 */
async function fromBridge<T>(call: () => Promise<{ ok: true; data: T } | { ok: false }>): Promise<
  ViewResult<T>
> {
  try {
    const response = await call();
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, recovery: describeViewFailure("refused") };
  } catch {
    return { ok: false, recovery: describeViewFailure("unreachable") };
  }
}

function shellSource(bridge: DashReadApi): DashDataSource {
  return {
    host: "shell",
    can_act: typeof window !== "undefined" && window.dashShell !== undefined,
    agents: () => fromBridge(() => bridge.agents()),
    runs: () => fromBridge(() => bridge.runs()),
    run: (agent, runId) => fromBridge(() => bridge.run(agent, runId)),
    connections: () => fromBridge(() => bridge.connections()),
    inbox: () => fromBridge(() => bridge.inbox()),
    workspace: (agent) => fromBridge(() => bridge.workspace(agent)),
  };
}

/**
 * The developer path.
 *
 * These routes exist only when DASH is running as a Next server; the packaged
 * build does not contain them, which is enforced by their filenames rather than
 * by a runtime check — see `next.config.mjs`.
 */
async function fromHttp<T>(path: string): Promise<ViewResult<T>> {
  try {
    const response = await fetch(path, { headers: { accept: "application/json" } });
    if (!response.ok) {
      return { ok: false, recovery: describeViewFailure("refused") };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, recovery: describeViewFailure("unreachable") };
  }
}

function browserSource(): DashDataSource {
  return {
    host: "browser",
    // Always false, and not a decision this function makes: a page served over
    // HTTP has no preload, so there is no bridge to find.
    can_act: false,
    agents: () => fromHttp("/api/views/agents"),
    runs: () => fromHttp("/api/views/runs"),
    run: (agent, runId) =>
      fromHttp(
        `/api/views/run?agent=${encodeURIComponent(agent)}&run_id=${encodeURIComponent(runId)}`,
      ),
    connections: () => fromHttp("/api/views/connections"),
    inbox: () => fromHttp("/api/views/inbox"),
    workspace: (agent) =>
      fromHttp(`/api/views/workspace?agent=${encodeURIComponent(agent)}`),
  };
}

/**
 * Which source this window has.
 *
 * Decided per call rather than cached at module scope: the module is evaluated
 * during server rendering on the developer path, where there is no `window` at
 * all, and a value captured then would be the wrong one forever.
 */
export function dataSource(): DashDataSource {
  const bridge = typeof window === "undefined" ? undefined : window.dashData;
  return bridge === undefined ? browserSource() : shellSource(bridge);
}

/**
 * Submit one of the seven Agent DOM verbs through a named preload method.
 *
 * The switch is exhaustive and no generic `invoke` or command string crosses
 * into the preload surface. Main still reviews the request, binds the actor,
 * mints nonce/idempotency/correlation, audits it, and the runner independently
 * rechecks the target and approval.
 */
export async function submitAgentCommand(
  command: AgentCommand,
  args: AgentCommandArgs,
): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to use agent controls.",
    };
  }

  switch (command) {
    case "approve":
      return bridge.approve(args);
    case "reject":
      return bridge.reject(args);
    case "choose":
      return bridge.choose(args);
    case "retry":
      return bridge.retry(args);
    case "pause":
      return bridge.pause(args);
    case "resume":
      return bridge.resume(args);
    case "cancel":
      return bridge.cancel(args);
    default: {
      const unreachable: never = command;
      throw new Error(`Unhandled agent command: ${String(unreachable)}`);
    }
  }
}

/**
 * Task-workspace commands (MAR-507).
 *
 * The same exhaustive switch over named methods as the two below, and the same
 * honest refusal in a host that has no bridge. What is different is worth
 * saying: `select` takes no path and returns none. The renderer names a role,
 * main opens the picker, and what comes back is a name and a size — see
 * `lib/shell/ipc.ts` for why the path never crosses in either direction.
 */
export async function submitWorkspaceCommand(
  action: "open" | "select" | "dispatch",
  args: { agent_id: string; task_id?: string; role_id?: string; run_id?: string },
): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  // The three methods are checked individually, not just the bridge: an
  // installed shell that predates this feature has a `dashShell` and none of
  // them, and calling through would throw where a refusal is the honest answer.
  if (
    bridge?.openAgentTask === undefined ||
    bridge.selectAgentInput === undefined ||
    bridge.dispatchAgentTask === undefined
  ) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to give an agent a file.",
    };
  }

  switch (action) {
    case "open":
      return bridge.openAgentTask({ agent_id: args.agent_id });
    case "select":
      return bridge.selectAgentInput({
        agent_id: args.agent_id,
        task_id: args.task_id ?? "",
        role_id: args.role_id ?? "",
      });
    case "dispatch":
      return bridge.dispatchAgentTask({
        agent_id: args.agent_id,
        task_id: args.task_id ?? "",
        run_id: args.run_id ?? "",
      });
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled workspace command: ${String(unreachable)}`);
    }
  }
}

/**
 * Ask DASH to save one of an agent's outputs (MAR-434).
 *
 * Three refusals rather than one, because they are three different things to
 * learn. A browser tab has no bridge at all and never will. A shell older than
 * this command has a bridge without the method — the same case `openAppMenu`
 * is optional for — and telling that user to open the installed app would be
 * advice they have already taken. Anything else is main's own sentence, passed
 * through unchanged: main is where the runner's refusal is worded, and
 * rewording it here would lose the distinction between a file that moved and
 * one somebody deleted.
 */
export async function downloadOutput(args: {
  agent_id: string;
  artifact_id: string;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to save a copy of this output.",
    };
  }
  if (bridge.downloadOutput === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "This version of the DASH app cannot save outputs yet.",
    };
  }
  return bridge.downloadOutput(args);
}

/**
 * Ask the runner how it is, including whether its own store is damaged
 * (MAR-518).
 *
 * The one status check a page reads independently of any one agent — see
 * `app/page.tsx`, the home view, for why this is the surface that asks it.
 */
export async function checkRunnerStatus(): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined || bridge.runnerStatus === undefined) {
    return { ok: false, request_id: "", reason: "read_only_host", detail: "" };
  }
  return bridge.runnerStatus();
}

/**
 * Ask DASH to set the runner's damaged store aside (MAR-518).
 *
 * The two refusals below are never shown as the reason a button did nothing:
 * `app/page.tsx` only renders the button once `checkRunnerStatus` has already
 * reported `store_damaged`, which itself required a bridge new enough to
 * answer that question. They exist so this function is honest on its own,
 * for any future caller that does not check first.
 */
export async function retireRunnerStore(): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to repair the runner's store.",
    };
  }
  if (bridge.retireRunnerStore === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "This version of the DASH app cannot set a damaged store aside yet.",
    };
  }
  return bridge.retireRunnerStore();
}

/**
 * Submit one connection command through a named preload method (MAR-383).
 *
 * The same shape as `submitAgentCommand` and for the same reasons: an
 * exhaustive switch over named methods, no command string crossing the bridge,
 * and an honest refusal in the host that has no bridge at all.
 *
 * Nothing in this function's arguments or return value can hold a credential.
 * `connect` asks main to open its own prompt; what the user types there never
 * comes back through here.
 */
export async function submitConnectionCommand(
  action: "connect" | "test" | "disconnect",
  args: ConnectionCommandArgs,
): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to connect a service.",
    };
  }

  switch (action) {
    case "connect":
      return bridge.connectConnection(args);
    case "test":
      return bridge.testConnection(args);
    case "disconnect":
      return bridge.disconnectConnection(args);
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled connection command: ${String(unreachable)}`);
    }
  }
}

/**
 * Submit one server action through its named preload method (MAR-536).
 *
 * A generic `host(action, target)` would let a page address a future operation
 * merely by choosing a string. The explicit switch matches the bridge and keeps
 * `host.create`'s public-only answer visible at the one renderer call site.
 */
export async function submitHostCommand(
  action: "create",
  target: HostCreateCommandArgs,
): Promise<CommandResult>;
export async function submitHostCommand(
  action: "probe" | "forget",
  target: HostCommandTarget,
): Promise<CommandResult>;
export async function submitHostCommand(
  action: "create" | "probe" | "forget",
  target: HostCreateCommandArgs | HostCommandTarget,
): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to connect a server.",
    };
  }

  switch (action) {
    case "create":
      if (bridge.createHost === undefined) {
        return {
          ok: false,
          request_id: "",
          reason: "read_only_host",
          detail: "This version of the DASH app cannot make a server key yet.",
        };
      }
      return bridge.createHost(target as HostCreateCommandArgs);
    case "probe":
      if (bridge.probeHost === undefined) {
        return {
          ok: false,
          request_id: "",
          reason: "read_only_host",
          detail: "This version of the DASH app cannot check a server yet.",
        };
      }
      return bridge.probeHost(target as HostCommandTarget);
    case "forget":
      if (bridge.forgetHost === undefined) {
        return {
          ok: false,
          request_id: "",
          reason: "read_only_host",
          detail: "This version of the DASH app cannot forget a server yet.",
        };
      }
      return bridge.forgetHost(target as HostCommandTarget);
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled host command: ${String(unreachable)}`);
    }
  }
}
