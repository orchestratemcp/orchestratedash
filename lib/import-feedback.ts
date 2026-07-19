/**
 * Turning an import failure into something a person can act on.
 *
 * MAR-383's acceptance criterion is that a fresh user gets through first-run
 * "without terminal, `.env`, component IDs or raw scopes" — and a wall of Ajv
 * output is the same failure in a different costume. `(root) must have required
 * property 'agent_dom'` tells an agent author nothing about what to do next.
 *
 * So this module maps a failure to a headline that names the likely cause and a
 * suggested fix. It is pure and I/O-free, like `lib/connections.ts`: the raw
 * errors still travel alongside for anyone who wants them, but they are never
 * the only thing shown.
 *
 * It deliberately does not try to explain every schema error. Guessing wrongly
 * about an unusual failure is worse than saying plainly "this did not match the
 * contract, here is what the validator said".
 */

export type ImportFailureKind =
  | "not_json"
  | "unsupported_version"
  | "missing_agent_dom"
  | "missing_required_field"
  | "schema_mismatch";

export interface ImportFailureExplanation {
  kind: ImportFailureKind;
  /** One sentence naming what went wrong. Safe to render as the error headline. */
  headline: string;
  /** What to do about it. Empty when we genuinely cannot suggest anything useful. */
  suggestion: string;
  /** The validator's own errors, kept verbatim for anyone who wants them. */
  raw: string[];
}

/**
 * A manifest that declares a version DASH does not know. `lib/contracts.ts`
 * emits this case as a single distinctive message rather than a schema diff,
 * so it is worth recognising: the fix is a different export, not an edit.
 */
const UNSUPPORTED_VERSION = /unsupported manifest_version/i;

/** Ajv's phrasing for an absent property, e.g. `must have required property 'agent'`. */
const MISSING_PROPERTY = /must have required property '([^']+)'/;

export function explainImportFailure(errors: string[]): ImportFailureExplanation {
  const joined = errors.join(" ");

  if (UNSUPPORTED_VERSION.test(joined)) {
    return {
      kind: "unsupported_version",
      headline: "This manifest declares a version DASH does not understand.",
      suggestion:
        "DASH reads manifest versions 1 and 2. Re-export the agent from a current OrchestrateKit, or check the manifest_version field.",
      raw: errors,
    };
  }

  const missing = errors
    .map((error) => MISSING_PROPERTY.exec(error)?.[1])
    .filter((name): name is string => name !== undefined);

  if (missing.includes("agent_dom")) {
    // Worth its own case: it is the difference between the two versions, and it
    // is the field that decides whether a connection checklist is possible.
    return {
      kind: "missing_agent_dom",
      headline: "This looks like a version 2 manifest, but its Agent DOM block is missing.",
      suggestion:
        "A v2 manifest needs an agent_dom section — that is where declared connections live. Re-export the agent, or import it as version 1 if it has no connections.",
      raw: errors,
    };
  }

  if (missing.length > 0) {
    const list = missing.join(", ");
    return {
      kind: "missing_required_field",
      headline: `This manifest is missing ${missing.length === 1 ? "a required section" : "required sections"}: ${list}.`,
      suggestion:
        "Manifests are produced by OrchestrateKit's export_build_brief. Re-exporting is usually faster and safer than editing the file by hand.",
      raw: errors,
    };
  }

  return {
    kind: "schema_mismatch",
    headline: "This file does not match the agent manifest contract.",
    // No invented advice. The raw errors are shown below this, which is the
    // honest thing to offer when we cannot do better.
    suggestion: "",
    raw: errors,
  };
}

/**
 * The case that never reaches a schema: the file is not JSON at all. Separated
 * because the user's next move is completely different — they picked the wrong
 * file, rather than having a manifest with a problem in it.
 */
export function explainNotJson(detail: string): ImportFailureExplanation {
  return {
    kind: "not_json",
    headline: "That file is not valid JSON, so it cannot be a manifest.",
    suggestion:
      "Pick the agent.manifest.json that OrchestrateKit exported. A build brief or a README will not import.",
    raw: [detail],
  };
}
