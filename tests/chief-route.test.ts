/**
 * The Chief's routing, and the rule it must never break (MAR-419).
 *
 * MAR-419's first acceptance criterion is that the Chief "correctly routes a
 * task to the one agent whose manifest declares the capability, with three
 * agents connected", and its routing rule is stated as a prohibition as much as
 * a method: *"not guessed from agent names, and not inferred from telemetry."*
 *
 * A prohibition needs a test that would fail if it were violated, which is what
 * the first block below is. The rest is the criterion itself.
 */

import { describe, expect, it } from "vitest";

import {
  declaredCapabilities,
  declaredVocabulary,
  routeRequest,
  words,
  type ChiefAgent,
} from "../lib/chief/route";

function agent(
  name: string,
  goal: string,
  capabilities: string[],
): ChiefAgent {
  return { name, goal, avatar: "wizard", capabilities };
}

/** Three connected agents, which is the number the acceptance criterion names. */
const FLEET: ChiefAgent[] = [
  agent(
    "ai-news-scout",
    "Reads the news sources you choose and writes you a short summary of what is new.",
    ["public_feed_fetch", "local_file_write"],
  ),
  agent(
    "meeting-assistant",
    "Drafts a reply to a meeting invitation in your mail drafts folder.",
    ["gmail_search", "gmail_draft_create"],
  ),
  agent(
    "invoice-filer",
    "Renames and files invoice documents into folders on this computer.",
    ["local_file_read", "local_file_write"],
  ),
];

/* ---------------------------------------------------------------------- *
 * The prohibition
 * ---------------------------------------------------------------------- */

describe("what routing is not allowed to look at", () => {
  /**
   * The load-bearing case in this file.
   *
   * An agent named for the work, declaring none of it, must not be chosen —
   * because the name is the most tempting thing in the record and the easiest
   * to match well on. If the name ever reaches the corpus this fails.
   */
  it("does not route on the agent's name, however well it reads", () => {
    const misleading: ChiefAgent[] = [
      agent("email-sender", "Files documents into folders.", ["local_file_write"]),
      agent("thing-doer", "Searches your mail and drafts replies.", ["gmail_search"]),
    ];
    const answer = routeRequest("search my email", misleading);
    expect(answer.kind).toBe("routed");
    if (answer.kind === "routed") {
      expect(answer.agent.name).toBe("thing-doer");
    }
  });

  it("keeps the name out of the declared vocabulary entirely", () => {
    // Not "is filtered out" — absent, so there is no line to delete later.
    const vocabulary = declaredVocabulary(
      agent("newsletter-digest-bot", "Files invoices.", ["local_file_write"]),
    );
    expect(vocabulary.has("newsletter")).toBe(false);
    expect(vocabulary.has("digest")).toBe(false);
    expect(vocabulary.has("bot")).toBe(false);
    expect(vocabulary.has("invoice")).toBe(true);
  });

  it("reads a component id as the words it is made of", () => {
    // `public_feed_fetch` is a declaration written in words. Splitting it is
    // reading the declaration, not inventing a synonym table.
    expect(words("public_feed_fetch")).toEqual(["public", "feed", "fetch"]);
  });

  it("drops grammar words that would otherwise match everything", () => {
    expect(words("can you do the thing for me")).toEqual(["thing"]);
  });
});

/* ---------------------------------------------------------------------- *
 * The acceptance criterion
 * ---------------------------------------------------------------------- */

describe("routing to the one agent that declares it", () => {
  it("picks the mail agent for a mail request, out of three", () => {
    const answer = routeRequest("draft a reply to this meeting invitation", FLEET);
    expect(answer.kind).toBe("routed");
    if (answer.kind === "routed") {
      expect(answer.agent.name).toBe("meeting-assistant");
    }
  });

  it("picks the news agent for a news request, out of the same three", () => {
    const answer = routeRequest("summarise what is new in the news", FLEET);
    expect(answer.kind).toBe("routed");
    if (answer.kind === "routed") {
      expect(answer.agent.name).toBe("ai-news-scout");
    }
  });

  it("matches a plural in the request against a singular in the manifest", () => {
    const answer = routeRequest("file these invoices", FLEET);
    expect(answer.kind).toBe("routed");
    if (answer.kind === "routed") {
      expect(answer.agent.name).toBe("invoice-filer");
    }
  });

  it("reports which words it matched on, so the routing can be argued with", () => {
    const answer = routeRequest("fetch the feed", FLEET);
    if (answer.kind !== "routed") {
      throw new Error(`expected a route, got ${answer.kind}`);
    }
    expect([...answer.matched].sort()).toEqual(["feed", "fetch"]);
  });
});

/* ---------------------------------------------------------------------- *
 * The refusals
 * ---------------------------------------------------------------------- */

describe("declining rather than improvising", () => {
  /**
   * MAR-419: "when no connected agent can do the thing, the Chief says so and
   * names what is missing. It must not improvise a plan that no agent declared
   * it can execute."
   */
  it("refuses work nobody declared, and hands back what the fleet can do", () => {
    const answer = routeRequest("book me a flight to Lisbon", FLEET);
    expect(answer.kind).toBe("nobody");
    if (answer.kind === "nobody") {
      expect(answer.declared).toContain("gmail_search");
      expect(answer.declared).toContain("public_feed_fetch");
    }
  });

  it("asks rather than choosing when two agents declare it equally", () => {
    // Both declare `local_file_write` and nothing separates them. A coin toss
    // here would be the Chief's confidence exceeding its information.
    const answer = routeRequest("write a file", FLEET);
    expect(answer.kind).toBe("ambiguous");
    if (answer.kind === "ambiguous") {
      expect(answer.agents.map((a) => a.name).sort()).toEqual([
        "ai-news-scout",
        "invoice-filer",
      ]);
    }
  });

  it("says nothing was asked rather than refusing an empty request", () => {
    // Not a refusal: there is no request to refuse, and a page that answered
    // "nobody can do that" to an empty box would be answering a question
    // nobody asked.
    expect(routeRequest("   ", FLEET).kind).toBe("empty");
    expect(routeRequest("can you please", FLEET).kind).toBe("empty");
  });

  it("has an honest answer with no agents at all", () => {
    const answer = routeRequest("do anything", []);
    expect(answer.kind).toBe("nobody");
    if (answer.kind === "nobody") {
      expect(answer.declared).toEqual([]);
    }
  });

  it("lists every declared capability once, in a stable order", () => {
    // `local_file_write` is declared by two agents and must appear once.
    expect(declaredCapabilities(FLEET)).toEqual([
      "gmail_draft_create",
      "gmail_search",
      "local_file_read",
      "local_file_write",
      "public_feed_fetch",
    ]);
  });
});
