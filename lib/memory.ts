/**
 * Memory write policy: may this thing be remembered, and who has to say yes?
 *
 * Pure decision layer, no storage. MAR-384 separates memory into distinct kinds
 * and gives them different rules; the point of putting those rules here rather
 * than at a database call site is that the dangerous default — "the model wrote
 * something, persist it" — becomes impossible to reach by accident.
 *
 * The governing acceptance criterion: **permanent memory cannot be silently
 * written by the model.** Every durable write authored by a model needs a human
 * to approve it first, so the pipeline is suggest → user approves → commit.
 *
 * This module decides. It never persists, and it never reads a credential or a
 * provider payload.
 */

/**
 * The memory kinds from MAR-384. `knowledge` is declared but out of v0 — it is
 * present as a named rejection rather than an omission, so a caller proposing
 * one gets a clear answer instead of a type error.
 */
export type MemoryCategory =
  | "working_state"
  | "approved_preference"
  | "run_summary"
  | "safety_policy"
  | "knowledge";

/** Who authored the proposed write. The whole policy turns on this. */
export type MemoryAuthor = "model" | "user" | "runner";

/**
 * `provider_content` means raw material fetched from a connected service — the
 * body of an email, a calendar description. MAR-384: do not store raw Gmail
 * content as memory by default.
 */
export type MemorySensitivity = "ordinary" | "personal" | "provider_content";

export interface MemoryWriteProposal {
  id: string;
  category: MemoryCategory;
  /** Plain-language summary shown to the user when approval is requested. */
  summary: string;
  author: MemoryAuthor;
  /** Identifier of the actor — model name, user id, or runner id. */
  actor_id: string;
  sensitivity: MemorySensitivity;
  /** Where this came from, in words. Required: memory without provenance is rumour. */
  provenance: string;
  /** Agent-wide or scoped to one run. */
  scope: "agent" | "run";
  run_id?: string;
  proposed_at: string;
}

export type MemoryWriteOutcome = "commit" | "needs_user_approval" | "rejected";

export interface MemoryWriteDecision {
  outcome: MemoryWriteOutcome;
  /** Plain-language explanation, safe to render directly to a core user. */
  reason: string;
  /**
   * True when the write would outlive the run that proposed it. Durable writes
   * are the ones the silent-write rule protects.
   */
  durable: boolean;
}

/**
 * Categories that outlive their run. `working_state` is scratch space for a
 * task in flight; everything else persists, and persistence is what makes the
 * approval question matter.
 */
const DURABLE_CATEGORIES: ReadonlySet<MemoryCategory> = new Set<MemoryCategory>([
  "approved_preference",
  "safety_policy",
  "run_summary",
  "knowledge",
]);

export function isDurable(category: MemoryCategory): boolean {
  return DURABLE_CATEGORIES.has(category);
}

/**
 * Decide what happens to a proposed memory write.
 *
 * Rules are applied hard-stop first, so a rejection can never be downgraded to
 * an approval prompt by a later rule:
 *
 * 1. `knowledge` is out of scope for v0 — rejected outright.
 * 2. Raw provider content is never stored by default, whoever proposed it.
 * 3. `safety_policy` is never model-authored. A model that can rewrite the
 *    rules constraining it is not constrained.
 * 4. Any other durable write authored by a model needs user approval.
 * 5. Non-durable working state commits directly — it dies with the run.
 */
export function evaluateMemoryWrite(
  proposal: MemoryWriteProposal,
): MemoryWriteDecision {
  const durable = isDurable(proposal.category);

  if (proposal.category === "knowledge") {
    return {
      outcome: "rejected",
      reason: "Knowledge memory is not available in this version.",
      durable,
    };
  }

  if (proposal.sensitivity === "provider_content") {
    return {
      outcome: "rejected",
      reason:
        "This would save raw content from a connected account. DASH does not store that as memory.",
      durable,
    };
  }

  if (proposal.category === "safety_policy" && proposal.author === "model") {
    return {
      outcome: "rejected",
      reason: "Safety rules cannot be changed by the agent itself.",
      durable,
    };
  }

  if (proposal.category === "safety_policy") {
    return {
      outcome: "needs_user_approval",
      reason: "Changing a safety rule always needs your approval.",
      durable,
    };
  }

  if (durable && proposal.author === "model") {
    return {
      outcome: "needs_user_approval",
      reason: "The agent suggested remembering this. It is saved only if you approve.",
      durable,
    };
  }

  if (durable && proposal.author === "runner" && proposal.category !== "run_summary") {
    // A runner may record what happened without asking. It may not decide what
    // the user prefers — that is the user's to state.
    return {
      outcome: "needs_user_approval",
      reason: "This changes a saved preference, so it needs your approval.",
      durable,
    };
  }

  return {
    outcome: "commit",
    reason: durable
      ? "Saved: this is a record of what happened, not a new preference."
      : "Kept while this task is running.",
    durable,
  };
}

/**
 * A committed memory entry. Every field MAR-384 requires is mandatory except
 * the run scope, so an entry cannot exist without provenance or an actor —
 * unattributable memory is exactly what the user cannot audit.
 */
export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  summary: string;
  scope: "agent" | "run";
  run_id?: string;
  author: MemoryAuthor;
  actor_id: string;
  sensitivity: MemorySensitivity;
  provenance: string;
  retention: "descriptor_only" | "user_approved";
  created_at: string;
  /** Set when a user approved the write; absent for direct commits. */
  approved_by?: string;
  approved_at?: string;
  editable: boolean;
  deletable: boolean;
}

/**
 * Turn a proposal into an entry, given the decision and — when the decision
 * demanded it — the approval.
 *
 * Returns null rather than throwing when the write may not proceed. A caller
 * that forgets to pass the approval gets no entry, not an unapproved one: the
 * failure mode of this function has to be "nothing was saved".
 */
export function commitMemoryWrite(
  proposal: MemoryWriteProposal,
  decision: MemoryWriteDecision,
  approval?: { actor_id: string; approved_at: string },
): MemoryEntry | null {
  if (decision.outcome === "rejected") {
    return null;
  }
  if (decision.outcome === "needs_user_approval" && approval === undefined) {
    return null;
  }

  return {
    id: proposal.id,
    category: proposal.category,
    summary: proposal.summary,
    scope: proposal.scope,
    ...(proposal.run_id === undefined ? {} : { run_id: proposal.run_id }),
    author: proposal.author,
    actor_id: proposal.actor_id,
    sensitivity: proposal.sensitivity,
    provenance: proposal.provenance,
    // Only a human-approved write earns `user_approved`; anything else stays a
    // descriptor the user can drop without losing a stated preference.
    retention: approval === undefined ? "descriptor_only" : "user_approved",
    created_at: proposal.proposed_at,
    ...(approval === undefined
      ? {}
      : { approved_by: approval.actor_id, approved_at: approval.approved_at }),
    // The user can always remove what an agent remembers about them.
    editable: proposal.category !== "run_summary",
    deletable: true,
  };
}
