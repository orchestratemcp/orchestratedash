/**
 * The storage engine itself: schema, transactions, and the one-way trip from
 * `.data/dash.json`.
 *
 * `tests/store.test.ts` is the behavioural suite and is deliberately unchanged
 * by MAR-416 — it passing against SQLite is the evidence that the swap was a
 * storage change and not a behaviour change. This file covers what is new: that
 * the schema is versioned, that a batch is atomic, and that a user with an
 * existing JSON store neither loses it nor gets it imported twice.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

const manifest = example("agent.manifest.example.json");
const runEvent = example("run-event.example.json");
const workspaceState = example("gmail-meeting-assistant.state.example.json");

/**
 * Both modules resolve the data directory once, at import time. Every scenario
 * here needs its own directory *and* its own module instance, so each one gets
 * a fresh module graph rather than trying to reset state inside a shared one.
 */
const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(seed?: (dataDir: string) => void): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  store: typeof import("../lib/store");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-sqlite-"));
  seed?.(dataDir);

  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  const store = await import("../lib/store");

  opened.push({ dataDir, closeDb: db.closeDb });
  return { dataDir, db, store };
}

afterEach(() => {
  const entries = opened.splice(0);
  // Every handle first, then the directories. The restart cases open a second
  // module instance over the same directory, and Windows will not remove a
  // directory while any handle in it is still open.
  for (const { closeDb } of entries) {
    closeDb();
  }
  for (const dataDir of new Set(entries.map((entry) => entry.dataDir))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("schema", () => {
  it("creates the versioned schema on first open", async () => {
    const { db } = await freshStore();
    const handle = db.db();

    // One per shipped migration: 0 is the MAR-416 store, 1 is MAR-417's
    // command channel, 2 is MAR-428's handoff ledger, 3 is MAR-457's run
    // artifacts, 4 is MAR-464's decision-identity columns. Asserted as a number
    // rather than as MIGRATIONS.length so that appending a migration is a
    // deliberate edit here too.
    const version = handle.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(version.user_version).toBe(5);

    const tables = handle
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row["name"]));
    expect(tables).toContain("agents");
    expect(tables).toContain("events");
    expect(tables).toContain("runs");
    expect(tables).toContain("connection_secrets");
    expect(tables).toContain("store_meta");
    expect(tables).toContain("agent_dom_state");
    expect(tables).toContain("command_nonces");
    expect(tables).toContain("command_results");
    expect(tables).toContain("command_audit");
    expect(tables).toContain("agent_handoffs");
    expect(tables).toContain("run_artifacts");
  });

  it("adds the artifact table to a store that predates it", async () => {
    // The case every user with an installed DASH is in. A migration that only
    // ever runs against a fresh directory is a migration nobody has tested on
    // the one store that matters, so this opens at the previous version, then
    // reopens and expects the new table without the old rows moving.
    const first = await freshStore();
    first.store.importManifest(manifest);
    first.db.db().exec("PRAGMA user_version = 3");
    first.db.db().exec("DROP TABLE run_artifacts");
    // Migration 4 ran when this store was created, so its columns have to go
    // back too or re-running it fails on a duplicate column rather than on
    // anything this test is about.
    first.db.db().exec("ALTER TABLE agent_dom_state DROP COLUMN runner_observed_at");
    first.db.db().exec("ALTER TABLE agent_dom_state DROP COLUMN decision_identity");
    first.db.closeDb();

    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const db = await import("../lib/db");
    const store = await import("../lib/store");
    opened.push({ dataDir: first.dataDir, closeDb: db.closeDb });

    const tables = db
      .db()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row["name"]));
    expect(tables).toContain("run_artifacts");
    expect(store.listAgents()).toHaveLength(1);
  });

  it("adds the decision-identity columns to a store that predates them", async () => {
    /*
     * The MAR-464 half of the case above, and the one every installed DASH is
     * in: a store whose `agent_dom_state` row was written before `observed_at`
     * was allowed to stand still. The row must survive, and it must keep
     * answering commands — a null `decision_identity` means "unknown", so the
     * next snapshot counts as a change rather than being silently treated as
     * identical to whatever is already there.
     */
    const first = await freshStore();
    const agentDom = await import("../lib/agent-dom/store");
    expect(agentDom.putAgentDomState(workspaceState).ok).toBe(true);
    first.db.db().exec("PRAGMA user_version = 4");
    first.db.db().exec("ALTER TABLE agent_dom_state DROP COLUMN runner_observed_at");
    first.db.db().exec("ALTER TABLE agent_dom_state DROP COLUMN decision_identity");
    first.db.closeDb();

    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const db = await import("../lib/db");
    const migrated = await import("../lib/agent-dom/store");
    opened.push({ dataDir: first.dataDir, closeDb: db.closeDb });

    const snapshot = migrated.readAgentDomState(String(workspaceState["agent_id"]));
    expect(snapshot).not.toBeNull();
    // Backfilled from the value the row already held, which is exactly what it
    // meant before the freeze existed.
    expect(snapshot?.runner_observed_at).toBe(snapshot?.observed_at);
    expect(snapshot?.decision_identity).toBeNull();
  });

  it("uses WAL journalling, which is what replaces write-then-rename", async () => {
    const { db } = await freshStore();
    const mode = db.db().prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(mode.journal_mode).toBe("wal");
  });

  it("re-opening an existing database does not re-run migrations", async () => {
    const first = await freshStore();
    first.store.importManifest(manifest);
    first.db.closeDb();

    // Same directory, fresh module graph: the restart case.
    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const store = await import("../lib/store");
    const db = await import("../lib/db");
    opened.push({ dataDir: first.dataDir, closeDb: db.closeDb });

    expect(store.listAgents()).toHaveLength(1);
    expect(
      (db.db().prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    ).toBe(5);
  });

  it("preserves pending tasks and approvals across a DASH restart", async () => {
    const first = await freshStore();
    const agentDom = await import("../lib/agent-dom/store");
    expect(agentDom.putAgentDomState(workspaceState).ok).toBe(true);
    first.db.closeDb();

    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const reopenedDb = await import("../lib/db");
    const reopenedAgentDom = await import("../lib/agent-dom/store");
    opened.push({ dataDir: first.dataDir, closeDb: reopenedDb.closeDb });

    const snapshot = reopenedAgentDom.readAgentDomState(
      "synthetic-gmail-meeting-assistant",
    );
    expect(snapshot?.state.tasks?.[0]).toMatchObject({
      id: "task-meeting-01",
      status: "waiting_for_approval",
    });
    expect(snapshot?.state.approval_requests?.[0]).toMatchObject({
      id: "approval-meeting-01",
      status: "pending",
      runner_enforced: true,
    });
  });

  /**
   * The `runs` table is an identity anchor for DASH-13 and DASH-15, and the
   * foreign key is what makes it one: an ingest path that forgot to record the
   * run would fail loudly rather than orphan the events.
   */
  it("anchors every event to a run row", async () => {
    const { db, store } = await freshStore();
    store.ingestEvents(runEvent);

    const runs = db.db().prepare("SELECT agent, run_id FROM runs").all();
    expect(runs).toHaveLength(1);

    expect(() =>
      db
        .db()
        .prepare(
          "INSERT INTO events (agent, run_id, seq, ts, type, event_json, received_at) " +
            "VALUES ('ghost', 'no-such-run', 0, '2026-07-04T09:15:00Z', 'run_started', '{}', '2026-07-04T09:15:00Z')",
        )
        .run(),
    ).toThrow();
  });
});

describe("transactions", () => {
  /**
   * The crash-safety property, restated for SQLite. The JSON store rewrote the
   * whole document on every ingest and relied on write-then-rename; a batch is
   * now a single commit, so a failure part way through leaves none of it rather
   * than some of it.
   */
  it("commits a batch atomically", async () => {
    const { db, store } = await freshStore();
    const base = { event_version: 1, agent: "email-lead-to-crm", run_id: "run-1" };

    store.ingestEvents([
      { ...base, seq: 0, ts: "2026-07-04T09:15:00Z", type: "run_started" },
      { ...base, seq: 1, ts: "2026-07-04T09:15:05Z", type: "step_started" },
      { ...base, seq: 2, ts: "2026-07-04T09:15:10Z", type: "run_completed" },
    ]);

    const count = db.db().prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number };
    expect(Number(count.n)).toBe(3);
  });

  it("rolls back and leaves the store untouched when the work throws", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);

    const handle = db.db();
    expect(() =>
      db.transact(handle, () => {
        handle.prepare("DELETE FROM agents").run();
        throw new Error("something failed half way");
      }),
    ).toThrow("something failed half way");

    expect(store.listAgents()).toHaveLength(1);
  });
});

describe("migrating an existing dash.json", () => {
  const legacy = {
    agents: {
      "email-lead-to-crm": { manifest, imported_at: "2026-07-01T10:00:00Z" },
    },
    events: [runEvent],
  };

  function seedLegacy(contents: unknown): (dataDir: string) => void {
    return (dataDir) => {
      writeFileSync(
        path.join(dataDir, "dash.json"),
        `${JSON.stringify(contents, null, 2)}\n`,
        "utf8",
      );
    };
  }

  it("imports agents and events on first run", async () => {
    const { store } = await freshStore(seedLegacy(legacy));

    const agents = store.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "email-lead-to-crm",
      // Carried across, not reset to migration time: the user imported this
      // agent when they imported it.
      imported_at: "2026-07-01T10:00:00Z",
    });
    expect(store.listRuns()).toHaveLength(1);
  });

  /**
   * The downgrade guarantee. A user who installs a build that predates SQLite
   * must find their store exactly where they left it.
   */
  it("leaves the original file untouched", async () => {
    const { dataDir } = await freshStore(seedLegacy(legacy));

    const stillThere = path.join(dataDir, "dash.json");
    expect(existsSync(stillThere)).toBe(true);
    expect(JSON.parse(readFileSync(stillThere, "utf8"))).toEqual(legacy);
  });

  it("does not import a second time on the next launch", async () => {
    const first = await freshStore(seedLegacy(legacy));
    // A manifest imported after migration, which a re-run would duplicate or
    // clobber if the marker were not honoured.
    first.store.importManifest({ ...manifest, agent: { ...(manifest["agent"] as object), name: "later-agent" } });
    first.db.closeDb();

    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const db = await import("../lib/db");
    const store = await import("../lib/store");
    opened.push({ dataDir: first.dataDir, closeDb: db.closeDb });

    expect(store.listAgents().map((agent) => agent.name).sort()).toEqual([
      "email-lead-to-crm",
      "later-agent",
    ]);
    expect(store.readStore().events).toHaveLength(1);
  });

  it("records what it did, in a form safe to log", async () => {
    const { db } = await freshStore(seedLegacy(legacy));
    expect(db.describeLegacyImport()).toMatchObject({
      found: true,
      agents: 1,
      events: 1,
      skipped_agents: [],
      skipped_events: 0,
    });
  });

  /**
   * The JSON store only ever wrote validated documents, so this should be
   * unreachable — which is exactly why it is recorded rather than assumed. A
   * store that quietly drops an agent is worse than one that says which.
   */
  it("skips and records a manifest that no longer validates", async () => {
    const { db, store } = await freshStore(
      seedLegacy({
        agents: {
          good: { manifest, imported_at: "2026-07-01T10:00:00Z" },
          broken: { manifest: { manifest_version: 1 }, imported_at: "2026-07-01T10:00:00Z" },
        },
        events: [runEvent, { event_version: 1 }],
      }),
    );

    expect(store.listAgents()).toHaveLength(1);
    const record = db.describeLegacyImport();
    expect(record).toMatchObject({ agents: 1, events: 1, skipped_events: 1 });
    expect(record?.skipped_agents[0]?.name).toBe("broken");
    expect(record?.skipped_agents[0]?.errors.length).toBeGreaterThan(0);
  });

  it("starts empty and records the reason when the file cannot be parsed", async () => {
    const { db, store } = await freshStore((dataDir) => {
      writeFileSync(path.join(dataDir, "dash.json"), "{ this is not json", "utf8");
    });

    expect(store.listAgents()).toEqual([]);
    expect(db.describeLegacyImport()?.failure).toBeTruthy();
  });

  it("records nothing at all when there is no file to migrate", async () => {
    const { db } = await freshStore();
    expect(db.describeLegacyImport()).toBeNull();
  });
});
