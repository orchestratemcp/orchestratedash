/**
 * The first real `SecureStore` backing: Electron `safeStorage` over an OS vault.
 *
 * `lib/secure-store.ts` is the seam and states two rules. This is the
 * implementation, and it exists to honour them rather than to route around
 * them:
 *
 * 1. **Declare whether you are genuinely OS-backed.** See `describeBacking`,
 *    and in particular the `basic_text` case, which is the whole reason this
 *    check is not a one-liner.
 * 2. **Keep the three failures distinguishable.** See `get`; the hard case is
 *    documented at the point where the ambiguity actually arises.
 *
 * **Why the ciphertext is not in SQLite.** `safeStorage` encrypts and decrypts;
 * it does not store. Something has to hold the resulting bytes, and they go to
 * one file per secret under the vault directory rather than into `dash.sqlite`.
 * Two reasons. First, "no secret value ever lands in the store" stays a
 * property that a test can check by scanning the database bytes — a rule with a
 * carve-out for "the encrypted ones" is a rule nobody can verify. Second, the
 * vault has a different lifecycle from the app store: it is the thing that must
 * survive an upgrade untouched and be wiped on disconnect, and mixing it into
 * the same file as the agent list makes both operations riskier.
 *
 * This is *not* the "encrypted file whose key must itself live somewhere on
 * disk" that ADR 0001 rejected. The key lives in DPAPI, Keychain or libsecret
 * and never touches the filesystem. When it would not — the `basic_text` case —
 * this store reports itself unavailable and refuses to write, which is the
 * distinction the ADR was actually drawing.
 *
 * The file is pure apart from `node:fs`: `safeStorage` arrives as an injected
 * port so the whole of this can be tested without launching Electron, in the
 * same shape as `lib/shell/*` and `electron/main.ts`.
 */

import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  SecureStoreError,
  assertCanHoldSecret,
  assertValidSecretName,
  isValidSecretName,
  type SecureStore,
  type SecureStoreBacking,
} from "./secure-store";

/* ---------------------------------------------------------------------- *
 * The port
 * ---------------------------------------------------------------------- */

/**
 * The slice of Electron's `safeStorage` this needs. Declared structurally
 * rather than imported so `lib/` never depends on `electron` — the renderer
 * must not be able to reach a credential store by following an import.
 */
export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  /**
   * Linux only, and the single most important method here. Optional because no
   * other platform implements it.
   */
  getSelectedStorageBackend?(): string;
  encryptString(plainText: string): Uint8Array;
  decryptString(encrypted: Uint8Array): string;
}

export interface VaultOptions {
  /** Directory holding one file per secret. Created on first write. */
  directory: string;
  safeStorage: SafeStoragePort;
  /** Injected so the platform-specific labelling is testable. */
  platform?: NodeJS.Platform;
}

/* ---------------------------------------------------------------------- *
 * On-disk entry
 * ---------------------------------------------------------------------- */

/**
 * Filenames are `dash-secret-<name>.enc`.
 *
 * The prefix is not decoration. Secret names are already restricted to
 * `[a-z0-9._-]` starting with an alphanumeric, so they cannot contain a path
 * separator and cannot be `..` — but a three-character name is legal, and
 * `con`, `aux`, `nul`, `prn`, `com1` and `lpt1` are reserved device names on
 * Windows *including* when they carry an extension. Prefixing moves every name
 * out of that space, and keeps the mapping trivially reversible for `listNames`.
 */
const FILE_PREFIX = "dash-secret-";
const FILE_SUFFIX = ".enc";

interface VaultEntry {
  /** Bumped if the envelope ever changes, so a re-key can migrate rather than guess. */
  format_version: 1;
  /** Which backing encrypted this. Lets the UI explain a machine or profile change. */
  backend: string;
  created_at: string;
  ciphertext_b64: string;
  /**
   * Which app identity encrypted this, e.g. `orchestratedash` (MAR-684).
   *
   * `safeStorage`'s master key lives in the `Local State` of the *userData*
   * directory, and userData is derived from the app's name — so the same
   * repository can run as two differently-named Electrons whose blobs are
   * mutually undecryptable while every file involved is intact. That family of
   * traps has hit this project repeatedly ("which Electron entry point holds
   * the lock", "capture harnesses must not be orchestratedash"). Recording the
   * writer's identity does not prevent the mismatch — nothing at read time can —
   * but it turns the resulting decrypt failure from a guess into a named
   * diagnosis: *this key was written by a DASH running as X*.
   *
   * Optional, because entries written before MAR-684 do not carry it and must
   * go on reading.
   */
  written_by?: string;
}

/* ---------------------------------------------------------------------- *
 * Backing detection
 * ---------------------------------------------------------------------- */

/**
 * The Linux backend that means "encrypted with a key compiled into Chromium".
 *
 * This is the trap the whole class is shaped around. When no keyring service is
 * running, `isEncryptionAvailable()` still returns **true** and encryption still
 * "works" — with a hardcoded key that offers no protection against anyone who
 * can read the file. Trusting the availability check alone would produce
 * exactly the silent degradation ADR 0001 rejected the local-service option
 * for, except worse, because the UI would report success.
 *
 * Only `basic_text` is treated as disqualifying. `unknown` is left alone
 * deliberately: it means Electron could not identify the backend, not that
 * there is no keyring, and refusing a working KWallet setup because it reported
 * itself oddly would be a different kind of wrong answer.
 */
const KEYLESS_LINUX_BACKEND = "basic_text";

function backendLabel(platform: NodeJS.Platform, linuxBackend: string | null): string {
  switch (platform) {
    case "win32":
      return "Windows Credential Manager (DPAPI)";
    case "darwin":
      return "macOS Keychain";
    case "linux":
      if (linuxBackend === "kwallet" || linuxBackend === "kwallet5" || linuxBackend === "kwallet6") {
        return "KDE Wallet";
      }
      if (linuxBackend === "gnome_libsecret") {
        return "GNOME Keyring (libsecret)";
      }
      return "Linux keyring (libsecret)";
    default:
      return "OS credential vault";
  }
}

/* ---------------------------------------------------------------------- *
 * The store
 * ---------------------------------------------------------------------- */

export class Vault implements SecureStore {
  private readonly directory: string;
  private readonly safeStorage: SafeStoragePort;
  private readonly platform: NodeJS.Platform;

  constructor(options: VaultOptions) {
    this.directory = options.directory;
    this.safeStorage = options.safeStorage;
    this.platform = options.platform ?? process.platform;
  }

  /**
   * Deliberately not cached. `isEncryptionAvailable()` is a local state check,
   * not a vault access — it cannot prompt and it cannot block — so there is
   * nothing to memoise away, and a cache would mean a machine whose keyring
   * starts after DASH does never recovers without a restart.
   */
  describeBacking(): SecureStoreBacking {
    let available = false;
    try {
      available = this.safeStorage.isEncryptionAvailable();
    } catch (error: unknown) {
      return unavailable(
        error instanceof Error ? error.message : "the OS vault could not be queried",
      );
    }

    if (!available) {
      return unavailable(
        this.platform === "linux"
          ? "no keyring service (GNOME Keyring or KWallet) is running"
          : "the operating system reported no credential vault",
      );
    }

    const linuxBackend =
      this.platform === "linux" && this.safeStorage.getSelectedStorageBackend !== undefined
        ? this.safeStorage.getSelectedStorageBackend()
        : null;

    if (linuxBackend === KEYLESS_LINUX_BACKEND) {
      return unavailable(
        "no keyring service is available, so the system would encrypt with a " +
          "built-in key that protects nothing",
      );
    }

    return {
      backend: "os_keychain",
      os_backed: true,
      persists_across_restart: true,
      label: backendLabel(this.platform, linuxBackend),
    };
  }

  /**
   * Every method starts here.
   *
   * Name validation runs before the backend check, and the order is load
   * bearing: a locked or missing vault must not mask a caller passing a value
   * where a name belongs, or the programming error stays hidden until the day
   * the vault happens to be available.
   */
  private guard(name?: string): SecureStoreBacking {
    if (name !== undefined) {
      assertValidSecretName(name);
    }
    const backing = this.describeBacking();
    if (!backing.os_backed) {
      throw new SecureStoreError(
        "backend_unavailable",
        `No OS credential vault is available${
          backing.unavailable_reason ? ` (${backing.unavailable_reason})` : ""
        }.`,
        name,
      );
    }
    return backing;
  }

  private fileFor(name: string): string {
    return path.join(this.directory, `${FILE_PREFIX}${name}${FILE_SUFFIX}`);
  }

  /**
   * The app identity this vault belongs to, read off its own path.
   *
   * The directory is `<userData>/vault` and userData's last segment *is* the
   * app's name — the fact `storeIdentityProblem` checks against a constant.
   * Derived here rather than injected because `lib/` must not import
   * `electron`, and the path already carries the answer.
   */
  private identity(): string {
    const segments = this.directory.split(/[\\/]/).filter((segment) => segment.length > 0);
    return segments[segments.length - 2] ?? "unknown";
  }

  async get(name: string): Promise<string> {
    this.guard(name);

    let raw: string;
    try {
      raw = readFileSync(this.fileFor(name), "utf8");
    } catch (error: unknown) {
      const errno = (error as NodeJS.ErrnoException | null)?.code ?? "read_failed";
      if (errno === "ENOENT") {
        throw new SecureStoreError("not_found", `No secret stored as "${name}".`, name, errno);
      }
      /*
       * MAR-684. Any other failure to read the file is NOT `not_found`. The
       * file may be there and locked by another process, refused by a
       * permission, or unopenable because this process is out of descriptors —
       * and every one of those used to be reported as "never stored", which
       * told the UI to say "connect it again" over a credential that provably
       * still existed. `vault_locked` is the code whose recovery destroys
       * nothing, which is the same tie-break `decryptString`'s catch below has
       * always made.
       */
      throw new SecureStoreError(
        "vault_locked",
        `The stored entry for "${name}" could not be read just now (${errno}). ` +
          `It is still on disk; close anything else using DASH's folder and try again.`,
        name,
        errno,
      );
    }

    let entry: VaultEntry;
    try {
      entry = JSON.parse(raw) as VaultEntry;
      if (entry.format_version !== 1 || typeof entry.ciphertext_b64 !== "string") {
        throw new Error("unrecognised entry");
      }
    } catch {
      // A present-but-unreadable envelope is reported as `not_found`, not as
      // `vault_locked`. The distinction the taxonomy cares about is the
      // recovery: this entry can never yield a credential again, so "connect
      // again" is the correct next step, and overwriting it costs nothing. The
      // dangerous direction is the opposite one, and it is handled below.
      throw new SecureStoreError(
        "not_found",
        `The stored entry for "${name}" is unreadable and must be set again.`,
        name,
        "envelope_unreadable",
      );
    }

    try {
      return this.safeStorage.decryptString(Buffer.from(entry.ciphertext_b64, "base64"));
    } catch (error: unknown) {
      // Here the envelope is intact and the OS refused to hand back the key.
      // That is `vault_locked` even though we cannot fully prove it — a locked
      // Keychain and a key we will never get again are indistinguishable from
      // here. Reporting `not_found` would tell the UI to ask for a credential
      // the user already gave us and then overwrite the good one, so when the
      // evidence is ambiguous this takes the reading whose wrong answer
      // destroys nothing.
      //
      // MAR-684: when the entry names the identity that wrote it and it is not
      // this one, that is the whole diagnosis — the master key that can decrypt
      // this blob belongs to a differently-named Electron — and the cause code
      // says so instead of leaving the next investigator to re-derive it.
      const writtenBy = typeof entry.written_by === "string" ? entry.written_by : null;
      const foreign = writtenBy !== null && writtenBy !== this.identity();
      throw new SecureStoreError(
        "vault_locked",
        `The OS vault would not release "${name}". It may be locked; unlock it and try again. ` +
          (foreign
            ? `(It was stored by a DASH running as "${writtenBy}", and this one is "${this.identity()}" — ` +
              `the two encrypt under different keys, so this copy cannot be read here. Replacing the key fixes it.)`
            : `(${error instanceof Error ? error.message : "decryption failed"})`),
        name,
        foreign ? `decrypt_failed_foreign_identity:${writtenBy}` : "decrypt_failed",
      );
    }
  }

  async set(name: string, secret: string): Promise<void> {
    const backing = this.guard(name);
    // Belt and braces: `guard` already refused a non-OS-backed store, but this
    // is the free function the seam made un-overridable, and a write is the
    // operation where being wrong is unrecoverable.
    assertCanHoldSecret(backing);

    let ciphertext: Uint8Array;
    try {
      ciphertext = this.safeStorage.encryptString(secret);
    } catch (error: unknown) {
      throw new SecureStoreError(
        "vault_locked",
        `The OS vault would not encrypt "${name}". It may be locked; unlock it and try again. ` +
          `(${error instanceof Error ? error.message : "encryption failed"})`,
        name,
      );
    }

    const entry: VaultEntry = {
      format_version: 1,
      backend: backing.backend,
      created_at: new Date().toISOString(),
      ciphertext_b64: Buffer.from(ciphertext).toString("base64"),
      written_by: this.identity(),
    };

    mkdirSync(this.directory, { recursive: true });
    // Write-then-rename, the same property the JSON store had and for the same
    // reason: a crash mid-write must not leave a half-written credential that
    // reads as corrupt. One file per secret means it also cannot damage any
    // other stored credential.
    const target = this.fileFor(name);
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(entry)}\n`, "utf8");

    /*
     * Read the temporary file back and decrypt it BEFORE the rename (MAR-684
     * requirement 2: a re-pasted key must read back under the same running
     * identity). Before, not after — the name may hold the only surviving copy
     * of a credential, and a replacement that cannot be read must not be the
     * thing that destroys it. A verify failure leaves the previous entry
     * exactly as it was.
     */
    try {
      const persisted = JSON.parse(readFileSync(temporary, "utf8")) as VaultEntry;
      const roundTripped = this.safeStorage.decryptString(
        Buffer.from(persisted.ciphertext_b64, "base64"),
      );
      if (roundTripped !== secret) {
        throw new Error("round-trip mismatch");
      }
    } catch {
      try {
        unlinkSync(temporary);
      } catch {
        // The unverified bytes are already outside the read path — nothing
        // resolves a `.tmp` name — so a leftover file is untidy, not unsafe.
      }
      throw new SecureStoreError(
        "vault_locked",
        `"${name}" was encrypted but could not be read back, so it was not stored. ` +
          `Whatever DASH previously held under that name is untouched. Try again.`,
        name,
        "readback_failed",
      );
    }

    renameSync(temporary, target);
  }

  async delete(name: string): Promise<void> {
    this.guard(name);
    try {
      unlinkSync(this.fileFor(name));
    } catch {
      throw new SecureStoreError("not_found", `No secret stored as "${name}".`, name);
    }
  }

  async listNames(): Promise<string[]> {
    this.guard();

    let entries: string[];
    try {
      entries = readdirSync(this.directory);
    } catch {
      // No directory means nothing has been stored yet, which is an empty list
      // rather than a failure. First run must not look like a broken vault.
      return [];
    }

    return entries
      .filter((file) => file.startsWith(FILE_PREFIX) && file.endsWith(FILE_SUFFIX))
      .map((file) => file.slice(FILE_PREFIX.length, -FILE_SUFFIX.length))
      // Re-validated on the way out: this directory is on the user's disk and
      // anything could have been dropped into it. A name that would not have
      // been accepted going in is not handed back as if DASH had stored it.
      .filter((name) => isValidSecretName(name))
      .sort();
  }
}

function unavailable(reason: string): SecureStoreBacking {
  return {
    backend: "unavailable",
    os_backed: false,
    persists_across_restart: false,
    label: "No OS credential vault",
    unavailable_reason: reason,
  };
}
