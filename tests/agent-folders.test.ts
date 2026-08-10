/**
 * ADR 0008 slice 2: the folder is the source, SQLite is the resilient index.
 *
 * These are restart tests because the hard promise is reconciliation, not
 * merely that an import happened to write four paths in one process.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("does not project an externally edited folder over the accepted row", async () => {
    /*
     * MAR-584, and it is the other half of "lets the folder win" above rather
     * than a contradiction of it.
     *
     * Two different events reach the same disagreement. **Index drift** — the
     * case above — is DASH having committed the folder and died before writing
     * the row: the folder is what DASH accepted, and projecting is a repair.
     * **An external edit** is the opposite: the row is the version the person
     * approved and the folder is a proposal nobody has looked at. Until now both
     * were projected, so an agent's declaration was silently replaced at the
     * next restart by whatever an editor had left on disk.
     *
     * The registration is what tells them apart, because it records the digest
     * of the document DASH accepted at the moment it accepted it. So this test
     * writes one; the case above deliberately has none, which is why it still
     * projects and still should.
     */
    const first = await freshStore();
    const original = manifestFor("edited-outside", "Before");
    const originalJson = `${JSON.stringify(original, null, 2)}\n`;
    expect(first.store.importManifest(original, { manifestJson: originalJson })).toMatchObject({
      ok: true,
    });

    const { writeRegistration } = await import("../lib/registration");
    writeRegistration(first.dataDir, {
      registration: {
        agent_id: "edited-outside",
        manifest_path: agentFolderManifestPath(first.dataDir, "edited-outside"),
        command: "dash:node",
        args: ["agent.mjs"],
        cwd: agentFolderCodePath(first.dataDir, "edited-outside"),
      },
      ownership: {
        owner: "dash_handoff",
        display_name: "Edited Outside",
        summary: "For the test.",
        registered_at: "2026-08-09T10:00:00Z",
      },
      manifestJson: originalJson,
      storedManifestPath: agentFolderManifestPath(first.dataDir, "edited-outside"),
    });
    first.db.closeDb();

    writeFileSync(
      agentFolderManifestPath(first.dataDir, "edited-outside"),
      `${JSON.stringify(manifestFor("edited-outside", "Changed by an editor"), null, 2)}\n`,
      "utf8",
    );

    const second = await openStore(first.dataDir);
    const visible = second.store.readStore();
    // The accepted goal, not the folder's.
    expect(visible.agents["edited-outside"]?.manifest.agent.goal).toBe("Before");
    // And it is not reported as damage. `describeStoreDamage` renders every
    // folder issue as a store fault and tells the person to re-import; an
    // outside edit is neither a fault nor something re-importing would fix.
    expect(visible.unreadable.agent_folders).toBeUndefined();
  });
});

describe("accepting what an outside editor put in the folder", () => {
  it("moves the row and leaves the folder — including what the agent produced", async () => {
    /*
     * The reason `acceptFolderManifest` exists rather than a call to
     * `importManifest`. That door **writes the folder**: `writeAgentFolder`
     * stages a complete replacement and swaps it in, so anything not re-declared
     * in the call is gone afterwards — including `code/reports/`, which for the
     * sample agent is everything it has ever produced. Accepting a change to an
     * agent must not delete its work as a side effect.
     *
     * There is also nothing to write. The person's own editor already put the
     * bytes there; what was out of date is DASH's projection of them.
     */
    const first = await freshStore();
    expect(
      first.store.importManifest(manifestFor("accepted", "Before"), {
        files: [{ path: "agent.mjs", contents: "run()" }],
      }),
    ).toMatchObject({ ok: true });

    const avatarBefore = first.store.readAgentAvatar("accepted");
    const reports = path.join(agentFolderCodePath(first.dataDir, "accepted"), "reports");
    mkdirSync(reports, { recursive: true });
    writeFileSync(path.join(reports, "one.json"), "{}", "utf8");

    const edited = manifestFor("accepted", "Changed by an editor");
    const editedJson = `${JSON.stringify(edited, null, 2)}\n`;
    writeFileSync(agentFolderManifestPath(first.dataDir, "accepted"), editedJson, "utf8");

    expect(first.store.acceptFolderManifest("accepted", editedJson)).toMatchObject({
      ok: true,
      agent: "accepted",
    });

    expect(first.store.readStore().agents["accepted"]?.manifest.agent.goal).toBe(
      "Changed by an editor",
    );
    // The agent's own work, and its program, both still there.
    expect(existsSync(path.join(reports, "one.json"))).toBe(true);
    expect(
      existsSync(path.join(agentFolderCodePath(first.dataDir, "accepted"), "agent.mjs")),
    ).toBe(true);
    // MAR-500: the character survives, because the statement names two columns
    // and cannot reach `avatar`.
    expect(first.store.readAgentAvatar("accepted")).toBe(avatarBefore);
  });

  it("refuses an edit the schema rejects, and leaves the row alone", async () => {
    /*
     * MAR-584's third bullet, at the write rather than at the report. The gates
     * are `importManifest`'s own two — schema, then
     * `checkManifestConstraints` — so an edit that would have been refused at
     * the front door is refused here in the same words, and the version DASH
     * describes and checks against does not move.
     */
    const first = await freshStore();
    expect(first.store.importManifest(manifestFor("guarded-accept", "Before"))).toMatchObject({
      ok: true,
    });

    const broken = manifestFor("guarded-accept") as Record<string, unknown>;
    delete (broken["agent"] as Record<string, unknown>)["goal"];

    const refused = first.store.acceptFolderManifest(
      "guarded-accept",
      JSON.stringify(broken),
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok ? [] : refused.errors.join(" ")).toContain("goal");
    expect(first.store.readStore().agents["guarded-accept"]?.manifest.agent.goal).toBe("Before");
  });

  it("refuses a folder whose document now names a different agent", async () => {
    // Not an update to this agent — a different agent in this agent's folder.
    // Accepting it would leave a row keyed on one name holding a document naming
    // another, which is the disagreement `reconcileAgentFolders` refuses to
    // create for itself.
    const first = await freshStore();
    expect(first.store.importManifest(manifestFor("renamed-away"))).toMatchObject({ ok: true });

    const refused = first.store.acceptFolderManifest(
      "renamed-away",
      JSON.stringify(manifestFor("somebody-else")),
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok ? [] : refused.errors.join(" ")).toContain("different agent");
  });

  it("refuses text that is not readable JSON", async () => {
    const first = await freshStore();
    expect(first.store.importManifest(manifestFor("not-json-accept"))).toMatchObject({ ok: true });
    expect(first.store.acceptFolderManifest("not-json-accept", "{")).toMatchObject({ ok: false });
  });
});

describe("the per-file baseline MAR-584 compares against", () => {
  it("records where each declared file is stored, not where it was declared", async () => {
    /*
     * The reason `StoredFileDigest` exists beside `agentFolderFilesDigest`. A
     * project's `agent.mjs` and a project's `code/agent.mjs` are stored at the
     * same place, so the aggregate over *declared* paths cannot be recomputed
     * from a folder — and a detector that tried would report every file as
     * changed on any agent whose handoff declared root-level files.
     */
    const { storedFileDigests, storedRelativePath } = await import("../lib/agent-folders");

    expect(storedRelativePath("agent.mjs")).toBe("code/agent.mjs");
    expect(storedRelativePath("code/agent.mjs")).toBe("code/agent.mjs");
    expect(storedRelativePath("assets/logo.png")).toBe("assets/logo.png");
    // Null, not the manifest's own name: it is validated, compared and digested
    // separately, and a baseline that listed it would report a document edit as
    // two changes.
    expect(storedRelativePath(AGENT_MANIFEST_FILE)).toBeNull();

    const digests = storedFileDigests([
      { path: "sources.json", contents: "{}" },
      { path: AGENT_MANIFEST_FILE, contents: "{}" },
      { path: "agent.mjs", contents: "run()" },
    ]);
    expect(digests.map((file) => file.path)).toEqual(["code/agent.mjs", "code/sources.json"]);
    // Same bytes, same digest, whichever path they were declared under.
    expect(digests[1]?.sha256).toBe(
      storedFileDigests([{ path: "code/sources.json", contents: "{}" }])[0]?.sha256,
    );
  });

  it("reads only the recorded paths, so an agent's own output is not an edit", async () => {
    /*
     * The load-bearing decision of the detector. The sample agent writes its
     * digests into `code/reports/` and its event log into `code/runs/`, both
     * inside the folder a walk would enumerate — so a walk would report an
     * agent's own work as somebody's edit, on the flagship agent, every check.
     */
    const { readStoredFile, readStoredFileDigests, storedFileDigests } = await import(
      "../lib/agent-folders"
    );
    const first = await freshStore();
    expect(
      first.store.importManifest(manifestFor("watched"), {
        files: [
          { path: "agent.mjs", contents: "run()" },
          { path: "sources.json", contents: '{"sources":[]}' },
        ],
      }),
    ).toMatchObject({ ok: true });

    const baseline = storedFileDigests([
      { path: "agent.mjs", contents: "run()" },
      { path: "sources.json", contents: '{"sources":[]}' },
    ]);
    const paths = baseline.map((file) => file.path);

    // The agent runs and writes into its own folder.
    mkdirSync(path.join(agentFolderCodePath(first.dataDir, "watched"), "reports"), {
      recursive: true,
    });
    writeFileSync(
      path.join(agentFolderCodePath(first.dataDir, "watched"), "reports", "one.json"),
      "{}",
      "utf8",
    );
    expect(readStoredFileDigests(first.dataDir, "watched", paths)).toEqual(baseline);

    // Then an editor changes one declared file, and deletes another.
    writeFileSync(
      path.join(agentFolderCodePath(first.dataDir, "watched"), "sources.json"),
      '{"sources":[{"name":"Ars Technica","url":"https://example.com","format":"rss"}]}',
      "utf8",
    );
    rmSync(path.join(agentFolderCodePath(first.dataDir, "watched"), "agent.mjs"));

    const after = readStoredFileDigests(first.dataDir, "watched", paths);
    expect(after[0]).toEqual({ path: "code/agent.mjs", sha256: null, problem: "missing" });
    expect(after[1]?.sha256).not.toBe(baseline[1]?.sha256);

    // And the contents reader is the same door, so a caller that wants text does
    // not grow its own `path.join` beside a `readFileSync`.
    expect(readStoredFile(first.dataDir, "watched", "code/sources.json")).toMatchObject({
      ok: true,
    });
    expect(readStoredFile(first.dataDir, "watched", "code/agent.mjs")).toEqual({
      ok: false,
      problem: "missing",
    });
  });

  it("refuses a recorded path that would leave the folder", async () => {
    // A baseline naming something outside the agent's folder can only come from
    // a damaged or hand-edited registration. The answer is the same as for a
    // deleted file — it says so — and never a read.
    const { readStoredFile } = await import("../lib/agent-folders");
    const first = await freshStore();
    expect(first.store.importManifest(manifestFor("guarded"))).toMatchObject({ ok: true });
    expect(readStoredFile(first.dataDir, "guarded", "../../secrets.txt")).toEqual({
      ok: false,
      problem: "unreadable",
    });
  });

  it("reduces a file set to one digest, stably and only when there is a set", async () => {
    /*
     * ADR 0010's deploy record and this baseline have to be comparable, and
     * before `storedDigestSummary` there was no way to compare them: one is
     * hashed over declared handoff paths and the other names files under
     * `agent/`. Both sides now reduce through this one function over the same
     * path space, which is the only reason "the copy DASH sent is not the copy
     * this agent is now" is a checkable claim.
     */
    const { storedDigestSummary } = await import("../lib/agent-folders");
    const a = { path: "code/agent.mjs", sha256: "aaa" };
    const b = { path: "code/sources.json", sha256: "bbb" };

    expect(storedDigestSummary([a, b])).toBe(storedDigestSummary([b, a]));
    expect(storedDigestSummary([a])).not.toBe(storedDigestSummary([a, b]));
    // Null rather than the digest of nothing: an empty set is *not comparable*,
    // and every caller treats it that way rather than as a match.
    expect(storedDigestSummary([])).toBeNull();
  });
});
