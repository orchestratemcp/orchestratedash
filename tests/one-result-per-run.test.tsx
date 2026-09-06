/**
 * One result per run (MAR-875, UX-1).
 *
 * ## What was on the screen
 *
 * Proof Scout, on the Output stage with its briefing open, showed the same
 * thirty Hacker News headlines three times: once as a full headline under every
 * paragraph that cited it, once as "The latest digest" in the author's panel,
 * and once as a thirty-row table under "Every headline in the latest digest".
 * Henrik's words for it were *"lots of content in the main window. A lot feels
 * like duplicates."*
 *
 * Every one of those three renderings was correct by the rule that produced it.
 * MAR-668 suppressed the artifact the stage had drawn, and the artifact the
 * stage had drawn was the **brief**; the digest is a different record with a
 * different id, so nothing in the panel could tell it was already on the page.
 *
 * ## What this file holds
 *
 * `tests/agent-one-home.test.tsx` holds MAR-646's and MAR-668's rules — one
 * stage, one outputs area, no second copy of the open card. This holds the four
 * claims MAR-875 adds, each of which fails on its own:
 *
 * 1. **the lineage** — what "already on the screen" means once a result can be
 *    written *from* something, and why the two members are not interchangeable;
 * 2. **one Sources disclosure** — the collected rows get one deliberate place,
 *    closed, with the author's table kept as a second reading of the same rows;
 * 3. **no mixing across runs** — selecting an older output moves the author's
 *    whole panel with it, and DASH says so;
 * 4. **grouping** — a run's outputs stay together in the index.
 *
 * The states MAR-875's acceptance names — empty, single result, multi-run,
 * rejected and pending verdict — are each exercised below rather than left to
 * the surfaces that happen to render them.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentRail } from "../app/_components/agent-rail";
import { OutputsPanel } from "../app/_components/outputs";
import { AgentPanel } from "../app/_components/panel";
import { briefCitationMark } from "../lib/copy/brief";
import { PANEL_ALREADY_SHOWN, PANEL_SOURCES_COPY } from "../lib/copy/panel";
import { fingerprintItems, resolveBriefCitations } from "../lib/brief/fingerprint";
import {
  buildArtifactCards,
  groupCardsByRun,
  resolveDrawnLineage,
  resolveOpenCard,
} from "../lib/views/artifacts";
import { buildPanelView } from "../lib/views/panel";
import { panelForRun } from "../lib/views/panel-run";
import type { Adjudication } from "../lib/genlayer/record";
import type { BriefArtifact, DigestArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";

const AGENT = "proof-scout";
const NEWEST = "run-tuesday";
const OLDER = "run-sunday";

/**
 * Ten rows, because the defect is about volume.
 *
 * Two would prove the join and would not distinguish "the list is drawn once"
 * from "the list is drawn twice and both are short". Ten makes every count
 * below a statement about the page rather than about the fixture, and gives the
 * citation marks something to be an improvement over.
 */
const ITEMS = Array.from({ length: 10 }, (_, index) => ({
  /* Worded so no headline is a prefix of another: `Headline 1` lives inside
     `Headline 10`, and a count of "how many times is this row on the page"
     would then report the fixture rather than the page. */
  headline: `Collected row ${String(index + 1)} of ten`,
  source_name: "Hacker News",
  source_url: "https://feed.test/hn",
  item_url: `https://news.test/item-${String(index + 1)}`,
}));

function digest(over: Partial<DigestArtifact> = {}): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: AGENT,
    run_id: NEWEST,
    artifact_id: "digest-tuesday",
    title: "Everything it collected",
    generated_at: "2026-09-01T09:00:00.000Z",
    sources_fetched: [
      { source_name: "Hacker News", source_url: "https://feed.test/hn", status: "ok", item_count: 10 },
    ],
    items: ITEMS,
    ...over,
  };
}

function brief(over: Partial<BriefArtifact> = {}): BriefArtifact {
  return {
    artifact_version: 2,
    kind: "brief",
    agent: AGENT,
    run_id: NEWEST,
    artifact_id: "brief-tuesday",
    title: "What it adds up to",
    generated_at: "2026-09-01T09:01:00.000Z",
    document: {
      model: "some-provider/some-model",
      sections: [
        {
          heading: "Agents are shipping",
          paragraphs: [
            { body: "Three releases landed this week.", items: [0, 2] },
            { body: "Nobody supervised any of them.", items: [7] },
          ],
        },
      ],
    },
    derived_from: {
      artifact_id: "digest-tuesday",
      run_id: NEWEST,
      item_count: ITEMS.length,
      items_digest: fingerprintItems(ITEMS),
    },
    ...over,
  };
}

/** Sunday's run: the same agent, a shorter list, its own ids. */
const SUNDAY_ITEMS = ITEMS.slice(0, 3);
const SUNDAY = digest({
  run_id: OLDER,
  artifact_id: "digest-sunday",
  title: "Sunday's roundup",
  generated_at: "2026-08-30T09:00:00.000Z",
  items: SUNDAY_ITEMS,
});

function record(artifact: DigestArtifact | BriefArtifact, receivedAt: string): RunArtifactRecord {
  return { artifact, received_at: receivedAt, stored_bytes: 4096 } as RunArtifactRecord;
}

/** Newest first, which is the order every binding in `lib/views` reads. */
const RECORDS: RunArtifactRecord[] = [
  record(brief(), "2026-09-01T09:01:05.000Z"),
  record(digest(), "2026-09-01T09:00:05.000Z"),
  record(SUNDAY, "2026-08-30T09:00:05.000Z"),
];

function citationsFor(entry: RunArtifactRecord) {
  return entry.artifact.kind === "brief"
    ? resolveBriefCitations(entry.artifact, [digest(), SUNDAY])
    : null;
}

const CARDS = buildArtifactCards(RECORDS, undefined, citationsFor);

/**
 * The scout's own panel, plus a table over the same role.
 *
 * The first three are the exact shape the real competitor scout declares and
 * the shape that produced the defect. The `note` is the control: a section that
 * draws no artifact must be untouched by any of this.
 */
const DECLARED = [
  { id: "latest_digest", type: "report", label: "The latest digest", artifact_role: "digest" },
  { id: "latest_brief", type: "report", label: "Written up", artifact_role: "brief" },
  {
    id: "headline_rows",
    type: "table",
    label: "Every headline in the latest digest",
    source_role: "digest",
    columns: [{ key: "headline", label: "Headline", kind: "text" }],
  },
  { id: "about", type: "note", label: "About this scout", text: "It runs when you ask it to." },
];

function view(sections: unknown[] = DECLARED, artifacts: readonly RunArtifactRecord[] = RECORDS) {
  return buildPanelView(
    { agent: { name: AGENT }, agent_dom: { panel: { panel_version: 1, sections } } },
    {
      artifacts,
      facts: { run_count: 2, last_run_at: "2026-09-01T09:00:00.000Z", last_run_status: "completed" },
      resolveCitations: citationsFor,
    },
  );
}

function decode(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** The Output stage as `app/agents/detail/page.tsx` draws it: one card. */
function stage(openId: string | null): string {
  return decode(
    renderToStaticMarkup(
      <OutputsPanel cards={CARDS} grounding={null} openId={openId} single />,
    ),
  );
}

/**
 * The author's panel as the page hands it down, for the same open card.
 *
 * Both halves go through the functions the page uses — `resolveOpenCard`,
 * `resolveDrawnLineage`, `panelForRun` — rather than being constructed here. A
 * fixture that built its own answer would let this file pass while the page
 * shipped a different one, which is the failure `resolveOpenCard`'s own note in
 * `lib/views/artifacts.ts` describes.
 */
function panel(openId: string | null, sections: unknown[] = DECLARED): string {
  const open = resolveOpenCard(CARDS, openId);
  return decode(
    renderToStaticMarkup(
      <AgentPanel
        alreadyShown={resolveDrawnLineage(open)}
        view={panelForRun(view(sections), open?.reference.run_id ?? null)}
      />,
    ),
  );
}

/** How many times a string occurs, without building a regex out of copy. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/* ---------------------------------------------------------------------- *
 * 1. What "already on the screen" means
 * ---------------------------------------------------------------------- */

describe("the lineage the stage has drawn", () => {
  it("is nothing at all when there is no card", () => {
    // The run detail page's situation, and the default that keeps a caller who
    // forgets getting today's behaviour rather than a silently emptied panel.
    expect(resolveDrawnLineage(null).size).toBe(0);
  });

  it("is the artifact itself, for a card that has no parent", () => {
    const open = resolveOpenCard(CARDS, "digest-tuesday");
    expect([...resolveDrawnLineage(open)]).toEqual([["digest-tuesday", "body"]]);
  });

  it("adds the list a briefing was written from, and marks it differently", () => {
    /*
     * The whole defect in one assertion. The digest is on the screen — its rows
     * are what every citation points at — and it is on the screen in a
     * different way from the brief, which is what lets one rule serve both:
     * the brief's body was drawn, and the digest's rows were not.
     */
    const open = resolveOpenCard(CARDS, "brief-tuesday");
    const drawn = resolveDrawnLineage(open);
    expect(drawn.get("brief-tuesday")).toBe("body");
    expect(drawn.get("digest-tuesday")).toBe("source");
  });

  it("does not walk further than the one declared parent", () => {
    // `derived_from` is a declared parent rather than a graph, and a transitive
    // closure over agent-authored ids is a loop waiting for the first agent
    // that names itself.
    const open = resolveOpenCard(CARDS, "brief-tuesday");
    expect(resolveDrawnLineage(open).size).toBe(2);
  });

  it("never lets a self-naming parent overwrite the card's own entry", () => {
    const selfNaming = buildArtifactCards([
      record(
        brief({ derived_from: { ...brief().derived_from, artifact_id: "brief-tuesday" } }),
        "2026-09-01T09:01:05.000Z",
      ),
    ]);
    expect(resolveDrawnLineage(selfNaming[0] ?? null).get("brief-tuesday")).toBe("body");
  });
});

/* ---------------------------------------------------------------------- *
 * 2. One Sources disclosure
 * ---------------------------------------------------------------------- */

describe("the collected list has one place on the page", () => {
  const html = panel("brief-tuesday");

  /** Everything in the author's region that is not inside the disclosure. */
  function outsideSources(markup: string): string {
    const from = markup.indexOf('<details class="card-more agent-panel-sources-disclosure">');
    expect(from, "no Sources disclosure was drawn").toBeGreaterThan(-1);
    const to = markup.indexOf("</details></article>", from);
    expect(to, "the Sources disclosure did not close").toBeGreaterThan(from);
    return markup.slice(0, from) + markup.slice(to);
  }

  it("puts no row on the surface of the author's region at all", () => {
    /*
     * THE NUMBER. Before this packet, opening the briefing put every headline
     * on the page three times over — under the paragraphs as a full title, in
     * the report section, and again as a table row, all of it on the surface
     * with nothing to close.
     *
     * Nothing is deleted: the rows are behind one closed disclosure, and the
     * two readings inside it are the list and the author's own table. What a
     * reader meets on the way down the page is the result and a count.
     */
    const surface = outsideSources(html);
    for (const item of ITEMS) {
      expect(surface, item.headline).not.toContain(item.headline);
    }
  });

  it("draws each row once per reading, and offers two readings", () => {
    // Two, not three, and both behind the same press: MAR-875 asks for the list
    // and the table to be two views of one set of rows rather than two
    // sections. A third occurrence is the defect coming back.
    for (const item of ITEMS) {
      expect(occurrences(html, item.headline), item.headline).toBe(2);
    }
  });

  it("collapses every yielding section into one disclosure, in the first one's place", () => {
    // Two sections yielded — the digest report and the table over the same
    // rows — and they leave one summary between them, not two.
    expect(occurrences(html, PANEL_SOURCES_COPY.summary(ITEMS.length))).toBe(1);
    expect(html).not.toContain("The latest digest");
    expect(html).not.toContain("Every headline in the latest digest");
    // The author's ordering survives: Sources sits where their first yielding
    // section was, which is above everything they declared after it.
    expect(html.indexOf(PANEL_SOURCES_COPY.summary(ITEMS.length))).toBeLessThan(
      html.indexOf("About this scout"),
    );
  });

  it("counts what is behind it rather than making a person open it to find out", () => {
    expect(PANEL_SOURCES_COPY.summary(10)).toContain("10");
    expect(PANEL_SOURCES_COPY.summary(1)).toBe("Sources (1)");
  });

  it("ships closed, and offers the author's table as a second reading", () => {
    expect(html).toContain('<details class="card-more agent-panel-sources-disclosure">');
    expect(html).not.toContain('agent-panel-sources-disclosure" open');
    expect(html).toContain(PANEL_SOURCES_COPY.list_summary);
    expect(html).toContain(PANEL_SOURCES_COPY.table_summary);
    // The table is the author's own columns, drawn by the component that
    // already contains its overflow inside its own box.
    expect(html).toContain('class="agent-panel-table-wrap"');
    expect(html).toContain('<th scope="col">Headline</th>');
  });

  it("numbers the list the way the citations count", () => {
    /*
     * The reason the marks are worth anything: `[8]` in a paragraph and the
     * eighth row of this list are the same row. The list is an `ol` so the
     * numbering is the platform's own counter rather than a second one that
     * could drift.
     */
    expect(html).toContain('<ol class="agent-panel-sources-items">');
    const rows = html.slice(html.indexOf('class="agent-panel-sources-items"'));
    for (const item of ITEMS) {
      expect(rows, item.headline).toContain(item.headline);
    }
  });

  it("asks the reader for nothing, which is ADR 0008's strongest claim", () => {
    // Two disclosures rather than a switch, and the reason is the whole of ADR
    // 0008: a control in a box somebody else frames is the one affordance that
    // could be made to look like DASH's.
    for (const control of ["<button", "<input", "<textarea", "<select", "<form"]) {
      expect(html, control).not.toContain(control);
    }
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("aria-expanded");
  });

  it("prints no artifact id, even though the table now carries one", () => {
    // `source_artifact_id` is how a table knows it is a second drawing. It is
    // a raw identifier and this surface admits none at all — not behind a
    // disclosure, not anywhere.
    for (const identifier of ["digest-tuesday", "brief-tuesday", NEWEST, "headline_rows"]) {
      expect(html, identifier).not.toContain(identifier);
    }
  });

  it("leaves the sections that draw no artifact alone", () => {
    expect(html).toContain("About this scout");
    expect(html).toContain("It runs when you ask it to.");
  });
});

describe("when the collected list is the thing on the stage", () => {
  const html = panel("digest-tuesday");

  it("offers the table and not a second list", () => {
    /*
     * The distinction the lineage map exists for. With the digest open, every
     * row is already on the stage in full — so a "Read them as a list" two
     * hundred pixels below would be this packet's own complaint wearing the
     * shape of its fix. The author's table is a reading the stage does not
     * give, so it stays.
     */
    expect(html).toContain(PANEL_SOURCES_COPY.table_summary);
    expect(html).not.toContain(PANEL_SOURCES_COPY.list_summary);
    expect(html).not.toContain('<ol class="agent-panel-sources-items">');
  });

  it("still draws the brief, which the stage did not", () => {
    // The yield is about the run's own lineage rather than about the run: an
    // artifact nothing has shown is the author's to present in full.
    expect(html).toContain("Written up");
    expect(html).toContain("Three releases landed this week.");
  });
});

describe("a run with nothing to collect", () => {
  it("renders no Sources at all when the yielding section has no rows behind it", () => {
    /*
     * A `report` bound to the brief, with the brief open. It yields — the stage
     * drew it — and there is no list and no table to offer instead, so the
     * section leaves no trace. An empty already-shown section renders nothing,
     * not a pointer.
     */
    const only = panel("brief-tuesday", [DECLARED[1]]);
    expect(only).not.toContain("Written up");
    expect(only).not.toContain(PANEL_SOURCES_COPY.list_summary);
    expect(only).not.toContain("Sources (");
    // The region itself survives, because the box is still the author's.
    expect(only).toContain("agent-panel-head");
  });

  it("says an empty section is empty rather than dropping it", () => {
    /*
     * The rule MAR-554 shipped and MAR-875 must not undo: a section with
     * nothing behind it *yet* is a different fact from a section whose content
     * is on the screen already, and only the second one may disappear.
     */
    const fresh = decode(
      renderToStaticMarkup(<AgentPanel view={view(DECLARED, [])} alreadyShown={new Map()} />),
    );
    expect(fresh).toContain("The latest digest");
    expect(fresh).toContain("Nothing has arrived for this section yet.");
    expect(fresh).toContain("This table has no rows yet.");
  });
});

/* ---------------------------------------------------------------------- *
 * 3. Compact citations
 * ---------------------------------------------------------------------- */

describe("a paragraph cites by mark rather than by headline", () => {
  const html = stage("brief-tuesday");

  it("puts the row's own position on the page", () => {
    // Positions 0, 2 and 7 of the digest, one-based where a person reads them.
    expect(html).toContain(briefCitationMark(0));
    expect(html).toContain(briefCitationMark(2));
    expect(html).toContain(briefCitationMark(7));
  });

  it("prints no headline under the paragraphs at all", () => {
    /*
     * The block this packet deleted. On the real scout it was thirty full
     * titles under one paragraph and thirty again under the next.
     */
    const document = html.slice(html.indexOf("Agents are shipping"));
    expect(document).not.toContain(`>${ITEMS[0]?.headline ?? ""}<`);
    expect(document).not.toContain(`>${ITEMS[2]?.headline ?? ""}<`);
  });

  it("keeps every mark a real anchor to the row DASH collected", () => {
    // Keyboard order follows reading order because the mark is where the
    // sentence is, and the address is the row's own — never model text.
    expect(html).toMatch(/<a[^>]*href="https:\/\/news\.test\/item-1"[^>]*>\[1\]/);
    // The headline is the hover text and the accessible name, so the mark can
    // be followed without opening anything — and it does not REPLACE the
    // number, which an `aria-label` on the anchor would.
    expect(html).toContain(`title="${ITEMS[0]?.headline ?? ""}"`);
    expect(html).toContain(
      `<span class="visually-hidden"> ${ITEMS[0]?.headline ?? ""}</span>`,
    );
  });
});

/* ---------------------------------------------------------------------- *
 * 4. No mixing across runs
 * ---------------------------------------------------------------------- */

describe("selecting an older output moves the whole panel with it", () => {
  it("describes the run the reader opened, not the newest one", () => {
    /*
     * The defect: pressing Sunday's roundup changed DASH's own card and left
     * the author's box holding Tuesday's ten rows. The panel is bound to the
     * selected run now, so the count on the disclosure is Sunday's three.
     */
    const sunday = panel("digest-sunday");
    expect(sunday).toContain(PANEL_SOURCES_COPY.summary(SUNDAY_ITEMS.length));
    expect(sunday).not.toContain(PANEL_SOURCES_COPY.summary(ITEMS.length));
    // Sunday produced no brief, so the author's brief section is genuinely
    // empty for that run rather than quietly showing Tuesday's.
    expect(sunday).not.toContain("Three releases landed this week.");
    expect(sunday).toContain("Nothing has arrived for this section yet.");
  });

  it("narrows the collected rows to that run's own", () => {
    const sunday = panel("digest-sunday");
    // Sunday collected three of the ten. The four Tuesday-only rows must not
    // appear anywhere in a panel describing Sunday.
    for (const item of ITEMS.slice(3)) {
      expect(sunday, item.headline).not.toContain(item.headline);
    }
  });

  it("keeps the newest run's panel for a reader who selected nothing", () => {
    const landing = panel(null);
    expect(landing).toContain(PANEL_SOURCES_COPY.summary(ITEMS.length));
  });
});

/* ---------------------------------------------------------------------- *
 * 5. A run's outputs stay together
 * ---------------------------------------------------------------------- */

describe("the index groups a run's outputs", () => {
  it("keeps order and reports where each group starts", () => {
    const groups = groupCardsByRun(CARDS);
    expect(groups.map((group) => group.run_id)).toEqual([NEWEST, OLDER]);
    expect(groups.map((group) => group.cards.length)).toEqual([2, 1]);
    expect(groups.map((group) => group.from)).toEqual([0, 2]);
  });

  it("puts a run's brief and the list it was written from in one group", () => {
    const [newest] = groupCardsByRun(CARDS);
    expect(newest?.cards.map((card) => card.reference.artifact_id)).toEqual([
      "brief-tuesday",
      "digest-tuesday",
    ]);
  });

  it("marks one newest entry on the whole rail rather than one per run", () => {
    const html = decode(
      renderToStaticMarkup(
        <AgentRail agent={AGENT} inbox={[]} openId={null} outputs={CARDS} />,
      ),
    );
    expect(occurrences(html, "is-newest")).toBe(1);
    // Every output is still reachable, which is what the rail is for.
    expect(occurrences(html, 'class="rail-output-title"')).toBe(CARDS.length);
  });

  it("dates a group once per day rather than once per run", () => {
    /*
     * An agent run four times on Tuesday would otherwise carry the word
     * "Tuesday" four times in a 300px column — an index repeating itself, which
     * is the shape MAR-646 spent a packet removing from this page.
     */
    const twice = buildArtifactCards([
      record(digest({ run_id: "run-a", artifact_id: "d-a" }), "2026-09-01T09:00:05.000Z"),
      record(digest({ run_id: "run-b", artifact_id: "d-b" }), "2026-09-01T08:00:05.000Z"),
    ]);
    const html = decode(
      renderToStaticMarkup(
        <AgentRail agent={AGENT} inbox={[]} openId={null} outputs={twice} />,
      ),
    );
    expect(occurrences(html, 'class="rail-output-group"')).toBe(2);
    expect(occurrences(html, "rail-output-day")).toBe(1);
  });
});

/* ---------------------------------------------------------------------- *
 * 6. The verdict stays beside the result
 * ---------------------------------------------------------------------- */

/**
 * MAR-875 must not cost MAR-863 anything.
 *
 * The GenLayer receipt sits between the citations and the author's panel and is
 * correct — that is the orchestrator's own reading of the defect — so the two
 * states a reader most needs from it have to survive this packet unchanged.
 */
describe("a judgement in flight and a judgement refused", () => {
  function judged(attempts: readonly Adjudication[]): string {
    const cards = buildArtifactCards(
      [record(brief(), "2026-09-01T09:01:05.000Z"), record(digest(), "2026-09-01T09:00:05.000Z")],
      undefined,
      citationsFor,
      () => attempts,
    );
    return decode(
      renderToStaticMarkup(
        <OutputsPanel cards={cards} grounding={null} openId="brief-tuesday" single />,
      ),
    );
  }

  const base: Adjudication = {
    commission_id: "c-1",
    agent: AGENT,
    run_id: NEWEST,
    artifact_id: "brief-tuesday",
    brief_digest: "sha256-not-a-real-one",
    rpc_url: "https://studio.genlayer.test",
    contract_address: "0x0",
    chain_id: 4221,
    stage: "judging",
    started_at: "2026-09-01T09:05:00.000Z",
    settled_at: null,
    open_tx: null,
    submit_tx: null,
    evaluate_tx: null,
    outcome: null,
    status_name: null,
    execution_result: null,
    consensus_result: null,
    leader_model: null,
    verdict: null,
    reasons: [],
    failure: null,
  };

  it("says what it is waiting for while a committee is reading", () => {
    const html = judged([base]);
    // The measured span is forty-five seconds to five minutes, and a page that
    // said nothing for four of them is indistinguishable from one that hung.
    expect(html).toContain("brief-adjudication");
    // The document is still whole underneath it, with its marks intact.
    expect(html).toContain("Three releases landed this week.");
    expect(html).toContain(briefCitationMark(0));
  });

  it("draws a refusal beside the result rather than in place of it", () => {
    const html = judged([
      {
        ...base,
        stage: "settled",
        /* The committee agreed and the state was written; what it wrote is a
           refusal. `outcome` and `verdict` are different questions — see
           `describeAdjudication`. */
        outcome: "applied",
        verdict: "REJECTED",
        reasons: ["The second claim is not supported by the collected rows."],
        settled_at: "2026-09-01T09:09:00.000Z",
        leader_model: "some-provider/some-model",
      },
    ]);
    expect(html).toContain("The second claim is not supported by the collected rows.");
    // The result is still readable, which is the point of keeping the verdict
    // beside it rather than above it.
    expect(html).toContain("Nobody supervised any of them.");
    expect(html).toContain(briefCitationMark(7));
  });
});

/* ---------------------------------------------------------------------- *
 * 7. Nothing was taken away
 * ---------------------------------------------------------------------- */

describe("what the reader keeps", () => {
  it("keeps DASH's own card whole — provenance, export and the run link", () => {
    /*
     * MAR-668's ruling, restated because MAR-875 removes more than it did: the
     * surface that yields is the author's, never DASH's. Deleting DASH's own
     * record of an artifact to resolve a duplication would take away the half a
     * person needs in order to check what they are reading.
     */
    const html = decode(
      renderToStaticMarkup(
        <OutputsPanel
          cards={CARDS}
          grounding={null}
          openId="brief-tuesday"
          onDownload={() => undefined}
          onExportBrief={() => undefined}
          runHref={() => "/runs/detail?run=run-tuesday"}
          single
        />,
      ),
    );
    expect(html).toContain("output-receipt");
    expect(html).toContain("Save a copy");
    expect(html).toContain("Open the full run");
    expect(html).toContain("output-developer");
  });

  it("keeps the pointer for a list the stage only partly drew", () => {
    /*
     * The one case MAR-668's sentence was written for and MAR-875 keeps: an
     * `outputs` section holding a mix. Dropping the drawn entry silently would
     * leave a list that skips a row between two others.
     */
    const mixed = panel("digest-tuesday", [
      { id: "everything", type: "outputs", label: "Everything it produced", artifact_role: "digest" },
    ]);
    expect(mixed).toContain("Everything it produced");
    expect(mixed).toContain(PANEL_ALREADY_SHOWN);
    expect(occurrences(mixed, PANEL_ALREADY_SHOWN)).toBe(1);
  });
});
