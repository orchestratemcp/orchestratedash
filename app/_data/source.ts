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
  HostsView,
  NotificationsView,
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

export interface HostDeployCommandTarget extends HostCommandTarget {
  agent_id: string;
}

/**
 * A saved server plus the identity code the person just read on screen
 * (MAR-572).
 *
 * The fingerprint goes *back* the way it came so main can check it against the
 * server's answer now. It is a fact about the far end's key and names nothing
 * on this machine, which is why it is representable here when a key or a path
 * is not.
 */
export interface HostTrustCommandTarget extends HostCommandTarget {
  fingerprint: string;
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
   * Re-import an agent DASH created, from DASH's current template (MAR-576).
   *
   * Optional for the same reason as the two above, and the case is a real one
   * rather than a formality: the whole defect this repairs is a store older than
   * the build reading it, so a shell older than this method is exactly the shell
   * most likely to be showing the notice that offers it.
   */
  refreshSampleAgent?(args: { agent_id: string }): Promise<CommandResult>;
  /**
   * The three folder commands (MAR-584).
   *
   * Optional for the same reason as everything above, and the degradation is
   * worth naming because it is quiet rather than loud: a shell older than these
   * cannot notice an outside edit at all, so it goes on describing an agent with
   * a document that is no longer the one in its folder, calmly. `checkFolder`
   * below therefore refuses with a sentence saying DASH cannot look, never one
   * that could be read as "nothing has changed".
   */
  checkFolder?(args: { agent_id: string }): Promise<CommandResult>;
  adoptFolder?(args: { agent_id: string }): Promise<CommandResult>;
  revealFolder?(args: { agent_id: string }): Promise<CommandResult>;
  /**
   * Remember that this agent's page has just been opened (MAR-586).
   *
   * Optional for the same reason as the three above, and here the absence is the
   * ordinary case for a while: an installed DASH older than this command has a
   * `dashShell` without it, and every fleet card it draws will go on saying an
   * agent's output is new. That is the honest degradation — the record does not
   * exist, so nothing can be said to have been read — and it is why
   * `markAgentLooked` below refuses quietly rather than surfacing an error on a
   * page nobody asked a question on.
   */
  markAgentLooked?(args: { agent_id: string }): Promise<CommandResult>;
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
  /**
   * The four notification commands (MAR-588).
   *
   * Optional for the same reason as everything above. Note what three of them
   * take: nothing. Page script cannot name a channel address, cannot ask which
   * one DASH holds, and cannot compose a message — see the `notify.*` entries in
   * `lib/shell/ipc.ts`, where the absence of a payload is the security argument
   * rather than a convenience.
   */
  connectNotifications?(): Promise<CommandResult>;
  disconnectNotifications?(): Promise<CommandResult>;
  testNotifications?(): Promise<CommandResult>;
  setNotificationKind?(args: { kind: string; enabled: boolean }): Promise<CommandResult>;
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
  /**
   * Confirming a server's identity, and writing out its setup step (MAR-572,
   * MAR-573).
   *
   * Optional like the four around them, and here the optionality has already
   * earned its keep once: these two are the newest commands on the bridge, so
   * an installed DASH from before this work has a `dashShell` with the rest and
   * without them.
   */
  trustHost?(args: HostTrustCommandTarget): Promise<CommandResult>;
  hostSetupScript?(args: HostCommandTarget): Promise<CommandResult>;
  deployAgentToHost?(args: HostDeployCommandTarget): Promise<CommandResult>;
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
  hosts(): Promise<ViewResult<HostsView>>;
  notifications(): Promise<ViewResult<NotificationsView>>;
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
  /*
   * MAR-574. Read once into a local rather than checked at the call site: a
   * shell built before this read exposes a `dashData` without it, and the
   * narrowing has to survive into the closure below.
   */
  const readHosts = bridge.hosts?.bind(bridge);
  /* MAR-588. Same treatment, same reason: a shell older than this read has no
     such method, and the narrowing has to survive into the closure. */
  const readNotifications = bridge.notifications?.bind(bridge);
  return {
    host: "shell",
    can_act: typeof window !== "undefined" && window.dashShell !== undefined,
    agents: () => fromBridge(() => bridge.agents()),
    runs: () => fromBridge(() => bridge.runs()),
    run: (agent, runId) => fromBridge(() => bridge.run(agent, runId)),
    connections: () => fromBridge(() => bridge.connections()),
    inbox: () => fromBridge(() => bridge.inbox()),
    workspace: (agent) => fromBridge(() => bridge.workspace(agent)),
    /*
     * Refused rather than called when the shell predates this read, and
     * `describeViewFailure("refused")` is exactly the right sentence for it:
     * the renderer asked this build for a document it does not offer, which can
     * only be a wiring mismatch rather than anything the user did.
     */
    hosts: () =>
      readHosts === undefined
        ? Promise.resolve({ ok: false, recovery: describeViewFailure("refused") })
        : fromBridge(readHosts),
    notifications: () =>
      readNotifications === undefined
        ? Promise.resolve({ ok: false, recovery: describeViewFailure("refused") })
        : fromBridge(readNotifications),
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
    hosts: () => fromHttp("/api/views/hosts"),
    notifications: () => fromHttp("/api/views/notifications"),
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
 * Ask DASH to re-import an agent it created, from its current template
 * (MAR-576).
 *
 * The same two refusals `downloadOutput` distinguishes below, for the same
 * reason and with a sharper consequence in the second case. A browser tab has
 * no bridge and cannot write a store. A shell older than this command has a
 * bridge without the method — and that user is in a genuinely awkward spot
 * worth wording exactly: their DASH is old enough that its saved agent is
 * behind its own template, and also old enough to be unable to fix that from
 * this page. "Open the installed app" would be advice they have already taken,
 * so the sentence names the way out that does exist.
 */
export async function refreshSampleAgent(args: {
  agent_id: string;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to update this agent.",
    };
  }
  if (bridge.refreshSampleAgent === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail:
        "This version of the DASH app cannot update an agent in place. Add the agent again from its own folder to bring it up to date.",
    };
  }
  return bridge.refreshSampleAgent(args);
}

/**
 * The three folder commands, and the two refusals every one of them shares
 * (MAR-584).
 *
 * One helper rather than three, because the refusals are identical and the only
 * thing that differs is which sentence names the action. Three copies of the
 * same two branches is three places for one of them to drift into reassurance.
 *
 * The wording of the second refusal is the one that had to be careful. A shell
 * too old to have these methods cannot look at the folder — so the sentence says
 * *this version cannot check*, and never anything a reader could take as *there
 * is nothing to check*. That distinction is the whole of `FOLDER_NO_BASELINE`'s
 * argument, applied one layer further out.
 */
async function folderCommand(
  method: "checkFolder" | "adoptFolder" | "revealFolder",
  args: { agent_id: string },
  cannot: string,
): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: `Open the installed DASH app to ${cannot}.`,
    };
  }
  const call = bridge[method];
  if (call === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: `This version of the DASH app cannot ${cannot}. Add the agent again from its own folder to bring DASH up to date with it.`,
    };
  }
  return call(args);
}

export async function checkAgentFolder(args: { agent_id: string }): Promise<CommandResult> {
  return folderCommand("checkFolder", args, "check this agent's folder for changes");
}

export async function adoptAgentFolder(args: { agent_id: string }): Promise<CommandResult> {
  return folderCommand("adoptFolder", args, "accept a change made to this agent's folder");
}

export async function revealAgentFolder(args: { agent_id: string }): Promise<CommandResult> {
  return folderCommand("revealFolder", args, "open this agent's folder");
}

/**
 * The four notification commands (MAR-588).
 *
 * One helper for `folderCommand`'s reason, and the browser-tab refusal is the
 * one worth reading. A page served over HTTP has no preload and therefore no way
 * to reach the vault or the credential window — which is correct and is also the
 * whole answer to "could somebody set this up from a browser tab": no.
 *
 * The sentence sends them to the installed app rather than explaining the
 * boundary, because the boundary is not the reader's problem. `lib/copy/host.ts`
 * is where DASH says what a read-only window is, and this page renders that too.
 */
async function notifyCommand(
  method:
    | "connectNotifications"
    | "disconnectNotifications"
    | "testNotifications",
  cannot: string,
): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: `Open the installed DASH app to ${cannot}.`,
    };
  }
  const call = bridge[method];
  if (call === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: `This version of the DASH app cannot ${cannot}.`,
    };
  }
  return call();
}

export async function connectNotifications(): Promise<CommandResult> {
  return notifyCommand("connectNotifications", "set up Discord messages");
}

export async function disconnectNotifications(): Promise<CommandResult> {
  return notifyCommand("disconnectNotifications", "stop Discord messages");
}

export async function testNotifications(): Promise<CommandResult> {
  return notifyCommand("testNotifications", "send a test message");
}

export async function setNotificationKind(args: {
  kind: "needs_approval" | "new_report";
  enabled: boolean;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  const call = bridge?.setNotificationKind;
  if (call === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to change what DASH sends to Discord.",
    };
  }
  return call(args);
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
 * Tell DASH this agent's page has been opened (MAR-586).
 *
 * **The one command in this module whose refusal is never shown to anybody**,
 * and that is deliberate rather than an oversight. Every other function here
 * composes a sentence for the two hosts that cannot act, because each of them is
 * called by a person pressing a button and a button that did nothing needs to
 * say why. Nobody presses this one: it fires when a page opens, and a browser tab
 * — which has no bridge at all and never will — would otherwise show a refusal
 * for something its reader never asked for.
 *
 * What is lost when it refuses is stated rather than hidden: in a browser tab,
 * and in an installed shell older than this command, the "new output" chip on
 * the fleet keeps counting from a look that was never recorded. That is the
 * truth about those hosts — the read-only path is read-only, so it cannot write
 * down that somebody read something.
 */
export async function markAgentLooked(agentId: string): Promise<void> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge?.markAgentLooked === undefined) {
    return;
  }
  // Deliberately unawaited in effect: the caller does not branch on the answer,
  // and a page that waited on this before rendering would be a page whose first
  // paint depended on a write nobody is watching.
  await bridge.markAgentLooked({ agent_id: agentId });
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
  action: "deploy",
  target: HostDeployCommandTarget,
): Promise<CommandResult>;
export async function submitHostCommand(
  action: "trust",
  target: HostTrustCommandTarget,
): Promise<CommandResult>;
export async function submitHostCommand(
  action: "setup",
  target: HostCommandTarget,
): Promise<CommandResult>;
export async function submitHostCommand(
  action: "create" | "probe" | "trust" | "setup" | "deploy" | "forget",
  target:
    | HostCreateCommandArgs
    | HostCommandTarget
    | HostTrustCommandTarget
    | HostDeployCommandTarget,
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
    case "trust":
      if (bridge.trustHost === undefined) {
        return {
          ok: false,
          request_id: "",
          reason: "read_only_host",
          detail: "This version of the DASH app cannot confirm a server's identity yet.",
        };
      }
      return bridge.trustHost(target as HostTrustCommandTarget);
    case "setup":
      if (bridge.hostSetupScript === undefined) {
        return {
          ok: false,
          request_id: "",
          reason: "read_only_host",
          detail: "This version of the DASH app cannot write a server's setup step yet.",
        };
      }
      return bridge.hostSetupScript(target as HostCommandTarget);
    case "deploy":
      if (bridge.deployAgentToHost === undefined) {
        return {
          ok: false,
          request_id: "",
          reason: "read_only_host",
          detail: "This version of the DASH app cannot put an agent on a server yet.",
        };
      }
      return bridge.deployAgentToHost(target as HostDeployCommandTarget);
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
