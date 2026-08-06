/**
 * What DASH says about a brokered request it never adjudicated (MAR-467,
 * ADR 0005).
 *
 * Three ways an agent's request goes untraced, and the tests are organised by
 * **who observed what**, because that is the distinction the whole design turns
 * on:
 *
 * - the runner destroyed it (observed by the runner, no decision exists);
 * - the answer could not be confirmed delivered (observed by DASH, and a
 *   decision exists — this one is a property of an audit row, not a new fact);
 * - DASH was closed (observed by nobody, and only DASH's own absence is
 *   recorded).
 *
 * The rule every test here is ultimately protecting: nothing DASH did not decide
 * may end up looking like a decision DASH made.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closedWindow, MIN_CLOSED_WINDOW_MS } from "../lib/broker/uptime";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The store resolves its directory at import time; redirect before importing,
// as tests/store.test.ts and tests/connection-center.test.ts do.
const dataDir = mkdtempSync(path.join(tmpdir(), "dash-lapses-"));
process.env.DASH_DATA_DIR = dataDir;

const {
  markBrokerAnswerUndelivered,
  readBrokerAudit,
  readBrokerLapses,
  readDashLastAlive,
  recordBrokerCall,
  recordBrokerLapse,
  recordClosedWindow,
  writeDashLastAlive,
} = await import("../lib/broker/store");
const { importManifest, resetStore } = await import("../lib/store");
const { closeDb, db } = await import("../lib/db");
const { connectionsView } = await import("../lib/views/build");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

const AGENT = "synthetic-gmail-meeting-assistant";

beforeEach(() => {
  resetStore();
  db().exec("DELETE FROM broker_lapses");
  db().exec("DELETE FROM broker_audit");
  db().exec("DELETE FROM store_meta WHERE key = 'broker.dash_last_alive_at'");
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/** One audited decision, as `lib/broker/execute.ts` would have written it. */
function auditOne(requestId: string): number {
  const id = recordBrokerCall({
    agent: AGENT,
    connection_id: "gmail",
    operation: "gmail.search",
    request_id: requestId,
    decision: "allowed",
    refusal: null,
    input_keys: ["query"],
    result_count: 3,
    account_hint: "he••@gmail.com",
    duration_ms: 12,
    decided_at: "2026-08-02T10:00:00.000Z",
  });
  expect(id).not.toBeNull();
  return id as number;
}

describe("an answer DASH could not confirm was delivered", () => {
  /**
   * The correction this issue's own description needed.
   *
   * MAR-467 lists an undeliverable answer as a third way a request "leaves no
   * trace". It does not: `lib/broker/execute.ts` audits on every path *before*
   * the answer travels, so by the time delivery fails the row already exists.
   * The defect is the opposite of a missing trace — it is a trace that reads as
   * a completed transaction when the agent got nothing.
   */
  it("is a property of the decision, because the decision really happened", () => {
    const id = auditOne("req-1");
    expect(readBrokerAudit(AGENT)).toHaveLength(1);

    markBrokerAnswerUndelivered(id);

    const rows = readBrokerAudit(AGENT);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.delivered).toBe(false);
    // Still the decision it always was. Nothing about the operation, the result
    // count or the verdict is rewritten by a delivery failure.
    expect(rows[0]?.decision).toBe("allowed");
    expect(rows[0]?.result_count).toBe(3);
  });

  it("leaves every other row saying nothing rather than saying delivered", () => {
    auditOne("req-2");
    // Null and not false: DASH never checked, and a column that reported "not
    // delivered" for every ordinary row would put a warning on the whole
    // history.
    expect(readBrokerAudit(AGENT)[0]?.delivered).toBeNull();
  });

  it("marks exactly one decision when a request id repeats", () => {
    // A replayed request produces a second audit row carrying the *same*
    // request id and a duplicate_request refusal, which is why delivery is
    // tracked by row id and never by (agent, request_id).
    const first = auditOne("req-same");
    const second = recordBrokerCall({
      agent: AGENT,
      connection_id: "gmail",
      operation: "gmail.search",
      request_id: "req-same",
      decision: "refused",
      refusal: "duplicate_request",
      input_keys: [],
      result_count: null,
      account_hint: null,
      duration_ms: 1,
      decided_at: "2026-08-02T10:00:01.000Z",
    });

    markBrokerAnswerUndelivered(first);

    const rows = readBrokerAudit(AGENT);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first)?.delivered).toBe(false);
    expect(rows.find((row) => row.id === second)?.delivered).toBeNull();
  });
});

describe("a request the runner destroyed", () => {
  it("is recorded as an attempt with no decision attached to it", () => {
    recordBrokerLapse({
      kind: "dropped_by_runner",
      agent: AGENT,
      attempts: 7,
      from_at: "2026-08-02T10:00:00.000Z",
      until_at: "2026-08-02T10:00:02.000Z",
      observed_by: "runner",
    });

    const lapses = readBrokerLapses(AGENT);
    expect(lapses).toHaveLength(1);
    expect(lapses[0]).toMatchObject({
      kind: "dropped_by_runner",
      agent: AGENT,
      attempts: 7,
      observed_by: "runner",
    });
    // And it did not become an audit row, which is the whole point.
    expect(readBrokerAudit(AGENT)).toHaveLength(0);
  });
});

describe("the window DASH was closed for", () => {
  const RUNNER_STARTED = "2026-08-02T08:00:00.000Z";
  const LAST_ALIVE = "2026-08-02T09:00:00.000Z";
  const NOW = "2026-08-02T10:00:00.000Z";

  it("is recorded when an already-running runner spanned it", () => {
    const window = closedWindow({
      last_alive_at: LAST_ALIVE,
      now: NOW,
      runner_adopted: true,
      runner_started_at: RUNNER_STARTED,
    });
    expect(window).toEqual({ from_at: LAST_ALIVE, until_at: NOW });
  });

  it("is not recorded when DASH spawned the runner, because nothing was up", () => {
    expect(
      closedWindow({
        last_alive_at: LAST_ALIVE,
        now: NOW,
        runner_adopted: false,
        runner_started_at: null,
      }),
    ).toBeNull();
  });

  it("is not recorded when the runner started inside the window", () => {
    // DASH cannot see *when* inside the window it started, so it cannot say how
    // much of the window went unanswered. A claim it cannot bound is not made.
    expect(
      closedWindow({
        last_alive_at: LAST_ALIVE,
        now: NOW,
        runner_adopted: true,
        runner_started_at: "2026-08-02T09:30:00.000Z",
      }),
    ).toBeNull();
  });

  it("is not recorded for a restart", () => {
    const shortly = new Date(Date.parse(LAST_ALIVE) + MIN_CLOSED_WINDOW_MS - 1_000).toISOString();
    expect(
      closedWindow({
        last_alive_at: LAST_ALIVE,
        now: shortly,
        runner_adopted: true,
        runner_started_at: RUNNER_STARTED,
      }),
    ).toBeNull();
  });

  it("is not recorded on a first run, or when a clock ran backwards", () => {
    expect(
      closedWindow({
        last_alive_at: null,
        now: NOW,
        runner_adopted: true,
        runner_started_at: RUNNER_STARTED,
      }),
    ).toBeNull();
    expect(
      closedWindow({
        last_alive_at: NOW,
        now: LAST_ALIVE,
        runner_adopted: true,
        runner_started_at: RUNNER_STARTED,
      }),
    ).toBeNull();
    expect(
      closedWindow({
        last_alive_at: "not a date",
        now: NOW,
        runner_adopted: true,
        runner_started_at: RUNNER_STARTED,
      }),
    ).toBeNull();
  });

  it("counts nothing, because nothing was watching", () => {
    recordClosedWindow({
      last_alive_at: LAST_ALIVE,
      now: NOW,
      runner_adopted: true,
      runner_started_at: RUNNER_STARTED,
    });

    const [lapse] = readBrokerLapses(AGENT);
    expect(lapse?.kind).toBe("dash_closed");
    // NULL and not 0. Zero would assert that nothing was asked, and DASH has no
    // basis for that: the broker was not running to see.
    expect(lapse?.attempts).toBeNull();
    // No agent either. The window is a fact about DASH.
    expect(lapse?.agent).toBeNull();
  });

  it("keeps a heartbeat DASH can measure its own absence against", () => {
    expect(readDashLastAlive()).toBeNull();
    writeDashLastAlive(LAST_ALIVE);
    expect(readDashLastAlive()).toBe(LAST_ALIVE);
  });
});

describe("what the Connection Center shows", () => {
  beforeEach(() => {
    expect(importManifest(example("gmail-meeting-assistant.manifest.v2.example.json")).ok).toBe(
      true,
    );
  });

  function lapsesFor(agent: string): ReturnType<typeof connectionsView>["agents"][number]["lapses"] {
    return connectionsView().agents.find((entry) => entry.name === agent)?.lapses ?? [];
  }

  it("shows nothing at all when nothing went wrong", () => {
    expect(lapsesFor(AGENT)).toEqual([]);
  });

  it("says a dropped request was never seen, and never says what it asked for", () => {
    recordBrokerLapse({
      kind: "dropped_by_runner",
      agent: AGENT,
      attempts: 4,
      from_at: "2026-08-02T10:00:00.000Z",
      until_at: "2026-08-02T10:00:02.000Z",
      observed_by: "runner",
    });

    const [view] = lapsesFor(AGENT);
    expect(view?.kind).toBe("dropped_by_runner");
    expect(view?.sentence).toContain("4 requests");
    expect(view?.sentence).toContain("before DASH saw");
    expect(view?.qualifier).toContain("does not know what they asked for");
    // The absence check that pairs with the presence check above: no sentence
    // here may name an operation, because the runner never read one.
    const text = `${view?.sentence ?? ""} ${view?.qualifier ?? ""}`;
    expect(text).not.toContain("gmail.search");
    expect(text).not.toContain("allowed");
    expect(text).not.toContain("refused");
  });

  it("shows a closed window only for an agent that keeps running through one", () => {
    recordClosedWindow({
      last_alive_at: "2026-08-02T09:00:00.000Z",
      now: "2026-08-02T10:00:00.000Z",
      runner_adopted: true,
      runner_started_at: "2026-08-02T08:00:00.000Z",
    });

    // The shipped Gmail example declares continues_when_dash_closed: true, so
    // the window is relevant to it.
    expect(lapsesFor(AGENT).map((entry) => entry.kind)).toContain("dash_closed");

    // The same window, and an agent that stops when DASH stops. Nothing of its
    // could have gone unanswered, so it is told nothing — the derivation, rather
    // than a stored per-agent row, is what makes this possible at all.
    const stops = example("dash-managed-secret.manifest.v2.example.json");
    expect(importManifest(stops).ok).toBe(true);
    const stopsName = String(
      (stops as { agent?: { name?: unknown } }).agent?.name ?? "dash-managed-secret",
    );
    expect(lapsesFor(stopsName).map((entry) => entry.kind)).not.toContain("dash_closed");
  });

  it("never claims the agent asked for something during a closed window", () => {
    recordClosedWindow({
      last_alive_at: "2026-08-02T09:00:00.000Z",
      now: "2026-08-02T10:00:00.000Z",
      runner_adopted: true,
      runner_started_at: "2026-08-02T08:00:00.000Z",
    });

    const view = lapsesFor(AGENT).find((entry) => entry.kind === "dash_closed");
    expect(view?.qualifier).toContain("no record of whether this agent asked");
  });

  it("says before any grant that the connection only works while DASH is open (MAR-482)", () => {
    // ADR 0006's option-3 copy, on the permission card rather than only in the
    // ADR. The shipped Gmail example keeps running while DASH is closed, and
    // the person deciding whether to connect a mailbox to it is told the
    // window up front — not afterwards, as a lapse row.
    const row = connectionsView()
      .agents.find((entry) => entry.name === AGENT)
      ?.rows.find((entry) => entry.connection_id === "gmail");
    const sentence = row?.broker?.dash_closed_sentence ?? "";
    expect(sentence).toContain("only while DASH is open on this computer");
    expect(sentence).toContain("the agent keeps running");
    expect(sentence).toContain("go unanswered");
    expectPlainLanguage([sentence]);
  });

  it("says nothing about closed windows for an agent that stops with DASH", () => {
    // Same manifest, one claim changed: the agent stops when DASH does. The
    // warning would describe a window in which the agent does not exist, so
    // its honest form is absence — the same derivation `lapseViews` makes for
    // the dash_closed lapse itself.
    const stops = example("gmail-meeting-assistant.manifest.v2.example.json") as {
      agent: { name: string };
      agent_dom: { runtime: { continues_when_dash_closed: boolean } };
    };
    stops.agent.name = "synthetic-stops-with-dash";
    stops.agent_dom.runtime.continues_when_dash_closed = false;
    expect(importManifest(stops).ok).toBe(true);

    const row = connectionsView()
      .agents.find((entry) => entry.name === "synthetic-stops-with-dash")
      ?.rows.find((entry) => entry.connection_id === "gmail");
    expect(row?.broker).not.toBeNull();
    expect(row?.broker?.dash_closed_sentence).toBeNull();
  });

  it("marks an undelivered answer on the decision, inside the history", () => {
    const id = auditOne("req-view");
    markBrokerAnswerUndelivered(id);

    const row = connectionsView()
      .agents.find((entry) => entry.name === AGENT)
      ?.rows.find((entry) => entry.connection_id === "gmail");
    const recent = row?.broker?.recent ?? [];
    expect(recent).toHaveLength(1);
    expect(recent[0]?.undelivered).toBe(true);
    // It is still an audited decision and still reads as one.
    expect(recent[0]?.decision).toBe("allowed");
    // And it did not also become a lapse: one event, one place.
    expect(lapsesFor(AGENT)).toEqual([]);
  });
});
