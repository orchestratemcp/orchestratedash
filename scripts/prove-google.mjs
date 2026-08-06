/**
 * Launch the attended real-Google proof (MAR-468).
 *
 *     node scripts/prove-google.mjs
 *
 * Deliberately **not** a `package.json` script. Every entry in that file is a
 * thing somebody can wire into a pipeline by pasting a name, and the one
 * property this proof must keep is that it cannot become a gate. Running it
 * takes a sentence from `docs/real-google-proof-runbook.md` rather than a name
 * from a list.
 *
 * ## The refusal below is the enforcement of ADR 0004
 *
 * ADR 0004's rule is that a blocking release gate may depend only on this
 * repository and this machine, and it named this proof as the follow-up that
 * stays manual. A rule kept by convention is a rule somebody keeps by accident
 * until they do not, so this file will not start if there is no terminal
 * attached or if `CI` is set. A CI job that tried to run it fails on line one
 * with a sentence about why, rather than hanging on a consent screen nobody is
 * standing at.
 *
 * ## Why it builds first
 *
 * The proof is TypeScript that imports the real shell — `electron/main.ts`, the
 * vault, the runner client, `lib/broker/`. It is bundled the same way
 * `scripts/build-shell.mjs` bundles the smoke harness, into `dist/`, and run by
 * the same Electron binary. Building it here rather than shipping a checked-in
 * bundle means the proof cannot drift from the code it is a proof about.
 *
 * `pnpm verify` never runs this file, and it does typecheck the source it
 * builds: `tsconfig.json` includes `scripts/google-proof`. That is the intended
 * split. A proof that rots silently between attended runs would be worse than
 * none, and typechecking a file is not executing it.
 */

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------------------------------------------- *
 * It has to be a person, and this is where that is enforced
 * ---------------------------------------------------------------------- */

if (process.env.CI !== undefined) {
  console.error(
    "[prove-google] refusing to run: CI is set.\n" +
      "This proof needs a human at Google's consent screen and it creates a real\n" +
      "draft in a real mailbox. ADR 0004: a blocking gate may depend only on this\n" +
      "repository and this machine. Run it by hand, from the runbook.",
  );
  process.exit(2);
}

if (!process.stdin.isTTY) {
  console.error(
    "[prove-google] refusing to run: no terminal is attached.\n" +
      "This proof stops twice to ask the operator a question — once before it\n" +
      "writes a real draft, and once to confirm the draft was deleted. Without a\n" +
      "terminal both would be answered by nobody.",
  );
  process.exit(2);
}

/* ---------------------------------------------------------------------- *
 * Build
 * ---------------------------------------------------------------------- */

const outDir = path.join(repoRoot, "dist", "google-proof");
mkdirSync(outDir, { recursive: true });

const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

/*
 * The output directory declares itself CommonJS for the reason
 * `scripts/build-shell.mjs` does — the repo root is `"type": "module"`, and the
 * `.mjs` extension wins over this for the one file that is actually ESM.
 *
 * `main` and `name` matter here too: Electron resolves `app.getName()` from the
 * directory it is pointed at, and getting it wrong would put this proof's store
 * somewhere the installed app never opens. The harness asserts the answer
 * anyway, in check G0a, so a mistake here is loud rather than silent.
 */
await build({
  entryPoints: [path.join(repoRoot, "scripts", "google-proof", "main.ts")],
  outfile: path.join(outDir, "main.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
  // `scripts/build-shell.mjs` defines this for the runner bundle. Nothing in
  // this proof reads it, but `runner/identity.ts` is reachable through the
  // imports, so the bundle would not build without a value for it.
  define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify("attended-google-proof") },
});

/*
 * The real executable, resolved through the `electron` package's own export
 * rather than through the `node_modules/.bin` shim.
 *
 * On Windows that shim is `electron.cmd`, and since the fix for CVE-2024-27980
 * Node refuses to spawn a `.cmd` or `.bat` without `shell: true`: `spawnSync`
 * comes straight back with `EINVAL` having started nothing. Paired with the
 * unchecked `result.error` below — now checked — the failure printed *nothing*.
 * The banner above, the shell prompt back, exit 0, and an operator with every
 * reason to believe Google had been asked something.
 *
 * `scripts/verify-shell.mjs` already avoids both halves of this: it spawns
 * `process.execPath` rather than a shim, and it reports `result.error` before
 * trusting `result.status`. This now matches its discipline.
 *
 * Found by running it. An unattended session validated everything about this
 * harness that could be validated without a consent screen — the typecheck, the
 * bundle, `node --check` on the generated agent — and the launch is precisely
 * the step none of that reaches. A runbook is not a run.
 */
let electronBinary;
try {
  electronBinary = createRequire(import.meta.url)("electron");
} catch {
  console.error("[prove-google] no electron package in node_modules — run `pnpm install` first.");
  process.exit(2);
}
if (typeof electronBinary !== "string" || !existsSync(electronBinary)) {
  console.error(
    `[prove-google] the electron package resolved to ${String(electronBinary)}, which is not an\n` +
      "executable on this machine — run `pnpm install` first.",
  );
  process.exit(2);
}

console.log(`[prove-google] version ${String(rootPackage.version)}`);
console.log("[prove-google] close DASH before continuing: the shell is single-instance,");
console.log("[prove-google] and this harness starts a real one.\n");

/*
 * `stdio: "inherit"` for all three, because the harness reads from the terminal.
 * Two of its steps are questions and neither can be answered down a pipe.
 */
const result = spawnSync(electronBinary, [path.join(outDir, "main.mjs")], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    // Belt and braces against the one substitution that would make this proof a
    // lie about which server answered. The harness asserts it is unset (check
    // G0b) and would refuse to continue; deleting it here means an operator who
    // ran a smoke in the same shell first cannot inherit it by accident.
    DASH_BROKER_PROOF_ORIGIN: undefined,
  },
});

/*
 * Reported before `status` is trusted, for the reason this file's own launch bug
 * demonstrated: a `spawnSync` that never started anything returns `status: null`
 * and an `error`, and `status ?? 1` turns that into a bare exit code carrying no
 * account of itself. The sibling `scripts/verify-shell.mjs` has always done this.
 */
if (result.error !== undefined) {
  console.error(`[prove-google] could not launch the proof harness: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
