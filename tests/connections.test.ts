import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MODEL_PROVIDER_ROW_ID,
  deriveConnectionRequirements,
  groupByOwnership,
} from "../lib/connections";
import type { ConnectionSourceManifest } from "../lib/connections";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): ConnectionSourceManifest {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "examples", name), "utf8"),
  ) as ConnectionSourceManifest;
}

const gmailExample = example("gmail-meeting-assistant.manifest.v2.example.json");
const agentManagedExample = example("agent-managed.manifest.v2.example.json");

describe("deriveConnectionRequirements — the Gmail example", () => {
  const rows = deriveConnectionRequirements(gmailExample);

  /**
   * Stated MAR-383 acceptance criterion: "Importing the Gmail example renders
   * Gmail, Google Calendar and model-provider rows." Asserted directly and by
   * exact set, so an extra or missing row fails rather than passing quietly.
   */
  it("renders exactly Gmail, Google Calendar and model-provider rows", () => {
    expect(rows.map((row) => row.service)).toEqual([
      "Gmail",
      "Google Calendar",
      "Model provider",
    ]);
  });

  it("carries the manifest's plain-language purpose, not a component id", () => {
    const gmail = rows.find((row) => row.service === "Gmail");
    expect(gmail?.purpose).toBe("Read meeting requests and save reply drafts");
    // No row may leak raw component ids or scopes into user-facing text.
    for (const row of rows) {
      expect(row.purpose).not.toMatch(/_|\./);
    }
  });

  it("lists the declared required capabilities", () => {
    const calendar = rows.find((row) => row.service === "Google Calendar");
    expect(calendar?.capabilities.map((capability) => capability.label)).toEqual([
      "Check calendar availability",
      "Create an approved calendar event",
    ]);
    expect(calendar?.capabilities.map((capability) => capability.access)).toEqual([
      "read",
      "write",
    ]);
  });

  it("reports declared ownership as DASH-managed and confirmed", () => {
    const declared = rows.filter((row) => row.source === "declared_connection");
    expect(declared).toHaveLength(2);
    for (const row of declared) {
      expect(row.ownership).toBe("dash");
      expect(row.ownership_confirmed).toBe(true);
    }
  });

  it("derives the model-provider row from declared model tiers, not values", () => {
    const model = rows.find((row) => row.connection_id === MODEL_PROVIDER_ROW_ID);
    expect(model).toBeDefined();
    expect(model?.source).toBe("derived_from_plan");
    // Two steps in the example plan declare model_tier "standard".
    expect(model?.purpose).toContain("2 steps");
    expect(model?.purpose).toContain("standard");
    expect(model?.capabilities.map((capability) => capability.id)).toEqual([
      "model.completion.standard",
    ]);
  });

  it("does not claim to know who owns the derived model connection", () => {
    const model = rows.find((row) => row.connection_id === MODEL_PROVIDER_ROW_ID);
    expect(model?.ownership_confirmed).toBe(false);
    expect(model?.requires_secret_input).toBe(false);
  });

  it("marks OAuth connections as needing reconnect rather than secret input", () => {
    const gmail = rows.find((row) => row.service === "Gmail");
    expect(gmail?.requires_secret_input).toBe(false);
    expect(gmail?.validation_behavior).toBe("reconnect_test_switch");
  });
});

describe("deriveConnectionRequirements — the agent-managed example", () => {
  const rows = deriveConnectionRequirements(agentManagedExample);

  it("keeps agent-managed ownership on the agent", () => {
    const store = rows.find((row) => row.connection_id === "invoice-store");
    expect(store?.ownership).toBe("agent");
    expect(store?.ownership_confirmed).toBe(true);
  });

  it("flags a required secret field as needing masked input", () => {
    const store = rows.find((row) => row.connection_id === "invoice-store");
    expect(store?.requires_secret_input).toBe(true);
    expect(store?.validation_behavior).toBe("test");
  });

  it("still derives a model-provider row for its one standard-tier step", () => {
    const model = rows.find((row) => row.connection_id === MODEL_PROVIDER_ROW_ID);
    expect(model?.purpose).toContain("1 step ");
  });
});

describe("deriveConnectionRequirements — edge cases", () => {
  it("returns no rows for an empty manifest rather than throwing", () => {
    expect(deriveConnectionRequirements({})).toEqual([]);
  });

  it("omits the model row when no step needs a model", () => {
    const manifest: ConnectionSourceManifest = {
      planned_route: [
        { step: 1, component_id: "audit_log", model_tier: "none" },
      ],
    };
    expect(deriveConnectionRequirements(manifest)).toEqual([]);
  });

  it("reports the highest tier when a plan mixes tiers", () => {
    const manifest: ConnectionSourceManifest = {
      planned_route: [
        { step: 1, component_id: "a", model_tier: "small" },
        { step: 2, component_id: "b", model_tier: "frontier" },
        { step: 3, component_id: "c", model_tier: "none" },
      ],
    };
    const [model] = deriveConnectionRequirements(manifest);
    expect(model.purpose).toContain("highest tier required: frontier");
    expect(model.capabilities.map((capability) => capability.id)).toEqual([
      "model.completion.small",
      "model.completion.frontier",
    ]);
  });

  it("preserves the manifest's connection order and appends derived rows last", () => {
    const rows = deriveConnectionRequirements(gmailExample);
    expect(rows[rows.length - 1].source).toBe("derived_from_plan");
  });

  it("maps external ownership through unchanged", () => {
    const manifest: ConnectionSourceManifest = {
      agent_dom: {
        connections: [
          {
            id: "vault",
            provider: "corp-secrets",
            label: "Corporate secret manager",
            purpose: "Supply credentials held by the company secret manager",
            ownership: "external",
            capabilities: [{ id: "secrets.read", label: "Read a credential", access: "read" }],
            fields: [],
          },
        ],
      },
    };
    const [row] = deriveConnectionRequirements(manifest);
    expect(row.ownership).toBe("external");
    expect(row.validation_behavior).toBe("none");
  });
});

describe("groupByOwnership", () => {
  it("splits rows into the three Connection Center sections", () => {
    const grouped = groupByOwnership(deriveConnectionRequirements(gmailExample));
    expect(grouped.dash.map((row) => row.service)).toEqual(["Gmail", "Google Calendar"]);
    expect(grouped.agent.map((row) => row.service)).toEqual(["Model provider"]);
    expect(grouped.external).toEqual([]);
  });
});
