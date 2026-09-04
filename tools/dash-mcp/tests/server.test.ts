/**
 * The protocol half (MAR-862, ADR 0032 decision 8).
 *
 * Written out rather than pulled from an SDK, which means the framing is this
 * package's responsibility and therefore this package's to prove. The two cases
 * that actually break clients are here: a notification must get no reply, and a
 * tool refusal must come back as a *result* with `isError`, never as a
 * JSON-RPC error — a transport error is a claim that the tool did not run, and
 * a client shown one will retry a call that already answered.
 */

import { describe, expect, it } from "vitest";

import { createReader, handle, type JsonRpcResponse } from "../src/server";

function ask(method: string, params?: Record<string, unknown>): JsonRpcResponse | null {
  return handle({ jsonrpc: "2.0", id: 1, method, params });
}

describe("initialize", () => {
  it("answers with capabilities and a server name", () => {
    const response = ask("initialize", { protocolVersion: "2025-06-18" });
    const result = response?.result as { capabilities: unknown; serverInfo: { name: string } };
    expect(result.capabilities).toEqual({ tools: {} });
    expect(result.serverInfo.name).toBe("dash");
  });

  it("agrees with the client's protocol revision rather than insisting on its own", () => {
    const response = ask("initialize", { protocolVersion: "2024-11-05" });
    expect((response?.result as { protocolVersion: string }).protocolVersion).toBe("2024-11-05");
  });

  it("names a revision when the client names none", () => {
    const response = ask("initialize", {});
    expect((response?.result as { protocolVersion: string }).protocolVersion).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });
});

describe("tools/list", () => {
  it("offers exactly the three tools, each with a schema", () => {
    const result = ask("tools/list")?.result as {
      tools: { name: string; description: string; inputSchema: { type: string } }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "dash_agent_scaffold",
      "dash_agent_validate",
      "dash_agent_install",
    ]);
    for (const tool of result.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });
});

describe("notifications", () => {
  it("gets no reply, because replying to one hangs some clients", () => {
    expect(handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(handle({ jsonrpc: "2.0", method: "notifications/cancelled" })).toBeNull();
  });

  it("still refuses an unknown method that carries an id", () => {
    const response = ask("does/not/exist");
    expect(response?.error?.code).toBe(-32601);
  });
});

describe("tools/call", () => {
  it("returns a refusal as a result with isError, not as a transport error", () => {
    const response = ask("tools/call", {
      name: "dash_agent_validate",
      arguments: { manifest: { manifest_version: 2, agent: { name: "x" } } },
    });

    expect(response?.error).toBeUndefined();
    const result = response?.result as { isError: boolean; structuredContent: { ok: boolean } };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.ok).toBe(false);
  });

  it("carries the same body as text and as structured content", () => {
    const response = ask("tools/call", {
      name: "dash_agent_validate",
      arguments: { manifest: { manifest_version: 2, agent: { name: "x" } } },
    });
    const result = response?.result as {
      content: { type: string; text: string }[];
      structuredContent: unknown;
    };
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
  });

  it("refuses an unknown tool", () => {
    expect(ask("tools/call", { name: "dash_agent_teleport" })?.error?.code).toBe(-32602);
  });

  it("turns a bad argument into a refusal rather than a crash", () => {
    const response = ask("tools/call", {
      name: "dash_agent_scaffold",
      arguments: { directory: "/tmp/x", summary: "no name given" },
    });
    const result = response?.result as { isError: boolean; structuredContent: { refusal: string } };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.refusal).toContain('"name" is required');
  });

  it("refuses a source whose format is not one DASH's template can parse", () => {
    const response = ask("tools/call", {
      name: "dash_agent_scaffold",
      arguments: {
        directory: "/tmp/x",
        name: "example",
        summary: "a summary",
        sources: [{ name: "A feed", url: "https://example.test", format: "csv" }],
      },
    });
    const result = response?.result as { structuredContent: { refusal: string } };
    expect(result.structuredContent.refusal).toContain("rss, atom, hn_algolia");
  });
});

describe("the reader", () => {
  it("answers one message per line, across chunk boundaries", () => {
    const written: JsonRpcResponse[] = [];
    const read = createReader((response) => written.push(response));

    read('{"jsonrpc":"2.0","id":1,"method":"pin');
    expect(written).toHaveLength(0);
    read('g"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n');

    expect(written.map((response) => response.id)).toEqual([1, 2]);
  });

  it("reports a line that is not JSON without dropping the connection", () => {
    const written: JsonRpcResponse[] = [];
    const read = createReader((response) => written.push(response));

    read("not json\n");
    read('{"jsonrpc":"2.0","id":9,"method":"ping"}\n');

    expect(written[0].error?.code).toBe(-32700);
    expect(written[1].id).toBe(9);
  });

  it("ignores blank lines", () => {
    const written: JsonRpcResponse[] = [];
    const read = createReader((response) => written.push(response));
    read("\n\n");
    expect(written).toHaveLength(0);
  });
});
