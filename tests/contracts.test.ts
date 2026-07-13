import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf-8"));
}

function semanticSha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validateManifest = ajv.compile(
  loadJson("contracts/agent.manifest.schema.json") as object,
);
const validateEvent = ajv.compile(
  loadJson("contracts/run-event.schema.json") as object,
);

describe("telemetry contract v1", () => {
  it("validates the example agent manifest against agent.manifest.schema.json", () => {
    const example = loadJson("examples/agent.manifest.example.json");

    const valid = validateManifest(example);

    expect(validateManifest.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it("validates the example run event against run-event.schema.json", () => {
    const example = loadJson("examples/run-event.example.json");

    const valid = validateEvent(example);

    expect(validateEvent.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it("locks the semantic v1 schema fingerprints", () => {
    const lock = loadJson("contracts/contract.lock.json") as {
      version: number;
      schema_semantic_sha256: Record<string, string>;
    };

    expect(lock.version).toBe(1);
    for (const [file, expected] of Object.entries(lock.schema_semantic_sha256)) {
      expect(semanticSha256(loadJson(`contracts/${file}`)), file).toBe(expected);
    }
  });

  it("validates the MAR-363 manifest and complete gate sequence", () => {
    const manifest = loadJson("conformance/v1/mar-363.agent.manifest.json") as {
      agent: { name: string };
      safety_contract: { irreversible_components: string[] };
    };
    const events = loadJson("conformance/v1/mar-363.run-events.json") as Array<{
      agent: string;
      run_id: string;
      seq: number;
      type: string;
      component_id?: string;
    }>;

    expect(validateManifest(manifest), JSON.stringify(validateManifest.errors)).toBe(true);
    for (const event of events) {
      expect(validateEvent(event), JSON.stringify(validateEvent.errors)).toBe(true);
      expect(event.agent).toBe(manifest.agent.name);
    }
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    expect(new Set(events.map((event) => event.run_id)).size).toBe(1);
    expect(events[0]?.type).toBe("run_started");
    expect(events.at(-1)?.type).toBe("run_completed");

    for (const component of manifest.safety_contract.irreversible_components) {
      const resolvedAt = events.findIndex(
        (event) => event.type === "gate_resolved" && event.component_id === component,
      );
      const startedAt = events.findIndex(
        (event) => event.type === "step_started" && event.component_id === component,
      );
      expect(resolvedAt, `${component} has a resolved gate`).toBeGreaterThan(-1);
      expect(startedAt, `${component} starts`).toBeGreaterThan(resolvedAt);
    }
  });

  it("rejects the pre-MAR-363 legacy event shape", () => {
    const valid = validateEvent({
      event: "run_started",
      run_id: "legacy-run",
      ts: "2026-07-13T09:00:00Z",
    });

    expect(valid).toBe(false);
    expect(validateEvent.errors?.map((error) => error.keyword)).toContain("required");
  });
});
