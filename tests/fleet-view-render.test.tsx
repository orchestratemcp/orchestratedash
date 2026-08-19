/**
 * The fleet's three views, drawn (MAR-612).
 *
 * `tests/fleet-view.test.ts` drives the setting and the stylesheet. This drives
 * the things on screen, for `tests/fleet-connector-render.test.tsx`' reason: a
 * photograph proves a state was drawn once on one machine, and this proves it is
 * still drawn on every run.
 *
 * ## What this can and cannot reach
 *
 * Every render test in this repository is `renderToStaticMarkup`, so no effect
 * runs, there is no `localStorage` and there is no scroll container. That is
 * exactly the environment the *packaged renderer's first frame* is built in, so
 * what it proves is worth having: the default view is what a cold render draws,
 * and the card is complete before a single hook has fired.
 *
 * The spotlight's own chrome is driven directly — `spotlightPosition` is
 * exported for this — because there is no way to give a static render a
 * scroll position.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { describeRunCount } from "../app/_components/fleet-card";
import { FleetList, spotlightPosition } from "../app/_components/fleet-list";
import { FleetRail } from "../app/_components/fleet-rail";
import { FleetViewToggle } from "../app/_components/fleet-view-toggle";
import { FLEET_CARD_STATUSES, describeFleetCardStatus } from "../lib/copy/fleet-status";
import { FLEET_VIEWS, describeFleetView } from "../lib/views/fleet-view";
import { GLANCE_ALL_CLEAR } from "../lib/copy/glance";
import type { AgentRow } from "../lib/views/types";

/*
 * MAR-640. `FleetList` now calls `useRouter` for Enter-to-open in Rows —
 * `tests/sidebar.test.tsx`'s own precedent for the same reason: a static
 * render has no app-router context to invariant-check against, and every
 * render test in this file is exactly that render.
 */
vi.mock("next/navigation", () => ({
  useRouter: (): { push: (href: string) => void } => ({ push: () => undefined }),
}));

function agent(over: Partial<AgentRow> = {}): AgentRow {
  return {
    name: "news-scout",
    title: "News Scout",
    goal: "Read the news sources you choose and write a short summary.",
    plan_source: "OrchestrateKit",
    build_target: "local",
    planned_steps: 3,
    automation_clearance: "ask first",
    run_count: 3,
    last_run_at: "2026-08-13T09:00:00.000Z",
    origin: { kind: "sample", detail: null },
    compliance: { runs: 3, clean: 3, verdict: "clean", label: "3/3 clean", tone: "muted" },
    avatar: "ninja",
    deploy: { can_deploy: true, refusal: null },
    glance: [GLANCE_ALL_CLEAR],
    hosted_on: [],
    running: false,
    favourite: false,
    ...over,
  } as AgentRow;
}

describe("the layout control", () => {
  const markup = renderToStaticMarkup(<FleetViewToggle />);

  it("offers all three views at once rather than cycling through them", () => {
    /*
     * A button that cycles can only name one of the two states it is not showing,
     * so the third is reachable by pressing twice and finding out. Three radios
     * state all three and mark the one in force.
     */
    for (const view of FLEET_VIEWS) {
      expect(markup).toContain(`value="${view}"`);
      expect(markup).toContain(describeFleetView(view).label);
    }
    expect([...markup.matchAll(/type="radio"/g)]).toHaveLength(3);
  });

  it("marks the default on a cold render", () => {
    // The first frame of the packaged renderer, before any effect has read the
    // document. It must show a state rather than none — a radio group with
    // nothing checked is a control that looks broken until it is touched.
    const checked = [...markup.matchAll(/<input[^>]*checked[^>]*>/g)];
    expect(checked).toHaveLength(1);
    expect(checked[0]?.[0]).toContain('value="grid"');
  });

  it("keeps one radio group, so the browser supplies the arrow keys", () => {
    // Real inputs sharing one `name` is what gives this a roving tab stop and
    // arrow-key movement without a line of JavaScript.
    expect([...markup.matchAll(/name="fleet-view"/g)]).toHaveLength(3);
  });

  it("puts each option's sentence on hover and nowhere on screen", () => {
    /*
     * The standing instruction: one label per control, explanation on hover at
     * most. The sentence is a `title`, and the visible text is the one word.
     */
    for (const view of FLEET_VIEWS) {
      const copy = describeFleetView(view);
      expect(markup).toContain(copy.description);
      // The description appears exactly once — as the title — rather than also
      // as body text under the control.
      const occurrences = markup.split(copy.description).length - 1;
      expect(occurrences, `${view}'s sentence is on screen as well as on hover`).toBe(1);
    }
  });

  it("names the group off screen, because three one-word options name nothing alone", () => {
    /*
     * MAR-639's text axe. The legend still exists for a screen reader —
     * `<fieldset>` needs an accessible name — but is no longer visible text
     * above three already-labelled, already-pictured options.
     */
    expect(markup).toContain('<legend class="visually-hidden">');
  });
});

describe("the agents page rail", () => {
  const markup = renderToStaticMarkup(<FleetRail agents={[]} />);

  it("is a named aside, not a row above the cards", () => {
    expect(markup).toContain('class="fleet-rail"');
    expect(markup).toContain('aria-label="Agent actions"');
  });

  it("holds Add agent, the filter and the three-view control together", () => {
    expect(markup).toContain('href="/settings/add-agent"');
    expect(markup).toContain("Add agent");
    expect(markup).toContain("fleet-view-toggle");
    // Six filter options plus the three views — one radio group each.
    expect([...markup.matchAll(/type="radio"/g)]).toHaveLength(9);
  });

  it("names the filter group and shows all six options, MAR-640", () => {
    expect(markup).toContain(">Show<");
    for (const label of ["All", "Needs action", "Running", "Ready", "Not run", "Favourites"]) {
      expect(markup).toContain(`>${label}<`);
    }
  });

  it("counts render from a real fleet, even at zero", () => {
    const zero = renderToStaticMarkup(<FleetRail agents={[]} />);
    // Every count is 0 when the fleet is empty — the row is drawn either way.
    expect([...zero.matchAll(/fleet-filter-count[^>]*>(\d+)</g)]).toHaveLength(6);
  });
});

describe("the list a cold render draws", () => {
  const markup = renderToStaticMarkup(
    <FleetList
      agents={[agent(), agent({ name: "digest", title: "Digest", avatar: "wizard" })]}
    />,
  );

  it("is the ordered list every other record surface uses", () => {
    // The list stays a list: ordered markup is what says these are records in
    // order to anything that is not looking at the screen.
    expect(markup).toContain('<ol class="row-list fleet-grid"');
  });

  it("draws every agent, with nothing waiting on a hook", () => {
    expect(markup).toContain("News Scout");
    expect(markup).toContain("Digest");
    expect([...markup.matchAll(/class="row-card fleet-card/g)]).toHaveLength(2);
  });

  it("marks local or cloud on every card", () => {
    expect([...markup.matchAll(/>Local</g)]).toHaveLength(2);
  });

  it("opens every agent from its own card, not just the one the chief is talking about (MAR-660)", () => {
    /*
     * Henrik, station 11 of his 2026-08-16 attended pass, verbatim: "under the
     * avatar in the card for every agent." A cold render has no effect and
     * therefore no `localStorage`, so `useFleetView` cannot resolve anything
     * but the default — this is the grid path, where `FleetOpenLink` draws for
     * every card; Rows' own omission is Electron-capture evidence, not
     * something a static render can exercise (`useFleetView` never sees the
     * document's `data-fleet-view` attribute without an effect).
     */
    expect([...markup.matchAll(/class="fleet-open"/g)]).toHaveLength(2);
    expect(markup).toContain('href="/agents/detail?agent=news-scout"');
    expect(markup).toContain('aria-label="Open News Scout"');
    expect(markup).toContain('href="/agents/detail?agent=digest"');
    expect(markup).toContain('aria-label="Open Digest"');
  });

  it("takes no tab stop when it is not a scroll container", () => {
    /*
     * The `tabIndex` and the label are the spotlight's, because there the `<ol>`
     * scrolls and a scrolling region has to be focusable and named. In the grid
     * it is an ordinary list, and a tab stop on it would be furniture between a
     * keyboard and the cards.
     */
    expect(markup).not.toContain('tabindex="0"');
  });

  it("stays a portrait, and draws no glance chip's full sentence inline", () => {
    /*
     * `lib/views/fleet-view.ts`'s rule from the markup's side: the views are
     * three tracks over one `FleetCard`, so a chip cannot exist in one view
     * and not another — and the card is a portrait in all three, never a
     * sentence.
     *
     * This used to also assert the chip's full sentence reached the page
     * through `ChiefBand`'s unprompted line — `expect(markup).toContain(
     * GLANCE_ALL_CLEAR.meaning)`. MAR-696 deleted that band whole ("the big
     * agent spotlight card"), and nothing replaced its per-agent prose; a
     * glance chip's meaning is not drawn anywhere on this page any more,
     * only the mark's own glyph on the card. That is a real narrowing, named
     * here rather than quietly kept passing by asserting for text nobody
     * draws.
     */
    expect(markup).not.toContain(GLANCE_ALL_CLEAR.meaning);
    expect(markup).not.toContain("chief-band");
    expect(markup).not.toContain("Read the news sources you choose");
  });
});

describe("a card for an agent that has never run (MAR-634)", () => {
  const markup = renderToStaticMarkup(
    <FleetList agents={[agent({ run_count: 0 })]} />,
  );

  it("says the absence instead of leaving a gap that reads as a failed load", () => {
    /*
     * The defect: two of three cards showed a place chip and no status, which
     * is *correct* — MAR-547 forbids faking `Completed` for an agent that has
     * never run — and on screen looked like a status that had not arrived.
     */
    expect(markup).toContain("Not run yet");
    expect(markup).toContain("fleet-mark-not_run");
  });

  it("invents no fifth status to say it (MAR-547)", () => {
    /*
     * The words come from `describeRunCount`, which reads `run_count` and is
     * the same function the chief speaks under this card. The four-status
     * ladder is untouched and still answers null here, which is what makes
     * this branch reachable at all.
     */
    expect(describeRunCount(0)).toBe("Not run yet");
    expect(
      describeFleetCardStatus({ running: false, run_count: 0, glance: [GLANCE_ALL_CLEAR] }),
    ).toBeNull();
    for (const status of FLEET_CARD_STATUSES) {
      expect(markup, `a never-run card must not claim ${status}`).not.toContain(
        `fleet-mark-${status}`,
      );
    }
  });

  it("draws two marks, which is what every other card draws", () => {
    /*
     * The whole of "deliberate rather than incomplete". A never-run card is
     * not a card missing its first mark; it is a card whose first mark says
     * nothing has happened yet. Same count, same places, same arrangement.
     */
    expect([...markup.matchAll(/class="fleet-mark /g)]).toHaveLength(2);
    expect(markup).toContain("fleet-mark-local");
  });

  it("words it once, from `describeRunCount`, with nothing left to repeat it", () => {
    /*
     * Used to be twice on screen — the card's mark and the chief's own run
     * line quoting the same function — and the point was that one function
     * fed both, so neither could drift from the other. MAR-696 removed the
     * second reader (`ChiefBand`'s `chief-runs` line) along with the whole
     * band; the invariant that mattered was "one function, not two strings",
     * and that survives with a single caller exactly as it did with two.
     */
    expect([...markup.matchAll(/Not run yet/g)]).toHaveLength(1);
  });
});

describe("where a card stands in the spotlight", () => {
  it("turns the two neighbours and nothing further out", () => {
    /*
     * A row where each card leans a little more than the last is a fan rather
     * than a spotlight, and past the second card the perspective needed to keep
     * it legible stops existing.
     */
    expect(spotlightPosition(2, 2)).toBe("is-centred");
    expect(spotlightPosition(1, 2)).toBe("is-before");
    expect(spotlightPosition(3, 2)).toBe("is-after");
    expect(spotlightPosition(0, 2)).toBeUndefined();
    expect(spotlightPosition(4, 2)).toBeUndefined();
  });
});

/*
 * MAR-696. The describe block that used to live here — "the chief, under the
 * cards" — rendered `ChiefBand` directly to prove it named the selected
 * agent by name and drew the vendored glyph. `ChiefBand` no longer exists:
 * that whole bordered box is the "big agent spotlight card" Henrik asked to
 * have removed, not relocated. `tests/chief-chat-render.test.tsx` covers what
 * replaced it — the composer `FleetList` renders directly.
 */
