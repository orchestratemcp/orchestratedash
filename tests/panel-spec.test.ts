/**
 * Panel spec v0: the contract, and the pure reader beside it (ADR 0008, MAR-552).
 *
 * The ADR makes three claims this file exists to hold:
 *
 * 1. **The vocabulary is closed.** Five section types, and a typo'd one is
 *    refused at import rather than dropped at render — "the way a widened
 *    `HOST_VERBS` fails its by-value pin."
 * 2. **The versioning rule is structural.** Version 1 is validated strictly; a
 *    version DASH does not know is accepted for structure only and rendered as
 *    one stated card. Both halves are asserted, because the failure mode of
 *    getting this wrong is either a manifest DASH refuses for being too new or
 *    a version 1 panel quietly rotting into leniency.
 * 3. **Absence means absence.** No shipped example declares a panel, and an
 *    undeclared panel produces nothing — never a default, never an empty frame.
 *
 * ## The corpus is the drift tripwire
 *
 * `lib/panel-spec.ts` re-states the schema's rules in TypeScript so the
 * renderer and the feedback layer can reach them without Ajv. A re-statement is
 * a second source of truth unless something fails when the two disagree, so
 * every case below is run through **both** the compiled schema and the pure
 * reader, and they must return the same verdict. Adding a rule to one and not
 * the other turns this file red.
 *
 * ## Which door refuses, and which sentence it says
 *
 * The refusal is Ajv's, at `validateManifest` — which is what both import doors
 * call (`importManifest` in `lib/store.ts`, `readManifestFor` in
 * `lib/handoff-flow.ts`). It is deliberately *not* wired into
 * `checkManifestConstraints`: that function's result is rendered by the handoff
 * door with a hardcoded ADR 0006 sentence about remote runtimes, so routing a
 * panel failure through it would answer the wrong question in the user's face.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { agentPanel, validateManifest, type AgentManifestV2 } from "../lib/contracts";
import { explainImportFailure } from "../lib/import-feedback";
import {
  PANEL_COLUMN_KINDS,
  PANEL_DASH_FACTS,
  PANEL_MANIFEST_PATH,
  PANEL_SECTION_TYPES_V1,
  resolvePanel,
  validatePanel,
} from "../lib/panel-spec";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-panel-"));
process.env.DASH_DATA_DIR = dataDir;

const { importManifest, resetStore } = await import("../lib/store");
const { closeDb } = await import("../lib/db");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/** The shipped v2 example with a panel grafted on. Nothing else about it changes. */
function withPanel(panel: unknown): Record<string, unknown> {
  const manifest = example("dash-managed.manifest.v2.example.json");
  (manifest["agent_dom"] as Record<string, unknown>)["panel"] = panel;
  return manifest;
}

/** What the compiled contract says, through the same function both import doors call. */
function schemaAccepts(panel: unknown): boolean {
  return validateManifest(withPanel(panel)).ok;
}

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------------- */

const REPORT = { id: "latest", type: "report", label: "Latest report", artifact_role: "digest" };
const OUTPUTS = { id: "files", type: "outputs", label: "Everything produced" };
const TABLE = {
  id: "rows",
  type: "table",
  label: "What it found",
  source_role: "digest",
  columns: [
    { key: "headline", label: "Headline", kind: "text" },
    { key: "published_at", label: "Published", kind: "timestamp" },
  ],
};
const METRICS = {
  id: "numbers",
  type: "metrics",
  label: "At a glance",
  items: [
    {
      id: "stories",
      label: "Stories found",
      source: { kind: "artifact_field", artifact_role: "digest", field: "item_count" },
    },
    { id: "runs", label: "Runs so far", source: { kind: "dash_fact", fact: "run_count" } },
  ],
};
const NOTE = {
  id: "about",
  type: "note",
  label: "About this agent",
  text: "Reads the feeds every weekday morning and writes up what changed.",
};

function panelOf(...sections: unknown[]): Record<string, unknown> {
  return { panel_version: 1, sections };
}

function repeat(character: string, count: number): string {
  return character.repeat(count);
}

/* ---------------------------------------------------------------------- *
 * The corpus: every case, checked twice
 * ---------------------------------------------------------------------- */

interface PanelCase {
  name: string;
  panel: unknown;
  valid: boolean;
}

const CASES: PanelCase[] = [
  /* --- the five components, each on its own ------------------------- */
  { name: "a report section", panel: panelOf(REPORT), valid: true },
  { name: "an outputs section with no role, meaning every role", panel: panelOf(OUTPUTS), valid: true },
  {
    name: "an outputs section scoped and capped",
    panel: panelOf({ ...OUTPUTS, artifact_role: "digest", max_items: 5 }),
    valid: true,
  },
  { name: "a table section", panel: panelOf(TABLE), valid: true },
  { name: "a metrics section reading both kinds of source", panel: panelOf(METRICS), valid: true },
  { name: "a note section", panel: panelOf(NOTE), valid: true },
  {
    name: "all five components at once",
    panel: panelOf(REPORT, OUTPUTS, TABLE, METRICS, NOTE),
    valid: true,
  },
  { name: "a titled panel", panel: { ...panelOf(NOTE), title: "News desk" }, valid: true },

  /* --- the closed enum ---------------------------------------------- */
  {
    name: "a typo'd section type",
    panel: panelOf({ ...REPORT, type: "reprot" }),
    valid: false,
  },
  {
    name: "a section type from a version that has not been designed yet",
    panel: panelOf({ id: "chat", type: "conversation", label: "Talk to it" }),
    valid: false,
  },
  {
    name: "a section with no type at all",
    panel: panelOf({ id: "x", label: "X" }),
    valid: false,
  },

  /* --- structure ----------------------------------------------------- */
  { name: "a panel that is not an object", panel: [REPORT], valid: false },
  { name: "a panel that is a string", panel: "a lovely panel", valid: false },
  { name: "a null panel — omit-never-empty, and never-null either", panel: null, valid: false },
  { name: "a panel with no sections key", panel: { panel_version: 1 }, valid: false },
  { name: "a panel whose sections are an object", panel: { panel_version: 1, sections: {} }, valid: false },
  { name: "an empty sections array", panel: panelOf(), valid: false },
  { name: "a section that is a string", panel: panelOf("note please"), valid: false },
  { name: "a section that is an array", panel: panelOf([]), valid: false },
  { name: "a section with no id", panel: panelOf({ type: "note", label: "X", text: "y" }), valid: false },
  { name: "a section with no label", panel: panelOf({ id: "x", type: "note", text: "y" }), valid: false },
  {
    name: "a section id that is not lowercase vocabulary",
    panel: panelOf({ ...NOTE, id: "About-This" }),
    valid: false,
  },
  {
    name: "unknown members on a section, which the additive rule keeps",
    panel: panelOf({ ...NOTE, invented_later: { deeply: ["nested"] } }),
    valid: true,
  },

  /* --- the version rule ---------------------------------------------- */
  {
    name: "a newer version carrying a type version 1 would refuse",
    panel: { panel_version: 2, sections: [{ id: "chat", type: "conversation", label: "Talk to it" }] },
    valid: true,
  },
  {
    name: "a much newer version with members version 1 never had",
    panel: {
      panel_version: 99,
      sections: [{ id: "x", type: "whatever", label: "X", bindings: { to: "something" } }],
    },
    valid: true,
  },
  {
    name: "a newer version whose id is not version 1 vocabulary, which is version 1's rule not structure's",
    panel: { panel_version: 2, sections: [{ id: "Some-Id", type: "whatever", label: "X" }] },
    valid: true,
  },
  {
    name: "a newer version whose section still has no label",
    panel: { panel_version: 2, sections: [{ id: "x", type: "whatever" }] },
    valid: false,
  },
  { name: "no version at all", panel: { sections: [NOTE] }, valid: false },
  { name: "version zero", panel: { panel_version: 0, sections: [NOTE] }, valid: false },
  { name: "a negative version", panel: { panel_version: -1, sections: [NOTE] }, valid: false },
  { name: "a fractional version", panel: { panel_version: 1.5, sections: [NOTE] }, valid: false },
  { name: "a version written as a string", panel: { panel_version: "1", sections: [NOTE] }, valid: false },

  /* --- what each component requires ---------------------------------- */
  {
    name: "a report with no role to bind to",
    panel: panelOf({ id: "latest", type: "report", label: "Latest" }),
    valid: false,
  },
  {
    name: "a role name that could spell a path",
    panel: panelOf({ ...REPORT, artifact_role: "../digest" }),
    valid: false,
  },
  {
    name: "a role name with a separator in it",
    panel: panelOf({ ...REPORT, artifact_role: "runs/digest" }),
    valid: false,
  },
  { name: "a table with no columns", panel: panelOf({ ...TABLE, columns: [] }), valid: false },
  {
    name: "a table column with no kind",
    panel: panelOf({ ...TABLE, columns: [{ key: "headline", label: "Headline" }] }),
    valid: false,
  },
  {
    name: "a table column of a kind DASH cannot render",
    panel: panelOf({ ...TABLE, columns: [{ key: "cover", label: "Cover", kind: "image" }] }),
    valid: false,
  },
  {
    name: "a table column key that is not lowercase vocabulary",
    panel: panelOf({ ...TABLE, columns: [{ key: "Headline", label: "Headline", kind: "text" }] }),
    valid: false,
  },
  { name: "a metrics section with no items", panel: panelOf({ ...METRICS, items: [] }), valid: false },
  {
    name: "a metric with no source",
    panel: panelOf({ ...METRICS, items: [{ id: "x", label: "X" }] }),
    valid: false,
  },
  {
    name: "a metric naming a fact DASH does not observe",
    panel: panelOf({
      ...METRICS,
      items: [{ id: "x", label: "X", source: { kind: "dash_fact", fact: "cost_usd" } }],
    }),
    valid: false,
  },
  {
    name: "an artifact field source missing the field",
    panel: panelOf({
      ...METRICS,
      items: [{ id: "x", label: "X", source: { kind: "artifact_field", artifact_role: "digest" } }],
    }),
    valid: false,
  },
  {
    name: "a source of a kind that does not exist",
    panel: panelOf({
      ...METRICS,
      items: [{ id: "x", label: "X", source: { kind: "http_get", url: "https://example.com" } }],
    }),
    valid: false,
  },
  { name: "a note with no text", panel: panelOf({ id: "about", type: "note", label: "About" }), valid: false },
  { name: "a note with empty text", panel: panelOf({ ...NOTE, text: "" }), valid: false },

  /* --- bounds, which are the resource story --------------------------- */
  {
    name: "eight sections",
    panel: panelOf(...Array.from({ length: 8 }, (_, index) => ({ ...NOTE, id: `note_${index}` }))),
    valid: true,
  },
  {
    name: "nine sections",
    panel: panelOf(...Array.from({ length: 9 }, (_, index) => ({ ...NOTE, id: `note_${index}` }))),
    valid: false,
  },
  {
    name: "eight columns",
    panel: panelOf({
      ...TABLE,
      columns: Array.from({ length: 8 }, (_, index) => ({
        key: `column_${index}`,
        label: `Column ${index}`,
        kind: "text",
      })),
    }),
    valid: true,
  },
  {
    name: "nine columns",
    panel: panelOf({
      ...TABLE,
      columns: Array.from({ length: 9 }, (_, index) => ({
        key: `column_${index}`,
        label: `Column ${index}`,
        kind: "text",
      })),
    }),
    valid: false,
  },
  {
    name: "nine metrics",
    panel: panelOf({
      ...METRICS,
      items: Array.from({ length: 9 }, (_, index) => ({
        id: `metric_${index}`,
        label: `Metric ${index}`,
        source: { kind: "dash_fact", fact: "run_count" },
      })),
    }),
    valid: false,
  },
  { name: "twenty output items", panel: panelOf({ ...OUTPUTS, max_items: 20 }), valid: true },
  { name: "twenty-one output items", panel: panelOf({ ...OUTPUTS, max_items: 21 }), valid: false },
  { name: "zero output items", panel: panelOf({ ...OUTPUTS, max_items: 0 }), valid: false },
  { name: "a note of four hundred characters", panel: panelOf({ ...NOTE, text: repeat("x", 400) }), valid: true },
  {
    name: "a note of four hundred and one characters",
    panel: panelOf({ ...NOTE, text: repeat("x", 401) }),
    valid: false,
  },
  { name: "a label of a hundred and twenty characters", panel: panelOf({ ...NOTE, label: repeat("x", 120) }), valid: true },
  { name: "a label of a hundred and twenty-one characters", panel: panelOf({ ...NOTE, label: repeat("x", 121) }), valid: false },
  { name: "an empty label", panel: panelOf({ ...NOTE, label: "" }), valid: false },
  { name: "a title of a hundred and twenty-one characters", panel: { ...panelOf(NOTE), title: repeat("x", 121) }, valid: false },
  { name: "an empty title", panel: { ...panelOf(NOTE), title: "" }, valid: false },
  { name: "a role name of sixty-five characters", panel: panelOf({ ...REPORT, artifact_role: repeat("a", 65) }), valid: false },
];

describe("the contract and the pure reader agree, case by case", () => {
  for (const { name, panel, valid } of CASES) {
    it(`${valid ? "accepts" : "refuses"} ${name}`, () => {
      expect(schemaAccepts(panel), "the compiled schema disagreed").toBe(valid);
      expect(validatePanel(panel).ok, "lib/panel-spec.ts disagreed").toBe(valid);
    });
  }

  it("covers every component in the vocabulary", () => {
    // The corpus is only exhaustive while the vocabulary is what it was when
    // the corpus was written. This fails on the day a sixth component lands
    // without cases of its own, which is the day it would otherwise ship
    // untested.
    expect(PANEL_SECTION_TYPES_V1).toEqual(["report", "outputs", "table", "metrics", "note"]);
    expect(PANEL_COLUMN_KINDS).toEqual(["text", "number", "timestamp"]);
    expect(PANEL_DASH_FACTS).toEqual(["run_count", "last_run_at", "last_run_verdict"]);
  });
});

/* ---------------------------------------------------------------------- *
 * The vocabulary is closed, and the errors say which rule broke
 * ---------------------------------------------------------------------- */

describe("the closed vocabulary", () => {
  it("names the whole set when a section type is not in it", () => {
    const result = validatePanel(panelOf({ ...REPORT, type: "reprot" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [error] = result.errors;
    expect(error?.code).toBe("unknown_section_type");
    expect(error?.path).toBe("/sections/0/type");
    // Every type, so the author's next move is picking one rather than
    // guessing which four they already knew about.
    for (const type of PANEL_SECTION_TYPES_V1) {
      expect(error?.message).toContain(type);
    }
  });

  it("stops at the type rather than guessing which shape was meant", () => {
    // A section typed `reprot` carrying a role could be a misspelt report or a
    // misspelt anything. Reporting "and it is also missing columns" would be
    // DASH deciding which component the author meant.
    const result = validatePanel(panelOf({ id: "x", type: "reprot", label: "X" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.code)).toEqual(["unknown_section_type"]);
  });

  it("points at the section that broke, not at the panel", () => {
    const result = validatePanel(panelOf(NOTE, REPORT, { ...NOTE, id: "third", text: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.path)).toEqual(["/sections/2/text"]);
  });

  it("reports every fault rather than the first", () => {
    // The author fixes their panel in one pass or in five, and which it is
    // should not depend on the order this module happens to check things in.
    const result = validatePanel(
      panelOf({ ...TABLE, source_role: "Bad Role", columns: [{ key: "OK", label: "", kind: "colour" }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.path)).toEqual([
      "/sections/0/source_role",
      "/sections/0/columns/0/key",
      "/sections/0/columns/0/label",
      "/sections/0/columns/0/kind",
    ]);
  });
});

/* ---------------------------------------------------------------------- *
 * The versioning rule, resolved
 * ---------------------------------------------------------------------- */

describe("what DASH may draw", () => {
  it("says nothing at all for an agent that declared no panel", () => {
    // The `task_inputs` rule restated, because the other reading is available
    // and wrong: an agent that declared no panel is not an agent that gets a
    // default one.
    expect(resolvePanel({ agent_dom: {} })).toEqual({ kind: "none" });
    expect(resolvePanel({})).toEqual({ kind: "none" });
    expect(resolvePanel(null)).toEqual({ kind: "none" });
  });

  it("reads a null panel as nothing to draw, though the contract refuses one", () => {
    // A deliberate difference between the two functions, recorded so it stays
    // deliberate. `validatePanel` refuses null because the schema does —
    // omit-never-empty means omit-never-null too, and that is the rule an
    // emitter is held to. `resolvePanel` renders nothing, because a panel with
    // no content is not a panel half-drawn.
    expect(validatePanel(null).ok).toBe(false);
    expect(resolvePanel({ agent_dom: { panel: null } })).toEqual({ kind: "none" });
  });

  it("narrows a version 1 panel to the closed union", () => {
    const resolved = resolvePanel({ agent_dom: { panel: panelOf(REPORT, TABLE, NOTE) } });
    expect(resolved.kind).toBe("v1");
    if (resolved.kind !== "v1") return;
    expect(resolved.sections.map((section) => section.type)).toEqual(["report", "table", "note"]);
    // Narrowing on `type` is the whole point: a renderer switching on it gets
    // the members that section actually has.
    const [report] = resolved.sections;
    if (report?.type === "report") {
      expect(report.artifact_role).toBe("digest");
    }
    expect(resolved.title).toBeNull();
  });

  it("carries the author's title when there is one", () => {
    const resolved = resolvePanel({
      agent_dom: { panel: { ...panelOf(NOTE), title: "News desk" } },
    });
    expect(resolved.kind === "v1" && resolved.title).toBe("News desk");
  });

  it("hands a newer version no sections at all", () => {
    /*
     * ADR 0008: a panel DASH cannot draw renders as one stated card, "never
     * partially, because a half-drawn panel is a guess rendered as a fact."
     * The resolution makes that structural rather than a rule the renderer has
     * to remember — there is no array to iterate, so there is no way to half
     * draw it.
     */
    const resolved = resolvePanel({
      agent_dom: {
        panel: { panel_version: 4, title: "Chat", sections: [{ id: "a", type: "conversation", label: "Talk" }] },
      },
    });
    expect(resolved).toEqual({ kind: "newer_version", panel_version: 4, title: "Chat" });
    expect(Object.keys(resolved)).not.toContain("sections");
  });

  it("keeps the errors for a panel that is declared but unreadable", () => {
    // Unreachable through the import doors, which refuse this before a row is
    // written. It exists for the document that arrived some other way, and the
    // errors are carried rather than swallowed because ADR 0008's rule is that
    // damage is surfaced, never silently repaired.
    const resolved = resolvePanel({ agent_dom: { panel: { panel_version: 1, sections: "yes please" } } });
    expect(resolved.kind).toBe("unreadable");
    if (resolved.kind !== "unreadable") return;
    expect(resolved.errors[0]?.code).toBe("sections_invalid");
  });
});

/* ---------------------------------------------------------------------- *
 * The accessor, and absence
 * ---------------------------------------------------------------------- */

describe("the declared panel", () => {
  it("is null for a v1 manifest, an undeclared block, and a block of the wrong shape", () => {
    expect(agentPanel(example("agent.manifest.example.json") as never)).toBeNull();
    expect(
      agentPanel(example("dash-managed.manifest.v2.example.json") as unknown as AgentManifestV2),
    ).toBeNull();
    expect(agentPanel(withPanel("not a panel") as unknown as AgentManifestV2)).toBeNull();
    expect(agentPanel(withPanel([REPORT]) as unknown as AgentManifestV2)).toBeNull();
  });

  it("is the author's own document when there is one", () => {
    const panel = agentPanel(withPanel(panelOf(NOTE)) as unknown as AgentManifestV2);
    expect(panel?.panel_version).toBe(1);
    expect(panel?.sections).toHaveLength(1);
  });

  it("the shipped sample declares one DASH can draw (MAR-548)", () => {
    /*
     * This assertion used to read "no shipped example declares one, and that is
     * the honest answer today" — the MAR-507 pattern, recorded so a test would
     * notice the day it stopped being true. MAR-548 is that day, and the test is
     * inverted rather than deleted: what it now holds is that the sample which
     * is meant to draw a panel actually does, resolved through the same
     * `resolvePanel` a render goes through rather than by reading the JSON.
     */
    const resolved = resolvePanel(example("gmail-meeting-assistant.manifest.v2.example.json"));
    expect(resolved.kind).toBe("v1");
    if (resolved.kind !== "v1") return;
    expect(resolved.sections.map((section) => section.type)).toEqual([
      "note",
      "report",
      "outputs",
      "metrics",
    ]);
  });

  it("the examples that are not sample agents still declare none", () => {
    /*
     * The other half, and the reason the loop survives the inversion above. A
     * panel arriving on a contract example by accident — a copy-paste, a merge —
     * would put an author's box on a document whose whole job is to exercise one
     * schema branch, and nothing else would say so.
     *
     * These four are not a retired cast. They never shipped: `examples/` is in
     * no package, nothing seeds them into a fleet, and no surface offers them.
     * They are fixtures with a directory that flatters them, which is the
     * finding MAR-548 records rather than the churn it performs.
     */
    for (const file of [
      "agent.manifest.example.json",
      "agent-managed.manifest.v2.example.json",
      "dash-managed.manifest.v2.example.json",
      "dash-managed-secret.manifest.v2.example.json",
    ]) {
      expect(resolvePanel(example(file)), file).toEqual({ kind: "none" });
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The door
 * ---------------------------------------------------------------------- */

describe("importManifest under the panel contract", () => {
  it("imports an agent whose panel DASH can draw", () => {
    expect(importManifest(withPanel(panelOf(REPORT, OUTPUTS, TABLE, METRICS, NOTE))).ok).toBe(true);
  });

  it("refuses a typo'd section type at import, not at render", () => {
    const result = importManifest(withPanel(panelOf({ ...REPORT, type: "reprot" })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain(PANEL_MANIFEST_PATH);
  });

  it("imports an agent whose panel is newer than this DASH", () => {
    // The additive-versioning rule: DASH ignores what it does not understand
    // rather than rejecting the document. An agent must not become
    // un-importable because its author moved first.
    expect(
      importManifest(
        withPanel({ panel_version: 2, sections: [{ id: "chat", type: "conversation", label: "Talk" }] }),
      ).ok,
    ).toBe(true);
  });

  it("still imports every shipped example", () => {
    expect(importManifest(example("dash-managed.manifest.v2.example.json")).ok).toBe(true);
    expect(importManifest(example("gmail-meeting-assistant.manifest.v2.example.json")).ok).toBe(true);
    expect(importManifest(example("agent-managed.manifest.v2.example.json")).ok).toBe(true);
    expect(importManifest(example("agent.manifest.example.json")).ok).toBe(true);
  });
});

/* ---------------------------------------------------------------------- *
 * The sentence
 * ---------------------------------------------------------------------- */

describe("what the refusal says", () => {
  it("explains an unreadable panel instead of relaying Ajv", () => {
    const result = importManifest(withPanel(panelOf({ ...REPORT, type: "reprot" })));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    const explanation = explainImportFailure(result.errors);
    expect(explanation.kind).toBe("invalid_panel");
    expect(explanation.headline).toContain("panel");
    for (const type of PANEL_SECTION_TYPES_V1) {
      expect(explanation.suggestion).toContain(type);
    }
    expect(explanation.raw).toEqual(result.errors);
  });

  it("wins over the missing-section case, which would point at the wrong file", () => {
    /*
     * A report section that forgot its role produces Ajv's ordinary "must have
     * required property 'artifact_role'". Read by the missing-property branch
     * that becomes "this manifest is missing a required section:
     * artifact_role", which sends an author to the top of their manifest
     * looking for something that is wrong inside their panel.
     */
    const result = importManifest(
      withPanel(panelOf({ id: "latest", type: "report", label: "Latest" })),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("must have required property");
    expect(explainImportFailure(result.errors).kind).toBe("invalid_panel");
  });

  it("leaves a manifest with no panel to the cases that were already right", () => {
    const explanation = explainImportFailure(["(root) must have required property 'agent_dom'"]);
    expect(explanation.kind).toBe("missing_agent_dom");
  });

  it("passes the plain-language rule", () => {
    const result = importManifest(withPanel(panelOf({ ...REPORT, type: "reprot" })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const explanation = explainImportFailure(result.errors);
    // The raw errors are exempt, as Ajv's always are — they are shown as the
    // validator's own words and are never the headline.
    expectPlainLanguage([explanation.headline, explanation.suggestion]);
  });
});

/* ---------------------------------------------------------------------- *
 * The import direction that keeps the panel readable in a browser
 * ---------------------------------------------------------------------- */

describe("lib/panel-spec.ts stays reachable from a client component", () => {
  it("imports nothing at all", () => {
    /*
     * `lib/import-feedback.ts` is bundled into the add-agent page's client
     * component and now imports this module for the section vocabulary; the
     * panel renderer (slice 3) will import it for the types. Neither can carry
     * `lib/contracts.ts`, which reads schema files with `node:fs`.
     *
     * Asserted over the source rather than trusted to review, because the
     * import that breaks this will look completely reasonable in a diff — one
     * `import type` that someone later makes a value import.
     */
    const source = readFileSync(path.join(repoRoot, "lib", "panel-spec.ts"), "utf8");
    const imports = source.match(/^\s*import\s.+$/gm) ?? [];
    expect(imports, "lib/panel-spec.ts must have no imports").toEqual([]);
  });
});
