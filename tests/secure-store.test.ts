import { describe, expect, it } from "vitest";
import {
  SecureStoreError,
  assertCanHoldSecret,
  assertValidSecretName,
  isSecureStoreError,
  isValidSecretName,
} from "../lib/secure-store";
import { MemorySecureStore } from "./fakes/memory-secure-store";

describe("SecureStore — get/set/delete round trip", () => {
  it("stores and returns a named secret", async () => {
    const store = new MemorySecureStore();
    await store.set("gmail.oauth-refresh", "value-under-test");
    expect(await store.get("gmail.oauth-refresh")).toBe("value-under-test");
  });

  it("replaces rather than duplicating on a second set", async () => {
    const store = new MemorySecureStore();
    await store.set("model-provider.api-key", "first");
    await store.set("model-provider.api-key", "second");
    expect(await store.get("model-provider.api-key")).toBe("second");
    expect(await store.listNames()).toEqual(["model-provider.api-key"]);
  });

  it("deletes, after which the secret is not found", async () => {
    const store = new MemorySecureStore();
    await store.set("gmail.oauth-refresh", "value-under-test");
    await store.delete("gmail.oauth-refresh");
    await expect(store.get("gmail.oauth-refresh")).rejects.toMatchObject({ code: "not_found" });
  });

  /**
   * Listing is the Connection Center's read path. It must expose that a
   * connection exists without exposing what it authorises.
   */
  it("lists names only, never values", async () => {
    const store = new MemorySecureStore();
    await store.set("b.key", "secret-b");
    await store.set("a.key", "secret-a");
    const names = await store.listNames();
    expect(names).toEqual(["a.key", "b.key"]);
    expect(JSON.stringify(names)).not.toContain("secret-");
  });
});

describe("SecureStore — the three failures stay distinguishable", () => {
  /**
   * The whole reason the taxonomy exists: each of these maps to a different
   * user recovery, and collapsing any two produces a real bug — most sharply,
   * a locked vault reported as `not_found` asks the user to re-enter a
   * credential they already gave us, and then overwrites the stored one.
   */
  it("reports a missing secret as not_found", async () => {
    const store = new MemorySecureStore();
    await expect(store.get("gmail.oauth-refresh")).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports a locked vault as vault_locked, not not_found", async () => {
    const store = new MemorySecureStore({ locked: true });
    await expect(store.get("gmail.oauth-refresh")).rejects.toMatchObject({ code: "vault_locked" });
  });

  it("reports a missing backend as backend_unavailable", async () => {
    const store = new MemorySecureStore({ unavailable: true });
    await expect(store.get("gmail.oauth-refresh")).rejects.toMatchObject({
      code: "backend_unavailable",
    });
  });

  it("fails a write when the vault is locked instead of silently dropping it", async () => {
    const store = new MemorySecureStore({ locked: true });
    await expect(store.set("gmail.oauth-refresh", "x")).rejects.toMatchObject({
      code: "vault_locked",
    });
  });

  it("narrows caught errors through isSecureStoreError", async () => {
    const store = new MemorySecureStore();
    try {
      await store.get("gmail.oauth-refresh");
      expect.unreachable("get should have thrown");
    } catch (error: unknown) {
      expect(isSecureStoreError(error)).toBe(true);
      if (isSecureStoreError(error)) {
        expect(error.code).toBe("not_found");
        expect(error.secret_name).toBe("gmail.oauth-refresh");
      }
    }
    expect(isSecureStoreError(new Error("plain"))).toBe(false);
  });
});

describe("capability query — is this store actually OS-backed?", () => {
  it("an in-memory store admits it is neither OS-backed nor persistent", () => {
    const backing = new MemorySecureStore().describeBacking();
    expect(backing.os_backed).toBe(false);
    expect(backing.persists_across_restart).toBe(false);
    expect(backing.unavailable_reason).toBeTruthy();
  });

  it("assertCanHoldSecret refuses a store that is not OS-backed", () => {
    const backing = new MemorySecureStore().describeBacking();
    expect(() => assertCanHoldSecret(backing)).toThrowError(SecureStoreError);
    try {
      assertCanHoldSecret(backing);
    } catch (error: unknown) {
      // Refusal, never a fallback to plaintext — ADR 0001's reason for
      // rejecting the local-service option.
      expect(isSecureStoreError(error) && error.code).toBe("backend_unavailable");
      expect((error as Error).message).toContain("not OS-backed");
    }
  });

  it("assertCanHoldSecret allows an OS-backed store", () => {
    const backing = new MemorySecureStore({ pretendOsBacked: true }).describeBacking();
    expect(backing.os_backed).toBe(true);
    expect(() => assertCanHoldSecret(backing)).not.toThrow();
  });

  it("an unavailable backend is reported with a reason the UI can show", () => {
    const backing = new MemorySecureStore({ unavailable: true }).describeBacking();
    expect(backing.backend).toBe("unavailable");
    expect(backing.unavailable_reason).toBe("no OS vault on this machine");
  });
});

describe("secret names", () => {
  it("accepts boring identifiers", () => {
    for (const name of ["gmail.oauth-refresh", "a1b", "model_provider.key-2"]) {
      expect(isValidSecretName(name)).toBe(true);
    }
  });

  /**
   * The rejections are the point: a pasted *value* does not look like a name,
   * so passing one by mistake fails instead of landing in a vault entry — and
   * in an audit line — as its own key.
   */
  it("rejects names that could be a pasted value, a path or a display string", () => {
    for (const name of [
      "sk-live-AbCdEf0123456789",
      "Gmail Refresh Token",
      "../../etc/passwd",
      "token\nsecond-line",
      "",
      "ab",
      "-leading-dash",
      "x".repeat(129),
    ]) {
      expect(isValidSecretName(name), name).toBe(false);
    }
  });

  it("never echoes the rejected name into the error message", () => {
    try {
      assertValidSecretName("sk-live-AbCdEf0123456789");
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain("sk-live");
      expect(isSecureStoreError(error) && error.code).toBe("invalid_name");
    }
  });

  it("validates the name before touching the store, on every method", async () => {
    const store = new MemorySecureStore();
    await expect(store.get("BAD NAME")).rejects.toMatchObject({ code: "invalid_name" });
    await expect(store.set("BAD NAME", "x")).rejects.toMatchObject({ code: "invalid_name" });
    await expect(store.delete("BAD NAME")).rejects.toMatchObject({ code: "invalid_name" });
  });

  /**
   * Name validation must win over backend state. Otherwise a locked vault would
   * mask a programming error until the day the vault happened to be unlocked.
   */
  it("reports invalid_name even when the backend is also unavailable", async () => {
    const store = new MemorySecureStore({ unavailable: true });
    await expect(store.get("BAD NAME")).rejects.toMatchObject({ code: "invalid_name" });
  });
});
