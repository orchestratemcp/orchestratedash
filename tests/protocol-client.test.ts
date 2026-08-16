/**
 * Who may claim the `dash://` scheme.
 *
 * A regression test for a bug that cost a real registration on a real machine:
 * `registerProtocolClient` registered `process.argv[1]`, and `electron/smoke.ts`
 * imports `main.ts` — so running `pnpm shell:smoke` pointed Windows at
 * `dist/electron/smoke.mjs`. Clicking a handoff link then launched the proof
 * harness, which ran its proofs and called `app.exit()`, so the link appeared to
 * do nothing and MAR-428's zero-file-picker flow was silently broken.
 *
 * The check is tested rather than the Electron call because the call is
 * `app.setAsDefaultProtocolClient`, which needs a real app and a real registry.
 * What can be decided in a test is which entry points are allowed to make it,
 * and that is the decision the bug got wrong.
 */

import { describe, expect, it } from "vitest";

// Moved out of `electron/handoff-host.ts` by MAR-656: the same predicate now
// also decides who may claim the app's *name*, and the two answers must not be
// allowed to differ. `electron/data-dir.ts` is the second caller.
import { appDirectoryFor, isAppEntryPoint } from "../lib/shell/app-identity";

describe("isAppEntryPoint", () => {
  it("accepts the app's own entry point", () => {
    expect(isAppEntryPoint("C:\\repo\\dist\\electron\\main.mjs")).toBe(true);
    expect(isAppEntryPoint("/repo/dist/electron/main.mjs")).toBe(true);
    // The unbundled name, for a run that has not been through esbuild.
    expect(isAppEntryPoint("/repo/dist/electron/main.js")).toBe(true);
  });

  it("refuses the smoke harness, which is the case that broke a machine", () => {
    // Same directory, one character of difference, and the whole handoff flow
    // hangs on it.
    expect(isAppEntryPoint("C:\\repo\\dist\\electron\\smoke.mjs")).toBe(false);
    expect(isAppEntryPoint("/repo/dist/electron/smoke.mjs")).toBe(false);
  });

  it("refuses anything else that happens to import main", () => {
    for (const entry of [
      "/repo/dist/electron/runner.mjs",
      "/repo/scripts/build-shell.mjs",
      "/repo/dist/electron/agent-kit/open-in-dash.mjs",
      "",
    ]) {
      expect(isAppEntryPoint(entry)).toBe(false);
    }
  });

  /**
   * The MAR-656 half. The same predicate gates `app.setName`, and a dozen
   * capture harnesses import `main.ts` while relying on **not** being
   * `orchestratedash` — that is what lets them photograph DASH beside a live
   * one instead of losing the single-instance lock to it.
   * `electron/capture-settings-polish.ts` states the bargain; this holds it.
   */
  it("refuses every capture harness, which must keep its own identity", () => {
    for (const entry of [
      "C:\\repo\\dist\\electron\\capture.mjs",
      "C:\\repo\\dist\\electron\\capture-deploy.mjs",
      "C:\\repo\\dist\\electron\\capture-settings-polish.mjs",
      "C:\\repo\\dist\\electron\\capture-connectors.mjs",
      "C:\\repo\\dist\\electron\\first-paint.mjs",
    ]) {
      expect(isAppEntryPoint(entry)).toBe(false);
    }
  });

  /**
   * `electron .` — how a person actually launches DASH — is not matched, and
   * does not need to be: Electron reads the name from that directory's
   * package.json, which is where `orchestratedash` came from in the first place.
   */
  it("does not match an app directory, which needs no help", () => {
    expect(isAppEntryPoint("C:\\Users\\henri\\Desktop\\projekt\\MCP\\orchestratedash")).toBe(false);
    expect(isAppEntryPoint(".")).toBe(false);
  });

  it("does not match a directory that merely contains the name", () => {
    // Guards against a check written on `includes` rather than the basename.
    expect(isAppEntryPoint("/repo/main.mjs/smoke.mjs")).toBe(false);
  });
});

/**
 * What the registration points at (MAR-656).
 *
 * The scheme was registered as `electron.exe <repo>\dist\electron\main.mjs %1`,
 * and Electron reads the app name from the package.json of an app *directory*.
 * Given a bare script it has none, runs as `Electron`, and puts `userData` at
 * `%APPDATA%\Electron` — a second store with its own agents and its own runner,
 * which the single-instance lock could not collide with because the lock is
 * keyed on `userData`.
 *
 * `app.setName` in `electron/data-dir.ts` is the fix that had to exist, because
 * identity must not depend on the launch command. This is the other half: the
 * handler now launches DASH the way a person does, so there is no second form
 * left to get wrong.
 */
describe("appDirectoryFor", () => {
  it("strips the entry point off a Windows path", () => {
    expect(appDirectoryFor("C:\\repo\\dist\\electron\\main.mjs")).toBe("C:\\repo");
  });

  it("strips the entry point off a posix path", () => {
    expect(appDirectoryFor("/repo/dist/electron/main.mjs")).toBe("/repo");
    // The unbundled name, for a run that has not been through esbuild.
    expect(appDirectoryFor("/repo/dist/electron/main.js")).toBe("/repo");
  });

  it("keeps a repo path that itself contains the tail's words", () => {
    expect(appDirectoryFor("C:\\dist\\electron\\dash\\dist\\electron\\main.mjs")).toBe(
      "C:\\dist\\electron\\dash",
    );
  });

  it("refuses rather than guesses when the tail is not there", () => {
    // A wrong directory is worse than no registration: nothing is a visible
    // failure, and a directory Electron cannot boot is a blank window.
    for (const entry of [
      "/repo/dist/electron/smoke.mjs",
      "/repo/dist/electron/runner.mjs",
      "/repo/electron/main.mjs",
      "main.mjs",
      "",
    ]) {
      expect(appDirectoryFor(entry)).toBeNull();
    }
  });

  it("refuses an entry with nothing in front of the tail", () => {
    // Slicing here would yield "", and registering an empty app directory is
    // how you get an app that launches into the current working directory.
    expect(appDirectoryFor("/dist/electron/main.mjs")).toBeNull();
  });
});
