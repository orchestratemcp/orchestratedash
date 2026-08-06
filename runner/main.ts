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
 * It is Node, spawning Node, over an OS-local socket — so the supervision, the
 * protocol, the enforcement and the HTTP surface are all reachable by the test
 * suite that already runs on every push. Only the *spawning of the runner by
 * Electron* stays in the local smoke.
 *
 * ## Configuration, and where the credential went
 *
 * MAR-415 passed `DASH_RUNNER_TOKEN` in the environment, on the argument that
 * it was the one channel to a detached child that did not touch disk. MAR-430
 * removes it. The credential is now minted and read through
 * `runner/channel-secret.ts`, in a file whose ACL this project sets and then
 * proves — which is what let the OS vault stop being a precondition for hosting
 * a local agent at all.
 *
 * The practical consequences are both good ones: the runner can be started by
 * hand for debugging without anybody minting a token first, and a secret that
 * used to sit in an environment block — readable, on Linux, by any process of
 * the same user via `/proc/{pid}/environ` — now sits behind file permissions.
 */

import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { contractsDirectory } from "../lib/contracts";
import { ensureChannelSecret } from "./channel-secret";
import {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
  type RunnerEndpoint,
} from "./endpoint";
import { DASH_LOCAL_PRINCIPAL } from "./execute";
import { createRunnerServer } from "./server";
import { RUNNER_BUILD_ID, RUNNER_PROTOCOL_VERSION } from "./identity";
import { RUNNER_STORE_FILE, openRunnerStore, type RunnerStore } from "./store";
import { retireDamagedStore, type RunnerStoreDamage } from "./store-damage";
import { Supervisor, loadRegistrations } from "./supervisor";
import { createTaskWorkspaceApi, type TaskWorkspaceApi } from "./task-api";
import { openWorkspaceRoot } from "./workspace";

/**
 * Where DASH looks to find a runner it did not just start.
 *
 * Written after the endpoint is listening, so its existence means "there was a
 * runner on this endpoint", not "one is being attempted". It holds a pid and a
 * path and nothing else — in particular not the channel secret, because a file
 * readable by every process on the machine is not where a credential goes. The
 * secret is in `runner.key` next to it, and that file is not readable by every
 * process on the machine; that is the whole difference and it is deliberate.
 */
export interface RunnerEndpointFile {
  pid: number;
  /** The Unix socket path or Windows pipe name. Not a secret. */
  endpoint: string;
  transport: "unix" | "pipe";
  started_at: string;
  runner_protocol: number;
  runner_build: string;
}

export function endpointFilePath(dataDir: string): string {
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
  /**
   * DASH mints this per spawn so the endpoint name cannot be guessed in
   * advance. Optional here so the runner stays runnable by hand: a debugging
   * session that has to invent one is a debugging session that will paste the
   * same value twice and then wonder why the second runner refused to start.
   */
  const endpointId =
    process.env["DASH_RUNNER_ENDPOINT_ID"] ?? randomBytes(12).toString("hex");

  const secret = ensureChannelSecret(dataDir);
  const endpoint: RunnerEndpoint = runnerEndpoint(dataDir, endpointId);
  await prepareEndpoint(endpoint);

  /*
   * MAR-506. The store either opens or names why it did not, and a runner whose
   * records are unreadable **supervises nothing**.
   *
   * That is a decision rather than a consequence. Nothing here technically
   * prevents spawning the children — the supervisor does not need the database
   * to start a process. What it needs it for is replay protection, idempotency
   * and the approval record, which is to say every guarantee DASH renders about
   * a command being carried out once and having been approved by somebody. An
   * agent running against a store that cannot record is an agent whose
   * guarantees DASH is still printing and no longer keeping, and that is worse
   * than an agent that is not running, because the second one is visible.
   *
   * It still listens. `/health` says so, `/store/retire` repairs it, and
   * `/shutdown` stops it — a runner that exited here would leave DASH with
   * "the runner did not start", which names nothing and offers no repair.
   */
  const opened = openRunnerStore(dataDir);
  let storeDamage: RunnerStoreDamage | null = opened.ok ? null : opened.damage;
  let store: RunnerStore | null = opened.ok ? opened.store : null;
  if (storeDamage !== null) {
    console.error(
      `[runner] the runner's own records cannot be read (${storeDamage.kind}): ${storeDamage.detail}`,
    );
    console.error("[runner] supervising nothing until they are repaired or set aside");
  }

  const registrationsDir = path.join(dataDir, "agents");
  const { registrations, skipped } =
    storeDamage === null
      ? loadRegistrations(registrationsDir)
      : { registrations: [], skipped: [] };
  for (const failure of skipped) {
    console.warn(`[runner] ignoring registration ${failure.file}: ${failure.problem}`);
  }

  /**
   * The task workspace and the supervisor need each other (MAR-434): the
   * workspace dispatches down a child's pipe, and the supervisor calls the
   * workspace the instant a child publishes a file. Neither can be constructed
   * with the other already in hand.
   *
   * Broken with a `let` and two closures rather than by giving one of them a
   * setter. A setter would make "is the workspace attached yet" a question with
   * a window in which the answer is no, and that window is exactly when a child
   * started by a previous run could be writing. The closures capture a binding
   * that is assigned before any agent can start, and the guard below says what
   * happens if that ordering is ever broken instead of dereferencing null.
   */
  let workspace: TaskWorkspaceApi | null = null;

  const supervisor = new Supervisor(registrations, undefined, (agentId, message) => {
    if (workspace === null) {
      console.warn(`[runner] ${agentId} published a file before the workspace was open`);
      return;
    }
    workspace.onArtifactFile(agentId, message);
  });

  /**
   * Attach the workspace to whatever store is currently open (MAR-506).
   *
   * A function rather than one expression because it happens twice: at startup,
   * and again after a damaged store has been set aside. The workspace holds a
   * database handle, so a retire that left the old one attached would leave the
   * runner answering file questions out of a database it had just abandoned.
   */
  const attachWorkspace = (): void => {
    workspace =
      store === null
        ? null
        : createTaskWorkspaceApi({
            database: store.database,
            root: openWorkspaceRoot(dataDir),
            dispatchToChild: (agentId, task) => supervisor.dispatchTask(agentId, task),
          });
  };
  attachWorkspace();

  let server: ReturnType<typeof createRunnerServer>;
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.warn(`[runner] ${signal}: stopping agents`);
    supervisor.stopAll();
    const finish = (): never => {
      store?.close();
      releaseEndpoint(endpoint);
      process.exit(0);
    };
    server.close(finish);
    // An endpoint with a wedged keep-alive connection must not stop the runner
    // from exiting when it was asked to.
    setTimeout(finish, 8_000).unref();
  };

  server = createRunnerServer({
    supervisor,
    database: () => store?.database ?? null,
    workspace: () => workspace ?? undefined,
    storeDamage: () => storeDamage,
    /**
     * MAR-506. The repair, and it is the reason the recovery copy ends in an
     * action rather than in "report this".
     *
     * It renames rather than deletes (`retireDamagedStore` says why), and the
     * runner then reopens: this is the one place `storeDamage` is cleared, so a
     * repaired runner starts answering its ordinary routes without being
     * restarted. Agents are deliberately **not** started here — the user asked
     * for the records to be set aside, not for their fleet to be launched, and
     * DASH re-registers them through the reload route it already has.
     */
    retireStore: () => {
      if (storeDamage === null) {
        return { ok: false as const, detail: "There is nothing to set aside." };
      }
      const outcome = retireDamagedStore(dataDir, RUNNER_STORE_FILE, new Date());
      if (!outcome.ok) {
        return { ok: false as const, detail: outcome.detail };
      }
      const reopened = openRunnerStore(dataDir);
      if (!reopened.ok) {
        // The old file moved and the new one is damaged too, which points at
        // the disk rather than at the file. Reported as a failure with the new
        // classification rather than as a success, because the user was about
        // to be told this was fixed.
        storeDamage = reopened.damage;
        return {
          ok: false as const,
          detail: `The records were set aside and a fresh store could not be created: ${reopened.damage.detail}`,
        };
      }
      store = reopened.store;
      storeDamage = null;
      attachWorkspace();
      console.warn(`[runner] store set aside as ${outcome.retired.moved_to}; a fresh one is open`);
      return { ok: true as const, ...outcome.retired };
    },
    token: secret,
    principal: DASH_LOCAL_PRINCIPAL,
    /**
     * MAR-428. The directory is read again, here, rather than the caller
     * sending its contents: a reload that accepted registrations over the wire
     * would be the remote shell `runner/README.md` refuses to build, wearing a
     * different name. DASH asks the runner to look; the filesystem answers.
     */
    reload: () => {
      const fresh = loadRegistrations(registrationsDir);
      for (const failure of fresh.skipped) {
        console.warn(`[runner] ignoring registration ${failure.file}: ${failure.problem}`);
      }
      return { ...supervisor.adopt(fresh.registrations), skipped: fresh.skipped };
    },
    shutdown: () => {
      shutdown("control request");
    },
  });

  await listenOnEndpoint(server, endpoint);

  writeFileSync(
    endpointFilePath(dataDir),
    `${JSON.stringify(
      {
        pid: process.pid,
        endpoint: endpoint.path,
        transport: endpoint.transport,
        started_at: new Date().toISOString(),
        runner_protocol: RUNNER_PROTOCOL_VERSION,
        runner_build: RUNNER_BUILD_ID,
      } satisfies RunnerEndpointFile,
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.warn(
    `[runner] listening on ${endpoint.path} pid=${String(process.pid)} ` +
      `protocol=${String(RUNNER_PROTOCOL_VERSION)} build=${RUNNER_BUILD_ID}`,
  );
  console.warn(`[runner] store: ${dataDir}`);
  console.warn(`[runner] contracts: ${contractsDirectory()}`);
  console.warn(`[runner] supervising ${String(registrations.length)} registered agent(s)`);

  /**
   * Shut down once, whatever arrives.
   *
   * Agents are stopped before the endpoint closes, so a DASH that is still up
   * sees "not running" rather than a connection refused it would have to guess
   * about. The store is closed last: an agent exiting can still settle a
   * command result on its way out. The socket is unlinked at the very end, so
   * the only path that ever leaves one behind is a crash — which is exactly the
   * case `prepareEndpoint` is written to recover from.
   */
  process.on("SIGTERM", () => { shutdown("SIGTERM"); });
  process.on("SIGINT", () => { shutdown("SIGINT"); });
}

void main().catch((error: unknown) => {
  console.error(
    `[runner] failed to start: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exit(1);
});
