import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentHealth } from "../app/_components/agent-health";
import {
  connectionHealth,
  lastRunHealth,
  manifestHealth,
  modelHealth,
  type AgentHealthView,
} from "../lib/views/agent-health";

const HEALTH: AgentHealthView = {
  manifest: manifestHealth({ kind: "current", detail: "The accepted digest matches." }),
  connections: [
    connectionHealth({
      id: "gmail",
      service: "Gmail",
      standing: "not_connected",
      detail: "The required grant has not been issued.",
      record: "agent_dom.connection_requirements + broker grant receipt",
    }),
  ],
  model: modelHealth(
    {
      can_choose: false,
      reason: "no_model_needed",
      headline: "This plan does not need a model",
      detail: "The imported route has no model step.",
      next_action: null,
      steps: [],
    },
    [],
  ),
  last_run: lastRunHealth(null),
};

describe("the agent Health stage", () => {
  it("draws one named, linked record for every verdict line", () => {
    const html = renderToStaticMarkup(
      <AgentHealth agent="briefing-agent" health={HEALTH} targets={[]} title="Briefing agent" />,
    );
    expect(html.match(/Record read:/g)).toHaveLength(4);
    expect(html).toContain("agent registration + agent.manifest.json");
    expect(html).toContain("broker grant receipt");
    expect(html).toContain("imported manifest planned route");
    expect(html).toContain("run_events + imported manifest planned route");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("stage=settings#folder-update");
    expect(html).toContain("stage=logs#current-runs");
  });

  it("states that opening the stage does not contact a provider or server", () => {
    const html = renderToStaticMarkup(
      <AgentHealth agent="briefing-agent" health={HEALTH} targets={[]} title="Briefing agent" />,
    );
    expect(html).toContain("It did not contact a provider or server");
    expect(html).toContain("unperformed check is shown as a warning rather than a pass");
  });
});
