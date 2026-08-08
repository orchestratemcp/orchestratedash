/**
 * ADR 0008 slice 2: the folder is the source, SQLite is the resilient index.
 *
 * These are restart tests because the hard promise is reconciliation, not
 * merely that an import happened to write four paths in one process.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AGENT_MANIFEST_FILE,
  MANIFEST_ONLY_DEPLOY_REFUSAL,
  agentFileIsContained,
  agentFolderAssetsPath,
  agentFolderCodePath,
  agentFolderManifestPath,
  agentFolderMatchesImport,
  agentFolderPath,
  agentFolderRegistrationPath,
  inspectAgentFilePath,
  inspectAgentFolderStanding,
} from "../lib/agent-folders";
import { INVALID_AGENT_FOLDER_NAME_PHRASE } from "../lib/import-feedback";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseManifest = JSON.parse(
  readFileSync(path.join(repoRoot, "examples", "agent.manifest.example.json"), "utf8"),
) as Record<string, unknown>;

function manifestFor(name: string, goal = `Run ${name}`): Record<string, unknown> {
  const manifest = structuredClone(baseManifest);
  const agent = manifest["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["goal"] = goal;
  return manifest;
}

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  store: typeof import("../lib/store");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-folders-"));
  return openStore(dataDir);
}

async function openStore(dataDir: string): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  store: typeof import("../lib/store");
}> {
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  const store = await import("../lib/store");
  opened.push({ dataDir, closeDb: db.closeDb });
  return { dataDir, db, store };
}

afterEach(() => {
  const entries = opened.splice(0);
  for (const entry of entries) entry.closeDb();
  for (const dataDir of new Set(entries.map((entry) => entry.dataDir))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("agent folder imports", () => {
  it("keeps the manifest verbatim in the authoritative folder and the SQLite index", async () => {
    const { dataDir, db, store } = await freshStore();
    const manifest = manifestFor("folder-source", "Folder source");
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

    expect(store.importManifest(manifest, { manifestJson })).toMatchObject({ ok: true });

    const folderJson = readFileSync(agentFolderManifestPath(dataDir, "folder-source"), "utf8");
    const row = db
      .db()
      .prepare("SELECT manifest_json FROM agents WHERE name = ?")
      .get("folder-source") as { manifest_json: string };
    expect(folderJson).toBe(manifestJson);
    expect(row.manifest_json).toBe(manifestJson);
    expect(inspectAgentFolderStanding(dataDir, "folder-source")).toMatchObject({
      kind: "manifest_only",
      refusal: MANIFEST_ONLY_DEPLOY_REFUSAL,
    });
  });

  it("acquires declared code and assets and records a relative spawn recipe", async () => {
    const { dataDir, store } = await freshStore();
    const manifest = manifestFor("complete-folder", "Complete folder");
    const manifestJson = JSON.stringify(manifest);
    const registration = {
      agent_id: "complete-folder",
      manifest_path: AGENT_MANIFEST_FILE,
      command: "node",
      args: ["agent.mjs"],
      cwd: "code",
      env: {},
    };

    expect(
      store.importManifest(manifest, {
        manifestJson,
        registration,
        files: [
          { path: AGENT_MANIFEST_FILE, contents: manifestJson },
          { path: "agent.mjs", contents: "process.stdout.write('ready')\n" },
          { path: "lib/helper.mjs", contents: "export const ready = true\n" },
          { path: "assets/icon.txt", contents: "icon\n" },
        ],
      }),
    ).toMatchObject({ ok: true });

    expect(readFileSync(path.join(agentFolderCodePath(dataDir, "complete-folder"), "agent.mjs"), "utf8"))
      .toBe("process.stdout.write('ready')\n");
    expect(
      readFileSync(path.join(agentFolderAssetsPath(dataDir, "complete-folder"), "icon.txt"), "utf8"),
    ).toBe("icon\n");
    expect(JSON.parse(readFileSync(agentFolderRegistrationPath(dataDir, "complete-folder"), "utf8")))
      .toEqual(registration);
    expect(inspectAgentFolderStanding(dataDir, "complete-folder")).toMatchObject({
      kind: "complete",
      code_path: agentFolderCodePath(dataDir, "complete-folder"),
    });
    const proposed = {
      dataDir,
      agent: "complete-folder",
      manifestJson,
      registration,
      files: [
        { path: AGENT_MANIFEST_FILE, contents: manifestJson },
        { path: "agent.mjs", contents: "process.stdout.write('ready')\n" },
        { path: "lib/helper.mjs", contents: "export const ready = true\n" },
        { path: "assets/icon.txt", contents: "icon\n" },
      ],
    };
    expect(agentFolderMatchesImport(proposed)).toBe(true);
    writeFileSync(path.join(agentFolderCodePath(dataDir, "complete-folder"), "agent.mjs"), "drift\n");
    expect(agentFolderMatchesImport(proposed)).toBe(false);
  });

  it("commits the folder before attempting the SQLite projection", async () => {
    const { dataDir, db, store } = await freshStore();
    const manifest = manifestFor("folder-first");
    db.db().exec("DROP TABLE agents");

    expect(() => store.importManifest(manifest)).toThrow();
    expect(existsSync(agentFolderManifestPath(dataDir, "folder-first"))).toBe(true);
  });

  it("refuses unsafe names and paths at both filesystem guards", async () => {
    const { dataDir, store } = await freshStore();
    const invalid = store.importManifest(manifestFor("con"));
    expect(invalid).toMatchObject({ ok: false });
    expect(invalid.ok ? [] : invalid.errors.join(" ")).toContain(INVALID_AGENT_FOLDER_NAME_PHRASE);
    expect(existsSync(path.join(dataDir, "agents", "con"))).toBe(false);

    expect(inspectAgentFilePath("..\\sibling\\agent.mjs")?.refusal).toBe("traversal");
    expect(agentFileIsContained(dataDir, "safe-agent", "..\\..\\sibling\\agent.mjs")).toBe(
      false,
    );
  });
});

describe("folder/index reconciliation", () => {
  it("lets the folder win, re-projects the row, and surfaces the disagreement", async () => {
    const first = await freshStore();
    const original = manifestFor("folder-wins", "Before");
    expect(first.store.importManifest(original)).toMatchObject({ ok: true });
    first.db.closeDb();

    const changed = manifestFor("folder-wins", "From the folder");
    const changedJson = `${JSON.stringify(changed, null, 2)}\n`;
    writeFileSync(agentFolderManifestPath(first.dataDir, "folder-wins"), changedJson, "utf8");

    const second = await openStore(first.dataDir);
    const visible = second.store.readStore();
    expect(visible.agents["folder-wins"]?.manifest.agent.goal).toBe("From the folder");
    expect(visible.unreadable.agent_folders).toEqual([
      { agent: "folder-wins", kind: "index_drift" },
    ]);
    const projected = second.db
      .db()
      .prepare("SELECT manifest_json FROM agents WHERE name = ?")
      .get("folder-wins") as { manifest_json: string };
    expect(projected.manifest_json).toBe(changedJson);

    // The evidence is session-scoped: the startup that observed and repaired
    // drift surfaces it. A later startup that observes agreement is clean.
    second.db.closeDb();
    const third = await openStore(first.dataDir);
    expect(third.store.readStore().unreadable.agent_folders).toBeUndefined();
  });

  it("keeps readable fallback rows when folders are missing or unreadable", async () => {
    const first = await freshStore();
    expect(first.store.importManifest(manifestFor("missing-folder"))).toMatchObject({ ok: true });
    expect(first.store.importManifest(manifestFor("broken-folder"))).toMatchObject({ ok: true });
    first.db.closeDb();

    rmSync(agentFolderPath(first.dataDir, "missing-folder"), { recursive: true, force: true });
    writeFileSync(agentFolderManifestPath(first.dataDir, "broken-folder"), "{", "utf8");

    const reopened = await openStore(first.dataDir);
    const visible = reopened.store.readStore();
    expect(Object.keys(visible.agents).sort()).toEqual(["broken-folder", "missing-folder"]);
    expect(visible.unreadable.agent_folders).toEqual([
      { agent: "broken-folder", kind: "folder_unreadable" },
      { agent: "missing-folder", kind: "folder_missing" },
    ]);
  });

  it("rebuilds a missing index row from the folder and names that recovery", async () => {
    const first = await freshStore();
    expect(first.store.importManifest(manifestFor("missing-index"))).toMatchObject({ ok: true });
    first.db.db().prepare("DELETE FROM agents WHERE name = ?").run("missing-index");
    first.db.closeDb();

    const reopened = await openStore(first.dataDir);
    const visible = reopened.store.readStore();
    expect(visible.agents["missing-index"]?.manifest.agent.name).toBe("missing-index");
    expect(visible.unreadable.agent_folders).toEqual([
      { agent: "missing-index", kind: "missing_index" },
    ]);
  });
});
