/**
 * What DASH asks Windows to run at login, and whether this copy of DASH may ask
 * (MAR-785, ADR 0030).
 *
 * **Pure on purpose, for `lib/shell/app-identity.ts`'s reason.** ADR 0027
 * decision 1 moved the store guard out of `electron/data-dir.ts` because that
 * module runs `app.setName` as an import side effect and cannot be loaded from a
 * test at all. Everything below is the same kind of decision — which command a
 * login entry should hold, and whether this checkout has any business writing
 * one — so it lives where a test can reach it without an Electron. The half that
 * touches the registry is `electron/autostart.ts`, and it is thin.
 *
 * ## Why the login entry runs DASH's own executable and not the runner
 *
 * `electron/runner-process.ts` starts the runner by spawning `process.execPath`
 * with `ELECTRON_RUN_AS_NODE=1` in its environment — that variable is the whole
 * mechanism by which the Electron binary becomes a Node runtime, and it is the
 * reason a user needs no separate Node installation.
 *
 * **A Run key value is a command line. It carries no environment.** Neither does
 * a Task Scheduler action. So there is no spelling of "run the runner" that
 * Windows can execute at login, short of writing a `.cmd` shim into the data
 * directory — which would put an executable script in the one place on disk that
 * every agent DASH hosts can already write to, and have Windows run it as the
 * person at every login. That is a worse thing than the feature is worth.
 *
 * What Windows *can* run is the executable DASH already is, and DASH can then
 * spawn the runner exactly as it does on any other launch. So the login entry is
 * `<DASH's exe> <app path> --start-runner`, and `electron/main.ts` branches on
 * that switch before it takes the single-instance lock, starts the runner, and
 * exits. See `AUTOSTART_SWITCH`.
 *
 * ## Why not a separate entry script
 *
 * `electron dist/electron/autostart.mjs` would work today and would stop working
 * the day DASH ships packaged: a packaged Electron app ignores `argv[1]` as an
 * app path and runs the app baked into its own resources. A switch on the one
 * executable is the spelling that survives packaging, and it is the same
 * spelling in development, which means the thing proven on this machine is the
 * thing that ships.
 */

/**
 * The switch that means *start the runner and get out of the way*.
 *
 * Prefixed `--dash-` rather than a bare `--start-runner` because Electron and
 * Chromium own the unprefixed switch namespace and add to it between versions.
 * A collision would not be a compile error; it would be a login that does
 * something else.
 */
export const AUTOSTART_SWITCH = "--dash-start-runner";

/**
 * The name the Run value carries, which is what Task Manager shows a person.
 *
 * Not `app.getName()` — that is `orchestratedash`, and a person auditing their
 * Startup apps list is owed the name on the window rather than the name of the
 * directory the store lives in.
 */
export const AUTOSTART_ENTRY_NAME = "OrchestrateDASH";

/** Is this process a login-time runner start rather than a DASH launch? */
export function isAutostartLaunch(argv: readonly string[]): boolean {
  return argv.includes(AUTOSTART_SWITCH);
}

/** One command line, split the way `app.setLoginItemSettings` wants it. */
export interface AutostartCommand {
  /** The executable Windows runs. */
  path: string;
  /** Its arguments, in order. */
  args: readonly string[];
}

/**
 * What the login entry should hold for this install.
 *
 * `packaged` decides whether the app path is an argument. In development the app
 * is a directory Electron is pointed at (`electron .`, and the desktop launcher's
 * `electron.exe <repo>`); packaged, the app is inside the executable and passing
 * a path would be ignored at best.
 */
export function autostartCommand(install: {
  execPath: string;
  appPath: string;
  packaged: boolean;
}): AutostartCommand {
  return {
    path: install.execPath,
    args: install.packaged ? [AUTOSTART_SWITCH] : [install.appPath, AUTOSTART_SWITCH],
  };
}

/**
 * Whether an entry already on the machine is the one this install would write.
 *
 * Compared rather than assumed because the interesting case is not "is something
 * enrolled" but **"is the enrolled thing me"**. A person who moved their checkout,
 * or who has two copies of DASH, has a Run value pointing at the other one, and a
 * toggle that read it as "on" would be reporting somebody else's login entry as
 * this DASH's.
 *
 * Paths are compared case-insensitively because Windows filesystems are, and
 * `process.execPath` and a value read back out of the registry routinely differ
 * in the case of the drive letter alone.
 */
export function autostartMatches(recorded: AutostartCommand, expected: AutostartCommand): boolean {
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  return (
    same(recorded.path, expected.path) &&
    recorded.args.length === expected.args.length &&
    recorded.args.every((value, index) => same(value, expected.args[index] ?? ""))
  );
}

/**
 * Whether the Run value's own text — not Electron's parse of it — is the
 * command line this install would write.
 *
 * MAR-789: `app.getLoginItemSettings().launchItems[].args` drops a trailing
 * switch on read-back on Electron 43.2.0/Windows — the registry held
 * `... --dash-start-runner` and the parse returned an `args` array one entry
 * short, with the switch simply gone. `autostartMatches` compared against that
 * dropped array and called a healthy, correctly-written entry foreign. The
 * registry's own text has no such bug: it is exactly what
 * `app.setLoginItemSettings` wrote. This tokenizes that text the way
 * `describeAutostartCommand` renders it — the only shape a value this module
 * wrote can take — and reuses `autostartMatches`'s case-insensitive comparison
 * on the result, so a genuinely foreign entry (a different path, a different
 * app directory) still reads as foreign.
 *
 * The tokenizer does not unescape an embedded quote, because a Run value this
 * module writes never carries one — every token is either a bare switch or a
 * whole quoted path.
 */
export function autostartMatchesRawValue(rawValue: string, expected: AutostartCommand): boolean {
  const tokens = tokenizeCommandLine(rawValue);
  if (tokens.length === 0) {
    return false;
  }
  const [path, ...args] = tokens;
  return autostartMatches({ path, args }, expected);
}

/** A plain quoted-or-bare command-line splitter — see `autostartMatchesRawValue`. */
function tokenizeCommandLine(value: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    tokens.push(match[1] ?? match[2] ?? "");
  }
  return tokens;
}

/**
 * Why this copy of DASH may not write a login entry, when it may not.
 *
 * `null` is the permission. Every other value is a refusal with a reason a
 * person can act on, and `lib/copy/startup.ts` has the sentence for each.
 */
export type AutostartRefusal =
  | "unsupported_platform"
  | "foreign_checkout"
  | "scratch_store";

export interface AutostartInstall {
  /** `process.platform`. */
  platform: string;
  /**
   * What `<app path>/.git` is — ADR 0027's question, asked for its answer.
   *
   * A linked worktree's `.git` is a file; the main working tree's is a
   * directory; a packaged install has neither.
   */
  gitEntry: "directory" | "file" | "absent";
  /**
   * Whether the **resolved store directory** is the installed one —
   * `resolvesInstalledStore` in `lib/shell/app-identity.ts`, decided by the
   * caller because only the caller has a resolved directory.
   *
   * The store and not `userData`. `DASH_DATA_DIR` moves one without the other,
   * so a scratch run has its store in `%TEMP%` while `userData` still reads
   * `%APPDATA%\orchestratedash` — and asking the wrong one would let a test's
   * data directory be enrolled at login. See `readAutostartState`.
   */
  installedStore: boolean;
}

/**
 * May this install enrol itself at login?
 *
 * Three refusals, and the ordering is the order in which they are true rather
 * than a preference.
 *
 * 1. **Not Windows.** Electron's `path` and `args` options on
 *    `setLoginItemSettings` are Windows-only: on macOS a login item launches the
 *    *application*, which is the full-DASH-at-login shape ADR 0030 refused, and
 *    there is no Linux implementation at all. A cross-platform login entry is a
 *    real packet — a LaunchAgent plist and a systemd user unit, each with its own
 *    uninstall story — and shipping a control here that silently did the wrong
 *    thing on two of three platforms would be worse than the refusal.
 *
 * 2. **A linked worktree.** ADR 0027's rule, and this is the case it was written
 *    for made permanent: a worktree that enrolled would put its own build on the
 *    real store at every login, for as long as that branch's directory existed,
 *    including after it was deleted. The session prompt for this packet says it
 *    in one line — scratch and dev launches must never enrol autostart — and
 *    this is where that is enforced rather than remembered.
 *
 * 3. **A store that is not DASH's.** The complement, and the one that catches a
 *    capture harness or a `DASH_DATA_DIR` scratch run. Enrolling one would ask
 *    Windows to start a runner over a directory that exists for the length of a
 *    test.
 *
 * A packaged install has no `.git` at all, which is `absent` and passes: that is
 * the shape this is ultimately for.
 */
export function autostartRefusal(install: AutostartInstall): AutostartRefusal | null {
  if (install.platform !== "win32") {
    return "unsupported_platform";
  }
  if (install.gitEntry === "file") {
    return "foreign_checkout";
  }
  if (!install.installedStore) {
    return "scratch_store";
  }
  return null;
}

/**
 * Everything the Startup page needs, and nothing a person could not be shown.
 *
 * Primitives only — this crosses the command channel, where `RunnerLifecycleResult`
 * permits a flat record and nothing else. The command line is in it deliberately:
 * a control that writes a value into a person's registry owes them the literal
 * text of what it wrote, in the place they can read it before they press.
 */
export interface AutostartState {
  /** Whether this install may enrol at all. `refusal` says why not. */
  available: boolean;
  refusal: AutostartRefusal | null;
  /** Whether a login entry for this install exists right now. */
  enrolled: boolean;
  /**
   * Whether Windows will actually run it.
   *
   * Task Manager's Startup apps list can disable a Run value **without removing
   * it**, by writing a bitmask under `StartupApproved\Run`. A DASH that read only
   * the value's existence would say "On" over a login that does nothing, which is
   * the exact class of lie the third liveness sentence exists to prevent. Electron
   * reports it as `enabled` on each launch item; this is that, and it is only
   * meaningful when `enrolled`.
   */
  approved: boolean;
  /**
   * A login entry under this name that points somewhere else.
   *
   * True when Windows holds an entry named `AUTOSTART_ENTRY_NAME` whose command
   * is not this install's — the moved-checkout and two-copies cases. The page
   * shows the command rather than silently repointing it: rewriting a person's
   * login state without a press is the thing this whole ADR is against.
   */
  foreign: boolean;
  /** The exact command line, for the page to show. Empty when unavailable. */
  command: string;
}

/** One command line as a person reads it, for the page and for the log. */
export function describeAutostartCommand(command: AutostartCommand): string {
  const quote = (value: string): string => (value.includes(" ") ? `"${value}"` : value);
  return [command.path, ...command.args].map(quote).join(" ");
}

/**
 * The state, flattened for the command channel.
 *
 * `RunnerLifecycleResult.data` is `Record<string, string | number | boolean>`
 * and that constraint is deliberate — see its docblock, which refuses richer
 * shapes so that nothing on this channel can become a second source of truth
 * about an agent. So `refusal: null` becomes the empty string here and
 * `parseAutostartState` turns it back, rather than the constraint being widened
 * for one page.
 */
export function autostartStateData(state: AutostartState): Record<string, string | boolean> {
  return {
    available: state.available,
    refusal: state.refusal ?? "",
    enrolled: state.enrolled,
    approved: state.approved,
    foreign: state.foreign,
    command: state.command,
  };
}

/** Every refusal, by value, so the parse below can check rather than cast. */
const REFUSALS: readonly AutostartRefusal[] = [
  "unsupported_platform",
  "foreign_checkout",
  "scratch_store",
];

/**
 * Turn a command result back into the state, or `null` if it is not one.
 *
 * The renderer's half. `null` rather than a defaulted object, because "the shell
 * answered with something that is not this" and "this install may not enrol"
 * are different sentences and the page shows different things for them — a
 * build mismatch is not a refusal a person can act on.
 */
export function parseAutostartState(data: unknown): AutostartState | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const record = data as Record<string, unknown>;
  if (typeof record["available"] !== "boolean" || typeof record["command"] !== "string") {
    return null;
  }
  const refusal = record["refusal"];
  return {
    available: record["available"],
    refusal:
      typeof refusal === "string" && (REFUSALS as readonly string[]).includes(refusal)
        ? (refusal as AutostartRefusal)
        : null,
    enrolled: record["enrolled"] === true,
    approved: record["approved"] === true,
    foreign: record["foreign"] === true,
    command: record["command"],
  };
}
