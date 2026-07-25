/**
 * A fake `safeStorage`, for tests only — same reason `MemorySecureStore` lives
 * under `tests/`: nothing that pretends to be a vault should be reachable from
 * app code by an accidental import.
 *
 * The "encryption" is a byte inversion with a marker prefix. It is not
 * security and is not trying to be: what the tests need is a reversible
 * transform whose output does not contain the plaintext, so that a redaction
 * test failing means the plaintext really did leak rather than that the fake
 * happened to store it verbatim.
 */

const MARKER = 0x7f;

export interface FakeSafeStorageOptions {
  /** `isEncryptionAvailable()` returns false — no vault on this machine. */
  unavailable?: boolean;
  /** Both encrypt and decrypt throw, as a locked Keychain does. */
  locked?: boolean;
  /** What `getSelectedStorageBackend()` reports. Only consulted on Linux. */
  linuxBackend?: string;
  /** Make `isEncryptionAvailable()` itself throw. */
  throwOnQuery?: boolean;
}

export class FakeSafeStorage {
  private readonly options: FakeSafeStorageOptions;
  /** Flipped by `lock()` so one instance can span a lock/unlock in a test. */
  private locked: boolean;

  constructor(options: FakeSafeStorageOptions = {}) {
    this.options = options;
    this.locked = options.locked ?? false;
  }

  lock(): void {
    this.locked = true;
  }

  unlock(): void {
    this.locked = false;
  }

  isEncryptionAvailable(): boolean {
    if (this.options.throwOnQuery === true) {
      throw new Error("OSCrypt not initialised");
    }
    return this.options.unavailable !== true;
  }

  getSelectedStorageBackend(): string {
    return this.options.linuxBackend ?? "gnome_libsecret";
  }

  encryptString(plainText: string): Uint8Array {
    if (this.locked) {
      throw new Error("the vault is locked");
    }
    const body = Buffer.from(plainText, "utf8").map((byte) => byte ^ 0xff);
    return Buffer.concat([Buffer.from([MARKER]), body]);
  }

  decryptString(encrypted: Uint8Array): string {
    if (this.locked) {
      throw new Error("the vault is locked");
    }
    const buffer = Buffer.from(encrypted);
    if (buffer[0] !== MARKER) {
      throw new Error("not encrypted by this vault");
    }
    return Buffer.from(buffer.subarray(1).map((byte) => byte ^ 0xff)).toString("utf8");
  }
}
