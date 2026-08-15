/**
 * Disk-backed construction of the Health stage (MAR-645).
 *
 * No probe lives here. Every read is a row, a managed file, or a stored
 * observation made by an earlier attended check. The result crosses the normal
 * workspace view boundary and the renderer only draws it.
 */

import { aiKeyConnections } from "../ai/connection-view";
import { readAgentFolderManifest } from "../agent-folders";
import { resolveRequirements } from "../connection-requirements";
import { resolveConnectionRequirements } from "../connection-spec";
import type { ConnectionSourceManifest } from "../connections";
import type { ConnectorStanding } from "../connectors";
import { dataDir } from "../db";
import { analysisForRun } from "../insights";
import { manifestDigest, readRegistration } from "../registration";
import { listRuns, type StoreShape } from "../store";
import type { ManifestGapView } from "../sample-refresh";
import {
  connectionHealth,
  lastRunHealth,
  manifestHealth,
  modelHealth,
  noConnectionsHealth,
  type AgentHealthView,
  type ConnectionHealthInput,
  type ManifestHealthInput,
} from "./agent-health";
import type {
  AgentModelSettingsView,
  ConnectionRowWithCredential,
} from "./types";

export function buildAgentHealth(input: {
  agent: string;
  manifest: ConnectionSourceManifest;
  manifest_gap: ManifestGapView | null;
  models: AgentModelSettingsView;
  rows: readonly ConnectionRowWithCredential[];
  store: StoreShape;
}): AgentHealthView {
  const runs = listRuns(input.store).filter((run) => run.agent === input.agent);
  const latest = runs[0] ?? null;
  const connections = connectionInputs(input.agent, input.manifest, input.rows);

  return {
    manifest: manifestHealth(manifestInput(input.agent, input.manifest_gap)),
    connections:
      connections.length === 0
        ? [noConnectionsHealth()]
        : connections.map(connectionHealth),
    model: modelHealth(input.models, aiKeyConnections(input.agent, input.manifest)),
    last_run: lastRunHealth(
      latest === null
        ? null
        : {
            run_id: latest.run_id,
            analysis: analysisForRun(input.agent, latest.run_id, input.store),
          },
    ),
  };
}

function manifestInput(agent: string, gap: ManifestGapView | null): ManifestHealthInput {
  const registration = readRegistration(dataDir, agent);
  const folder = readAgentFolderManifest(dataDir, agent);
  if (registration === null || registration.dash.manifest_sha256 === "") {
    return {
      kind: "not_comparable",
      detail:
        "This imported row has no managed registration digest, so DASH cannot compare a folder copy with the bytes it accepted.",
    };
  }
  if (!folder.ok) {
    return {
      kind: "unreadable",
      detail: `The registration has an accepted manifest digest, but the managed file is ${folder.problem.replaceAll("_", " ")}.`,
    };
  }
  if (manifestDigest(folder.json) !== registration.dash.manifest_sha256) {
    return {
      kind: "changed",
      detail:
        "The bytes in agent.manifest.json no longer match the digest recorded when DASH imported this agent. Adopt or restore the folder before treating its changes as active.",
    };
  }
  if (gap !== null) {
    return {
      kind: "template_gap",
      detail: gap.card.meaning,
    };
  }
  return {
    kind: "current",
    detail:
      "The managed file's digest matches the registration DASH accepted, and DASH has no recorded sample-template gap for it.",
  };
}

/**
 * Required v1 declarations win. Older agents fall back to their declared
 * connection rows. Provider-key rows are excluded in both paths because the
 * model line owns that one need (MAR-624).
 */
function connectionInputs(
  agent: string,
  manifest: ConnectionSourceManifest,
  rows: readonly ConnectionRowWithCredential[],
): ConnectionHealthInput[] {
  const resolution = resolveConnectionRequirements(manifest);
  if (resolution.kind === "v1") {
    return resolveRequirements(
      resolution.requirements.filter((requirement) => {
        if (requirement.optional === true) return false;
        const row = rows.find((candidate) => candidate.connection_id === requirement.connection_id);
        return row?.credential_kind !== "provider_key";
      }),
      agent,
      rows,
    ).map((requirement) => ({
      id: requirement.id,
      service: requirement.name,
      standing: requirementStanding(requirement.standing),
      detail:
        requirement.disagreements.length > 0
          ? "The requirement and its connection record disagree. Re-export the agent; another sign-in cannot repair this."
          : requirement.why ?? "This required connection is declared by the imported manifest.",
      record: "agent_dom.connection_requirements + broker grant receipt",
    }));
  }

  return rows
    .filter(
      (row) => row.source === "declared_connection" && row.credential_kind !== "provider_key",
    )
    .map((row) => ({
      id: row.connection_id,
      service: row.service,
      standing: rowStanding(row),
      detail: row.purpose,
      record: "imported manifest connection + connection_secrets",
    }));
}

function requirementStanding(
  standing: "allowed" | "awaiting_you" | "not_issued" | "not_asked_for",
): ConnectorStanding {
  switch (standing) {
    case "allowed":
      return "connected";
    case "not_issued":
      return "partly_connected";
    case "awaiting_you":
    case "not_asked_for":
      return "not_connected";
  }
}

function rowStanding(row: ConnectionRowWithCredential): ConnectorStanding {
  if (!row.dash_can_hold) return "not_dash_held";
  return row.masked_hint === null ? "not_connected" : "connected";
}
