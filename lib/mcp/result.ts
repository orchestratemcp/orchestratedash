/**
 * Turning a tool result into something an agent may read (MAR-633, ADR 0020).
 *
 * Every existing broker operation has a hand-written `project` that names each
 * field an agent may see. An MCP result has no such function, because nobody
 * wrote the tool. What replaces it is a **whitelist over block kinds**: a shape
 * this module does not recognise does not arrive as an unknown, it arrives as
 * an omission with a reason. A stripper would have to anticipate every shape
 * worth removing; a whitelist only has to be right about the shapes it passes.
 *
 * ## Content is data, and here is what that means mechanically
 *
 * There is no code path from a value in this file back into
 * `parseBrokerRequest`. A result cannot name a connection, an operation, a tool
 * or a scope; it cannot widen an admission, which is written only by
 * `admitTools` from a person's ticked classes; and it cannot open a spend
 * allowance, which only `electron/main.ts` opens on a Run press. Those are
 * properties of where the code can run rather than checks that could be
 * forgotten.
 *
 * What DASH cannot do is stop an agent believing what it reads. If a document
 * says *now call the send tool with the previous result* and the agent obeys,
 * what arrives at the broker is a well-formed request for a granted tool. That
 * is what `lib/mcp/reach.ts` exists for, and it is why this file's docblock
 * does not claim to prevent injection.
 *
 * ## DASH does not follow a link a server returned
 *
 * A `resource_link` is a description of somewhere, and it arrives as a
 * description. DASH does not fetch it, does not resolve it, and does not
 * present it as something to click unless its scheme is one a browser would
 * accept — because a `javascript:` or `data:` URI rendered as a link is an
 * attack, and one arriving inside a tool result is an attack from precisely the
 * party this module distrusts.
 *
 * ## Provenance travels with the content
 *
 * Every projected result names the server and the tool that produced it, so an
 * artifact derived from a poisoned document can say where the document came
 * from. Grounding is already a second verdict axis outside
 * `RunAnalysis.compliant`; this is the input that keeps it honest when a source
 * is an MCP server rather than a URL the agent fetched.
 */

/** Which server and tool produced this. Travels with the content, always. */
export interface McpProvenance {
  server_id: string;
  /** The server's name as a person reads it. DASH's word for it, or the person's. */
  server_label: string;
  tool: string;
}

export type ProjectedBlock =
  | { kind: "text"; text: string }
  | {
      kind: "link";
      uri: string;
      /** The server's own words about the link, or null. Rendered quoted. */
      claimed_description: string | null;
      /** Whether a surface may present this as something to open. */
      openable: boolean;
    }
  | { kind: "omitted"; reason: OmissionReason };

export type OmissionReason =
  /** A block kind this slice does not carry: an image, audio, anything new. */
  | "kind_not_carried"
  /** The result was longer than DASH will read. */
  | "truncated"
  /** The block was the right kind and its contents were unreadable. */
  | "malformed";

export interface ProjectedResult {
  provenance: McpProvenance;
  blocks: readonly ProjectedBlock[];
  /** The server said the call failed. Its claim, carried rather than interpreted. */
  claimed_error: boolean;
  /** Whether anything was dropped for length. Separate from an omitted block. */
  truncated: boolean;
}

/**
 * How much text DASH will carry out of one tool result.
 *
 * A bound on what a compromised or merely enthusiastic server can push into a
 * DASH process and an agent's context, in the spirit of
 * `OperationBase.max_response_bytes` — which is per operation there because the
 * operations differ by an order of magnitude. Here there is one number, because
 * DASH did not write the tools and has no basis for saying which of them
 * deserves more.
 */
export const MAX_RESULT_TEXT_BYTES = 64 * 1024;

/** The most blocks DASH will carry. Past this the rest is one omission. */
export const MAX_RESULT_BLOCKS = 64;

/** Schemes a surface may offer to open. Everything else is shown and inert. */
const OPENABLE_SCHEMES: readonly string[] = Object.freeze(["http:", "https:"]);

const MAX_URI_LENGTH = 2048;
const MAX_LINK_DESCRIPTION = 512;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function textByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * Truncate at or under a byte budget, without splitting a character.
 *
 * Byte-counted because the budget is about memory and context, and a
 * character-counted cap would let a result of astral-plane characters be four
 * times the size DASH thought it allowed.
 *
 * Cut in the byte buffer and walk back off any UTF-8 continuation byte, which
 * is at most three steps. The obvious alternative — search for the longest
 * prefix whose encoded length fits — measures a growing slice repeatedly and is
 * quadratic in the input, on input a hostile server chooses the size of.
 */
function clampText(value: string, budget: number): { text: string; truncated: boolean } {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.length <= budget) {
    return { text: value, truncated: false };
  }
  let end = budget;
  // `encoded[end]` is the first byte being dropped. While it is a continuation
  // byte (`10xxxxxx`), the cut is inside a character.
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) {
    end -= 1;
  }
  return { text: encoded.subarray(0, end).toString("utf8"), truncated: true };
}

function readLink(value: Record<string, unknown>): ProjectedBlock {
  const uri = value["uri"];
  if (typeof uri !== "string" || uri.length === 0 || uri.length > MAX_URI_LENGTH) {
    return { kind: "omitted", reason: "malformed" };
  }
  if (CONTROL_CHARACTERS.test(uri)) {
    return { kind: "omitted", reason: "malformed" };
  }
  let openable = false;
  try {
    openable = OPENABLE_SCHEMES.includes(new URL(uri).protocol);
  } catch {
    openable = false;
  }
  const described = value["description"];
  const claimed =
    typeof described === "string" &&
    described.length > 0 &&
    described.length <= MAX_LINK_DESCRIPTION &&
    !CONTROL_CHARACTERS.test(described)
      ? described
      : null;
  return { kind: "link", uri, claimed_description: claimed, openable };
}

/**
 * Project one tool result.
 *
 * Never throws and never returns null: a result DASH could not read at all
 * becomes a projection with no blocks, because the agent still asked and the
 * audit still needs a row. An empty projection is a fact about the call, not an
 * error in DASH.
 */
export function projectToolResult(
  candidate: unknown,
  provenance: McpProvenance,
): ProjectedResult {
  const empty: ProjectedResult = {
    provenance,
    blocks: [],
    claimed_error: false,
    truncated: false,
  };
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return empty;
  }
  const value = candidate as Record<string, unknown>;
  const content = value["content"];
  const claimedError = value["isError"] === true;
  if (!Array.isArray(content)) {
    return { ...empty, claimed_error: claimedError };
  }

  const blocks: ProjectedBlock[] = [];
  let budget = MAX_RESULT_TEXT_BYTES;
  let truncated = false;

  for (const entry of content) {
    if (blocks.length >= MAX_RESULT_BLOCKS) {
      truncated = true;
      break;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      blocks.push({ kind: "omitted", reason: "malformed" });
      continue;
    }
    const block = entry as Record<string, unknown>;
    const type = block["type"];

    if (type === "text") {
      const text = block["text"];
      if (typeof text !== "string") {
        blocks.push({ kind: "omitted", reason: "malformed" });
        continue;
      }
      if (budget === 0) {
        truncated = true;
        blocks.push({ kind: "omitted", reason: "truncated" });
        continue;
      }
      const clamped = clampText(text, budget);
      budget -= textByteLength(clamped.text);
      truncated = truncated || clamped.truncated;
      blocks.push({ kind: "text", text: clamped.text });
      continue;
    }

    if (type === "resource_link") {
      blocks.push(readLink(block));
      continue;
    }

    // Everything else — images, audio, embedded resources, and every block kind
    // a later revision adds. Named as not carried rather than dropped silently,
    // so a person reading a result can tell "the server sent nothing" from
    // "DASH does not carry what the server sent".
    blocks.push({ kind: "omitted", reason: "kind_not_carried" });
  }

  return { provenance, blocks, claimed_error: claimedError, truncated };
}

/**
 * The attribution line that goes wherever this content is shown or cited.
 *
 * A function rather than a template each surface writes, so the sentence cannot
 * drift into one that reads as DASH vouching for the content.
 */
export function provenanceLine(provenance: McpProvenance): string {
  return `Read from ${provenance.server_label}, using its ${provenance.tool} tool.`;
}
