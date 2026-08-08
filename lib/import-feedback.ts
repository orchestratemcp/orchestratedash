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

// The one import this module may take, and it is safe by construction:
// `lib/panel-spec.ts` has no imports of its own, so nothing reaches the
// filesystem through it. The alternative was a second copy of the section
// vocabulary written out as prose here, which is the copy that would still say
// five types on the day a sixth was added.
import { PANEL_MANIFEST_PATH, PANEL_SECTION_TYPES_V1 } from "./panel-spec";

/**
 * The distinctive phrase `lib/manifest-constraints.ts` puts in its error
 * string and this module keys on. It lives HERE and is imported THERE, not
 * the other way around: this module is bundled into the add-agent page's
 * client component, so it must stay free of imports — the constraint module
 * reaches `lib/contracts.ts`, which reads schema files with `node:fs`, and a
 * client chunk cannot carry that. The round trip is asserted by test, so the
 * two sides cannot drift.
 */
export const REMOTE_DASH_MANAGED_PHRASE =
  "declares a remote runtime location and a DASH-managed connection";

export type ImportFailureKind =
  | "not_json"
  | "unsupported_version"
  | "missing_agent_dom"
  | "missing_required_field"
  | "remote_agent_dash_connections"
  | "invalid_panel"
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

/**
 * The five section kinds, as a sentence.
 *
 * Built from the pinned array rather than typed out, so the day a sixth
 * component is added to the vocabulary this sentence grows with it instead of
 * quietly continuing to name five.
 */
const SECTION_TYPES_SENTENCE = `${PANEL_SECTION_TYPES_V1.slice(0, -1).join(", ")} and ${
  PANEL_SECTION_TYPES_V1[PANEL_SECTION_TYPES_V1.length - 1]
}`;

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

  if (joined.includes(REMOTE_DASH_MANAGED_PHRASE)) {
    // MAR-482, the refusal ADR 0006 mandates. Unlike every other case here the
    // manifest matched the schema perfectly — what it asks for is a
    // contradiction: an agent on another computer can never reach a connection
    // DASH manages, because DASH's reach ends at this machine. The suggestion
    // names the honest alternative rather than a workaround, since no edit
    // short of that changes what the transport allows.
    return {
      kind: "remote_agent_dash_connections",
      headline: "This agent runs on another computer, but asks DASH to manage sign-ins for it.",
      suggestion:
        "DASH can only manage a sign-in for an agent it runs on this computer, while DASH is open. " +
        "An agent that runs somewhere else holds its own sign-ins — re-export it with its " +
        "connections marked as the agent's own, and DASH will say plainly what it cannot see or limit.",
      raw: errors,
    };
  }

  // Before the missing-property branch below, deliberately (ADR 0008,
  // MAR-552). A section that forgot `artifact_role` produces Ajv's ordinary
  // "must have required property" string, and read by that branch it becomes
  // "this manifest is missing a required section: artifact_role" — which sends
  // an author looking at the top of their manifest for something that is
  // wrong inside their panel.
  if (joined.includes(PANEL_MANIFEST_PATH)) {
    // Ajv's own account of a failed `oneOf` is five copies of "must be equal to
    // constant", which names nothing an author can act on. So this case does
    // not try to relay the validator; it states the rule the panel broke and
    // names the whole vocabulary, because picking one of five words is the
    // author's actual next move. The raw errors travel underneath for anyone
    // who wants the path.
    return {
      kind: "invalid_panel",
      headline: "This agent declares a panel DASH cannot draw.",
      suggestion:
        `A panel is built from a fixed set of sections — ${SECTION_TYPES_SENTENCE} — ` +
        "and each one needs a heading and the details its kind requires. DASH refuses a panel " +
        "it would have to guess at rather than drawing half of one. Re-export the agent from a " +
        "current OrchestrateKit; the validator's errors below point at the section at fault.",
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
