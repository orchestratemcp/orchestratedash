/**
 * The local channel credential, and the ACL that actually protects it.
 *
 * ## Why this file exists at all
 *
 * MAR-415 kept the runner's bearer token in the OS vault. That was the right
 * instinct applied to the wrong secret. A vault protects a credential *from
 * other software on the machine*, and it costs a hard dependency on DPAPI /
 * Keychain / libsecret — which is how `runner/README.md` item 7 came to say "no
 * OS-backed vault means no runner", i.e. a Linux box with no keyring could not
 * host even an agent that had no secrets of its own.
 *
 * MAR-430 draws the line where it belongs:
 *
 * - **Provider credentials and remote enrollment tokens** are things a person
 *   entrusted to DASH. They still go in `SecureStore` and still fail closed
 *   when there is no vault. Nothing about that changes.
 * - **The local channel credential** is not entrusted by anyone. It is a value
 *   this installation minted for itself, to talk to a process it started, on
 *   the same machine, under the same user account. Its whole threat model is
 *   "another principal on this box", and the operating system already has a
 *   mechanism for that: file ownership.
 *
 * So it lives in a file whose ACL we set and — this is the part that makes it a
 * claim rather than a hope — **verify**.
 *
 * ## Verifying an ACL from Node, without native code
 *
 * POSIX is easy: `chmod 0600`, then `stat` and check the mode and the uid.
 *
 * Windows has no `fs` answer at all — `chmod` there only toggles the read-only
 * bit — so this module shells out to two binaries that ship with the OS:
 *
 * | Step | Command | Why this one |
 * | --- | --- | --- |
 * | Find our SID | `whoami /user /fo csv /nh` | Locale-independent. A name is not. |
 * | Set the ACL | `icacls f /inheritance:r /grant:r "*SID:F" "*S-1-5-18:F"` | `/inheritance:r` is what makes it *not* inherit whatever the profile tree grants. |
 * | Read it back | `icacls f /save out` | Emits **SDDL with raw SIDs**, UTF-16LE. |
 *
 * SIDs throughout, never account names. This machine's Administrators group is
 * spelled `Administratör`; a check that parsed display names would pass in
 * en-US and fail in Swedish, which is the worst possible failure mode for a
 * security check.
 *
 * `/inheritance:r` matters more than it looks. The DASH data directory inherits
 * its ACL from the user profile, and inherited grants are added by things
 * outside this app — the machine this was developed on had a local group
 * granted read over `%APPDATA%\orchestratedash` by unrelated tooling. An
 * inherited ACL is not a controlled one, so the secret's ACL is protected and
 * then proven.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

/** `{dataDir}/runner.key`. Sibling of `runner.json`, which stays secret-free. */
export function channelSecretPath(dataDir: string): string {
  return path.join(dataDir, "runner.key");
}

/** NT AUTHORITY\SYSTEM. Present in every SDDL we accept, spelled either way. */
const SYSTEM_SIDS = new Set(["SY", "S-1-5-18"]);
/** BUILTIN\Administrators. Accepted, not granted — see `assertWindowsAclIsOwnerOnly`. */
const ADMIN_SIDS = new Set(["BA", "S-1-5-32-544"]);

export type ChannelSecretProblem =
  /** The ACL could not be applied, read back, or did not say what it must. */
  | "acl_unprovable"
  /** A principal beyond the owner, SYSTEM and Administrators holds access. */
  | "acl_too_wide"
  /** The file exists but this user does not own it. */
  | "foreign_owner"
  /** The stored value is not the shape this module writes. */
  | "malformed";

export class ChannelSecretError extends Error {
  readonly problem: ChannelSecretProblem;
  constructor(problem: ChannelSecretProblem, message: string) {
    super(message);
    this.name = "ChannelSecretError";
    this.problem = problem;
  }
}

/**
 * Read the channel secret, minting one on first run.
 *
 * The ACL is applied and verified on **every** call, not only when the file is
 * created. An ACL that was right once is not a property of a file; it is a
 * property of a file at a moment, and the moment that matters is this one.
 *
 * @throws ChannelSecretError
 */
export function ensureChannelSecret(dataDir: string): string {
  const file = channelSecretPath(dataDir);

  if (!existsSync(file)) {
    // 32 bytes of CSPRNG output, base64url — the same shape and the same
    // reasoning as the command nonce in `lib/agent-dom/envelope.ts`.
    // Written before it is hardened, so it is created empty-of-meaning to
    // anyone who wins the race, and hardened before it is returned.
    writeFileSync(file, `${randomBytes(32).toString("base64url")}\n`, { encoding: "utf8", mode: 0o600 });
  }

  hardenOwnerOnly(file);

  const secret = readFileSync(file, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{40,}$/.test(secret)) {
    // The value is never quoted into the error. A malformed secret is still a
    // secret, and this message reaches a log.
    throw new ChannelSecretError(
      "malformed",
      `${file} does not contain a channel secret this runner wrote. Delete it and restart DASH to mint a new one.`,
    );
  }
  return secret;
}

/**
 * Apply the owner-only ACL to one path, then prove it.
 *
 * Exported and generalised over files and directories by MAR-434, which needs
 * the identical guarantee for the task workspace: a directory holding a
 * customer's documents is protected by the same mechanism, verified the same
 * way, or it is protected by a comment. Writing a second ACL implementation
 * beside this one would have meant two places for the Swedish-`Administratör`
 * bug to come back to.
 *
 * The directory case differs in exactly two ways and neither changes the rule.
 * The POSIX mode is `0700` rather than `0600`, because a directory nobody may
 * enter is a directory nobody may read a file out of. And the Windows grant
 * carries `(OI)(CI)`, so the files the runner creates inside inherit the
 * protection instead of each needing its own pass — which matters because those
 * files are created in a hot path and shelling out to `icacls` per input file
 * would be both slow and a new failure mode per file.
 *
 * @throws ChannelSecretError
 */
export function hardenOwnerOnly(target: string, options: { directory?: boolean } = {}): void {
  const directory = options.directory ?? false;

  if (process.platform === "win32") {
    hardenWindows(target, directory);
    return;
  }

  chmodSync(target, directory ? 0o700 : 0o600);
  const stats = statSync(target);
  const uid = process.getuid?.();
  if (uid !== undefined && stats.uid !== uid) {
    throw new ChannelSecretError(
      "foreign_owner",
      `${target} is owned by uid ${String(stats.uid)}, not by uid ${String(uid)}.`,
    );
  }
  // `chmod` reports success and the mode is what `stat` says, which are not
  // the same claim on a filesystem that does not carry POSIX modes — a
  // DASH data directory on an SMB or FAT mount, for instance.
  if ((stats.mode & 0o077) !== 0) {
    throw new ChannelSecretError(
      "acl_too_wide",
      `${target} is mode ${(stats.mode & 0o777).toString(8)} after chmod ${directory ? "700" : "600"}. ` +
        `The filesystem holding the data directory does not enforce POSIX permissions.`,
    );
  }
}

/**
 * Set the ACL, read it back, remove whatever should not be there, prove it.
 *
 * The repair pass is not defensive padding; it is required for correctness.
 * `icacls /grant:r` replaces the ACEs **of the principals it names** and leaves
 * every other explicit ACE alone, and `/inheritance:r` removes only *inherited*
 * ACEs. So neither of them removes an explicit grant that something else added
 * to this file. Without the second pass, one stray ACE would make the ACL
 * permanently unprovable, and DASH would refuse to host agents for the rest of
 * the installation's life with no remedy short of the user running `icacls` by
 * hand.
 *
 * So: harden, inspect, remove the trustees the inspection names, inspect again.
 * If it is still wrong the second time, that is a refusal — a secret whose ACL
 * cannot be proven is not a protected secret, which is the issue's own rule.
 *
 * @throws ChannelSecretError
 */
function hardenWindows(file: string, directory = false): void {
  const sid = currentUserSid();
  // `(OI)(CI)` on a directory so new children inherit the protected ACL. On a
  // file the flags are meaningless and `icacls` rejects them, so they are only
  // applied where they mean something.
  const rights = directory ? "(OI)(CI)F" : "F";
  icacls(file, ["/inheritance:r", "/grant:r", `*${sid}:${rights}`, `*S-1-5-18:${rights}`]);

  const first = inspectAcl(readAcl(file), sid, file);
  if (first.ok) {
    return;
  }
  if (first.foreign.length === 0) {
    // Nothing nameable to remove — an unparseable descriptor, or a deny ACE.
    throw new ChannelSecretError(first.problem, first.detail);
  }

  for (const trustee of first.foreign) {
    icacls(file, ["/remove:g", `*${trustee}`, "/remove:d", `*${trustee}`]);
  }

  const second = inspectAcl(readAcl(file), sid, file);
  if (!second.ok) {
    throw new ChannelSecretError(second.problem, second.detail);
  }
}

/** One `icacls` invocation, with its failure named. @throws ChannelSecretError */
function icacls(file: string, args: string[]): void {
  try {
    execFileSync("icacls", [file, ...args], { stdio: "pipe", windowsHide: true });
  } catch (error: unknown) {
    throw new ChannelSecretError(
      "acl_unprovable",
      `The runner could not set the ACL on ${file}: ${describe(error)}`,
    );
  }
}

/** The file's real security descriptor, as SDDL. @throws ChannelSecretError */
function readAcl(file: string): string {
  const scratch = mkdtempSync(path.join(tmpdir(), "dash-acl-"));
  const dump = path.join(scratch, "acl.sddl");
  try {
    execFileSync("icacls", [file, "/save", dump], { stdio: "pipe", windowsHide: true });
    // `/save` writes UTF-16LE: the filename on one line, the SDDL on the next.
    return readFileSync(dump, "utf16le");
  } catch (error: unknown) {
    throw new ChannelSecretError(
      "acl_unprovable",
      `The runner could not read back the ACL on ${file}, so it cannot prove the channel ` +
        `secret is owner-only: ${describe(error)}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export type AclInspection =
  | { ok: true }
  | { ok: false; problem: ChannelSecretProblem; detail: string; foreign: string[] };

/**
 * The rule itself, on a string, so it can be tested without Windows.
 *
 * Split out for the reason `lib/agent-dom/control-location.ts` gives for its
 * own split: "a security boundary that can only be tested by standing up a
 * server is one that mostly does not get tested." This one would otherwise need
 * a second user account and a Windows runner to exercise at all, and the case
 * that matters most — the descriptor Windows puts on a named pipe by default,
 * with `WD` and `AN` in it — can be written down exactly and asserted against
 * on any platform.
 *
 * Three things are checked, and the first is the one that is easy to forget:
 *
 * 1. **The DACL is protected** (`P` in the `D:` flags). Without that, the ACEs
 *    below are merely today's inherited answer.
 * 2. **Every ACE is an allow ACE** for the owner, SYSTEM or Administrators.
 * 3. **Nothing else appears** — in particular not `WD` (Everyone) or `AN`
 *    (Anonymous), which are exactly what a Windows named pipe's default
 *    descriptor grants and what this file exists to compensate for.
 *
 * Administrators are *accepted but not granted*. An administrator can take
 * ownership of any file on the machine, so refusing to run because they appear
 * would be theatre; granting them explicitly would be widening the ACL
 * ourselves. Neither, then: `/grant:r` leaves them out, and their presence via
 * some policy does not fail the check.
 *
 * `foreign` names the trustees a caller may remove to fix the ACL, so the
 * repair pass in `hardenWindows` does not have to re-derive them.
 */
export function inspectAcl(sddl: string, sid: string, file = "the secret"): AclInspection {
  const dacl = /D:([A-Z]*)((?:\([^)]*\))*)/.exec(sddl);
  if (dacl === null) {
    return {
      ok: false,
      problem: "acl_unprovable",
      detail: `The ACL saved for ${file} contained no DACL this runner could parse.`,
      foreign: [],
    };
  }

  const [, flags = "", aces = ""] = dacl;
  const foreign: string[] = [];
  for (const ace of aces.matchAll(/\(([^)]*)\)/g)) {
    // type;flags;rights;objectGuid;inheritObjectGuid;accountSid
    const fields = (ace[1] ?? "").split(";");
    const type = fields[0] ?? "";
    const trustee = fields[5] ?? "";
    if (type !== "A" && type !== "D") {
      // Audit and alarm ACEs belong in a SACL. One here is a descriptor this
      // module does not understand, and an ACL we do not understand is one we
      // must not vouch for.
      return {
        ok: false,
        problem: "acl_unprovable",
        detail: `The ACL on ${file} carries an ACE type (${type}) this runner did not write.`,
        foreign: [],
      };
    }
    if (type === "A" && (trustee === sid || SYSTEM_SIDS.has(trustee) || ADMIN_SIDS.has(trustee))) {
      continue;
    }
    foreign.push(trustee);
  }

  if (foreign.length > 0) {
    return {
      ok: false,
      problem: "acl_too_wide",
      detail:
        `The ACL on ${file} names ${foreign.join(", ")}, which is neither this user, SYSTEM, ` +
        `nor Administrators. Refusing to use a channel secret another principal can reach.`,
      foreign,
    };
  }

  // Checked last so that a widened *and* inherited ACL reports the trustees a
  // caller can actually remove, rather than stopping at the flag.
  if (!flags.includes("P")) {
    return {
      ok: false,
      problem: "acl_too_wide",
      detail: `The ACL on ${file} still inherits from its parent directory, so it is not a controlled ACL.`,
      foreign: [],
    };
  }

  return { ok: true };
}

/**
 * This process's user SID.
 *
 * `whoami /user /fo csv /nh` prints `"DOMAIN\user","S-1-5-21-…"`. The SID field
 * is parsed rather than the name field on purpose: `icacls` accepts `*SID`
 * syntax precisely so callers never have to spell a localised account name.
 */
function currentUserSid(): string {
  let output: string;
  try {
    output = execFileSync("whoami", ["/user", "/fo", "csv", "/nh"], {
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true,
    });
  } catch (error: unknown) {
    throw new ChannelSecretError(
      "acl_unprovable",
      `The runner could not determine its own user SID: ${describe(error)}`,
    );
  }

  const sid = /(S-1-[0-9-]+)/.exec(output)?.[1];
  if (sid === undefined) {
    throw new ChannelSecretError(
      "acl_unprovable",
      "`whoami /user` returned no SID, so the channel secret's ACL cannot be written against one.",
    );
  }
  return sid;
}

/** Errors from `execFileSync` carry stdio buffers; only the message is safe. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
