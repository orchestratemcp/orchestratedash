/**
 * The cockpit frame, drawn (MAR-641).
 *
 * `tests/agent-stage.test.ts` drives the router. This drives the three bands
 * that never scroll and the container that does, and the assertions are the
 * claims the wireframe makes rather than the classes it happens to produce:
 *
 * - the header says who, what state, where it lives, and offers the actions;
 * - **no control leads nowhere** — the grid has no Health cell, because there
 *   is no Health stage, and the one cell that acts says so only when it would;
 * - the rail is titles, not bodies, and marks the newest without colour alone;
 * - the chat bar is never a dead input;
 * - exactly one stage is in the document, which is what makes a stage a page
 *   rather than five hidden headings on one.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentCockpitHeader } from "../app/_components/agent-header";
import { AgentRail } from "../app/_components/agent-rail";
import { AgentStageView } from "../app/_components/agent-stage";
import { AgentChatBar } from "../app/_components/ask";
import { OutputsPanel } from "../app/_components/outputs";
import { AGENT_COCKPIT_COPY } from "../lib/copy/agent-page";
import {
  ASK_HEADING,
  ASK_MODEL_CHANGE,
  ASK_PLACEHOLDER,
  describeAskModel,
  describeChatSubject,
  describeUnavailable,
} from "../lib/copy/ask";
import { buildArtifactCards } from "../lib/views/artifacts";
import { AGENT_STAGES, type AgentStage } from "../lib/views/agent-stage";
import type { AgentControlView } from "../lib/views/agent-control";
import type { DigestArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";
import type { AgentAskView } from "../lib/views/types";
import type { InboxItem } from "../lib/workspace";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "ai-agent-news";

function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}

const IDLE: AgentControlView = {
  status: { label: "Not reported", tone: "calm", detail: "This agent has not published a state." },
  run: { kind: "idle", reason: "not_reported" },
};

const READY: AgentControlView = {
  status: { label: "Ready", tone: "calm", detail: "Nothing is running." },
  run: { kind: "run_now", task_id: "task-1", observed_at: "2026-08-15T09:00:00Z" },
};

function header(over: Partial<Parameters<typeof AgentCockpitHeader>[0]> = {}): string {
  return decode(
    renderToStaticMarkup(
      <AgentCockpitHeader
        agent={AGENT}
        avatar="wizard"
        busy={null}
        canTrigger
        control={READY}
        goal="Reads the news and writes you a digest."
        hasFolder
        live={null}
        onOpenFolder={() => undefined}
        onRefresh={() => undefined}
        onTriggerRun={() => undefined}
        places={[]}
        plan={[]}
        stage="overview"
        title="News Scout"
        {...over}
      />,
    ),
  );
}

describe("the band that never scrolls", () => {
  it("names the agent, its state, where it lives and its id", () => {
    const html = header();
    expect(html).toContain("News Scout");
    expect(html).toContain("Ready");
    expect(html).toContain("Reads the news and writes you a digest.");
    // MAR-589: the name is prose and the id is a value, both still here.
    expect(html).toContain(">ai-agent-news<");
    // The fleet card's own two words for where an agent lives, not a second
    // vocabulary invented for this header.
    expect(html).toContain("Local");
  });

  it("says Cloud for an agent DASH has sent to a server", () => {
    const html = header({
      places: [
        {
          host_id: "h1",
          label: "My server",
          sent_at: "2026-08-01T00:00:00Z",
          sent_on: "1 August",
          comparable: true,
          behind: false,
        },
      ],
    });
    expect(html).toContain("Cloud");
  });

  it("offers the five actions, with Health leading to its stage", () => {
    const html = header();
    expect(html).toContain(AGENT_COCKPIT_COPY.trigger_run);
    expect(html).toContain(AGENT_COCKPIT_COPY.health);
    expect(html).toContain(AGENT_COCKPIT_COPY.settings);
    expect(html).toContain(AGENT_COCKPIT_COPY.logs);
    expect(html).toContain(AGENT_COCKPIT_COPY.overview);
    expect(html).toContain("stage=health");
  });

  /**
   * MAR-658. The proof-pass finding this cell exists for: an agent with even
   * one output has no way back to its own Overview once MAR-646 sent a plain
   * link to `output` instead of `overview`. Rendered at `stage="output"`
   * specifically, because that is the exact stage the finding named.
   */
  it("offers a way back to Overview from the Output stage", () => {
    const html = header({ stage: "output" });
    expect(html).toContain(`href="/agents/detail?agent=${AGENT}&stage=overview"`);
    expect(html).toContain(AGENT_COCKPIT_COPY.overview);
  });

  it("marks Overview current when you are on it, like every other cell", () => {
    const html = header({ stage: "overview" });
    expect(html).toMatch(
      new RegExp(`<a[^>]*aria-current="page"[^>]*stage=overview[^>]*>${AGENT_COCKPIT_COPY.overview}<`),
    );
  });

  it("promises to start a run only when there is one to start", () => {
    expect(header({ canTrigger: true })).toContain(AGENT_COCKPIT_COPY.trigger_run);
    const idle = header({ canTrigger: false, control: IDLE });
    expect(idle).toContain(`>${AGENT_COCKPIT_COPY.open_run}<`);
    expect(idle).not.toContain(AGENT_COCKPIT_COPY.trigger_run);
  });

  it("marks the stage you are on for a reader who is not looking at a colour", () => {
    const html = header({ stage: "logs" });
    expect(html).toMatch(/aria-current="page"[^>]*>|<a[^>]*aria-current="page"/);
    expect(html).toContain("stage=logs");
  });

  it("keeps removal out of the menu that closes on a stray press", () => {
    const html = header();
    // Present as a way into Settings, where the removal controls sit under a
    // heading with the sentence that says it cannot be undone.
    expect(html).toContain(AGENT_COCKPIT_COPY.remove);
    expect(html).toContain(`href="/agents/detail?agent=ai-agent-news&stage=settings"`);
    // And not as a button inside the overflow itself.
    expect(html).not.toMatch(/<button[^>]*>Remove this agent/);
  });

  it("offers Open folder only where DASH holds a folder to open", () => {
    expect(header({ hasFolder: true })).toContain(AGENT_COCKPIT_COPY.open_folder);
    expect(header({ hasFolder: false })).not.toContain(AGENT_COCKPIT_COPY.open_folder);
  });

  it("tints the frame around the portrait and never the character", () => {
    const html = header({
      control: { ...READY, status: { ...READY.status, tone: "attention" } },
    });
    expect(html).toContain("cockpit-portrait tone-attention");
    // The costume is the same picture — the same idle loop, since MAR-615
    // opted this portrait into it — in every state.
    expect(html).toContain("--o-action:url(/o/actions/wizard-fireball.png)");
  });

  it("says nothing about a poll when no run is being followed", () => {
    expect(header({ live: null })).toContain('aria-live="polite"');
    expect(header({ live: "09:41:02" })).toContain("09:41:02");
  });

  it("speaks plain language", () => {
    expectPlainLanguage([
      AGENT_COCKPIT_COPY.trigger_run,
      AGENT_COCKPIT_COPY.open_run,
      AGENT_COCKPIT_COPY.health,
      AGENT_COCKPIT_COPY.settings,
      AGENT_COCKPIT_COPY.logs,
      AGENT_COCKPIT_COPY.overview,
      AGENT_COCKPIT_COPY.refresh,
      AGENT_COCKPIT_COPY.open_folder,
      AGENT_COCKPIT_COPY.remove,
      AGENT_COCKPIT_COPY.place_label,
      AGENT_COCKPIT_COPY.more_label,
    ]);
  });
});

/* ---------------------------------------------------------------------- *
 * The rail
 * ---------------------------------------------------------------------- */

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
    items: [
      {
        headline: "Chip makers brace for new tariffs",
        summary: "A long body that has no business being in a 300px rail.",
        source_name: "Example Wire",
        item_url: "https://example.test/chips",
      },
    ],
    ...over,
  };
}

const RECORDS: RunArtifactRecord[] = [
  { artifact: digest(), received_at: "2026-08-13T09:15:08.000Z", stored_bytes: 1200 },
  {
    artifact: digest({ run_id: "run-b", artifact_id: "digest-b", title: "Monday digest" }),
    received_at: "2026-08-12T09:15:08.000Z",
    stored_bytes: 1100,
  },
];

const APPROVAL: InboxItem = {
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
};

function rail(over: Partial<Parameters<typeof AgentRail>[0]> = {}): string {
  return decode(
    renderToStaticMarkup(
      <AgentRail
        agent={AGENT}
        inbox={[]}
        openId={null}
        outputs={buildArtifactCards(RECORDS)}
        {...over}
      />,
    ),
  );
}

describe("the rail", () => {
  it("lists titles and not bodies", () => {
    const html = rail();
    expect(html).toContain("Tuesday digest");
    expect(html).toContain("Monday digest");
    // The body of an output belongs to the stage. A rail that drew it would be
    // a second, narrower Output stage competing with the real one.
    expect(html).not.toContain("no business being in a 300px rail");
  });

  it("opens the item in the stage rather than holding it in the rail", () => {
    expect(rail()).toContain("stage=output&output=digest-b");
  });

  it("marks the newest in words as well as with an edge", () => {
    const html = rail();
    expect(html).toContain("is-newest");
    expect(html).toContain(AGENT_COCKPIT_COPY.outputs_newest);
  });

  it("says nothing was made rather than disappearing", () => {
    const html = rail({ outputs: [] });
    expect(html).toContain(AGENT_COCKPIT_COPY.outputs_empty);
  });

  it("draws no action-needed panel when nothing is waiting", () => {
    // MAR-609's rule: the old page drew a heading and a sentence saying there
    // was nothing under it, on every agent, forever.
    expect(rail()).not.toContain(AGENT_COCKPIT_COPY.work_heading);
  });

  it("names what is waiting and takes you to the decision, without granting it", () => {
    const html = rail({ inbox: [APPROVAL] });
    expect(html).toContain(AGENT_COCKPIT_COPY.work_heading);
    expect(html).toContain("Send the Tuesday briefing");
    expect(html).toContain("stage=overview#work-ap-1");
    /*
     * The deliberate deviation from the wireframe, pinned so it cannot be
     * undone by accident: an approval is granted against an exact action, with
     * the effect preview and the recheck sentence beside it. A pair of buttons
     * in the rail would grant a consequence from a summary.
     */
    expect(html).not.toContain("Approve exact action");
    expect(html).not.toContain("<button");
  });

  it("is a count and a title, not a small copy of the card (MAR-646)", () => {
    const html = rail({ inbox: [APPROVAL] });
    // The fact only an index has: the stage under it *is* the queue.
    expect(html).toContain('class="rail-count">1<');
    /*
     * And nothing the destination also says. The kind sits on the card beside
     * the expiry and the effect preview that give it meaning; here it was the
     * pointer wearing a small copy of what it points at.
     */
    expect(html).not.toContain(AGENT_COCKPIT_COPY.work_kind.approval);
    expect(html).not.toContain(AGENT_COCKPIT_COPY.work_kind.choice);
    // The card's own sentence about the action never reaches the rail either.
    expect(html).not.toContain("Send an email to the list");
    expect(html).not.toContain("Send one email to 40 addresses");
  });
});

/* ---------------------------------------------------------------------- *
 * The stage, and the chat bar
 * ---------------------------------------------------------------------- */

describe("the stage", () => {
  function views(): Record<AgentStage, string> {
    return Object.fromEntries(
      AGENT_STAGES.map((stage) => [stage, `stage-body-${stage}`]),
    ) as Record<AgentStage, string>;
  }

  it("puts one stage in the document and not the other five", () => {
    for (const stage of AGENT_STAGES) {
      const html = renderToStaticMarkup(<AgentStageView stage={stage} views={views()} />);
      expect(html).toContain(`stage-body-${stage}`);
      for (const other of AGENT_STAGES.filter((name) => name !== stage)) {
        // Not merely hidden: a stashed-but-rendered stage would put five more
        // headings, five empty states and five duplicate ids on every page a
        // copy sweep or a geometry check looks at.
        expect(html).not.toContain(`stage-body-${other}`);
      }
    }
  });

  it("announces which view a person has moved into", () => {
    const html = renderToStaticMarkup(<AgentStageView stage="logs" views={views()} />);
    expect(html).toContain(`aria-label="${AGENT_COCKPIT_COPY.stage.logs}"`);
    expect(html).toContain('role="region"');
  });
});

describe("opening one output in the stage", () => {
  function stage(openId: string | null): string {
    return decode(
      renderToStaticMarkup(
        <OutputsPanel
          cards={buildArtifactCards(RECORDS)}
          grounding={null}
          heading="Generated assets"
          openId={openId}
          single
        />,
      ),
    );
  }

  /** Every output title the stage draws, in any position. */
  function titles(html: string): string[] {
    return [...html.matchAll(/<h3 class="value">([^<]+)</g)].map((match) => match[1] ?? "");
  }

  it("draws the named output and no trace of the others (MAR-646)", () => {
    const html = stage("digest-b");
    expect(titles(html)).toEqual(["Monday digest"]);
    expect(html).toContain("no business being in a 300px rail");
    /*
     * The dated disclosures that used to sit under it were the rail's list a
     * second time — the same day and the same title per row, three hundred
     * pixels apart on one screen.
     */
    expect(html).not.toContain("output-history-entry");
    expect(html).not.toContain("Tuesday digest");
  });

  it("falls back to the newest for a link that has outlived its output", () => {
    // A saved link naming an artifact the store no longer holds should land on
    // the page it named rather than on an empty one.
    expect(titles(stage("digest-gone"))).toEqual(["Tuesday digest"]);
  });

  it("draws the newest when the rail has named nothing", () => {
    expect(titles(stage(null))).toEqual(["Tuesday digest"]);
  });
});

function chatBar(ask: AgentAskView): string {
  return decode(
    renderToStaticMarkup(
      <AgentChatBar
        agent={AGENT}
        ask={ask}
        canAct
        onAsked={() => undefined}
        setFeedback={() => undefined}
      />,
    ),
  );
}

const ASKABLE: AgentAskView = {
  can_ask: true,
  heading: ASK_HEADING,
  purpose: { headline: "Ask this agent about what it has saved.", detail: "It reads its own reports." },
  custody: "Your questions and the answers stay on this computer.",
  placeholder: ASK_PLACEHOLDER,
  submit: "Ask",
  working: "Asking…",
  sources_heading: "Where this came from",
  provider_label: "OpenRouter",
  /* MAR-648. What the composer's settings row draws. */
  model: {
    model_id: "anthropic/claude-sonnet-5",
    from_default: false,
    note: describeAskModel(false),
    change_label: ASK_MODEL_CHANGE,
  },
  estimate: { headline: "Up to 12 saved things go with your question.", detail: "About $0.003." },
  ask: { agent_id: AGENT, connection_id: "models", field_id: "key" },
  history: [],
  spent: null,
  reported: null,
};

describe("the chat bar", () => {
  it("is a box you can type in when there is something to ask with", () => {
    const html = chatBar(ASKABLE);
    expect(html).toContain("<textarea");
    expect(html).toContain(ASK_PLACEHOLDER);
  });

  /*
   * MAR-659. This agent's own name, read rather than only announced — the
   * bar used to carry a generic "Message this agent" as a `visually-hidden`
   * label, which is a prop deciding who the box talks to with no word on
   * screen confirming it.
   */
  it("names this agent, visibly, above the box", () => {
    const html = decode(
      renderToStaticMarkup(
        <AgentChatBar
          agent={AGENT}
          agentTitle="AI agent news"
          ask={ASKABLE}
          canAct
          onAsked={() => undefined}
          setFeedback={() => undefined}
        />,
      ),
    );
    expect(html).toContain(describeChatSubject("AI agent news"));
    expect(html).not.toContain('<span class="visually-hidden">Message');
  });

  it("is never a dead input", () => {
    /*
     * MAR-624 is the issue behind this one: a person who has done the right
     * thing and is told it did not work. A greyed box would be that shape
     * again. The bar says what is missing in one line and offers the way to the
     * fix-it card, which is on the Chat stage with the two sentences that
     * explain it.
     */
    const html = chatBar({
      can_ask: false,
      heading: ASK_HEADING,
      blocked: describeUnavailable("no_key", { agent: AGENT, service: "OpenRouter" }),
      connect: null,
      history: [],
      sources_heading: "Where this came from",
      reported: null,
    });
    expect(html).not.toContain("<textarea");
    expect(html).toContain(AGENT_COCKPIT_COPY.chat_open);
    expect(html).toContain("stage=chat");
  });
});
