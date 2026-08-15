/**
 * The rail's filter over the fleet (MAR-640).
 *
 * `tests/fleet-view.test.ts`'s own shape: the setting and its pure functions
 * here, the pre-paint script's link to the layout here too since this module
 * has no stylesheet half to test separately from — filtering removes cards
 * from the document rather than repositioning them, so there is no
 * `[data-fleet-filter]` rule in `app/globals.css` the way there is a
 * `[data-fleet-view]` one.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_FLEET_FILTER,
  FLEET_FILTERS,
  FLEET_FILTER_ATTRIBUTE,
  FLEET_FILTER_STORAGE_KEY,
  describeFleetFilter,
  fleetFilterCounts,
  matchesFleetFilter,
  parseFleetFilter,
  type FleetFilter,
} from "../lib/views/fleet-filter";
import { DENSITY_ATTRIBUTE, DENSITY_STORAGE_KEY } from "../lib/views/density";
import { FLEET_STRIP_ATTRIBUTE, FLEET_STRIP_STORAGE_KEY } from "../lib/views/fleet-strip";
import { FLEET_VIEW_ATTRIBUTE, FLEET_VIEW_STORAGE_KEY } from "../lib/views/fleet-view";
import { GLANCE_ALL_CLEAR, type GlanceChip } from "../lib/copy/glance";
import type { AgentRow } from "../lib/views/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const railSource = readFileSync(path.join(repoRoot, "app", "_components", "fleet-rail.tsx"), "utf8");
const layoutSource = readFileSync(path.join(repoRoot, "app", "layout.tsx"), "utf8");

function agent(over: Partial<AgentRow> & { glance?: GlanceChip[] } = {}): AgentRow {
  return {
    name: "news-scout",
    title: "News Scout",
    goal: "Read the news.",
    plan_source: "OrchestrateKit",
    build_target: "local",
    planned_steps: 1,
    automation_clearance: "ask first",
    run_count: 0,
    last_run_at: null,
    origin: { kind: "sample", detail: null },
    compliance: { runs: 0, clean: 0, verdict: "clean", label: "0/0 clean", tone: "muted" },
    avatar: "ninja",
    deploy: { deployable: true, refusal: null, travel: { stranded: [], stranded_sentence: null } },
    glance: [GLANCE_ALL_CLEAR],
    running: false,
    hosted_on: [],
    favourite: false,
    ...over,
  } as AgentRow;
}

const NEEDS_YOU: GlanceChip = { question: "needs_you", label: "needs you", meaning: "test", tone: "warn" };
const NEW_OUTPUT: GlanceChip = { question: "new_output", label: "new", meaning: "test", tone: "accent" };

describe("the setting", () => {
  it("has exactly Henrik's six options, in order", () => {
    expect(FLEET_FILTERS).toEqual(["all", "needs_action", "running", "ready", "not_run", "favourites"]);
  });

  it("defaults to all — a filter's first act must not hide anybody's fleet", () => {
    expect(DEFAULT_FLEET_FILTER).toBe("all");
  });

  it("refuses a stored value that is not one of ours, falling back to all rather than to a filter that hides", () => {
    expect(parseFleetFilter("archived")).toBe("all");
    expect(parseFleetFilter("")).toBe("all");
    expect(parseFleetFilter(null)).toBe("all");
    expect(parseFleetFilter(undefined)).toBe("all");
    expect(parseFleetFilter(3)).toBe("all");
  });

  it("reads back every value it can write", () => {
    for (const filter of FLEET_FILTERS) {
      expect(parseFleetFilter(filter)).toBe(filter);
    }
  });

  it("does not collide with the settings already in storage", () => {
    const keys = [DENSITY_STORAGE_KEY, FLEET_STRIP_STORAGE_KEY, FLEET_VIEW_STORAGE_KEY, FLEET_FILTER_STORAGE_KEY];
    expect(new Set(keys).size).toBe(keys.length);

    const attributes = [DENSITY_ATTRIBUTE, FLEET_STRIP_ATTRIBUTE, FLEET_VIEW_ATTRIBUTE, FLEET_FILTER_ATTRIBUTE];
    expect(new Set(attributes).size).toBe(attributes.length);
  });

  it("gives every option a one-word label", () => {
    for (const filter of FLEET_FILTERS) {
      expect(describeFleetFilter(filter).length).toBeGreaterThan(0);
    }
    const labels = FLEET_FILTERS.map(describeFleetFilter);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("matching one agent", () => {
  it("all matches everybody", () => {
    expect(matchesFleetFilter("all", agent())).toBe(true);
    expect(matchesFleetFilter("all", agent({ favourite: true }))).toBe(true);
  });

  it("favourites reads the reader's own flag and nothing else", () => {
    expect(matchesFleetFilter("favourites", agent({ favourite: true }))).toBe(true);
    expect(matchesFleetFilter("favourites", agent({ favourite: false }))).toBe(false);
  });

  it("needs_action, running, ready and not_run read the same one status every portrait is tinted by", () => {
    expect(matchesFleetFilter("needs_action", agent({ glance: [NEEDS_YOU] }))).toBe(true);
    expect(matchesFleetFilter("running", agent({ running: true }))).toBe(true);
    expect(matchesFleetFilter("ready", agent({ glance: [NEW_OUTPUT] }))).toBe(true);
    expect(matchesFleetFilter("not_run", agent({ run_count: 0, running: false }))).toBe(true);
    expect(matchesFleetFilter("not_run", agent({ run_count: 3 }))).toBe(false);
  });

  it("an agent matches at most one of the four status filters", () => {
    const cases: Array<{ label: string; agent: AgentRow }> = [
      { label: "needs input", agent: agent({ glance: [NEEDS_YOU] }) },
      { label: "working", agent: agent({ running: true }) },
      { label: "ready for review", agent: agent({ glance: [NEW_OUTPUT] }) },
      { label: "never run", agent: agent() },
    ];
    const statusFilters: FleetFilter[] = ["needs_action", "running", "ready", "not_run"];
    for (const { label, agent: row } of cases) {
      const matched = statusFilters.filter((filter) => matchesFleetFilter(filter, row));
      expect(matched.length, `${label} matched ${JSON.stringify(matched)}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("counts over the whole fleet", () => {
  it("counts render even when nothing is starred or waiting", () => {
    const counts = fleetFilterCounts([agent(), agent({ name: "second" })]);
    expect(counts).toEqual({ all: 2, needs_action: 0, running: 0, ready: 0, not_run: 2, favourites: 0 });
  });

  it("counts the whole fleet regardless of any filter in force — there is no filtered input to this function", () => {
    const fleet = [
      agent({ name: "a", glance: [NEEDS_YOU] }),
      agent({ name: "b", running: true }),
      agent({ name: "c", favourite: true, run_count: 1 }),
    ];
    const counts = fleetFilterCounts(fleet);
    expect(counts.all).toBe(3);
    expect(counts.needs_action).toBe(1);
    expect(counts.running).toBe(1);
    expect(counts.favourites).toBe(1);
    // "c" ran once and nothing is waiting on it, so it is neither ready nor not_run.
    expect(counts.ready).toBe(0);
    expect(counts.not_run).toBe(0);
  });
});

describe("the pre-paint script", () => {
  it("is rendered by the layout, beside the other three", () => {
    expect(layoutSource).toContain("<FleetFilterScript />");
  });

  it("compares the stored value against literals and never writes it through", () => {
    const script = /const script = \[([\s\S]*?)\]\.join\(""\);/.exec(railSource);
    expect(script).not.toBeNull();
    const body = script?.[1] ?? "";
    // The default writes nothing, so a hand-edited "all" must not reach setAttribute either.
    expect(body).toContain('v!=="all"');
    // Driven by the constant rather than a second, hand-copied list of the
    // six names — the same drift `describeFleetView`'s own list would risk.
    expect(body).toContain("FLEET_FILTERS");
  });
});
