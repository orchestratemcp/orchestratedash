/**
 * The run-progress panel, drawn (MAR-680).
 *
 * Two claims, and the second is the one that keeps this from becoming the
 * defect it fixes.
 *
 * 1. **It says the three things Henrik could not find out**: which step, whether
 *    it is over, and whether he may leave.
 * 2. **It is not the feed again.** `LiveFeed` sits directly under this panel on
 *    the same stage and carries the timestamped log. This panel carries no clock
 *    time at all — one fact, one home, in the shape `tests/agent-one-home.test.tsx`
 *    holds the stage and the rail to.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RunProgress } from "../app/_components/run-progress";
import { LiveFeed } from "../app/_components/live-feed";
import { AGENT_RUN_PROGRESS_COPY as COPY } from "../lib/copy/agent-page";
import type { RunEvent, RunEventType } from "../lib/contracts";
import { buildAgentFeed } from "../lib/views/agent-feed";
import { buildRunProgress, type RunProgressPlanStep } from "../lib/views/run-progress";

const AGENT = "competitor-scout";
const RUN = "run-now";
const NOW = new Date("2026-08-17T18:36:30.000Z");

const PLAN: RunProgressPlanStep[] = [
  { step: 1, component_id: "public_source_fetch" },
  { step: 2, component_id: "signal_sort" },
  { step: 3, component_id: "digest_curate" },
];

function event(seq: number, type: RunEventType, extra: Partial<RunEvent> = {}): RunEvent {
  return {
    event_version: 1,
    agent: AGENT,
    run_id: RUN,
    seq,
    ts: extra.ts ?? `2026-08-17T18:36:${String(seq).padStart(2, "0")}Z`,
    type,
    ...extra,
  };
}

const WORKING = [
  event(0, "run_started"),
  event(1, "step_started", { component_id: "public_source_fetch" }),
  event(2, "step_completed", { component_id: "public_source_fetch", status: "ok" }),
  event(3, "step_started", { component_id: "signal_sort" }),
];

function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}

function panel(events: readonly RunEvent[], outputHref?: string): string {
  return decode(
    renderToStaticMarkup(
      <RunProgress
        outputHref={outputHref}
        progress={buildRunProgress({ events, now: NOW, plan: PLAN, runs: [] })}
      />,
    ),
  );
}

describe("the run-progress panel", () => {
  it("draws nothing for an agent that has never run", () => {
    // The feed's own empty state is on the same stage and says the same thing.
    // Two panels apologising for one absence is the page MAR-609 was filed on.
    expect(panel([])).toBe("");
  });

  it("says which step is happening, in words as well as in motion", () => {
    const html = panel(WORKING);
    expect(html).toContain("Step 2 of 3");
    expect(html).toContain("Signal sort");
    // The pips are decoration; the state has to be readable without them.
    expect(html).toContain(COPY.step_running);
    expect(html).toContain("working-pips");
    // And the step that has not run yet is on screen, quietly.
    expect(html).toContain("Digest curate");
    expect(html).toContain(COPY.step_todo);
  });

  it("answers whether the page can be left, while it is worth answering", () => {
    expect(panel(WORKING)).toContain(COPY.safe_to_leave);
    expect(panel([...WORKING, event(9, "run_completed")])).not.toContain(COPY.safe_to_leave);
  });

  it("says finished, and points at what the run made", () => {
    const html = panel([...WORKING, event(9, "run_completed")], "/agents/detail?stage=output");
    expect(html).toContain(COPY.phase.finished.headline);
    expect(html).toContain(COPY.open_output);
    expect(html).toContain('href="/agents/detail?stage=output"');
  });

  it("offers no way to the output while the run is still going", () => {
    // There is nothing settled to send anybody to yet.
    expect(panel(WORKING, "/agents/detail?stage=output")).not.toContain(COPY.open_output);
  });

  it("announces the state and not the whole list", () => {
    /*
     * A person who is not looking wants to be told "Finished", once. A live
     * region around the steps would re-announce every row on every five-second
     * poll, which is "nothing moves without saying it did" turned into a
     * machine that will not stop talking.
     */
    const html = panel(WORKING);
    expect(html).toMatch(/aria-live="polite"[^>]*class="run-progress-state/);
    expect(html).not.toMatch(/aria-live[^>]*run-progress-steps/);
  });
});

describe("the panel and the log are not the same fact", () => {
  it("carries no clock time, which is the feed's", () => {
    const html = panel(WORKING);
    // Every telemetry event in this run is stamped 18:36:0x. The feed prints
    // those; this panel must not, or the stage says one thing twice.
    expect(html).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(html).not.toContain("live-feed-clock");
  });

  it("says what the log cannot: the step that has not happened", () => {
    const feed = decode(renderToStaticMarkup(<LiveFeed feed={buildAgentFeed(WORKING)} />));
    // The proof that this panel is worth its space rather than a second log.
    expect(feed).not.toContain("Digest curate");
    expect(panel(WORKING)).toContain("Digest curate");
  });
});
