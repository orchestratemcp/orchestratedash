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

import { encodeBrokerResponse } from "../lib/broker/protocol";
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
import { hostBrokerFor } from "./host-broker";
import { RunnerChief } from "./chief";
import { DiscordNotifier } from "./notify";
import { RunnerSchedule } from "./schedule";
import { createRunnerServer } from "./server";
import { RUNNER_BUILD_ID, RUNNER_PROTOCOL_VERSION } from "./identity";
import { channelSecretFingerprint, clearSessionKey, writeSessionKey } from "./session-key";
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
  /**
   * SHA-256 over the channel secret this runner resolved, truncated (MAR-520).
   *
   * Not a secret, and the module that computes it says at length why. What it
   * buys is that a caller holding a candidate key learns *before it connects*
   * whether that key is this runner's — so "you have the wrong credential" stops
   * being indistinguishable from "the runner is wedged", which is the state a
   * live unretirable runner was left in on 2026-08-07.
   *
   * Optional because a runner from an earlier build wrote a file without it, and
   * a reader that required it would decline to talk to exactly the stale runner
   * this field exists to help retire.
   */
  channel_secret_fingerprint?: string;
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
  /*
   * MAR-520. Written here, before the endpoint exists, so there is never a
   * moment at which this runner is reachable and nothing on disk says how to
   * stop it. `runner/session-key.ts` has the whole argument; the short version
   * is that `runner.key` records what the *spawner* believes and this records
   * what the *runner* is using, and a runner nobody can authenticate to is one
   * only a machine restart can retire.
   */
  writeSessionKey(dataDir, secret);
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

  /**
   * The notifier (MAR-588).
   *
   * Constructed unconditionally and idle until DASH posts an address to
   * `POST /notify/discord`: with no configuration it accepts observations and
   * drops them, so there is no branch anywhere else in this file for "was a
   * channel set up". It holds the address in memory only and is gone with this
   * process — `runner/notify.ts` explains why that is the honest shape rather
   * than a gap to close.
   */
  const notifier = new DiscordNotifier();

  /**
   * The chief, riding along (MAR-743, ADR 0028).
   *
   * Constructed unconditionally and idle for the same reason the notifier is:
   * with no configuration it opens no socket, holds no credential and answers
   * nothing, so there is no branch anywhere else in this file for "did somebody
   * connect Discord". DASH posts one to `POST /chief/discord` and takes it away
   * on the same route.
   *
   * `database` is a **function** rather than the handle, because a damaged store
   * can be retired and re-opened under a running runner (MAR-506) — the same
   * reason `createRunnerServer` takes one. A chief holding the old handle would
   * spool into a database the runner had just abandoned.
   */
  const chief = new RunnerChief({
    database: () => store?.database ?? null,
    log: (line) => {
      console.warn(line);
    },
  });

  /**
   * The host broker, when this runner is on a host that has a pack (MAR-629,
   * ADR 0021).
   *
   * Null in DASH's own runner, because `electron/runner-process.ts` sets neither
   * variable — so the local path is untouched and broker requests go on being
   * buffered for the broker in Electron. Non-null only when
   * `scripts/host-helper/main.ts` started this process and proved a pack, which
   * is the one situation in which there is nobody to drain those requests and a
   * key on this machine to answer them with.
   *
   * Built before the supervisor because the supervisor takes it, and the
   * ordering is worth a sentence: a broker attached later would leave a window
   * in which an agent started by a previous run could write a request that got
   * buffered instead of answered, and a request in the wrong place is one an
   * agent waits out.
   */
  const hostBroker = hostBrokerFor(
    {
      hostRoot: process.env["DASH_HOST_ROOT"],
      bundleId: process.env["DASH_HOST_BUNDLE_ID"],
      dataDir,
      registrations,
      log: (line) => {
        console.warn(line);
      },
    },
    { fetchImpl: fetch, now: () => new Date() },
  );

  const supervisor = new Supervisor(
    registrations,
    undefined,
    (agentId, message) => {
      if (workspace === null) {
        console.warn(`[runner] ${agentId} published a file before the workspace was open`);
        return;
      }
      workspace.onArtifactFile(agentId, message);
    },
    (agentId, title, event) => {
      if (event.kind === "artifact") {
        notifier.observeArtifact(agentId, title, event.artifact);
        return;
      }
      notifier.observeState(agentId, title, event.state);
    },
    // Undefined off a host, which is what keeps every local runner on exactly
    // the path it was on before this pack existed.
    hostBroker === null
      ? undefined
      : async (agentId, request) => {
          const response = await hostBroker.adjudicate(agentId, request);
          return response === null ? null : encodeBrokerResponse(response);
        },
  );

  /**
   * The scheduler (MAR-742 item 8, ADR 0029).
   *
   * Constructed unconditionally and idle for the notifier's and the chief's
   * reason: with nothing pushed it holds an empty set, fires nothing, and there
   * is no branch anywhere else in this file for "has anybody set a schedule".
   * DASH pushes the whole set on every evidence poll and takes it away by
   * pushing one without it.
   *
   * After the supervisor because it takes it, and that ordering is the feature:
   * a scheduled fire is `supervisor.start` followed by a `retry` through
   * `executeCommand`, which is ADR 0022's two acts and no new verb.
   *
   * `database` is a **function** rather than the handle, `RunnerChief`'s reason
   * verbatim: a damaged store can be retired and re-opened under a running
   * runner, and a scheduler holding the old handle would spool into a database
   * the runner had just abandoned.
   */
  const schedule = new RunnerSchedule({
    database: () => store?.database ?? null,
    supervisor,
    log: (line) => {
      console.warn(line);
    },
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
    // Before the store closes and the socket goes. A queued notification whose
    // delivery outlived the runner would be a message about an agent that is no
    // longer running, arriving after the fact, from a process that is meant to
    // be gone (MAR-588).
    notifier.stop();
    // Beside the notifier, for its reason and one of its own: a gateway socket
    // left open would go on receiving messages the chief can no longer answer,
    // and the person would be talking to a process that is on its way out.
    chief.stop();
    /*
     * Before the store closes, beside the other two, and for a reason of its
     * own: a timer that fired during shutdown would start an agent the line
     * above has just stopped, and the person would be left with a child process
     * the runner that spawned it is no longer around to supervise.
     */
    schedule.stop();
    const finish = (): never => {
      store?.close();
      releaseEndpoint(endpoint);
      // MAR-520. A session key on disk means "a runner is alive with this
      // credential". Removed last, beside the socket, so the claim stops being
      // true at the same moment the runner does.
      clearSessionKey(dataDir);
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
    configureNotifier: (configuration) => {
      notifier.configure(configuration);
    },
    // MAR-743, ADR 0028. The chief's second room, handed over on the same
    // authenticated channel and on the same cadence as the notifier's.
    configureChief: (configuration) => {
      chief.configure(configuration);
    },
    drainChief: () => chief.drain(),
    // MAR-742 item 8, ADR 0029. The standing instructions, handed over on the
    // same authenticated channel as the notifier's address and the chief's
    // snapshot — and on a faster cadence, because unlike those two this one is
    // re-asserted whole on every evidence poll rather than pushed on a change.
    configureSchedules: (configuration) => {
      schedule.configure(configuration);
    },
    drainSchedules: () => schedule.drain(),
    // MAR-745. The read side of `configureChief`, so DASH's settings row can
    // ask what the runner actually has rather than trusting that a push landed.
    describeChief: () => chief.describe(),
    storeDamage: () => storeDamage,
    // MAR-629, ADR 0021. The remote half of `electron/main.ts`'s one line: a
    // person's Run on this host opens the allowance on this host, and nothing
    // else on this machine may open one. Absent off a host, where there is
    // nothing that could spend.
    allowRunSpend: hostBroker === null ? undefined : (agentId, at) => {
      hostBroker.allowRunSpend(agentId, at);
    },
    /**
     * MAR-520. The second half of MAR-506's two detections, connected.
     *
     * A store that passed `quick_check` at open and threw later is damage this
     * runner has now observed, and recording it is what makes `/store/retire`
     * reachable — it refuses outright while `storeDamage` is null. Everything
     * downstream of `storeDamage()` follows from the same line: `/health` stops
     * claiming `ok`, and the routes that need a database stop being tried.
     *
     * It is only ever set, never cleared here. Clearing belongs to
     * `retireStore`, which is the one place that knows the damage was dealt
     * with rather than merely not seen again.
     */
    onStoreDamage: (damage) => {
      if (storeDamage !== null) {
        return;
      }
      storeDamage = damage;
      console.error(
        `[runner] the runner's own records failed mid-request (${damage.kind}): ${damage.detail}`,
      );
      console.error("[runner] supervising nothing until they are repaired or set aside");
    },
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
      /*
       * MAR-520. Closed before it is moved, and this is the difference between
       * a repair and a repair that cannot run on Windows.
       *
       * `openRunnerStore` closes the handle itself when the *open-time* probe
       * finds damage, so on that path there is nothing open and a rename
       * succeeds. The runtime path is the opposite: a store that opened
       * cleanly and threw later is still open, held by this process, and
       * `renameSync` on a file SQLite has open answers `EBUSY` on Windows —
       * measured, not assumed. Since the main database is moved first, the
       * whole repair failed on its first step and reported the operating
       * system's word for "no" to somebody who had asked DASH to fix their
       * records.
       *
       * The workspace is detached with it: it holds a handle on the same
       * database, so a close that left it attached would leave the runner
       * answering file questions out of a closed store.
       */
      store?.close();
      store = null;
      attachWorkspace();

      const outcome = retireDamagedStore(dataDir, RUNNER_STORE_FILE, new Date());
      if (!outcome.ok) {
        // The files are back where they were (`retireDamagedStore` rolls its
        // own moves back), so the honest thing is to reopen what we closed.
        // A runner left with no store after a failed repair would answer every
        // route with "unreadable" for a reason that is no longer true.
        const reopened = openRunnerStore(dataDir);
        if (reopened.ok) {
          store = reopened.store;
          attachWorkspace();
        }
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

  /*
   * MAR-742 item 8, ADR 0029. The loop starts once the endpoint is up.
   *
   * After listening, so that a runner which cannot be reached is also a runner
   * that has not yet started anything: the first thing DASH does on this channel
   * is push the current set, and a scheduler that had already ticked would have
   * ticked against an empty one — which for a machine that has just woken up is
   * the difference between "your 08:00 run was missed" and silence.
   *
   * ## What it starts with (MAR-785, ADR 0030 decision 5)
   *
   * Until this packet, the answer was "nothing, until DASH pushes" — which was
   * correct while DASH was the only thing that could start a runner, and stopped
   * being enough the moment Windows could start one at login with DASH never
   * opened. So the set this runner was last told is read back from its own store
   * first, and `restore` parses it with the same function the channel's body
   * goes through.
   *
   * The line is written whether or not anything came back. After a reboot where
   * nobody opened DASH, `runner.log` is the only place on the machine that says
   * what the login produced, and "restored 0" and silence have to be different
   * sentences.
   */
  const restored = schedule.restore();
  console.warn(
    `[runner] standing schedules: ${restored ? "restored from this runner's own store" : "none remembered; waiting for DASH"}`,
  );
  schedule.start();

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
        channel_secret_fingerprint: channelSecretFingerprint(secret),
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
