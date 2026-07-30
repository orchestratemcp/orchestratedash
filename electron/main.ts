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

import { app, BrowserWindow, ipcMain, Menu } from "electron";

import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";

import {
  localPrincipal,
  noAdapter,
  runAgentCommand,
  type AgentCommandInput,
} from "../lib/agent-dom/runner";
import { heldCredentials, performConnectionAction } from "../lib/connection-actions";
import { deliverableFields, type CredentialTarget } from "../lib/connection-credentials";
import type { ConnectionSourceManifest } from "../lib/connections";
import { parseOAuthCredential } from "../lib/oauth/credential";
import { closeDb, dataDir } from "../lib/db";
import type { HandoffPorts } from "../lib/handoff-flow";
import { findDeepLink } from "../lib/shell/deep-link";
import { applicationMenu, type MenuAction, type MenuItemSpec } from "../lib/shell/menu";
import {
  SHELL_COMMAND_CHANNEL,
  dispatchCommand,
  formatAuditLine,
  type RunnerLifecycleResult,
} from "../lib/shell/ipc";
import {
  SHELL_READ_CHANNEL,
  reviewRead,
  type ReadResponse,
  type ReadResults,
} from "../lib/shell/read";
import {
  agentsView,
  connectionsView,
  runView,
  runsView,
  workInboxView,
  workspaceView,
} from "../lib/views/build";
import { createAgentChannels, startPolling, type AgentChannels } from "./agent-adapters";
import {
  handoffPorts,
  openHandoffLink,
  registerProtocolClient,
  removeAgentWithReport,
  surfaceWindow,
} from "./handoff-host";
import {
  assertRendererPresent,
  registerRendererScheme,
  serveRenderer,
} from "./renderer-host";
import { RENDERER_ENTRY_URL, RENDERER_ORIGIN } from "../lib/shell/renderer-scheme";
import { readAgentManifest } from "../lib/store";
import {
  promptForAuthorization,
  promptForSecret,
  registerCredentialChannels,
} from "./credential-prompt";
import { mintAccessToken, providerOperations } from "./oauth-session";
import { ensureRunner, runnerFetch, stopRunner, type RunnerHandle } from "./runner-process";
import { assertSampleTemplatesPresent, offerSampleAgent } from "./sample-agent";
import {
  SHELL_WEB_PREFERENCES,
  assertHardenedWebPreferences,
  isAllowedRendererUrl,
} from "../lib/shell/window";
import { secureStore } from "./secure-store";

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
    enqueueHandoff(url);
  }
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
      return { role: spec.role as Electron.MenuItemConstructorOptions["role"] };
    }
    return {
      label: spec.label,
      accelerator: spec.accelerator,
      click: () => {
        void runMenuAction(spec.action);
      },
    };
  };

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      applicationMenu(process.platform, app.getName()).map((menu) => ({
        label: menu.label,
        submenu: menu.items.map(toItem),
      })),
    ),
  );
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
    case undefined:
      return;
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled menu action: ${String(unreachable)}`);
    }
  }
}

export function createWindow(): BrowserWindow {
  // Re-assert the posture at the point of use. `SHELL_WEB_PREFERENCES` is
  // frozen, so this can only fail if someone edits the constant — which is
  // precisely the regression worth catching, and the tests catch it earlier.
  assertHardenedWebPreferences(SHELL_WEB_PREFERENCES);

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    // Do not paint an empty frame while the renderer boots.
    show: false,
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
      runAgentCommand: (input: AgentCommandInput) =>
        runAgentCommand(input, {
          principal,
          // MAR-415: the adapter is chosen per agent, and is the real HTTP one
          // for any agent DASH holds a channel to. `noAdapter` remains the
          // answer for the rest — an agent with no control location, or a
          // remote one DASH has no credential for — and it still refuses
          // honestly rather than reporting an effect nothing performed.
          adapter: channels?.adapterFor(input.target.agent_id) ?? noAdapter,
        }),
      runnerLifecycle: (action, agentId) => runnerLifecycle(runner, action, agentId),
      // MAR-383. The vault is reachable from exactly this one entry in exactly
      // this one context object, and the value the user types never comes back
      // through it — see `lib/connection-actions.ts` for what does.
      connectionAction: (action, target) =>
        performConnectionAction(action, target, {
          store: secureStore(),
          readManifest: (agentId) =>
            readAgentManifest(agentId) as ConnectionSourceManifest | null,
          promptForSecret: (credential, vaultLabel) =>
            promptForSecret(
              credential,
              vaultLabel,
              alreadyHeld(credential),
              BrowserWindow.getAllWindows()[0] ?? null,
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
                BrowserWindow.getAllWindows()[0] ?? null,
                RENDERER_ORIGIN,
              ),
          },
        }),
    });
  });
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
async function collectSpawnCredentials(agentId: string): Promise<Record<string, string>> {
  const manifest = readAgentManifest(agentId) as ConnectionSourceManifest | null;
  if (manifest === null) {
    return {};
  }

  const store = secureStore();
  const credentials: Record<string, string> = {};

  for (const field of deliverableFields(agentId, manifest)) {
    try {
      const stored = await store.get(field.secret_name);

      if (field.kind === "oauth") {
        // MAR-446. What is in the vault is a refresh token, and it does not go
        // anywhere near a child process: it is DASH's durable grant on the
        // user's account, and an agent that had it could keep minting access
        // long after DASH stopped holding it. What the agent gets is a fresh
        // access token, minted here, good for about an hour, and dead when the
        // provider says so.
        const credential = parseOAuthCredential(stored);
        if (credential === null) {
          continue;
        }
        const access = await mintAccessToken(credential);
        credentials[field.environment_name] = access.access_token;
        continue;
      }

      credentials[field.environment_name] = stored;
    } catch {
      // `not_found` on first run, `vault_locked` on a machine whose keychain is
      // shut, and for OAuth a grant the provider has stopped honouring. All of
      // them mean "DASH has nothing to hand over right now", and all of them are
      // already reported on the Connection Center, where the user asked.
    }
  }

  return credentials;
}

async function runnerLifecycle(
  runner: RunnerHandle | null,
  action: string,
  agentId: string | undefined,
): Promise<RunnerLifecycleResult> {
  if (action === "remove") {
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
    return removeAgentWithReport(agentId, handoffContext);
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
      const body = (await response.json()) as { agents?: unknown[] };
      return {
        ok: true,
        data: { available: true, supervising: (body.agents ?? []).length },
      };
    } catch {
      return { ok: false, detail: "The runner did not answer." };
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
 */
function reportStoreLocation(): void {
  console.warn(`[dash-shell] store: ${dataDir}`);
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
      enqueueHandoff(launchLink);
    }

    app.on("second-instance", (_event, argv) => {
      surfaceWindow();
      const url = findDeepLink(argv);
      if (url !== null) {
        enqueueHandoff(url);
      }
    });

    // macOS does not use argv for this at all.
    app.on("open-url", (event, url) => {
      event.preventDefault();
      enqueueHandoff(url);
    });
  }

  void app.whenReady().then(async () => {
    // `electron/data-dir.ts` already pointed the store at `userData`, as the
    // first import in this file. This is the proof it worked — see that module
    // for why the old `useUserDataDirectory()` call here could never have.
    assertStoreLocation(dataDir);
    reportStoreLocation();
    reportSecureStoreBacking();

    // MAR-429. The read-only half of the same question: the store must land in
    // the user's data directory, and the schemas must come from this install
    // rather than from a development tree that happens to be on the build
    // machine. Both fail loudly here or not at all.
    assertContractsLocation();
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

    registerCommandChannel(channels, runner);
    registerReadChannel();
    // MAR-383. The third and last `ipcMain.handle` group. Registered here beside
    // the other two so every channel DASH answers is visible in one place.
    registerCredentialChannels();
    installApplicationMenu();
    createWindow();

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
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", () => {
    // Stop polling a runner we are about to stop talking to. The runner itself
    // is deliberately left alone.
    stopPolling?.();
    stopPolling = null;
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
