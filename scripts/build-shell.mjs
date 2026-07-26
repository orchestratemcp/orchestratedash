/**
 * Build the Electron shell and the bundled runner.
 *
 * Four bundles, and the interesting part is that they are not all the same
 * module format. `sandbox: true` (ADR 0001's standing obligation, asserted in
 * `lib/shell/window.ts`) means a sandboxed preload cannot use ESM and cannot
 * import anything at runtime — so the preload must be one CommonJS file. The
 * main process is under no such constraint, and keeping it ESM is what makes
 * `import.meta.url` real, which is how `main.ts` finds the preload correctly on
 * Windows.
 *
 * The posture is the fixed point and the build adapts to it. At no point does
 * anything here want `sandbox` relaxed: the preload's only non-`electron`
 * import is `lib/shell/ipc.ts`, whose own imports are all `import type` and
 * therefore erased. The bundle is two files' worth of code with no Node
 * built-ins in it, which is exactly what a sandboxed preload can run.
 *
 * Not electron-builder, not packaging, not signing. Those are the packaging
 * phase (MAR-424 is explicit that they are out of scope). This produces the
 * files `electron .` needs and nothing else.
 */

import { build } from "esbuild";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist", "electron");

/**
 * `electron` is external because it is supplied by the runtime, never bundled.
 * Node built-ins are external automatically under `platform: "node"`.
 *
 * `target` tracks the Node that Electron 43 embeds (24.18 at the time of
 * writing, confirmed by `process.versions` in a real launch) rather than the
 * Node running this build. Getting it wrong in the safe direction only costs
 * unnecessary downlevelling; getting it wrong in the other direction ships
 * syntax the shell cannot parse.
 */
const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

mkdirSync(outDir, { recursive: true });

/**
 * The repo root is `"type": "module"`, which would make a `.js` file in here
 * ESM. The preload must be CommonJS, so the output directory declares itself
 * CommonJS and the ESM outputs use `.mjs`, where the extension wins regardless.
 *
 * Written by the build rather than committed: it is a fact about the output
 * format, so it belongs next to the thing that chooses the output format.
 *
 * A `name` here would do nothing. Electron takes the app name from the
 * package.json of the *app directory*, which is the repo root under `electron .`
 * and is not consulted at all when a file is launched directly — see
 * `electron/smoke-identity.ts` for how the harness deals with that.
 */
writeFileSync(
  path.join(outDir, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  "utf8",
);

await Promise.all([
  // The main process. ESM, so `import.meta.url` resolves to this file and the
  // preload beside it.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "main.ts")],
    outfile: path.join(outDir, "main.mjs"),
    format: "esm",
  }),

  // The preload. CommonJS and self-contained, because the sandbox permits
  // nothing else.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "preload.ts")],
    outfile: path.join(outDir, "preload.js"),
    format: "cjs",
  }),

  // The bundled runner (MAR-415). A separate process, launched by main with
  // `ELECTRON_RUN_AS_NODE=1`, so it is plain Node and needs no Electron API —
  // but it is bundled here rather than run from source for the same reason main
  // is: a packaged app has no TypeScript and no node_modules to resolve `ajv`
  // out of.
  //
  // ESM, and it must stay ESM: `lib/contracts.ts` finds the schema directory by
  // walking up from `import.meta.url`, which a CJS bundle would not have.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "runner", "main.ts")],
    outfile: path.join(outDir, "runner.mjs"),
    format: "esm",
  }),

  // The proof harness. Never on the `electron .` path — it is built here only
  // so `pnpm shell:smoke` has something to run. See `electron/smoke.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "smoke.ts")],
    outfile: path.join(outDir, "smoke.mjs"),
    format: "esm",
  }),
]);

/**
 * The packaged renderer (MAR-429).
 *
 * Copied rather than bundled: it is one static file with no imports, and
 * `electron/resources.ts` resolves it relative to `main.mjs`, so it has to land
 * beside it. Only the packaged app loads it — `pnpm dev` and `pnpm shell` still
 * point at the loopback Next server — but it is built every time so that a
 * packaging run can never be the first thing to discover it is missing.
 *
 * It is a placeholder for the real UI, and says so in its own text. See
 * `electron/resources.ts` for why DASH's Next renderer is not packaged yet.
 */
const rendererDir = path.join(outDir, "renderer");
mkdirSync(rendererDir, { recursive: true });
copyFileSync(
  path.join(repoRoot, "electron", "renderer", "index.html"),
  path.join(rendererDir, "index.html"),
);

console.log(`[build-shell] wrote ${path.relative(repoRoot, outDir)}`);
