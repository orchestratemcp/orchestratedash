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
 * The spotlight's own chrome is driven directly — `ChiefBand` and
 * `spotlightPosition` are exported for this — because there is no way to give a
 * static render a scroll position.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { describeRunCount } from "../app/_components/fleet-card";
import { ChiefBand, FleetList, spotlightPosition } from "../app/_components/fleet-list";
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
    <FleetList agents={[agent(), agent({ name: "digest", title: "Digest", avatar: "wizard" })]} />,
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

  it("keeps the goal off the card, because the card is a portrait", () => {
    /*
     * `lib/views/fleet-view.ts`'s rule from the markup's side: the views are three
     * tracks over one `FleetCard`, so a fact cannot exist in one view and not
     * another. The goal left the card at MAR-612 and stays off it in Grid and
     * Spotlight — Rows draws its own one-line version, gated on the view.
     */
    expect(markup).toContain("chief-band");
    expect(markup).not.toContain("Read the news sources you choose");
  });

  it("speaks about the fleet, never about which card is selected (MAR-669)", () => {
    /*
     * Both seeded agents are calm — `run_count: 3`, `glance: [GLANCE_ALL_CLEAR]`
     * — so `describeFleetCardStatus` reads `completed` for each and
     * `describeFleetSummary` has nothing to ask for. That sentence is what the
     * band says, and the per-agent line MAR-669 removed — a name, a chip's
     * meaning, an "Ask <agent>" action — is gone with it.
     */
    expect(markup).toContain("Nothing needs you right now.");
    expect(markup).not.toContain(GLANCE_ALL_CLEAR.meaning);
    expect(markup).not.toContain("Ask news-scout");
    expect(markup).not.toContain("chief-line");
    expect(markup).not.toContain("chief-actions");
  });
});

describe("a card for an agent that has never run (MAR-634)", () => {
  const markup = renderToStaticMarkup(<FleetList agents={[agent({ run_count: 0 })]} />);

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

  it("says it from one function, and the chief no longer echoes it (MAR-669)", () => {
    /*
     * Before MAR-669 this string appeared twice — the card's mark and the
     * chief's per-agent run line, both built from `describeRunCount` so the
     * two copies could not disagree. The chief no longer has a per-agent
     * line to put it in; the card's own mark is the only place left, which
     * is one copy rather than two agreeing copies.
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

describe("the chief, under the cards", () => {
  it("talks about the fleet, never about one agent by name (MAR-669)", () => {
    /*
     * `ChiefBand` no longer takes an `agent` prop at all — Henrik's own words,
     * "the chief band speaks about the fleet as a whole and nothing else."
     * `agents` (plural, the whole visible fleet) is what it reads.
     */
    const markup = renderToStaticMarkup(<ChiefBand agents={[agent()]} />);
    expect(markup).not.toContain("news-scout");
    expect(markup).not.toContain(GLANCE_ALL_CLEAR.meaning);
    expect(markup).toContain("Nothing needs you right now.");
  });

  it("draws no per-agent action — asking one agent still works, from its own page", () => {
    /*
     * MAR-669 removed the band's own "Ask <agent>" link along with the rest of
     * the per-agent line. The route it pointed at is untouched:
     * `app/_components/ask.tsx`'s `#ask-agent` section still lives on the
     * agent's own workspace, reached now by `fleet-card.tsx`'s `FleetOpenLink`
     * (MAR-660) or by asking the chief a routed question (`ChiefChat`).
     */
    const markup = renderToStaticMarkup(<ChiefBand agents={[agent()]} />);
    expect(markup).not.toContain("Ask news-scout");
    expect(markup).not.toContain("Open this agent");
    expect(markup).not.toContain("#ask-agent");
  });

  it("says where it is and stops when the fleet is empty", () => {
    const markup = renderToStaticMarkup(<ChiefBand agents={[]} />);
    expect(markup).toContain("The chief is waiting");
    // No action, because there is nothing to act on. A button that named no
    // agent would be the dead control this band exists to avoid.
    expect(markup).not.toContain("button-link");
  });

  it("is drawn from the vendored cast, but never as one of the agents' own costumes (MAR-615)", () => {
    // The chief is audited cast art since MAR-615 — no longer the placeholder
    // glyph MAR-544's boot sequence distinguished from the O's. It still is
    // not an ordinary agent's costume: it animates through its own vendored
    // sheet rather than the still-image path a fleet avatar without `action`
    // would use, and `O_FLEET` (asserted in tests/o-cast.test.ts) is what keeps
    // `oFor()` from ever landing an agent in it.
    const markup = renderToStaticMarkup(<ChiefBand agents={[agent()]} />);
    expect(markup).toContain("chief-glyph");
    expect(markup).toContain("/o/actions/chief-baton-wave.png");
    expect(markup).not.toContain("/o/1x/");
  });
});
