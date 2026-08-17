/**
 * The host pack on a host's disk: the empty secret store, the wrapping key, and
 * the identity file `pack` reads (MAR-629, ADR 0021).
 *
 * Lives in `runner/` beside `path-guard.ts` for that module's reason: this is
 * code that runs on a machine DASH does not administer, imported by **both** the
 * helper and the runner, and neither of them is Electron. The helper lays the
 * pack down and proves it; the runner's host broker reads keys out of it. One
 * module so the two cannot disagree about where a key lives — which would be a
 * broker that reads an empty directory while a placement receipt says a key is
 * on the server.
 *
 * ## The layout, and what each mode is for (ADR 0021 section 3)
 *
 * ```
 * {hostRoot}/
 *   bundles/                       existing; replaceable by `install`
 *   secrets/                       0700; helper-chosen; `install` never writes here
 *     pack.json                    0600; { "pack_version": 1 }; no keys
 *     wrap.key                     0600; the wrapping key the helper minted
 *     keys/                        0700
 *       {bundle_id}/               0700
 *         {connection_id}          0600; one encrypted key file
 * ```
 *
 * `bundle_id` and `connection_id` are identifiers and never paths — the alphabet
 * in `lib/deploy/verbs.ts` cannot spell a separator — and this module re-checks
 * containment after joining anyway. That is belt and braces on the same
 * arithmetic `scripts/host-helper/main.ts` does for a bundle file, and it is
 * worth more here: the tree this protects is the one with the keys in it.
 *
 * ## The honest protection claim, said in the code that implements it
 *
 * The bytes are encrypted at rest with a key stored `0600` **in the same
 * account**. So this is a speed bump against the rest of the disk and against
 * other host principals, and it is not a vault:
 *
 * - the helper/runner account can read `wrap.key` and therefore every value;
 * - root can take ownership;
 * - another process running as that account can read what that account owns;
 * - `0600` does not sandbox two agents that share a uid.
 *
 * The local Windows vault is OS-keychain backed. This is not that, and no
 * receipt built on this module may borrow its words. ADR 0021 fixes the
 * sentence: *the key is protected by that machine's account, not by a keychain*.
 *
 * Encrypting anyway is still worth the code. It means a backup, a snapshot, a
 * stray `tar` of the home directory or a misconfigured file sync carries
 * ciphertext, which is a real and common way a plaintext secret leaves a machine
 * without anybody attacking it.
 *
 * ## Why POSIX proofs are conditional and that is not a loophole
 *
 * The host is Linux. This module is *tested* on whatever CI and a developer
 * happen to run, and Node on Windows reports a mode that means nothing —
 * `process.getuid` is not even defined there. So the owner-and-mode proof runs
 * where the platform has one and is skipped where it does not, and
 * `packProtection` reports which happened rather than claiming a proof nobody
 * performed. ADR 0004's shape, one module down: the Linux proof is real on the
 * machine that matters and CI runs on Linux; a green Windows test proves the
 * protocol and the encryption and does not claim the filesystem.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";

import { HOST_PACK_VERSION } from "../lib/deploy/host-pack";
import { containedIn } from "./path-guard";

/* ---------------------------------------------------------------------- *
 * Where the pack lives
 * ---------------------------------------------------------------------- */

export function secretsRoot(hostRoot: string): string {
  return path.join(hostRoot, "secrets");
}

export function packIdentityFile(hostRoot: string): string {
  return path.join(secretsRoot(hostRoot), "pack.json");
}

export function wrappingKeyFile(hostRoot: string): string {
  return path.join(secretsRoot(hostRoot), "wrap.key");
}

export function keysRoot(hostRoot: string): string {
  return path.join(secretsRoot(hostRoot), "keys");
}

/**
 * Where one placed key lives, or null when the identifiers do not resolve below
 * the keys root.
 *
 * Null rather than a throw, and re-checked rather than trusted. The alphabet in
 * `lib/deploy/verbs.ts` already makes a separator unspellable, so reaching the
 * null branch means something upstream stopped validating — which is exactly
 * when a containment check earns its keep.
 */
export function hostKeyFile(
  hostRoot: string,
  bundleId: string,
  connectionId: string,
): string | null {
  const root = keysRoot(hostRoot);
  const directory = path.join(root, bundleId);
  const file = path.join(directory, connectionId);
  if (!containedIn(root, directory) || !containedIn(directory, file)) {
    return null;
  }
  return file;
}

/* ---------------------------------------------------------------------- *
 * Laying the pack down
 * ---------------------------------------------------------------------- */

/** Whether this platform has an owner and a mode worth proving. */
function hasPosixModes(): boolean {
  return process.platform !== "win32";
}

/**
 * Create every parent as owner-only, on the platforms that have owners.
 *
 * `mkdirSync`'s `mode` is masked by the process umask, so a `0o700` request on a
 * host with an unusual umask can land as something wider. The `chmodSync`
 * afterwards is what actually decides the mode, and it runs on the directory
 * whether this call created it or a previous install did — a pack laid down by
 * an older umask is repaired by the next helper invocation rather than left.
 */
function ensureOwnerOnlyDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (hasPosixModes()) {
    chmodSync(directory, 0o700);
  }
}

function writeOwnerOnlyFile(file: string, bytes: Buffer): void {
  /*
   * Written beside and renamed into place, so a failure part-way leaves the
   * previous file rather than a truncated one. `install-key` will need exactly
   * this property for a key replacement — ADR 0018: *"Failure replacing an
   * existing key leaves the previous shadow and says so"* — and building the
   * pack's own writes on it means the primitive is the same one.
   */
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, bytes, { mode: 0o600 });
  if (hasPosixModes()) {
    chmodSync(temporary, 0o600);
  }
  renameSync(temporary, file);
  if (hasPosixModes()) {
    chmodSync(file, 0o600);
  }
}

export type PackInstall =
  | { ok: true; pack_version: number; minted_wrapping_key: boolean }
  | { ok: false; detail: string };

/**
 * Lay down the pack, or repair one that is already there.
 *
 * Called at the top of every helper invocation, which is what makes ADR 0021's
 * *"re-running setup replaces the helper and lays down the empty pack as one
 * step"* true without a second install path. The bootstrap writes the helper's
 * bytes; the first thing those bytes do is this. There is no "install just the
 * broker" and no half state a person is asked to reason about.
 *
 * **Empty, always.** This creates directories, an identity file and a wrapping
 * key, and it never writes a `{connection_id}`. ADR 0021 rule 6 is the whole
 * reason that sentence is worth writing down: a pack that shipped the vault's
 * contents would grant every credential to a machine in one action and destroy
 * the per-key consent ADR 0018 exists to obtain. There is no argument, no flag
 * and no future convenience that turns this function into a key writer.
 *
 * **Idempotent, and it does not re-mint.** An existing `wrap.key` is left
 * exactly where it is: minting a new one would silently make every key already
 * placed under the old one unreadable, which would present as a broker that
 * refuses a key a receipt says is on the server.
 */
export function ensureHostPack(hostRoot: string): PackInstall {
  try {
    const secrets = secretsRoot(hostRoot);
    if (!containedIn(hostRoot, secrets)) {
      return { ok: false, detail: "The secrets root did not resolve below the host root." };
    }
    ensureOwnerOnlyDirectory(secrets);
    ensureOwnerOnlyDirectory(keysRoot(hostRoot));

    const wrapFile = wrappingKeyFile(hostRoot);
    const minted = !existsSync(wrapFile);
    if (minted) {
      writeOwnerOnlyFile(wrapFile, randomBytes(WRAPPING_KEY_BYTES));
    }

    writeOwnerOnlyFile(
      packIdentityFile(hostRoot),
      Buffer.from(`${JSON.stringify({ pack_version: HOST_PACK_VERSION }, null, 2)}\n`, "utf8"),
    );

    return { ok: true, pack_version: HOST_PACK_VERSION, minted_wrapping_key: minted };
  } catch (error: unknown) {
    // The class and never the path or the message. This string travels to DASH
    // and a filesystem error names directories on a machine DASH does not
    // administer — `uninstall` makes the same choice for the same reason.
    return {
      ok: false,
      detail: `The pack could not be written: ${(error as { code?: string } | null)?.code ?? "unknown reason"}.`,
    };
  }
}

/* ---------------------------------------------------------------------- *
 * Proving it
 * ---------------------------------------------------------------------- */

export type PackProof =
  | { ok: true; pack_version: number }
  | { ok: false; detail: string };

/**
 * Whether this host really has a pack, as `pack` answers it.
 *
 * Three things have to be true, and ADR 0021 section 4 names all three as
 * `host_pack_too_old` when they are not: `pack.json` present and holding an
 * integer version, the wrapping key readable, and the secrets root owner-only.
 * A pack that is missing one of them is a failed install rather than a version,
 * and the only repair is the setup step — so this refuses rather than repairing
 * silently, even though `ensureHostPack` ran moments earlier and would have.
 *
 * That ordering is deliberate: `runHelper` calls `ensureHostPack` first, so
 * reaching a refusal here means the pack could not be made good on a machine
 * that just tried. Reporting "fine" after a repair nobody watched would hide a
 * disk that is failing, a root that is not writable, or a permissions model this
 * code does not understand.
 */
export function proveHostPack(hostRoot: string): PackProof {
  const secrets = secretsRoot(hostRoot);
  if (!existsSync(secrets)) {
    return { ok: false, detail: "This server has no host pack." };
  }
  if (hasPosixModes()) {
    try {
      const found = statSync(secrets);
      if (!found.isDirectory() || (found.mode & 0o777) !== 0o700) {
        return { ok: false, detail: "This server's host pack is not owner-only." };
      }
    } catch {
      return { ok: false, detail: "This server's host pack could not be read." };
    }
  }

  let version: unknown;
  try {
    version = (
      JSON.parse(readFileSync(packIdentityFile(hostRoot), "utf8")) as { pack_version?: unknown }
    ).pack_version;
  } catch {
    return { ok: false, detail: "This server's host pack does not say which version it is." };
  }
  if (!Number.isInteger(version) || (version as number) < 1) {
    return { ok: false, detail: "This server's host pack does not say which version it is." };
  }

  /*
   * The wrapping key is read for its *length*, and the value is dropped on the
   * next line. A pack whose wrapping key is absent or the wrong size cannot
   * decrypt anything placed under it, so a `pack` answer that ignored it would
   * report a working runtime for a host where every brokered call is about to
   * fail with an unreadable key.
   */
  const wrapping = readWrappingKey(hostRoot);
  if (wrapping === null) {
    return { ok: false, detail: "This server's host pack has no usable wrapping key." };
  }
  wrapping.fill(0);

  return { ok: true, pack_version: version as number };
}

/**
 * What the pack does and does not protect, in words a receipt may use.
 *
 * A constant rather than a composed sentence, for `MODEL_KEY_STAYS_HOME_REFUSAL`'s
 * reason: it is the load-bearing custody claim, a test pins it by value, and a
 * sentence built where it is rendered is a sentence somebody softens.
 *
 * ADR 0021 section 3 fixes the clause exactly. It extends ADR 0018's custody
 * sentence rather than replacing it, and the thing it must never say is
 * "keychain".
 */
export const HOST_KEY_PROTECTION_SENTENCE =
  "the key is protected by that machine's account, not by a keychain";

/* ---------------------------------------------------------------------- *
 * Keys, at rest
 * ---------------------------------------------------------------------- */

const WRAPPING_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Read the wrapping key, or null.
 *
 * Returns a `Buffer` the caller is expected to `fill(0)` when it is done.
 * Zeroing is not a guarantee — Node copies buffers freely and a garbage
 * collector moves them — and it is done anyway because the alternative is
 * leaving the key sitting in a long-lived allocation for the life of a process
 * that runs for weeks on somebody's server.
 */
function readWrappingKey(hostRoot: string): Buffer | null {
  try {
    const bytes = readFileSync(wrappingKeyFile(hostRoot));
    return bytes.length === WRAPPING_KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

export type HostKeyRead =
  | { kind: "found"; key: string }
  /** No key is placed for that bundle and connection. */
  | { kind: "absent" }
  /** A file is there and this pack cannot read it. */
  | { kind: "unusable" };

/**
 * Read one placed key.
 *
 * **Scoped to the bundle, and that scope is the isolation.** ADR 0021 refuses
 * *"a key placed for a different bundle"* by name, and the reason it has to be
 * enforced by the path rather than by the account is written into the ADR:
 * same-account `0600` is not isolation, because the helper and every runner
 * share one uid. So the broker that answers a runner is handed *its own* bundle
 * id by the helper that started it, and the only keys it can name are the ones
 * beneath that id.
 *
 * `unusable` rather than a throw for a file this pack cannot decrypt. A wrapping
 * key that was re-minted, a truncated write, a file somebody put there by hand:
 * all of them are "there is something here and it is not a key I can use", which
 * the broker turns into `revoked` — the refusal whose next move is a person
 * making a new one, which is the correct next move for every one of those cases.
 */
export function readHostKey(
  hostRoot: string,
  bundleId: string,
  connectionId: string,
): HostKeyRead {
  const file = hostKeyFile(hostRoot, bundleId, connectionId);
  if (file === null || !existsSync(file)) {
    return { kind: "absent" };
  }
  const wrapping = readWrappingKey(hostRoot);
  if (wrapping === null) {
    return { kind: "unusable" };
  }
  try {
    const sealed = readFileSync(file);
    if (sealed.length <= NONCE_BYTES + TAG_BYTES) {
      return { kind: "unusable" };
    }
    const nonce = sealed.subarray(0, NONCE_BYTES);
    const tag = sealed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const body = sealed.subarray(NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", wrapping, nonce);
    /*
     * The slot is the additional authenticated data, so a key file moved from
     * one bundle's directory to another's fails to decrypt rather than being
     * read as that bundle's key. Without it, the bundle scope above would be a
     * check on a path and nothing more — and a path is the thing an attacker
     * with the account already has.
     */
    decipher.setAAD(Buffer.from(`${bundleId} ${connectionId}`, "utf8"));
    decipher.setAuthTag(tag);
    const opened = Buffer.concat([decipher.update(body), decipher.final()]);
    const key = opened.toString("utf8");
    opened.fill(0);
    return { kind: "found", key };
  } catch {
    return { kind: "unusable" };
  } finally {
    wrapping.fill(0);
  }
}

export type HostKeyWrite = { ok: true } | { ok: false; detail: string };

/**
 * Seal one key into the store.
 *
 * **This is a primitive, not a verb.** ADR 0018's `install-key` is the admitted
 * way a key crosses, it is MAR-625's to write, and it is not in this pack —
 * ADR 0021 rule 6 and the ceremony in ADR 0018 are what stand between this
 * function and a key. What the pack owes that verb is the store it writes into,
 * with the encryption, the modes and the proof already decided, so that the
 * session which builds the ceremony is not also inventing a file format.
 *
 * So the callers today are `install-key`, when it lands, and the tests that
 * prove the broker can read what was placed. Nothing in DASH calls it: there is
 * no IPC route, no command and no deploy verb that reaches it, and adding one
 * without the ceremony would be the bulk-sync ADR 0021 rule 6 forbids.
 *
 * It refuses when the pack is missing, which is ADR 0021's stated obligation:
 * a key written beside an absent wrapping key is a key nothing can ever read.
 */
export function writeHostKey(
  hostRoot: string,
  bundleId: string,
  connectionId: string,
  key: string,
): HostKeyWrite {
  const proof = proveHostPack(hostRoot);
  if (!proof.ok) {
    return { ok: false, detail: proof.detail };
  }
  const file = hostKeyFile(hostRoot, bundleId, connectionId);
  if (file === null) {
    return { ok: false, detail: "The declared key slot did not resolve below the pack's keys root." };
  }
  const wrapping = readWrappingKey(hostRoot);
  if (wrapping === null) {
    return { ok: false, detail: "This server's host pack has no usable wrapping key." };
  }
  try {
    ensureOwnerOnlyDirectory(path.dirname(file));
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", wrapping, nonce);
    cipher.setAAD(Buffer.from(`${bundleId} ${connectionId}`, "utf8"));
    const body = Buffer.concat([cipher.update(Buffer.from(key, "utf8")), cipher.final()]);
    // `nonce | tag | body`, which is what `readHostKey` slices back apart. The
    // tag is read from the cipher only after `final`, which is the one ordering
    // rule GCM has and the one a rewrite gets wrong.
    writeOwnerOnlyFile(file, Buffer.concat([nonce, cipher.getAuthTag(), body]));

    /*
     * Read the owner and the mode back, and refuse if either cannot be proved.
     * ADR 0018 rule 3 requires exactly this and it is the reason `install-key`
     * is a verb rather than a bundle file: a key that landed world-readable is
     * a key on somebody's server that this code told them was owner-only.
     */
    if (hasPosixModes()) {
      const found = statSync(file);
      const uid = process.getuid?.();
      if ((found.mode & 0o777) !== 0o600 || (uid !== undefined && found.uid !== uid)) {
        rmSync(file, { force: true });
        return { ok: false, detail: "The key file's owner and permissions could not be proved." };
      }
    }
    return { ok: true };
  } catch (error: unknown) {
    return {
      ok: false,
      detail: `The key could not be written: ${(error as { code?: string } | null)?.code ?? "unknown reason"}.`,
    };
  } finally {
    wrapping.fill(0);
  }
}

/**
 * Whether two secrets are equal, without leaking which byte differed.
 *
 * Exported because the host broker's own tests want it and because a future
 * `remove-key` will need to prove it removed the value it was asked about.
 * Length-safe: `timingSafeEqual` throws on a length mismatch, which would itself
 * be an oracle, so unequal lengths answer false before it is called.
 */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
