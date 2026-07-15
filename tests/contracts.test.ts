import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf-8"));
}

function loadObject(relativePath: string): Record<string, unknown> {
  return loadJson(relativePath) as Record<string, unknown>;
}

function compile(relativePath: string): ValidateFunction {
  const validator = new Ajv2020({ strict: true, allErrors: true });
  addFormats(validator);
  return validator.compile(loadJson(relativePath) as object);
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

const forbiddenCredentialKeys = new Set([
  "password",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "client_secret",
  "api_key",
  "credential_value",
]);

const obviousSecretValues = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
];

function securityViolations(value: unknown, location = "$", key = ""): string[] {
  const violations: string[] = [];

  if (forbiddenCredentialKeys.has(key.toLowerCase())) {
    violations.push(`${location} uses forbidden credential field '${key}'`);
  }

  if (typeof value === "string") {
    if (obviousSecretValues.some((pattern) => pattern.test(value))) {
      violations.push(`${location} contains an obvious credential value`);
    }

    if (key === "uri") {
      const parsed = new URL(value);
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        violations.push(`${location} contains URL credentials, query data, or a fragment`);
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...securityViolations(item, `${location}[${index}]`)));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([childKey, child]) => {
      violations.push(...securityViolations(child, `${location}.${childKey}`, childKey));
    });
  }

  return violations;
}

function gmailPolicyViolations(manifest: Record<string, unknown>, state?: Record<string, unknown>): string[] {
  const violations: string[] = [];
  const dom = manifest.agent_dom as Record<string, unknown> | undefined;
  const connections = (dom?.connections as Array<Record<string, unknown>> | undefined) ?? [];
  const gmail = connections.find((connection) => connection.id === "gmail");
  const capabilities = (gmail?.capabilities as Array<Record<string, unknown>> | undefined) ?? [];

  for (const capability of capabilities) {
    const copy = `${String(capability.id)} ${String(capability.label)}`;
    if (/\bgmail[^\n]*\bsend(?:ing)?\b|\bsend(?:ing)?\b[^\n]*\bgmail\b/i.test(copy)) {
      violations.push("Gmail capability introduces outbound delivery");
    }
  }

  const actions = (state?.actions as Array<Record<string, unknown>> | undefined) ?? [];
  for (const action of actions) {
    if (/\bsend(?:ing)?\b/i.test(String(action.label))) {
      violations.push("Gmail action copy is delivery-oriented");
    }
  }

  return violations;
}

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

describe("telemetry contract v1 compatibility", () => {
  const manifestValidator = compile("contracts/agent.manifest.schema.json");
  const eventValidator = compile("contracts/run-event.schema.json");

  it("continues to validate the frozen telemetry-only examples", () => {
    expect(manifestValidator(loadJson("examples/agent.manifest.example.json"))).toBe(true);
    expect(manifestValidator.errors).toBeNull();
    expect(eventValidator(loadJson("examples/run-event.example.json"))).toBe(true);
    expect(eventValidator.errors).toBeNull();
  });

  it("continues to ignore unknown additive fields", () => {
    const manifest = loadObject("examples/agent.manifest.example.json");
    manifest.future_contract_hint = { enabled: true };
    (manifest.agent as Record<string, unknown>).future_display_hint = "compact";

    const event = loadObject("examples/run-event.example.json");
    event.future_metric = { safe_count: 2 };

    expect(manifestValidator(manifest)).toBe(true);
    expect(eventValidator(event)).toBe(true);
  });
});

describe("Agent DOM v2 schemas", () => {
  const manifestValidator = compile("contracts/agent.manifest.v2.schema.json");
  const stateValidator = compile("contracts/agent-dom-state.schema.json");
  const commandValidator = compile("contracts/agent-command.schema.json");

  it.each([
    "examples/agent-managed.manifest.v2.example.json",
    "examples/dash-managed.manifest.v2.example.json",
    "examples/gmail-meeting-assistant.manifest.v2.example.json",
  ])("validates v2 manifest %s", (file) => {
    expect(manifestValidator(loadJson(file)), JSON.stringify(manifestValidator.errors)).toBe(true);
  });

  it("validates the Gmail state and approval command examples", () => {
    expect(stateValidator(loadJson("examples/gmail-meeting-assistant.state.example.json")), JSON.stringify(stateValidator.errors)).toBe(true);
    expect(commandValidator(loadJson("examples/approve-command.example.json")), JSON.stringify(commandValidator.errors)).toBe(true);
  });

  it("keeps unknown v2 fields forward-compatible", () => {
    const manifest = loadObject("examples/agent-managed.manifest.v2.example.json");
    (manifest.agent_dom as Record<string, unknown>).future_resource = { safe_count: 1 };
    expect(manifestValidator(manifest)).toBe(true);

    const state = loadObject("examples/gmail-meeting-assistant.state.example.json");
    state.future_state = { safe_label: "Future additive state" };
    expect(stateValidator(state)).toBe(true);
  });

  it("supports a read-only v2 fallback when an adapter implements no commands", () => {
    const manifest = loadObject("examples/agent-managed.manifest.v2.example.json");
    const dom = manifest.agent_dom as Record<string, unknown>;
    dom.control = { supported: false, command_version: 1, commands: [] };
    expect(manifestValidator(manifest)).toBe(true);
  });

  it("rejects credential values in a connection requirement", () => {
    const manifest = loadObject("examples/agent-managed.manifest.v2.example.json");
    const dom = manifest.agent_dom as Record<string, unknown>;
    const connection = (dom.connections as Array<Record<string, unknown>>)[0];
    const field = (connection.fields as Array<Record<string, unknown>>)[0];
    field.value = "sk-synthetic-not-a-real-key-000000";

    expect(manifestValidator(manifest)).toBe(false);
  });

  it.each(["actor", "target", "expires_at", "nonce", "idempotency_key", "audit"])(
    "rejects a command missing %s",
    (field) => {
      const command = loadObject("examples/approve-command.example.json");
      delete command[field];
      expect(commandValidator(command)).toBe(false);
    },
  );

  it.each(["task_id", "approval_id"])("rejects approval command targets that omit %s", (field) => {
    const command = loadObject("examples/approve-command.example.json");
    delete (command.target as Record<string, unknown>)[field];
    expect(commandValidator(command)).toBe(false);
  });

  it("rejects approval-required actions without runner-enforced approval semantics", () => {
    const state = loadObject("examples/gmail-meeting-assistant.state.example.json");
    const action = (state.actions as Array<Record<string, unknown>>)[0];
    action.approval = { enforcement: "none" };
    expect(stateValidator(state)).toBe(false);
  });

  it("rejects an unmasked connection account identifier", () => {
    const state = loadObject("examples/gmail-meeting-assistant.state.example.json");
    const connection = (state.connections as Array<Record<string, unknown>>)[0];
    connection.masked_account = "meeting.assistant@example.test";
    expect(stateValidator(state)).toBe(false);
  });

  it.each([
    ["contracts/agent.manifest.v2.schema.json", "examples/agent-managed.manifest.v2.example.json", "manifest_version", 1],
    ["contracts/agent-dom-state.schema.json", "examples/gmail-meeting-assistant.state.example.json", "manifest_version", 1],
    ["contracts/agent-command.schema.json", "examples/approve-command.example.json", "command_version", 2],
  ])("rejects incompatible versions in %s", (schemaFile, exampleFile, versionField, incompatibleVersion) => {
    const validator = compile(schemaFile);
    const value = loadObject(exampleFile);
    value[versionField] = incompatibleVersion;
    expect(validator(value)).toBe(false);
  });
});

describe("security policies across schemas and examples", () => {
  const exampleFiles = readdirSync(path.join(root, "examples"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => `examples/${file}`);

  it.each(exampleFiles)("contains no credential values or unsafe URLs: %s", (file) => {
    expect(securityViolations(loadJson(file))).toEqual([]);
  });

  it("detects obvious secret-bearing event fields and values", () => {
    const event = loadObject("examples/run-event.example.json");
    event.access_token = "sk-synthetic-not-a-real-key-000000";
    event.detail = "Bearer synthetic-credential-value";
    expect(securityViolations(event).length).toBeGreaterThanOrEqual(2);
  });

  it("detects an already-expired command even though JSON Schema cannot compare timestamps", () => {
    const command = loadObject("examples/approve-command.example.json");
    command.expires_at = "2026-07-16T09:05:00Z";
    expect(Date.parse(String(command.expires_at))).toBeLessThanOrEqual(Date.parse(String(command.issued_at)));
  });

  it("keeps the Gmail profile draft-only", () => {
    const manifest = loadObject("examples/gmail-meeting-assistant.manifest.v2.example.json");
    const state = loadObject("examples/gmail-meeting-assistant.state.example.json");
    expect(gmailPolicyViolations(manifest, state)).toEqual([]);

    const dom = manifest.agent_dom as Record<string, unknown>;
    const gmail = (dom.connections as Array<Record<string, unknown>>).find((connection) => connection.id === "gmail")!;
    (gmail.capabilities as Array<Record<string, unknown>>).push({ id: "gmail.messages.send", label: "Send Gmail messages", access: "write" });
    expect(gmailPolicyViolations(manifest, state)).toContain("Gmail capability introduces outbound delivery");
  });

  it("requires exactly two proposed times and guarded invite creation in the Gmail fixture", () => {
    const manifest = loadObject("examples/gmail-meeting-assistant.manifest.v2.example.json");
    const state = loadObject("examples/gmail-meeting-assistant.state.example.json");
    const choice = (state.choices as Array<Record<string, unknown>>)[0];
    const action = (state.actions as Array<Record<string, unknown>>)[0];
    const route = manifest.planned_route as Array<Record<string, unknown>>;
    const approvalStep = route.findIndex((step) => step.component_id === "human_approval_gate");
    const calendarWriteStep = route.findIndex((step) => step.component_id === "calendar_event_create");
    expect(choice.options).toHaveLength(2);
    expect(action.label).toBe("Create invite and save Gmail draft");
    expect(action.approval_required).toBe(true);
    expect(action.approval).toMatchObject({ enforcement: "runner_enforced" });
    expect(calendarWriteStep).toBeGreaterThan(approvalStep);
  });

  it("does not retain raw Gmail content as permanent memory", () => {
    const state = loadObject("examples/gmail-meeting-assistant.state.example.json");
    const memory = state.memory as Array<Record<string, unknown>>;
    expect(memory.every((entry) => entry.retention === "user_approved" || entry.retention === "descriptor_only")).toBe(true);
    expect(memory.flatMap((entry) => Object.keys(entry))).not.toEqual(expect.arrayContaining(["raw_content", "message_body", "email_body"]));
  });
});
