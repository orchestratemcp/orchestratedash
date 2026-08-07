/**
 * Pulling what an agent did, from whichever runner is holding it (MAR-488).
 *
 * These three drains lived in `electron/agent-adapters.ts` and each opened with
 * `if (runner === null) { return; }`, where `runner` was the *local*
 * `RunnerHandle`. They were not written against a channel — they were hardcoded
 * to the one runner this machine spawned, and generalising them is what MAR-488
 * exists to do.
 *
 * ## The refactor ADR 0007 predicted, done the way it said to do it
 *
 * The audit on MAR-481 named this exact commit before anybody wrote it:
 *
 * > somebody doing this ticket performs the correct-looking refactor —
 * > generalise the drain helpers to take a channel so a remote runner's
 * > telemetry can be pulled the same way — and `/broker/drain` comes along
 * > **because it was in the same loop**. No line of code would say "extend the
 * > broker."
 *
 * `POST /broker/drain` really is a neighbour of `/telemetry/drain` and
 * `/artifacts/drain` in `runner/server.ts`, on the same authenticated channel,
 * answering the same shape. Nothing about the *shape* of these functions would
 * have stopped a fourth one being added beside them.
 *
 * **What stops it is the parameter type.** Every function here takes a
 * `RemoteRunnerChannel`, which is `RunnerChannel<EvidenceRoute>` — and
 * `EvidenceRoute` does not include either brokered route. So
 * `channel.call("/broker/drain")` inside this file is a **compile error**, not a
 * policy somebody must remember, and the fourth drain cannot be written here at
 * all. That is ADR 0006's boundary held by the same standard ADR 0002 amendment
 * 2 applied to `WriteOperation` when it removed `plan` rather than checking its
 * output.
 *
 * The direction that has to keep working does: a `LocalRunnerChannel` is
 * assignable to `RemoteRunnerChannel`, so this one implementation serves the
 * runner on this machine and a runner on a host. Two implementations of "pull
 * what this agent did" is how the two would come to disagree.
 *
 * ## Why `RunnerChannel` and not `ControlChannel`
 *
 * MAR-488's text says "generalise the drain helpers to take a `ControlChannel`".
 * `ControlChannel` (`lib/agent-dom/transport.ts`) is the wrong vehicle and
 * saying so is part of the deliverable: it is **per agent** — it carries
 * `{uri, token, ipc_path}` for one agent's own control route — while these
 * three drains are per *runner*, draining every hosted agent's evidence in one
 * call. More decisively, it carries a URI rather than a route, and a URI is a
 * string types cannot see into: `${uri}/broker/drain` would compile anywhere.
 * `RunnerChannel<Route>` was built by MAR-484 for precisely this, and using it
 * is what makes the exclusion structural instead of conventional.
 *
 * ## What a pull is honest about
 *
 * It returns an `EvidencePull` rather than only logging. The `dropped` counts
 * the runner reports were previously written to a console line and thrown away,
 * which made them invisible to the only surface that should carry them: a Runs
 * page rendering evidence from a **bounded host buffer**, read whenever DASH
 * last happened to be open. See `lib/copy/evidence.ts` for the sentence and
 * `.orchestrate/state.json`'s MAR-488 entry for why a zero here is still not a
 * claim of completeness.
 */

import {
  ingestArtifacts,
  ingestEvents,
  syncWorkspaceArtifacts,
  type IngestResult,
} from "../store";
import type { RemoteRunnerChannel } from "./runner-channel";

/** How long any one drain waits on a runner before giving up. */
const DRAIN_TIMEOUT_MS = 3_000;

/**
 * Where a pull's evidence came from, in the only distinction that changes what
 * DASH can honestly claim about it.
 *
 * `this_machine` is the runner DASH's own installer put here and DASH's own
 * process spawned; nothing about its buffer or its lifetime is outside DASH's
 * sight for long. `another_machine` is a host the *user* administers, which
 * keeps running while DASH is closed and whose files the user may delete before
 * DASH ever looks. The difference is not the transport — it is what the record
 * is a record *of*, so it is a field rather than an inference.
 */
export type EvidenceSourceKind = "this_machine" | "another_machine";

/** One pass over one runner's evidence routes. */
export interface EvidencePull {
  /**
   * Which runner this was. `local` for the one this machine spawned; a host
   * record's id otherwise. Opaque, never rendered — the copy layer speaks about
   * kinds, not ids.
   */
  source: string;
  kind: EvidenceSourceKind;
  /**
   * DASH's own clock at the moment it looked, which is the honest name for it.
   *
   * Not the runner's: `workspace_artifacts.observed_at` is the runner's, and
   * conflating the two would let "when the file was last seen" be read as "when
   * DASH last asked". Both are true and they are different questions.
   */
  observed_at: string;
  /** Whether the runner answered at all. A pull that failed is not an empty one. */
  reached: boolean;
  /** Candidates the runner's bounded buffer destroyed before DASH got there. */
  telemetry_dropped: number;
  artifacts_dropped: number;
  /** The runner's artifact index was longer than the one route returns. */
  workspace_truncated: boolean;
  events_ingested: number;
  artifacts_ingested: number;
}

export interface PullOptions {
  source: string;
  kind: EvidenceSourceKind;
  /** Injected so a test can pin the timestamp rather than match a pattern. */
  now?: () => string;
  log?: (line: string) => void;
}

/**
 * Drain hosted telemetry on the runner's own authenticated channel.
 *
 * The runner only frames and buffers candidates. `ingestEvents` remains the one
 * contract boundary: it validates every item independently and binds each valid
 * event to the supervisor identity carried beside it, so a hosted child cannot
 * publish an event under another agent's name. That is unchanged by this
 * generalisation and is the reason it can be — the provenance check lives in the
 * ingest, not in the transport, so it holds identically for a runner on a host.
 */
async function drainTelemetry(
  channel: RemoteRunnerChannel,
  log: (line: string) => void,
): Promise<{ dropped: number; ingested: number; reached: boolean }> {
  try {
    const response = await channel.call("/telemetry/drain", {
      method: "POST",
      signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { dropped: 0, ingested: 0, reached: false };
    }

    const body = (await response.json()) as { events?: unknown; dropped?: unknown };
    const dropped = typeof body.dropped === "number" && body.dropped > 0 ? body.dropped : 0;
    if (dropped > 0) {
      log(
        `[dash-shell] runner telemetry buffer dropped ${String(dropped)} ` +
          `candidate${dropped === 1 ? "" : "s"} before this poll`,
      );
    }
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return { dropped, ingested: 0, reached: true };
    }

    const batch = envelopes(body.events, "event", log, "telemetry");
    const result = ingestEvents(
      batch.map((candidate) => candidate.payload),
      { sourceAgents: batch.map((candidate) => candidate.agent_id) },
    );
    report(result, log, "runner-hosted telemetry event");
    return { dropped, ingested: result.accepted, reached: true };
  } catch {
    // Delivery is fire-and-forget. A failed drain must not stop the poll loop,
    // and the agent's own events.jsonl remains the primary record.
    return { dropped: 0, ingested: 0, reached: false };
  }
}

/**
 * Drain what hosted agents produced, on the same channel as their telemetry
 * (MAR-457).
 *
 * Separate from `drainTelemetry` for the reason the runner keeps two routes:
 * events and artifacts are validated against different schemas at different
 * boundaries, and `ingestArtifacts` is the one for these.
 *
 * This function is the piece that was missing when the installed smoke first
 * ran: the buffer existed, the ingest existed, the view existed, and nothing
 * connected them. A unit test that called `drainArtifacts()` on the supervisor
 * directly passed the whole time, because the gap was the absence of a caller
 * rather than a fault in anything either side of it.
 */
async function drainArtifacts(
  channel: RemoteRunnerChannel,
  log: (line: string) => void,
): Promise<{ dropped: number; ingested: number; reached: boolean }> {
  try {
    const response = await channel.call("/artifacts/drain", {
      method: "POST",
      signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { dropped: 0, ingested: 0, reached: false };
    }

    const body = (await response.json()) as { artifacts?: unknown; dropped?: unknown };
    const dropped = typeof body.dropped === "number" && body.dropped > 0 ? body.dropped : 0;
    if (dropped > 0) {
      log(
        `[dash-shell] runner artifact buffer dropped ${String(dropped)} ` +
          `candidate${dropped === 1 ? "" : "s"} before this poll`,
      );
    }
    if (!Array.isArray(body.artifacts) || body.artifacts.length === 0) {
      return { dropped, ingested: 0, reached: true };
    }

    const batch = envelopes(body.artifacts, "artifact", log, "artifact");
    const result = ingestArtifacts(
      batch.map((candidate) => candidate.payload),
      { sourceAgents: batch.map((candidate) => candidate.agent_id) },
    );
    report(result, log, "runner-hosted artifact");
    return { dropped, ingested: result.accepted, reached: true };
  } catch {
    // Fire-and-forget, exactly as telemetry is. The digest in the agent's own
    // reports folder remains the primary record, so a failed drain costs a
    // rendering and not the user's data.
    return { dropped: 0, ingested: 0, reached: false };
  }
}

/**
 * Take up the runner's picture of its file-backed artifacts (MAR-434).
 *
 * A GET of the whole index rather than a drain, because availability is a state
 * and not an event — `runner/server.ts` says why at the route. So this runs on
 * every poll and overwrites, and a poll that fails leaves the previous answer in
 * place with its own `observed_at` rather than emptying the panel.
 *
 * The provenance binding is the same one `drainArtifacts` applies and is worth
 * as much: `sourceAgents` comes from the record's own `agent` field here rather
 * than from a transport envelope, because unlike a drained candidate this row
 * was **written by the runner**, not forwarded by it. Re-deriving it from the
 * same field it came from would be a check that cannot fail, so it is not
 * performed and this comment is here instead of one.
 */
async function syncWorkspace(
  channel: RemoteRunnerChannel,
  log: (line: string) => void,
): Promise<{ truncated: boolean; reached: boolean }> {
  try {
    const response = await channel.call("/workspace-artifacts", {
      method: "GET",
      signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS),
    });
    if (!response.ok) {
      // 501 is the ordinary answer from a runner built without a workspace, and
      // is not worth a log line on every poll.
      return { truncated: false, reached: false };
    }

    const body = (await response.json()) as { artifacts?: unknown; truncated?: unknown };
    const truncated = body.truncated === true;
    if (truncated) {
      log(
        "[dash-shell] the runner's artifact index was truncated; the Outputs panel is not " +
          "showing every file this installation has produced",
      );
    }
    if (!Array.isArray(body.artifacts)) {
      return { truncated, reached: true };
    }

    report(syncWorkspaceArtifacts(body.artifacts), log, "runner workspace artifact");
    return { truncated, reached: true };
  } catch {
    // Fire and forget, as the two drains above are. The runner's own index is
    // the record; this is a copy for rendering, and a failed refresh costs a
    // page being five seconds behind.
    return { truncated: false, reached: false };
  }
}

/**
 * One pass over every evidence route a runner answers.
 *
 * The three run in sequence rather than concurrently, deliberately: they write
 * to one SQLite store, and a runner that has stopped answering costs three
 * timeouts either way. Sequential is what the local path already did and what
 * `startPolling`'s self-scheduling timeout is sized against.
 *
 * `reached` is true when **any** of the three answered. A runner that served
 * telemetry and 501'd the workspace route is a runner DASH reached; treating
 * that as unreachable would make the honesty sentence below say DASH never
 * looked, on a poll where it did.
 */
export async function pullEvidence(
  channel: RemoteRunnerChannel,
  options: PullOptions,
): Promise<EvidencePull> {
  const log = options.log ?? ((line: string) => { console.warn(line); });
  const now = options.now ?? (() => new Date().toISOString());

  const telemetry = await drainTelemetry(channel, log);
  const artifacts = await drainArtifacts(channel, log);
  const workspace = await syncWorkspace(channel, log);

  return {
    source: options.source,
    kind: options.kind,
    observed_at: now(),
    reached: telemetry.reached || artifacts.reached || workspace.reached,
    telemetry_dropped: telemetry.dropped,
    artifacts_dropped: artifacts.dropped,
    workspace_truncated: workspace.truncated,
    events_ingested: telemetry.ingested,
    artifacts_ingested: artifacts.ingested,
  };
}

/* ---------------------------------------------------------------------- *
 * Shared shapes
 * ---------------------------------------------------------------------- */

/**
 * Split a drained batch into `{agent_id, payload}`, dropping anything whose
 * provenance the runner did not attach.
 *
 * One helper for both drains because the envelope is the same on both routes
 * and the check is the load-bearing one on each: an item with no `agent_id`
 * beside it is an item nothing can bind to a supervisor, so it is refused here
 * rather than handed to an ingest that would have to invent an owner.
 */
function envelopes(
  candidates: readonly unknown[],
  member: "event" | "artifact",
  log: (line: string) => void,
  what: string,
): Array<{ agent_id: string; payload: unknown }> {
  const batch: Array<{ agent_id: string; payload: unknown }> = [];
  candidates.forEach((candidate, index) => {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      typeof (candidate as { agent_id?: unknown }).agent_id !== "string" ||
      !Object.hasOwn(candidate, member)
    ) {
      log(
        `[dash-shell] rejected runner ${what} envelope at index ${String(index)}: invalid provenance`,
      );
      return;
    }
    const envelope = candidate as { agent_id: string } & Record<string, unknown>;
    batch.push({ agent_id: envelope.agent_id, payload: envelope[member] });
  });
  return batch;
}

/** Say what an ingest refused, at the same volume the local path always did. */
function report(result: IngestResult, log: (line: string) => void, what: string): void {
  for (const rejection of result.rejected) {
    log(
      `[dash-shell] rejected ${what} at index ${String(rejection.index)}: ` +
        rejection.errors.slice(0, 3).join("; "),
    );
  }
}
