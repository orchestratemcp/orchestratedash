/**
 * MAR-748 acceptance proof #3: a scripted repro, not a hand transcript.
 *
 * Holds the single-instance lock with a first Electron on a **scratch**
 * `--user-data-dir` (never the installed store), then runs `pnpm verify:shell`
 * against that same directory and asserts it exits non-zero and names the
 * lock as the cause — the exact failure PR #268's handoff hit by accident.
 *
 * Run from PowerShell, not Git Bash (see project memory: Git Bash's `whoami`
 * answers differently than Windows' does, which the runner's channel-secret
 * path depends on and `shell:smoke` exercises regardless of what this repro
 * is actually testing):
 *
 *   node scripts/mar748-repro.mjs
 *
 * Never run this against a live DASH or an existing capture session's
 * userData — it only ever touches its own `mkdtemp`'d scratch directory.
 *
 * ## The holder is a real, fully-started DASH, not a stub
 *
 * An earlier version of this fixture used a minimal Electron process that
 * only called `requestSingleInstanceLock()` — real enough to prove the lock
 * itself, but the contending `shell:smoke` run against it did not exit in
 * seconds the way the bug report describes: it hung, apparently indefinitely,
 * inside `ensureRunner`'s cold-spawn-and-wait path (`electron/runner-
 * process.ts`), because a scratch directory with no prior runner gives that
 * losing instance nothing to *adopt* — it tries to spawn a brand new one
 * instead. A real DASH already has a running, registered runner for its
 * userData, so the losing instance's `ensureRunner` finds one immediately.
 * Measured against that shape: the losing instance's whole run — lock check,
 * partial startup, runner *adoption*, clean quit — took **2.8 seconds** and
 * printed zero `PASS`/`FAIL` lines, matching the folklore this issue retires.
 * (The cold-spawn hang is real but is a different, narrower defect — a
 * losing instance racing a *completely fresh* userData with no existing
 * runner — and is out of this ticket's scope; worth its own issue.)
 *
 * The holder is left running when this script exits — Windows gives
 * `child_process.kill()` no graceful signal to send an Electron app (it is a
 * `TerminateProcess` regardless of the signal name), and this codebase's rule
 * against force-killing Electron does not carve out "but it's only a scratch
 * store". Close the window by hand when done; it holds nothing but its own
 * temp directory.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describeSmokeFailure } from "./verify-shell-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");

function log(line) {
  console.log(`[mar748-repro] ${line}`);
}

/** True once `ensureRunner` has settled one way or the other for this userData. */
const RUNNER_SETTLED = /\[dash-shell\] (runner:|no runner)/;

async function main() {
  const scratchDir = mkdtempSync(path.join(tmpdir(), "mar748-lock-repro-"));
  log(`scratch userData: ${scratchDir}`);

  const electronBinary = (await import("electron")).default;
  const holderEnv = { ...process.env, DASH_DATA_DIR: scratchDir, DASH_SHELL_URL: "dash-app://ui/" };

  log("starting the lock holder: a real dist/electron/main.mjs, pointed at the scratch directory…");
  log("(requires `pnpm build:shell` to have already produced dist/electron/main.mjs and smoke.mjs)");
  const holder = spawn(electronBinary, ["dist/electron/main.mjs", `--user-data-dir=${scratchDir}`], {
    cwd: repoRoot,
    env: holderEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const holderSettled = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("holder did not finish its runner startup within 30s")), 30_000);
    const onChunk = (chunk) => {
      const text = chunk.toString("utf8");
      process.stdout.write(`[holder] ${text}`);
      if (RUNNER_SETTLED.test(text)) {
        clearTimeout(timer);
        resolve();
      }
    };
    holder.stdout.on("data", onChunk);
    holder.stderr.on("data", onChunk);
    holder.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`holder exited early (code ${String(code)}); it never settled`));
    });
  });

  await holderSettled;
  log("holder holds the lock and has a settled runner state. Launching pnpm verify:shell against the same directory…");

  // `shell: true`, because Windows cannot exec a `.cmd` shim (pnpm's own
  // launcher) through CreateProcess directly.
  const verifyRun = spawn("pnpm", ["run", "verify:shell"], {
    cwd: repoRoot,
    env: { ...process.env, DASH_SMOKE_USER_DATA_DIR: scratchDir },
    stdio: ["inherit", "pipe", "pipe"],
    shell: true,
  });

  let verifyOutput = "";
  const verifyExit = await new Promise((resolve) => {
    verifyRun.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      verifyOutput += chunk.toString("utf8");
    });
    verifyRun.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      verifyOutput += chunk.toString("utf8");
    });
    verifyRun.on("error", (error) => {
      verifyOutput += `\n[mar748-repro] failed to launch pnpm: ${error.message}\n`;
      resolve(null);
    });
    verifyRun.on("close", (code) => resolve(code));
  });

  // Independent check, not just "did verify-shell.mjs say FAIL": re-derive the
  // verdict from the raw captured output with the same pure function verify-
  // shell.mjs itself uses, so this repro is not merely trusting the thing it
  // is trying to prove.
  const failureReason = describeSmokeFailure(verifyOutput, verifyExit);
  const exitReasonOk = verifyExit !== 0 && failureReason !== null && failureReason.includes("single-instance lock");

  log(`holder pid ${String(holder.pid)} left running on purpose — close its window by hand when you are done.`);

  if (exitReasonOk) {
    log(`PASS: pnpm verify:shell exited ${String(verifyExit)} and named the held lock as the cause.`);
    process.exit(0);
  } else {
    log(`FAIL: pnpm verify:shell exited ${String(verifyExit)}; did not read as a correctly-named lock-loss failure.`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[mar748-repro] ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
