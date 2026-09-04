/**
 * DASH's own import verdict, delivered before the file is written (MAR-862,
 * ADR 0032 decisions 4 and 5).
 *
 * Nothing here decides what is valid. `validateManifest` decides, and
 * `checkManifestConstraints` decides the part no schema can express, and
 * `explainImportFailure` decides what to say about it — all three imported from
 * `lib/`, all three the functions DASH runs at its own import boundary. This
 * module's only job is to run them somewhere useful and to attach, to each
 * complaint, the thing the caller is actually missing: **what to write
 * instead**.
 *
 * ## Why a fix rather than a message
 *
 * An Ajv string is addressed to somebody holding the schema. `/agent_dom/panel
 * /sections/0/type must be equal to one of the allowed values` names the place
 * and withholds the answer, because the allowed values live in the schema and
 * `formatErrors` renders only the message. A coding agent reading that has two
 * options — guess, or go and read `contracts/` — and the first is what produces
 * a second failed import.
 *
 * So the pointer is resolved back through the schema document and the
 * constraint at that location is quoted: the enum, the pattern, the constant,
 * the type. It is best-effort by design — a pointer that lands inside an
 * `allOf` branch or behind a `$ref` resolves to nothing and the caller gets the
 * raw sentence plus DASH's own suggestion, which is exactly what it would have
 * had anyway. Best-effort is the right ambition for a hint; it would be the
 * wrong ambition for a verdict, and the verdict is not computed here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { contractsDirectory, validateManifest, type AnyAgentManifest } from "../../../lib/contracts";
import { checkManifestConstraints } from "../../../lib/manifest-constraints";
import {
  explainImportFailure,
  type ImportFailureExplanation,
} from "../../../lib/import-feedback";

/** One thing wrong, and what to do about it. */
export interface AgentProblem {
  /** A JSON pointer into the manifest, or `(root)`. Verbatim from the validator. */
  where: string;
  /** The validator's own sentence, unedited. */
  problem: string;
  /**
   * What to write instead, when the schema at `where` says something concrete.
   * Absent when the pointer could not be resolved — see the module header on
   * why that is a hint failing rather than a verdict failing.
   */
  fix?: string;
}

export type ManifestVerdict =
  | {
      ok: true;
      agent: string;
      manifest_version: number;
      /** Nothing wrong with it. Present so a caller can render one shape. */
      problems: readonly [];
    }
  | {
      ok: false;
      /** The agent's declared name, when it managed to declare one. */
      agent: string | null;
      headline: string;
      suggestion: string;
      problems: AgentProblem[];
    };

/**
 * The whole verdict on one manifest document.
 *
 * Schema first, then the constraints. That order is DASH's — `importManifest`
 * runs the schema and only then `checkManifestConstraints` — and the reason to
 * keep it is that a document failing the schema has no reliable
 * `agent_dom.locations` for the constraint check to reason about, so running
 * both would produce a second complaint derived from the first one's rubble.
 */
export function verdictForManifest(input: unknown): ManifestVerdict {
  const validated = validateManifest(input);

  if (!validated.ok) {
    return refusal(input, validated.errors);
  }

  const constraintErrors = checkManifestConstraints(validated.value);
  if (constraintErrors.length > 0) {
    return refusal(input, constraintErrors);
  }

  return {
    ok: true,
    agent: validated.value.agent.name,
    manifest_version: validated.value.manifest_version,
    problems: [],
  };
}

/** Parse then judge. A file that is not JSON is its own kind of answer. */
export function verdictForManifestJson(json: string): ManifestVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      agent: null,
      headline: "That file is not valid JSON, so nothing has read it as a manifest yet.",
      suggestion:
        "Fix the JSON syntax first — the position in the message below is where the parser stopped.",
      problems: [{ where: "(root)", problem: detail }],
    };
  }
  return verdictForManifest(parsed);
}

function refusal(input: unknown, errors: string[]): ManifestVerdict {
  const explanation: ImportFailureExplanation = explainImportFailure(errors);
  return {
    ok: false,
    agent: declaredName(input),
    headline: explanation.headline,
    suggestion: explanation.suggestion,
    problems: errors.map((error) => asProblem(error, input)),
  };
}

function declaredName(input: unknown): string | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const agent = (input as { agent?: unknown }).agent;
  if (typeof agent !== "object" || agent === null) {
    return null;
  }
  const name = (agent as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
}

/**
 * Split one validator string into its pointer and its sentence, and look up
 * what the schema says at that pointer.
 *
 * `formatErrors` renders `${instancePath} ${message}` with a single space, and
 * `instancePath` is either empty — rendered `(root)` — or begins with `/`. So
 * the split is unambiguous without parsing the sentence.
 */
function asProblem(error: string, input: unknown): AgentProblem {
  const space = error.indexOf(" ");
  const where = space === -1 ? "(root)" : error.slice(0, space);
  const problem = space === -1 ? error : error.slice(space + 1);

  const fix = fixFor(where, problem, input);
  return fix === null ? { where, problem } : { where, problem, fix };
}

/**
 * What to write at `where`, in one sentence, or null when nothing useful is
 * known.
 *
 * The missing-property case is handled before the schema lookup because it is
 * the common one and because its pointer names the *parent*: the schema at
 * `/agent_dom` says nothing about a missing `panel` that the parent's
 * `properties.panel` does not say better.
 */
function fixFor(where: string, problem: string, input: unknown): string | null {
  const missing = /must have required property '([^']+)'/.exec(problem);
  if (missing !== null) {
    const property = missing[1];
    const childPointer = where === "(root)" ? `/${property}` : `${where}/${property}`;
    const constraint = describeSchemaAt(childPointer, input);
    const opening = `Add "${property}" at ${where === "(root)" ? "the top level" : where}.`;
    return constraint === null ? opening : `${opening} ${constraint}`;
  }

  return describeSchemaAt(where, input);
}

/**
 * The constraint the schema puts on one location, as a sentence.
 *
 * Reads the same schema files `lib/contracts.ts` compiled, from the directory
 * that module resolved, so the answer cannot come from a different copy than
 * the verdict did.
 */
function describeSchemaAt(pointer: string, input: unknown): string | null {
  if (pointer === "(root)") {
    return null;
  }
  const schema = manifestSchemaFor(input);
  if (schema === null) {
    return null;
  }
  const node = resolvePointer(schema, pointer);
  if (node === null) {
    return null;
  }
  return describeNode(node);
}

/**
 * Which of the two manifest schemas applies, chosen by the document's own
 * declared version — the same discriminator `validateManifest` uses, for the
 * same reason it gives: reading a v2 document against v1's rules produces a
 * confident answer about the wrong contract.
 */
function manifestSchemaFor(input: unknown): SchemaNode | null {
  const declared =
    typeof input === "object" && input !== null
      ? (input as { manifest_version?: unknown }).manifest_version
      : undefined;
  const file = declared === 2 ? "agent.manifest.v2.schema.json" : "agent.manifest.schema.json";
  return loadSchema(file);
}

type SchemaNode = Record<string, unknown>;

const schemaCache = new Map<string, SchemaNode | null>();

function loadSchema(file: string): SchemaNode | null {
  const cached = schemaCache.get(file);
  if (cached !== undefined) {
    return cached;
  }
  let loaded: SchemaNode | null;
  try {
    const raw = readFileSync(path.join(contractsDirectory(), file), "utf8");
    const parsed: unknown = JSON.parse(raw);
    loaded = typeof parsed === "object" && parsed !== null ? (parsed as SchemaNode) : null;
  } catch {
    loaded = null;
  }
  schemaCache.set(file, loaded);
  return loaded;
}

/**
 * Walk an *instance* pointer through a schema document.
 *
 * `/agent/name` becomes `properties.agent.properties.name`; a numeric segment
 * becomes `items`, since every array in these schemas is homogeneous. Anything
 * this cannot follow — a branch under `allOf`, a `$ref`, a `patternProperties`
 * key — returns null rather than a guess, and the caller degrades to the raw
 * message. A wrong hint is worse than no hint: it is a confident instruction to
 * write something that will fail again.
 */
function resolvePointer(schema: SchemaNode, pointer: string): SchemaNode | null {
  let node: SchemaNode = schema;

  for (const raw of pointer.split("/").slice(1)) {
    const segment = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    const next = /^\d+$/.test(segment) ? node["items"] : properties(node)?.[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return null;
    }
    node = next as SchemaNode;
  }

  return node === schema ? null : node;
}

function properties(node: SchemaNode): Record<string, unknown> | null {
  const found = node["properties"];
  if (typeof found !== "object" || found === null || Array.isArray(found)) {
    return null;
  }
  return found as Record<string, unknown>;
}

/**
 * One node's constraints, said out loud.
 *
 * Ordered most-answering-first: an enum settles the question outright, a
 * constant does too, a pattern narrows it, and a type is the weakest thing
 * worth saying. `description` is appended when present because these schemas
 * carry unusually good ones — they are where the reasoning lives — but bounded,
 * since several run to a paragraph and this is a hint beside an error, not
 * documentation.
 */
function describeNode(node: SchemaNode): string | null {
  const parts: string[] = [];

  const constant = node["const"];
  if (constant !== undefined) {
    parts.push(`It must be exactly ${JSON.stringify(constant)}.`);
  }

  const allowed = node["enum"];
  if (Array.isArray(allowed) && allowed.length > 0) {
    parts.push(`Allowed values: ${allowed.map((value) => JSON.stringify(value)).join(", ")}.`);
  }

  const required = node["required"];
  if (Array.isArray(required) && required.length > 0) {
    parts.push(`It must contain: ${required.map((value) => String(value)).join(", ")}.`);
  }

  const pattern = node["pattern"];
  if (typeof pattern === "string") {
    parts.push(`It must match ${pattern}.`);
  }

  if (parts.length === 0) {
    const type = node["type"];
    if (typeof type === "string") {
      parts.push(`It must be ${type === "object" || type === "array" ? "an" : "a"} ${type}.`);
    }
  }

  const description = node["description"];
  if (typeof description === "string" && description.length > 0) {
    parts.push(truncate(description, 240));
  }

  return parts.length === 0 ? null : parts.join(" ");
}

function truncate(value: string, limit: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`;
}

/** Convenience for callers that already hold a validated manifest. */
export function manifestName(manifest: AnyAgentManifest): string {
  return manifest.agent.name;
}
