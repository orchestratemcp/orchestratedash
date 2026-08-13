/**
 * What an MCP call leaves behind (MAR-633, ADR 0020).
 *
 * No new table. `broker_audit` already holds one row per brokered call on every
 * path including refusals, and it already holds the columns this needs. A
 * second table would be a second answer to a question the first one answers,
 * free to disagree with it — which is the argument MAR-469 used when it made
 * durable replay detection a query over `broker_audit` rather than a new store.
 *
 * So an MCP call is a broker call whose `operation` names the server and the
 * tool, and the answer to *what did this agent do* still comes from one place.
 *
 * ## What is stored, and what deliberately is not
 *
 * ADR 0002 invariant 5, unchanged: the operation name, the *names* of the input
 * fields the agent supplied, a count, and a duration. **Not the input values.**
 * A durable table of every phrase an agent searched somebody's wiki for would
 * be the same mistake as a table of every phrase it searched their mail for,
 * and `broker_audit` has refused to be that since MAR-458.
 *
 * Not the content either. A tool result is the untrusted document this whole
 * subsystem is careful about; copying it into DASH's audit table would put
 * attacker-chosen text into the one surface a suspicious person reads to find
 * out what happened.
 *
 * `account_hint` is null for every MCP row. A server token identifies nobody —
 * it is audience-bound to the server rather than to a person — so there are no
 * four characters of an address to mask, and the null is the same one MAR-582
 * writes for a keyed grant. A hint invented here would be worse than absent.
 */

/**
 * The longest an operation id may be, tied to the one in
 * `lib/broker/protocol.ts`.
 *
 * That parser refuses an `operation` longer than 128 characters or containing
 * anything outside `[A-Za-z0-9._:-]`, and it refuses it *before* there is
 * anything to look the operation up in. So an id minted past that length would
 * name an operation no agent could ever call, and a grant built on one would
 * look live on the card and refuse forever. `mcpOperationId` returns null
 * instead, and `checkCatalogueEntry` turns that null into a defect at the one
 * point where a human is choosing the names.
 */
export const MAX_OPERATION_ID_LENGTH = 128;

/** The prefix that makes an MCP call recognisable in one glance at the audit. */
export const MCP_OPERATION_PREFIX = "mcp";

const SAFE_SERVER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SAFE_TOOL_NAME = /^[A-Za-z0-9._:-]{1,128}$/u;

/**
 * The operation id for one tool on one server, or null when it would not fit.
 *
 * `mcp.<server>.<tool>`, and the parse is unambiguous despite tool names being
 * allowed to contain dots: a server id may not contain one, so the second
 * segment is always the server and everything after it is always the tool.
 */
export function mcpOperationId(serverId: string, toolName: string): string | null {
  if (!SAFE_SERVER_ID.test(serverId) || !SAFE_TOOL_NAME.test(toolName)) {
    return null;
  }
  const id = `${MCP_OPERATION_PREFIX}.${serverId}.${toolName}`;
  return id.length > MAX_OPERATION_ID_LENGTH ? null : id;
}

/** Read an operation id back. Null for anything that is not one of ours. */
export function parseMcpOperationId(
  operation: string,
): { server_id: string; tool: string } | null {
  const prefix = `${MCP_OPERATION_PREFIX}.`;
  if (!operation.startsWith(prefix)) {
    return null;
  }
  const rest = operation.slice(prefix.length);
  const separator = rest.indexOf(".");
  if (separator <= 0 || separator === rest.length - 1) {
    return null;
  }
  const serverId = rest.slice(0, separator);
  const tool = rest.slice(separator + 1);
  if (!SAFE_SERVER_ID.test(serverId) || !SAFE_TOOL_NAME.test(tool)) {
    return null;
  }
  return { server_id: serverId, tool };
}

/**
 * One row, in `broker_audit`'s exact column shape.
 *
 * Built by a function rather than assembled at the call site so that the two
 * rules that matter — names not values, and no account hint — are properties of
 * the only thing that can make a row, instead of instructions a caller follows.
 */
export interface McpAuditRow {
  agent: string;
  connection_id: string;
  operation: string;
  request_id: string;
  decision: "allowed" | "refused";
  refusal: string | null;
  /** Sorted field names, comma-joined. Never a value. */
  input_keys: string;
  /** How many blocks DASH carried out. Null for a refusal. */
  result_count: number | null;
  /** Always null. See the note at the top. */
  account_hint: null;
  duration_ms: number;
  decided_at: string;
}

export interface McpAuditInput {
  agent: string;
  connection_id: string;
  operation: string;
  request_id: string;
  /** The agent's input object. Only its keys are read. */
  input: Record<string, unknown>;
  decision: "allowed" | "refused";
  refusal: string | null;
  result_count: number | null;
  duration_ms: number;
  decided_at: Date;
}

export function mcpAuditRow(input: McpAuditInput): McpAuditRow {
  return {
    agent: input.agent,
    connection_id: input.connection_id,
    operation: input.operation,
    request_id: input.request_id,
    decision: input.decision,
    refusal: input.decision === "refused" ? input.refusal : null,
    // Sorted so two calls with the same fields in a different order produce the
    // same row, and keys only — the values never leave the call.
    input_keys: Object.keys(input.input).sort().join(","),
    result_count: input.decision === "allowed" ? input.result_count : null,
    account_hint: null,
    duration_ms: input.duration_ms,
    decided_at: input.decided_at.toISOString(),
  };
}
