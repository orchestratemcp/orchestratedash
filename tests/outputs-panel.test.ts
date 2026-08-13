/**
 * The Outputs panel (MAR-434).
 *
 * The assertions that matter here are the ones about what the four
 * unavailability states are *not* allowed to become. Collapsing them into one
 * "this output is unavailable" is the failure this slice exists to avoid, and
 * it is a failure that would pass every test that only checked a string was
 * non-empty — so the tests below check that the four lead somewhere different,
 * not merely that four of them exist.
 *
 * Everything here is pure. `lib/views/artifacts.ts` imports the store and the
 * contracts for types only, so the panel's whole view model can be driven
 * without a database, which is what makes it cheap enough to exercise all five
 * states rather than the one production can currently produce.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  OUTPUTS_PANEL_COPY,
  describeArtifactAvailability,
  describeArtifactHistoryDay,
  describeArtifactRole,
  describeRecordSize,
  type ArtifactAvailability,
} from "../lib/copy/artifacts";
import { buildArtifactCards, canPreview } from "../lib/views/artifacts";
import type { DigestArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The agent's own name for the output, as a person would see it. */
const TITLE = "AI news for 1 August";

/** The internal names that must never reach the guided path. */
const ARTIFACT_ID = "digest-2026-08-01";
const RUN_ID = "run-7f3a91";

const GONE: readonly ArtifactAvailability[] = ["missing", "moved", "quarantined", "deleted"];

function digest(overrides: Partial<DigestArtifact> = {}): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: "ai-news-scout",
    run_id: RUN_ID,
    artifact_id: ARTIFACT_ID,
    title: TITLE,
    generated_at: "2026-08-01T06:04:11.000Z",
    items: [],
    ...overrides,
  };
}

function record(overrides: Partial<RunArtifactRecord> = {}): RunArtifactRecord {
  return {
    artifact: digest(),
    received_at: "2026-08-01T06:04:14.812Z",
    stored_bytes: 4210,
    ...overrides,
  };
}

describe("an output that is gone is four different facts", () => {
  it("says nothing at all when the output is here", () => {
    // Null rather than a cheerful "available" recovery, for the reason
    // `describeConnectionCondition` gives: a surface that renders a recovery
    // for a healthy thing teaches people to ignore recoveries.
    expect(describeArtifactAvailability("available", { title: TITLE })).toBeNull();
  });

  it("gives all four states a recovery", () => {
    for (const state of GONE) {
      const recovery = describeArtifactAvailability(state, { title: TITLE });
      expect(recovery, state).not.toBeNull();
      expect(recovery?.headline.length, state).toBeGreaterThan(0);
      expect(recovery?.meaning.length, state).toBeGreaterThan(0);
      expect(recovery?.next_action.length, state).toBeGreaterThan(0);
    }
  });

  it("never gives two of them the same next action", () => {
    /*
     * The load-bearing assertion in this file. Four distinct headlines with one
     * shared next action would be four states in the copy and one state in
     * practice, which is precisely the collapse the issue names — a person acts
     * on the last line, so that is the line that has to differ.
     */
    const actions = GONE.map(
      (state) => describeArtifactAvailability(state, { title: TITLE })?.next_action,
    );
    expect(new Set(actions).size).toBe(GONE.length);

    const headlines = GONE.map(
      (state) => describeArtifactAvailability(state, { title: TITLE })?.headline,
    );
    expect(new Set(headlines).size).toBe(GONE.length);
  });

  it("does not tell someone to re-run when the output still exists", () => {
    /*
     * Moved is the state where the obvious advice is actively harmful: running
     * the agent again leaves the person with two outputs and the one they were
     * hunting for is still wherever it went. The copy has to send them looking.
     */
    const moved = describeArtifactAvailability("moved", { title: TITLE });
    expect(moved?.next_action.toLowerCase()).not.toContain("run the agent again");
    expect(moved?.meaning.toLowerCase()).toContain("still exists");
  });

  it("sends a quarantine to the software holding it, not back to DASH", () => {
    // Re-running produces another file that is taken the same way, so a
    // recovery pointing at DASH would be a loop with a known ending.
    const quarantined = describeArtifactAvailability("quarantined", { title: TITLE });
    expect(quarantined?.next_action.toLowerCase()).toContain("security software");
    expect(quarantined?.next_action.toLowerCase()).not.toContain("run the agent again");
  });

  it("treats a deletion as a decision rather than a fault", () => {
    /*
     * The same judgment `describeAuthorizationFailure` makes about a cancelled
     * sign-in: the user got the outcome they asked for. The next action is
     * conditional, and the meaning says whose choice it was.
     */
    const deleted = describeArtifactAvailability("deleted", { title: TITLE });
    expect(deleted?.next_action.toLowerCase()).toContain("if you want");
    expect(deleted?.meaning.toLowerCase()).toContain("on purpose");
  });

  it("names the output the user is looking at, in every state", () => {
    for (const state of GONE) {
      expect(describeArtifactAvailability(state, { title: TITLE })?.headline, state).toContain(
        TITLE,
      );
    }
  });
});

describe("roles are about purpose, not format", () => {
  it("describes the two kinds DASH can draw", () => {
    expect(describeArtifactRole("digest").previewable).toBe(true);
    expect(describeArtifactRole("draft").previewable).toBe(true);
    expect(describeArtifactRole("digest").label).not.toBe(describeArtifactRole("draft").label);
  });

  it("carries the no-send safeguard into the list, not just the panel", () => {
    // A person scanning a list of outputs decides whether to worry there.
    expect(describeArtifactRole("draft").purpose.toLowerCase()).toContain("nothing has been sent");
  });

  it("does not pretend it can show a kind it has never heard of", () => {
    /*
     * The schema and the renderer's union are two authorities that can disagree
     * across a version. An unknown kind must degrade to facts plus a reveal,
     * and must never be reported to the user as damage.
     */
    const role = describeArtifactRole("spreadsheet");
    expect(role.previewable).toBe(false);
    expect(role.label.length).toBeGreaterThan(0);
    for (const word of ["error", "broken", "failed", "invalid", "corrupt"]) {
      expect(role.purpose.toLowerCase(), word).not.toContain(word);
    }
  });
});

describe("canPreview needs both halves", () => {
  it("previews a digest that is here", () => {
    expect(canPreview(buildArtifactCards([record()])[0]!)).toBe(true);
  });

  it("refuses to preview a digest that is not here", () => {
    /*
     * A moved digest is perfectly previewable in principle and there is nothing
     * to preview. Checking only the role would render an empty summary directly
     * under a notice saying the output is gone.
     */
    const [card] = buildArtifactCards([record()], () => "moved");
    expect(card!.role.previewable).toBe(true);
    expect(canPreview(card!)).toBe(false);
  });

  it("refuses to preview a kind it does not know", () => {
    const unknown = { ...digest(), kind: "spreadsheet" } as unknown as DigestArtifact;
    const [card] = buildArtifactCards([record({ artifact: unknown })]);
    expect(canPreview(card!)).toBe(false);
  });
});

describe("the provenance receipt", () => {
  it("carries both times, keeps them apart, and words neither as the machine wrote it", () => {
    const [card] = buildArtifactCards([record()]);
    /*
     * One is the agent's claim and one is DASH's record. A single "created"
     * would promote the first into the second, so they stay two.
     *
     * MAR-548: these two assertions used to pin the stored ISO strings, which
     * is what let the receipt ship `2026-08-01T06:04:11.000Z` onto three guided
     * surfaces beside a `size` that has been worded since MAR-434. Smoke check
     * 6o found it. Written against the worded forms rather than against exact
     * strings, because `plainMoment` renders in local time and a fixed
     * expectation here would pass in Oslo and fail in CI's UTC.
     */
    expect(card!.receipt.stated_at).not.toContain("T");
    expect(card!.receipt.received_at).not.toContain("T");
    expect(card!.receipt.stated_at).toContain("August 2026 at");
    expect(card!.receipt.received_at).toContain("August 2026 at");

    /*
     * **What wording costs, pinned rather than discovered.** `plainMoment`
     * renders to the minute, so this fixture's two moments — 3.8 seconds apart,
     * which is the ordinary case — now read identically. The assertion that
     * used to sit here (`stated_at` differs from `received_at`) was true only
     * because both were raw to the millisecond, and keeping it would have meant
     * keeping the defect to satisfy a test.
     *
     * The distinction the receipt exists to protect is *whose claim each is*,
     * and that is carried by the two labels, which is what MAR-434's own
     * comment says a single "Created" row would destroy. Two labelled rows
     * showing the same minute is an honest rendering of an artifact DASH
     * received in the minute the agent made it. What must still be visible is
     * the case that matters — a gap big enough to mean something — and that is
     * the assertion below.
     */
    const delayed = buildArtifactCards([record({ received_at: "2026-08-01T09:30:00.000Z" })]);
    expect(delayed[0]!.receipt.stated_at).not.toBe(delayed[0]!.receipt.received_at);
  });

  it("states an unreadable moment rather than handing the input back", () => {
    /*
     * `lib/copy/when.ts`'s rule, which is why this is worth its own case: no
     * function there ever returns what it was given, so a malformed instant
     * cannot be echoed onto the screen through the one field nobody watches.
     * "unknown" is `describeRecordSize`'s answer for the same slot.
     */
    const [card] = buildArtifactCards([
      record({ artifact: { ...digest(), generated_at: "not a time" } as DigestArtifact }),
    ]);
    expect(card!.receipt.stated_at).toBe("unknown");
  });

  it("reports the size DASH is actually holding", () => {
    expect(buildArtifactCards([record({ stored_bytes: 4210 })])[0]!.receipt.size).toBe("4.2 kB");
  });

  it("survives every availability state", () => {
    /*
     * Density is allowed to change spacing and nothing else, and an output
     * being gone is not a licence to drop its provenance either — the receipt
     * is how somebody works out what happened to it.
     */
    for (const state of ["available", ...GONE] as ArtifactAvailability[]) {
      const [card] = buildArtifactCards([record()], () => state);
      expect(card!.receipt.agent, state).toBe("ai-news-scout");
      expect(card!.receipt.stated_at, state).toContain("August 2026 at");
      expect(card!.receipt.received_at, state).toContain("August 2026 at");
      expect(card!.receipt.size, state).toBe("4.2 kB");
    }
  });

  it("does not put the run's own id in it", () => {
    /*
     * The panel only ever renders on that run's page, so "which run made this"
     * is answered by where the reader already is. The id stays in `reference`,
     * which is rendered behind the developer disclosure.
     */
    const [card] = buildArtifactCards([record()]);
    expect(Object.values(card!.receipt)).not.toContain(RUN_ID);
    expect(card!.reference.run_id).toBe(RUN_ID);
    expect(card!.reference.artifact_id).toBe(ARTIFACT_ID);
  });

  it("keeps the store's order rather than re-sorting", () => {
    const older = record({ artifact: digest({ artifact_id: "older", title: "Yesterday" }) });
    const cards = buildArtifactCards([record(), older]);
    expect(cards.map((card) => card.reference.artifact_id)).toEqual([ARTIFACT_ID, "older"]);
  });

  it("claims nothing about availability by default", () => {
    // Nothing in DASH observes a file, so production must not assert a state
    // it cannot detect. The default is the only honest one.
    const [card] = buildArtifactCards([record()]);
    expect(card!.availability).toBe("available");
    expect(card!.recovery).toBeNull();
  });
});

describe("the history day", () => {
  const today = new Date(2026, 4, 3, 12);
  const at = (year: number, month: number, day: number): string =>
    new Date(year, month, day, 12).toISOString();

  it("uses relative words only for the two dates Henrik named", () => {
    expect(describeArtifactHistoryDay(at(2026, 4, 3), today)).toBe("Today");
    expect(describeArtifactHistoryDay(at(2026, 4, 2), today)).toBe("Yesterday");
    expect(describeArtifactHistoryDay(at(2026, 4, 1), today)).toBe("1 May");
  });

  it("keeps the year when an older output crossed one", () => {
    expect(describeArtifactHistoryDay(at(2025, 11, 31), today)).toBe("31 December 2025");
  });

  it("never hands an unreadable machine value to the screen", () => {
    expect(describeArtifactHistoryDay("not a time", today)).toBe("Earlier output");
  });
});

describe("describeRecordSize", () => {
  it("words the small end without a stray plural", () => {
    expect(describeRecordSize(1)).toBe("1 byte");
    expect(describeRecordSize(0)).toBe("0 bytes");
    expect(describeRecordSize(999)).toBe("999 bytes");
  });

  it("steps up at the decimal boundaries", () => {
    expect(describeRecordSize(1000)).toBe("1.0 kB");
    expect(describeRecordSize(1_500_000)).toBe("1.5 MB");
  });

  it("says unknown rather than printing nonsense in a monospace slot", () => {
    expect(describeRecordSize(Number.NaN)).toBe("unknown");
    expect(describeRecordSize(-1)).toBe("unknown");
  });
});

describe("everything the panel renders is plain language", () => {
  it("passes the guided-path rule, ids included", () => {
    /*
     * MAR-423's criterion, over the strings the component actually imports
     * rather than a transcription of them. `forbid` carries the opaque ids,
     * which no general rule could catch: nothing about `run-7f3a91` is shaped
     * differently from a word somebody might legitimately write.
     */
    const rendered: string[] = [
      OUTPUTS_PANEL_COPY.heading,
      OUTPUTS_PANEL_COPY.empty,
      OUTPUTS_PANEL_COPY.reveal,
      OUTPUTS_PANEL_COPY.developer_summary,
      ...Object.values(OUTPUTS_PANEL_COPY.receipt),
    ];

    for (const kind of ["digest", "draft", "spreadsheet"]) {
      const role = describeArtifactRole(kind);
      rendered.push(role.label, role.purpose);
    }

    for (const state of GONE) {
      const recovery = describeArtifactAvailability(state, { title: TITLE });
      rendered.push(recovery!.headline, recovery!.meaning, recovery!.next_action);
    }

    expectPlainLanguage(rendered, {
      // The agent's own name for the output is content, not vocabulary — the
      // exemption is at the call site so it shows up in a diff.
      allow: [TITLE],
      forbid: [ARTIFACT_ID, RUN_ID, "artifact_id", "run_id", "generated_at"],
    });
  });
});

describe("density changes spacing and nothing else", () => {
  it("has no compact rule that touches an output", () => {
    /*
     * tokens.css states the rule and `tests/tokens.test.ts` holds the compact
     * block to declaring only `--density-*`. This is the other half: a rule in
     * the component stylesheet that hid a receipt at high density would satisfy
     * that test and still drop a fact.
     */
    const css = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8");
    const densityRules = css.match(/\[data-density[^{]*\{[^}]*\}/g) ?? [];
    for (const rule of densityRules) {
      expect(rule).not.toContain("output");
    }
  });

  it("spaces the panel with density tokens rather than fixed gaps", () => {
    const css = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8");
    const list = /\.output-list\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(list).toContain("var(--density-gap)");
  });
});
