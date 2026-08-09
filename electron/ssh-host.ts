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
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { remoteRunnerChannel, type RemoteRunnerChannel } from "../lib/agent-dom/runner-channel";
import { stdioFetch, type StdioChannel } from "../lib/agent-dom/ssh-fetch";
import {
  checkDeployRequest,
  type DeployAnswer,
  type DeployRequest,
} from "../lib/deploy/verbs";
import {
  hostPattern,
  knownHostsEntriesFor,
  knownHostsLine,
  parseScannedHostKeys,
  type HostKeyOffer,
  type ScannedHostKey,
} from "../lib/host-key";
import { checkHostRecord, sshArgv, type HostRecord, type HostVerb } from "../lib/hosts";
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
 * Remove the key pair for a host DASH is forgetting.
 *
 * This function names the files it owns from a validated key name, but never
 * reads either one. In particular it returns no bytes and no path: forgetting a
 * server must remove DASH's ability to sign in without creating a route that
 * could reveal the credential being removed.
 */
export function forgetHostKey(dataDir: string, keyName: string): void {
  const privateFile = hostKeyPath(dataDir, keyName);
  for (const file of [privateFile, `${privateFile}.pub`]) {
    if (existsSync(file)) {
      unlinkSync(file);
    }
  }
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
 * The public half of a key DASH already holds.
 *
 * The obvious question about this function is whether it weakens the module's
 * one structural promise — *there is no function here that returns a private
 * key.* It does not, and the way it does not is worth stating: it names the
 * `.pub` file, which is the file whose entire purpose is to be handed out, and
 * there is no argument by which the other path could be reached from it. The
 * test that sweeps this module's exports for a private-key reader still passes
 * over it because it is still true.
 *
 * It exists because enrollment has to be **resumable**. Before MAR-572 the only
 * way to see the public half was to mint a key, so a wizard that lost its place
 * — which it did, on every failure — had no way to continue and minted another
 * one. That left an unusable key in DASH's store and a stale line on the host
 * for each attempt. The fix is to be able to ask for what already exists.
 *
 * @throws HostKeyError when this host has no key on this machine.
 */
export function readHostPublicKey(dataDir: string, keyName: string): string {
  const publicKeyFile = `${hostKeyPath(dataDir, keyName)}.pub`;
  if (!existsSync(publicKeyFile)) {
    throw new HostKeyError(
      "key_missing",
      "DASH no longer holds the key for this server, so it cannot sign in. Connect the server again.",
    );
  }
  return readFileSync(publicKeyFile, "utf8").trim();
}

/* ---------------------------------------------------------------------- *
 * Enrollment: the first pin (MAR-572)
 * ---------------------------------------------------------------------- */

export type HostKeyScanProblem =
  /** `ssh-keyscan` is not on this machine. */
  | "no_ssh"
  /** Nothing answered at that address and port. */
  | "no_answer"
  /** Something answered and offered no key DASH will pin. */
  | "no_supported_key";

export type HostKeyScanResult =
  | { ok: true; offer: HostKeyOffer }
  | { ok: false; problem: HostKeyScanProblem };

/**
 * Ask a host who it says it is, over DASH's own dialer.
 *
 * This is the half of `StrictHostKeyChecking=yes` that never shipped. The
 * strict half has been in `sshArgv` since MAR-484, pointed at a `known_hosts`
 * that `createHostKey` writes **empty on purpose** — so that a first connection
 * fails closed rather than silently trusting whatever answered. What was
 * missing was any way for a person to put a first key into that file, which
 * meant every host DASH had not seen failed forever. The 2026-08-08 run found
 * it against a real box: DASH's probes reached the server and aborted at
 * preauth, and the host's `auth.log` recorded no publickey attempt at all
 * because there had never been a session to make one in.
 *
 * `ssh-keyscan` rather than `ssh -o StrictHostKeyChecking=accept-new`, and the
 * difference is the entire point. `accept-new` writes a key into the file as a
 * side effect of connecting, so the trust decision would be made by the
 * connection rather than by a person, and it would be made before anybody had
 * seen a fingerprint. This asks, shows, and writes nothing.
 *
 * Nothing about the record reaches a shell: `execFileSync` takes an argument
 * vector, and every component of it is either fixed here or has been through
 * `checkHostRecord` — which refuses a leading `-` for exactly this reason.
 */
export function scanHostKey(record: HostRecord): HostKeyScanResult {
  const checked = checkHostRecord(record);
  if (!checked.ok) {
    // A record that cannot be validated cannot be dialled. This is unreachable
    // through the app — main validates before saving and `readStore` validates
    // on the way back out — and it is checked rather than assumed because the
    // next line puts these strings on a command line.
    return { ok: false, problem: "no_answer" };
  }

  const address =
    record.address.startsWith("[") && record.address.endsWith("]")
      ? record.address.slice(1, -1)
      : record.address;

  let output: string;
  try {
    output = execFileSync(
      "ssh-keyscan",
      [
        // Bounded, because this runs while somebody is watching a wizard. The
        // default is five seconds per key type and this asks for three.
        "-T", "10",
        "-p", String(record.port),
        // Asked for in DASH's own order of preference. What arrives is whatever
        // the host has; `chooseHostKey` decides which one is pinned.
        "-t", "ed25519,ecdsa,rsa",
        address,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 20_000 },
    );
  } catch (error: unknown) {
    if ((error as { code?: string } | null)?.code === "ENOENT") {
      return { ok: false, problem: "no_ssh" };
    }
    // `ssh-keyscan` exits non-zero when it found nothing, and its stdout is
    // still the honest answer when it found something and then timed out on a
    // later key type. Read what there is; the parser decides whether it is a key.
    const stdout = (error as { stdout?: Buffer | string } | null)?.stdout;
    output = typeof stdout === "string" ? stdout : (stdout?.toString("utf8") ?? "");
  }

  const parsed = parseScannedHostKeys(output);
  if (!parsed.ok) {
    // "Nothing answered" and "it answered with nothing usable" are different
    // facts with different next actions — a wrong address against a server
    // running an ancient key type — and `lib/host-connect.ts` has a sentence
    // for each.
    return { ok: false, problem: parsed.problem === "no_key_offered" ? "no_answer" : "no_supported_key" };
  }
  return { ok: true, offer: parsed.offer };
}

export type HostKeyPinResult =
  | { ok: true; fingerprint: string }
  /** Something is already pinned for this host and it is not this key. */
  | { ok: false; problem: "already_pinned_differently" };

/**
 * Write the first pin, and refuse to write a second one.
 *
 * The refusal is the load-bearing half. ADR 0007 requires a changed host key to
 * fail closed, and the way to keep that true once an enrollment step exists is
 * to make sure the enrollment step cannot be used to *re*-enrol: there is no
 * argument to this function that overwrites a line, and no sibling function
 * that does either. A host whose key really did change is forgotten and added
 * again, which is a deliberate act with a confirmation in front of it, rather
 * than a button that appears at the moment somebody is most inclined to press
 * it.
 *
 * Re-pinning the *same* key succeeds and writes nothing new, so a retried
 * enrollment is not an error — resumability that stops at the first repeated
 * step is not resumability.
 *
 * @throws ChannelSecretError when the ACL cannot be applied or proven.
 */
export function pinHostKey(dataDir: string, record: HostRecord, key: ScannedHostKey): HostKeyPinResult {
  hostKeysDirectory(dataDir);
  const file = knownHostsPath(dataDir);
  const contents = existsSync(file) ? readFileSync(file, "utf8") : "";
  const pattern = hostPattern(record.address, record.port);
  const line = knownHostsLine(pattern, key);

  const existing = knownHostsEntriesFor(contents, pattern);
  if (existing.length > 0) {
    return existing.every((entry) => entry.trim() === line)
      ? { ok: true, fingerprint: key.fingerprint }
      : { ok: false, problem: "already_pinned_differently" };
  }

  const separator = contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
  writeFileSync(file, `${contents}${separator}${line}\n`, { encoding: "utf8", mode: 0o600 });
  hardenOwnerOnly(file);
  return { ok: true, fingerprint: key.fingerprint };
}

/**
 * Forget one host's pin, as part of forgetting the host.
 *
 * The only way a pinned key is ever removed, and it is reached from
 * `host.forget` — the path with a confirmation in front of it that also removes
 * DASH's own key. Leaving the line behind would mean a server added again later
 * skipped the enrollment step and inherited a decision somebody made about a
 * machine that may no longer be the same one.
 */
export function forgetHostKeyPin(dataDir: string, record: HostRecord): void {
  const file = knownHostsPath(dataDir);
  if (!existsSync(file)) {
    return;
  }
  const pattern = hostPattern(record.address, record.port);
  const kept = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((entry) => entry.trim().length > 0 && entry.split(/\s+/)[0] !== pattern);
  writeFileSync(file, kept.length === 0 ? "" : `${kept.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  hardenOwnerOnly(file);
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
 * Where `ssh`'s own diagnostics are collected so they can be *classified*.
 *
 * A mutable box rather than a return value because the text arrives after the
 * channel does, and the caller reads it once the answer has settled.
 */
export interface SshDiagnostics {
  stderr: string;
}

/** Enough to hold any refusal OpenSSH prints, and far less than a log flood. */
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;

/**
 * Spawn one `ssh` for one request, and hand back its two pipes.
 *
 * `stderr` still goes to DASH's own log and still goes nowhere else. What
 * changed in MAR-572 is that it is *also* kept, when a caller asks, so that
 * `classifyHostFailure` can reduce it to one of a closed set of problems.
 *
 * The original rule was written as "do not read it", for a good reason —
 * `ssh`'s diagnostics name a host, a user, a port and the local path of DASH's
 * private key, and a transport that read them would be a transport that could
 * interpolate them into an error message. Keeping the rule by not looking cost
 * the product the ability to tell three completely different failures apart,
 * which is what the 2026-08-08 attended run ran into: an unconfirmed host key,
 * a refused sign-in and a server with no helper on it all arrived as one
 * sentence.
 *
 * So the rule is now kept by the return type of the thing that reads it.
 * `classifyHostFailure` takes this text and can only return a member of
 * `HostReachProblem` — there is no path from these bytes to a rendered string.
 * The class of failure is what callers act on; the text is still only for
 * whoever is reading a log on this machine.
 */
export function openSshChannel(
  record: HostRecord,
  verb: HostVerb,
  paths: { identity_file: string; known_hosts_file: string },
  bundleId?: string,
  diagnostics?: SshDiagnostics,
): StdioChannel {
  const child = spawn("ssh", sshArgv(record, verb, paths, bundleId), {
    // Piped rather than inherited so the same bytes can reach two places. They
    // are written straight back out below, so what lands in DASH's log is what
    // landed there before.
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    process.stderr.write(chunk);
    if (diagnostics !== undefined && diagnostics.stderr.length < MAX_DIAGNOSTIC_BYTES) {
      diagnostics.stderr += chunk;
    }
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
export function sshDeploySpawn(
  record: HostRecord,
  dataDir: string,
  /** Collects `ssh`'s diagnostics for classification. See `openSshChannel`. */
  diagnostics?: SshDiagnostics,
): DeploySpawn {
  return (verb, bundleId) => {
    const identity = assertHostKeyProtected(dataDir, record.key_name);
    return openSshChannel(
      record,
      verb,
      { identity_file: identity, known_hosts_file: knownHostsPath(dataDir) },
      bundleId,
      diagnostics,
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
