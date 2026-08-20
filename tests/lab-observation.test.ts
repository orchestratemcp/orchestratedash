import { describe, expect, it } from "vitest";

import type { AgentManifestV2 } from "../lib/contracts";
import {
  ABSENT_ROUTE_SCORE,
  ROUTE_SLUG_PREFIX,
  composeObservation,
  observationDay,
  observationKey,
  payloadBody,
  pendingObservations,
  routeSlug,
} from "../lib/lab/observation";

/**
 * What DASH may say to a LAB (MAR-479, ADR 0026).
 *
 * The first block is the one that matters. ADR 0026 decision 2 claims *no
 * character a person typed reaches the wire*, and that claim is only worth
 * having if something checks it against a manifest full of characters a person
 * typed — so `SECRETIVE` below carries three distinctive strings in the three
 * author-authored fields, and the assertion is over the payload **bytes**
 * rather than over named fields. A field added later that leaked the goal would
 * fail this test without anybody having to remember to extend it.
 */

const GOAL = "zzWATCHACMECORPPRICINGzz";
const NAME = "zzACMEINVOICECHASERzz";
const DISPLAY = "zzHENRIKSPRIVATESCOUTzz";

function manifest(overrides: Partial<AgentManifestV2["agent"]> = {}): AgentManifestV2 {
  return {
    manifest_version: 2,
    agent: {
      name: NAME,
      display_name: DISPLAY,
      goal: GOAL,
      plan_source: "composed",
      playbook_id: "",
      route_id: "",
      build_target: "code",
      ...overrides,
    },
    planned_route: [
      { step: 2, component_id: "signal_sort", risk_level: "low", model_tier: "none" },
      { step: 1, component_id: "public_source_fetch", risk_level: "low", model_tier: "none" },
      { step: 3, component_id: "brief_compose", risk_level: "medium", model_tier: "small" },
    ],
    safety_contract: {
      automation_clearance: "L1",
      enforced_approval_gates: [],
      irreversible_components: [],
    },
    monitoring: {},
    provenance: {},
    agent_dom: {},
  };
}

describe("nothing a person wrote crosses the wire", () => {
  it("puts none of the goal, the name or the display name in the payload bytes", () => {
    const observation = composeObservation(manifest(), "2026-08-20");
    expect(observation).not.toBeNull();

    const bytes = payloadBody([observation!]);
    expect(bytes).not.toContain(GOAL);
    expect(bytes).not.toContain(NAME);
    expect(bytes).not.toContain(DISPLAY);
  });

  it("carries the registry's own vocabulary instead", () => {
    const observation = composeObservation(manifest(), "2026-08-20");

    // Step order, not array order: the fixture lists step 2 first on purpose.
    expect(observation?.components).toEqual([
      "public_source_fetch",
      "signal_sort",
      "brief_compose",
    ]);
    expect(observation?.goal_text).toBe("public_source_fetch → signal_sort → brief_compose");
    expect(observation?.route_selected).toBe("composed");
  });

  it("prefixes every slug so a LAB collision is impossible rather than resolved", () => {
    // ADR 0026 decision 8. LAB's corpus slugs are fixture names and its demo
    // fixture is `dash_demo_`-prefixed; neither can be produced here.
    const observation = composeObservation(manifest(), "2026-08-20");
    expect(observation?.goal_slug.startsWith(ROUTE_SLUG_PREFIX)).toBe(true);
    expect(observation?.goal_slug.startsWith("dash_demo_")).toBe(false);
  });
});

describe("the slug is the route", () => {
  it("is stable for the same route and plan source", () => {
    expect(routeSlug("composed", ["a", "b"])).toBe(routeSlug("composed", ["a", "b"]));
  });

  it("changes when the route changes, which is how a route change is expressed", () => {
    // ADR 0026 decision 3: `route_changed` is always false because a changed
    // route is a *new slug*. This is that mechanism.
    expect(routeSlug("composed", ["a", "b"])).not.toBe(routeSlug("composed", ["a", "b", "c"]));
    expect(composeObservation(manifest(), "2026-08-20")?.route_changed).toBe(false);
  });

  it("distinguishes a playbook match from a composed route with the same steps", () => {
    expect(routeSlug("playbook", ["a", "b"])).not.toBe(routeSlug("composed", ["a", "b"]));
  });

  it("cannot be forged by a component id containing the separator", () => {
    // The unit separator is what stops ["ab","c"] and ["a","bc"] digesting the
    // same pre-image. A component id cannot contain one, so this is a guard on
    // the joining rather than on the input.
    expect(routeSlug("composed", ["ab", "c"])).not.toBe(routeSlug("composed", ["a", "bc"]));
  });

  it("carries the playbook id when one matched, because LAB can resolve a score from it", () => {
    const observation = composeObservation(
      manifest({ plan_source: "playbook", playbook_id: "resolve_calendar_conflict" }),
      "2026-08-20",
    );
    expect(observation?.playbook_candidate).toBe("resolve_calendar_conflict");
    expect(observation?.route_selected).toBe("playbook");
  });
});

describe("the fields DASH cannot fill", () => {
  it("sends zero for a score it has never held, and empty contract lists", () => {
    const observation = composeObservation(manifest(), "2026-08-20");
    expect(observation?.route_score).toBe(ABSENT_ROUTE_SCORE);
    expect(observation?.must_have_missing).toEqual([]);
    expect(observation?.forbidden_present).toEqual([]);
  });

  it("refuses a manifest with no route rather than digesting an empty one", () => {
    // Every routeless agent on every install would otherwise share one slug,
    // and LAB would rank a golden-path gap that does not exist.
    const routeless = { ...manifest(), planned_route: [] };
    expect(composeObservation(routeless, "2026-08-20")).toBeNull();
  });
});

describe("the day is UTC, because LAB's window is", () => {
  it("takes the UTC day of the event, not the local one", () => {
    expect(observationDay("2026-08-20T23:30:00Z")).toBe("2026-08-20");
    expect(observationDay("2026-08-21T00:30:00Z")).toBe("2026-08-21");
  });

  it("returns null for a timestamp it cannot read rather than today", () => {
    expect(observationDay("not a date")).toBeNull();
  });
});

describe("a batch is one entry per route per day", () => {
  const store = {
    agents: { [NAME]: { manifest: manifest() } },
    events: [
      { agent: NAME, ts: "2026-08-20T09:00:00Z" },
      { agent: NAME, ts: "2026-08-20T17:00:00Z" },
      { agent: NAME, ts: "2026-08-19T09:00:00Z" },
    ],
  };

  it("collapses several runs on one day into one entry", () => {
    const pending = pendingObservations(store, new Set());
    expect(pending).toHaveLength(2);
    expect(pending.map((o) => o.observed_on)).toEqual(["2026-08-20", "2026-08-19"]);
  });

  it("skips what has already been accepted", () => {
    const first = pendingObservations(store, new Set());
    const sent = new Set([observationKey(first[0]!)]);
    expect(pendingObservations(store, sent).map((o) => o.observed_on)).toEqual(["2026-08-19"]);
  });

  it("skips an event whose agent was never imported", () => {
    // No manifest means no route, and a payload composed from an absent
    // manifest would be a claim about a plan nobody declared.
    const orphaned = { agents: {}, events: store.events };
    expect(pendingObservations(orphaned, new Set())).toEqual([]);
  });

  it("sends nothing at all from an empty store", () => {
    expect(payloadBody(pendingObservations({ agents: {}, events: [] }, new Set()))).toBe("[]");
  });
});
