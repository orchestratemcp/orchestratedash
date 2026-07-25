/**
 * The runner process.
 *
 * A plain Node process — not Electron, not a renderer, not a window. It is
 * started by `electron/main.ts` and **outlives it**: that is the whole point of
 * the issue's acceptance criterion that closing the DASH window leaves running
 * agents running. DASH is a control surface that may come and go; the thing
 * holding the agents has to be something else.
 *
 * ## Why this can be tested in CI when the shell cannot
 *
 * `electron/README.md` records that CI cannot run the shell, because
 * `ELECTRON_SKIP_BINARY_DOWNLOAD=1` keeps the platform binary out of CI and the
 * proofs are a local `pnpm shell:smoke`. This process has no such constraint.
 * It is Node, spawning Node, over a loopback socket — so the supervision, the
 * protocol, the enforcement and the HTTP surface are all reachable by the test
 * suite that already runs on every push. Only the *spawning of the runner by
 * Electron* stays in the local smoke.
 *
 * ## Configuration is environment, and one variable is a secret
 *
 * `DASH_RUNNER_TOKEN` is the channel credential. It arrives in the environment
 * because that is the one channel between main and a detached child that does
 * not touch disk, and it is never written to the port file, never logged, and
 * never passed to an agent — `runner/supervisor.ts` strips it from every child
 * environment and asserts that it did.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

import { contractsDirectory } from "../lib/contracts";
import { DASH_LOCAL_PRINCIPAL } from "./execute";
import { createRunnerServer } from "./server";
import { openRunnerStore } from "./store";
import { Supervisor, loadRegistrations } from "./supervisor";

/**
 * Where DASH looks to find a runner it did not just start.
 *
 * Written after the socket is listening, so its existence means "there was a
 * runner on this port", not "one is being attempted". It holds a pid and a port
 * and nothing else — in particular not the token, because a file readable by
 * every process on the machine is not where a credential goes.
 */
export interface RunnerPortFile {
  pid: number;
  port: number;
  started_at: string;
}

export function portFilePath(dataDir: string): string {
  return path.join(dataDir, "runner.json");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set. The runner is started by DASH, not by hand.`);
  }
  return value;
}

async function main(): Promise<void> {
  const dataDir = requiredEnvironment("DASH_RUNNER_DATA_DIR");
  const token = requiredEnvironment("DASH_RUNNER_TOKEN");
  // 0 asks the OS for a free port, which is the sane default: a fixed port is a
  // collision waiting for a second install, and DASH reads the real one back
  // out of the port file.
  const requestedPort = Number(process.env.DASH_RUNNER_PORT ?? "0");

  const store = openRunnerStore(dataDir);
  const { registrations, skipped } = loadRegistrations(path.join(dataDir, "agents"));
  for (const failure of skipped) {
    console.warn(`[runner] ignoring registration ${failure.file}: ${failure.problem}`);
  }

  const supervisor = new Supervisor(registrations);
  const server = createRunnerServer({
    supervisor,
    database: store.database,
    token,
    principal: DASH_LOCAL_PRINCIPAL,
  });

  await new Promise<void>((resolve) => {
    // 127.0.0.1 explicitly, never 0.0.0.0. The contract permits loopback HTTP
    // for a local adapter and requires HTTPS for anything else; binding wider
    // would put a plaintext command channel on the network.
    server.listen(requestedPort, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : requestedPort;

  writeFileSync(
    portFilePath(dataDir),
    `${JSON.stringify({ pid: process.pid, port, started_at: new Date().toISOString() } satisfies RunnerPortFile, null, 2)}\n`,
    "utf8",
  );

  console.warn(`[runner] listening on http://127.0.0.1:${String(port)} pid=${String(process.pid)}`);
  console.warn(`[runner] store: ${dataDir}`);
  console.warn(`[runner] contracts: ${contractsDirectory()}`);
  console.warn(`[runner] supervising ${String(registrations.length)} registered agent(s)`);

  /**
   * Shut down once, whatever arrives.
   *
   * Agents are stopped before the socket closes, so a DASH that is still up
   * sees "not running" rather than a connection refused it would have to guess
   * about. The store is closed last: an agent exiting can still settle a
   * command result on its way out.
   */
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.warn(`[runner] ${signal}: stopping agents`);
    supervisor.stopAll();
    server.close(() => {
      store.close();
      process.exit(0);
    });
    // A socket with a wedged keep-alive connection must not stop the runner
    // from exiting when it was asked to.
    setTimeout(() => {
      store.close();
      process.exit(0);
    }, 8_000).unref();
  };

  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
  process.on("SIGINT", () => { shutdown("SIGINT"); });
}

void main().catch((error: unknown) => {
  console.error(
    `[runner] failed to start: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exit(1);
});
