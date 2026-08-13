/**
 * The agent page's live feed and performance meters (MAR-635).
 *
 * The feed is telemetry v1's per-step records, worded. The meters are only
 * the fields those records actually carried. Both claims are cheaper to
 * break in a unit test than in a screenshot: a raw `step_started` on the
 * guided path, or a `$0.00` where nobody posted a cost, would look like a
 * finished command surface in a frame.
 */

import { describe, expect, it } from "vitest";

import type { RunEvent, RunEventType } from "../lib/contracts";
import {
  AGENT_FEED_COPY,
  AGENT_TELEMETRY_COPY,
  describeFeedDuration,
} from "../lib/copy/agent-page";
import { buildAgentFeed, buildAgentTelemetry } from "../lib/views/agent-feed";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "email-lead-to-crm";
const RUN = "run-mar635-demo";
const EARLIER = "run-mar635-older";

function event(
  seq: number,
  type: RunEventType,
  extra: Partial<RunEvent> = {},
): RunEvent {
  return {
    event_version: 1,
    agent: AGENT,
    run_id: extra.run_id ?? RUN,
    seq,
    ts: extra.ts ?? `2026-08-13T09:15:${String(seq).padStart(2, "0")}Z`,
    type,
    ...extra,
  };
}

describe("the live feed", () => {
  it("is empty when this agent has never posted an event", () => {
    expect(buildAgentFeed([])).toEqual({ kind: "empty" });
  });

  it("follows a run still in flight rather than a finished older one", () => {
    const feed = buildAgentFeed([
      event(0, "run_started", { run_id: EARLIER, ts: "2026-08-12T09:00:00Z" }),
      event(1, "run_completed", { run_id: EARLIER, ts: "2026-08-12T09:01:00Z" }),
      event(0, "run_started", { ts: "2026-08-13T09:15:00Z" }),
      event(1, "step_started", {
        component_id: "email_draft",
        ts: "2026-08-13T09:15:01Z",
      }),
    ]);
    expect(feed.kind).toBe("live");
    if (feed.kind === "empty") {
      return;
    }
    expect(feed.run_id).toBe(RUN);
    expect(feed.lines.map((line) => line.verb)).toEqual([
      "Started",
      "Started Email draft",
    ]);
    expect(feed.lines[1]?.tone).toBe("live");
  });

  it("words every telemetry v1 event type and never prints the type itself", () => {
    const types: RunEventType[] = [
      "run_started",
      "step_started",
      "step_completed",
      "gate_requested",
      "gate_resolved",
      "run_completed",
      "run_failed",
    ];
    expect(Object.keys(AGENT_FEED_COPY.verb).sort()).toEqual([...types].sort());

    const feed = buildAgentFeed(
      types.map((type, seq) =>
        event(seq, type, {
          component_id: type.startsWith("step_") ? "email_draft" : undefined,
          detail: type === "step_completed" ? "draft created for lead acme.com" : undefined,
          status: type === "run_failed" ? "error" : "ok",
        }),
      ),
    );
    expect(feed.kind).toBe("past");
    if (feed.kind === "empty") {
      return;
    }
    const said = feed.lines.flatMap((line) => [line.verb, line.detail ?? ""]);
    expectPlainLanguage(said);
    for (const type of types) {
      expect(said.join("\n")).not.toContain(type);
    }
    expect(feed.lines.map((line) => line.verb)).toEqual([
      "Started",
      "Started Email draft",
      "Finished Email draft",
      "Waiting for you",
      "You answered",
      "Finished",
      "Failed",
    ]);
    expect(feed.lines[2]?.detail).toBe("draft created for lead acme.com");
  });

  it("omits a clock rather than echoing a timestamp it cannot read", () => {
    const feed = buildAgentFeed([event(0, "run_started", { ts: "not a date" })]);
    expect(feed.kind).toBe("live");
    if (feed.kind === "empty") {
      return;
    }
    expect(feed.lines[0]?.clock).toBeNull();
    expect(JSON.stringify(feed.lines[0])).not.toContain("not a date");
  });
});

describe("performance meters", () => {
  it("is empty when nothing was recorded, and only duration when timestamps are all it has", () => {
    expect(buildAgentTelemetry([])).toEqual({ meters: [], sparkline: null });
    expect(
      buildAgentTelemetry([
        event(0, "run_started"),
        event(1, "step_started", { component_id: "email_draft" }),
        event(2, "step_completed", { component_id: "email_draft", status: "ok" }),
        event(3, "run_completed"),
      ]),
    ).toEqual({
      meters: [{ label: AGENT_TELEMETRY_COPY.duration, value: "3 seconds" }],
      sparkline: null,
    });
  });

  it("omits a token or cost meter whose field never appeared", () => {
    const telemetry = buildAgentTelemetry([
      event(0, "run_started", { ts: "2026-08-13T09:15:00Z" }),
      event(1, "step_completed", {
        component_id: "email_draft",
        status: "ok",
        tokens_in: 1420,
        ts: "2026-08-13T09:15:12Z",
      }),
      event(2, "run_completed", { ts: "2026-08-13T09:15:14Z" }),
    ]);
    const labels = telemetry.meters.map((meter) => meter.label);
    expect(labels).toContain(AGENT_TELEMETRY_COPY.tokens_in);
    expect(labels).toContain(AGENT_TELEMETRY_COPY.duration);
    expect(labels).not.toContain(AGENT_TELEMETRY_COPY.tokens_out);
    expect(labels).not.toContain(AGENT_TELEMETRY_COPY.cost);
    expect(telemetry.sparkline).toBeNull();
  });

  it("sums recorded cost and tokens, and sparks only a series of two or more", () => {
    const telemetry = buildAgentTelemetry([
      event(0, "run_started", { ts: "2026-08-13T09:15:00Z" }),
      event(1, "step_completed", {
        component_id: "email_read",
        status: "ok",
        tokens_in: 100,
        tokens_out: 10,
        cost_usd: 0.001,
        ts: "2026-08-13T09:15:04Z",
      }),
      event(2, "step_completed", {
        component_id: "email_draft",
        status: "ok",
        model: "anthropic/claude-sonnet-4-6",
        tokens_in: 1420,
        tokens_out: 310,
        cost_usd: 0.0041,
        ts: "2026-08-13T09:15:12Z",
      }),
      event(3, "run_completed", { ts: "2026-08-13T09:15:14Z" }),
    ]);
    const byLabel = Object.fromEntries(
      telemetry.meters.map((meter) => [meter.label, meter.value]),
    );
    expect(byLabel[AGENT_TELEMETRY_COPY.tokens_in]).toBe("1,520");
    expect(byLabel[AGENT_TELEMETRY_COPY.tokens_out]).toBe("320");
    expect(byLabel[AGENT_TELEMETRY_COPY.cost]).toBe("$0.0051");
    expect(byLabel[AGENT_TELEMETRY_COPY.model]).toBe("anthropic/claude-sonnet-4-6");
    expect(telemetry.sparkline?.label).toBe(AGENT_TELEMETRY_COPY.sparkline_written);
    expect(telemetry.sparkline?.bars).toHaveLength(2);
  });

  it("does not treat a missing cost as zero", () => {
    const telemetry = buildAgentTelemetry([
      event(0, "run_started"),
      event(1, "run_completed", { tokens_in: 10 }),
    ]);
    expect(telemetry.meters.map((meter) => meter.label)).not.toContain(
      AGENT_TELEMETRY_COPY.cost,
    );
    expect(telemetry.meters.map((meter) => meter.value).join(" ")).not.toMatch(/\$0/);
  });
});

describe("how long a run took", () => {
  it("is whole seconds from two recorded timestamps, or nothing", () => {
    expect(describeFeedDuration("2026-08-13T09:15:00Z", "2026-08-13T09:15:14Z")).toBe(
      "14 seconds",
    );
    expect(describeFeedDuration("2026-08-13T09:15:00Z", "2026-08-13T09:16:00Z")).toBe(
      "1 minute",
    );
    expect(describeFeedDuration("nonsense", "2026-08-13T09:15:14Z")).toBeNull();
    expect(describeFeedDuration("2026-08-13T09:15:14Z", "2026-08-13T09:15:00Z")).toBeNull();
    expectPlainLanguage([
      describeFeedDuration("2026-08-13T09:15:00Z", "2026-08-13T09:15:01Z") ?? "",
      describeFeedDuration("2026-08-13T09:15:00Z", "2026-08-13T10:16:00Z") ?? "",
    ]);
  });
});
