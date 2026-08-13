/**
 * Electron main-process skeleton.
 *
 * ADR 0001 (Accepted) adopts Electron as DASH's installable shell. This is the
 * first structural slice of it: a window, the security posture, and the audited
 * command boundary. Nothing else.
 *
 * **What this deliberately does not do**, per the ADR's "Not decided here":
 * no secret storage, no `safeStorage`, no OAuth, no credential UI, no local
 * bridge or ingest server, no packaging. `SecureStore` (`lib/secure-store.ts`)
 * is a seam with no implementation, and nothing in this file touches it.
 *
 * The file is intentionally thin. Everything with a rule in it — the renderer
 * posture, the URL allowlist, the command review — lives in pure modules under
 * `lib/shell/` that are unit-tested without launching Electron. What remains
 * here is wiring, which is the part that cannot be tested without a real
 * Electron process and therefore should be as small as possible.
 */

// MUST BE FIRST. This import's side effect points the store at the per-user
// data directory, and ES modules evaluate imports in source order — so it runs
// before the runner's import chain below reaches `lib/db.ts`, which resolves its
// location once at module-evaluation time. Moving or sorting this line silently
// sends the store back to the source tree; `assertStoreLocation` catches that at
// startup. See `electron/data-dir.ts`.
import { assertStoreLocation } from "./data-dir";

// ALSO ORDER-SENSITIVE, for the same reason and one step further along.
// `lib/contracts.ts` resolves and caches the schema directory at first use, so
// a packaged app has to name it before anything validates anything. See
// `electron/resources.ts` — the fallbacks it replaces are correct in a
// development tree and wrong in an install, which is the worst combination.
import { assertContractsLocation } from "./resources";

import { ignoreBrokenPipeErrors } from "../lib/shell/pipe-guard";

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from "electron";
import { readUiScale, writeUiScale } from "./ui-scale";
import { DEFAULT_UI_SCALE, UI_SCALES, parseUiScale, type UiScale } from "../lib/views/ui-scale";

import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  localPrincipal,
  noAdapter,
  runAgentCommand,
  type AgentCommandInput,
} from "../lib/agent-dom/runner";
import { readStoreDamage } from "../lib/agent-dom/transport";
import { probeModelProvider } from "../lib/ai/probe";
import { heldCredentials, performConnectionAction } from "../lib/connection-actions";
import {
  deliverableFields,
  deliverableSecretFields,
  resolveCredentialTarget,
  type CredentialTarget,
} from "../lib/connection-credentials";
import type { ConnectionSourceManifest } from "../lib/connections";
import { listAiKeyModels } from "../lib/ai/actions";
import { performAskAction } from "./ask-host";
import {
  bundledModelChoice,
  resolveModelSteps,
  type BundledModelChoice,
} from "../lib/ai/model-choice";
import { stepsNeedingAModel } from "../lib/ai/model-levels";
import {
  clearAgentModelChoice,
  clearStepLevelOverride,
  readAgentModelChoice,
  readStepLevelOverrides,
  writeAgentModelChoice,
  writeStepLevelOverride,
} from "../lib/ai/model-store";
import {
  readDashLastAlive,
  recordClosedWindow,
  writeDashLastAlive,
} from "../lib/broker/store";
import { closeDb, dataDir } from "../lib/db";
import {
  checkHostRecord,
  describeDuplicateHost,
  findDuplicateHost,
  type HostRecord,
} from "../lib/hosts";
import { describeBundleContents, produceAgentFolderBundle } from "../lib/deploy/folder-bundle";
import { readRegistration } from "../lib/registration";
import type { HandoffPorts } from "../lib/handoff-flow";
import { findDeepLink } from "../lib/shell/deep-link";
import { OPEN_HOST, deepLinkAuthority, parseOpenLink } from "../lib/open-link";
import { agentWorkspaceHref } from "../app/_data/routes";
import { applicationMenu, type MenuAction, type MenuItemSpec } from "../lib/shell/menu";
import {
  SHELL_COMMAND_CHANNEL,
  dispatchCommand,
  formatAuditLine,
  type HostAction,
  type HostActionResult,
  type RenameAction,
  type RunnerLifecycleResult,
  type WorkspaceAction,
  type WorkspaceActionResult,
} from "../lib/shell/ipc";
import { declaredLimitsFor } from "../lib/views/inputs";
import {
  SHELL_READ_CHANNEL,
  reviewRead,
  type ReadResponse,
  type ReadResults,
} from "../lib/shell/read";
import {
  agentsView,
  connectionsView,
  hostsView,
  notificationsView,
  runView,
  runsView,
  workInboxView,
  workspaceView,
} from "../lib/views/build";
import { createAgentChannels, startPolling, type AgentChannels } from "./agent-adapters";
import { startApprovalNotifier } from "./approval-notifier";
import {
  closeApprovalPopup,
  focusApprovalPopup,
  setApprovalPopupVisible,
} from "./approval-popup";
import {
  handoffPorts,
  openHandoffLink,
  registerProtocolClient,
  removeAgentWithReport,
  runnerPort,
  surfaceWindow,
} from "./handoff-host";
import {
  assertRendererPresent,
  registerRendererScheme,
  serveRenderer,
} from "./renderer-host";
import { RENDERER_ENTRY_URL, RENDERER_ORIGIN } from "../lib/shell/renderer-scheme";
import {
  findHostByConnection,
  forgetHost,
  forgetHostDeploys,
  importManifest,
  listAgentNames,
  listHosts,
  pinHostFingerprint,
  readAgentManifest,
  readHost,
  readNotificationSettings,
  recordAgentDeploy,
  recordAgentLook,
  renameAgent,
  saveHost,
} from "../lib/store";
// MAR-576. The folder is authoritative (ADR 0008), so the re-import reads it
// before the row — see `refreshSampleAgent`.
import { readAgentFolderManifest } from "../lib/agent-folders";
import { isScaffoldedByDash, refreshedManifest } from "../lib/sample-refresh";
import {
  promptForAuthorization,
  promptForSecret,
  registerCredentialChannels,
} from "./credential-prompt";
import { performFolderAction } from "./folder-update";
import { buildNotifyConfiguration, performNotifyAction } from "./notify-settings";
import { providerOperations } from "./oauth-session";
import { hostBroker, startBroker } from "./broker-host";
import { ensureRunner, runnerFetch, stopRunner, type RunnerHandle } from "./runner-process";
import { assertSampleTemplatesPresent, offerSampleAgent } from "./sample-agent";
import {
  SHELL_WEB_PREFERENCES,
  assertHardenedWebPreferences,
  isAllowedRendererUrl,
} from "../lib/shell/window";
// MAR-440 / MAR-436. The window's colours and geometry, decided once for the
// three processes that need them; see `lib/shell/chrome.ts`.
import { SURFACE_0, resolveTheme, titleBarOverlay, titleBarStyle } from "../lib/shell/chrome";
import { appWindow, clearAppWindow, setAppWindow } from "./app-window";
import { openSplash, type SplashWindow } from "./splash";
import type { StartupStepId } from "../lib/shell/splash";
import { secureStore } from "./secure-store";
import {
  assertHostKeyProtected,
  createHostKey,
  forgetHostKey,
  forgetHostKeyPin,
  hostScanRefusal,
  knownHostsPath,
  openSshChannel,
  pinHostKey,
  probeSshTools,
  readHostPublicKey,
  runDeployVerb,
  scanHostKey,
  sshDeploySpawn,
  type SshDiagnostics,
} from "./ssh-host";
import { runAgentOnHost } from "./host-run";
import { bringAgentHomeFromHost } from "./host-bring-home";
import { authorizedKeysLine, buildBootstrapScript } from "../lib/host-bootstrap";
import { classifyHostFailure, type HostReachProblem } from "../lib/host-connect";
import type { Recovery } from "../lib/copy/recovery";

// MAR-595 finding 12. Every import above can log through `console.warn` or
// `console.error` as a side effect, and every module-level statement below
// does too — either can be the write that hits a reader that is already gone.
// This has to run before any of them, which under ES module evaluation order
// means "first statement after the last import", since the imports above have
// already run by the time execution reaches here regardless of where in this
// file they were written. See `lib/shell/pipe-guard.ts`.
ignoreBrokenPipeErrors([process.stdout, process.stderr]);

/**
 * Where the renderer loads from.
 *
 * The developer path is the loopback Next dev server, which ADR 0001 keeps as a
 * second entry point. The packaged app will point this at a local static
 * export. Either way it goes through `isAllowedRendererUrl` — an env var is
 * caller-controlled input, and "no remote content in the renderer" has to hold
 * even when the caller is us.
 */
const DEFAULT_RENDERER_URL = "http://127.0.0.1:3000";

/** Stops the Agent DOM state poller. Null when no runner was available. */
let stopPolling: (() => void) | null = null;

/** Stops the permission broker's loop (MAR-458). Null when there is no runner. */
let stopBroker: (() => void) | null = null;

/** Stops the uptime heartbeat (MAR-467). */
let stopHeartbeat: (() => void) | null = null;

/** Stops the approval notifier/popup watcher (MAR-421). */
let stopApprovalNotifier: (() => void) | null = null;

/**
 * The startup window, while it is up (MAR-436). Null once the app window has
 * painted, which is the normal ending.
 */
let splash: SplashWindow | null = null;

/**
 * The step now under way, so a throw can be described rather than dumped.
 *
 * Assigned *before* each step runs, never after. That ordering is the whole
 * mechanism: `catch` reads whatever was last assigned, so the value it finds is
 * the step that was in progress when something threw.
 */
let splashStep: StartupStepId | null = null;

/**
 * True once the splash is showing a startup failure.
 *
 * DASH stops exiting immediately in that case — the window has become the only
 * report a person will ever see — so the non-zero exit has to happen when they
 * close it instead. Without this flag `window-all-closed` cannot tell a failed
 * launch from an ordinary quit, and a broken install would exit 0.
 */
let startupFailed = false;

/**
 * How often DASH writes down that it is still running (MAR-467).
 *
 * This interval is the resolution of every "DASH was closed from X to Y"
 * sentence, and the error is one-sided: the recorded window starts at the last
 * heartbeat, so it can overstate DASH's absence by up to this much and can never
 * understate it. Thirty seconds keeps that overstatement smaller than the
 * `MIN_CLOSED_WINDOW_MS` threshold a window has to clear to be recorded at all,
 * which is what stops the rounding from manufacturing windows.
 *
 * A crash is the case that makes a periodic write necessary rather than a single
 * one on quit: `before-quit` does not run when a process is killed, and the
 * launches most worth explaining are the ones that follow a launch that ended
 * badly.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

function startHeartbeat(): () => void {
  writeDashLastAlive(new Date().toISOString());
  const timer = setInterval(() => {
    writeDashLastAlive(new Date().toISOString());
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return () => {
    clearInterval(timer);
  };
}

/**
 * The handoff ports, once the runner's fate is known (MAR-428).
 *
 * Null until `whenReady` has resolved. A `dash://` link can arrive before that —
 * a cold start *is* the link — so links are queued rather than dropped, and
 * `drainHandoffQueue` runs them once there is a store, a window and either a
 * runner or a decided absence of one.
 */
let handoffContext: HandoffPorts | null = null;
const pendingHandoffs: string[] = [];

/**
 * One link at a time, in the order they arrived.
 *
 * An impatient double click on "Open in DASH" produces two identical links. The
 * flow's idempotency makes the *outcome* right either way; serialising is what
 * stops two modal dialogs racing each other in front of one confused user.
 */
let handoffChain: Promise<void> = Promise.resolve();

function enqueueHandoff(url: string): void {
  if (handoffContext === null) {
    pendingHandoffs.push(url);
    return;
  }
  const ports = handoffContext;
  handoffChain = handoffChain
    .then(async () => {
      await openHandoffLink(url, ports);
    })
    .catch((error: unknown) => {
      // A throw here would leave the chain permanently rejected and every later
      // link silently ignored, which is the worst failure this feature has: the
      // user clicks and nothing at all happens, forever.
      console.error(
        `[dash-shell] handoff failed: ${error instanceof Error ? error.stack : String(error)}`,
      );
    });
}

function drainHandoffQueue(ports: HandoffPorts): void {
  handoffContext = ports;
  const queued = pendingHandoffs.splice(0, pendingHandoffs.length);
  for (const url of queued) {
    // Back through the dispatcher rather than straight to `enqueueHandoff`
    // (MAR-588). The queue holds both kinds of link now, and re-deciding here is
    // what keeps a cold-start `dash://open` from being opened as a handoff and
    // refused as a malformed one.
    enqueueDeepLink(url);
  }
}

/**
 * Route one arriving `dash://` link by its authority (MAR-588).
 *
 * There are two now. `lib/handoff.ts` anticipated this — "a fixed word rather
 * than a free-form path so that adding a second kind of deep link later is a new
 * authority with its own parser" — and this is the fork that keeps the two
 * apart at the top rather than inside either parser.
 *
 * The asymmetry between the branches is the point and is worth reading twice. A
 * handoff can end with DASH registering a program somebody else wrote, so it
 * goes through a consent dialog, a nonce, a TTL and a serialised queue. An open
 * link can only ever end with a page being shown, so it goes through a parser
 * and a navigation and nothing else. Giving the second one the first one's
 * apparatus would not make it safer; it would make a person clicking a link in
 * their own Discord channel answer a security question about looking at their
 * own agent.
 *
 * An unknown authority falls through to the handoff branch deliberately, rather
 * than being dropped here. `lib/shell/deep-link.ts` states the rule: a malformed
 * link must reach the layer that produces a user-facing refusal, because a link
 * silently ignored looks, to the person who clicked it, exactly like DASH being
 * broken.
 */
function enqueueDeepLink(url: string): void {
  if (handoffContext === null) {
    // A cold start *is* the link, for both kinds, so both queue. Without this an
    // `open` link that launched DASH would arrive before there was a window to
    // navigate and would be silently lost — the exact failure the handoff queue
    // was built to avoid, arriving through the new door.
    pendingHandoffs.push(url);
    return;
  }
  if (deepLinkAuthority(url) === OPEN_HOST) {
    openDeepLink(url);
    return;
  }
  enqueueHandoff(url);
}

/**
 * Show the surface a `dash://open?…` link named.
 *
 * `loadURL` rather than a message to the renderer, because the renderer is a
 * static export in which every surface is its own page, and because a link may
 * arrive before any window has been told anything — a cold start *is* the link.
 * The route is built from `agentWorkspaceHref`, so the address this opens and the
 * address the agents list links to are the same string from the same function.
 *
 * A link that does not parse surfaces the window and stops. That is the honest
 * response to "somebody sent DASH an address it will not act on": the app comes
 * forward, where the person can see their agents and find whatever they were
 * looking for. Nothing is registered, nothing is answered, and nothing is
 * approved — see `lib/open-link.ts` for why that list is exhaustive.
 */
function openDeepLink(url: string): void {
  surfaceWindow();

  const parsed = parseOpenLink(url);
  if (!parsed.ok) {
    console.warn(`[dash-shell] ignored a link DASH would not have written (${parsed.refusal})`);
    return;
  }

  const window = appWindow();
  if (window === null) {
    return;
  }
  // The run is deliberately not used to pick a different page. An agent's own
  // workspace is where its latest report and its pending approvals both are, so
  // one destination answers both kinds of message — and a report link that
  // landed on a run's history page would put a person one click further from the
  // thing they came back to do.
  void window.webContents
    .loadURL(`${RENDERER_ORIGIN}${agentWorkspaceHref(parsed.target.agent)}`)
    .catch((error: unknown) => {
      console.error(`[dash-shell] a deep link could not open its page: ${String(error)}`);
    });
}

function rendererUrl(): string {
  // Packaged: the static export, served from inside the install over DASH's own
  // scheme (MAR-432). Unpacked: the loopback dev server, unchanged.
  // `DASH_SHELL_URL` still overrides both, and still goes through the allowlist
  // — which is also how the packaged renderer is exercised without packaging:
  // `pnpm build:renderer && DASH_SHELL_URL=dash-app://ui/ pnpm shell`.
  const url =
    process.env.DASH_SHELL_URL ?? (app.isPackaged ? RENDERER_ENTRY_URL : DEFAULT_RENDERER_URL);
  if (!isAllowedRendererUrl(url)) {
    // Fail loudly at startup rather than rendering off-machine content in a
    // window that holds a command channel.
    throw new Error(
      `Refusing to load "${url}": DASH's renderer may only load its installed origin or a loopback development origin.`,
    );
  }
  return url;
}

/**
 * Install the application menu (MAR-423).
 *
 * The template is `lib/shell/menu.ts`'s and is pure; this turns each `action`
 * into a handler. The mapping is a `switch` over a union rather than a lookup
 * table so that adding a menu action without wiring it is a compile error —
 * the same argument `executeCommand` makes about the command catalogue.
 *
 * Every DASH-specific item goes through this one function, so a future item that
 * does something consequential cannot quietly acquire a handler that skips
 * whatever the consequential thing needs.
 */
function installApplicationMenu(): void {
  const toItem = (spec: MenuItemSpec): Electron.MenuItemConstructorOptions => {
    if (spec.separator === true) {
      return { type: "separator" };
    }
    if (spec.role !== undefined) {
      return {
        role: spec.role as Electron.MenuItemConstructorOptions["role"],
        accelerator: spec.accelerator,
        click: spec.action === undefined ? undefined : () => void runMenuAction(spec.action),
      };
    }
    return {
      label: spec.label,
      accelerator: spec.accelerator,
      click: () => {
        void runMenuAction(spec.action);
      },
    };
  };

  const menu = Menu.buildFromTemplate(
    applicationMenu(process.platform, app.getName()).map((spec) => ({
      label: spec.label,
      submenu: spec.items.map(toItem),
    })),
  );

  /*
   * Still `setApplicationMenu`, even though MAR-440 hides the bar.
   *
   * This is the line that registers the accelerators. A hidden application menu
   * goes on answering Ctrl+R, Ctrl+Shift+I, F11 and the clipboard shortcuts;
   * a menu that was merely *built* and popped up on demand would answer none of
   * them, and the issue is explicit that "their accelerators must keep working".
   *
   * On Windows the bar itself stops being drawn because `titleBarStyle` is
   * `hidden` — there is no caption area for it to live in — so no extra call is
   * needed to hide it, and adding `setMenuBarVisibility(false)` would suggest
   * the two are related when only one of them is doing anything.
   */
  Menu.setApplicationMenu(menu);
  applicationMenuInstance = menu;
}

/**
 * The built menu, kept so `shell.menu` can pop the same one (MAR-440).
 *
 * `Menu.getApplicationMenu()` would also return it. Holding the reference is
 * for the failure case rather than the happy one: if something ever replaces
 * the application menu, popping whatever is currently installed would show the
 * user a menu DASH did not build, and holding this makes the button show DASH's
 * menu or nothing.
 */
let applicationMenuInstance: Menu | null = null;

/**
 * Show the application menu, at a point the renderer asked for (MAR-440).
 *
 * The renderer reaches this through `shell.menu` on the audited command
 * channel, which carries two numbers. It cannot name a menu or an item — this
 * function looks up neither — so the button in the title bar can *display* the
 * menu and can never invoke anything in it. Every click is still main's own
 * handler, as it was when the bar was visible.
 */
function showApplicationMenu(at: { x: number; y: number } | undefined): void {
  const window = appWindow();
  if (applicationMenuInstance === null || window === null) {
    return;
  }
  applicationMenuInstance.popup(at === undefined ? { window } : { window, ...at });
}

async function runMenuAction(action: MenuAction | undefined): Promise<void> {
  switch (action) {
    case "sample_agent":
      // `handoffContext` is null until `drainHandoffQueue` runs, which is after
      // the store, the runner decision and the window all exist. The sample goes
      // through the same ports a deep link does, so it needs the same readiness
      // and says so rather than half-working.
      await offerSampleAgent(handoffContext);
      return;
    case "zoom_in":
      changeUiScale(1);
      return;
    case "zoom_out":
      changeUiScale(-1);
      return;
    case "reset_zoom":
      applyUiScale(DEFAULT_UI_SCALE);
      return;
    case undefined:
      return;
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled menu action: ${String(unreachable)}`);
    }
  }
}

function applyUiScale(factor: unknown): UiScale {
  const scale = writeUiScale(app.getPath("userData"), factor);
  appWindow()?.webContents.setZoomFactor(scale);
  return scale;
}

function changeUiScale(direction: 1 | -1): UiScale {
  const current = readUiScale(app.getPath("userData"));
  const index = UI_SCALES.indexOf(current);
  return applyUiScale(UI_SCALES[Math.max(0, Math.min(UI_SCALES.length - 1, index + direction))]);
}

export function createWindow(): BrowserWindow {
  // Re-assert the posture at the point of use. `SHELL_WEB_PREFERENCES` is
  // frozen, so this can only fail if someone edits the constant — which is
  // precisely the regression worth catching, and the tests catch it earlier.
  assertHardenedWebPreferences(SHELL_WEB_PREFERENCES);

  // MAR-440. The OS decides the theme unless the user has chosen; main has to
  // answer that before any stylesheet is parsed, which is why the rule lives in
  // `lib/shell/chrome.ts` beside the colours rather than only in CSS.
  const theme = resolveTheme(nativeTheme.shouldUseDarkColors, null);

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    // Do not paint an empty frame while the renderer boots.
    show: false,
    /*
     * MAR-440. The frame is ours; the buttons stay the operating system's.
     *
     * `titleBarStyle: "hidden"` with `titleBarOverlay` is the combination that
     * gets both: no native menu bar and no native caption, but minimise,
     * maximise and close are still Windows' own controls — so they are drawn in
     * the right place, in the right order for the user's locale, with the
     * right snap-layouts hover behaviour, none of which a `<button>` of ours
     * would have.
     */
    titleBarStyle: titleBarStyle(process.platform),
    ...(process.platform === "darwin" ? {} : { titleBarOverlay: titleBarOverlay(theme) }),
    /*
     * The colour behind everything, before anything.
     *
     * Electron's default is white, and it is what the eye catches on a cold
     * start and on every resize: a white frame for one or two frames, then the
     * app. Setting it here is half of MAR-436's "no unpainted or white window";
     * the splash is the other half.
     */
    backgroundColor: SURFACE_0[theme],
    webPreferences: {
      ...SHELL_WEB_PREFERENCES,
      // `fileURLToPath`, not `URL.pathname`: on Windows the latter yields
      // "/C:/Users/..." — a string Electron cannot resolve, and one that looks
      // close enough to a path to survive a code review. The preload is built
      // beside this file (see `scripts/build-shell.mjs`), so it is always the
      // sibling of whichever bundle is running.
      preload: fileURLToPath(new URL("./preload.js", import.meta.url)),
    },
  });

  // Before loadURL: the renderer is a static export and cannot restore this
  // Electron setting before its first paint.
  window.webContents.setZoomFactor(readUiScale(app.getPath("userData")));

  window.once("ready-to-show", () => window.show());

  // Without this, a renderer that fails to load never fires `ready-to-show`, so
  // `show: false` above leaves an invisible process and no message anywhere. The
  // most likely cause by far is the dev server not running, so say that.
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode: number, errorDescription: string, validatedURL: string) => {
      console.error(
        `[dash-shell] failed to load ${validatedURL}: ${errorDescription} (${errorCode}). ` +
          `If this is the developer path, is \`pnpm dev\` running?`,
      );
    },
  );

  // Two escapes from the allowlist, both closed. Without these, any link in the
  // UI — or injected into it — could navigate the privileged renderer to a
  // remote page that then has the command channel in reach.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererUrl(url)) {
      event.preventDefault();
      console.warn(`[dash-shell] blocked navigation to ${url}`);
    }
  });

  /*
   * Follow the OS if it changes while DASH is open (MAR-440).
   *
   * The renderer follows on its own — `app/tokens.css` is written in
   * `light-dark()` against `color-scheme` — but the overlay and the window's
   * background are main's, and without this the caption buttons stay in
   * yesterday's theme while everything under them switches. That seam is
   * exactly the one this issue exists to remove.
   */
  const followTheme = (): void => {
    if (window.isDestroyed() || process.platform === "darwin") {
      return;
    }
    const next = resolveTheme(nativeTheme.shouldUseDarkColors, null);
    window.setTitleBarOverlay(titleBarOverlay(next));
    window.setBackgroundColor(SURFACE_0[next]);
  };
  nativeTheme.on("updated", followTheme);
  window.on("closed", () => {
    nativeTheme.off("updated", followTheme);
    clearAppWindow(window);
  });

  setAppWindow(window);
  void window.loadURL(rendererUrl());
  return window;
}

/**
 * Register the one audited command channel.
 *
 * One `handle` call, for one channel, for every command — see `lib/shell/ipc.ts`
 * for why that is the design and not an accident. The handler's whole job is:
 * review, audit, then dispatch only if allowed.
 *
 * The IPC-level audit goes to stderr; the Agent DOM command audit is durable in
 * SQLite from MAR-417 (`command_audit`). Both are produced at the chokepoint and
 * no path skips either.
 *
 * **This is where the actor is bound.** The principal is derived from the
 * process's own OS session, here in main, and handed to the runner as a
 * parameter. The request that arrived over IPC is never consulted for it — and
 * cannot be, since no command declares a payload key that could carry one.
 */
/**
 * Does DASH already hold something for this field?
 *
 * Reads the reference table, never the vault — the same argument
 * `heldCredentials` makes for itself. Used to word the prompt: "Replace" rather
 * than "Connect", and for OAuth to offer the account already connected.
 */
function alreadyHeld(credential: CredentialTarget): boolean {
  return heldCredentials(credential.agent_id).some(
    (held) =>
      held.connection_id === credential.connection_id && held.field_id === credential.field_id,
  );
}

/** The masked hint on the row, for the prompt to show which account it means. */
function heldHintFor(credential: CredentialTarget): string | null {
  return (
    heldCredentials(credential.agent_id).find(
      (held) =>
        held.connection_id === credential.connection_id && held.field_id === credential.field_id,
    )?.masked_hint ?? null
  );
}

export function registerCommandChannel(
  channels: AgentChannels | null,
  runner: RunnerHandle | null,
): void {
  const principal = localPrincipal(userInfo().username);

  ipcMain.handle(SHELL_COMMAND_CHANNEL, async (_event, request: unknown) => {
    return dispatchCommand(request, {
      audit: (record) => console.warn(formatAuditLine(record)),
      runAgentCommand: (input: AgentCommandInput) => {
        /*
         * The press that pays for a model call (MAR-619, ADR 0016).
         *
         * `retry` is the verb behind Run now — see `buildAgentControl`, which
         * binds the pending task to it — so this line is the moment a person
         * asks for a run, and it is the **only** place in DASH that opens a
         * spend allowance. Everything else about the command is unchanged.
         *
         * Before the command rather than after its result, because the agent
         * begins working the instant the runner writes the line and would
         * otherwise race an allowance opened on the way back. The cost of that
         * ordering is a refused command that opened an allowance nothing
         * spends, and it expires on its own; the opposite ordering is a run
         * whose curation step is refused for a reason nobody can see.
         *
         * The other six verbs open nothing. `resume` in particular does not:
         * it lets a run continue that a person already paid for, and treating
         * it as a fresh press would be a second allowance for one press.
         */
        if (input.command === "retry") {
          hostBroker().allowRunSpend(input.target.agent_id, new Date());
        }
        return runAgentCommand(input, {
          principal,
          // MAR-415: the adapter is chosen per agent, and is the real HTTP one
          // for any agent DASH holds a channel to. `noAdapter` remains the
          // answer for the rest — an agent with no control location, or a
          // remote one DASH has no credential for — and it still refuses
          // honestly rather than reporting an effect nothing performed.
          adapter: channels?.adapterFor(input.target.agent_id) ?? noAdapter,
        });
      },
      runnerLifecycle: (action, agentId) => runnerLifecycle(runner, action, agentId),
      // MAR-440. Draws a menu and reaches nothing else — no store, no runner,
      // no provider. See `showApplicationMenu` for why the renderer cannot name
      // what it wants popped.
      showApplicationMenu,
      setUiScale: (factor) => {
        if (factor === undefined) {
          return readUiScale(app.getPath("userData"));
        }
        return applyUiScale(factor);
      },
      // MAR-383. The vault is reachable from exactly this one entry in exactly
      // this one context object, and the value the user types never comes back
      // through it — see `lib/connection-actions.ts` for what does.
      connectionAction: (action, target) =>
        performConnectionAction(action, target, {
          store: secureStore(),
          readManifest: (agentId) =>
            readAgentManifest(agentId) as ConnectionSourceManifest | null,
          // MAR-570. What makes "connect once, both agents light up" true: the
          // fan-out needs to know who else exists, and this module is the only
          // place that does. `findGrantSharers` decides which of them qualify —
          // a dependency that pre-filtered would be a second copy of the sharing
          // rule, free to disagree with the sentence the tile shows first.
          listAgentIds: () => listAgentNames(),
          promptForSecret: (credential, vaultLabel) =>
            promptForSecret(
              credential,
              vaultLabel,
              alreadyHeld(credential),
              appWindow(),
              RENDERER_ORIGIN,
            ),
          // MAR-446. `check` and `revoke` are pure provider calls and come from
          // `oauth-session.ts`; `authorize` needs a window to show what is about
          // to be granted, so it comes from the module that owns one.
          oauth: {
            ...providerOperations(),
            authorize: (credential, options) =>
              promptForAuthorization(
                credential,
                secureStore().describeBacking().label,
                alreadyHeld(credential),
                heldHintFor(credential),
                options.login_hint,
                options.client,
                appWindow(),
                RENDERER_ORIGIN,
              ),
          },
          // MAR-582. One `GET` to a model provider's own origin, carrying the
          // key DASH holds. No window, no vault beyond the one read the action
          // already did, and no part of the answer beyond a status and a count —
          // see `probeModelProvider`, which is where all of that is enforced.
          ai: { probe: (profile, key, wantIds) => probeModelProvider(profile, key, fetch, wantIds) },
        }),
      // MAR-536. Main owns host keys, the host store and the SSH child. The
      // preload can name only an ordinary draft or an opaque host id; it never
      // reaches a key file, and this action returns only the public half.
      hostAction,
      // MAR-507 + MAR-434. The one entry in this object that can turn a click
      // into a path on the user's own disk: the workspace helper is the only
      // place in DASH that opens a file picker, and `download` the only action
      // that raises a save dialog. What crosses back is a task id, a name and
      // a size — never a path in either direction.
      workspaceAction: (action, target) =>
        action === "download"
          ? workspaceDownload(runner, target.artifact_id ?? "")
          : workspaceAction(runner, action, target),
      // MAR-576. The only route in DASH that rewrites an author's manifest, and
      // the ownership gate that makes that safe lives inside it rather than at
      // the seam — see `refreshSampleAgent`.
      sampleAction: (_action, target) => Promise.resolve(refreshSampleAgent(target.agent_id)),
      // MAR-586. The one command in DASH about the reader rather than about
      // anything DASH supervises. Main stamps the moment from its own clock —
      // `recordAgentLook`'s default — so a renderer cannot mark an agent as read
      // at a time it chose.
      glanceAction: (_action, target) => {
        recordAgentLook(target.agent_id);
        return Promise.resolve({ ok: true });
      },
      // MAR-589. Set or clear the name DASH shows for one agent. Every gate is
      // inside `performAgentRenameAction`, beside the write it guards, for
      // `refreshSampleAgent`'s reason.
      agentAction: (action, target) =>
        Promise.resolve(performAgentRenameAction(action, target)),
      // MAR-584. The one route in DASH that accepts a document somebody else's
      // editor wrote. Every gate is inside `electron/folder-update.ts`, beside
      // the reads and the write it guards, for `refreshSampleAgent`'s reason.
      folderAction: (action, target) =>
        Promise.resolve(performFolderAction(dataDir, action, target.agent_id, runnerPort(runner))),
      // MAR-583. Which model an agent uses. Two of the three touch only DASH's
      // own choice rows; the third opens the vault and makes one `GET` to a
      // provider — the same request `connection.test` makes, keeping more of the
      // answer. Every gate is inside `performModelAction`, beside the reads it
      // guards, for `refreshSampleAgent`'s reason.
      modelAction: (action, target) => performModelAction(action, target),
      // MAR-545. The only route in DASH that can spend the person's money, and
      // the only caller anywhere that hands the broker `"person"` rather than
      // `"agent"`. Every gate is inside `electron/ask-host.ts`, beside the call
      // it guards, for `performFolderAction`'s reason.
      askAction: (_action, target) => performAskAction(target),
      // MAR-588. The only route in DASH that can send something off this machine
      // without an agent asking it to. Every gate is inside
      // `electron/notify-settings.ts`, beside the vault read and the write, for
      // `performFolderAction`'s reason — and the address is reachable from
      // exactly this one entry in exactly this one context object, which is the
      // same standing `connectionAction` has.
      notifyAction: (action, target) =>
        performNotifyAction(action, target, {
          store: secureStore(),
          promptForSecret: (request) =>
            promptForSecret(
              request,
              secureStore().describeBacking().label,
              readNotificationSettings().configured,
              appWindow(),
              RENDERER_ORIGIN,
            ),
          pushToRunner: () => pushNotifyConfiguration(runner),
        }),
    });
  });
}

/**
 * Hand the runner the channel it should post to, or take it away (MAR-588).
 *
 * Called after every settings change and once at startup. Never throws and never
 * reports: a runner that is down, starting, or built without the route is a
 * temporary state, and refusing somebody's setting because of it would be DASH
 * making a person's preference contingent on a process they cannot see.
 *
 * What it costs to be wrong is silence, and silence is the failure this whole
 * feature exists to prevent — which is why this is called more often than it
 * strictly needs to be rather than less.
 */
async function pushNotifyConfiguration(runner: RunnerHandle | null): Promise<void> {
  if (runner === null) {
    return;
  }
  try {
    const body = await buildNotifyConfiguration(secureStore());
    const response = await runnerFetch(runner)(`${runner.origin}/notify/discord`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${runner.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // The status and nothing else. The body that failed held the address.
      console.warn(
        `[dash-shell] the runner would not take the notification settings (status ${String(response.status)})`,
      );
    }
  } catch (error: unknown) {
    console.warn(
      `[dash-shell] the notification settings could not reach the runner: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Re-import an agent DASH scaffolded, from DASH's current template (MAR-576).
 *
 * ## The gate is the whole of this function's safety, so it comes first
 *
 * `isScaffoldedByDash` reads `provenance.generated_by` off the **stored**
 * document. Only a manifest DASH's own `create-dash-agent` wrote can be
 * regenerated by DASH's own template, because only for that document is the
 * template the author. Anything else — an agent a person wrote, an agent
 * exported from another tool, an agent whose scaffolded manifest somebody has
 * since edited by hand into something else — is refused, and refused *here*,
 * beside the write, where no future caller can route around it.
 *
 * The refusal is a plain sentence rather than a silent no-op. A button that
 * appeared and then did nothing would be worse than no button, and the surface
 * only ever offers this for an agent `describeManifestGap` has already
 * identified — so a refusal reaching a person means the two disagreed, which is
 * exactly the event worth saying out loud.
 *
 * ## Why the folder is read and not the row
 *
 * `readAgentManifest` answers from the store's projection, and ADR 0008 makes
 * the folder authoritative. If they disagree, the folder is the document the
 * user has, and regenerating from the row would silently discard whatever the
 * folder held — the "silent repair" that ADR forbids, performed by the one
 * command in DASH allowed to write a manifest at all. `readAgentFolderManifest`
 * is asked first and the row answers only for the row-only agents MAR-553 keeps
 * supported on purpose.
 *
 * ## What it does not do
 *
 * It does not touch the agent's own project folder. Nothing under the directory
 * the user chose is read, written or deleted: `agent.mjs`, the sources file and
 * anything they have edited are theirs, and DASH's template has no business
 * over-writing code on the strength of a button on a workspace page. What is
 * replaced is DASH's copy of the manifest, which is what decides what DASH
 * draws — and that is the entire scope of the defect this repairs.
 */
/**
 * Choose a model, set one step's level, or ask what models there are (MAR-583).
 *
 * ## Every gate is here, beside the write
 *
 * The seam in `lib/shell/ipc.ts` describes these three commands and, by
 * construction, cannot perform them. So the checks live here, in the same
 * argument `refreshSampleAgent` makes for its ownership gate: a rule stated at
 * the seam is a rule a second implementation could forget, and a rule stated
 * beside the write is unavoidable by anything that actually writes.
 *
 * There are three of them and each refuses a different kind of nonsense. The
 * agent has to be one DASH holds a manifest for. The connection and field have
 * to resolve to a target DASH would take a key for, through the same
 * `resolveCredentialTarget` the connect flow uses — so a renderer cannot name a
 * connection the manifest does not declare, or one belonging to a different
 * agent. And the target has to be a `provider_key`: naming an ordinary secret
 * field or a sign-in gets a refusal rather than a model choice filed against a
 * credential that has nothing to do with models.
 *
 * ## Putting it back is an absent field, not a value
 *
 * `model.choose` with no model id clears the row, and `model.step` with no level
 * clears that step's. Neither needs the connection to resolve, because there is
 * nothing to resolve *to* — deleting DASH's own row is not an act against a
 * provider, and requiring a live connection to undo a setting would strand
 * somebody who had disconnected their key.
 */
async function performModelAction(
  action: "choose" | "step" | "list",
  target: {
    agent_id: string;
    connection_id?: string;
    field_id?: string;
    model_id?: string;
    step?: number;
    level?: string;
  },
): Promise<{ ok: boolean; detail?: string; recovery?: Recovery; models?: string[] }> {
  const now = new Date().toISOString();

  if (action === "step") {
    if (target.step === undefined) {
      return { ok: false, detail: "DASH was not told which step to change." };
    }
    if (target.level === undefined) {
      clearStepLevelOverride(target.agent_id, target.step);
      return { ok: true, detail: "That step is back to what its plan asked for." };
    }
    const written = writeStepLevelOverride(target.agent_id, target.step, target.level, now);
    return written
      ? { ok: true, detail: "Saved." }
      : { ok: false, detail: "DASH does not recognise that strength." };
  }

  if (action === "choose" && target.model_id === undefined) {
    clearAgentModelChoice(target.agent_id);
    return { ok: true, detail: "This agent is matching each step to what that step needs again." };
  }

  const manifest = readAgentManifest(target.agent_id) as ConnectionSourceManifest | null;
  if (manifest === null) {
    return { ok: false, detail: "DASH has no saved setup for that agent." };
  }
  const resolution = resolveCredentialTarget(
    target.agent_id,
    manifest,
    target.connection_id ?? "",
    target.field_id ?? "",
  );
  if (!resolution.ok || resolution.target.kind !== "provider_key") {
    return {
      ok: false,
      detail: "This agent does not have a model provider DASH can act on.",
    };
  }

  if (action === "list") {
    const listed = await listAiKeyModels(
      resolution.target,
      secureStore().describeBacking().label,
      aiKeyDeps(),
    );
    return {
      ok: listed.ok,
      detail: listed.detail,
      recovery: listed.recovery,
      models: listed.models,
    };
  }

  // `ai_provider_id` is non-null by construction for a `provider_key` target —
  // `resolveCredentialTarget` sets the kind and the id together or neither — and
  // `writeAgentModelChoice` resolves it against the registry anyway rather than
  // trusting that, which is what makes a dropped provider a refusal instead of a
  // row nothing can read back.
  const written = writeAgentModelChoice(
    target.agent_id,
    resolution.target.ai_provider_id ?? "",
    target.model_id ?? "",
    now,
  );
  return written
    ? { ok: true, detail: "Saved." }
    : { ok: false, detail: "DASH will not store that as a model name." };
}

/**
 * The model setting this agent would take to a server, or nothing (MAR-583).
 *
 * Undefined when the agent's plan declares no step that needs a model **and**
 * nobody has named one — which is the ordinary case and produces no file in the
 * bundle. An absence there says there was nothing to decide, which is a
 * different thing from a document recording that somebody chose the default; see
 * `ProduceFolderBundleOptions.models`.
 *
 * Reads the row's manifest rather than the folder's. The folder is authoritative
 * under ADR 0008 and the producer reads it for everything else — but this
 * function runs before the producer has opened anything, and what it needs is
 * only the planned route, which is the part of a manifest that cannot differ
 * between the two without the folder having been edited into a different agent.
 * `folder.check` is the surface for that disagreement.
 */
function bundledModelChoiceFor(agentId: string): BundledModelChoice | undefined {
  const manifest = readAgentManifest(agentId);
  if (manifest === null) {
    return undefined;
  }
  const declared = stepsNeedingAModel(manifest.planned_route);
  const choice = readAgentModelChoice(agentId);
  if (declared.length === 0 && choice.kind === "match_each_step") {
    return undefined;
  }
  return bundledModelChoice(
    agentId,
    choice,
    resolveModelSteps(declared, readStepLevelOverrides(agentId)),
  );
}

/**
 * The vault and the one provider request, for the model list.
 *
 * The same three dependencies `performConnectionAction` is given, minus the two
 * it does not need: there is no prompt because nothing here asks for a key, and
 * `promptForSecret` is stubbed to a refusal rather than wired, so a future edit
 * that made this path ask for a credential would produce a cancelled prompt
 * instead of a window nobody expected.
 */
function aiKeyDeps(): Parameters<typeof listAiKeyModels>[2] {
  return {
    store: secureStore(),
    promptForSecret: () => Promise.resolve(null),
    ai: { probe: (profile, key, wantIds) => probeModelProvider(profile, key, fetch, wantIds) },
    now: () => new Date(),
  };
}

function refreshSampleAgent(agentId: string): { ok: boolean; refusal?: string; detail?: string } {
  const folder = readAgentFolderManifest(dataDir, agentId);
  let stored: unknown = null;
  if (folder.ok) {
    try {
      stored = JSON.parse(folder.json) as unknown;
    } catch {
      stored = null;
    }
  }
  stored ??= readAgentManifest(agentId);

  if (stored === null) {
    return {
      ok: false,
      refusal: "unknown_agent",
      detail: "DASH has no saved setup for that agent.",
    };
  }
  if (!isScaffoldedByDash(stored)) {
    return {
      ok: false,
      refusal: "not_a_dash_agent",
      detail:
        "DASH did not create this agent, so it has no version of its own to replace it with. Add it again from its own folder to update it.",
    };
  }

  const rebuilt = refreshedManifest(stored, { kitVersion: app.getVersion(), now: new Date() });
  if (!rebuilt.ok) {
    return { ok: false, refusal: "unreadable_manifest", detail: rebuilt.problem };
  }

  // Straight through the ordinary import door. It writes the folder before the
  // row, preserves the avatar, revalidates against the schema and clears the
  // agent's startup folder issue — four properties this would otherwise have to
  // reimplement, and one of them (`ON CONFLICT DO UPDATE` omitting `avatar`) is
  // the reason the copy on the button can promise the character survives.
  const imported = importManifest(rebuilt.manifest);
  if (!imported.ok) {
    return {
      ok: false,
      refusal: "refused_at_import",
      detail: "DASH could not accept its own updated setup for this agent, so nothing was changed.",
    };
  }
  return { ok: true };
}

/**
 * Set — or clear — the name DASH shows for one agent (MAR-589).
 *
 * The only gate is `renameAgent`'s own: the agent has to exist, and a name
 * that survives trimming has to be non-empty and not absurdly long. Both are
 * checked beside the write in `lib/store.ts`, `refreshSampleAgent`'s reason
 * for its own gate living beside its write rather than at this seam.
 */
function performAgentRenameAction(
  _action: RenameAction,
  target: { agent_id: string; display_name?: string },
): { ok: boolean; refusal?: string } {
  const result = renameAgent(target.agent_id, target.display_name);
  if (!result.ok) {
    return { ok: false, refusal: result.errors.join(" ") };
  }
  return { ok: true };
}

/**
 * Open a task, admit one user-selected file, or hand the task over (MAR-507).
 *
 * The whole of the path handling lives here, and the reason is the same one
 * `promptForSecret` exists for: the renderer asks main to *ask*. It names an
 * agent and a role; main opens `dialog.showOpenDialog`, and the path the user
 * chose goes straight to the runner over its authenticated socket without ever
 * being returned to the page, written to a store, or put in an audit line.
 *
 * **The role is checked against the manifest here, not at the runner.** The
 * runner would take any role string and admit the file under it — it has no
 * manifest — so a renderer naming a role the agent never declared would get a
 * file admitted under a name the agent will never look for. `declaredLimitsFor`
 * answering null is that refusal, and it is also where the limits come from, so
 * a payload cannot widen what the author declared.
 */
async function workspaceAction(
  runner: RunnerHandle | null,
  action: WorkspaceAction,
  target: { agent_id: string; task_id?: string; role_id?: string; run_id?: string },
): Promise<WorkspaceActionResult> {
  if (runner === null) {
    return {
      ok: false,
      refusal: "no_runner",
      detail:
        "This computer cannot run agents, so there is nowhere to put a file for one.",
    };
  }
  const call = runnerFetch(runner);
  const base = `${runner.origin}/agents/${encodeURIComponent(target.agent_id)}/tasks`;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${runner.token}`,
  };

  try {
    if (action === "open_task") {
      const response = await call(base, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        task?: { task_id?: string };
        detail?: string;
      };
      const taskId = body.task?.task_id ?? "";
      return body.ok === true && taskId.length > 0
        ? { ok: true, data: { task_id: taskId } }
        : { ok: false, refusal: "task_not_opened", detail: body.detail };
    }

    if (target.task_id === undefined || target.task_id.length === 0) {
      return { ok: false, refusal: "no_task", detail: "No place to put the file was open." };
    }
    const taskBase = `${base}/${encodeURIComponent(target.task_id)}`;

    if (action === "select_input") {
      const manifest = readAgentManifest(target.agent_id);
      const limits =
        target.role_id === undefined ? null : declaredLimitsFor(manifest, target.role_id);
      if (limits === null) {
        // The agent never said it takes this. Refused before a picker opens, so
        // the user is not asked for a document that could not have been used.
        return {
          ok: false,
          refusal: "undeclared_role",
          detail: "This agent does not ask for that kind of file.",
        };
      }

      // Modal to the app window when there is one. A picker that is not owned
      // by the window it was opened from can end up behind it, which reads as
      // DASH having frozen.
      const window = appWindow();
      const options = {
        properties: ["openFile" as const],
        title: "Choose a file for this agent",
        buttonLabel: "Give to agent",
      };
      const chosen =
        window === null
          ? await dialog.showOpenDialog(options)
          : await dialog.showOpenDialog(window, options);
      const sourcePath = chosen.canceled ? undefined : chosen.filePaths[0];
      if (sourcePath === undefined) {
        // Cancelling is not a failure and must not read as one. The same call
        // `describeAuthorizationFailure` makes about a cancelled sign-in.
        return { ok: false, refusal: "cancelled" };
      }

      const response = await call(`${taskBase}/inputs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ role: target.role_id, source_path: sourcePath, limits }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        refusal?: string;
        detail?: string;
        input?: { display_name?: string; byte_size?: number };
      };
      if (body.ok !== true) {
        // The runner's own code and the runner's own sentence, passed through
        // untouched. `lib/copy/inputs.ts` says why DASH does not reword them.
        return { ok: false, refusal: body.refusal, detail: body.detail };
      }
      return {
        ok: true,
        data: {
          display_name: body.input?.display_name ?? "",
          byte_size: body.input?.byte_size ?? 0,
        },
      };
    }

    const runId = target.run_id;
    if (runId === undefined || runId.length === 0) {
      return { ok: false, refusal: "no_run", detail: "No run was named for these files." };
    }
    const response = await call(`${taskBase}/dispatch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ run_id: runId }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { ok?: boolean; refusal?: string; detail?: string };
    return body.ok === true
      ? { ok: true }
      : { ok: false, refusal: body.refusal, detail: body.detail };
  } catch {
    // The error is not quoted. A thrown fetch can carry the request URL, and
    // this module's requests carry a bearer token — `describeTransportError`
    // makes the same argument about the same class of leak.
    return {
      ok: false,
      refusal: "unreachable",
      detail: "DASH could not reach the part of itself that holds files for agents.",
    };
  }
}

/**
 * Register the read channel (MAR-432).
 *
 * A second `ipcMain.handle`, and the only other one there is. It answers with
 * the same `lib/views/build.ts` projections the developer path's GET routes
 * answer with, which is the mechanism behind "one renderer, two data sources":
 * neither source builds anything, so neither can drift from the other.
 *
 * No audit record, no principal, no adapter, no runner. A read reaches SQLite
 * and comes back. See `lib/shell/read.ts` for the argument that this is the
 * right shape rather than an omission.
 *
 * Registered unconditionally — unlike the command channel, this needs no runner
 * and no vault. A machine that could not start a runner still has agents,
 * events and connection requirements to show, and a DASH that could not render
 * its own store because it could not host a process would be a worse failure
 * than the one it was reporting.
 */
export function registerReadChannel(): void {
  ipcMain.handle(SHELL_READ_CHANNEL, (_event, request: unknown) => {
    const review = reviewRead(request);
    if (review.decision === "denied") {
      return { ok: false, reason: review.reason } satisfies ReadResponse<never>;
    }

    // Exhaustive over `READS`: adding a read without answering it here is a
    // compile error, the same way `executeCommand` treats a new command.
    switch (review.read) {
      case "view.agents":
        return { ok: true, data: agentsView() } satisfies ReadResponse<ReadResults["view.agents"]>;
      case "view.runs":
        return { ok: true, data: runsView() } satisfies ReadResponse<ReadResults["view.runs"]>;
      case "view.run":
        return {
          ok: true,
          data: runView(review.params["agent"] ?? "", review.params["run_id"] ?? ""),
        } satisfies ReadResponse<ReadResults["view.run"]>;
      case "view.connections":
        return {
          ok: true,
          data: connectionsView(),
        } satisfies ReadResponse<ReadResults["view.connections"]>;
      case "view.inbox":
        return {
          ok: true,
          data: workInboxView(),
        } satisfies ReadResponse<ReadResults["view.inbox"]>;
      case "view.workspace":
        return {
          ok: true,
          data: workspaceView(review.params["agent"] ?? ""),
        } satisfies ReadResponse<ReadResults["view.workspace"]>;
      case "view.hosts":
        return { ok: true, data: hostsView() } satisfies ReadResponse<ReadResults["view.hosts"]>;
      case "view.notifications":
        return {
          ok: true,
          data: notificationsView(),
        } satisfies ReadResponse<ReadResults["view.notifications"]>;
      default: {
        const unreachable: never = review.read;
        throw new Error(`Unhandled read: ${String(unreachable)}`);
      }
    }
  });
}

/**
 * Start or stop a hosted agent, or report what the runner holds.
 *
 * Goes to the runner's `/lifecycle` route, never through the command channel.
 * The separation is the whole reason `runner.*` exists as its own family: these
 * act on a process, and no manifest declares them.
 */
/**
 * The credentials this agent's manifest says DASH should deliver (MAR-383).
 *
 * Driven by the *manifest*, not by what happens to be in the vault: a value left
 * over from a manifest that has since stopped declaring the field is never sent
 * anywhere. `deliverableFields` is the filtered list — fields DASH may hold
 * *and* that name somewhere to be delivered — so a credential DASH holds for its
 * own use cannot leak into a child process by being iterated with the rest.
 *
 * A missing or unreadable credential is skipped rather than fatal. The agent
 * starts and fails at the thing that needed it, which is a failure the user can
 * see and act on in the workspace; refusing to start would turn one unconfigured
 * connection into an agent that will not run at all and does not say why.
 *
 * Nothing here is logged. Not the values, and not the names either — a log line
 * listing which connections resolved would be a map of this machine's
 * credentials sitting in a file.
 */
/**
 * Exported for `electron/smoke.ts` (MAR-458), and for one reason.
 *
 * Proof 7 asserts that no provider token reaches a spawned agent's environment.
 * That assertion is worth nothing if the harness assembles the environment
 * itself: it would be proving a copy of this function rather than this one. So
 * the proof calls the real thing, and what it hands the runner is exactly what
 * `runnerLifecycle` hands it.
 */
export async function collectSpawnCredentials(agentId: string): Promise<Record<string, string>> {
  const manifest = readAgentManifest(agentId) as ConnectionSourceManifest | null;
  if (manifest === null) {
    return {};
  }

  const store = secureStore();
  const credentials: Record<string, string> = {};

  // MAR-458 changed what this iterates. It used to be `deliverableFields`, which
  // includes OAuth targets, and the loop minted a provider access token for each
  // one and put it in the child's environment.
  //
  // That is the defect ADR 0002 was written about. The token was short-lived and
  // scoped, which sounds like a boundary and is not one: for `gmail.compose` it
  // could send mail, while the manifest declared only draft creation and the
  // Connection Center said so — "a contract claim, not a technical firewall", in
  // the ADR's words. Every guard around it was a promise about what the agent
  // would choose to do with a credential it held.
  //
  // `deliverableSecretFields` cannot return an OAuth target, so the only
  // credentials that reach a child are the ones a user typed for a service DASH
  // has no client for. Provider grants are reached through the broker instead:
  // named operations, checked per call, audited, and revocable while the agent is
  // running. See `lib/broker/` and `assertNoBrokeredCredentials` below.
  for (const field of deliverableSecretFields(agentId, manifest)) {
    try {
      credentials[field.environment_name] = await store.get(field.secret_name);
    } catch {
      // `not_found` on first run and `vault_locked` on a machine whose keychain
      // is shut. Both mean "DASH has nothing to hand over right now", and both
      // are already reported on the Connection Center, where the user asked.
    }
  }

  // Belt and braces on DASH's own code. `deliverableSecretFields` is the filter;
  // this is the assertion, in the shape `runner/supervisor.ts` uses for the
  // runner's own token — the difference between an invariant a reviewer has to
  // notice and one the process refuses to violate. A future change that widened
  // the filter would fail here rather than shipping a token into an agent.
  assertNoBrokeredCredentials(agentId, manifest, credentials);

  return credentials;
}

/**
 * Fail loudly rather than start an agent holding a provider credential
 * (MAR-458, ADR 0002 invariants 1 and 2).
 *
 * Checks the assembled map against the manifest's *own* declaration of where a
 * brokered credential would have been delivered. That is the check worth having:
 * it does not try to recognise a credential by looking at one — which is the
 * guessing `lib/connections.ts` refuses to do, and which no pattern could do
 * reliably anyway — it asks the manifest which environment names belong to
 * brokered fields and refuses if any of them has a value.
 *
 * MAR-582 widened it from `kind === "oauth"` to every kind that is not a plain
 * `secret`, which is the shape that survives a third custody model being added.
 * For a model provider key the check is currently unreachable by construction —
 * `resolveCredentialTarget` refuses a manifest that names a delivery variable
 * for one, so no such field ever reaches `deliverableFields` — and it is here
 * anyway, because "unreachable" is a property of a refusal somebody could
 * relax and this is the line that would notice.
 */
function assertNoBrokeredCredentials(
  agentId: string,
  manifest: ConnectionSourceManifest,
  credentials: Record<string, string>,
): void {
  for (const field of deliverableFields(agentId, manifest)) {
    if (field.kind !== "secret" && Object.hasOwn(credentials, field.environment_name)) {
      throw new Error(
        `Refusing to start "${agentId}" with a provider credential in its environment: ` +
          `"${field.environment_name}" is a brokered connection, and a brokered connection is ` +
          `reached through named operations rather than by holding a credential.`,
      );
    }
  }
}

/**
 * Save one of an agent's outputs where the user asks (MAR-434).
 *
 * The last missing piece of MAR-434's acceptance criterion: the runner has
 * served `GET /artifacts/{id}/download` since PR #48 and proof `9f` hashes what
 * it returns, and nothing on any page could call it.
 *
 * The order here is the whole design. **Ask first, fetch second.** A download
 * that streamed the bytes somewhere and then asked where to put them would have
 * had to choose a place on its own, and a downloads folder DASH picked is a
 * place the user has to go and find. Asking first also means a cancelled dialog
 * costs a socket read that never happened.
 *
 * What does not cross back to the renderer: the path the user chose, the bytes,
 * and the digest. The result is a sentence. `runner/workspace.ts` refuses to
 * return `stored_path` for exactly this reason, and it would be a strange
 * discipline to keep at the runner's boundary and drop at the window's.
 *
 * The suggested filename is the artifact's own `display_name`, which the runner
 * sends in `x-artifact-name` — the name the agent gave its file, which is the
 * name the person will be looking for.
 */
async function workspaceDownload(
  runner: RunnerHandle | null,
  artifactId: string,
): Promise<{ ok: boolean; detail: string }> {
  if (runner === null) {
    return {
      ok: false,
      detail: "No bundled runner is available on this machine, so DASH cannot fetch this file.",
    };
  }

  const window = appWindow();
  const call = runnerFetch(runner);

  // Ask the runner what it is called before asking the user where to put it, so
  // the dialog can suggest the agent's own name for the file. A HEAD would be
  // tidier; the route answers GET, and inventing a second one for a filename
  // would be inventing contract for cosmetics.
  let response: Response;
  try {
    response = await call(`${runner.origin}/artifacts/${encodeURIComponent(artifactId)}/download`, {
      headers: { authorization: `Bearer ${runner.token}` },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, detail: "DASH could not reach the runner that is holding this file." };
  }

  if (!response.ok) {
    // The runner distinguishes "no such artifact" from "the record is here and
    // the bytes are not", and both arrive as a refusal with a sentence. Passing
    // its own detail through keeps the four availability states meaningful all
    // the way to the button.
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    return {
      ok: false,
      detail:
        body.detail ??
        "The runner would not hand over this file. It may have been moved or deleted since it was made.",
    };
  }

  const suggested = response.headers.get("x-artifact-name") ?? "output";
  // Parented to the app window when there is one, so the dialog is modal to
  // DASH rather than a floating window the user can lose behind it.
  const options = { defaultPath: suggested, title: "Save a copy of this output" };
  const chosen =
    window === null
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(window, options);
  if (chosen.canceled || chosen.filePath === undefined || chosen.filePath === "") {
    // Not a failure. The user answered the question, and the answer was no.
    return { ok: true, detail: "" };
  }

  try {
    writeFileSync(chosen.filePath, Buffer.from(await response.arrayBuffer()));
  } catch (error: unknown) {
    return {
      ok: false,
      detail: `DASH could not write the file there: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  // The folder, not the full path — enough for a person to find it, and it is
  // the folder they just chose in a dialog rather than anything DASH decided.
  return { ok: true, detail: `Saved to ${path.dirname(chosen.filePath)}.` };
}

/* ---------------------------------------------------------------------- *
 * Saved servers (MAR-536)
 * ---------------------------------------------------------------------- */

/**
 * Make, check or forget one host from the audited command dispatcher.
 *
 * This is intentionally the only main-process path from a renderer action to
 * `electron/ssh-host.ts`. It mints identifiers, owns the key file, and returns
 * the create result field-by-field so a private key or filesystem path has no
 * route back through the IPC result.
 */
async function hostAction(
  action: HostAction,
  target:
    | { label: string; address: string; username: string; port: number }
    | { host_id: string }
    | { host_id: string; fingerprint: string }
    | { host_id: string; agent_id: string },
): Promise<HostActionResult> {
  if (action === "create") {
    if (!("label" in target)) {
      return { ok: false, detail: "DASH did not receive the server details it needs." };
    }

    /*
     * Adding a server DASH already has is *resuming*, not adding a second one
     * (MAR-572).
     *
     * The 2026-08-08 run walked this path four times against one box, because
     * the wizard returned to its first step on every failure. Each pass minted
     * a fresh key: the previous one stayed in DASH's store attached to nothing,
     * and its public half stayed in the server's allowed-keys file as a line
     * nobody could account for. Neither is a wizard bug that can be fixed only
     * in the wizard — anything that walks these steps twice would do it — so
     * the idempotence lives here, at the point where a key would be minted.
     *
     * The label is taken from the newer attempt. It is what the person calls
     * the server and they may well have improved it; nothing points at it.
     */
    const existing = findHostByConnection({
      address: target.address.trim(),
      port: target.port,
      username: target.username.trim(),
    });
    if (existing !== null) {
      let publicKey: string;
      try {
        publicKey = readHostPublicKey(dataDir, existing.key_name);
      } catch {
        // The record outlived its key, which is recoverable only by starting
        // this server over — and saying so beats silently minting a key the
        // server's allowed-keys file has never been told about.
        return {
          ok: false,
          detail:
            "DASH has this server saved but no longer holds the key for it. " +
            "Stop using it and add it again to make a new one.",
        };
      }
      return {
        ok: true,
        action: "create",
        host_id: existing.host_id,
        label: existing.label,
        public_key: publicKey,
        key_name: existing.key_name,
        authorized_keys_line: authorizedKeysLine(publicKey),
        resumed: true,
      };
    }

    // The renderer does not choose either name. An address is not an identity,
    // and a caller-selected key name would reintroduce a path-shaped input at
    // the point it is about to become a filename.
    const hostId = randomUUID();
    const record: HostRecord = {
      host_id: hostId,
      label: target.label.trim(),
      address: target.address.trim(),
      username: target.username.trim(),
      port: target.port,
      key_name: `host-${hostId}`,
      host_fingerprint: null,
      added_at: new Date().toISOString(),
    };
    const checked = checkHostRecord(record);
    if (!checked.ok) {
      return { ok: false, detail: checked.detail };
    }

    /*
     * MAR-574. Refuse the second record for one server, before a key is minted.
     *
     * Before this, the wizard's only affordance was "add another" and nothing
     * anywhere said no: Henrik's real store holds four rows for one Hostinger
     * box, one per attempt, each with its own minted key. The refusal is here
     * rather than only in `saveHost` because the order matters — a check after
     * `createHostKey` would leave a key on this computer for a record that was
     * never saved, which is the orphan the failure path below exists to avoid.
     *
     * It names the record that already exists. "Already added" without saying
     * which one sends somebody hunting through a list for a server they cannot
     * tell apart from the one they just typed.
     */
    const duplicate = findDuplicateHost(listHosts(), record);
    if (duplicate !== null) {
      const refusal = describeDuplicateHost(duplicate.label);
      return { ok: false, detail: `${refusal.headline}. ${refusal.detail} ${refusal.next_action}.` };
    }

    const tools = probeSshTools();
    if (!tools.present) {
      return {
        ok: false,
        detail: tools.detail ?? "This computer cannot create a server key.",
        problem: "no_ssh_on_this_computer",
      };
    }

    let publicKey: string;
    try {
      // `createHostKey` returns the public half and has no private-key reader.
      publicKey = createHostKey(dataDir, record.key_name);
    } catch {
      // Error objects from filesystem ACLs can name a local path. The renderer
      // needs the fact that creation failed, not a diagnostic that could name
      // the location of the credential.
      return { ok: false, detail: "DASH could not make a protected key for this server." };
    }

    try {
      saveHost(record);
    } catch {
      // Do not leave a usable key behind when its record was not saved. The
      // cleanup itself reads neither key half and reports no path.
      try {
        forgetHostKey(dataDir, record.key_name);
      } catch {
        // The store failure is the result that matters to this action; a later
        // startup cannot use this orphan because it has no host record.
      }
      return { ok: false, detail: "DASH could not save this server." };
    }

    return {
      ok: true,
      action: "create",
      host_id: record.host_id,
      label: record.label,
      public_key: publicKey,
      key_name: record.key_name,
      authorized_keys_line: authorizedKeysLine(publicKey),
      resumed: false,
    };
  }

  if (!("host_id" in target)) {
    return { ok: false, detail: "DASH did not receive the server it should use." };
  }
  const record = readHost(target.host_id);
  if (record === null) {
    return { ok: false, detail: "DASH no longer has this server." };
  }

  if (action === "forget") {
    try {
      // Remove the credential first. If this fails, keep the record so DASH
      // does not report a server forgotten while it can still sign in to it.
      forgetHostKey(dataDir, record.key_name);
      // And the pin, which is the only place it is ever removed. A server added
      // again later must be confirmed again: the previous decision was about a
      // machine that may not be this one any more (MAR-572).
      forgetHostKeyPin(dataDir, record);
      // MAR-584, ADR 0010. The ADR requires this and it is not tidiness: once
      // the label is gone, a surviving row could only render as a claim about a
      // machine DASH can no longer reach or even name.
      forgetHostDeploys(record.host_id);
      forgetHost(record.host_id);
    } catch {
      return { ok: false, detail: "DASH could not forget this server safely." };
    }
    return { ok: true, action: "forget", host_id: record.host_id, label: record.label };
  }

  if (action === "setup") {
    return hostSetupScript(record);
  }

  if (action === "trust") {
    if (!("fingerprint" in target)) {
      return { ok: false, detail: "DASH did not receive the identity code you confirmed." };
    }
    return trustHostKey(record, target.fingerprint);
  }

  /*
   * The enrollment gate, and it is before `ssh` rather than after it (MAR-572).
   *
   * A host whose identity nobody has confirmed cannot pass `sshArgv`'s
   * `StrictHostKeyChecking=yes`, so dialling first would spend a connection to
   * learn what this record already says. Worse, it would report the failure as
   * a refusal — which is what happened on 2026-08-08, when four probe attempts
   * against a real box produced "could not sign in, or the helper is not
   * installed" while the box's own log showed DASH aborting before it offered
   * anything at all.
   *
   * Deploy passes through here too. Putting an agent on a server DASH has not
   * been told to trust is the same question asked with more at stake.
   */
  if (record.host_fingerprint === null) {
    const scan = scanHostKey(record);
    if (!scan.ok) {
      // MAR-600. One mapping, beside the union it reads, rather than a ternary
      // chain here and a second one below that disagreed with it.
      return { ok: false, ...hostScanRefusal(scan.problem) };
    }
    return {
      ok: false,
      // Not an error, and the copy that renders this state says so. It is
      // reported on the failure path because DASH did not do the thing it was
      // asked to do, and reporting it as a success would be a probe that says
      // it reached a server it has never signed in to.
      detail: "This server's identity has not been confirmed yet.",
      problem: "host_key_not_trusted",
      host_key: {
        fingerprint: scan.offer.chosen.fingerprint,
        key_type: scan.offer.chosen.type,
        offered_count: scan.offer.offered.length,
      },
    };
  }

  /*
   * MAR-602, ADR 0014. Start the copy that is on this server.
   *
   * Below the enrollment gate and above everything else, deliberately. Asking a
   * server DASH has not been told to trust to *run* something is the same
   * question deploy asks with the same stakes, and the gate above is the one
   * place it is answered — a branch that sat higher would be a second path to a
   * host with no pin, which is what MAR-572 exists to make impossible.
   *
   * Every gate beyond that is inside `electron/host-run.ts`, beside the calls it
   * guards, for `performFolderAction`'s reason. Main holds the seam: the record,
   * the data directory, and the OS user whose name becomes the actor DASH
   * asserts — which the runner records as DASH's *claim* and cannot verify, one
   * machine over, exactly as ADR 0014 says out loud rather than inheriting.
   */
  if (action === "run") {
    if (!("agent_id" in target)) {
      return { ok: false, detail: "DASH did not receive the agent it should start." };
    }
    const toolsForRun = probeSshTools();
    if (!toolsForRun.present) {
      return {
        ok: false,
        detail: toolsForRun.detail ?? "This computer cannot reach a server.",
        problem: "no_ssh_on_this_computer",
      };
    }
    return await runAgentOnHost(record, target.agent_id, dataDir, userInfo().username);
  }

  /*
   * MAR-611, ADR 0017. Bring the copy that is on this server home.
   *
   * Beside `run` and below the same enrollment gate, for the same reason and one
   * sharper: this is the only host command that destroys anything, and a path to
   * it that skipped the pin would be a path to *removing* an agent from a machine
   * DASH has never been told to trust.
   *
   * `readAgentManifest` is the one thing main answers rather than delegating,
   * because "does DASH still hold this agent" is a question about this store and
   * the refusal it produces is the boundary of the feature: a host can name a
   * bundle DASH never sent (ADR 0015), and adopting a stranger's agent off a
   * server is a different act than taking back one DASH put there.
   */
  if (action === "bringHome") {
    if (!("agent_id" in target)) {
      return { ok: false, detail: "DASH did not receive the agent it should bring home." };
    }
    const toolsForBringHome = probeSshTools();
    if (!toolsForBringHome.present) {
      return {
        ok: false,
        detail: toolsForBringHome.detail ?? "This computer cannot reach a server.",
        problem: "no_ssh_on_this_computer",
      };
    }
    return await bringAgentHomeFromHost(
      record,
      target.agent_id,
      dataDir,
      readAgentManifest(target.agent_id) !== null,
    );
  }

  let produced: ReturnType<typeof produceAgentFolderBundle> | null = null;
  if (action === "deploy") {
    if (!("agent_id" in target)) {
      return { ok: false, detail: "DASH did not receive the agent it should deploy." };
    }
    produced = produceAgentFolderBundle({
      data_dir: dataDir,
      agent_id: target.agent_id,
      bundle_id: target.agent_id,
      // `build-shell.mjs` stages MAR-497's artifact beside `main.mjs`, and
      // @electron/packager copies that whole directory unchanged. The same
      // relative location therefore works in `electron .` and an MSIX.
      runner_artifact_dir: path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "runner-standalone",
      ),
      // MAR-583. The setting travels with the folder. Resolved here rather than
      // inside the producer, so that module stays a reader of one folder with no
      // store behind it — and resolved through the same two functions the page
      // reads, so what goes on the server is what the person is looking at.
      models: bundledModelChoiceFor(target.agent_id),
    });
  }
  if (produced !== null && !produced.ok) {
    return { ok: false, detail: produced.detail };
  }

  const tools = probeSshTools();
  if (!tools.present) {
    return {
      ok: false,
      detail: tools.detail ?? "This computer cannot check a server.",
      problem: "no_ssh_on_this_computer",
    };
  }

  // Collected by `openSshChannel` and read only by `classifyHostFailure`, whose
  // return type is a closed union — so `ssh`'s own text, which names this
  // machine's key location, has no route from here to anything rendered.
  const diagnostics: SshDiagnostics = { stderr: "" };

  let answer: Awaited<ReturnType<typeof runDeployVerb>>;
  try {
    if (produced !== null && produced.ok) {
      const spawn = sshDeploySpawn(record, dataDir, diagnostics);
      const installed = await runDeployVerb(spawn, produced.request);
      if (!installed.ok) {
        return { ok: false, detail: installed.detail, problem: diagnosed(diagnostics, record) };
      }
      const started = await runDeployVerb(spawn, {
        verb: "start",
        bundle_id: produced.request.bundle_id,
      });
      if (!started.ok) {
        return { ok: false, detail: started.detail, problem: diagnosed(diagnostics, record) };
      }
      /*
       * MAR-584, ADR 0010. After the start succeeded and nowhere else.
       *
       * A deploy is three steps behind one answer and DASH cannot tell which of
       * them a failure stopped at, so a row written on an attempt would claim
       * DASH sent something it may not have. Written here, the row records the
       * one thing DASH does know: the server took the bundle and started it,
       * and these were the bytes in it.
       *
       * Nothing about the server's state is stored — see the migration's own
       * note and the ADR. `sent_at` comes from DASH's clock inside
       * `recordAgentDeploy`, which is what keeps every sentence derived from
       * this row in the past tense.
       */
      recordAgentDeploy({
        agent: produced.request.agent_id,
        host_id: record.host_id,
        // The paths DASH recorded as this agent's program, so the digest is over
        // the same set the accepted baseline covers and the two can be compared
        // later. Empty for an agent with no baseline, which yields a null
        // program digest and a surface that says it cannot tell.
        ...describeBundleContents(
          produced.request,
          (readRegistration(dataDir, produced.request.agent_id)?.dash.accepted_files ?? []).map(
            (file) => file.path,
          ),
        ),
      });
      return {
        ok: true,
        action: "deploy",
        host_id: record.host_id,
        label: record.label,
        agent_id: produced.request.agent_id,
        bundle_id: produced.request.bundle_id,
        runner_build: produced.runner_build,
        detail: `The agent is running on ${record.label}.`,
      };
    }

    const identity = assertHostKeyProtected(dataDir, record.key_name);
    // `status` is the host helper's read-only operation: it proves the SSH
    // channel reaches the server without selecting a bundle or deploying one.
    // The only variable between this and the fixture proof is which process
    // answers on the other end of the ssh pipes.
    answer = await runDeployVerb(
      (verb, bundleId) =>
        openSshChannel(
          record,
          verb,
          { identity_file: identity, known_hosts_file: knownHostsPath(dataDir) },
          bundleId,
          diagnostics,
        ),
      { verb: "status" },
    );
  } catch {
    // Do not surface SSH or ACL diagnostics: either can name this machine's key
    // location. `runDeployVerb` already returns a safe sentence for answers it
    // could classify, so this is only the pre-channel safeguard above.
    return { ok: false, detail: "DASH could not prepare the key for this server." };
  }

  if (!answer.ok) {
    /*
     * The transport's own generic sentence, plus a *class* when one can be
     * recognised (MAR-572, MAR-573).
     *
     * `ssh`'s stderr still never travels — `classifyHostFailure` can only
     * return one of nine named problems, and the renderer turns that into copy
     * of DASH's own. What this replaces is the old behaviour of returning no
     * class at all, which made every one of those nine wear the same sentence:
     * "DASH could not sign in, or the helper is not installed there." The
     * 2026-08-08 run produced three of them in a row and read that sentence
     * every time, while the server's log said precisely which had happened.
     *
     * An unrecognised failure still returns no class, and still gets the
     * generic sentence. Guessing would be worse than the shrug it replaced.
     */
    return { ok: false, detail: answer.detail, problem: diagnosed(diagnostics, record) };
  }
  if (answer.verb !== "status") {
    return { ok: false, detail: "The server did not answer the check DASH sent." };
  }

  const running = answer.bundles.filter((bundle) => bundle.running);
  const first = running[0];
  if (first === undefined) {
    return {
      ok: false,
      detail: "DASH reached this server, and it has no agent runner running there yet.",
      problem: "no_runner_there",
    };
  }

  return {
    ok: true,
    action: "probe",
    host_id: record.host_id,
    label: record.label,
    runner_build: first.runner_build,
    // MAR-574. Counted from the host's own answer and not from anything DASH
    // stored, because DASH stores nothing about what it deployed where. The
    // Servers page words it as a report for that reason.
    agents_running: running.length,
    /*
     * MAR-606, ADR 0015. The same answer, no longer reduced to its length.
     *
     * `answer.bundles` has always carried a name per bundle and this function
     * has always thrown them away — MAR-489's attended run is what that cost:
     * a person put one agent on a server by two different routes, and no
     * surface in DASH could tell him whether he had one copy there or two.
     * There is no extra round trip here and no new question asked of the
     * server; this is the reply it already gave, passed on instead of counted.
     *
     * Every bundle, not only the running ones, because "installed and stopped"
     * is a state a person needs to see and `agents_running` above cannot
     * express — it is the difference between an agent that was never sent and
     * one that died, and reducing both to an absence is how the second goes
     * unnoticed.
     *
     * The pid is deliberately left behind. It is a number that helps nobody
     * this product is for, and a field that exists is a field that ends up in
     * a sentence.
     */
    agents_there: answer.bundles.map((bundle) => ({
      agent_id: bundle.agent_id,
      running: bundle.running,
    })),
  };
}

/**
 * `ssh`'s diagnostics as one of nine problems, or as nothing.
 *
 * A named function rather than an inline call so that every `return` on the
 * failure path reads the same way, and so there is exactly one place in main
 * where these bytes are touched at all. Whether the host is pinned is the
 * tiebreaker `classifyHostFailure` needs to tell an unconfirmed identity from a
 * changed one.
 */
function diagnosed(diagnostics: SshDiagnostics, record: HostRecord): HostReachProblem | undefined {
  return (
    classifyHostFailure({
      stderr: diagnostics.stderr,
      pinned: record.host_fingerprint !== null,
    }) ?? undefined
  );
}

/**
 * Record that a person confirmed this server's identity (MAR-572).
 *
 * The host is asked *again* rather than trusting the fingerprint that came back
 * from the renderer, and the two must agree. That closes a real gap: between
 * DASH showing a fingerprint and somebody deciding to accept it, whatever is
 * answering at that address could have changed. The window is small and it is
 * precisely the window this step exists to be careful about, so the check costs
 * one scan and is worth it.
 *
 * The file and the record are written in that order and both refuse a second
 * pin. If the record is already pinned, this returns the identity-changed alarm
 * rather than a success — because the only way to reach this function with a
 * pinned record is a server whose key is not the one that was pinned.
 */
function trustHostKey(record: HostRecord, confirmed: string): HostActionResult {
  if (record.host_fingerprint !== null) {
    return record.host_fingerprint === confirmed
      ? // Confirming what is already confirmed. A no-op success rather than an
        // error, because a flow that can be resumed will re-enter its own steps
        // and a resumable flow that fails on the second pass is not one.
        {
          ok: true,
          action: "trust",
          host_id: record.host_id,
          label: record.label,
          fingerprint: record.host_fingerprint,
        }
      : {
          // Somebody is being asked to confirm an identity that is not the one
          // DASH pinned. There is no branch below this that could change the
          // pin, and this refusal is where that fact is stated.
          ok: false,
          detail: "DASH already recorded a different identity for this server.",
          problem: "server_identity_changed",
        };
  }

  const scan = scanHostKey(record);
  if (!scan.ok) {
    return {
      ok: false,
      detail: "DASH could not ask this server for its identity again.",
      problem: hostScanRefusal(scan.problem).problem,
    };
  }
  if (scan.offer.chosen.fingerprint !== confirmed) {
    // Never pinned. What is answering now is not what was on screen, and the
    // honest response to that is the alarm, not a retry.
    return {
      ok: false,
      detail: "This server answered with a different identity than the one you were shown.",
      problem: "server_identity_changed",
    };
  }

  const pinned = pinHostKey(dataDir, record, scan.offer.chosen);
  if (!pinned.ok) {
    return {
      ok: false,
      detail: "DASH already has a different identity recorded for this address.",
      problem: "server_identity_changed",
    };
  }
  if (!pinHostFingerprint(record.host_id, pinned.fingerprint)) {
    // The row moved under us — two windows, or a record forgotten mid-flow. The
    // file now holds a line for a host DASH may no longer have, which
    // `host.forget` removes; nothing here overwrites anything.
    return { ok: false, detail: "DASH could not record this server's identity." };
  }
  return {
    ok: true,
    action: "trust",
    host_id: record.host_id,
    label: record.label,
    fingerprint: pinned.fingerprint,
  };
}

/**
 * The one-off setup step for a server, as text (MAR-573).
 *
 * Everything variable in it comes from two places: DASH's own public key for
 * this host, and the helper artifact staged beside the bundled main process.
 * `lib/host-bootstrap.ts` refuses anything it does not recognise rather than
 * quoting it, so the script this returns either passed that allowlist or does
 * not exist.
 *
 * The helper is read from the same directory `host.deploy` pushes from, which
 * is what makes "the host is running the build this DASH shipped" true of the
 * bootstrap as well as of the deploy.
 */
function hostSetupScript(record: HostRecord): HostActionResult {
  let publicKey: string;
  try {
    publicKey = readHostPublicKey(dataDir, record.key_name);
  } catch {
    return {
      ok: false,
      detail: "DASH no longer holds the key for this server, so it cannot write a setup step for it.",
    };
  }

  let helper: Buffer;
  try {
    helper = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "runner-standalone", "host-helper.mjs"),
    );
  } catch {
    // A build that shipped without the artifact. Named as DASH's own fault,
    // because it is: nothing the person did or could do produced it.
    return { ok: false, detail: "This copy of DASH is missing the helper it puts on a server." };
  }

  const built = buildBootstrapScript({
    public_key: publicKey,
    username: record.username,
    helper_base64: helper.toString("base64"),
    helper_sha256: createHash("sha256").update(helper).digest("hex"),
  });
  if (!built.ok) {
    return { ok: false, detail: built.detail };
  }
  return {
    ok: true,
    action: "setup",
    host_id: record.host_id,
    label: record.label,
    script: built.script,
  };
}

async function runnerLifecycle(
  runner: RunnerHandle | null,
  action: string,
  agentId: string | undefined,
): Promise<RunnerLifecycleResult> {
  if (action === "remove" || action === "removeKeepFiles") {
    // Handled here rather than at the runner, because removing an agent is a
    // sequence — stop the process, delete DASH's registration and manifest
    // copy, forget the store row, have the runner take a fresh reading — and
    // only the shell can perform it in that order. See `lib/handoff-flow.ts`
    // for why the order is the safety property.
    if (agentId === undefined) {
      return { ok: false, detail: "No agent was named." };
    }
    if (handoffContext === null) {
      return { ok: false, detail: "DASH is still starting up." };
    }
    // Deliberately reachable with no runner. A machine that could not start one
    // can still have a registration on disk from a previous launch, and
    // "DASH cannot remove this because it cannot run it" would be a trap.
    //
    // MAR-595 finding 18. Two commands, one sequence: "remove" also deletes
    // DASH's own copy of the agent's files, "removeKeepFiles" stops here and
    // leaves them where `writeAgentFolder` put them. See `removeAgent`'s own
    // header in `lib/handoff-flow.ts` for what each one actually touches.
    return removeAgentWithReport(agentId, handoffContext, {
      deleteFiles: action === "remove",
    });
  }

  if (runner === null) {
    return {
      ok: false,
      detail:
        "No bundled runner is available on this machine, so DASH cannot start or stop agents here.",
    };
  }

  // The runner's socket or pipe, not the network. Global `fetch` resolves a
  // host and opens a TCP connection; there is no host and no port to open.
  const call = runnerFetch(runner);

  if (action === "status") {
    try {
      const response = await call(`${runner.origin}/agents`, {
        headers: { authorization: `Bearer ${runner.token}` },
        signal: AbortSignal.timeout(3_000),
      });
      /*
       * MAR-518. This used to read `response.json()` unconditionally, which
       * does not throw on a non-2xx status — `fetch` only throws on a
       * transport failure. So a damaged store's typed 503 parsed as `{agents:
       * undefined}`, `(body.agents ?? []).length` was `0`, and `runner.status`
       * reported `{ok: true, supervising: 0}`: a healthy, idle runner, not a
       * damaged one. Nobody asked this route yet, which is why nothing had
       * noticed.
       */
      if (!response.ok) {
        const damage = await readStoreDamage(response);
        if (damage !== null) {
          return {
            ok: false,
            detail: "The runner cannot read its own records.",
            data: { store_damaged: true, damage_kind: damage },
          };
        }
        return { ok: false, detail: `The runner answered with status ${String(response.status)}.` };
      }
      const body = (await response.json()) as { agents?: unknown[] };
      return {
        ok: true,
        data: { available: true, supervising: (body.agents ?? []).length },
      };
    } catch {
      return { ok: false, detail: "The runner did not answer." };
    }
  }

  if (action === "retireStore") {
    /*
     * MAR-518. Names no agent — see the `runner.retireStore` entry in
     * `lib/shell/ipc.ts` for why this reaches `POST /store/retire` directly
     * rather than an agent's `/lifecycle` route.
     *
     * The runner's own success body (`{ok: true, moved_to, moved}`) carries
     * no sentence a person reads — `runner/server.ts` only writes one on
     * failure — so it is composed here, once, rather than asking every future
     * caller of this branch to remember to.
     */
    try {
      const response = await call(`${runner.origin}/store/retire`, {
        method: "POST",
        headers: { authorization: `Bearer ${runner.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json()) as
        | { ok: true; moved_to?: unknown; moved?: unknown }
        | { ok: false; detail?: unknown };
      if (body.ok === true) {
        const movedTo = typeof body.moved_to === "string" ? body.moved_to : "a renamed file";
        const moved = typeof body.moved === "number" ? body.moved : 0;
        return {
          ok: true,
          detail: `The damaged records were set aside as ${movedTo} (${String(moved)} file${moved === 1 ? "" : "s"}). A fresh store is open.`,
          data: { moved_to: movedTo, moved },
        };
      }
      return {
        ok: false,
        detail:
          typeof body.detail === "string"
            ? body.detail
            : "The runner could not set its store aside.",
      };
    } catch {
      return { ok: false, detail: "The runner could not be reached." };
    }
  }

  if (agentId === undefined) {
    return { ok: false, detail: "No agent was named." };
  }

  try {
    const response = await call(`${runner.origin}/agents/${encodeURIComponent(agentId)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${runner.token}` },
      body: JSON.stringify({
        action,
        // MAR-383. Read from the OS vault at the moment of starting and sent
        // down the runner's authenticated socket or pipe — never written into
        // the registration file, which is plaintext on disk and survives the
        // process. The runner holds these for the length of one spawn.
        credentials: action === "start" ? await collectSpawnCredentials(agentId) : undefined,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as { ok?: boolean; detail?: string };
    return { ok: body.ok === true, detail: body.detail };
  } catch {
    return { ok: false, detail: "The runner could not be reached." };
  }
}

/**
 * Guarded so importing this module in a test or a tool does not try to start an
 * app. `app` is undefined outside a real Electron process.
 */
/**
 * Report which vault DASH is actually using, once, at startup.
 *
 * `describeBacking()` returns only a backend name, a label and a reason — all
 * of which the seam guarantees are safe to log. Reporting it here means an
 * unusable vault is visible in the logs from the first launch rather than being
 * discovered at the moment a user tries to connect something, and it makes the
 * `basic_text` refusal legible on the Linux machines where it fires.
 */
function reportSecureStoreBacking(): void {
  const backing = secureStore().describeBacking();
  console.warn(
    `[dash-shell] secure store: ${backing.label} os_backed=${backing.os_backed}` +
      (backing.unavailable_reason ? ` reason=${backing.unavailable_reason}` : ""),
  );
}

/**
 * Report where the store actually is, once, at startup.
 *
 * The companion to `assertStoreLocation`: the assertion proves the location is
 * right, and this makes it visible. "Which database did that audit row land in"
 * is otherwise a question you can only answer by guessing at the platform's
 * conventions for `userData`.
 *
 * MAR-595 finding 11. `app_name` is printed beside the path because the path
 * alone does not explain itself: `userData` is derived from `app.getName()`,
 * which `electron .` reads from `package.json` and `electron
 * dist/electron/main.mjs` never sees — same binary, same build, two different
 * DASHes, and until now the only trace of which one this launch is was the
 * path itself, unexplained. Seeing `app_name=Electron` beside the path is what
 * makes "this is the wrong DASH" legible without already knowing the trap.
 */
function reportStoreLocation(): void {
  console.warn(`[dash-shell] store: ${dataDir} (app_name=${app.getName()})`);
}

if (typeof app !== "undefined") {
  // ORDER-SENSITIVE, like the two imports at the top of this file and for a
  // comparable reason. `registerSchemesAsPrivileged` is only honoured before
  // `app.ready`; called later it succeeds silently and the packaged renderer
  // loads as an opaque origin, failing at its first module script with a message
  // about the origin rather than about the registration. See
  // `electron/renderer-host.ts`.
  registerRendererScheme();

  /**
   * Exactly one DASH per user session (MAR-428).
   *
   * Required by the deep link and not merely tidy. Windows launches a *second*
   * copy of the executable with the URL in its argv; without the lock, that copy
   * would open its own window, adopt the same runner, and start a second poller
   * against one store. With it, the second copy exits immediately and the first
   * one is handed the argv through `second-instance`.
   *
   * The lock is taken before `whenReady` on purpose: the losing copy should not
   * get as far as creating a window to then destroy.
   */
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    registerProtocolClient();

    // A cold start *is* the link: Windows launched this process because of it,
    // so it is in our own argv and there is no `second-instance` event coming.
    const launchLink = findDeepLink(process.argv);
    if (launchLink !== null) {
      enqueueDeepLink(launchLink);
    }

    app.on("second-instance", (_event, argv) => {
      surfaceWindow();
      const url = findDeepLink(argv);
      if (url !== null) {
        enqueueDeepLink(url);
      }
    });

    // macOS does not use argv for this at all.
    app.on("open-url", (event, url) => {
      event.preventDefault();
      enqueueDeepLink(url);
    });
  }

  void app.whenReady().then(async () => {
    /*
     * MAR-436. The first thing that happens, before any check that can throw.
     *
     * `splashStep` is what makes the splash honest rather than decorative: each
     * assertion below announces itself *before* running, so if it throws, the
     * step showing on screen is the step that failed and the `catch` at the end
     * of this chain has a name to describe. A spinner started here and never
     * updated would tell a user with a broken install exactly as much as the
     * blank window it replaced.
     */
    splash = openSplash(resolveTheme(nativeTheme.shouldUseDarkColors, null));

    // `electron/data-dir.ts` already pointed the store at `userData`, as the
    // first import in this file. This is the proof it worked — see that module
    // for why the old `useUserDataDirectory()` call here could never have.
    splashStep = "store";
    splash.step("store");
    assertStoreLocation(dataDir);
    reportStoreLocation();

    splashStep = "vault";
    splash.step("vault");
    reportSecureStoreBacking();

    // MAR-429. The read-only half of the same question: the store must land in
    // the user's data directory, and the schemas must come from this install
    // rather than from a development tree that happens to be on the build
    // machine. Both fail loudly here or not at all.
    splashStep = "rules";
    splash.step("rules");
    assertContractsLocation();

    splashStep = "screens";
    splash.step("screens");
    assertRendererPresent();
    // MAR-432. After `whenReady`, unlike `registerRendererScheme` above.
    // Registered whether or not this launch will load it, so that
    // `DASH_SHELL_URL=dash-app://ui/` exercises the packaged renderer's real
    // path on a development machine — the only way to reach it without
    // packaging, which needs a certificate and is not this session's to do.
    serveRenderer();
    // MAR-423. The same shape of check for the sample agent's two template
    // files: a packaging mistake should be a crash here, not a menu item that
    // only fails in the shipped build.
    assertSampleTemplatesPresent();

    // MAR-415. The runner is started before the window so the first render
    // already has somewhere to poll. A machine that cannot host one still gets
    // a working DASH; it just does not host agents, and says so once rather
    // than failing per click.
    //
    // MAR-430 narrowed what "cannot host one" means. It used to include every
    // machine without an OS keyring. Now it means DASH could not put a proven
    // owner-only ACL on one file — which is a real refusal, and a much rarer
    // one.
    // Named on the splash but deliberately *not* a failure that stops startup:
    // `ensureRunner` returns a refusal rather than throwing, DASH works without
    // a runner, and `lib/shell/splash.ts` has no hard-failure entry for it.
    splashStep = "runner";
    splash.step("runner");
    const started = await ensureRunner(dataDir);
    const runner = started.ok ? started.handle : null;
    if (started.ok) {
      console.warn(
        `[dash-shell] runner: ${started.handle.transport} ${started.handle.endpoint} ` +
          `pid=${String(started.handle.pid)}${started.handle.adopted ? " (adopted)" : ""}`,
      );
    } else {
      console.warn(`[dash-shell] no runner (${started.reason}): ${started.detail}`);
    }

    const channels = runner === null ? null : createAgentChannels(runner, secureStore());
    if (channels !== null) {
      stopPolling = startPolling(channels);
    }

    /*
     * MAR-588. Hand the runner the notification channel, if there is one.
     *
     * Here rather than lazily on the first agent event, and not awaited. The
     * runner is what posts, it holds the address in memory only, and it has just
     * either been spawned with nothing or adopted from a previous launch that
     * may have been told a different address — so this is the moment the two
     * processes agree, and it must happen before any agent has a chance to need
     * an approval.
     *
     * Not awaited because nothing later in startup depends on it and a slow
     * local socket must not hold up the window. `pushNotifyConfiguration` never
     * throws and reports its own failures.
     */
    void pushNotifyConfiguration(runner);

    // MAR-467. Before the broker starts, and before the heartbeat moves: the
    // window being recorded is the one that ended when this launch began, and
    // moving the heartbeat first would erase its start. See ADR 0005 — this is
    // the one of the three untraced cases nobody observed, so what gets written
    // is DASH's own absence and never an agent's request.
    const closed = recordClosedWindow({
      last_alive_at: readDashLastAlive(),
      now: new Date().toISOString(),
      runner_adopted: runner?.adopted ?? false,
      runner_started_at: runner?.started_at ?? null,
    });
    if (closed !== null) {
      console.warn(
        `[dash-shell] DASH was closed from ${closed.from_at} to ${closed.until_at} ` +
          `while the runner kept running; brokered requests in that window went unanswered`,
      );
    }
    stopHeartbeat = startHeartbeat();

    // MAR-458. Its own loop rather than a step inside the poll above: an agent
    // is *blocked* on a brokered answer, and five seconds is right for "is this
    // agent still alive" and absurd for a request somebody is waiting on. See
    // `electron/broker-host.ts`.
    stopBroker = startBroker(runner);

    registerCommandChannel(channels, runner);
    registerReadChannel();
    // MAR-383. The third and last `ipcMain.handle` group. Registered here beside
    // the other two so every channel DASH answers is visible in one place.
    registerCredentialChannels();
    installApplicationMenu();
    splashStep = "window";
    splash.step("window");
    const window = createWindow();

    /*
     * The handover, and the ordering is load-bearing in both directions.
     *
     * Closed on `ready-to-show` — the same event `createWindow` reveals the app
     * on — so the two happen in one frame and there is never a moment with
     * neither window painted. That is the whole point of the splash and it
     * would be undone by closing it any earlier.
     *
     * And never *before* the app window exists, because `window-all-closed`
     * quits the app: closing the splash while it was the only window would shut
     * DASH down during its own startup.
     */
    window.once("ready-to-show", () => {
      splash?.close();
      splash = null;
    });

    // MAR-421. After the window exists, so the popup's own approve/reject
    // calls have somewhere to be answered from — `registerCommandChannel`
    // just above is unaffected either way, since it answers any window's
    // request on the one shared channel, but there is no reason to watch for
    // approvals before there is anything to show one in.
    stopApprovalNotifier = startApprovalNotifier(
      { sync: (pending) => { setApprovalPopupVisible(pending, RENDERER_ORIGIN); } },
      () => { focusApprovalPopup(); },
    );

    // MAR-428. Only now is there a store, a window to parent a dialog to, and a
    // decided answer about whether this machine can host agents. Any link that
    // arrived before this — including the one that started the process — has
    // been waiting rather than being dropped.
    drainHandoffQueue(handoffPorts(dataDir, runner));

    app.on("activate", () => {
      // macOS convention: clicking the dock icon with no windows open reopens one.
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  }).catch((error: unknown) => {
    // Every check above is written to throw — the store location, the renderer
    // posture, the URL allowlist. Inside a promise callback a throw is only an
    // unhandled rejection, which prints a warning and lets the app carry on in
    // exactly the state the check refused to accept. This is what makes "fail
    // loudly at startup" true rather than aspirational.
    console.error(
      `[dash-shell] startup failed: ${error instanceof Error ? error.stack : String(error)}`,
    );

    /*
     * MAR-436's actual requirement, and the reason the splash is not decorative.
     *
     * Until now a failed startup was `app.exit(1)` and a line on a stderr
     * stream nobody double-clicking an icon will ever see: DASH vanished. It
     * now says which step failed, what that means, and what to do — from
     * `describeStartupFailure`, in plain language, and *never* from the thrown
     * error, whose message is a developer's sentence full of paths.
     *
     * Note that this does not exit. The window is the message now, so the
     * process lives until the user closes it, and `window-all-closed` ends it
     * with the failing code. Exiting here would put the splash's whole point
     * back where it started.
     */
    if (splash !== null && splashStep !== null) {
      splash.fail(splashStep);
      startupFailed = true;
      return;
    }

    app.exit(1);
  });

  app.on("window-all-closed", () => {
    // Unchanged by MAR-415, and that is the interesting part. The issue's
    // acceptance criterion is that closing the DASH window leaves running
    // agents running — and it does, because the agents are children of the
    // *runner*, which is detached and is not torn down with this process.
    // Quitting DASH here costs nothing but the poller.
    //
    // What did change is that DASH now leaves a process behind on purpose. The
    // runner is stopped by `runner.stop`, not by closing the window; see
    // `runner/README.md`.
    //
    // MAR-436. One exception, and it is about the exit code rather than the
    // quitting. A startup that failed now keeps the splash up to say so instead
    // of exiting on the spot, so the non-zero code has to be paid here — when
    // the user closes the message. `app.exit` rather than `app.quit` because
    // this path has already decided; there is nothing left to interrupt it for.
    if (startupFailed) {
      app.exit(1);
      return;
    }
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    // Stop polling a runner we are about to stop talking to. The runner itself
    // is deliberately left alone.
    stopPolling?.();
    stopPolling = null;
    // The broker stops with DASH, which is the honest behaviour rather than a
    // limitation: a process that could reach a user's mailbox after they closed
    // the app they granted it through is exactly what ADR 0002 is about.
    stopBroker?.();
    stopBroker = null;
    // MAR-467. One last heartbeat on the way out, so a clean quit starts the
    // next launch's closed window at the moment DASH actually stopped rather
    // than up to thirty seconds before it.
    stopHeartbeat?.();
    stopHeartbeat = null;
    writeDashLastAlive(new Date().toISOString());
    // MAR-421. Stop watching before the popup window it controls is torn
    // down, so a tick cannot land against a window that is already gone.
    stopApprovalNotifier?.();
    stopApprovalNotifier = null;
    closeApprovalPopup();
  });

  app.on("will-quit", () => {
    /**
     * Close the database, which nothing outside the tests had ever done.
     *
     * `lib/db.ts` opens in WAL mode, so committed data is durable whether or not
     * this runs — that part was never in doubt and is not what this is for. What
     * it buys is the *checkpoint*: closing the last connection folds the
     * write-ahead log back into `dash.sqlite` and removes it, so the file DASH
     * leaves behind between sessions is a single self-contained one.
     *
     * That matters because of what the file is subjected to here. A store that
     * is only ever left mid-WAL is a store where every backup, every copy and
     * every abrupt termination lands on a two-file structure that has to be
     * recovered rather than simply read. Checkpointing on the way out means the
     * quiet exit — the overwhelmingly common one — leaves nothing to recover.
     *
     * `will-quit` rather than `before-quit` because `before-quit` can be
     * cancelled, and closing the handle out from under a quit that then does not
     * happen would leave the app running with a store it has to reopen.
     */
    closeDb();
  });
}
