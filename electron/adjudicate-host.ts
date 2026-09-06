/**
 * The one route by which a press in DASH's window publishes something nobody
 * can take down (MAR-863, ADR 0033).
 *
 * `electron/open-out.ts`' shape: the seam is one module, so a reviewer asking
 * *"what in DASH can put a document on a public network?"* reads one file rather
 * than auditing every caller of a client library. `lib/shell/ipc.ts` routes
 * `adjudicate.start` here and nowhere else, and `lib/genlayer/adjudicate.ts` —
 * which is pure but for its injected chain — decides everything about what
 * happens next.
 *
 * ## What this module actually adds
 *
 * Three things, and they are all resolutions the renderer must not make:
 *
 * 1. **Which briefing.** The renderer names two opaque ids; this resolves them
 *    against the store, and refuses anything that is not a brief this agent
 *    produced. No document crosses the IPC boundary in either direction.
 * 2. **Which digest.** A brief is judged against the list it was written from,
 *    found here the way `exportBriefAsPdf` finds it — same run, same artifact
 *    id — and `buildAdjudicationPayload` then re-checks the fingerprint and
 *    refuses on a mismatch.
 * 3. **Which chain.** The endpoint and the contract address come from
 *    `resolveGenLayerConnection`, never from a payload, so a compromised
 *    renderer cannot point a judgement at a network of its own choosing.
 *
 * ## It returns before the judgement finishes, on purpose
 *
 * Measured at forty-five seconds to five minutes. The command returns as soon as
 * the attempt is recorded and running; `lib/genlayer/store.ts` holds the stage,
 * and the page reads it on the poll it already runs. A command that awaited the
 * whole thing would hold an IPC promise open across five minutes of somebody's
 * session, and a renderer that reloaded in the middle would lose the only handle
 * on a document that is already public.
 *
 * The rejection handler is therefore load-bearing rather than defensive: nothing
 * is awaiting this promise, so an unhandled rejection here would be a silent
 * stall with a row stuck at whichever stage it reached.
 */

import { adjudicateBrief } from "../lib/genlayer/adjudicate.js";
import { openGenLayerChain } from "../lib/genlayer/client.js";
import { resolveGenLayerConnection } from "../lib/genlayer/connection.js";
import { isBriefArtifact, isDigestArtifact } from "../lib/contracts.js";
import { artifactRecordsForAgent } from "../lib/store.js";

/**
 * Start one judgement.
 *
 * `refusal` is a `PayloadRefusal` when DASH declined to publish, so the page can
 * say which — `lib/copy/genlayer.ts` words all four, and a stale digest and an
 * empty briefing lead somewhere different. It is never a network's own message.
 */
export function startAdjudication(
  agentId: string,
  artifactId: string,
): { ok: boolean; refusal?: string; detail?: string } {
  const records = artifactRecordsForAgent(agentId);
  const record = records.find((entry) => entry.artifact.artifact_id === artifactId);

  if (record === undefined || !isBriefArtifact(record.artifact)) {
    // Said about the record rather than about the person, `exportBriefAsPdf`'s
    // rule: an id that names nothing is a stale link, not somebody's mistake.
    return {
      ok: false,
      refusal: "digest_missing",
      detail: "DASH could not find that briefing. It may have been replaced by a newer run.",
    };
  }

  const brief = record.artifact;
  const digest = records
    .map((entry) => entry.artifact)
    .filter(isDigestArtifact)
    .find(
      (candidate) =>
        candidate.artifact_id === brief.derived_from.artifact_id &&
        candidate.run_id === brief.derived_from.run_id,
    );

  if (digest === undefined) {
    /*
     * Refused before anything is published. The judge is asked whether every
     * claim is supported by the rows the paragraph cites, and DASH cannot ship
     * those rows if it is not holding them — so this is a refusal rather than a
     * judgement of a briefing with no evidence attached.
     */
    return {
      ok: false,
      refusal: "digest_missing",
      detail:
        "DASH is not holding the list of items this briefing was written from, so there is " +
        "nothing to judge it against.",
    };
  }

  const connection = resolveGenLayerConnection({});
  if (!connection.ok) {
    // Unreachable while the defaults are the shipped ones, and checked anyway:
    // `resolveGenLayerConnection` is the one place a stored override becomes a
    // usable connection, and a caller that skipped it would be a second place
    // deciding what DASH will talk to.
    return {
      ok: false,
      refusal: connection.refusal,
      detail: "The judging network DASH is set up for is not usable.",
    };
  }

  /*
   * Started and not awaited. See this module's header — and note the catch: no
   * caller is holding this promise, so a rejection escaping here would be an
   * unhandled rejection in main and a row stuck mid-stage with nothing said.
   *
   * `adjudicateBrief` records every stage it reaches and settles the row on
   * every path it takes, so what a catch here handles is a bug in that
   * function rather than any outcome it has a name for.
   */
  void adjudicateBrief(brief, digest, connection.connection, openGenLayerChain, {
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.warn(line),
  }).catch((error: unknown) => {
    console.warn(
      `[dash] a judgement stopped unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  return { ok: true };
}
