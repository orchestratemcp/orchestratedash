/**
 * Connection requirements: what an agent needs to be connected to before it can
 * run, derived from its manifest.
 *
 * This is the data layer behind the MAR-383 Connection Center. Like
 * `lib/analyze.ts`, it is a pure function over a manifest — no I/O, no secret
 * handling, no network — so it is fully unit-testable and safe to call from
 * anywhere.
 *
 * The governing rule from MAR-383: **rows are generated from manifest/adapter
 * metadata, never guessed from values.** DASH never sniffs a `.env`, never
 * pattern-matches an API key, and never infers "this looks like Stripe" from a
 * string. If the manifest did not declare it, DASH either derives it from
 * another *declared* field (and says so) or does not show it at all.
 *
 * Nothing here reads or stores a credential. Manifests are forbidden from
 * carrying credential values by the v2 schema; this module only ever touches
 * the requirement descriptors.
 */

export type ConnectionOwnership = "dash" | "agent" | "external";

/**
 * Where a row came from. The UI must be able to distinguish "the agent told us
 * it needs this" from "we worked out it must need this", because the honesty
 * rules in MAR-383 forbid presenting a derived requirement as a declared one.
 */
export type ConnectionRowSource = "declared_connection" | "derived_from_plan";

export interface RequiredCapability {
  id: string;
  /** Plain-language capability name, safe to render directly. */
  label: string;
  /**
   * `BrokerAccess`, restated rather than imported (MAR-545).
   *
   * This module declares itself importless and safe to call from anywhere, and
   * a type import from `lib/broker/` would point a base module at one above it
   * for a value that is erased at compile time anyway. Restated in
   * `AiKeyActionResult`'s shape and pinned the way that one is: a one-line
   * compile-time assignment in `tests/broker-spend.test.ts` fails the moment the
   * two drift.
   */
  access: "read" | "write" | "spend";
}

export interface ConnectionRequirementRow {
  /** Stable key for the row. Declared rows use the manifest connection id. */
  connection_id: string;
  /** Friendly service name shown to the user, e.g. "Gmail". */
  service: string;
  /** Machine-ish provider id, e.g. "google-gmail". Not shown as the headline. */
  provider: string;
  /** Plain-language reason this agent needs the connection. */
  purpose: string;
  capabilities: RequiredCapability[];
  ownership: ConnectionOwnership;
  /**
   * False when ownership was assumed rather than declared. Derived rows cannot
   * know who holds the credential, and claiming otherwise would be exactly the
   * "never claim all detected credentials are portable" failure MAR-383 warns
   * against.
   */
  ownership_confirmed: boolean;
  source: ConnectionRowSource;
  /**
   * True when at least one required field is a secret the user would type.
   * Drives whether the row needs a masked input later — it does not imply any
   * storage decision here.
   */
  requires_secret_input: boolean;
  validation_behavior: "test" | "reconnect_test_switch" | "none";
}

/* ---------------------------------------------------------------------- *
 * Manifest v2 shapes
 *
 * Declared locally rather than imported from `lib/contracts.ts`: that module
 * reads schema files off disk at import time, and this one is deliberately
 * I/O-free. `contracts.ts` also still describes v1 only. These types describe
 * the subset of `contracts/agent.manifest.v2.schema.json` this module reads.
 * ---------------------------------------------------------------------- */

export type ModelTier = "none" | "small" | "standard" | "frontier";

export interface ManifestConnectionField {
  id: string;
  label: string;
  purpose: string;
  kind: "secret" | "non_secret" | "oauth_reauthorization";
  required: boolean;
  /** Author-written guidance, e.g. where to find the key. Safe to render. */
  help?: string;
  /**
   * The schema's escape hatch for things a novice should never see. Read by
   * `lib/connection-credentials.ts` — `environment_name` is the delivery target
   * for a DASH-held secret — and deliberately not surfaced by
   * `deriveConnectionRequirements`, which builds the plain-language checklist.
   */
  technical?: {
    environment_name?: string;
    provider_scopes?: string[];
  };
}

export interface ManifestConnection {
  id: string;
  provider: string;
  label: string;
  purpose: string;
  ownership: "dash_managed" | "agent_managed" | "external";
  capabilities: RequiredCapability[];
  fields: ManifestConnectionField[];
  validation_action?: { id: string; label: string; behavior: "test" | "reconnect_test_switch" };
}

export interface ConnectionSourceManifest {
  planned_route?: Array<{ step: number; component_id: string; model_tier: ModelTier }>;
  agent_dom?: { connections?: ManifestConnection[] };
}

const OWNERSHIP_BY_MANIFEST_VALUE: Record<ManifestConnection["ownership"], ConnectionOwnership> = {
  dash_managed: "dash",
  agent_managed: "agent",
  external: "external",
};

/** Tiers ordered weakest to strongest, for reporting the highest tier the plan asks for. */
const TIER_ORDER: ModelTier[] = ["none", "small", "standard", "frontier"];

const TIER_LABEL: Record<Exclude<ModelTier, "none">, string> = {
  small: "small",
  standard: "standard",
  frontier: "frontier",
};

/**
 * Synthetic id for the derived model-provider row. Prefixed so it can never
 * collide with a manifest-declared connection id.
 */
export const MODEL_PROVIDER_ROW_ID = "derived:model-provider";

function declaredRows(connections: ManifestConnection[]): ConnectionRequirementRow[] {
  return connections.map((connection) => ({
    connection_id: connection.id,
    service: connection.label,
    provider: connection.provider,
    purpose: connection.purpose,
    capabilities: connection.capabilities,
    ownership: OWNERSHIP_BY_MANIFEST_VALUE[connection.ownership],
    // Declared connections state their own ownership, so it is authoritative.
    ownership_confirmed: true,
    source: "declared_connection",
    requires_secret_input: connection.fields.some(
      (field) => field.kind === "secret" && field.required,
    ),
    validation_behavior: connection.validation_action?.behavior ?? "none",
  }));
}

/**
 * The model provider is a real connection requirement that manifests do not
 * declare as one: a plan with `model_tier` above "none" cannot run without
 * access to a model, but v2 has no connection entry for it.
 *
 * Deriving it from `planned_route[].model_tier` stays inside the rule — that is
 * a declared, enumerated manifest field, not a guessed value. MAR-383's
 * acceptance criterion requires the Gmail example to produce a model-provider
 * row, and this is the only honest way to get one.
 *
 * The row is marked `derived_from_plan` with `ownership_confirmed: false`: we
 * know the agent needs a model, and we know its runtime is the thing that will
 * call one, but nothing in the manifest says who holds that credential. The UI
 * must ask rather than assert.
 */
function modelProviderRow(
  planned: NonNullable<ConnectionSourceManifest["planned_route"]>,
): ConnectionRequirementRow | null {
  const usedTiers = TIER_ORDER.filter(
    (tier) => tier !== "none" && planned.some((step) => step.model_tier === tier),
  ) as Array<Exclude<ModelTier, "none">>;

  if (usedTiers.length === 0) {
    // A plan with no model steps genuinely needs no model provider.
    return null;
  }

  const stepCount = planned.filter((step) => step.model_tier !== "none").length;
  const highest = usedTiers[usedTiers.length - 1];

  return {
    connection_id: MODEL_PROVIDER_ROW_ID,
    service: "Model provider",
    provider: "model-provider",
    purpose:
      `Run the ${stepCount} step${stepCount === 1 ? "" : "s"} in this agent's plan ` +
      `that ${stepCount === 1 ? "needs" : "need"} a language model ` +
      `(highest tier required: ${TIER_LABEL[highest]})`,
    capabilities: usedTiers.map((tier) => ({
      id: `model.completion.${tier}`,
      label: `Send plan steps to a ${TIER_LABEL[tier]}-tier model`,
      // "write" because the step sends this agent's data out to the provider.
      // Access here describes blast radius, not CRUD.
      access: "write" as const,
    })),
    ownership: "agent",
    ownership_confirmed: false,
    source: "derived_from_plan",
    // Whether the user types a key or reauthorizes depends on the provider they
    // pick, which is not knowable from the manifest. Assume nothing.
    requires_secret_input: false,
    validation_behavior: "none",
  };
}

/**
 * Derive every connection this agent requires.
 *
 * Declared connections come first in manifest order — that order is the agent
 * author's, and reordering it would lose intent. The derived model-provider row
 * is appended last because it is inferred, and inferred rows should not lead.
 *
 * Tolerates a v1 manifest (no `agent_dom`) and a manifest with no planned
 * route: both yield fewer rows rather than an error. A monitor that throws on
 * an older manifest is worse than one that shows what it can.
 */
export function deriveConnectionRequirements(
  manifest: ConnectionSourceManifest,
): ConnectionRequirementRow[] {
  const rows = declaredRows(manifest.agent_dom?.connections ?? []);

  const model = modelProviderRow(manifest.planned_route ?? []);
  if (model !== null) {
    rows.push(model);
  }

  return rows;
}

/**
 * Group rows by who holds the credential. The Connection Center shows these as
 * separate sections, because "you connect this" and "the agent already has
 * this" are different user actions.
 */
export function groupByOwnership(
  rows: ConnectionRequirementRow[],
): Record<ConnectionOwnership, ConnectionRequirementRow[]> {
  const grouped: Record<ConnectionOwnership, ConnectionRequirementRow[]> = {
    dash: [],
    agent: [],
    external: [],
  };
  for (const row of rows) {
    grouped[row.ownership].push(row);
  }
  return grouped;
}
