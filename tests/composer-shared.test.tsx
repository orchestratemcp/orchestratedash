/**
 * One composer, two surfaces — enforced rather than asserted (MAR-711).
 *
 * The objective was that the agent page's Ask adopts the fleet composer's
 * look and behaviour as **one component with per-surface wiring, not a
 * copy**. `app/_components/composer.tsx` is that component; this file is
 * `tests/fleet-view.test.ts`'s own move for it — "a claim about what a
 * surface is not allowed to do, checked against what it actually renders and
 * against the source that decides where the renderers are called"
 * (`tests/agent-one-home.test.tsx`'s own words for the same shape of test).
 *
 * Three independent checks, because any one of them could pass while the
 * other two quietly failed:
 *
 * - **The source.** Both `chief-chat.tsx` and `ask.tsx` import `Composer`
 *   from `./composer`. A future edit that inlined the room's markup back into
 *   either file — even one that kept every class name identical — fails this
 *   without needing to render anything.
 * - **The stylesheet.** Every composer-chrome rule in `app/globals.css` is a
 *   *combined* selector, `.chief-X, .ask-X` — one declaration, not two that
 *   happen to agree. A restyle of one composer that forgot the other fails
 *   here the way a fleet-view rule that forgot a track fails
 *   `tests/fleet-view.test.ts`.
 * - **The render.** `ChiefChat` and `AskComposer`, each driven to its open
 *   state, draw the same structural shape through the same class-name
 *   vocabulary Composer defines — proving the wiring in `chief-chat.tsx` and
 *   `ask.tsx` actually reaches `Composer` at runtime, not only at the import
 *   line.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { AskComposer } from "../app/_components/ask";
import { ChiefChat } from "../app/_components/chief-chat";
import { ASK_HEADING, ASK_MODEL_CHANGE, describeAskModel } from "../lib/copy/ask";
import { CHIEF_CHAT_COPY } from "../lib/copy/chief-chat";
import type { AgentAskView } from "../lib/views/types";
import type { AgentRow, ChiefRoomView } from "../lib/views/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chiefSource = readFileSync(
  path.join(repoRoot, "app", "_components", "chief-chat.tsx"),
  "utf8",
);
const askSource = readFileSync(path.join(repoRoot, "app", "_components", "ask.tsx"), "utf8");
const globals = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8");
const fleetListSource = readFileSync(
  path.join(repoRoot, "app", "_components", "fleet-list.tsx"),
  "utf8",
);
const agentPageSource = readFileSync(
  path.join(repoRoot, "app", "agents", "detail", "page.tsx"),
  "utf8",
);

describe("both surfaces route through the same component", () => {
  it("imports Composer rather than drawing its own room", () => {
    expect(chiefSource).toMatch(/import\s*\{[^}]*\bComposer\b[^}]*\}\s*from\s*"\.\/composer"/);
    expect(askSource).toMatch(/import\s*\{[^}]*\bComposer\b[^}]*\}\s*from\s*"\.\/composer"/);
  });

  it("each renders through <Composer, not a hand-rolled room", () => {
    expect(chiefSource).toMatch(/<Composer\b/);
    expect(askSource).toMatch(/<Composer\b/);
  });
});

describe("the stylesheet states composer chrome once, for both surfaces", () => {
  /*
   * Every chrome part `Composer` draws, named the way the chief's own class
   * already is. A rule is read as declared only when `.chief-<part>` and
   * `.ask-<part>` appear in the *same* selector list — the combined-selector
   * discipline `composer.tsx`'s own header asks for — so a rule that split
   * back into two (even two that still agreed) would fail this.
   */
  const CHROME_PARTS = [
    "composer",
    "room",
    "room-head",
    "room-scroll",
    "room-heading",
    "room-actions",
    "room-clear",
    "room-close",
    "composer-chips",
    "compose",
    "field",
    "input-wrap",
    "input",
    "enter-glyph",
    "composer-foot",
    "model-chip",
    "composer-hint",
  ];

  /*
   * Every selector, split into its comma-separated arms and trimmed — a rule
   * `.chief-room-clear:hover:not(:disabled),\n.ask-room-clear:hover:not(:disabled) {`
   * is one rule with two arms, and what this test cares about is whether an
   * arm naming `.chief-<part>` (optionally with pseudo-classes chained after
   * it) shares its rule with an arm naming `.ask-<part>` the same way.
   *
   * A rule that names only `.chief-<part>` and no `.ask-` arm at all —
   * `.chief-model-picker`, a chief-only exception this stylesheet keeps
   * (the agent's own model chip is a link with no picker to open) — is not
   * one of the `CHROME_PARTS` above, so it is never checked here: the class
   * has to be the whole of the arm (plus pseudo-classes),
   * not the first step of a longer one, or this would demand an `.ask-`
   * sibling for a rule that was never meant to have one.
   */
  const rules = [...globals.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) =>
    // The doc comment above a rule has no braces either, so it rides along in
    // group 1 (`tests/fleet-view.test.ts`'s own regex has the same shape, for
    // the same reason) — stripped here rather than there, because splitting
    // it on commas the way this test does would otherwise pick up every
    // comma inside the prose above a rule as if it were another selector arm.
    rule[1]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((arm) => arm.trim())
      .filter((arm) => arm.length > 0),
  );

  for (const part of CHROME_PARTS) {
    it(`combines .chief-${part} and .ask-${part} in one selector`, () => {
      const chiefArm = new RegExp(`^\\.chief-${part}(:.*)?$`);
      const askArm = new RegExp(`^\\.ask-${part}(:.*)?$`);
      const declaring = rules.filter((arms) => arms.some((arm) => chiefArm.test(arm)));
      expect(declaring.length, `no rule declares .chief-${part}`).toBeGreaterThan(0);
      for (const arms of declaring) {
        expect(
          arms.some((arm) => askArm.test(arm)),
          `".chief-${part}" has no ".ask-${part}" arm in: ${arms.join(", ")}`,
        ).toBe(true);
      }
    });
  }
});

/* ---------------------------------------------------------------------- *
 * MAR-741: the room's width is the content column's, on both surfaces
 * ---------------------------------------------------------------------- */

describe("the room is bounded to the content column, not the whole window", () => {
  /*
   * `.chief-room`/`.ask-room` is `left: 0; right: 0` from `.chief-composer`/
   * `.ask-composer` (asserted above, in the combined-selector loop) — so the
   * room is exactly as wide as its composer, and the composer sizes to
   * *its own* content rather than the page. What decides the room's actual
   * on-screen width is therefore which ancestor the composer sits inside,
   * which a stylesheet or a render test cannot see: both are strings this
   * test reads directly.
   */
  it("mounts the chief composer inside .fleet-stage, next to the cards rather than the rail", () => {
    const stageOpen = fleetListSource.indexOf('"fleet-stage"');
    const chiefMount = fleetListSource.indexOf("<ChiefChat");
    expect(stageOpen).toBeGreaterThan(-1);
    expect(chiefMount).toBeGreaterThan(stageOpen);
  });

  /*
   * MAR-740's fix moved `AgentChatBar` off `.agent-cockpit` (where it spanned
   * both the stage and rail columns) and into `.cockpit-content`, the same
   * grid item as `AgentStageView`, beside `AgentRail` rather than under it.
   * A future edit that pulled the chat bar back out to span the page again —
   * even one that kept every class name — would still pass every check
   * above; this is the one that would catch it.
   */
  it("mounts the agent's chat bar inside .cockpit-content, beside the rail rather than under it", () => {
    const contentOpen = agentPageSource.indexOf('"cockpit-content"');
    const chatMount = agentPageSource.indexOf("<AgentChatBar");
    const railMount = agentPageSource.indexOf("<AgentRail");
    expect(contentOpen).toBeGreaterThan(-1);
    expect(chatMount).toBeGreaterThan(contentOpen);
    // The rail is a sibling of `.cockpit-content`, not something inside it —
    // so it is named after the chat bar in source order either way, and what
    // this line actually pins is that the rail was not accidentally nested
    // inside the same wrapper as the stage and the chat bar.
    expect(railMount).toBeGreaterThan(chatMount);
  });

  it("gives the stage and the chat bar one grid column of their own", () => {
    const rule = /\.cockpit-content\s*\{([^}]*)\}/.exec(globals);
    expect(rule, ".cockpit-content has no rule in app/globals.css").not.toBeNull();
    expect(rule?.[1]).toMatch(/grid-template-rows:\s*minmax\(0,\s*1fr\)\s*auto/);
  });

  it("no longer gives the chat bar its own full-width row of .agent-cockpit", () => {
    const rule = /\.agent-cockpit\s*\{([^}]*)\}/.exec(globals);
    expect(rule).not.toBeNull();
    // Two rows — the identity band and the body — not three. A third `auto`
    // row is exactly the shape that let the chat bar span both of
    // `.cockpit-body`'s columns.
    expect(rule?.[1]).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s*;/);
  });
});

/* ---------------------------------------------------------------------- *
 * The render: same shape, two surfaces
 * ---------------------------------------------------------------------- */

function chiefRow(): AgentRow {
  return {
    name: "ai-agent-news",
    title: "AI agent news",
    goal: "Collect news about ai agents from public feeds and write a digest.",
    capabilities: ["public_feed_fetch"],
    plan_source: "orchestratekit",
    build_target: "node",
    planned_steps: 2,
    automation_clearance: "manual",
    run_count: 0,
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
    glance: [],
    running: false,
    hosted_on: [],
    favourite: false,
    // `chief-chat-render.test.tsx`'s own `row()` reaches `AgentRow` through a
    // `Partial<AgentRow>` spread, which widens the inferred literal enough for
    // a plain `as AgentRow` to pass. This fixture takes no overrides, so it
    // goes through `unknown` instead rather than adding an unused parameter.
  } as unknown as AgentRow;
}

function chiefView(): ChiefRoomView {
  return {
    can_ask: false,
    model_id: null,
    model_provider_id: null,
    model_is_own: false,
    blocked: null,
    turns: [],
  };
}

function askable(): AgentAskView {
  return {
    can_ask: true,
    heading: ASK_HEADING,
    purpose: { headline: "Ask this agent about what it has saved.", detail: "It reads its own reports." },
    custody: "Your questions and the answers stay on this computer.",
    placeholder: "What have you found about…?",
    submit: "Ask",
    working: "Asking…",
    sources_heading: "What this answer used",
    provider_label: "OpenRouter",
    model: {
      model_id: "anthropic/claude-sonnet-5",
      from_default: false,
      note: describeAskModel(false),
      change_label: ASK_MODEL_CHANGE,
    },
    estimate: { headline: "Up to 12 saved things go with your question.", detail: "About $0.003." },
    ask: { agent_id: "ai-agent-news", connection_id: "models", field_id: "key" },
    history: [],
    spent: null,
    reported: null,
  };
}

const NOOP = (): void => {
  /* nothing to do */
};

describe("the two composers draw the same shape, open", () => {
  const chief = renderToStaticMarkup(
    <ChiefChat
      agents={[chiefRow()]}
      view={chiefView()}
      canAct={false}
      onAsked={NOOP}
      open={true}
      onOpen={NOOP}
      onClose={NOOP}
    />,
  );

  const ask = renderToStaticMarkup(
    <AskComposer
      ask={askable()}
      canAct={true}
      onAsked={NOOP}
      open={true}
      onOpen={NOOP}
      onClose={NOOP}
      setFeedback={NOOP}
    />,
  );

  it("marks the composer open the same way", () => {
    expect(chief).toContain("chief-composer is-open");
    expect(ask).toContain("ask-composer is-open");
  });

  it("draws a room with a heading, a Clear and an X", () => {
    for (const html of [chief, ask]) {
      expect(html).toMatch(/room-head"/);
      expect(html).toMatch(/room-heading"/);
      expect(html).toMatch(/room-clear"/);
      expect(html).toMatch(/room-close"/);
      expect(html).toContain('aria-hidden="true">×</span>');
    }
  });

  it("draws no submit button on either surface — Enter is the only way to send", () => {
    for (const html of [chief, ask]) {
      expect(html).not.toContain('class="primary"');
      expect(html).not.toContain(">Ask<");
    }
  });

  it("draws the enter glyph, decorative, on both fields", () => {
    for (const html of [chief, ask]) {
      expect(html).toMatch(/enter-glyph" aria-hidden="true">/);
      expect(html).toContain("↵");
    }
  });

  it("draws a model chip, whether or not the room is open", () => {
    for (const html of [chief, ask]) {
      expect(html).toMatch(/model-chip/);
    }
    // And each says whose model it is, in the words that surface already used.
    expect(chief).toContain(CHIEF_CHAT_COPY.no_model_chip);
    expect(ask).toContain("anthropic/claude-sonnet-5");
  });
});
