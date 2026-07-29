/**
 * The view projections (MAR-432, DASH-20).
 *
 * These are the documents both hosts render from — the IPC read channel in the
 * packaged app, and the developer path's GET routes — so what is asserted here
 * is asserted for both. Two properties get most of the attention:
 *
 * - **What a view carries, and what it deliberately does not.** `agentsView`
 *   projects a registration down to three facts; the command line and the
 *   environment block behind it must not survive the trip.
 * - **Structured-clone safety.** These cross `contextBridge`, which clones. A
 *   `Date` or a `Map` sneaking into a view would throw at a boundary no unit
 *   test otherwise crosses, in the packaged app only.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-views-"));
process.env.DASH_DATA_DIR = dataDir;

const { importManifest, ingestEvents, resetStore } = await import("../lib/store");
const { closeDb } = await import("../lib/db");
const { writeRegistration } = await import("../lib/registration");
const { agentOrigin, agentsView, connectionsView, runView, runsView } = await import(
  "../lib/views/build"
);

function example(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8"));
}

const manifest = example("agent.manifest.example.json");
const v2Manifest = example("dash-managed.manifest.v2.example.json");
const violatingRun = example("run-events.gate-violation.example.json") as unknown[];

beforeEach(() => {
  resetStore();
  rmSync(path.join(dataDir, "agents"), { recursive: true, force: true });
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/**
 * Everything a view may contain, checked structurally.
 *
 * `structuredClone` would be the direct test, and it is used below — but it
 * accepts `Date` and `Map` happily, and those are exactly the values that would
 * arrive in the renderer as something other than what was sent. So this walks
 * the document and insists on JSON's vocabulary.
 */
function assertJsonShaped(value: unknown, at = "$"): void {
  if (value === null) {
    return;
  }
  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonShaped(item, `${at}[${String(index)}]`));
    return;
  }
  expect(kind, `${at} must be a plain value, not ${kind}`).toBe("object");
  expect(
    Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    `${at} must be a plain object, not a ${(value as object).constructor?.name ?? "class"} instance`,
  ).toBe(true);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    assertJsonShaped(item, `${at}.${key}`);
  }
}

function addRegistration(agentId: string, owner: "dash_handoff" | "external"): void {
  writeRegistration(dataDir, {
    registration: {
      agent_id: agentId,
      manifest_path: "unused",
      command: "dash:node",
      args: ["agent.mjs"],
      // The reason `AgentOriginView` is a projection: this must not reach a page.
      env: { AGENT_SECRET_TOKEN: "s3cret" },
    },
    ownership: {
      owner,
      display_name: "Lead router",
      summary: "Routes leads.",
      registered_at: new Date().toISOString(),
      source_project: path.join("C:", "Users", "someone", "projects", "lead-router"),
    },
    manifestJson: JSON.stringify(manifest),
  });
}

describe("agentsView", () => {
  it("is empty, not absent, when nothing has been imported", () => {
    expect(agentsView()).toEqual({ agents: [] });
  });

  it("carries what the agents list renders", () => {
    importManifest(manifest);
    ingestEvents(violatingRun);

    const view = agentsView();
    expect(view.agents).toHaveLength(1);
    const agent = view.agents[0];
    expect(agent?.name).toBe("email-lead-to-crm");
    expect(agent?.run_count).toBe(1);
    expect(agent?.compliance.gate_violation_runs).toBe(1);
  });

  it("never carries a registration's command line or environment", () => {
    importManifest(manifest);
    addRegistration("email-lead-to-crm", "dash_handoff");

    const serialized = JSON.stringify(agentsView());
    expect(serialized).not.toContain("AGENT_SECRET_TOKEN");
    expect(serialized).not.toContain("s3cret");
    expect(serialized).not.toContain("agent.mjs");
    expect(serialized).not.toContain("dash:node");
  });

  it("reports an imported agent nothing on this machine runs as watched only", () => {
    expect(agentOrigin(undefined)).toEqual({ kind: "watched_only" });

    importManifest(manifest);
    expect(agentsView().agents[0]?.origin.kind).toBe("watched_only");
  });

  it("names the folder an agent DASH added came from", () => {
    importManifest(manifest);
    addRegistration("email-lead-to-crm", "dash_handoff");

    const origin = agentsView().agents[0]?.origin;
    expect(origin?.kind).toBe("added_through_dash");
    expect(origin?.source_project).toContain("lead-router");
  });

  it("does not vouch for a hand-written registration's folder", () => {
    importManifest(manifest);
    addRegistration("email-lead-to-crm", "external");

    const origin = agentsView().agents[0]?.origin;
    expect(origin?.kind).toBe("set_up_by_hand");
    // DASH did not create the file and cannot say where it points.
    expect(origin?.source_project).toBeUndefined();
  });
});

describe("runsView", () => {
  it("attaches each run's analysis", () => {
    importManifest(manifest);
    ingestEvents(violatingRun);

    const view = runsView();
    expect(view.runs).toHaveLength(1);
    expect(view.runs[0]?.analysis?.compliant).toBe(false);
  });

  it("reports a run whose agent was never imported, with no analysis", () => {
    ingestEvents(violatingRun);

    const view = runsView();
    expect(view.runs[0]?.known_agent).toBe(false);
    expect(view.runs[0]?.analysis).toBeNull();
  });
});

describe("runView", () => {
  it("says a run is absent rather than throwing", () => {
    expect(runView("nobody", "no-such-run")).toEqual({ found: false });
  });

  it("joins the plan to what actually ran", () => {
    importManifest(manifest);
    ingestEvents(violatingRun);

    const view = runView("email-lead-to-crm", "run-gate-violation-demo");
    expect(view.found).toBe(true);
    if (!view.found) {
      return;
    }
    expect(view.manifest_imported).toBe(true);
    expect(view.planned_route.length).toBeGreaterThan(0);
    expect(view.planned_route.every((step) => typeof step.executed === "boolean")).toBe(true);
    expect(view.events.length).toBeGreaterThan(0);
  });

  it("names nothing as unplanned when there is no plan to be unplanned against", () => {
    ingestEvents(violatingRun);

    const view = runView("email-lead-to-crm", "run-gate-violation-demo");
    expect(view.found).toBe(true);
    if (!view.found) {
      return;
    }
    expect(view.manifest_imported).toBe(false);
    expect(view.unplanned_component_ids).toEqual([]);
    expect(view.planned_route).toEqual([]);
  });
});

describe("connectionsView", () => {
  it("keeps v1 agents out of the checklist and names them separately", () => {
    importManifest(manifest);

    const view = connectionsView();
    expect(view.agents).toEqual([]);
    expect(view.older_agent_names).toEqual(["email-lead-to-crm"]);
  });

  it("derives a v2 agent's requirements", () => {
    importManifest(v2Manifest);

    const view = connectionsView();
    expect(view.agents).toHaveLength(1);
    expect(view.agents[0]?.rows.length).toBeGreaterThan(0);
    expect(view.older_agent_names).toEqual([]);
  });
});

describe("every view", () => {
  it("survives the boundary it has to cross", () => {
    importManifest(manifest);
    importManifest(v2Manifest);
    ingestEvents(violatingRun);
    addRegistration("email-lead-to-crm", "dash_handoff");

    const views: unknown[] = [
      agentsView(),
      runsView(),
      connectionsView(),
      runView("email-lead-to-crm", "run-gate-violation-demo"),
      runView("nobody", "no-such-run"),
    ];

    for (const view of views) {
      assertJsonShaped(view);
      expect(() => structuredClone(view)).not.toThrow();
    }
  });
});
