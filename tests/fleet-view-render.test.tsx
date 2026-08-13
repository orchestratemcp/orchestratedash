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

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { describeRunCount } from "../app/_components/fleet-card";
import { ChiefBand, FleetList, spotlightPosition } from "../app/_components/fleet-list";
import { FleetRail } from "../app/_components/fleet-rail";
import { FleetViewToggle } from "../app/_components/fleet-view-toggle";
import { FLEET_CARD_STATUSES, describeFleetCardStatus } from "../lib/copy/fleet-status";
import { FLEET_VIEWS, describeFleetView } from "../lib/views/fleet-view";
import { GLANCE_ALL_CLEAR } from "../lib/copy/glance";
import type { AgentRow } from "../lib/views/types";

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
    origin: { kind: "sample", detail: null },
    compliance: { runs: 3, clean: 3, verdict: "clean", label: "3/3 clean", tone: "muted" },
    avatar: "ninja",
    deploy: { can_deploy: true, refusal: null },
    glance: [GLANCE_ALL_CLEAR],
    hosted_on: [],
    running: false,
    ...over,
  } as AgentRow;
}

const NO_SIGHTINGS = { seen: {} } as never;

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

  it("names the group, because three one-word options name nothing alone", () => {
    expect(markup).toContain("<legend>");
  });
});

describe("the agents page rail", () => {
  const markup = renderToStaticMarkup(<FleetRail />);

  it("is a named aside, not a row above the cards", () => {
    expect(markup).toContain('class="fleet-rail"');
    expect(markup).toContain('aria-label="Agent actions"');
  });

  it("holds Add agent and the three-view control together", () => {
    expect(markup).toContain('href="/settings/add-agent"');
    expect(markup).toContain("Add agent");
    expect(markup).toContain("fleet-view-toggle");
    expect([...markup.matchAll(/type="radio"/g)]).toHaveLength(3);
  });
});

describe("the list a cold render draws", () => {
  const markup = renderToStaticMarkup(
    <FleetList
      agents={[agent(), agent({ name: "digest", title: "Digest", avatar: "wizard" })]}
      log={NO_SIGHTINGS}
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

  it("takes no tab stop when it is not a scroll container", () => {
    /*
     * The `tabIndex` and the label are the spotlight's, because there the `<ol>`
     * scrolls and a scrolling region has to be focusable and named. In the grid
     * it is an ordinary list, and a tab stop on it would be furniture between a
     * keyboard and the cards.
     */
    expect(markup).not.toContain('tabindex="0"');
  });

  it("puts the facts on the chief, because the card is a portrait", () => {
    /*
     * `lib/views/fleet-view.ts`'s rule from the markup's side: the views are three
     * tracks over one `FleetCard`, so a chip cannot exist in one view and not
     * another. The prose left the card; the chief is on the same list in every
     * view and is where those facts now live.
     */
    expect(markup).toContain(GLANCE_ALL_CLEAR.meaning);
    expect(markup).toContain("chief-band");
    expect(markup).not.toContain("Read the news sources you choose");
  });
});

describe("a card for an agent that has never run (MAR-634)", () => {
  const markup = renderToStaticMarkup(
    <FleetList agents={[agent({ run_count: 0 })]} log={NO_SIGHTINGS} />,
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

  it("words it once, so the card and the chief cannot disagree", () => {
    // Twice on screen, from one function: the card's mark and the chief's
    // run line. Two literals would be two things to improve separately.
    expect([...markup.matchAll(/Not run yet/g)]).toHaveLength(2);
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
  it("talks about the agent in the middle, by name", () => {
    const markup = renderToStaticMarkup(<ChiefBand agent={agent()} />);
    expect(markup).toContain("news-scout");
    expect(markup).toContain(GLANCE_ALL_CLEAR.meaning);
    expect(markup).toContain("Run 3 times");
  });

  it("offers the one place this agent can actually be asked something", () => {
    /*
     * MAR-419's chat is not built. The action is MAR-545's per-agent Ask instead,
     * on the agent's own workspace — a real destination rather than a box that
     * would take a question nothing can answer. Opening the agent is here too,
     * because the card is no longer a link.
     */
    const markup = renderToStaticMarkup(<ChiefBand agent={agent()} />);
    expect(markup).toContain("Ask news-scout");
    expect(markup).toContain("Open this agent");
    expect(markup).toContain("/agents/detail?agent=news-scout#ask-agent");
  });

  it("says where it is and stops when there is no agent to talk about", () => {
    const markup = renderToStaticMarkup(<ChiefBand agent={null} />);
    expect(markup).toContain("The chief is waiting");
    // No action, because there is nothing to act on. A button that named no
    // agent would be the dead control this band exists to avoid.
    expect(markup).not.toContain("button-link");
  });

  it("is drawn as DASH rather than as one of the agents' characters", () => {
    // The cast is vendored artwork audited against orchestrateweb's manifest;
    // this is a glyph DASH owns. MAR-544's boot sequence settled the distinction.
    const markup = renderToStaticMarkup(<ChiefBand agent={agent()} />);
    expect(markup).toContain('class="chief-glyph"');
    expect(markup).not.toContain("/o/1x/");
  });
});
