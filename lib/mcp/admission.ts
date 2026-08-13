/**
 * What a person actually consented to, fixed at the moment they pressed
 * Connect (MAR-633, ADR 0020).
 *
 * `lib/broker/operations.ts` holds a frozen array whose docblock invites a
 * reader to treat it as the complete answer to *what can this application do to
 * my account?*. That property comes from every operation being a literal a
 * human typed. An MCP tool is none of those things — its name, its input
 * schema, its description and its result shape all arrive from a third party at
 * connect time and may change afterwards by a notification the server sends
 * whenever it likes.
 *
 * So the frozen thing moves. For an MCP connection the reviewed, pinned set is
 * **the admitted tool set of one server**, and it is stored rather than
 * compiled because a person rather than a programmer wrote it.
 *
 * ## The three parties, with the third one replaced
 *
 * ADR 0002 amendment 1's rule is that a grant is the intersection of three
 * parties, and each catches something the other two miss. Here they are:
 *
 * 1. **DASH** — the server is catalogued and the tool is classified. Without
 *    this the tool is unclassified, and an unclassified tool is not a read.
 * 2. **The agent's author** — the manifest names this tool. Without this an
 *    agent could reach a tool the person granted for a different agent, and an
 *    author could widen their own access by asking for everything.
 * 3. **The user** — pressed Connect with these tools visible and left these
 *    access classes ticked.
 *
 * ## Why `list_changed` is a consent event
 *
 * The specification lets a server announce that its tool list changed, and the
 * obvious client behaviour is to re-fetch and carry on. That would make the
 * consent screen a description of a moment rather than of an agreement. The
 * direction here is deliberately asymmetric: **a server may narrow its own
 * offering without asking, and may never widen what it is allowed to do without
 * a person.**
 *
 * `schema_changed` is the case that would be easiest to miss and matters most.
 * `search(query)` becoming `search(query, exfiltrate_to)` is the same name, the
 * same access class, and a completely different tool.
 */

import { catalogueTool, type CatalogueServer, type McpAccess } from "./catalogue";
import type { ToolDeclaration } from "./tools";

/** One tool a person granted, as the grant records it. */
export interface AdmittedTool {
  name: string;
  /** The digest the tool had on the consent screen. Re-checked at call time. */
  input_schema_digest: string;
  access: McpAccess;
  reaches_beyond_server: boolean;
}

/** One server's grant. The pinned set this module exists to produce. */
export interface Admission {
  server_id: string;
  /** ISO 8601. The moment the set was fixed. */
  admitted_at: string;
  tools: readonly AdmittedTool[];
}

/**
 * DASH's own answer about a tool, or the honest absence of one.
 *
 * A tagged union rather than a nullable access, so a caller cannot treat "not
 * classified" as a default and get a read. The whole point is that there is no
 * safe default: a tool DASH has never seen might delete something.
 */
export type ToolClassification =
  | {
      classified: true;
      access: McpAccess;
      reaches_beyond_server: boolean;
      /** DASH's own sentence. Never the server's. */
      label: string;
      consequence: string | null;
    }
  | { classified: false };

/**
 * Classify one declared tool.
 *
 * **This function does not read `declaration.claimed`.** It reads the
 * declaration's name and looks it up in a list a human wrote, and that is the
 * whole of it. The specification says clients should never make critical
 * tool-use decisions based on annotations from untrusted servers, and this is
 * where DASH either obeys that or does not.
 *
 * `tests/mcp-admission.test.ts` asserts the negative directly: a tool absent
 * from the catalogue that claims `readOnlyHint: true` is still unclassified,
 * and a catalogued write that claims `readOnlyHint: true` is still a write.
 */
export function classifyTool(
  server: CatalogueServer | null,
  declaration: ToolDeclaration,
): ToolClassification {
  const known = catalogueTool(server, declaration.name);
  if (known === null) {
    return { classified: false };
  }
  return {
    classified: true,
    access: known.access,
    reaches_beyond_server: known.reaches_beyond_server,
    label: known.label,
    consequence: known.consequence,
  };
}

export interface AdmitToolsInput {
  server_id: string;
  /** Null when the person added this server themselves. Then nothing classifies. */
  server: CatalogueServer | null;
  /** What the server offered, already parsed. */
  declarations: readonly ToolDeclaration[];
  /** Party 2: the tool names this agent's manifest asked for. */
  requested_by_manifest: readonly string[];
  /** Party 3: the access classes the person left ticked. */
  ticked_classes: readonly McpAccess[];
  admitted_at: Date;
}

/**
 * Why a declared tool did not make it into the grant.
 *
 * Enumerated rather than collapsed into "not granted", because the four lead
 * somewhere completely different for the person reading the card: one is a
 * checkbox, one is the agent's own file, one is a tool DASH cannot describe,
 * and one is a tool that will always need a person.
 */
export type ExclusionReason =
  /** DASH has no classification for it. Attended-only; never silently granted. */
  | "unclassified"
  /** This agent's manifest did not ask for it. */
  | "not_requested"
  /** The person did not tick the class it belongs to. */
  | "class_not_ticked";

export interface AdmissionResult {
  admission: Admission;
  excluded: readonly { name: string; reason: ExclusionReason }[];
}

/**
 * Compute the grant: the intersection of the three parties.
 *
 * A tool that fails more than one party is reported under the first it failed,
 * in the order DASH → author → user, because that order is the order a person
 * can do something about. "DASH has not classified this" is not fixed by
 * ticking a box.
 */
export function admitTools(input: AdmitToolsInput): AdmissionResult {
  const requested = new Set(input.requested_by_manifest);
  const ticked = new Set(input.ticked_classes);
  const tools: AdmittedTool[] = [];
  const excluded: { name: string; reason: ExclusionReason }[] = [];

  for (const declaration of input.declarations) {
    const classification = classifyTool(input.server, declaration);
    if (!classification.classified) {
      excluded.push({ name: declaration.name, reason: "unclassified" });
      continue;
    }
    if (!requested.has(declaration.name)) {
      excluded.push({ name: declaration.name, reason: "not_requested" });
      continue;
    }
    if (!ticked.has(classification.access)) {
      excluded.push({ name: declaration.name, reason: "class_not_ticked" });
      continue;
    }
    tools.push({
      name: declaration.name,
      input_schema_digest: declaration.input_schema_digest,
      access: classification.access,
      reaches_beyond_server: classification.reaches_beyond_server,
    });
  }

  return {
    admission: {
      server_id: input.server_id,
      admitted_at: input.admitted_at.toISOString(),
      tools,
    },
    excluded,
  };
}

export type AdmissionChangeKind =
  /** Offered now, absent from the consent screen. Ungranted until a person looks. */
  | "new_tool"
  /** Same name, different input schema. The rename-preserving widening. */
  | "schema_changed"
  /** Granted, and the server no longer offers it. Calls refuse `not_granted`. */
  | "withdrawn";

export interface AdmissionChange {
  kind: AdmissionChangeKind;
  tool: string;
}

/**
 * What changed between what a person approved and what the server offers now.
 *
 * Called when a server announces `notifications/tools/list_changed`, and also
 * worth calling on reconnect, because a server that changed while DASH was
 * closed sent the notification to nobody.
 *
 * Note what this does **not** do: it does not update the admission. Nothing in
 * this module writes a grant except `admitTools`, which takes a person's ticked
 * classes as an argument — so there is no code path by which a server's
 * announcement becomes a wider grant.
 */
export function diffAdmission(
  admission: Admission,
  declarations: readonly ToolDeclaration[],
): AdmissionChange[] {
  const offered = new Map(declarations.map((entry) => [entry.name, entry]));
  const changes: AdmissionChange[] = [];

  for (const tool of admission.tools) {
    const declaration = offered.get(tool.name);
    if (declaration === undefined) {
      changes.push({ kind: "withdrawn", tool: tool.name });
      continue;
    }
    if (declaration.input_schema_digest !== tool.input_schema_digest) {
      changes.push({ kind: "schema_changed", tool: tool.name });
    }
  }

  const granted = new Set(admission.tools.map((tool) => tool.name));
  for (const declaration of declarations) {
    if (!granted.has(declaration.name)) {
      changes.push({ kind: "new_tool", tool: declaration.name });
    }
  }

  return changes;
}

/** Why a call was not covered by the grant. Maps onto existing `BrokerRefusal`s. */
export type CoverageRefusal =
  /** No admitted tool of that name. Includes withdrawn and never-granted. */
  | "not_granted"
  /**
   * Admitted, and the input schema is not the one the person saw.
   *
   * Its own value rather than `not_granted` because the two lead somewhere
   * different: this one is a tool that changed under a live grant, and the
   * person's next move is to look at what it changed into.
   */
  | "schema_changed";

export type Coverage =
  | { ok: true; tool: AdmittedTool }
  | { ok: false; refusal: CoverageRefusal };

/**
 * Does this grant cover this call?
 *
 * The digest is re-checked at call time rather than trusted from connect time,
 * because the whole risk is that the thing changed in between.
 */
export function coversCall(
  admission: Admission,
  toolName: string,
  offeredDigest: string,
): Coverage {
  const tool = admission.tools.find((entry) => entry.name === toolName);
  if (tool === undefined) {
    return { ok: false, refusal: "not_granted" };
  }
  if (tool.input_schema_digest !== offeredDigest) {
    return { ok: false, refusal: "schema_changed" };
  }
  return { ok: true, tool };
}
