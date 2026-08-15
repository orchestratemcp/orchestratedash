import { describe, expect, it } from "vitest";

import type { AiKeyConnectionView } from "../lib/ai/connection-view";
import type { RunAnalysis } from "../lib/analyze";
import { connectorChip, type ConnectorStanding } from "../lib/connectors";
import {
  connectionHealth,
  hostHealthLines,
  lastRunHealth,
  manifestHealth,
  modelHealth,
  noConnectionsHealth,
} from "../lib/views/agent-health";
import type { AgentDeployTarget, AgentModelSettingsView } from "../lib/views/types";

const NO_MODEL: AgentModelSettingsView = {
  can_choose: false,
  reason: "no_model_needed",
  headline: "This plan does not need a model",
  detail: "The imported route declares no model step.",
  next_action: null,
  steps: [],
};

const MODEL: AgentModelSettingsView = {
  can_choose: true,
  provider_id: "openrouter",
  provider_label: "OpenRouter",
  connection_id: "models",
  field_id: "api_key",
  headline: "Choose one model",
  detail: "One model choice is in force for this agent.",
  chosen_model_id: "openai/gpt-5",
  in_force: "OpenAI GPT-5",
  steps: [],
  steps_in_force: false,
  steps_note: "One model overrides step levels.",
};

const TARGET: AgentDeployTarget = {
  host_id: "host-1",
  label: "Production host",
  sent_at: "2026-08-14T10:00:00Z",
  sent_on: "14 August",
  comparable: true,
  behind: false,
};

function card(
  state: "not_checked" | "live" | "key_refused" | "provider_error",
  connectionId = "models",
): AiKeyConnectionView {
  return {
    connection_id: connectionId,
    field_id: "api_key",
    service: "OpenRouter",
    provider_id: "openrouter",
    provider_label: "OpenRouter",
    purpose: "Run model steps",
    key_source: "OpenRouter",
    held: true,
    masked_hint: "…1234",
    liveness: {
      state,
      checked_at: state === "not_checked" ? null : "2026-08-14T10:30:00Z",
      model_count: state === "live" ? 42 : null,
      headline:
        state === "live"
          ? "Key accepted"
          : state === "key_refused"
            ? "Key refused"
            : state === "provider_error"
              ? "Provider did not answer cleanly"
              : "Not checked",
      detail: "This is the stored result of the attended model-key check.",
      next_action: state === "live" ? null : "Check the key.",
    },
    capabilities: [],
    custody_sentence: "DASH holds this key locally.",
    narrowing_sentence: "The agent receives only the provider key it named.",
    connect: { available: false, label: "Connect", reason: null },
    check: { available: true, label: "Check", reason: null },
    disconnect: { available: true, label: "Disconnect", reason: null },
  } as unknown as AiKeyConnectionView;
}

function analysis(overrides: Partial<RunAnalysis> = {}): RunAnalysis {
  return {
    agent: "briefing-agent",
    run_id: "run-1",
    executed_route: ["collect", "write"],
    drift: [],
    gate_violations: [],
    clearance_findings: [],
    compliant: true,
    ...overrides,
  };
}

describe("the agent Health verdict document", () => {
  it("uses the connector page's four standing labels instead of inventing new ones", () => {
    const standings: ConnectorStanding[] = [
      "connected",
      "partly_connected",
      "not_connected",
      "not_dash_held",
    ];

    for (const standing of standings) {
      const line = connectionHealth({
        id: standing,
        service: "Gmail",
        standing,
        detail: "The imported manifest requires Gmail.",
        record: "manifest + grant receipt",
      });
      expect(line.headline).toBe(connectorChip(standing).label);
      expect(line.record).toContain("manifest");
      expect(line.target).toEqual({ kind: "connections" });
    }
  });

  it("never turns a check DASH could not perform into a pass", () => {
    expect(manifestHealth({ kind: "not_comparable", detail: "No digest." }).outcome).toBe("warn");
    expect(modelHealth(MODEL, []).outcome).toBe("warn");
    expect(modelHealth(MODEL, [card("not_checked")]).outcome).toBe("warn");
    expect(lastRunHealth(null).outcome).toBe("warn");
  });

  it("reads the one model need and the liveness row for that exact key", () => {
    expect(modelHealth(NO_MODEL, []).outcome).toBe("pass");
    expect(modelHealth(MODEL, [card("live", "another-key")]).outcome).toBe("warn");
    expect(modelHealth(MODEL, [card("live")]).outcome).toBe("pass");
    expect(modelHealth(MODEL, [card("key_refused")]).outcome).toBe("fail");
    expect(modelHealth(MODEL, [card("provider_error")]).outcome).toBe("warn");
  });

  it("delegates the last-run verdict to the existing analyzer result", () => {
    expect(lastRunHealth({ run_id: "run-1", analysis: analysis() }).outcome).toBe("pass");
    expect(
      lastRunHealth({
        run_id: "run-1",
        analysis: analysis({
          drift: [
            {
              kind: "unplanned_step",
              component_id: "surprise",
              detail: "surprise was not in the imported plan",
            },
          ],
        }),
      }).outcome,
    ).toBe("warn");
    expect(lastRunHealth({ run_id: "run-1", analysis: analysis({ compliant: false }) }).outcome).toBe(
      "fail",
    );
  });

  it("adds no host claim for a local agent and no persisted-live default for a deployment", () => {
    expect(hostHealthLines({ agent: "briefing-agent", title: "Briefing agent", targets: [], sightings: {} })).toEqual([]);

    const unasked = hostHealthLines({
      agent: "briefing-agent",
      title: "Briefing agent",
      targets: [TARGET],
      sightings: {},
    });
    expect(unasked).toHaveLength(1);
    expect(unasked[0]?.outcome).toBe("warn");
    expect(unasked[0]?.headline).toBe("not asked");
    expect(unasked[0]?.detail).toContain("has not asked Production host");
    expect(unasked[0]?.record).toContain("this window's host sighting");
  });

  it("names the sighting moment when this window did observe a deployed agent", () => {
    const [line] = hostHealthLines({
      agent: "briefing-agent",
      title: "Briefing agent",
      targets: [TARGET],
      sightings: {
        "host-1": {
          label: "Production host",
          agents: [{ agent_id: "briefing-agent", running: true }],
          at: "2026-08-14T10:30:00Z",
        },
      },
    });
    expect(line?.outcome).toBe("pass");
    expect(line?.headline).toBe("seen running");
    expect(line?.detail).toContain("when DASH asked on 14 August 2026 at 12:30");
  });

  it("gives every line a named record and a link destination", () => {
    const lines = [
      manifestHealth({ kind: "current", detail: "Digest matches." }),
      noConnectionsHealth(),
      modelHealth(NO_MODEL, []),
      lastRunHealth({ run_id: "run-1", analysis: analysis() }),
    ];
    for (const line of lines) {
      expect(line.record.length).toBeGreaterThan(0);
      expect(line.target.kind.length).toBeGreaterThan(0);
    }
  });
});
