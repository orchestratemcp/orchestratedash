import Link from "next/link";
import type { ReactNode } from "react";

import { agentWorkspaceHref } from "../_data/routes";
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
  return (
    <div className="glance">
      <div className="chips">
        {chips.map((chip) => {
          const className = TONE_CLASS[chip.tone];
          if (chip.question === "all_clear") {
            return (
              <span className={className} key={chip.question}>
                {chip.label}
              </span>
            );
          }
          return (
            <Link
              className={`${className} chip-link`}
              href={ANSWERED_AT[chip.question](agent)}
              key={chip.question}
            >
              {chip.label}
            </Link>
          );
        })}
      </div>
      {/*
        The sentences, under the chips rather than in a `title`.

        A chip is two or three words and cannot carry "this agent expects to run
        about once a day, and DASH last saw it run on 6 August 2026" — but that
        sentence is the whole reason the chip is honest rather than a meter, so
        it has to be on the screen. `BrokerCapabilityView.consequence` makes the
        same argument about a hover: a fact somebody has to point at is a fact
        most people never read.

        A list, because these are one line each and there may be four of them.
      */}
      <ul className="glance-said">
        {chips.map((chip) => (
          <li key={chip.question}>{chip.meaning}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The button MAR-586 asks for by name: *"besides this it needs buttons to its
 * agent page."*
 *
 * The agent's name at the top of the card has been a link since MAR-501, and
 * that is not the same thing. A word that happens to be clickable is something a
 * person discovers; a button is something they can see. MAR-547's two named
 * defects on this surface are "a lot of things that can't be clicked" and "info
 * lacking", and a card whose only route onward is its own heading is the first
 * one from the reader's side even though the link works.
 *
 * A `Link` wearing a button's clothes rather than a `button` with a handler:
 * this is navigation, and a real anchor is what gives a person the middle-click,
 * the context menu and the keyboard behaviour they already have. `canAct` is not
 * consulted anywhere here, and deliberately — going to a page is the one thing a
 * read-only browser tab can do exactly as well as the installed app.
 *
 * `button-link` is the class the Work inbox already uses for its own route to an
 * agent's workspace, rather than a new one that would look almost the same: two
 * surfaces offering the same journey should offer it in the same clothes.
 */
export function OpenAgentButton({ agent }: { agent: string }): ReactNode {
  return (
    <Link
      aria-label={`Open ${agent}`}
      className="button-link open-agent"
      href={agentWorkspaceHref(agent)}
    >
      Open this agent
    </Link>
  );
}
