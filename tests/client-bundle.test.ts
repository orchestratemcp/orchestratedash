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
 * Modules that touch a Node builtin, directly or through any number of hops.
 *
 * **This used to be five strings somebody typed** — `lib/contracts`, `lib/store`,
 * `lib/db`, `lib/insights`, `lib/views/build` — and MAR-498 walked straight past
 * it. The connect-a-server wizard imported `describeDeployReceipt` from
 * `lib/deploy/bundle.ts`, which imports `node:crypto` to hash bundle files, and
 * the packaged renderer stopped hydrating altogether: every page drew its
 * background colour and nothing else, no chrome, no agents, no error on screen.
 * The full suite passed, including this file, because `lib/deploy/bundle` was
 * not on the list.
 *
 * So the list is computed. `lib/` is walked once, every module that imports a
 * `node:` builtin is marked, and the mark is propagated up the import graph
 * until it stops moving. A module added tomorrow that reads from disk is on the
 * list the moment it is written, which is the only version of this guard that
 * keeps working without being remembered.
 *
 * The five original names are kept below as a floor — see the test that asserts
 * they are still found. A graph walk that broke and returned an empty set would
 * otherwise pass this file forever, which is precisely the failure being fixed.
 */
const KNOWN_NODE_ONLY = [
  "lib/contracts",
  "lib/store",
  "lib/db",
  "lib/insights",
  "lib/views/build",
  // Added by the defect above, and named here so it cannot quietly leave.
  "lib/deploy/bundle",
];

const libDir = path.join(repoRoot, "lib");

/** Every `.ts` under `lib/`, as repo-relative specifiers without the extension. */
function libModules(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...libModules(full));
    } else if (entry.endsWith(".ts")) {
      found.push(path.relative(repoRoot, full).replace(/\\/g, "/").replace(/\.ts$/, ""));
    }
  }
  return found;
}

/**
 * The transitive closure of "imports a Node builtin".
 *
 * Type-only imports are ignored here for the same reason they are ignored at the
 * component boundary: they erase, so a module whose only link to `node:fs` is a
 * type is not a module that puts `node:fs` in a bundle.
 */
function nodeOnlyModules(): Set<string> {
  const modules = libModules(libDir);
  const sources = new Map<string, ReturnType<typeof importsOf>>();
  const marked = new Set<string>();

  for (const name of modules) {
    const imports = importsOf(readFileSync(path.join(repoRoot, `${name}.ts`), "utf8"));
    sources.set(name, imports);
    if (imports.some((entry) => !entry.typeOnly && entry.from.startsWith("node:"))) {
      marked.add(name);
    }
  }

  // Propagate until nothing moves. The graph is a few hundred edges; a fixed
  // point is cheaper to read than a topological sort and cannot be defeated by
  // a cycle.
  let moved = true;
  while (moved) {
    moved = false;
    for (const [name, imports] of sources) {
      if (marked.has(name)) {
        continue;
      }
      for (const entry of imports) {
        if (entry.typeOnly || !entry.from.startsWith(".")) {
          continue;
        }
        const resolved = path
          .relative(repoRoot, path.resolve(path.dirname(path.join(repoRoot, name)), entry.from))
          .replace(/\\/g, "/");
        if (marked.has(resolved)) {
          marked.add(name);
          moved = true;
          break;
        }
      }
    }
  }

  return marked;
}

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

describe("the Node-only set is computed rather than remembered", () => {
  const marked = nodeOnlyModules();

  it("finds the modules the old hand-written list named", () => {
    /*
     * The floor. A graph walk that broke and returned an empty set would make
     * every assertion below pass by checking nothing — which is exactly the
     * shape of failure this rewrite exists to fix, arriving through a different
     * door.
     */
    for (const known of KNOWN_NODE_ONLY) {
      expect([...marked], `${known} must still be found`).toContain(known);
    }
  });

  it("follows an import through more than one hop", () => {
    // `lib/views/build` was on the old list because somebody knew it reaches the
    // store. Nothing in it names a `node:` builtin directly, so it is only here
    // if the propagation actually ran.
    expect([...marked]).toContain("lib/views/build");
  });

  it("does not mark a module whose only Node link is a type", () => {
    // `lib/connection-card.ts` imports its view types from `lib/views/types`,
    // which is pure, and nothing else. A walk that ignored `import type` would
    // sweep half of `lib/` in and make the guard useless by being too loud.
    expect([...marked]).not.toContain("lib/connection-card");
    expect([...marked]).not.toContain("lib/copy/when");
    expect([...marked]).not.toContain("lib/deploy/receipt");
  });
});

describe("a rendered component never pulls a Node builtin into the bundle", () => {
  const files = componentFiles(appDir);
  const marked = nodeOnlyModules();

  it("finds components to check", () => {
    // A guard whose glob silently matched nothing would pass forever.
    expect(files.length).toBeGreaterThan(5);
  });

  it("imports no value from any module that reaches a Node builtin", () => {
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
        if (marked.has(resolved) || entry.from.startsWith("node:")) {
          offenders.push(
            `${path.relative(repoRoot, file).replace(/\\/g, "/")} imports ${entry.from}`,
          );
        }
      }
    }

    expect(
      offenders,
      "these modules reach a Node builtin. Import their types with `import type`, " +
        "which erases, or move the value you need into a pure module — " +
        "`lib/deploy/receipt.ts` is what that looks like.",
    ).toEqual([]);
  });
});
