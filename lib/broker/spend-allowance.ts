/**
 * The per-run budget MAR-582 named, built at last (MAR-619, ADR 0016).
 *
 * `BrokerOrigin` in `lib/broker/execute.ts` has refused every agent-origin spend
 * since MAR-545, and its docblock is unusually specific about why: *"a cost
 * story and a per-run budget — and this slice builds the first and not the
 * second… An agent that may spend without a per-run budget is an agent that can
 * empty an account between two of DASH's five-second polls."* It closes by
 * calling the refusal **a stated, temporary standing rather than a principle**.
 *
 * This module is the second thing. It exists because MAR-619 asks the News Scout
 * to send what it found through a model, and that request cannot be honoured by
 * relaxing the gate — a gate relaxed is a gate gone, and what stood behind it
 * was somebody's OpenRouter balance running unattended.
 *
 * ## What an allowance is, and why it is not a relaxation
 *
 * A person presses Run now. That press opens an allowance: **a small number of
 * model calls, for a short time, for that one agent.** An agent-origin spend is
 * permitted only while one is open, and each call consumes it.
 *
 * So the sentence the origin gate was protecting stays literally true — *a
 * person is behind every penny DASH spends* — and what changes is only how DASH
 * knows it. `origin` was a crude proxy for that sentence, and the honest reason
 * it was crude is written into its own comment: DASH had no way to tie a line
 * read off a child's stdout to a button somebody pressed. This is that way.
 *
 * The distinction matters when reading the diff. This does not widen what an
 * agent may do; it narrows *when* it may do it, from never to "inside a window a
 * person opened by asking for a run".
 *
 * ## The bound is in tokens, because that is the only unit DASH holds
 *
 * A budget denominated in money cannot be enforced, and pretending otherwise
 * would be the invented number `AnswerCharge` and `describeAmount` exist to
 * refuse. Two of the three providers never state a price at all
 * (`prices_its_own_answer` is false for Anthropic and OpenAI), and the one that
 * does states it *after* the call — so a dollar ceiling could only ever be
 * checked once the money was already gone.
 *
 * What DASH does hold, exactly and in advance, is the size of what it will send
 * and the ceiling on what it will ask for back. `MAX_MATERIAL_CHARS` bounds one
 * request's material and `MAX_OUTPUT_TOKENS` bounds one reply, both in
 * `lib/broker/operations.ts` and both DASH's own constants rather than a
 * caller's. Multiplying those by `SPEND_ALLOWANCE_CALLS` gives the worst case
 * one press can produce, in the unit the provider actually bills on, without
 * DASH holding a rate card for anybody.
 *
 * That is the whole claim, and it is deliberately not the stronger one somebody
 * will want: DASH cannot promise a press costs less than a stated amount of
 * money, and no surface built on this may say it does.
 *
 * ## Why it is not keyed on a run id
 *
 * The obvious key is the run, and it is the wrong one. A run id is minted by the
 * agent — `startRun` in the template calls `randomUUID` — and reaches DASH as a
 * telemetry claim. An allowance keyed on a value the spending party chooses is
 * an allowance that party can reset by choosing another one, which is the same
 * mistake as letting a request carry its own origin.
 *
 * So it is keyed on the agent and opened by the press, which is a fact about
 * DASH's own UI that no child process can assert. The cost of that choice is
 * stated rather than hidden: a person who presses Run now twice in ten minutes
 * has opened one allowance twice, and `openRunSpend` replaces rather than adds,
 * so the second press cannot stack a larger budget than the first.
 *
 * Pure, and it holds nothing. The map lives in `createBroker` beside the other
 * budgets, for the reason they are there: one broker, one set of counters, so a
 * second instance cannot be a second budget — the argument `hostBroker` already
 * makes about itself.
 */

/**
 * How many model calls one press of Run now may pay for.
 *
 * Two, and the second one is the argued half. One is what the scout needs: its
 * digest step makes a single curation call per run. The second exists so that a
 * step which failed on a torn connection can be tried again inside the same run
 * without a person having to press anything — and it stops there, because three
 * would start to look like a retry loop's allowance rather than a run's.
 *
 * The number is small on purpose and is meant to stay small. Widening it is
 * widening what one press can cost, and `tests/broker-spend.test.ts` pins it by
 * value so that the widening is a diff somebody reads.
 */
export const SPEND_ALLOWANCE_CALLS = 2;

/**
 * How long a press stays good for.
 *
 * Ten minutes. A run of the scout is seconds of work — three fetches at
 * `FETCH_TIMEOUT_MS` apiece, then one model call — so this is generous by an
 * order of magnitude and still short enough that an allowance cannot be left
 * lying open across an afternoon for something else to find.
 *
 * A window rather than a close-on-run-end signal, and that is the honest
 * choice: run-end reaches DASH as a `run_completed` event the agent emits, so
 * closing on it would put the end of the budget in the hands of the process
 * being budgeted. A clock cannot be argued with.
 */
export const SPEND_ALLOWANCE_MS = 10 * 60_000;

/** What one press of Run now bought, as the broker holds it. */
export interface RunSpendAllowance {
  /** When the person pressed, by DASH's own clock. Never an agent's timestamp. */
  opened_at: number;
  /** Calls still available under it. Zero is spent, and spent is not open. */
  remaining: number;
}

/**
 * A person asked for a run. Open the allowance.
 *
 * Replaces any allowance already open for this agent rather than topping one
 * up, which is the property that makes a second press harmless: the ceiling on
 * what an agent may spend is always one press's worth, however many times
 * somebody presses.
 */
export function openRunSpend(at: number): RunSpendAllowance {
  return { opened_at: at, remaining: SPEND_ALLOWANCE_CALLS };
}

/**
 * Whether this allowance still covers a call at this moment.
 *
 * Absent, expired and spent all answer false, and the caller does not get to
 * tell them apart. That is deliberate: the agent-visible refusal is
 * `needs_a_person` in every case, because the next move is the same one — ask
 * the person to run it — and a refusal that distinguished them would let an
 * agent learn the shape of the budget by probing it.
 */
export function spendAllowed(
  allowance: RunSpendAllowance | undefined,
  at: number,
): boolean {
  if (allowance === undefined || allowance.remaining <= 0) {
    return false;
  }
  return at - allowance.opened_at < SPEND_ALLOWANCE_MS;
}

/**
 * One call's worth taken off it.
 *
 * Returns a new value rather than mutating, so the broker's own step order
 * decides when the allowance is actually reduced — and it reduces it on the
 * *attempt* rather than on a successful answer, for `budget.calls`' stated
 * reason: a refused call still reached a provider's door, and not counting
 * refusals leaves a way to probe the boundary as fast as the pipe allows.
 */
export function spendOne(allowance: RunSpendAllowance): RunSpendAllowance {
  return { opened_at: allowance.opened_at, remaining: Math.max(0, allowance.remaining - 1) };
}
