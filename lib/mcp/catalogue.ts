/**
 * The servers DASH offers, and the rule for being in the list (MAR-633,
 * ADR 0020).
 *
 * The membership rule is `CONNECTOR_KINDS_V1`'s, restated for a new kind of
 * entry because it is the reason this file is a by-value array rather than a
 * lookup over something a user or an agent supplied:
 *
 * **A server is in this catalogue because DASH has connected it, listed its
 * tools, classified them, and written the sentences.**
 *
 * That is a narrower claim than it will look. It is not a claim that the server
 * is safe, that its operator is trustworthy, or that its tools do what they
 * say — DASH cannot audit a remote server's behaviour and must not imply it
 * has. What curation buys is that the words on the card were written by someone
 * accountable for them, which is exactly what the advanced "add your own" path
 * cannot have, and the whole reason that path is a different register rather
 * than a riskier one.
 *
 * ## The array is empty, and that is the honest state
 *
 * No MCP server has been connected. Adding an entry now would be asserting the
 * membership rule about work nobody has done, in the one file whose entire
 * value is that the rule holds. `CATALOGUE_SERVERS` therefore ships empty and
 * `tests/mcp-catalogue.test.ts` pins it empty by value, so the first real entry
 * is a diff a reviewer sees.
 *
 * What is not empty is `checkCatalogueEntry`, the invariants an entry must
 * satisfy, and the proof entry below — so the machinery is testable end to end
 * before there is anything real in it, and the first real entry is checked by
 * something that already works.
 */

import { mcpOperationId } from "./audit";
import { admitTransport, type AdmittedTransport } from "./transport";

/**
 * What a tool does, in the vocabulary three surfaces already render.
 *
 * The same three as `BrokerAccess` in `lib/broker/operations.ts`, restated
 * rather than imported: that module pulls in `lib/ai/providers.ts` and the
 * whole operation catalogue, and this vocabulary needs to be reachable from a
 * card without any of it. The values are identical on purpose and
 * `tests/mcp-catalogue.test.ts` asserts they stay that way.
 *
 * There is no fourth value for *send*. A sent message is a `write` whose
 * `consequence` says it cannot be recalled, and a fourth class would fragment a
 * vocabulary the manifest schema, the capability card and the broker all speak.
 */
export type McpAccess = "read" | "write" | "spend";

/** One tool, as DASH classified it. Every string here is DASH's own. */
export interface CatalogueTool {
  /** The name the server uses. Matched against a declaration by exact equality. */
  name: string;
  access: McpAccess;
  /**
   * Whether this tool acts at an address the *agent* names rather than at the
   * server the person connected.
   *
   * A separate axis from `access` rather than a fourth value of it, because a
   * tool can be both a read and an exit: `fetch(url)` reads, and it is also the
   * general-purpose egress channel that turns a document into an
   * exfiltration. Every operation DASH has written until now goes to an origin
   * DASH froze, so the existing vocabulary has no way to say this.
   */
  reaches_beyond_server: boolean;
  /** One sentence, plain language, no identifiers. DASH's words, not the server's. */
  label: string;
  /**
   * What a person will be able to see, or will have lost, because this ran.
   *
   * Required-but-nullable in `WriteOperation.wider_permission`'s shape, and
   * `checkCatalogueEntry` refuses null for anything that is not a plain read —
   * so classifying a tool as a write means answering the question rather than
   * remembering to.
   */
  consequence: string | null;
}

export interface CatalogueServer {
  /** DASH's id for the server. Appears in an operation id and in the audit. */
  id: string;
  /** The name a person reads. */
  label: string;
  /** The endpoint, which must survive `admitTransport`. */
  url: string;
  /** DASH's own sentence about what this server is for. */
  description: string;
  /** Every tool DASH has classified. A tool absent from here is unclassified. */
  tools: readonly CatalogueTool[];
}

/** A catalogue entry that has passed its invariants. */
export interface AdmittedCatalogueServer extends CatalogueServer {
  transport: AdmittedTransport;
}

export type CatalogueDefect =
  | "id_unsafe"
  | "duplicate_tool"
  | "tool_name_unsafe"
  | "consequence_missing"
  | "operation_id_too_long"
  | "transport_refused";

const SAFE_CATALOGUE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SAFE_TOOL_NAME = /^[A-Za-z0-9._:-]{1,128}$/u;

/**
 * The invariants an entry must satisfy, as a function rather than as a comment.
 *
 * Returns defects rather than throwing so a test can enumerate them, and so the
 * check can run over a candidate somebody is proposing as well as over the
 * shipped array.
 */
export function checkCatalogueEntry(entry: CatalogueServer): CatalogueDefect[] {
  const defects: CatalogueDefect[] = [];
  if (!SAFE_CATALOGUE_ID.test(entry.id)) {
    defects.push("id_unsafe");
  }
  if (!admitTransport({ kind: "streamable_http", url: entry.url }, "catalogue").ok) {
    defects.push("transport_refused");
  }
  const seen = new Set<string>();
  for (const tool of entry.tools) {
    if (!SAFE_TOOL_NAME.test(tool.name)) {
      defects.push("tool_name_unsafe");
    }
    if (seen.has(tool.name)) {
      defects.push("duplicate_tool");
    }
    seen.add(tool.name);
    // Caught here rather than at call time, because this is the one moment a
    // human is choosing both halves of the name. See `mcpOperationId`.
    if (mcpOperationId(entry.id, tool.name) === null) {
      defects.push("operation_id_too_long");
    }
    // A read that reaches beyond the server is not a plain read: it is the
    // egress half of the chain ADR 0020's read-then-reach rule is about, and a
    // person approving it deserves the sentence.
    const needsConsequence = tool.access !== "read" || tool.reaches_beyond_server;
    if (needsConsequence && tool.consequence === null) {
      defects.push("consequence_missing");
    }
  }
  return defects;
}

/**
 * Every server DASH offers. Empty, on purpose — see the note at the top.
 */
export const CATALOGUE_SERVERS: readonly CatalogueServer[] = Object.freeze([]);

/** The catalogue id of the proof harness. Not a service that exists. */
export const LOOPBACK_PROOF_SERVER_ID = "dash-loopback-mcp";

/**
 * The proof entry, when the guard allows one.
 *
 * `lib/oauth/providers.ts`'s `proofProvider` in a new place and for the same
 * reason: a proof that stopped before the wire would be the source-level claim
 * `AGENTS.md` forbids, and there is no real curated server to point one at yet.
 * The guard is the same shape — a `DASH_`-namespaced variable, which
 * `runner/supervisor.ts` refuses into every child environment, so no agent can
 * set this for itself or read one that is set — and it exists so the entry
 * cannot come into being by accident on a machine nobody is running a proof on.
 *
 * Its tools are deliberately one of each interesting kind rather than a copy of
 * something real: a plain read, a write with a consequence, and a read that
 * reaches beyond the server, which is the one the read-then-reach rule needs in
 * order to be provable at all.
 */
export function proofCatalogueServer(): CatalogueServer | null {
  const configured = process.env["DASH_MCP_PROOF_URL"];
  if (configured === undefined || configured.length === 0) {
    return null;
  }
  const admitted = admitTransport({ kind: "streamable_http", url: configured }, "catalogue");
  if (!admitted.ok || admitted.transport.origin.startsWith("https:")) {
    // Loopback only. A proof entry that could be pointed at a real host would
    // be a way to add an uncurated server to the curated list by setting one
    // variable, which is the failure the whole file is about.
    return null;
  }
  return {
    id: LOOPBACK_PROOF_SERVER_ID,
    label: "Loopback tools (proof harness)",
    url: admitted.transport.url,
    description: "A server DASH runs against itself to prove the boundary. Not a real service.",
    tools: [
      {
        name: "notes.search",
        access: "read",
        reaches_beyond_server: false,
        label: "Search the notes on this server",
        consequence: null,
      },
      {
        name: "notes.append",
        access: "write",
        reaches_beyond_server: false,
        label: "Add a line to a note on this server",
        consequence: "The line stays in the note until somebody removes it there.",
      },
      {
        name: "web.fetch",
        access: "read",
        reaches_beyond_server: true,
        label: "Read a web page at an address the agent chooses",
        consequence:
          "The agent decides which address is contacted, so anything it puts in that address " +
          "leaves this server.",
      },
    ],
  };
}

/**
 * Look a server up by id, admitting its transport on the way out.
 *
 * `brokerProfileFor`'s shape: the shipped list first, the proof entry second,
 * and null for anything else. A caller that receives null is holding a server
 * DASH has not classified, which `lib/mcp/admission.ts` treats as the
 * attended-only case rather than as an error.
 */
export function catalogueServer(id: string): AdmittedCatalogueServer | null {
  const proof = proofCatalogueServer();
  const entry =
    CATALOGUE_SERVERS.find((server) => server.id === id) ??
    (proof !== null && proof.id === id ? proof : null);
  if (entry === null) {
    return null;
  }
  if (checkCatalogueEntry(entry).length > 0) {
    return null;
  }
  const admitted = admitTransport({ kind: "streamable_http", url: entry.url }, "catalogue");
  if (!admitted.ok) {
    return null;
  }
  return { ...entry, transport: admitted.transport };
}

/** The tool DASH classified under this name, or null when it classified none. */
export function catalogueTool(
  server: CatalogueServer | null,
  name: string,
): CatalogueTool | null {
  return server?.tools.find((tool) => tool.name === name) ?? null;
}
