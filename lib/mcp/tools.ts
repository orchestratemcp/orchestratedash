/**
 * Reading a server's `tools/list`, which is a document written by the party
 * whose behaviour it describes (MAR-633, ADR 0020).
 *
 * This is an untrusted boundary in `lib/broker/protocol.ts`'s strong sense, and
 * it is worse in one specific way: the far side of the broker protocol is a
 * child process DASH started, while the far side of this is a stranger on the
 * internet whose text will be rendered to a person on a consent screen. So
 * every field is checked rather than cast, and the parser's default answer to
 * anything it does not recognise is no.
 *
 * ## Three things that arrive here and must never decide anything
 *
 * 1. **The tool's name.** It becomes part of an operation id echoed into
 *    `broker_audit` and written into a newline-delimited protocol in the other
 *    direction, so it gets `parseBrokerRequest`'s discipline — printable, no
 *    whitespace, no control characters, no newline. A name containing one would
 *    let a server frame a second message inside a field of the first, or write
 *    a line of its own choosing into DASH's audit table.
 * 2. **The description.** It is the server's sentence about itself and is
 *    rendered quoted and attributed, never as DASH's own description. See
 *    `lib/mcp/card.ts`.
 * 3. **The annotations.** `ToolAnnotations` looks exactly like the thing that
 *    would make classification easy, and the specification is unambiguous that
 *    it is not: the fields are hints, "not guaranteed to be a faithful
 *    representation of actual tool behavior", and clients should "never make
 *    critical tool-use decisions based on annotations received from untrusted
 *    servers". A hostile server sets `readOnlyHint: true` on the tool that
 *    deletes.
 *
 * They are parsed and kept anyway, under a name that says what they are, so a
 * card can show the server's claim beside DASH's classification. A disagreement
 * between the two is itself information a person can act on. Nothing in
 * `lib/mcp/admission.ts` reads them.
 *
 * ## Why the input schema is digested rather than stored
 *
 * The rename-preserving widening is the case a name check misses:
 * `search(query)` becoming `search(query, exfiltrate_to)` is the same name, the
 * same access class and a completely different tool. Comparing a digest taken
 * at consent against the digest offered at call time catches it, and a digest
 * rather than the schema itself keeps an admission record small enough to read.
 */

import { createHash } from "node:crypto";

/**
 * What the server claimed about a tool's behaviour.
 *
 * Nullable rather than defaulted, and the distinction is load-bearing: `null`
 * means the server said nothing, which is different from the server saying
 * `false`. MCP's own defaults are the conservative ones — `destructiveHint` and
 * `openWorldHint` both default to true — so a caller that filled an absence
 * with `false` would be reading the spec backwards.
 */
export interface ClaimedAnnotations {
  read_only: boolean | null;
  destructive: boolean | null;
  idempotent: boolean | null;
  open_world: boolean | null;
}

/** One tool as the server declared it. Every string is the server's, not DASH's. */
export interface ToolDeclaration {
  /** The id an agent would name. Narrowed to the audit-and-protocol-safe set. */
  name: string;
  /** The server's own display title, or null. Rendered quoted. */
  claimed_title: string | null;
  /** The server's own description, or null. Rendered quoted. */
  claimed_description: string | null;
  /** Digest of the input schema as offered. See the note above. */
  input_schema_digest: string;
  /** The server's claims about side effects. Never consulted for a decision. */
  claimed: ClaimedAnnotations;
}

/**
 * The same narrowing `lib/broker/protocol.ts` puts on an id an agent chooses,
 * for the same two reasons: this value is written into a newline-delimited
 * protocol, and it is written into DASH's own audit table.
 */
const SAFE_TOOL_NAME = /^[A-Za-z0-9._:-]{1,128}$/u;

/** Generous caps on text a person will read. Bounds, not format guesses. */
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4096;
/** The most tools DASH will read from one server before refusing the list. */
export const MAX_TOOLS_PER_SERVER = 128;

/** Control characters, including the newline that would frame a second message. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function readClaimedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  // Refused rather than sanitised. A description DASH had to repair before it
  // could render it is a description nobody should be reading on a consent
  // screen, and repairing it would mean the quoted text is not what the server
  // actually sent.
  if (value.length === 0 || value.length > max || CONTROL_CHARACTERS.test(value)) {
    return null;
  }
  return value;
}

function readClaimedFlag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * A stable serialization for digesting.
 *
 * Object keys are sorted, so a server reordering its schema does not read as a
 * change. Arrays keep the order they arrived in: sorting them would mean
 * deciding, per JSON Schema keyword, whether order carries meaning, and the
 * only thing that buys is that a server can reorder `required` without a person
 * being told. Being told is the cheaper mistake.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(",")}}`;
  }
  // `undefined`, a function, a symbol: not JSON, and reachable only from a
  // caller that did not come off the wire. Digested as a named absence rather
  // than as nothing, so two different unserialisable values do not collide with
  // each other or with a real one.
  return '"__dash_unserializable__"';
}

/** Digest of an input schema, as offered at one moment. */
export function inputSchemaDigest(schema: unknown): string {
  return createHash("sha256").update(canonicalJson(schema), "utf8").digest("hex");
}

/**
 * Parse one tool declaration, or return null.
 *
 * Null rather than a refusal, in `parseBrokerRequest`'s sense: a malformed
 * declaration has no identity to address a refusal to. What the caller does
 * with a null is drop that tool and keep the rest, because one bad entry in a
 * list of forty is not a reason to leave a person unable to connect — and a
 * dropped tool is simply a tool that cannot be granted.
 */
export function parseToolDeclaration(candidate: unknown): ToolDeclaration | null {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const value = candidate as Record<string, unknown>;

  const name = value["name"];
  if (typeof name !== "string" || !SAFE_TOOL_NAME.test(name)) {
    return null;
  }

  const annotations =
    typeof value["annotations"] === "object" &&
    value["annotations"] !== null &&
    !Array.isArray(value["annotations"])
      ? (value["annotations"] as Record<string, unknown>)
      : {};

  return {
    name,
    claimed_title: readClaimedText(value["title"], MAX_TITLE_LENGTH),
    claimed_description: readClaimedText(value["description"], MAX_DESCRIPTION_LENGTH),
    input_schema_digest: inputSchemaDigest(value["inputSchema"] ?? null),
    claimed: {
      read_only: readClaimedFlag(annotations["readOnlyHint"]),
      destructive: readClaimedFlag(annotations["destructiveHint"]),
      idempotent: readClaimedFlag(annotations["idempotentHint"]),
      open_world: readClaimedFlag(annotations["openWorldHint"]),
    },
  };
}

/**
 * Parse a whole `tools/list` result.
 *
 * Returns null when the envelope itself is unreadable, and drops individual
 * declarations that are not. A duplicate name is dropped rather than
 * overwriting: two tools called `search` is a server DASH cannot describe to a
 * person, and taking the last one would let a server shadow the entry a person
 * approved with one arriving later in the same array.
 */
export function parseToolList(candidate: unknown): ToolDeclaration[] | null {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const tools = (candidate as Record<string, unknown>)["tools"];
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS_PER_SERVER) {
    return null;
  }

  const seen = new Set<string>();
  const declarations: ToolDeclaration[] = [];
  for (const entry of tools) {
    const declaration = parseToolDeclaration(entry);
    if (declaration === null || seen.has(declaration.name)) {
      continue;
    }
    seen.add(declaration.name);
    declarations.push(declaration);
  }
  return declarations;
}
