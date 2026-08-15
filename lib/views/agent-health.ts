/**
 * The Health stage's verdict document (MAR-645).
 *
 * This module is deliberately pure and safe in the renderer. The disk-reading
 * half lives in `agent-health-build.ts`; this half owns the closed pass/warn/
 * fail vocabulary, the projection of existing connector standings, and the
 * ADR 0015 join against sightings held only for this window.
 */

import type { RunAnalysis } from "../analyze";
import {
  connectorChip,
  type ConnectorStanding,
} from "../connectors";
import {
  describeAgentOnHost,
  type AgentOnHost,
} from "../host-sighting";
import type { SightingLog } from "../host-sightings";
import type { AiKeyConnectionView } from "../ai/connection-view";
import type {
  AgentDeployTarget,
  AgentModelSettingsView,
} from "./types";

/** No cheerful default: an outcome has to be chosen for every line. */
export type AgentHealthOutcome = "pass" | "warn" | "fail";

export type AgentHealthDestination =
  | { kind: "agent_stage"; stage: "overview" | "settings" | "logs"; fragment?: string }
  | { kind: "connections" }
  | { kind: "servers" }
  | { kind: "run"; run_id: string };

export interface AgentHealthLine {
  id: string;
  outcome: AgentHealthOutcome;
  label: string;
  headline: string;
  detail: string;
  /** The stored document(s) this line read, named in visible copy. */
  record: string;
  target: AgentHealthDestination;
}

export interface AgentHealthView {
  manifest: AgentHealthLine;
  connections: AgentHealthLine[];
  model: AgentHealthLine;
  last_run: AgentHealthLine;
}

export interface ManifestHealthInput {
  kind: "current" | "changed" | "template_gap" | "unreadable" | "not_comparable";
  detail: string;
}

export interface ConnectionHealthInput {
  id: string;
  service: string;
  standing: ConnectorStanding;
  detail: string;
  record: string;
}

export interface LastRunHealthInput {
  run_id: string;
  analysis: RunAnalysis | null;
}

/** Manifest freshness, without turning absence into success. */
export function manifestHealth(input: ManifestHealthInput): AgentHealthLine {
  const outcome: AgentHealthOutcome =
    input.kind === "current"
      ? "pass"
      : input.kind === "unreadable"
        ? "fail"
        : "warn";
  const headline =
    input.kind === "current"
      ? "The managed manifest matches the import DASH accepted"
      : input.kind === "changed"
        ? "The managed manifest changed after DASH imported it"
        : input.kind === "template_gap"
          ? "This DASH sample still uses an older template"
          : input.kind === "unreadable"
            ? "DASH cannot read the managed manifest"
            : "DASH has no managed manifest baseline to compare";

  return {
    id: "manifest",
    outcome,
    label: "Manifest freshness",
    headline,
    detail: input.detail,
    record: "agent registration + agent.manifest.json",
    target: { kind: "agent_stage", stage: "settings", fragment: "folder-update" },
  };
}

/**
 * One connector standing becomes one health line. The labels come straight
 * from `connectorChip`; Health does not acquire a second vocabulary.
 */
export function connectionHealth(input: ConnectionHealthInput): AgentHealthLine {
  const chip = connectorChip(input.standing);
  const outcome: AgentHealthOutcome =
    input.standing === "connected"
      ? "pass"
      : input.standing === "not_connected"
        ? "fail"
        : "warn";
  return {
    id: `connection:${input.id}`,
    outcome,
    label: `Connection · ${input.service}`,
    headline: chip.label,
    detail: input.detail,
    record: input.record,
    target: { kind: "connections" },
  };
}

/** A manifest that declares no non-model connection has a checkable answer. */
export function noConnectionsHealth(): AgentHealthLine {
  return {
    id: "connections:none",
    outcome: "pass",
    label: "Connections",
    headline: "No non-model connection is required",
    detail:
      "The imported manifest declares no account or service this agent needs beyond its model setting.",
    record: "imported manifest connection requirements",
    target: { kind: "connections" },
  };
}

/**
 * The one-model-need rule (MAR-624): `models` chooses the provider-key record,
 * and Health reads the liveness observation for that exact connection.
 */
export function modelHealth(
  models: AgentModelSettingsView,
  cards: readonly AiKeyConnectionView[],
): AgentHealthLine {
  const target = { kind: "agent_stage", stage: "settings", fragment: "model-choice" } as const;
  if (!models.can_choose) {
    if (models.reason === "no_model_needed") {
      return {
        id: "model",
        outcome: "pass",
        label: "Model reachability",
        headline: "This plan does not need a model",
        detail: models.detail,
        record: "imported manifest planned route",
        target,
      };
    }
    return {
      id: "model",
      outcome: models.reason === "no_key_held" ? "fail" : "warn",
      label: "Model reachability",
      headline: models.headline,
      detail: models.detail,
      record:
        models.reason === "no_key_held"
          ? "connection_secrets + imported manifest planned route"
          : "imported manifest planned route",
      target,
    };
  }

  const card =
    cards.find(
      (candidate) =>
        candidate.connection_id === models.connection_id && candidate.field_id === models.field_id,
    ) ?? null;
  if (card === null) {
    return {
      id: "model",
      outcome: "warn",
      label: "Model reachability",
      headline: "DASH cannot match the model setting to a key record",
      detail:
        "The model setting exists, but this view received no provider-key record for the same connection. DASH will not guess that another key is equivalent.",
      record: "agent_model_choice + connection_secrets",
      target,
    };
  }

  const outcome: AgentHealthOutcome =
    card.liveness.state === "live"
      ? "pass"
      : card.liveness.state === "key_refused"
        ? "fail"
        : "warn";
  return {
    id: "model",
    outcome,
    label: "Model reachability",
    headline: card.liveness.headline,
    detail: card.liveness.detail,
    record: "connection_secrets + model key check",
    target,
  };
}

/** The run-detail analyzer's verdict, not a second run-status heuristic. */
export function lastRunHealth(input: LastRunHealthInput | null): AgentHealthLine {
  if (input === null) {
    return {
      id: "last-run",
      outcome: "warn",
      label: "Last run verdict",
      headline: "DASH has no run to judge yet",
      detail:
        "No run_events record exists for this agent, so DASH cannot claim its plan and execution agree.",
      record: "run_events + imported manifest planned route",
      target: { kind: "agent_stage", stage: "logs", fragment: "current-runs" },
    };
  }
  if (input.analysis === null) {
    return {
      id: "last-run",
      outcome: "warn",
      label: "Last run verdict",
      headline: "DASH cannot compute the last run's verdict",
      detail:
        "The run record exists, but DASH has no readable imported plan to compare it with. Unknown is not a pass.",
      record: "run_events + imported manifest planned route",
      target: { kind: "run", run_id: input.run_id },
    };
  }

  const { analysis } = input;
  const outcome: AgentHealthOutcome = !analysis.compliant
    ? "fail"
    : analysis.drift.length > 0
      ? "warn"
      : "pass";
  const headline = !analysis.compliant
    ? "The last run broke its safety contract"
    : analysis.drift.length > 0
      ? "The last run was safe, with plan drift"
      : "The last run matched its safety contract and plan";
  const findings =
    analysis.gate_violations.length + analysis.clearance_findings.length + analysis.drift.length;
  return {
    id: "last-run",
    outcome,
    label: "Last run verdict",
    headline,
    detail:
      findings === 0
        ? "The run-detail analyzer found no gate violation, clearance finding or plan drift."
        : `The run-detail analyzer recorded ${String(findings)} ${findings === 1 ? "finding" : "findings"}. Open the run for the exact evidence.`,
    record: "run_events + imported manifest planned route",
    target: { kind: "run", run_id: input.run_id },
  };
}

/**
 * Host lines exist only for deployed agents. A missing sighting is a warning,
 * never a persisted liveness claim; every observed sentence is delegated to
 * ADR 0015's existing formatter so the timestamp cannot be dropped.
 */
export function hostHealthLines(input: {
  agent: string;
  title: string;
  targets: readonly AgentDeployTarget[];
  sightings: SightingLog;
}): AgentHealthLine[] {
  return input.targets.map((target) => {
    const sighting = input.sightings[target.host_id];
    const seen =
      sighting?.agents.find((candidate) => candidate.agent_id === input.agent) ?? null;
    const standing = describeAgentOnHost({
      agent: input.title,
      server: target.label,
      seen,
      sent_on: target.sent_on,
      at: sighting?.at ?? null,
    });
    return {
      id: `host:${target.host_id}`,
      outcome: hostOutcome(standing.standing),
      label: `Host · ${target.label}`,
      headline: standing.chip,
      detail: standing.sentence,
      record: "agent_deploys + this window's host sighting",
      target: { kind: "servers" },
    };
  });
}

function hostOutcome(standing: AgentOnHost): AgentHealthOutcome {
  switch (standing) {
    case "seen_running":
      return "pass";
    case "seen_stopped":
    case "sent_not_seen":
      return "fail";
    case "sent_not_asked":
    case "seen_unsent":
      return "warn";
  }
}

