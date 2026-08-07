/**
 * The key DASH holds, and the `ssh` it holds it for (MAR-484, ADR 0007).
 *
 * `lib/hosts.ts` decides what a host record may say and what argument vector a
 * verb becomes. This is the half that touches the machine: the key files, the
 * ACL that protects them, the probe for the binary, and the child process the
 * control plane speaks HTTP down.
 *
 * ## Custody, stated as what this module cannot do
 *
 * The private key is a credential DASH holds *on this machine*, used from an
 * open DASH to dial outward. That is the **inside** of ADR 0006's line — the
 * same side as every token in the vault. It never ships to the host, never
 * reaches an agent's environment, and is not a connection field, so
 * `deliverableSecretFields` cannot return it and `assertNoBrokeredCredentials`
 * is unaffected.
 *
 * The strongest statement available is an absence, so it is the one this module
 * makes: **there is no function here that returns a private key.** It can
 * create one, protect one, prove one is protected, and name the path `ssh`
 * should read — and it cannot hand the bytes to anything, including to a future
 * caller with good intentions. DASH cannot leak what it never reads.
 *
 * ## Why a file at all, which is the awkward part
 *
 * ADR 0007 says it plainly: the system `ssh` binary needs the key as a file and
 * cannot read `safeStorage`. So the vault is not the whole answer, and the
 * honest one is already in this repository. `runner/channel-secret.ts` writes
 * `runner.key` under an owner-only ACL and then *proves what it wrote* by
 * reading the descriptor back, refusing to start if it cannot. The deploy key
 * gets the same treatment and the same refusal, by calling the same function
 * rather than by a second implementation of it — which is what keeps the
 * Swedish-`Administratör` bug from coming back in a new file.
 *
 * Preferring `ssh-agent` would avoid the file and introduce a per-platform
 * daemon whose presence DASH cannot guarantee; `IdentityAgent=none` in
 * `sshArgv` is that rejection enforced rather than assumed.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { remoteRunnerChannel, type RemoteRunnerChannel } from "../lib/agent-dom/runner-channel";
import { stdioFetch, type StdioChannel } from "../lib/agent-dom/ssh-fetch";
import {
  checkDeployRequest,
  type DeployAnswer,
  type DeployRequest,
} from "../lib/deploy/verbs";
import { sshArgv, type HostRecord, type HostVerb } from "../lib/hosts";
import { hardenOwnerOnly } from "../runner/channel-secret";

/* ---------------------------------------------------------------------- *
 * Where the key lives
 * ---------------------------------------------------------------------- */

/**
 * `{dataDir}/hosts/`, owner-only and proven so on every call.
 *
 * Created and hardened together, because a directory that was 0700 once is not
 * a protected directory — it is a directory that was protected at a moment, and
 * the moment that matters is the one a key is about to be read in.
 *
 * @throws ChannelSecretError when the ACL cannot be applied or proven.
 */
export function hostKeysDirectory(dataDir: string): string {
  const directory = path.join(dataDir, "hosts");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  hardenOwnerOnly(directory, { directory: true });
  return directory;
}

/** Where `ssh -i` is pointed. The name comes from the host record. */
export function hostKeyPath(dataDir: string, keyName: string): string {
  return path.join(dataDir, "hosts", `${keyName}.key`);
}

/**
 * DASH's own `known_hosts`, deliberately not the user's.
 *
 * `~/.ssh/known_hosts` belongs to the person. DASH must not edit it — an entry
 * DASH added would outlive DASH and change how the user's own `ssh` behaves —
 * and DASH cannot vouch for what is already in it, which is what pinning a host
 * key is supposed to mean.
 */
export function knownHostsPath(dataDir: string): string {
  return path.join(dataDir, "hosts", "known_hosts");
}

export type HostKeyProblem =
  /** `ssh` or `ssh-keygen` is not on this machine. */
  | "no_ssh"
  /** A key already exists under that name. Overwriting would strand a host. */
  | "key_exists"
  /** The key named by a record is not there. */
  | "key_missing"
  /** `ssh-keygen` ran and failed. */
  | "keygen_failed";

export class HostKeyError extends Error {
  readonly problem: HostKeyProblem;
  constructor(problem: HostKeyProblem, message: string) {
    super(message);
    this.name = "HostKeyError";
    this.problem = problem;
  }
}

/* ---------------------------------------------------------------------- *
 * The binary this depends on and does not version
 * ---------------------------------------------------------------------- */

export interface SshTools {
  present: boolean;
  /** `ssh -V`'s own answer, for a receipt. Safe to render: it names no host. */
  version: string | null;
  /** Plain language, when it is absent. */
  detail: string | null;
}

/**
 * Look for `ssh` and say so plainly, rather than failing at the first deploy.
 *
 * ADR 0007 accepts the cost in writing — DASH depends on a binary it does not
 * version, whose behaviour varies across builds, and whose absence is a
 * first-run failure — and requires exactly this: the connect flow probes for it
 * and says so, "the same shape as `prepareEndpoint` refusing with a named
 * `EndpointProblem` rather than a mysterious bind error".
 *
 * `ssh-keygen` is probed too and in the same breath, because it is what mints
 * the credential and its absence would surface one step later as a confusing
 * failure to connect a host that was never given a key.
 */
export function probeSshTools(): SshTools {
  let version: string | null = null;
  try {
    // `ssh -V` writes to stderr and exits 0 on every build worth supporting.
    const output = execFileSync("ssh", ["-V"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    version = output.trim();
  } catch (error: unknown) {
    const stderr = (error as { stderr?: Buffer | string } | null)?.stderr;
    const text = typeof stderr === "string" ? stderr : stderr?.toString("utf8");
    if (text !== undefined && /OpenSSH/i.test(text)) {
      version = text.trim();
    } else {
      return {
        present: false,
        version: null,
        detail:
          "This computer has no SSH command, which is how DASH reaches a server. " +
          "On Windows it is an optional feature called OpenSSH Client; on macOS and Linux it is " +
          "usually already installed.",
      };
    }
  }

  try {
    execFileSync("ssh-keygen", ["-A", "-?"], { stdio: "ignore", windowsHide: true });
  } catch (error: unknown) {
    // `ssh-keygen` with a bad flag exits non-zero, which is fine — what is being
    // asked is whether it can be *run at all*. ENOENT is the only answer that
    // means absent, and it is the only one treated as one.
    if ((error as { code?: string } | null)?.code === "ENOENT") {
      return {
        present: false,
        version,
        detail:
          "This computer has the SSH command but not the tool that creates a key for it. " +
          "Installing the full OpenSSH client package adds both.",
      };
    }
  }

  return { present: true, version, detail: null };
}

/* ---------------------------------------------------------------------- *
 * Minting a key, and never reading one
 * ---------------------------------------------------------------------- */

/**
 * Create the key DASH will reach one host with, and return its **public** half.
 *
 * Ed25519 with no passphrase. The passphrase is the interesting omission: a
 * passphrase on a key DASH uses unattended would have to be stored somewhere
 * DASH can read it, which is a second credential protecting the first one and
 * kept beside it. The protection here is the file's ACL, applied and proven,
 * which is the mechanism this project already knows how to check on the machine
 * it ships to.
 *
 * The public key is returned because it is the one thing that *should* travel:
 * the user puts it in the host's `authorized_keys`. Nothing else about the pair
 * leaves this function, now or later.
 *
 * @throws HostKeyError, ChannelSecretError
 */
export function createHostKey(dataDir: string, keyName: string): string {
  hostKeysDirectory(dataDir);
  const file = hostKeyPath(dataDir, keyName);
  if (existsSync(file)) {
    // Not overwritten. A key is what a host's `authorized_keys` was told to
    // trust, so replacing one silently would break every host that had been
    // given it, and would do so at the next poll rather than here.
    throw new HostKeyError(
      "key_exists",
      `DASH already holds a key under this name. Remove the host first, or choose another name.`,
    );
  }

  try {
    execFileSync(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-C", "orchestratedash", "-f", file],
      { stdio: "pipe", windowsHide: true },
    );
  } catch (error: unknown) {
    throw new HostKeyError(
      "keygen_failed",
      `DASH could not create a key for this server: ${describe(error)}`,
    );
  }

  // Applied to what `ssh-keygen` wrote, not to what DASH intended it to write.
  hardenOwnerOnly(file);
  const publicKeyFile = `${file}.pub`;
  hardenOwnerOnly(publicKeyFile);

  // `known_hosts` is created empty and protected now rather than on first
  // connect, so `StrictHostKeyChecking=yes` has a file to fail against instead
  // of an `ssh` error about a missing path.
  const known = knownHostsPath(dataDir);
  if (!existsSync(known)) {
    writeFileSync(known, "", { encoding: "utf8", mode: 0o600 });
    hardenOwnerOnly(known);
  }

  // The public half, and only the public half. There is no sibling function
  // that returns the other one — see this module's header.
  return readFileSync(publicKeyFile, "utf8").trim();
}

/**
 * Prove the key is still protected, immediately before it is used.
 *
 * The same rule `ensureChannelSecret` applies on every call and for the same
 * reason: an ACL that was right once is not a property of a file, it is a
 * property of a file at a moment. The moment that matters is this one, because
 * the next thing that happens is `ssh` reading it.
 *
 * @throws HostKeyError, ChannelSecretError
 */
export function assertHostKeyProtected(dataDir: string, keyName: string): string {
  const file = hostKeyPath(dataDir, keyName);
  if (!existsSync(file)) {
    throw new HostKeyError(
      "key_missing",
      "DASH no longer holds the key for this server, so it cannot sign in. Connect the server again.",
    );
  }
  hardenOwnerOnly(file);
  return file;
}

/* ---------------------------------------------------------------------- *
 * The channel
 * ---------------------------------------------------------------------- */

/**
 * Spawn one `ssh` for one request, and hand back its two pipes.
 *
 * `stderr` is inherited into DASH's own log rather than piped and parsed.
 * `ssh`'s diagnostics name a host, a user, a port and a key path, and a
 * transport that read them would be a transport that could interpolate them
 * into an error message — which `describeTransportError` exists to prevent.
 * The class of failure is what callers act on; the text is for whoever is
 * reading a log on this machine.
 */
export function openSshChannel(
  record: HostRecord,
  verb: HostVerb,
  paths: { identity_file: string; known_hosts_file: string },
  bundleId?: string,
): StdioChannel {
  const child = spawn("ssh", sshArgv(record, verb, paths, bundleId), {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    close: () => {
      // The far end is a helper joining a socket to stdio; closing our side is
      // what ends it. `kill` is the backstop for an `ssh` that is wedged before
      // it ever reached the host, and it is this process's own child rather
      // than anything on the host — AGENTS.md's rule is about the runner and
      // Electron, and neither is here.
      child.stdin.end();
      child.kill();
    },
  };
}

/* ---------------------------------------------------------------------- *
 * The deploy plane (MAR-487)
 * ---------------------------------------------------------------------- */

/**
 * How a deploy verb's child is started, so a test can supply one without `ssh`.
 *
 * The same seam `TransportOptions.fetch` and `StdioChannel` already are, and
 * for ADR 0007's own stated reason: *"the only variable between the CI proof
 * and the attended one is which process is on the other end of the pipe."* A
 * test hands over the real host helper as a local child; production hands over
 * `ssh`. Nothing between them differs.
 */
export type DeploySpawn = (verb: HostVerb, bundleId?: string) => StdioChannel;

/**
 * Send one verb and read one answer.
 *
 * The request is written to the child's stdin and the child's stdin is then
 * **closed**, which is what makes the far end's `readStdin` return. Everything
 * variable travels this way rather than on argv, and `lib/deploy/verbs.ts`
 * explains at length why: argv is where option injection lives, and keeping all
 * variable data off it means the set of strings `ssh` can be made to interpret
 * is fixed when this repository is compiled.
 *
 * The request is checked **before** the child is spawned as well as by the
 * helper on arrival. Two calls to one function, never two implementations — the
 * helper's is the one that matters, because it is the side something other than
 * DASH could talk to, and this one exists so a malformed request costs no
 * process.
 *
 * A non-JSON answer is reported as a transport failure rather than parsed
 * loosely. An `ssh` that could not authenticate writes its diagnostics to
 * stderr and exits, so stdout holds nothing — and "the host said something I
 * could not read" is a different fact from "the host refused", which is
 * `describeTransportError`'s distinction applied one plane over.
 */
export async function runDeployVerb(
  spawnChild: DeploySpawn,
  request: DeployRequest,
): Promise<DeployAnswer> {
  const checked = checkDeployRequest(request);
  if (!checked.ok) {
    return { ok: false, problem: checked.problem, detail: checked.detail };
  }

  const channel = spawnChild(
    request.verb,
    // Only `connect` puts an id on the command line, and `connect` does not come
    // through here — it is a channel, not a request/response. Passed anyway so
    // the spawner has it, and ignored by every other verb's helper branch.
    undefined,
  );

  return await new Promise<DeployAnswer>((resolve) => {
    let body = "";
    let settled = false;
    const settle = (answer: DeployAnswer): void => {
      if (settled) {
        return;
      }
      settled = true;
      channel.close();
      resolve(answer);
    };

    channel.stdout.setEncoding("utf8");
    channel.stdout.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_ANSWER_BYTES) {
        settle({
          ok: false,
          problem: "unreadable_answer",
          detail: "The server's answer was too long to be one.",
        });
      }
    });
    channel.stdout.on("end", () => {
      const line = body.trim();
      if (line.length === 0) {
        settle({
          ok: false,
          problem: "unreachable",
          detail:
            "The server did not answer. DASH could not sign in, or the helper is not installed there.",
        });
        return;
      }
      try {
        settle(JSON.parse(line.split("\n").pop() ?? line) as DeployAnswer);
      } catch {
        settle({
          ok: false,
          problem: "unreadable_answer",
          // The answer is never quoted back. It is whatever a machine DASH does
          // not administer chose to write, and this string reaches a log.
          detail: "The server answered with something DASH could not read.",
        });
      }
    });
    channel.stdout.on("error", () => {
      settle({ ok: false, problem: "unreachable", detail: "The connection to the server failed." });
    });

    channel.stdin.on("error", () => {
      settle({ ok: false, problem: "unreachable", detail: "The connection to the server failed." });
    });
    channel.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

/** An answer is a status line, not a payload. Evidence travels on the other plane. */
const MAX_ANSWER_BYTES = 1024 * 1024;

/**
 * Spawn `ssh` for a deploy verb against one host.
 *
 * The key is proven protected on the way, for `sshHostChannel`'s reason: an ACL
 * that was right once is a property of a file at a moment, and the moment that
 * matters is the one `ssh` is about to read it in.
 *
 * @throws HostKeyError, ChannelSecretError
 */
export function sshDeploySpawn(record: HostRecord, dataDir: string): DeploySpawn {
  return (verb, bundleId) => {
    const identity = assertHostKeyProtected(dataDir, record.key_name);
    return openSshChannel(
      record,
      verb,
      { identity_file: identity, known_hosts_file: knownHostsPath(dataDir) },
      bundleId,
    );
  };
}

/**
 * The control-plane channel to a runner on a host.
 *
 * A `RemoteRunnerChannel`, which is the whole point: the type carries evidence
 * routes and cannot carry `/broker/drain` or `/broker/responses`, so the
 * generalising refactor ADR 0007 warns about fails to compile rather than
 * succeeding quietly. See `lib/agent-dom/runner-channel.ts`.
 *
 * The key is proven protected **here**, on the way to building the channel,
 * rather than once at connect time — a channel that outlived a change to its
 * key file would otherwise keep using it.
 *
 * @throws HostKeyError, ChannelSecretError
 */
export function sshHostChannel(options: {
  record: HostRecord;
  dataDir: string;
  /** The remote runner's own channel secret. The second of ADR 0007's two credentials. */
  token: string;
}): RemoteRunnerChannel {
  const identity = assertHostKeyProtected(options.dataDir, options.record.key_name);
  const known = knownHostsPath(options.dataDir);
  return remoteRunnerChannel({
    token: options.token,
    dial: stdioFetch(() =>
      openSshChannel(options.record, "connect", {
        identity_file: identity,
        known_hosts_file: known,
      }),
    ),
  });
}

/** Errors from `execFileSync` carry stdio buffers; only the message is safe. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
