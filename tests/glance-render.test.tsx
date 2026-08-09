/**
 * What a fleet card draws for its four answers (MAR-586).
 *
 * `tests/glance.test.ts` proves which chips are true. This proves the half a
 * reader actually meets: that every chip is a link, that each one goes to the
 * place that answers it, that the sentence is on the screen rather than in a
 * tooltip, and that the button MAR-586 asks for by name exists and is a real
 * anchor.
 *
 * Three of those are properties no screenshot settles. A picture of a chip and a
 * picture of a chip-shaped link are the same picture, and the defect MAR-547
 * names on this exact surface — *"there are still a lot of things that can't be
 * clicked"* — is invisible in one.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { GLANCE_ALL_CLEAR, describeGlance, type GlanceFacts } from "../lib/copy/glance";
import { agentWorkspaceHref } from "../app/_data/routes";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }): ReactNode => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { GlanceChips, OpenAgentButton } = await import("../app/_components/glance-chips");

/** The stylesheet with its comments removed — `tests/record-card.test.tsx`'s reason. */
const globals = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

const AGENT = "ai-news-scout";

const NOTHING: GlanceFacts = {
  new_outputs: 0,
  total_outputs: 0,
  never_looked: false,
  approvals: 0,
  choices: 0,
  expired: 0,
  unconnected: 0,
  self_contradicting: 0,
  overdue: null,
};

const EVERYTHING: GlanceFacts = {
  ...NOTHING,
  new_outputs: 3,
  total_outputs: 3,
  approvals: 1,
  unconnected: 2,
  overdue: { last_run_at: "2026-08-06T09:00:00.000Z", every_seconds: 86_400 },
};

function markup(facts: GlanceFacts): string {
  return renderToStaticMarkup(<GlanceChips agent={AGENT} chips={describeGlance(facts)} />);
}

describe("every chip is a way in (MAR-586, MAR-547's clickability)", () => {
  it("draws one link per question, each to the place that answers it", () => {
    const html = markup(EVERYTHING);
    const workspace = agentWorkspaceHref(AGENT);

    // The three the agent's own page answers.
    expect(html).toContain(`href="${workspace}#outputs-heading"`);
    expect(html).toContain(`href="${workspace}#waiting-work"`);
    expect(html).toContain(`href="${workspace}#workspace-overview"`);
    /*
     * And the one it does not. What an agent needs connected is the Connection
     * Center's subject; the agent page's own Connections section is the agent's
     * report on connections it already has, which is a different question and
     * the wrong place to send somebody told something is missing.
     */
    expect(html).toContain('href="/connections"');

    // Four questions, four destinations, no chip left as inert text.
    expect(html.match(/<a /g) ?? []).toHaveLength(4);
  });

  it("keeps a link looking and reading like a chip", () => {
    const html = markup(EVERYTHING);
    // `.chip` carries the box and the border; `.chip-link` is applied alongside
    // it rather than instead of it, so a chip that became a link did not become
    // a different thing.
    for (const anchor of html.match(/<a class="[^"]+"/g) ?? []) {
      expect(anchor).toContain("chip ");
      expect(anchor).toContain("chip-link");
    }
  });

  /**
   * The all-clear chip goes nowhere on purpose. A link that led somewhere and
   * then showed the reader nothing in particular is the dead control
   * `lib/workspace.ts` argues against, wearing a chip.
   */
  it("does not make a link out of having nothing to say", () => {
    const html = markup(NOTHING);
    expect(html).toContain(GLANCE_ALL_CLEAR.label);
    expect(html).not.toContain("<a ");
  });

  /**
   * MAR-547's other named defect is "info lacking". A chip is two or three
   * words; the sentence behind it is what makes it a fact rather than a meter,
   * so it has to be in the document rather than in a `title`.
   */
  it("puts the sentence on the screen, not behind a hover", () => {
    const html = markup(EVERYTHING);
    for (const chip of describeGlance(EVERYTHING)) {
      expect(html).toContain(chip.meaning.replace(/'/g, "&#x27;"));
    }
    expect(html).not.toContain("title=");
  });

  it("says nothing to a reader in vocabulary only DASH uses", () => {
    const chips = describeGlance(EVERYTHING);
    expectPlainLanguage(chips.flatMap((chip) => [chip.label, chip.meaning]));
  });
});

describe("the button to the agent page (MAR-586)", () => {
  it("is a real anchor to the agent's own page, named for a screen reader too", () => {
    const html = renderToStaticMarkup(<OpenAgentButton agent={AGENT} />);
    expect(html).toContain(`href="${agentWorkspaceHref(AGENT)}"`);
    expect(html).toContain("Open this agent");
    // The visible words are the same for every card, so the accessible name
    // carries which agent this one is.
    expect(html).toContain(`aria-label="Open ${AGENT}"`);
    expect(html).toContain("<a ");
  });

  /**
   * It wears the class the Work inbox already uses for the same journey. A
   * second class that looked almost the same would be two answers to "what does
   * a link to an agent look like".
   */
  it("wears the shared button-link clothes rather than a private copy", () => {
    const html = renderToStaticMarkup(<OpenAgentButton agent={AGENT} />);
    expect(html).toContain("button-link");
    expect(globals).toMatch(/button,\s*\.button-link\s*\{/);
  });
});

/**
 * Henrik, 2026-08-09, looking at the first set of these screenshots: *"I want
 * the fleet cards to fit like 3 in a row. And the avatar to be bigger."*
 *
 * Both are CSS, so both are asserted against the stylesheet rather than against
 * a rendering. What is worth pinning is not the number three — it is the two
 * decisions underneath it that a later edit could quietly undo.
 */
describe("the fleet is a grid of portraits (MAR-547's concept)", () => {
  it("lays the fleet on its own track and leaves the shared list class alone", () => {
    // `.row-list` is also the Runs and Connections record list. Their records
    // are wide rows of prose, and a three-column grid declared on the shared
    // class would have followed this change onto both of them.
    expect(globals).toMatch(/\.row-list\.fleet-grid\s*\{[^}]*grid-template-columns/);
    const shared = globals.match(/\.work-list,\s*\.card-grid,\s*\.row-list\s*\{[^}]*\}/);
    expect(shared?.[0]).not.toContain("minmax(19rem");
  });

  it("asks for a floor rather than a column count, so a phone gets one column", () => {
    /*
     * `repeat(3, 1fr)` would give a 375px window three 100px columns. MAR-491
     * settled that a width-conditional interface is two interfaces; this is the
     * worse version, where the same interface arrives at a width it cannot be
     * read at. `auto-fit` with a floor is one interface that reflows.
     */
    const track = globals.match(/\.row-list\.fleet-grid\s*\{[^}]*\}/)?.[0] ?? "";
    expect(track).toContain("auto-fit");
    expect(track).toContain("minmax(");
    expect(track).not.toMatch(/repeat\(\s*\d+\s*,/);
  });

  it("pins the control to the bottom, so a row of cards agrees where it is", () => {
    // Three cards with three different goal lengths would otherwise put their
    // buttons at three heights, and the button is the one thing on this surface
    // a person looks for in the same place on every card.
    expect(globals).toMatch(/\.fleet-card\s*\{[^}]*flex-direction:\s*column/);
    expect(globals).toMatch(/\.fleet-card \.glance-actions\s*\{[^}]*margin-top:\s*auto/);
  });
});

describe("the glance is not a width-conditional interface (MAR-491's rule)", () => {
  /**
   * MAR-491 settled this for the record card and the rule is general: a surface
   * that hides facts when the window is narrow is two interfaces, and the one a
   * person learns on a laptop is not the one they get on a phone. Neither
   * density may hide them either — that is a preference about air, and MAR-491
   * names hiding-by-density as the trap.
   */
  it("hides no chip behind a breakpoint or a density", () => {
    const media = globals.match(/@media[^{]+\{[\s\S]*?\n\}/g) ?? [];
    for (const block of media) {
      expect(block).not.toContain(".glance");
      expect(block).not.toContain(".chip-link");
    }
    const density = globals.match(/\[data-density="compact"\][^{]*\{[^}]*\}/g) ?? [];
    for (const rule of density) {
      expect(rule).not.toContain("display: none");
    }
  });
});
