/**
 * The sentences an MCP connection's card needs, and the two it cannot borrow
 * (MAR-633, ADR 0020).
 *
 * `lib/broker/providers.ts` already has a custody grammar, and connecting a
 * real MCP server shows that its `token_custodian` field is singular while the
 * fact is a pair:
 *
 * - **DASH's custody of the server token.** MCP's authorization model requires
 *   the client to send `resource` naming the canonical URI of the MCP server
 *   (RFC 8707) and requires the server to validate that the token it received
 *   was issued for it. So the token DASH holds is audience-bound to that
 *   server. It is not a credential for whatever the server fronts, it cannot be
 *   replayed against it, and DASH holding it in the OS vault is the correct
 *   thing rather than a compromise.
 * - **The server's custody of whatever is behind it.** Disconnecting in DASH
 *   does not withdraw that. `describeCustody("remote_mcp_server")` has said so
 *   since MAR-483 and is correct as written; it is the second half.
 *
 * Both are true at once. A card stating only the first reassures about the
 * wrong custodian; a card stating only the second understates what DASH is
 * responsible for. So this module returns them as two named fields rather than
 * choosing one value for one field, and a surface that renders only one of them
 * is visibly rendering half a fact.
 *
 * ## Why the server's own words get quotation marks
 *
 * The injection discussion always fixes on the agent's reasoning and forgets
 * that the first thing a hostile server writes into is the sentence a human
 * reads before pressing Connect. A tool's `description` is chosen by the party
 * whose behaviour it purports to describe. So it is rendered quoted and
 * attributed — *this server says* — never as DASH's own description, and
 * `attributeServerText` is the only way to get one onto a surface.
 *
 * Every sentence here is plain language with no identifiers, because these are
 * guided-path copy in MAR-423's sense and `tests/mcp-card.test.ts` runs the
 * shared assertion over them.
 */

import type { AdmissionChange, ExclusionReason } from "./admission";

/** The pair. Both halves, always, because either alone misleads. */
export interface McpCustodySentences {
  /** What DASH holds and what disconnecting here actually ends. */
  dash_side: string;
  /** What the server holds and what disconnecting here does not touch. */
  server_side: string;
  /**
   * Whether the sign-in DASH holds is one only this server can use, or null
   * when the server did not implement the check that makes that true.
   *
   * Required-but-nullable in `wider_permission`'s shape, so a future connection
   * kind cannot ship without somebody answering it. Null is not a silent
   * absence: `describeUnboundToken` is the sentence the disclosure owes a
   * person when a server asks DASH to hold a sign-in whose audience nobody
   * validated.
   */
  audience_binding: string | null;
}

export interface McpCustodyFacts {
  /** The server's name as a person reads it. */
  server_label: string;
  /** What sits behind the server, in the person's words: "your notes". Nullable. */
  behind_label: string | null;
  /** Whether the server honoured the resource parameter. */
  audience_bound: boolean;
}

export function describeMcpCustody(facts: McpCustodyFacts): McpCustodySentences {
  const behind = facts.behind_label ?? "whatever it connects to";
  return {
    dash_side:
      `DASH holds the sign-in for ${facts.server_label} in this computer's vault. The agent ` +
      "never receives it — it asks DASH, and DASH makes the request. Removing it here stops " +
      "DASH using it.",
    server_side:
      `${facts.server_label} holds its own sign-in for ${behind}, and DASH has never seen it. ` +
      `Disconnecting here stops DASH using ${facts.server_label} and does not withdraw what ` +
      `${facts.server_label} can already reach.`,
    audience_binding: facts.audience_bound
      ? `The sign-in DASH holds only works at ${facts.server_label}. It cannot be used ` +
        `anywhere else, including at ${behind}.`
      : null,
  };
}

/**
 * The sentence a person is owed when a server did not bind the token to itself.
 *
 * Separate from `describeMcpCustody` so it cannot be rendered by accident in
 * the reassuring position where `audience_binding` sits.
 */
export function describeUnboundToken(serverLabel: string): string {
  return (
    `${serverLabel} did not tell DASH that the sign-in is only for itself, so DASH cannot ` +
    "promise that it is. Only connect this if you trust whoever runs it."
  );
}

/**
 * Put a server's own words on a surface, marked as its own words.
 *
 * The only way third-party text reaches a card. Returns null for null so a
 * caller cannot end up rendering the frame around nothing, and the quotation
 * marks are part of the returned string rather than markup a surface might
 * forget.
 */
export function attributeServerText(serverLabel: string, text: string | null): string | null {
  if (text === null || text.length === 0) {
    return null;
  }
  return `${serverLabel} describes this as: “${text}”`;
}

/** The disclosure that opens the advanced path, before any server is named. */
export function describeUncuratedServer(): string {
  return (
    "DASH has not seen this server. Everything you are about to read about it was written " +
    "by the server itself, including what its tools say they do. DASH cannot check any of it."
  );
}

/**
 * What a person reads beside a tool DASH could not classify.
 *
 * It has to explain that the tool still works and still needs them, without
 * implying the tool is suspected of anything — the honest content is that DASH
 * has no opinion, and having no opinion is why it asks.
 */
export function describeUnclassifiedTool(): string {
  return (
    "DASH has not checked what this one does, so it will ask you every time before it runs, " +
    "and show you exactly what it was asked to do."
  );
}

/** Why a declared tool is not in the grant. One sentence, one next move. */
export function describeExclusion(reason: ExclusionReason): string {
  switch (reason) {
    case "unclassified":
      return "DASH has not checked what this one does, so it is not switched on for this agent.";
    case "not_requested":
      return "This agent did not ask for this one, so DASH has not switched it on.";
    case "class_not_ticked":
      return "You left this kind of action switched off.";
  }
}

/**
 * What a person reads when a server's tool list changed under a live grant.
 *
 * The three cases lead somewhere genuinely different and the copy has to keep
 * them apart. A new tool is an offer; a changed one is the case that matters
 * most and the easiest to miss; a withdrawn one is the server's own decision
 * and needs no action.
 */
export function describeAdmissionChange(change: AdmissionChange, serverLabel: string): string {
  switch (change.kind) {
    case "new_tool":
      return (
        `${serverLabel} is offering something new that was not there when you connected it. ` +
        "No agent can use it until you look at it."
      );
    case "schema_changed":
      return (
        `Something you switched on at ${serverLabel} now asks for different information than ` +
        "it did when you approved it. DASH has stopped using it until you look."
      );
    case "withdrawn":
      return `${serverLabel} has stopped offering something you had switched on.`;
  }
}
