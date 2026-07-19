import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

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
  event: ValidateFunction;
} {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  return {
    manifest: ajv.compile(loadSchema("contracts/agent.manifest.schema.json")),
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
 */
export function validateManifest(input: unknown): ValidationResult<AgentManifest> {
  const validate = validators().manifest;
  if (validate(input)) {
    return { ok: true, value: input as AgentManifest };
  }
  return { ok: false, errors: formatErrors(validate) };
}

export function validateEvent(input: unknown): ValidationResult<RunEvent> {
  const validate = validators().event;
  if (validate(input)) {
    return { ok: true, value: input as RunEvent };
  }
  return { ok: false, errors: formatErrors(validate) };
}

export interface AgentManifest {
  manifest_version: 1;
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
