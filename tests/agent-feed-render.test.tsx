/**
 * The live feed and telemetry panel, rendered (MAR-635).
 *
 * The view tests prove the numbers. This proves the renderer does not put a
 * raw event type on screen, does not draw a panel of zeros, and still uses
 * the shared output-history wrapper for generated assets — the two-renderers
 * trap MAR-622 named.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentTelemetry } from "../app/_components/agent-telemetry";
import { LiveFeed } from "../app/_components/live-feed";
import { OutputsPanel } from "../app/_components/outputs";
import { AGENT_FEED_COPY, AGENT_OUTPUTS_COPY } from "../lib/copy/agent-page";
import { buildAgentFeed, buildAgentTelemetry } from "../lib/views/agent-feed";
import { buildArtifactCards } from "../lib/views/artifacts";
import type { RunEvent } from "../lib/contracts";
import type { DigestArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";
import { expectPlainLanguage } from "./helpers/plain-language";

function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const started: RunEvent = {
  event_version: 1,
  agent: "ai-agent-news",
  run_id: "run-mar635",
  seq: 0,
  ts: "2026-08-13T09:15:00Z",
  type: "run_started",
};

const drafted: RunEvent = {
  event_version: 1,
  agent: "ai-agent-news",
  run_id: "run-mar635",
  seq: 1,
  ts: "2026-08-13T09:15:12Z",
  type: "step_completed",
  component_id: "email_draft",
  status: "ok",
  tokens_in: 1420,
  tokens_out: 310,
  cost_usd: 0.0041,
  detail: "draft created for lead acme.com",
};

describe("the live feed, rendered", () => {
  it("sizes the empty agent as two short sentences, not a fake terminal", () => {
    const html = decode(renderToStaticMarkup(<LiveFeed feed={buildAgentFeed([])} />));
    expect(html).toContain(AGENT_FEED_COPY.empty_headline);
    expect(html).toContain(AGENT_FEED_COPY.empty_detail);
    expect(html).not.toContain("step_started");
    expect(html).not.toContain("cursor");
    expectPlainLanguage([AGENT_FEED_COPY.empty_headline, AGENT_FEED_COPY.empty_detail]);
  });

  it("prints the worded step and never the event type", () => {
    const html = decode(
      renderToStaticMarkup(
        <LiveFeed feed={buildAgentFeed([started, drafted])} runHref="/runs/detail?agent=ai-agent-news&run=run-mar635" />,
      ),
    );
    expect(html).toContain("Finished Email draft");
    expect(html).toContain("draft created for lead acme.com");
    expect(html).toContain(AGENT_FEED_COPY.open_run);
    expect(html).not.toContain("step_completed");
    expect(html).not.toContain("run_started");
  });
});

describe("the telemetry panel, rendered", () => {
  it("draws nothing when no number was recorded", () => {
    const html = renderToStaticMarkup(
      <AgentTelemetry telemetry={buildAgentTelemetry([])} />,
    );
    expect(html).toBe("");
  });

  it("draws recorded meters and not a zero for a missing field", () => {
    const html = decode(
      renderToStaticMarkup(
        <AgentTelemetry telemetry={buildAgentTelemetry([started, drafted])} />,
      ),
    );
    expect(html).toContain("1,420");
    expect(html).toContain("310");
    expect(html).toContain("$0.0041");
    expect(html).toContain("not something DASH watched");
    expect(html).not.toMatch(/\$0\.00(?!\d)/);
  });
});

describe("generated assets still share the history wrapper", () => {
  it("keeps OutputHistory in the agent-page renderer", () => {
    const digest: DigestArtifact = {
      artifact_version: 1,
      kind: "digest",
      agent: "ai-agent-news",
      run_id: "run-a",
      artifact_id: "digest-a",
      title: "Tuesday digest",
      generated_at: "2026-08-13T09:15:00.000Z",
      sources_fetched: [],
      items: [],
    };
    const older: DigestArtifact = {
      ...digest,
      run_id: "run-b",
      artifact_id: "digest-b",
      title: "Monday digest",
      generated_at: "2026-08-12T09:15:00.000Z",
    };
    const records: RunArtifactRecord[] = [
      { artifact: digest, received_at: "2026-08-13T09:15:08.000Z", stored_bytes: 1200 },
      { artifact: older, received_at: "2026-08-12T09:15:08.000Z", stored_bytes: 1100 },
    ];
    const html = decode(
      renderToStaticMarkup(
        <OutputsPanel
          cards={buildArtifactCards(records)}
          grounding={null}
          heading={AGENT_OUTPUTS_COPY.heading}
          history
        />,
      ),
    );
    expect(html).toContain(AGENT_OUTPUTS_COPY.heading);
    expect(html).toContain("output-history-entry");
    expect(html).toContain("Tuesday digest");
    expect(html).toContain("Monday digest");
  });
});
