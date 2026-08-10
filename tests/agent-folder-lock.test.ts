/**
 * MAR-595 finding 15: re-importing a changed manifest onto a running agent
 * failed with a message that blamed a bad build — "DASH could not finish
 * copying … Build the agent again" — when the real cause is Windows
 * refusing to rename a folder a live process still has open. This pins both
 * halves of the fix: the classifier that tells an `EBUSY` apart from every
 * other write failure (`isAgentFolderLocked`), and `importManifest`'s use of
 * it to report `locked: true` instead of the generic message.
 *
 * `pnpm test` runs on Linux CI (`.github/workflows/ci.yml`'s `verify` job),
 * where a directory rename never fails just because a process's cwd sits
 * inside it — the real Windows lock this bug is about cannot be reproduced
 * here. `writeAgentFolder` is mocked to throw a fabricated `EBUSY` instead,
 * which is honest about testing the *classification*, not the OS behaviour
 * that triggers it.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isAgentFolderLocked } from "../lib/agent-folders";

describe("isAgentFolderLocked", () => {
  it("recognises EBUSY, the code Windows uses for a folder a live process still has open", () => {
    const error = Object.assign(new Error("rename EBUSY"), { code: "EBUSY" });
    expect(isAgentFolderLocked(error)).toBe(true);
  });

  it("does not treat EPERM as a lock — that code already means a read-only handle elsewhere in this codebase", () => {
    const error = Object.assign(new Error("write EPERM"), { code: "EPERM" });
    expect(isAgentFolderLocked(error)).toBe(false);
  });

  it("is false for an error with no code at all", () => {
    expect(isAgentFolderLocked(new Error("something else"))).toBe(false);
  });

  it("is false for a non-Error value", () => {
    expect(isAgentFolderLocked("EBUSY")).toBe(false);
    expect(isAgentFolderLocked(null)).toBe(false);
  });
});

const ebusy = Object.assign(new Error("rename EBUSY"), { code: "EBUSY" });

vi.mock("../lib/agent-folders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agent-folders")>();
  return {
    ...actual,
    writeAgentFolder: vi.fn(() => {
      throw ebusy;
    }),
  };
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseManifest = JSON.parse(
  readFileSync(path.join(repoRoot, "examples", "agent.manifest.example.json"), "utf8"),
) as Record<string, unknown>;

function manifestFor(name: string): Record<string, unknown> {
  const manifest = structuredClone(baseManifest);
  (manifest["agent"] as Record<string, unknown>)["name"] = name;
  return manifest;
}

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

afterEach(() => {
  const entries = opened.splice(0);
  for (const entry of entries) entry.closeDb();
  for (const dataDir of new Set(entries.map((entry) => entry.dataDir))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("importManifest, when the folder write fails with EBUSY", () => {
  it("reports locked: true instead of the generic write-failure message", async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "dash-locked-"));
    process.env.DASH_DATA_DIR = dataDir;
    vi.resetModules();
    const db = await import("../lib/db");
    const store = await import("../lib/store");
    opened.push({ dataDir, closeDb: db.closeDb });

    const result = store.importManifest(manifestFor("locked-agent"));

    expect(result).toMatchObject({ ok: false, locked: true });
  });
});
