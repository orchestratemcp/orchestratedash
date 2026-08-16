/**
 * No hook may be declared after an early return (MAR-648).
 *
 * ## The bug that earned this file
 *
 * MAR-648 added one `useRef` to `app/agents/detail/page.tsx` and put it beside
 * the value it belongs with, three hundred lines down — which is after that
 * component's three early returns for loading, failed and not-found. So the
 * first render of the page ran one fewer hook than the second, and React threw
 * *"Rendered more hooks than during the previous render"* the moment a view
 * arrived over IPC. The agent page was a Next error boundary in the packaged
 * app, on every stage.
 *
 * **Nothing in this repository could see it.** `pnpm typecheck` was clean,
 * `pnpm brand:check` was green, and all 190 test files passed — because every
 * render test here is `renderToStaticMarkup`, which renders once. A hook count
 * that changes *between two renders* is invisible to a single render by
 * construction, so no amount of component testing in this style would ever have
 * caught it. Two capture harnesses photographing the error page did.
 *
 * ## Why a source scan rather than a lint rule
 *
 * `react-hooks/rules-of-hooks` is exactly this check and DASH does not run
 * ESLint in `pnpm verify`. Adding it would be the right long-term answer and a
 * much larger change than this issue; this is the narrow version that fails for
 * the same reason, in a gate that already runs, and it is written to be deleted
 * the day the lint rule lands.
 *
 * ## What it looks at
 *
 * Every `"use client"` component file under `app/`. Within each top-level
 * function body it walks lines in order and remembers the first unindented-ish
 * `return` — the shape of a guard clause at the top level of a component — then
 * fails any `useX(` declared after it.
 *
 * Deliberately crude, and it errs towards silence rather than towards noise: it
 * is not a parser and it does not try to be. What it catches is the exact shape
 * that shipped, which is a hook sitting far below a guard nobody re-read.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

/**
 * Every `.tsx` under a directory, recursively.
 *
 * `readdirSync` rather than a glob dependency, which is what
 * `tests/broker-channel-exclusion.test.ts` already does for the same job —
 * this repository has no glob helper in its test dependencies and adding one
 * for a walk this small would be a dependency to explain.
 */
function tsxFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...tsxFiles(full));
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * A hook call being *declared*, not a type or a comment.
 *
 * Anchored to an assignment or a bare call at the start of a statement, so
 * `useRef<AgentStage | null>(null)` inside a prop's docblock — this file's own
 * subject matter is full of those — is not a finding.
 */
const HOOK = /^\s{2}(?:const|let|var)?\s*(?:\[[^\]]*\]|\{[^}]*\}|\w+)?\s*=?\s*(use[A-Z]\w*)\s*[(<]/;

/**
 * A guard clause, in the two shapes a component actually uses.
 *
 * `BARE_RETURN` is `  return …` at the top level of the body. `IF_OPEN` /
 * `IF_RETURN` / `BLOCK_CLOSE` together are the commoner one and the one that
 * shipped the bug — a top-level `if (…) {` whose body returns:
 *
 *     if (state.status === "loading") {
 *       return <ViewLoading />;
 *     }
 *
 * The first version of this file only had `BARE_RETURN`, so it matched nothing
 * in `app/agents/detail/page.tsx` — whose three guards are all of the second
 * shape — and went green against the very source it was written from. A gate
 * that passes the bug it was written for is worse than no gate, which is why
 * the rule below is now tested against that source directly.
 */
const BARE_RETURN = /^\s{2}return\b/;
const IF_OPEN = /^\s{2}if\s*\(/;
const IF_RETURN = /^\s{4}return\b/;
const BLOCK_CLOSE = /^\s{2}\}/;

/**
 * The start of a new top-level function, which resets the walk.
 *
 * `default` is in the alternation because leaving it out is a false positive
 * with teeth: `export default function HostsPage()` is how every page component
 * in `app/` is declared, so a pattern without it never resets at a page
 * boundary and reports the page's own hooks as sitting after a `return`
 * belonging to some helper defined above it.
 */
const FUNCTION_START = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+\w+/;

function offenders(source: string): string[] {
  // Normalised at the read. A regex anchored with `^` under `m` is CRLF-blind
  // only where the pattern ends in `\n`; these do not, but the file is read
  // once and split here, so the line endings are gone before any of it runs.
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const found: string[] = [];
  let guardedAt: number | null = null;
  let insideTopLevelIf = false;

  lines.forEach((line, index) => {
    if (FUNCTION_START.test(line)) {
      guardedAt = null;
      insideTopLevelIf = false;
      return;
    }
    if (IF_OPEN.test(line)) {
      insideTopLevelIf = true;
      return;
    }
    if (BLOCK_CLOSE.test(line)) {
      insideTopLevelIf = false;
      return;
    }
    if (guardedAt === null && (BARE_RETURN.test(line) || (insideTopLevelIf && IF_RETURN.test(line)))) {
      guardedAt = index + 1;
      return;
    }
    const hook = HOOK.exec(line);
    if (hook !== null && guardedAt !== null) {
      found.push(
        `line ${String(index + 1)}: ${String(hook[1])} is declared after the return on line ${String(guardedAt)}`,
      );
    }
  });
  return found;
}

/*
 * The rule, tested in both directions, which is the standard
 * `tests/copy-identifiers.test.ts` sets and states the reason for: *"a detector
 * that nothing tests is a detector that can quietly stop detecting, at which
 * point every surface asserting against it passes for the wrong reason — the
 * worst failure mode available to this design, because it is silent and it is
 * green."*
 */
describe("the rule itself", () => {
  it("catches the shape that shipped", () => {
    // MAR-648's own bug, reduced: a guard, then a hook.
    const source = [
      "function AgentWorkspace(): ReactNode {",
      "  const [state] = useState(0);",
      '  if (state.status === "loading") {',
      "    return <ViewLoading />;",
      "  }",
      "  const returnStage = useRef<AgentStage | null>(null);",
      "  return <div />;",
      "}",
    ].join("\n");
    expect(offenders(source)).toEqual([
      "line 6: useRef is declared after the return on line 4",
    ]);
  });

  it("passes the same component with the hook moved up", () => {
    const source = [
      "function AgentWorkspace(): ReactNode {",
      "  const [state] = useState(0);",
      "  const returnStage = useRef<AgentStage | null>(null);",
      '  if (state.status === "loading") {',
      "    return <ViewLoading />;",
      "  }",
      "  return <div />;",
      "}",
    ].join("\n");
    expect(offenders(source)).toEqual([]);
  });

  it("does not carry a helper's return into the next function", () => {
    const source = [
      "function Helper(): ReactNode {",
      "  return <p />;",
      "}",
      "export default function Page(): ReactNode {",
      "  const [value] = useState(0);",
      "  return <div />;",
      "}",
    ].join("\n");
    expect(offenders(source)).toEqual([]);
  });

  it("reads a hook name in a docblock as prose, not as a declaration", () => {
    // This file's own subject matter is full of these, and a gate that failed
    // on a comment about the thing it checks would be unusable in the file that
    // documents it.
    const source = [
      "function Page(): ReactNode {",
      "  return <div />;",
      "}",
      "/** See useRef(null) above, and useState<AgentStage>(x). */",
    ].join("\n");
    expect(offenders(source)).toEqual([]);
  });
});

describe("hooks are declared before any early return", () => {
  const files = tsxFiles(path.join(ROOT, "app"))
    .map((full) => ({
      relative: path.relative(ROOT, full).split(path.sep).join("/"),
      source: readFileSync(full, "utf8"),
    }))
    .filter((file) => file.source.startsWith('"use client"'));

  it("finds client components to check", () => {
    // The guard on the guard. A glob that stopped matching would make every
    // assertion below pass over an empty set, which is the failure mode this
    // whole file exists to complain about.
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file.relative} declares every hook before its first guard`, () => {
      expect(offenders(file.source), file.relative).toEqual([]);
    });
  }
});
