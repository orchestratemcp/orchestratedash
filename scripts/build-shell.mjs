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
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeRunnerBuildId } from "./runner-build-id.mjs";
import { buildStandaloneRunner } from "./build-runner-standalone.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "dist", "electron");
const standaloneRunnerDir = path.join(outDir, "runner-standalone");
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

/**
 * Exact identity of the runner bundle's source and contract inputs.
 *
 * Moved to `scripts/runner-build-id.mjs` by MAR-497, because the standalone
 * host artifact must compute the *same* string from the same tree — and it is
 * built on a different platform, which is what surfaced the two normalisations
 * that module now applies.
 */
const runnerBuildId = computeRunnerBuildId(repoRoot, rootPackage.version);

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
  define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify(runnerBuildId) },
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
  // MAR-556. The folder-bundle producer runs in Electron main and reads the
  // standalone artifact beside that bundle. Staging it here makes the same
  // location work under `electron .` and after @electron/packager copies this
  // whole directory into the immutable install root. The exported builder is
  // MAR-497's one recipe, not a second shell-specific copy.
  buildStandaloneRunner({ repoRoot, outDir: standaloneRunnerDir }),

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

  // The launch preflight. Runs under plain **Node**, before `electron .`, which
  // is the whole point of it — see `electron/preflight.ts`. Bundled here rather
  // than written as a `.mjs` script so that its rules can live in
  // `lib/shell/preflight.ts` with the rest of the shell's rules and be
  // unit-tested there, which a `scripts/*.mjs` file could not import.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "preflight.ts")],
    outfile: path.join(outDir, "preflight.mjs"),
    format: "esm",
  }),

  // The first-paint check (`pnpm shell:check`). Never on the `electron .` path,
  // built here only so there is something to run — the same terms as the smoke
  // and the screenshot harness below. It produces a verdict about the developer
  // path, which ADR 0004 keeps out of the release gate because that path
  // depends on a dev server somebody has to have started.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "first-paint.ts")],
    outfile: path.join(outDir, "first-paint.mjs"),
    format: "esm",
  }),

  // The screenshot harness, on the same terms as the smoke above: never on the
  // `electron .` path, built here only so there is something to run. It is
  // deliberately not named by any `package.json` script — it produces evidence,
  // not a verdict, and ADR 0004 keeps things that cannot fail a release out of
  // the gate. See `electron/capture.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture.ts")],
    outfile: path.join(outDir, "capture.mjs"),
    format: "esm",
  }),

  // The panel's own screenshot harness (MAR-554), on exactly the terms above.
  // Separate from `capture.ts` because that one walks routes and the declarative
  // panel has none yet — a real manifest declaring one arrives with MAR-548. See
  // `electron/capture-panel.ts` on what its images are and are not evidence of.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-panel.ts")],
    outfile: path.join(outDir, "capture-panel.mjs"),
    format: "esm",
  }),

  // The Servers route's own screenshot harness (MAR-574), on the same terms.
  // Separate from `capture.ts` because that one photographs whatever store the
  // machine happens to hold, and /settings/servers is a two-state route whose state that
  // store *decides* — so a run against one machine's store photographs one of
  // the two and cannot say which. This one is pointed at a store the run
  // chooses, and is run once per state. See `electron/capture-servers.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-servers.ts")],
    outfile: path.join(outDir, "capture-servers.mjs"),
    format: "esm",
  }),

  // The deploy surface's own screenshot harness (MAR-577), on the same terms
  // again. Two facts the store decides, not one: whether an agent can be sent
  // anywhere is its folder standing, and whether a server is offered is the host
  // table. A run against whatever a machine holds photographs one branch of each
  // and cannot say which. This one seeds the store it was pointed at and is run
  // once per scene. See `electron/capture-deploy.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-deploy.ts")],
    outfile: path.join(outDir, "capture-deploy.mjs"),
    format: "esm",
  }),

  // The Connections page's own screenshot harness (MAR-570), on the same terms.
  // Separate from `capture.ts` because that one photographs whatever store the
  // machine holds, and this page's subject is a relationship *between* agents —
  // two of them needing one service. No shipped example produces that, so a run
  // against a real store photographs the case the issue is not about. See
  // `electron/capture-connectors.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-connectors.ts")],
    outfile: path.join(outDir, "capture-connectors.mjs"),
    format: "esm",
  }),

  // Servers, Notifications and Preferences (MAR-599), on the same terms and
  // for the same reason `capture-connectors.ts` is separate from `capture.ts`:
  // this one does not import `smoke-identity.ts`, so it never claims the
  // installed app's own single-instance lock or default `userData` path — the
  // property this branch needed to run beside an attended test on the real
  // store without touching it. See `electron/capture-settings-polish.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-settings-polish.ts")],
    outfile: path.join(outDir, "capture-settings-polish.mjs"),
    format: "esm",
  }),

  // Add agent (MAR-598), on `capture-settings-polish.ts`'s exact terms — no
  // `smoke-identity.ts`, so it runs beside a live DASH without claiming its lock
  // or its store. A harness of its own rather than a fourth page on that one,
  // because that one's header records Add agent as deliberately excluded, and
  // adding it there would relabel a merged issue's evidence. See
  // `electron/capture-add-agent.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-add-agent.ts")],
    outfile: path.join(outDir, "capture-add-agent.mjs"),
    format: "esm",
  }),

  // The fleet's glance chips (MAR-586), on the same terms and for the sharpest
  // version of the reason: a chip exists only when the fact behind it is true,
  // so a run against whatever a machine holds photographs one of sixteen
  // combinations and cannot say which one it got. This one seeds five agents,
  // one per answer, and photographs them side by side. See
  // `electron/capture-glance.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-glance.ts")],
    outfile: path.join(outDir, "capture-glance.mjs"),
    format: "esm",
  }),

  // The fleet as character select (MAR-587 Phase B), on the same terms and for
  // a reason of its own: an agent's character is a hash of its name, so a run
  // against whatever store a machine holds photographs whichever costumes that
  // machine happens to wear — and only three of the eleven have sheets. This one
  // seeds five agents whose names were chosen to put an animated and a still
  // character alternately on screen, and writes the two things a photograph
  // cannot hold: the loop advancing, and the loop stopping when nobody is
  // looking. See `electron/capture-actions.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-actions.ts")],
    outfile: path.join(outDir, "capture-actions.mjs"),
    format: "esm",
  }),

  // The folder-update surface (MAR-584), on the same terms and for the sharpest
  // version of the reason yet: what this section draws is decided entirely by a
  // disagreement between two things on disk, so a run against a real store
  // photographs an agent nobody has edited — one of five states, and the least
  // interesting one. This one seeds the store, stages the edit its scene is
  // named for, and presses the real check button. See
  // `electron/capture-folder.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-folder.ts")],
    outfile: path.join(outDir, "capture-folder.mjs"),
    format: "esm",
  }),

  // The model-choice section (MAR-583), on the same terms. Which of its four
  // states is drawn depends on what is in the vault, so a run against a real
  // store photographs whichever one that machine happens to be in and cannot
  // say which. This one seeds four agents, one per state, and opens the step
  // disclosure by clicking it. See `electron/capture-models.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-models.ts")],
    outfile: path.join(outDir, "capture-models.mjs"),
    format: "esm",
  }),

  // The conversation (MAR-545), on the same terms. Five states, and which one is
  // drawn depends on the vault, on a settings row and on what the agent has
  // saved. This one seeds five agents, one per state, opens the sources
  // disclosure by clicking it, and photographs both densities as well as both
  // themes. See `electron/capture-ask.ts`, including the paragraph saying that
  // no provider was contacted and nobody was charged to produce those images.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-ask.ts")],
    outfile: path.join(outDir, "capture-ask.mjs"),
    format: "esm",
  }),

  // The text pass (MAR-614), on the same terms, and the first capture harness
  // whose subject is not a state but a *quantity*. Every other one above
  // measures width; prose that explains never overflows, it pushes the control
  // you came for off the bottom of the screen. So this one counts the words a
  // surface puts above its first action and photographs the same frame, run once
  // before the pass and once after. See `electron/capture-text-pass.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-text-pass.ts")],
    outfile: path.join(outDir, "capture-text-pass.mjs"),
    format: "esm",
  }),
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-ui-scale.ts")],
    outfile: path.join(outDir, "capture-ui-scale.mjs"),
    format: "esm",
  }),

  // The cockpit's de-duplication (MAR-646), on the same terms as every harness
  // above and for a reason none of them could cover: `capture-deploy.ts` already
  // photographs all six agent stages, and every frame it takes is of an agent
  // that has never run — so its rail is empty, and a duplication between a rail
  // and the stage beside it cannot be photographed with the rail empty. This one
  // seeds an agent with four outputs, a run of telemetry and a queue, and counts
  // how many of the rail's titles the stage repeats. See
  // `electron/capture-cockpit.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-cockpit.ts")],
    outfile: path.join(outDir, "capture-cockpit.mjs"),
    format: "esm",
  }),

  // The fleet's three layouts (MAR-612), on the same terms and for two reasons
  // at once: the store decides whether a spotlight has neighbours to turn, and a
  // stored preference decides what shape the page draws at all. A run against
  // whatever a machine holds photographs one of six combinations and cannot say
  // which. This one seeds five agents, writes both preferences and reloads
  // rather than clicking anything, and reads each frame's labels back off the
  // document before it takes the picture — the mislabelling hazard MAR-612's own
  // issue names. See `electron/capture-fleet-views.ts`.
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "electron", "capture-fleet-views.ts")],
    outfile: path.join(outDir, "capture-fleet-views.mjs"),
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

console.log(
  `[build-shell] wrote ${path.relative(repoRoot, outDir)} runner_build=${runnerBuildId}`,
);
