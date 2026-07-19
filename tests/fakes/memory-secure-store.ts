/**
 * An in-memory `SecureStore`, for tests only.
 *
 * It lives under `tests/` rather than `lib/` deliberately: an in-memory
 * credential store is exactly the thing that must never be reachable from app
 * code by an accidental import. Being here makes that a physical property, not
 * a naming convention.
 *
 * It reports itself honestly — `os_backed: false` — so `assertCanHoldSecret`
 * refuses it for real credentials. That is the point: the fake exercises the
 * interface's contract *including* its refusals.
 */

import {
  SecureStoreError,
  assertValidSecretName,
  type SecureStore,
  type SecureStoreBacking,
} from "../../lib/secure-store";

export interface MemorySecureStoreOptions {
  /** Simulate a locked OS vault. */
  locked?: boolean;
  /** Simulate no vault at all. */
  unavailable?: boolean;
  /**
   * Claim to be OS-backed. Only for testing that callers branch on the
   * capability query — nothing here is actually OS-backed.
   */
  pretendOsBacked?: boolean;
}

export class MemorySecureStore implements SecureStore {
  private readonly secrets = new Map<string, string>();
  private readonly options: MemorySecureStoreOptions;

  constructor(options: MemorySecureStoreOptions = {}) {
    this.options = options;
  }

  describeBacking(): SecureStoreBacking {
    if (this.options.unavailable) {
      return {
        backend: "unavailable",
        os_backed: false,
        persists_across_restart: false,
        label: "No secure store",
        unavailable_reason: "no OS vault on this machine",
      };
    }
    if (this.options.pretendOsBacked) {
      return {
        backend: "os_keychain",
        os_backed: true,
        persists_across_restart: true,
        label: "Fake OS vault",
      };
    }
    return {
      backend: "ephemeral",
      os_backed: false,
      persists_across_restart: false,
      label: "In-memory test store",
      unavailable_reason: "test double; values are lost when the process exits",
    };
  }

  /** Every method starts here, so the guards are impossible to skip per-method. */
  private guard(name?: string): void {
    if (name !== undefined) {
      assertValidSecretName(name);
    }
    if (this.options.unavailable) {
      throw new SecureStoreError("backend_unavailable", "No secure store is available.", name);
    }
    if (this.options.locked) {
      throw new SecureStoreError("vault_locked", "The vault is locked.", name);
    }
  }

  async get(name: string): Promise<string> {
    this.guard(name);
    const value = this.secrets.get(name);
    if (value === undefined) {
      throw new SecureStoreError("not_found", `No secret stored as "${name}".`, name);
    }
    return value;
  }

  async set(name: string, secret: string): Promise<void> {
    this.guard(name);
    this.secrets.set(name, secret);
  }

  async delete(name: string): Promise<void> {
    this.guard(name);
    if (!this.secrets.delete(name)) {
      throw new SecureStoreError("not_found", `No secret stored as "${name}".`, name);
    }
  }

  async listNames(): Promise<string[]> {
    this.guard();
    return [...this.secrets.keys()].sort();
  }
}
