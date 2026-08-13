/**
 * Reading a document written by the party it describes (MAR-633, ADR 0020).
 *
 * `tests/broker-threat-model.test.ts` attacks `lib/broker/operations.ts` with no
 * Electron, no runner and no Google account, because the attacks worth writing
 * are all pure functions of an untrusted input. The same is true here and the
 * untrusted party is further away: the far side of the broker protocol is a
 * child process DASH started, and the far side of this is a stranger on the
 * internet whose text will be rendered to a person on a consent screen.
 *
 * The claims this file holds:
 *
 * 1. **A tool name cannot forge a protocol line or an audit row.**
 * 2. **A malformed entry costs its own tool and nothing else.**
 * 3. **A digest notices the rename-preserving widening** — the same name, the
 *    same class, one more input field — and does not notice a reordering.
 * 4. **An operation id is unambiguous** even though tool names may contain the
 *    character that separates it, and it refuses to exist when it would not fit.
 * 5. **An audit row carries names and never values.**
 */

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  inputSchemaDigest,
  MAX_TOOLS_PER_SERVER,
  parseToolDeclaration,
  parseToolList,
} from "../lib/mcp/tools";
import {
  MAX_OPERATION_ID_LENGTH,
  mcpAuditRow,
  mcpOperationId,
  parseMcpOperationId,
} from "../lib/mcp/audit";

describe("parsing one declaration", () => {
  it("keeps the server's own words as the server's own words", () => {
    const declaration = parseToolDeclaration({
      name: "notes.search",
      title: "Search notes",
      description: "Finds things in your notes.",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      annotations: { readOnlyHint: true, openWorldHint: false },
    });
    expect(declaration?.name).toBe("notes.search");
    expect(declaration?.claimed_title).toBe("Search notes");
    expect(declaration?.claimed_description).toBe("Finds things in your notes.");
    // Kept under a name that says whose claim it is. Nothing in
    // `lib/mcp/admission.ts` reads it — see `tests/mcp-consent.test.ts`.
    expect(declaration?.claimed).toEqual({
      read_only: true,
      destructive: null,
      idempotent: null,
      open_world: false,
    });
  });

  it("does not fill an unsaid annotation with false", () => {
    // MCP's own defaults are the conservative ones — `destructiveHint` and
    // `openWorldHint` both default to true — so a caller that read an absence as
    // `false` would be reading the specification backwards. Null means unsaid.
    const declaration = parseToolDeclaration({ name: "notes.search", inputSchema: {} });
    expect(declaration?.claimed).toEqual({
      read_only: null,
      destructive: null,
      idempotent: null,
      open_world: null,
    });
  });

  it("refuses a name that could frame a second protocol message", () => {
    // The value is written into a newline-delimited protocol in the other
    // direction and into DASH's own audit table. This is `parseBrokerRequest`'s
    // reason, applied to a name a stranger chose.
    for (const name of [
      "notes\nsearch",
      "notes search",
      "notes/search",
      "notes\u0000search",
      "",
      "a".repeat(129),
    ]) {
      expect(parseToolDeclaration({ name, inputSchema: {} }), name).toBeNull();
    }
  });

  it("drops description text it would have had to repair before rendering", () => {
    // Refused rather than sanitised: a description DASH edited is not what the
    // server sent, and the whole point of quoting it is that it is.
    const declaration = parseToolDeclaration({
      name: "notes.search",
      description: "Finds things\u0007in your notes.",
      inputSchema: {},
    });
    expect(declaration?.claimed_description).toBeNull();
  });
});

describe("parsing a whole list", () => {
  it("drops one bad entry and keeps the rest", () => {
    const parsed = parseToolList({
      tools: [
        { name: "notes.search", inputSchema: {} },
        { name: "bad name", inputSchema: {} },
        "not an object",
        { name: "notes.append", inputSchema: {} },
      ],
    });
    expect(parsed?.map((entry) => entry.name)).toEqual(["notes.search", "notes.append"]);
  });

  it("drops a duplicate rather than letting the later one win", () => {
    // Taking the last would let a server shadow the entry a person approved with
    // one arriving later in the same array.
    const parsed = parseToolList({
      tools: [
        { name: "notes.search", inputSchema: { properties: { query: {} } } },
        { name: "notes.search", inputSchema: { properties: { query: {}, send_to: {} } } },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.input_schema_digest).toBe(
      inputSchemaDigest({ properties: { query: {} } }),
    );
  });

  it("refuses an unreadable envelope and an oversized one", () => {
    expect(parseToolList(null)).toBeNull();
    expect(parseToolList({ tools: "many" })).toBeNull();
    expect(
      parseToolList({
        tools: Array.from({ length: MAX_TOOLS_PER_SERVER + 1 }, (_, index) => ({
          name: `tool${String(index)}`,
          inputSchema: {},
        })),
      }),
    ).toBeNull();
  });
});

describe("the input schema digest", () => {
  it("catches the rename-preserving widening", () => {
    // The case a name check misses and the reason the digest exists at all:
    // same name, same access class, completely different tool.
    const before = inputSchemaDigest({
      type: "object",
      properties: { query: { type: "string" } },
    });
    const after = inputSchemaDigest({
      type: "object",
      properties: { query: { type: "string" }, exfiltrate_to: { type: "string" } },
    });
    expect(after).not.toBe(before);
  });

  it("is unmoved by a server reordering its own keys", () => {
    expect(inputSchemaDigest({ a: 1, b: 2 })).toBe(inputSchemaDigest({ b: 2, a: 1 }));
  });

  it("keeps array order significant", () => {
    // Sorting would mean deciding per JSON Schema keyword whether order carries
    // meaning, and the only thing that buys is a silent reorder of `required`.
    expect(inputSchemaDigest({ required: ["a", "b"] })).not.toBe(
      inputSchemaDigest({ required: ["b", "a"] }),
    );
  });

  it("digests a value JSON cannot carry as a named absence rather than as nothing", () => {
    // Reachable only from a caller that did not come off the wire, and given a
    // name so that two unserialisable values do not silently digest the same as
    // each other or as a real one.
    expect(canonicalJson({ a: undefined })).toBe("{}");
    expect(canonicalJson(undefined)).toBe('"__dash_unserializable__"');
    expect(inputSchemaDigest(undefined)).not.toBe(inputSchemaDigest(null));
  });
});

describe("the operation id", () => {
  it("round-trips despite tool names containing the separator", () => {
    // A server id may not contain a dot, so the second segment is always the
    // server and everything after it is always the tool.
    const id = mcpOperationId("notes-server", "notes.search.deep");
    expect(id).toBe("mcp.notes-server.notes.search.deep");
    expect(parseMcpOperationId(id as string)).toEqual({
      server_id: "notes-server",
      tool: "notes.search.deep",
    });
  });

  it("refuses to mint an id no agent could name", () => {
    // The broker protocol refuses an operation past 128 characters before it
    // looks anything up, so a longer id would be a grant that looks live and
    // refuses forever.
    expect(mcpOperationId("a".repeat(60), "b".repeat(80))).toBeNull();
    expect((mcpOperationId("notes-server", "notes.search") as string).length).toBeLessThanOrEqual(
      MAX_OPERATION_ID_LENGTH,
    );
  });

  it("refuses unsafe halves in both directions", () => {
    expect(mcpOperationId("Notes Server", "notes.search")).toBeNull();
    expect(mcpOperationId("notes-server", "notes search")).toBeNull();
    expect(parseMcpOperationId("gmail.search")).toBeNull();
    expect(parseMcpOperationId("mcp.notes-server")).toBeNull();
    expect(parseMcpOperationId("mcp..search")).toBeNull();
  });
});

describe("the audit row", () => {
  it("carries the names of the fields an agent supplied and none of the values", () => {
    const row = mcpAuditRow({
      agent: "news-scout",
      connection_id: "team-notes",
      operation: "mcp.notes-server.notes.search",
      request_id: "1-4",
      input: { query: "the merger nobody has announced", limit: 5 },
      decision: "allowed",
      refusal: null,
      result_count: 3,
      duration_ms: 41,
      decided_at: new Date("2026-08-13T18:00:00.000Z"),
    });
    expect(row.input_keys).toBe("limit,query");
    expect(JSON.stringify(row)).not.toContain("merger");
    // A server token identifies nobody, so there are no four characters of an
    // address to mask and an invented hint would be worse than absent.
    expect(row.account_hint).toBeNull();
  });

  it("keeps a refusal's shape distinguishable from an allowed call's", () => {
    const row = mcpAuditRow({
      agent: "news-scout",
      connection_id: "team-notes",
      operation: "mcp.notes-server.notes.append",
      request_id: "1-5",
      input: { line: "anything" },
      decision: "refused",
      refusal: "needs_a_person",
      result_count: 7,
      duration_ms: 1,
      decided_at: new Date("2026-08-13T18:00:01.000Z"),
    });
    expect(row.refusal).toBe("needs_a_person");
    // A refusal carried nothing out, so a count would be describing a result
    // that does not exist.
    expect(row.result_count).toBeNull();
  });
});
