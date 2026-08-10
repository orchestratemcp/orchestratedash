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
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AskAgent } from "../app/_components/ask";
import {
  ASK_CUSTODY,
  ASK_HEADING,
  ASK_PLACEHOLDER,
  ASK_SOURCES_HEADING,
  ASK_SUBMIT,
  ASK_WORKING,
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
    submit: ASK_SUBMIT,
    working: ASK_WORKING,
    sources_heading: ASK_SOURCES_HEADING,
    provider_label: "OpenRouter",
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

function draw(ask: AgentAskView, canAct = true): string {
  return renderToStaticMarkup(
    <AskAgent
      ask={ask}
      canAct={canAct}
      onAsked={() => undefined}
      setFeedback={() => undefined}
    />,
  );
}

/* ---------------------------------------------------------------------- *
 * Asking
 * ---------------------------------------------------------------------- */

describe("the chat when there is something to ask", () => {
  it("draws a box, a button, and the estimate above both", () => {
    const html = draw(askable());
    expect(html).toContain(ASK_PLACEHOLDER);
    expect(html).toContain(ASK_SUBMIT);
    // The estimate is the one line that could change what somebody types, so it
    // has to be readable before the control it applies to — placed under the
    // button it would be read after the decision.
    expect(html.indexOf("Up to 12 saved things")).toBeLessThan(html.indexOf(ASK_PLACEHOLDER));
  });

  it("starts with the button unpressable, because an empty question is a charge for nothing", () => {
    expect(draw(askable({ history: [] }))).toContain("disabled");
  });

  it("says where the words go, and what each number is", () => {
    const html = draw(askable());
    expect(html).toContain("Your questions and the answers stay on this computer");
    // The two figures side by side, each attributed. One is the provider's for
    // something DASH asked; the other is the agent's about its own past.
    expect(html).toContain("OpenRouter has charged");
    expect(html).toContain("not something DASH watched");
  });

  it("renders an answer as text, and keeps a link inside it text", () => {
    const html = draw(
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
    const html = draw(askable());
    expect(html).toContain('href="https://example.test/chips"');
    expect(html).toContain("Tariffs on steel confirmed");
    expect(html).toContain(ASK_SOURCES_HEADING);
    // Every outbound link in DASH carries this.
    expect(html).toContain('rel="noreferrer"');
  });

  it("shows a question that failed, with what to do about it", () => {
    const html = draw(askable({ history: [ANSWERED, FAILED] }));
    expect(html).toContain("And about shipping?");
    expect(html).toContain("turned the question down");
    expect(html).toContain("Check the model this agent is set to use");
    // In order, so the conversation reads downwards.
    expect(html.indexOf("What have you found")).toBeLessThan(html.indexOf("And about shipping"));
  });

  it("tells a browser tab which window can act rather than drawing a dead box", () => {
    const html = draw(askable(), false);
    expect(html).toContain("Open the installed DASH app");
    expect(html).not.toContain("<textarea");
    // And the conversation is still fully readable there, which is the whole
    // point of the answer living in the view rather than in one window's memory.
    expect(html).toContain("Two of the saved reports mention tariffs");
  });
});

/* ---------------------------------------------------------------------- *
 * Not asking
 * ---------------------------------------------------------------------- */

describe("the chat when there is nothing to ask with", () => {
  it("never draws an input, in any of the four reasons", () => {
    for (const reason of ["no_provider", "no_key", "no_model_chosen", "nothing_saved"] as const) {
      const html = draw(blocked(reason, reason === "no_key"));
      expect(html).not.toContain("<textarea");
      expect(html).toContain(ASK_HEADING);
      // A sentence and a next action, every time.
      const recovery = describeUnavailable(reason, { agent: AGENT, service: "OpenRouter" });
      expect(html).toContain(recovery.headline);
      expect(html).toContain(recovery.next_action);
    }
  });

  it("makes the one fixable reason a button rather than an instruction", () => {
    const html = draw(blocked("no_key", true));
    expect(html).toContain("<button");
    expect(html).toContain("Connect OpenRouter");
  });

  it("gives the other reasons no button, because there is nothing here for one to do", () => {
    expect(draw(blocked("no_provider", false))).not.toContain("<button");
    expect(draw(blocked("nothing_saved", false))).not.toContain("<button");
  });

  it("keeps a conversation that happened before the key was withdrawn", () => {
    const html = draw({ ...blocked("no_key", true), history: [ANSWERED] });
    expect(html).toContain("Two of the saved reports mention tariffs");
    expect(html).toContain(ASK_SOURCES_HEADING);
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
      const html = draw(state);
      // MAR-545's own acceptance. `artifact`, `run_id` and `digest` are DASH's
      // words for its own filing, and the person who came to read the news does
      // not have them.
      expect(html.toLowerCase()).not.toContain("artifact");
      expect(html.toLowerCase()).not.toContain("run_id");
      expect(html.toLowerCase()).not.toContain("digest");
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
    ]);
  });
});
