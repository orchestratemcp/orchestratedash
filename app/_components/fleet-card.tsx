"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AgentComplianceChips } from "./verdict";
import { AgentOrigin } from "./agent-origin";
import { GlanceChips, OpenAgentButton } from "./glance-chips";
import { TechnicalDetails } from "./record-card";
import { OAvatar } from "./o-avatar";
import { agentWorkspaceHref } from "../_data/routes";
import { describeAgentHosting } from "../../lib/host-sighting";
import { sightingFor, type SightingLog } from "../../lib/host-sightings";
import type { AgentHostedOnView, AgentRow } from "../../lib/views/types";

/**
 * One agent, as a card (MAR-547's composition, MAR-586's answers).
 *
 * ## Why this is its own file now
 *
 * It was the body of the `<ol>` in `app/page.tsx` until MAR-612, and it moved
 * for that issue's central constraint rather than for tidiness: **three views
 * draw the same card.** `lib/views/fleet-view.ts` states the rule — a view may
 * change the track the cards are laid on and nothing a card says — and one
 * component is what enforces it. Three views built from three copies of this
 * markup would be three places for a chip to go missing, and the person who
 * chose the view is the person least likely to be told which one lost it.
 *
 * So every comment below is the argument that shipped with the card, kept where
 * the markup is. What changed is that the `<li>`, the track and the ordering now
 * belong to `app/_components/fleet-list.tsx`.
 */
export function FleetCard({
  agent,
  log,
}: {
  agent: AgentRow;
  /** What the Servers page saw, this window (MAR-606, ADR 0015). */
  log: SightingLog;
}): ReactNode {
  return (
    <article className="row-card fleet-card">
      {/*
        The concept's header band (MAR-528, `DESIGN.md` "Cards & Panels"): a
        distinct top section with a bold monospace label and one status slot on
        the right. The label is the agent's name; the status is DASH's own
        verdict on its recent runs, which is the nearest true thing to the
        concept's ACTIVE chip — and unlike that chip it is a record rather than a
        reading.

        The "Last N runs" eyebrow that used to sit above these chips is gone, and
        nothing is lost with it: every chip carries its own denominator ("5/5
        clean", "2/5 gate violation"), which is the fact the eyebrow was there to
        supply. In a card a third of the page wide, a label explaining a number
        that is already on screen is the "text that is not needed" MAR-547 names.
      */}
      <div className="card-head">
        <div className="card-head-identity">
          <h3>
            <Link className="plain" href={agentWorkspaceHref(agent.name)}>
              {agent.title}
            </Link>
          </h3>
          {/*
            MAR-589. Henrik's ruling applied to the fleet card: the name is the
            label and the id is a value, in the same monospace chip
            `AgentHeader` already draws on the agent's own page. This card used
            to set the id itself in `<code>` as the heading, which was the exact
            defect MAR-577 and MAR-570's sessions flagged on two other surfaces.
          */}
          <p className="agent-id-chip">
            <span className="agent-id-label">ID</span>{" "}
            <code className="value">{agent.name}</code>
          </p>
        </div>
        <AgentComplianceChips compliance={agent.compliance} />
      </div>
      {/*
        MAR-501's rule survives the move and is worth restating, since the
        character is no longer beside the name: it must not be aligned with the
        verdict. Here it is centred in a band of its own, above the goal and
        below the name — recognition, in the position the concept gives a
        portrait, and nowhere near the compliance chips.

        MAR-587, and Henrik's second pass at the same sentence: "it would also be
        cool if we could animate the Os and make them big… to make the fleet look
        more like a game and character selection." So the tile is the card's hero
        at `size={200}` — 4× the 50px source, a whole multiple, because
        `image-rendering: pixelated` upscales by nearest neighbour and a
        "slightly bigger" sprite lands source pixels unevenly.

        MAR-612 keeps that size in all three views, and the rows view is where it
        was tempting not to: a card the full width of the page has room for a
        portrait beside its prose rather than above it, which is what
        `[data-fleet-view="rows"]` does in `app/globals.css`. The sprite is moved,
        never resized — `OSize` has no value between 100 and 200 and
        `lib/brand/o-cast.ts` says why.

        `action` draws the character's vendored idle loop where one exists —
        three of eleven today. It is a literal rather than an expression, and
        `scripts/brand-rules.mjs` fails anything else: whether this surface
        animates is a decision about the surface, never a fact about the agent.
        Everything the fleet actually *knows* is in the chips below, in words.
      */}
      <div className="fleet-portrait">
        <OAvatar name={agent.avatar} size={200} action />
      </div>
      {/*
        Everything below the portrait, in one box (MAR-612).

        It was flat until the rows view needed the portrait *beside* the reading
        matter rather than above it, and a flat card cannot do that: the card
        becomes a two-column grid, the portrait takes column one, and the eight
        things after it auto-place down column two — leaving column one's row as
        tall as the sprite and every cell beside it padded out to match. The
        first attempt shipped exactly that, and a screenshot of it is what found
        it: a 200px hole between the goal and the chips at 1280.

        One wrapper makes the card two rows instead of nine, in every view, and
        costs the grid nothing: it is a flex column inside a flex column, and
        `.glance-actions`' `margin-top: auto` still pins the control to the
        bottom of the card because this box is what grows to fill it.
      */}
      <div className="fleet-body">
        <p className="muted wrap">{agent.goal}</p>
        {/*
          MAR-586. The four questions, above the meta line and below the goal: what
          an agent is *for* is why you keep it, and whether something is waiting on
          you is why you look at it today. Both come before DASH's own record of
          how many times it has run.

          Every chip is a stored fact and links to where that fact is answered —
          see `lib/copy/glance.ts` for MAR-547's ruling, which is what keeps this a
          row of facts rather than a row of meters.
        */}
        <GlanceChips agent={agent.name} chips={agent.glance} />
        {/*
          MAR-606. Where this agent runs, when that is anywhere but this computer.

          Below the glance chips rather than among them, and that is not a layout
          preference. `lib/copy/glance.ts` reserves those four for *things that need
          you*, and its tone scale has no success colour at all — a card is a record
          of an agent at rest and has nothing live to report. This does: a sighting
          is DASH having just looked at a process on a machine and been told yes,
          which is the exception that comment anticipated. Keeping it out of
          `GlanceChip` is what stops emerald leaking into a scale built on not
          having one.

          Draws nothing for an agent DASH has never sent anywhere, which is almost
          all of them.
        */}
        <AgentHosting agent={agent.name} hostedOn={agent.hosted_on} log={log} />
        <p className="card-meta">
          <span className="value">{describeRunCount(agent.run_count)}</span>
          <span aria-hidden="true"> · </span>
          <AgentOrigin origin={agent.origin} />
        </p>
        {/*
          MAR-586's second half, and MAR-547's "can't be clicked" from the reader's
          side: a control they can see, rather than a heading that turns out to have
          been a link.
        */}
        <div className="glance-actions">
          <OpenAgentButton agent={agent.name} />
        </div>
        <TechnicalDetails>
          <dl className="facts">
            <div>
              <dt>Plan source</dt>
              <dd>{agent.plan_source}</dd>
            </div>
            <div>
              <dt>Build target</dt>
              <dd>{agent.build_target}</dd>
            </div>
            <div>
              <dt>Planned steps</dt>
              <dd>{agent.planned_steps}</dd>
            </div>
            <div>
              <dt>Clearance</dt>
              <dd>{agent.automation_clearance}</dd>
            </div>
          </dl>
        </TechnicalDetails>
      </div>
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
 * With no sighting the card says DASH sent this here and has not asked since,
 * which is honest and is the state a freshly opened window is always in. It is
 * never blank while a deploy record exists, because "we have not looked" and
 * "there is nothing to say" are different facts and only one of them is true.
 *
 * Exported so a render test can drive both halves without a store or a check.
 * `app/page.tsx` re-exports it, because `tests/host-sighting-render.test.tsx`
 * imports it from there and the test is the contract rather than the path.
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
 * the same fact already assembled, and it is the one that belongs on a card
 * whose other line is what the agent is for. The plural is spelled out because
 * "1 runs" is the smallest possible way for a surface to look unfinished.
 *
 * The chief speaks this sentence too (`lib/copy/chief.ts`), and takes it already
 * worded rather than rebuilding it from the number — two copies of "Not run yet"
 * is two copies that can disagree the day somebody improves one of them.
 */
export function describeRunCount(runs: number): string {
  if (runs <= 0) {
    return "Not run yet";
  }
  return runs === 1 ? "Run once" : `Run ${String(runs)} times`;
}
