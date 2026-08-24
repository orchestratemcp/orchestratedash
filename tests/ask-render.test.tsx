/**
 * The conversation, drawn in every state it has (MAR-545).
 *
 * `tests/ask.test.ts` drives the selection and the sentences. This drives the
 * surface, and the assertions that matter are the two rules MAR-545 states in
 * its own words:
 *
 * - **never a dead input** — every state where nothing can be asked draws a
 *   sentence and a next action, and the one that is fixable from here draws a
 *   button;
 * - **someone who has never heard the word "artifact"** — nothing on this
 *   surface, in any state, uses DASH's vocabulary for its own filing.
 *
 * Plus the one that is a safety property rather than a design one: an answer is
 * rendered as text, and a link in an answer stays text.
 *
 * ## MAR-711: two components, tested separately, because that is how they ship
 *
 * `AskThread` (the full Chat-stage section) and `AskComposer` (the pinned bar's
 * own room, adopted from the fleet composer's shape) used to be composed
 * together here even though no real caller ever did that — a test convenience
 * this file's own header once admitted was "the composition ... which is also
 * what the cockpit does", which stopped being true once the composer stopped
 * needing `AskThread` wrapped around it to show a purpose, a history or an
 * estimate. `AskComposer` now carries all three itself. So this file tests
 * each the way the cockpit actually mounts it: `AskThread` alone, on the Chat
 * stage; `AskComposer` alone, pinned, with `chief-chat-render.test.tsx`'s own
 * shape for driving its room open and closed.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AskComposer, AskThread } from "../app/_components/ask";
import {
  ASK_ACTIVITY_LABEL,
  ASK_CLEAR,
  ASK_CLEAR_DETAIL,
  ASK_CLOSE,
  ASK_CUSTODY,
  ASK_HEADING,
  ASK_MODEL_CHANGE,
  ASK_MODEL_CHIP_LABEL,
  ASK_PLACEHOLDER,
  ASK_SOURCES_HEADING,
  describeAskActivity,
  describeAskModel,
  describeAskPurpose,
  describeUnavailable,
} from "../lib/copy/ask";
import type { AgentAskView, AskExchangeView } from "../lib/views/types";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "ai-agent-news";

const ANSWERED: AskExchangeView = {
  id: 1,
  question: "What have you found about tariffs?",
  asked: "today at 09:00",
  answer: "Two of the saved reports mention tariffs. [1] says the rate rises in September.",
  failure: null,
  selection: "2 saved things that mention “tariffs” went with this question.",
  charge: "OpenRouter charged $0.0031 for this answer: 1,200 pieces of text went, 90 came back.",
  model: "openai/gpt-5-mini",
  citations: [
    {
      index: 1,
      headline: "Chip makers brace for new tariffs",
      source_name: "Example Wire",
      item_url: "https://example.test/chips",
      report_title: "Morning briefing",
    },
    {
      index: 2,
      headline: "Tariffs on steel confirmed",
      source_name: null,
      item_url: null,
      report_title: "Morning briefing",
    },
  ],
};

const FAILED: AskExchangeView = {
  id: 2,
  question: "And about shipping?",
  asked: "today at 09:04",
  answer: null,
  failure: {
    headline: "OpenRouter turned the question down.",
    meaning: "The most common causes are a model your key cannot use and an account out of credit.",
    next_action: "Check the model this agent is set to use, and your balance at OpenRouter.",
    actor: "user",
  },
  selection: "4 saved things went with this question.",
  charge: "OpenRouter did not say what this answer cost.",
  model: null,
  citations: [],
};

function askable(over: Partial<Extract<AgentAskView, { can_ask: true }>> = {}): AgentAskView {
  return {
    can_ask: true,
    heading: ASK_HEADING,
    purpose: describeAskPurpose(AGENT),
    custody: ASK_CUSTODY,
    placeholder: ASK_PLACEHOLDER,
    submit: "Ask",
    working: "Asking…",
    sources_heading: ASK_SOURCES_HEADING,
    provider_label: "OpenRouter",
    /* MAR-648. The settings row's indicator. `from_default: false` is the
       commoner state — an agent whose owner picked a model — so it is the
       fixture's default and the fleet-default arm is overridden explicitly by
       the case that tests it. */
    model: {
      model_id: "anthropic/claude-sonnet-5",
      from_default: false,
      note: describeAskModel(false),
      change_label: ASK_MODEL_CHANGE,
    },
    estimate: {
      headline: "Up to 12 saved things of the 40 this agent has saved go with your question, whichever ones match it.",
      detail: "A question here has usually cost $0.0031.",
    },
    ask: { agent_id: AGENT, connection_id: "models", field_id: "key" },
    history: [ANSWERED],
    spent: "OpenRouter has charged $0.02 for the 6 questions asked here.",
    reported: `${AGENT} reports that its own work has cost $0.31 across 12 runs. That is the agent's own figure about itself, not something DASH watched.`,
    ...over,
  };
}

function blocked(reason: Parameters<typeof describeUnavailable>[0], withConnect: boolean): AgentAskView {
  return {
    can_ask: false,
    heading: ASK_HEADING,
    blocked: describeUnavailable(reason, { agent: AGENT, service: "OpenRouter" }),
    connect: withConnect
      ? {
          channel: "connection.connect",
          agent_id: AGENT,
          connection_id: "models",
          field_id: "key",
        }
      : null,
    history: [],
    sources_heading: ASK_SOURCES_HEADING,
    reported: null,
  };
}

const NOOP = (): void => {
  /* nothing to do */
};

function thread(ask: AgentAskView, canAct = true): string {
  return renderToStaticMarkup(
    <AskThread ask={ask} canAct={canAct} onAsked={NOOP} setFeedback={NOOP} />,
  );
}

function composer(
  ask: AgentAskView,
  over: { canAct?: boolean; open?: boolean; onChatStage?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <AskComposer
      ask={ask}
      canAct={over.canAct ?? true}
      onAsked={NOOP}
      onChatStage={over.onChatStage ?? false}
      open={over.open ?? false}
      onOpen={NOOP}
      onClose={NOOP}
      setFeedback={NOOP}
    />,
  );
}

/* ---------------------------------------------------------------------- *
 * AskThread — the Chat stage's own section
 * ---------------------------------------------------------------------- */

describe("the thread when there is something to ask", () => {
  it("draws the purpose and the history, in order", () => {
    const html = thread(askable());
    expect(html).toContain(ASK_HEADING);
    expect(html.indexOf("Ask")).toBeLessThan(html.indexOf(ANSWERED.question));
  });

  it("says where the words go, and what each number is", () => {
    const html = thread(askable());
    expect(html).toContain("Your questions and the answers stay on this computer");
    // The two figures side by side, each attributed. One is the provider's for
    // something DASH asked; the other is the agent's about its own past.
    expect(html).toContain("OpenRouter has charged");
    expect(html).toContain("not something DASH watched");
  });

  it("puts the estimate above nothing, since there is no box here any more (MAR-711)", () => {
    // MAR-545's rule was "above the box" and this section no longer draws
    // one — `AskComposer` does, pinned. What survives is the ordering that
    // rule protected: the estimate is still the last thing before wherever a
    // person would type, which for this section is simply its own end.
    const html = thread(askable());
    expect(html.indexOf("Up to 12 saved things")).toBeGreaterThan(html.indexOf(ANSWERED.question));
  });

  it("renders an answer as text, and keeps a link inside it text", () => {
    const html = thread(
      askable({
        history: [
          {
            ...ANSWERED,
            answer:
              "Read more at https://evil.test/x and <a href='https://evil.test'>click here</a>.",
          },
        ],
      }),
    );
    // The answer came out of a model reading headlines an agent collected off
    // the open web. It is a text node and nothing else — no anchor, no markup,
    // no link the reader can press by mistake.
    expect(html).not.toContain('href="https://evil.test"');
    expect(html).toContain("&lt;a href=");
    expect(html).toContain("https://evil.test/x and");
  });

  it("links only what DASH recorded, and draws a citation with no link as plain text", () => {
    const html = thread(askable());
    expect(html).toContain('href="https://example.test/chips"');
    expect(html).toContain("Tariffs on steel confirmed");
    expect(html).toContain(ASK_SOURCES_HEADING);
    // Every outbound link in DASH carries this.
    expect(html).toContain('rel="noreferrer"');
  });

  it("shows a question that failed, with what to do about it", () => {
    const html = thread(askable({ history: [ANSWERED, FAILED] }));
    expect(html).toContain("And about shipping?");
    expect(html).toContain("turned the question down");
    expect(html).toContain("Check the model this agent is set to use");
    // In order, so the conversation reads downwards.
    expect(html.indexOf("What have you found")).toBeLessThan(html.indexOf("And about shipping"));
  });
});

describe("the thread when there is nothing to ask with", () => {
  it("never claims a box exists, in any of the four reasons", () => {
    for (const reason of ["no_provider", "no_key", "no_model_chosen", "nothing_saved"] as const) {
      const html = thread(blocked(reason, reason === "no_key"));
      expect(html).toContain(ASK_HEADING);
      // A sentence and a next action, every time.
      const recovery = describeUnavailable(reason, { agent: AGENT, service: "OpenRouter" });
      expect(html).toContain(recovery.headline);
      expect(html).toContain(recovery.next_action);
    }
  });

  it("makes the one fixable reason a button rather than an instruction", () => {
    const html = thread(blocked("no_key", true));
    expect(html).toContain("<button");
    expect(html).toContain("Connect OpenRouter");
  });

  it("gives the other reasons no button, because there is nothing here for one to do", () => {
    expect(thread(blocked("no_provider", false))).not.toContain("<button");
    expect(thread(blocked("nothing_saved", false))).not.toContain("<button");
  });

  it("keeps a conversation that happened before the key was withdrawn", () => {
    const html = thread({ ...blocked("no_key", true), history: [ANSWERED] });
    expect(html).toContain("Two of the saved reports mention tariffs");
    expect(html).toContain(ASK_SOURCES_HEADING);
  });
});

/* ---------------------------------------------------------------------- *
 * AskComposer — the pinned bar and its room (MAR-711)
 * ---------------------------------------------------------------------- */

describe("the composer, collapsed", () => {
  it("draws a box a person can type in", () => {
    const html = composer(askable());
    expect(html).toContain("<textarea");
    expect(html).toContain(ASK_PLACEHOLDER);
  });

  /* MAR-711. The fleet composer's own rule, adopted: Enter already sends. */
  it("draws no submit button — Enter is the only way to send", () => {
    const html = composer(askable());
    expect(html).not.toContain(">Ask<");
    expect(html).not.toContain('class="primary"');
  });

  it("is never a dead input", () => {
    const html = composer(askable());
    expect(html).toContain('<textarea class="ask-input"');
    expect(/<textarea[^>]*\sdisabled/.test(html)).toBe(false);
  });

  it("names this agent as the composer's accessible name", () => {
    const html = composer(askable(), {});
    expect(html).toContain('aria-label="Message this agent"');
    expect(html).not.toContain('<span class="visually-hidden">Message');

    const named = renderToStaticMarkup(
      <AskComposer
        agentTitle="AI agent news"
        ask={askable()}
        canAct
        onAsked={NOOP}
        open={false}
        onOpen={NOOP}
        onClose={NOOP}
        setFeedback={NOOP}
      />,
    );
    expect(named).toContain('aria-label="Message AI agent news"');
  });

  /*
   * MAR-742 roadmap item 1. Henrik's own ruling on the design proposal's open
   * question 3: the agent page's scope chip reads the agent's own name —
   * shorter than `describeChatSubject`'s "Message X", which stays the
   * composer's accessible name (above) rather than the chip's visible text.
   */
  it("draws the scope chip with the agent's own name, above the field", () => {
    const html = composer(askable(), {});
    expect(html).toContain('class="chip" title="Message this agent"');
    expect(html).toContain(">This agent<");

    const named = renderToStaticMarkup(
      <AskComposer
        agentTitle="AI agent news"
        ask={askable()}
        canAct
        onAsked={NOOP}
        open={false}
        onOpen={NOOP}
        onClose={NOOP}
        setFeedback={NOOP}
      />,
    );
    expect(named).toContain(">AI agent news<");
  });

  it("draws an enter glyph, decorative and never a control", () => {
    const html = composer(askable());
    expect(html).toContain('<span class="ask-enter-glyph" aria-hidden="true">');
    expect(html).toContain("↵");
  });

  it("draws no room, because it is not open", () => {
    const html = composer(askable(), { open: false });
    expect(html).not.toContain("ask-room");
  });

  it("is not marked is-open when closed", () => {
    const html = composer(askable(), { open: false });
    expect(html).toContain('class="ask-composer"');
    expect(html).not.toContain("is-open");
  });

  it("renders nothing at all when there is nothing to ask with", () => {
    expect(composer(blocked("no_key", true))).toBe("");
  });

  it("tells a browser tab which window can act rather than drawing a dead box", () => {
    const html = composer(askable(), { canAct: false });
    expect(html).toContain("Open the installed DASH app");
    expect(html).not.toContain("<textarea");
  });
});

describe("the model chip, always drawn (MAR-648, adopted by MAR-711, compacted by MAR-742 roadmap item 1)", () => {
  it("names the model this question will be asked under", () => {
    const html = composer(askable());
    expect(html).toContain(ASK_MODEL_CHIP_LABEL);
    expect(html).toContain("anthropic/claude-sonnet-5");
  });

  it("is drawn whether the room is open or closed", () => {
    expect(composer(askable(), { open: false })).toContain(ASK_MODEL_CHIP_LABEL);
    expect(composer(askable(), { open: true })).toContain(ASK_MODEL_CHIP_LABEL);
  });

  it("sets the model id as a value rather than writing it into a sentence", () => {
    const html = composer(askable());
    expect(/<code class="value"[^>]*>anthropic\/claude-sonnet-5<\/code>/.test(html)).toBe(true);
  });

  /*
   * MAR-742 roadmap item 1. `describeAskModel`'s distinction used to be a
   * sentence beside the id; it is the chip's `title` now — `hidden text is
   * still in the markup` does not apply here the way it did for the chief's
   * own FLEET DEFAULT case, because there is only one control on this
   * surface for a reader to inspect, not a second control that silently
   * changed shape.
   */
  it("says whose decision the model was, reachable as the chip's title", () => {
    const mine = composer(askable());
    expect(mine).toContain(describeAskModel(false));

    const theirs = composer(
      askable({
        model: {
          model_id: "anthropic/claude-sonnet-5",
          from_default: true,
          note: describeAskModel(true),
          change_label: ASK_MODEL_CHANGE,
        },
      }),
    );
    expect(theirs).toContain(describeAskModel(true));
    expect(describeAskModel(true)).not.toBe(describeAskModel(false));
  });

  it("is the way to change it — a link, since this surface has no picker of its own", () => {
    const html = composer(askable());
    expect(html).toMatch(/<a[^>]*class="chip chip-model chip-link"[^>]*href="[^"]*stage=settings[^"]*"/);
    expect(html).toContain(ASK_MODEL_CHANGE);
  });
});

describe("the room opens above the composer", () => {
  it("shows a heading, and the composer stays after it in source order", () => {
    const html = composer(askable(), { open: true });
    expect(html).toContain(`<p class="ask-room-heading">${ASK_HEADING}</p>`);
    expect(html.indexOf('class="ask-room"')).toBeLessThan(html.indexOf('class="ask-compose"'));
  });

  it("draws an X to collapse and a Clear button", () => {
    const html = composer(askable(), { open: true });
    expect(html).toContain('class="ask-room-close"');
    expect(html).toContain(ASK_CLOSE);
    expect(html).toContain('class="ask-room-clear"');
    expect(html).toContain(`>${ASK_CLEAR}<`);
    // Not the full `ASK_CLEAR_DETAIL` string: it carries an apostrophe, which
    // `renderToStaticMarkup` escapes to `&#x27;` in the attribute it sits in.
    expect(html).toContain("Clears what");
    expect(html).toContain("DASH still keeps this conversation");
  });

  it("disables Clear when there is nothing to clear", () => {
    const html = composer(askable({ history: [] }), { open: true });
    expect(/class="ask-room-clear"[^>]*\sdisabled/.test(html)).toBe(true);
  });

  it("leaves Clear enabled once a question has been answered", () => {
    const html = composer(askable(), { open: true });
    expect(/class="ask-room-clear"[^>]*\sdisabled/.test(html)).toBe(false);
  });

  it("draws the purpose, the history and the estimate — the same facts the Chat stage shows in full", () => {
    const html = composer(askable(), { open: true });
    expect(html).toContain(describeAskPurpose(AGENT).headline);
    expect(html).toContain(ANSWERED.question);
    expect(html).toContain("Up to 12 saved things");
  });

  it("stays closed on the Chat stage, where AskThread already shows this in full", () => {
    // The anti-duplication guard: `onChatStage` is the reason this composer
    // and `AskThread` never draw the purpose/history/estimate on one screen
    // at once — `AgentChatBar`'s own header states why.
    const html = composer(askable(), { open: true, onChatStage: true });
    expect(html).not.toContain("ask-room\"");
    expect(html).toContain("<textarea");
  });

  it("keeps working with a fresh conversation and nothing asked yet", () => {
    const html = composer(askable({ history: [] }), { open: true });
    expect(html).toContain('<textarea class="ask-input"');
    expect(/<textarea[^>]*\sdisabled/.test(html)).toBe(false);
  });

  it("marks the composer itself while its room is open", () => {
    expect(composer(askable(), { open: true })).toContain("ask-composer is-open");
  });
});

/* ---------------------------------------------------------------------- *
 * The word this surface must never use
 * ---------------------------------------------------------------------- */

describe("somebody who has never heard the word", () => {
  it("meets no identifier and no filing vocabulary, in any state", () => {
    const states = [
      askable(),
      askable({ history: [ANSWERED, FAILED] }),
      blocked("no_provider", false),
      blocked("no_key", true),
      blocked("no_model_chosen", false),
      blocked("nothing_saved", false),
    ];
    for (const state of states) {
      // MAR-545's own acceptance. `artifact`, `run_id` and `digest` are DASH's
      // words for its own filing, and the person who came to read the news does
      // not have them.
      for (const html of [thread(state), composer(state, { open: true })]) {
        expect(html.toLowerCase()).not.toContain("artifact");
        expect(html.toLowerCase()).not.toContain("run_id");
        expect(html.toLowerCase()).not.toContain("digest");
      }
    }
  });

  it("holds every sentence this surface composes to the identifier rule", () => {
    const view = askable();
    if (!view.can_ask) {
      return;
    }
    expectPlainLanguage([
      view.heading,
      view.purpose.headline,
      view.purpose.detail,
      view.custody,
      view.placeholder,
      view.submit,
      view.working,
      view.sources_heading,
      view.estimate.headline,
      view.estimate.detail,
      ASK_CLOSE,
      ASK_CLEAR,
      ASK_CLEAR_DETAIL,
    ]);
  });
});

describe("what DASH says while a question is running", () => {
  /*
   * The honesty rule MAR-648 states, tested where it is decided.
   * `describeAskActivity`'s own header carries the argument: the renderer
   * cannot see the four real steps inside `performAskAction`, so it names the
   * operation in flight and counts its own clock, and claims nothing else.
   */
  it("names no step DASH cannot observe", () => {
    for (const seconds of [0, 1, 7, 42]) {
      const line = describeAskActivity(seconds);
      expect(line.toLowerCase()).not.toContain("reading");
      expect(line.toLowerCase()).not.toContain("thinking");
      expect(line.toLowerCase()).not.toContain("choosing");
      expect(line.toLowerCase()).not.toContain("saving");
    }
  });

  it("counts the wait in whole seconds once there is one to count", () => {
    expect(describeAskActivity(0)).toBe("Asking…");
    expect(describeAskActivity(0.4)).toBe("Asking…");
    expect(describeAskActivity(1)).toBe("Asking… 1s");
    expect(describeAskActivity(7.9)).toBe("Asking… 7s");
  });

  it("holds the waiting line to the identifier rule", () => {
    expectPlainLanguage([describeAskActivity(0), describeAskActivity(12), ASK_ACTIVITY_LABEL]);
  });
});
