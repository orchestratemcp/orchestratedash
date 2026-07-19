import { describe, expect, it } from "vitest";
import { explainImportFailure, explainNotJson } from "../lib/import-feedback";
import { validateManifest } from "../lib/contracts";

/**
 * These assert the plain-language layer, and — where it matters — feed it the
 * real validator's output rather than hand-written strings. A mapping that only
 * works against invented error text is worthless the first time Ajv rephrases
 * something.
 */

function errorsFor(input: unknown): string[] {
  const result = validateManifest(input);
  if (result.ok) {
    throw new Error("expected this manifest to fail validation");
  }
  return result.errors;
}

describe("explaining a failed import", () => {
  it("names an unsupported version and points at the fix", () => {
    const explanation = explainImportFailure(errorsFor({ manifest_version: 99 }));
    expect(explanation.kind).toBe("unsupported_version");
    expect(explanation.headline).toContain("does not understand");
    expect(explanation.suggestion).toContain("versions 1 and 2");
  });

  it("recognises a v2 manifest with no Agent DOM block", () => {
    // Real v2 shape, agent_dom removed — the case that separates the versions.
    const explanation = explainImportFailure([
      "(root) must have required property 'agent_dom'",
    ]);
    expect(explanation.kind).toBe("missing_agent_dom");
    expect(explanation.suggestion).toContain("declared connections live");
  });

  it("lists missing required sections by name", () => {
    const explanation = explainImportFailure(errorsFor({ manifest_version: 1 }));
    expect(explanation.kind).toBe("missing_required_field");
    // The names come from the validator, so this also pins that the regex still
    // matches Ajv's actual phrasing.
    expect(explanation.headline).toContain("agent");
    expect(explanation.headline).toContain("planned_route");
  });

  it("uses singular wording for exactly one missing section", () => {
    const explanation = explainImportFailure([
      "(root) must have required property 'provenance'",
    ]);
    expect(explanation.headline).toContain("a required section");
    expect(explanation.headline).not.toContain("sections:");
  });

  /**
   * The honest fallback. Inventing advice for an unrecognised schema error is
   * worse than admitting we only have the validator's word for it.
   */
  it("falls back without inventing a suggestion", () => {
    const explanation = explainImportFailure(["/planned_route/0/step must be number"]);
    expect(explanation.kind).toBe("schema_mismatch");
    expect(explanation.suggestion).toBe("");
    expect(explanation.raw).toEqual(["/planned_route/0/step must be number"]);
  });

  it("always keeps the validator's own errors alongside the explanation", () => {
    const raw = errorsFor({ manifest_version: 1 });
    expect(explainImportFailure(raw).raw).toEqual(raw);
  });

  /**
   * A different problem with a different fix: the user picked the wrong file,
   * rather than having a manifest with something wrong in it.
   */
  it("treats a non-JSON file as its own case", () => {
    const explanation = explainNotJson("Unexpected token < in JSON at position 0");
    expect(explanation.kind).toBe("not_json");
    expect(explanation.headline).toContain("not valid JSON");
    expect(explanation.suggestion).toContain("agent.manifest.json");
  });

  /** No explanation may leak the raw schema vocabulary into the headline. */
  it("keeps headlines free of schema jargon", () => {
    const explanations = [
      explainImportFailure(errorsFor({ manifest_version: 99 })),
      explainImportFailure(errorsFor({ manifest_version: 1 })),
      explainNotJson("boom"),
    ];
    for (const explanation of explanations) {
      expect(explanation.headline).not.toMatch(/instancePath|anyOf|const|\$ref/);
    }
  });
});
