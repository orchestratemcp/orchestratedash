/**
 * The one file in DASH that names `genlayer-js` (MAR-863, ADR 0033).
 *
 * Everything above it — the payload, the receipt reading, the state machine — is
 * pure and talks to `GenLayerChain`, a four-method interface a test can stand in
 * front of. This is the implementation of that interface, and it is deliberately
 * thin: it makes an account, funds it, signs, waits, and reads. It decides
 * nothing.
 *
 * ## The account is a throwaway and never leaves this function
 *
 * `createAccount()` mints a fresh keypair per attempt. The private half lives in
 * the closure below for the length of one adjudication and is never returned,
 * never stored, never logged, never written to the vault, and never reachable
 * from the value handed back — `lib/broker/execute.ts`' rule about a live
 * credential, applied to a key DASH generated rather than one a person gave it.
 *
 * That is not defence in depth over something valuable. It is why there is
 * nothing valuable: the account exists to pay gas out of a test network's faucet
 * and holds nothing else, so losing it costs nobody anything. See
 * `lib/genlayer/connection.ts` for why the whole design rests on that.
 *
 * ## Why the chain object is rebuilt rather than passed through
 *
 * `studionet` from the library carries the network's id, its consensus contract
 * and its ABI, and DASH must not restate any of that. What DASH decides is the
 * **endpoint**, because a person may point at their own node — so the chain is
 * the library's own object with `rpcUrls` replaced, and nothing else touched.
 *
 * ## Node only, and it bundles
 *
 * Checked before anything was built on it: `genlayer-js` bundles under
 * `esbuild` at `platform: "node"`, `format: "esm"`, `target: "node24"` — the
 * exact configuration `scripts/build-shell.mjs` uses for Electron main — at
 * about 1.2 MB, and the bundle runs. A Node-only entry point has broken this
 * bundle before, which is why that was the first thing this packet established.
 *
 * ## One dropped connection must not kill a five-minute wait (MAR-880)
 *
 * `genlayer-js@1.1.8`'s own poll loop calls `client.getTransaction` with no
 * try/catch around it, over a transport built with `retryCount: 0`. Judgement
 * 4 on Proof Scout's brief died in `opening` — `open_tx` written, `submit_tx`
 * never reached — twenty-five seconds after the press, while Studionet
 * finalized that same open transaction six seconds later. One poll threw and
 * the whole wait was abandoned as if the chain had gone silent, when it had
 * not.
 *
 * So `waitFinalized` below does not hand the whole wait to the library's own
 * recursive `waitForTransactionReceipt`. It drives its own poll loop,
 * checking once per interval (`retries: 0`, so the library makes exactly one
 * `getTransaction` call and either returns a decided receipt or throws) and
 * retrying *that one check* — never the whole wait — up to `POLL_RETRY_LIMIT`
 * times with a short backoff before deciding the network, not the chain, is
 * the problem. `pollWithRetry` is exported specifically so that decision can
 * be tested with a fake poll and no genlayer-js in the room — see
 * `tests/genlayer-client.test.ts`.
 *
 * The one thing this must not do is treat "not decided yet" as an error: with
 * `retries: 0` the library throws `Timed out waiting for transaction …` on a
 * merely-pending status, and retrying *that* with a backoff would turn every
 * ordinary poll into a five-times-slower one and could even manufacture a
 * false `network_lost` out of a transaction that was simply still being
 * judged. `isNotYetDecided` is the one place that message is read, and it is
 * this file's own accounting, not a claim about anything durable — nothing
 * derived from it is stored.
 */

import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

import type { GenLayerChain } from "./adjudicate";
import type { GenLayerConnection } from "./connection";
import { GenLayerNetworkLostError } from "./record";

/**
 * How long DASH will watch one transaction, and where the numbers come from.
 *
 * Measured across the spike's ten judgements, `evaluate` took **45 to 281
 * seconds** to finalize. These budgets are roughly double the worst observed —
 * ten minutes of two-second polls to accepted, ten of three-second polls to
 * finalized — which is what "budget for the tail" means when the tail is a
 * committee of language models and nobody has its ninety-ninth percentile.
 *
 * This is not a timeout in the sense the surface should say so. Exhausting it
 * means DASH stopped watching a transaction that is still on the chain, which is
 * `abandoned` in `AdjudicationFailure` and reads as *DASH stopped waiting*,
 * never as *it failed*.
 */
const ACCEPTED_POLL_MS = 2_000;
const ACCEPTED_POLLS = 300;
const FINALIZED_POLL_MS = 3_000;
const FINALIZED_POLLS = 200;

/**
 * How many extra tries one failed poll gets before it counts as lost, and how
 * long DASH waits between them (MAR-880).
 *
 * Five retries is enough to ride out one dropped connection or one
 * not-yet-indexed hash without turning a check that normally takes a fraction
 * of a second into a five-minute one on every single poll — most polls never
 * retry at all. The backoff is short because the budget this sits inside is
 * already generous (ten minutes to accepted, ten more to finalized); this is
 * for riding out a blip, not for waiting out an outage.
 */
export const POLL_RETRY_LIMIT = 5;
const POLL_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 8_000] as const;

/**
 * Retry one poll up to `POLL_RETRY_LIMIT` times with a short backoff before
 * giving up on it.
 *
 * Generic over `poll`, and `sleep` is injectable, on `adjudicateBrief`'s own
 * reasoning: a test of a five-times-longer wait must not take five times as
 * long. Nothing here knows what a "poll" checks or what it means for one to
 * succeed — that is `waitForStatus`'s job, below. This function knows only
 * how many times to try again and how long to wait in between.
 */
export async function pollWithRetry<T>(
  poll: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= POLL_RETRY_LIMIT; attempt++) {
    try {
      return await poll();
    } catch (error) {
      lastError = error;
      if (attempt === POLL_RETRY_LIMIT) {
        break;
      }
      await sleep(POLL_RETRY_BACKOFF_MS[attempt]);
    }
  }
  throw new GenLayerNetworkLostError(
    `lost the network after ${POLL_RETRY_LIMIT + 1} consecutive polls: ${errorMessage(lastError)}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function realSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * The faucet, over the network's own JSON-RPC.
 *
 * `sim_fundAccount` is a Studio method and not part of the client library, so
 * this is a plain `fetch` at the same endpoint the client uses. It is the only
 * hand-written request in this packet and it carries no credential, because
 * there is none: the faucet funds whatever address it is asked about.
 */
async function fundAccount(rpcUrl: string, address: string, amount: number): Promise<void> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "sim_fundAccount",
      params: [address, amount],
    }),
  });
  if (!response.ok) {
    throw new Error("the faucet refused");
  }
  const body: unknown = await response.json();
  /*
   * A JSON-RPC error arrives with HTTP 200 and an `error` member, so the status
   * above is not the check. The message it carries is deliberately *not* read
   * into the throw: a network's own error text is content DASH did not write,
   * and `adjudicateBrief` drops the caught value anyway.
   */
  if (typeof body === "object" && body !== null && "error" in body) {
    throw new Error("the faucet refused");
  }
}

/**
 * Open a chain for one adjudication.
 *
 * The account is made here and dies with the returned object. Nothing on that
 * object exposes it, and the four methods it does expose cannot name an endpoint
 * or an address — both are closed over from the connection, once.
 */
export async function openGenLayerChain(
  connection: GenLayerConnection,
): Promise<GenLayerChain> {
  const account = createAccount();
  /*
   * The library's own chain, with the endpoint replaced and nothing else. The
   * id, the consensus contract and its ABI stay whatever `genlayer-js` says they
   * are — restating any of them here would be DASH keeping a second copy of
   * somebody else's network configuration.
   */
  const chain = {
    ...studionet,
    rpcUrls: { default: { http: [connection.rpc_url] as const } },
  };
  const client = createClient({ chain, account });
  const address = connection.contract_address as `0x${string}`;

  return {
    address: account.address,

    async fund(amount: number): Promise<void> {
      await fundAccount(connection.rpc_url, account.address, amount);
    },

    async write(functionName: string, args: readonly string[]): Promise<string> {
      /*
       * `value: 0n` on every write, and it is not a default. `open_commission`
       * is payable, and a non-zero value here would be DASH moving something.
       * See `lib/genlayer/adjudicate.ts` on why the bounty is always zero.
       */
      const hash = await client.writeContract({
        address,
        functionName,
        args: [...args],
        value: 0n,
      });
      return String(hash);
    },

    async waitFinalized(hash: string): Promise<unknown> {
      /*
       * Accepted, then finalized. They answer different questions — accepted
       * means the committee agreed on the receipt, finalized means the appeal
       * window closed — and DASH waits for both because that is what the spike's
       * ten judgements and this packet's own live probe actually did.
       *
       * Neither of them means the contract call succeeded, and neither means
       * state was applied. `lib/genlayer/receipt.ts` is the only thing that
       * answers those, from three fields on the receipt returned here.
       *
       * See this file's header (MAR-880): each status is its own poll loop
       * rather than one call handed to the library's recursive wait, so a
       * dropped connection on poll 4 does not cost the whole budget earned by
       * polls 1 through 3.
       */
      await waitForStatus(client, asHash(hash), TransactionStatus.ACCEPTED, ACCEPTED_POLL_MS, ACCEPTED_POLLS);
      return waitForStatus(client, asHash(hash), TransactionStatus.FINALIZED, FINALIZED_POLL_MS, FINALIZED_POLLS);
    },

    async read(functionName: string, args: readonly string[]): Promise<unknown> {
      return client.readContract({ address, functionName, args: [...args] });
    },
  };
}

/**
 * The one method `waitForStatus` needs from a genlayer-js client.
 *
 * Narrower than `ReturnType<typeof createClient>` on purpose: a structural
 * type this small is one a test can satisfy with a plain object and no
 * genlayer-js in the room — see `tests/genlayer-client.test.ts`.
 */
export interface PollableClient {
  waitForTransactionReceipt(args: {
    hash: `0x${string}` & { length: 66 };
    status: TransactionStatus;
    interval: number;
    retries: number;
  }): Promise<unknown>;
}

/**
 * One status, waited for, with each individual poll retried on its own
 * (MAR-880).
 *
 * `checkOnce` below is one call to the library with `retries: 0`, so it makes
 * exactly one `getTransaction` and either returns a decided receipt or
 * throws. This loop turns that into the same shape the library's own
 * recursive wait had — up to `maxPolls` checks, `intervalMs` apart — except
 * that a check which throws for a transport reason is retried by
 * `pollWithRetry` before it costs one of those `maxPolls` slots, and a check
 * which throws only because the status is not there yet costs a slot and
 * nothing else. Exhausting `maxPolls` throws a plain `Error`, exactly the
 * shape the library's own timeout took, which is what keeps this an
 * `abandoned` and not a `network_lost` — see `lib/genlayer/adjudicate.ts`.
 *
 * Exported so a test can drive the whole loop — throws that resolve on
 * retry, throws that exhaust the retry budget, and a budget that runs out
 * while every poll keeps succeeding — against a fake `PollableClient` with no
 * real wait in the room. `sleep` is injectable for the same reason: a test of
 * a budget-exhaustion path must not spend that budget's wall-clock time.
 */
export async function waitForStatus(
  client: PollableClient,
  hash: `0x${string}` & { length: 66 },
  status: TransactionStatus,
  intervalMs: number,
  maxPolls: number,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<unknown> {
  for (let poll = 0; poll < maxPolls; poll++) {
    const outcome = await pollWithRetry(() => checkOnce(client, hash, status), sleep);
    if (outcome.decided) {
      return outcome.receipt;
    }
    if (poll < maxPolls - 1) {
      await sleep(intervalMs);
    }
  }
  throw new Error(`Timed out waiting for transaction ${hash} to reach status "${status}".`);
}

/** One poll's answer. Not-yet-decided is a normal outcome, never a throw here. */
type PollOutcome = { decided: true; receipt: unknown } | { decided: false };

/** Ask once. `retries: 0` is what makes this exactly one `getTransaction`. */
async function checkOnce(
  client: PollableClient,
  hash: `0x${string}` & { length: 66 },
  status: TransactionStatus,
): Promise<PollOutcome> {
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      status,
      interval: 0,
      retries: 0,
    });
    return { decided: true, receipt };
  } catch (error) {
    if (isNotYetDecided(error)) {
      return { decided: false };
    }
    throw error;
  }
}

/**
 * The one shape `client.waitForTransactionReceipt` throws when asked to check
 * once (`retries: 0`) and the status has not arrived — a normal answer to an
 * ordinary poll, never a transport failure. Matched by the message because
 * the library gives it no other shape: read from `genlayer-js@1.1.8`,
 * `dist/index.js`, `receiptActions.waitForTransactionReceipt`. Anything else
 * thrown from that call — a rejected fetch, a non-JSON body, an unindexed
 * hash — is `pollWithRetry`'s to retry, not this function's to interpret.
 */
function isNotYetDecided(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Timed out waiting for transaction ");
}

/**
 * A transaction hash, in the shape the library's own type demands.
 *
 * `genlayer-js` types a hash as a template literal *and* a length, which no
 * `string` narrows to on its own. The value here came out of `writeContract`
 * one call earlier, so this is a cast over the library's own output rather
 * than over anything DASH parsed — and it is one function so the cast is in
 * one place rather than at each of the two call sites.
 */
function asHash(hash: string): `0x${string}` & { length: 66 } {
  return hash as `0x${string}` & { length: 66 };
}
