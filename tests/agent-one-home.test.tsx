/**
 * One fact, one home (MAR-646).
 *
 * ## The rule this file exists to keep
 *
 * The cockpit is three surfaces with three jobs. The header band is identity
 * and standing, the rail is an *index of pointers*, and the stage is the
 * content, one subject at a time. The failure mode is not that any one of them
 * is wrong — it is that a fact drifts into two of them, and the page grows by a
 * block nobody added on purpose. Henrik's words for the merged frame were
 * *"lots of content in the main window. A lot feels like duplicates."*
 *
 * MAR-646 deleted the duplicates. This is the part that stops the next packet
 * putting them back, and it is deliberately the same shape as the fleet's
 * one-card-three-tracks rule in `tests/fleet-view.test.ts`: a claim about what
 * a surface is **not allowed to do**, checked against what it actually renders
 * and against the source that decides where the renderers are called.
 *
 * ## Why a shared title is allowed exactly once
 *
 * A pointer has to name its target, so the rail and the stage will always agree
 * on *one* string: the title of the output being read, the label of the
 * decision being taken. What may never happen again is the **list** appearing
 * twice — the rail's index redrawn inside the stage beside it, which is what
 * the Output stage's dated disclosures were and what the Overview stage's
 * *Latest output* block was.
 *
 * So the invariant is a count rather than a set difference: **a stage may draw
 * at most one of the outputs the rail indexes.** Two is a list.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentRail } from "../app/_components/agent-rail";
import { OutputsPanel } from "../app/_components/outputs";
import { AGENT_COCKPIT_COPY } from "../lib/copy/agent-page";
import { buildArtifactCards } from "../lib/views/artifacts";
import type { DigestArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";
import type { InboxItem } from "../lib/workspace";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* Normalised at the read. A regex over source that anchors on `\n` is blind on
   a machine that checked the file out with CRLF endings, and a blind assertion
   is a green one. */
const pageSource = readFileSync(
  path.join(repoRoot, "app", "agents", "detail", "page.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

const AGENT = "ai-agent-news";

function digest(over: Partial<DigestArtifact> = {}): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: AGENT,
    run_id: "run-a",
    artifact_id: "digest-a",
    title: "Tuesday digest",
    generated_at: "2026-08-13T09:15:00.000Z",
    sources_fetched: [],
    items: [{ headline: "Chip makers brace for new tariffs", summary: "A body." }],
    ...over,
  };
}

/** Four outputs, because two can look like a coincidence and four is a list. */
const RECORDS: RunArtifactRecord[] = [
  { artifact: digest(), received_at: "2026-08-13T09:15:08.000Z", stored_bytes: 1200 },
  {
    artifact: digest({ run_id: "run-b", artifact_id: "digest-b", title: "Monday digest" }),
    received_at: "2026-08-12T09:15:08.000Z",
    stored_bytes: 1100,
  },
  {
    artifact: digest({ run_id: "run-c", artifact_id: "digest-c", title: "Sunday digest" }),
    received_at: "2026-08-11T09:15:08.000Z",
    stored_bytes: 1000,
  },
  {
    artifact: digest({ run_id: "run-d", artifact_id: "digest-d", title: "Saturday digest" }),
    received_at: "2026-08-10T09:15:08.000Z",
    stored_bytes: 900,
  },
];

const CARDS = buildArtifactCards(RECORDS);
const TITLES = CARDS.map((card) => card.artifact.title);

const WAITING: InboxItem[] = [
  {
    kind: "approval",
    id: "ap-1",
    task_id: "task-1",
    task_label: "Send the Tuesday briefing",
    run_id: "run-a",
    label: "Send an email to the list",
    expires_at: "today at 18:00",
    expired: false,
    options: [],
    action_id: "send-1",
    action_label: "Send one email to 40 addresses",
  },
  {
    kind: "choice",
    id: "ch-1",
    task_id: "task-2",
    task_label: "Pick a source for Monday",
    run_id: "run-a",
    label: "Which feed should it read?",
    expires_at: "tomorrow at 09:00",
    expired: false,
    options: [{ id: "a", label: "Hacker News" }],
  },
];

function railHtml(): string {
  return renderToStaticMarkup(
    <AgentRail agent={AGENT} inbox={WAITING} openId={null} outputs={CARDS} />,
  );
}

/** The Output stage as the page draws it: one card, chosen by the rail. */
function outputStage(openId: string | null): string {
  return renderToStaticMarkup(
    <OutputsPanel cards={CARDS} grounding={null} openId={openId} single />,
  );
}

/** How many of the rail's titles a piece of markup contains. */
function shared(html: string): string[] {
  return TITLES.filter((title) => html.includes(title));
}

describe("the rail indexes and the stage reads", () => {
  it("puts every output in the rail, as a title and nothing more", () => {
    const html = railHtml();
    expect(shared(html)).toEqual(TITLES);
    /*
     * And no bodies. A rail that drew one would be a second, narrower Output
     * stage — which is the same duplication seen from the other end.
     */
    expect(html).not.toContain("Chip makers brace for new tariffs");
    expect(html).not.toContain("output-card");
    expect(html).not.toContain("digest-items");
  });

  it("never draws two of the rail's outputs inside the stage", () => {
    /*
     * The rule, and the one assertion that would have caught both defects this
     * packet was filed on: the Output stage's dated disclosures listed every
     * title, and the Overview stage drew the newest under the rail's own
     * heading. One is a pointer resolving to its target; two is the index
     * again.
     */
    for (const openId of [null, "digest-a", "digest-c", "digest-gone"]) {
      const drawn = shared(outputStage(openId));
      expect(drawn.length, `the stage drew ${String(drawn.length)} of the rail's outputs`).toBe(1);
    }
  });

  it("opens the output the rail named, and the newest when it named none", () => {
    // The pointer has to actually point, or the invariant above is satisfied by
    // a stage that ignores the rail entirely.
    expect(shared(outputStage("digest-c"))).toEqual(["Sunday digest"]);
    expect(shared(outputStage(null))).toEqual(["Tuesday digest"]);
    // A link that outlived its artifact lands on the page it named.
    expect(shared(outputStage("digest-gone"))).toEqual(["Tuesday digest"]);
  });

  it("counts the waiting queue rather than previewing it", () => {
    const html = railHtml();
    // Both titles, because a queue of two that showed one would be an index
    // that lies about how much is owed.
    expect(html).toContain("Send the Tuesday briefing");
    expect(html).toContain("Pick a source for Monday");
    expect(html).toContain(">2<");
    /*
     * And nothing the card carries. The kind, the sentence about what the agent
     * wants to do, and what approval permits are all on the decision itself,
     * where they sit with the expiry and the recheck sentence that make them
     * mean something.
     */
    expect(html).not.toContain(AGENT_COCKPIT_COPY.work_kind.approval);
    expect(html).not.toContain(AGENT_COCKPIT_COPY.work_kind.choice);
    expect(html).not.toContain("Send an email to the list");
    expect(html).not.toContain("Send one email to 40 addresses");
    expect(html).not.toContain("Which feed should it read?");
  });
});

/**
 * The half a rendering test cannot reach.
 *
 * Everything above proves the components behave. It cannot prove the *page*
 * still calls them that way — a stage that mounted a second outputs list would
 * pass every assertion in this file while putting the duplication back on the
 * screen. These read the one file that decides, for the reason
 * `tests/fleet-view.test.ts` reads the stylesheet.
 */
describe("the page mounts one outputs list, on one stage", () => {
  it("draws the outputs area exactly once", () => {
    const mounts = [...pageSource.matchAll(/<OutputsArea\b/g)];
    expect(mounts).toHaveLength(1);
  });

  it("keeps it on the Output stage and off the Overview stage", () => {
    /*
     * The stage record is an object literal whose keys are the stage ids, in
     * `AGENT_STAGES` order, so an `overview:` entry ends where `run:` begins.
     * Crude, and it is checking a crude thing: whether a block of JSX is inside
     * one property or another.
     */
    const overview = pageSource.slice(
      pageSource.indexOf("\n    overview: ("),
      pageSource.indexOf("\n    run: ("),
    );
    expect(overview.length).toBeGreaterThan(0);
    expect(overview).not.toContain("<OutputsArea");
    /* The rail's heading is the index's. A stage that borrowed it would be two
       panels with one name on one screen, which is the defect exactly. */
    expect(overview).not.toContain("outputs_heading");

    const output = pageSource.slice(
      pageSource.indexOf("\n    output: ("),
      pageSource.indexOf("\n    chat: ("),
    );
    expect(output).toContain("<OutputsArea");
  });

  it("asks that panel for one output rather than a list", () => {
    /*
     * `single` is what replaced MAR-622's `history` here, and dropping it is
     * the one-character edit that puts every dated row back under the open
     * card. `history` itself cannot come back by accident — the prop is gone
     * and `tsc` refuses it — but a call that simply stopped passing `single`
     * would compile and would draw the rail's list again.
     */
    const area = pageSource.slice(
      pageSource.indexOf("function OutputsArea("),
      pageSource.indexOf("function GuidedChecklist("),
    );
    expect(area.length).toBeGreaterThan(0);
    expect(area).toContain("<OutputsPanel");
    expect(area).toMatch(/\n\s+single\n/);
  });
});
