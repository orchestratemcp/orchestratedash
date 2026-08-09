/**
 * Connecting, checking and disconnecting a Google sign-in (MAR-446, DASH-29).
 *
 * The companion to `tests/connection-actions.test.ts`, written the same way and
 * for the same reason: a real SQLite store and a real `Vault` over a fake
 * `safeStorage`, because the questions are "where did the refresh token end up",
 * "what is in the row" and "what got deleted" — and a mocked store answers none
 * of them.
 *
 * The provider is the injected part. Everything between the outcome of a sign-in
 * and the bytes on disk is the real thing.
 *
 * The acceptance criteria this file exists to hold:
 *
 * - *"Importing the Gmail example and pressing Connect … stores a refresh token
 *   in the OS vault."*
 * - *"No token value reaches SQLite, the audit log, a URL or either app
 *   renderer."*
 * - *"Revocation at Google's end surfaces as `revoked` with recovery copy, not
 *   as a generic failure."*
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { ConnectionSourceManifest } from "../lib/connections";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";
import { refusingAi } from "./fakes/ai-operations";
import { oauthCredential, scriptedOAuth } from "./fakes/oauth-operations";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-oauth-connection-"));
process.env.DASH_DATA_DIR = dataDir;

const { performConnectionAction } = await import("../lib/connection-actions");
const { connectionSecretName } = await import("../lib/connection-credentials");
const { closeDb } = await import("../lib/db");
const { listSecretReferences } = await import("../lib/secret-refs");
const { listReceipts } = await import("../lib/broker/store");
const { readStoreBytes } = await import("./helpers/store-bytes");

const AGENT = "gmail-assistant";
const TARGET = { agent_id: AGENT, connection_id: "gmail", field_id: "gmail-account" };
const SECRET_NAME = connectionSecretName(AGENT, "gmail", "gmail-account");

const gmailManifest = JSON.parse(
  readFileSync(
    path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
    "utf8",
  ),
) as ConnectionSourceManifest;

function vault(): Vault {
  return new Vault({
    directory: path.join(dataDir, "vault"),
    safeStorage: new FakeSafeStorage(),
    platform: "win32",
  });
}

function deps(store: Vault, oauth: ReturnType<typeof scriptedOAuth>) {
  return {
    store,
    readManifest: () => gmailManifest,
    promptForSecret: () => {
      throw new Error("A sign-in field must never reach the typed-secret prompt.");
    },
    oauth,
    // A sign-in is not a model provider key, so nothing in this file may reach a
    // probe (MAR-582). Throws rather than answering, for the reason the prompt
    // above does.
    ai: refusingAi(),
  };
}

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await performConnectionAction("disconnect", TARGET, deps(vault(), scriptedOAuth()));
});

describe("connect", () => {
  /**
   * The MAR-383 criterion that could not be met, met end to end.
   */
  it("stores the refresh token in the vault and only a masked account in the store", async () => {
    const store = vault();
    const result = await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    expect(result).toMatchObject({ ok: true, state: "connected" });
    // The account, not four characters of a refresh token nobody has seen.
    expect(result.masked_hint).toBe("he••••@example.com");

    const stored = JSON.parse(await store.get(SECRET_NAME)) as { refresh_token: string };
    expect(stored.refresh_token).toBe(oauthCredential().refresh_token);

    const rows = listSecretReferences(AGENT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      connection_id: "gmail",
      field_id: "gmail-account",
      secret_name: SECRET_NAME,
      masked_hint: "he••••@example.com",
    });
  });

  /**
   * *"No token value reaches SQLite."* Asserted over the database file's raw
   * bytes rather than over a query, because a query only sees the columns
   * somebody thought to look at.
   */
  it("puts no part of the token or the account in the database file", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const bytes = readStoreBytes(dataDir);
    expect(bytes).not.toContain(oauthCredential().refresh_token);
    expect(bytes).not.toContain("henrik@example.com");
    // Nor the local part on its own, which the mask deliberately withholds.
    expect(bytes).not.toContain("nrik@");
  });

  /**
   * MAR-458 added a second writer of the account to the store — the broker's
   * receipt — and the first version of it stored the address whole. The test
   * above caught it, and this one names the row so a future regression says
   * *which* table rather than "some bytes are in the file".
   */
  it("masks the account on the permission receipt too", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const receipts = listReceipts(AGENT);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.account_hint).toBe("he••••@example.com");
    expect(receipts[0]?.operations).toContain("gmail.search");
    // Approved now, never used yet. The distinction is the whole point of the
    // column: a grant nothing has exercised should not read as one in use.
    expect(receipts[0]?.last_used_at).toBeNull();
  });

  it("forgets the receipt when the connection is disconnected", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));
    expect(listReceipts(AGENT)).toHaveLength(1);

    await performConnectionAction("disconnect", TARGET, deps(store, scriptedOAuth()));
    expect(listReceipts(AGENT)).toEqual([]);
  });

  it("survives a database close and reopen", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    closeDb();

    const rows = listSecretReferences(AGENT);
    expect(rows[0]?.masked_hint).toBe("he••••@example.com");
    expect(JSON.parse(await vault().get(SECRET_NAME))).toMatchObject({ provider: "google" });
  });

  /**
   * A cancel is an ordinary outcome, and it must not look like a disconnection.
   */
  it("leaves an existing sign-in alone when the user cancels", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const cancelled = await performConnectionAction(
      "connect",
      TARGET,
      deps(store, scriptedOAuth({ authorize: { ok: false, code: "cancelled" } })),
    );

    expect(cancelled).toMatchObject({ ok: false, state: "connected" });
    expect(cancelled.masked_hint).toBe("he••••@example.com");
    // Still there, and still readable.
    expect(JSON.parse(await store.get(SECRET_NAME))).toMatchObject({ provider: "google" });
  });

  it("offers the connected account back when signing in again", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const again = scriptedOAuth();
    await performConnectionAction("connect", TARGET, deps(store, again));

    expect(again.hints).toEqual(["henrik@example.com"]);
  });

  /**
   * Consent screens have checkboxes. A partial grant is real and is kept — the
   * user consented to something — but the result says there is more to do, in
   * the provider's plain-language words.
   */
  it("keeps a partial grant and says which permission is missing", async () => {
    const store = vault();
    const partial = scriptedOAuth({
      authorize: {
        ok: true,
        credential: oauthCredential({
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
        }),
      },
    });

    const result = await performConnectionAction("connect", TARGET, deps(store, partial));

    expect(result).toMatchObject({ ok: false, state: "connected" });
    expect(result.recovery?.meaning).toContain("Write and save Gmail drafts");
    expectPlainLanguage([
      result.detail,
      result.recovery?.headline ?? "",
      result.recovery?.meaning ?? "",
      result.recovery?.next_action ?? "",
    ]);
    // Kept, not thrown away.
    expect(await store.get(SECRET_NAME)).toContain("refresh_token");
  });

  it("says nothing was stored when the user declines at the provider", async () => {
    const store = vault();
    const result = await performConnectionAction(
      "connect",
      TARGET,
      deps(store, scriptedOAuth({ authorize: { ok: false, code: "denied" } })),
    );

    expect(result).toMatchObject({ ok: false, state: "not_connected", masked_hint: null });
    expect(listSecretReferences(AGENT)).toEqual([]);
  });
});

describe("check", () => {
  it("asks the provider, and reports a live sign-in", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const checking = scriptedOAuth();
    const result = await performConnectionAction("test", TARGET, deps(store, checking));

    expect(result).toMatchObject({ ok: true, state: "connected" });
    expect(checking.calls).toContain("check");
    expect(result.detail).toBe("Google still accepts the sign-in DASH holds for Gmail.");
  });

  /**
   * *"Revocation at Google's end surfaces as `revoked` with recovery copy, not
   * as a generic failure."*
   */
  it("reports a withdrawn grant as revoked, with the words for it", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const result = await performConnectionAction(
      "test",
      TARGET,
      deps(store, scriptedOAuth({ check: { ok: false, code: "revoked" } })),
    );

    expect(result.state).toBe("revoked");
    expect(result.recovery?.headline).toBe("Access to Gmail was withdrawn.");
    expect(result.recovery?.meaning).toContain("Someone removed this agent's access");
    expectPlainLanguage([
      result.recovery?.headline ?? "",
      result.recovery?.meaning ?? "",
      result.recovery?.next_action ?? "",
    ]);
  });

  /**
   * Being offline is not evidence that access was taken away. Reporting
   * `revoked` here would send a user to their Google account settings looking
   * for something that never happened.
   */
  it("does not call a network failure a revocation", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const result = await performConnectionAction(
      "test",
      TARGET,
      deps(store, scriptedOAuth({ check: { ok: false, code: "network" } })),
    );

    expect(result.state).toBe("connected");
    expect(result.recovery?.headline).toBe("DASH could not reach Gmail.");
  });

  it("reports nothing stored as not connected rather than as a failure to check", async () => {
    const result = await performConnectionAction("test", TARGET, deps(vault(), scriptedOAuth()));

    expect(result).toMatchObject({ ok: false, state: "not_connected", masked_hint: null });
    expect(result.recovery?.next_action).toBe("Connect Gmail.");
  });

  /**
   * A value in the vault that is not one of ours — an API key left behind by a
   * manifest whose field changed kind. It must read as "connect this", not as a
   * crash and not as a working connection.
   */
  it("treats an unreadable stored value as not connected", async () => {
    const store = vault();
    await store.set(SECRET_NAME, "sk-an-api-key-from-a-previous-manifest");

    const result = await performConnectionAction("test", TARGET, deps(store, scriptedOAuth()));

    expect(result).toMatchObject({ ok: false, state: "not_connected" });
  });
});

describe("disconnect", () => {
  it("withdraws the grant, deletes the value, and forgets the row", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const disconnecting = scriptedOAuth();
    const result = await performConnectionAction("disconnect", TARGET, deps(store, disconnecting));

    expect(result).toMatchObject({ ok: true, state: "not_connected", masked_hint: null });
    expect(disconnecting.calls).toContain("revoke");
    expect(result.detail).toContain("withdraw the agent's access");
    expect(listSecretReferences(AGENT)).toEqual([]);
    await expect(store.get(SECRET_NAME)).rejects.toMatchObject({ code: "not_found" });
  });

  /**
   * Offline, DASH can still keep the promise it made — it stops holding the
   * credential. What it must not do is claim the larger thing it did not manage.
   */
  it("still disconnects when the provider cannot be reached, and says so", async () => {
    const store = vault();
    await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth()));

    const result = await performConnectionAction(
      "disconnect",
      TARGET,
      deps(store, scriptedOAuth({ revoke: false })),
    );

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("could not reach Google");
    expect(listSecretReferences(AGENT)).toEqual([]);
    await expect(store.get(SECRET_NAME)).rejects.toMatchObject({ code: "not_found" });
  });

  it("is harmless when there was nothing connected", async () => {
    const result = await performConnectionAction(
      "disconnect",
      TARGET,
      deps(vault(), scriptedOAuth()),
    );

    expect(result.ok).toBe(true);
  });
});

describe("what never crosses back", () => {
  /**
   * `ConnectionActionResult` is what `lib/shell/ipc.ts` puts on the command
   * channel and into the audit record. Nothing on it may be derived from a token.
   */
  it("returns nothing derived from the refresh token on any path", async () => {
    const store = vault();
    const token = oauthCredential().refresh_token;

    const results = [
      await performConnectionAction("connect", TARGET, deps(store, scriptedOAuth())),
      await performConnectionAction("test", TARGET, deps(store, scriptedOAuth())),
      await performConnectionAction(
        "test",
        TARGET,
        deps(store, scriptedOAuth({ check: { ok: false, code: "revoked" } })),
      ),
      await performConnectionAction("disconnect", TARGET, deps(store, scriptedOAuth())),
    ];

    for (const result of results) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(token);
      // Not even a fragment. Four characters of a refresh token is what
      // `maskSecret` would have produced, and the account hint exists so that
      // never happens.
      expect(serialized).not.toContain(token.slice(-4));
    }
  });
});
