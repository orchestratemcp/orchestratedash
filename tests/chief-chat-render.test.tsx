/**
 * The chief's composer and its room, drawn (MAR-648, incorporated MAR-696).
 *
 * `renderToStaticMarkup`, like every render test here, so no effect runs and
 * nothing is clicked. What that reaches is the whole of what MAR-696's
 * corrected spec asked for on this surface — a rounded field with a perched O
 * and an enter glyph, a model line always visible underneath, and a room that
 * opens above the field with a visible heading and its own X and Clear —
 * because all four are markup and CSS rather than behaviour. What a static
 * render cannot reach is the Clear button's own effect, which is why that is
 * tested separately, as the pure function it is filtered through
 * (`visibleChiefTurns`, in `chief-chat-render.test.tsx`'s sibling file for
 * that reason — see the bottom of this file).
 *
 * The assertions worth reading are the negative ones: the chief never draws a
 * loader, the unprompted subject stays visible, and there is still no submit
 * button anywhere on this surface.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChiefChat, visibleChiefTurns } from "../app/_components/chief-chat";
import { CHIEF_CHAT_COPY } from "../lib/copy/chief-chat";
import type { AgentRow, ChiefRoomView, ChiefTurnView } from "../lib/views/types";

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
    glance: [],
    running: false,
    hosted_on: [],
    favourite: false,
    ...over,
  } as AgentRow;
}

function turn(over: Partial<ChiefTurnView> = {}): ChiefTurnView {
  return {
    id: 1,
    question: "how is my fleet doing",
    asked: "just now",
    answer: "Everything is quiet.",
    failure: null,
    from_records: true,
    handoffs: [],
    matched: [],
    receipt: [],
    receipt_note: "Nothing from your records was used for this one.",
    evidence: null,
    stale: false,
    model: null,
    charge: null,
    ...over,
  };
}

function view(over: Partial<ChiefRoomView> = {}): ChiefRoomView {
  return {
    can_ask: false,
    model_id: null,
    model_provider_id: null,
    model_is_own: false,
    blocked: null,
    turns: [],
    ...over,
  };
}

const NOOP = (): void => {
  /* nothing to do */
};

function chat(props: Partial<Parameters<typeof ChiefChat>[0]> = {}): string {
  return renderToStaticMarkup(
    <ChiefChat
      agents={[row()]}
      view={view()}
      canAct={false}
      onAsked={NOOP}
      open={false}
      onOpen={NOOP}
      onClose={NOOP}
      {...props}
    />,
  );
}

describe("the composer, collapsed", () => {
  it("draws a box a person can type in", () => {
    const html = chat();
    expect(html).toContain("<textarea");
    expect(html).toContain(CHIEF_CHAT_COPY.placeholder);
  });

  /*
   * MAR-696. Henrik's own words, both passes: "remove all excess... No
   * button" the first time, and the corrected spec still draws no button —
   * an enter glyph replaced the Ask button's position, not a second control.
   * Not "no button anywhere": the swap control and the room's own Clear/Close
   * are buttons too, and this asserts against the submit control by name.
   */
  it("draws no submit button — Enter is the only way to send", () => {
    const html = chat();
    expect(html).not.toContain(">Ask<");
    expect(html).not.toContain('class="primary"');
  });

  it("is never a dead input", () => {
    const html = chat();
    expect(html).toContain('<textarea class="chief-input"');
    expect(/<textarea[^>]*\sdisabled/.test(html)).toBe(false);
  });

  /*
   * MAR-659, compacted by MAR-742 roadmap item 1. `label`'s full sentence
   * used to be the visible line itself; it is the scope chip's `title` and
   * the field's `aria-label` now, and the chip's own short visible word is
   * `scope` — see "the chip row, above the field" below for both halves of
   * that claim.
   */
  it("keeps the composer's full sentence reachable, not deleted", () => {
    const html = chat();
    expect(html).toContain(CHIEF_CHAT_COPY.label);
  });

  /* MAR-696. Claude Code's own composer, the reference on the issue: an enter
     glyph inside the field on the right, standing in for the button that left. */
  it("draws an enter glyph, decorative and never a control", () => {
    const html = chat();
    expect(html).toContain('<span class="chief-enter-glyph" aria-hidden="true">');
    expect(html).toContain("↵");
  });

  it("draws no loader, because it never waits", () => {
    const html = chat();
    expect(html).not.toContain("ask-activity");
    /*
     * Exactly one animating O, and it is the chief's own perched composer
     * glyph — `ChiefComposerGlyph`, not the old `ChiefBand` portrait. An
     * animating O belonging to an agent, or a second one anywhere on this
     * surface, still fails.
     */
    expect(html.match(/is-action/g)).toHaveLength(1);
    expect(html).toContain('class="o-avatar chief-composer-o is-action"');
  });

  it("draws no room, because it is not open", () => {
    const html = chat();
    expect(html).not.toContain("chief-room");
  });

  it("is not marked is-open when closed", () => {
    const html = chat();
    expect(html).toContain('class="chief-composer"');
    expect(html).not.toContain("is-open");
  });
});

describe("the model chip, always drawn (MAR-696, ADR 0023 amendment 1; compacted MAR-742 roadmap item 1)", () => {
  it("names the chief's own pin, distinctly from the fleet default, in the chip's title", () => {
    const html = chat({
      view: view({ can_ask: true, model_id: "claude-haiku-4-5-20251001", model_provider_id: "anthropic", model_is_own: true }),
    });
    expect(html).toContain("The chief&#x27;s own model:");
    expect(html).toContain("claude-haiku-4-5-20251001");
    // Own pin — no FLEET DEFAULT companion chip beside it.
    expect(html).not.toContain(CHIEF_CHAT_COPY.fleet_default_chip);
  });

  it("names the fleet default when the chief has no pin of its own, and says so with a visible chip", () => {
    const html = chat({
      view: view({ can_ask: true, model_id: "gpt-5-mini", model_provider_id: "openai", model_is_own: false }),
    });
    expect(html).toContain("Asking under DASH&#x27;s fleet default:");
    expect(html).toContain("gpt-5-mini");
    /*
     * MAR-742 roadmap item 1, §4.1. The fact a `title` alone would hide —
     * `hidden text is still in the markup` — so this checks for the visible
     * companion chip, not only the attribute both cases carry.
     */
    expect(html).toContain(`class="chip chip-muted"`);
    expect(html).toContain(CHIEF_CHAT_COPY.fleet_default_chip);
  });

  it("draws the model chip as a button, with a popover trigger, only where a person can act", () => {
    const withAccess = chat({
      canAct: true,
      view: view({ can_ask: true, model_id: "gpt-5-mini", model_provider_id: "openai", model_is_own: false }),
    });
    expect(withAccess).toMatch(/<button[^>]*class="chip chip-model"[^>]*aria-haspopup="dialog"/);
    expect(withAccess).toContain(CHIEF_CHAT_COPY.model_chip_label);

    const readOnly = chat({
      canAct: false,
      view: view({ can_ask: true, model_id: "gpt-5-mini", model_provider_id: "openai", model_is_own: false }),
    });
    expect(readOnly).not.toMatch(/<button[^>]*class="chip chip-model"/);
    expect(readOnly).toContain('<span class="chip chip-model"');
  });

  it("says no model is set with a warn chip, and links to Settings only where a person can act", () => {
    const withAccess = chat({ canAct: true });
    expect(withAccess).toContain(CHIEF_CHAT_COPY.no_model_chip);
    expect(withAccess).toContain(CHIEF_CHAT_COPY.no_model);
    expect(withAccess).toContain(CHIEF_CHAT_COPY.no_model_link);
    expect(withAccess).toMatch(/<a[^>]*class="chip chip-warn chip-link"[^>]*href="\/settings\/ai"/);

    const readOnly = chat({ canAct: false });
    expect(readOnly).toContain(CHIEF_CHAT_COPY.no_model_chip);
    expect(readOnly).toContain(CHIEF_CHAT_COPY.no_model);
    expect(readOnly).not.toContain(CHIEF_CHAT_COPY.no_model_link);
    expect(readOnly).not.toContain('href="/settings/ai"');
  });

  it("is not `.chief-settings`, the standing scope note MAR-683 removed", () => {
    const html = chat({
      view: view({ can_ask: true, model_id: "gpt-5-mini", model_provider_id: "openai", model_is_own: false }),
    });
    expect(html).not.toContain("chief-settings");
    expect(html).not.toContain("I read your own records");
    expect(html).not.toContain("Nothing said here is saved");
  });
});

describe("the chip row, above the field (MAR-742 roadmap item 1)", () => {
  it("draws the scope chip with the composer's full sentence as its title", () => {
    const html = chat();
    expect(html).toContain(`class="chip" title="${CHIEF_CHAT_COPY.label}"`);
    expect(html).toContain(`>${CHIEF_CHAT_COPY.scope}<`);
  });

  it("carries the composer's accessible name as an aria-label now, not a visible line", () => {
    const html = chat();
    expect(html).toContain(`aria-label="${CHIEF_CHAT_COPY.label}"`);
    expect(html).not.toContain('class="chief-subject"');
  });

  it("draws no decisions chip when there are none to show", () => {
    const html = chat({ decisionsTotal: 0 });
    expect(html).not.toContain('href="/decisions"');
  });

  it("draws a decisions chip, singular and plural, linking to the log", () => {
    const one = chat({ decisionsTotal: 1 });
    expect(one).toContain('href="/decisions"');
    expect(one).toContain(">1 decision<");

    const many = chat({ decisionsTotal: 5 });
    expect(many).toContain(">5 decisions<");
  });
});

describe("the room opens above the composer", () => {
  it("shows a visible heading now, and the composer stays after it in source order", () => {
    const html = chat({ open: true });
    // MAR-696 brought the heading back as text a sighted reader sees, not
    // only an `aria-label` — the reversal of MAR-683's own choice, made for
    // a different room this time (the Clear button beside it is new).
    expect(html).toContain(`<p class="chief-room-heading">${CHIEF_CHAT_COPY.heading}</p>`);
    // `class="chief-compose"` rather than the bare substring "chief-compose",
    // which is also a prefix of the outer wrapper's own "chief-composer" —
    // an unquoted match would find that first and report the room as later
    // in source order than it actually is.
    expect(html.indexOf('class="chief-room"')).toBeLessThan(html.indexOf('class="chief-compose"'));
  });

  it("draws an X to collapse and a Clear button, both MAR-683 removed and MAR-696 restores", () => {
    const html = chat({ open: true, view: view({ turns: [turn()] }) });
    expect(html).toContain('class="chief-room-close"');
    expect(html).toContain("Close the chief");
    expect(html).toContain('class="chief-room-clear"');
    expect(html).toContain(">Clear<");
    // The visible label stays short — every button in this system renders
    // upper-case, and a full sentence shouted in caps reads as an alarm.
    // The fuller, honest scope is still reachable, as `title`.
    expect(html).toContain("Clears what");
  });

  it("disables Clear when there is nothing to clear", () => {
    const html = chat({ open: true, view: view({ turns: [] }) });
    expect(/class="chief-room-clear"[^>]*\sdisabled/.test(html)).toBe(true);
  });

  it("leaves Clear enabled once a turn exists", () => {
    const html = chat({ open: true, view: view({ turns: [turn()] }) });
    expect(/class="chief-room-clear"[^>]*\sdisabled/.test(html)).toBe(false);
  });

  it("no longer tells a returning reader their conversation was cleared", () => {
    const html = chat({ open: true });
    expect(html).not.toContain("Nothing said here is saved");
    expect(html).not.toContain("is expected, not a lost conversation");
  });

  it("leaves the box working with no model configured and nothing asked", () => {
    const html = chat({ open: true });
    expect(html).not.toContain("chief-blocked");
    expect(html).not.toContain("chief-scope");
    expect(html).toContain('<textarea class="chief-input"');
    expect(/<textarea[^>]*\sdisabled/.test(html)).toBe(false);
  });

  it("marks the composer itself while its room is open", () => {
    const html = chat({ open: true });
    expect(html).toContain("chief-composer is-open");
  });

  it("draws every turn handed to it", () => {
    const html = chat({
      open: true,
      view: view({ turns: [turn({ id: 1, question: "one" }), turn({ id: 2, question: "two" })] }),
    });
    expect(html).toContain("one");
    expect(html).toContain("two");
  });

  it("keeps the header — and its Close/Clear controls — outside the scrolling transcript (MAR-706)", () => {
    const html = chat({ open: true, view: view({ turns: [turn()] }) });
    const headOpen = html.indexOf('<div class="chief-room-head"');
    const scrollOpen = html.indexOf('<div class="chief-room-scroll"');
    const closeButton = html.indexOf('class="chief-room-close"');
    const clearButton = html.indexOf('class="chief-room-clear"');
    expect(headOpen).toBeGreaterThan(-1);
    expect(scrollOpen).toBeGreaterThan(-1);
    // `.chief-room-head` renders — and closes — before `.chief-room-scroll`
    // opens, so it is that box's sibling rather than a descendant of it: the
    // transcript can scroll on its own without ever carrying the header, the
    // X, or Clear off screen with it.
    expect(headOpen).toBeLessThan(scrollOpen);
    expect(closeButton).toBeLessThan(scrollOpen);
    expect(clearButton).toBeLessThan(scrollOpen);
  });
});

describe("the composer without handlers", () => {
  it("still renders when only the required props are given", () => {
    expect(() =>
      renderToStaticMarkup(
        <ChiefChat
          agents={[]}
          view={view()}
          canAct={false}
          onAsked={NOOP}
          open={false}
          onOpen={NOOP}
          onClose={NOOP}
        />,
      ),
    ).not.toThrow();
  });
});

/* ---------------------------------------------------------------------- *
 * `visibleChiefTurns`: the Clear button's own effect, pure (MAR-696)
 * ---------------------------------------------------------------------- */

describe("visibleChiefTurns — what Clear actually filters", () => {
  it("returns every turn when nothing has been cleared", () => {
    const turns = [turn({ id: 1 }), turn({ id: 2 })];
    expect(visibleChiefTurns(turns, null)).toEqual(turns);
  });

  it("drops every turn at or before the cleared boundary", () => {
    const turns = [turn({ id: 1 }), turn({ id: 2 }), turn({ id: 3 })];
    expect(visibleChiefTurns(turns, 2).map((t) => t.id)).toEqual([3]);
  });

  it("keeps a turn asked after the clear", () => {
    const turns = [turn({ id: 1 })];
    // Cleared through id 1, then a new turn (id 2) arrives — the ordinary
    // shape once `onAsked` re-reads the view after a fresh question.
    const next = [...turns, turn({ id: 2 })];
    expect(visibleChiefTurns(next, 1).map((t) => t.id)).toEqual([2]);
  });

  it("clears to empty when every turn is at or before the boundary", () => {
    const turns = [turn({ id: 1 }), turn({ id: 2 })];
    expect(visibleChiefTurns(turns, 2)).toEqual([]);
  });
});
