/**
 * The declarative panel's view model and its words (MAR-554, ADR 0008 slice 3).
 *
 * `tests/panel-spec.test.ts` holds `validatePanel` and `resolvePanel` — what a
 * panel *is*. This holds what DASH draws from one: which artifact each binding
 * lands on, what a cell does with a value that is not the kind its column
 * declared, which of the three empty tables a person is looking at, and whether
 * a number arrives wearing the agent's voice or DASH's.
 *
 * `tests/panel-render.test.tsx` is the third file and renders the component. The
 * split is `tests/outputs-panel.test.ts`/`tests/outputs-render.test.tsx`'s and
 * for the same reason: the interesting cases here are the ones with no artifact
 * behind them, and a test that had to mount a React tree to check the third
 * empty-table sentence is a test nobody writes for the third one.
 */

import { describe, expect, it } from "vitest";

import { describeRawIdentifiers, rawIdentifiersIn } from "../lib/copy/identifiers";
import {
  PANEL_ATTRIBUTION,
  PANEL_CELL_ABSENT,
  PANEL_COPY,
  PANEL_METRIC_EMPTY,
  PANEL_NEWER_VERSION,
  PANEL_UNREADABLE,
  describeEmptyTable,
  describeOutputsCap,
  describeRowCap,
  describeRunVerdict,
  describeSkippedRows,
} from "../lib/copy/panel";
import { plainMoment } from "../lib/copy/when";
import { PANEL_SECTION_TYPES_V1 } from "../lib/panel-spec";
import { PANEL_ROW_CAP, buildPanelView, type PanelDashFacts } from "../lib/views/panel";
import type { DigestArtifact, DraftArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";

/* ---------------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------------- */

const AGENT = "ai-agent-news";
const RUN_ID = "run-mar554-demo";

function digest(items: unknown[] = [{ headline: "A supervisor for agents lands in beta" }]): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: AGENT,
    run_id: RUN_ID,
    artifact_id: "digest-2026-08-05",
    title: "AI agent news for 5 August",
    generated_at: "2026-08-05T21:14:02.000Z",
    items,
  } as unknown as DigestArtifact;
}

const draft: DraftArtifact = {
  artifact_version: 1,
  kind: "draft",
  agent: AGENT,
  run_id: RUN_ID,
  artifact_id: "draft-2026-08-05",
  title: "Reply to Maria about the pilot",
  generated_at: "2026-08-05T21:14:05.000Z",
  draft: {
    to: ["maria@example.com"],
    subject: "Re: pilot scope",
    body: "Thanks for the note.",
    placement: { where: "provider_draft", service: "Gmail" },
  },
};

function record(artifact: unknown, receivedAt = "2026-08-05T21:14:08.412Z"): RunArtifactRecord {
  return {
    artifact: artifact as DigestArtifact,
    received_at: receivedAt,
    stored_bytes: 4210,
  };
}

const FACTS: PanelDashFacts = {
  run_count: 12,
  last_run_at: "2026-08-05T21:14:02.000Z",
  last_run_status: "completed",
};

/** A manifest carrying nothing but the panel under test. */
function manifestWith(panel: unknown): unknown {
  return { agent: { name: AGENT }, agent_dom: { panel } };
}

function panelV1(sections: unknown[], title?: string): unknown {
  return manifestWith({
    panel_version: 1,
    ...(title === undefined ? {} : { title }),
    sections,
  });
}

function build(
  manifest: unknown,
  artifacts: readonly RunArtifactRecord[] = [],
  facts: PanelDashFacts = FACTS,
): ReturnType<typeof buildPanelView> {
  return buildPanelView(manifest, { artifacts, facts });
}

/** The `declared` case, narrowed, so a test does not have to re-check the union. */
function declared(view: ReturnType<typeof buildPanelView>) {
  if (view.kind !== "declared") {
    throw new Error(`expected a declared panel, got ${view.kind}`);
  }
  return view;
}

/* ---------------------------------------------------------------------- *
 * The three resolutions that are not a panel
 * ---------------------------------------------------------------------- */

describe("a panel nobody declared", () => {
  it("renders nothing at all, rather than an empty frame", () => {
    /*
     * The rule `task_inputs` shipped with, restated because the other reading is
     * available and wrong: an agent that declared no panel is not an agent that
     * gets a default one.
     */
    expect(build({ agent: { name: AGENT } })).toEqual({ kind: "none" });
    expect(build(manifestWith(undefined))).toEqual({ kind: "none" });
    expect(build(null)).toEqual({ kind: "none" });
  });
});

describe("a panel in a version DASH cannot draw", () => {
  const view = build(
    manifestWith({
      panel_version: 7,
      title: "Fleet control",
      sections: [{ id: "whatever", type: "orbit_map", label: "Orbit map" }],
    }),
  );

  it("is one stated card", () => {
    expect(view.kind).toBe("newer_version");
    expect(view.kind === "newer_version" && view.card).toEqual(PANEL_NEWER_VERSION);
  });

  it("carries no sections for a renderer to half-draw", () => {
    /*
     * ADR 0008's "never partially, because a half-drawn panel is a guess
     * rendered as a fact", asserted as a property of the value rather than of a
     * component. There is no array here, so there is no way to iterate one — a
     * later edit that wanted to would have to widen this type first.
     */
    expect("sections" in view).toBe(false);
  });

  it("says the rest of the page is unaffected, and offers no next step", () => {
    expect(PANEL_NEWER_VERSION.meaning).toContain("Everything else on this page is unaffected");
    // Honest rather than missing: nothing on this machine turns a newer
    // declaration into one this build can draw.
    expect(PANEL_NEWER_VERSION.next_action).toBeNull();
  });
});

describe("a panel DASH cannot read", () => {
  const view = build(manifestWith({ panel_version: 1, sections: [{ id: "x", type: "reprot" }] }));

  it("surfaces the damage rather than repairing it silently", () => {
    // ADR 0008's rule for two stores that disagree, applied to the one document
    // that can reach the renderer without passing an import door.
    expect(view.kind).toBe("unreadable");
    expect(view.kind === "unreadable" && view.card).toEqual(PANEL_UNREADABLE);
  });

  it("keeps the technical errors off the guided path", () => {
    expect("errors" in view).toBe(false);
  });

  it("has a next step, because there genuinely is one", () => {
    expect(PANEL_UNREADABLE.next_action).not.toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * The region
 * ---------------------------------------------------------------------- */

describe("the region DASH frames", () => {
  it("uses the author's title when they declared one", () => {
    expect(declared(build(panelV1([note()], "Newsroom"))).title).toBe("Newsroom");
  });

  it("falls back to DASH's own heading rather than inventing the author one", () => {
    expect(declared(build(panelV1([note()]))).title).toBe(PANEL_COPY.heading);
  });

  it("keeps a section's technical id out of the view entirely", () => {
    /*
     * Not "behind a disclosure" — absent. `PanelSectionView` has no id field, so
     * there is nothing for a component to print by accident, which is a stronger
     * property than a rule a renderer has to remember.
     */
    const view = declared(build(panelV1([note("secret_section_id")])));
    expect(JSON.stringify(view)).not.toContain("secret_section_id");
  });
});

/* ---------------------------------------------------------------------- *
 * report and outputs
 * ---------------------------------------------------------------------- */

function report(role = "digest"): unknown {
  return { id: "latest_digest", type: "report", label: "Latest roundup", artifact_role: role };
}

describe("a report section", () => {
  it("binds to the newest artifact of the named role", () => {
    const view = declared(
      build(panelV1([report()]), [record(digest()), record({ ...digest(), title: "Older" })]),
    );
    const section = view.sections[0];
    expect(section?.kind).toBe("report");
    expect(section?.kind === "report" && section.card?.artifact.title).toBe(
      "AI agent news for 5 August",
    );
  });

  it("names the output by its role rather than by its kind", () => {
    const view = declared(build(panelV1([report()]), [record(digest())]));
    const section = view.sections[0];
    expect(section?.kind === "report" && section.card?.role.label).toBe("Summary");
  });

  it("states an empty state rather than blanking when the role never arrived", () => {
    const view = declared(build(panelV1([report("invoice")]), [record(digest())]));
    const section = view.sections[0];
    expect(section?.kind === "report" && section.card).toBeNull();
    expect(section?.kind === "report" && section.empty.headline.length).toBeGreaterThan(0);
    expect(section?.kind === "report" && section.empty.meaning.length).toBeGreaterThan(0);
  });

  it("reaches only this agent's records, because the binding carries no agent", () => {
    // The security property stated as a shape rather than as prose: there is no
    // field on a `report` section that could name another agent, so the only
    // artifacts reachable are the ones the caller passed in.
    expect(Object.keys(report() as object)).toEqual(["id", "type", "label", "artifact_role"]);
  });
});

describe("an outputs section", () => {
  const three = [record(digest()), record(draft), record({ ...digest(), title: "Older roundup" })];

  it("shows every role when the author scoped none", () => {
    const view = declared(
      build(panelV1([{ id: "all", type: "outputs", label: "Everything" }]), three),
    );
    const section = view.sections[0];
    expect(section?.kind === "outputs" && section.cards).toHaveLength(3);
    expect(section?.kind === "outputs" && section.capped).toBeNull();
  });

  it("scopes to one role when the author named one", () => {
    const view = declared(
      build(
        panelV1([{ id: "drafts", type: "outputs", label: "Replies", artifact_role: "draft" }]),
        three,
      ),
    );
    const section = view.sections[0];
    expect(section?.kind === "outputs" && section.cards).toHaveLength(1);
    expect(section?.kind === "outputs" && section.cards[0]?.role.label).toBe("Draft reply");
  });

  it("states the author's own cap rather than letting it pass for the whole record", () => {
    const view = declared(
      build(panelV1([{ id: "few", type: "outputs", label: "Recent", max_items: 2 }]), three),
    );
    const section = view.sections[0];
    expect(section?.kind === "outputs" && section.cards).toHaveLength(2);
    expect(section?.kind === "outputs" && section.capped).toBe(describeOutputsCap(2, 3));
    expect(describeOutputsCap(2, 3)).toContain("3");
  });

  it("says so plainly when the agent has produced nothing", () => {
    const view = declared(build(panelV1([{ id: "all", type: "outputs", label: "Everything" }])));
    const section = view.sections[0];
    expect(section?.kind === "outputs" && section.cards).toHaveLength(0);
    expect(section?.kind === "outputs" && section.empty.headline.length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------------- *
 * table
 * ---------------------------------------------------------------------- */

function table(columns: unknown[], role = "digest"): unknown {
  return {
    id: "headlines",
    type: "table",
    label: "Headlines",
    source_role: role,
    columns,
  };
}

const HEADLINE_COLUMNS = [
  { key: "headline", label: "Headline", kind: "text" },
  { key: "score", label: "Score", kind: "number" },
  { key: "published_at", label: "Published", kind: "timestamp" },
];

function tableOf(rows: unknown[], columns: unknown[] = HEADLINE_COLUMNS) {
  const view = declared(build(panelV1([table(columns)]), [record(digest(rows))]));
  const section = view.sections[0];
  if (section?.kind !== "table") {
    throw new Error("expected a table section");
  }
  return section;
}

describe("a table section", () => {
  it("reads rows out of the artifact body the contract gives that kind", () => {
    const section = tableOf([
      { headline: "One", score: 12, published_at: "2026-08-05T09:00:00.000Z" },
    ]);
    expect(section.rows).toHaveLength(1);
    expect(section.rows[0]?.[0]?.text).toBe("One");
    expect(section.rows[0]?.[1]?.text).toBe("12");
  });

  it("renders each cell as the kind its column declared", () => {
    const section = tableOf([
      { headline: "One", score: 12, published_at: "2026-08-05T09:00:00.000Z" },
    ]);
    // MAR-533: a moment DASH is told is a moment is worded by DASH, never
    // shipped as the machine's own spelling of it.
    expect(section.rows[0]?.[2]?.text).toBe(plainMoment("2026-08-05T09:00:00.000Z"));
    expect(section.rows[0]?.[2]?.text).not.toContain("T09:00");
  });

  it("renders a value of the wrong kind as absent rather than coercing it", () => {
    /*
     * ADR 0008's own words. `String(value)` would fill every cell and would turn
     * a null into "null", an object into "[object Object]" and a number into a
     * value the author's own column header then describes wrongly.
     */
    const section = tableOf([
      { headline: 42, score: "twelve", published_at: "not a moment at all" },
    ]);
    expect(section.rows[0]?.map((cell) => cell.text)).toEqual([null, null, null]);
  });

  it("treats a missing key, an empty string and a non-finite number as absent", () => {
    const section = tableOf([{ headline: "", score: Number.NaN }]);
    expect(section.rows[0]?.map((cell) => cell.text)).toEqual([null, null, null]);
  });

  it("reads own properties only", () => {
    // A column keyed `constructor` must read as absent rather than reaching up
    // the prototype chain and rendering a function.
    const section = tableOf([{ headline: "One" }], [
      { key: "constructor", label: "Anything", kind: "text" },
    ]);
    expect(section.rows[0]?.[0]?.text).toBeNull();
  });

  it("truncates past the cap and states both counts", () => {
    const many = Array.from({ length: PANEL_ROW_CAP + 40 }, (_, index) => ({
      headline: `Item ${String(index)}`,
    }));
    const section = tableOf(many);
    expect(section.rows).toHaveLength(PANEL_ROW_CAP);
    // A silent cap reads as a complete record. The number a person needs is the
    // one they are not being shown.
    expect(section.capped).toBe(describeRowCap(PANEL_ROW_CAP, PANEL_ROW_CAP + 40));
    expect(section.capped).toContain(String(PANEL_ROW_CAP + 40));
  });

  it("counts the entries that were not rows rather than dropping them quietly", () => {
    const section = tableOf([{ headline: "One" }, "not a row", ["also not"], null]);
    expect(section.rows).toHaveLength(1);
    expect(section.skipped).toBe(describeSkippedRows(3));
  });

  it("keeps the three empty tables apart", () => {
    const kinds = ["no_artifact", "not_rows", "no_readable_rows"] as const;
    const sentences = new Set(kinds.map((kind) => describeEmptyTable(kind).headline));
    // One comfortable sentence covering all three would be true in each and
    // useful in none.
    expect(sentences.size).toBe(3);
    for (const kind of kinds) {
      expect(describeEmptyTable(kind).meaning.length).toBeGreaterThan(0);
    }
  });

  it("says which empty table this is: nothing has arrived", () => {
    const view = declared(build(panelV1([table(HEADLINE_COLUMNS, "invoice")]), [record(digest())]));
    const section = view.sections[0];
    expect(section?.kind === "table" && section.empty?.kind).toBe("no_artifact");
  });

  it("says which empty table this is: the output is not a list", () => {
    const view = declared(
      build(panelV1([table(HEADLINE_COLUMNS, "draft")]), [record(draft)]),
    );
    const section = view.sections[0];
    // A draft's body is an object, so there is a latest output and no rows in
    // it — a different fact from having no output at all, and the one an agent
    // author needs to be told.
    expect(section?.kind === "table" && section.empty?.kind).toBe("not_rows");
  });

  it("says which empty table this is: a list with no rows in it", () => {
    const section = tableOf(["one", "two"]);
    expect(section.empty?.kind).toBe("no_readable_rows");
    expect(section.rows).toHaveLength(0);
  });

  it("carries no empty state at all when there are rows", () => {
    expect(tableOf([{ headline: "One" }]).empty).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * metrics
 * ---------------------------------------------------------------------- */

function metrics(items: unknown[]): unknown {
  return { id: "numbers", type: "metrics", label: "At a glance", items };
}

describe("a metrics section", () => {
  it("attributes an artifact field to the agent and a DASH fact to DASH", () => {
    /*
     * The load-bearing assertion of this component. ADR 0008: collapsing the two
     * "would let an agent's own number wear DASH's voice" — the
     * stated/received split applied to a number.
     */
    const view = declared(
      build(
        panelV1([
          metrics([
            {
              id: "headline_count",
              label: "Headlines gathered",
              source: { kind: "artifact_field", artifact_role: "digest", field: "title" },
            },
            {
              id: "runs",
              label: "Times run",
              source: { kind: "dash_fact", fact: "run_count" },
            },
          ]),
        ]),
        [record(digest())],
      ),
    );
    const section = view.sections[0];
    if (section?.kind !== "metrics") {
      throw new Error("expected a metrics section");
    }
    expect(section.items[0]?.attribution).toBe(PANEL_ATTRIBUTION.artifact_field);
    expect(section.items[1]?.attribution).toBe(PANEL_ATTRIBUTION.dash_fact);
    expect(PANEL_ATTRIBUTION.artifact_field).not.toBe(PANEL_ATTRIBUTION.dash_fact);
  });

  it("reads a top-level field of the newest artifact of that role", () => {
    const view = declared(
      build(
        panelV1([
          metrics([
            {
              id: "name",
              label: "Latest roundup",
              source: { kind: "artifact_field", artifact_role: "digest", field: "title" },
            },
          ]),
        ]),
        [record(digest())],
      ),
    );
    const section = view.sections[0];
    expect(section?.kind === "metrics" && section.items[0]?.value).toBe(
      "AI agent news for 5 August",
    );
  });

  it("renders a field that is not one value as nothing rather than flattening it", () => {
    // `items` is an array. A metric slot is one value beside one label, and
    // anything else would have to be flattened, which is coercion by another
    // name.
    const view = declared(
      build(
        panelV1([
          metrics([
            {
              id: "items",
              label: "Everything",
              source: { kind: "artifact_field", artifact_role: "digest", field: "items" },
            },
          ]),
        ]),
        [record(digest())],
      ),
    );
    const section = view.sections[0];
    expect(section?.kind === "metrics" && section.items[0]?.value).toBeNull();
  });

  it("answers each DASH fact from what DASH observed", () => {
    const view = declared(
      build(
        panelV1([
          metrics([
            { id: "a", label: "Times run", source: { kind: "dash_fact", fact: "run_count" } },
            { id: "b", label: "Last run", source: { kind: "dash_fact", fact: "last_run_at" } },
            {
              id: "c",
              label: "How it went",
              source: { kind: "dash_fact", fact: "last_run_verdict" },
            },
          ]),
        ]),
      ),
    );
    const section = view.sections[0];
    if (section?.kind !== "metrics") {
      throw new Error("expected a metrics section");
    }
    expect(section.items[0]?.value).toBe("12");
    expect(section.items[1]?.value).toBe(plainMoment(FACTS.last_run_at ?? ""));
    expect(section.items[1]?.value).not.toContain("T21:14");
    expect(section.items[2]?.value).toBe("Finished");
  });

  it("has nothing to say about an agent that has never run", () => {
    const view = declared(
      build(
        panelV1([
          metrics([
            { id: "b", label: "Last run", source: { kind: "dash_fact", fact: "last_run_at" } },
            {
              id: "c",
              label: "How it went",
              source: { kind: "dash_fact", fact: "last_run_verdict" },
            },
          ]),
        ]),
        [],
        { run_count: 0, last_run_at: null, last_run_status: null },
      ),
    );
    const section = view.sections[0];
    expect(section?.kind === "metrics" && section.items.map((item) => item.value)).toEqual([
      null,
      null,
    ]);
  });

  it("keeps DASH's alarm out of a box the author frames", () => {
    /*
     * A failed run is a fact and it renders as one here. DASH's own verdict
     * surfaces — compliance, grounding, receipts — are outside the panel and
     * stay as loud as they are; a red-sounding word inside somebody else's frame
     * is the one place DASH's alarm could be borrowed.
     */
    expect(describeRunVerdict("failed")).toBe("Did not finish");
    expect(describeRunVerdict("running")).toBe("Running now");
    expect(describeRunVerdict(null)).toBeNull();
    // A status a later build adds renders as the metric's own empty state, which
    // is true, rather than as a word this build guessed at.
    expect(describeRunVerdict("quarantined")).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * note
 * ---------------------------------------------------------------------- */

function note(id = "welcome"): unknown {
  return { id, type: "note", label: "About this agent", text: "It runs when you ask it to." };
}

describe("a note section", () => {
  it("carries the author's words through unchanged", () => {
    const view = declared(build(panelV1([note()])));
    const section = view.sections[0];
    expect(section?.kind === "note" && section.text).toBe("It runs when you ask it to.");
  });
});

/* ---------------------------------------------------------------------- *
 * The vocabulary, pinned
 * ---------------------------------------------------------------------- */

describe("the component vocabulary is a by-value pin", () => {
  it("is exactly these five", () => {
    /*
     * The `HOST_VERBS` discipline. Widening this union widens what
     * agent-authored data can make DASH draw, so it is a change somebody defends
     * in one place rather than a predicate that grows quietly.
     */
    expect([...PANEL_SECTION_TYPES_V1]).toEqual([
      "report",
      "outputs",
      "table",
      "metrics",
      "note",
    ]);
  });

  it("builds a section view for every one of them", () => {
    // A sixth type added to the spec without a branch in `buildSection` fails
    // here as well as at the renderer's own switch.
    const built = declared(
      build(
        panelV1([
          report(),
          { id: "all", type: "outputs", label: "Everything" },
          table(HEADLINE_COLUMNS),
          metrics([{ id: "a", label: "Times run", source: { kind: "dash_fact", fact: "run_count" } }]),
          note(),
        ]),
        [record(digest())],
      ),
    );
    expect(built.sections.map((section) => section.kind)).toEqual([...PANEL_SECTION_TYPES_V1]);
  });

  it("keeps the declared order, which is the author's", () => {
    const built = declared(build(panelV1([note("first"), report()], "Ordered")));
    expect(built.sections.map((section) => section.kind)).toEqual(["note", "report"]);
    expect(built.sections.map((section) => section.at)).toEqual([0, 1]);
  });
});

/* ---------------------------------------------------------------------- *
 * The copy
 * ---------------------------------------------------------------------- */

describe("every fixed string is plain language", () => {
  const lines = [
    PANEL_COPY.eyebrow,
    PANEL_COPY.heading,
    PANEL_COPY.attribution,
    PANEL_ATTRIBUTION.artifact_field,
    PANEL_ATTRIBUTION.dash_fact,
    PANEL_METRIC_EMPTY,
    PANEL_CELL_ABSENT,
    PANEL_NEWER_VERSION.headline,
    PANEL_NEWER_VERSION.meaning,
    PANEL_UNREADABLE.headline,
    PANEL_UNREADABLE.meaning,
    PANEL_UNREADABLE.next_action ?? "",
    describeRowCap(200, 4120) ?? "",
    describeSkippedRows(1) ?? "",
    describeSkippedRows(3) ?? "",
    describeOutputsCap(2, 9) ?? "",
    describeRunVerdict("completed") ?? "",
    describeRunVerdict("failed") ?? "",
    describeRunVerdict("running") ?? "",
    ...(["no_artifact", "not_rows", "no_readable_rows"] as const).flatMap((kind) => {
      const empty = describeEmptyTable(kind);
      return [empty.headline, empty.meaning];
    }),
  ];

  it("finds strings to check", () => {
    // A list that silently emptied would pass this file forever.
    expect(lines.filter((line) => line !== "").length).toBeGreaterThan(20);
  });

  it("names no internal field, no environment variable and no scope", () => {
    for (const line of lines) {
      const findings = rawIdentifiersIn(line);
      expect(findings, `${line} — ${describeRawIdentifiers(findings)}`).toEqual([]);
    }
  });

  it("says what would fill an empty section rather than only that it is empty", () => {
    /*
     * MAR-554's own bar. "This table is empty" is true and useless; the second
     * sentence is the one a person can act on, and it is what distinguishes a
     * stated empty state from a blank with a label on it.
     */
    for (const kind of ["no_artifact", "not_rows", "no_readable_rows"] as const) {
      expect(describeEmptyTable(kind).meaning.split(" ").length).toBeGreaterThan(8);
    }
  });

  it("counts rows in digits a machine's locale cannot move", () => {
    // `toLocaleString` answers differently per machine, which would make the
    // same panel render two ways and a render test assert nothing.
    expect(describeRowCap(200, 4120)).toContain("4120");
    expect(describeRowCap(200, 200)).toBeNull();
  });
});
