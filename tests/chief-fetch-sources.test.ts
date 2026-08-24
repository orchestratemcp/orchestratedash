/**
 * Every fetch is a row, and no fetch goes anywhere DASH did not choose
 * (MAR-744).
 *
 * The property under test is the one `runner/chief-broker.ts` holds for a model
 * call, restated for the packet's one outbound reach: **one audit row per
 * source, on every path**. An audit table is a record of decisions rather than
 * of successes, and the way that stays true is that `decide()` is the single
 * exit — so the test worth writing is the one that walks every failure mode and
 * counts the rows.
 */

import { describe, expect, it } from "vitest";

import type { ChiefDecisionRow } from "../lib/chief/audit";
import { CHIEF_SOURCES_CONNECTION_ID, CHIEF_SOURCES_OPERATION } from "../lib/chief/audit";
import { fetchChiefSources } from "../lib/chief/fetch-sources";
import { CHIEF_SOURCES, CHIEF_SOURCE_ORIGINS, type ChiefSource } from "../lib/chief/sources";

/*
 * A body in each of the three formats, chosen by which source asked for it.
 *
 * One body for all three would be a test that only ever exercised the RSS
 * parser and read the other two as not-a-feed -- which is what the real thing
 * would correctly do, and would have made "six per source" quietly mean "six in
 * total". `readFeed` picks its parser from the source's declared format, so a
 * harness that ignores the format is not standing in for a real source.
 */
const TEN = Array.from({ length: 10 }, (_, i) => String(i));

const RSS =
  "<rss><channel>" +
  TEN.map((i) => `<item><title>Story ${i}</title><link>https://e.example/${i}</link></item>`).join("") +
  "</channel></rss>";

const ATOM =
  "<feed>" +
  TEN.map((i) => `<entry><title>Paper ${i}</title><link href="https://a.example/${i}"/></entry>`).join("") +
  "</feed>";

const ALGOLIA = JSON.stringify({
  hits: TEN.map((i) => ({ title: `Post ${i}`, url: `https://h.example/${i}` })),
});

/** The body a real source at this address would answer with. */
function bodyFor(url: string): string {
  const { origin } = new URL(url);
  if (origin === "https://hn.algolia.com") {
    return ALGOLIA;
  }
  return origin === "https://export.arxiv.org" ? ATOM : RSS;
}

/** The same, listing nothing -- reachable and empty rather than not-a-feed. */
function emptyBodyFor(url: string): string {
  const { origin } = new URL(url);
  if (origin === "https://hn.algolia.com") {
    return JSON.stringify({ hits: [] });
  }
  return origin === "https://export.arxiv.org"
    ? "<feed><entry></entry></feed>"
    : "<rss><channel><item></item></channel></rss>";
}

function harness(
  responder: (url: string) => Response | Promise<Response> | Error,
): { deps: Parameters<typeof fetchChiefSources>[1]; rows: ChiefDecisionRow[]; urls: string[] } {
  const rows: ChiefDecisionRow[] = [];
  const urls: string[] = [];
  let tick = 0;
  return {
    rows,
    urls,
    deps: {
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        const answer = await responder(url);
        if (answer instanceof Error) {
          throw answer;
        }
        return answer;
      }) as unknown as typeof fetch,
      audit: (row) => rows.push(row),
      now: () => new Date(1_760_000_000_000 + (tick += 1) * 10),
    },
  };
}

const ok = (body: string): Response =>
  new Response(body, { status: 200, headers: { "content-type": "application/xml" } });

describe("a fetch goes to the allowlist and nowhere else", () => {
  it("requests one address per source, all on the allowlist", async () => {
    const { deps, urls } = harness((url) => ok(bodyFor(url)));
    await fetchChiefSources("tariffs", deps, CHIEF_SOURCES);

    expect(urls).toHaveLength(CHIEF_SOURCES.length);
    for (const url of urls) {
      expect(CHIEF_SOURCE_ORIGINS).toContain(new URL(url).origin);
      expect(url).toContain("tariffs");
    }
  });

  /*
   * The guard that matters, driven from the far side. A source whose template
   * points somewhere else does not produce a request -- `addressFor` refuses it
   * on the origin re-check -- and the refusal is still a row.
   */
  it("does not fetch a source whose template leaves the allowlist", async () => {
    const rogue: ChiefSource = {
      id: "rogue",
      name: "Rogue",
      format: "rss",
      address: (topic) => `https://evil.example/rss?q=${encodeURIComponent(topic)}`,
    };
    const { deps, rows, urls } = harness((url) => ok(bodyFor(url)));
    const outcome = await fetchChiefSources("tariffs", deps, [rogue]);

    expect(urls).toEqual([]);
    expect(outcome.sources[0]?.status).toBe("refused");
    expect(outcome.sources[0]?.address).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe("refused");
    expect(rows[0]?.refusal).toBe("invalid_input");
  });

  it("does not fetch at all for a topic the narrowing refused", async () => {
    const { deps, rows, urls } = harness((url) => ok(bodyFor(url)));
    const outcome = await fetchChiefSources("https://evil.example/x", deps, CHIEF_SOURCES);

    expect(urls).toEqual([]);
    expect(outcome.items).toEqual([]);
    // Still one row per source: DASH decided not to ask, and a decision not to
    // ask is a decision.
    expect(rows).toHaveLength(CHIEF_SOURCES.length);
    expect(rows.every((row) => row.decision === "refused")).toBe(true);
  });
});

describe("every path writes exactly one row per source", () => {
  const CASES: readonly [string, (url: string) => Response | Error, string, string | null][] = [
    ["a feed that answers", (url) => ok(bodyFor(url)), "ok", null],
    ["a body in the wrong shape", () => ok("<rss><channel></channel></rss>"), "not_a_feed", "provider_refused"],
    ["an error page", () => ok("<html>502</html>"), "not_a_feed", "provider_refused"],
    ["a 500", () => new Response("no", { status: 500 }), "unreachable", "provider_unavailable"],
    ["a 404", () => new Response("no", { status: 404 }), "unreachable", "provider_unavailable"],
    ["a connection that fails", () => new Error("ECONNREFUSED"), "unreachable", "provider_unavailable"],
  ];

  for (const [name, responder, status, refusal] of CASES) {
    it(`records ${name}`, async () => {
      const { deps, rows } = harness(responder);
      const outcome = await fetchChiefSources("tariffs", deps, CHIEF_SOURCES);

      expect(rows).toHaveLength(CHIEF_SOURCES.length);
      for (const row of rows) {
        expect(row.connection_id).toBe(CHIEF_SOURCES_CONNECTION_ID);
        expect(row.operation).toBe(CHIEF_SOURCES_OPERATION);
        expect(row.refusal).toBe(refusal);
        expect(row.decision).toBe(refusal === null ? "allowed" : "refused");
        expect(row.duration_ms).toBeGreaterThanOrEqual(0);
        expect(Number.isNaN(Date.parse(row.decided_at))).toBe(false);
      }
      for (const source of outcome.sources) {
        expect(source.status).toBe(status);
      }
    });
  }

  it("gives every row its own request id", async () => {
    const { deps, rows } = harness((url) => ok(bodyFor(url)));
    await fetchChiefSources("tariffs", deps, CHIEF_SOURCES);
    expect(new Set(rows.map((row) => row.request_id)).size).toBe(rows.length);
  });

  /*
   * `input_keys` is names, never values. The subject somebody asked about is
   * their business and is not audit data -- `broker_audit`'s own rule, which
   * this table's column inherits by being the same column.
   */
  it("records the names of the inputs and never the topic", async () => {
    const { deps, rows } = harness((url) => ok(bodyFor(url)));
    await fetchChiefSources("a very private subject", deps, CHIEF_SOURCES);
    for (const row of rows) {
      expect(row.input_keys).toEqual(["source", "topic"]);
      expect(JSON.stringify(row)).not.toContain("private");
    }
  });
});

describe("what comes back is bounded", () => {
  it("keeps at most six entries per source", async () => {
    const { deps } = harness((url) => ok(bodyFor(url)));
    const outcome = await fetchChiefSources("tariffs", deps, CHIEF_SOURCES);
    for (const source of outcome.sources) {
      expect(source.items.length).toBeLessThanOrEqual(6);
    }
    expect(outcome.items.length).toBe(6 * CHIEF_SOURCES.length);
  });

  it("stops reading a body past the ceiling and calls it not-a-feed", async () => {
    // Past the ceiling before any parser sees it, so the format does not
    // matter here -- the read is abandoned mid-stream.
    const huge = `<rss><channel><item><title>${"x".repeat(300_000)}</title></item></channel></rss>`;
    const { deps, rows } = harness(() => ok(huge));
    const outcome = await fetchChiefSources("tariffs", deps, CHIEF_SOURCES);
    expect(outcome.items).toEqual([]);
    expect(outcome.sources.every((source) => source.status === "not_a_feed")).toBe(true);
    expect(rows).toHaveLength(CHIEF_SOURCES.length);
  });

  it("never throws, whatever a source does", async () => {
    const { deps } = harness(() => new Error("anything"));
    await expect(fetchChiefSources("tariffs", deps, CHIEF_SOURCES)).resolves.toBeDefined();
  });
});

describe("what a source answered survives to the record", () => {
  it("keeps the address DASH actually fetched, for the citation to link", async () => {
    const { deps } = harness((url) => ok(bodyFor(url)));
    const outcome = await fetchChiefSources("tariffs", deps, CHIEF_SOURCES);
    for (const source of outcome.sources) {
      expect(source.address).not.toBeNull();
      expect(CHIEF_SOURCE_ORIGINS).toContain(new URL(String(source.address)).origin);
    }
  });

  it("tells a reachable-but-empty source apart from an unreachable one", async () => {
    const { deps } = harness((url) => ok(emptyBodyFor(url)));
    const outcome = await fetchChiefSources("tariffs", deps, CHIEF_SOURCES);
    // An `<item>` with no title parses to an empty list rather than to null:
    // the feed was read and listed nothing.
    expect(outcome.sources.every((source) => source.status === "empty")).toBe(true);
  });
});
