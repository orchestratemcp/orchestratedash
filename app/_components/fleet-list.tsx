"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FleetCard } from "./fleet-card";
import { ChiefChat } from "./chief-chat";
import { useFleetFilterSync } from "./fleet-rail";
import { useFleetView } from "./fleet-view-toggle";
import { agentWorkspaceHref } from "../_data/routes";
import { matchesFleetFilter } from "../../lib/views/fleet-filter";
import { stepRowsSelection, stepSpotlight } from "../../lib/views/fleet-view";
import { describeChiefNoModel } from "../../lib/copy/chief-chat";
import type { AgentRow, ChiefRoomView } from "../../lib/views/types";

/**
 * The chief's room when nobody handed one in (MAR-659).
 *
 * The state a DASH with no fleet default is really in, so a caller that omits
 * the prop — a render test, or a host built before ADR 0023 — gets the honest
 * answer rather than a shape claiming a model is available. Frozen, because it
 * is shared by every such caller and a component that mutated it would change
 * what the next one sees.
 */
const EMPTY_CHIEF_ROOM: ChiefRoomView = Object.freeze({
  can_ask: false,
  model_id: null,
  model_provider_id: null,
  model_is_own: false,
  blocked: describeChiefNoModel(),
  turns: [],
});

/**
 * The fleet, laid out the way the reader asked for (MAR-612, then the 2/3 split).
 *
 * Henrik, 2026-08-13: grid is two rows of three cards; rows fits three agents
 * on one screen; spotlight (the carousel) sits in the same band. In every
 * view the cards take two thirds of the remaining page and the chief takes
 * the third underneath.
 *
 * ## One list, three tracks, and almost all of it is CSS
 *
 * The three views are **the same `<ol>` of the same `<article>`s**. What differs
 * is the track, and the track is `[data-fleet-view]` in `app/globals.css`
 * switching on an attribute a pre-paint script has already written
 * (`FleetViewScript`).
 *
 * ## What React is for: which agent the chief is talking about
 *
 * CSS can lay a scroll-snapping row and can size two rows of three; it cannot
 * tell the chief who to talk about. Every view now tracks a selected index.
 * In the grid and in rows, a press on a card sets it. In the spotlight, the
 * middle card is the selection, measured from real rectangles, and a press
 * scrolls that card to the middle.
 *
 * No card is hidden, removed from the document or taken out of the tab order
 * in any view: a person scrolling this row with a keyboard reaches every
 * agent, and a screen reader reads the same list it reads in the grid.
 *
 * ## The rail's filter narrows this same list (MAR-640)
 *
 * `agents` is the whole fleet — the rail reads it too, for its counts, which
 * is why it is never filtered before it gets here. This component filters
 * its own copy with `useFleetFilterSync`, the same attribute the rail's
 * control writes, read synchronously so the very first paint is already
 * narrowed — see that hook's own header for why filtering cannot lean on
 * `FleetViewScript`'s CSS-only trick the way the three tracks do.
 *
 * ## Keyboard selection (MAR-640)
 *
 * Rows gets ↑/↓ to move the selection (the chief follows, `select`'s own
 * job) and Enter to open the selected agent's workspace. Spotlight gets ←/→
 * as the keyboard equivalent of the two step buttons already beside it —
 * `stepSpotlight` is the same function either way. Grid gets neither: a
 * two-dimensional grid has no single "next" a linear key can name, and
 * nothing in the issue asked for one.
 */
export function FleetList({
  agents,
  chief = EMPTY_CHIEF_ROOM,
  canAct = false,
  onAsked,
  onToggleFavourite,
}: {
  /** The whole fleet — the rail's own counts depend on this being unfiltered. */
  agents: readonly AgentRow[];
  /**
   * The chief's kept conversation, and what its composer can do (MAR-659).
   *
   * Optional, so the render tests that drive this band with a list of rows and
   * nothing else go on working. The default is the honest one — no model, no
   * turns, and the room's own notice saying why — rather than a shape that
   * claims a model is available.
   */
  chief?: ChiefRoomView;
  /** False in a browser tab, where there is no bridge to ask through. */
  canAct?: boolean;
  /** Ask the page to re-read the view, so a new chief turn appears. */
  onAsked?: () => void;
  /** Star — or unstar — one agent (MAR-640). Optional: see `FleetCard`'s own note. */
  onToggleFavourite?: (agent: string, next: boolean) => void;
}): ReactNode {
  const router = useRouter();
  const [view] = useFleetView();
  const filter = useFleetFilterSync();
  const spotlight = view === "spotlight";
  const rows = view === "rows";
  const track = useRef<HTMLOListElement | null>(null);
  const cards = useRef<(HTMLLIElement | null)[]>([]);
  const [selected, setSelected] = useState(0);

  const visible = useMemo(
    () => agents.filter((agent) => matchesFleetFilter(filter, agent)),
    [agents, filter],
  );

  /*
   * Clamped rather than trusted. The filtered list is rebuilt on every window
   * focus, navigation and filter change, so a selected index valid a moment
   * ago can point past the end — an agent removed, or filtered out, while
   * this view was open is the ordinary way that happens.
   */
  const current = selected < visible.length ? selected : 0;

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
    setSelected(nearest);
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
  }, [spotlight, measure, visible.length]);

  const scrollTo = (index: number): void => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cards.current[index]?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  };

  const select = (index: number): void => {
    setSelected(index);
    if (spotlight) {
      scrollTo(index);
    }
  };

  const step = (direction: 1 | -1): void => {
    const next = stepSpotlight(current, visible.length, direction);
    setSelected(next);
    scrollTo(next);
  };

  /*
   * MAR-640. Rows moves the selection with the arrow keys and opens the
   * selected agent on Enter; Spotlight steps with the arrow keys the same
   * two buttons beside it already do. `select`'s own focus-follows-selection
   * job is why `.fleet-pick` is focused explicitly after an arrow key in
   * Rows — a browser's default Tab order has no notion of "the row above".
   */
  const onListKeyDown = (event: KeyboardEvent<HTMLOListElement>): void => {
    if (rows) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = stepRowsSelection(current, visible.length, event.key === "ArrowDown" ? 1 : -1);
        select(next);
        cards.current[next]?.querySelector<HTMLButtonElement>(".fleet-pick")?.focus();
      } else if (event.key === "Enter") {
        const agent = visible[current];
        if (agent !== undefined) {
          router.push(agentWorkspaceHref(agent.name));
        }
      }
      return;
    }
    if (spotlight) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    }
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
       * not scroll sideways and a tab stop on it would be furniture in the way of
       * the cards.
       */
      tabIndex={spotlight ? 0 : undefined}
      aria-label={spotlight ? "Your agents, side by side" : undefined}
      onKeyDown={rows || spotlight ? onListKeyDown : undefined}
    >
      {visible.map((agent, index) => (
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
          className={
            spotlight
              ? [spotlightPosition(index, current), index === current ? "is-selected" : undefined]
                  .filter(Boolean)
                  .join(" ") || undefined
              : index === current
                ? "is-selected"
                : undefined
          }
        >
          <FleetCard
            agent={agent}
            selected={index === current}
            onSelect={() => {
              select(index);
            }}
            onToggleFavourite={
              onToggleFavourite === undefined
                ? undefined
                : (next) => {
                    onToggleFavourite(agent.name, next);
                  }
            }
          />
        </li>
      ))}
    </ol>
  );

  const cardsPane = spotlight ? (
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
  ) : (
    list
  );

  /*
   * MAR-648. Whether the chief's room is open, overlaying the cards.
   *
   * Held here rather than inside `ChiefChat`, on `FleetList`'s own standing
   * reason: this is the element already holding the fleet's selection and
   * the cards `chief-room` overlays, so it is in a position to say whether
   * the stage itself is mid-conversation — `ChiefChat` says when it should
   * change and this only remembers the answer. MAR-696 removed `ChiefBand`,
   * the layer that used to sit between this state and `ChiefChat`; the state
   * moved down one level with it rather than into `ChiefChat` itself, since
   * a future sibling of the composer (the cards' own dimming, say) would need
   * the same fact `ChiefChat` does.
   *
   * React state and not the address, which is the opposite of the call
   * `lib/views/agent-stage.ts` made for the agent page's stages — and the
   * reasons that module gives are what decide it. A stage is in the address
   * because Back should return to it, because `lib/open-link.ts` needs to name
   * it, and because the capture harnesses photograph a route. None of the three
   * applies to a composer somebody put a cursor in: nothing links to "the fleet
   * page with the chief's box focused", Back should leave the fleet rather than
   * close a panel, and the harness that photographs this focuses the box, which
   * is what a person does.
   */
  const [chiefOpen, setChiefOpen] = useState(false);

  return (
    <div className="fleet-stage">
      <div className="fleet-cards">
        {/*
          MAR-640, corrected by MAR-742 roadmap item 2. A filter that hides
          everybody says so rather than leaving a bare pane — the same argument
          the page-level "no agents yet" empty state already makes, for a
          narrower cause. `agents.length` (the whole fleet) is what
          distinguishes the two: `FleetList` now mounts even for a genuinely
          empty fleet, so DASH's own room (below) can answer, and an empty
          `visible` with an empty `agents` is that state rather than a filter's
          doing — `app/page.tsx`'s "Nothing here yet" already says so, and
          repeating "Nothing matches this filter" underneath it would name a
          filter that was never applied. Nothing is drawn in the cards pane at
          all rather than a second empty sentence.
        */}
        {agents.length === 0 ? null : visible.length === 0 ? (
          <p className="empty">Nothing matches this filter. Choose another in the rail.</p>
        ) : (
          cardsPane
        )}
      </div>
      {/*
        MAR-696. The composer, incorporated into the page's own layout rather
        than docked in a bordered band — `ChiefBand` and the big box Henrik
        asked to have removed ("This box Ive asked you to remove manytimes")
        are both gone. `ChiefChat` draws itself; nothing here wraps it.
      */}
      <ChiefChat
        agents={visible}
        view={chief}
        canAct={canAct}
        onAsked={onAsked ?? noop}
        open={chiefOpen}
        onOpen={() => {
          setChiefOpen(true);
        }}
        onClose={() => {
          setChiefOpen(false);
        }}
      />
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
 * `onAsked` and `onOpen`/`onClose` are optional on `FleetList` — this file's
 * own render tests predate the composer and hold no open state — so this is
 * what a composer rendered without them falls back to. A required handler
 * would have made those tests fail to compile to keep a prop only one caller
 * in the application can supply.
 */
function noop(): void {
  /* nothing to do */
}
