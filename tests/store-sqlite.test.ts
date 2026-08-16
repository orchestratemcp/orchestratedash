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

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    // artifacts, 4 is MAR-464's decision-identity columns, 5 is MAR-458's
    // permission broker, 6 is MAR-467's lapse table and delivery column, 7 is
    // MAR-434's projection of the runner's file-backed artifacts, 8 is MAR-500's
    // avatar column and its backfill, 9 is MAR-488's record of DASH's own
    // reading, 10 is MAR-553's manifest-only agent-folder materialisation
    // (kept at that index at merge time — installed databases had already
    // recorded it), 11 is MAR-536's saved hosts, 12 is MAR-582's record of
    // what a model provider last said about a key DASH holds, and 13 is
    // MAR-586's record of when the reader last opened an agent's page —
    // authored as 12, renumbered at the merge because MAR-582 reached master
    // first and installed databases had already recorded it — and 14 is
    // MAR-584's record of what DASH sent to which server (ADR 0010), and 15 is
    // MAR-583's three tables for which model an agent uses, and 16 is
    // MAR-588's record of where DASH posts when an agent needs somebody -- a
    // masked hint and two switches, with no column an address could go in —
    // authored as 15, renumbered at the merge because MAR-583 reached master
    // first and installed databases had already recorded it, and 18 is
    // MAR-593's two fleet tables (ADR 0013) — a connection that exists before
    // any agent does, and the per-agent decisions somebody made about it, and
    // 19 is MAR-589's `display_name` column — a name DASH itself owns,
    // separate from the author's own.
    // Asserted as a number rather than as MIGRATIONS.length so that appending a
    // migration is a deliberate edit here too. 21 is MAR-611's second date on
    // `agent_deploys` (ADR 0017) -- the first step in this list written as a
    // function purely so it can be re-applied, because the two tests below
    // rewind `user_version` to 10 and every later step runs again.
    //
    // It is 21 rather than the 20 this branch was written against because
    // MAR-589's `display_name` column reached master mid-flight. That step keeps
    // the index it shipped with and this one moved to the end of the list, which
    // is the only order that leaves an already-migrated installed store alone --
    // renumbering a step somebody's database has already recorded is the one
    // thing this pin exists to make somebody think about.
    //
    // 22 is MAR-640's `agent_prefs` table — the reader's own favourite flag,
    // kept apart from `agents` for `agent_looks`' own reason.
    //
    // 23 is MAR-642's `fleet_model_default`, appended for that same reason: it
    // is a new step and it goes last (MAR-640 reached master first and holds
    // 22), so an installed store that has already recorded steps 0 to 22 runs
    // exactly one more.
    //
    // 24 is MAR-659's `chief_messages` (ADR 0023 decision 6) — the chief's own
    // transcript with its receipt frozen beside each turn. Appended last for the
    // same reason every step since 21 has been: an installed store that has
    // already recorded 0 to 23 runs exactly one more, and renumbering a step
    // somebody's database has recorded is the one thing this pin exists to make
    // somebody think about.
    const version = handle.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(version.user_version).toBe(24);

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
    expect(tables).toContain("broker_grants");
    expect(tables).toContain("broker_audit");
    expect(tables).toContain("workspace_artifacts");
    // MAR-588. Named here beside the rest so that "which tables exist" stays a
    // list somebody reads rather than one the schema reports about itself.
    expect(tables).toContain("notify_discord");
    expect(tables).toContain("evidence_pulls");
    expect(tables).toContain("hosts");
    expect(tables).toContain("ai_key_checks");
    expect(tables).toContain("agent_looks");
    // MAR-640. The reader's own favourite flag, one row per agent.
    expect(tables).toContain("agent_prefs");
    // MAR-584, ADR 0010. What DASH sent to a server, and never what is running
    // there — the ADR bounds the columns, and the migration's own note says why
    // there is no `running` column for a later feature to reach for.
    expect(tables).toContain("agent_deploys");
    // MAR-583. Three, and every one of them empty for an agent nobody has
    // configured — the recommended setting needs no row to be in force. None of
    // them has a cost column, and the condition for one existing anywhere was
    // "numbers that came from a provider rather than from DASH's own
    // arithmetic". MAR-545 met it: `agent_questions.amount_usd` below is filled
    // only from a figure a provider stated in the reply it charged for, and
    // these three are still without one.
    expect(tables).toContain("agent_model_choice");
    expect(tables).toContain("agent_step_levels");
    expect(tables).toContain("run_models");
    // MAR-545. The conversation, and the one table in DASH that holds money.
    expect(tables).toContain("agent_questions");
    // MAR-593, ADR 0013. The first connection tables in this list that are not
    // keyed by agent: one row per service the person connected, and one row per
    // decision they made about which agent may use it. `connection_secrets`
    // above is untouched and still means what it always did.
    expect(tables).toContain("fleet_connections");
    expect(tables).toContain("fleet_grants");
    // MAR-642. One row, holding the model DASH gives an agent nobody has given
    // one. Beside the fleet tables above because it is the same kind of fact —
    // a decision the person made about their whole DASH rather than about one
    // agent — and, like `agent_model_choice`, it has no cost column and no
    // column a key could go in.
    expect(tables).toContain("fleet_model_default");
    // MAR-659, ADR 0023 decision 6. The chief's own transcript, and the second
    // conversation table in this list. It is not keyed by agent and cannot be:
    // the fleet room and an agent's room are two threads with nothing shared,
    // because `{ kind: "chief" }` carries no agent id to key one by.
    expect(tables).toContain("chief_messages");
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
    // And migration 5 (MAR-458), for the same reason, and 6 (MAR-467) and
    // 7 (MAR-434).
    first.db.db().exec("DROP TABLE broker_audit");
    first.db.db().exec("DROP TABLE broker_grants");
    first.db.db().exec("DROP TABLE broker_lapses");
    first.db.db().exec("DROP TABLE workspace_artifacts");
    // And migration 8 (MAR-500), whose step is an ALTER rather than a
    // CREATE: re-running it against a column that is still there fails on
    // the duplicate rather than on anything this test is about.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN avatar");
    // And migration 19 (MAR-589), the same reason exactly.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN display_name");
    // And migration 9 (MAR-488), DASH's record of its own reading.
    first.db.db().exec("DROP TABLE evidence_pulls");
    // And migration 10 (MAR-536), saved servers.
    first.db.db().exec("DROP TABLE hosts");
    // And migration 12 (MAR-582), what a model provider last said about a key.
    first.db.db().exec("DROP TABLE ai_key_checks");
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
    first.db.db().exec("DROP TABLE workspace_artifacts");
    // And migration 8 (MAR-500), whose step is an ALTER rather than a
    // CREATE: re-running it against a column that is still there fails on
    // the duplicate rather than on anything this test is about.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN avatar");
    // And migration 19 (MAR-589), the same reason exactly.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN display_name");
    // And migration 9 (MAR-488), DASH's record of its own reading.
    first.db.db().exec("DROP TABLE evidence_pulls");
    first.db.db().exec("ALTER TABLE agent_dom_state DROP COLUMN runner_observed_at");
    first.db.db().exec("ALTER TABLE agent_dom_state DROP COLUMN decision_identity");
    first.db.db().exec("DROP TABLE broker_audit");
    first.db.db().exec("DROP TABLE broker_grants");
    first.db.db().exec("DROP TABLE broker_lapses");
    first.db.db().exec("DROP TABLE hosts");
    // And migration 12 (MAR-582), what a model provider last said about a key.
    first.db.db().exec("DROP TABLE ai_key_checks");
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

  it("adds the broker tables to a store that predates them", async () => {
    /*
     * MAR-458, in the same shape as the two cases above and for the same
     * reason: every installed DASH is a store that was created before the
     * permission broker existed, and a migration only ever run against a fresh
     * directory is one nobody has tested where it matters.
     *
     * The manifest row has to survive. A user who upgrades into the broker must
     * not find their agents gone.
     */
    const first = await freshStore();
    first.store.importManifest(manifest);
    first.db.db().exec("PRAGMA user_version = 5");
    first.db.db().exec("DROP TABLE workspace_artifacts");
    // And migration 8 (MAR-500), whose step is an ALTER rather than a
    // CREATE: re-running it against a column that is still there fails on
    // the duplicate rather than on anything this test is about.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN avatar");
    // And migration 19 (MAR-589), the same reason exactly.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN display_name");
    // And migration 9 (MAR-488), DASH's record of its own reading.
    first.db.db().exec("DROP TABLE evidence_pulls");
    first.db.db().exec("DROP TABLE broker_audit");
    first.db.db().exec("DROP TABLE broker_grants");
    // And migration 6 (MAR-467), which builds on migration 5's broker_audit and
    // would otherwise fail creating a table that is still there.
    first.db.db().exec("DROP TABLE broker_lapses");
    first.db.db().exec("DROP TABLE hosts");
    // And migration 12 (MAR-582), what a model provider last said about a key.
    first.db.db().exec("DROP TABLE ai_key_checks");
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
    expect(tables).toContain("broker_grants");
    expect(tables).toContain("broker_audit");
    expect(store.listAgents()).toHaveLength(1);
  });

  it("adds the lapse table and the delivery column to a store that predates them", async () => {
    // MAR-467, in the shape the three cases above use. The store every user
    // already has was created before this existed.
    const first = await freshStore();
    first.store.importManifest(manifest);
    first.db.db().exec("PRAGMA user_version = 6");
    first.db.db().exec("DROP TABLE workspace_artifacts");
    // And migration 8 (MAR-500), whose step is an ALTER rather than a
    // CREATE: re-running it against a column that is still there fails on
    // the duplicate rather than on anything this test is about.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN avatar");
    // And migration 19 (MAR-589), the same reason exactly.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN display_name");
    // And migration 9 (MAR-488), DASH's record of its own reading.
    first.db.db().exec("DROP TABLE evidence_pulls");
    first.db.db().exec("DROP TABLE broker_lapses");
    first.db.db().exec("ALTER TABLE broker_audit DROP COLUMN delivered");
    first.db.db().exec("DROP TABLE hosts");
    // And migration 12 (MAR-582), what a model provider last said about a key.
    first.db.db().exec("DROP TABLE ai_key_checks");
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
    expect(tables).toContain("broker_lapses");

    const auditColumns = db
      .db()
      .prepare("PRAGMA table_info(broker_audit)")
      .all()
      .map((row) => String(row["name"]));
    expect(auditColumns).toContain("delivered");
    expect(store.listAgents()).toHaveLength(1);
  });

  it("adds the workspace artifact projection to a store that predates it", async () => {
    // MAR-434, in the shape the four cases above use. Every existing
    // installation's store was created before this table existed, and the
    // issue's criterion is that "closing and reopening DASH preserves the task,
    // output index, approvals, and recovery state" — which starts with the
    // upgrade working at all.
    const first = await freshStore();
    first.store.importManifest(manifest);
    first.db.db().exec("PRAGMA user_version = 7");
    first.db.db().exec("DROP TABLE workspace_artifacts");
    // And migration 8 (MAR-500), whose step is an ALTER rather than a
    // CREATE: re-running it against a column that is still there fails on
    // the duplicate rather than on anything this test is about.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN avatar");
    // And migration 19 (MAR-589), the same reason exactly.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN display_name");
    // And migration 9 (MAR-488), DASH's record of its own reading.
    first.db.db().exec("DROP TABLE evidence_pulls");
    first.db.db().exec("DROP TABLE hosts");
    // And migration 12 (MAR-582), what a model provider last said about a key.
    first.db.db().exec("DROP TABLE ai_key_checks");
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
    expect(tables).toContain("workspace_artifacts");
    expect(store.listAgents()).toHaveLength(1);
  });

  /**
   * `workspace_artifacts` holds metadata about files, and holds no file.
   *
   * The bytes live in the runner's data directory under an opaque name the
   * child was never told. That is what makes a recorded SHA-256 still true
   * later — see `runner/workspace.ts` — and it survives only as long as nothing
   * adds a body, a blob or a path column here for the convenience of a renderer.
   *
   * A `stored_path` column in particular would undo the boundary quietly: DASH
   * would then hold a filesystem path to every output, a view model would carry
   * it, and a page would print it. This test failing is the intended
   * conversation.
   */
  it("gives workspace_artifacts no column that could carry a file or a path", async () => {
    const { db } = await freshStore();
    const columns = db
      .db()
      .prepare("PRAGMA table_info(workspace_artifacts)")
      .all()
      .map((row) => String(row["name"]));

    expect(columns).toEqual([
      "artifact_id",
      "agent",
      "run_id",
      "task_id",
      "role",
      "display_name",
      "media_type",
      "byte_size",
      "sha256",
      "registered_at",
      "retention",
      "availability",
      "availability_detail",
      "observed_at",
    ]);
  });

  /**
   * MAR-536. The table names a key by the stable name main resolves, never by
   * path and never by its contents. This is the storage half of the same
   * private-key boundary `tests/shell.test.ts` pins at the IPC edge.
   */
  it("stores host connection facts but no private key or key path", async () => {
    const { db } = await freshStore();
    const columns = db
      .db()
      .prepare("PRAGMA table_info(hosts)")
      .all()
      .map((row) => String(row["name"]));

    expect(columns).toEqual([
      "host_id",
      "label",
      "address",
      "port",
      "username",
      "key_name",
      "host_fingerprint",
      "added_at",
    ]);
    for (const forbidden of ["private_key", "key_path", "path", "public_key", "channel_secret"]) {
      expect(columns, `hosts must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  /**
   * The structural half of ADR 0005, enforced rather than described.
   *
   * `broker_lapses` holds facts about requests DASH did *not* adjudicate. The
   * argument for why that is safe to show a user next to the audit trail rests
   * entirely on the two being impossible to confuse — so the table is built
   * without any of the columns an adjudication has, and this is the test that
   * keeps a later, well-meaning migration from adding one.
   *
   * If a future feature genuinely needs an operation name on a lapse, this test
   * failing is the intended conversation: it means the runner has started
   * parsing agent-authored request bodies, which is a decision for an ADR and
   * not for a migration.
   */
  it("gives broker_lapses no column that could pass for an audited decision", async () => {
    const { db } = await freshStore();
    const columns = db
      .db()
      .prepare("PRAGMA table_info(broker_lapses)")
      .all()
      .map((row) => String(row["name"]));

    expect(columns).toEqual([
      "id",
      "kind",
      "agent",
      "attempts",
      "from_at",
      "until_at",
      "observed_by",
    ]);
    for (const forbidden of [
      "decision",
      "refusal",
      "operation",
      "connection_id",
      "request_id",
      "result_count",
      "account_hint",
    ]) {
      expect(columns, `broker_lapses must not carry ${forbidden}`).not.toContain(forbidden);
    }
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
    ).toBe(24);
  });

  it("materialises row-only agents as manifest-only folders without acquiring author code", async () => {
    const first = await freshStore();
    const agent = String((manifest["agent"] as { name: string }).name);
    expect(first.store.importManifest(manifest)).toMatchObject({ ok: true });

    // Re-create the standing every installed pre-MAR-553 store has: the row and
    // a runner registration point at an author-owned project, with no DASH copy.
    rmSync(path.join(first.dataDir, "agents", agent), { recursive: true, force: true });
    const authorProject = path.join(first.dataDir, "author-project");
    mkdirSync(authorProject, { recursive: true });
    const authorCode = path.join(authorProject, "agent.mjs");
    writeFileSync(authorCode, "// author-owned and not migration input\n", "utf8");
    const registrationFile = path.join(first.dataDir, "agents", `${agent}.json`);
    const oldRegistration = {
      agent_id: agent,
      manifest_path: path.join(authorProject, "agent.manifest.json"),
      command: "node",
      args: ["agent.mjs"],
      cwd: authorProject,
    };
    writeFileSync(registrationFile, JSON.stringify(oldRegistration), "utf8");
    first.db.db().exec("PRAGMA user_version = 10");
    // Migration 12 (MAR-582) ran when this store was created, so it goes back
    // too — re-running it against the table it already made would fail on the
    // duplicate rather than on anything this test is about.
    first.db.db().exec("DROP TABLE ai_key_checks");
    // And migration 19 (MAR-589), for the same reason.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN display_name");
    first.db.closeDb();

    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const db = await import("../lib/db");
    const store = await import("../lib/store");
    opened.push({ dataDir: first.dataDir, closeDb: db.closeDb });

    expect(store.listAgentNames()).toContain(agent);
    expect(readdirSync(path.join(first.dataDir, "agents", agent)).sort()).toEqual([
      "agent.manifest.json",
    ]);
    expect(readFileSync(authorCode, "utf8")).toBe("// author-owned and not migration input\n");
    expect(JSON.parse(readFileSync(registrationFile, "utf8"))).toEqual(oldRegistration);
    expect(db.describeAgentFolderMigration()).toMatchObject({
      materialized_agents: [agent],
      skipped_agents: [],
      unreadable_rows: 0,
    });
  });

  it("reports but preserves a legacy row whose name cannot be a folder", async () => {
    const first = await freshStore();
    const legacy = structuredClone(manifest);
    (legacy["agent"] as { name: string }).name = "con";
    first.db
      .db()
      .prepare(
        "INSERT INTO agents (name, manifest_version, manifest_json, imported_at, avatar) " +
          "VALUES (?, ?, ?, ?, ?)",
      )
      .run("con", Number(legacy["manifest_version"]), JSON.stringify(legacy), new Date().toISOString(), null);
    first.db.db().exec("PRAGMA user_version = 10");
    // Migration 12 (MAR-582) ran when this store was created, so it goes back
    // too — re-running it against the table it already made would fail on the
    // duplicate rather than on anything this test is about.
    first.db.db().exec("DROP TABLE ai_key_checks");
    // And migration 19 (MAR-589), for the same reason.
    first.db.db().exec("ALTER TABLE agents DROP COLUMN display_name");
    first.db.closeDb();

    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const db = await import("../lib/db");
    const store = await import("../lib/store");
    opened.push({ dataDir: first.dataDir, closeDb: db.closeDb });

    expect(store.listAgentNames()).toContain("con");
    expect(existsSync(path.join(first.dataDir, "agents", "con"))).toBe(false);
    expect(db.describeAgentFolderMigration()?.skipped_agents).toEqual([
      {
        name: "con",
        errors: [expect.stringContaining("safe folder component")],
      },
    ]);
    expect(store.readStore().unreadable.agent_folders).toBeUndefined();
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
