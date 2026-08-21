"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FleetCard } from "./fleet-card";
import { ChiefChat } from "./chief-chat";
import { OAvatar } from "./o-avatar";
import { useFleetFilterSync } from "./fleet-rail";
import { useFleetView } from "./fleet-view-toggle";
import { agentWorkspaceHref } from "../_data/routes";
import { CHIEF_NAME, describeFleetSummary } from "../../lib/copy/chief";
import { describeFleetCardStatus } from "../../lib/copy/fleet-status";
import { matchesFleetFilter } from "../../lib/views/fleet-filter";
import { stepRowsSelection, stepSpotlight } from "../../lib/views/fleet-view";
import type { AgentRow } from "../../lib/views/types";

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
 * ## What React is for: which card is selected
 *
 * CSS can lay a scroll-snapping row and can size two rows of three; it cannot
 * decide which card is picked. Every view now tracks a selected index — the
 * border `.fleet-card.is-selected` draws, and the card the spotlight centres.
 * In the grid and in rows, a press on a card sets it. In the spotlight, the
 * middle card is the selection, measured from real rectangles, and a press
 * scrolls that card to the middle. Selection no longer changes what the
 * chief says beneath the cards (MAR-669: the band speaks about the fleet as
 * a whole and nothing else) — it is purely which card reads as "this one",
 * for the reader's own reference.
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
 * Rows gets ↑/↓ to move the selection and Enter to open the selected
 * agent's workspace. Spotlight gets ←/→
 * as the keyboard equivalent of the two step buttons already beside it —
 * `stepSpotlight` is the same function either way. Grid gets neither: a
 * two-dimensional grid has no single "next" a linear key can name, and
 * nothing in the issue asked for one.
 */
export function FleetList({
  agents,
  onToggleFavourite,
}: {
  /** The whole fleet — the rail's own counts depend on this being unfiltered. */
  agents: readonly AgentRow[];
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
   * MAR-648. Whether the chief's room is open over the cards.
   *
   * Held here rather than inside `ChiefChat` because it is a fact about the
   * *stage*: the band grows and the cards give up their two thirds, which is a
   * decision only the element that owns both tracks can take. `ChiefChat` says
   * when it should change and this decides what that looks like.
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
    <div className={chiefOpen ? "fleet-stage chief-is-open" : "fleet-stage"}>
      <div className="fleet-cards">
        {/*
          MAR-640. A filter that hides everybody says so rather than leaving a
          bare pane — the same argument the page-level "no agents yet" empty
          state already makes, for a narrower cause. `agents.length` (the
          whole fleet) is what distinguishes this from that state: an empty
          fleet never reaches `FleetList` at all (`app/page.tsx` draws its own
          empty state first), so an empty `visible` here is always a filter's
          doing.
        */}
        {visible.length === 0 ? (
          <p className="empty">Nothing matches this filter. Choose another in the rail.</p>
        ) : (
          cardsPane
        )}
      </div>
      <ChiefBand
        agents={visible}
        chatOpen={chiefOpen}
        onCloseChat={() => {
          setChiefOpen(false);
        }}
        onOpenChat={() => {
          setChiefOpen(true);
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
 * The chief, under the cards — in every view, in the lower third.
 *
 * ## What the chief does here, and what it does not
 *
 * `docs/design-brief.md` gives the chief one job: *"A non-technical user should
 * never have to read the fleet grid to answer 'is my thing working'. They should
 * be able to ask, and get a sentence."* Until MAR-669 that sentence was about
 * whichever card was selected. It is now always about the **fleet** —
 * Henrik's own words, asked directly and answered plainly: *"remove the
 * per-agent line entirely. The chief band speaks about the fleet as a whole
 * and nothing else."* Station 11's *"when in fleet mode I want the chat to
 * only be chief mode"* is what this always meant for the composer; MAR-669
 * makes it true of the unprompted line too. A card's own facts — its status,
 * its place, its name — live on the card now (`fleet-card.tsx`'s combined
 * indicator row), and opening one lives on the card too (MAR-660's
 * `FleetOpenLink`), so nothing this band said about a single agent is
 * unreachable — it moved to the thing it was about.
 *
 * ## Asking about one agent still works, from here or from its own page
 *
 * `ChiefChat` routes a typed question about a named agent to that agent's own
 * workspace (`lib/chief/route.ts`, `lib/chief/reply.ts`) — MAR-648's build,
 * untouched by this change. `app/_components/ask.tsx`'s `#ask-agent` section
 * on the agent's own page is the destination either way, whether a person
 * gets there by asking the chief or by opening the card directly. Removing
 * the band's own per-agent line does not remove that route — it only removes
 * the one place in DASH that spoke about a single agent from a component
 * whose subject is the whole fleet.
 *
 * ## The chief is not one of the O's, and has its own portrait anyway
 *
 * Until MAR-615 this was drawn as inline rects on the sidebar's 12×12 grid, in
 * `currentColor`, like `sidebar-icons.tsx` and like MAR-544's boot glyph — a
 * placeholder standing in for *"not one of the cast: the cast are the agents'
 * characters, and the thing booting here is DASH."* That question still holds:
 * `O_FLEET` still excludes the chief, and `oFor()` can never land an ordinary
 * agent in his costume. But the chief is cast, even if he is not fleet —
 * orchestrateweb's `scripts/build-o-chief.mjs` re-dresses the audited king into
 * his own still and his own `chief-baton-wave` idle sheet, vendored here the
 * same way every other character is, and this band is exactly the spotlight
 * that sheet was built for.
 *
 * ## The unprompted line (MAR-639, narrowed to fleet-only at MAR-669)
 *
 * Henrik's own example: *"2 need you, 1 working."* `describeFleetSummary`
 * builds it from the same per-card status every portrait is tinted by, so the
 * fleet and the chief cannot disagree about what "needs you" means. It steps
 * aside while the room is open — both are the chief talking, and leaving them
 * on screen together would put one sentence directly above a conversation
 * about something the person actually asked, the duplication MAR-646 was
 * filed on rather than a second opinion.
 */
export function ChiefBand({
  agents = [],
  chatOpen = false,
  onCloseChat,
  onOpenChat,
}: {
  /**
   * Every agent in the fleet — what the summary above is built from and what
   * `ChiefChat` routes a typed question over. Optional and defaulting to
   * empty so a caller (this file's own render tests included) that has none
   * to hand keeps working.
   */
  agents?: readonly AgentRow[];
  /** Whether the room is open. Optional, for the render tests that predate it. */
  chatOpen?: boolean;
  onCloseChat?: () => void;
  onOpenChat?: () => void;
}): ReactNode {
  return (
    <aside className={chatOpen ? "chief-band is-chatting" : "chief-band"}>
      <ChiefGlyph />
      {chatOpen ? null : (
        <p className="chief-says muted">
          {describeFleetSummary(
            agents.map(
              (row) =>
                describeFleetCardStatus({
                  running: row.running,
                  run_count: row.run_count,
                  glance: row.glance,
                })?.id ?? null,
            ),
          )}
        </p>
      )}

      {/*
        MAR-648. The composer, docked, and the room it opens above itself.

        Last in the band and therefore last in the tab order, which is the
        right order for it: somebody arriving here with a keyboard reaches the
        chief's sentence before they reach a box that asks them to compose
        something.
      */}
      <ChiefChat
        agents={agents}
        open={chatOpen}
        onClose={onCloseChat ?? noop}
        onOpen={onOpenChat ?? noop}
      />
    </aside>
  );
}

/**
 * For a `ChiefBand` rendered without the handlers.
 *
 * `ChiefBand` is exported for the render tests, which drive it directly because
 * every test here is `renderToStaticMarkup` and the spotlight is unreachable
 * through `FleetList` — see this component's header. Those callers hold no open
 * state, and a composer that throws on focus would make the band untestable to
 * keep a prop required that only one caller in the application can supply.
 */
function noop(): void {
  /* nothing to do */
}

/**
 * The chief's vendored portrait, waving his baton (MAR-615).
 *
 * `label={CHIEF_NAME}` because this is the one place `OAvatarProps.label`'s
 * own docblock names as the exception: the character genuinely *is* the
 * information here, standing in for who is speaking rather than decorating an
 * agent's name that is already printed beside it. `scripts/brand-check.mjs`'s
 * `LABEL_ALLOWLIST` names this file for exactly that reason — everywhere else
 * in DASH the rule holds with no exceptions.
 *
 * `size={100}`, the portrait scale `AgentPortrait` uses for the one other
 * surface where a character is close to being the subject rather than a
 * marker in a list.
 */
function ChiefGlyph(): ReactNode {
  return <OAvatar name="chief" size={100} action label={CHIEF_NAME} className="chief-glyph" />;
}
