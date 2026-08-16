/**
 * The plan a person can read before pressing anything (MAR-664).
 *
 * The fixture is the real competitor scout's own `planned_route` — installed
 * on the machine this packet was built on, six steps, and the most complex
 * plan DASH holds. Copied here by value rather than read off disk: this
 * module has no store and this test should not gain one just to prove it.
 *
 * The claims this file exists to hold:
 *
 * 1. **Every step projects, not only the ones that need a model.** `lib/ai/
 *    model-levels.ts`'s `stepsNeedingAModel` answers a narrower question;
 *    this one answers "what will this agent do".
 * 2. **`component_id` never reaches a sentence.** It travels as a labelled
 *    value — the same standing the agent's own id has in the header chip —
 *    and the plain-language sweep is what actually enforces that rather than
 *    a comment promising it.
 * 3. **ADR 0011 is quoted, not re-decided.** DASH shows a step's declared
 *    level truthfully and says, once, that it does not turn that into a
 *    model — never a sentence that could be read as a per-step picker
 *    existing.
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_PLAN_EMPTY_SENTENCE,
  AGENT_PLAN_MODEL_BOUNDARY,
  describeAgentPlan,
  everyAgentPlanSentence,
  type PlannedRouteStepFull,
} from "../lib/agent-plan";
import { expectPlainLanguage } from "./helpers/plain-language";

/** The real installed scout's plan, `agent.manifest.json`'s own `planned_route`. */
const COMPETITOR_SCOUT_ROUTE: PlannedRouteStepFull[] = [
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

describe("reading the real scout's plan", () => {
  it("projects all six steps, in order, none of them dropped", () => {
    const steps = describeAgentPlan(COMPETITOR_SCOUT_ROUTE);
    expect(steps.map((step) => step.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps.map((step) => step.component_id)).toEqual([
      "public_source_fetch",
      "signal_sort",
      "digest_curate",
      "deep_dive_synthesis",
      "competitor_choice",
      "report_file_write",
    ]);
  });

  it("says the four fixed steps use no model, truthfully", () => {
    const steps = describeAgentPlan(COMPETITOR_SCOUT_ROUTE);
    for (const id of ["public_source_fetch", "signal_sort", "competitor_choice", "report_file_write"]) {
      const step = steps.find((entry) => entry.component_id === id);
      expect(step?.model.kind, id).toBe("no_model");
    }
  });

  it("reads the two AI steps' declared levels, and only those two", () => {
    const steps = describeAgentPlan(COMPETITOR_SCOUT_ROUTE);
    const curate = steps.find((entry) => entry.component_id === "digest_curate");
    const synthesis = steps.find((entry) => entry.component_id === "deep_dive_synthesis");
    expect(curate?.model).toMatchObject({ kind: "declared", level: "cheap" });
    expect(synthesis?.model).toMatchObject({ kind: "declared", level: "standard" });

    const declaredCount = steps.filter((entry) => entry.model.kind === "declared").length;
    expect(declaredCount).toBe(2);
  });

  it("reads the highest-risk step's own declared risk, the file-write gate", () => {
    const steps = describeAgentPlan(COMPETITOR_SCOUT_ROUTE);
    const write = steps.find((entry) => entry.component_id === "report_file_write");
    expect(write).toMatchObject({ risk_level: "high", risk_tone: "err" });
  });
});

describe("the reader's own rules", () => {
  it("returns steps in step order, whatever order the route was written in", () => {
    const jumbled = [COMPETITOR_SCOUT_ROUTE[5]!, COMPETITOR_SCOUT_ROUTE[0]!, COMPETITOR_SCOUT_ROUTE[2]!];
    expect(describeAgentPlan(jumbled).map((entry) => entry.step)).toEqual([1, 3, 6]);
  });

  it("says an empty plan declares nothing, rather than throwing", () => {
    expect(describeAgentPlan([])).toEqual([]);
  });

  it("names the undeclared gap: a step that needs a model and predates the field that says how much", () => {
    // The case `lib/ai/model-levels.ts` refuses to bridge with `model_tier` —
    // this is the honest sentence for the step that fallback would have
    // covered, rather than silence or an invented level.
    const older: PlannedRouteStepFull[] = [
      { step: 1, component_id: "write_the_reply", risk_level: "medium", model_tier: "standard" },
    ];
    const [step] = describeAgentPlan(older);
    expect(step?.model.kind).toBe("undeclared");
    expect(step?.model.sentence).toContain("predates");
  });

  it("never turns a step's model_tier into a level on its own", () => {
    // The exact refusal ADR 0011 states: `model_tier` and `default_model_level`
    // are different vocabularies, and translating one into the other here
    // would put ADR-MAR-583's mapping table in a second repository.
    const tierOnly: PlannedRouteStepFull[] = [
      { step: 1, component_id: "x", risk_level: "low", model_tier: "frontier" },
    ];
    const [step] = describeAgentPlan(tierOnly);
    expect(step?.model.kind).toBe("undeclared");
  });
});

describe("what ADR 0011 lets this module say", () => {
  it("never promises a per-step model", () => {
    // The trap this packet was filed to avoid: showing a declared tier while
    // implying it can be turned into a chosen model per step would be the
    // MAR-624 defect rebuilt — a surface asserting something DASH does not do.
    expect(AGENT_PLAN_MODEL_BOUNDARY).toContain("no per-step model picker");
    expect(AGENT_PLAN_MODEL_BOUNDARY).not.toMatch(/choose.*model.*step|per-step.*(choice|choose)/i);
  });
});

describe("what a person reads", () => {
  it("is plain language on every branch", () => {
    expectPlainLanguage(everyAgentPlanSentence());
  });

  it("never composes a raw component id into a sentence", () => {
    // The stronger form of the assertion above: run the real scout's own
    // snake_case ids through the same reader and confirm none of them show up
    // in a rendered sentence, only as the labelled value a component would
    // put in a <code> tag beside it.
    const steps = describeAgentPlan(COMPETITOR_SCOUT_ROUTE);
    const sentences = steps.flatMap((step) => [step.risk_label, step.model.sentence]);
    for (const step of steps) {
      for (const sentence of sentences) {
        expect(sentence).not.toContain(step.component_id);
      }
    }
  });

  it("says nothing when there are no steps, without a blank line", () => {
    expect(AGENT_PLAN_EMPTY_SENTENCE.length).toBeGreaterThan(0);
    expectPlainLanguage([AGENT_PLAN_EMPTY_SENTENCE]);
  });
});
