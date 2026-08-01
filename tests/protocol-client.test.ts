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

import { isAppEntryPoint } from "../electron/handoff-host";

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

  it("does not match a directory that merely contains the name", () => {
    // Guards against a check written on `includes` rather than the basename.
    expect(isAppEntryPoint("/repo/main.mjs/smoke.mjs")).toBe(false);
  });
});
