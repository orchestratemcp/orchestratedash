/**
 * The host helper: the closed verb set, on the machine DASH does not administer
 * (MAR-487, ADR 0007).
 *
 * ```
 * ssh host install    <- one JSON request on stdin, one JSON answer on stdout
 * ssh host start
 * ssh host stop
 * ssh host status
 * ssh host collect
 * ssh host connect    <- joins the runner's socket to stdio; not JSON
 * ssh host channel    <- hands back the credential that pipe is spoken with
 * ssh host uninstall  <- takes one bundle off this machine
 * ```
 *
 * ## What this is a boundary against, said plainly
 *
 * Not against the host. DASH holds a key that could run anything there, and
 * ADR 0007 refuses to pretend otherwise:
 *
 * > This is not a security boundary against the host — DASH holds a key that
 * > could run anything, and pretending otherwise would be the dishonesty ADR
 * > 0006 spends its length avoiding. It is a boundary against **DASH itself**:
 * > a bug, a bad manifest, or a hostile build brief cannot turn a deploy into
 * > arbitrary remote execution, because the string DASH sends is drawn from a
 * > fixed set.
 *
 * So the value of this file is what it *cannot* be asked to do. There is no
 * verb that takes a command, no verb that takes a path, and no branch anywhere
 * below that passes a caller-supplied string to a shell. `start` spawns
 * `node start.mjs` because **this file decided that**, not because a request
 * said so — which is `runner/README.md`'s sentence, moved one machine over:
 * *the API chooses which registration to start, never what to run.*
 *
 * ## Why the request is on stdin
 *
 * `ssh` takes its options as argv and argv has no quoting layer to get wrong.
 * `lib/hosts.ts` refuses a leading `-` on every component that reaches it for
 * that reason. Keeping *all* variable data off argv means the set of strings
 * `ssh` can be made to interpret is fixed when this repository is compiled, and
 * a bundle's file list could never have gone there in any case.
 *
 * ## Every path is checked here, not only where it was written
 *
 * A bundle carries relative file names, and they are validated with
 * `runner/path-guard.ts` — the module MAR-434 wrote for a child running as the
 * same user as the runner, whose Windows rules deliberately run on every
 * platform. Checked on this side rather than only in DASH, because a check that
 * lives only in the sender is a check a different sender does not perform, and
 * this program's whole job is to be the thing standing between an `ssh` session
 * and a filesystem.
 *
 * ## The root, and what is never above it
 *
 * Everything lives under `~/.orchestratedash-host/` (or `DASH_HOST_ROOT`), and
 * every path this program writes is `join(root, bundles, <validated id>, <validated
 * relative name>)` re-checked for containment afterwards. An id cannot spell a
 * path — `lib/deploy/verbs.ts` says why its alphabet excludes every separator —
 * so there is no arithmetic by which a request escapes.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  MAX_COLLECT_LINES,
  checkDeployRequest,
  type DeployAnswer,
  type DeployRequest,
  type HostBundleStatus,
  type InstallRequest,
} from "../../lib/deploy/verbs";
import { containedIn, inspectComponent } from "../../runner/path-guard";

/* ---------------------------------------------------------------------- *
 * Where things live on the host
 * ---------------------------------------------------------------------- */

function hostRoot(): string {
  return process.env["DASH_HOST_ROOT"] ?? path.join(os.homedir(), ".orchestratedash-host");
}

function bundleDirectory(root: string, bundleId: string): string {
  return path.join(root, "bundles", bundleId);
}

/**
 * One record per installed bundle, beside the bundle rather than in it.
 *
 * Beside, because `install` replaces a bundle's files and the record has to
 * survive that — the pid of a runner started from the previous install is
 * exactly the thing a `status` after a re-install needs to be honest about.
 */
interface BundleRecord {
  bundle_id: string;
  agent_id: string;
  runner_build: string;
  installed_at: string;
  pid: number | null;
}

function recordPath(root: string, bundleId: string): string {
  return path.join(root, "bundles", `${bundleId}.json`);
}

function readRecord(root: string, bundleId: string): BundleRecord | null {
  const file = recordPath(root, bundleId);
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as BundleRecord;
  } catch {
    return null;
  }
}

function writeRecord(root: string, record: BundleRecord): void {
  mkdirSync(path.join(root, "bundles"), { recursive: true, mode: 0o700 });
  writeFileSync(recordPath(root, record.bundle_id), `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/* ---------------------------------------------------------------------- *
 * install
 * ---------------------------------------------------------------------- */

function install(root: string, request: InstallRequest): DeployAnswer {
  const directory = bundleDirectory(root, request.bundle_id);

  /*
   * Validated before a byte is written, all of them, so a bundle with one bad
   * name does not leave a half-installed directory behind. The same
   * all-or-nothing instinct MAR-520 put into `retireDamagedStore`, applied
   * where the failure is a caller rather than a filesystem.
   */
  for (const file of request.files) {
    if (path.isAbsolute(file.path) || /^[a-zA-Z]:/.test(file.path)) {
      return {
        ok: false,
        problem: "malformed_files",
        detail: "A bundle file named a location outside the bundle.",
      };
    }
    /*
     * `inspectComponent` per segment rather than `inspectPathSyntax` on the
     * whole string, and the difference matters. `inspectPathSyntax` answers
     * about a path a caller *chose*, so it requires an absolute one; a bundle
     * name is relative by construction and would be refused as `not_absolute`
     * before any of the interesting rules ran.
     *
     * Per-component is also the stronger question, and it is the one MAR-434
     * wrote that function for: `..`, a colon that would open an alternate data
     * stream, a trailing dot or space that Windows silently strips, a control
     * character that truncates the name inside a native call, and every
     * reserved device name at any depth — `NUL`, `COM1`, `AUX` — are each a
     * property of a single component, and every one of them applies here for
     * exactly the reason it applies to a file a child published.
     */
    for (const component of file.path.split("/")) {
      const problem = inspectComponent(component);
      if (problem !== null) {
        return {
          ok: false,
          problem: "malformed_files",
          // The refusal class, never the name. A path that reached this branch
          // is one the helper by definition did not vouch for, and this string
          // goes into an answer DASH renders.
          detail: `A bundle file's name was refused: ${problem.refusal}.`,
        };
      }
    }
  }

  // A re-install replaces rather than merges. A merged directory would hold two
  // runner builds' files at once, and the one that ran would be whichever the
  // entry point happened to import.
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true, mode: 0o700 });

  let bytes = 0;
  for (const file of request.files) {
    const target = path.join(directory, file.path);
    // Belt and braces behind the syntax check: the arithmetic is re-run on the
    // joined result, so a name that survived validation and still escapes is
    // caught by the containment question rather than by trust.
    if (!containedIn(directory, target)) {
      return {
        ok: false,
        problem: "malformed_files",
        detail: "A bundle file resolved outside the bundle directory.",
      };
    }
    const content = Buffer.from(file.content_base64, "base64");
    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== file.sha256) {
      return {
        ok: false,
        problem: "digest_mismatch",
        detail: "A bundle file did not arrive as it was sent.",
      };
    }
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, content, { mode: file.mode });
    bytes += content.byteLength;
  }

  // Re-read and re-hash from where they landed, rather than trusting what was
  // written — MAR-434's discipline for a registered artifact, and the same
  // reason: the digest on a receipt should describe the bytes in the file the
  // receipt points at.
  for (const file of request.files) {
    const written = readFileSync(path.join(directory, file.path));
    if (createHash("sha256").update(written).digest("hex") !== file.sha256) {
      return {
        ok: false,
        problem: "digest_mismatch",
        detail: "A bundle file did not match its digest after it was written.",
      };
    }
  }

  const existing = readRecord(root, request.bundle_id);
  writeRecord(root, {
    bundle_id: request.bundle_id,
    agent_id: request.agent_id,
    runner_build: request.runner_build,
    installed_at: new Date().toISOString(),
    // Carried across a re-install deliberately: a runner from the previous
    // install may still be alive, and forgetting its pid would make `status`
    // report "not running" about a process that is.
    pid: existing?.pid ?? null,
  });

  return { ok: true, verb: "install", bundle_id: request.bundle_id, files: request.files.length, bytes };
}

/* ---------------------------------------------------------------------- *
 * start / stop / status / collect
 * ---------------------------------------------------------------------- */

/**
 * Run the installed bundle.
 *
 * **The command is this file's, not the request's.** `node start.mjs` is what
 * MAR-497's standalone artifact documents as its own entry point, and the
 * request carries no command, no interpreter, no arguments and no environment.
 * A request that could name any of those would make this an `exec` endpoint
 * with a JSON costume.
 *
 * Detached with no pipes, for `electron/runner-process.ts`'s reason: a process
 * whose parent exits would otherwise write into a closed stdout and die of
 * EPIPE the first time it logged. Here the parent is an `ssh` session that ends
 * in a moment, which is the point of deploying at all.
 */
function start(root: string, bundleId: string): DeployAnswer {
  const record = readRecord(root, bundleId);
  if (record === null) {
    return { ok: false, problem: "not_installed", detail: "No bundle is installed under that name." };
  }
  const directory = bundleDirectory(root, bundleId);
  const entry = path.join(directory, "start.mjs");
  if (!existsSync(entry)) {
    return {
      ok: false,
      problem: "not_installed",
      detail: "The installed bundle has no entry point, so there is nothing to start.",
    };
  }
  if (record.pid !== null && processAlive(record.pid)) {
    return { ok: true, verb: "start", bundle_id: bundleId, pid: record.pid };
  }

  const dataDir = path.join(directory, "data");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const logFile = path.join(directory, "runner.log");

  const child = spawn(process.execPath, [entry], {
    cwd: directory,
    detached: true,
    stdio: ["ignore", openAppend(logFile), openAppend(logFile)],
    env: {
      ...process.env,
      DASH_RUNNER_DATA_DIR: dataDir,
    },
  });
  child.unref();

  const pid = child.pid ?? null;
  writeRecord(root, { ...record, pid });
  return pid === null
    ? { ok: false, problem: "start_failed", detail: "The runner did not start." }
    : { ok: true, verb: "start", bundle_id: bundleId, pid };
}

/**
 * Ask the runner to stop, through its own authenticated route.
 *
 * The host's version of AGENTS.md's process-safety rule, and it works here for
 * a reason MAR-520 built: the runner records the channel secret it actually
 * resolved, under an owner-only ACL, beside the endpoint file. So a helper that
 * did not start this runner — a later `ssh` session, which is every session —
 * can still authenticate to it. Before that, the only thing on the far end of a
 * `stop` would have been a signal.
 *
 * A runner that cannot be reached is reported as not stopped, with the reason.
 * Nothing here escalates to a signal: a runner holding somebody's agent history
 * is the exact process this project has already corrupted a store by killing.
 */
async function stop(root: string, bundleId: string): Promise<DeployAnswer> {
  const record = readRecord(root, bundleId);
  if (record === null) {
    return { ok: false, problem: "not_installed", detail: "No bundle is installed under that name." };
  }
  if (record.pid === null || !processAlive(record.pid)) {
    writeRecord(root, { ...record, pid: null });
    return { ok: true, verb: "stop", bundle_id: bundleId, stopped: true, detail: "It was not running." };
  }

  const dataDir = path.join(bundleDirectory(root, bundleId), "data");
  const endpointFile = path.join(dataDir, "runner.json");
  const sessionKeyFile = path.join(dataDir, "runner.session.key");
  if (!existsSync(endpointFile) || !existsSync(sessionKeyFile)) {
    return {
      ok: true,
      verb: "stop",
      bundle_id: bundleId,
      stopped: false,
      detail:
        "The runner is running and did not leave a way to sign in to it, so the helper cannot ask " +
        "it to stop. Restarting the server is the only way to clear it.",
    };
  }

  let endpoint: string;
  let secret: string;
  try {
    endpoint = (JSON.parse(readFileSync(endpointFile, "utf8")) as { endpoint: string }).endpoint;
    secret = readFileSync(sessionKeyFile, "utf8").trim();
  } catch {
    return {
      ok: true,
      verb: "stop",
      bundle_id: bundleId,
      stopped: false,
      detail: "The runner's own records could not be read, so the helper cannot ask it to stop.",
    };
  }

  const answered = await postShutdown(endpoint, secret);
  if (answered) {
    writeRecord(root, { ...record, pid: null });
  }
  return {
    ok: true,
    verb: "stop",
    bundle_id: bundleId,
    stopped: answered,
    detail: answered ? "The runner was asked to stop and agreed." : "The runner did not answer.",
  };
}

function status(root: string, bundleId?: string): DeployAnswer {
  const directory = path.join(root, "bundles");
  const ids =
    bundleId !== undefined
      ? [bundleId]
      : existsSync(directory)
        ? readdirSync(directory)
            .filter((name) => name.endsWith(".json"))
            .map((name) => name.slice(0, -".json".length))
        : [];

  const bundles: HostBundleStatus[] = [];
  for (const id of ids) {
    const record = readRecord(root, id);
    if (record === null) {
      continue;
    }
    const running = record.pid !== null && processAlive(record.pid);
    bundles.push({
      bundle_id: record.bundle_id,
      agent_id: record.agent_id,
      runner_build: record.runner_build,
      installed_at: record.installed_at,
      running,
      // Reported as gone rather than as a number that no longer names anything.
      pid: running ? record.pid : null,
    });
  }
  return { ok: true, verb: "status", bundles };
}

/**
 * The host's own account of a bundle.
 *
 * Deliberately the runner's log and nothing else. Run evidence — telemetry,
 * artifacts, what an agent actually did — travels on the **control** plane,
 * over `connect`, as `lib/agent-dom/evidence.ts` pulls it. A deploy verb that
 * returned run evidence would be a second path to the same facts, and the two
 * would disagree the first time one of them changed.
 */
function collect(root: string, bundleId: string, lines: number): DeployAnswer {
  const file = path.join(bundleDirectory(root, bundleId), "runner.log");
  if (!existsSync(file)) {
    return { ok: true, verb: "collect", bundle_id: bundleId, log: [], truncated: false };
  }
  const all = readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.length > 0);
  const tail = all.slice(-lines);
  return {
    ok: true,
    verb: "collect",
    bundle_id: bundleId,
    log: tail,
    // Reported rather than silently applied, which is `GET /workspace-artifacts`'s
    // rule: a truncation a caller cannot see is a caller believing it has
    // everything.
    truncated: tail.length < all.length,
  };
}

/* ---------------------------------------------------------------------- *
 * uninstall — the only verb that removes anything (MAR-611)
 * ---------------------------------------------------------------------- */

/**
 * Take one bundle off this machine.
 *
 * ## The refusal is the feature
 *
 * `install` already removes a bundle's directory — `rmSync(directory, {
 * recursive: true, force: true })`, so a re-install replaces rather than merges
 * — so this is not a new capability on the host any more than `channel` was. It
 * is the same `rmSync` reached deliberately rather than as a step on the way to
 * writing something back.
 *
 * What is new is that nothing is written afterwards, and that changes what the
 * call has to check. **A running runner is refused**, and it is refused here
 * rather than only in DASH:
 *
 * - A directory removed out from under a live process leaves a runner writing
 *   into a deleted tree, on a machine nobody is watching, holding somebody's
 *   agent history. It is the quiet version of the force-kill AGENTS.md forbids —
 *   `stop` already declines to escalate to a signal for that exact reason, and a
 *   verb that deleted the process's world instead would be doing worse by
 *   another route.
 * - A rule that lived only in the sender is a rule the host does not have. That
 *   is `checkDeployRequest`'s argument for running on both ends, and it applies
 *   with more force to the one verb whose mistake cannot be undone.
 *
 * So the order — stop, then uninstall — is a property of this program, and the
 * copy-before-remove order is a property of `lib/deploy/bring-home.ts`. Two
 * halves of the same discipline, kept in the two places that can each see one.
 *
 * ## What goes, and what stays
 *
 * The bundle directory and the record beside it: the agent's files, the runner
 * that served it, its log, and its `data/` — which holds the runner's own store
 * and is where the host's account of what that agent did lives. That last one is
 * why DASH copies first, and why this returns nothing about what it destroyed:
 * a verb that summarised the evidence on its way past would be a second path to
 * facts the control plane already owns, and the two would disagree the first
 * time either changed.
 *
 * Nothing above the bundle is touched. The root stays, the other bundles stay,
 * and the helper and the allowed-keys line stay — removing DASH from a server
 * entirely is the printed step the setup script ends with, performed by a person
 * on the machine they administer.
 */
function uninstall(root: string, bundleId: string): DeployAnswer {
  const record = readRecord(root, bundleId);
  const directory = bundleDirectory(root, bundleId);
  if (record === null && !existsSync(directory)) {
    // Idempotent by decision, not by accident — see `DEPLOY_VERBS`. A
    // bring-home whose last step failed has to be safe to press again, and a
    // second press must not report a problem the person cannot act on.
    return {
      ok: true,
      verb: "uninstall",
      bundle_id: bundleId,
      removed: false,
      detail: "There was nothing installed under that name.",
    };
  }

  if (record !== null && record.pid !== null && processAlive(record.pid)) {
    return {
      ok: false,
      problem: "still_running",
      detail:
        "That bundle's runner is still running, so the helper will not remove the files it is " +
        "using. Ask it to stop first.",
    };
  }

  // The record last, so a failure part-way leaves the bundle findable rather
  // than leaving an orphaned directory with nothing naming it. `status` reads
  // the records, so a directory with no record is invisible to every other verb.
  try {
    rmSync(directory, { recursive: true, force: true });
    rmSync(recordPath(root, bundleId), { force: true });
  } catch (error: unknown) {
    return {
      ok: false,
      problem: "remove_failed",
      // The class and not the path. This string reaches a log on DASH's side,
      // and a filesystem error's message names directories on a machine DASH
      // does not administer.
      detail: `The files could not be removed: ${(error as { code?: string } | null)?.code ?? "unknown reason"}.`,
    };
  }

  return {
    ok: true,
    verb: "uninstall",
    bundle_id: bundleId,
    removed: true,
    detail: "The bundle and everything it held were removed.",
  };
}

/* ---------------------------------------------------------------------- *
 * connect — the control plane
 * ---------------------------------------------------------------------- */

/**
 * Join the runner's socket to this process's stdio.
 *
 * This is the verb `lib/agent-dom/ssh-fetch.ts` speaks HTTP down, and it is the
 * only one whose answer is not JSON. Nothing is parsed in either direction: the
 * bytes DASH writes go to the socket and the bytes the socket answers go to
 * stdout, so the request line, the header encoding and the response parser stay
 * Node's on DASH's side and the runner's on this one.
 */
function connect(root: string, bundleId: string): void {
  const endpointFile = path.join(bundleDirectory(root, bundleId), "data", "runner.json");
  if (!existsSync(endpointFile)) {
    process.exit(69); // EX_UNAVAILABLE — nothing to join.
  }
  const { endpoint } = JSON.parse(readFileSync(endpointFile, "utf8")) as { endpoint: string };
  const socket = net.createConnection({ path: endpoint });
  socket.on("error", () => {
    process.exit(69);
  });
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on("close", () => {
    process.exit(0);
  });
}

/* ---------------------------------------------------------------------- *
 * channel — the credential the control plane is spoken with (MAR-602)
 * ---------------------------------------------------------------------- */

/**
 * Hand back the running runner's own channel secret.
 *
 * `connect` opens the pipe and this says who to be on it. They are two verbs
 * rather than one because `connect`'s stdin is the HTTP conversation and
 * nothing may be written into it that is not HTTP — a helper that emitted a
 * credential first would put a byte in front of DASH's response parser, and the
 * property `connect` is built on is that neither side parses anything.
 *
 * **The refusals are the interesting part, and they are refusals rather than
 * empty successes.** A bundle that is not installed, a runner that is not
 * running, and a runner that left no session key are three different situations
 * with three different next steps, and MAR-600's lesson is that collapsing them
 * sends a person to the wrong end of their own problem. The third is the one
 * MAR-520 named: a runner alive with no record of the secret it resolved is
 * reachable and unauthenticable, and the honest sentence says so rather than
 * letting DASH discover it as a 401 three steps later.
 *
 * Nothing is minted here. If the runner has no session key this program does not
 * make one up — a secret this helper invented would authenticate to nothing,
 * because the runner is already using a different one.
 */
function channel(root: string, bundleId: string): DeployAnswer {
  const record = readRecord(root, bundleId);
  if (record === null) {
    return { ok: false, problem: "not_installed", detail: "No bundle is installed under that name." };
  }
  if (record.pid === null || !processAlive(record.pid)) {
    return {
      ok: false,
      problem: "not_running",
      detail: "That bundle's runner is not running, so there is nothing to sign in to.",
    };
  }

  const dataDir = path.join(bundleDirectory(root, bundleId), "data");
  const sessionKeyFile = path.join(dataDir, "runner.session.key");
  if (!existsSync(sessionKeyFile)) {
    return {
      ok: false,
      problem: "no_channel_credential",
      detail:
        "The runner is running and left no way to sign in to it. Stopping and starting it on the " +
        "server is the only way to clear that.",
    };
  }

  let token: string;
  let fingerprint: string | null = null;
  try {
    token = readFileSync(sessionKeyFile, "utf8").trim();
    // The endpoint file is secret-free by design, so a failure to read it costs
    // the cross-check and not the answer. `fingerprint` is optional in the
    // answer for exactly this case.
    const endpointFile = path.join(dataDir, "runner.json");
    if (existsSync(endpointFile)) {
      const parsed = JSON.parse(readFileSync(endpointFile, "utf8")) as {
        channel_secret_fingerprint?: unknown;
      };
      fingerprint =
        typeof parsed.channel_secret_fingerprint === "string"
          ? parsed.channel_secret_fingerprint
          : null;
    }
  } catch {
    return {
      ok: false,
      problem: "no_channel_credential",
      detail: "The runner's own records could not be read, so the helper cannot sign in to it.",
    };
  }

  /*
   * The same shape check `readSessionKey` applies on this repository's other
   * side, and for the same reason: a value that is not one of ours must not be
   * presented as a bearer token to anything. It is never quoted into the
   * refusal — the whole point of refusing is that DASH does not get this value.
   */
  if (!/^[A-Za-z0-9_-]{40,}$/.test(token)) {
    return {
      ok: false,
      problem: "no_channel_credential",
      detail: "What the runner recorded is not a credential this helper will hand on.",
    };
  }

  return { ok: true, verb: "channel", bundle_id: bundleId, token, fingerprint };
}

/* ---------------------------------------------------------------------- *
 * Small mechanics
 * ---------------------------------------------------------------------- */

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means a process with that id exists and belongs to somebody else,
    // which is still "alive" for the question being asked.
    return (error as { code?: string } | null)?.code === "EPERM";
  }
}

function openAppend(file: string): number {
  return openSync(file, "a");
}

/** `POST /shutdown` over the runner's own socket. No third-party client. */
function postShutdown(endpoint: string, secret: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.request(
      {
        socketPath: endpoint,
        path: "/shutdown",
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        timeout: 10_000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 202);
      },
    );
    request.on("error", () => {
      resolve(false);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      body += chunk;
    });
    process.stdin.on("end", () => {
      resolve(body);
    });
  });
}

function answer(value: DeployAnswer): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/* ---------------------------------------------------------------------- *
 * The one entry point
 * ---------------------------------------------------------------------- */

/**
 * What this invocation was asked to do, whichever way it was asked (MAR-573).
 *
 * Two routes reach this program and they must agree:
 *
 * - **Argv**, which is `ssh host status` and the local child a test drives.
 * - **`SSH_ORIGINAL_COMMAND`**, which is what `sshd` sets when the key that
 *   signed in carries `command="…"`. The forced command runs no matter what the
 *   client asked for, and the client's request is put in that variable for the
 *   forced program to read *or ignore*.
 *
 * ADR 0009 chose the forced command over namespacing the verbs, so this
 * function is the seam that decision needs. Argv wins when it has anything in
 * it, which keeps every existing caller — and the fixture proof in
 * `tests/deploy-bridge.test.ts`, which runs this program as a local child —
 * working exactly as before.
 *
 * **The variable is split, never interpreted.** It is a string a client chose,
 * so it is cut on whitespace and handed to `checkDeployRequest` like anything
 * else; there is no shell between here and there, no glob expansion, and no
 * branch that would run one of these tokens. A request with more than two of
 * them is refused rather than truncated: two is a verb and at most one
 * identifier, and anything longer means the far end has a different idea of
 * this protocol than this program does.
 */
export function helperArgv(argv: readonly string[], originalCommand: string | undefined): string[] {
  if (argv.length > 0) {
    return [...argv];
  }
  return (originalCommand ?? "").split(/\s+/).filter((token) => token.length > 0);
}

export async function runHelper(argv: string[]): Promise<number> {
  const root = hostRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });

  const verb = argv[0];
  if (verb === undefined) {
    answer({ ok: false, problem: "unknown_verb", detail: "No operation was named." });
    return 64; // EX_USAGE
  }
  if (argv.length > 2) {
    // A verb and at most one identifier. Refused rather than trimmed, for
    // `reviewCommand`'s reason about an unexpected field: a caller sending more
    // than this program understands has a different model of it, and quietly
    // ignoring the surplus hides that.
    answer({
      ok: false,
      problem: "unknown_verb",
      detail: "More was sent than an operation and one name.",
    });
    return 64;
  }

  /*
   * `connect` is handled before stdin is read, and it has to be.
   *
   * Every other verb's request arrives on stdin and is read to EOF. `connect`'s
   * stdin **is the HTTP conversation** — DASH writes a request and waits for the
   * answer — so a helper that drained it first would consume the first request
   * and then wait forever for an end that only comes when DASH gives up. The
   * bundle id therefore reaches this verb on argv, which is the one place a
   * caller-supplied string is allowed on the command line, and it is validated
   * by the same `checkDeployRequest` as everything else before it is used.
   */
  if (verb === "connect") {
    const checkedConnect = checkDeployRequest({ verb, bundle_id: argv[1] });
    if (!checkedConnect.ok) {
      answer({ ok: false, problem: checkedConnect.problem, detail: checkedConnect.detail });
      return 65;
    }
    connect(root, argv[1] as string);
    return await new Promise<number>(() => {
      /* held open deliberately — the exit comes from the socket closing */
    });
  }

  const body = await readStdin();
  let parsed: unknown;
  try {
    parsed = body.trim().length === 0 ? { verb } : JSON.parse(body);
  } catch {
    answer({ ok: false, problem: "malformed_request", detail: "The request was not JSON." });
    return 65; // EX_DATAERR
  }

  /*
   * The verb on the command line is authoritative, and the one in the body is
   * checked against it rather than trusted. They arrive by different routes —
   * argv is what `sshArgv` composed, the body is what DASH wrote — and a helper
   * that took the body's word could be asked to `install` by a session that was
   * authorised to `status`. Nothing today grants per-verb authority, and writing
   * the check now is what makes that possible later rather than a rewrite.
   */
  if (typeof parsed === "object" && parsed !== null) {
    (parsed as Record<string, unknown>)["verb"] = verb;
  }

  const checked = checkDeployRequest(parsed);
  if (!checked.ok) {
    answer({ ok: false, problem: checked.problem, detail: checked.detail });
    return 65;
  }
  const request: DeployRequest = checked.request;

  switch (request.verb) {
    case "install":
      answer(install(root, request));
      return 0;
    case "start":
      answer(start(root, request.bundle_id));
      return 0;
    case "stop":
      answer(await stop(root, request.bundle_id));
      return 0;
    case "status":
      answer(status(root, request.bundle_id));
      return 0;
    case "collect":
      answer(collect(root, request.bundle_id, request.lines ?? MAX_COLLECT_LINES));
      return 0;
    case "channel":
      answer(channel(root, request.bundle_id));
      return 0;
    case "uninstall":
      answer(uninstall(root, request.bundle_id));
      return 0;
    case "connect":
      // Unreachable: handled above, before stdin was read. Checked rather than
      // asserted, because "unreachable" is a claim about another branch.
      answer({ ok: false, problem: "unknown_verb", detail: "Handled before the request was read." });
      return 70; // EX_SOFTWARE
  }
}
