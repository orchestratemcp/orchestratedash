/**
 * `SecureStore` — the seam between DASH and whatever actually holds a secret.
 *
 * ADR 0001 adopts Electron partly because `safeStorage` binds to DPAPI /
 * Keychain / libsecret, and it deliberately puts that behind an interface so the
 * OS vault stays "a replaceable detail" — the same seam Tauri's keyring plugin
 * would slot into if we revisit that rejection.
 *
 * This file is the seam and nothing else. There is no implementation here: no
 * `safeStorage` call, no keychain access, no file. Like `lib/connections.ts`
 * this module is I/O-free and fully unit-testable; unlike it, it exists to be
 * implemented later rather than called now.
 *
 * Two rules are enforced *in this layer* rather than left to callers, because a
 * caller that forgets either one leaks a credential:
 *
 * 1. **A store must declare whether it is genuinely OS-backed.** Callers must
 *    not have to infer it from the class name. See `SecureStoreBacking` and
 *    `assertCanHoldSecret`.
 * 2. **Failures are distinguishable.** "No such secret", "the vault is locked"
 *    and "there is no vault here" need three different recoveries, and
 *    collapsing them into one error is how a locked Keychain turns into a
 *    silent re-prompt for a key the user already gave us. See
 *    `SecureStoreErrorCode`.
 *
 * Nothing in this file ever accepts, returns or formats a secret *value* except
 * the explicit get/set methods. Names, backings and errors are all safe to log.
 */

/* ---------------------------------------------------------------------- *
 * Backing — "is this store actually OS-backed?"
 * ---------------------------------------------------------------------- */

/**
 * What a store is really built on.
 *
 * `os_keychain` is the only backing that may hold a real user credential.
 * `ephemeral` covers test fakes and any store that would otherwise be inventing
 * its own key management — ADR 0001 rejected the local-service option precisely
 * because "an encrypted file whose key must itself live somewhere on disk" is a
 * problem we refuse to invent. A store that cannot reach a vault must say so
 * here and be refused, not quietly degrade.
 */
export type SecureStoreBackend = "os_keychain" | "ephemeral" | "unavailable";

export interface SecureStoreBacking {
  backend: SecureStoreBackend;
  /**
   * True only when the operating system holds the key material. This is the
   * capability query callers branch on; `backend` is for display and diagnosis.
   */
  os_backed: boolean;
  /** Whether stored values survive an app restart. Drives honest UI copy. */
  persists_across_restart: boolean;
  /**
   * Plain-language description for the Connection Center, e.g. "Windows
   * Credential Manager". Safe to render and to log — never contains a secret.
   */
  label: string;
  /**
   * Why this store is not OS-backed, when it is not. Present exactly when
   * `os_backed` is false, so the UI can explain the degradation instead of
   * showing a bare failure.
   */
  unavailable_reason?: string;
}

/* ---------------------------------------------------------------------- *
 * Errors
 * ---------------------------------------------------------------------- */

/**
 * The failure taxonomy. Each code maps to a *different* user recovery, which is
 * the whole reason they are separate:
 *
 * - `not_found` — nothing is stored under that name. Recovery: ask the user to
 *   connect. This is an ordinary, expected outcome on first run.
 * - `vault_locked` — the vault exists and holds the secret, but the OS will not
 *   release it right now (locked Keychain, no desktop session). Recovery:
 *   prompt the user to unlock. Treating this as `not_found` would ask the user
 *   to re-enter a credential they already gave us, and would overwrite it.
 * - `backend_unavailable` — there is no usable vault at all (no libsecret, an
 *   ephemeral store asked to hold a real secret). Recovery: refuse the
 *   operation and tell the user. Never fall back to plaintext.
 * - `invalid_name` — the caller passed a name this layer will not accept. A
 *   programming error, surfaced rather than normalised away.
 */
export type SecureStoreErrorCode =
  | "not_found"
  | "vault_locked"
  | "backend_unavailable"
  | "invalid_name";

export class SecureStoreError extends Error {
  readonly code: SecureStoreErrorCode;
  /** The secret's name. Safe: names are validated to be non-sensitive. */
  readonly secret_name?: string;
  /**
   * The mechanism, when the implementation knows it (MAR-684): an fs errno
   * (`EPERM`), `decrypt_failed`, `envelope_unreadable`, `readback_failed`, or
   * `decrypt_failed_foreign_identity:<name>`. Never a value and never part of
   * the sentence a user reads — it exists so a diagnosis can name what actually
   * happened instead of inferring it back from which recovery was shown, which
   * is how a healthy vault spent a day being called locked.
   */
  readonly cause_code?: string;
  /**
   * Where the implementation actually looked (MAR-742).
   *
   * `cause_code` says *what* happened; this says *where*, and the second
   * question turned out to be the expensive one. A blob that had been on disk
   * since 15:30 was reported `not_found:ENOENT` at 20:57 while its siblings read
   * fine, and answering "which directory did that process resolve?" afterwards
   * took hours of filesystem archaeology — because DASH derives its store root
   * from `DASH_DATA_DIR` and its vault root from `app.getPath("userData")`, two
   * roots one launch can move independently. One recorded path answers it in a
   * second.
   *
   * A filesystem path, never a value: a directory plus `dash-secret-<name>.enc`,
   * and the name is already the log-safe identifier `assertValidSecretName`
   * guarantees. Optional because a store that is not file-backed has no
   * meaningful answer and must not invent one.
   */
  readonly resolved_path?: string;

  constructor(
    code: SecureStoreErrorCode,
    message: string,
    secretName?: string,
    causeCode?: string,
    resolvedPath?: string,
  ) {
    super(message);
    this.name = "SecureStoreError";
    this.code = code;
    this.secret_name = secretName;
    this.cause_code = causeCode;
    this.resolved_path = resolvedPath;
  }
}

/**
 * Narrow an unknown caught value. Implementations live behind an async
 * interface, so callers catch `unknown` and need a guard that does not rely on
 * `instanceof` surviving a process boundary.
 */
export function isSecureStoreError(value: unknown): value is SecureStoreError {
  return value instanceof SecureStoreError;
}

/* ---------------------------------------------------------------------- *
 * Secret names
 * ---------------------------------------------------------------------- */

/**
 * Secret names appear in audit records, error messages and OS vault entries —
 * all of which are read by humans and some of which are written to disk. So a
 * name is deliberately restricted to a boring, log-safe identifier: lowercase,
 * no whitespace, no punctuation beyond `.`, `-` and `_`.
 *
 * The restriction is not cosmetic. It stops two real mistakes: a caller pasting
 * a *value* where a name belongs (values contain characters this rejects), and
 * names that collide once a vault flattens them into one namespace.
 */
const SECRET_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

/**
 * Validate a name, throwing the taxonomy's own error so callers have exactly
 * one error type to handle. Implementations should call this first in every
 * method — the alternative is each backend inventing its own rules.
 */
export function assertValidSecretName(name: string): void {
  if (!isValidSecretName(name)) {
    throw new SecureStoreError(
      "invalid_name",
      `Secret name must be 3-128 characters of lowercase letters, digits, "." , "-" or "_" and start with a letter or digit.`,
      // The rejected name is NOT echoed back: if a caller passed a value by
      // mistake, echoing it into an error message would put the secret in a log.
    );
  }
}

/**
 * The guard that makes rule 1 enforceable. Call this before storing anything a
 * user would consider a credential.
 *
 * Kept as a free function rather than a method so it cannot be overridden by an
 * implementation that would rather say yes.
 */
export function assertCanHoldSecret(backing: SecureStoreBacking): void {
  if (!backing.os_backed) {
    throw new SecureStoreError(
      "backend_unavailable",
      `Refusing to store a credential in "${backing.label}": it is not OS-backed` +
        (backing.unavailable_reason ? ` (${backing.unavailable_reason})` : "") +
        ". Connect through an OS vault instead.",
    );
  }
}

/* ---------------------------------------------------------------------- *
 * The interface
 * ---------------------------------------------------------------------- */

/**
 * Named-secret storage. Every method is async because every real backing is:
 * DPAPI, Keychain and libsecret all cross a process or an OS boundary, and an
 * interface that pretended otherwise would have to be rewritten the moment it
 * met one.
 *
 * `get`/`delete` throw `not_found` rather than returning `null`. Callers of a
 * credential store almost always want the missing case to be loud; the ones
 * that do not can catch the code, and that reads better than every caller
 * null-checking a value they then pass to an API.
 */
export interface SecureStore {
  /**
   * What this store is really built on. Synchronous and cheap: the UI asks it
   * on every render of the Connection Center, and it must never be the thing
   * that pops an OS unlock prompt.
   */
  describeBacking(): SecureStoreBacking;

  /** @throws SecureStoreError `not_found` | `vault_locked` | `backend_unavailable` | `invalid_name` */
  get(name: string): Promise<string>;

  /**
   * Store or replace a secret.
   *
   * @throws SecureStoreError `vault_locked` | `backend_unavailable` | `invalid_name`
   */
  set(name: string, secret: string): Promise<void>;

  /** @throws SecureStoreError `not_found` | `vault_locked` | `backend_unavailable` | `invalid_name` */
  delete(name: string): Promise<void>;

  /**
   * Names only — never values. This is what the Connection Center lists, and
   * the reason listing is safe: a name tells you a connection exists, not what
   * it authorises.
   *
   * @throws SecureStoreError `vault_locked` | `backend_unavailable`
   */
  listNames(): Promise<string[]>;

  /**
   * Where this store keeps what it keeps, when that is a place (MAR-742).
   *
   * The standing half of `SecureStoreError.resolved_path`: the error names a
   * path only when something failed, and the question "which vault is this
   * process actually using?" needs an answer on the successful launches too —
   * that is what turns a self-check record from *these names failed* into
   * *these names failed, in this directory*, which is the difference between a
   * diagnosis and an archaeology dig.
   *
   * Optional, and returning `null` is a real answer. A `MemorySecureStore` has
   * no location and must say so rather than invent a plausible path; callers
   * treat the absence as "not file-backed", never as "unknown".
   *
   * Never a value, and never prompts: a path, or null.
   */
  describeLocation?(): string | null;
}
