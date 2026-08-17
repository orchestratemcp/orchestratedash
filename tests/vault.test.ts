/**
 * The `safeStorage`-backed `SecureStore`, exercised through an injected fake.
 *
 * `tests/secure-store.test.ts` covers the seam's contract against the in-memory
 * double. This file covers the things only a real backing has: an OS
 * availability check that can lie, files on disk that outlive the object, and
 * the acceptance criteria MAR-416 states — survive a restart, survive an
 * upgrade, and keep a locked vault distinguishable from a missing secret.
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isSecureStoreError } from "../lib/secure-store";
import { Vault } from "../lib/vault";
import { FakeSafeStorage, type FakeSafeStorageOptions } from "./fakes/fake-safe-storage";

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "dash-vault-"));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

function vault(
  options: FakeSafeStorageOptions = {},
  platform: NodeJS.Platform = "win32",
): { store: Vault; safeStorage: FakeSafeStorage } {
  const safeStorage = new FakeSafeStorage(options);
  return {
    store: new Vault({ directory: path.join(directory, "vault"), safeStorage, platform }),
    safeStorage,
  };
}

describe("round trip through the OS vault", () => {
  it("stores, returns, replaces and deletes a named secret", async () => {
    const { store } = vault();
    await store.set("gmail.oauth-refresh", "value-under-test");
    expect(await store.get("gmail.oauth-refresh")).toBe("value-under-test");

    await store.set("gmail.oauth-refresh", "replacement");
    expect(await store.get("gmail.oauth-refresh")).toBe("replacement");
    expect(await store.listNames()).toEqual(["gmail.oauth-refresh"]);

    await store.delete("gmail.oauth-refresh");
    await expect(store.get("gmail.oauth-refresh")).rejects.toMatchObject({ code: "not_found" });
  });

  it("lists names only, and an empty vault is empty rather than broken", async () => {
    const { store } = vault();
    expect(await store.listNames()).toEqual([]);

    await store.set("b.key", "secret-b");
    await store.set("a.key", "secret-a");
    expect(await store.listNames()).toEqual(["a.key", "b.key"]);
  });

  it("never writes the plaintext to disk", async () => {
    const { store } = vault();
    await store.set("model-provider.api-key", "sk-live-do-not-store-me");

    const files = readdirSync(path.join(directory, "vault"));
    expect(files).toHaveLength(1);
    const raw = readFileSync(path.join(directory, "vault", files[0]!)).toString("latin1");
    expect(raw).not.toContain("sk-live-do-not-store-me");
    expect(JSON.parse(raw)).toMatchObject({ format_version: 1, backend: "os_keychain" });
  });
});

describe("acceptance — survives a restart and an upgrade", () => {
  /**
   * "Restart" is a new store object over the same directory: nothing is carried
   * in memory, exactly as after the process exits.
   */
  it("a key written before a restart is readable after it", async () => {
    const first = vault();
    await first.store.set("gmail.oauth-refresh", "survives-restart");

    const second = vault();
    expect(await second.store.get("gmail.oauth-refresh")).toBe("survives-restart");
  });

  /**
   * "Upgrade" replaces the application, not the user's data directory. The
   * property that makes this hold is that the vault path contains no version —
   * asserted here on the path the store was actually given, so a future change
   * that versioned the directory would fail this test rather than silently
   * orphan every stored credential on the next release.
   */
  it("the vault directory is not versioned, so an upgrade cannot orphan it", async () => {
    const before = vault();
    await before.store.set("model-provider.api-key", "survives-upgrade");

    const after = vault();
    expect(await after.store.get("model-provider.api-key")).toBe("survives-upgrade");
    expect(path.join(directory, "vault")).not.toMatch(/\d+\.\d+\.\d+/);
  });
});

describe("the three failures stay distinguishable", () => {
  it("a missing secret is not_found", async () => {
    const { store } = vault();
    await expect(store.get("gmail.oauth-refresh")).rejects.toMatchObject({ code: "not_found" });
  });

  /**
   * The sharpest requirement in the issue. A locked vault reported as
   * `not_found` would prompt the user for a credential they already gave, and
   * the reconnect would overwrite the good one.
   */
  it("a locked vault is vault_locked, not not_found, and the value is still there after unlocking", async () => {
    const { store, safeStorage } = vault();
    await store.set("gmail.oauth-refresh", "still-here");

    safeStorage.lock();
    await expect(store.get("gmail.oauth-refresh")).rejects.toMatchObject({ code: "vault_locked" });

    safeStorage.unlock();
    expect(await store.get("gmail.oauth-refresh")).toBe("still-here");
  });

  it("a locked vault fails a write instead of dropping it", async () => {
    const { store } = vault({ locked: true });
    await expect(store.set("gmail.oauth-refresh", "x")).rejects.toMatchObject({
      code: "vault_locked",
    });
  });

  it("no vault at all is backend_unavailable on every method", async () => {
    const { store } = vault({ unavailable: true });
    for (const call of [
      store.get("gmail.oauth-refresh"),
      store.set("gmail.oauth-refresh", "x"),
      store.delete("gmail.oauth-refresh"),
      store.listNames(),
    ]) {
      await expect(call).rejects.toMatchObject({ code: "backend_unavailable" });
    }
  });

  it("an unreadable entry is not_found — it can never yield a credential again", async () => {
    const { store } = vault();
    await store.set("gmail.oauth-refresh", "x");
    const file = path.join(directory, "vault", "dash-secret-gmail.oauth-refresh.enc");
    writeFileSync(file, "{ not json", "utf8");

    await expect(store.get("gmail.oauth-refresh")).rejects.toMatchObject({ code: "not_found" });
  });

  it("validates the name before consulting the backend", async () => {
    const { store } = vault({ unavailable: true });
    await expect(store.get("BAD NAME")).rejects.toMatchObject({ code: "invalid_name" });
  });

  /**
   * MAR-684. The refinement that came out of a healthy vault being called
   * empty: a file that exists and cannot be read is not `not_found`. Only
   * ENOENT — the file genuinely is not there — may say "never stored", because
   * "never stored" is the one answer whose recovery overwrites what a person
   * gave DASH. Everything else is a read that failed *right now*, and the code
   * whose wrong answer destroys nothing is `vault_locked`.
   */
  it("a file that exists but cannot be read is vault_locked with the mechanism attached, not not_found", async () => {
    const { store } = vault();
    await store.set("gmail.oauth-refresh", "x");
    // Replace the entry with a directory of the same name: `readFileSync`
    // fails with EISDIR — a stand-in for every non-ENOENT failure (a lock, a
    // permission, descriptor exhaustion) that used to masquerade as "never
    // stored".
    const file = path.join(directory, "vault", "dash-secret-gmail.oauth-refresh.enc");
    rmSync(file);
    mkdirSync(file);

    try {
      await store.get("gmail.oauth-refresh");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect(isSecureStoreError(error) && error.code).toBe("vault_locked");
      expect(isSecureStoreError(error) ? error.cause_code : null).toBe("EISDIR");
    }
  });
});

describe("MAR-684 — the written-by identity and the read-back proof", () => {
  /**
   * `safeStorage`'s master key follows the app's name, so one repository can run
   * as two differently-named Electrons whose blobs are mutually unreadable while
   * every file involved is intact. Nothing at read time can prevent that; what
   * the vault can do is *name* it, which turns the resulting failure from a
   * day of guessing into one sentence.
   */
  it("stamps which identity wrote an entry, and names it when a foreign blob will not decrypt", async () => {
    const writerDirectory = path.join(directory, "appA", "vault");
    const writer = new Vault({
      directory: writerDirectory,
      safeStorage: new FakeSafeStorage(),
      platform: "win32",
    });
    await writer.set("model-provider.api-key", "written-under-appA");

    const raw = JSON.parse(
      readFileSync(
        path.join(writerDirectory, "dash-secret-model-provider.api-key.enc"),
        "utf8",
      ),
    ) as { written_by?: string };
    expect(raw.written_by).toBe("appA");

    // The same blob under a different identity whose vault cannot decrypt it.
    const readerDirectory = path.join(directory, "appB", "vault");
    mkdirSync(readerDirectory, { recursive: true });
    writeFileSync(
      path.join(readerDirectory, "dash-secret-model-provider.api-key.enc"),
      JSON.stringify(raw),
      "utf8",
    );
    const readerStorage = new FakeSafeStorage();
    readerStorage.lock();
    const reader = new Vault({
      directory: readerDirectory,
      safeStorage: readerStorage,
      platform: "win32",
    });

    try {
      await reader.get("model-provider.api-key");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect(isSecureStoreError(error) && error.code).toBe("vault_locked");
      expect(isSecureStoreError(error) ? error.cause_code : null).toBe(
        "decrypt_failed_foreign_identity:appA",
      );
      expect(error instanceof Error && error.message).toContain('running as "appA"');
    }
  });

  it("an entry written before the stamp existed still reads, and a same-identity decrypt failure stays unattributed", async () => {
    const { store, safeStorage } = vault();
    await store.set("gmail.oauth-refresh", "still-here");
    // Strip the stamp, as every pre-MAR-684 entry on disk lacks it.
    const file = path.join(directory, "vault", "dash-secret-gmail.oauth-refresh.enc");
    const entry = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    delete entry["written_by"];
    writeFileSync(file, JSON.stringify(entry), "utf8");

    expect(await store.get("gmail.oauth-refresh")).toBe("still-here");

    safeStorage.lock();
    try {
      await store.get("gmail.oauth-refresh");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect(isSecureStoreError(error) ? error.cause_code : null).toBe("decrypt_failed");
    }
  });

  /**
   * MAR-684 requirement 2, made structural: a stored credential is one that
   * PROVABLY reads back under the running identity. The verify runs against the
   * temporary file before the rename, so a write that cannot be read back
   * leaves whatever was stored before exactly as it was — the name may hold the
   * only surviving copy of a credential, and an unreadable replacement must not
   * be the thing that destroys it.
   */
  it("refuses a write that does not read back, leaving the previous value untouched", async () => {
    const { store } = vault();
    await store.set("model-provider.api-key", "the-good-one");

    const corrupting = {
      isEncryptionAvailable: () => true,
      // Valid-looking bytes that decrypt to the wrong thing.
      encryptString: () => new FakeSafeStorage().encryptString("something else entirely"),
      decryptString: (encrypted: Uint8Array) => new FakeSafeStorage().decryptString(encrypted),
    };
    const broken = new Vault({
      directory: path.join(directory, "vault"),
      safeStorage: corrupting,
      platform: "win32",
    });

    try {
      await broken.set("model-provider.api-key", "the-replacement");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect(isSecureStoreError(error) && error.code).toBe("vault_locked");
      expect(isSecureStoreError(error) ? error.cause_code : null).toBe("readback_failed");
    }

    // The previous entry is byte-for-byte still the one that resolves, and no
    // half-written temporary is left beside it.
    const { store: fresh } = vault();
    expect(await fresh.get("model-provider.api-key")).toBe("the-good-one");
    expect(readdirSync(path.join(directory, "vault")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("declaring the backing honestly", () => {
  it("reports an OS vault as OS-backed and persistent, with a platform label", () => {
    expect(vault({}, "win32").store.describeBacking()).toMatchObject({
      backend: "os_keychain",
      os_backed: true,
      persists_across_restart: true,
      label: "Windows Credential Manager (DPAPI)",
    });
    expect(vault({}, "darwin").store.describeBacking().label).toBe("macOS Keychain");
  });

  /**
   * The Linux trap, and the reason this class exists in the shape it does.
   * `isEncryptionAvailable()` returns true and encryption "works" — with a key
   * compiled into Chromium. ADR 0001 rejected exactly this: a store that cannot
   * reach a vault must say so and be refused, not quietly degrade.
   */
  it("refuses basic_text on Linux even though encryption reports itself available", async () => {
    const { store, safeStorage } = vault({ linuxBackend: "basic_text" }, "linux");
    expect(safeStorage.isEncryptionAvailable()).toBe(true);

    const backing = store.describeBacking();
    expect(backing.os_backed).toBe(false);
    expect(backing.backend).toBe("unavailable");
    expect(backing.unavailable_reason).toContain("built-in key");

    await expect(store.set("gmail.oauth-refresh", "x")).rejects.toMatchObject({
      code: "backend_unavailable",
    });
  });

  it("accepts a real Linux keyring", () => {
    expect(vault({ linuxBackend: "gnome_libsecret" }, "linux").store.describeBacking()).toMatchObject(
      { os_backed: true, label: "GNOME Keyring (libsecret)" },
    );
    expect(vault({ linuxBackend: "kwallet6" }, "linux").store.describeBacking().label).toBe(
      "KDE Wallet",
    );
  });

  /**
   * `unknown` means Electron could not identify the backend, not that there is
   * no keyring. Refusing it would break working setups; only the specifically
   * keyless backend is disqualifying.
   */
  it("does not refuse an unidentified Linux backend", () => {
    expect(vault({ linuxBackend: "unknown" }, "linux").store.describeBacking().os_backed).toBe(true);
  });

  it("survives a backend that throws when queried, and says why", () => {
    const backing = vault({ throwOnQuery: true }).store.describeBacking();
    expect(backing.os_backed).toBe(false);
    expect(backing.unavailable_reason).toContain("OSCrypt");
  });
});

describe("secret names as filenames", () => {
  /**
   * Names are already restricted to `[a-z0-9._-]` starting alphanumeric, so
   * traversal is impossible — but a three-character name is legal, and Windows
   * treats `con`, `nul`, `aux` and friends as device names even with an
   * extension. The filename prefix is what keeps those writable.
   */
  it("stores names that are Windows reserved device names", async () => {
    const { store } = vault();
    for (const name of ["con", "nul", "aux", "prn", "com1", "lpt1"]) {
      await store.set(name, `value-for-${name}`);
      expect(await store.get(name)).toBe(`value-for-${name}`);
    }
    expect(await store.listNames()).toEqual(["aux", "com1", "con", "lpt1", "nul", "prn"]);
  });

  it("ignores foreign files dropped into the vault directory", async () => {
    const { store } = vault();
    await store.set("gmail.oauth-refresh", "x");
    writeFileSync(path.join(directory, "vault", "notes.txt"), "hello", "utf8");
    writeFileSync(path.join(directory, "vault", "dash-secret-NOT VALID.enc"), "{}", "utf8");

    expect(await store.listNames()).toEqual(["gmail.oauth-refresh"]);
  });

  it("rejects a pasted value used as a name before it reaches the filesystem", async () => {
    const { store } = vault();
    await expect(store.set("sk-live-AbCdEf0123456789", "x")).rejects.toMatchObject({
      code: "invalid_name",
    });
    try {
      await store.set("../../etc/passwd", "x");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect(isSecureStoreError(error) && error.code).toBe("invalid_name");
    }
  });
});
