import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The store resolves its directory once at import time, so point it at a
// throwaway folder before importing it.
const dataDir = mkdtempSync(path.join(tmpdir(), "dash-store-"));
process.env.DASH_DATA_DIR = dataDir;

const { importManifest, ingestEvents, listAgents, listRuns, resetStore } =
  await import("../lib/store");
const { closeDb } = await import("../lib/db");

function example(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8"));
}

const manifest = example("agent.manifest.example.json");
const runEvent = example("run-event.example.json");

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  // The database handle has to be released before the directory can go: an
  // open SQLite file is a real handle now, where the JSON store left nothing
  // behind between calls.
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("manifest import", () => {
  it("accepts the bundled v1 example", () => {
    const result = importManifest(manifest);
    expect(result).toMatchObject({ ok: true, agent: "email-lead-to-crm" });
  });

  it("surfaces it on the agents list with plan metadata", () => {
    importManifest(manifest);
    const agents = listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: "email-lead-to-crm",
      planned_steps: 8,
      automation_clearance: "L3",
      run_count: 0,
    });
  });

  it("replaces rather than duplicates on re-import", () => {
    importManifest(manifest);
    const second = importManifest(manifest);
    expect(second).toMatchObject({ ok: true, replaced: true });
    expect(listAgents()).toHaveLength(1);
  });

  it("rejects a manifest that fails the v1 schema", () => {
    const result = importManifest({ manifest_version: 1 });
    expect(result.ok).toBe(false);
  });

  it("keeps unknown fields rather than rejecting them", () => {
    const additive = { ...(manifest as object), future_field: "ignored" };
    expect(importManifest(additive).ok).toBe(true);
  });
});

describe("event ingest", () => {
  it("accepts the bundled v1 example event", () => {
    expect(ingestEvents(runEvent)).toEqual({ accepted: 1, rejected: [] });
  });

  it("accepts a batch and validates each item independently", () => {
    const result = ingestEvents([runEvent, { event_version: 1 }]);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.index).toBe(1);
  });

  it("binds runner-hosted telemetry to the child that emitted it", () => {
    const result = ingestEvents(
      [
        runEvent,
        { ...(runEvent as object), agent: "another-agent", seq: 1 },
      ],
      { sourceAgents: ["email-lead-to-crm", "email-lead-to-crm"] },
    );

    expect(result).toEqual({
      accepted: 1,
      rejected: [
        {
          index: 1,
          errors: ["/agent must match the runner-hosted source"],
        },
      ],
    });
  });

  it("rejects an event from an unsupported version", () => {
    const result = ingestEvents({ ...(runEvent as object), event_version: 2 });
    expect(result.accepted).toBe(0);
  });
});

describe("run reconstruction", () => {
  const base = {
    event_version: 1 as const,
    agent: "email-lead-to-crm",
    run_id: "run-1",
  };

  it("groups events into a run and reports it as running", () => {
    ingestEvents([
      { ...base, seq: 0, ts: "2026-07-04T09:15:00Z", type: "run_started" },
      { ...base, seq: 1, ts: "2026-07-04T09:15:05Z", type: "step_started" },
    ]);

    const runs = listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      run_id: "run-1",
      status: "running",
      event_count: 2,
      has_sequence_gap: false,
    });
  });

  it("marks a run completed and then failed by terminal event", () => {
    ingestEvents([
      { ...base, seq: 0, ts: "2026-07-04T09:15:00Z", type: "run_started" },
      { ...base, seq: 1, ts: "2026-07-04T09:16:00Z", type: "run_completed" },
    ]);
    expect(listRuns()[0]?.status).toBe("completed");

    resetStore();
    ingestEvents([
      { ...base, seq: 0, ts: "2026-07-04T09:15:00Z", type: "run_started" },
      { ...base, seq: 1, ts: "2026-07-04T09:16:00Z", type: "run_failed" },
    ]);
    expect(listRuns()[0]?.status).toBe("failed");
  });

  it("flags a gap in sequence numbers", () => {
    ingestEvents([
      { ...base, seq: 0, ts: "2026-07-04T09:15:00Z", type: "run_started" },
      { ...base, seq: 4, ts: "2026-07-04T09:15:30Z", type: "step_started" },
    ]);
    expect(listRuns()[0]?.has_sequence_gap).toBe(true);
  });

  it("accepts events for an agent whose manifest is not imported, and says so", () => {
    ingestEvents(runEvent);
    expect(listRuns()[0]?.known_agent).toBe(false);

    importManifest(manifest);
    expect(listRuns()[0]?.known_agent).toBe(true);
  });

  it("separates runs belonging to different agents", () => {
    ingestEvents([
      { ...base, seq: 0, ts: "2026-07-04T09:15:00Z", type: "run_started" },
      {
        ...base,
        agent: "other-agent",
        seq: 0,
        ts: "2026-07-04T09:15:00Z",
        type: "run_started",
      },
    ]);
    expect(listRuns()).toHaveLength(2);
  });

  it("counts runs per agent on the agents list", () => {
    importManifest(manifest);
    ingestEvents([
      { ...base, seq: 0, ts: "2026-07-04T09:15:00Z", type: "run_started" },
      {
        ...base,
        run_id: "run-2",
        seq: 0,
        ts: "2026-07-04T10:00:00Z",
        type: "run_started",
      },
    ]);
    expect(listAgents()[0]?.run_count).toBe(2);
  });
});
