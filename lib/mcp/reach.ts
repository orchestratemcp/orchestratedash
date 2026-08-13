/**
 * The read-then-reach rule (MAR-633, ADR 0020).
 *
 * The dangerous chain has three links: the agent reads content it does not
 * control, the agent holds access to something private, and the agent has a way
 * to send data outward. DASH cannot see the middle link — that is the agent's
 * reasoning, which runs in a child process DASH started and did not write. It
 * can see the other two, in its own audit, because both are brokered calls it
 * decided.
 *
 * So: **a successful read through any MCP connection marks the run. After that
 * mark, any brokered call in the same run that is a `write`, a `spend`, or
 * carries `reaches_beyond_server` needs a person.**
 *
 * ## Why `needs_a_person` is the right existing code
 *
 * Its docblock in `lib/broker/protocol.ts` already says what this means — the
 * request arrived from a process rather than from somebody at the keyboard, and
 * no amount of connecting or ticking boxes changes that — and the agent's move
 * is identical: stop, and let the person decide. A new code would be a second
 * name for one situation, and an agent handling one and not the other would
 * behave differently for no reason a user could see.
 *
 * ## Four things this rule is not
 *
 * A rule this cheap invites overclaiming, so the limits are here rather than in
 * a commit message:
 *
 * 1. **It is per run**, not per agent and not per session. A run is the unit a
 *    person pressed for and the unit the audit already groups by.
 * 2. **It does not distinguish safe content from hostile content**, because
 *    nothing can. Every MCP read is untrusted, which is what ADR 0002
 *    invariant 7 already says about every provider response.
 * 3. **It stops brokered egress after a brokered read. Nothing more.** It does
 *    not stop the agent writing the secret into its own report, its own
 *    artifact, a file in its folder, or a digest a person will read. Those
 *    paths exist and this module is silent about them.
 * 4. **It is not a defence against prompt injection.** Injected content still
 *    reaches the agent's reasoning and can still persuade it. What the rule
 *    changes is that the persuasion cannot reach a consequence without somebody
 *    at the keyboard.
 *
 * Nothing here performs I/O or reads a clock of its own. The caller supplies
 * the time, so a test can drive the whole rule deterministically.
 */

import type { BrokerOrigin } from "../broker/execute";
import type { AdmittedTool } from "./admission";

/**
 * How many runs the ledger remembers.
 *
 * Bounded because a long-lived DASH process would otherwise accumulate one
 * entry per run forever. The eviction direction is the unsafe one and is stated
 * rather than hidden: **an evicted run reverts to unmarked**, so a run that
 * outlived this many later marks would stop requiring a person.
 *
 * That is acceptable here and would not be if the number were small. A mark is
 * written at most once per run, `forgetRun` removes an entry when a run ends,
 * and reaching this ceiling means several hundred runs began, marked, and did
 * not end while one older run was still going. `BROKER_REPLAY_MEMORY` accepts
 * the same class of limit for the same reason and says so.
 */
export const REACH_LEDGER_RUNS = 256;

export interface ReachLedger {
  /** Insertion-ordered, which is what makes the oldest entry evictable. */
  marked: Map<string, string>;
}

export function createReachLedger(): ReachLedger {
  return { marked: new Map() };
}

/**
 * Record that this run read content DASH did not control.
 *
 * Called on a **successful** MCP read and on nothing else. A refused read
 * returned no content, so marking it would make a refusal tighten the rest of
 * the run — which reads as a punishment for asking and would push an agent
 * author towards probing less rather than declaring more.
 *
 * Idempotent: the first mark's time is kept, because the question the ledger
 * answers is *has this run read untrusted content*, and the answer's first
 * moment is the useful one for a receipt.
 */
export function markUntrustedRead(ledger: ReachLedger, runId: string, at: Date): void {
  if (ledger.marked.has(runId)) {
    return;
  }
  if (ledger.marked.size >= REACH_LEDGER_RUNS) {
    const oldest = ledger.marked.keys().next();
    if (!oldest.done) {
      ledger.marked.delete(oldest.value);
    }
  }
  ledger.marked.set(runId, at.toISOString());
}

/** When this run first read untrusted content, or null. Drives the receipt. */
export function untrustedReadAt(ledger: ReachLedger, runId: string): string | null {
  return ledger.marked.get(runId) ?? null;
}

/** A run ended. Its mark is no longer about anything. */
export function forgetRun(ledger: ReachLedger, runId: string): void {
  ledger.marked.delete(runId);
}

/**
 * Whether a tool's consequence is the kind the rule holds back.
 *
 * A read that reaches beyond its server counts, and that is the whole reason
 * `reaches_beyond_server` is a separate axis from `access`: `fetch(url)` is a
 * read by every annotation the protocol offers and is also the exit.
 */
export function isReaching(tool: AdmittedTool): boolean {
  return tool.access !== "read" || tool.reaches_beyond_server;
}

export type ReachDecision =
  | { ok: true }
  | { ok: false; refusal: "needs_a_person"; reason: "read_then_reach" };

export interface ReachRequest {
  ledger: ReachLedger;
  /** Null when the call is not inside a run at all. */
  run_id: string | null;
  origin: BrokerOrigin;
  tool: AdmittedTool;
}

/**
 * Decide one call against the rule.
 *
 * A `person` origin always passes, and that is not a loophole — it is the rule
 * working. `BrokerOrigin` records which code path inside DASH's own process the
 * request took, and `person` means somebody at the keyboard asked for this
 * specific call with its inputs visible. That is exactly the approval the rule
 * demands, so requiring a second one would be asking the same person the same
 * question twice.
 *
 * A call with no run cannot have been preceded by a read in that run, so it
 * passes here. Whether an agent may act outside a run at all is a different
 * question with a different answer, and `lib/broker/execute.ts` already owns it.
 */
export function decideReach(request: ReachRequest): ReachDecision {
  if (request.origin === "person") {
    return { ok: true };
  }
  if (!isReaching(request.tool)) {
    return { ok: true };
  }
  if (request.run_id === null || !request.ledger.marked.has(request.run_id)) {
    return { ok: true };
  }
  return { ok: false, refusal: "needs_a_person", reason: "read_then_reach" };
}

/**
 * What a person reads when the rule stopped something.
 *
 * It has to say what happened without implying DASH detected an attack, because
 * DASH detected no such thing — it noticed an ordering, and the ordering is
 * usually innocent. Copy that cried wolf here would train a person to approve
 * without reading, which is the one outcome that would make the rule worthless.
 */
export function describeReachRefusal(serverLabel: string): string {
  return (
    `This agent has already read something from ${serverLabel} in this run, and now wants to ` +
    "do something that leaves. That is a normal thing to want and it is also how a booby-trapped " +
    "document would try to send your information somewhere, so DASH is asking you first. " +
    "Check what it is about to do, then allow it or stop it."
  );
}
