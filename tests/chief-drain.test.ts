/**
 * What DASH does with what the runner did while it was closed (MAR-743, ADR
 * 0028 decisions 6 and 7).
 *
 * The evidence path the issue asks for, end to end on a real store: a turn
 * arrives in `chief_messages` saying it came from Discord, and a decision
 * arrives in `broker_audit` saying the **runner** took it. Both facts are
 * columns rather than inferences, and this is where that stops being a claim.
 *
 * The interesting assertion is the negative one. `decided_on` is not a
 * parameter of anything: `recordBrokerCall` cannot write `'runner'` and
 * `recordRunnerChiefCall` cannot write anything else, so a row's provenance is
 * decided by which function DASH called and not by a field a caller filled in.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHIEF_CONNECTION_ID } from "../lib/chief/manifest";

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  drain: typeof import("../electron/chief-discord");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-chief-drain-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  opened.push({ dataDir, closeDb: db.closeDb });
  db.db();
  const drain = await import("../electron/chief-discord");
  return { dataDir, db, drain };
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

const TURN: import("../lib/chief/store").ChiefTurnDraft = {
  asked_at: "2026-08-23T02:14:00.000Z",
  question: "what did the scout find overnight",
  answer: "It published one digest, with four sources.",
  failure: null,
  provider_id: "openrouter",
  model_id: "openai/gpt-5-mini",
  tokens_in: 120,
  tokens_out: 30,
  amount_usd: 0.0003,
  receipt: [],
  origin: "discord",
};

const DECISION: Parameters<typeof import("../electron/chief-discord").ingestChiefDrain>[0]["audit"][number] = {
  connection_id: CHIEF_CONNECTION_ID,
  operation: "openrouter.chat.completion",
  request_id: "chief-abc",
  decision: "allowed",
  refusal: null,
  input_keys: ["material", "model", "question"],
  result_count: 1,
  duration_ms: 812,
  decided_at: "2026-08-23T02:14:01.000Z",
};

describe("taking the runner's night shift into the store", () => {
  it("keeps the room the question was asked in", async () => {
    const { db, drain } = await freshStore();
    const written = drain.ingestChiefDrain({ turns: [TURN], audit: [] });
    expect(written.turns).toBe(1);

    const row = db.db().prepare("SELECT question, origin FROM chief_messages").get() as {
      question: string;
      origin: string;
    };
    expect(row.question).toBe(TURN.question);
    expect(row.origin).toBe("discord");
  });

  it("stamps the decision with the process that made it", async () => {
    const { db, drain } = await freshStore();
    drain.ingestChiefDrain({ turns: [], audit: [DECISION] });

    const row = db
      .db()
      .prepare("SELECT agent, operation, decided_on, account_hint FROM broker_audit")
      .get() as { agent: string; operation: string; decided_on: string; account_hint: null };
    expect(row.decided_on).toBe("runner");
    expect(row.operation).toBe(DECISION.operation);
    // The same label a chief call made at the window writes. The two rooms' rows
    // sit under one name and are told apart by `decided_on` — which is what that
    // column is for.
    expect(row.agent).toBe("dash.fleet");
    // A fleet key identifies nobody.
    expect(row.account_hint).toBeNull();
  });

  it("does not let a drained row claim an operation the chief cannot perform", async () => {
    /*
     * `broker_audit` is the table somebody reads to find out what their key was
     * spent on, so a row in it naming an operation this bridge cannot perform
     * would be a *false record of a spend* — the one kind of wrong entry that is
     * worse than a missing one.
     *
     * Checked even though DASH's own runner wrote the row, for the reason ADR
     * 0021 gives about a pulled row: what arrives over a channel is evidence
     * DASH observed, not a fact DASH established.
     */
    const { db, drain } = await freshStore();
    const written = drain.ingestChiefDrain({
      turns: [],
      audit: [
        { ...DECISION, operation: "gmail.draft.create" },
        { ...DECISION, connection_id: "models" },
        { ...DECISION, operation: "openrouter.digest.curate" },
      ],
    });

    expect(written.audit).toBe(0);
    const count = db.db().prepare("SELECT COUNT(*) AS n FROM broker_audit").get() as { n: number };
    expect(count.n).toBe(0);
  });

  it("writes a window turn as a window turn, unchanged", async () => {
    /*
     * The other half of decision 7, and the reason the column has a default
     * rather than being filled in at ingest: every row written before ADR 0028
     * was asked at the window, and a turn recorded here the ordinary way still
     * is.
     */
    const { db } = await freshStore();
    const chiefStore = await import("../lib/chief/store");
    chiefStore.recordChiefTurn({ ...TURN, origin: "window" });

    const row = db.db().prepare("SELECT origin FROM chief_messages").get() as { origin: string };
    expect(row.origin).toBe("window");
  });

  it("writes DASH's own decisions as DASH's, with nothing to pass in", async () => {
    const { db } = await freshStore();
    const brokerStore = await import("../lib/broker/store");
    brokerStore.recordBrokerCall({
      agent: "dash.fleet",
      connection_id: CHIEF_CONNECTION_ID,
      operation: "openrouter.chat.completion",
      request_id: "chief-window",
      decision: "allowed",
      refusal: null,
      input_keys: ["question"],
      result_count: 1,
      account_hint: null,
      duration_ms: 400,
      decided_at: "2026-08-23T09:00:00.000Z",
    });

    const row = db.db().prepare("SELECT decided_on FROM broker_audit").get() as {
      decided_on: string;
    };
    expect(row.decided_on).toBe("dash");
  });
});
