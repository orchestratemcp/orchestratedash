/**
 * The agent page's live feed and performance numbers (MAR-635).
 *
 * Pure. The page cannot import the store, and a test that had to mount a
 * workspace to check that an unrecorded meter is absent would be a test
 * nobody writes for the fifth field. Both projections read the same events
 * the run detail page already holds — telemetry v1, per step — and word
 * them here rather than in the renderer.
 *
 * ## What is selected
 *
 * A running run, if one is in flight; otherwise the latest run by start
 * time. The feed follows what the agent is doing *now*, and when it is
 * doing nothing it shows the last thing it did. An agent that has never
 * posted an event gets the empty arm, which is the state every new user
 * meets.
 *
 * ## MAR-547, applied to numbers
 *
 * A meter whose field never appeared is omitted. Summing missing `cost_usd`
 * into `$0.00` would claim the run was free; drawing a latency bar from one
 * timestamp would invent an end. The panel draws nothing at all when every
 * meter is absent, which is also the empty-agent size.
 */

import type { RunEvent, RunEventType } from "../contracts";
import { humanizeAgentName } from "../copy/agent-name";
import {
  AGENT_FEED_COPY,
  AGENT_TELEMETRY_COPY,
  describeFeedDuration,
} from "../copy/agent-page";
import { describeAmount } from "../copy/ask";
import { plainClock } from "../copy/when";

export type AgentFeedLineTone = "ok" | "error" | "live" | "wait" | "neutral";

export interface AgentFeedLine {
  seq: number;
  /** Already worded. Null when the event's timestamp cannot be read. */
  clock: string | null;
  verb: string;
  detail: string | null;
  tone: AgentFeedLineTone;
}

export type AgentFeedView =
  | { kind: "empty" }
  | {
      kind: "live" | "past";
      /**
       * The producing run, for the "open this run" link. Never drawn as a
       * label — it is a value behind a sentence, the same rule MAR-589
       * holds for agent ids.
       */
      run_id: string;
      lines: AgentFeedLine[];
    };

export interface AgentTelemetryMeter {
  label: string;
  value: string;
  /** A model id is a value and wants the monospace face; a duration is not. */
  mono?: boolean;
}

export interface AgentTelemetryBar {
  /** The recorded number, not a normalised height. */
  value: number;
  /** Already worded, for the bar's accessible name. */
  label: string;
}

export interface AgentTelemetryView {
  meters: AgentTelemetryMeter[];
  sparkline: { label: string; bars: AgentTelemetryBar[] } | null;
}

/**
 * Project one agent's events into the live feed.
 *
 * `events` must already be this agent's. The function does not re-check
 * `event.agent`: a caller that mixed two agents would be a bug in the view
 * builder, and silently dropping the foreign ones here would hide it.
 */
export function buildAgentFeed(events: readonly RunEvent[]): AgentFeedView {
  const selected = selectFeedRun(events);
  if (selected === null) {
    return { kind: "empty" };
  }
  const lastSeq = selected.events[selected.events.length - 1]?.seq;
  return {
    kind: selected.live ? "live" : "past",
    run_id: selected.run_id,
    lines: selected.events.map((event) =>
      toFeedLine(event, selected.live && event.seq === lastSeq),
    ),
  };
}

/**
 * Project the same selected run into meters the store can actually back.
 *
 * Empty `meters` and a null sparkline is a valid answer and the common one:
 * most agents have never reported tokens or cost. The renderer treats that
 * as "draw nothing", not "draw zeros".
 */
export function buildAgentTelemetry(events: readonly RunEvent[]): AgentTelemetryView {
  const selected = selectFeedRun(events);
  if (selected === null) {
    return { meters: [], sparkline: null };
  }
  return {
    meters: metersFor(selected.events, selected.live),
    sparkline: sparklineFor(selected.events),
  };
}

interface SelectedRun {
  run_id: string;
  events: RunEvent[];
  live: boolean;
}

function selectFeedRun(events: readonly RunEvent[]): SelectedRun | null {
  const grouped = new Map<string, RunEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.run_id) ?? [];
    bucket.push(event);
    grouped.set(event.run_id, bucket);
  }
  let chosen: SelectedRun | null = null;
  let chosenStarted = "";
  for (const [runId, bucket] of grouped) {
    const ordered = [...bucket].sort((a, b) => a.seq - b.seq);
    const types = new Set(ordered.map((event) => event.type));
    const live = !types.has("run_completed") && !types.has("run_failed");
    const started = ordered.reduce(
      (earliest, event) => (event.ts < earliest ? event.ts : earliest),
      ordered[0]?.ts ?? "",
    );
    const candidate: SelectedRun = { run_id: runId, events: ordered, live };
    if (chosen === null) {
      chosen = candidate;
      chosenStarted = started;
      continue;
    }
    if (candidate.live && !chosen.live) {
      chosen = candidate;
      chosenStarted = started;
      continue;
    }
    if (candidate.live === chosen.live && started > chosenStarted) {
      chosen = candidate;
      chosenStarted = started;
    }
  }
  return chosen;
}

function toFeedLine(event: RunEvent, tailOfLiveRun: boolean): AgentFeedLine {
  const step = namedStep(event.component_id);
  return {
    seq: event.seq,
    clock: plainClock(event.ts),
    verb: verbFor(event.type, step),
    detail: event.detail?.trim() ? event.detail.trim() : null,
    tone: toneFor(event, tailOfLiveRun),
  };
}

function verbFor(type: RunEventType, step: string | null): string {
  switch (type) {
    case "run_started":
      return AGENT_FEED_COPY.verb.run_started;
    case "run_completed":
      return AGENT_FEED_COPY.verb.run_completed;
    case "run_failed":
      return AGENT_FEED_COPY.verb.run_failed;
    case "gate_requested":
      return AGENT_FEED_COPY.verb.gate_requested;
    case "gate_resolved":
      return AGENT_FEED_COPY.verb.gate_resolved;
    case "step_started":
      return step === null ? AGENT_FEED_COPY.verb.run_started : AGENT_FEED_COPY.verb.step_started(step);
    case "step_completed":
      return step === null ? AGENT_FEED_COPY.verb.run_completed : AGENT_FEED_COPY.verb.step_completed(step);
  }
}

function toneFor(event: RunEvent, tailOfLiveRun: boolean): AgentFeedLineTone {
  if (event.type === "run_failed" || event.status === "error") {
    return "error";
  }
  if (event.type === "gate_requested") {
    return "wait";
  }
  if (tailOfLiveRun) {
    return "live";
  }
  if (event.type === "step_completed" && event.status === "ok") {
    return "ok";
  }
  return "neutral";
}

function namedStep(componentId: string | undefined): string | null {
  const raw = componentId?.trim() ?? "";
  if (raw === "") {
    return null;
  }
  return humanizeAgentName(raw);
}

function metersFor(events: readonly RunEvent[], live: boolean): AgentTelemetryMeter[] {
  const meters: AgentTelemetryMeter[] = [];
  const firstTs = events.reduce(
    (earliest, event) => (event.ts < earliest ? event.ts : earliest),
    events[0]?.ts ?? "",
  );
  const lastTs = events.reduce(
    (latest, event) => (event.ts > latest ? event.ts : latest),
    events[0]?.ts ?? "",
  );
  const duration = firstTs === "" || lastTs === "" ? null : describeFeedDuration(firstTs, lastTs);
  if (duration !== null) {
    meters.push({
      label: live ? AGENT_TELEMETRY_COPY.duration_so_far : AGENT_TELEMETRY_COPY.duration,
      value: duration,
    });
  }

  const tokensIn = sumField(events, "tokens_in");
  if (tokensIn !== null) {
    meters.push({
      label: AGENT_TELEMETRY_COPY.tokens_in,
      value: formatCount(tokensIn),
    });
  }
  const tokensOut = sumField(events, "tokens_out");
  if (tokensOut !== null) {
    meters.push({
      label: AGENT_TELEMETRY_COPY.tokens_out,
      value: formatCount(tokensOut),
    });
  }
  const cost = sumField(events, "cost_usd");
  if (cost !== null) {
    meters.push({
      label: AGENT_TELEMETRY_COPY.cost,
      value: describeAmount(cost),
    });
  }

  const models: string[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    const model = event.model?.trim() ?? "";
    if (model === "" || seen.has(model)) {
      continue;
    }
    seen.add(model);
    models.push(model);
  }
  if (models.length === 1 && models[0] !== undefined) {
    meters.push({
      label: AGENT_TELEMETRY_COPY.model,
      value: models[0],
      mono: true,
    });
  }

  return meters;
}

function sparklineFor(events: readonly RunEvent[]): AgentTelemetryView["sparkline"] {
  const written = barsFrom(events, "tokens_out", (value) => `${formatCount(value)} written`);
  if (written !== null) {
    return { label: AGENT_TELEMETRY_COPY.sparkline_written, bars: written };
  }
  const cost = barsFrom(events, "cost_usd", (value) => describeAmount(value));
  if (cost !== null) {
    return { label: AGENT_TELEMETRY_COPY.sparkline_cost, bars: cost };
  }
  return null;
}

function barsFrom(
  events: readonly RunEvent[],
  field: "tokens_out" | "cost_usd",
  label: (value: number) => string,
): AgentTelemetryBar[] | null {
  const bars: AgentTelemetryBar[] = [];
  for (const event of events) {
    if (event.type !== "step_completed") {
      continue;
    }
    const value = event[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      continue;
    }
    bars.push({ value, label: label(value) });
  }
  if (bars.length < 2) {
    return null;
  }
  if (bars.every((bar) => bar.value === 0)) {
    return null;
  }
  return bars;
}

function sumField(
  events: readonly RunEvent[],
  field: "tokens_in" | "tokens_out" | "cost_usd",
): number | null {
  let total = 0;
  let seen = false;
  for (const event of events) {
    const value = event[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      continue;
    }
    seen = true;
    total += value;
  }
  return seen ? total : null;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
