/**
 * Which transports DASH admits, and what the catalogue may contain (MAR-633,
 * ADR 0020).
 *
 * The claims this file holds:
 *
 * 1. **The stdio rules are permanent and the stdio gate is temporary**, and the
 *    refusal order proves which is which. A launcher, a relative path and a
 *    manifest-supplied command each refuse on their own ground; a
 *    perfectly-formed proposal refuses on the slice gate alone. So switching
 *    stdio on later is deleting one line, and the three rules that were always
 *    permanent are already tested.
 * 2. **A manifest may ask and may never supply.** The one rule whose absence
 *    would make a connection kind into remote code execution arriving through
 *    the import door.
 * 3. **The catalogue is empty**, pinned by value, because no MCP server has
 *    been connected and the membership rule is a claim about work somebody did.
 * 4. **The invariants exist before the entries do**, so the first real entry is
 *    checked by something that already works.
 */

import { describe, expect, it } from "vitest";

import {
  admitTransport,
  commandBasename,
  describeTransportRefusal,
  FORBIDDEN_LAUNCHERS,
  isAbsolutePath,
  type McpTransportProposal,
} from "../lib/mcp/transport";
import {
  CATALOGUE_SERVERS,
  catalogueServer,
  catalogueTool,
  checkCatalogueEntry,
  LOOPBACK_PROOF_SERVER_ID,
  proofCatalogueServer,
  type CatalogueServer,
} from "../lib/mcp/catalogue";
import { expectPlainLanguage } from "./helpers/plain-language";

const PROOF_URL = "http://127.0.0.1:47811/mcp";

function withProofServer<T>(url: string, body: () => T): T {
  const previous = process.env["DASH_MCP_PROOF_URL"];
  process.env["DASH_MCP_PROOF_URL"] = url;
  try {
    return body();
  } finally {
    if (previous === undefined) {
      delete process.env["DASH_MCP_PROOF_URL"];
    } else {
      process.env["DASH_MCP_PROOF_URL"] = previous;
    }
  }
}

describe("remote transport admission", () => {
  it("admits an https endpoint and derives the audience it will be bound to", () => {
    const admitted = admitTransport(
      { kind: "streamable_http", url: "https://tools.example.com/team-a/mcp" },
      "person",
    );
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) {
      return;
    }
    expect(admitted.transport.origin).toBe("https://tools.example.com");
    // The path is kept: two servers can live on one host, and an audience that
    // named only the origin would be a token valid at both.
    expect(admitted.transport.resource).toBe("https://tools.example.com/team-a/mcp");
  });

  it("keeps two servers on one host apart in the audience they bind", () => {
    const a = admitTransport(
      { kind: "streamable_http", url: "https://tools.example.com/team-a/mcp" },
      "person",
    );
    const b = admitTransport(
      { kind: "streamable_http", url: "https://tools.example.com/team-b/mcp" },
      "person",
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) {
      return;
    }
    expect(a.transport.resource).not.toBe(b.transport.resource);
  });

  it("refuses plain http off this machine and admits only literal loopback", () => {
    expect(
      admitTransport({ kind: "streamable_http", url: "http://tools.example.com/mcp" }, "person"),
    ).toEqual({ ok: false, refusal: "url_not_https" });
    // `localhost` is refused for `loopbackProofOrigin`'s reason: what it
    // resolves to is a property of a hosts file.
    expect(
      admitTransport({ kind: "streamable_http", url: "http://localhost:47811/mcp" }, "person"),
    ).toEqual({ ok: false, refusal: "url_not_https" });
    expect(admitTransport({ kind: "streamable_http", url: PROOF_URL }, "person").ok).toBe(true);
  });

  it("refuses a sign-in written into the address before it notices anything else", () => {
    // Both defects present. The credential wins, because a credential in a URL
    // is a credential in every log line that URL ever reaches.
    expect(
      admitTransport(
        { kind: "streamable_http", url: "https://user:secret@tools.example.com/mcp#frag" },
        "person",
      ),
    ).toEqual({ ok: false, refusal: "url_has_credentials" });
  });

  it("refuses a fragment, an unreadable address and an unknown kind", () => {
    expect(
      admitTransport({ kind: "streamable_http", url: "https://tools.example.com/mcp#x" }, "person"),
    ).toEqual({ ok: false, refusal: "url_has_fragment" });
    expect(
      admitTransport({ kind: "streamable_http", url: "not a url" }, "person"),
    ).toEqual({ ok: false, refusal: "url_malformed" });
    expect(
      admitTransport(
        { kind: "websocket", url: "wss://tools.example.com" } as unknown as McpTransportProposal,
        "person",
      ),
    ).toEqual({ ok: false, refusal: "unknown_transport" });
  });
});

describe("stdio is an install, not a connection", () => {
  const wellFormed: McpTransportProposal = {
    kind: "stdio",
    command: "/usr/local/bin/notes-mcp-server",
    args: [],
  };

  it("refuses a well-formed proposal on the slice gate alone", () => {
    // The load-bearing assertion of the ordering: nothing is wrong with this
    // proposal except that stdio is not in the slice. Switching stdio on is
    // deleting one line, and the three rules below keep working when it is.
    expect(admitTransport(wellFormed, "person")).toEqual({
      ok: false,
      refusal: "stdio_not_admitted",
    });
  });

  it("refuses a manifest-supplied command ahead of every other rule", () => {
    // A manifest is a third party's JSON document. This is the whole difference
    // between a connection kind and remote code execution through the import
    // door, so it wins even over a command that is otherwise perfect.
    expect(admitTransport(wellFormed, "manifest")).toEqual({
      ok: false,
      refusal: "command_from_manifest",
    });
  });

  it("refuses every package-manager launcher and shell, however it is spelled", () => {
    for (const launcher of FORBIDDEN_LAUNCHERS) {
      for (const spelling of [
        launcher,
        `/usr/local/bin/${launcher}`,
        `C:\\Program Files\\nodejs\\${launcher.toUpperCase()}.CMD`,
      ]) {
        expect(
          admitTransport({ kind: "stdio", command: spelling, args: ["-y", "some-server"] }, "person"),
          `${spelling} must refuse as a launcher`,
        ).toEqual({ ok: false, refusal: "launcher_forbidden" });
      }
    }
  });

  it("refuses a command that is not a full location on this computer", () => {
    expect(
      admitTransport({ kind: "stdio", command: "notes-mcp-server", args: [] }, "person"),
    ).toEqual({ ok: false, refusal: "command_not_absolute" });
    expect(
      admitTransport({ kind: "stdio", command: "./server.mjs", args: [] }, "person"),
    ).toEqual({ ok: false, refusal: "command_not_absolute" });
  });

  it("reads absoluteness from the string rather than from the host platform", () => {
    // A connection proposal is a document that travels between Henrik's Windows
    // machine and a Linux CI box. `node:path`'s answer would differ between them.
    expect(isAbsolutePath("/usr/local/bin/server")).toBe(true);
    expect(isAbsolutePath("C:\\tools\\server.exe")).toBe(true);
    expect(isAbsolutePath("\\\\share\\tools\\server.exe")).toBe(true);
    expect(isAbsolutePath("tools/server")).toBe(false);
  });

  it("strips a Windows executable suffix before comparing a command name", () => {
    expect(commandBasename("C:\\Program Files\\nodejs\\npx.CMD")).toBe("npx");
    expect(commandBasename("/usr/bin/env")).toBe("env");
  });
});

describe("what a person reads when a transport is refused", () => {
  it("says which rule was met, in plain language", () => {
    const sentences = (
      [
        "unknown_transport",
        "command_from_manifest",
        "launcher_forbidden",
        "command_not_absolute",
        "stdio_not_admitted",
        "url_malformed",
        "url_not_https",
        "url_has_credentials",
        "url_has_fragment",
      ] as const
    ).map((refusal) => describeTransportRefusal(refusal));
    expect(new Set(sentences).size).toBe(sentences.length);
    expectPlainLanguage(sentences);
  });
});

describe("the catalogue", () => {
  it("is empty, and that is the honest state", () => {
    // Pinned by value in `WRITE_PATHS`' shape. No MCP server has been connected,
    // and the membership rule — DASH connected it, listed its tools, classified
    // them, wrote the sentences — is a claim about work somebody did. The first
    // real entry is a diff a reviewer sees.
    expect(CATALOGUE_SERVERS).toEqual([]);
  });

  it("does not produce a proof entry without the namespaced variable", () => {
    const previous = process.env["DASH_MCP_PROOF_URL"];
    delete process.env["DASH_MCP_PROOF_URL"];
    try {
      expect(proofCatalogueServer()).toBeNull();
      expect(catalogueServer(LOOPBACK_PROOF_SERVER_ID)).toBeNull();
    } finally {
      if (previous !== undefined) {
        process.env["DASH_MCP_PROOF_URL"] = previous;
      }
    }
  });

  it("refuses to point the proof entry at a real host", () => {
    // Otherwise one environment variable would add an uncurated server to the
    // curated list, which is the failure the whole file is about.
    withProofServer("https://tools.example.com/mcp", () => {
      expect(proofCatalogueServer()).toBeNull();
    });
  });

  it("resolves the proof entry with an admitted transport when the guard allows", () => {
    withProofServer(PROOF_URL, () => {
      const server = catalogueServer(LOOPBACK_PROOF_SERVER_ID);
      expect(server).not.toBeNull();
      expect(server?.transport.origin).toBe("http://127.0.0.1:47811");
      expect(catalogueTool(server, "web.fetch")?.reaches_beyond_server).toBe(true);
      expect(catalogueTool(server, "notes.search")?.reaches_beyond_server).toBe(false);
      expect(catalogueTool(server, "never.built")).toBeNull();
    });
  });

  it("passes its own invariants", () => {
    withProofServer(PROOF_URL, () => {
      const proof = proofCatalogueServer();
      expect(proof).not.toBeNull();
      expect(checkCatalogueEntry(proof as CatalogueServer)).toEqual([]);
      expectPlainLanguage([
        (proof as CatalogueServer).description,
        ...(proof as CatalogueServer).tools.flatMap((tool) => [
          tool.label,
          ...(tool.consequence === null ? [] : [tool.consequence]),
        ]),
      ]);
    });
  });
});

describe("the catalogue invariants exist before the entries do", () => {
  const base: CatalogueServer = {
    id: "example-tools",
    label: "Example tools",
    url: "https://tools.example.com/mcp",
    description: "A server DASH would have written sentences for.",
    tools: [
      {
        name: "notes.search",
        access: "read",
        reaches_beyond_server: false,
        label: "Search the notes on this server",
        consequence: null,
      },
    ],
  };

  it("accepts a well-formed entry", () => {
    expect(checkCatalogueEntry(base)).toEqual([]);
  });

  it("requires a consequence from anything that is not a plain read", () => {
    expect(
      checkCatalogueEntry({
        ...base,
        tools: [{ ...base.tools[0]!, access: "write", consequence: null }],
      }),
    ).toContain("consequence_missing");
    // And from a read that leaves — which is the egress half of the chain the
    // read-then-reach rule is about, so a person approving it is owed the words.
    expect(
      checkCatalogueEntry({
        ...base,
        tools: [{ ...base.tools[0]!, reaches_beyond_server: true, consequence: null }],
      }),
    ).toContain("consequence_missing");
  });

  it("refuses an entry whose transport DASH would not admit", () => {
    expect(checkCatalogueEntry({ ...base, url: "http://tools.example.com/mcp" })).toContain(
      "transport_refused",
    );
  });

  it("refuses names that would break the audit or the protocol", () => {
    expect(checkCatalogueEntry({ ...base, id: "Example Tools" })).toContain("id_unsafe");
    expect(
      checkCatalogueEntry({
        ...base,
        tools: [{ ...base.tools[0]!, name: "search\nnotes" }],
      }),
    ).toContain("tool_name_unsafe");
  });

  it("refuses a name pair that would not fit in an operation id", () => {
    // An id past the broker protocol's own limit would name an operation no
    // agent could ever call, and the grant would look live and refuse forever.
    expect(
      checkCatalogueEntry({
        ...base,
        id: "a".repeat(60),
        tools: [{ ...base.tools[0]!, name: "b".repeat(80) }],
      }),
    ).toContain("operation_id_too_long");
  });

  it("refuses two tools with the same name", () => {
    expect(
      checkCatalogueEntry({ ...base, tools: [base.tools[0]!, base.tools[0]!] }),
    ).toContain("duplicate_tool");
  });
});
