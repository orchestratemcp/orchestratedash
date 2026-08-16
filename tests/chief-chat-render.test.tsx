/**
 * The chief's composer and its room, drawn (MAR-648).
 *
 * `renderToStaticMarkup`, like every render test here, so no effect runs and
 * nothing is clicked. What that reaches is the whole of what MAR-648 asked for
 * on this surface — the band grows a box, focus opens a room above it, and the
 * composer does not move — because all three are markup and CSS rather than
 * behaviour.
 *
 * The assertions worth reading are the two negative ones: the chief never draws
 * a loader, and the unprompted line steps aside rather than sitting above a
 * conversation.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ChiefBand } from "../app/_components/fleet-list";
import { CHIEF_CHAT_COPY } from "../lib/copy/chief-chat";
import { GLANCE_ALL_CLEAR, type GlanceChip } from "../lib/copy/glance";
import type { AgentRow } from "../lib/views/types";

const NEEDS_YOU: GlanceChip = {
  question: "needs_you",
  label: "needs you",
  meaning: "This agent is waiting for you to approve something before it can carry on.",
  tone: "warn",
};

function row(over: Partial<AgentRow> = {}): AgentRow {
  return {
    name: "ai-agent-news",
    title: "AI agent news",
    goal: "Collect news about ai agents from public feeds and write a digest.",
    capabilities: ["public_feed_fetch", "digest_compose"],
    plan_source: "orchestratekit",
    build_target: "node",
    planned_steps: 2,
    automation_clearance: "manual",
    run_count: 3,
    last_run_at: null,
    origin: { kind: "watched_only" },
    compliance: {
      runs_considered: 0,
      gate_violation_runs: 0,
      drifted_runs: 0,
      clearance_flagged_runs: 0,
    },
    avatar: "ninja",
    deploy: { deployable: false, reason: "no_folder" },
    glance: [GLANCE_ALL_CLEAR],
    running: false,
    hosted_on: [],
    favourite: false,
    ...over,
  } as AgentRow;
}

function band(props: Parameters<typeof ChiefBand>[0]): string {
  return renderToStaticMarkup(<ChiefBand {...props} />);
}

describe("the chief's band grows a composer", () => {
  it("draws a box a person can type in", () => {
    const html = band({ agent: row(), agents: [row()] });
    expect(html).toContain("<textarea");
    expect(html).toContain(CHIEF_CHAT_COPY.placeholder);
    expect(html).toContain(CHIEF_CHAT_COPY.submit);
  });

  /*
   * `ask.tsx`'s standing rule, which is why this band refused to draw a box for
   * as long as MAR-419 was unbuilt. It is satisfied differently here: the box is
   * live because every press produces a real answer out of records, not because
   * a model was wired up.
   */
  it("is never a dead input", () => {
    const html = band({ agent: row(), agents: [row()] });
    /*
     * The *box* is live. The send button is disabled on an empty box, which is
     * `AskComposer`'s own rule and the opposite of this defect: there is no
     * sentence worth showing for "you typed nothing", and a button that does
     * nothing on press is worse than one that says it is not ready.
     */
    expect(html).toContain('<textarea class="chief-input"');
    expect(/<textarea[^>]*\sdisabled/.test(html)).toBe(false);
  });

  it("says what it answers from, where a model indicator would be", () => {
    // MAR-648's rule for this row: affordances as they become real, never as
    // dead chrome. There is no model here, so there is no model chip — what is
    // true is where the answers come from.
    const html = band({ agent: row(), agents: [row()] });
    expect(html).toContain("I answer from your own records");
    expect(html).not.toContain("Asking under");
  });

  /*
   * The chief answers from props, in the same tick. A loader over a synchronous
   * read would be the same fabrication MAR-648 forbids on the agent page,
   * wearing the opposite costume — theatre asserting work where there is none.
   */
  it("draws no loader, because it never waits", () => {
    const html = band({ agent: row(), agents: [row()] });
    expect(html).not.toContain("ask-activity");
    expect(html).not.toContain("is-action");
  });
});

describe("the room opens above the composer", () => {
  it("shows the scope note and the composer when it is open and nothing is asked", () => {
    const html = band({ agent: row(), agents: [row()], chatOpen: true });
    expect(html).toContain(CHIEF_CHAT_COPY.heading);
    expect(html).toContain(CHIEF_CHAT_COPY.close);
    // The composer is still there, and after the room in the document — which
    // is what "the room appears above it" means in a source order.
    expect(html.indexOf("chief-room")).toBeLessThan(html.indexOf("chief-compose"));
  });

  /*
   * Both are the chief talking. Leaving them together would put a sentence
   * about whichever card is centred directly above a conversation about
   * something the person actually asked — one speaker saying two unrelated
   * things at once, which is MAR-646's duplication rather than a second opinion.
   */
  it("puts the unprompted line away while the room is open", () => {
    const closed = band({ agent: row({ glance: [NEEDS_YOU] }), agents: [row({ glance: [NEEDS_YOU] })] });
    const open = band({
      agent: row({ glance: [NEEDS_YOU] }),
      agents: [row({ glance: [NEEDS_YOU] })],
      chatOpen: true,
    });
    expect(closed).toContain(NEEDS_YOU.meaning);
    expect(open).not.toContain(NEEDS_YOU.meaning);
  });

  it("keeps the chief's glyph, because that is who is speaking", () => {
    const html = band({ agent: row(), agents: [row()], chatOpen: true });
    expect(html).toContain("chief-glyph");
  });

  it("marks the stage so the cards give up their two thirds", () => {
    const html = band({ agent: row(), agents: [row()], chatOpen: true });
    expect(html).toContain("is-chatting");
  });
});

describe("the band without a chat", () => {
  /*
   * `ChiefBand` is exported for render tests that predate the composer and hold
   * no open state. A required handler would have made the band untestable to
   * keep a prop only one caller in the application can supply.
   */
  it("still renders when no handlers are given", () => {
    expect(() => band({ agent: row(), agents: [row()] })).not.toThrow();
  });
});
