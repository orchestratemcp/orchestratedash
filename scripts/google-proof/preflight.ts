/**
 * Is this machine ready for an attended proof run? (MAR-520)
 *
 * Run by `scripts/prove-google.mjs` before it builds the harness and long
 * before an operator stands at a consent screen. It answers one question —
 * **is anything already holding the data directory this run is about to write
 * to** — and it exists because on 2026-08-07 the answer was yes and nobody
 * found out until after the run.
 *
 * That morning's harness left a runner alive, supervising three agents, holding
 * `%APPDATA%\orchestratedash`, answering `401` to the only credential on disk.
 * The next run would have started a second runner over the same
 * `runner.sqlite`, which is the two-writers-one-store pattern MAR-506's
 * corruption is suspected to have come from. Nothing in the harness or the
 * runbook told an operator to look.
 *
 * ## Why it is a separate process rather than a check inside the harness
 *
 * The harness starts the real shell, and the shell spawns the runner. By the
 * time any code inside the harness could look, the thing it is looking for has
 * already been adopted or spawned past. This runs first, exits, and leaves
 * nothing behind.
 *
 * ## Why it runs under Electron rather than plain Node
 *
 * `app.getPath("userData")` is the only honest answer to "which directory is
 * this run about to write to". Computing it any other way would be a third
 * spelling of a path the harness already asserts (check `G0a`), and a preflight
 * that guarded the wrong directory would be worse than none.
 *
 * Exit codes are for `prove-google.mjs` to branch on rather than parse:
 * **0** nothing in the way, **3** something is holding it that could not be
 * retired.
 */

import "../../electron/smoke-identity";

import { app } from "electron";

import { retireLeftoverRunner } from "../../electron/runner-process";

async function main(): Promise<void> {
  await app.whenReady();
  const dataDir = app.getPath("userData");
  console.log(`[preflight] data directory: ${dataDir}`);

  const found = await retireLeftoverRunner(dataDir);

  switch (found.state) {
    case "none":
      console.log("[preflight] no runner is holding this data directory.");
      app.exit(0);
      return;

    case "adoptable":
      // Left running on purpose. The shell this proof starts will adopt it, and
      // stopping a healthy runner here would end a fleet the user is watching.
      console.log(
        `[preflight] runner pid ${String(found.pid)} (${found.build ?? "identity unavailable"}) ` +
          `is already running and DASH can talk to it. It will be adopted, not restarted.`,
      );
      app.exit(0);
      return;

    case "retired":
      console.log(
        `[preflight] retired a leftover runner: pid ${String(found.pid)} ` +
          `(${found.build ?? "identity unavailable"}) was holding this data directory and did ` +
          `not accept DASH's credential. It was asked to stop through its own authenticated ` +
          `shutdown route. Nothing was force-killed.`,
      );
      app.exit(0);
      return;

    case "held":
      console.error(`[preflight] refusing to start the proof.\n${found.detail}`);
      app.exit(3);
      return;
  }
}

void main().catch((error: unknown) => {
  console.error(
    `[preflight] failed: ${error instanceof Error ? error.stack : String(error)}`,
  );
  app.exit(3);
});
