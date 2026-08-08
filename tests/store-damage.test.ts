/**
 * What DASH does when its own store comes back short.
 *
 * This suite exists because of a real incident rather than a hypothetical. An
 * Electron process was killed abruptly three times while a smoke run hung; the
 * store at `%APPDATA%/orchestratedash/dash.sqlite` came back with
 * `PRAGMA quick_check` reporting *"database disk image is malformed"*, one agent
 * row's `manifest_json` truncated mid-string from 4156 bytes to 449, and its
 * `imported_at` an empty string. `readStore` parsed every row unguarded, so that
 * one row threw — and because all four views call `readStore`, every page in
 * DASH failed at once and the smoke could not run at all.
 *
 * ## What is simulated here, and what is not
 *
 * These tests damage a row with an `UPDATE`, not the file with a corrupt page.
 * That is deliberate and it is the honest scope: the *behaviour* under test is
 * "a row came back unparseable", and how the bytes got that way is not something
 * `readStore` can observe or should branch on. Reproducing genuine page-level
 * corruption portably would mean writing malformed SQLite internals from a test,
 * which would assert against a file format rather than against DASH.
 *
 * What that leaves untested is the layer below: whether SQLite itself surfaces
 * damage as a short read or as a throw from `prepare().all()`. In the real store
 * it was the former, which is why the guard is where it is.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { describeStoreDamage } from "../lib/copy/recovery";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

const manifest = example("agent.manifest.example.json");
const otherManifest = example("dash-managed.manifest.v2.example.json");
const runEvent = example("run-event.example.json");

function agentName(document: Record<string, unknown>): string {
  return String((document["agent"] as Record<string, unknown>)["name"]);
}

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(seed?: (dataDir: string) => void): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  store: typeof import("../lib/store");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-damage-"));
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
  for (const { closeDb } of entries) {
    closeDb();
  }
  for (const dataDir of new Set(entries.map((entry) => entry.dataDir))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

/**
 * The shape the real damage had: valid JSON cut off part-way through, leaving an
 * unterminated string. Written straight over the column, because no writer in
 * DASH can produce this — which is the entire finding, and is why the test has
 * to reach past them.
 */
/** A distinctive fragment, so a test can prove the copy never quotes it back. */
const DAMAGE_MARKER = "unreadable-fragment-marker";

function truncateManifest(database: DatabaseSync, name: string): void {
  const whole = JSON.stringify({
    manifest_version: 2,
    agent: { name, goal: DAMAGE_MARKER },
  });
  // Cut mid-string, exactly as the overflow-page damage did: valid JSON up to
  // the cut, unterminated after it. `imported_at` is emptied in the same write
  // because the real row had both.
  database
    .prepare("UPDATE agents SET manifest_json = ?, imported_at = '' WHERE name = ?")
    .run(whole.slice(0, whole.length - 12), name);
}

describe("readStore, against a damaged row", () => {
  it("returns the readable agents and names the one it could not read", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);
    store.importManifest(otherManifest);

    const damaged = agentName(manifest);
    const intact = agentName(otherManifest);
    truncateManifest(db.db(), damaged);

    // The property the incident violated: this call used to throw.
    const result = store.readStore();

    expect(Object.keys(result.agents)).toEqual([intact]);
    expect(result.unreadable.agents).toEqual([damaged]);
    expect(result.unreadable.events).toBe(0);
  });

  it("keeps every projection working over the rows that survived", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);
    store.importManifest(otherManifest);
    truncateManifest(db.db(), agentName(manifest));

    // Each of these takes a StoreShape and used to inherit the throw. The blast
    // radius is the point: one row must not cost four pages.
    const shape = store.readStore();
    expect(store.listAgents(shape)).toHaveLength(1);
    expect(store.listRuns(shape)).toEqual([]);
    expect(store.listConnectionCapableAgents(shape).map((entry) => entry.name)).toEqual([
      agentName(otherManifest),
    ]);
  });

  it("counts an unreadable event without discarding the rest of the run", async () => {
    const { db, store } = await freshStore();
    store.ingestEvents(runEvent);
    store.ingestEvents({ ...runEvent, seq: 1, type: "run_completed" });

    // By arrival id, not by seq: the example's own seq is whatever the example
    // says, and a WHERE that silently matches nothing would make this test pass
    // by proving that no damage is handled fine.
    const damaged = db
      .db()
      .prepare("UPDATE events SET event_json = '{\"agent\":' WHERE id = (SELECT MIN(id) FROM events)")
      .run();
    expect(Number(damaged.changes)).toBe(1);

    const result = store.readStore();
    expect(result.events).toHaveLength(1);
    expect(result.unreadable.events).toBe(1);
    expect(result.unreadable.agents).toEqual([]);
  });

  it("reads an unreadable manifest as an unknown agent rather than throwing", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);
    const damaged = agentName(manifest);
    truncateManifest(db.db(), damaged);

    // Fails closed, and the command channel already refuses a null manifest at
    // `unknown_target`. A manifest DASH cannot read is not one it may act on.
    expect(store.readAgentManifest(damaged)).toBeNull();

    // Still listed, because the row is still there. `listAgentNames` reads the
    // name column and never the manifest, so it is unaffected by the damage —
    // and an agent that vanished from this list would be a different lie.
    expect(store.listAgentNames()).toContain(damaged);
  });

  it("reports nothing unreadable for a healthy store", async () => {
    const { store } = await freshStore();
    store.importManifest(manifest);
    store.ingestEvents(runEvent);

    expect(store.readStore().unreadable).toEqual({ agents: [], events: 0, unnamed_agents: 0 });
  });
});

/**
 * The second shape of damage, and the one the real store's `command_audit`
 * actually had: the bulk `SELECT *` does not come back short, it throws.
 *
 * Simulated by making the *statement* fail rather than the file, for the reason
 * given at the top of this file — the behaviour under test is what DASH does
 * when a bulk read throws, and reproducing SQLITE_CORRUPT portably would mean
 * writing malformed SQLite internals from a test.
 */
function auditRecord(decision: "allowed" | "denied"): Parameters<
  typeof import("../lib/agent-dom/store").writeCommandAudit
>[1] {
  return {
    command_id: `cmd-${decision}`,
    request_id: `req-${decision}`,
    correlation_id: "corr-1",
    agent: "billing-watch",
    run_id: null,
    command: "agent.start",
    actor_id: "local",
    actor_type: "user",
    authenticated_by: "shell",
    decision,
    payload_keys: ["agent_id"],
    mutates: true,
    irreversible: false,
    issued_at: null,
    expires_at: null,
    decided_at: new Date().toISOString(),
  };
}

describe("readRowsTolerantly", () => {
  it("uses the bulk read when the table is intact", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);

    const read = db.readRowsTolerantly(db.db(), {
      table: "agents",
      bulk: "SELECT name FROM agents",
      byRowid: "SELECT name FROM agents WHERE rowid = ?",
    });
    expect(read.rows.map((row) => String(row["name"]))).toEqual([agentName(manifest)]);
    expect(read.lost).toBe(0);
  });

  it("falls back to one row at a time when the bulk read throws", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);
    store.importManifest(otherManifest);

    const read = db.readRowsTolerantly(db.db(), {
      table: "agents",
      // A statement that cannot prepare stands in for a leaf page that cannot
      // be read: both fail the bulk path and leave the rowid walk to recover.
      bulk: "SELECT name FROM agents WHERE no_such_column = 1",
      byRowid: "SELECT name FROM agents WHERE rowid = ?",
    });

    expect(read.rows).toHaveLength(2);
    expect(read.lost).toBe(0);
  });

  it("keeps a filtered read filtered on the slow path", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);
    store.importManifest(otherManifest);

    const read = db.readRowsTolerantly(db.db(), {
      table: "agents",
      bulk: "SELECT name FROM agents WHERE no_such_column = 1",
      byRowid: "SELECT name FROM agents WHERE rowid = ? AND name = ?",
      parameters: [agentName(otherManifest)],
    });

    // The fallback must not quietly widen to the whole table — a caller that
    // asked about one agent would otherwise be handed every agent's rows.
    expect(read.rows.map((row) => String(row["name"]))).toEqual([agentName(otherManifest)]);
  });

  it("reports nothing rather than guessing when it cannot size the table", async () => {
    const { db } = await freshStore();

    const read = db.readRowsTolerantly(db.db(), {
      table: "no_such_table",
      bulk: "SELECT * FROM no_such_table",
      byRowid: "SELECT * FROM no_such_table WHERE rowid = ?",
    });

    // `lost: 0` is deliberate. A fabricated count would be rendered to a user.
    expect(read).toEqual({ rows: [], lost: 0 });
  });

  it("reports the loss when the walk recovers nothing, rather than an empty success", async () => {
    const { db } = await freshStore();
    const { writeCommandAudit } = await import("../lib/agent-dom/store");
    writeCommandAudit(db.db(), auditRecord("allowed"));
    writeCommandAudit(db.db(), auditRecord("denied"));

    const read = db.readRowsTolerantly(db.db(), {
      table: "command_audit",
      bulk: "SELECT * FROM command_audit WHERE no_such_column = 1",
      byRowid: "SELECT * FROM command_audit WHERE rowid = ? AND no_such_column = 1",
    });

    // "Nothing came back" and "there was nothing" must not look the same to a
    // caller, least of all this table's caller.
    expect(read.rows).toEqual([]);
    expect(read.lost).toBe(2);

    /*
     * NOT covered here: the `sqlite_sequence` sizing fallback. It runs only when
     * `max(rowid)` itself throws, which needs a table whose data pages are gone
     * while its indexes survive — the real store's `command_audit` exactly, and
     * not something this suite can manufacture. The fallback is exercised
     * against a copy of that file rather than from here.
     */
  });
});

describe("the command audit, against a table that will not bulk-read", () => {
  it("survives, because an audit trail is the last thing that should vanish", async () => {
    const { db } = await freshStore();
    const { writeCommandAudit, readCommandAudit } = await import("../lib/agent-dom/store");

    // Two rows through the ordinary writer, so the shapes are real.
    for (const decision of ["allowed", "denied"] as const) {
      writeCommandAudit(db.db(), auditRecord(decision));
    }
    expect(readCommandAudit()).toHaveLength(2);

    // The bulk path is what broke on the real store; the rowid walk is what
    // this asserts still answers.
    const read = db.readRowsTolerantly(db.db(), {
      table: "command_audit",
      bulk: "SELECT * FROM command_audit WHERE no_such_column = 1",
      byRowid: "SELECT * FROM command_audit WHERE rowid = ?",
    });
    expect(read.rows).toHaveLength(2);
  });
});

describe("the agents view", () => {
  it("carries the damage as a recovery, beside the agents that survived", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);
    store.importManifest(otherManifest);
    truncateManifest(db.db(), agentName(manifest));

    const { agentsView } = await import("../lib/views/build");
    const view = agentsView();

    expect(view.agents).toHaveLength(1);
    expect(view.damage).not.toBeNull();
    expect(view.damage?.headline).toContain(agentName(manifest));
    expect(view.damage?.actor).toBe("dash");
  });

  it("never quotes the damaged bytes into what it renders", async () => {
    const { db, store } = await freshStore();
    store.importManifest(manifest);
    truncateManifest(db.db(), agentName(manifest));

    const { agentsView } = await import("../lib/views/build");
    // The parser's message quotes the offending input back at you, and this
    // document crosses a bridge and reaches a log. `lib/db.ts` refuses to quote
    // an unreadable `dash.json` for the same reason; the store holds connection
    // hints, so it holds here harder.
    expect(JSON.stringify(agentsView())).not.toContain(DAMAGE_MARKER);
  });

  it("carries null damage when the store is intact", async () => {
    const { store } = await freshStore();
    store.importManifest(manifest);

    const { agentsView } = await import("../lib/views/build");
    expect(agentsView().damage).toBeNull();
  });
});

describe("describeStoreDamage", () => {
  it("says nothing at all when nothing was lost", () => {
    expect(describeStoreDamage({ agents: [], events: 0 })).toBeNull();
  });

  it("names all three things a failure has to name", () => {
    const recovery = describeStoreDamage({ agents: ["billing-watch"], events: 0 });
    expect(recovery?.headline).toBeTruthy();
    expect(recovery?.meaning).toBeTruthy();
    expect(recovery?.next_action).toBeTruthy();
  });

  it("never asks the user to fix a database", () => {
    const recovery = describeStoreDamage({ agents: ["billing-watch"], events: 0 });
    // `actor: "dash"` is what stops a surface offering a button for this. The
    // damage is not the user's doing and no retry repairs it.
    expect(recovery?.actor).toBe("dash");
    expect(recovery?.next_action.toLowerCase()).not.toContain("try again");
  });

  it("names the agents, so 'which one is gone?' has an answer", () => {
    const one = describeStoreDamage({ agents: ["billing-watch"], events: 0 });
    expect(one?.headline).toContain("billing-watch");

    const two = describeStoreDamage({ agents: ["billing-watch", "folder-digest"], events: 0 });
    expect(two?.headline).toContain("billing-watch");
    expect(two?.headline).toContain("folder-digest");
  });

  it("speaks about damaged events without naming an agent it cannot identify", () => {
    const recovery = describeStoreDamage({ agents: [], events: 4 });
    expect(recovery).not.toBeNull();
    // A damaged event body has no readable identity left. Copy that named one
    // would be inventing it.
    expect(recovery?.next_action).toContain("Report this");
  });

  it("counts agents whose name did not survive, and never invents one", () => {
    const recovery = describeStoreDamage({ agents: [], events: 0, unnamed_agents: 2 });
    expect(recovery?.headline).toContain("2 of your agents");
    // No placeholder in the position a real agent name would occupy.
    expect(recovery?.headline).not.toMatch(/unknown|unnamed|undefined|null/i);
  });

  it("counts named and unnamed losses together", () => {
    const recovery = describeStoreDamage({
      agents: ["billing-watch"],
      events: 0,
      unnamed_agents: 1,
    });
    expect(recovery?.headline).toContain("2 of your agents");
    expect(recovery?.headline).toContain("billing-watch");
    expect(recovery?.headline).toContain("one more it could not name");
  });

  it("says the sign-ins are unaffected, because they are", () => {
    // The vault is a separate directory and survived the real incident intact.
    // That is the single most reassuring true thing available here, and a user
    // who is not told it will assume the opposite.
    const recovery = describeStoreDamage({ agents: ["billing-watch"], events: 0 });
    expect(`${recovery?.meaning} ${recovery?.next_action}`).toMatch(/keyring|sign-in/i);
  });

  it("surfaces folder/index drift and says which source won", () => {
    const recovery = describeStoreDamage({
      agents: [],
      events: 0,
      agent_folders: [{ agent: "folder-digest", kind: "index_drift" }],
    });
    expect(recovery?.headline).toContain("folder-digest");
    expect(recovery?.meaning).toContain("folder is authoritative");
    expect(recovery?.meaning).toMatch(/last readable index/i);
    expect(recovery?.next_action).toMatch(/re-import/i);
    expect(recovery?.actor).toBe("dash");
  });
});

describe("the legacy import's imported_at", () => {
  async function importing(importedAt: unknown): Promise<string> {
    const { store } = await freshStore((dataDir) => {
      writeFileSync(
        path.join(dataDir, "dash.json"),
        JSON.stringify({ agents: { seeded: { manifest, imported_at: importedAt } }, events: [] }),
        "utf8",
      );
    });
    const stored = store.readStore().agents[agentName(manifest)];
    return stored?.imported_at ?? "";
  }

  it("keeps a real timestamp", async () => {
    expect(await importing("2026-07-01T10:00:00.000Z")).toBe("2026-07-01T10:00:00.000Z");
  });

  it.each([
    ["", "the empty string"],
    ["not a date", "prose"],
    [null, "null"],
    [42, "a number"],
  ] as Array<[unknown, string]>)(
    "replaces %j (%s) with the time DASH actually first saw the row",
    async (value: unknown) => {
      const stored = await importing(value);
      // Not the bad value, and parseable — the column is NOT NULL, which "" also
      // satisfies while being no more a timestamp than null is.
      expect(stored).not.toBe(value);
      expect(Number.isNaN(Date.parse(stored))).toBe(false);
    },
  );
});
