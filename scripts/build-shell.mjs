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
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist", "electron");
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

/**
 * The two Agent Kit files "Try a sample agent" needs (MAR-423).
 *
 * Inside `outDir` because `@electron/packager` stages that directory as the
 * packaged app, so anything under it ships and anything outside it does not.
 */
const kitDir = path.join(outDir, "agent-kit");
const kitVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "agent-kit", "package.json"), "utf8"),
).version;

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
mkdirSync(kitDir, { recursive: true });

/**
 * The repo root is `"type": "module"`, which would make a `.js` file in here
 * ESM. The preload must be CommonJS, so the output directory declares itself
 * CommonJS and the ESM outputs use `.mjs`, where the extension wins regardless.
 *
 * Written by the build rather than committed: it is a fact about the output
 * format, so it belongs next to the thing that chooses the output format.
 *
 * Under `electron .` at the repo root, only `type` matters here — Electron
 * reads the *repo root's* package.json for the app name, not this one; see
 * `electron/smoke-identity.ts` for how the harness deals with that.
 *
 * `name`, `productName`, `version` and `main` matter for a different reader:
 * `@electron/packager` (MAR-429) stages *this* directory as the packaged app,
 * and Electron resolves `app.getName()` — and therefore `app.getPath("userData")`
 * — from a packaged app's own bundled package.json, `productName` first. That
 * name must stay `OrchestrateDASH` on every future build: changing it would
 * silently point an updated package at a different user-data folder, which is
 * exactly the update-orphans-data failure this issue exists to rule out. It is
 * deliberately not the same as the dev path's app name (`orchestratedash`,
 * lowercase, from the repo root's package.json) — dev and packaged installs
 * already use different `userData` roots for other reasons, so there is no
 * continuity to preserve between them, only within each.
 */
writeFileSync(
  path.join(outDir, "package.json"),
  `${JSON.stringify(
    {
      type: "commonjs",
      name: "orchestratedash",
      productName: "OrchestrateDASH",
      version: rootPackage.version,
      main: "main.mjs",
    },
    null,
    2,
  )}\n`,
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

  // The credential prompt's preload (MAR-383). A second CommonJS bundle for the
  // same reasons as the first, and a separate file rather than a branch inside
  // it: the two bridges must not be reachable from one another's window, and
  // building them separately is what makes that true of the bytes rather than
  // just of the source.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "credential-preload.ts")],
    outfile: path.join(outDir, "credential-preload.js"),
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

  // MAR-423. "Try a sample agent" scaffolds a project, and a scaffold needs the
  // same `scripts/open-in-dash.mjs` the Agent Kit copies in, so the user can
  // re-add their agent later from their own folder without DASH.
  //
  // Built here rather than copied from `agent-kit/dist/`, which is gitignored
  // and only exists after `pnpm build:agent-kit`: a packaging run must not
  // depend on somebody having remembered a separate command, and the failure if
  // they had not would be a menu item that is broken only in the shipped build.
  //
  // `node20`, matching `scripts/build-agent-kit.mjs` and not the shell's
  // `node24`: this file is copied into the user's project and runs on whatever
  // Node they have, if they ever run it at all.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "agent-kit", "bin", "open-in-dash.ts")],
    outfile: path.join(kitDir, "open-in-dash.mjs"),
    format: "esm",
    target: "node20",
    define: { __AGENT_KIT_VERSION__: JSON.stringify(kitVersion) },
  }),
]);

/**
 * The generated agent, copied verbatim beside the bundles.
 *
 * Same placement argument as the renderer below: `electron/sample-agent.ts`
 * resolves it relative to `import.meta.url`, which is the one anchor that holds
 * in a development tree and under an immutable MSIX install root alike.
 */
copyFileSync(
  path.join(repoRoot, "agent-kit", "template", "agent.mjs"),
  path.join(kitDir, "agent.mjs"),
);

/**
 * The packaged renderer (MAR-432).
 *
 * DASH's actual UI, statically exported by `pnpm build:renderer`, copied to sit
 * beside `main.mjs` — `electron/renderer-host.ts` resolves it relative to
 * `import.meta.url`, the one anchor that holds in a development tree and under a
 * version-stamped MSIX install root alike.
 *
 * **Copied if it is there, and reported if it is not.** Not built from here: a
 * full Next export takes tens of seconds, and `pnpm shell` runs this script on
 * the developer path where the loopback dev server is what gets loaded and the
 * export is never opened. Failing here would tax the common case for the sake of
 * the rare one.
 *
 * What makes that safe is that nothing *silently* ships without it. A packaged
 * launch calls `assertRendererPresent()` and crashes on line one with the
 * command to run; `scripts/package-msix.mjs` refuses before it stages anything.
 * The one thing that cannot happen is a package with a blank window in it.
 */
const rendererDir = path.join(outDir, "renderer");
rmSync(rendererDir, { recursive: true, force: true });

const exportDir = path.join(repoRoot, "out");
if (existsSync(exportDir)) {
  cpSync(exportDir, rendererDir, { recursive: true });
  console.log(`[build-shell] copied the exported renderer from ${path.relative(repoRoot, exportDir)}`);
} else {
  mkdirSync(rendererDir, { recursive: true });
  console.log(
    "[build-shell] no exported renderer found — run `pnpm build:renderer` before packaging. " +
      "The developer path (`pnpm dev` + `pnpm shell`) does not need it.",
  );
}

console.log(`[build-shell] wrote ${path.relative(repoRoot, outDir)}`);
