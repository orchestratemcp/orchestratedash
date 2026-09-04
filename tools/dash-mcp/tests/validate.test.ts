/**
 * The verdict, and the fix attached to it (MAR-862, ADR 0032 decision 5).
 *
 * Two properties are being held here. The first is that the verdict is DASH's:
 * this module decides nothing, so a test that asserted its own idea of validity
 * would be testing a second implementation. What is asserted instead is that
 * the answer *travels* — that a refusal keeps DASH's headline and produces one
 * problem per validator error.
 *
 * The second is the one this packet exists for: that a problem carries what to
 * write. An Ajv string names the place and withholds the answer, and a caller
 * that has to guess produces the second failed import this tool was built to
 * prevent.
 */

import { describe, expect, it } from "vitest";

import { scaffoldManifest } from "../src/scaffold";
import { verdictForManifest, verdictForManifestJson } from "../src/validate";

const NOW = new Date("2026-09-04T12:00:00.000Z");

function good(): Record<string, unknown> {
  return scaffoldManifest({
    directory: "/tmp/example-agent",
    agent_id: "example-agent",
    display_name: "Example agent",
    summary: "Reads a few public sources and says what came in.",
    sources: [],
    now: NOW,
  });
}

describe("verdictForManifest", () => {
  it("passes the scaffold's own manifest", () => {
    const verdict = verdictForManifest(good());
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.agent).toBe("example-agent");
    expect(verdict.ok && verdict.manifest_version).toBe(2);
  });

  it("names every missing top-level block, one problem each", () => {
    const verdict = verdictForManifest({ manifest_version: 2, agent: { name: "x" } });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    const missing = verdict.problems
      .map((problem) => /required property '([^']+)'/.exec(problem.problem)?.[1])
      .filter((name) => name !== undefined);
    expect(missing).toEqual(
      expect.arrayContaining(["planned_route", "safety_contract", "monitoring", "agent_dom"]),
    );
  });

  it("tells the caller what to add, not only that something is absent", () => {
    const verdict = verdictForManifest({ manifest_version: 2, agent: { name: "x" } });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    const route = verdict.problems.find((problem) => problem.problem.includes("planned_route"));
    expect(route?.fix).toContain('Add "planned_route"');
  });

  /**
   * The case the whole fix layer was written for. `must be equal to one of the
   * allowed values` is the least actionable message Ajv emits, because the
   * values are in the schema and the message is not.
   */
  it("quotes the allowed values when a field is out of vocabulary", () => {
    const manifest = good() as { planned_route: { risk_level: string }[] };
    manifest.planned_route[0].risk_level = "extremely-low";

    const verdict = verdictForManifest(manifest);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    const problem = verdict.problems.find((entry) => entry.where.includes("risk_level"));
    expect(problem).toBeDefined();
    expect(problem?.fix).toContain('"low"');
    expect(problem?.fix).toContain('"critical"');
  });

  it("keeps the validator's own sentence beside the fix", () => {
    const manifest = good() as { planned_route: { risk_level: string }[] };
    manifest.planned_route[0].risk_level = "extremely-low";

    const verdict = verdictForManifest(manifest);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) {
      return;
    }
    const problem = verdict.problems.find((entry) => entry.where.includes("risk_level"));
    expect(problem?.problem).toContain("must be equal to one of the allowed values");
  });

  it("refuses a version DASH has never heard of, and says so plainly", () => {
    const verdict = verdictForManifest({ manifest_version: 7, agent: { name: "x" } });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.problems[0].problem).toContain("unsupported manifest_version");
  });

  /**
   * The constraint no schema can express — ADR 0006, checked by
   * `checkManifestConstraints`. It reaches the caller through the same shape as
   * a schema failure, which is the property `lib/import-feedback.ts` was built
   * for: two kinds of refusal, one road, one explanation layer.
   */
  it("refuses a remote runtime that asks DASH to manage a connection for it", () => {
    const manifest = good() as {
      agent_dom: {
        locations: { runtime: { kind: string } };
        connections: unknown[];
      };
    };
    manifest.agent_dom.locations.runtime.kind = "remote";
    manifest.agent_dom.connections = [
      {
        id: "model_provider",
        provider: "openrouter",
        label: "Your model provider",
        purpose: "Writes the brief.",
        ownership: "dash_managed",
        capabilities: [
          { id: "openrouter.chat.completion", label: "Write the brief", access: "spend" },
        ],
        fields: [
          {
            id: "key",
            label: "API key",
            purpose: "So DASH can reach the provider.",
            kind: "secret",
            required: true,
          },
        ],
        validation_action: { id: "test_model_key", label: "Check the key", behavior: "test" },
      },
    ];

    const verdict = verdictForManifest(manifest);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : JSON.stringify(verdict.problems)).toContain("ADR 0006");
  });

  it("refuses a name that cannot be a folder", () => {
    const manifest = good() as { agent: { name: string } };
    manifest.agent.name = "..";
    const verdict = verdictForManifest(manifest);
    expect(verdict.ok).toBe(false);
  });
});

describe("verdictForManifestJson", () => {
  it("treats a file that is not JSON as its own kind of answer", () => {
    const verdict = verdictForManifestJson("{ not json");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? "" : verdict.headline).toContain("not valid JSON");
  });

  it("passes the scaffold's manifest through a serialisation round trip", () => {
    expect(verdictForManifestJson(JSON.stringify(good(), null, 2)).ok).toBe(true);
  });
});
