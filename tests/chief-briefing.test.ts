/**
 * What the chief is told, what the receipt shows back, and when a stored answer
 * stops describing the fleet it was written about (MAR-659, ADR 0023 decisions
 * 5, 6 and 7).
 *
 * The rule under test is one sentence and it is deliberately weaker than the one
 * it replaces:
 *
 * > Every field on a briefing row is a string DASH already renders on a screen.
 *
 * `describeChief`'s *"quote one record, never reword it"* could not survive the
 * question that failed station 11 — *"which agents run local and which on the
 * cloud"* is `describeFleetPlace` per agent and grouped, and there is no single
 * record to quote. So these tests check the replacement rather than the original:
 * each field is compared against the function the card itself calls.
 */

import { describe, expect, it } from "vitest";

import {
  EMPTY_BRIEFING,
  MAX_BRIEFING_AGENTS,
  briefingFor,
  fleetChangedSince,
  renderBriefing,
  type ChiefBriefingRow,
} from "../lib/chief/briefing";
import { everyChiefManifestSentence } from "../lib/chief/manifest";
import { describeFleetPlace, describeRunCount } from "../lib/copy/fleet-status";
import { plainDay } from "../lib/copy/when";
import type { AgentRow, ChiefReceiptRow } from "../lib/views/types";
import { expectPlainLanguage } from "./helpers/plain-language";

/**
 * `ChiefReceiptRow` is `ChiefBriefingRow`, pinned.
 *
 * `lib/views/types.ts` restates the shape structurally rather than importing it,
 * because that module is the boundary a `"use client"` page reads and
 * `lib/chief/briefing.ts` imports the copy layer. This one-line assignment is
 * what keeps the restatement honest — the mechanism `AiKeyActionResult` and
 * `RequiredCapability` both use for the same problem.
 */
const _shapesAgree: ChiefReceiptRow = {
  agent: "a",
  title: "A",
  place: "Local",
  standing: "All clear.",
  runs: "Not run yet",
  last_run: null,
  capabilities: [],
} satisfies ChiefBriefingRow;
void _shapesAgree;

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    name: "ai-agent-news",
    title: "AI News Scout",
    goal: "Collect AI agent news every morning and summarise it.",
    capabilities: ["public_feed_fetch", "digest_compose"],
    plan_source: "declared",
    build_target: "node",
    planned_steps: 2,
    automation_clearance: "on command",
    run_count: 3,
    last_run_at: "2026-08-14T09:00:00.000Z",
    origin: { kind: "sample", label: "Sample", detail: null },
    compliance: { verdict: "compliant", detail: null },
    avatar: "nerd",
    deploy: { can_deploy: false, reason: null },
    glance: [
      {
        question: "all_clear",
        label: "All clear",
        meaning: "DASH has nothing waiting for you on this agent.",
        tone: "muted",
      },
    ],
    running: false,
    hosted_on: [],
    favourite: false,
    ...over,
  } as AgentRow;
}

/* ---------------------------------------------------------------------- *
 * Every field is a string a card already prints
 * ---------------------------------------------------------------------- */

describe("the briefing rule", () => {
  it("takes each field from the function the card itself calls", () => {
    const agent = row();
    const [only] = briefingFor([agent]);

    expect(only?.title).toBe(agent.title);
    expect(only?.place).toBe(describeFleetPlace(agent.hosted_on).label);
    expect(only?.runs).toBe(describeRunCount(agent.run_count));
    expect(only?.last_run).toBe(plainDay(agent.last_run_at as string));
    // The chip's own sentence, verbatim. Two wordings of "needs your approval"
    // is one wording free to soften.
    expect(only?.standing).toBe(agent.glance[0]?.meaning);
    expect(only?.capabilities).toEqual(agent.capabilities);
  });

  /*
   * The question that failed station 11, and the reason this rule exists.
   * `describeFleetPlace` is the only place either word is decided, so a briefing
   * that says "Cloud" for a deployed agent and "Local" for one that is not is a
   * briefing a model can group correctly — and one a person can check against
   * the card behind the room without translating anything.
   */
  it("distinguishes local from cloud, in the card's own two words", () => {
    const rows = briefingFor([
      row({ name: "local-one" }),
      row({
        name: "cloud-one",
        hosted_on: [{ host_id: "h1", label: "My VPS", sent_on: "7 August 2026" }],
      }),
    ]);
    expect(rows.map((one) => one.place)).toEqual(["Local", "Cloud"]);
  });

  /*
   * `demandsOf` drops the all-clear chip because a list of agents waiting on
   * somebody should not include the ones that are fine. A briefing is the
   * opposite job — a description of every agent — so it keeps it, and this is
   * the assertion that stops somebody "fixing" one to match the other.
   */
  it("keeps the all-clear chip, unlike the standing answer's demand list", () => {
    const [only] = briefingFor([row()]);
    expect(only?.standing).toContain("nothing waiting for you");
  });

  it("leads with the most pressing chip when there is one", () => {
    const [only] = briefingFor([
      row({
        glance: [
          {
            question: "all_clear",
            label: "All clear",
            meaning: "DASH has nothing waiting for you on this agent.",
            tone: "muted",
          },
          {
            question: "needs_you",
            label: "Needs you",
            meaning: "This agent is waiting for you to approve something.",
            tone: "warn",
          },
        ],
      } as Partial<AgentRow>),
    ]);
    expect(only?.standing).toContain("waiting for you to approve");
  });

  it("bounds how many agents one question carries", () => {
    const many = Array.from({ length: MAX_BRIEFING_AGENTS + 5 }, (_, index) =>
      row({ name: `agent-${String(index)}` }),
    );
    expect(briefingFor(many)).toHaveLength(MAX_BRIEFING_AGENTS);
  });
});

/* ---------------------------------------------------------------------- *
 * What goes on the wire
 * ---------------------------------------------------------------------- */

describe("the briefing as the model sees it", () => {
  it("numbers the rows and labels every field", () => {
    const text = renderBriefing(briefingFor([row()]));
    expect(text).toContain("[1] AI News Scout");
    expect(text).toContain("Runs on: Local");
    expect(text).toContain("Standing:");
    expect(text).toContain("Activity: Run 3 times, last on 14 August 2026");
  });

  /*
   * The id is DASH's key for the row and the thing the receipt links out on. A
   * model given both a title and an identifier will eventually write the
   * identifier into a sentence, which is `lib/copy/identifiers.ts`' rule broken
   * by a model rather than by a person.
   */
  it("sends the title and never the agent id", () => {
    const text = renderBriefing(briefingFor([row()]));
    expect(text).toContain("AI News Scout");
    expect(text).not.toContain("ai-agent-news");
  });

  /*
   * ADR 0023 decision 7. A greeting goes through the same call with no rows —
   * not through a table of canned greetings, which would be a second personality
   * free to drift from the first. The empty case is still a sentence rather than
   * an empty string, so the operation's own non-empty rule holds without a
   * special case in it and the model is told the true thing.
   */
  it("says plainly when no records were read", () => {
    expect(renderBriefing([])).toBe(EMPTY_BRIEFING);
    expect(EMPTY_BRIEFING.length).toBeGreaterThan(0);
    expectPlainLanguage([EMPTY_BRIEFING]);
  });
});

/* ---------------------------------------------------------------------- *
 * The one sentence the chief's manifest puts on a screen
 * ---------------------------------------------------------------------- */

describe("the chief manifest's own copy", () => {
  /*
   * `everyChiefManifestSentence` is derived from the builder rather than written
   * out, which is the shape `everyFleetCatalogueSentence` established — and this
   * is the call that makes it worth anything.
   *
   * Worth saying why the assertion exists at all: on master its sibling has
   * **no caller**, so the pattern as inherited is a function that looks like a
   * gate and is not one. Writing a second unconsumed one would have been copy
   * with a plain-language walk that never runs over it, which is exactly the
   * failure mode this repository has already hit — a rule green everywhere and
   * unenforced on the field nobody feeds it.
   *
   * The connection's `purpose` is the one sentence a person could meet: it is
   * DASH's own description of DASH's own connection, and it would surface
   * wherever a capability card is drawn for the chief's manifest.
   */
  it("passes the plain-language walk for every provider", () => {
    const sentences = everyChiefManifestSentence();
    expect(sentences.length).toBeGreaterThan(0);
    expectPlainLanguage(sentences);
    for (const sentence of sentences) {
      expect(sentence.length).toBeGreaterThan(0);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Staleness — DASH comparing two of its own records
 * ---------------------------------------------------------------------- */

describe("when a stored turn stops describing the fleet", () => {
  const frozen = briefingFor([row()]);

  it("is unmarked while nothing has moved", () => {
    expect(fleetChangedSince(frozen, briefingFor([row()]))).toBe(false);
  });

  /*
   * Every field is compared, because every one of them is a sentence the answer
   * above could have been built on. These are the four a person would actually
   * notice, driven one at a time so a comparison quietly dropped from `sameRow`
   * fails here rather than in six months.
   */
  it("is marked when a fact in the receipt has changed", () => {
    const moved: Array<[string, AgentRow]> = [
      ["place", row({ hosted_on: [{ host_id: "h", label: "VPS", sent_on: null }] })],
      ["runs", row({ run_count: 4 })],
      ["last run", row({ last_run_at: "2026-08-16T09:00:00.000Z" })],
      ["title", row({ title: "The Scout" })],
      ["capabilities", row({ capabilities: ["public_feed_fetch"] })],
      [
        "standing",
        row({
          glance: [
            {
              question: "needs_you",
              label: "Needs you",
              meaning: "This agent is waiting for you to approve something.",
              tone: "warn",
            },
          ],
        } as Partial<AgentRow>),
      ],
    ];
    for (const [what, changed] of moved) {
      expect(fleetChangedSince(frozen, briefingFor([changed])), what).toBe(true);
    }
  });

  it("is marked when an agent has been added or removed", () => {
    expect(fleetChangedSince(frozen, [])).toBe(true);
    expect(fleetChangedSince(frozen, briefingFor([row(), row({ name: "second" })]))).toBe(true);
  });

  /*
   * ADR 0023 decision 7 again, from the staleness side. A greeting made no claim
   * about the fleet, so there is nothing about it the fleet could contradict —
   * and marking one would be DASH telling somebody their "hello" is out of date.
   */
  it("never marks a turn that read no records", () => {
    expect(fleetChangedSince([], briefingFor([row({ run_count: 99 })]))).toBe(false);
  });
});
