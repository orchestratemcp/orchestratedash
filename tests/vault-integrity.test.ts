/**
 * MAR-742, item 3b: the mechanism that makes a credential DASH holds read as
 * one it never had, and the hardening that makes the next one self-diagnosing.
 *
 * ## The evidence this file is built from
 *
 * 2026-08-24. A blob written to `%APPDATA%\orchestratedash\vault` at 15:30 was
 * reported by the startup self-check at 20:57 as
 * `{ ok: false, code: "not_found", cause: "ENOENT" }`, while the Discord bot
 * token beside it in the same directory went on working. The recorded failure
 * was found in `%TEMP%\dash-scratch-5step\dash.sqlite` — a **scratch** store,
 * not the installed one — with `checked_at: 2026-08-24T18:57:34.414Z`, and the
 * `fleet_connections` row naming that secret carried
 * `connected_at: 2026-08-24T19:09:58Z`: twelve minutes *after* the failed
 * check, which is the disconnect-and-re-add that "fixed" it.
 *
 * ## What that pins, and what it does not
 *
 * It pins the shape. DASH resolves **two roots independently**: the store from
 * `DASH_DATA_DIR`, and the vault from `app.getPath("userData")` — which only
 * Electron's `--user-data-dir` moves (`electron/secure-store.ts`:
 * `useUserDataDirectory` seeds `DASH_DATA_DIR` *from* userData when unset, and
 * never the reverse). A launch that moves one and not the other splits a
 * `fleet_connections` row from the blob it names, and the read that follows
 * gets a real `ENOENT` for a credential that is really on disk — somewhere
 * else. `describes the split` below is that, reproduced.
 *
 * It does **not** pin that this was the mechanism on the night, and the tests
 * here do not claim it was. The launch that failed was gone by the time anyone
 * looked, and the one field that would have settled it — *which directory did
 * that process resolve?* — was not recorded anywhere. That absence is the
 * finding, `carries the resolved path` is the fix, and `retries` covers the
 * suspect the artifacts cannot rule out either way: a Windows filter driver
 * failing one open with `STATUS_OBJECT_NAME_NOT_FOUND`.
 *
 * Two suspects the evidence *does* rule out are pinned at the bottom.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isSecureStoreError } from "../lib/secure-store";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "dash-vault-integrity-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

/**
 * A vault under a named userData root, the way `secureStore()` builds one.
 *
 * The nesting is not decoration: `Vault.identity()` reads the app name off the
 * *second-to-last* path segment, so a vault built without a userData directory
 * above it would report the wrong identity and the MAR-684 branches would be
 * exercised against a shape the real thing never has.
 */
function vaultUnder(userDataName: string): Vault {
  const directory = path.join(root, userDataName, "vault");
  return new Vault({
    directory,
    safeStorage: new FakeSafeStorage(),
    platform: "win32",
  });
}

describe("the split between the store root and the vault root (MAR-742)", () => {
  it("reads a credential as never stored when only one of the two roots moved", async () => {
    /*
     * The reproduction, in three lines and no Electron.
     *
     * A key is connected while DASH runs as `orchestratedash` — the blob lands
     * under that userData. The next launch moves `--user-data-dir` and keeps
     * pointing `DASH_DATA_DIR` at the same store, so the row that names this
     * secret survives and the vault under it does not.
     */
    const asInstalled = vaultUnder("orchestratedash");
    await asInstalled.set("dash.fleet.openrouter.account-1.api_key", "the-key-under-test");

    const asScratch = vaultUnder("dash-scratch-5step");
    const failure = await asScratch.get("dash.fleet.openrouter.account-1.api_key").catch(
      (error: unknown) => error,
    );

    // Exactly the pair the 20:57 record carried, and it is *correct* — the file
    // genuinely is not there. The taxonomy was never the bug.
    expect(isSecureStoreError(failure)).toBe(true);
    expect(failure).toMatchObject({ code: "not_found", cause_code: "ENOENT" });

    // And the blob is on disk the whole time, which is the half that made this
    // read as a vault fault rather than as a path fault.
    expect(readdirSync(path.join(root, "orchestratedash", "vault"))).toEqual([
      "dash-secret-dash.fleet.openrouter.account-1.api_key.enc",
    ]);
  });

  it("still says ok for its own canary while a fleet read fails, which is why the self-check looked healthy", async () => {
    /*
     * The 20:57 record read `canary: "ok"` beside the failed name, and that
     * combination is what sent the diagnosis at the vault rather than at the
     * path: a working canary looks like proof the vault is fine.
     *
     * It is not. The canary writes and reads in **whichever directory this
     * process resolved**, so it passes in an empty one — it can never see a
     * split, by construction. Pinned here so the next person reading a
     * `canary: ok` record knows exactly what it did and did not establish.
     */
    const asInstalled = vaultUnder("orchestratedash");
    await asInstalled.set("dash.fleet.openrouter.account-1.api_key", "the-key-under-test");

    const asScratch = vaultUnder("dash-scratch-5step");
    await asScratch.set("dash.self-check.canary", "dash-vault-self-check");
    expect(await asScratch.get("dash.self-check.canary")).toBe("dash-vault-self-check");
    await asScratch.delete("dash.self-check.canary");

    await expect(asScratch.get("dash.fleet.openrouter.account-1.api_key")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("carries the resolved path on the failure, so the next report answers where by itself", async () => {
    // The field whose absence turned this into filesystem archaeology. One
    // string, and the split above becomes readable off the record.
    const asScratch = vaultUnder("dash-scratch-5step");
    const failure = (await asScratch
      .get("dash.fleet.openrouter.account-1.api_key")
      .catch((error: unknown) => error)) as { resolved_path?: string };

    expect(failure.resolved_path).toBe(
      path.join(
        root,
        "dash-scratch-5step",
        "vault",
        "dash-secret-dash.fleet.openrouter.account-1.api_key.enc",
      ),
    );
    // It names the directory that was read, not the one the blob is in — which
    // is the whole point: two records side by side show two different folders.
    expect(failure.resolved_path).not.toContain("orchestratedash");
  });

  it("reports where it looked on an unreadable-but-present entry, not only a missing one", async () => {
    /*
     * The MAR-684 branch: an errno that is *not* `ENOENT` must stay
     * `vault_locked` — the code whose recovery destroys nothing — and must now
     * also say where.
     *
     * Provoked with a real filesystem rather than a mocked one: a **directory**
     * standing where the blob's name belongs makes the open fail with a
     * genuine non-`ENOENT` errno, on this platform, without anything in the
     * test pretending to be `node:fs`.
     */
    const store = vaultUnder("orchestratedash");
    const directory = path.join(root, "orchestratedash", "vault");
    const file = path.join(
      directory,
      "dash-secret-dash.fleet.openrouter.account-1.api_key.enc",
    );
    mkdirSync(file, { recursive: true });

    const failure = (await store
      .get("dash.fleet.openrouter.account-1.api_key")
      .catch((error: unknown) => error)) as { code?: string; cause_code?: string; resolved_path?: string };

    expect(failure.code).toBe("vault_locked");
    expect(failure.resolved_path).toBe(file);
    // The errno itself is the platform's to choose — what this pins is that it
    // is carried, and that it is not `ENOENT` being rounded into "never stored".
    expect(failure.cause_code).not.toBe("ENOENT");
  });

  it("hands back the vault directory even when nothing failed", async () => {
    // `describeLocation`'s reason: a record that only names a path when
    // something broke cannot be compared with the launch where nothing did.
    const store = vaultUnder("orchestratedash");
    expect(store.describeLocation()).toBe(path.join(root, "orchestratedash", "vault"));
  });
});

describe("a read that fails once (MAR-742)", () => {
  it("retries, so a blob that becomes readable between attempts is found rather than reported missing", async () => {
    /*
     * The suspect the artifacts cannot settle either way: on Windows an
     * on-access scanner holding a file mid-scan can fail the open, and a filter
     * driver is free to answer `STATUS_OBJECT_NAME_NOT_FOUND` — which arrives
     * here as `ENOENT`, the code whose recovery is *paste your credential
     * again*.
     *
     * Reproduced against the real filesystem instead of a mocked one, because
     * `node:fs` exports cannot be spied on under ESM and because the real thing
     * is a better proof anyway. `get` is started while the blob is absent, so
     * the first attempt takes a genuine `ENOENT`; the file is then written
     * during the backoff, and the second attempt finds it. Nothing here
     * pretends to be a filesystem — the file really is missing, and then really
     * is there.
     */
    const store = vaultUnder("orchestratedash");
    const directory = path.join(root, "orchestratedash", "vault");
    // Written through a second Vault over the same directory, so the envelope
    // is the real one and not a fixture this test had to know the shape of.
    const writer = new Vault({
      directory,
      safeStorage: new FakeSafeStorage(),
      platform: "win32",
    });
    await writer.set("dash.self-check.canary", "unrelated");
    const blob = path.join(
      directory,
      "dash-secret-dash.fleet.openrouter.account-1.api_key.enc",
    );

    await writer.set("dash.fleet.openrouter.account-1.api_key", "the-key-under-test");
    const envelope = readFileSync(blob, "utf8");
    rmSync(blob);

    const reading = store.get("dash.fleet.openrouter.account-1.api_key");
    // Put it back before the first backoff elapses. `readWithRetry` awaits a
    // real timer between attempts, so this runs after attempt one has already
    // failed and before attempt two is made.
    writeFileSync(blob, envelope, "utf8");

    expect(await reading).toBe("the-key-under-test");
  });

  it("still reports a genuinely missing secret, having waited out the whole ladder first", async () => {
    // The retry must not turn "there is nothing there" into a hang or a lie: it
    // costs a bounded pause and then says the same true thing. The elapsed time
    // is what shows it actually tried again — no mock required.
    const store = vaultUnder("orchestratedash");
    const started = Date.now();

    await expect(store.get("dash.fleet.openrouter.account-1.api_key")).rejects.toMatchObject({
      code: "not_found",
      cause_code: "ENOENT",
    });

    // The ladder is 25ms + 100ms. Asserted loosely from below, so the numbers
    // can be tuned without this failing, and not from above, so a slow machine
    // does not redden the suite.
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it("does not retry an unreadable envelope, which no pause could fix", async () => {
    /*
     * The line the retry must not cross. A torn envelope is not a filesystem
     * race — `set` renames a fully-written file onto the name — so retrying it
     * would add latency to a failure that is already stable, on a path that
     * runs once per connection at every startup.
     *
     * Shown by the clock again: this failure returns without walking the ladder
     * the test above measures.
     */
    const store = vaultUnder("orchestratedash");
    const directory = path.join(root, "orchestratedash", "vault");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      path.join(directory, "dash-secret-dash.fleet.openrouter.account-1.api_key.enc"),
      "not json at all\n",
      "utf8",
    );

    const started = Date.now();
    await expect(store.get("dash.fleet.openrouter.account-1.api_key")).rejects.toMatchObject({
      code: "not_found",
      cause_code: "envelope_unreadable",
    });
    expect(Date.now() - started).toBeLessThan(100);
  });
});

describe("suspects the evidence rules out (MAR-742)", () => {
  it("never leaves the name without a file while replacing a secret", async () => {
    /*
     * The rename-window suspect, closed.
     *
     * `set` writes `<target>.tmp`, verifies it decrypts, and only then renames
     * onto the name — so there is no instant at which the target is absent, and
     * a concurrent reader either sees the old blob or the new one. Pinned by
     * reading the directory from inside the encrypt step, which is the moment a
     * window would be open if there were one.
     */
    const safeStorage = new FakeSafeStorage();
    const directory = path.join(root, "orchestratedash", "vault");
    const store = new Vault({ directory, safeStorage, platform: "win32" });
    await store.set("dash.fleet.openrouter.account-1.api_key", "the-first-key");

    const file = "dash-secret-dash.fleet.openrouter.account-1.api_key.enc";
    const seen: string[][] = [];
    const realEncrypt = safeStorage.encryptString.bind(safeStorage);
    vi.spyOn(safeStorage, "encryptString").mockImplementation((plain: string) => {
      seen.push(readdirSync(directory));
      return realEncrypt(plain);
    });

    await store.set("dash.fleet.openrouter.account-1.api_key", "the-second-key");

    expect(seen[0]).toContain(file);
    expect(readdirSync(directory)).toContain(file);
    // And no `.tmp` survives the commit.
    expect(readdirSync(directory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(await store.get("dash.fleet.openrouter.account-1.api_key")).toBe("the-second-key");
  });

  it("writes no `.orphaned` file, so the one on disk was never DASH's doing", async () => {
    /*
     * The other suspect the brief named. `%APPDATA%\orchestratedash\vault` holds
     * `…api_key.enc.orphaned` dated 2026-08-19, which reads like a rename
     * mechanism — and there is none: nothing in this repository, at any commit,
     * writes that suffix. It is a hand-made artifact from an earlier
     * investigation.
     *
     * Pinned as a property rather than a grep, so that a future orphan pass
     * cannot be added without this failing and its author having to decide, in
     * public, that it is atomic.
     */
    const directory = path.join(root, "orchestratedash", "vault");
    const store = new Vault({ directory, safeStorage: new FakeSafeStorage(), platform: "win32" });

    await store.set("dash.fleet.openrouter.account-1.api_key", "the-first-key");
    await store.set("dash.fleet.openrouter.account-1.api_key", "the-second-key");
    await store.set("dash.chief.discord.bot_token", "another-value");
    await store.delete("dash.chief.discord.bot_token");

    expect(readdirSync(directory).filter((name) => name.includes(".orphaned"))).toEqual([]);
  });

  it("matches the name the store records exactly, so case and encoding are not in it", async () => {
    /*
     * The third suspect. The 20:57 row carried `secret_name` of exactly 39
     * characters — `dash.fleet.openrouter.account-1.api_key` — and the file on
     * disk was byte-identical to what `fileFor` builds from it. Pinned so the
     * filename mapping cannot drift under a name that reads the same.
     */
    const directory = path.join(root, "orchestratedash", "vault");
    const store = new Vault({ directory, safeStorage: new FakeSafeStorage(), platform: "win32" });
    const name = "dash.fleet.openrouter.account-1.api_key";
    expect(name).toHaveLength(39);

    await store.set(name, "the-key-under-test");
    expect(readdirSync(directory)).toEqual([`dash-secret-${name}.enc`]);
    // And the envelope on disk is JSON with no plaintext in it — the standing
    // property, restated here because this test is the one that reads the file.
    const raw = readFileSync(path.join(directory, `dash-secret-${name}.enc`), "utf8");
    expect(raw).not.toContain("the-key-under-test");
    expect(JSON.parse(raw)).toMatchObject({ format_version: 1, written_by: "orchestratedash" });
  });
});
