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
import type { O_FLEET } from "../../lib/brand/o-cast";
import type { CommandResult } from "../../lib/shell/ipc";
import type { DashReadApi } from "../../lib/shell/read";
import type { AgentCommand } from "../../lib/workspace";
// `import type`, so this client module names the shape without pulling
// `lib/views/browser.ts` — which reaches the store — toward the browser bundle.
import type { BrowserView } from "../../lib/views/browser";
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
 * What the renderer may say about a fleet command (MAR-593, ADR 0013).
 *
 * One id, and it is a provider. There is no agent here and no field: a fleet act
 * names a service, and which credential that service holds is the catalogue's
 * answer rather than a page's. The absence is the same one
 * `ConnectionCommandArgs` has about a value, for the same reason — a member a
 * page could fill is a decision a page could get wrong.
 */
export interface FleetCommandArgs {
  provider: string;
  account_id?: string;
}

export interface FleetAssignmentCommandArgs extends FleetCommandArgs {
  account_id: string;
  agent_id: string;
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
  /** MAR-674. Optional for `downloadOutput`'s reason: an older installed
      build has the bridge and not this member, and a page must be able to
      say so rather than throw. */
  exportBriefAsPdf?(args: { agent_id: string; artifact_id: string }): Promise<CommandResult>;
  /**
   * The two ways out of DASH's window (MAR-697, MAR-698).
   *
   * Optional for the reason everything here is, and the degradation differs
   * between them in a way that decides how each is called. Without `openLink`
   * an anchor is left to behave like an anchor, which is right in a browser tab
   * and inert in an installed shell too old to have the command — so a link
   * there stays exactly as dead as it is today, and nothing new breaks. Without
   * `openExport` there is nothing to fall back to, so the list says so.
   */
  openLink?(args: { url: string }): Promise<CommandResult>;
  openExport?(args: { agent_id: string; file: string }): Promise<CommandResult>;
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
   * Adding an agent by choosing its folder (MAR-598).
   *
   * Optional for the reason every method here is, and the degradation is the
   * plainest on this whole interface: a window with no bridge, or a shell older
   * than this command, cannot open a folder chooser at all. So `chooseAgentFolder`
   * below refuses with a sentence naming the window that can, rather than
   * throwing on the page's primary control.
   *
   * It takes nothing. There is no argument a page could supply and no folder it
   * could name — see the `folder.choose` entry in `lib/shell/ipc.ts`, where the
   * absence of a payload is the security argument rather than a convenience.
   */
  chooseAgentFolder?(): Promise<CommandResult>;
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
  setUiScale?(factor?: number): Promise<CommandResult>;
  /**
   * The controlled browser's two commands (MAR-628, ADR 0019).
   *
   * Optional for the reason every method here is, and the degradation is worth
   * naming because only one half of it is quiet. A shell older than
   * `setBrowserViewport` cannot place the view, so it sits where
   * `FALLBACK_BOUNDS` puts it — visible, in the wrong place, which is the right
   * way round for a browser somebody is meant to be watching.
   *
   * A shell older than `stopBrowser` is the loud half: it also has no browser
   * to stop, because the same build that added one added both. So the panel
   * that would offer Stop is a panel with nothing to show, and
   * `BrowserPanel` renders nothing at all rather than a dead button.
   */
  setBrowserViewport?(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): Promise<CommandResult>;
  stopBrowser?(agent: string): Promise<CommandResult>;
  /**
   * The native half of the theme (MAR-642).
   *
   * Optional for the reason every method here is, and this degradation is the
   * gentlest of them: a shell older than this command draws the whole page in
   * whichever palette the person chose — that is CSS and needs no bridge — and
   * only the title bar goes on following the operating system. So the setting
   * works and one strip at the top of the window is out of step, which is worth
   * strictly less than a control that refused to exist.
   */
  setTheme?(theme: string): Promise<CommandResult>;
  /**
   * The three model commands (MAR-583).
   *
   * Optional for the same reason as everything above, and the degradation is the
   * kind worth naming: a shell older than these draws an agent's declared levels
   * — those come from the manifest through the view and need no bridge — and
   * cannot change any of them. So the page reads correctly and refuses to act,
   * which is the right way round. A page that could offer a control it had no way
   * to honour would be the dead button `lib/connection-spec.ts` closes its
   * vocabulary to prevent.
   */
  chooseModel?(args: {
    agent_id: string;
    connection_id?: string;
    field_id?: string;
    model_id?: string;
  }): Promise<CommandResult>;
  setStepLevel?(args: { agent_id: string; step: number; level?: string }): Promise<CommandResult>;
  listModels?(args: {
    agent_id: string;
    connection_id: string;
    field_id: string;
  }): Promise<CommandResult>;
  /**
   * DASH's own default model, and the list to pick it from (MAR-642).
   *
   * Optional for the reason the three above are, and the degradation is the
   * same shape: a shell older than these draws the AI tab's cards and the
   * default already in force — both come through the view — and cannot change
   * either. Reads, refuses to act.
   */
  setDefaultModel?(args: { provider_id?: string; model_id?: string }): Promise<CommandResult>;
  listProviderModels?(args: { provider_id: string }): Promise<CommandResult>;
  /**
   * What one level means, fleet-wide (MAR-654).
   *
   * Optional for the reason the two above are, and the degradation is the same
   * shape: a shell older than this draws the level rows and whatever is mapped —
   * both come through the view — and cannot change them. Reads, refuses to act.
   */
  setLevelModel?(args: {
    provider_id: string;
    level: string;
    model_id?: string;
  }): Promise<CommandResult>;
  /**
   * The chief's own model, read before the fleet default rather than instead
   * of it (MAR-696, ADR 0023 amendment 1).
   *
   * Optional for the three above's reason, and the same degradation: a shell
   * older than this command draws the model line already in force — it comes
   * through the view — and cannot change it. Reads, refuses to act.
   */
  setChiefModel?(args: { provider_id?: string; model_id?: string }): Promise<CommandResult>;
  /**
   * Asking an agent a question (MAR-545).
   *
   * Optional for the reason every method here is, and this is the one where the
   * degradation matters most: a shell older than this command has a bridge
   * without it, and a page that assumed otherwise would throw on a control the
   * person just pressed. What it degrades *to* is right, though — the whole
   * conversation is in the view and reads perfectly in a browser tab; only
   * asking something new needs the installed app.
   */
  askQuestion?(args: {
    agent_id: string;
    connection_id: string;
    field_id: string;
    question: string;
  }): Promise<CommandResult>;
  /**
   * Ask the chief about the fleet, and forget what it said (MAR-659, ADR 0023).
   *
   * Optional for `askQuestion`'s reason, and the degradation is the same shape:
   * the whole conversation arrives in the fleet view and reads perfectly in a
   * browser tab, because it is stored now. Only asking something new, and
   * clearing the thread, need the installed app.
   */
  askChief?(args: { question: string }): Promise<CommandResult>;
  clearChiefThread?(): Promise<CommandResult>;
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
   * Start one registered agent's process on this computer (MAR-657).
   *
   * Optional for the reason everything around it is: an installed shell built
   * before this feature has a `dashShell` without it, and a page that assumed
   * otherwise would throw where a refusal is the honest answer. That case is
   * real here rather than theoretical — this method is the only way the control
   * MAR-657 adds can do anything, so an older shell has to be told it cannot
   * rather than shown a button that throws.
   */
  startAgent?(args: { agent_id: string }): Promise<CommandResult>;
  /**
   * DASH's two removal actions (MAR-595 finding 18).
   *
   * Optional for the same reason as everything above: a shell built before
   * this feature has a `dashShell` without them. `removeAgent` also deletes
   * DASH's own copy of the agent's files; `removeAgentKeepFiles` leaves that
   * copy where it is.
   */
  removeAgent?(args: { agent_id: string }): Promise<CommandResult>;
  removeAgentKeepFiles?(args: { agent_id: string }): Promise<CommandResult>;
  /**
   * Set — or clear — the name DASH shows for one agent (MAR-589).
   *
   * Optional for the same reason as everything above: a shell built before
   * this feature has a `dashShell` without it.
   */
  renameAgent?(args: { agent_id: string; display_name?: string }): Promise<CommandResult>;
  /**
   * Star — or unstar — one agent, for the fleet rail's own filter (MAR-640).
   *
   * Optional for the same reason as everything above: a shell built before
   * this feature has a `dashShell` without it.
   */
  setAgentFavourite?(args: { agent_id: string; favourite: boolean }): Promise<CommandResult>;
  /**
   * Swap the character DASH draws for one agent, from `O_FLEET`'s eleven
   * (MAR-615).
   *
   * Optional for the same reason as everything above: a shell built before
   * this feature has a `dashShell` without it.
   */
  setAgentAvatar?(args: { agent_id: string; avatar: string }): Promise<CommandResult>;
  /**
   * Remember — or forget — an agent's answer to one runtime question
   * (MAR-681).
   *
   * Optional for the same reason as everything above: a shell built before
   * this feature has a `dashShell` without them.
   */
  setStandingAnswer?(args: {
    agent_id: string;
    question_label: string;
    option_id: string;
    option_label: string;
  }): Promise<CommandResult>;
  clearStandingAnswer?(args: { agent_id: string; question_key: string }): Promise<CommandResult>;
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
   * The four fleet commands (MAR-593, ADR 0013).
   *
   * Optional for the reason every method added since the host family is, and the
   * degradation here is the one worth stating: a shell older than these draws
   * the Connections page — the catalogue and what DASH holds both come through
   * the view and need no bridge — and cannot connect anything on it. So the page
   * reads correctly and refuses to act, which is the right way round.
   */
  connectFleet?(args: FleetCommandArgs): Promise<CommandResult>;
  testFleet?(args: FleetCommandArgs): Promise<CommandResult>;
  disconnectFleet?(args: FleetCommandArgs): Promise<CommandResult>;
  shareFleet?(args: FleetCommandArgs): Promise<CommandResult>;
  defaultFleet?(args: FleetCommandArgs & { account_id: string }): Promise<CommandResult>;
  assignFleet?(args: FleetAssignmentCommandArgs): Promise<CommandResult>;
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
  /**
   * Start the copy that is on a server (MAR-602, ADR 0014).
   *
   * The newest method on the bridge, so its optionality is the live case rather
   * than the historical one: a DASH installed before this work has every method
   * around it and not this. Taking the same target as `deployAgentToHost` and no
   * task id — a page has never seen the server's snapshot and cannot name a
   * target on it.
   */
  runAgentOnHost?(args: HostDeployCommandTarget): Promise<CommandResult>;
  /**
   * Take the copy that is on a server back (MAR-611, ADR 0017).
   *
   * The same target `deployAgentToHost` and `runAgentOnHost` take, and the same
   * optionality for the same reason — the newest method on the bridge, so a DASH
   * installed before this work has every method around it and not this one.
   */
  bringAgentHome?(args: HostDeployCommandTarget): Promise<CommandResult>;
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
  /** MAR-628, ADR 0019. One agent's controlled browser and its trail. */
  browser(agent: string): Promise<ViewResult<BrowserView>>;
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
  /* MAR-628. Same treatment, same reason. */
  const readBrowser = bridge.browser?.bind(bridge);
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
    browser: (agent) =>
      readBrowser === undefined
        ? Promise.resolve({ ok: false, recovery: describeViewFailure("refused") })
        : fromBridge(() => readBrowser(agent)),
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
    browser: (agent) => fromHttp(`/api/views/browser?agent=${encodeURIComponent(agent)}`),
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
 * Add an agent by choosing the folder it lives in (MAR-598).
 *
 * Not routed through `folderCommand` above, and the reason is its signature
 * rather than its wording: that helper exists to pass one agent id to three
 * methods, and this command has no agent and no arguments. Threading an unused
 * parameter through it to save four lines would have made the one method on this
 * bridge that deliberately takes nothing look like the three that take an id.
 *
 * The two refusals are the same two, worded for the page's primary control. The
 * second one — a shell that has a bridge and not this method — matters more here
 * than anywhere else it appears: that person is standing on the Add agent page
 * with no other way in, so the sentence names the one that still works rather
 * than telling them to open an app they already opened.
 */
export async function chooseAgentFolder(): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to add an agent from a folder.",
    };
  }
  if (bridge.chooseAgentFolder === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail:
        "This version of the DASH app cannot open a folder chooser. Use the steps below to build an agent and hand it to DASH.",
    };
  }
  return bridge.chooseAgentFolder();
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
 * The three model commands, and the two refusals they share (MAR-583).
 *
 * `folderCommand`'s shape, and the same argument for one helper rather than
 * three. What differs is the sentence naming the action, which each caller
 * supplies.
 *
 * The wording matters most on the second branch, as it did for the folder. A
 * shell older than these commands **can still show** which level each step asked
 * for — that comes off the manifest through the view and needs no bridge — so
 * the sentence says this version cannot *change* it, never anything a reader
 * could take as "DASH does not know".
 */
async function modelCommand(
  method:
    | "chooseModel"
    | "setStepLevel"
    | "listModels"
    | "setDefaultModel"
    | "listProviderModels"
    | "setLevelModel"
    | "setChiefModel",
  args: Record<string, unknown>,
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
      detail: `This version of the DASH app cannot ${cannot}. What each step asks for is shown above and is unchanged.`,
    };
  }
  // The cast is the one place this module's generic helper meets three different
  // argument shapes. Each caller below builds the shape its own method declares,
  // and the preload allowlists the payload keys again on the other side, so a
  // wrong field here reaches a refusal rather than main.
  return (call as (input: Record<string, unknown>) => Promise<CommandResult>)(args);
}

export async function chooseAgentModel(args: {
  agent_id: string;
  connection_id?: string;
  field_id?: string;
  model_id?: string;
}): Promise<CommandResult> {
  return modelCommand("chooseModel", args, "change which model this agent uses");
}

export async function setAgentStepLevel(args: {
  agent_id: string;
  step: number;
  level?: string;
}): Promise<CommandResult> {
  return modelCommand("setStepLevel", args, "change what one step of this agent's plan asks for");
}

export async function listAgentModels(args: {
  agent_id: string;
  connection_id: string;
  field_id: string;
}): Promise<CommandResult> {
  return modelCommand("listModels", args, "ask this agent's provider which models it offers");
}

/**
 * Set or clear DASH's default model (MAR-642).
 *
 * No arguments is how it is cleared, which is `chooseAgentModel`'s rule one
 * level up: the absent field is the instruction, so there is no second command
 * and no magic value.
 */
export async function setDefaultModel(
  args: { provider_id?: string; model_id?: string } = {},
): Promise<CommandResult> {
  return modelCommand("setDefaultModel", args, "change the model new agents use");
}

/** Ask one provider which models the key DASH holds for you can reach. */
export async function listProviderModels(args: {
  provider_id: string;
}): Promise<CommandResult> {
  return modelCommand("listProviderModels", args, "ask that provider which models it offers");
}

/**
 * Say what one level means, or clear it (MAR-654).
 *
 * An absent `model_id` clears, which is `setDefaultModel`'s rule one row along:
 * the absent field is the instruction, so there is no second command and no
 * magic value.
 */
export async function setLevelModel(args: {
  provider_id: string;
  level: string;
  model_id?: string;
}): Promise<CommandResult> {
  return modelCommand("setLevelModel", args, "change what one kind of step runs on");
}

/**
 * Set or clear the chief's own model (MAR-696).
 *
 * `setDefaultModel`'s exact shape: no arguments is how it is cleared, and
 * clearing puts the chief back on DASH's fleet default rather than on
 * nothing — `readEffectiveChiefModel` is what a reader resolves that
 * through.
 */
export async function setChiefModel(
  args: { provider_id?: string; model_id?: string } = {},
): Promise<CommandResult> {
  return modelCommand("setChiefModel", args, "change the model the chief asks under");
}

/**
 * Ask this agent's model a question (MAR-545).
 *
 * `modelCommand`'s two refusals, worded for this surface. The second is the one
 * worth reading: a shell that cannot ask a new question can still *show* every
 * question and answer already recorded, because those arrive in the view like
 * everything else — so the sentence says this version cannot ask, and never
 * anything a reader could take as "the conversation is gone".
 */
export async function askAgentQuestion(args: {
  agent_id: string;
  connection_id: string;
  field_id: string;
  question: string;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to ask this agent a question.",
    };
  }
  if (bridge.askQuestion === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail:
        "This version of the DASH app cannot ask a question. Everything already asked is shown below.",
    };
  }
  return bridge.askQuestion(args);
}

/**
 * Ask the chief about your fleet (MAR-659, ADR 0023).
 *
 * `askAgentQuestion`'s three refusals, and the third sentence is the one worth
 * reading: a shell too old for this command still shows the whole conversation,
 * because the transcript is in the fleet view like everything else. Only asking
 * something new needs the installed app.
 */
export async function askChief(args: { question: string }): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to ask the chief a question.",
    };
  }
  if (bridge.askChief === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail:
        "This version of the DASH app cannot ask the chief a question. Everything already asked is shown below.",
    };
  }
  return bridge.askChief(args);
}

/**
 * Forget the whole conversation with the chief (MAR-659).
 *
 * Refused rather than faked where the bridge cannot reach the store, because the
 * one thing a clear must never do is report a conversation deleted that is still
 * on disk.
 */
export async function clearChiefThread(): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge?.clearChiefThread === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to clear this conversation.",
    };
  }
  return bridge.clearChiefThread();
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
 * Save one briefing as a PDF and open it (MAR-674, ADR 0025 decision 4).
 *
 * `downloadOutput`'s twin, and the two refusals above are worth keeping
 * separate rather than sharing: a browser tab cannot print through Electron at
 * all, and an older installed build has the command but not this member. Both
 * sentences name what to do rather than what failed.
 */
export async function exportBriefAsPdf(args: {
  agent_id: string;
  artifact_id: string;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to save this briefing as a PDF.",
    };
  }
  if (bridge.exportBriefAsPdf === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "This version of the DASH app cannot save a briefing as a PDF yet.",
    };
  }
  return bridge.exportBriefAsPdf(args);
}

/**
 * Open one address the agent collected, outside DASH (MAR-698).
 *
 * ## The browser-tab refusal here is a fallback rather than a message
 *
 * Every other function in this module composes a sentence for a host that
 * cannot act, because a button that did nothing has to say why. This one is
 * different: on the developer path the page is in a real browser, and an anchor
 * whose click was not intercepted has already done the right thing on its own.
 * So `LinkOut` calls this **only** when the bridge is there, and lets the
 * anchor behave like an anchor otherwise. The refusal below is what a caller
 * that did not check gets, and it names the app rather than the link.
 *
 * The `https` rule is not restated here, deliberately. A check in the renderer
 * would be a second copy of a rule that has to hold in main anyway, free to
 * drift from it and worth nothing against a compromised page. See
 * `lib/shell/outbound.ts`, which is the only place it is written down.
 */
export async function openLink(args: { url: string }): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge?.openLink === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to follow this link.",
    };
  }
  return bridge.openLink(args);
}

/**
 * Open one file DASH saved for this agent (MAR-697).
 *
 * `openLink`'s twin with the opposite degradation, and the refusal here is a
 * real message rather than a fallback: a browser tab has no way at all to open
 * a file on this computer, and there is no anchor behaviour to fall back to
 * because this list names files rather than addresses.
 */
export async function openExport(args: {
  agent_id: string;
  file: string;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge?.openExport === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to open this file.",
    };
  }
  return bridge.openExport(args);
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
 * DASH's two removal actions (MAR-595 finding 18).
 *
 * Two functions rather than one taking a boolean, mirroring the two named
 * preload methods they call: `removeAgent` also deletes DASH's own copy of
 * the agent's files, `removeAgentKeepFiles` leaves that copy in place. Both
 * refuse honestly in a host with no bridge, or an installed shell old enough
 * not to have the method yet — the same shape as `retireRunnerStore` above.
 */
export async function removeAgent(args: { agent_id: string }): Promise<CommandResult> {
  return agentIdCommand("removeAgent", args, "remove an agent");
}

export async function removeAgentKeepFiles(args: { agent_id: string }): Promise<CommandResult> {
  return agentIdCommand("removeAgentKeepFiles", args, "remove an agent");
}

/**
 * Start one registered agent's process on this computer (MAR-657).
 *
 * `agentIdCommand`'s shape and its refusals, which is the point: this is the
 * same family of act — DASH operating on something it launched — reaching the
 * same lifecycle route through the same audited channel. The two refusals below
 * are the ones that matter, and the second is not hypothetical: an installed
 * shell older than this feature has a `dashShell` with no `startAgent`, and it
 * is better told so than left with a button that throws.
 */
export async function startAgent(args: { agent_id: string }): Promise<CommandResult> {
  return agentIdCommand("startAgent", args, "start an agent");
}

async function agentIdCommand(
  method: "removeAgent" | "removeAgentKeepFiles" | "startAgent",
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
      detail: `This version of the DASH app cannot ${cannot} yet.`,
    };
  }
  return call(args);
}

/**
 * Set — or clear — the name DASH shows for one agent (MAR-589).
 *
 * `agentIdCommand`'s shape, and its own function rather than a third case
 * added there: the argument carries an optional `display_name` the two
 * removal methods have no equivalent of.
 */
export async function renameAgent(args: {
  agent_id: string;
  display_name?: string;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to rename an agent.",
    };
  }
  const call = bridge.renameAgent;
  if (call === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "This version of the DASH app cannot rename an agent yet.",
    };
  }
  return call(args);
}

/**
 * Star — or unstar — one agent, for the fleet rail's own filter (MAR-640).
 *
 * `renameAgent`'s shape exactly, for the same reason: a browser tab cannot
 * act, and an older packaged build may not carry this method yet.
 */
export async function setAgentFavourite(args: {
  agent_id: string;
  favourite: boolean;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to star an agent.",
    };
  }
  const call = bridge.setAgentFavourite;
  if (call === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "This version of the DASH app cannot star an agent yet.",
    };
  }
  return call(args);
}

/**
 * Swap the character DASH draws for one agent, from `O_FLEET`'s eleven
 * (MAR-615).
 *
 * `renameAgent`'s shape exactly, for the same reason: a browser tab cannot
 * act, and an older packaged build may not carry this method yet. `avatar`
 * is typed against `O_FLEET`, not `OName`, so a picker offering the chief is
 * a compile error here rather than a refusal `lib/store.ts`'s `setAgentAvatar`
 * would otherwise have to catch alone.
 */
export async function setAgentAvatar(args: {
  agent_id: string;
  avatar: (typeof O_FLEET)[number];
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to change an agent's avatar.",
    };
  }
  const call = bridge.setAgentAvatar;
  if (call === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "This version of the DASH app cannot change an agent's avatar yet.",
    };
  }
  return call(args);
}

/**
 * Remember an agent's answer to one runtime question: "always this"
 * (MAR-681).
 *
 * `setAgentAvatar`'s shape exactly, for the same reason: a browser tab cannot
 * act, and an older packaged build may not carry this method yet.
 */
export async function setStandingAnswer(args: {
  agent_id: string;
  question_label: string;
  option_id: string;
  option_label: string;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to remember an answer.",
    };
  }
  const call = bridge.setStandingAnswer;
  if (call === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "This version of the DASH app cannot remember an answer yet.",
    };
  }
  return call(args);
}

/** `setStandingAnswer`'s undo. */
export async function clearStandingAnswer(args: {
  agent_id: string;
  question_key: string;
}): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  if (bridge === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to forget a standing answer.",
    };
  }
  const call = bridge.clearStandingAnswer;
  if (call === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "This version of the DASH app cannot forget a standing answer yet.",
    };
  }
  return call(args);
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
 * Submit one fleet action through its named preload method (MAR-593).
 *
 * The switch is `submitConnectionCommand`'s and exists for its reason: a generic
 * `fleet(action, provider)` would let page script address whatever the fifth
 * verb turns out to be. Nothing in the arguments or the return value can hold a
 * credential — `connect` asks main to open its own prompt or its own sign-in
 * window, and what happens in either never comes back through here.
 *
 * A missing method is a shell older than this feature, and it refuses with the
 * sentence that names the actual next step rather than throwing on a control the
 * person just pressed.
 */
export async function submitFleetCommand(
  action: "connect" | "test" | "disconnect" | "share" | "default" | "assign",
  args: FleetCommandArgs | FleetAssignmentCommandArgs,
): Promise<CommandResult> {
  const bridge = typeof window === "undefined" ? undefined : window.dashShell;
  const method =
    action === "connect"
      ? bridge?.connectFleet
      : action === "test"
        ? bridge?.testFleet
        : action === "disconnect"
          ? bridge?.disconnectFleet
      : action === "share"
        ? bridge?.shareFleet
        : action === "default"
          ? bridge?.defaultFleet
          : bridge?.assignFleet;

  if (bridge === undefined || method === undefined) {
    return {
      ok: false,
      request_id: "",
      reason: "read_only_host",
      detail: "Open the installed DASH app to connect a service.",
    };
  }
  return method.call(bridge, args);
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
  action: "deploy" | "run" | "bringHome",
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
  action: "create" | "probe" | "trust" | "setup" | "deploy" | "run" | "bringHome" | "forget",
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
    case "run":
      if (bridge.runAgentOnHost === undefined) {
        return {
          ok: false,
          request_id: "",
          reason: "read_only_host",
          detail: "This version of the DASH app cannot start an agent on a server yet.",
        };
      }
      return bridge.runAgentOnHost(target as HostDeployCommandTarget);
    case "bringHome":
      if (bridge.bringAgentHome === undefined) {
        return {
          ok: false,
          request_id: "",
          reason: "read_only_host",
          detail: "This version of the DASH app cannot bring an agent home yet.",
        };
      }
      return bridge.bringAgentHome(target as HostDeployCommandTarget);
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
