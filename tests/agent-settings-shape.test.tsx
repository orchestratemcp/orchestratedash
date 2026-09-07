/**
 * The Settings stage's shape, and the budget that keeps it (MAR-874).
 *
 * ## The complaint this file is the gate on
 *
 * Henrik's account of this stage was a count rather than an objection to any
 * one sentence: seven sections and roughly forty sentences standing between him
 * and the three facts the page exists to state — where the agent runs, when it
 * runs, and which model it talks with.
 *
 * The rule adopted in answer is that **each section shows its current state in
 * one sentence and offers one action, and every explanation moves behind a
 * *Why?* that is closed by default**. That rule is easy to write and easy to
 * lose: the next person with a true and useful sentence puts it above the fold,
 * and the person after that does the same, and in four packets the stage is
 * what it was. So the budget is asserted rather than described.
 *
 * ## Why the count is of *visible* sentences and not of strings
 *
 * "Moves behind a disclosure" is exactly the distinction a naive copy grep
 * cannot see: hidden text is still in the markup, and a `details` keeps its
 * content in the DOM whether or not it is open. So `visible()` below strips the
 * contents of every `details` element before counting — which is the only
 * reading of this rule that a test can hold and a person can feel.
 *
 * ## What this file is careful not to assert
 *
 * That anything was deleted. Nothing was. Each disclosure's own contents are
 * asserted present, because the value of the restructure depends entirely on
 * the warnings still being one press away rather than gone — ADR 0029's third
 * liveness sentence and MAR-784's spending line in particular.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentSettings } from "../app/_components/agent-settings";
import { AGENT_SETTINGS_COPY, AGENT_TRIGGER_COPY } from "../lib/copy/agent-page";
import { buildAgentScheduleView } from "../lib/views/agent-schedule";
import type { AgentSchedule } from "../lib/schedule/plan";

const SCHEDULED: AgentSchedule = {
  agent: "scout",
  enabled: true,
  kind: "daily",
  at_local: "18:20",
  created_at: "2026-09-01T12:00:00.000Z",
  allowance_calls: 2,
};

/**
 * The stage with a stand-in in each of its four slots.
 *
 * Stand-ins rather than the real `DeployToServer`, `ModelChoice`,
 * `FolderUpdate` and `RemoveAgent`, deliberately: those four have their own
 * render tests, and this file is about the frame — the order of the sections,
 * what is above the fold, and what is one press under it. A stand-in also makes
 * the budget below meaningful rather than a measurement of whichever component
 * happened to be wordiest.
 *
 * `"schedule" in over` rather than `??`, so a test can ask for **no** schedule.
 * Null is a value this component has a state for and `??` would swallow it.
 */
function stage(
  over: { schedule?: AgentSchedule | null; canAct?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <AgentSettings
      avatar={null}
      canAct={over.canAct ?? true}
      id="ai-news-scout"
      onAvatarChanged={() => undefined}
      onClose={() => undefined}
      onRenamed={() => undefined}
      renamed={false}
      schedule={buildAgentScheduleView("schedule" in over ? over.schedule ?? null : SCHEDULED, [])}
      setFeedback={() => undefined}
      title="Proof Scout"
      trigger={null}
      where={<p>Where stands here.</p>}
      model={<p>Model stands here.</p>}
      advanced={<p>Advanced stands here.</p>}
      danger={<p>Danger stands here.</p>}
    />,
  );
}

/**
 * The markup with every `details` element's contents removed.
 *
 * Non-greedy and repeated until it stops changing, so nested disclosures — the
 * per-step levels inside the model row's Why?, which is a `details` inside a
 * `details` — are stripped along with their parent rather than leaving their
 * innards behind.
 */
function visible(html: string): string {
  let out = html;
  for (;;) {
    const next = out.replaceAll(/<details\b[^>]*>[\s\S]*?<\/details>/g, "<details></details>");
    if (next === out) {
      return next;
    }
    out = next;
  }
}

/** The words, without the markup. Attribute names are not copy. */
function text(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&mdash;", "—")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * Sentences a person sees before opening anything.
 *
 * Counted by terminators rather than by paragraphs, because the failure this
 * guards against is a paragraph that grows rather than a paragraph that is
 * added. Question marks count: *Why?* is a summary and is deliberately not
 * inside a `details` body, so it is one of the things being budgeted.
 */
function sentences(html: string): string[] {
  return text(visible(html))
    .split(/(?<=[.!?])\s+/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0);
}

describe("the Settings stage, closed", () => {
  /**
   * The budget. Twenty-five, against a stage that had roughly forty.
   *
   * A ceiling and not a target: the number is deliberately loose enough that an
   * honest new state sentence fits, and tight enough that a paragraph of
   * explanation does not. If a future packet needs to raise it, raising it in
   * the diff — beside the sentence that needed the room — is the whole point.
   */
  it("fits inside its sentence budget with every disclosure closed", () => {
    const drawn = sentences(stage());
    expect(drawn.length, drawn.join("\n")).toBeLessThanOrEqual(25);
  });

  /**
   * The order, which is the answer to the three questions the stage exists for.
   *
   * Asserted by position rather than by presence, because presence was never
   * the problem — every one of these was already on the page, in an order
   * nobody had chosen.
   */
  it("answers where, when and which model, in that order", () => {
    const html = stage();
    const at = (needle: string): number => {
      const index = html.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    expect(at(AGENT_SETTINGS_COPY.identity.heading)).toBeLessThan(
      at(AGENT_TRIGGER_COPY.heading),
    );
    expect(at(AGENT_TRIGGER_COPY.heading)).toBeLessThan(
      at(AGENT_SETTINGS_COPY.advanced.heading),
    );
    expect(at(AGENT_SETTINGS_COPY.advanced.heading)).toBeLessThan(
      at(AGENT_SETTINGS_COPY.danger.heading),
    );
  });

  /**
   * The two sections that are decisions nobody arrives with, and one of them is
   * the only one on the stage whose presses cannot be undone.
   *
   * Collapsed, not removed: MAR-595's finding was that the removal buttons were
   * unfindable, not that they were too easy to press, and a summary that says
   * *Remove this agent* is one press from anybody who came for it.
   */
  it("collapses Advanced and Remove rather than dropping them", () => {
    const html = stage();
    expect(html).toContain(`<summary>${AGENT_SETTINGS_COPY.advanced.heading}</summary>`);
    expect(html).toContain(`<summary>${AGENT_SETTINGS_COPY.danger.heading}</summary>`);
    // Closed: no `details` on this stage is rendered open, so the shape does not
    // depend on which section a previous visit happened to leave expanded.
    expect(html).not.toContain("<details open");
  });
});

describe("what moved behind Why?, and is still there", () => {
  /**
   * ADR 0029's three liveness sentences and MAR-784's spending line.
   *
   * These are the sentences it would be worst to lose, which is exactly why
   * they are the ones asserted: the third liveness sentence is the whole of
   * what ADR 0007 left open, and the spending line is the sentence that costs
   * this feature something. Both are one press under a question, and neither is
   * on the first screen.
   */
  it("keeps every warning a schedule owes a person, one press away", () => {
    const html = stage();
    const words = text(html);
    const shown = text(visible(html));

    for (const sentence of AGENT_TRIGGER_COPY.liveness) {
      expect(words).toContain(text(sentence));
      expect(shown).not.toContain(text(sentence));
    }
    const spend = AGENT_TRIGGER_COPY.spend.allowed(2);
    expect(words).toContain(text(spend));
    expect(shown).not.toContain(text(spend));
    expect(words).toContain(text(AGENT_TRIGGER_COPY.spend.needs_dash_open));
  });

  /**
   * The identity row's provenance sentences and the id.
   *
   * MAR-589's ruling is untouched — the id is still a value, still in `code`
   * type, still on the page. It is behind the question a person asks about it
   * once, which is where an answer nobody is currently asking for belongs.
   */
  it("keeps the id and where the name came from, one press away", () => {
    const html = stage();
    expect(text(html)).toContain(AGENT_SETTINGS_COPY.identity.name_source);
    expect(text(visible(html))).not.toContain(AGENT_SETTINGS_COPY.identity.name_source);
    // The id itself, as prose. `text` first: the id is also a `for`/`id`
    // attribute on the schedule field, and an attribute is not copy — a raw
    // markup check here would read the label's plumbing as a visible
    // identifier and pass for the wrong reason.
    expect(text(html)).toContain("ai-news-scout");
    expect(text(visible(html))).not.toContain("ai-news-scout");
  });

  /**
   * The state line itself is never behind the press.
   *
   * The whole exchange this packet made is *one sentence in the open for every
   * paragraph folded away*, and a fold that swallowed the sentence too would be
   * the bad half of it with none of the good.
   */
  it("leaves the schedule's own state sentence in the open", () => {
    const shown = text(visible(stage()));
    expect(shown).toContain(AGENT_TRIGGER_COPY.standing("18:20"));
    expect(text(visible(stage({ schedule: null })))).toContain(
      AGENT_TRIGGER_COPY.none_standing,
    );
  });

  /**
   * A browser tab still gets the sentence rather than a dead control, which is
   * `lib/workspace.ts`'s rule and is unchanged by any of this.
   */
  it("tells a read-only window which window it is", () => {
    expect(text(stage({ canAct: false }))).toContain(
      AGENT_SETTINGS_COPY.identity.rename_read_only,
    );
  });
});
