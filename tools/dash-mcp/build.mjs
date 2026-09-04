/**
 * Two bundles, and neither is committed (MAR-862, ADR 0032 decision 4).
 *
 * - `dist/server.mjs` is the MCP server the plugin spawns.
 * - `dist/open-in-dash.mjs` is **copied into every scaffolded project** as
 *   `scripts/open-in-dash.mjs`.
 *
 * Both exist because the interesting half of this package is TypeScript in
 * `lib/` — DASH's own validator, DASH's own handoff — and a plugin's server is
 * a plain Node process that cannot import it. Bundling is how the tool holds
 * the real code rather than a description of it.
 *
 * `dist/` is gitignored, exactly as the shell's and the Agent Kit's are, and
 * that is load-bearing rather than tidy: a committed artifact of DASH's
 * validator would be a copy of the contract with a build date on it, which is
 * precisely what decision 4 refuses. The bundle is rebuilt whenever any file it
 * was built from is newer than it — see `launch.mjs` — so the running server is
 * never older than the checkout it was started from.
 *
 * `target` is `node22`, the floor this repository's `engines` already sets.
 */

import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(packageRoot, "dist");

mkdirSync(outDir, { recursive: true });

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: false,
  logLevel: "warning",
  // Every input, so `launch.mjs` can compare their timestamps against the
  // bundle's rather than guessing at a dependency list. A rebuild triggered by
  // a stale guess is cheap; a stale bundle nobody rebuilt is the failure this
  // avoids.
  metafile: true,
};

const [server, openInDash] = await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(packageRoot, "src", "main.ts")],
    outfile: path.join(outDir, "server.mjs"),
  }),
  build({
    ...shared,
    entryPoints: [path.join(packageRoot, "src", "open-in-dash.ts")],
    outfile: path.join(outDir, "open-in-dash.mjs"),
  }),
]);

const inputs = new Set([
  ...Object.keys(server.metafile.inputs),
  ...Object.keys(openInDash.metafile.inputs),
]);

writeFileSync(
  path.join(outDir, "inputs.json"),
  `${JSON.stringify({ built_at: new Date().toISOString(), inputs: [...inputs].sort() }, null, 2)}\n`,
  "utf8",
);

process.stdout.write(`dash-mcp: built 2 bundles from ${String(inputs.size)} files\n`);
