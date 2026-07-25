/**
 * Secret redaction, at the three places a credential could escape: the store,
 * the logs, and the IPC boundary.
 *
 * These are the tests MAR-416 asks for by name, and they are written as
 * end-to-end checks against real artefacts rather than as assertions about
 * intent. The store test reads the bytes SQLite actually wrote. The IPC test
 * walks the real command catalogue. A test that only checked that the right
 * function was called would pass just as happily on the day someone adds a
 * second path that skips it.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  COMMANDS,
  executeCommand,
  formatAuditLine,
  reviewCommand,
} from "../lib/shell/ipc";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-redaction-"));
process.env.DASH_DATA_DIR = dataDir;

const { importManifest, ingestEvents } = await import("../lib/store");
const { closeDb } = await import("../lib/db");
const { maskSecret, isMaskedHint, listSecretReferences, recordSecretReference } = await import(
  "../lib/secret-refs"
);
const { asStoredText, readStoreBytes } = await import("./helpers/store-bytes");

/** A distinctive value: if it appears anywhere, it got there from this test. */
const SECRET = "sk-live-51H8kQrZ2vNpXwT9dEaLmB4c";

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the store never holds a secret value", () => {
  it("keeps the plaintext out of the database after a full connect flow", async () => {
    const vaultDirectory = path.join(dataDir, "vault");
    const store = new Vault({
      directory: vaultDirectory,
      safeStorage: new FakeSafeStorage(),
      platform: "win32",
    });

    // The real shape of connecting something: the credential goes to the OS
    // vault, and only a name and a masked hint go to SQLite.
    await store.set("gmail.oauth-refresh", SECRET);
    recordSecretReference({
      agent: "gmail-meeting-assistant",
      connection_id: "gmail",
      field_id: "refresh_token",
      secret_name: "gmail.oauth-refresh",
      masked_hint: maskSecret(SECRET),
      backend: store.describeBacking().backend,
    });
    importManifest(
      JSON.parse(readFileSync(path.join(repoRoot, "examples", "agent.manifest.example.json"), "utf8")),
    );
    ingestEvents(
      JSON.parse(readFileSync(path.join(repoRoot, "examples", "run-event.example.json"), "utf8")),
    );

    const bytes = readStoreBytes(dataDir);
    expect(bytes).not.toContain(SECRET);
    // Not even a substring long enough to be worth brute forcing.
    expect(bytes).not.toContain(SECRET.slice(0, 16));
    // What is there: the reference and the hint.
    expect(bytes).toContain("gmail.oauth-refresh");
    expect(bytes).toContain(asStoredText("••••mB4c"));
  });

  it("keeps the ciphertext out of the database too", () => {
    const files = readdirSync(path.join(dataDir, "vault"));
    const ciphertext = (
      JSON.parse(readFileSync(path.join(dataDir, "vault", files[0]!), "utf8")) as {
        ciphertext_b64: string;
      }
    ).ciphertext_b64;

    // The vault is a separate file by design: "no secret value in the store"
    // has no carve-out for encrypted ones, which is what makes it checkable.
    expect(readStoreBytes(dataDir)).not.toContain(ciphertext);
  });

  it("refuses a raw value where a masked hint belongs", () => {
    expect(isMaskedHint(SECRET)).toBe(false);
    expect(() =>
      recordSecretReference({
        agent: null,
        connection_id: "openrouter",
        field_id: "api_key",
        secret_name: "openrouter.api-key",
        masked_hint: SECRET,
        backend: "os_keychain",
      }),
    ).toThrow(/never accepts a raw value/);
    // And the error itself does not carry the value it rejected.
    try {
      recordSecretReference({
        agent: null,
        connection_id: "openrouter",
        field_id: "api_key",
        secret_name: "openrouter.api-key",
        masked_hint: SECRET,
        backend: "os_keychain",
      });
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("refuses a pasted value where a secret name belongs", () => {
    expect(() =>
      recordSecretReference({
        agent: null,
        connection_id: "openrouter",
        field_id: "api_key",
        secret_name: SECRET,
        masked_hint: null,
        backend: "os_keychain",
      }),
    ).toThrow();
  });

  it("reveals nothing at all for a short value", () => {
    expect(maskSecret("hunter2")).toBe("••••");
    expect(maskSecret("")).toBe("••••");
  });

  it("returns references that are safe to render in full", () => {
    const references = listSecretReferences("gmail-meeting-assistant");
    expect(references).toHaveLength(1);
    expect(JSON.stringify(references)).not.toContain(SECRET);
    expect(references[0]).toMatchObject({
      secret_name: "gmail.oauth-refresh",
      masked_hint: "••••mB4c",
    });
  });
});

describe("logs never carry a secret value", () => {
  it("audits payload keys and not payload values", () => {
    const review = reviewCommand({
      command: "shell.ping",
      request_id: "req-1",
      payload: { issued_at: SECRET },
    });
    const line = formatAuditLine(review.audit);

    expect(line).toContain("issued_at");
    expect(line).not.toContain(SECRET);
    expect(JSON.stringify(review.audit)).not.toContain(SECRET);
  });

  it("audits a denied request without echoing what it carried", () => {
    const review = reviewCommand({
      command: "shell.exfiltrate",
      request_id: "req-2",
      payload: { token: SECRET },
    });
    expect(review.decision).toBe("denied");
    expect(formatAuditLine(review.audit)).not.toContain(SECRET);
  });

  it("keeps a secret out of vault error messages", async () => {
    const store = new Vault({
      directory: path.join(dataDir, "locked-vault"),
      safeStorage: new FakeSafeStorage({ locked: true }),
      platform: "win32",
    });
    try {
      await store.set("gmail.oauth-refresh", SECRET);
      expect.unreachable("should have thrown");
    } catch (error: unknown) {
      expect((error as Error).message).not.toContain(SECRET);
      // The name is safe and useful; the value is neither.
      expect((error as Error).message).toContain("gmail.oauth-refresh");
    }
  });
});

describe("the IPC boundary carries no secret", () => {
  /**
   * The catalogue is the whole surface — `electron/main.ts` registers one
   * handler and `lib/shell/ipc.ts` denies anything not listed. Walking it means
   * a future command that took a credential would fail here rather than at
   * review time.
   */
  it("declares no payload key that would carry a credential", () => {
    const suspicious = /secret|token|password|credential|api[_-]?key|refresh/i;
    for (const [name, spec] of Object.entries(COMMANDS)) {
      for (const key of spec.payload_keys) {
        expect(suspicious.test(key), `${name}.${key}`).toBe(false);
      }
    }
  });

  it("returns no secret to the renderer", () => {
    const review = reviewCommand({ command: "shell.ping", request_id: "req-3" });
    const result = executeCommand(review);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("rejects a non-primitive payload, which is how a credential blob would arrive", () => {
    const review = reviewCommand({
      command: "shell.ping",
      request_id: "req-4",
      payload: { issued_at: { nested: SECRET } },
    });
    expect(review).toMatchObject({ decision: "denied", reason: "unsupported_payload_value" });
    expect(formatAuditLine(review.audit)).not.toContain(SECRET);
  });

  /**
   * The structural half of the same rule. `SecureStore` lives in the main
   * process; anything under `app/` is renderer code, and an import from there
   * would put a credential store one bundle away from page script no matter
   * what the IPC layer does.
   */
  it("keeps the vault unreachable from renderer code", () => {
    const offenders: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          const source = readFileSync(full, "utf8");
          if (/from\s+["'][^"']*(?:vault|secure-store|secret-refs)["']/.test(source)) {
            offenders.push(path.relative(repoRoot, full));
          }
        }
      }
    };
    walk(path.join(repoRoot, "app"));
    expect(offenders).toEqual([]);
  });
});
