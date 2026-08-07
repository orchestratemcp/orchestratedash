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
const { putAgentDomState } = await import("../lib/agent-dom/store");
const { writeRegistration } = await import("../lib/registration");
const {
  agentOrigin,
  agentsView,
  connectionsView,
  runView,
  runsView,
  workInboxView,
  workspaceView,
} = await import("../lib/views/build");

function example(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8"));
}

const manifest = example("agent.manifest.example.json");
const v2Manifest = example("dash-managed.manifest.v2.example.json");
const workspaceManifest = example("gmail-meeting-assistant.manifest.v2.example.json");
const workspaceState = example("gmail-meeting-assistant.state.example.json");
const violatingRun = example("run-events.gate-violation.example.json") as unknown[];
const BEFORE_WORK_EXPIRY = new Date("2026-07-16T10:00:00Z");

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
    // `damage: null` rather than an absent key: an intact store states that it
    // is intact. See `tests/store-damage.test.ts` for the other branch.
    expect(agentsView()).toEqual({ agents: [], damage: null });
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

describe("workspaceView", () => {
  it("distinguishes an absent agent from an imported agent with no live state", () => {
    expect(workspaceView("nobody", BEFORE_WORK_EXPIRY)).toEqual({ found: false });

    importManifest(workspaceManifest);
    const view = workspaceView("synthetic-gmail-meeting-assistant", BEFORE_WORK_EXPIRY);
    expect(view).toMatchObject({
      found: true,
      title: "Meeting Assistant",
      snapshot: null,
    });
  });

  it("projects the live workspace, exact approval effect and only targetable run controls", () => {
    importManifest(workspaceManifest);
    expect(putAgentDomState(workspaceState).ok).toBe(true);

    const view = workspaceView("synthetic-gmail-meeting-assistant", BEFORE_WORK_EXPIRY);
    expect(view.found).toBe(true);
    if (!view.found || view.snapshot === null) {
      return;
    }

    expect(view.snapshot.overview.next_action).toBe("Review 1 item waiting for you");
    expect(view.snapshot.inbox[0]).toMatchObject({
      kind: "approval",
      action_id: "action-create-invite-draft",
      action_label: "Create invite and save Gmail draft",
    });
    expect(view.snapshot.runs[0]?.controls.map(({ command }) => command)).toEqual([
      "cancel",
    ]);
    expect(view.snapshot.memory[0]).toMatchObject({
      retention: "user_approved",
      provenance: "User approved this preference on 2026-07-10",
    });
    expect(view.snapshot.audit_events[0]).not.toHaveProperty("detail");
  });

  it("builds one cross-agent inbox without reading unrelated workspace documents", () => {
    importManifest(workspaceManifest);
    const live = structuredClone(workspaceState) as {
      choices: Array<Record<string, unknown>>;
    };
    delete live.choices[0]?.["selected_option_id"];
    expect(putAgentDomState(live).ok).toBe(true);

    const view = workInboxView(BEFORE_WORK_EXPIRY);
    expect(view.items.map(({ kind }) => kind)).toEqual(["approval", "choice"]);
    expect(view.items.every((item) => item.agent === "synthetic-gmail-meeting-assistant")).toBe(
      true,
    );
  });

  it("surfaces a scheduled agent past its window as stalled, separately from choices and approvals (MAR-441)", () => {
    // v2Manifest declares `trigger: { type: "schedule", expected_interval_seconds: 259200 }`.
    importManifest(v2Manifest);
    const lastActivityAt = "2026-07-10T08:05:00Z";
    expect(
      putAgentDomState({
        state_version: 1,
        manifest_version: 2,
        agent_id: "synthetic-project-reporter",
        observed_at: "2026-07-10T08:00:00Z",
        status: "ready",
        connections: [],
        runs: [
          {
            id: "run-1",
            status: "completed",
            started_at: "2026-07-10T08:00:00Z",
            finished_at: lastActivityAt,
            progress: 1,
          },
        ],
        tasks: [],
        choices: [],
        actions: [],
        approval_requests: [],
        approval_decisions: [],
        memory: [],
        audit_events: [],
        plan_vs_actual: {
          run_id: "run-1",
          planned_components: [],
          executed_components: [],
          deviations: [],
        },
      }).ok,
    ).toBe(true);

    // Ten days later — well past the 3-day expected interval.
    const view = workInboxView(new Date("2026-07-20T08:00:00Z"));
    expect(view.stalled).toEqual([
      {
        agent: "synthetic-project-reporter",
        agent_title: "Project Reporter",
        last_activity_at: lastActivityAt,
        next_action: "Check why this agent hasn't run when scheduled",
      },
    ]);
    // Stalled is reported separately from choices/approvals, not folded into them.
    expect(view.items).toEqual([]);
  });
});

describe("every view", () => {
  it("survives the boundary it has to cross", () => {
    importManifest(manifest);
    importManifest(v2Manifest);
    ingestEvents(violatingRun);
    addRegistration("email-lead-to-crm", "dash_handoff");
    importManifest(workspaceManifest);
    putAgentDomState(workspaceState);

    const views: unknown[] = [
      agentsView(),
      runsView(),
      connectionsView(),
      workInboxView(BEFORE_WORK_EXPIRY),
      workspaceView("synthetic-gmail-meeting-assistant", BEFORE_WORK_EXPIRY),
      workspaceView("nobody", BEFORE_WORK_EXPIRY),
      runView("email-lead-to-crm", "run-gate-violation-demo"),
      runView("nobody", "no-such-run"),
    ];

    for (const view of views) {
      assertJsonShaped(view);
      expect(() => structuredClone(view)).not.toThrow();
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Artifacts and permissions in the views (MAR-457)
 * ---------------------------------------------------------------------- */

describe("what a run produced", () => {
  const artifact = {
    artifact_version: 1,
    agent: "email-lead-to-crm",
    run_id: "run-artifact-1",
    artifact_id: "digest-1",
    kind: "digest",
    title: "Today",
    generated_at: "2026-08-01T09:00:00.000Z",
    sources_fetched: [
      { source_name: "A feed", source_url: "https://example.com/feed", status: "ok" },
    ],
    items: [{ headline: "Something", source_url: "https://example.com/feed" }],
  };

  function seedRun(): void {
    importManifest(manifest);
    ingestEvents([
      {
        event_version: 1,
        agent: "email-lead-to-crm",
        run_id: "run-artifact-1",
        seq: 0,
        ts: "2026-08-01T09:00:00.000Z",
        type: "run_started",
      },
    ]);
  }

  it("carries the digest and its grounding on the run view", async () => {
    const { ingestArtifacts } = await import("../lib/store");
    seedRun();
    expect(ingestArtifacts(artifact).accepted).toBe(1);

    const view = runView("email-lead-to-crm", "run-artifact-1");
    expect(view.found).toBe(true);
    if (!view.found) return;

    expect(view.artifacts).toHaveLength(1);
    expect(view.grounding?.verdict).toBe("grounded");
    // The two verdicts travel together and stay separate. A page must be able
    // to render one without the other having touched it.
    expect(view.analysis).not.toHaveProperty("grounding");
  });

  it("carries a real availability state onto the run view's artifact cards (MAR-434)", async () => {
    /*
     * `lib/views/build.ts` used to call `buildArtifactCards` with no resolver at
     * all, so every card read `available` no matter what the runner had
     * observed. This drives the actual producer — `syncWorkspaceArtifacts`
     * writing a `workspace_artifacts` row, `resolveArtifactAvailability`
     * reading it back — through `runView`, rather than a stub resolver passed
     * straight to `buildArtifactCards`. A stub would prove the view model can
     * represent "moved"; it would not prove production ever asks.
     */
    const { ingestArtifacts, syncWorkspaceArtifacts } = await import("../lib/store");
    seedRun();
    expect(ingestArtifacts(artifact).accepted).toBe(1);
    expect(
      syncWorkspaceArtifacts({
        artifact_id: "digest-1",
        agent: "email-lead-to-crm",
        run_id: "run-artifact-1",
        task_id: "task-1",
        sha256: "a".repeat(64),
        registered_at: "2026-08-01T09:00:01.000Z",
        availability: "moved",
        availability_detail: "found in a sibling folder",
      }).accepted,
    ).toBe(1);

    const view = runView("email-lead-to-crm", "run-artifact-1");
    expect(view.found).toBe(true);
    if (!view.found) return;

    expect(view.artifact_cards).toHaveLength(1);
    expect(view.artifact_cards[0]!.availability).toBe("moved");
    expect(view.artifact_cards[0]!.recovery).not.toBeNull();
  });

  /**
   * The same wiring, on the surface a person actually opens (MAR-434).
   *
   * The agent workspace rendered `latest_digest` and nothing else, so an agent
   * that wrote a digest *and* a reply showed one of them — the defect MAR-434
   * had already corrected on the run detail page and not here. And like the run
   * view before it was wired, the workspace had no availability at all.
   *
   * This drives the real producer end to end for the same reason the test above
   * does: a stub resolver would prove the view model can hold "moved", not that
   * this view asks for it.
   */
  it("carries every output of the latest run onto the workspace, with real availability", async () => {
    const { ingestArtifacts, syncWorkspaceArtifacts } = await import("../lib/store");
    // `seedRun` imports the manifest, which is what the workspace needs before
    // it will report `found` at all.
    seedRun();
    expect(ingestArtifacts(artifact).accepted).toBe(1);
    expect(
      syncWorkspaceArtifacts({
        artifact_id: "digest-1",
        agent: "email-lead-to-crm",
        run_id: "run-artifact-1",
        task_id: "task-1",
        sha256: "a".repeat(64),
        registered_at: "2026-08-01T09:00:01.000Z",
        availability: "quarantined",
        availability_detail: "held by this computer's security software",
      }).accepted,
    ).toBe(1);

    const view = workspaceView("email-lead-to-crm");
    expect(view.found).toBe(true);
    if (!view.found) return;

    expect(view.outputs).toHaveLength(1);
    expect(view.outputs[0]!.availability).toBe("quarantined");
    // A quarantined output's next action is not "run it again" — re-running
    // produces another file taken the same way.
    expect(view.outputs[0]!.recovery).not.toBeNull();
    expect(view.outputs_run_id).toBe("run-artifact-1");
  });

  it("gives a workspace with no outputs an empty list rather than a missing one", () => {
    seedRun();

    const view = workspaceView("email-lead-to-crm");
    expect(view.found).toBe(true);
    if (!view.found) return;

    // Empty, not absent: the panel says "this run produced nothing", which is a
    // different thing to learn from a panel that is not drawn.
    expect(view.outputs).toEqual([]);
    expect(view.outputs_run_id).toBeNull();
  });

  it("gives a run that produced nothing an empty list and no verdict", async () => {
    seedRun();
    const view = runView("email-lead-to-crm", "run-artifact-1");
    expect(view.found).toBe(true);
    if (!view.found) return;

    // Not null-and-a-verdict, and not a verdict over an absent digest: there is
    // nothing to judge, so nothing is claimed about it.
    expect(view.artifacts).toEqual([]);
    expect(view.grounding).toBeNull();
  });

  it("keeps the newest digest on the workspace, outliving the agent's snapshot", async () => {
    const { ingestArtifacts } = await import("../lib/store");
    importManifest(manifest);
    expect(ingestArtifacts(artifact).accepted).toBe(1);

    // No Agent DOM state at all — the agent is stopped, or has not published
    // yet. The digest is DASH's own record and must survive that.
    const view = workspaceView("email-lead-to-crm");
    expect(view.found).toBe(true);
    if (!view.found) return;

    expect(view.snapshot).toBeNull();
    expect(view.latest_digest?.artifact_id).toBe("digest-1");
    expect(view.latest_digest_grounding?.verdict).toBe("grounded");
  });

  it("stays structured-clone safe with a digest attached", async () => {
    const { ingestArtifacts } = await import("../lib/store");
    seedRun();
    ingestArtifacts(artifact);

    // The property this whole file exists to protect: these cross
    // contextBridge, which clones. A Date reaching a view throws in the
    // packaged app and nowhere else.
    expect(() => structuredClone(runView("email-lead-to-crm", "run-artifact-1"))).not.toThrow();
    expect(() => structuredClone(workspaceView("email-lead-to-crm"))).not.toThrow();
  });
});

describe("declared permissions", () => {
  it("reach the workspace view as the manifest wrote them", () => {
    importManifest(manifest);
    const view = workspaceView("email-lead-to-crm");
    expect(view.found).toBe(true);
    if (!view.found) return;

    // The v1 example declares none, and the honest answer is an empty list
    // rather than an invented one.
    expect(view.permissions).toEqual([]);
  });
});
