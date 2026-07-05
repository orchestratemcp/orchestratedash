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

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

describe("telemetry contract v1", () => {
  it("validates the example agent manifest against agent.manifest.schema.json", () => {
    const schema = loadJson("contracts/agent.manifest.schema.json");
    const example = loadJson("examples/agent.manifest.example.json");

    const validate = ajv.compile(schema as object);
    const valid = validate(example);

    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });

  it("validates the example run event against run-event.schema.json", () => {
    const schema = loadJson("contracts/run-event.schema.json");
    const example = loadJson("examples/run-event.example.json");

    const validate = ajv.compile(schema as object);
    const valid = validate(example);

    expect(validate.errors).toBeNull();
    expect(valid).toBe(true);
  });
});
