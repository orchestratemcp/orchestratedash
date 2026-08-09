/**
 * The four questions a fleet card answers (MAR-586).
 *
 * Two halves, tested apart because they fail apart. `lib/copy/glance.ts` is pure
 * and its failures are sentences that read wrongly or say something DASH cannot
 * support. `lib/views/glance.ts` reads four different records, and its failures
 * are a chip that appears for an agent it is not true of — which is the one
 * failure mode MAR-547's ruling exists to prevent, so most of this file is about
 * the cases where a chip must **not** be drawn.
 *
 * The store half runs against a real SQLite store in a temporary directory, like
 * `tests/views.test.ts`, because the whole point of the "new output" chip is a
 * comparison between two timestamps in two tables and a mock of either would be
 * testing this file's idea of the schema.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  GLANCE_ALL_CLEAR,
  describeExpectedInterval,
  describeGlance,
  everyGlanceSentence,
  type GlanceFacts,
} from "../lib/copy/glance";
import { isPlainLanguage, rawIdentifiersIn, describeRawIdentifiers } from "../lib/copy/identifiers";
import { pastScheduleExpectation } from "../lib/workspace";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-glance-"));
process.env.DASH_DATA_DIR = dataDir;

// Imported after the data directory is chosen, the way `tests/views.test.ts`
// does it: a static import would observe whatever directory the module graph
// resolved first.
const { importManifest, ingestArtifacts, recordAgentLook, resetStore, readStore } = await import(
  "../lib/store"
);
const { closeDb } = await import("../lib/db");
const { putAgentDomState } = await import("../lib/agent-dom/store");
const { agentsView, connectionRowsFor } = await import("../lib/views/build");
const { glanceReader } = await import("../lib/views/glance");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/** Schedule trigger, and one connection DASH has no way to hold a credential for. */
const SCHEDULED = "synthetic-project-reporter";
/** Manual trigger, and one connection DASH would prompt for a key on. */
const SECRET_HOLDER = "synthetic-ledger-reporter";
/** Manual trigger, no declared connections — the sample agent's shape. */
const MANUAL = "ai-news-scout";

const NOW = new Date("2026-08-09T12:00:00.000Z");

beforeEach(() => {
  resetStore();
  rmSync(path.join(dataDir, "agents"), { recursive: true, force: true });
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

function reader(now: Date = NOW): (agent: string) => ReturnType<typeof describeGlance> {
  return glanceReader(readStore(), { connectionRows: connectionRowsFor }, now);
}

function labels(agent: string, now: Date = NOW): string[] {
  return reader(now)(agent).map((chip) => chip.label);
}

function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifact_version: 1,
    agent: MANUAL,
    run_id: "run-1",
    artifact_id: "digest-1",
    kind: "digest",
    title: "Today's news",
    generated_at: "2026-08-09T09:00:00.000Z",
    sources_fetched: [
      {
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
        status: "ok",
        item_count: 1,
      },
    ],
    items: [
      {
        headline: "Something happened",
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
      },
    ],
    ...overrides,
  };
}

/* ---------------------------------------------------------------------- *
 * The sentences
 * ---------------------------------------------------------------------- */

const NOTHING: GlanceFacts = {
  new_outputs: 0,
  total_outputs: 0,
  never_looked: false,
  approvals: 0,
  choices: 0,
  expired: 0,
  unconnected: 0,
  self_contradicting: 0,
  overdue: null,
};

describe("what a card says (MAR-586, lib/copy/glance.ts)", () => {
  it("never draws nothing, because an empty card and an unfilled card look alike", () => {
    expect(describeGlance(NOTHING)).toEqual([GLANCE_ALL_CLEAR]);
  });

  it("orders the chips by what the reader should do next, not by count", () => {
    const everything = describeGlance({
      ...NOTHING,
      new_outputs: 9,
      total_outputs: 9,
      approvals: 1,
      unconnected: 1,
      overdue: { last_run_at: "2026-08-06T09:00:00.000Z", every_seconds: 86_400 },
    });
    expect(everything.map((chip) => chip.question)).toEqual([
      "needs_you",
      "not_connected",
      "overdue",
      "new_output",
    ]);
  });

  it("says which of the two kinds of waiting it found", () => {
    expect(describeGlance({ ...NOTHING, approvals: 1 })[0]?.label).toBe("needs your approval");
    expect(describeGlance({ ...NOTHING, choices: 1 })[0]?.label).toBe("needs your answer");
    // An approval alongside a choice still names the approval: it is the
    // stronger of the two, and the sentence carries the total.
    const both = describeGlance({ ...NOTHING, approvals: 1, choices: 2 });
    expect(both[0]?.label).toBe("needs your approval");
    expect(both[0]?.meaning).toContain("3 things");
  });

  it("does not tell somebody a request is waiting when its time has run out", () => {
    const chip = describeGlance({ ...NOTHING, approvals: 1, expired: 1 })[0];
    expect(chip?.meaning).toContain("ran out");
    expect(chip?.meaning).not.toContain("1 thing is waiting");
  });

  /**
   * The `never_looked` branch, which is the whole reason that flag is a separate
   * field rather than being inferred from a count.
   */
  it("does not claim a visit that never happened", () => {
    const first = describeGlance({
      ...NOTHING,
      new_outputs: 2,
      total_outputs: 2,
      never_looked: true,
    })[0];
    expect(first?.meaning).toContain("not opened its page");
    expect(first?.meaning).not.toContain("last opened");

    const later = describeGlance({ ...NOTHING, new_outputs: 2, total_outputs: 7 })[0];
    expect(later?.meaning).toContain("since you last opened");
    // The count is what arrived since, not everything the agent has ever made.
    expect(later?.meaning).toContain("2 new things");
  });

  it("names a disagreement as something no sign-in fixes", () => {
    const chip = describeGlance({ ...NOTHING, self_contradicting: 1 })[0];
    expect(chip?.meaning).toContain("no sign-in will fix");
    expect(chip?.meaning).toContain("add the agent again");
  });

  it("quotes the declared interval rather than a schedule DASH did not parse", () => {
    expect(describeExpectedInterval(60)).toBe("about once a minute");
    expect(describeExpectedInterval(1_800)).toBe("about once every 30 minutes");
    expect(describeExpectedInterval(3_600)).toBe("about once an hour");
    expect(describeExpectedInterval(86_400)).toBe("about once a day");
    expect(describeExpectedInterval(259_200)).toBe("about once every 3 days");
    expect(describeExpectedInterval(604_800)).toBe("about once a week");
  });

  it("spells the last run as a day a person can check, never as an instant", () => {
    const chip = describeGlance({
      ...NOTHING,
      overdue: { last_run_at: "2026-08-06T09:00:00.000Z", every_seconds: 86_400 },
    })[0];
    expect(chip?.meaning).toContain("about once a day");
    expect(chip?.meaning).toMatch(/6 August 2026/);
    // `lib/copy/when.ts`'s rule: no `T`, no `Z`, no relative phrase.
    expect(chip?.meaning).not.toContain("2026-08-06T");
  });

  /**
   * The plain-language gate, over every sentence this module can produce rather
   * than over the handful a fixture happens to reach.
   */
  it("puts no raw identifier in front of a reader", () => {
    for (const sentence of everyGlanceSentence()) {
      const findings = rawIdentifiersIn(sentence);
      expect(findings, `${sentence} — ${describeRawIdentifiers(findings)}`).toEqual([]);
      expect(isPlainLanguage(sentence)).toBe(true);
    }
  });

  /**
   * Emerald is reserved (`app/tokens.css`), and red belongs to a gate violation.
   * A tone added here without a decision would be a colour DASH spends twice.
   */
  it("spends only the three tones this surface has argued for", () => {
    const tones = new Set(everyGlanceScene().flatMap((chip) => chip.tone));
    expect([...tones].sort()).toEqual(["accent", "muted", "warn"]);
  });
});

function everyGlanceScene(): ReturnType<typeof describeGlance> {
  return [
    describeGlance(NOTHING),
    describeGlance({ ...NOTHING, new_outputs: 1, total_outputs: 1 }),
    describeGlance({ ...NOTHING, approvals: 1 }),
    describeGlance({ ...NOTHING, unconnected: 1 }),
    describeGlance({ ...NOTHING, overdue: { last_run_at: null, every_seconds: 86_400 } }),
  ].flat();
}

/* ---------------------------------------------------------------------- *
 * The shared arithmetic
 * ---------------------------------------------------------------------- */

describe("one definition of late (MAR-586 shares MAR-441's)", () => {
  const schedule = { type: "schedule", label: "Daily", expected_interval_seconds: 86_400 };
  const day = (iso: string): Date => new Date(iso);

  it("says yes only when the declared window has actually gone by", () => {
    expect(
      pastScheduleExpectation(schedule, "2026-08-08T09:00:00.000Z", day("2026-08-09T12:00:00.000Z")),
    ).toBe(true);
    expect(
      pastScheduleExpectation(schedule, "2026-08-09T09:00:00.000Z", day("2026-08-09T12:00:00.000Z")),
    ).toBe(false);
  });

  it("refuses to guess rather than reporting a negative finding", () => {
    const now = day("2026-08-09T12:00:00.000Z");
    // No trigger at all.
    expect(pastScheduleExpectation(undefined, "2020-01-01T00:00:00.000Z", now)).toBe(false);
    // A trigger that is not a schedule has no expected window.
    expect(
      pastScheduleExpectation(
        { type: "manual", label: "When asked" },
        "2020-01-01T00:00:00.000Z",
        now,
      ),
    ).toBe(false);
    // A schedule with no declared interval: `schedule` itself is prose DASH
    // does not parse.
    expect(
      pastScheduleExpectation(
        { type: "schedule", label: "Weekday mornings" },
        "2020-01-01T00:00:00.000Z",
        now,
      ),
    ).toBe(false);
    // Nothing to measure a gap from.
    expect(pastScheduleExpectation(schedule, null, now)).toBe(false);
    expect(pastScheduleExpectation(schedule, "not a timestamp", now)).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * The records behind the chips
 * ---------------------------------------------------------------------- */

describe("which records answer (MAR-586, lib/views/glance.ts)", () => {
  it("says nothing needs you about a freshly imported agent", () => {
    expect(importManifest(example("agent.manifest.example.json"))).toMatchObject({ ok: true });
    expect(labels(MANUAL)).toEqual([GLANCE_ALL_CLEAR.label]);
  });

  it("counts an output as new until the page it is on has been opened", () => {
    expect(importManifest(example("agent.manifest.example.json"))).toMatchObject({ ok: true });
    expect(ingestArtifacts(artifact()).accepted).toBe(1);

    // Nobody has looked. Everything the agent has made is unseen, and the
    // sentence says so rather than implying a visit.
    const before = reader()(MANUAL);
    expect(before.map((chip) => chip.label)).toEqual(["new output"]);
    expect(before[0]?.meaning).toContain("not opened its page");

    // A look stamped after the artifact arrived clears it. The moment is passed
    // in rather than waited for, which is why `recordAgentLook` takes one.
    recordAgentLook(MANUAL, "2099-01-01T00:00:00.000Z");
    expect(labels(MANUAL)).toEqual([GLANCE_ALL_CLEAR.label]);

    // A look from before it arrived does not.
    recordAgentLook(MANUAL, "2000-01-01T00:00:00.000Z");
    const after = reader()(MANUAL);
    expect(after.map((chip) => chip.label)).toEqual(["new output"]);
    expect(after[0]?.meaning).toContain("since you last opened");
  });

  it("does not call an agent overdue for a schedule it never declared", () => {
    expect(importManifest(example("agent.manifest.example.json"))).toMatchObject({ ok: true });
    // Years after any plausible run, with a manual trigger: not overdue, because
    // nobody ever said it should have run.
    expect(labels(MANUAL, new Date("2030-01-01T00:00:00.000Z"))).toEqual([
      GLANCE_ALL_CLEAR.label,
    ]);
  });

  it("reports a declared connection DASH could hold a credential for and does not", () => {
    expect(importManifest(example("dash-managed-secret.manifest.v2.example.json"))).toMatchObject({
      ok: true,
    });
    const chips = reader()(SECRET_HOLDER);
    const connection = chips.find((chip) => chip.question === "not_connected");
    expect(connection?.label).toBe("not connected");
    expect(connection?.meaning).toContain("1 thing");
    // The manifest names an environment variable for the key. It must not reach
    // the sentence — `lib/copy/identifiers.ts`'s rule, checked here on a card
    // built from a real manifest rather than only on the composed corpus above.
    expect(isPlainLanguage(connection?.meaning ?? "")).toBe(true);
  });

  /**
   * The other half of the same rule, and the one worth a test of its own: a row
   * DASH cannot hold a credential for is somebody else's to arrange, DASH offers
   * no button for it, and a chip counting it would send a person to do something
   * DASH can never mark as done.
   */
  it("does not count a connection DASH has no way to hold", () => {
    expect(importManifest(example("dash-managed.manifest.v2.example.json"))).toMatchObject({
      ok: true,
    });
    // The declared field is a reauthorization against a provider DASH does not
    // broker, so `dash_can_hold` is false for every row on this agent.
    expect(connectionRowsFor(SCHEDULED, example("dash-managed.manifest.v2.example.json")).every(
      (row) => !row.dash_can_hold,
    )).toBe(true);
    expect(reader()(SCHEDULED).some((chip) => chip.question === "not_connected")).toBe(false);
  });

  /**
   * The overdue chip against DASH's own record of runs, which is the record
   * MAR-586 names — and, deliberately, not the snapshot's `last_activity_at`.
   */
  it("measures overdue against the schedule and the last run", () => {
    expect(importManifest(example("dash-managed.manifest.v2.example.json"))).toMatchObject({
      ok: true,
    });
    // The example declares three days. An agent that has never run at all is
    // not overdue: there is nothing to measure a gap from.
    expect(reader().call(null, SCHEDULED).some((chip) => chip.question === "overdue")).toBe(false);
  });

  it("does not call an agent overdue while it is running", () => {
    const manifest = example("dash-managed.manifest.v2.example.json");
    expect(importManifest(manifest)).toMatchObject({ ok: true });
    putAgentDomState({
      state_version: 1,
      manifest_version: 2,
      agent_id: SCHEDULED,
      observed_at: "2026-08-09T11:00:00.000Z",
      status: "running",
      runs: [{ id: "run-9", status: "running", started_at: "2026-08-09T11:00:00.000Z" }],
    });
    expect(reader().call(null, SCHEDULED).some((chip) => chip.question === "overdue")).toBe(false);
  });

  it("hands every fleet row an answer, and one a renderer can carry", () => {
    expect(importManifest(example("agent.manifest.example.json"))).toMatchObject({ ok: true });
    const view = agentsView();
    expect(view.agents).toHaveLength(1);
    for (const row of view.agents) {
      expect(row.glance.length).toBeGreaterThan(0);
      // Structured-clone safety, the property `tests/views.test.ts` guards for
      // the rest of this document: these cross `contextBridge`.
      expect(() => structuredClone(row.glance)).not.toThrow();
    }
  });
});
