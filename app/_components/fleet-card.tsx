"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { agentWorkspaceHref } from "../_data/routes";
import { OAvatar } from "./o-avatar";
import { useFleetView } from "./fleet-view-toggle";
import { describeAgentHosting } from "../../lib/host-sighting";
import { sightingFor, type SightingLog } from "../../lib/host-sightings";
import { plainDay } from "../../lib/copy/when";
import {
  describeFleetCardStatus,
  describeFleetPlace,
  describeRunCount,
  type FleetCardStatus,
} from "../../lib/copy/fleet-status";
import type { AgentHostedOnView, AgentRow } from "../../lib/views/types";

/**
 * Which tone a status tints the portrait (MAR-639), or `null` for the
 * neutral tone the base `.fleet-portrait` rule already draws.
 *
 * `lib/copy/fleet-status.ts` already ranks the four statuses; this is the
 * same three-tone scale `lib/copy/glance.ts` states for its chips —
 * **warn is waiting on you, accent is in flight or ready to read, neither
 * for the rest** — read across onto the portrait rather than invented a
 * second time. `completed` and the never-run case (`null`) share the plain
 * base look rather than a modifier class, since neither has anything left
 * for the card to ask about.
 */
function statusTone(status: FleetCardStatus | null): "warn" | "accent" | null {
  switch (status) {
    case "needs_input":
      return "warn";
    case "working":
    case "ready_for_review":
      return "accent";
    case "completed":
    case null:
      return null;
  }
}

/**
 * One agent, as a snug portrait card.
 *
 * Three views draw this same card — `lib/views/fleet-view.ts` still holds that
 * a view may change the track and nothing a card says. The sprite is
 * `size={100}` — 2× the 50px source, a whole multiple — so two rows of three
 * sit snug in the cards pane rather than filling it with cropped 200px tiles.
 *
 * ## The whole card is the way in now (MAR-639)
 *
 * `.fleet-card-link` is a real anchor stretched over the card with CSS
 * (`inset: 0`), so a press anywhere on the card that is not another control
 * opens the agent — the affordance `OpenAgentButton` used to be the only
 * door to. It sits as a sibling *after* the pick button rather than wrapping
 * it, on the same rule the button's own comment already stated: a link
 * nested inside a button (or the reverse) is two actions sharing one tab
 * stop. `.fleet-pick` keeps `z-index: 1` in the stylesheet so its own click
 * — selecting the card, for the chief — wins over the stretched link
 * underneath it.
 *
 * ## Rows adds, it never hides (MAR-640)
 *
 * `lib/views/fleet-view.ts:29-46`'s rule — a view may change the track and
 * nothing a card says — is amended rather than dropped: the card still never
 * *hides* a fact shared with the other two views, but Rows draws one it does
 * not, `.fleet-goal`, gated on `view === "rows"` in this component rather
 * than on a stylesheet `display: none`. That keeps the amendment checkable
 * the same way the original rule was: `tests/fleet-view.test.ts` still scans
 * every `[data-fleet-view]` rule for a hidden fact, and an *addition* that
 * exists in one view's DOM and not the others' never matches that pattern.
 *
 * ## Visible again, and the corner it shares (MAR-660)
 *
 * MAR-639's whole-card link made opening an agent possible from anywhere on
 * the card; it did not make that possible *discoverable*. Henrik's attended
 * pass names the gap directly and asks for it under the avatar, on every
 * card — `FleetOpenLink`, below, is that control, in Grid and Spotlight only,
 * for the reasoning its own header gives. The same pass also caught the
 * favourite star sitting on top of Rows' place badge (`.fleet-marks`) and
 * asked for more room around the status cluster generally — both are
 * `app/globals.css`'s `[data-fleet-view="rows"]` rules now, not this
 * component's, since neither changes what a card says, only where Rows draws
 * it.
 */
export function FleetCard({
  agent,
  selected,
  onSelect,
  onToggleFavourite,
}: {
  agent: AgentRow;
  selected: boolean;
  onSelect: () => void;
  /**
   * Star — or unstar — this agent (MAR-640). Optional so every existing
   * caller — the render tests included — keeps compiling; a card with no
   * handler simply draws no star.
   */
  onToggleFavourite?: (next: boolean) => void;
}): ReactNode {
  const [view] = useFleetView();
  const status = describeFleetCardStatus({
    running: agent.running,
    run_count: agent.run_count,
    glance: agent.glance,
  });
  const place = describeFleetPlace(agent.hosted_on);
  const tone = statusTone(status?.id ?? null);
  const markSize = view === "rows" ? 16 : 12;

  return (
    <article className={selected ? "row-card fleet-card is-selected" : "row-card fleet-card"}>
      <div className="fleet-marks">
        <span className={`fleet-mark fleet-mark-${place.id}`}>
          <FleetMarkGlyph name={place.id} size={markSize} />
          {place.label}
        </span>
      </div>
      {/*
        A real button, not a card that looks clickable. Selection is what tells
        the chief who to talk about. Opening the agent is the stretched link
        below, a sibling rather than a wrapper — see this component's own
        header for why neither may nest inside the other.
      */}
      <button
        type="button"
        className="fleet-pick"
        aria-pressed={selected}
        onClick={onSelect}
      >
        {/*
          MAR-639. The portrait carries the status as a colour now, not just a
          word beside it: a 2px border and a tinted ground in the same tone
          the chip scale already uses, so a reader who knows that scale reads
          the card before reaching the label.
        */}
        <span className={tone === null ? "fleet-portrait" : `fleet-portrait fleet-portrait-${tone}`}>
          <OAvatar name={agent.avatar} size={100} action />
        </span>
        <span className="fleet-identity">
          {status === null ? (
            /*
             * MAR-634 item 3. A card with no status mark read as one that
             * failed to load, which is the one thing it was not: a never-run
             * agent is a correct, complete card, and MAR-547 forbids dressing
             * it as `Completed`.
             *
             * So the absence gets said rather than left as a gap, and the
             * words are `describeRunCount`'s — the same sentence the chief
             * speaks under this card, taken already worded rather than
             * written twice. `describeFleetCardStatus` returns null only
             * when `run_count` is zero and nothing is waiting, so this branch
             * is exactly the never-run case and the string is exactly "Not
             * run yet". No fifth status was invented to say it.
             */
            <span className="fleet-mark fleet-mark-not_run">
              <FleetMarkGlyph name="not_run" size={16} />
              {describeRunCount(agent.run_count)}
            </span>
          ) : (
            <>
              <span className={`fleet-mark fleet-mark-${status.id}`}>
                <FleetMarkGlyph name={status.id} size={16} />
                {status.label}
              </span>
              {/*
                MAR-639's last-run line. Only drawn once the agent has run at
                least once — a never-run card's status mark above already says
                "Not run yet", and repeating it here would be the exact
                two-copies-that-can-disagree `describeRunCount`'s own header
                argues against, on a card MAR-614 was written to make quieter
                rather than louder.
              */}
              <span className="fleet-last-run muted">
                {describeLastRun(agent.run_count, agent.last_run_at)}
              </span>
            </>
          )}
          <span className="fleet-name">{agent.title}</span>
          {/*
            MAR-640. Rows' own addition: the goal was moved off the card and
            onto the chief at MAR-612, and stays there in Grid and Spotlight —
            this is not that sentence coming back, it is Rows drawing a
            one-line version because a dense row has the width to say what a
            square tile does not.
          */}
          {view === "rows" ? <p className="fleet-goal muted">{agent.goal}</p> : null}
        </span>
      </button>
      {/*
        MAR-660. Grid and Spotlight only — see `FleetOpenLink`'s own header
        for why Rows keeps relying on `.fleet-card-link` instead.
      */}
      {view === "rows" ? null : <FleetOpenLink agent={agent.name} title={agent.title} />}
      {onToggleFavourite === undefined ? null : (
        <FavouriteButton
          agent={agent.title}
          favourite={agent.favourite}
          onToggle={onToggleFavourite}
        />
      )}
      <Link
        className="fleet-card-link"
        href={agentWorkspaceHref(agent.name)}
        aria-label={`Open ${agent.title}`}
      />
    </article>
  );
}

/**
 * "Open this agent," under the avatar rather than on the chief (MAR-660).
 *
 * From Henrik's attended proof pass, 2026-08-16, station 11, verbatim: *"The
 * button 'open this agent' shouldn't be in the chief component but under the
 * avatar in the card for every agent."* The control used to live only on
 * `fleet-list.tsx`'s chief band — one button, for whichever single agent the
 * chief happened to be talking about. This is the replacement: every card
 * draws its own, so opening an agent is no longer a fact the fleet keeps in
 * one place.
 *
 * It replaces `glance-chips.tsx`'s old `OpenAgentButton` rather than reusing
 * it — that component's one caller was the chief band this issue empties, so
 * keeping it around would have been a component with no production caller.
 * Reusing its own reasoning instead: a real `Link`, not a `button` with a
 * handler, because this is navigation and an anchor is what gives a person
 * the middle-click, the context menu and the keyboard behaviour a script
 * cannot fake. `title` (the agent's display name) rather than `agent` (its
 * slug) makes the accessible name, on `.fleet-card-link`'s and
 * `FavouriteButton`'s own standing — the other two controls on this same
 * card already name the agent that way.
 *
 * `position: relative; z-index: 1` in the stylesheet, `.fleet-pick`'s own
 * reason: above `.fleet-card-link`'s stretch, so a press here opens the
 * agent through this control rather than falling through to the whole-card
 * link underneath it. That whole-card link is not replaced or diminished —
 * it is still there and still works everywhere — this only makes the
 * capability visible instead of something a reader has to discover by
 * pointing at the card.
 *
 * ## Grid and Spotlight only
 *
 * Rows does not draw this. Its row is pinned to a measured height (MAR-640:
 * ~68px comfortable, exactly 56px compact) and this exact corner already
 * carries a second control, the favourite star — MAR-660's own issue text
 * warns against "stacking a third control into a space that is already too
 * tight for two," which is precisely what a third visible affordance here
 * would be. Rows keeps `.fleet-card-link`'s whole-row click as its way in,
 * the same dense-list convention it already used before this change, so
 * nothing a Rows card used to say is hidden — this is a new fact, and
 * `lib/views/fleet-view.ts`'s amendment permits a view to add one the others
 * do not without being obliged to add it everywhere.
 */
function FleetOpenLink({ agent, title }: { agent: string; title: string }): ReactNode {
  return (
    <Link className="fleet-open" href={agentWorkspaceHref(agent)} aria-label={`Open ${title}`}>
      Open this agent
    </Link>
  );
}

/**
 * Star — or unstar — one agent (MAR-640).
 *
 * A sibling of `.fleet-pick`, never nested inside it — the same reason
 * `.fleet-card-link` sits beside it rather than wrapping it: two controls
 * sharing one tab stop is not one control. `z-index: 1` in the stylesheet
 * puts it above the stretched whole-card link for the same reason
 * `.fleet-pick` needs it, so a press here stars the agent instead of
 * opening it.
 *
 * Visible on hover or focus, and always visible once favourited — an
 * affordance nobody can find by guessing is not a feature, and a starred
 * agent's own state must not disappear the moment the pointer moves away.
 * `aria-pressed` carries the state for anyone not reading colour, on the
 * same standing `FleetCard`'s own `.fleet-pick` already gives selection.
 */
function FavouriteButton({
  agent,
  favourite,
  onToggle,
}: {
  agent: string;
  favourite: boolean;
  onToggle: (next: boolean) => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={favourite ? "fleet-favourite is-favourite" : "fleet-favourite"}
      aria-pressed={favourite}
      aria-label={favourite ? `Remove ${agent} from favourites` : `Add ${agent} to favourites`}
      title={favourite ? "Remove from favourites" : "Add to favourites"}
      onClick={() => {
        onToggle(!favourite);
      }}
    >
      <FavouriteGlyph />
    </button>
  );
}

/** A blocky five-point star, `sidebar-icons.tsx`'s 12×12 grid. */
const FAVOURITE_STAR: readonly Px[] = [
  [5, 0, 2, 2],
  [4, 2, 4, 2],
  [1, 4, 10, 2],
  [3, 6, 6, 2],
  [2, 8, 2, 2],
  [8, 8, 2, 2],
];

function FavouriteGlyph(): ReactNode {
  return (
    <svg
      className="fleet-favourite-glyph"
      viewBox="0 0 12 12"
      width={14}
      height={14}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {FAVOURITE_STAR.map(([x, y, w, h]) => (
        <rect
          key={`${String(x)}-${String(y)}-${String(w)}-${String(h)}`}
          x={x}
          y={y}
          width={w}
          height={h}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

/**
 * Where one agent runs, when that is anywhere but this computer (MAR-606).
 *
 * Two sources, joined here because neither is complete on its own and only a
 * renderer holds both:
 *
 * - `hostedOn` is DASH's own deploy record, on the view, durable, and true on a
 *   cold start. It is what makes the indicator appear at all.
 * - `log` is what a server said when somebody last pressed Check, held for this
 *   window only (ADR 0015). It is what gives the indicator a colour.
 *
 * With no sighting the line says DASH sent this here and has not asked since,
 * which is honest and is the state a freshly opened window is always in. It is
 * never blank while a deploy record exists, because "we have not looked" and
 * "there is nothing to say" are different facts and only one of them is true.
 *
 * Exported so a render test can drive both halves without a store or a check.
 * `app/page.tsx` re-exports it, because `tests/host-sighting-render.test.tsx`
 * imports it from there and the test is the contract rather than the path.
 *
 * Drawn by the chief, not the card: the card is a portrait, and this sentence
 * is a fact about the selected agent.
 */
export function AgentHosting({
  agent,
  hostedOn,
  log,
}: {
  agent: string;
  hostedOn: readonly AgentHostedOnView[];
  log: SightingLog;
}): ReactNode {
  const first = hostedOn[0];
  if (first === undefined) {
    return null;
  }
  /*
   * The newest sighting across this agent's servers, or null when none has been
   * taken. Falls back to the newest *deploy*, which is `hostedOn[0]` — so an
   * unchecked agent still names a server rather than nothing.
   */
  const seen = sightingFor({ agent, sent_to: hostedOn, log });
  const server = seen?.label ?? first.label;
  const hosting = describeAgentHosting({
    agent,
    server,
    seen: seen?.seen ?? null,
    sent_on: hostedOn.find((one) => one.label === server)?.sent_on ?? first.sent_on,
    at: seen?.at ?? null,
  });
  if (hosting === null) {
    return null;
  }
  return (
    <p className="fleet-hosting">
      <span className={`chip chip-${hosting.tone}`}>{hosting.chip}</span>
      {/* The sentence carries the moment, which is what licenses the chip's
          colour at all — see ADR 0015. It is rendered rather than hidden in a
          title, for the reason `GlanceChip.meaning` is: a fact somebody has to
          discover by pointing at something is a fact most people never read. */}
      <span className="muted wrap">{hosting.sentence}</span>
      {hostedOn.length > 1 ? (
        <span className="muted wrap">
          DASH has sent it to {String(hostedOn.length)} servers. The Servers page lists them all.
        </span>
      ) : null}
    </p>
  );
}

/**
 * Re-exported from `lib/copy/fleet-status.ts`, where it moved (MAR-659).
 *
 * It was written here and its own note explained why the chief takes it already
 * worded rather than rebuilding it: *"two copies of 'Not run yet' is two copies
 * that can disagree the day somebody improves one of them."* ADR 0023's fleet
 * briefing is assembled in Electron main, which cannot import this file at all,
 * so the sentence had to live somewhere both a React card and a main-process
 * builder can reach. The re-export keeps `app/page.tsx` and `fleet-list.tsx`
 * pointing where they always did.
 */
export { describeRunCount } from "../../lib/copy/fleet-status";

/**
 * "Run 3 times · 7 August 2026", or just the count when DASH has no date
 * (MAR-639).
 *
 * `plainDay`, never a relative phrase. `lib/copy/when.ts` states the rule this
 * follows rather than reopening it: a relative phrase needs a clock at render,
 * so the packaged export's first paint and a render test's static markup
 * would disagree with each other, and an absolute date is the one a person
 * can actually check against a run's own record. Falls back to the count
 * alone when there is no date to read — an unparsable timestamp, not a
 * possible state for what `lib/views/build.ts` writes, but `plainDay`'s own
 * contract is to return null rather than echo something nothing can read.
 */
export function describeLastRun(runCount: number, lastRunAt: string | null): string {
  const base = describeRunCount(runCount);
  const day = lastRunAt === null ? null : plainDay(lastRunAt);
  return day === null ? base : `${base} · ${day}`;
}

/** x, y, width, height on the 12×12 grid, matching `sidebar-icons.tsx`. */
type Px = readonly [number, number, number, number];

type MarkName = FleetCardStatus | "local" | "cloud" | "not_run";

/**
 * Pixel marks for the four statuses and the two places.
 *
 * Inline rects on the sidebar's 12×12 grid, in `currentColor`, because these
 * are glyphs rather than costumes — they change colour with the mark, and a
 * PNG cannot. `shape-rendering="crispEdges"` is `image-rendering: pixelated`
 * for vector squares.
 */
const MARKS: Readonly<Record<MarkName, readonly Px[]>> = {
  /* A clockwise hook: working, in flight. */
  working: [
    [3, 2, 6, 2],
    [7, 4, 2, 4],
    [3, 8, 6, 2],
    [3, 5, 2, 3],
    [8, 1, 2, 2],
  ],
  /* A triangle with a bang: something is waiting on you. */
  needs_input: [
    [5, 1, 2, 2],
    [4, 3, 4, 2],
    [3, 5, 6, 2],
    [2, 7, 8, 2],
    [5, 9, 2, 2],
  ],
  /* Two uprights with end caps: ready to look at. */
  ready_for_review: [
    [3, 3, 2, 6],
    [7, 3, 2, 6],
    [2, 2, 4, 2],
    [6, 8, 4, 2],
  ],
  /*
   * A single bar: the typographic dash that stands where a value would be.
   *
   * Deliberately not an outlined box, which is what "empty" wants to be here
   * and is also what `local` already is — the two marks sit side by side on
   * every never-run card, and a hollow square beside a monitor would be two
   * rectangles a reader has to tell apart at 12px. A dash cannot be mistaken
   * for any of the other five, and beside "Not run yet" it reads as the
   * absence it is rather than as a subtraction.
   */
  not_run: [[2, 5, 8, 2]],
  /* A check. */
  completed: [
    [2, 6, 2, 2],
    [4, 8, 2, 2],
    [6, 6, 2, 2],
    [8, 4, 2, 2],
    [10, 2, 2, 2],
  ],
  /* A screen on a stand: this computer. */
  local: [
    [2, 2, 8, 1],
    [2, 2, 1, 6],
    [9, 2, 1, 6],
    [2, 7, 8, 1],
    [5, 8, 2, 1],
    [4, 9, 4, 1],
  ],
  /* Three stacked bars: a server. */
  cloud: [
    [3, 2, 6, 2],
    [2, 5, 8, 2],
    [3, 8, 6, 2],
  ],
};

/**
 * `size` defaults to 12 — the place chip's own size, unchanged. The status
 * mark that now sits beside the portrait passes 16 (MAR-639): closer reading
 * distance from the icon that stands for a whole card's status earns it the
 * larger of the two sizes this sidebar-icon grid already draws at.
 */
function FleetMarkGlyph({ name, size = 12 }: { name: MarkName; size?: 12 | 16 }): ReactNode {
  return (
    <svg
      className="fleet-mark-glyph"
      viewBox="0 0 12 12"
      width={size}
      height={size}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {MARKS[name].map(([x, y, w, h]) => (
        <rect
          // MAR-640. `local`'s own two rects share an `x, y` origin — a
          // wide bar and a tall one both starting at the screen's corner —
          // so `x-y` alone collided and React warned on every card. The
          // full rect is unique wherever the corner is not.
          key={`${String(x)}-${String(y)}-${String(w)}-${String(h)}`}
          x={x}
          y={y}
          width={w}
          height={h}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
