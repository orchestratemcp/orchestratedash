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

import { execFileSync, spawn, spawnSync } from "node:child_process";
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
import type { HostReachProblem } from "../lib/host-connect";
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
 * The binaries this depends on, resolved rather than wished for (MAR-600)
 * ---------------------------------------------------------------------- */

/** The three external programs DASH drives. There is no fourth. */
export type SshToolName = "ssh" | "ssh-keyscan" | "ssh-keygen";

export const SSH_TOOL_NAMES = ["ssh", "ssh-keyscan", "ssh-keygen"] as const satisfies readonly SshToolName[];

/**
 * One binary DASH decided to run, and where it came from.
 *
 * `source` is the half MAR-600 is really about. Until this existed DASH drove
 * whichever OpenSSH `PATH` happened to name and could not say which one that
 * was — so when Microsoft's bundled `ssh-keyscan` could not key-exchange with a
 * stock Ubuntu 24.04, nothing in DASH knew enough to say so, and the failure
 * came out as a sentence about the user's server.
 */
export interface ResolvedSshTool {
  name: SshToolName;
  /** What is executed. An absolute path when DASH found one, else the bare name. */
  command: string;
  /** Where it came from, in words fit for a receipt. Never a user's path. */
  source: string;
}

/**
 * How the search can be driven from a test, on a machine that has neither
 * OpenSSH installed in either place.
 *
 * `exists` is injected for the same reason `DeploySpawn` is: the interesting
 * cases here are *other people's* machines — a Windows box with only the system
 * OpenSSH, one with Git for Windows as well, one with neither — and none of them
 * is the machine CI runs on.
 */
export interface SshToolSearch {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  exists?: (file: string) => boolean;
}

/**
 * An operator's escape hatch, which the reported failure needs to have.
 *
 * MAR-600's complaint is not only that `PATH` was trusted; it is that there was
 * **no configuration point at all**, so a person who knew exactly which OpenSSH
 * worked had no way to say so. One directory holding all three binaries is the
 * whole of it — deliberately not three variables, because three is an invitation
 * to mix builds.
 */
const OPENSSH_DIR_OVERRIDE = "DASH_OPENSSH_DIR";

/**
 * Where DASH looks, per tool, in the order it prefers.
 *
 * The order is not the same for all three, and the asymmetry is the fix:
 *
 * - `ssh` and `ssh-keygen` prefer **Windows' own** OpenSSH. Both are given
 *   Windows file paths on their command line — the identity file, the
 *   `known_hosts` file — and the native build is the one that has been reading
 *   them correctly on every installed DASH so far. Changing which binary opens
 *   the actual connection is a risk with nothing to buy: the 2026-08-10 run
 *   confirmed the stock `ssh` completes a full handshake with the same host.
 * - `ssh-keyscan` prefers **Git for Windows'**. It is the one binary observed to
 *   fail, it takes no file path on its command line so there is nothing for a
 *   different build to mis-translate, and Git for Windows' 10.3p1 fetched the
 *   key first try against the host that defeated 9.5p2.
 *
 * Neither preference is a guess DASH is stuck with: `scanHostKey` falls through
 * to the next candidate when the preferred one proves incapable, so the order
 * decides who goes first rather than who is allowed.
 *
 * The bare name is always last. A machine with an OpenSSH somewhere this list
 * has never heard of must keep working exactly as it did before MAR-600.
 */
export function sshToolCandidates(
  name: SshToolName,
  search: SshToolSearch = {},
): ResolvedSshTool[] {
  const env = search.env ?? process.env;
  const platform = search.platform ?? process.platform;
  const exists = search.exists ?? existsSync;
  const binary = platform === "win32" ? `${name}.exe` : name;

  const directories: Array<{ dir: string; source: string }> = [];
  const override = env[OPENSSH_DIR_OVERRIDE];
  if (override !== undefined && override.trim() !== "") {
    directories.push({ dir: override.trim(), source: "the folder this computer was told to use" });
  }

  if (platform === "win32") {
    const windows = env["SystemRoot"] ?? env["windir"];
    const system: Array<{ dir: string; source: string }> =
      windows === undefined
        ? []
        : [{ dir: path.join(windows, "System32", "OpenSSH"), source: "Windows' own OpenSSH" }];

    const git: Array<{ dir: string; source: string }> = [
      env["ProgramFiles"],
      env["ProgramFiles(x86)"],
      env["ProgramW6432"],
      env["LOCALAPPDATA"] === undefined ? undefined : path.join(env["LOCALAPPDATA"], "Programs"),
    ]
      .filter((root): root is string => root !== undefined && root.trim() !== "")
      .map((root) => ({ dir: path.join(root, "Git", "usr", "bin"), source: "Git for Windows" }));

    directories.push(...(name === "ssh-keyscan" ? [...git, ...system] : [...system, ...git]));
  }

  const found = directories
    .map((entry) => ({ name, command: path.join(entry.dir, binary), source: entry.source }))
    .filter((tool) => exists(tool.command));

  // Deduplicated by path, because `ProgramFiles` and `ProgramW6432` are the same
  // directory on a 64-bit process and a list that named it twice would scan
  // twice with the same broken binary.
  const seen = new Set<string>();
  const unique = found.filter((tool) => {
    const key = tool.command.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return [...unique, { name, command: name, source: "the system search path" }];
}

/** The one DASH will use. See `sshToolCandidates` for the order. */
export function resolveSshTool(name: SshToolName, search: SshToolSearch = {}): ResolvedSshTool {
  // `sshToolCandidates` always ends with the bare-name fallback, so this index
  // is never out of range.
  return sshToolCandidates(name, search)[0] as ResolvedSshTool;
}

/**
 * Say once, into this machine's own log, which OpenSSH DASH picked.
 *
 * "Record which one was chosen and from where" is MAR-600's first ask, and a
 * line per connection would be a flood rather than a record. Paths from this
 * module's own candidate list, never a host, a user or a key location.
 */
const announced = new Set<string>();
function announce(tool: ResolvedSshTool): ResolvedSshTool {
  const line = `${tool.name} -> ${tool.command} (${tool.source})`;
  if (!announced.has(line)) {
    announced.add(line);
    console.error(`[ssh] ${line}`);
  }
  return tool;
}

/* ---------------------------------------------------------------------- *
 * Probing what those binaries can do, rather than that they exist
 * ---------------------------------------------------------------------- */

export interface SshTools {
  present: boolean;
  /** `ssh -V`'s own answer, for a receipt. Safe to render: it names no host. */
  version: string | null;
  /** Plain language, when it is absent. */
  detail: string | null;
  /** Which binary DASH will drive for each job, and where each came from. */
  chosen: Record<SshToolName, ResolvedSshTool>;
}

/**
 * Look for the three tools and say so plainly, rather than failing at the first
 * deploy.
 *
 * ADR 0007 accepts the cost in writing — DASH depends on a binary it does not
 * version, whose behaviour varies across builds, and whose absence is a
 * first-run failure — and requires exactly this: the connect flow probes for it
 * and says so, "the same shape as `prepareEndpoint` refusing with a named
 * `EndpointProblem` rather than a mysterious bind error".
 *
 * ## What MAR-600 changed, and what it could not
 *
 * This function used to run `ssh -V` and nothing else. That proved a tool was
 * **present**, never that it **worked** — and it probed `ssh`, which was not
 * even the binary that failed. On 2026-08-10 the preflight passed, `ssh-keyscan`
 * then could not key-exchange with the host, and the failure surfaced two steps
 * later wearing a sentence about the user's server.
 *
 * So `ssh-keyscan` is probed here too, and it is the honest half of the fix
 * rather than the whole of it: whether a build can complete a key exchange with
 * *one particular sshd* is not answerable from this machine alone. Nothing local
 * — not `-V`, not `ssh -Q kex`, which reports on a sibling binary rather than on
 * this one — distinguishes the 9.5p2 that failed from a build that would not.
 * The capability question is therefore answered where it can be: at the scan,
 * from what came back. See `classifyKeyscanAttempt`.
 *
 * What this probe *can* prove is that DASH has all three and knows which ones,
 * which is why the answer now carries `chosen`.
 */
export function probeSshTools(search: SshToolSearch = {}): SshTools {
  const chosen: Record<SshToolName, ResolvedSshTool> = {
    ssh: announce(resolveSshTool("ssh", search)),
    "ssh-keyscan": announce(resolveSshTool("ssh-keyscan", search)),
    "ssh-keygen": announce(resolveSshTool("ssh-keygen", search)),
  };

  let version: string | null = null;
  try {
    // `ssh -V` writes to stderr and exits 0 on every build worth supporting.
    const output = execFileSync(chosen.ssh.command, ["-V"], {
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
        chosen,
      };
    }
  }

  try {
    execFileSync(chosen["ssh-keygen"].command, ["-A", "-?"], { stdio: "ignore", windowsHide: true });
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
        chosen,
      };
    }
  }

  // The binary MAR-600 is about, probed at last. Run with no arguments it prints
  // its usage and exits non-zero, which is an answer; stdin is closed so a build
  // that would rather read a host list from it gets an immediate end of file
  // instead of hanging a wizard.
  try {
    execFileSync(chosen["ssh-keyscan"].command, [], {
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: true,
      timeout: 5_000,
    });
  } catch (error: unknown) {
    if ((error as { code?: string } | null)?.code === "ENOENT") {
      return {
        present: false,
        version,
        detail:
          "This computer has the SSH command but not the tool that reads a server's identity. " +
          "Installing the full OpenSSH client package adds both.",
        chosen,
      };
    }
  }

  return { present: true, version, detail: null, chosen };
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
      announce(resolveSshTool("ssh-keygen")).command,
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
  | "no_supported_key"
  /**
   * The server answered and **this computer's** `ssh-keyscan` could not finish
   * with it (MAR-600).
   *
   * Kept apart from `no_answer` at the cost of a union member, because the two
   * send a person to opposite ends of the problem. On 2026-08-10 this exact
   * failure — Microsoft's 9.5p2 against OpenSSH 9.6p1 on Ubuntu 24.04 — arrived
   * as `no_answer` and told the user their address, their port, their boot or
   * their firewall was at fault, none of which had been checked and all of which
   * pointed at the server for a defect on the PC.
   */
  | "tool_cannot_scan";

export type HostKeyScanResult =
  | {
      ok: true;
      offer: HostKeyOffer;
      /** Which OpenSSH actually produced this key. For the log, not for a sentence. */
      via?: ResolvedSshTool;
    }
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
export function scanHostKey(record: HostRecord, run: RunKeyscan = runKeyscan): HostKeyScanResult {
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
  const argv = [
    // Bounded, because this runs while somebody is watching a wizard. The
    // default is five seconds per key type and this asks for three.
    "-T", "10",
    "-p", String(record.port),
    // Asked for in DASH's own order of preference. What arrives is whatever
    // the host has; `chooseHostKey` decides which one is pinned.
    "-t", "ed25519,ecdsa,rsa",
    address,
  ];

  /*
   * Every `ssh-keyscan` on this machine, in preference order, until one can do
   * the job (MAR-600).
   *
   * This loop is what "prefer a capable one" means in practice, and preferring
   * by *outcome* is the only honest way to do it — nothing DASH can ask a build
   * locally distinguishes one that will complete a key exchange with a given
   * sshd from one that will not. The cost of being wrong first is one failed
   * scan, and the observed failure is immediate: 9.5p2 printed the host's
   * banner and gave up on the key exchange in well under a second.
   *
   * `no_supported_key` stops the loop. That is the *server* offering nothing
   * DASH will pin, and asking a second binary the same question would get the
   * same answer more slowly.
   */
  let worst: HostKeyScanProblem = "no_ssh";
  const incapable: ResolvedSshTool[] = [];
  for (const tool of sshToolCandidates("ssh-keyscan")) {
    const attempt = run(tool, argv);
    if (attempt.absent) {
      continue;
    }
    const read = classifyKeyscanAttempt(attempt);
    if (read.ok) {
      if (incapable.length > 0) {
        console.error(
          `[ssh] ssh-keyscan from ${incapable.map((one) => one.source).join(", ")} could not ` +
            `complete a key exchange with this server; used ${tool.command} (${tool.source}) instead`,
        );
      } else {
        announce(tool);
      }
      return { ok: true, offer: read.offer, via: tool };
    }
    if (read.problem === "tool_cannot_scan") {
      incapable.push(tool);
      worst = "tool_cannot_scan";
      continue;
    }
    if (read.problem === "no_answer" && worst === "tool_cannot_scan") {
      // An earlier candidate already saw this server's own protocol banner, so
      // "nothing answered" is a thing DASH now knows to be false. A second
      // binary being quieter about the same failure must not be allowed to
      // downgrade what the first one proved — that downgrade is the whole of
      // MAR-600.
      continue;
    }
    /*
     * `no_supported_key` and `no_answer` both end the loop, and the second is
     * the deliberate one.
     *
     * Nothing came back at all, from the first binary asked, which on a healthy
     * one means nothing is listening — and a second cannot make a silent address
     * speak. Trying one anyway would double the wait on the commonest mistake
     * there is, a mistyped address, to insure against a locally broken build
     * that would also have failed `probeSshTools`. The wrong address is certain
     * and the broken build is hypothetical, so the wizard is kept fast for the
     * certain one.
     */
    return { ok: false, problem: read.problem };
  }

  if (worst === "tool_cannot_scan") {
    console.error(
      `[ssh] no ssh-keyscan on this computer could read this server's identity; tried: ` +
        incapable.map((one) => `${one.command} (${one.source})`).join(", "),
    );
  }
  return { ok: false, problem: worst };
}

/** What one `ssh-keyscan` run said. `absent` is the only "it was not there" answer. */
export interface KeyscanAttempt {
  stdout: string;
  stderr: string;
  absent: boolean;
}

/** How one scan is run, so the classification below can be tested without a host. */
export type RunKeyscan = (tool: ResolvedSshTool, argv: readonly string[]) => KeyscanAttempt;

/** The real one. Never throws: a failed scan is an answer, not an exception. */
function runKeyscan(tool: ResolvedSshTool, argv: readonly string[]): KeyscanAttempt {
  const result = spawnSync(tool.command, [...argv], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 20_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    absent: (result.error as { code?: string } | undefined)?.code === "ENOENT",
  };
}

/**
 * A silent address, an unusable server, or a tool that cannot do the job
 * (MAR-600).
 *
 * Pure, and separated from the process that produced the text for the reason
 * `inspectAcl` is separated from `icacls`: the case that matters most is one no
 * test machine can reproduce on demand — it needs a stock Windows 11 and a
 * rented Ubuntu box — and it can be written down exactly and asserted against
 * anywhere.
 *
 * ## The distinction, which is the whole point
 *
 * `ssh-keyscan` reaching a server and failing writes down the proof that it
 * reached it. The 2026-08-10 run captured both lines:
 *
 * ```
 * # 186.240.156.166:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.18
 * choose_kex: unsupported KEX method sntrup761x25519-sha512@openssh.com
 * ```
 *
 * The first is the server's own protocol banner. A machine that does not answer
 * cannot produce one, so its presence settles the question the old code got
 * wrong: **something is listening at that address and port**, and a scan that
 * then yields no key is this computer's failure, not the server's. The second
 * line names the mechanism, and either alone is enough — a build wording its
 * negotiation failure differently still gets classified by the banner, and a
 * build that fails before printing one still gets classified by the wording.
 *
 * Nothing from either line reaches a person. This function's return type is a
 * closed union, the same guard `classifyHostFailure` is built on.
 */
export function classifyKeyscanAttempt(attempt: {
  stdout: string;
  stderr: string;
}): { ok: true; offer: HostKeyOffer } | { ok: false; problem: Exclude<HostKeyScanProblem, "no_ssh"> } {
  // The banner comment is stdout on the builds this project has seen and stderr
  // on others, and which one it is has never been the interesting question.
  const said = `${attempt.stdout}\n${attempt.stderr}`;

  const parsed = parseScannedHostKeys(attempt.stdout);
  if (parsed.ok) {
    return { ok: true, offer: parsed.offer };
  }
  if (parsed.problem === "no_supported_key") {
    // Lines arrived and none of them was a key DASH will pin — a server running
    // a key type this project refuses to teach anyone to accept. The tool did
    // its job.
    return { ok: false, problem: "no_supported_key" };
  }

  if (/SSH-\d+\.\d+-/.test(said) || KEX_FAILURE.test(said)) {
    return { ok: false, problem: "tool_cannot_scan" };
  }
  return { ok: false, problem: "no_answer" };
}

/**
 * How a client says it ran out of algorithms.
 *
 * `choose_kex` is `ssh-keyscan`'s own wording, from the run. The rest are what
 * OpenSSH prints for the same class of failure across builds and on the
 * connection plane, kept together because they mean one thing: the two ends
 * share no algorithm, and the end DASH can do something about is this one.
 */
const KEX_FAILURE =
  /choose_kex|unsupported kex|no matching key exchange method|no matching cipher|no matching mac|unable to negotiate/i;

/**
 * A scan's refusal, in the vocabulary the surface renders (MAR-600).
 *
 * Here rather than at the call site because `HostKeyScanProblem` is declared
 * here, and a mapping written where it is *used* is a mapping that gets missed
 * when a member is added. `main` had two of them, neither exhaustive, and a new
 * member would have fallen quietly through to whatever the last branch said —
 * which is precisely how a defect on this computer came to be reported as a
 * fault on the user's server.
 */
export function hostScanRefusal(problem: HostKeyScanProblem): {
  detail: string;
  problem: HostReachProblem;
} {
  switch (problem) {
    case "no_ssh":
      return {
        detail: "This computer is missing the tool DASH uses to check a server's identity.",
        problem: "no_ssh_on_this_computer",
      };
    case "tool_cannot_scan":
      return {
        detail: "This computer's connection tools could not read this server's identity.",
        problem: "ssh_tools_cannot_check_here",
      };
    case "no_answer":
      return {
        detail: "Nothing answered at this server's address.",
        problem: "no_answer_at_address",
      };
    case "no_supported_key":
      return {
        detail: "This server offered no identity DASH knows how to check.",
        problem: "sign_in_refused",
      };
  }
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
  const child = spawn(announce(resolveSshTool("ssh")).command, sshArgv(record, verb, paths, bundleId), {
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
