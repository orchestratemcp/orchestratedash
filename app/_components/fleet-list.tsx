"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AgentHosting, FleetCard, describeRunCount } from "./fleet-card";
import { ChiefChat } from "./chief-chat";
import { OpenAgentButton } from "./glance-chips";
import { InfoNote } from "./info-note";
import { useFleetFilterSync } from "./fleet-rail";
import { useFleetView } from "./fleet-view-toggle";
import { agentWorkspaceHref } from "../_data/routes";
import { CHIEF_NAME, describeChief, describeFleetSummary } from "../../lib/copy/chief";
import { describeFleetCardStatus } from "../../lib/copy/fleet-status";
import { matchesFleetFilter } from "../../lib/views/fleet-filter";
import { stepRowsSelection, stepSpotlight } from "../../lib/views/fleet-view";
import type { SightingLog } from "../../lib/host-sightings";
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
  log,
  onToggleFavourite,
}: {
  /** The whole fleet — the rail's own counts depend on this being unfiltered. */
  agents: readonly AgentRow[];
  /** What the Servers page saw, this window (MAR-606, ADR 0015). */
  log: SightingLog;
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
        agent={visible[current] ?? null}
        agents={visible}
        chatOpen={chiefOpen}
        log={log}
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
 * be able to ask, and get a sentence."* This is the sentence, for the selected
 * agent, given without being asked. Opening the agent lives here too, because
 * the card above is now a portrait.
 *
 * ## The asking is built now (MAR-648)
 *
 * This paragraph used to say MAR-419 was blocked on a fleet-wide selection over
 * MAR-545's completion layer. The selection was never the hard part. What is
 * actually in the way is narrower and is recorded in `lib/chief/route.ts`: the
 * broker resolves a manifest per agent and the fleet principal has none, and
 * `connectionSecretName` only ever emits `dash.connection.`, so the fleet's own
 * key cannot be reached from the spend path by construction.
 *
 * So the chief asks nothing of anybody and still answers, which is MAR-648's own
 * scope for it — *"answers scoped to facts the chief can already speak (glance
 * chips, fleet facts)"*. `ChiefChat` is the box and `lib/chief/reply.ts` is what
 * comes back. The old rule this band was written under still holds and is why
 * that box is safe to draw: it is not a dead input, because every press produces
 * a real answer out of records this component already has in its props.
 *
 * The per-agent Ask has not gone anywhere. It is what a routed reply links to,
 * which is the same destination this band's action always pointed at — reached
 * now by asking a question rather than by knowing in advance which agent to ask.
 *
 * ## The chief is not one of the O's
 *
 * Drawn as inline rects on the sidebar's 12×12 grid, in `currentColor`, like
 * `sidebar-icons.tsx` and like MAR-544's boot glyph — whose header settles this
 * exact question: *"not one of the cast: the cast are the agents' characters, and
 * the thing booting here is DASH."* The chief is DASH speaking, so it is drawn
 * the way DASH draws itself.
 *
 * Exported so a render test can drive it without a scroll container, which is
 * the one thing this repository's tests have no way to produce: every render
 * test here is `renderToStaticMarkup`, so no effect runs and the spotlight is
 * unreachable through `FleetList` itself.
 *
 * ## When nothing is selected, the chief talks about the fleet (MAR-639)
 *
 * Henrik's own example: *"2 need you, 1 working."* Replaces the old fixed
 * "waiting for an agent to talk about" — a sentence that named nothing an
 * agent that reached this branch could actually be about. `describeFleetSummary`
 * builds it from the same per-card status every portrait is tinted by, so the
 * fleet and the chief cannot disagree about what "needs you" means.
 */
export function ChiefBand({
  agent,
  agents = [],
  chatOpen = false,
  log = {},
  onCloseChat,
  onOpenChat,
}: {
  agent: AgentRow | null;
  /**
   * Every agent in the fleet, read only for the summary drawn above — never
   * for anything about the selected agent, which stays `agent`'s alone.
   * Optional and defaulting to empty so a caller (this file's own render
   * tests included) that only ever had one agent to hand keeps working.
   *
   * MAR-648 gave it a second reader: `ChiefChat` routes over the same list,
   * which is what makes "ask the chief" a question about the fleet in front of
   * you rather than about a fleet somebody else filtered.
   */
  agents?: readonly AgentRow[];
  /** Whether the room is open. Optional, for the render tests that predate it. */
  chatOpen?: boolean;
  log?: SightingLog;
  onCloseChat?: () => void;
  onOpenChat?: () => void;
}): ReactNode {
  const line =
    agent === null
      ? null
      : describeChief({
          agent: agent.name,
          runs: describeRunCount(agent.run_count),
          glance: agent.glance,
        });

  return (
    <aside className={chatOpen ? "chief-band is-chatting" : "chief-band"}>
      <ChiefGlyph />
      {/*
        MAR-648. The unprompted line steps aside while the room is open.

        Both are the chief talking, and leaving them on screen together would put
        a sentence about the agent in the middle of the cards directly above a
        conversation about something the person actually asked — one speaker
        saying two unrelated things at once, which is the duplication MAR-646 was
        filed on rather than a second opinion. The glyph stays: it is who is
        speaking, and that has not changed.
      */}
      {chatOpen ? null : line === null || agent === null ? (
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
      ) : (
        <>
          <div className="chief-line">
            {/*
              The agent's name in the same monospace the card used to give it
              in its header band, so the thing the chief is talking about is
              recognisable as the portrait above rather than as a new noun.
            */}
            <p className="chief-says">
              <code>{line.agent}</code> — {line.says}
              {/*
                MAR-639. The all-clear chip's whole sentence, behind the note
                rather than loose in the line — `ChiefLine.note`'s own header
                states which chip this is and why.
              */}
              {line.note === null ? null : <InfoNote>{line.note}</InfoNote>}
            </p>
            <p className="chief-runs muted">{line.runs}</p>
            <AgentHosting agent={agent.name} hostedOn={agent.hosted_on} log={log} />
          </div>
          <div className="chief-actions">
            <OpenAgentButton agent={line.agent} />
            {/*
              A link to the workspace, with the Ask section's own anchor on it.
              The fragment lands when the page has drawn and is a no-op when it
              has not — either way the reader is on the one surface in DASH
              where this agent can actually be asked something.
            */}
            <Link className="button-link" href={`${agentWorkspaceHref(line.agent)}#ask-agent`}>
              {line.action}
            </Link>
          </div>
        </>
      )}

      {/*
        MAR-648. The composer, docked, and the room it opens above itself.

        Last in the band and therefore last in the tab order, which is the right
        order for it: somebody arriving here with a keyboard reaches the chief's
        sentence and the two controls about the agent in the middle before they
        reach a box that asks them to compose something.
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
