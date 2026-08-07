/**
 * What `pnpm shell` refuses to launch against.
 *
 * The rules are in `lib/shell/preflight.ts` and are pure precisely so that they
 * can be checked here rather than by starting Electron and looking. Each
 * refusal is asserted for its *own* sentence, not merely for being a refusal:
 * three failures that all say "something is wrong" are one failure with three
 * spellings, and the whole reason these are separate cases is that they send the
 * reader somewhere different.
 */

import { describe, expect, it } from "vitest";

import {
  RENDERER_TITLE,
  judgeDeveloperTarget,
  judgePackagedTarget,
  resolveShellTarget,
} from "../lib/shell/preflight";

const ORIGIN = "http://127.0.0.1:3000";

describe("which renderer a launch will load", () => {
  it("defaults to the loopback dev server, as electron/main.ts does", () => {
    expect(resolveShellTarget(undefined)).toEqual({ kind: "developer", origin: ORIGIN });
  });

  it("treats the app's own scheme as the packaged renderer", () => {
    expect(resolveShellTarget("dash-app://ui/")).toEqual({
      kind: "packaged",
      url: "dash-app://ui/",
    });
  });

  it("treats any other override as a developer origin", () => {
    // `isAllowedRendererUrl` is what decides whether it may be loaded at all;
    // this only decides which set of checks apply to it.
    expect(resolveShellTarget("http://[::1]:4000")).toEqual({
      kind: "developer",
      origin: "http://[::1]:4000",
    });
  });
});

describe("the developer origin", () => {
  it("launches when this repository's dev server answers", () => {
    const verdict = judgeDeveloperTarget(ORIGIN, {
      status: 200,
      title: RENDERER_TITLE,
      error: null,
    });
    expect(verdict.ok).toBe(true);
  });

  it("refuses when nothing is listening, and names the command that fixes it", () => {
    const verdict = judgeDeveloperTarget(ORIGIN, {
      status: null,
      title: null,
      error: "fetch failed",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.next_action).toContain("pnpm dev");
  });

  it("refuses when something else owns the port, and says so rather than blaming the dev server", () => {
    const verdict = judgeDeveloperTarget(ORIGIN, {
      status: 200,
      title: "OrchestrateLab",
      error: null,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.headline).toContain("not DASH");
    expect(verdict.meaning).toContain("OrchestrateLab");
    // The point of this case: it must not tell the reader to start a dev server
    // they have already started.
    expect(verdict.next_action).not.toContain("pnpm dev`");
  });

  it("refuses an error status separately from an absent server", () => {
    const nothing = judgeDeveloperTarget(ORIGIN, { status: null, title: null, error: "x" });
    const broken = judgeDeveloperTarget(ORIGIN, { status: 500, title: null, error: null });
    expect(broken.ok).toBe(false);
    // Three refusals, three next actions. A collapse into one would be the
    // failure `lib/copy/recovery.ts` argues against for credentials.
    expect(broken.next_action).not.toBe(nothing.next_action);
  });

  it("treats a page with no title at all as not DASH", () => {
    const verdict = judgeDeveloperTarget(ORIGIN, { status: 200, title: null, error: null });
    expect(verdict.ok).toBe(false);
    expect(verdict.meaning).toContain("nothing at all");
  });
});

describe("the packaged renderer", () => {
  const built = 2_000;
  const older = 1_000;
  const newer = 3_000;

  it("launches when the export is newer than everything it is built from", () => {
    expect(
      judgePackagedTarget({
        entry_exists: true,
        exported_at: built,
        newest_source: "app/page.tsx",
        newest_source_at: older,
      }).ok,
    ).toBe(true);
  });

  it("refuses when there is no export at all", () => {
    const verdict = judgePackagedTarget({
      entry_exists: false,
      exported_at: null,
      newest_source: "app/page.tsx",
      newest_source_at: newer,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.next_action).toContain("pnpm build:renderer");
  });

  /**
   * The pairing this whole module exists for: `pnpm build:shell` has just
   * rebuilt main and the preload from the working tree, so an export older than
   * a source file means new shell, old screens.
   */
  it("refuses a fresh shell paired with a stale export, and names the file that made it stale", () => {
    const verdict = judgePackagedTarget({
      entry_exists: true,
      exported_at: built,
      newest_source: "app/_components/outputs.tsx",
      newest_source_at: newer,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.meaning).toContain("app/_components/outputs.tsx");
    expect(verdict.next_action).toContain("pnpm build:renderer");
  });

  /**
   * A judgment it must decline to make. `dist/electron/renderer/` is a copy and
   * carries the copy's timestamp, so when the real export is gone there is
   * nothing to compare and guessing would produce a refusal nobody can act on.
   */
  it("does not claim staleness it cannot observe", () => {
    expect(
      judgePackagedTarget({
        entry_exists: true,
        exported_at: null,
        newest_source: "app/page.tsx",
        newest_source_at: newer,
      }).ok,
    ).toBe(true);
  });
});
