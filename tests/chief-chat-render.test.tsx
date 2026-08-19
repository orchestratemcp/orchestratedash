/**
 * The chief's composer and its room, drawn (MAR-648, floating since MAR-696).
 *
 * `renderToStaticMarkup`, like every render test here, so no effect runs and
 * nothing is clicked. What that reaches is the whole of what MAR-648 asked for
 * on this surface — a box, focus opens a room above it, and the composer does
 * not move — because all three are markup and CSS rather than behaviour.
 *
 * The assertions worth reading are the negative ones: the chief never draws a
 * loader, the unprompted line steps aside rather than sitting above a
 * conversation, and MAR-696 left no button anywhere on this surface.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChiefBand } from "../app/_components/fleet-list";
import { CHIEF_CHAT_COPY } from "../lib/copy/chief-chat";
import { GLANCE_ALL_CLEAR, type GlanceChip } from "../lib/copy/glance";
import type { AgentRow } from "../lib/views/types";

const NEEDS_YOU: GlanceChip = {
  question: "needs_you",
  label: "needs you",
  meaning: "This agent is waiting for you to approve something before it can carry on.",
  tone: "warn",
};

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    name: "ai-agent-news",
    title: "AI agent news",
    goal: "Collect news about ai agents from public feeds and write a digest.",
    capabilities: ["public_feed_fetch", "digest_compose"],
    plan_source: "orchestratekit",
    build_target: "node",
    planned_steps: 2,
    automation_clearance: "manual",
    run_count: 3,
    last_run_at: null,
    origin: { kind: "watched_only" },
    compliance: {
      runs_considered: 0,
      gate_violation_runs: 0,
      drifted_runs: 0,
      clearance_flagged_runs: 0,
    },
    avatar: "ninja",
    deploy: { deployable: false, reason: "no_folder" },
    glance: [GLANCE_ALL_CLEAR],
    running: false,
    hosted_on: [],
    favourite: false,
    ...over,
  } as AgentRow;
}

function band(props: Parameters<typeof ChiefBand>[0]): string {
  return renderToStaticMarkup(<ChiefBand {...props} />);
}

describe("the chief's band carries a composer", () => {
  it("draws a box a person can type in", () => {
    const html = band({ agent: row(), agents: [row()] });
    expect(html).toContain("<textarea");
    expect(html).toContain(CHIEF_CHAT_COPY.placeholder);
  });

  /*
   * MAR-696. Henrik's own words: *"remove all excess... No button."* The
   * placeholder above is now the only place that says how to send a question —
   * `describeAskActivity`'s honesty rule applied to a control instead of a
   * sentence: an affordance that moves has to still be findable somewhere.
   *
   * Not "no button anywhere": the all-clear chip's own `InfoNote` still draws
   * one (its "what this means" disclosure, unrelated to sending a question),
   * so the assertion is against the submit control by name rather than against
   * every `<button` in the band.
   */
  it("draws no submit button — Enter is the only way to send", () => {
    const html = band({ agent: row(), agents: [row()] });
    expect(html).not.toContain(">Ask<");
    expect(html).not.toContain('class="primary"');
  });

  /*
   * `ask.tsx`'s standing rule, which is why this band refused to draw a box for
   * as long as MAR-419 was unbuilt. It is satisfied differently here: the box is
   * live because every press produces a real answer out of records, not because
   * a model was wired up.
   */
  it("is never a dead input", () => {
    const html = band({ agent: row(), agents: [row()] });
    /*
     * The box is live, and MAR-696 left it the only control on this surface:
     * there is no button left to disable on an empty press, only `ask()`'s own
     * early return (`chief-chat.tsx`) for a question that is all whitespace.
     */
    expect(html).toContain('<textarea class="chief-input"');
    expect(/<textarea[^>]*\sdisabled/.test(html)).toBe(false);
  });

  it("draws no standing scope note or model line — MAR-683 moved that to per-turn provenance", () => {
    // MAR-683. The closed band used to carry `.chief-settings`, a scope
    // headline and (once a model was set) its id, on screen whether or not the
    // room was even open. That line is gone: what model answered, and what it
    // read, is now said once per turn, in the receipt beside the answer it
    // belongs to — never as a standing indicator nobody asked to see yet.
    const html = band({ agent: row(), agents: [row()] });
    expect(html).not.toContain("chief-settings");
    expect(html).not.toContain("I read your own records");
    expect(html).not.toContain("Nothing said here is saved");
    expect(html).not.toContain("Asking under");
  });

  /*
   * MAR-659. The fleet is this composer's subject and it used to be
   * announcement-only — `CHIEF_CHAT_COPY.label` inside a `visually-hidden`
   * span. A person should not need a screen reader to learn this box is not
   * one particular agent's.
   */
  it("says whose composer this is, in words a sighted reader sees too", () => {
    const html = band({ agent: row(), agents: [row()] });
    expect(html).toContain(CHIEF_CHAT_COPY.label);
    expect(html).not.toContain(`<span class="visually-hidden">${CHIEF_CHAT_COPY.label}</span>`);
  });

  /*
   * The chief answers from props, in the same tick. A loader over a synchronous
   * read would be the same fabrication MAR-648 forbids on the agent page,
   * wearing the opposite costume — theatre asserting work where there is none.
   */
  it("draws no loader, because it never waits", () => {
    const html = band({ agent: row(), agents: [row()] });
    expect(html).not.toContain("ask-activity");
    /*
     * This line used to read `not.toContain("is-action")`, and MAR-615 made
     * that assertion mean something it was never written to mean. `is-action`
     * was a fair proxy for the loader when the only animated O on this band
     * would have been one put there by work in flight; the chief was inline
     * rects and could not carry it. The chief now has a vendored baton-wave
     * idle sheet, so the class is on this band every time it draws, and the
     * bare assertion would forbid the portrait rather than the loader.
     *
     * What still says what this test means is *how many* O's animate here and
     * *which*: exactly one, and it is the chief's own portrait. An animating O
     * belonging to an agent — the shape a loader would take, whether or not it
     * came wrapped in `.ask-activity` — still fails.
     */
    expect(html.match(/is-action/g)).toHaveLength(1);
    expect(html).toContain('class="o-avatar chief-glyph is-action"');
  });
});

describe("the room opens above the composer", () => {
  it("shows the composer, named for a screen reader, when it is open and nothing is asked", () => {
    const html = band({ agent: row(), agents: [row()], chatOpen: true });
    // MAR-683 dropped the visible `<h2>` and the Clear/Close button-links —
    // Escape already closes the room, from anywhere in it, not only from the
    // composer (see the component's own header). What survives is the
    // accessible name, now carried as an `aria-label` rather than a heading a
    // sighted reader had to read past on every open.
    expect(html).toContain(`aria-label="${CHIEF_CHAT_COPY.heading}"`);
    expect(html).not.toContain("chief-room-head");
    expect(html).not.toContain("chief-room-actions");
    // The composer is still there, and after the room in the document — which
    // is what "the room appears above it" means in a source order.
    expect(html.indexOf("chief-room")).toBeLessThan(html.indexOf("chief-compose"));
  });

  /*
   * MAR-659, ADR 0023. Henrik's own report: he changed view, came back, and the
   * thread was blank.
   *
   * The shape half of that issue answered it by explaining the emptiness —
   * *"leaving this page clears this chat"* — which was the honest thing to say
   * about a chief that really did forget. MAR-659 removed the cause; MAR-683
   * then removed the scope note itself as standing chrome. Both wordings stay
   * refused: a thread that survives must not carry a sentence telling a reader
   * it does not, whether or not anything else replaces it.
   */
  it("no longer tells a returning reader their conversation was cleared", () => {
    const html = band({ agent: row(), agents: [row()], chatOpen: true });
    expect(html).not.toContain("Nothing said here is saved");
    expect(html).not.toContain("is expected, not a lost conversation");
  });

  /*
   * MAR-683. The always-on "I can read your records, but I cannot write you a
   * sentence yet" block is gone — `performChiefAction` already puts the same
   * headline in a turn's own feedback line on the one path that needs it (a
   * question that would have gone to a model), which `describeChiefNoModel`'s
   * own unit test in `chief-chat-copy.test.ts` still covers. What a static
   * render can still prove, and what actually matters here, is the standing
   * half of MAR-659's rule: with no model configured and nothing asked yet, the
   * box is not greyed out. A composer disabled here would be a dead input where
   * the records-only question still works.
   */
  it("leaves the box working with no model configured and nothing asked", () => {
    const html = band({ agent: row(), agents: [row()], chatOpen: true });
    expect(html).not.toContain("chief-blocked");
    expect(html).not.toContain("chief-scope");
    expect(html).toContain('<textarea class="chief-input"');
    expect(/<textarea[^>]*\sdisabled/.test(html)).toBe(false);
  });

  /*
   * Both are the chief talking. Leaving them together would put a sentence
   * about whichever card is centred directly above a conversation about
   * something the person actually asked — one speaker saying two unrelated
   * things at once, which is MAR-646's duplication rather than a second opinion.
   */
  it("puts the unprompted line away while the room is open", () => {
    const closed = band({ agent: row({ glance: [NEEDS_YOU] }), agents: [row({ glance: [NEEDS_YOU] })] });
    const open = band({
      agent: row({ glance: [NEEDS_YOU] }),
      agents: [row({ glance: [NEEDS_YOU] })],
      chatOpen: true,
    });
    expect(closed).toContain(NEEDS_YOU.meaning);
    expect(open).not.toContain(NEEDS_YOU.meaning);
  });

  it("keeps the chief's glyph, because that is who is speaking", () => {
    const html = band({ agent: row(), agents: [row()], chatOpen: true });
    expect(html).toContain("chief-glyph");
  });

  /*
   * MAR-696 stopped the cards giving up any height for an open room — the room
   * floats over them now (`app/globals.css`'s `.chief-chat`) rather than
   * growing the stage's own row. `is-chatting` survives as the band's own
   * open-state marker, which is what lets the docked band's border pick up the
   * accent while its floating room is showing.
   */
  it("marks the band itself while its floating room is open", () => {
    const html = band({ agent: row(), agents: [row()], chatOpen: true });
    expect(html).toContain("is-chatting");
  });
});

describe("the band without a chat", () => {
  /*
   * `ChiefBand` is exported for render tests that predate the composer and hold
   * no open state. A required handler would have made the band untestable to
   * keep a prop only one caller in the application can supply.
   */
  it("still renders when no handlers are given", () => {
    expect(() => band({ agent: row(), agents: [row()] })).not.toThrow();
  });
});
