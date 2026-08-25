/**
 * What DASH would put in a person's startup list, and when it refuses to
 * (MAR-785, ADR 0030).
 *
 * Every claim here is about `lib/shell/autostart.ts`, which is pure for exactly
 * this reason: the alternative is a suite that writes into the registry of
 * whichever machine runs it. The Electron half — `electron/autostart.ts` — is
 * three calls into `app.getLoginItemSettings` / `setLoginItemSettings` and one
 * `ensureRunner`, and the decisions it makes are all here.
 *
 * The refusals are the load-bearing half. ADR 0027 refuses a linked worktree
 * the installed store; this refuses it the ability to put itself into a
 * person's login, which is strictly worse than opening the store because it
 * survives the branch, the session and the directory.
 */

import { describe, expect, it } from "vitest";

import {
  AUTOSTART_ENTRY_NAME,
  AUTOSTART_SWITCH,
  autostartCommand,
  autostartMatches,
  autostartMatchesRawValue,
  autostartRefusal,
  autostartStateData,
  describeAutostartCommand,
  isAutostartLaunch,
  parseAutostartState,
  type AutostartState,
} from "../lib/shell/autostart";
import { STARTUP_COPY, describeAutostartRefusal } from "../lib/copy/startup";

const INSTALLED = {
  platform: "win32",
  gitEntry: "directory",
  installedStore: true,
} as const;

describe("the login switch", () => {
  it("is recognised anywhere in argv, not only in one position", () => {
    // Windows appends nothing of its own to a Run value, but Electron and
    // Chromium both do — and a `--dash-start-runner` that only worked as
    // `argv[2]` would be a login that opened a window the first time a switch
    // was inserted ahead of it.
    expect(isAutostartLaunch(["electron.exe", "C:\\dash", AUTOSTART_SWITCH])).toBe(true);
    expect(isAutostartLaunch(["dash.exe", AUTOSTART_SWITCH, "--other"])).toBe(true);
    expect(isAutostartLaunch(["electron.exe", "C:\\dash"])).toBe(false);
  });

  it("is prefixed so Chromium cannot grow into it", () => {
    // Not an aesthetic. A bare `--start-runner` colliding with a future
    // Chromium switch would not be a compile error; it would be a login doing
    // something else, discovered at a reboot.
    expect(AUTOSTART_SWITCH.startsWith("--dash-")).toBe(true);
  });
});

describe("the command a login entry holds", () => {
  it("names the app directory in development and omits it when packaged", () => {
    // The packaged case is not symmetry: a packaged Electron app ignores
    // `argv[1]` as an app path and runs what is baked into its own resources,
    // so passing one would be a value that reads as configuration and is not.
    expect(autostartCommand({ execPath: "C:\\e\\electron.exe", appPath: "C:\\dash", packaged: false })).toEqual({
      path: "C:\\e\\electron.exe",
      args: ["C:\\dash", AUTOSTART_SWITCH],
    });
    expect(
      autostartCommand({ execPath: "C:\\p\\DASH.exe", appPath: "C:\\p\\resources\\app", packaged: true }),
    ).toEqual({ path: "C:\\p\\DASH.exe", args: [AUTOSTART_SWITCH] });
  });

  it("renders as a command line a person can match against Task Manager", () => {
    expect(
      describeAutostartCommand({ path: "C:\\Program Files\\DASH.exe", args: [AUTOSTART_SWITCH] }),
    ).toBe(`"C:\\Program Files\\DASH.exe" ${AUTOSTART_SWITCH}`);
  });

  it("compares case-insensitively, because Windows paths are", () => {
    // `process.execPath` and the same path read back out of the registry
    // routinely differ in the case of the drive letter alone, and a comparison
    // that called those two different would report this install's own entry as
    // somebody else's on every launch.
    const expected = autostartCommand({ execPath: "C:\\e\\electron.exe", appPath: "C:\\dash", packaged: false });
    expect(
      autostartMatches({ path: "c:\\E\\Electron.exe", args: ["c:\\DASH", AUTOSTART_SWITCH] }, expected),
    ).toBe(true);
  });

  it("calls another copy of DASH a stranger", () => {
    const expected = autostartCommand({ execPath: "C:\\e\\electron.exe", appPath: "C:\\dash", packaged: false });
    expect(
      autostartMatches({ path: "C:\\e\\electron.exe", args: ["C:\\other-dash", AUTOSTART_SWITCH] }, expected),
    ).toBe(false);
    // A shorter argument list is not a prefix match.
    expect(autostartMatches({ path: "C:\\e\\electron.exe", args: [] }, expected)).toBe(false);
  });
});

describe("matching the Run value's own text (MAR-789)", () => {
  // `app.getLoginItemSettings().launchItems[].args` drops a trailing switch on
  // read-back on Electron 43.2.0/Windows. `RAW_FIXTURE` below is not invented —
  // it is the literal output of `reg.exe query
  // "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v OrchestrateDASH` on
  // Henrik's machine while this fix was written, the same healthy, enabled entry
  // the issue's evidence quotes. The old `autostartMatches(entry.command, ...)`
  // path called it foreign because Electron's parse of it drops
  // `--dash-start-runner`; `autostartMatchesRawValue` reads this text directly
  // and must call it mine.
  const RAW_FIXTURE =
    '"C:\\Users\\henri\\Desktop\\projekt\\MCP\\orchestratedash\\node_modules\\.pnpm\\electron@43.2.0\\node_modules\\electron\\dist\\electron.exe" ' +
    '"C:\\Users\\henri\\Desktop\\projekt\\MCP\\orchestratedash" --dash-start-runner';

  const devExpected = autostartCommand({
    execPath:
      "C:\\Users\\henri\\Desktop\\projekt\\MCP\\orchestratedash\\node_modules\\.pnpm\\electron@43.2.0\\node_modules\\electron\\dist\\electron.exe",
    appPath: "C:\\Users\\henri\\Desktop\\projekt\\MCP\\orchestratedash",
    packaged: false,
  });

  it("recognises the healthy dev-checkout entry the launchItems parse drops a switch from", () => {
    expect(autostartMatchesRawValue(RAW_FIXTURE, devExpected)).toBe(true);
  });

  it("recognises a packaged install's single-switch value, the other shape the issue flags", () => {
    // Packaged installs pass only `[AUTOSTART_SWITCH]` (no app path), so the
    // same launchItems bug would read back `args: []` — verified here against
    // the raw text instead, which still carries the switch.
    const packagedExpected = autostartCommand({
      execPath: "C:\\Program Files\\DASH\\DASH.exe",
      appPath: "C:\\Program Files\\DASH\\resources\\app",
      packaged: true,
    });
    const raw = '"C:\\Program Files\\DASH\\DASH.exe" --dash-start-runner';
    expect(autostartMatchesRawValue(raw, packagedExpected)).toBe(true);
  });

  it("is case-insensitive, for the same drive-letter reason as autostartMatches", () => {
    // `process.execPath` and a value read back out of the registry routinely
    // differ in case alone — most often the drive letter, but this asserts the
    // whole line survives a case change, not just that one letter.
    expect(autostartMatchesRawValue(RAW_FIXTURE.toLowerCase(), devExpected)).toBe(true);
  });

  it("still calls the genuinely-foreign twin foreign — a different checkout's entry", () => {
    // Same executable, a sibling directory instead of this checkout's — the
    // moved-checkout / two-copies case `autostartRefusal`'s docblock names.
    const raw = RAW_FIXTURE.replace(
      '"C:\\Users\\henri\\Desktop\\projekt\\MCP\\orchestratedash" --dash-start-runner',
      '"C:\\Users\\henri\\Desktop\\projekt\\MCP\\orchestratedash-old" --dash-start-runner',
    );
    expect(autostartMatchesRawValue(raw, devExpected)).toBe(false);
  });

  it("reads an unparsable or missing value as not mine, never as a guess", () => {
    expect(autostartMatchesRawValue("", devExpected)).toBe(false);
  });
});

describe("who may enrol", () => {
  it("lets an installed DASH on Windows enrol", () => {
    expect(autostartRefusal(INSTALLED)).toBeNull();
    // A packaged install has no `.git` at all, which is the shape this exists
    // for once DASH ships as something other than a checkout.
    expect(autostartRefusal({ ...INSTALLED, gitEntry: "absent" })).toBeNull();
  });

  it("refuses a linked worktree, which is ADR 0027's rule outliving the session", () => {
    // The store guard refuses a worktree the installed store for the length of
    // one launch. This refuses it something worse: a login entry pointing at a
    // branch's directory, still firing after the branch is merged and the
    // directory deleted.
    expect(autostartRefusal({ ...INSTALLED, gitEntry: "file" })).toBe("foreign_checkout");
  });

  it("refuses a scratch store, which is every capture harness", () => {
    expect(autostartRefusal({ ...INSTALLED, installedStore: false })).toBe("scratch_store");
  });

  it("refuses anything that is not Windows", () => {
    // `path` and `args` on `setLoginItemSettings` are Windows-only: a macOS
    // login item launches the *application*, which is the full-DASH-at-login
    // shape ADR 0030 refused, and there is no Linux implementation at all.
    expect(autostartRefusal({ ...INSTALLED, platform: "darwin" })).toBe("unsupported_platform");
    expect(autostartRefusal({ ...INSTALLED, platform: "linux" })).toBe("unsupported_platform");
  });

  it("asks the platform first, so a worktree on macOS is told the true thing", () => {
    // Ordering, asserted rather than assumed: a person on a Mac cannot act on
    // "this is a working copy", and telling them so would send them to fix
    // something that would change nothing.
    expect(autostartRefusal({ platform: "darwin", gitEntry: "file", installedStore: false })).toBe(
      "unsupported_platform",
    );
  });

  it("has a sentence for every refusal, and none of them names a mechanism", () => {
    for (const refusal of ["unsupported_platform", "foreign_checkout", "scratch_store"] as const) {
      const sentence = describeAutostartRefusal(refusal);
      expect(sentence.length).toBeGreaterThan(20);
      // MAR-684's rule: the code and the cause go to the shell log. A person is
      // owed the remedy in their own words.
      expect(sentence).not.toMatch(/registry|Run key|setLoginItemSettings|HKCU|argv/iu);
    }
  });
});

describe("the state, across the command channel", () => {
  const state: AutostartState = {
    available: true,
    refusal: null,
    enrolled: true,
    approved: false,
    foreign: false,
    command: `"C:\\dash.exe" ${AUTOSTART_SWITCH}`,
  };

  it("survives the round trip through flat primitives", () => {
    expect(parseAutostartState(autostartStateData(state))).toEqual(state);
  });

  it("turns a refusal back into itself and an unknown one into null", () => {
    const refused: AutostartState = { ...state, available: false, refusal: "foreign_checkout" };
    expect(parseAutostartState(autostartStateData(refused))?.refusal).toBe("foreign_checkout");
    expect(parseAutostartState({ ...autostartStateData(state), refusal: "made_up" })?.refusal).toBeNull();
  });

  it("reads a result from a shell that has never heard of this as null", () => {
    // The distinction the page draws: `null` is a build mismatch and gets a
    // sentence about the build, while a parsed state with `available: false`
    // gets a refusal a person can act on. Defaulting one into the other would
    // tell somebody with an old DASH to move their checkout.
    expect(parseAutostartState(undefined)).toBeNull();
    expect(parseAutostartState({})).toBeNull();
    expect(parseAutostartState({ available: true })).toBeNull();
  });

  it("reads a missing flag as off rather than on", () => {
    const partial = { available: true, command: "x", refusal: "" };
    expect(parseAutostartState(partial)).toMatchObject({
      enrolled: false,
      approved: false,
      foreign: false,
    });
  });
});

describe("the copy on the Startup page", () => {
  it("keeps ADR 0029's third liveness sentence, in the on state", () => {
    // The whole bar this page is held to. Turning autostart on does not make a
    // window fire that came round while the machine was off — ADR 0029 decision
    // 7 refuses backfilling — and a page that dropped the sentence would have
    // taken a true statement off the screen and put nothing in its place.
    const third = STARTUP_COPY.liveness_on[2] ?? "";
    expect(third).toMatch(/off or asleep|asleep/iu);
    expect(third).toMatch(/missed/iu);
    expect(third).toMatch(/does not run it late/iu);
  });

  it("says it is off until pressed, on the page rather than in a docblock", () => {
    expect(STARTUP_COPY.opt_in).toMatch(/off until you turn it on/iu);
    expect(STARTUP_COPY.opt_in).toMatch(/never adds itself/iu);
  });

  it("promises no window and no port, both of which a person could assume", () => {
    const joined = STARTUP_COPY.not_this.join(" ");
    expect(joined).toMatch(/does not open DASH's window/iu);
    expect(joined).toMatch(/does not open a port/iu);
  });

  it("uses the same word for the runner that the agent page already uses", () => {
    // `AGENT_TRIGGER_COPY.liveness[1]` calls it "a small helper". A person who
    // read that sentence and came looking for the switch has to recognise the
    // thing they are switching.
    expect(STARTUP_COPY.toggle.detail).toMatch(/helper/iu);
  });

  it("keeps the button faces short, because every button is uppercased", () => {
    expect(STARTUP_COPY.toggle_on.length).toBeLessThanOrEqual(12);
    expect(STARTUP_COPY.toggle_off.length).toBeLessThanOrEqual(12);
  });

  it("names the entry so a person can find it in Task Manager", () => {
    expect(AUTOSTART_ENTRY_NAME).toBe("OrchestrateDASH");
    expect(STARTUP_COPY.command_note).toMatch(/Startup apps/u);
  });
});
