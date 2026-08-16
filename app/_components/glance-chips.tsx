import Link from "next/link";
import type { ReactNode } from "react";

import { InfoNote } from "./info-note";
import { agentWorkspaceHref } from "../_data/routes";
import { splitGlance } from "../../lib/copy/info-note";
import type { GlanceChip, GlanceQuestion } from "../../lib/copy/glance";

/**
 * The four questions a fleet card answers, drawn (MAR-586).
 *
 * `lib/copy/glance.ts` decided what each chip says and `lib/views/glance.ts`
 * decided which of them are true. What is left for a component is where each one
 * goes, which is the half MAR-586 asks for in its own words: *"Each chip is a
 * link into the agent page section that answers it."*
 *
 * ## Why the destinations live here and not on the view
 *
 * A route is a fact about this application's pages, and `app/_data/routes.ts` is
 * where DASH keeps those so that a page reading a parameter and a page writing
 * one cannot disagree about its name. The view carries the *question*, which is
 * a fact about the agent; the answer to "and where do I look?" is this file's.
 * A view that carried hrefs would be a trusted-side module that had to be
 * rebuilt every time a page moved.
 *
 * ## The one chip that is not a link
 *
 * "Nothing needs you" goes nowhere, because there is nothing to go and see. A
 * link that led somewhere and then showed the reader nothing in particular is
 * the dead control `lib/workspace.ts` argues against, wearing a chip.
 */

/**
 * Where each question is answered.
 *
 * Three of the four are sections of the agent's own page. The fourth is not, and
 * that is a statement about the product rather than a shortcut: what an agent
 * needs connected, and how far along each one is, is the Connection Center's
 * whole subject — the agent page's own Connections section is the *agent's*
 * report on connections it already has, which is a different question and would
 * be the wrong place to send somebody who has been told something is missing.
 *
 * The fragments are best-effort by construction. Two of the three name sections
 * that exist only when there is something in them, and a fragment naming no
 * element simply lands the reader at the top of the right page — which is still
 * an answer, and a better failure than a chip that is not a link at all.
 */
const ANSWERED_AT: Record<GlanceQuestion, (agent: string) => string> = {
  new_output: (agent) => `${agentWorkspaceHref(agent)}#outputs-heading`,
  needs_you: (agent) => `${agentWorkspaceHref(agent)}#waiting-work`,
  not_connected: () => "/settings",
  overdue: (agent) => `${agentWorkspaceHref(agent)}#workspace-overview`,
};

const TONE_CLASS = {
  accent: "chip chip-accent",
  warn: "chip chip-warn",
  muted: "chip chip-muted",
} as const;

export function GlanceChips({
  agent,
  chips,
}: {
  /** The agent these chips are about, for the links. */
  agent: string;
  chips: readonly GlanceChip[];
}): ReactNode {
  const split = chips.map((chip) => ({ chip, ...splitGlance(chip.question, chip.meaning) }));
  const said = split.filter((one) => one.surface !== null);

  return (
    <div className="glance">
      <div className="chips">
        {split.map(({ chip, note }) => {
          const className = TONE_CLASS[chip.tone];
          /*
            The note rides beside its own chip rather than where the sentence
            used to be (MAR-614). `app/_components/info-note.tsx` is the inline
            affordance — "attached to the single word or control it is about" —
            and a marker parked at the bottom of the card would be a question
            mark about the card in general, which is the one thing it must not
            be when there can be four chips.
          */
          const label =
            chip.question === "all_clear" ? (
              <span className={className} key={chip.question}>
                {chip.label}
              </span>
            ) : (
              <Link
                className={`${className} chip-link`}
                href={ANSWERED_AT[chip.question](agent)}
                key={chip.question}
              >
                {chip.label}
              </Link>
            );
          if (note === null) {
            return label;
          }
          return (
            <span className="glance-chip-noted" key={chip.question}>
              {label}
              <InfoNote>{note}</InfoNote>
            </span>
          );
        })}
      </div>
      {/*
        The sentences that stay, under the chips rather than in a `title`.

        A chip is two or three words and cannot carry "this agent expects to run
        about once a day, and DASH last saw it run on 6 August 2026" — but that
        sentence is the whole reason the chip is honest rather than a meter, so
        it has to be on the screen. `BrokerCapabilityView.consequence` makes the
        same argument about a hover: a fact somebody has to point at is a fact
        most people never read.

        That argument is why `splitGlance` moves exactly one of the five and not
        the rest: it holds for every sentence that names something waiting on the
        reader, and collapses for the one that names an absence. See
        `lib/copy/info-note.ts` for which and why.

        A list, because these are one line each and there may be four of them.
        Drawn only when something is in it — an empty `<ul>` is still a box, and
        on a healthy card it was the last thing between the chips and the meta
        line.
      */}
      {said.length === 0 ? null : (
        <ul className="glance-said">
          {said.map((one) => (
            <li key={one.chip.question}>{one.surface}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
