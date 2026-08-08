/**
 * Build the standalone runner: what actually runs on the VPS (MAR-497).
 *
 * ADR 0007 decided the remote process is *this repository's runner*, and named
 * shipping it standalone as an open question — the runner is bundled into the
 * Electron app as `dist/electron/runner.mjs` and started by the Electron binary
 * with `ELECTRON_RUN_AS_NODE=1`, which a host does not have. This script is the
 * answer: the same runner, bundled for a host's own Node, with the two things
 * the MSIX install was silently providing.
 *
 * ## The artifact, and why each file is in it
 *
 * ```
 * dist/runner-standalone/
 *   start.mjs        the entry point — preflight, data directory, handover
 *   runner.mjs       the runner itself, byte-for-byte the same source as the shell's
 *   host-helper.mjs  the deploy plane's closed verb set (MAR-487)
 *   contracts/       the frozen schemas, because the walk-up search must find them
 *   package.json     type, version, engines, and the runner build id
 *   README.md        the start command and what the host must already have
 * ```
 *
 * **`contracts/` is the file nobody would predict.** `lib/contracts.ts` finds
 * the schema directory by walking up from its own `import.meta.url`, which
 * resolves to the repository root in a development tree and to the app's
 * resource directory in a package. On a host there is nothing above the
 * artifact, so the schemas have to be *inside* it — and if they are not, the
 * runner does not fail at build time or at start time. It fails the first time
 * something validates a manifest, which is the first time an agent is asked to
 * run. `tests/runner-standalone.test.ts` copies the artifact outside this
 * repository before starting it precisely so that a missing `contracts/` cannot
 * be quietly satisfied by the repository the test is running in.
 *
 * ## Why the entry point is its own bundle
 *
 * `runner/standalone.ts` checks that this host's Node has `node:sqlite` before
 * anything imports it. Bundled together they would be one module graph, the
 * import would be hoisted above the check, and the preflight would never run on
 * the host it exists for. Two files is the property; see that module's header.
 *
 * ## What this is not
 *
 * Not a packager, not an installer, not a service unit, and it uploads nothing.
 * It produces a directory. Getting that directory onto a host is the deploy
 * plane's job (MAR-484), and ADR 0007 is explicit that the verb set belongs
 * with the bridge rather than here.
 */

import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeRunnerBuildId } from "./runner-build-id.mjs";

const defaultRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Build the artifact either at its canonical developer location or into a
 * caller-owned staging directory.
 *
 * MAR-556's installed deploy action needs these exact bytes beside the bundled
 * Electron main process. Exporting the builder keeps that staged copy and
 * `pnpm build:runner-standalone` on one implementation; a second build recipe
 * would eventually make DASH upload a runner different from the one MAR-497's
 * tests exercise.
 */
export async function buildStandaloneRunner(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const outDir = options.outDir ?? path.join(repoRoot, "dist", "runner-standalone");
  const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

/**
 * The same fingerprint the shell's bundled runner carries.
 *
 * Same function, same inputs, therefore the same string — which is what makes
 * "the host is running the build this DASH shipped" a question with an answer.
 * It is only meaningful because `scripts/runner-build-id.mjs` normalises path
 * separators and line endings; without that, a Linux-built artifact and a
 * Windows-built shell would disagree about identical source.
 */
const runnerBuildId = computeRunnerBuildId(repoRoot, rootPackage.version);

/**
 * `node24`, and it is a different claim from the shell's identically-spelled one.
 *
 * `scripts/build-shell.mjs` targets node24 because that is what Electron 43
 * embeds — a runtime this project ships. Here it is the floor a *host* must
 * meet, and `runner/host-runtime.ts` is where that number is argued and
 * enforced. The two agreeing today is a coincidence worth not relying on.
 */
const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  sourcemap: true,
  logLevel: "info",
  format: "esm",
  define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify(runnerBuildId) },
};

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await Promise.all([
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "runner", "standalone.ts")],
    outfile: path.join(outDir, "start.mjs"),
  }),
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "runner", "main.ts")],
    outfile: path.join(outDir, "runner.mjs"),
  }),

  /**
   * The host helper (MAR-487), in the bundle it operates on.
   *
   * ADR 0007: *"The bundle DASH pushes includes a small host helper with a
   * closed verb set."* It ships **inside** the artifact rather than beside it
   * for one reason worth writing down: `install` replaces a bundle's files, and
   * a helper living outside would be a version of the deploy plane that could
   * drift from the runner it starts. Here they are always the same build, and
   * the `install` that replaced them is the one that replaced both.
   *
   * Its own bundle rather than part of `start.mjs`, because the two are
   * different programs with different lifetimes: `start.mjs` becomes the
   * runner and stays, and the helper answers one verb and exits.
   */
  build({
    ...shared,
    entryPoints: [path.join(repoRoot, "scripts", "host-helper", "entry.ts")],
    outfile: path.join(outDir, "host-helper.mjs"),
  }),
]);

cpSync(path.join(repoRoot, "contracts"), path.join(outDir, "contracts"), { recursive: true });

/**
 * `type: module` is belt and braces — the `.mjs` extension already decides it —
 * and `engines` is the machine-readable half of the sentence
 * `runner/host-runtime.ts` prints. Nothing installs from this file; it is here
 * so an operator running `node -p` against it gets the same answer the runner
 * would give them.
 */
writeFileSync(
  path.join(outDir, "package.json"),
  `${JSON.stringify(
    {
      name: "orchestratedash-runner",
      version: rootPackage.version,
      private: true,
      type: "module",
      main: "start.mjs",
      engines: { node: ">=24.0.0" },
      dash: { runner_build: runnerBuildId, runner_protocol: 1 },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

writeFileSync(
  path.join(outDir, "README.md"),
  hostReadme(rootPackage, runnerBuildId),
  "utf8",
);

console.log(
  `[build-runner-standalone] wrote ${path.relative(repoRoot, outDir)} runner_build=${runnerBuildId}`,
);

  return { outDir, runnerBuildId };
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  path.resolve(invokedPath) === path.resolve(fileURLToPath(import.meta.url))
) {
  await buildStandaloneRunner();
}

/**
 * The README that travels with the artifact.
 *
 * Written here rather than kept as a file to copy, because two of its
 * sentences are facts about *this* build — the identity and the version — and a
 * checked-in copy would be right until the first time somebody forgot to
 * update it. `docs/runner-standalone.md` is the durable document; this is the
 * label on the box.
 */
function hostReadme(rootPackage, buildId) {
  return `# OrchestrateDASH agent runner — standalone

Version ${rootPackage.version}, runner build \`${buildId}\`.

The process that holds running agents. It is the same runner that ships inside
the DASH desktop app, built to run on a host where DASH is not installed.

## What this host needs

- **Node 24 or newer.** The runner keeps its own database using the SQLite
  module built into Node itself, so there is nothing to compile and nothing to
  install with a package manager — but older versions of Node either do not
  have that module or keep it behind a command-line flag. The runner checks
  before it starts anything and refuses with a sentence rather than a crash.
- Nothing else. No Electron, no Python, no build tools, no database server.

## Starting it

\`\`\`sh
node start.mjs
\`\`\`

That is the whole command. State goes in \`~/.orchestratedash/runner\` unless
\`DASH_RUNNER_DATA_DIR\` says otherwise:

\`\`\`sh
DASH_RUNNER_DATA_DIR=/srv/dash-runner node start.mjs
\`\`\`

The directory is created if it is missing and is made readable by its owner
only. It holds the runner's database, its credential, and any files a person
handed to an agent, so the runner refuses to start if it cannot prove those
permissions.

## Where it listens

On a Unix socket inside that data directory — or under \`XDG_RUNTIME_DIR\` when
the session has one — and **never on a network port**. Nothing on this host
accepts a connection from anywhere else, and the runner never dials out. DASH
reaches it over SSH, outbound from the user's own computer.

Once it is listening, \`runner.json\` beside the database names the socket, the
process id and this build. The credential is in \`runner.key\` and is not in
\`runner.json\`, deliberately.

## Stopping it

\`\`\`sh
curl --unix-socket "$(node -p "require('./runner.json').endpoint")" \\
  -H "Authorization: Bearer $(cat runner.key)" \\
  -X POST http://runner/shutdown
\`\`\`

run from the data directory. The runner stops its agents, closes its database
and exits. \`SIGTERM\` does the same thing. Do not kill it: agents are its
children and the database is checkpointed on the way out.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Asked to stop, and stopped. |
| 1 | Started and failed. Read \`runner.log\` in the data directory. |
| 78 | This host cannot run it. The reason is the last line printed, and it is about the host rather than the runner. |
`;
}
