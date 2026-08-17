/**
 * Whether a store belongs to DASH or to a second application wearing its build
 * (MAR-656).
 *
 * The bug: the registered `dash://` handler launched `electron
 * dist/electron/main.mjs`, Electron reads the app name from the package.json of
 * an app *directory* and had none, so the process ran as `Electron` with
 * `userData` at `%APPDATA%\Electron`. A whole second DASH — own store, own
 * runner, own agents — opened beside the real one and collided with nothing,
 * because the single-instance lock is keyed on `userData`. It had been
 * collecting a person's agents since 2026-08-03.
 *
 * `assertStoreLocation` was already running on every launch and passed every
 * time, because it compared the resolved store against `app.getPath("userData")`
 * and in the phantom **both sides said `Electron`**. That is the case these
 * tests are about: equality with yourself is not identity.
 */

import { describe, expect, it } from "vitest";

import {
  ALLOW_INSTALLED_STORE_ENV,
  APP_NAME,
  foreignCheckoutProblem,
  isAppEntryPoint,
  isBlessedCheckout,
  storeBasename,
  storeIdentityProblem,
  storeLocationChosen,
  type AppCheckout,
} from "../lib/shell/app-identity";

describe("storeBasename", () => {
  it("splits a Windows path on a posix runner", () => {
    // The reason this is not `path.basename`. On Linux CI, `path.basename` on a
    // backslash path returns the whole string — so the one case that matters
    // would pass for the wrong reason and keep passing after a regression.
    expect(storeBasename("C:\\Users\\henri\\AppData\\Roaming\\orchestratedash")).toBe(
      "orchestratedash",
    );
    expect(storeBasename("C:\\Users\\henri\\AppData\\Roaming\\Electron")).toBe("Electron");
  });

  it("splits a posix path on a Windows runner", () => {
    expect(storeBasename("/home/henri/.config/orchestratedash")).toBe("orchestratedash");
  });

  it("ignores a trailing separator", () => {
    expect(storeBasename("C:\\Roaming\\orchestratedash\\")).toBe("orchestratedash");
    expect(storeBasename("/home/henri/.config/orchestratedash/")).toBe("orchestratedash");
  });

  it("has an answer for a path with no segments at all", () => {
    expect(storeBasename("")).toBe("");
    expect(storeBasename("/")).toBe("");
  });
});

/**
 * The identity check only applies to a store nobody chose, and there are two
 * ways to choose. Missing the second one would have crashed a capture harness
 * whose store was exactly where its operator put it — a real one was running in
 * a parallel worktree at the moment this was written, launched as
 * `--user-data-dir=…\dash-mar660-scratch-final\profile` with no `DASH_DATA_DIR`
 * at all.
 */
describe("storeLocationChosen", () => {
  it("counts DASH_DATA_DIR", () => {
    expect(storeLocationChosen({ DASH_DATA_DIR: "C:\\scratch" }, [])).toBe(true);
  });

  it("counts Electron's own --user-data-dir, in both spellings", () => {
    expect(
      storeLocationChosen({}, ["electron.exe", "--user-data-dir=C:\\scratch\\profile", "run.mjs"]),
    ).toBe(true);
    expect(storeLocationChosen({}, ["electron.exe", "--user-data-dir", "C:\\scratch"])).toBe(true);
  });

  it("is false for an ordinary launch, which is the case the check is for", () => {
    expect(storeLocationChosen({}, ["electron.exe", "C:\\repo"])).toBe(false);
    expect(storeLocationChosen({ DASH_DATA_DIR: undefined }, ["electron.exe"])).toBe(false);
  });

  it("is not fooled by a switch that merely starts the same way", () => {
    // `--user-data-dir-something` is not the switch, and neither is a path that
    // happens to mention it.
    expect(storeLocationChosen({}, ["electron.exe", "C:\\repo\\--user-data-dir\\main.mjs"])).toBe(
      false,
    );
  });
});

describe("storeIdentityProblem", () => {
  it("passes the real store on either platform", () => {
    expect(
      storeIdentityProblem(`C:\\Users\\henri\\AppData\\Roaming\\${APP_NAME}`, APP_NAME),
    ).toBeNull();
    expect(storeIdentityProblem(`/home/henri/.config/${APP_NAME}`, APP_NAME)).toBeNull();
  });

  it("catches the phantom store, which the equality check could not", () => {
    // Both arguments are consistent with each other — this *is* what the running
    // process believed about itself — and it is still wrong.
    const problem = storeIdentityProblem("C:\\Users\\henri\\AppData\\Roaming\\Electron", "Electron");
    expect(problem).not.toBeNull();
    // The message has to teach the mechanism. `%APPDATA%\Electron` looks like a
    // stray directory until you know `userData` is `<appData>/<app name>`, and
    // nobody should have to rediscover that the way it was discovered.
    expect(problem).toContain("Electron");
    expect(problem).toContain("app.setName");
  });

  it("is not fooled by a directory that merely contains the name", () => {
    expect(
      storeIdentityProblem(`C:\\Roaming\\${APP_NAME}-backup`, APP_NAME),
    ).not.toBeNull();
    expect(
      storeIdentityProblem(`C:\\Roaming\\${APP_NAME}\\quarantine`, APP_NAME),
    ).not.toBeNull();
  });
});

/**
 * MAR-676: the same trap as the phantom store, reached from the other side.
 *
 * `storeIdentityProblem` above catches a process that is **not** DASH opening a
 * store that is not DASH's. This catches a process that has DASH's identity
 * legitimately — every checkout of this repository does, because they all carry
 * the same package.json — and has no business opening the installed store with
 * it. On 2026-08-16 a worktree build of the MAR-643 branch ran its own migration
 * 24 over Henrik's real store, and nothing anywhere asked whether it should.
 */
const worktree: AppCheckout = {
  app_path: "C:\\Users\\henri\\Desktop\\projekt\\MCP\\dash-mar643",
  packaged: false,
  git_entry: "file",
};
const mainCheckout: AppCheckout = {
  app_path: "C:\\Users\\henri\\Desktop\\projekt\\MCP\\orchestratedash",
  packaged: false,
  git_entry: "directory",
};
const installed: AppCheckout = {
  app_path: "C:\\Program Files\\WindowsApps\\orchestratedash\\resources\\app",
  packaged: true,
  git_entry: "absent",
};
const store = `C:\\Users\\henri\\AppData\\Roaming\\${APP_NAME}`;

describe("isBlessedCheckout", () => {
  it("blesses the packaged app, which is the thing the store belongs to", () => {
    expect(isBlessedCheckout(installed)).toBe(true);
    // And it stays blessed with no git anywhere near it, which is the ordinary
    // state of an install.
    expect(isBlessedCheckout({ ...installed, git_entry: "absent" })).toBe(true);
  });

  it("blesses the main working tree, whose .git is a directory", () => {
    expect(isBlessedCheckout(mainCheckout)).toBe(true);
  });

  it("refuses a linked worktree, whose .git is a file", () => {
    // This is how git itself distinguishes the two, which is why it is the test
    // rather than a marker file somebody has to create and remember.
    expect(isBlessedCheckout(worktree)).toBe(false);
  });

  it("refuses a tree with no git at all", () => {
    // A copied or exported tree cannot show it is the checkout the store belongs
    // to, and on a page about somebody's real data the reassuring answer is the
    // wrong one.
    expect(isBlessedCheckout({ ...mainCheckout, git_entry: "absent" })).toBe(false);
  });
});

describe("foreignCheckoutProblem", () => {
  it("lets the main checkout and the install through", () => {
    expect(foreignCheckoutProblem(mainCheckout, store, {})).toBeNull();
    expect(foreignCheckoutProblem(installed, store, {})).toBeNull();
  });

  it("refuses a worktree launch and names all three remedies", () => {
    const problem = foreignCheckoutProblem(worktree, store, {});
    expect(problem).not.toBeNull();
    // The person reading this is mid-task with three legitimate intentions, and a
    // refusal that names the rule without naming which switch belongs to which
    // intention is a refusal they have to go and read the source to act on.
    expect(problem).toContain("DASH_DATA_DIR");
    expect(problem).toContain(ALLOW_INSTALLED_STORE_ENV);
    expect(problem).toContain("main checkout");
    // And it names both paths, because "a worktree" and "the real store" are the
    // two facts that make the sentence true.
    expect(problem).toContain(worktree.app_path);
    expect(problem).toContain(store);
  });

  it("stands aside when somebody says they mean it", () => {
    // The escape MAR-676's own repair needs: the store it repairs is the only
    // store with the shape it repairs, so reproducing it means opening the real
    // one on purpose.
    expect(foreignCheckoutProblem(worktree, store, { [ALLOW_INSTALLED_STORE_ENV]: "1" })).toBeNull();
    // Set to anything, including empty: this is a switch somebody typed, and
    // reading its *value* would invent a second rule nobody was told about.
    expect(foreignCheckoutProblem(worktree, store, { [ALLOW_INSTALLED_STORE_ENV]: "" })).toBeNull();
  });

  it("says which of the two refusals it is", () => {
    expect(foreignCheckoutProblem(worktree, store, {})).toContain("linked git worktree");
    expect(foreignCheckoutProblem({ ...worktree, git_entry: "absent" }, store, {})).toContain(
      "not a git working tree",
    );
  });
});

/**
 * The guard's scope, which is the same question `app.setName` asks.
 *
 * `electron/data-dir.ts` applies the checkout guard only to an app-directory
 * launch, because that is the form that reads a package.json and takes the name
 * `orchestratedash` from it. The smoke and a dozen capture harnesses are launched
 * as a file and must stay outside it — the smoke's third acceptance criterion
 * (MAR-424) is that it writes to the *real* user-data directory, deliberately.
 */
describe("the checkout guard's scope", () => {
  it("covers the app entry point and not the proof harnesses beside it", () => {
    expect(isAppEntryPoint("C:\\repo\\dist\\electron\\main.mjs")).toBe(true);
    expect(isAppEntryPoint("C:\\repo\\dist\\electron\\smoke.mjs")).toBe(false);
    expect(isAppEntryPoint("C:\\repo\\dist\\electron\\capture-fleet-views.mjs")).toBe(false);
  });
});
