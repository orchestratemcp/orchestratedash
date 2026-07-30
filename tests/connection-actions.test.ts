/**
 * Connecting, checking and disconnecting a credential (MAR-383).
 *
 * Written against a real SQLite store and a real `Vault` over a fake
 * `safeStorage`, rather than against mocks of both. The questions here are
 * "where did the plaintext end up", "is it still there after a restart" and
 * "what got deleted" — and a mocked store answers none of them.
 *
 * The prompt is the one injected part, because the real one opens a window.
 * Everything downstream of it is the real thing.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { ConnectionSourceManifest } from "../lib/connections";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";
import { MemorySecureStore } from "./fakes/memory-secure-store";
import { refusingOAuth } from "./fakes/oauth-operations";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-connection-actions-"));
process.env.DASH_DATA_DIR = dataDir;

const { performConnectionAction, heldCredentials } = await import("../lib/connection-actions");
const { connectionSecretName } = await import("../lib/connection-credentials");
const { closeDb } = await import("../lib/db");
const { listSecretReferences } = await import("../lib/secret-refs");
const { readStoreBytes } = await import("./helpers/store-bytes");

/** Distinctive: if this appears anywhere, it got there from this test. */
const SECRET = "sk-ledger-9XcQ2mWvT7pLbN4dRzYh";

const AGENT = "ledger-reporter";
const TARGET = { agent_id: AGENT, connection_id: "ledger", field_id: "api-key" };

function example(name: string): ConnectionSourceManifest {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "examples", name), "utf8"),
  ) as ConnectionSourceManifest;
}

const secretManifest = example("dash-managed-secret.manifest.v2.example.json");
const oauthManifest = example("dash-managed.manifest.v2.example.json");
const agentManagedManifest = example("agent-managed.manifest.v2.example.json");

function vault(): Vault {
  return new Vault({
    directory: path.join(dataDir, "vault"),
    safeStorage: new FakeSafeStorage(),
    platform: "win32",
  });
}

/** Records whether the user was asked, and answers with `answer`. */
function prompt(answer: string | null) {
  const asked: string[] = [];
  return {
    asked,
    promptForSecret: (target: { connection_id: string }) => {
      asked.push(target.connection_id);
      return Promise.resolve(answer);
    },
  };
}

function deps(
  store: Vault | MemorySecureStore,
  promptFor: ReturnType<typeof prompt>,
  manifest: ConnectionSourceManifest | null = secretManifest,
) {
  return {
    store,
    readManifest: () => manifest,
    promptForSecret: promptFor.promptForSecret,
    // Throws on contact. Every test in this file drives a typed-secret field,
    // so the OAuth path being unreachable from it is a thing the suite proves
    // rather than a thing a reader checks (MAR-446).
    oauth: refusingOAuth(),
  };
}

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  // Each test starts from disconnected, through the real disconnect path, so
  // the fixture cannot leave a row the code would not have left.
  await performConnectionAction("disconnect", TARGET, deps(vault(), prompt(null)));
});

describe("connect", () => {
  it("stores the value in the vault and only a masked hint in the store", async () => {
    const store = vault();
    const asked = prompt(SECRET);
    const result = await performConnectionAction("connect", TARGET, deps(store, asked));

    expect(result).toMatchObject({ ok: true, state: "connected", masked_hint: "••••RzYh" });
    expect(asked.asked).toEqual(["ledger"]);

    // The vault has it.
    await expect(store.get(connectionSecretName(AGENT, "ledger", "api-key"))).resolves.toBe(SECRET);

    // The database does not — not the value, and not a prefix of it.
    const bytes = readStoreBytes(dataDir);
    expect(bytes).not.toContain(SECRET);
    expect(bytes).not.toContain(SECRET.slice(0, 16));

    // What the row does hold: a name and a mask.
    expect(listSecretReferences(AGENT)).toEqual([
      expect.objectContaining({
        connection_id: "ledger",
        field_id: "api-key",
        secret_name: "dash.connection.ledger-reporter.ledger.api-key",
        masked_hint: "••••RzYh",
      }),
    ]);
  });

  /**
   * The result crosses IPC to the renderer. Nothing on it may be the value, and
   * nothing on it may be enough of the value to matter.
   */
  it("returns nothing that contains the credential", async () => {
    const result = await performConnectionAction("connect", TARGET, deps(vault(), prompt(SECRET)));
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(SECRET);
    expect(serialised).not.toContain(SECRET.slice(0, 8));
  });

  it("treats a cancelled prompt as no change, not a failure", async () => {
    const result = await performConnectionAction("connect", TARGET, deps(vault(), prompt(null)));
    expect(result).toMatchObject({ ok: true, state: "not_connected", detail: "No change was made." });
    expect(listSecretReferences(AGENT)).toEqual([]);
  });

  /**
   * `assertCanHoldSecret` runs before the prompt. Asking someone to go and find
   * an API key and *then* saying there was nowhere to put it wastes the one
   * action that required effort.
   */
  it("refuses before asking when there is no OS-backed vault", async () => {
    const asked = prompt(SECRET);
    const result = await performConnectionAction(
      "connect",
      TARGET,
      deps(new MemorySecureStore(), asked),
    );

    expect(result).toMatchObject({ ok: false, state: "unavailable" });
    expect(result.recovery?.actor).toBe("user");
    expect(asked.asked).toEqual([]);
  });
});

describe("refusals never reach the vault or the user", () => {
  it("refuses an OAuth field without prompting", async () => {
    const asked = prompt(SECRET);
    const result = await performConnectionAction(
      "connect",
      { agent_id: "p", connection_id: "project-service", field_id: "account-authorization" },
      deps(vault(), asked, oauthManifest),
    );

    expect(result).toMatchObject({ ok: false, state: "not_held_by_dash" });
    expect(result.detail).toContain("signs in through its own provider");
    expect(asked.asked).toEqual([]);
  });

  it("refuses an agent-managed connection without prompting", async () => {
    const asked = prompt(SECRET);
    const result = await performConnectionAction(
      "connect",
      { agent_id: "i", connection_id: "invoice-store", field_id: "service-credential" },
      deps(vault(), asked, agentManagedManifest),
    );

    expect(result).toMatchObject({ ok: false, state: "not_held_by_dash" });
    expect(result.detail).toContain("looked after by the agent itself");
    expect(asked.asked).toEqual([]);
  });

  it("refuses a connection the manifest never declared", async () => {
    const asked = prompt(SECRET);
    const result = await performConnectionAction(
      "connect",
      { agent_id: AGENT, connection_id: "stripe", field_id: "api-key" },
      deps(vault(), asked),
    );

    expect(result.ok).toBe(false);
    expect(asked.asked).toEqual([]);
  });

  it("refuses when DASH has not imported the agent's manifest", async () => {
    const asked = prompt(SECRET);
    const result = await performConnectionAction("connect", TARGET, deps(vault(), asked, null));

    expect(result.ok).toBe(false);
    expect(asked.asked).toEqual([]);
  });
});

describe("check", () => {
  it("reports connected while the vault still has it", async () => {
    await performConnectionAction("connect", TARGET, deps(vault(), prompt(SECRET)));
    const result = await performConnectionAction("test", TARGET, deps(vault(), prompt(null)));

    expect(result).toMatchObject({ ok: true, state: "connected", masked_hint: "••••RzYh" });
    // The wording must not claim the provider accepted anything — DASH read its
    // own vault and nothing else.
    expect(result.detail).toContain("reported by the agent when it runs");
  });

  it("does not leak the value it read", async () => {
    await performConnectionAction("connect", TARGET, deps(vault(), prompt(SECRET)));
    const result = await performConnectionAction("test", TARGET, deps(vault(), prompt(null)));
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("reports not connected when the vault has nothing", async () => {
    const result = await performConnectionAction("test", TARGET, deps(vault(), prompt(null)));
    expect(result).toMatchObject({ ok: false, state: "not_connected" });
    expect(result.recovery?.headline).toContain("not connected yet");
  });

  /**
   * The distinction MAR-383 asks for by name: a locked vault must not be
   * reported as a missing credential, or the user is told to find a key they
   * never lost — and connecting again would overwrite the one they have.
   */
  it("tells a locked vault apart from a missing credential", async () => {
    const result = await performConnectionAction(
      "test",
      TARGET,
      deps(new MemorySecureStore({ locked: true, pretendOsBacked: true }), prompt(null)),
    );

    expect(result).toMatchObject({ ok: false, state: "locked" });
    expect(result.recovery?.headline).toContain("locked");
    expect(result.recovery?.next_action).toContain("Unlock");
  });
});

describe("disconnect", () => {
  it("deletes the value from the vault and the row from the store", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, prompt(SECRET)));

    const result = await performConnectionAction("disconnect", TARGET, deps(store, prompt(null)));

    expect(result).toMatchObject({ ok: true, state: "not_connected", masked_hint: null });
    expect(listSecretReferences(AGENT)).toEqual([]);
    await expect(store.get(connectionSecretName(AGENT, "ledger", "api-key"))).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("is not a failure when there was nothing to disconnect", async () => {
    const result = await performConnectionAction("disconnect", TARGET, deps(vault(), prompt(null)));
    expect(result.ok).toBe(true);
  });
});

/**
 * MAR-383 asks for offline/restart behaviour to be tested, not just documented.
 * The vault is a directory and the references are a table, and both outlive the
 * process — so a credential connected before a restart is still connected
 * after one.
 */
describe("across a restart", () => {
  it("still holds the credential after the database is closed and reopened", async () => {
    await performConnectionAction("connect", TARGET, deps(vault(), prompt(SECRET)));

    // The real restart boundary: the handle is dropped and the next call opens
    // the file again from disk.
    closeDb();

    expect(heldCredentials(AGENT)).toEqual([
      { connection_id: "ledger", field_id: "api-key", masked_hint: "••••RzYh" },
    ]);

    const result = await performConnectionAction("test", TARGET, deps(vault(), prompt(null)));
    expect(result).toMatchObject({ ok: true, state: "connected" });
  });
});
