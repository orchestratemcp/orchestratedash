/**
 * The Electron proof is a Windows release gate, not an optional afterthought.
 *
 * Linux CI still typechecks and bundles the shell without downloading the
 * Electron binary. A separate Windows CI job executes this same command with
 * the binary present. On a Windows developer machine `pnpm verify` therefore
 * cannot report green without launching the real shell proof.
 *
 * ## MAR-748: an exit code alone is not evidence
 *
 * `electron/smoke.ts` imports `electron/main.ts`, which answers a lost
 * single-instance lock (another DASH — live, orphaned, or a leftover capture
 * shell — already holding it for this userData) with a clean `app.quit()`:
 * exit 0, in seconds, having run none of the 85 proofs. Trusting that exit
 * code made this gate pass exactly when it proved nothing.
 *
 * So the shell proof is launched directly (not through the `shell:smoke`
 * pnpm script — see the note above `smokeExtraArgs` for why) with its output
 * captured as well as streamed, and `describeSmokeFailure` — pure, tested in
 * `tests/verify-shell.test.ts` — judges it by what actually printed, not
 * merely by what the child reported on the way out.
 */

import { spawn, spawnSync } from "node:child_process";

import { describeSmokeFailure } from "./verify-shell-lib.mjs";

if (process.platform !== "win32") {
  console.log("[verify:shell] Windows shell proof is enforced by the shell-smoke CI job.");
  process.exit(0);
}

const pnpmEntrypoint = process.env.npm_execpath;
if (pnpmEntrypoint === undefined || pnpmEntrypoint.length === 0) {
  console.error("[verify:shell] pnpm did not expose npm_execpath; cannot run the mandatory shell proof.");
  process.exit(1);
}

function pnpm(script, env = process.env) {
  return spawnSync(process.execPath, [pnpmEntrypoint, script], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
}

/**
 * Same shape as `pnpm()`, but for a plain executable rather than a script
 * name, and it tees stdout/stderr to this process while also buffering them
 * — the developer still watches it live, and `describeSmokeFailure` gets to
 * see what was actually printed once the child exits.
 */
function runCaptured(command, args, env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd(), env, stdio: ["inherit", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ status: null, error, output });
    });
    child.on("close", (code) => {
      resolve({ status: code, error: undefined, output });
    });
  });
}

// The proof must be self-contained. Relying on a developer's Next server made
// the old command impossible to run in a clean Windows CI checkout and tested
// the dev renderer instead of the installed one when a server happened to be
// present.
const renderer = pnpm("build:renderer");
if (renderer.error !== undefined) {
  console.error(`[verify:shell] could not build the installed renderer: ${renderer.error.message}`);
  process.exit(1);
}
if (renderer.status !== 0) {
  process.exit(renderer.status ?? 1);
}

const shellBuild = pnpm("build:shell");
if (shellBuild.error !== undefined) {
  console.error(`[verify:shell] could not build the shell: ${shellBuild.error.message}`);
  process.exit(1);
}
if (shellBuild.status !== 0) {
  process.exit(shellBuild.status ?? 1);
}

/**
 * `pnpm run shell:smoke -- --user-data-dir=…` looks like the obvious way to
 * point a scratch repro at its own userData, and it is wrong: pnpm forwards
 * trailing args by inserting a literal `--` ahead of them, and Chromium's own
 * switch parser treats everything after a bare `--` as positional rather than
 * a switch — `--user-data-dir` would be silently ignored and the run would
 * fall through to the installed store, exactly what MAR-748's repro must
 * never do. Launching the Electron binary directly sidesteps that parser
 * entirely, so this wrapper's argv is the child's argv, verbatim.
 */
const electronBinary = (await import("electron")).default;
const scratchUserDataDir = process.env.DASH_SMOKE_USER_DATA_DIR;
const smokeArgs = ["dist/electron/smoke.mjs"];
if (scratchUserDataDir !== undefined) {
  smokeArgs.push(`--user-data-dir=${scratchUserDataDir}`);
}

const smokeEnv = { ...process.env, DASH_SHELL_URL: "dash-app://ui/" };
if (scratchUserDataDir !== undefined) {
  // Keeps the sqlite store beside the Electron userData override rather than
  // the installed store — see the module header on why this must never run
  // against the real one.
  smokeEnv.DASH_DATA_DIR = scratchUserDataDir;
}

const captured = await runCaptured(electronBinary, smokeArgs, smokeEnv);
if (captured.error !== undefined) {
  console.error(`[verify:shell] could not launch the shell proof: ${captured.error.message}`);
  process.exit(1);
}

const failureReason = describeSmokeFailure(captured.output, captured.status);
if (failureReason !== null) {
  console.error(`\n[verify:shell] FAIL: ${failureReason}\n`);
  process.exit(1);
}

process.exit(captured.status ?? 1);
