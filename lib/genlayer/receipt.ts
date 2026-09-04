/**
 * Reading a GenLayer transaction receipt correctly (MAR-863, ADR 0033).
 *
 * The port of `scripts/lib/studio.mjs`'s `applied()` from the Agent Tank spike,
 * and the single most important forty lines in this packet. It cost the spike
 * two Studionet runs to find, so it arrives here as a module with a name rather
 * than as three `??` chains inside a state machine.
 *
 * ## Three fields, three different questions
 *
 * | Field | Question |
 * | -- | -- |
 * | `status_name` | did the transaction reach a decision? |
 * | `consensus_data.leader_receipt[0].execution_result` | did the leader's call succeed? |
 * | `result_name` | did the committee accept the leader's answer? |
 *
 * A write can be **FINALIZED**, with **SUCCESS** execution, and apply **no
 * state at all**, because consensus came back `MAJORITY_DISAGREE`. Studionet
 * run 4 did exactly that: the leader proposed a verdict, three validators judged
 * that verdict against the same case file and refused it, and the commission
 * stayed `submitted` with no verdict on it. Reading only the first two fields
 * reports that as a success with a mysteriously empty result — and a surface
 * built on that reading waits forever for a verdict that is never coming.
 *
 * Measured across ten judgements in the spike's `transcripts/stability.json`:
 * **one in ten.** That is not a rare edge; it is a routine outcome the product
 * has to have a route out of, which is why `AdjudicationOutcome` names it and
 * `lib/copy/genlayer.ts` gives it a sentence and a next action.
 *
 * This is the equivalence principle doing its job rather than a fault. The
 * committee is *supposed* to be able to refuse a leader whose verdict it does
 * not accept, and a client that could not tell that apart from a verdict would
 * be reporting one validator's opinion as the network's.
 *
 * ## Everything here reads an untrusted structure
 *
 * A receipt arrives over JSON-RPC from a network DASH does not run, so every
 * read below is defensive in the shape `lib/broker/operations.ts`' projections
 * are: a value is used when it is the type it should be, and is null otherwise.
 * Nothing throws on a shape nobody expected, and nothing is coerced.
 *
 * Pure. No network, no clock, no store — which is what lets
 * `tests/broker-genlayer.test.ts` drive the whole `MAJORITY_DISAGREE` case
 * against a recorded receipt with no chain in the room.
 */

/* ---------------------------------------------------------------------- *
 * What DASH concluded about one transaction
 * ---------------------------------------------------------------------- */

/**
 * What a finished adjudication actually did.
 *
 * Three, and the third is the one the packet exists to get right.
 */
export type AdjudicationOutcome =
  /** The committee agreed and the state was written. There is a verdict. */
  | "applied"
  /**
   * The transaction was decided, the leader's call succeeded, and the committee
   * refused the leader's verdict — so nothing was written and there is no
   * verdict to read. Roughly one judgement in ten. Recoverable by asking again.
   */
  | "no_consensus"
  /** The call itself failed, so no verdict was ever proposed. */
  | "execution_failed";

/**
 * What DASH could read off one receipt, before any of it is believed.
 *
 * Every member is nullable because every member is a provider's word. A null
 * `status` on a receipt that arrived is a Studio version DASH has not seen, and
 * `outcome` is decided from the two fields that matter rather than from this
 * one — a receipt whose status DASH cannot name can still have applied state.
 */
export interface ReceiptReading {
  /** `FINALIZED`, `ACCEPTED`, … as the network wrote it. Never parsed further. */
  status: string | null;
  /** The leader's own `execution_result`. `SUCCESS`, `FINISHED_WITH_RETURN`, … */
  execution_result: string | null;
  /** The consensus outcome. `MAJORITY_AGREE`, `MAJORITY_DISAGREE`, … */
  consensus_result: string | null;
  /** What the network says wrote the verdict, e.g. `openai/gpt-4o`. Its claim. */
  leader_model: string | null;
  /** How each validator voted, tallied by name. Null when none were reported. */
  votes: Record<string, number> | null;
  outcome: AdjudicationOutcome;
}

/* ---------------------------------------------------------------------- *
 * The three readings
 * ---------------------------------------------------------------------- */

/** Every value the leader's execution takes when the call itself succeeded. */
const EXECUTION_SUCCEEDED: readonly (string | number)[] = Object.freeze([
  "FINISHED_WITH_RETURN",
  "SUCCESS",
  1,
]);

/** Every value the consensus takes when the committee accepted the leader. */
const CONSENSUS_AGREED: readonly (string | number)[] = Object.freeze(["MAJORITY_AGREE", 6]);

/**
 * Did the leader's own call succeed?
 *
 * The leader receipt's `execution_result` first, and the transaction-level
 * `txExecutionResultName` only as a fallback for a Studio that shapes it
 * differently. The transaction-level `result_name` is **not** consulted here and
 * must never be: it is the consensus outcome, and reading it as an answer to
 * "did the contract call succeed" is precisely how a refused verdict gets
 * reported as a success.
 */
export function executionResultOf(receipt: unknown): string | null {
  const leader = leaderReceipts(receipt)[0];
  const fromLeader = readString(leader, "execution_result");
  if (fromLeader !== null) {
    return fromLeader;
  }
  return readString(receipt, "txExecutionResultName");
}

/** Did the committee accept the leader's answer? */
export function consensusResultOf(receipt: unknown): string | null {
  return readString(receipt, "result_name") ?? readString(receipt, "result");
}

/** Did the transaction reach a decision at all? */
export function statusOf(receipt: unknown): string | null {
  return (
    readString(receipt, "status_name") ??
    readString(receipt, "statusName") ??
    readString(receipt, "status")
  );
}

/**
 * Did this transaction actually change anything?
 *
 * The three-part check, in one predicate, with a name that says what it means.
 * `succeeded(receipt) && consensus agreed` — and the whole file exists so that
 * no caller anywhere writes the two-part version by accident.
 */
export function applied(receipt: unknown): boolean {
  return succeeded(receipt) && member(consensusResultOf(receipt), CONSENSUS_AGREED);
}

/** The leader's call succeeded. Necessary, and on its own not sufficient. */
export function succeeded(receipt: unknown): boolean {
  return member(executionResultOf(receipt), EXECUTION_SUCCEEDED);
}

/**
 * Everything DASH concluded about one receipt, in one pass.
 *
 * The one function a caller should reach for. It returns the reading *and* the
 * outcome together, so a surface drawing the failure has the three fields that
 * explain it without asking the receipt a fourth question.
 */
export function readReceipt(receipt: unknown): ReceiptReading {
  const execution = executionResultOf(receipt);
  const consensus = consensusResultOf(receipt);
  const ok = member(execution, EXECUTION_SUCCEEDED);
  return {
    status: statusOf(receipt),
    execution_result: execution,
    consensus_result: consensus,
    leader_model: leaderModelOf(receipt),
    votes: votesOf(receipt),
    outcome: !ok
      ? "execution_failed"
      : member(consensus, CONSENSUS_AGREED)
        ? "applied"
        : "no_consensus",
  };
}

/* ---------------------------------------------------------------------- *
 * The network's own claims about itself
 * ---------------------------------------------------------------------- */

/**
 * Which model the network says wrote the verdict.
 *
 * Studio has moved this between versions, so rather than pin one path this walks
 * the receipt for the first object carrying a `model`, bounded to six levels.
 * What it finds is reported as **the network's claim**, never as DASH's
 * measurement — the same standing `BriefArtifact.document.model` has, and the
 * same sentence `describeBriefAuthor` already uses for it.
 */
export function leaderModelOf(receipt: unknown): string | null {
  const node = record(leaderReceipts(receipt)[0])?.["node_config"];
  const named = readString(node, "model");
  if (named !== null) {
    return join(readString(node, "provider"), named);
  }
  return findModel(receipt, 0);
}

/** How the validators voted, tallied by the name each vote came back under. */
export function votesOf(receipt: unknown): Record<string, number> | null {
  const votes = record(record(receipt)?.["consensus_data"])?.["votes"];
  const source = record(votes);
  if (source === null) {
    return null;
  }
  const tally: Record<string, number> = {};
  for (const vote of Object.values(source)) {
    const name = typeof vote === "string" ? vote : JSON.stringify(vote);
    tally[name] = (tally[name] ?? 0) + 1;
  }
  return Object.keys(tally).length === 0 ? null : tally;
}

/**
 * Where a deployment put the contract, or null.
 *
 * Unused by the adjudication itself — DASH judges against a contract whose
 * address is part of the connection, and deploying one is not something this
 * packet does. Here because reading an address off a receipt is a receipt
 * question, and the module that answers receipt questions is this one.
 */
export function contractAddressOf(receipt: unknown): string | null {
  return (
    readString(record(receipt)?.["data"], "contract_address") ??
    readString(receipt, "contract_address") ??
    readString(receipt, "to_address")
  );
}

/* ---------------------------------------------------------------------- *
 * Defensive reads
 * ---------------------------------------------------------------------- */

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(source: unknown, key: string): string | null {
  const holder = record(source);
  if (holder === null) {
    return null;
  }
  const value = holder[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  // A Studio that answers with an enum number rather than its name. Rendered as
  // the number so a surface can print what the network actually said, rather
  // than DASH inventing the label it thinks that number means.
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
}

/** The leader receipts, however this Studio version shaped them. */
function leaderReceipts(receipt: unknown): unknown[] {
  const raw = record(record(receipt)?.["consensus_data"])?.["leader_receipt"];
  if (Array.isArray(raw)) {
    return raw;
  }
  return raw === undefined || raw === null ? [] : [raw];
}

function member(value: string | null, allowed: readonly (string | number)[]): boolean {
  if (value === null) {
    return false;
  }
  return allowed.some((one) => String(one) === value);
}

function join(provider: string | null, model: string): string {
  return provider === null ? model : `${provider}/${model}`;
}

/** The first `model` anywhere in the receipt, bounded. See `leaderModelOf`. */
function findModel(value: unknown, depth: number): string | null {
  if (depth > 6) {
    return null;
  }
  const holder = record(value);
  if (holder === null) {
    if (Array.isArray(value)) {
      for (const child of value) {
        const found = findModel(child, depth + 1);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  }
  const named = readString(holder, "model");
  if (named !== null) {
    return join(readString(holder, "provider"), named);
  }
  for (const child of Object.values(holder)) {
    const found = findModel(child, depth + 1);
    if (found !== null) {
      return found;
    }
  }
  return null;
}
