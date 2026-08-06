/**
 * DASH's side of the availability seam (MAR-434).
 *
 * The runner is the authority on where an artifact's bytes are;
 * `runner/workspace.ts` and `tests/task-workspace.test.ts` are that half. This
 * file covers the copy DASH keeps in order to render without opening a socket,
 * and the one function the Outputs panel actually calls.
 *
 * MAR-434's design slice shipped `resolveAvailability` as a parameter with an
 * honest default — production passed nothing and every output read as
 * `available`, which was true because nothing could yet be otherwise. What is
 * asserted here is that production now passes something, and that the something
 * is still honest about the artifacts it knows nothing about.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-availability-"));
process.env.DASH_DATA_DIR = dataDir;

const {
  resetStore,
  resolveArtifactAvailability,
  syncWorkspaceArtifacts,
  workspaceArtifactsForRun,
} = await import("../lib/store");
const { closeDb } = await import("../lib/db");

const AGENT = "offert-agent";
const RUN = "run-2026-08-06-01";

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifact_id: "art_0123456789abcdef0123456789abcdef",
    agent: AGENT,
    run_id: RUN,
    task_id: "task_0123456789abcdef0123456789abcdef",
    role: "finished_offert",
    display_name: "offert.pdf",
    media_type: "application/pdf",
    byte_size: 2048,
    sha256: "a".repeat(64),
    registered_at: "2026-08-06T09:00:00.000Z",
    retention: "kept",
    availability: "available",
    availability_detail: null,
    observed_at: "2026-08-06T09:00:05.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("taking up the runner's picture", () => {
  it("stores a record and reads it back on the run it belongs to", () => {
    expect(syncWorkspaceArtifacts([record()])).toMatchObject({ accepted: 1, rejected: [] });

    const artifacts = workspaceArtifactsForRun(AGENT, RUN);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      display_name: "offert.pdf",
      sha256: "a".repeat(64),
      availability: "available",
      // The runner's own observation time, not DASH's write time. Attributing
      // one to the other is the small promotion `received_at` exists to stop.
      observed_at: "2026-08-06T09:00:05.000Z",
    });
  });

  it("updates availability in place rather than growing a second row", () => {
    syncWorkspaceArtifacts([record()]);
    syncWorkspaceArtifacts([
      record({
        availability: "moved",
        availability_detail: "found elsewhere",
        observed_at: "2026-08-06T09:05:00.000Z",
      }),
    ]);

    const artifacts = workspaceArtifactsForRun(AGENT, RUN);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      availability: "moved",
      availability_detail: "found elsewhere",
      observed_at: "2026-08-06T09:05:00.000Z",
    });
  });

  it("refuses a record whose agent does not match the runner-hosted source", () => {
    // The same binding `ingestArtifacts` applies. An output attributed to the
    // wrong agent is a file a person would go looking for on the wrong page.
    const result = syncWorkspaceArtifacts([record()], { sourceAgents: ["someone-else"] });
    expect(result.accepted).toBe(0);
    expect(result.rejected[0]?.errors[0]).toContain("must match the runner-hosted source");
    expect(workspaceArtifactsForRun(AGENT, RUN)).toHaveLength(0);
  });

  it("rejects one malformed record without discarding its neighbours", () => {
    const result = syncWorkspaceArtifacts([
      record({ artifact_id: "art_aaaa" }),
      { nonsense: true },
      record({ artifact_id: "art_bbbb" }),
    ]);
    expect(result.accepted).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.index).toBe(1);
  });

  it("degrades an availability it has never heard of to missing", () => {
    // A runner build newer than this DASH is the case `RUNNER_BUILD_ID` exists
    // for. An unknown state must not reach a page that has no copy for it, and
    // `missing` is the state whose recovery is right for the most things that
    // could have gone wrong.
    syncWorkspaceArtifacts([record({ availability: "evaporated" })]);
    expect(workspaceArtifactsForRun(AGENT, RUN)[0]?.availability).toBe("missing");
  });

  it("drops a record with no identity rather than inventing one", () => {
    expect(syncWorkspaceArtifacts([record({ artifact_id: "" })]).accepted).toBe(0);
    expect(syncWorkspaceArtifacts([record({ sha256: undefined })]).accepted).toBe(0);
  });
});

describe("resolveArtifactAvailability", () => {
  it("answers with the state the runner reported", () => {
    syncWorkspaceArtifacts([
      record({ artifact_id: "art_gone", availability: "missing" }),
      record({ artifact_id: "art_held", availability: "quarantined" }),
      record({ artifact_id: "art_here", availability: "available" }),
    ]);

    const resolve = resolveArtifactAvailability(AGENT, RUN);
    expect(resolve("art_gone")).toBe("missing");
    expect(resolve("art_held")).toBe("quarantined");
    expect(resolve("art_here")).toBe("available");
  });

  it("calls an artifact it has never heard of available, on purpose", () => {
    // Almost every artifact in DASH is a MAR-457 *body* in `run_artifacts`:
    // there is no file, so there is nothing that could be missing. Reporting
    // those as missing because they are absent from a table about files would
    // turn every existing digest on every existing run page red.
    const resolve = resolveArtifactAvailability(AGENT, RUN);
    expect(resolve("digest-2026-08-06")).toBe("available");
  });

  it("does not answer for another run's artifact", () => {
    syncWorkspaceArtifacts([record({ artifact_id: "art_other", run_id: "run-other" })]);
    // Scoped to the run whose page is being rendered, so one run's deleted
    // output cannot grey out another run's.
    expect(resolveArtifactAvailability(AGENT, RUN)("art_other")).toBe("available");
    expect(resolveArtifactAvailability(AGENT, "run-other")("art_other")).toBe("available");
    syncWorkspaceArtifacts([
      record({ artifact_id: "art_other", run_id: "run-other", availability: "deleted" }),
    ]);
    expect(resolveArtifactAvailability(AGENT, "run-other")("art_other")).toBe("deleted");
    expect(resolveArtifactAvailability(AGENT, RUN)("art_other")).toBe("available");
  });
});
