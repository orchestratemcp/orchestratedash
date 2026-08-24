/**
 * What the chief answers, and what it refuses to make up (MAR-648).
 *
 * `tests/chief-route.test.ts` drives the routing underneath this. What is
 * asserted here is the layer MAR-648 added on top of it: which of the two kinds
 * of answer a question gets, and the property that makes a chief with no model
 * safe to put a box in front of — **every sentence it produces traces to a
 * record it was handed.**
 *
 * The precedence case is the one worth reading. `lib/chief/reply.ts` routes
 * before it stands, and the fleet DASH actually ships is why: one agent whose
 * own goal contains the word *agent*, and a question about the news that must
 * not come back as a status line.
 */

import { describe, expect, it } from "vitest";

import { answerChief, asksAboutStanding, type ChiefFleetAgent } from "../lib/chief/reply";
import { recordsAnswer, undeclaredAnswer } from "../lib/chief/records-answer";
import { CHIEF_WAITING } from "../lib/copy/chief";
import { GLANCE_ALL_CLEAR, type GlanceChip } from "../lib/copy/glance";

const NEEDS_YOU: GlanceChip = {
  question: "needs_you",
  label: "needs you",
  meaning: "This agent is waiting for you to approve something before it can carry on.",
  tone: "warn",
};

const NEW_OUTPUT: GlanceChip = {
  question: "new_output",
  label: "2 new",
  meaning: "This agent has saved 2 things since you last looked at it.",
  tone: "accent",
};

function agent(over: Partial<ChiefFleetAgent> = {}): ChiefFleetAgent {
  return {
    name: "ai-agent-news",
    title: "AI agent news",
    goal: "Collect news about ai agents from public feeds and write a digest.",
    avatar: "ninja",
    capabilities: ["public_feed_fetch", "digest_compose"],
    glance: [GLANCE_ALL_CLEAR],
    status: null,
    ...over,
  };
}

describe("which kind of answer a question gets", () => {
  it("routes a question about a subject an agent declares", () => {
    const reply = answerChief("what is the latest news?", [agent()]);
    expect(reply.kind).toBe("routed");
    if (reply.kind !== "routed") {
      return;
    }
    expect(reply.agent.name).toBe("ai-agent-news");
    expect(reply.matched).toContain("new");
  });

  it("answers about the fleet when the question is about standing", () => {
    const reply = answerChief("what needs me?", [agent({ status: "needs_input", glance: [NEEDS_YOU] })]);
    expect(reply.kind).toBe("standing");
  });

  /*
   * The case the precedence exists for, and it is not hypothetical: DASH ships
   * one demo agent and its goal says "ai agents". Standing-first would read the
   * word `agent` in this question, match it against nothing in particular, and
   * answer the most likely question anybody will ever type here with a status
   * line about a fleet of one.
   */
  it("does not read a topic question as a question about the fleet", () => {
    const reply = answerChief("what's the latest ai agent news?", [agent()]);
    expect(reply.kind).toBe("routed");
  });

  /* The other half of the same precedence: a standing word wins even where an
     agent would otherwise have claimed the sentence. */
  it("does not route a standing question to an agent that declares one of its words", () => {
    const feeds = agent({
      name: "status-watch",
      title: "Status watch",
      goal: "Check the status of public feeds and report what is broken.",
      capabilities: ["status_check"],
    });
    expect(answerChief("what is wrong?", [feeds]).kind).toBe("standing");
    expect(answerChief("is anything broken?", [feeds]).kind).toBe("standing");
  });

  it("names the tie rather than picking one", () => {
    const reply = answerChief("send an email", [
      agent({ name: "one", title: "One", goal: "Send an email digest.", capabilities: ["mail_send"] }),
      agent({ name: "two", title: "Two", goal: "Send an email summary.", capabilities: ["mail_send"] }),
    ]);
    expect(reply.kind).toBe("ambiguous");
    if (reply.kind !== "ambiguous") {
      return;
    }
    expect(reply.agents.map((one) => one.name)).toEqual(["one", "two"]);
  });

  it("falls back to the standing when nobody declares the subject", () => {
    const reply = answerChief("book me a flight to Lisbon", [agent()]);
    expect(reply.kind).toBe("undeclared");
    if (reply.kind !== "undeclared") {
      return;
    }
    // MAR-419's rule: name what the fleet *does* declare, so a person who
    // disagrees knows where to go and change it.
    expect(reply.declared).toEqual(["digest_compose", "public_feed_fetch"]);
    // And still answer the question it can — see `ChiefReply.undeclared`.
    expect(reply.summary.length).toBeGreaterThan(0);
  });

  it("has a reply for a question with no words worth matching", () => {
    expect(answerChief("the a of", [agent()]).kind).toBe("nothing_asked");
  });
});

/*
 * MAR-742 roadmap item 2. The chief's room now mounts for a genuinely empty
 * fleet (`app/page.tsx` no longer skips `FleetList` when `agents.length === 0`),
 * so this is a real, reachable state rather than the one `CHIEF_WAITING` used to
 * document as impossible. What matters here is that DASH tells the truth about
 * *which* absence it is looking at — no agents at all is a different fact from
 * agents that declare nothing — and that the records-only path (no model
 * connected) says how to add one rather than just naming the gap.
 */
describe("the empty fleet (MAR-742)", () => {
  it("answers from records rather than refusing", () => {
    const reply = answerChief("what agents do I have?", []);
    expect(reply.kind).toBe("undeclared");
    if (reply.kind !== "undeclared") {
      return;
    }
    expect(reply.declared).toEqual([]);
    expect(reply.summary).toBe(CHIEF_WAITING);
  });

  it("names the fleet as empty rather than as undeclared, records-only", () => {
    // `recordsAnswer` returns null for the "undeclared" kind either way — the
    // caller's fallback, `undeclaredAnswer`, is what a DASH with no model to
    // ask actually shows, and it is where the two absences must not blur.
    expect(recordsAnswer("what agents do I have?", [])).toBeNull();
    const empty = undeclaredAnswer("what agents do I have?", []);
    expect(empty).toContain("Your fleet is empty");
    expect(empty).not.toContain("None of your agents has declared");

    const undeclared = undeclaredAnswer("book me a flight", [agent({ goal: "", capabilities: [] })]);
    expect(undeclared).toContain("None of your agents has declared");
    expect(undeclared).not.toContain("Your fleet is empty");
  });
});

describe("what the chief may say about an agent", () => {
  it("quotes a glance chip rather than rewording it", () => {
    const reply = answerChief("what needs me?", [agent({ status: "needs_input", glance: [NEEDS_YOU] })]);
    if (reply.kind !== "standing") {
      throw new Error("expected a standing answer");
    }
    expect(reply.demands).toHaveLength(1);
    expect(reply.demands[0]?.meaning).toBe(NEEDS_YOU.meaning);
    expect(reply.demands[0]?.label).toBe(NEEDS_YOU.label);
  });

  /*
   * `GLANCE_ALL_CLEAR` exists so a *card* is never blank. A chief that recited
   * it once per healthy agent would bury the two that need you under the ten
   * that do not — and the count of healthy agents is already in the summary.
   */
  it("does not list an agent whose only chip is the all-clear", () => {
    const reply = answerChief("what needs me?", [agent()]);
    if (reply.kind !== "standing") {
      throw new Error("expected a standing answer");
    }
    expect(reply.demands).toEqual([]);
  });

  it("speaks the most pressing chip when a card carries several", () => {
    const reply = answerChief("what needs me?", [
      agent({ status: "needs_input", glance: [NEW_OUTPUT, NEEDS_YOU] }),
    ]);
    if (reply.kind !== "standing") {
      throw new Error("expected a standing answer");
    }
    // Amber outranks blue, which is `lib/copy/chief.ts`'s own scale — waiting
    // beats working, because the person is what the agent is blocked on.
    expect(reply.demands[0]?.label).toBe(NEEDS_YOU.label);
  });

  it("counts the fleet from the same statuses the cards are tinted by", () => {
    const reply = answerChief("how is the fleet?", [
      agent({ name: "a", status: "needs_input", glance: [NEEDS_YOU] }),
      agent({ name: "b", status: "working" }),
    ]);
    if (reply.kind !== "standing") {
      throw new Error("expected a standing answer");
    }
    expect(reply.summary).toBe("1 needs you, 1 working.");
  });
});

describe("what routing is allowed to look at", () => {
  /*
   * The rule `lib/chief/route.ts` is written around, asserted at this layer too
   * because `answerChief` is what the surface actually calls — and because the
   * projection that keeps it true lives here rather than there.
   */
  it("never routes on the agent's name", () => {
    const reply = answerChief("send an email", [
      agent({
        name: "email-sender",
        title: "Email sender",
        goal: "Collect news from public feeds.",
        capabilities: ["public_feed_fetch"],
      }),
    ]);
    expect(reply.kind).toBe("undeclared");
  });

  it("never routes on how an agent is doing", () => {
    // A running agent with things waiting is the most "relevant" agent on any
    // reasonable reading of the word, and it is still not the answer to a
    // question about a subject it does not declare.
    const reply = answerChief("book me a flight", [
      agent({ status: "needs_input", glance: [NEEDS_YOU] }),
    ]);
    expect(reply.kind).toBe("undeclared");
  });

  it("routes to nobody on a fleet whose manifests declare nothing", () => {
    const reply = answerChief("read the news", [agent({ goal: "", capabilities: [] })]);
    expect(reply.kind).toBe("undeclared");
    if (reply.kind !== "undeclared") {
      return;
    }
    expect(reply.declared).toEqual([]);
  });
});

describe("the standing words", () => {
  it("recognises the questions somebody actually types", () => {
    for (const question of [
      "what needs me?",
      "is anything waiting?",
      "what is wrong?",
      "anything broken?",
      "any errors?",
      "how is the fleet?",
      "what is the status?",
      "is anything overdue?",
    ]) {
      expect(asksAboutStanding(question), question).toBe(true);
    }
  });

  it("stays out of the way of ordinary topic questions", () => {
    for (const question of [
      "what have you found about tariffs?",
      "what is the latest news?",
      "summarise this week",
      "who reads my email?",
    ]) {
      expect(asksAboutStanding(question), question).toBe(false);
    }
  });
});
