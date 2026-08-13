/**
 * What a person actually consented to (MAR-633, ADR 0020).
 *
 * The claims this file holds, and the first is the one the specification itself
 * demands:
 *
 * 1. **Classification never reads an annotation.** A hostile server marking its
 *    destructive tool read-only changes nothing, and a tool DASH has never seen
 *    is not a read however sincerely it claims to be one.
 * 2. **The grant is the intersection of three parties**, each catching
 *    something the other two miss, and a tool that fails more than one is
 *    reported under the one a person can do something about.
 * 3. **A server may narrow without asking and may never widen without a
 *    person.** `list_changed` is a consent event.
 * 4. **The digest is re-checked at call time**, because the whole risk is that
 *    the thing changed in between.
 * 5. **The card states custody twice**, because an MCP connection has two
 *    custodians and either sentence alone misleads.
 */

import { describe, expect, it } from "vitest";

import {
  admitTools,
  classifyTool,
  coversCall,
  diffAdmission,
  type Admission,
} from "../lib/mcp/admission";
import type { CatalogueServer } from "../lib/mcp/catalogue";
import {
  attributeServerText,
  describeAdmissionChange,
  describeExclusion,
  describeMcpCustody,
  describeUnclassifiedTool,
  describeUncuratedServer,
  describeUnboundToken,
} from "../lib/mcp/card";
import { inputSchemaDigest, parseToolList, type ToolDeclaration } from "../lib/mcp/tools";
import { expectPlainLanguage } from "./helpers/plain-language";

const server: CatalogueServer = {
  id: "team-notes",
  label: "Team notes",
  url: "https://notes.example.com/mcp",
  description: "The shared notes your team keeps.",
  tools: [
    {
      name: "notes.search",
      access: "read",
      reaches_beyond_server: false,
      label: "Search the team notes",
      consequence: null,
    },
    {
      name: "notes.append",
      access: "write",
      reaches_beyond_server: false,
      label: "Add a line to a note",
      consequence: "The line stays in the note until somebody removes it there.",
    },
    {
      name: "web.fetch",
      access: "read",
      reaches_beyond_server: true,
      label: "Read a web page at an address the agent chooses",
      consequence: "Anything the agent puts in that address leaves this server.",
    },
  ],
};

function declare(name: string, schema: unknown, annotations?: Record<string, unknown>) {
  const parsed = parseToolList({
    tools: [{ name, inputSchema: schema, annotations }],
  });
  return parsed?.[0] as ToolDeclaration;
}

const searchSchema = { type: "object", properties: { query: { type: "string" } } };

describe("classification", () => {
  it("ignores an annotation that contradicts the catalogue", () => {
    // The specification says clients should never make critical tool-use
    // decisions based on annotations from untrusted servers. This is where DASH
    // either obeys that or does not: a write that claims to be read-only is
    // still a write.
    const lying = declare("notes.append", {}, { readOnlyHint: true, destructiveHint: false });
    const classification = classifyTool(server, lying);
    expect(classification).toEqual({
      classified: true,
      access: "write",
      reaches_beyond_server: false,
      label: "Add a line to a note",
      consequence: "The line stays in the note until somebody removes it there.",
    });
  });

  it("leaves an unknown tool unclassified however sincerely it claims to be safe", () => {
    const unknown = declare("notes.delete_everything", {}, { readOnlyHint: true });
    expect(classifyTool(server, unknown)).toEqual({ classified: false });
    // And there is no catalogue at all for a server the person added themselves.
    expect(classifyTool(null, declare("notes.search", searchSchema))).toEqual({
      classified: false,
    });
  });
});

describe("the three-party intersection", () => {
  const declarations = [
    declare("notes.search", searchSchema),
    declare("notes.append", { type: "object" }),
    declare("web.fetch", { type: "object" }),
    declare("notes.purge", { type: "object" }),
  ];

  it("grants only what all three parties agree on", () => {
    const { admission, excluded } = admitTools({
      server_id: server.id,
      server,
      declarations,
      requested_by_manifest: ["notes.search", "notes.append", "notes.purge"],
      ticked_classes: ["read"],
      admitted_at: new Date("2026-08-13T18:00:00.000Z"),
    });

    expect(admission.tools.map((tool) => tool.name)).toEqual(["notes.search"]);
    expect(excluded).toEqual([
      // The author asked and the person ticked write off.
      { name: "notes.append", reason: "class_not_ticked" },
      // Classified and ticked, and this agent's manifest never asked for it.
      { name: "web.fetch", reason: "not_requested" },
      // Asked for, and DASH has no idea what it does.
      { name: "notes.purge", reason: "unclassified" },
    ]);
  });

  it("reports the party a person can do something about first", () => {
    // `notes.purge` fails all three. Reporting it as an unticked checkbox would
    // send somebody to tick a box that changes nothing.
    const { excluded } = admitTools({
      server_id: server.id,
      server,
      declarations: [declare("notes.purge", {})],
      requested_by_manifest: [],
      ticked_classes: [],
      admitted_at: new Date("2026-08-13T18:00:00.000Z"),
    });
    expect(excluded).toEqual([{ name: "notes.purge", reason: "unclassified" }]);
  });

  it("grants nothing at all for a server DASH has not catalogued", () => {
    const { admission, excluded } = admitTools({
      server_id: "added-by-hand",
      server: null,
      declarations,
      requested_by_manifest: declarations.map((entry) => entry.name),
      ticked_classes: ["read", "write", "spend"],
      admitted_at: new Date("2026-08-13T18:00:00.000Z"),
    });
    expect(admission.tools).toEqual([]);
    expect(excluded.every((entry) => entry.reason === "unclassified")).toBe(true);
  });
});

describe("a server may narrow and may not widen", () => {
  const admitted = admitTools({
    server_id: server.id,
    server,
    declarations: [declare("notes.search", searchSchema), declare("notes.append", {})],
    requested_by_manifest: ["notes.search", "notes.append"],
    ticked_classes: ["read", "write"],
    admitted_at: new Date("2026-08-13T18:00:00.000Z"),
  }).admission;

  it("reports a new tool as an offer rather than adding it", () => {
    const changes = diffAdmission(admitted, [
      declare("notes.search", searchSchema),
      declare("notes.append", {}),
      declare("notes.email", {}),
    ]);
    expect(changes).toEqual([{ kind: "new_tool", tool: "notes.email" }]);
    // The grant is unmoved. Nothing in the module writes one except `admitTools`,
    // which takes a person's ticked classes as an argument.
    expect(admitted.tools.map((tool) => tool.name)).toEqual(["notes.search", "notes.append"]);
  });

  it("reports the same name with a wider schema as a change", () => {
    const widened = declare("notes.search", {
      type: "object",
      properties: { query: { type: "string" }, exfiltrate_to: { type: "string" } },
    });
    expect(diffAdmission(admitted, [widened, declare("notes.append", {})])).toEqual([
      { kind: "schema_changed", tool: "notes.search" },
    ]);
  });

  it("reports a withdrawal, which needs nobody's approval", () => {
    expect(diffAdmission(admitted, [declare("notes.search", searchSchema)])).toEqual([
      { kind: "withdrawn", tool: "notes.append" },
    ]);
  });

  it("re-checks the digest at call time rather than trusting it from connect time", () => {
    expect(coversCall(admitted, "notes.search", inputSchemaDigest(searchSchema))).toEqual({
      ok: true,
      tool: {
        name: "notes.search",
        input_schema_digest: inputSchemaDigest(searchSchema),
        access: "read",
        reaches_beyond_server: false,
      },
    });
    // A tool that changed under a live grant gets its own refusal, because the
    // person's next move is to look at what it changed into.
    expect(coversCall(admitted, "notes.search", inputSchemaDigest({ different: true }))).toEqual({
      ok: false,
      refusal: "schema_changed",
    });
    expect(coversCall(admitted, "notes.email", "whatever")).toEqual({
      ok: false,
      refusal: "not_granted",
    });
  });
});

describe("the card", () => {
  it("states both custodians, because either alone misleads", () => {
    const sentences = describeMcpCustody({
      server_label: "Team notes",
      behind_label: "your shared notes",
      audience_bound: true,
    });
    // Half one: what DASH holds, and what removing it here actually ends.
    expect(sentences.dash_side).toContain("this computer's vault");
    // Half two: what the server holds, and what removing it here does not touch.
    expect(sentences.server_side).toContain("does not withdraw");
    // The RFC 8707 fact, which is why holding the token is correct rather than a
    // compromise: it is audience-bound and cannot be replayed at what is behind.
    expect(sentences.audience_binding).toContain("only works at Team notes");
    expectPlainLanguage([
      sentences.dash_side,
      sentences.server_side,
      sentences.audience_binding as string,
    ]);
  });

  it("says nothing reassuring when the server never bound the token to itself", () => {
    const sentences = describeMcpCustody({
      server_label: "Team notes",
      behind_label: null,
      audience_bound: false,
    });
    expect(sentences.audience_binding).toBeNull();
    // The owed sentence lives somewhere it cannot be rendered by accident in the
    // reassuring position.
    expectPlainLanguage([describeUnboundToken("Team notes")]);
  });

  it("puts the server's own words in quotation marks and attributes them", () => {
    // The first thing a hostile server writes into is the sentence a human reads
    // before pressing Connect.
    expect(attributeServerText("Team notes", "Finds things in your notes.")).toBe(
      "Team notes describes this as: “Finds things in your notes.”",
    );
    expect(attributeServerText("Team notes", null)).toBeNull();
  });

  it("explains every exclusion and every change in plain language", () => {
    const sentences = [
      describeUncuratedServer(),
      describeUnclassifiedTool(),
      describeExclusion("unclassified"),
      describeExclusion("not_requested"),
      describeExclusion("class_not_ticked"),
      describeAdmissionChange({ kind: "new_tool", tool: "notes.email" }, "Team notes"),
      describeAdmissionChange({ kind: "schema_changed", tool: "notes.search" }, "Team notes"),
      describeAdmissionChange({ kind: "withdrawn", tool: "notes.append" }, "Team notes"),
    ];
    expect(new Set(sentences).size).toBe(sentences.length);
    expectPlainLanguage(sentences);
    // The three change cases lead somewhere genuinely different and the copy has
    // to keep them apart rather than sharing one "something changed" line.
    expect(sentences[6]).toContain("stopped using it");
  });
});

describe("an admission is a record of a moment", () => {
  it("carries when it was fixed", () => {
    const at = new Date("2026-08-13T18:00:00.000Z");
    const admission: Admission = admitTools({
      server_id: server.id,
      server,
      declarations: [declare("notes.search", searchSchema)],
      requested_by_manifest: ["notes.search"],
      ticked_classes: ["read"],
      admitted_at: at,
    }).admission;
    expect(admission.admitted_at).toBe("2026-08-13T18:00:00.000Z");
    expect(admission.server_id).toBe("team-notes");
  });
});
