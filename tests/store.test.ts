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

const {
  findHostByConnection,
  forgetHost,
  importManifest,
  ingestEvents,
  listAgents,
  listRuns,
  pinHostFingerprint,
  readAgentFavourites,
  readHost,
  readStore,
  renameAgent,
  resetStore,
  saveHost,
  setAgentAvatar,
  setAgentFavourite,
} = await import("../lib/store");
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

describe("agent rename (MAR-589)", () => {
  const agentId = "email-lead-to-crm";

  it("changes the title listAgents reports, and nothing else", () => {
    importManifest(manifest);
    const before = listAgents()[0];

    expect(renameAgent(agentId, "Lead Router")).toEqual({ ok: true });

    const after = listAgents()[0];
    expect(after?.title).toBe("Lead Router");
    // Nothing about the underlying manifest projection moved.
    expect(after?.name).toBe(before?.name);
    expect(after?.goal).toBe(before?.goal);
  });

  it("survives a re-import, unlike avatar it is not — the manifest's own display_name is what a rename must outrank", () => {
    importManifest(manifest);
    renameAgent(agentId, "Lead Router");
    importManifest(manifest);
    expect(listAgents()[0]?.title).toBe("Lead Router");
  });

  it("falls back to the manifest's own name once the rename is cleared", () => {
    importManifest(manifest);
    const original = listAgents()[0]?.title;
    renameAgent(agentId, "Lead Router");
    expect(renameAgent(agentId, undefined)).toEqual({ ok: true });
    expect(listAgents()[0]?.title).toBe(original);
  });

  it("trims whitespace and refuses a name that is blank once trimmed", () => {
    importManifest(manifest);
    expect(renameAgent(agentId, "  Lead Router  ")).toEqual({ ok: true });
    expect(listAgents()[0]?.title).toBe("Lead Router");
    expect(renameAgent(agentId, "   ").ok).toBe(false);
    // The blank attempt did not clear the rename that was already there.
    expect(listAgents()[0]?.title).toBe("Lead Router");
  });

  it("refuses an agent DASH has no record of", () => {
    const result = renameAgent("no-such-agent", "Anything");
    expect(result).toMatchObject({ ok: false });
  });
});

describe("agent favourites (MAR-640)", () => {
  const agentId = "email-lead-to-crm";

  it("is not starred until somebody stars it", () => {
    importManifest(manifest);
    expect(readAgentFavourites().has(agentId)).toBe(false);
  });

  it("stars and unstars, and a second write replaces the first rather than duplicating it", () => {
    importManifest(manifest);
    setAgentFavourite(agentId, true);
    expect(readAgentFavourites()).toEqual(new Set([agentId]));

    setAgentFavourite(agentId, false);
    expect(readAgentFavourites().has(agentId)).toBe(false);

    setAgentFavourite(agentId, true);
    setAgentFavourite(agentId, true);
    expect(readAgentFavourites()).toEqual(new Set([agentId]));
  });
});

describe("agent avatar (MAR-615)", () => {
  const agentId = "email-lead-to-crm";

  it("changes the character listAgents reports, and nothing else", () => {
    importManifest(manifest);
    const before = listAgents()[0];
    const next = before?.avatar === "ninja" ? "knight" : "ninja";

    expect(setAgentAvatar(agentId, next)).toEqual({ ok: true });

    const after = listAgents()[0];
    expect(after?.avatar).toBe(next);
    expect(after?.name).toBe(before?.name);
    expect(after?.title).toBe(before?.title);
  });

  it("refuses the chief — a picker offers O_FLEET, but a direct call is the real gate", () => {
    importManifest(manifest);
    const before = listAgents()[0]?.avatar;

    const result = setAgentAvatar(agentId, "chief" as Parameters<typeof setAgentAvatar>[1]);

    expect(result.ok).toBe(false);
    expect(listAgents()[0]?.avatar).toBe(before);
  });

  it("refuses an agent DASH has no record of", () => {
    const result = setAgentAvatar("no-such-agent", "ninja");
    expect(result).toMatchObject({ ok: false });
  });
});

describe("saved hosts", () => {
  const host = {
    host_id: "host-store-1",
    label: "My server",
    address: "vps.example.com",
    port: 22,
    username: "dash",
    key_name: "host-store-1",
    host_fingerprint: null,
    added_at: "2026-08-08T12:00:00.000Z",
  };

  it("persists an independently-addressed server with only a key name", () => {
    saveHost(host);

    expect(readHost(host.host_id)).toEqual(host);
    expect(readStore().hosts).toEqual({ [host.host_id]: host });
    expect(Object.keys(readStore().hosts[host.host_id] ?? {})).not.toEqual(
      expect.arrayContaining(["private_key", "key_path", "path"]),
    );
  });

  it("forgets the record and returns its internal key name for main to retire", () => {
    saveHost(host);

    expect(forgetHost(host.host_id)).toEqual(host);
    expect(readHost(host.host_id)).toBeNull();
  });

  /**
   * Resumability, at the point where a second key would have been minted
   * (MAR-572).
   *
   * The 2026-08-08 run walked the add-a-server steps four times against one box
   * because the wizard returned to step one on every failure, and each pass
   * minted a fresh key — leaving the previous one attached to nothing here and
   * its public half stale in the server's allowed-keys file. Matching on the
   * three facts that identify a way in is what lets main resume instead.
   */
  it("finds a saved server by how DASH reaches it, not by what it is called", () => {
    saveHost(host);

    expect(findHostByConnection({ address: host.address, port: 22, username: "dash" })).toEqual(
      host,
    );
    // The label is what a person calls it and may well change between attempts;
    // nothing points at it.
    expect(findHostByConnection({ address: host.address, port: 2222, username: "dash" })).toBeNull();
    expect(
      findHostByConnection({ address: host.address, port: 22, username: "someone-else" }),
    ).toBeNull();
    expect(
      findHostByConnection({ address: "other.example", port: 22, username: "dash" }),
    ).toBeNull();
  });

  /**
   * The pin is written once, and there is no path here that moves it.
   *
   * ADR 0007 requires a changed host key to fail closed. Once an enrollment
   * step exists, the way to keep that true is for the enrollment step to be
   * unable to re-enrol — so the update is conditional on the column still being
   * null, and a caller that tries again is told it did not happen rather than
   * quietly succeeding.
   */
  it("records a confirmed identity once and refuses to move it", () => {
    saveHost(host);

    expect(pinHostFingerprint(host.host_id, "SHA256:first")).toBe(true);
    expect(readHost(host.host_id)?.host_fingerprint).toBe("SHA256:first");

    expect(pinHostFingerprint(host.host_id, "SHA256:second")).toBe(false);
    expect(readHost(host.host_id)?.host_fingerprint).toBe("SHA256:first");
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
