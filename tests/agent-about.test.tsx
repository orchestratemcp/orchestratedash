/**
 * One fact, one home: the goal and the plan live in About, and nowhere else
 * (MAR-664, MAR-646's rule).
 *
 * Henrik: *"The agent description doesn't need to be in the header. Too much
 * text. Better add an about the agent button. Shows steps and description."*
 * The header used to print the goal as a permanent line under the name. This
 * file is the gate that keeps it from moving back, in
 * `tests/agent-one-home.test.tsx`'s own shape: a claim about what a surface
 * may draw **at most once**, checked against rendered markup and against the
 * source that decides what is mounted.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentCockpitHeader } from "../app/_components/agent-header";
import { describeAgentPlan, type PlannedRouteStepFull } from "../lib/agent-plan";
import type { AgentControlView } from "../lib/views/agent-control";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* Normalised at the read — `a-regex-over-source-is-crlf-blind`'s lesson. */
const headerSource = readFileSync(
  path.join(repoRoot, "app", "_components", "agent-header.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

const AGENT = "competitor-scout";
const GOAL =
  "Watches public sources for what competing agent products ship and for what people praise, " +
  "complain about and ask for, and writes a briefing where every claim links to where it came from.";

/** The real installed scout's plan — see `tests/agent-plan.test.ts` for the source. */
const ROUTE: PlannedRouteStepFull[] = [
  { step: 1, component_id: "public_source_fetch", risk_level: "low", model_tier: "none" },
  { step: 2, component_id: "signal_sort", risk_level: "low", model_tier: "none" },
  {
    step: 3,
    component_id: "digest_curate",
    risk_level: "medium",
    model_tier: "small",
    default_model_level: "cheap",
  },
  {
    step: 4,
    component_id: "deep_dive_synthesis",
    risk_level: "medium",
    model_tier: "standard",
    default_model_level: "standard",
  },
  { step: 5, component_id: "competitor_choice", risk_level: "low", model_tier: "none" },
  { step: 6, component_id: "report_file_write", risk_level: "high", model_tier: "none" },
];

const READY: AgentControlView = {
  status: { label: "Ready", tone: "calm", detail: "Nothing is running." },
  run: { kind: "run_now", task_id: "task-1", observed_at: "2026-08-16T09:00:00Z" },
};

/** `renderToStaticMarkup`'s own entity escaping, undone — `agent-cockpit-render.test.tsx`'s helper. */
function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}

function header(plan: PlannedRouteStepFull[] = ROUTE): string {
  return decode(
    renderToStaticMarkup(
      <AgentCockpitHeader
        agent={AGENT}
        avatar="wizard"
        busy={null}
        canTrigger
        control={READY}
        goal={GOAL}
        hasFolder={false}
        live={null}
        onOpenFolder={() => undefined}
        onRefresh={() => undefined}
        onTriggerRun={() => undefined}
        places={[]}
        plan={describeAgentPlan(plan)}
        stage="overview"
        title="Competitor scout"
      />,
    ),
  );
}

/** The `<details class="cockpit-about">…</details>` block, and nothing outside it. */
function aboutBlock(html: string): string {
  const start = html.indexOf('<details class="cockpit-about">');
  const end = html.indexOf("</details>", start) + "</details>".length;
  expect(start, "the About disclosure must be in the header").toBeGreaterThanOrEqual(0);
  return html.slice(start, end);
}

describe("the header states identity, and About states the plan", () => {
  it("prints the goal exactly once, and only inside About", () => {
    const html = header();
    const about = aboutBlock(html);
    expect(about).toContain(GOAL);

    // Outside the block, the goal must not appear at all — one fact, one home.
    const outside = html.slice(0, html.indexOf(about)) + html.slice(html.indexOf(about) + about.length);
    expect(outside).not.toContain(GOAL);

    // And there is exactly one occurrence in the whole page, not two copies
    // inside About itself.
    expect(html.split(GOAL).length - 1).toBe(1);
  });

  it("closes by default", () => {
    // renderToStaticMarkup never adds the `open` attribute unless the element
    // asked for it — asserted anyway, because a closed `<details>` still keeps
    // its layout boxes and its text, which is exactly what makes "closed" easy
    // to get wrong without anyone noticing on a screenshot.
    const about = aboutBlock(header());
    expect(about.slice(0, about.indexOf(">"))).not.toContain("open");
  });

  it("names every step the plan declares, in order, with its own id as a value", () => {
    const about = aboutBlock(header());
    for (const step of ROUTE) {
      expect(about).toContain(`Step ${String(step.step)}`);
      expect(about).toContain(`<code class="value">${step.component_id}</code>`);
    }
  });

  it("says the fixed steps use no model and the two AI steps their declared level", () => {
    const about = aboutBlock(header());
    expect(about).toContain("This step does not use a language model.");
    expect(about).toContain("Declared level: Small and cheap.");
    expect(about).toContain("Declared level: Balanced.");
  });

  it("states ADR 0011's boundary once, not once per step", () => {
    const about = aboutBlock(header());
    const boundary = "there is no per-step model picker";
    expect(about.split(boundary).length - 1).toBe(1);
  });

  it("says so, rather than nothing, for an agent whose plan declares no steps", () => {
    const about = aboutBlock(header([]));
    expect(about).toContain("This agent's plan does not declare any steps.");
  });

  it("is a disclosure of facts and never a control — nothing in it has a press", () => {
    // ADR 0008's rule, held to here on purpose though this is not the
    // author's declared panel: a read-only region should not grow a button
    // by habit just because the surrounding page has plenty of them.
    const about = aboutBlock(header());
    expect(about).not.toMatch(/<button|<select|<input|<form/);
  });
});

describe("the header source mounts the goal in exactly one place", () => {
  it("interpolates {goal} exactly once, inside the About panel", () => {
    const uses = [...headerSource.matchAll(/\{goal\}/g)];
    expect(uses).toHaveLength(1);

    const aboutStart = headerSource.indexOf('<details className="cockpit-about">');
    const aboutEnd = headerSource.indexOf("</details>", aboutStart);
    expect(aboutStart).toBeGreaterThanOrEqual(0);
    const at = uses[0]!.index ?? -1;
    expect(at).toBeGreaterThan(aboutStart);
    expect(at).toBeLessThan(aboutEnd);
  });

  it("no longer prints the goal as a standing line under the name", () => {
    expect(headerSource).not.toContain("cockpit-goal");
    expect(headerSource).not.toContain("lede cockpit-goal");
  });
});
