"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { FleetCard, describeRunCount } from "./fleet-card";
import { useFleetView } from "./fleet-view-toggle";
import { agentWorkspaceHref } from "../_data/routes";
import { CHIEF_NAME, CHIEF_WAITING, describeChief } from "../../lib/copy/chief";
import { stepSpotlight } from "../../lib/views/fleet-view";
import type { SightingLog } from "../../lib/host-sightings";
import type { AgentRow } from "../../lib/views/types";

/**
 * The fleet, laid out the way the reader asked for (MAR-612).
 *
 * Henrik, 2026-08-11, verbatim: *"1. 3 cards in a row. make em bit smaller so we
 * can have some space around. 2. 1 card per row. 3. A carousel type view one
 * card in the middle and two slightly bent cards on the sides. under the 3 cards
 * we have the chief."*
 *
 * ## One list, three tracks, and almost all of it is CSS
 *
 * The three views are **the same `<ol>` of the same `<article>`s**. What differs
 * is the track, and the track is `[data-fleet-view]` in `app/globals.css`
 * switching on an attribute a pre-paint script has already written
 * (`FleetViewScript`). So grid and rows cost this component nothing at all: no
 * branch, no second markup, no flash on a cold start, and no way for a chip to
 * exist in one view and not another — which is the rule `lib/views/fleet-view.ts`
 * is built around.
 *
 * ## What the spotlight needs React for, and it is one fact
 *
 * **Which card is in the middle.** CSS can lay a scroll-snapping row and can
 * centre whatever the reader scrolled to; it cannot tell the two neighbours to
 * lean *towards* the middle one, and it cannot tell the chief who to talk about.
 * So the spotlight — and only the spotlight — tracks an index, marks the three
 * cards around it, and hands the middle one to the chief.
 *
 * Everything that index drives is an addition. No card is hidden, removed from
 * the document or taken out of the tab order in any view: a person scrolling
 * this row with a keyboard reaches every agent, and a screen reader reads the
 * same list it reads in the grid. A carousel that unmounts its off-screen items
 * is the version of this pattern that quietly loses agents, and `is-before` /
 * `is-after` are class names precisely so that nothing else about the card
 * changes.
 *
 * ## The scroll position is the truth, not the index
 *
 * The arrows set the index *and* scroll; scrolling sets the index. Both paths
 * end at "which card is nearest the middle of the track", measured from real
 * rectangles rather than from card arithmetic, because the card's width is a
 * token that density and the viewport both move and any number kept in here
 * would be a fourth opinion about it.
 */
export function FleetList({
  agents,
  log,
}: {
  agents: readonly AgentRow[];
  /** What the Servers page saw, this window (MAR-606, ADR 0015). */
  log: SightingLog;
}): ReactNode {
  const [view] = useFleetView();
  const spotlight = view === "spotlight";
  const track = useRef<HTMLOListElement | null>(null);
  const cards = useRef<(HTMLLIElement | null)[]>([]);
  const [centre, setCentre] = useState(0);

  /*
   * Clamped rather than trusted. The agents list is re-read on window focus and
   * on every navigation back to this page, so the fleet can shrink underneath a
   * centre index that was valid a moment ago — an agent removed while this view
   * was open is the ordinary way that happens.
   */
  const centred = centre < agents.length ? centre : 0;

  const measure = useCallback((): void => {
    const row = track.current;
    if (row === null) {
      return;
    }
    const box = row.getBoundingClientRect();
    const middle = box.left + box.width / 2;
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    cards.current.forEach((card, index) => {
      if (card === null) {
        return;
      }
      const rect = card.getBoundingClientRect();
      const distance = Math.abs(rect.left + rect.width / 2 - middle);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    setCentre(nearest);
  }, []);

  /*
   * Read once per frame at most. A scroll event fires far more often than a
   * layout changes and each pass reads a rectangle per card, which is the one
   * thing in here that could be made to cost something on a long fleet.
   */
  useEffect(() => {
    const row = track.current;
    if (!spotlight || row === null) {
      return;
    }
    let frame = 0;
    const onScroll = (): void => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    row.addEventListener("scroll", onScroll, { passive: true });
    /*
     * Measured on entry as well as on scroll. Switching into the spotlight from
     * the grid does not scroll anything, so without this the middle card is
     * whichever one index 0 happens to be rather than the one under the reader's
     * eye — and on a resize the track re-centres with no scroll event at all.
     */
    measure();
    window.addEventListener("resize", onScroll);
    return () => {
      row.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [spotlight, measure, agents.length]);

  const step = (direction: 1 | -1): void => {
    const next = stepSpotlight(centred, agents.length, direction);
    setCentre(next);
    /*
     * `prefers-reduced-motion` decides how it gets there, and it is asked here
     * rather than in CSS because `scroll-behavior: smooth` on the track would
     * also smooth the reader's own wheel. `app/tokens.css` zeroes the motion
     * tokens under the same query; this is the one animation in the feature that
     * is not a token, because it is a scroll rather than a transition.
     */
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cards.current[next]?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  };

  const list = (
    <ol
      className="row-list fleet-grid"
      ref={track}
      /*
       * A scrolling region is focusable, so somebody who cannot use a pointer can
       * still move this row with the arrow keys — and a focusable region needs a
       * name, or a screen reader announces a group with nothing in the title.
       * Both are conditional because in the grid and rows views this element does
       * not scroll and a tab stop on it would be furniture in the way of the
       * cards.
       */
      tabIndex={spotlight ? 0 : undefined}
      aria-label={spotlight ? "Your agents, side by side" : undefined}
    >
      {agents.map((agent, index) => (
        <li
          key={agent.name}
          ref={(node) => {
            cards.current[index] = node;
          }}
          /*
           * Position relative to the middle, and nothing else. The class says
           * where a card is standing, never anything about the agent — which is
           * the same separation `fleet-motion.ts` keeps for the bottom strip,
           * where a behaviour is state and a costume never is.
           */
          className={spotlight ? spotlightPosition(index, centred) : undefined}
        >
          <FleetCard agent={agent} log={log} />
        </li>
      ))}
    </ol>
  );

  if (!spotlight) {
    return list;
  }

  return (
    <div className="fleet-spotlight">
      <div className="fleet-spotlight-track">
        {/*
          Two arrows, and they wrap rather than disable at the ends
          (`stepSpotlight`). They are real buttons beside a real scroll
          container, so they are the pointer shortcut for something the keyboard
          and the wheel can already do — never the only way to reach a card,
          which is what would make an off-screen agent unreachable.
        */}
        <button
          type="button"
          className="fleet-spotlight-step"
          onClick={() => {
            step(-1);
          }}
          aria-label="Show the agent before this one"
        >
          <span aria-hidden="true">‹</span>
        </button>
        {list}
        <button
          type="button"
          className="fleet-spotlight-step"
          onClick={() => {
            step(1);
          }}
          aria-label="Show the agent after this one"
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <ChiefBand agent={agents[centred] ?? null} />
    </div>
  );
}

/**
 * Where one card stands relative to the middle.
 *
 * Only the two immediate neighbours lean. Everything further out is flat and
 * scrolled past, because a row where each card leans a little more than the last
 * is a fan rather than a spotlight, and past the second card the perspective
 * needed to keep it legible stops existing.
 */
export function spotlightPosition(index: number, centred: number): string | undefined {
  if (index === centred) {
    return "is-centred";
  }
  if (index === centred - 1) {
    return "is-before";
  }
  if (index === centred + 1) {
    return "is-after";
  }
  return undefined;
}

/**
 * The chief, under the cards (MAR-612, Henrik's third view).
 *
 * ## What the chief does here, and what it does not
 *
 * `docs/design-brief.md` gives the chief one job: *"A non-technical user should
 * never have to read the fleet grid to answer 'is my thing working'. They should
 * be able to ask, and get a sentence."* This is the sentence, for the agent in
 * the middle, given without being asked.
 *
 * **The asking is MAR-419 and it is not built.** It is blocked on a fleet-wide
 * selection over MAR-545's completion layer, per `docs/mar-545-handoff.md`, and
 * this band deliberately does not draw a box a person could type into and get
 * nothing back from — `app/_components/ask.tsx` states that rule and its own
 * view union has no arm for one. So the chief's action is the truest thing in
 * reach: the per-agent Ask that MAR-545 already shipped, on the agent's own
 * workspace, named after the agent the chief is talking about.
 *
 * The room is left. When the chief can be asked, the input goes under this line
 * and the action beside it becomes the send — the band is sized for it now so
 * that day is a component change rather than a page moving under everybody.
 *
 * ## The chief is not one of the O's
 *
 * Drawn as inline rects on the sidebar's 12×12 grid, in `currentColor`, like
 * `sidebar-icons.tsx` and like MAR-544's boot glyph — whose header settles this
 * exact question: *"not one of the cast: the cast are the agents' characters, and
 * the thing booting here is DASH."* The chief is DASH speaking, so it is drawn
 * the way DASH draws itself.
 *
 * That is a placeholder in one direction only, and it is worth being plain about
 * it: the cast lives in orchestrateweb and DASH vendors it against a per-file
 * sha256 (`lib/brand/o-cast.ts`), so a chief *character* is a sprite that repo
 * has to ship and audit first — MAR-615's lane. Inventing one here would mean
 * regenerating an audit manifest against art nobody upstream drew, which is the
 * one thing that file forbids. A glyph DASH owns is honest today and is replaced
 * by an `OAvatar` the day the sprite exists.
 *
 * Exported so a render test can drive it without a scroll container, which is
 * the one thing this repository's tests have no way to produce: every render
 * test here is `renderToStaticMarkup`, so no effect runs and the spotlight is
 * unreachable through `FleetList` itself.
 */
export function ChiefBand({ agent }: { agent: AgentRow | null }): ReactNode {
  const line =
    agent === null
      ? null
      : describeChief({
          agent: agent.name,
          runs: describeRunCount(agent.run_count),
          glance: agent.glance,
        });

  return (
    <aside className="chief-band">
      <ChiefGlyph />
      {line === null ? (
        <p className="chief-says muted">{CHIEF_WAITING}</p>
      ) : (
        <>
          <div className="chief-line">
            {/*
              The agent's name in the same monospace the card's header band gives
              it, so the thing the chief is talking about is recognisable as the
              card two hundred pixels above rather than as a new noun.
            */}
            <p className="chief-says">
              <code>{line.agent}</code> — {line.says}
            </p>
            <p className="chief-runs muted">{line.runs}</p>
          </div>
          {/*
            A link to the workspace, with the Ask section's own anchor on it. The
            fragment lands when the page has drawn and is a no-op when it has not
            — either way the reader is on the one surface in DASH where this agent
            can actually be asked something, which is the whole promise of the
            label.
          */}
          <Link className="button-link" href={`${agentWorkspaceHref(line.agent)}#ask-agent`}>
            {line.action}
          </Link>
        </>
      )}
    </aside>
  );
}

/** x, y, width, height on the 12×12 grid, matching `sidebar-icons.tsx`. */
type Px = readonly [number, number, number, number];

/**
 * The chief: a crest, a visor with two gaps for eyes, ear cups and shoulders.
 *
 * Filled rects with no stroke and no even-odd fill, so a gap is a cell that was
 * never drawn over — the same construction the sidebar's gear uses for its hole.
 */
const CHIEF: readonly Px[] = [
  [5, 0, 2, 2],
  [3, 2, 6, 2],
  [3, 4, 1, 1],
  [5, 4, 2, 1],
  [8, 4, 1, 1],
  [3, 5, 6, 2],
  [2, 2, 1, 4],
  [9, 2, 1, 4],
  [5, 7, 2, 1],
  [2, 8, 8, 3],
];

function ChiefGlyph(): ReactNode {
  return (
    <svg
      className="chief-glyph"
      viewBox="0 0 12 12"
      width="48"
      height="48"
      role="img"
      aria-label={CHIEF_NAME}
      shapeRendering="crispEdges"
    >
      {CHIEF.map(([x, y, w, h]) => (
        <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}
