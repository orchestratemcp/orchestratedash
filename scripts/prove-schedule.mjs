/**
 * Run MAR-742 item 8's acceptance proof (ADR 0029).
 *
 *     node scripts/prove-schedule.mjs
 *
 * Deliberately **not** a `package.json` script, `scripts/prove-google.mjs`'
 * reason: every entry in that file is a thing somebody can wire into a pipeline
 * by pasting a name, and this one takes two minutes of real wall-clock time
 * because waiting for a real window to come round is the whole content of it.
 *
 * ## Why it builds first
 *
 * The proof is TypeScript that imports the real store, the real schedule module
 * and the real view builder, and it spawns the real runner. Both are bundled
 * here, into `dist/`, so the proof cannot drift from the code it is a proof
 * about — `scripts/prove-google.mjs`' argument, unchanged.
 *
 * `pnpm verify` never runs this file, and `tsconfig.json` includes
 * `scripts/schedule-proof` so the source is typechecked. That is the intended
 * split: a proof that rots silently between runs would be worse than none, and
 * typechecking a file is not executing it.
 *
 * ## It touches only its own scratch directory
 *
 * The harness `mkdtemp`s a data directory and sets `DASH_DATA_DIR` to it before
 * anything opens a store. It never resolves the installed `dash.sqlite`, and it
 * is safe to run beside a live DASH — the runner it spawns has its own data
 * directory, so it publishes its own endpoint and cannot be confused with the
 * one DASH is talking to.
 */

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist", "schedule-proof");
mkdirSync(outDir, { recursive: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  // The runner reads its own build id through this define in the shell build.
  // Nothing in this proof asserts on it, so a placeholder is honest: it says
  // "this runner was not built by the shell build" rather than claiming a
  // provenance it does not have.
  define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify("schedule-proof") },
};

const runnerOut = path.join(outDir, "runner.mjs");
const proofOut = path.join(outDir, "main.mjs");

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "runner", "main.ts")],
    outfile: runnerOut,
  }),
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "scripts", "schedule-proof", "main.ts")],
    outfile: proofOut,
  }),
]);

const result = spawnSync(process.execPath, [proofOut], {
  stdio: "inherit",
  env: { ...process.env, DASH_PROOF_RUNNER: runnerOut },
});

process.exit(result.status ?? 1);
