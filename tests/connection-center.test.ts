import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deriveConnectionRequirements } from "../lib/connections";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Same pattern as tests/store.test.ts: the store resolves its directory at
// import time, so redirect it before importing.
const dataDir = mkdtempSync(path.join(tmpdir(), "dash-connections-"));
process.env.DASH_DATA_DIR = dataDir;

const { importManifest, listAgents, listConnectionCapableAgents, resetStore } =
  await import("../lib/store");
const { closeDb } = await import("../lib/db");
const { readStoreBytes } = await import("./helpers/store-bytes");

function example(name: string): unknown {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8"));
}

const v1Manifest = example("agent.manifest.example.json");
const gmailV2 = example("gmail-meeting-assistant.manifest.v2.example.json");
const agentManagedV2 = example("agent-managed.manifest.v2.example.json");

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("importing a v2 manifest", () => {
  /**
   * The gap this closes: `lib/connections.ts` shipped able to derive a
   * checklist, but the only ingest path validated against v1 alone — so a v2
   * manifest, the only kind carrying declared connections, could not get into
   * DASH at all.
   */
  it("accepts a v2 manifest, which v1-only validation rejected", () => {
    expect(importManifest(gmailV2)).toMatchObject({
      ok: true,
      agent: "synthetic-gmail-meeting-assistant",
    });
  });

  it("still accepts v1 manifests", () => {
    expect(importManifest(v1Manifest)).toMatchObject({ ok: true });
  });

  it("reports the imported version on the agent summary", () => {
    importManifest(gmailV2);
    importManifest(v1Manifest);
    const versions = Object.fromEntries(
      listAgents().map((agent) => [agent.name, agent.manifest_version]),
    );
    expect(versions).toEqual({
      "synthetic-gmail-meeting-assistant": 2,
      "email-lead-to-crm": 1,
    });
  });

  it("stores the manifest verbatim, so declared connections survive the round trip", () => {
    importManifest(gmailV2);
    const [stored] = listConnectionCapableAgents();
    expect(stored?.manifest.agent_dom.connections?.map((c) => c.id)).toEqual(
      (gmailV2 as { agent_dom: { connections: Array<{ id: string }> } }).agent_dom.connections.map(
        (c) => c.id,
      ),
    );
  });

  /**
   * Version-specific errors. Validating a v2 document against v1 would report
   * "manifest_version must be equal to constant" and say nothing about the real
   * mistake, which is a bad first-run experience for an agent author.
   */
  it("reports errors against the version the document declared", () => {
    const broken = { ...(gmailV2 as object), agent_dom: {} };
    const result = importManifest(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).not.toMatch(/manifest_version/);
    }
  });

  it("names an unknown version instead of running it through the wrong schema", () => {
    const result = importManifest({ ...(gmailV2 as object), manifest_version: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("unsupported manifest_version 99");
    }
  });

  it("keeps unknown v2 fields, per the additive-versioning rule", () => {
    expect(importManifest({ ...(gmailV2 as object), future_field: "ignored" }).ok).toBe(true);
  });
});

describe("which agents can have a checklist", () => {
  /**
   * v1 agents are omitted rather than listed with an empty checklist. "Declares
   * no connections" and "is too old to declare any" are different claims, and
   * MAR-383's honesty rules turn on not making the first when you mean the
   * second.
   */
  it("excludes v1 agents entirely", () => {
    importManifest(v1Manifest);
    expect(listConnectionCapableAgents()).toEqual([]);
  });

  it("includes v2 agents, sorted by name", () => {
    importManifest(gmailV2);
    importManifest(agentManagedV2);
    const names = listConnectionCapableAgents().map((agent) => agent.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("synthetic-gmail-meeting-assistant");
  });
});

describe("the acceptance criterion, end to end through the store", () => {
  /**
   * MAR-383, stated: "Importing the Gmail example renders Gmail, Google
   * Calendar and model-provider rows." tests/connections.test.ts asserts this
   * against the example file; this asserts it survives an actual import, which
   * is the path a user takes.
   */
  it("importing the Gmail example yields Gmail, Google Calendar and model-provider rows", () => {
    importManifest(gmailV2);
    const [agent] = listConnectionCapableAgents();
    expect(agent).toBeDefined();
    const rows = deriveConnectionRequirements(agent!.manifest);
    expect(rows.map((row) => row.service)).toEqual([
      "Gmail",
      "Google Calendar",
      "Model provider",
    ]);
  });

  /** No component ids and no raw scopes may reach the checklist's user-facing text. */
  it("carries no component ids or raw scopes in what the page renders", () => {
    importManifest(gmailV2);
    const rows = deriveConnectionRequirements(listConnectionCapableAgents()[0]!.manifest);
    for (const row of rows) {
      expect(row.purpose).not.toMatch(/_|\./);
      for (const capability of row.capabilities) {
        expect(capability.label).not.toMatch(/https?:|auth\/|scope/i);
      }
    }
  });

  it("keeps the inferred model-provider row marked as inferred and unowned", () => {
    importManifest(gmailV2);
    const rows = deriveConnectionRequirements(listConnectionCapableAgents()[0]!.manifest);
    const model = rows.find((row) => row.service === "Model provider");
    expect(model).toMatchObject({
      source: "derived_from_plan",
      ownership_confirmed: false,
    });
  });

  /**
   * The store must not become a place credentials live. v2 manifests are
   * forbidden from carrying values by the schema; this asserts what DASH
   * actually writes to disk stays clean after a real import.
   */
  it("writes no secret-shaped value into the store file", () => {
    importManifest(gmailV2);
    expect(readStoreBytes(dataDir)).not.toMatch(
      /sk-|Bearer |refresh_token"\s*:\s*"[^"]+"|password/i,
    );
  });
});
