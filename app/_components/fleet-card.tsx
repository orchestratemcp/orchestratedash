"use client";

import type { ReactNode } from "react";

import { OpenAgentButton } from "./glance-chips";
import { OAvatar } from "./o-avatar";
import { describeAgentHosting } from "../../lib/host-sighting";
import { sightingFor, type SightingLog } from "../../lib/host-sightings";
import {
  describeFleetCardStatus,
  describeFleetPlace,
  type FleetCardStatus,
} from "../../lib/copy/fleet-status";
import type { AgentHostedOnView, AgentRow } from "../../lib/views/types";

/**
 * One agent, as a snug portrait card.
 *
 * Three views draw this same card — `lib/views/fleet-view.ts` still holds that
 * a view may change the track and nothing a card says. The card now carries
 * the four marks Henrik asked for (status, local/cloud, open), drawn from
 * facts already on the row. The sprite is `size={100}` — 2× the 50px source,
 * a whole multiple — so two rows of three sit snug in the cards pane rather
 * than filling it with cropped 200px tiles.
 */
export function FleetCard({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentRow;
  selected: boolean;
  onSelect: () => void;
}): ReactNode {
  const status = describeFleetCardStatus({
    running: agent.running,
    run_count: agent.run_count,
    glance: agent.glance,
  });
  const place = describeFleetPlace(agent.hosted_on);

  return (
    <article className={selected ? "row-card fleet-card is-selected" : "row-card fleet-card"}>
      <div className="fleet-marks">
        {status === null ? (
          /*
           * MAR-634 item 3. A card with a place chip and no status read as a
           * status that failed to load, which is the one thing it was not: a
           * never-run agent is a correct, complete card, and MAR-547 forbids
           * dressing it as `Completed`.
           *
           * So the absence gets said rather than left as a gap, and the words
           * are `describeRunCount`'s — the same sentence the chief speaks
           * under this card, taken already worded rather than written twice.
           * `describeFleetCardStatus` returns null only when `run_count` is
           * zero and nothing is waiting, so this branch is exactly the
           * never-run case and the string is exactly "Not run yet". No fifth
           * status was invented to say it; the run count is a recorded fact
           * and this is that fact, drawn where the others are.
           */
          <span className="fleet-mark fleet-mark-not_run">
            <FleetMarkGlyph name="not_run" />
            {describeRunCount(agent.run_count)}
          </span>
        ) : (
          <span className={`fleet-mark fleet-mark-${status.id}`}>
            <FleetMarkGlyph name={status.id} />
            {status.label}
          </span>
        )}
        <span className={`fleet-mark fleet-mark-${place.id}`}>
          <FleetMarkGlyph name={place.id} />
          {place.label}
        </span>
      </div>
      {/*
        A real button, not a card that looks clickable. Selection is what tells
        the chief who to talk about. The Open control sits beside this, not
        inside it — a link nested in a button is two actions in one tab stop.
      */}
      <button
        type="button"
        className="fleet-pick"
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="fleet-portrait">
          <OAvatar name={agent.avatar} size={100} action />
        </span>
        <span className="fleet-name">{agent.title}</span>
      </button>
      <OpenAgentButton agent={agent.name} />
    </article>
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
 * How many times this agent has worked, in a sentence rather than a number
 * (MAR-491).
 *
 * `0` under a `Runs` label is a fact a person has to assemble; "Not run yet" is
 * the same fact already assembled. The plural is spelled out because "1 runs"
 * is the smallest possible way for a surface to look unfinished.
 *
 * The chief speaks this sentence (`lib/copy/chief.ts`), and takes it already
 * worded rather than rebuilding it from the number — two copies of "Not run yet"
 * is two copies that can disagree the day somebody improves one of them.
 */
export function describeRunCount(runs: number): string {
  if (runs <= 0) {
    return "Not run yet";
  }
  return runs === 1 ? "Run once" : `Run ${String(runs)} times`;
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

function FleetMarkGlyph({ name }: { name: MarkName }): ReactNode {
  return (
    <svg
      className="fleet-mark-glyph"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {MARKS[name].map(([x, y, w, h]) => (
        <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}
