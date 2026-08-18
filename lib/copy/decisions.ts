/**
 * Every sentence the decisions log speaks (MAR-673, ADR 0024).
 *
 * These are the `summary` sentences the write-sites freeze into
 * `fleet_decisions` and the phrases the surface renders around them. One
 * module for both, so the frozen phrasing and the surface's phrasing start
 * identical — after that the frozen copy deliberately stays as written,
 * because re-rendering an old row with today's copy would quietly rewrite
 * what was said.
 *
 * ## Identifiers are labelled values, never prose
 *
 * A connection id, a component id, a model id or a provider appears after a
 * colon — `Declared connection dropped: {id}` — the same shape
 * `renderBriefing`'s "Declared steps:" line uses. `lib/copy/identifiers.ts`'
 * rule: DASH's sentence names the kind of thing, and the value stands beside
 * it as a value. An author's label for a connection is author text and never
 * enters these sentences at all; it travels in `outcome`, attributed, for a
 * surface that wants to show it beside DASH's words.
 *
 * ## The absent reason has one sentence
 *
 * `NO_REASON_RECORDED` is the whole answer to "why" when nobody wrote one
 * down, and it is the chief's answer too (ADR 0024 decision 5): a why the
 * store does not hold is a why the chief does not say.
 */

/** What a row says when `reason` is null. The true sentence, said plainly. */
export const NO_REASON_RECORDED = "No reason was recorded.";

/** Rendered before a reason that arrived after the decision (`reason_added_at`). */
export const REASON_ADDED_LATER = "Added later";

/** The marker for a chain head whose standing state moved without a decision. */
export const DECISION_DRIFTED =
  "The fleet no longer matches this decision, and no decision says why.";

/** Rendered on a superseded row, before its successor's date. */
export const DECISION_SUPERSEDED = "Later changed";

/* ---------------------------------------------------------------------- *
 * The summaries, one per kind and arm
 * ---------------------------------------------------------------------- */

export function describeAgentAdded(): string {
  return "Added to the fleet.";
}

export function describeAgentRemoved(): string {
  return "Removed from the fleet.";
}

export function describeDeclaredConnection(
  connectionId: string,
  state: "declared" | "dropped",
): string {
  return state === "declared"
    ? `Declared connection added: ${connectionId}.`
    : `Declared connection dropped: ${connectionId}.`;
}

export function describeDeclaredRoute(componentId: string, state: "declared" | "dropped"): string {
  return state === "declared"
    ? `Planned route gained a step: ${componentId}.`
    : `Planned route lost a step: ${componentId}.`;
}

export function describeModelPinned(modelId: string): string {
  return `Model pinned: ${modelId}.`;
}

export function describeModelUnpinned(): string {
  return "Model pin cleared; each step matches its declared level.";
}

/**
 * `question_key`, not `question_label` — this module's own rule (see the
 * header) that an author's own prose does not enter a frozen sentence. The
 * verbatim question and the chosen option travel in `outcome`, for a surface
 * that wants to quote them.
 */
export function describeStandingAnswerSet(questionKey: string): string {
  return `Standing answer set: ${questionKey}.`;
}

export function describeStandingAnswerCleared(questionKey: string): string {
  return `Standing answer cleared: ${questionKey}.`;
}

export function describeFleetDefaultSet(modelId: string): string {
  return `Fleet default model set: ${modelId}.`;
}

export function describeFleetDefaultCleared(): string {
  return "Fleet default model cleared.";
}

/** MAR-654. What one level means, in the log's frozen phrasing. */
export function describeLevelModelSet(levelLabel: string, modelId: string): string {
  return `Level model set — ${levelLabel}: ${modelId}.`;
}

export function describeLevelModelCleared(levelLabel: string): string {
  return `Level model cleared — ${levelLabel}; steps of that kind fall back to the default.`;
}

export function describeConnectionGranted(connectionId: string): string {
  return `Connection granted: ${connectionId}.`;
}

export function describeConnectionRevoked(connectionId: string): string {
  return `Connection disconnected: ${connectionId}.`;
}

export function describeFleetConnected(provider: string): string {
  return `Fleet connection made: ${provider}.`;
}

export function describeFleetDisconnected(provider: string): string {
  return `Fleet connection removed: ${provider}.`;
}

export function describeFleetGrant(provider: string, standing: "granted" | "withheld"): string {
  return standing === "granted"
    ? `Given access to the fleet connection: ${provider}.`
    : `Withheld from the fleet connection: ${provider}.`;
}

export function describeFleetGrantCleared(provider: string): string {
  return `Access decision cleared for the fleet connection: ${provider}.`;
}

export function describeIrreversibleApproval(command: string): string {
  return `An irreversible command was approved: ${command}.`;
}
