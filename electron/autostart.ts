/**
 * Reading and writing this machine's login entry, and being the thing it starts
 * (MAR-785, ADR 0030).
 *
 * The decisions are in `lib/shell/autostart.ts`, which is pure and tested
 * without an Electron. What is left here is the part that cannot be: three calls
 * into `app.getLoginItemSettings` / `app.setLoginItemSettings`, and the ten
 * seconds of process that a login actually runs.
 *
 * ## Why `setLoginItemSettings` rather than `reg.exe` or a scheduled task
 *
 * All three write something Windows honours at logon. Two of them write it
 * somewhere a person can find.
 *
 * A **Run key value** — which is what Electron's API writes — appears in Task
 * Manager's *Startup apps* list, with a name, a publisher and a switch of its
 * own. That is the list a person opens when they want to know what their
 * computer starts without asking, and DASH belongs in it. It is also how they
 * turn this off without DASH's help, which matters more than usual here: see the
 * uninstall section in ADR 0030, where the honest answer is that there is no
 * hook and the entry has to be removable by hand.
 *
 * A **scheduled task** with a logon trigger does not appear in that list. It is
 * more capable — a delay, a restart policy, a hidden window — and every one of
 * those capabilities is a way for DASH to be running on somebody's machine in a
 * manner they cannot see. The capability this feature wants is *start once*, and
 * the Run key is exactly that and nothing more.
 *
 * `reg.exe` would write the same value with none of Electron's reading of
 * `StartupApproved` — see `readAutostartState`, where Windows' own off switch is
 * the difference between a truthful page and one that says "On" over a login
 * that does nothing.
 *
 * ## What runs at login
 *
 * `startRunnerAtLogin` — a DASH main process that takes no lock, opens no store,
 * creates no window, starts the runner exactly as any launch does, writes one
 * line saying so, and exits. It is ordinarily alive for two or three seconds.
 */

import { appendFileSync } from "node:fs";
import path from "node:path";

import { app } from "electron";

import {
  AUTOSTART_ENTRY_NAME,
  autostartCommand,
  autostartMatches,
  autostartRefusal,
  describeAutostartCommand,
  type AutostartCommand,
  type AutostartState,
} from "../lib/shell/autostart";
import { resolvesInstalledStore } from "../lib/shell/app-identity";
import { ensureRunner } from "./runner-process";
import { gitEntryKind } from "./data-dir";

/** The command this install would enrol. One derivation, three callers. */
function commandForThisInstall(): AutostartCommand {
  return autostartCommand({
    execPath: process.execPath,
    appPath: app.getAppPath(),
    packaged: app.isPackaged,
  });
}

/**
 * What Windows holds under DASH's name right now.
 *
 * `launchItems` rather than the top-level `openAtLogin`, because the two answer
 * different questions and only one of them is this page's. `openAtLogin` is
 * "does an entry exist for the path and args I asked about", which cannot tell
 * *no entry* apart from *an entry pointing at another copy of DASH* — and the
 * second of those is the case a person with two checkouts actually has. The
 * items carry a name, so the entry can be found by name and then compared.
 *
 * On anything that is not Windows this is empty and every caller falls through
 * to `autostartRefusal`'s first case, which is the honest answer there.
 */
function findEntry(): { command: AutostartCommand; enabled: boolean } | null {
  const settings = app.getLoginItemSettings();
  const items = settings.launchItems ?? [];
  const mine = items.find((item) => item.name === AUTOSTART_ENTRY_NAME);
  if (mine === undefined) {
    return null;
  }
  return { command: { path: mine.path, args: mine.args }, enabled: mine.enabled };
}

/**
 * The Startup page's whole state, in one read.
 *
 * Nothing is cached. This is read on every ask because the value it reports is
 * owned by Windows and can be changed by a person in Task Manager while DASH is
 * on screen — a cached "On" would be a page that stays wrong until it is
 * reopened, which is the same defect `view.notifications` fixed for the chief.
 */
export function readAutostartState(dataDir: string): AutostartState {
  const refusal = autostartRefusal({
    platform: process.platform,
    gitEntry: gitEntryKind(),
    /*
     * The **resolved store**, not `app.getPath("userData")`, and the difference
     * is the whole of "scratch and dev launches must never enrol".
     *
     * `store-and-vault-are-two-roots`: `DASH_DATA_DIR` moves the store without
     * moving `userData`, so a capture harness or a scratch run has a store in
     * `%TEMP%\dash-scratch-…` while `userData` still reads
     * `%APPDATA%\orchestratedash`. Asking `userData` would have called that
     * launch installed and let it write a login entry for a data directory that
     * exists for the length of a test. ADR 0027 decision 1 asks about the
     * destination for the same reason, and this is the same question.
     */
    installedStore: resolvesInstalledStore(dataDir),
  });
  const expected = commandForThisInstall();
  const command = describeAutostartCommand(expected);

  if (refusal !== null) {
    return {
      available: false,
      refusal,
      enrolled: false,
      approved: false,
      foreign: false,
      command: "",
    };
  }

  const entry = findEntry();
  if (entry === null) {
    return {
      available: true,
      refusal: null,
      enrolled: false,
      approved: false,
      foreign: false,
      command,
    };
  }

  const mine = autostartMatches(entry.command, expected);
  return {
    available: true,
    refusal: null,
    enrolled: mine,
    approved: mine && entry.enabled,
    foreign: !mine,
    command,
  };
}

/** What a press produced, for the page's sentence and for the shell log. */
export interface AutostartWriteResult {
  ok: boolean;
  state: AutostartState;
  /** The mechanism, for the log only. Never rendered. */
  problem?: string;
}

/**
 * Turn the login entry on or off.
 *
 * Refuses rather than writes when `autostartRefusal` says this install may not
 * enrol — a worktree, a scratch store, a platform without the API. That check is
 * repeated here and not merely relied upon in the renderer, for the reason every
 * command in this repository repeats its own checks: the page is a caller, not a
 * guard.
 *
 * **The off path runs even when this install is not enrolled**, and deliberately
 * so. `foreign` means an entry under DASH's name that points at a copy which may
 * no longer exist, and a person switching this off is asking for that entry to
 * be gone. Refusing to remove it because it is not ours would leave the one
 * broken login this feature can produce with nothing on screen that removes it.
 */
export function writeAutostart(dataDir: string, enabled: boolean): AutostartWriteResult {
  const before = readAutostartState(dataDir);
  if (!before.available) {
    return { ok: false, state: before, problem: `refused: ${String(before.refusal)}` };
  }

  const command = commandForThisInstall();
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      name: AUTOSTART_ENTRY_NAME,
      path: command.path,
      args: [...command.args],
    });
  } catch (error: unknown) {
    return {
      ok: false,
      state: before,
      problem: error instanceof Error ? error.message : "setLoginItemSettings failed",
    };
  }

  const after = readAutostartState(dataDir);
  /*
   * Read back rather than trusted. Windows can accept the write and decline to
   * honour it — a policy, a managed machine, an antivirus that owns the Run key
   * — and a control that reported success from the absence of an exception would
   * be the same shape of lie as reporting `openAtLogin` without `StartupApproved`.
   */
  const landed = enabled ? after.enrolled : !after.enrolled && !after.foreign;
  return landed
    ? { ok: true, state: after }
    : { ok: false, state: after, problem: "the value did not change" };
}

/**
 * The login-time process (ADR 0030 decision 3).
 *
 * Called from `electron/main.ts` *instead of* everything else that launch does,
 * on the strength of one switch in `process.argv`. What it deliberately does
 * not do is as important as what it does:
 *
 * - **It does not take the single-instance lock.** A DASH that lost the lock
 *   would hand its argv to the copy that holds it through `second-instance`,
 *   which surfaces that window. At login, the window a person did not ask for is
 *   the whole thing this shape exists to avoid; and worse, a person
 *   double-clicking DASH during the two seconds this process held the lock would
 *   have their launch swallowed by a process about to exit.
 * - **It does not open `dash.sqlite`.** ADR 0027 counted the ways this store
 *   comes to be abandoned mid-checkpoint and made every exit checkpoint it. A
 *   process that runs at every login and touches the store would be a new one of
 *   those ways, added for no gain: the runner needs a directory, not a database.
 * - **It does not create a window, a tray icon or a notification.** Silence is
 *   the promise the toggle's copy makes.
 *
 * `assertStoreLocation` is deliberately *not* called: it is `whenReady`'s, it
 * belongs to a launch that is about to open the store, and this one is not.
 * The refusal that matters here — a worktree enrolling itself — is enforced
 * where the entry is written rather than where it is honoured, because an entry
 * that already exists is a fact about the machine and refusing to act on it at
 * login would leave a person with a startup item that does nothing and says
 * nothing.
 */
export async function startRunnerAtLogin(dataDir: string): Promise<void> {
  const started = await ensureRunner(dataDir);
  /*
   * ASCII only, deliberately. This file is read at three in the morning by
   * whatever a person has to hand — `type` in a console, Notepad — and Windows
   * PowerShell 5.1's `Get-Content` still defaults to the system codepage, which
   * turns a UTF-8 em dash into mojibake in the one line that is supposed to say
   * what happened. Every other log in this repository is read through tooling
   * that knows the encoding; this one is not.
   */
  const line = started.ok
    ? `started the runner, pid ${String(started.handle.pid)}${started.handle.adopted ? " (adopted - it was already up)" : ""}`
    : `did not start the runner (${started.reason}): ${started.detail}`;
  noteLogin(dataDir, line);
  console.warn(`[dash-autostart] ${line}`);
  app.exit(started.ok ? 0 : 1);
}

/**
 * One line per login, beside the runner's own log.
 *
 * This process has no window, no console anybody sees, and no store. Without
 * this there is no evidence at all that a login happened, which makes "did it
 * start this morning" unanswerable — and that question is the entire reason a
 * person turned the switch on. `runner.log` in the same directory is the other
 * half and is the runner's own.
 *
 * Failure is swallowed. A login that could not write its own log has still
 * started the runner, and refusing to proceed because the note failed would
 * trade the feature for its receipt.
 */
function noteLogin(dataDir: string, line: string): void {
  try {
    appendFileSync(
      path.join(dataDir, "autostart.log"),
      `${new Date().toISOString()} ${line}\n`,
      "utf8",
    );
  } catch {
    // See above.
  }
}
