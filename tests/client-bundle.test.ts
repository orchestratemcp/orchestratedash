/**
 * What a rendered page may import (MAR-434).
 *
 * `app/_components/outputs.tsx` shipped for several hours with a *value* import
 * of `isDigestArtifact` from `lib/contracts.ts`. That module reads the JSON
 * schemas off disk, so pulling a function out of it into a `"use client"` tree
 * drags `node:fs` into the browser bundle, and the run detail page answered 500:
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs)
 *
 * Nothing caught it. `tsc` is happy — the import is type-correct. The unit
 * tests are happy — they render through `react-dom/server`, where `node:fs` is
 * simply available and no bundler is involved. The full suite passed, 1245
 * tests, on a page that could not load at all.
 *
 * That is the gap this file closes, and the rule it enforces is narrow on
 * purpose: **a component may import types from a Node-only module, and may not
 * import values from one.** Types erase; functions do not. Route handlers under
 * `app/api/` are exempt because they run on the server in the developer build
 * and are absent from the packaged export entirely (see `next.config.mjs`).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(repoRoot, "app");

/**
 * Modules that touch the filesystem or the database, directly or through one
 * hop. Importing a *value* from any of these puts a Node builtin in the bundle.
 */
const NODE_ONLY = ["lib/contracts", "lib/store", "lib/db", "lib/insights", "lib/views/build"];

function componentFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route handlers are server-only by construction and are stripped from
      // the static export, so the rule does not apply to them.
      if (entry === "api") {
        continue;
      }
      found.push(...componentFiles(full));
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Every import statement in a file, as `{ typeOnly, from }`.
 *
 * A deliberately small parser rather than a real one: the shapes in this
 * codebase are `import { … } from "…"`, `import type { … } from "…"` and
 * `import X from "…"`, and a regex that understands those three is easier to
 * trust than a dependency.
 */
function importsOf(source: string): Array<{ typeOnly: boolean; from: string }> {
  const pattern = /import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;
  const found: Array<{ typeOnly: boolean; from: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const clause = match[2] ?? "";
    // `import { type A, type B }` is also fully erased.
    const everyMemberTyped =
      clause.trim().startsWith("{") &&
      clause
        .replace(/[{}]/g, "")
        .split(",")
        .filter((part) => part.trim() !== "")
        .every((part) => part.trim().startsWith("type "));
    found.push({
      typeOnly: match[1] !== undefined || everyMemberTyped,
      from: match[3] ?? "",
    });
  }
  return found;
}

describe("a rendered component never pulls a Node builtin into the bundle", () => {
  const files = componentFiles(appDir);

  it("finds components to check", () => {
    // A guard whose glob silently matched nothing would pass forever.
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(NODE_ONLY)("imports no value from %s", (moduleName) => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const entry of importsOf(readFileSync(file, "utf8"))) {
        if (entry.typeOnly) {
          continue;
        }
        // Relative specifiers are resolved against the importing file, so
        // `../../lib/contracts` and `../contracts` both land on `lib/contracts`.
        const resolved = entry.from.startsWith(".")
          ? path.relative(repoRoot, path.resolve(path.dirname(file), entry.from)).replace(/\\/g, "/")
          : entry.from;
        if (resolved === moduleName) {
          offenders.push(
            `${path.relative(repoRoot, file).replace(/\\/g, "/")} imports ${entry.from}`,
          );
        }
      }
    }

    expect(
      offenders,
      `${moduleName} reads from disk or the database. Import its types with ` +
        "`import type`, which erases, or move the value you need into a pure module.",
    ).toEqual([]);
  });
});
