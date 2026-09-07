/**
 * An agent whose source fetch fails once and then succeeds (MAR-889).
 *
 * The acceptance criterion for stage 3 is that *a real error and a real retry
 * show on the right step with the right result*, and this is the "real" half.
 * Nothing here is stubbed: it is an ordinary program using the shipped runtime
 * the way the templates do, spawned by a real `Supervisor` over a real pipe, and
 * the failure is a function that throws the first time it is called.
 *
 * The shape is the one the SDK documents rather than a clever one. Two steps,
 * and inside the first a `span()` per attempt carrying `attempt` — which is what
 * leaves the failed try on the page beside the one that worked instead of a
 * counter saying it took two goes.
 *
 * It reaches no network. The point is the trace, and a fixture that fetched
 * would be a fixture that fails on a machine with no connection for a reason
 * that has nothing to do with what is being proven.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { startAgent } from "./dash-agent-sdk.mjs";

const projectDir = path.dirname(fileURLToPath(import.meta.url));

let attempts = 0;

/** Throws the first time, answers the second. No network, no timer, no sleep. */
async function readTheFeed() {
  attempts += 1;
  if (attempts === 1) {
    throw new Error("the newsroom feed did not answer");
  }
  return [
    {
      headline: "A thing happened",
      summary: "One item, so the digest has something in it.",
      source_name: "Example newsroom",
      source_url: "https://example.test",
      item_url: "https://example.test/a-thing-happened",
    },
  ];
}

startAgent({
  definition: {
    projectDir,
    stepProgress: 0.45,
    ready: () => "ready, and it will fail once on purpose",
  },
  async runOnce({ step, span, digest }) {
    step("source_fetch", "Read the sources");

    let items = null;
    let lastError = null;
    for (let attempt = 1; attempt <= 2 && items === null; attempt += 1) {
      try {
        items = await span("Read the newsroom feed", readTheFeed, {
          kind: "source_fetch",
          attempt,
        });
      } catch (error) {
        // Kept rather than swallowed: if the second try fails too, the run
        // should fail with the reason, which is what the run span records.
        lastError = error;
      }
    }
    if (items === null) {
      throw lastError ?? new Error("no items");
    }

    step("digest_write", "Write what it found");
    digest({
      title: "One thing that happened",
      generated_at: "2026-09-07T12:00:00.000Z",
      sources: [
        {
          source_name: "Example newsroom",
          source_url: "https://example.test",
          status: "ok",
          item_count: items.length,
        },
      ],
      items,
    });

    return `Read ${String(items.length)} item.`;
  },
});
