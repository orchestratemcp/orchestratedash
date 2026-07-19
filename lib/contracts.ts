import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { ManifestConnection } from "./connections";

/**
 * Validation against the frozen telemetry v1 schemas. DASH is the canonical
 * owner of those schemas, so the app reads the same files the contract tests
 * read rather than keeping a second copy of the rules.
 */

const repoRoot = process.cwd();

function loadSchema(relativePath: string): object {
  return JSON.parse(
    readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as object;
}

function buildValidators(): {
  manifest: ValidateFunction;
  manifestV2: ValidateFunction;
  event: ValidateFunction;
} {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return {
    manifest: ajv.compile(loadSchema("contracts/agent.manifest.schema.json")),
    manifestV2: ajv.compile(loadSchema("contracts/agent.manifest.v2.schema.json")),
    event: ajv.compile(loadSchema("contracts/run-event.schema.json")),
  };
}

// Compiling is not free and the schemas are frozen, so do it once per process.
let cached: ReturnType<typeof buildValidators> | null = null;

function validators(): ReturnType<typeof buildValidators> {
  if (cached === null) {
    cached = buildValidators();
  }
  return cached;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

function formatErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map((error) => {
    const where = error.instancePath === "" ? "(root)" : error.instancePath;
    return `${where} ${error.message ?? "is invalid"}`;
  });
}

/**
 * Unknown fields are accepted on purpose: the contract's additive-versioning
 * rule requires DASH to ignore fields it does not understand rather than
 * reject the document.
 *
 * Both manifest versions are accepted. v1 and v2 are separate schemas with a
 * `const` on `manifest_version`, so a document matches exactly one of them —
 * which makes the version the discriminator and lets each document be checked
 * against the rules it was actually written for.
 *
 * Dispatching on the declared version rather than trying v1 then v2 matters for
 * the error messages: a v2 manifest with one bad field, validated against v1,
 * reports "manifest_version must be equal to constant" and nothing useful about
 * the real mistake. The user sees the errors for the version they declared.
 */
export function validateManifest(input: unknown): ValidationResult<AnyAgentManifest> {
  const declared =
    typeof input === "object" && input !== null
      ? (input as { manifest_version?: unknown }).manifest_version
      : undefined;

  if (declared === 2) {
    const validate = validators().manifestV2;
    if (validate(input)) {
      return { ok: true, value: input as AgentManifestV2 };
    }
    return { ok: false, errors: formatErrors(validate) };
  }

  if (declared === 1 || declared === undefined) {
    // Undefined falls through to v1 so a manifest missing the field entirely
    // still gets v1's "required" error rather than a version complaint that
    // would be confusing on a document that never claimed a version.
    const validate = validators().manifest;
    if (validate(input)) {
      return { ok: true, value: input as AgentManifest };
    }
    return { ok: false, errors: formatErrors(validate) };
  }

  // A version we have never heard of. Say so plainly instead of running it
  // through a schema it was not written for and emitting a misleading diff.
  return {
    ok: false,
    errors: [`(root) unsupported manifest_version ${JSON.stringify(declared)}; DASH understands 1 and 2`],
  };
}

/** True when a manifest carries the v2 Agent DOM block. Use before reading `agent_dom`. */
export function isManifestV2(manifest: AnyAgentManifest): manifest is AgentManifestV2 {
  return manifest.manifest_version === 2;
}

export function validateEvent(input: unknown): ValidationResult<RunEvent> {
  const validate = validators().event;
  if (validate(input)) {
    return { ok: true, value: input as RunEvent };
  }
  return { ok: false, errors: formatErrors(validate) };
}

/**
 * The v1 body, which v2 extends rather than replaces. Split out so the shared
 * fields are stated once — everything in DASH that reads a manifest without
 * caring about the Agent DOM (the agent list, plan-vs-actual analysis) works on
 * this shape and stays version-agnostic.
 */
export interface AgentManifestBody {
  agent: {
    name: string;
    goal: string;
    plan_source: "playbook" | "composed";
    playbook_id: string;
    route_id: string;
    build_target: "cowork" | "cursor" | "chatgpt_gpt" | "code";
  };
  planned_route: Array<{
    step: number;
    component_id: string;
    risk_level: "low" | "medium" | "high" | "critical";
    model_tier: "none" | "small" | "standard" | "frontier";
  }>;
  safety_contract: {
    automation_clearance: string;
    enforced_approval_gates: string[];
    irreversible_components: string[];
  };
  monitoring: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export interface AgentManifest extends AgentManifestBody {
  manifest_version: 1;
}

/**
 * v2 adds the Agent DOM block (MAR-382), which is where declared connections
 * live — and therefore the only manifest version that can produce a Connection
 * Center checklist.
 *
 * `connections` is typed by importing `ManifestConnection` from
 * `lib/connections.ts` rather than restating it. That module is the one place
 * that reads these fields, and a second local copy of the shape is exactly how
 * a renderer and its data layer drift apart. The import is type-only, so this
 * module's I/O does not leak into that pure one.
 */
export interface AgentManifestV2 extends AgentManifestBody {
  manifest_version: 2;
  agent_dom: {
    connections?: ManifestConnection[];
    [key: string]: unknown;
  };
}

export type AnyAgentManifest = AgentManifest | AgentManifestV2;

export type RunEventType =
  | "run_started"
  | "step_started"
  | "step_completed"
  | "gate_requested"
  | "gate_resolved"
  | "run_completed"
  | "run_failed";

export interface RunEvent {
  event_version: 1;
  agent: string;
  run_id: string;
  seq: number;
  ts: string;
  type: RunEventType;
  component_id?: string;
  status?: "ok" | "error" | "skipped" | "pending";
  model?: string;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
  detail?: string;
}
