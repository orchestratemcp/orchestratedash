/**
 * Run MAR-784's acceptance proof (ADR 0029 amendment 1).
 *
 *     node scripts/prove-schedule-spend.mjs
 *
 * With a real key, which is the mode that proves the whole sentence:
 *
 *     $env:DASH_PROOF_MODEL_KEY = "<an OpenRouter key>"
 *     node scripts/prove-schedule-spend.mjs
 *
 * At most **two** model calls are made, ever, whatever else happens: one per
 * scheduled agent, bounded by the ceilings this proof sets on their schedules.
 * That bound is the feature, so a harness that could exceed it would be arguing
 * against its own subject. The key is read from the environment, used only to
 * build an authorization header inside DASH's own broker, and never printed,
 * written to the scratch store, or put in a settlement row.
 *
 * `DASH_PROOF_MODEL_ID` picks the model; it defaults to a small one.
 *
 * ## Why it builds first
 *
 * `scripts/prove-schedule.mjs`' reason, unchanged: the proof is TypeScript that
 * imports the real store, the real schedule module, the real broker and the real
 * view builder, and it spawns the real runner. Both are bundled into `dist/` so
 * the proof cannot drift from the code it is a proof about.
 *
 * `pnpm verify` never runs this file, and `tsconfig.json` includes
 * `scripts/schedule-spend-proof` so the source is typechecked. A proof that
 * rotted silently between runs would be worse than none, and typechecking a file
 * is not executing it.
 *
 * ## It takes about three minutes
 *
 * Two agents, one window, and a thirty-second scheduler tick that fires one
 * agent per pass. Waiting for real minutes is the content of the proof — see
 * `scripts/schedule-proof/main.ts`, which makes the same trade for the same
 * reason.
 */

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist", "schedule-spend-proof");
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
  define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify("schedule-spend-proof") },
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
    entryPoints: [path.join(repoRoot, "scripts", "schedule-spend-proof", "main.ts")],
    outfile: proofOut,
  }),
]);

const result = spawnSync(process.execPath, [proofOut], {
  stdio: "inherit",
  env: { ...process.env, DASH_PROOF_RUNNER: runnerOut },
});

process.exit(result.status ?? 1);
