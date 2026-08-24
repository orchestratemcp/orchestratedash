/**
 * Henrik's own two sentences, driven end to end (MAR-744).
 *
 * > *"we should be able to ask the chief to pull out the most current news,
 * > then ask it to find more sources to a topic"*
 *
 * `answerChiefQuestion` is the shared procedure both rooms host, so a test that
 * drives it with a fake broker and a fake fetch is a test of **both** the window
 * and Discord — which is the whole point of ADR 0028 decision 1 and the reason
 * this file is not written twice. What each room does with the outcome is
 * `tests/chief-discord.test.ts` and `tests/chief-transcript.test.ts`.
 *
 * The assertions worth reading are the ones about what the model was *sent*:
 * that the material carried the brief's own content, that it carried no address
 * at all, and that every link a person can click came off DASH's record instead.
 */

import { describe, expect, it } from "vitest";

import { answerChiefQuestion, type ChiefAnswerDeps } from "../lib/chief/answer";
import type { ChiefBriefingRow } from "../lib/chief/briefing";
import type { FetchedSource } from "../lib/chief/fetch-sources";
import { chiefLibrary, type ChiefItem } from "../lib/chief/library";
import type { ChiefTurnDraft } from "../lib/chief/store";
import { fulfil, refuse, type BrokerRequest } from "../lib/broker/protocol";
import type { AiProviderProfile } from "../lib/ai/providers";
import { aiProviders } from "../lib/ai/providers";
import type { BriefArtifact, DigestArtifact } from "../lib/contracts";

/* ---------------------------------------------------------------------- *
 * A fleet with one scout that has run
 * ---------------------------------------------------------------------- */

const SCOUT = "ai-agent-news";

/**
 * The address a headline carried out of the feed.
 *
 * Distinctive on purpose: the assertions below search the whole request body for
 * it, and *"no address reached the model"* is only a real claim if the address
 * would have been findable had it leaked.
 */
const ITEM_URL = "https://collected.example/tariff-story";

function digest(): DigestArtifact {
  return {
    kind: "digest",
    artifact_version: 1,
    agent: SCOUT,
    run_id: "run-2",
    artifact_id: "artifact-digest",
    title: "AI agents roundup",
    generated_at: "2026-08-24T06:00:00.000Z",
    items: [
      {
        headline: "Tariffs reshape the chip supply chain",
        summary: "Two governments moved on semiconductor duties this week.",
        source_name: "Google News",
        item_url: ITEM_URL,
        published_at: "2026-08-24T05:00:00.000Z",
      },
      {
        headline: "A new open-source agent framework ships",
        summary: "It claims a smaller runtime than the incumbents.",
        source_name: "Hacker News",
        item_url: "https://collected.example/framework",
      },
    ],
  };
}

function brief(): BriefArtifact {
  return {
    kind: "brief",
    artifact_version: 2,
    agent: SCOUT,
    run_id: "run-2",
    artifact_id: "artifact-brief",
    title: "This week in AI agents",
    generated_at: "2026-08-24T06:05:00.000Z",
    document: {
      sections: [
        {
          heading: "Tariffs are the week's story",
          paragraphs: [{ body: "Duties on semiconductors moved twice.", items: [0] }],
        },
      ],
    },
    derived_from: {
      artifact_id: "artifact-digest",
      run_id: "run-2",
      item_count: 2,
      items_digest: "a".repeat(64),
    },
  };
}

/** An older run, so *newest first* is a claim with something to be wrong about. */
function olderDigest(): DigestArtifact {
  return {
    ...digest(),
    run_id: "run-1",
    artifact_id: "artifact-old",
    title: "Last month's roundup",
    generated_at: "2026-07-01T06:00:00.000Z",
    items: [{ headline: "Something from July", source_name: "Google News" }],
  };
}

const LIBRARY: ChiefItem[] = chiefLibrary([
  {
    agent: SCOUT,
    title: "AI agent news",
    artifacts: [brief(), digest(), olderDigest()],
  },
]);

const BRIEFING: ChiefBriefingRow[] = [
  {
    agent: SCOUT,
    title: "AI agent news",
    place: "Local",
    standing: "Nothing needs you.",
    runs: "Two runs so far",
    last_run: "today",
    capabilities: ["public_feed_fetch"],
  },
];

/* ---------------------------------------------------------------------- *
 * The world one question is answered in
 * ---------------------------------------------------------------------- */

interface Harness {
  deps: ChiefAnswerDeps;
  sent: BrokerRequest[];
  written: ChiefTurnDraft[];
  searched: string[];
}

const PROFILE: AiProviderProfile = aiProviders()[0] as AiProviderProfile;

const FETCHED: FetchedSource[] = [
  {
    id: "google-news",
    name: "Google News",
    address: "https://news.google.com/rss/search?q=tariffs",
    status: "ok",
    items: [
      {
        headline: "Fresh tariff ruling lands",
        item_url: "https://news.google.example/fresh",
        published_at: "2026-08-24T08:00:00.000Z",
      },
    ],
  },
  {
    id: "hacker-news",
    name: "Hacker News",
    address: "https://hn.algolia.com/api/v1/search_by_date?query=tariffs",
    status: "ok",
    items: [
      { headline: "Discussion of the ruling", item_url: "https://hn.example/1", published_at: null },
    ],
  },
  {
    id: "arxiv",
    name: "arXiv",
    address: "https://export.arxiv.org/api/query?search_query=all:tariffs",
    status: "unreachable",
    items: [],
  },
];

function harness(
  over: {
    model?: boolean;
    library?: readonly ChiefItem[];
    fetched?: readonly FetchedSource[] | null;
    answer?: string;
  } = {},
): Harness {
  const sent: BrokerRequest[] = [];
  const written: ChiefTurnDraft[] = [];
  const searched: string[] = [];
  const fetched = over.fetched === undefined ? FETCHED : over.fetched;

  return {
    sent,
    written,
    searched,
    deps: {
      snapshot: {
        fleet: [],
        briefing: BRIEFING,
        library: over.library ?? LIBRARY,
        taken_at: null,
      },
      model:
        over.model === false ? null : { profile: PROFILE, model_id: "a-model" },
      context: "",
      ask: async (request) => {
        sent.push(request);
        // The protocol's own constructor rather than a literal, so the fake
        // cannot drift from the shape a real broker returns.
        return fulfil(request.request_id, {
          answer: over.answer ?? "Here is what your scout found. [1] is the big one.",
          model: "a-model",
        });
      },
      fetchSources:
        fetched === null
          ? null
          : async (topic) => {
              searched.push(topic);
              return fetched;
            },
      record: (draft) => {
        written.push(draft);
        return true;
      },
      now: () => new Date("2026-08-24T09:00:00.000Z"),
    },
  };
}

/** The material the one brokered request carried. */
function material(sent: readonly BrokerRequest[]): string {
  return String(sent[0]?.input["material"] ?? "");
}

/* ---------------------------------------------------------------------- *
 * Turn one: pull out the most current news
 * ---------------------------------------------------------------------- */

describe("pull out the most current news", () => {
  it("answers from the fleet's own reports, newest first", async () => {
    const { deps, sent, written } = harness();
    const outcome = await answerChiefQuestion("pull out the most current news", "window", deps);

    expect(outcome.kind).toBe("answered");
    expect(sent).toHaveLength(1);

    // The brief and this week's digest are in it; July's is not, because the
    // library is newest-first and the ceiling bites before it.
    const sentMaterial = material(sent);
    expect(sentMaterial).toContain("Tariffs are the week's story");
    expect(sentMaterial).toContain("Tariffs reshape the chip supply chain");
    expect(sentMaterial).toContain("AI agent news");

    // Not the briefing. A question about output does not spend on a list of
    // agents, and the receipt says so by being empty.
    expect(sentMaterial).not.toContain("Nothing needs you.");
    expect(written[0]?.receipt).toEqual([]);
  });

  /*
   * The grounding rule, driven from the outside. `renderChiefItem` omits
   * `item_url` and this is the assertion that keeps it omitted: an address in
   * the material is an address the model can repeat into an answer, and a
   * person reading a chat reply cannot tell a link DASH fetched from a link a
   * model assembled.
   */
  it("sends the model no address at all", async () => {
    const { deps, sent } = harness();
    await answerChiefQuestion("pull out the most current news", "window", deps);

    const body = JSON.stringify(sent[0]?.input);
    expect(body).not.toContain(ITEM_URL);
    expect(body).not.toContain("https://collected.example");
  });

  it("cites every item it sent, by the number the material used", async () => {
    const { deps, written } = harness();
    const outcome = await answerChiefQuestion("pull out the most current news", "window", deps);

    expect(outcome.kind).toBe("answered");
    const evidence = outcome.kind === "answered" ? outcome.evidence : { kind: "none" as const };
    expect(evidence.kind).toBe("outputs");
    if (evidence.kind !== "outputs") {
      return;
    }
    expect(evidence.citations.length).toBeGreaterThan(0);
    expect(evidence.citations.map((one) => one.index)).toEqual(
      evidence.citations.map((_, index) => index + 1),
    );
    // The link is on the citation, from DASH's own record of the item.
    expect(evidence.citations.some((one) => one.item_url === ITEM_URL)).toBe(true);
    expect(evidence.citations.every((one) => one.agent === SCOUT)).toBe(true);
    // And it is frozen onto the turn, so the scrollback shows what this answer
    // was built from rather than what today's would be.
    expect(written[0]?.evidence).toEqual(evidence);
  });

  it("says plainly that there is nothing when the fleet has produced nothing", async () => {
    const { deps, written } = harness({ library: [] });
    const outcome = await answerChiefQuestion("pull out the most current news", "window", deps);

    expect(outcome.kind).toBe("answered");
    const evidence = written[0]?.evidence;
    expect(evidence?.kind).toBe("outputs");
    if (evidence?.kind === "outputs") {
      expect(evidence.basis).toBe("nothing_saved");
      expect(evidence.citations).toEqual([]);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Turn two: find more sources about one of its topics
 * ---------------------------------------------------------------------- */

describe("find more sources about a topic", () => {
  it("searches for the subject and answers from what came back", async () => {
    const { deps, sent, searched } = harness();
    const outcome = await answerChiefQuestion(
      "find more sources about tariffs",
      "window",
      deps,
    );

    expect(searched).toEqual(["tariffs"]);
    expect(outcome.kind).toBe("answered");

    const sentMaterial = material(sent);
    expect(sentMaterial).toContain("Fresh tariff ruling lands");
    expect(sentMaterial).toContain("Google News");
    // The source that did not answer is named, so the answer can say so rather
    // than describing two sources as three.
    expect(sentMaterial).toContain("arXiv");
  });

  it("sends the model no address, and puts every link on the citation", async () => {
    const { deps, sent } = harness();
    const outcome = await answerChiefQuestion("find more sources about tariffs", "window", deps);

    expect(JSON.stringify(sent[0]?.input)).not.toContain("https://");

    const evidence = outcome.kind === "answered" ? outcome.evidence : { kind: "none" as const };
    expect(evidence.kind).toBe("sources");
    if (evidence.kind !== "sources") {
      return;
    }
    expect(evidence.topic).toBe("tariffs");
    expect(evidence.citations).toHaveLength(2);
    expect(evidence.citations[0]?.item_url).toBe("https://news.google.example/fresh");
    // Every source DASH tried, including the one that did not answer.
    expect(evidence.sources.map((one) => one.name)).toEqual([
      "Google News",
      "Hacker News",
      "arXiv",
    ]);
    expect(evidence.sources[2]?.status).toBe("unreachable");
  });

  it("does not buy an answer when nothing came back", async () => {
    const empty = FETCHED.map((source) => ({ ...source, status: "empty" as const, items: [] }));
    const { deps, sent, written } = harness({ fetched: empty });
    const outcome = await answerChiefQuestion("find more sources about tariffs", "window", deps);

    // Nothing to write prose over, so nothing was asked and nothing charged.
    expect(sent).toEqual([]);
    expect(written[0]?.provider_id).toBeNull();
    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      // The honest sentence names what was searched rather than implying the
      // internet was.
      expect(outcome.text).toContain("Google News");
    }
  });

  it("tells 'nothing was listed' apart from 'I could not get through'", async () => {
    const down = FETCHED.map((source) => ({
      ...source,
      status: "unreachable" as const,
      items: [],
    }));
    const { deps } = harness({ fetched: down });
    const outcome = await answerChiefQuestion("find more sources about tariffs", "window", deps);

    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      expect(outcome.text).toContain("could not reach");
    }
  });

  it("says what it needs when no subject was named", async () => {
    const { deps, sent, searched } = harness();
    const outcome = await answerChiefQuestion("find more sources", "window", deps);

    expect(searched).toEqual([]);
    expect(sent).toEqual([]);
    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      expect(outcome.text).toContain("what about");
    }
  });

  it("says it cannot search from a room that has no fetcher", async () => {
    const { deps, sent } = harness({ fetched: null });
    const outcome = await answerChiefQuestion("find more sources about tariffs", "window", deps);

    expect(sent).toEqual([]);
    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      expect(outcome.text).toContain("cannot go and look things up from here");
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The rules the harness must not have broken
 * ---------------------------------------------------------------------- */

describe("what a tool does not change", () => {
  /*
   * Records first, and free. A standing question must not become a spend
   * because it happens to contain a word this packet added to a list.
   */
  it("still answers a standing question from records with no model call", async () => {
    const { deps, sent, written } = harness();
    const outcome = await answerChiefQuestion("how is my fleet doing", "window", deps);

    expect(sent).toEqual([]);
    expect(written[0]?.provider_id).toBeNull();
    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      expect(outcome.from).toBe("records");
      expect(outcome.evidence.kind).toBe("none");
    }
  });

  it("still answers an ordinary question from the briefing", async () => {
    const { deps, sent, written } = harness();
    await answerChiefQuestion("which agents run locally", "window", deps);

    expect(material(sent)).toContain("Nothing needs you.");
    expect(written[0]?.receipt).toEqual(BRIEFING);
    expect(written[0]?.evidence).toEqual({ kind: "none" });
  });

  /*
   * ADR 0023 decision 4, unwidened. Whatever a tool did, the one thing that
   * reaches a broker is still one completion on the chief's one connection.
   */
  it("reaches exactly one operation on one connection, whichever tool ran", async () => {
    for (const question of [
      "pull out the most current news",
      "find more sources about tariffs",
      "which agents run locally",
    ]) {
      const { deps, sent } = harness();
      await answerChiefQuestion(question, "window", deps);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.connection_id).toBe("chief:model-provider");
      expect(sent[0]?.operation).toBe(`${PROFILE.id}.chat.completion`);
      // No frame supplied: the broker writes it from the principal.
      expect(sent[0]?.input["frame"]).toBeUndefined();
    }
  });

  /*
   * The degraded room. A chief with no model still did the work -- ADR 0028
   * decision 9's rule, and the reason a tool runs before the model check.
   */
  it("still fetches and still cites when there is no model to ask", async () => {
    const { deps, sent } = harness({ model: false });
    const outcome = await answerChiefQuestion("find more sources about tariffs", "window", deps);

    expect(sent).toEqual([]);
    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      expect(outcome.no_model).toBe(true);
      expect(outcome.evidence.kind).toBe("sources");
      if (outcome.evidence.kind === "sources") {
        expect(outcome.evidence.citations).toHaveLength(2);
      }
    }
  });

  it("keeps the citations when the model refuses after a successful fetch", async () => {
    const { deps } = harness();
    const refusing: ChiefAnswerDeps = {
      ...deps,
      ask: async (request) => refuse(request.request_id, "provider_unavailable"),
    };
    const outcome = await answerChiefQuestion(
      "find more sources about tariffs",
      "window",
      refusing,
    );

    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.evidence.kind).toBe("sources");
      if (outcome.evidence.kind === "sources") {
        expect(outcome.evidence.citations).toHaveLength(2);
      }
    }
  });
});
