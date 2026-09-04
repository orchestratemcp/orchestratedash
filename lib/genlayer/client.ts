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
 */

import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

import type { GenLayerChain } from "./adjudicate";
import type { GenLayerConnection } from "./connection";

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
       */
      await client.waitForTransactionReceipt({
        hash: asHash(hash),
        status: TransactionStatus.ACCEPTED,
        interval: ACCEPTED_POLL_MS,
        retries: ACCEPTED_POLLS,
      });
      return client.waitForTransactionReceipt({
        hash: asHash(hash),
        status: TransactionStatus.FINALIZED,
        interval: FINALIZED_POLL_MS,
        retries: FINALIZED_POLLS,
      });
    },

    async read(functionName: string, args: readonly string[]): Promise<unknown> {
      return client.readContract({ address, functionName, args: [...args] });
    },
  };
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
