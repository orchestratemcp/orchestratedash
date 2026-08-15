"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  hostHealthLines,
  type AgentHealthDestination,
  type AgentHealthLine,
  type AgentHealthOutcome,
  type AgentHealthView,
} from "../../lib/views/agent-health";
import type { AgentDeployTarget } from "../../lib/views/types";
import { agentStageHref, runDetailHref } from "../_data/routes";
import { useSightings } from "../_data/sightings";

/**
 * One press, one list of the records that answer whether this agent can work
 * (MAR-645). No effect and no fetch: the workspace view already holds every
 * durable line, and ADR 0015's host observations are joined from this window.
 */
export function AgentHealth({
  agent,
  health,
  targets,
  title,
}: {
  agent: string;
  health: AgentHealthView;
  targets: readonly AgentDeployTarget[];
  title: string;
}): ReactNode {
  const sightings = useSightings();
  const lines = [
    health.manifest,
    ...health.connections,
    health.model,
    ...hostHealthLines({ agent, title, targets, sightings }),
    health.last_run,
  ];
  const counts = countOutcomes(lines);

  return (
    <section className="agent-health" aria-labelledby="agent-health-heading">
      <div className="section-heading health-heading">
        <div>
          <p className="eyebrow">Stored records only</p>
          <h2 id="agent-health-heading">Health check</h2>
        </div>
        <p className="health-summary" aria-label={summary(counts)}>
          <OutcomeCount outcome="pass" count={counts.pass} />
          <OutcomeCount outcome="warn" count={counts.warn} />
          <OutcomeCount outcome="fail" count={counts.fail} />
        </p>
      </div>

      <p className="muted wrap">
        DASH read the records below. It did not contact a provider or server, and an
        unperformed check is shown as a warning rather than a pass.
      </p>

      <ol className="health-list">
        {lines.map((line) => (
          <HealthLine agent={agent} key={line.id} line={line} />
        ))}
      </ol>
    </section>
  );
}

function HealthLine({ agent, line }: { agent: string; line: AgentHealthLine }): ReactNode {
  return (
    <li className={`health-line is-${line.outcome}`}>
      <span className={`chip ${chipClass(line.outcome)}`}>{line.outcome}</span>
      <div className="health-line-body">
        <p className="eyebrow">{line.label}</p>
        <h3>{line.headline}</h3>
        <p className="wrap">{line.detail}</p>
        <p className="health-record">
          Record read: <Link href={healthHref(agent, line.target)}>{line.record}</Link>
        </p>
      </div>
    </li>
  );
}

function OutcomeCount({
  count,
  outcome,
}: {
  count: number;
  outcome: AgentHealthOutcome;
}): ReactNode {
  return (
    <span className={`chip ${chipClass(outcome)}`}>
      {String(count)} {outcome}
    </span>
  );
}

function chipClass(outcome: AgentHealthOutcome): "chip-ok" | "chip-warn" | "chip-err" {
  switch (outcome) {
    case "pass":
      return "chip-ok";
    case "warn":
      return "chip-warn";
    case "fail":
      return "chip-err";
  }
}

function countOutcomes(lines: readonly AgentHealthLine[]): Record<AgentHealthOutcome, number> {
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const line of lines) counts[line.outcome] += 1;
  return counts;
}

function summary(counts: Record<AgentHealthOutcome, number>): string {
  return `${String(counts.pass)} pass, ${String(counts.warn)} warn, ${String(counts.fail)} fail`;
}

function healthHref(agent: string, target: AgentHealthDestination): string {
  switch (target.kind) {
    case "agent_stage": {
      const href = agentStageHref(agent, target.stage);
      return target.fragment === undefined ? href : `${href}#${target.fragment}`;
    }
    case "connections":
      return "/settings";
    case "servers":
      return "/settings/servers";
    case "run":
      return runDetailHref(agent, target.run_id);
  }
}
