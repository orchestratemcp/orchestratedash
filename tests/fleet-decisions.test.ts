/**
 * The decisions half of the fleet's memory (MAR-673, ADR 0024).
 *
 * Three layers, matching the design's own seams: the pure chain arithmetic
 * (no store), the filing write-sites driven through a real scratch store
 * (`freshStore`, `tests/store-sqlite.test.ts`'s harness), and the
 * source-level tripwire that every named write-site actually files — the
 * closest a test can get to ADR 0024's honest gap that completeness is
 * per-kind, per-write-site.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DECISION_KINDS,
  chainKeyOf,
  declarationDiff,
  markDecisions,
  type DecisionRecord,
} from "../lib/fleet/decisions";
import {
  describeDeclaredConnection,
  describeDeclaredRoute,
} from "../lib/copy/decisions";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/* ---------------------------------------------------------------------- *
 * The closed list
 * ---------------------------------------------------------------------- */

describe("the closed kind list", () => {
  it("is pinned by value, WRITE_PATHS' way", () => {
    // Adding a kind is adding a write-site that files it; this pin is what
    // makes that a deliberate edit here too.
    expect([...DECISION_KINDS]).toEqual([
      "agent_added",
      "agent_removed",
      "declared_connection",
      "declared_route",
      "agent_model",
      "fleet_model_default",
      // MAR-654. What one level means, set or cleared. A kind of its own rather
      // than a topic on the default's, because the two are separate standing
      // states: the default is read only where a level row is absent, and a view
      // resolving one against the other's current value would report a setting
      // nobody made.
      "fleet_level_model",
      "connection_grant",
      "fleet_connection",
      "fleet_grant",
      "irreversible_approval",
      "standing_answer",
    ]);
  });
});

/* ---------------------------------------------------------------------- *
 * Chains: supersession and drift
 * ---------------------------------------------------------------------- */

let nextId = 1;

function decision(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    id: nextId++,
    decided_at: "2026-08-16T12:00:00.000Z",
    subject_kind: "agent",
    subject_id: "scout",
    kind: "declared_connection",
    topic: "reddit",
    summary: "Declared connection dropped: reddit.",
    outcome: { state: "dropped", connection: "reddit" },
    decided_by: "person",
    rule: null,
    reason: null,
    reason_added_at: null,
    receipts: ["agents.imported_at 2026-08-16T12:00:00.000Z"],
    ...overrides,
  };
}

describe("markDecisions", () => {
  it("marks the older row on a chain with its successor, and returns newest first", () => {
    const dropped = decision({ outcome: { state: "dropped", connection: "reddit" } });
    const restored = decision({
      summary: "Declared connection added: reddit.",
      outcome: { state: "declared", connection: "reddit" },
      decided_at: "2026-09-03T12:00:00.000Z",
    });
    const marked = markDecisions([dropped, restored], new Map());

    expect(marked.map((one) => one.decision.id)).toEqual([restored.id, dropped.id]);
    expect(marked[1]?.superseded_by?.id).toBe(restored.id);
    expect(marked[0]?.superseded_by).toBeNull();
  });

  it("keeps distinct chains apart", () => {
    const reddit = decision({ topic: "reddit" });
    const hackernews = decision({ topic: "hackernews" });
    const marked = markDecisions([reddit, hackernews], new Map());
    expect(marked.every((one) => one.superseded_by === null)).toBe(true);
    expect(chainKeyOf(reddit)).not.toBe(chainKeyOf(hackernews));
  });

  it("marks drift only on a chain head whose current standing moved", () => {
    const dropped = decision({});
    const marked = markDecisions(
      [dropped],
      new Map([[chainKeyOf(dropped), { state: "declared", connection: "reddit" }]]),
    );
    expect(marked[0]?.drifted).toBe(true);
  });

  it("never marks drift when nothing looked, and never on a superseded row", () => {
    const dropped = decision({});
    const restored = decision({
      outcome: { state: "declared", connection: "reddit" },
      decided_at: "2026-09-03T12:00:00.000Z",
    });

    // Absent from the map is "did not look" — the weaker claim, unmarked.
    expect(markDecisions([dropped], new Map())[0]?.drifted).toBe(false);

    // The superseded row's explanation is its successor, whatever the fleet
    // looks like now.
    const marked = markDecisions(
      [dropped, restored],
      new Map([[chainKeyOf(dropped), { state: "dropped", connection: "reddit" }]]),
    );
    const older = marked.find((one) => one.decision.id === dropped.id);
    expect(older?.drifted).toBe(false);
  });

  it("matches by value, not by object identity", () => {
    const head = decision({});
    const marked = markDecisions(
      [head],
      new Map([[chainKeyOf(head), { state: "dropped", connection: "reddit" }]]),
    );
    expect(marked[0]?.drifted).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * The declared diff
 * ---------------------------------------------------------------------- */

const SUMMARISE = { connection: describeDeclaredConnection, route: describeDeclaredRoute };

function manifestWith(connections: string[], route: string[]): string {
  return JSON.stringify({
    manifest_version: 2,
    agent_dom: { connections: connections.map((id) => ({ id, label: id })) },
    planned_route: route.map((component_id, index) => ({ step: index + 1, component_id })),
  });
}

describe("declarationDiff", () => {
  it("files one row per connection that went, on its own chain", () => {
    const drafts = declarationDiff(
      "scout",
      manifestWith(["reddit", "hackernews"], []),
      manifestWith(["hackernews"], []),
      "2026-08-20T09:00:00.000Z",
      SUMMARISE,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      kind: "declared_connection",
      topic: "reddit",
      subject_id: "scout",
      summary: "Declared connection dropped: reddit.",
      outcome: { state: "dropped", connection: "reddit" },
      decided_by: "person",
      reason: null,
    });
  });

  it("files additions and route changes, and nothing for an unchanged document", () => {
    const before = manifestWith(["reddit"], ["fetch"]);
    const after = manifestWith(["reddit", "bluesky"], ["fetch", "summarize"]);
    const drafts = declarationDiff("scout", before, after, "2026-08-20T09:00:00.000Z", SUMMARISE);
    expect(drafts.map((draft) => [draft.kind, draft.topic, draft.outcome["state"]])).toEqual([
      ["declared_connection", "bluesky", "declared"],
      ["declared_route", "summarize", "declared"],
    ]);

    expect(declarationDiff("scout", before, before, "2026-08-20T09:00:00.000Z", SUMMARISE)).toEqual(
      [],
    );
  });

  it("yields no drafts when either document is unreadable", () => {
    expect(
      declarationDiff("scout", "not json", manifestWith([], []), "2026-08-20", SUMMARISE),
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * The store, driven through the real write-sites
 * ---------------------------------------------------------------------- */

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  store: typeof import("../lib/store");
  decisions: typeof import("../lib/fleet/decisions-store");
  models: typeof import("../lib/ai/model-store");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-decisions-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  const store = await import("../lib/store");
  const decisions = await import("../lib/fleet/decisions-store");
  const models = await import("../lib/ai/model-store");
  opened.push({ dataDir, closeDb: db.closeDb });
  return { dataDir, db, store, decisions, models };
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

const v2 = example("dash-managed.manifest.v2.example.json");
const v2Agent = String((v2["agent"] as { name: string }).name);

describe("filing at the write-sites", () => {
  it("files agent_added on a first import and the declared diff on a re-import", async () => {
    const { store, decisions } = await freshStore();

    expect(store.importManifest(v2)).toMatchObject({ ok: true });
    let log = decisions.readDecisions();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "agent_added", subject_id: v2Agent });

    // Same document again: no transition, no rows.
    expect(store.importManifest(v2)).toMatchObject({ ok: true });
    expect(decisions.readDecisions()).toHaveLength(1);

    // Drop the declared connection: one row, on the connection's own chain.
    const dropped = structuredClone(v2);
    (dropped["agent_dom"] as { connections?: unknown[] }).connections = [];
    expect(store.importManifest(dropped)).toMatchObject({ ok: true });
    log = decisions.readDecisions();
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({
      kind: "declared_connection",
      topic: "project-service",
      subject_id: v2Agent,
      summary: "Declared connection dropped: project-service.",
      reason: null,
    });
  });

  it("files agent_removed once, and nothing for the cascade", async () => {
    const { store, decisions, models } = await freshStore();
    expect(store.importManifest(v2)).toMatchObject({ ok: true });

    // A pin, then removal: the pin's cascade delete must not read as a
    // person clearing a model.
    expect(
      models.writeAgentModelChoice(v2Agent, "anthropic", "claude-haiku-4-5-20251001", now()),
    ).toBe(true);
    store.forgetAgent(v2Agent);
    models.forgetAgentModelChoice(v2Agent);

    const kinds = decisions.readDecisions().map((row) => row.kind);
    expect(kinds).toEqual(["agent_added", "agent_model", "agent_removed"]);
  });

  it("files a model pin once per transition, and a clear only when a pin existed", async () => {
    const { decisions, models } = await freshStore();

    expect(models.writeAgentModelChoice("scout", "anthropic", "claude-haiku-4-5-20251001", now())).toBe(true);
    expect(models.writeAgentModelChoice("scout", "anthropic", "claude-haiku-4-5-20251001", now())).toBe(true);
    expect(decisions.readDecisions()).toHaveLength(1);

    models.clearAgentModelChoice("scout");
    models.clearAgentModelChoice("scout");
    const log = decisions.readDecisions();
    expect(log).toHaveLength(2);
    expect(log[1]?.outcome).toEqual({ state: "match_each_step" });
  });

  it("files the fleet default with a fleet subject and no agent", async () => {
    const { decisions, models } = await freshStore();
    expect(models.writeFleetModelDefault("anthropic", "claude-haiku-4-5-20251001", now())).toBe(true);
    models.clearFleetModelDefault();
    const log = decisions.readDecisions();
    expect(log.map((row) => [row.subject_kind, row.subject_id, row.outcome["state"]])).toEqual([
      ["fleet", null, "set"],
      ["fleet", null, "cleared"],
    ]);
  });

  it("reads a row with an unknown kind as the absence of a record", async () => {
    const { db, decisions } = await freshStore();
    db.db()
      .prepare(
        "INSERT INTO fleet_decisions (decided_at, subject_kind, subject_id, kind, topic, " +
          "summary, outcome_json, decided_by, rule, reason, reason_added_at, receipts_json) " +
          "VALUES (?, 'agent', 'scout', 'a_kind_from_the_future', '', 'x', '{}', 'person', " +
          "NULL, NULL, NULL, '[]')",
      )
      .run(now());
    expect(decisions.readDecisions()).toEqual([]);
  });
});

function now(): string {
  return new Date().toISOString();
}

/* ---------------------------------------------------------------------- *
 * The tripwire: every named write-site files
 * ---------------------------------------------------------------------- */

describe("the write-sites, in source", () => {
  // ADR 0024 names its own honest gap: a standing setting added later whose
  // write-site does not file makes the log lie by omission, and no gate
  // fully catches it. This is the partial gate it asks for — the write-site
  // each kind's docblock names must actually call `fileDecision`.
  const sites = [
    "lib/store.ts",
    "lib/ai/model-store.ts",
    "lib/connection-actions.ts",
    "lib/fleet/store.ts",
    "lib/fleet/actions.ts",
    "lib/agent-dom/runner.ts",
  ];

  it.each(sites)("%s files decisions", (site) => {
    const source = readFileSync(path.join(repoRoot, site), "utf8");
    expect(source).toContain("fileDecision(");
  });

  it("the shared receipt plumbing does not file", () => {
    // `recordReceipt` and `forgetReceipt` execute fan-outs of one decision
    // made elsewhere; a `fileDecision` here would turn one decision into a
    // row per agent (see `forgetReceipt`'s docblock).
    const source = readFileSync(path.join(repoRoot, "lib/broker/store.ts"), "utf8");
    expect(source).not.toContain("fileDecision(");
  });
});
