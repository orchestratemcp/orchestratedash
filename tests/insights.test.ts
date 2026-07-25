import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The store resolves its directory once at import time, so point it at a
// throwaway folder before importing anything that touches it.
const dataDir = mkdtempSync(path.join(tmpdir(), "dash-insights-"));
process.env.DASH_DATA_DIR = dataDir;

const { importManifest, ingestEvents, resetStore } = await import("../lib/store");
const { closeDb } = await import("../lib/db");
const { analysisForRun, complianceForAgent, listAnalyzedRuns } = await import(
  "../lib/insights"
);

function example(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8"));
}

const manifest = example("agent.manifest.example.json");
const violatingRun = example(
  "run-events.gate-violation.example.json",
) as Array<Record<string, unknown>>;

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("analysisForRun", () => {
  it("judges the bundled violating run as non-compliant", () => {
    importManifest(manifest);
    ingestEvents(violatingRun);

    const analysis = analysisForRun("email-lead-to-crm", "run-gate-violation-demo");
    expect(analysis?.compliant).toBe(false);
    expect(analysis?.gate_violations.map((v) => v.component_id)).toEqual([
      "crm_note_write",
    ]);
    expect(analysis?.clearance_findings).toHaveLength(1);
  });

  it("returns null when the manifest has not been imported", () => {
    ingestEvents(violatingRun);
    expect(analysisForRun("email-lead-to-crm", "run-gate-violation-demo")).toBeNull();
  });

  it("returns null for a run that has no events", () => {
    importManifest(manifest);
    expect(analysisForRun("email-lead-to-crm", "no-such-run")).toBeNull();
  });
});

describe("listAnalyzedRuns", () => {
  it("attaches the verdict to each run summary", () => {
    importManifest(manifest);
    ingestEvents(violatingRun);

    const runs = listAnalyzedRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.run_id).toBe("run-gate-violation-demo");
    expect(runs[0]?.analysis?.gate_violations).toHaveLength(1);
  });

  it("leaves the verdict null for runs with no imported plan", () => {
    ingestEvents(violatingRun);
    expect(listAnalyzedRuns()[0]?.analysis).toBeNull();
  });
});

describe("complianceForAgent", () => {
  it("reports nothing to roll up before any run arrives", () => {
    importManifest(manifest);
    expect(complianceForAgent("email-lead-to-crm")).toEqual({
      runs_considered: 0,
      gate_violation_runs: 0,
      drifted_runs: 0,
      clearance_flagged_runs: 0,
    });
  });

  it("counts violating runs across the rollup window", () => {
    importManifest(manifest);
    ingestEvents(violatingRun);
    ingestEvents(
      violatingRun.map((event) => ({ ...event, run_id: "run-gate-violation-demo-2" })),
    );

    expect(complianceForAgent("email-lead-to-crm")).toMatchObject({
      runs_considered: 2,
      gate_violation_runs: 2,
      clearance_flagged_runs: 2,
    });
  });

  it("caps the rollup at the requested window", () => {
    importManifest(manifest);
    for (let index = 0; index < 4; index += 1) {
      ingestEvents(
        violatingRun.map((event) => ({ ...event, run_id: `run-${index}` })),
      );
    }

    expect(complianceForAgent("email-lead-to-crm", undefined, 2)).toMatchObject({
      runs_considered: 2,
    });
  });
});
