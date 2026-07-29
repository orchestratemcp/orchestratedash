/**
 * Build the Agent Kit (MAR-428).
 *
 * Two bundles, and the second one is the interesting one.
 *
 * - `dist/cli.mjs` is `npx create-dash-agent`.
 * - `dist/open-in-dash.mjs` is **copied into every scaffolded project** as
 *   `scripts/open-in-dash.mjs`. Bundling it here, from `lib/handoff.ts`, is what
 *   makes the handoff a project writes and the handoff DASH reads the same
 *   contract rather than two copies of one that agree today. A templated string
 *   would drift on its first edit; a bundle cannot.
 *
 * Both carry the kit's version as a compile-time constant rather than reading a
 * `package.json` beside them at runtime, because both get copied — into
 * `node_modules/.bin`, into somebody's project — and a relative read of a
 * manifest is a guess about where the file landed.
 *
 * The output is deliberately not committed: `dist/` is ignored, exactly as the
 * shell's is. `pnpm verify` does not need it, because the tests exercise the
 * TypeScript sources; only actually *running* the kit does.
 */

import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kitRoot = path.join(repoRoot, "agent-kit");
const outDir = path.join(kitRoot, "dist");
const kitPackage = JSON.parse(readFileSync(path.join(kitRoot, "package.json"), "utf8"));

mkdirSync(outDir, { recursive: true });

/**
 * `target` is deliberately lower than the shell's `node24`.
 *
 * The shell bundles run inside the Electron this repo pins, so their floor is
 * known. These run on whatever Node the agent author has, and the scaffold's own
 * `engines` says 20. Downlevelling costs nothing; shipping syntax somebody's
 * Node 20 cannot parse costs them a first impression.
 */
const shared = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  logLevel: "info",
  define: {
    __AGENT_KIT_VERSION__: JSON.stringify(kitPackage.version),
  },
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(kitRoot, "bin", "create-dash-agent.ts")],
    outfile: path.join(outDir, "cli.mjs"),
    banner: { js: "#!/usr/bin/env node" },
  }),

  build({
    ...shared,
    entryPoints: [path.join(kitRoot, "bin", "open-in-dash.ts")],
    outfile: path.join(outDir, "open-in-dash.mjs"),
  }),
]);

console.log(`[build-agent-kit] wrote ${path.relative(repoRoot, outDir)}`);
