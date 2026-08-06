import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { AgentCommandEnvelope } from "./agent-dom/envelope";
import type { ManifestConnection } from "./connections";
import type { AgentDomState } from "./workspace";

/**
 * Validation against the frozen telemetry v1 schemas. DASH is the canonical
 * owner of those schemas, so the app reads the same files the contract tests
 * read rather than keeping a second copy of the rules.
 */

/**
 * The schema files this module compiles. Also the probe: a candidate directory
 * counts as the contracts directory only if it holds all of them, so a stray
 * `contracts/` folder somewhere up the tree cannot half-satisfy the search and
 * produce a confusing missing-file error three frames later.
 */
const SCHEMA_FILES = [
  "agent.manifest.schema.json",
  "agent.manifest.v2.schema.json",
  "run-event.schema.json",
  "run-artifact.schema.json",
  "agent-dom-state.schema.json",
  "agent-command.schema.json",
] as const;

/**
 * Where the schemas are, found rather than assumed.
 *
 * This used to be `process.cwd()`, which held for `pnpm dev` and `pnpm shell`
 * — both launched from the repo root — and was written up in
 * `electron/README.md` as a packaging-phase blocker. MAR-415 turned it into a
 * present-tense one: the bundled runner is a separate process with its own
 * working directory, so a cwd-relative lookup fails outright the first time the
 * runner tries to validate anything.
 *
 * The search order is deliberate:
 *
 * 1. `DASH_CONTRACTS_DIR`, when set. The explicit override a packaged app will
 *    use to point at its resource directory, and the one a test uses to prove
 *    the other two branches are not silently carrying it.
 * 2. Walking up from this module's own location. Correct for the source tree
 *    (`lib/` → repo root) and for an esbuild bundle (`dist/electron/` → repo
 *    root) without either needing to know its own depth.
 * 3. `process.cwd()`. Kept last rather than deleted: Next bundles this module
 *    into a server build where `import.meta.url` may not survive the transform,
 *    and that path has always run from the repo root.
 *
 * Resolved once, at first use, and cached with the compiled validators.
 */
function findContractsDir(): string {
  const candidates: string[] = [];

  const override = process.env.DASH_CONTRACTS_DIR;
  if (override !== undefined && override.length > 0) {
    candidates.push(override);
  }

  // Guarded: a bundler that rewrites `import.meta` leaves this undefined rather
  // than throwing, and the cwd candidate below still answers.
  const here = moduleDirectory();
  if (here !== null) {
    let directory = here;
    while (true) {
      candidates.push(path.join(directory, "contracts"));
      const parent = path.dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  }

  candidates.push(path.join(process.cwd(), "contracts"));

  for (const candidate of candidates) {
    if (SCHEMA_FILES.every((file) => existsSync(path.join(candidate, file)))) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find the contracts directory. Looked in:\n` +
      candidates.map((candidate) => `  ${candidate}`).join("\n") +
      `\nSet DASH_CONTRACTS_DIR to the directory holding ${SCHEMA_FILES[0]}.`,
  );
}

/**
 * This module's directory, or null when the bundler did not preserve it.
 *
 * `fileURLToPath`, not `URL.pathname`, for the reason `electron/main.ts`
 * records at its own preload resolution: on Windows the latter yields
 * "/C:/Users/..." — a string no filesystem call accepts, and one that looks
 * close enough to a path to survive a code review.
 */
function moduleDirectory(): string | null {
  try {
    const url = import.meta.url;
    if (typeof url !== "string" || !url.startsWith("file:")) {
      return null;
    }
    return path.dirname(fileURLToPath(url));
  } catch {
    return null;
  }
}

function loadSchema(directory: string, fileName: string): object {
  return JSON.parse(readFileSync(path.join(directory, fileName), "utf8")) as object;
}

function buildValidators(): {
  manifest: ValidateFunction;
  manifestV2: ValidateFunction;
  event: ValidateFunction;
  artifact: ValidateFunction;
  state: ValidateFunction;
  command: ValidateFunction;
} {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const dir = findContractsDir();
  return {
    manifest: ajv.compile(loadSchema(dir, "agent.manifest.schema.json")),
    manifestV2: ajv.compile(loadSchema(dir, "agent.manifest.v2.schema.json")),
    event: ajv.compile(loadSchema(dir, "run-event.schema.json")),
    // MAR-457. A separate contract from the event above rather than a new event
    // type: telemetry v1 is frozen, `contract.lock.json` holds its digest, and
    // `listRuns` derives run status from events — so an artifact that were an
    // event could change a run's status by existing.
    artifact: ajv.compile(loadSchema(dir, "run-artifact.schema.json")),
    // MAR-417. Both schemas have existed since MAR-382 and neither had ever
    // been compiled by anything; the schema files themselves are untouched.
    state: ajv.compile(loadSchema(dir, "agent-dom-state.schema.json")),
    command: ajv.compile(loadSchema(dir, "agent-command.schema.json")),
  };
}

/**
 * Which directory the schemas were loaded from.
 *
 * Exported so the runner can report it at startup. A separate process
 * validating against a contracts directory nobody can name is the failure mode
 * this search was written to end, and printing the answer is cheaper than
 * inferring it from a stack trace.
 */
export function contractsDirectory(): string {
  return findContractsDir();
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
 * Validate one run artifact (MAR-457).
 *
 * Same boundary discipline as `validateEvent`: the producing agent is a separate
 * program of unknown quality, so its output is checked rather than cast, and one
 * malformed artifact is rejected on its own without discarding anything else
 * that arrived with it.
 */
export function validateArtifact(input: unknown): ValidationResult<RunArtifact> {
  const validate = validators().artifact;
  if (validate(input)) {
    return { ok: true, value: input as RunArtifact };
  }
  return { ok: false, errors: formatErrors(validate) };
}

/**
 * Validate an Agent DOM state snapshot (MAR-417).
 *
 * The returned type is `lib/workspace.ts`'s `AgentDomState` — the subset DASH
 * actually reads — rather than a second transcription of the schema. The schema
 * is the authority on what is valid; the interface is the authority on what we
 * look at, and keeping those separate is why `lib/workspace.ts` can stay pure
 * while this module does the file reading.
 */
export function validateState(input: unknown): ValidationResult<AgentDomState> {
  const validate = validators().state;
  if (validate(input)) {
    return { ok: true, value: input as AgentDomState };
  }
  return { ok: false, errors: formatErrors(validate) };
}

/**
 * Validate an Agent DOM command envelope (MAR-417).
 *
 * DASH constructs its own envelopes in Electron main and could in principle
 * trust them. It validates them anyway, at the point of enforcement, because
 * the envelope is a *transport* document: the same seam accepts one built by a
 * remote adapter, and a check that only runs when we happen to be the author is
 * not a check. It also means `agent-command.schema.json` is executed rather
 * than merely honoured, which is the whole point of this issue.
 */
export function validateCommand(input: unknown): ValidationResult<AgentCommandEnvelope> {
  const validate = validators().command;
  if (validate(input)) {
    return { ok: true, value: input as AgentCommandEnvelope };
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
    permissions?: ManifestPermissions;
    task_inputs?: TaskInputRole[];
    [key: string]: unknown;
  };
}

/**
 * One kind of file a task accepts (MAR-434).
 *
 * Optional on the manifest, and its absence means the agent takes no files —
 * which is every agent that existed before this block did. That reading has to
 * be stated because the other one is available and wrong: an agent with no
 * declared inputs is not an agent that accepts anything.
 *
 * The numeric fields are **narrowing requests, not grants**. `runner/workspace.ts`
 * takes the minimum against its own ceilings, so nothing an agent author writes
 * here can make DASH copy a larger file into its data directory than the runner
 * was built to accept. That is why the type can afford to be this permissive
 * about what a manifest may say.
 */
export interface TaskInputRole {
  /** Technical vocabulary, carried in commands. Never rendered. */
  id: string;
  /** What a person reads: "Customer brief". */
  label: string;
  description?: string;
  required: boolean;
  min_count?: number;
  max_count?: number;
  /**
   * As the runner sniffs them from the bytes, never as an extension claims.
   * Absent means the runner does not narrow by type.
   */
  media_types?: string[];
  max_file_bytes?: number;
  max_total_bytes?: number;
}

/**
 * The declared input roles, or an empty list.
 *
 * A helper rather than a property read at each call site, because `agent_dom` is
 * an index signature and every caller would otherwise be casting `unknown`. It
 * returns `[]` for a v1 manifest, for a v2 manifest with no block, and for a
 * block that is not an array — three different documents that mean the same
 * thing to a caller: this agent asked for no files.
 */
export function taskInputRoles(manifest: AnyAgentManifest): TaskInputRole[] {
  if (!isManifestV2(manifest)) {
    return [];
  }
  const declared = manifest.agent_dom["task_inputs"];
  return Array.isArray(declared) ? (declared as TaskInputRole[]) : [];
}

/**
 * One declared capability that needs no credential (MAR-457).
 *
 * `id` is the registry's vocabulary and never reaches a guided surface; `label`
 * and `detail` are what a person reads. See the schema for why this is a
 * declaration DASH renders rather than a boundary DASH enforces.
 */
export interface PermissionGrant {
  id: string;
  label: string;
  detail: string;
}

export interface ManifestPermissions {
  read?: PermissionGrant[];
  write?: PermissionGrant[];
  approval_required_for?: PermissionGrant[];
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

/** How a run reported one source it tried to read. */
export type ArtifactSourceStatus = "ok" | "unreachable" | "not_a_feed" | "empty";

export interface ArtifactSource {
  source_name: string;
  source_url: string;
  status: ArtifactSourceStatus;
  fetched_at?: string;
  item_count?: number;
}

export interface ArtifactItem {
  headline: string;
  summary?: string;
  source_name?: string;
  /** Absent means uncited. Kept and rendered as such, never dropped. */
  source_url?: string;
  item_url?: string;
  published_at?: string;
}

/**
 * What a run produced (MAR-457), as distinct from what it did.
 *
 * The stable pair is `(agent, run_id, artifact_id)`: re-opening a digest
 * resolves to the same document rather than to whatever is newest.
 */
interface RunArtifactBase {
  artifact_version: 1;
  agent: string;
  run_id: string;
  artifact_id: string;
  title: string;
  generated_at: string;
}

export interface DigestArtifact extends RunArtifactBase {
  kind: "digest";
  sources_fetched?: ArtifactSource[];
  items: ArtifactItem[];
}

/**
 * Where a composed reply actually is (MAR-469).
 *
 * A union rather than a flag, so every renderer branches. MAR-458's draft was
 * always local and the word "local" was load-bearing in the copy; MAR-469 made
 * it conditionally false without changing the artifact kind, which is precisely
 * the situation where an optional boolean gets forgotten by one call site and
 * that call site is the one telling a person nothing left DASH.
 *
 * **It is a claim, not a record.** The agent asserts this about its own work.
 * DASH's independent record of what it actually performed is the broker audit
 * trail on the Connections page, and copy rendering `provider_draft` has to
 * attribute rather than assert — the same standing `sources_fetched` has for a
 * digest.
 */
export type DraftPlacement =
  /** DASH is holding this and it exists nowhere else. */
  | { where: "dash_only" }
  /** The agent says it created a draft at the provider through the broker. */
  | { where: "provider_draft"; service: string; draft_id?: string };

/**
 * A reply an agent composed (MAR-458, MAR-469).
 *
 * **Nothing here has been sent, in either placement.** The broker has no send
 * operation: not for a message, not for a draft it created. What changed at
 * stage 2 is narrower and worth stating exactly — a `provider_draft` reply is
 * sitting in the user's own Drafts folder, visible in their mail client and one
 * human click from going out. Copy must not flatten that back into "held here
 * only", and must not inflate it into "sent" either.
 */
export interface ArtifactDraft {
  to?: string[];
  subject: string;
  body: string;
  placement: DraftPlacement;
  in_reply_to?: { message_id?: string; thread_id?: string };
  /** The messages the agent says it read to write this. */
  sources?: Array<{ message_id: string; subject?: string; from?: string }>;
}

export interface DraftArtifact extends RunArtifactBase {
  kind: "draft";
  draft: ArtifactDraft;
}

/**
 * A discriminated union rather than one interface with optional members
 * (MAR-458).
 *
 * The alternative was `items?: ArtifactItem[]` and `draft?: ArtifactDraft`,
 * which compiles and quietly breaks the one thing worth protecting:
 * `analyzeGrounding` iterates `artifact.items`, and an optional `items` would
 * make a draft artifact reaching it a runtime crash on a page a user is looking
 * at — or worse, with a `?? []`, a draft silently graded as a perfectly grounded
 * digest of nothing. A union makes that a compile error at every call site,
 * which is where MAR-457's own lesson points: four defects reached the installed
 * smoke because nothing forced a caller to exist.
 */
export type RunArtifact = DigestArtifact | DraftArtifact;

/** Narrow to the kind the grounding verdict is about. */
export function isDigestArtifact(artifact: RunArtifact): artifact is DigestArtifact {
  return artifact.kind === "digest";
}
