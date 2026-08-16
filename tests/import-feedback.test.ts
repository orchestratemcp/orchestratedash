import { describe, expect, it } from "vitest";
import {
  explainImportFailure,
  explainNotJson,
  formatExplanationDetail,
} from "../lib/import-feedback";
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

  /**
   * The handoff dialog's version of the same explanation (MAR-655/656).
   *
   * A native message box has one string for its detail, so before this the deep
   * link relayed none of the above and said "Building the agent again with a
   * current Agent Kit usually fixes this" instead. That cost a session: the real
   * fault was a panel note three characters over the schema's cap, in a manifest
   * the author had edited by hand, and no rebuild was ever going to shorten it.
   */
  describe("formatExplanationDetail", () => {
    it("puts the validator's own line in front of the person", () => {
      const detail = formatExplanationDetail(
        explainImportFailure([
          "/agent_dom/panel/sections/4 must have required property 'artifact_role'",
          "/agent_dom/panel/sections/4/text must NOT have more than 400 characters",
        ]),
      );
      expect(detail).toContain("400 characters");
      // And DASH's own sentence still leads, as it does on the three pages.
      expect(detail.startsWith("This agent declares a panel DASH cannot draw.")).toBe(true);
    });

    it("caps the list rather than pasting a failed oneOf into a dialog", () => {
      // Ajv narrates every branch it tried: eleven lines for one mistake. All
      // eleven in a message box buries the one that matters.
      const raw = Array.from({ length: 11 }, (_, index) => `/agent_dom/panel/sections/${String(index)} bad`);
      const detail = formatExplanationDetail(explainImportFailure(raw));
      expect(detail).toContain("and 7 more.");
      expect(detail.split("\n").filter((line) => line.startsWith("• "))).toHaveLength(5);
    });

    it("omits an empty suggestion instead of leaving a hole in the dialog", () => {
      const explanation = explainImportFailure(["/agent must be object"]);
      expect(explanation.suggestion).toBe("");
      const detail = formatExplanationDetail(explanation);
      expect(detail).not.toContain("\n\n\n");
    });
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
