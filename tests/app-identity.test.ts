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
  APP_NAME,
  storeBasename,
  storeIdentityProblem,
  storeLocationChosen,
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
