/**
 * Nothing bundled into `main.mjs` may reach for `__dirname`.
 *
 * A regression test for a bug that made the Connection Center unusable without
 * ever failing loudly: `electron/credential-prompt.ts` resolved its preload with
 * `path.join(__dirname, "credential-preload.js")`. That file is bundled into
 * `main.mjs`, which is ESM — `__dirname` does not exist there — so opening the
 * prompt threw a `ReferenceError` before the window was constructed. The caller
 * was left awaiting a promise that could never settle, so every attempt to
 * connect an account hung with no window and no error on screen.
 *
 * It survived because the throw happens inside a `new Promise` executor whose
 * rejection nothing observed, and because the shell's OAuth proofs had never
 * been executed on a machine — they could not have passed.
 *
 * A source assertion rather than a behavioural one: reproducing it needs a real
 * Electron main process opening a real window, which is what the shell smoke
 * does. What a test can hold cheaply is the rule the file broke, and the rule is
 * the thing that generalises to the next file someone adds.
 *
 * See `electron/README.md`, which already documents that `main.mjs` is ESM and
 * that `import.meta.url` is how a path beside the bundle resolves on Windows.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.join(import.meta.dirname, "..");
const electronDir = path.join(repoRoot, "electron");

/**
 * The `.ts` sources under `electron/`, which is exactly the set that
 * `scripts/build-shell.mjs` turns into ESM bundles. `.js` preloads are excluded
 * deliberately: they are built as CommonJS for the sandbox, where `__dirname` is
 * real. See the table in `electron/README.md`.
 */
function electronSources(): string[] {
  return readdirSync(electronDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
}

describe("the ESM shell bundles", () => {
  it("has sources to check, so a rename cannot quietly empty this test", () => {
    expect(electronSources().length).toBeGreaterThan(5);
  });

  it("never references __dirname or __filename", () => {
    const offenders: string[] = [];
    for (const name of electronSources()) {
      const source = readFileSync(path.join(electronDir, name), "utf8");
      // Word boundaries, so a mention inside a comment explaining the rule does
      // not count as breaking it.
      for (const identifier of ["__dirname", "__filename"]) {
        if (new RegExp(`(?<![\\w"'\`])${identifier}\\b(?![\\w"'\`])`).test(stripComments(source))) {
          offenders.push(`${name}: ${identifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * Comments removed before the check, because the fix for this bug leaves an
 * explanation of `__dirname` sitting in the file it was removed from, and a test
 * that failed on its own documentation would be deleted rather than obeyed.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
