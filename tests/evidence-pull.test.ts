/**
 * Pulling a runner's evidence over a channel, and the route it can never ask
 * for (MAR-488, ADR 0006, ADR 0007).
 *
 * Two claims, and only one of them is about behaviour.
 *
 * The **behavioural** one is that generalising the three drains changed nothing
 * about what reaches the store: the same events, the same artifacts, the same
 * provenance binding, the same refusals. MAR-488's exit evidence asks for
 * exactly this — "reconstruction from a pulled event log matches reconstruction
 * from local ingest for the same events" — so these tests drive `pullEvidence`
 * against a fake channel and then read the real store back, rather than
 * asserting on what the function returned.
 *
 * The **structural** one is that `/broker/drain` and `/broker/responses` are
 * unreachable from this code path. It is asserted three ways, none of which
 * reads a flag:
 *
 * 1. the channel `pullEvidence` takes is `RemoteRunnerChannel`, so a broker
 *    route at any call site inside `lib/agent-dom/evidence.ts` is a compile
 *    error — pinned here by `@ts-expect-error`, which starts failing the
 *    typecheck the moment it stops being an error;
 * 2. a real pull records every route it asked for, and the set is checked
 *    against `BROKER_ROUTES` — the capability observed to be absent rather than
 *    declared absent;
 * 3. `tests/broker-channel-exclusion.test.ts` scans `lib/` and `electron/` for
 *    the route strings in code, which already covers the new module.
 *
 * The one that would fail first if somebody added a fourth drain beside the
 * three is (1), in their editor, before the commit exists.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  BROKER_ROUTES,
  EVIDENCE_ROUTES,
  remoteRunnerChannel,
  type RemoteRunnerChannel,
} from "../lib/agent-dom/runner-channel";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-evidence-"));
process.env.DASH_DATA_DIR = dataDir;

const { pullEvidence } = await import("../lib/agent-dom/evidence");
const { ingestEvents, readEvidencePulls, recordEvidencePull, readStore, resetStore } =
  await import("../lib/store");
const { closeDb } = await import("../lib/db");
const { runsView } = await import("../lib/views/build");

const AGENT = "ai-agent-news";
const RUN = "run-evidence-001";

function event(seq: number, type: string, extra: Record<string, unknown> = {}) {
  return {
    event_version: 1,
    agent: AGENT,
    run_id: RUN,
    seq,
    ts: `2026-08-07T09:0${String(seq)}:00.000Z`,
    type,
    ...extra,
  };
}

/**
 * A channel that answers from a script and records what it was asked for.
 *
 * Typed `RemoteRunnerChannel` on purpose: if `pullEvidence` ever tightened its
 * parameter to `LocalRunnerChannel`, every test in this file would stop
 * compiling — which is the assertion that evidence code stays written once for
 * both kinds of runner.
 */
function scriptedChannel(script: Partial<Record<string, unknown>>): {
  channel: RemoteRunnerChannel;
  asked: string[];
} {
  const asked: string[] = [];
  const channel = remoteRunnerChannel({
    token: "the-runners-own-channel-secret",
    dial: (input) => {
      const route = new URL(String(input)).pathname;
      asked.push(route);
      const body = script[route];
      if (body === undefined) {
        return Promise.resolve(new Response("{}", { status: 501 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  return { channel, asked };
}

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * The same evidence, over a channel
 * ---------------------------------------------------------------------- */

describe("a pull over a channel", () => {
  /**
   * The load-bearing behavioural test, and it compares two *stores* rather than
   * two return values.
   *
   * A pulled batch and a locally ingested one have to reconstruct to the same
   * run, or a remote agent's Runs row would be a different kind of object from a
   * local one — which is the failure MAR-488 exists to avoid and which no
   * assertion about the drain's own bookkeeping would catch.
   */
  it("reconstructs a run exactly as a local ingest of the same events does", async () => {
    const events = [
      event(1, "run_started"),
      event(2, "step_started", { step: 1, component_id: "public_feed_fetch" }),
      event(3, "run_completed", { outcome: "succeeded" }),
    ];

    const { channel } = scriptedChannel({
      "/telemetry/drain": {
        events: events.map((entry) => ({ agent_id: AGENT, event: entry })),
        dropped: 0,
      },
    });
    await pullEvidence(channel, { source: "host-1", kind: "another_machine", log: () => {} });
    const pulled = readStore();

    resetStore();
    ingestEvents(events, { sourceAgents: events.map(() => AGENT) });
    const local = readStore();

    expect(pulled.events).toEqual(local.events);
    expect(pulled.events.filter((entry) => entry.run_id === RUN)).toHaveLength(3);
  });

  /**
   * The provenance binding survives the generalisation, and it is the check
   * that matters most when the runner is on somebody else's machine: a hosted
   * child must not be able to publish under another agent's name.
   */
  it("refuses an event whose agent disagrees with the envelope the runner attached", async () => {
    const { channel } = scriptedChannel({
      "/telemetry/drain": {
        events: [{ agent_id: "some-other-agent", event: event(1, "run_started") }],
        dropped: 0,
      },
    });
    const rejected: string[] = [];
    await pullEvidence(channel, {
      source: "host-1",
      kind: "another_machine",
      log: (line) => rejected.push(line),
    });

    expect(readStore().events).toEqual([]);
    expect(rejected.join(" ")).toContain("must match the runner-hosted source");
  });

  it("drops an envelope the runner attached no provenance to, rather than inventing an owner", async () => {
    const { channel } = scriptedChannel({
      "/telemetry/drain": { events: [{ event: event(1, "run_started") }], dropped: 0 },
    });
    const logged: string[] = [];
    await pullEvidence(channel, {
      source: "host-1",
      kind: "another_machine",
      log: (line) => logged.push(line),
    });

    expect(readStore().events).toEqual([]);
    expect(logged.join(" ")).toContain("invalid provenance");
  });

  /**
   * The numbers that used to be written to a console line and thrown away.
   *
   * They are the whole of the honesty half: the count that says the record is
   * incomplete was the one number no surface could see.
   */
  it("carries what the runner's bounded buffer destroyed before DASH got there", async () => {
    const { channel } = scriptedChannel({
      "/telemetry/drain": { events: [], dropped: 136 },
      "/artifacts/drain": { artifacts: [], dropped: 4 },
      "/workspace-artifacts": { artifacts: [], truncated: true },
    });

    const pull = await pullEvidence(channel, {
      source: "host-1",
      kind: "another_machine",
      log: () => {},
      now: () => "2026-08-07T09:00:00.000Z",
    });

    expect(pull).toMatchObject({
      source: "host-1",
      kind: "another_machine",
      observed_at: "2026-08-07T09:00:00.000Z",
      reached: true,
      telemetry_dropped: 136,
      artifacts_dropped: 4,
      workspace_truncated: true,
    });
  });

  /**
   * A runner that answered nothing is not a runner that had nothing to say, and
   * the distinction has to survive to the record — otherwise "DASH last looked"
   * would be written over a look that never happened.
   */
  it("reports a runner that did not answer as unreached rather than as empty", async () => {
    const channel = remoteRunnerChannel({
      token: "unused",
      dial: () => Promise.reject(new Error("the host did not answer")),
    });
    const pull = await pullEvidence(channel, {
      source: "host-1",
      kind: "another_machine",
      log: () => {},
    });
    expect(pull.reached).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * The exclusion
 * ---------------------------------------------------------------------- */

describe("the brokered routes, from the evidence path", () => {
  /**
   * The compile-time half, pinned at a call site of the same shape the drains
   * use. Directives attach to the next line, so nothing sits between.
   *
   * If `RemoteRunnerChannel` ever gained a brokered route, this stops being an
   * error and an unused `@ts-expect-error` is itself an error — the assertion
   * cannot rot into a tautology.
   */
  it("cannot be named at a call site typed the way the drains are typed", () => {
    const { channel } = scriptedChannel({});
    // @ts-expect-error the channel the evidence path takes carries no broker route.
    const forbidden = () => channel.call("/broker/drain", { method: "POST" });
    expect(forbidden).toBeTypeOf("function");
  });

  /**
   * The observed half. A whole pull is run and every route it asked for is
   * recorded — so this is the capability being absent in fact, not a flag being
   * read. A fourth drain added beside the three would appear here.
   */
  it("asks only for evidence routes across a whole pull", async () => {
    const { channel, asked } = scriptedChannel({
      "/telemetry/drain": { events: [], dropped: 0 },
      "/artifacts/drain": { artifacts: [], dropped: 0 },
      "/workspace-artifacts": { artifacts: [] },
    });
    await pullEvidence(channel, { source: "host-1", kind: "another_machine", log: () => {} });

    expect(asked.length).toBeGreaterThan(0);
    for (const route of asked) {
      expect(EVIDENCE_ROUTES).toContain(route);
    }
    for (const route of BROKER_ROUTES) {
      expect(asked).not.toContain(route);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * What the record says about itself
 * ---------------------------------------------------------------------- */

describe("the record of DASH's own reading", () => {
  it("keeps one row per source and overwrites it, because this is a state", () => {
    recordEvidencePull({
      source: "local",
      kind: "this_machine",
      observed_at: "2026-08-07T09:00:00.000Z",
      reached: true,
      telemetry_dropped: 0,
      artifacts_dropped: 0,
      workspace_truncated: false,
    });
    recordEvidencePull({
      source: "local",
      kind: "this_machine",
      observed_at: "2026-08-07T09:05:00.000Z",
      reached: true,
      telemetry_dropped: 12,
      artifacts_dropped: 0,
      workspace_truncated: false,
    });

    expect(readEvidencePulls()).toEqual([
      {
        source: "local",
        kind: "this_machine",
        observed_at: "2026-08-07T09:05:00.000Z",
        reached: true,
        telemetry_dropped: 12,
        artifacts_dropped: 0,
        workspace_truncated: false,
      },
    ]);
  });

  /**
   * Production asks the producer.
   *
   * The assertion worth having is not that `RunsView` can carry a notice — it
   * is that `runsView` reads the pull record without being handed a stub, which
   * is the wiring `resolveArtifactAvailability` needed a follow-up to get right.
   */
  it("reaches the Runs view through the reader production uses", () => {
    recordEvidencePull({
      source: "host-1",
      kind: "another_machine",
      observed_at: "2026-08-07T09:00:00.000Z",
      reached: true,
      telemetry_dropped: 0,
      artifacts_dropped: 0,
      workspace_truncated: false,
    });

    const view = runsView();
    expect(view.evidence).not.toBeNull();
    expect(view.evidence?.standing).toBe(true);
  });

  it("says nothing when the only source is this machine and nothing was lost", () => {
    recordEvidencePull({
      source: "local",
      kind: "this_machine",
      observed_at: "2026-08-07T09:00:00.000Z",
      reached: true,
      telemetry_dropped: 0,
      artifacts_dropped: 0,
      workspace_truncated: false,
    });
    expect(runsView().evidence).toBeNull();
  });
});
