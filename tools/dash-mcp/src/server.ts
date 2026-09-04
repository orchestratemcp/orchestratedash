/**
 * The stdio half: newline-delimited JSON-RPC 2.0, and nothing else
 * (MAR-862, ADR 0032 decision 8).
 *
 * Four methods and no SDK. That is not asceticism — adding
 * `@modelcontextprotocol/sdk` to DASH's dependency tree puts a package in the
 * installed Electron application's lock file for the benefit of a developer
 * tool the application never loads, and this repository is already fluent in
 * exactly this protocol shape: the runner speaks newline-delimited JSON to
 * every agent it spawns, and `template/agent.mjs` answers it in about forty
 * lines.
 *
 * This module holds no policy. Every decision is in `agent-tools.ts`, over
 * ordinary values, so the suite covers it. What is here is framing, dispatch
 * and the one rule that matters on a stdio server:
 *
 * **stdout belongs to the protocol.** A stray `console.log` anywhere in the
 * import graph writes a line the client will try to parse as a message, and the
 * failure looks like a broken server rather than like a log. Everything this
 * process wants to say goes to stderr.
 */

import { installAgent, scaffoldAgent, validateAgent, type ToolResult } from "./agent-tools";
import type { FeedSource } from "./scaffold";

const SERVER_NAME = "dash";
const SERVER_VERSION = "0.1.0";

/** The newest protocol revision this server was written against. */
const PROTOCOL_VERSION = "2025-06-18";

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => ToolResult;
}

/* ---------------------------------------------------------------------- *
 * The tools
 * ---------------------------------------------------------------------- */

/**
 * Descriptions written for the caller that will actually read them, which is a
 * model choosing between three tools with one sentence of context each. So each
 * one says what it *does* and what it *refuses*, because the refusal is the
 * feature: a tool that might advise gets called speculatively, and a tool that
 * writes a folder does not.
 */
const TOOLS: ToolDefinition[] = [
  {
    name: "dash_agent_scaffold",
    title: "Build a DASH agent folder",
    description:
      "Write a complete, importable DASH agent into a directory: manifest, program, sources and " +
      "README. The manifest is checked against DASH's own validator BEFORE anything is written, so " +
      "either the folder is importable or nothing exists. The agent starts idle, runs only when " +
      "asked, and emits both a digest and a brief bound to it — so its output can be judged, not " +
      "just read. Refuses to write inside DASH's own agents folder.",
    inputSchema: {
      type: "object",
      required: ["directory", "name", "summary"],
      properties: {
        directory: {
          type: "string",
          description:
            "Full path of the project directory to create. Must be outside DASH's data directory.",
        },
        name: {
          type: "string",
          description:
            "The agent's id. Lowercase letters, digits, dots, dashes and underscores; anything " +
            "else is converted and the conversion is reported back.",
        },
        display_name: { type: "string", description: "What to call it in DASH. Defaults to name." },
        summary: {
          type: "string",
          description: "One sentence a non-technical person can read, describing what it does.",
        },
        sources: {
          type: "array",
          description: "What it should read. Omit for a working default.",
          items: {
            type: "object",
            required: ["name", "url", "format"],
            properties: {
              name: { type: "string", description: "What a person reads. Never a URL." },
              url: { type: "string" },
              format: { enum: ["rss", "atom", "hn_algolia"] },
            },
          },
        },
      },
    },
    run: (args) =>
      scaffoldAgent({
        directory: requireString(args, "directory"),
        name: requireString(args, "name"),
        display_name: optionalString(args, "display_name"),
        summary: requireString(args, "summary"),
        sources: readSources(args["sources"]),
      }),
  },
  {
    name: "dash_agent_validate",
    title: "Check an agent against DASH's importer",
    description:
      "Run DASH's real import validator over a manifest — the same functions DASH runs when a " +
      "person imports — and return every problem with the fix for it: the JSON pointer, what the " +
      "schema requires there, and the allowed values. Use it on a manifest you are about to write, " +
      "before writing it. A pass here means the import will not fail on validation.",
    inputSchema: {
      type: "object",
      properties: {
        directory: {
          type: "string",
          description: "A project directory holding agent.manifest.json, or the manifest file itself.",
        },
        manifest: {
          type: "object",
          description:
            "A manifest document to check without writing it anywhere. The shortest loop: " +
            "compose, check, correct, then write.",
        },
      },
    },
    run: (args) =>
      validateAgent({
        directory: optionalString(args, "directory"),
        manifest: args["manifest"],
      }),
  },
  {
    name: "dash_agent_install",
    title: "Hand DASH the import",
    description:
      "Validate a staged agent folder and hand it to DASH: writes a single-use handoff and opens " +
      "DASH, which ASKS the person before storing anything. DASH takes its own copy; the folder " +
      "stays where it is and stays editable. Refuses, and writes nothing, if the agent would fail " +
      "validation. This tool cannot install an agent by itself and cannot answer for the person.",
    inputSchema: {
      type: "object",
      required: ["directory"],
      properties: {
        directory: { type: "string", description: "Full path of the staged agent folder." },
        open: {
          type: "boolean",
          description:
            "Set false to write the handoff and return the URL without opening DASH — for a " +
            "machine where DASH is not installed.",
        },
      },
    },
    run: (args) =>
      installAgent({
        directory: requireString(args, "directory"),
        open: typeof args["open"] === "boolean" ? args["open"] : undefined,
      }),
  },
];

/* ---------------------------------------------------------------------- *
 * Reading arguments
 * ---------------------------------------------------------------------- */

class BadArgument extends Error {}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadArgument(`"${key}" is required and must be text.`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new BadArgument(`"${key}" must be text.`);
  }
  return value;
}

/**
 * Sources, checked rather than cast.
 *
 * A malformed entry is refused by name. Filtering it out silently would scaffold
 * an agent watching fewer things than the caller asked for, which is a wrong
 * answer that looks like a right one.
 */
function readSources(value: unknown): FeedSource[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadArgument('"sources" must be a list.');
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new BadArgument(`"sources[${String(index)}]" is not an object.`);
    }
    const source = entry as Record<string, unknown>;
    const format = source["format"];
    if (format !== "rss" && format !== "atom" && format !== "hn_algolia") {
      throw new BadArgument(
        `"sources[${String(index)}].format" must be one of rss, atom, hn_algolia.`,
      );
    }
    return {
      name: requireString(source, "name"),
      url: requireString(source, "url"),
      format,
    };
  });
}

/* ---------------------------------------------------------------------- *
 * Dispatch
 * ---------------------------------------------------------------------- */

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Answer one request, or return null for a notification.
 *
 * A notification — a message with no `id` — gets no reply, ever. Replying to one
 * is a protocol violation that some clients tolerate and others hang on, and
 * `notifications/initialized` is sent by every client on every connection.
 */
export function handle(request: Request): JsonRpcResponse | null {
  const id = request.id ?? null;
  const isNotification = request.id === undefined || request.id === null;

  switch (request.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          // Echoed when the client named one. This server has no
          // version-specific behaviour, so agreeing with the client is strictly
          // more compatible than insisting on a revision it may not know.
          protocolVersion: readProtocolVersion(request.params) ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };

    case "ping":
      return { jsonrpc: "2.0", id, result: {} };

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      };

    case "tools/call":
      return callTool(id, request.params ?? {});

    default:
      if (isNotification) {
        return null;
      }
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unknown method "${request.method}".` },
      };
  }
}

function readProtocolVersion(params: Record<string, unknown> | undefined): string | null {
  const value = params?.["protocolVersion"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Run one tool.
 *
 * A refusal comes back as `isError: true` with the same JSON body a success
 * would have. Returning it as a JSON-RPC *error* instead would be wrong: the
 * call succeeded and the answer is no, and a transport-level error is a claim
 * that the tool did not run.
 */
function callTool(id: string | number | null, params: Record<string, unknown>): JsonRpcResponse {
  const name = params["name"];
  const tool = TOOLS.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: `Unknown tool "${String(name)}".` },
    };
  }

  const args =
    typeof params["arguments"] === "object" && params["arguments"] !== null
      ? (params["arguments"] as Record<string, unknown>)
      : {};

  let result: ToolResult;
  try {
    result = tool.run(args);
  } catch (error) {
    result = {
      ok: false,
      refusal:
        error instanceof BadArgument
          ? error.message
          : `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: !result.ok,
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Running
 * ---------------------------------------------------------------------- */

/** Feed the loop one chunk at a time. Exported so a test can drive it. */
export function createReader(write: (response: JsonRpcResponse) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string): void => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (line.length === 0) {
        continue;
      }

      let request: Request;
      try {
        request = JSON.parse(line) as Request;
      } catch {
        write({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "That line is not JSON." },
        });
        continue;
      }

      const response = handle(request);
      if (response !== null) {
        write(response);
      }
    }
  };
}

export function main(): void {
  const read = createReader((response) => {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", read);
  process.stdin.on("end", () => {
    process.exit(0);
  });
}
