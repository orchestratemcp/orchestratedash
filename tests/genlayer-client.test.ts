/**
 * The poll retry that keeps one dropped connection from abandoning a
 * five-minute wait (MAR-880).
 *
 * `lib/genlayer/client.ts` is the one file in DASH that names `genlayer-js`,
 * and it is deliberately outside the fixture boundary `tests/broker-genlayer.test.ts`
 * drives everything else through — there is no fake chain for it to implement,
 * because it *is* the implementation. What it exports instead are the two
 * pieces of the fix that do not need a real chain to be exercised honestly:
 *
 * 1. `pollWithRetry`, generic over what a "poll" is, tested against a bare
 *    function that throws on a schedule.
 * 2. `waitForStatus`, the loop that decides which throws are "not yet" (a
 *    normal answer to an ordinary poll) and which are the network genuinely
 *    gone, tested against `PollableClient` — the one method it needs, not the
 *    whole of `genlayer-js`.
 *
 * No network, no chain, no key, and no real wait: every `sleep` here is
 * injected and resolves immediately, on `adjudicateBrief`'s own reasoning —
 * a test of a five-times-longer wait must not take five times as long.
 */

import { describe, expect, it, vi } from "vitest";
import { TransactionStatus } from "genlayer-js/types";

import {
  POLL_RETRY_LIMIT,
  pollWithRetry,
  waitForStatus,
  type PollableClient,
} from "../lib/genlayer/client";
import { GenLayerNetworkLostError } from "../lib/genlayer/record";

// Cast exactly as `lib/genlayer/client.ts`'s own `asHash` does — a template
// literal type is not one a `string` narrows to on its own.
const HASH = "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}` &
  { length: 66 };
const ACCEPTED = TransactionStatus.ACCEPTED;

/** A `sleep` that resolves immediately but still records what it was asked. */
function instantSleep(): { sleep: (ms: number) => Promise<void>; calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    sleep: (ms: number) => {
      calls.push(ms);
      return Promise.resolve();
    },
  };
}

/* ---------------------------------------------------------------------- *
 * pollWithRetry — generic over what a "poll" is
 * ---------------------------------------------------------------------- */

describe("pollWithRetry", () => {
  it("(a) resolves when a poll throws once and then succeeds", async () => {
    let calls = 0;
    const { sleep, calls: sleeps } = instantSleep();
    const poll = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error("connection reset"));
      }
      return Promise.resolve("verdict landed");
    });

    await expect(pollWithRetry(poll, sleep)).resolves.toBe("verdict landed");
    expect(poll).toHaveBeenCalledTimes(2);
    // One retry, one backoff — the first entry in the schedule.
    expect(sleeps).toEqual([1_000]);
  });

  it("never sleeps or retries when the first attempt succeeds", async () => {
    const { sleep, calls: sleeps } = instantSleep();
    await expect(pollWithRetry(() => Promise.resolve("ok"), sleep)).resolves.toBe("ok");
    expect(sleeps).toEqual([]);
  });

  it("(b) throws GenLayerNetworkLostError after six consecutive throws", async () => {
    const { sleep, calls: sleeps } = instantSleep();
    const poll = vi.fn(() => Promise.reject(new Error("fetch failed")));

    await expect(pollWithRetry(poll, sleep)).rejects.toBeInstanceOf(GenLayerNetworkLostError);
    // The initial attempt plus POLL_RETRY_LIMIT retries — six consecutive
    // throws in total, which is the shape MAR-880's diagnosis describes.
    expect(poll).toHaveBeenCalledTimes(POLL_RETRY_LIMIT + 1);
    expect(sleeps).toEqual([1_000, 2_000, 4_000, 8_000, 8_000]);
  });

  it("binds the last error's message onto the network-lost error, never a network's own object", async () => {
    const { sleep } = instantSleep();
    const poll = () => Promise.reject(new Error("ECONNRESET"));
    await expect(pollWithRetry(poll, sleep)).rejects.toThrow(/ECONNRESET/);
  });
});

/* ---------------------------------------------------------------------- *
 * waitForStatus — the loop that decides what "one poll" means
 * ---------------------------------------------------------------------- */

describe("waitForStatus", () => {
  it("(a) a poll that throws a transport error once then succeeds reaches the receipt", async () => {
    const { sleep, calls: sleeps } = instantSleep();
    let attempt = 0;
    const client: PollableClient = {
      waitForTransactionReceipt: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error("network reset"));
        }
        return Promise.resolve({ status_name: "ACCEPTED" });
      },
    };

    const receipt = await waitForStatus(client, HASH, ACCEPTED, 2_000, 300, sleep);
    expect(receipt).toEqual({ status_name: "ACCEPTED" });
    expect(attempt).toBe(2);
    // The retry backoff, not the poll interval — the poll succeeded on its
    // first *outer* iteration, it just needed one inner retry to get there.
    expect(sleeps).toEqual([1_000]);
  });

  it('treats "not yet decided" as an ordinary answer, never as a reason to retry', async () => {
    const { sleep, calls: sleeps } = instantSleep();
    let attempt = 0;
    const client: PollableClient = {
      waitForTransactionReceipt: () => {
        attempt += 1;
        if (attempt < 3) {
          return Promise.reject(
            new Error(
              `Timed out waiting for transaction ${HASH} to reach status "ACCEPTED" (current status: PENDING).`,
            ),
          );
        }
        return Promise.resolve({ status_name: "ACCEPTED" });
      },
    };

    const receipt = await waitForStatus(client, HASH, ACCEPTED, 2_000, 300, sleep);
    expect(receipt).toEqual({ status_name: "ACCEPTED" });
    // Three outer polls, each its own interval sleep, and no backoff sleep at
    // all — a "not yet" answer never enters `pollWithRetry`'s retry budget.
    expect(sleeps).toEqual([2_000, 2_000]);
  });

  it("(c) a status that never arrives exhausts the poll budget as a plain Error, not network-lost", async () => {
    const { sleep } = instantSleep();
    const client: PollableClient = {
      waitForTransactionReceipt: () =>
        Promise.reject(
          new Error(`Timed out waiting for transaction ${HASH} to reach status "ACCEPTED".`),
        ),
    };

    const failure = await waitForStatus(client, HASH, ACCEPTED, 2_000, 3, sleep).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(GenLayerNetworkLostError);
    expect((failure as Error).message).toMatch(/Timed out waiting for transaction/);
  });

  it("six consecutive genuine errors on one poll surface as network-lost, not a timeout", async () => {
    const { sleep } = instantSleep();
    const client: PollableClient = {
      waitForTransactionReceipt: () => Promise.reject(new Error("ECONNRESET")),
    };

    await expect(waitForStatus(client, HASH, ACCEPTED, 2_000, 300, sleep)).rejects.toBeInstanceOf(
      GenLayerNetworkLostError,
    );
  });
});
