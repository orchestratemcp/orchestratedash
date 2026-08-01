/**
 * The Electron proof is a Windows release gate, not an optional afterthought.
 *
 * Linux CI still typechecks and bundles the shell without downloading the
 * Electron binary. A separate Windows CI job executes this same command with
 * the binary present. On a Windows developer machine `pnpm verify` therefore
 * cannot report green without launching the real shell proof.
 */

import { spawnSync } from "node:child_process";

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

const result = pnpm("shell:smoke", {
  ...process.env,
  DASH_SHELL_URL: "dash-app://ui/",
});

if (result.error !== undefined) {
  console.error(`[verify:shell] could not launch the shell proof: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
