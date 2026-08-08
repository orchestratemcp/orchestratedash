/**
 * The import-time refusal ADR 0006 mandates (MAR-482).
 *
 * "A manifest that asks for both is a contradiction DASH must refuse at
 * import, not discover at runtime." Both halves of that sentence are asserted
 * here: the contradictory manifest is refused at the store's import door with
 * plain-language copy, and the shapes the ADR calls legal — a remote agent
 * holding its own sign-ins, a local agent with DASH-managed connections —
 * still import exactly as before.
 *
 * The contradictory fixture is built by mutation rather than shipped, on
 * purpose: under this refusal, a contradictory file in `examples/` would be an
 * example DASH itself refuses to import, which is why
 * `dash-managed.manifest.v2.example.json` became a local worker in the same
 * change.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-constraints-"));
process.env.DASH_DATA_DIR = dataDir;

const {
  checkManifestConstraints,
  INVALID_AGENT_FOLDER_NAME_PHRASE,
  REMOTE_DASH_MANAGED_PHRASE,
} = await import("../lib/manifest-constraints");
const { explainImportFailure } = await import("../lib/import-feedback");
const { importManifest, resetStore } = await import("../lib/store");
const { closeDb } = await import("../lib/db");

function example(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8"));
}

/**
 * The shipped local example, mutated back into the contradiction: a runtime
 * declared away from this computer, still asking DASH to manage a connection.
 */
function remoteWithDashManaged(): Record<string, unknown> {
  const manifest = example("dash-managed.manifest.v2.example.json") as {
    agent_dom: {
      runtime: { class: string; label: string };
      locations: { runtime: { kind: string; label: string } };
    };
  };
  manifest.agent_dom.runtime.class = "managed_worker";
  manifest.agent_dom.runtime.label = "Remote report worker";
  manifest.agent_dom.locations.runtime.kind = "remote";
  manifest.agent_dom.locations.runtime.label = "Remote report worker";
  return manifest as unknown as Record<string, unknown>;
}

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * The rule
 * ---------------------------------------------------------------------- */

describe("checkManifestConstraints", () => {
  it("refuses a remote runtime with a DASH-managed connection", () => {
    const errors = checkManifestConstraints(
      remoteWithDashManaged() as unknown as Parameters<typeof checkManifestConstraints>[0],
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(REMOTE_DASH_MANAGED_PHRASE);
    // The connection's display label, so a manifest with several names the
    // ones at issue rather than making the author diff their own file.
    expect(errors[0]).toContain("Project updates");
  });

  it("allows a remote runtime whose connections are all the agent's own", () => {
    const manifest = remoteWithDashManaged() as {
      agent_dom: { connections: Array<{ ownership: string }> };
    };
    for (const connection of manifest.agent_dom.connections) {
      connection.ownership = "agent_managed";
    }
    expect(
      checkManifestConstraints(manifest as Parameters<typeof checkManifestConstraints>[0]),
    ).toEqual([]);
  });

  it("allows a local runtime with DASH-managed connections, however long it runs", () => {
    // The shipped example: local, always on, continues when DASH is closed,
    // one DASH-managed connection. ADR 0006 calls this legal and
    // under-explained — the pre-grant sentence is its answer, not a refusal.
    const manifest = example("dash-managed.manifest.v2.example.json");
    expect(
      checkManifestConstraints(manifest as Parameters<typeof checkManifestConstraints>[0]),
    ).toEqual([]);
  });

  it("has nothing to say about a v1 manifest", () => {
    const manifest = example("agent.manifest.example.json");
    expect(
      checkManifestConstraints(manifest as Parameters<typeof checkManifestConstraints>[0]),
    ).toEqual([]);
  });

  it("applies the component guard to both manifest versions", () => {
    for (const file of [
      "agent.manifest.example.json",
      "gmail-meeting-assistant.manifest.v2.example.json",
    ]) {
      const manifest = example(file) as { agent: { name: string } };
      manifest.agent.name = "con";
      expect(
        checkManifestConstraints(
          manifest as unknown as Parameters<typeof checkManifestConstraints>[0],
        ).join(" "),
      ).toContain(INVALID_AGENT_FOLDER_NAME_PHRASE);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The door
 * ---------------------------------------------------------------------- */

describe("importManifest under the constraint", () => {
  it("refuses the contradiction at import, not at runtime", () => {
    const result = importManifest(remoteWithDashManaged());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain(REMOTE_DASH_MANAGED_PHRASE);
  });

  it("still imports the shipped examples", () => {
    expect(importManifest(example("dash-managed.manifest.v2.example.json")).ok).toBe(true);
    expect(importManifest(example("gmail-meeting-assistant.manifest.v2.example.json")).ok).toBe(
      true,
    );
    expect(importManifest(example("agent-managed.manifest.v2.example.json")).ok).toBe(true);
  });

  it("refuses a name it cannot make into the authoritative folder", () => {
    const manifest = example("agent.manifest.example.json") as { agent: { name: string } };
    manifest.agent.name = "con";
    const result = importManifest(manifest);
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? "" : result.errors.join(" ")).toContain(INVALID_AGENT_FOLDER_NAME_PHRASE);
  });
});

/* ---------------------------------------------------------------------- *
 * The sentence
 * ---------------------------------------------------------------------- */

describe("what the refusal says", () => {
  it("explains the contradiction in plain language, with the raw errors kept", () => {
    const result = importManifest(remoteWithDashManaged());
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const explanation = explainImportFailure(result.errors);
    expect(explanation.kind).toBe("remote_agent_dash_connections");
    expect(explanation.headline).toContain("runs on another computer");
    expect(explanation.headline).toContain("manage sign-ins");
    expect(explanation.suggestion).toContain("on this computer");
    expect(explanation.raw).toEqual(result.errors);
  });

  it("passes the plain-language rule", () => {
    const explanation = explainImportFailure(
      checkManifestConstraints(
        remoteWithDashManaged() as unknown as Parameters<typeof checkManifestConstraints>[0],
      ),
    );
    // The raw errors are exempt, as Ajv's are — they are shown as the
    // validator's own words, never as the headline.
    expectPlainLanguage([explanation.headline, explanation.suggestion]);
  });

  it("explains an unsafe folder name without silently proposing a rename", () => {
    const manifest = example("agent.manifest.example.json") as { agent: { name: string } };
    manifest.agent.name = "con";
    const explanation = explainImportFailure(
      checkManifestConstraints(
        manifest as unknown as Parameters<typeof checkManifestConstraints>[0],
      ),
    );
    expect(explanation.kind).toBe("invalid_agent_folder_name");
    expect(explanation.headline).toContain("folder");
    expect(explanation.suggestion).toContain("will not silently rename");
    expectPlainLanguage([explanation.headline, explanation.suggestion]);
  });
});
