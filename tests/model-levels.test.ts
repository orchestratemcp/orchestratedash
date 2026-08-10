/**
 * Default model levels: the contract, and the pure reader beside it (MAR-583).
 *
 * The claims this file exists to hold:
 *
 * 1. **The vocabulary is closed, and it is three.** `cheap`, `standard`,
 *    `frontier` — no `none`, no provider name, no model name. A manifest that
 *    names one of those is refused at import rather than drawn at render.
 * 2. **Absence is a fact.** A step with no level declared needs no model, which
 *    is what the emitter means by omitting the property, and the reader returns
 *    fewer steps rather than steps carrying a null.
 * 3. **The reader never falls back to `model_tier`.** The two fields describe
 *    the same underlying thing and the mapping between them belongs to the MCP
 *    emitter; re-deriving it here would put ADR-MAR-583's table in two
 *    repositories.
 * 4. **The emitter's real output validates.** The exact mapping ADR-MAR-583
 *    specifies, run through DASH's compiled schema.
 *
 * ## The corpus is the drift tripwire
 *
 * `lib/ai/model-levels.ts` re-states the schema's enum in TypeScript so the
 * renderer can reach it without Ajv. A re-statement is a second source of truth
 * unless something fails when the two disagree, so every case below is run
 * through **both** the compiled schema and the pure reader, and they must agree.
 * That is MAR-555's mechanism and this is the third issue to use it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { validateManifest } from "../lib/contracts";
import {
  DEFAULT_MODEL_LEVELS,
  everyLevelSentence,
  isDefaultModelLevel,
  levelLabel,
  levelMeaning,
  planNeedsAModel,
  stepsNeedingAModel,
  strongestLevel,
} from "../lib/ai/model-levels";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/** The shipped v2 example with a planned route grafted on. Nothing else changes. */
function withRoute(route: unknown): Record<string, unknown> {
  const manifest = example("dash-managed.manifest.v2.example.json");
  manifest["planned_route"] = route;
  return manifest;
}

/** What the compiled contract says, through the function both import doors call. */
function schemaAccepts(route: unknown): boolean {
  return validateManifest(withRoute(route)).ok;
}

function step(
  index: number,
  tier: string,
  level?: unknown,
): Record<string, unknown> {
  return {
    step: index,
    component_id: `component-${String(index)}`,
    risk_level: "low",
    model_tier: tier,
    ...(level === undefined ? {} : { default_model_level: level }),
  };
}

/* ---------------------------------------------------------------------- *
 * The corpus: every case, checked twice
 * ---------------------------------------------------------------------- */

interface LevelCase {
  name: string;
  route: unknown[];
  valid: boolean;
  /** How many steps the pure reader should say need a model. */
  needing: number;
}

const CASES: LevelCase[] = [
  /* --- the three members, and the honest absence ---------------------- */
  { name: "a cheap step", route: [step(1, "small", "cheap")], valid: true, needing: 1 },
  { name: "a standard step", route: [step(1, "standard", "standard")], valid: true, needing: 1 },
  { name: "a frontier step", route: [step(1, "frontier", "frontier")], valid: true, needing: 1 },
  {
    name: "a deterministic step declares nothing",
    route: [step(1, "none")],
    valid: true,
    needing: 0,
  },
  {
    name: "the emitter's own shape: fixed steps beside AI ones",
    route: [step(1, "none"), step(2, "small", "cheap"), step(3, "frontier", "frontier")],
    valid: true,
    needing: 2,
  },

  /* --- what the vocabulary refuses ------------------------------------ */
  {
    // The fourth member somebody will reach for, because `model_tier` has one.
    // A step that needs no AI declares nothing; a placeholder would make it look
    // configurable, which is exactly the reading ADR-MAR-583 rejected.
    name: "there is no none level",
    route: [step(1, "none", "none")],
    valid: false,
    needing: 0,
  },
  {
    // `model_tier`'s own vocabulary, which is a different vocabulary. Accepting
    // it would let the two fields drift into one.
    name: "a tier word is not a level",
    route: [step(1, "small", "small")],
    valid: false,
    needing: 0,
  },
  {
    name: "a provider name is not a level",
    route: [step(1, "frontier", "openrouter")],
    valid: false,
    needing: 0,
  },
  {
    // The whole reason ADR-MAR-583 emits levels rather than names: names age,
    // and a manifest that pinned one would be wrong within a year.
    name: "a model name is not a level",
    route: [step(1, "frontier", "claude-opus-4")],
    valid: false,
    needing: 0,
  },
  { name: "a level is not a number", route: [step(1, "small", 1)], valid: false, needing: 0 },
  { name: "a level is not null", route: [step(1, "small", null)], valid: false, needing: 0 },
  {
    name: "case matters",
    route: [step(1, "frontier", "Frontier")],
    valid: false,
    needing: 0,
  },
];

describe("default model levels: schema and reader agree", () => {
  for (const testCase of CASES) {
    it(`${testCase.name}: ${testCase.valid ? "valid" : "refused"}`, () => {
      expect(schemaAccepts(testCase.route)).toBe(testCase.valid);

      // The pure reader's verdict on the same document. It cannot refuse a
      // manifest — that is the schema's job at the import door — so what it
      // reports is how many steps it is willing to offer a choice for, and a
      // value the schema refuses must produce none.
      const read = stepsNeedingAModel(
        testCase.route as Array<{ step: number; component_id: string }>,
      );
      expect(read).toHaveLength(testCase.needing);
      for (const entry of read) {
        expect(isDefaultModelLevel(entry.level)).toBe(true);
      }
    });
  }

  it("carries the same three members as the schema's enum", () => {
    const schema = JSON.parse(
      readFileSync(path.join(repoRoot, "contracts", "agent.manifest.v2.schema.json"), "utf8"),
    ) as {
      properties: {
        planned_route: { items: { properties: { default_model_level: { enum: string[] } } } };
      };
    };
    expect(schema.properties.planned_route.items.properties.default_model_level.enum).toEqual([
      ...DEFAULT_MODEL_LEVELS,
    ]);
  });

  it("leaves the property optional, so every manifest written before it still imports", () => {
    const schema = JSON.parse(
      readFileSync(path.join(repoRoot, "contracts", "agent.manifest.v2.schema.json"), "utf8"),
    ) as { properties: { planned_route: { items: { required: string[] } } } };
    expect(schema.properties.planned_route.items.required).not.toContain("default_model_level");
    expect(schemaAccepts([step(1, "frontier")])).toBe(true);
  });
});

/* ---------------------------------------------------------------------- *
 * The emitter's mapping, as ADR-MAR-583 specifies it
 * ---------------------------------------------------------------------- */

describe("the mapping the MCP emitter writes", () => {
  /*
   * The exact table in ADR-MAR-583, driven through DASH's schema. It is here
   * rather than only in the MCP repository because this is the side that has to
   * keep accepting it: the MCP proof asserts what it emits, and this asserts
   * that what it emits is what DASH reads.
   */
  const MAPPING: Array<[string, string | undefined]> = [
    ["none", undefined],
    ["small", "cheap"],
    ["standard", "standard"],
    ["frontier", "frontier"],
  ];

  it("validates, and reads back as one step per AI-needing tier", () => {
    const route = MAPPING.map(([tier, level], index) => step(index + 1, tier, level));
    expect(schemaAccepts(route)).toBe(true);

    const read = stepsNeedingAModel(route as Array<{ step: number; component_id: string }>);
    expect(read.map((entry) => entry.level)).toEqual(["cheap", "standard", "frontier"]);
  });
});

/* ---------------------------------------------------------------------- *
 * The reader's own rules
 * ---------------------------------------------------------------------- */

describe("reading a plan", () => {
  it("never falls back to model_tier for a manifest exported before the emitter", () => {
    /*
     * The decision worth a test rather than a comment. An older manifest carries
     * `model_tier` and no levels, and translating one into the other here would
     * put ADR-MAR-583's mapping table in two repositories — where the second copy
     * would be the one nobody updates.
     *
     * The consequence is the honest one and is asserted in both directions: DASH
     * offers no per-step choice for that agent, and still knows it needs a model.
     */
    const older = [step(1, "none"), step(2, "standard"), step(3, "frontier")];
    expect(stepsNeedingAModel(older as Array<{ step: number; component_id: string }>)).toEqual([]);
    expect(planNeedsAModel(older as Array<{ step: number; component_id: string }>)).toBe(true);
  });

  it("says a fully deterministic plan needs no model, on either question", () => {
    const fixed = [step(1, "none"), step(2, "none")];
    expect(stepsNeedingAModel(fixed as Array<{ step: number; component_id: string }>)).toEqual([]);
    expect(planNeedsAModel(fixed as Array<{ step: number; component_id: string }>)).toBe(false);
  });

  it("returns steps in step order, whatever order the route was written in", () => {
    const jumbled = [step(3, "frontier", "frontier"), step(1, "small", "cheap")];
    expect(
      stepsNeedingAModel(jumbled as Array<{ step: number; component_id: string }>).map(
        (entry) => entry.step,
      ),
    ).toEqual([1, 3]);
  });

  it("ranks the levels weakest to strongest, and answers null for none", () => {
    expect(strongestLevel([])).toBeNull();
    expect(strongestLevel(["cheap"])).toBe("cheap");
    expect(strongestLevel(["frontier", "cheap"])).toBe("frontier");
    expect(strongestLevel(["cheap", "standard"])).toBe("standard");
  });

  it("drops a step whose declared level this build does not know", () => {
    // `readLivenessCheck`'s rule one layer along: a value this build cannot
    // interpret reads as the absence of a declaration, not as a fourth level.
    const odd = [step(1, "frontier", "genius")];
    expect(stepsNeedingAModel(odd as Array<{ step: number; component_id: string }>)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * The words
 * ---------------------------------------------------------------------- */

describe("what a level is called", () => {
  it("names capability and never an amount", () => {
    /*
     * MAR-299 owns spend, and it owns it because a number DASH derived from a
     * price list it does not hold would be DASH's arithmetic presented as
     * somebody's bill. So what is forbidden here is a **figure** — a currency, an
     * amount, a per-token rate — and not the word "cheap".
     *
     * That line is drawn deliberately rather than by convenience. "A small model
     * costs less than a large one" is true at every provider and is the reason a
     * person would pick one; it commits DASH to nothing it would have to check.
     * "About a cent a run" is a number DASH made up, and a person who reads it
     * and then finds four dollars on their statement has been misled by DASH.
     * `describeRunModel` is where the second kind is refused outright, and it has
     * no field one could go in.
     */
    const said = everyLevelSentence().join(" ").toLowerCase();
    for (const forbidden of ["$", "€", "cent", "per token", "per 1", "usd", "dollar"]) {
      expect(said).not.toContain(forbidden);
    }
    expect(said).not.toMatch(/\d/);
  });

  it("gives every level a label and a meaning, and both are plain language", () => {
    for (const level of DEFAULT_MODEL_LEVELS) {
      expect(levelLabel(level).length).toBeGreaterThan(0);
      expect(levelMeaning(level).length).toBeGreaterThan(0);
    }
    expectPlainLanguage(everyLevelSentence());
  });
});
