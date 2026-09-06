/**
 * The AI tab, drawn (MAR-642).
 *
 * `tests/model-choice.test.ts` drives the rows and the precedence. This drives
 * the thing on screen, for `tests/fleet-connector-render.test.tsx`' reason: a
 * photograph proves a state was drawn once on one machine, and this proves each
 * one is still drawn on every run.
 *
 * The load-bearing claims are all about **the split**, because the way this
 * change goes quietly wrong is a card that ends up on both tabs or on neither:
 *
 * - a model provider's key is on AI and not on Connections;
 * - a sign-in is on Connections and not on AI;
 * - the same is true of the per-agent tiles, so one key is not told twice;
 * - a DASH holding no key opens with the choices showing, and one holding a key
 *   puts the rest behind a control that says what it does;
 * - the default's control is absent, not disabled, until a key exists to ask.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AiKeys, AiSettings } from "../app/settings/ai/page";
import { ServiceList } from "../app/settings/page";
import { ModelDefault } from "../app/_components/model-default";
import {
  describeFleetDefault,
  describeLevelModelRow,
  describeLevelModels,
} from "../lib/ai/model-choice";
import { DEFAULT_MODEL_LEVELS, levelLabel, levelMeaning } from "../lib/ai/model-levels";
import type {
  AgentConnections,
  ConnectionsView,
  FleetConnectorView,
  FleetLevelModelsView,
  FleetModelDefaultView,
} from "../lib/views/types";

function connector(over: Partial<FleetConnectorView> = {}): FleetConnectorView {
  return {
    provider: "google-gmail",
    service: "Gmail",
    connector_kind: "google_oauth_broker",
    ai_provider_id: null,
    purpose: "Let your agents work with your mail.",
    help: null,
    capabilities: [],
    wider_permissions: [],
    held: null,
    agents: [],
    skipped: [],
    waiting: [],
    reach_sentence: null,
    ...over,
  };
}

function key(
  provider: string,
  service: string,
  over: Partial<FleetConnectorView> = {},
): FleetConnectorView {
  return connector({
    provider,
    service,
    connector_kind: "api_key",
    ai_provider_id: provider,
    purpose: `Let DASH hold your ${service} key.`,
    help: `Your ${service} account has a keys page.`,
    ...over,
  });
}

/**
 * A key DASH holds **and can read**.
 *
 * `secret_readable: true` is not boilerplate: MAR-676 made it the difference
 * between the Connected chip and an honest one, so a fixture that left it out
 * would be describing Henrik's broken store rather than a working DASH. Every
 * assertion below that expects a connected surface depends on it, which is the
 * point — the fixture now has to say which of the two situations it is.
 */
const HELD = {
  masked_hint: "••••abcd",
  account_hint: null,
  since: "15 August 2026",
  permissions: [],
  secret_readable: true,
  unreadable: null,
};

function defaultView(over: Partial<FleetModelDefaultView> = {}): FleetModelDefaultView {
  const copy = describeFleetDefault(null, null, 0);
  return {
    provider_id: null,
    model_id: null,
    headline: copy.headline,
    detail: copy.detail,
    in_force: copy.in_force,
    ...over,
  };
}

/**
 * The level rows for one provider, at their shipped values (MAR-654, A1.6).
 *
 * Every row empty and every sentence the no-default one, which is the state
 * every DASH ships in: nothing is seeded and no existing DASH changes behaviour
 * until a person writes a row. `levelsFor` takes a map so a test can write one.
 */
function levelsFor(
  providerIds: readonly string[],
  mapped: Readonly<Record<string, string>> = {},
  fleetDefaultModelId: string | null = null,
): FleetLevelModelsView {
  const copy = describeLevelModels(providerIds.length === 0 ? null : "OpenRouter");
  return {
    headline: copy.headline,
    detail: copy.detail,
    in_force: copy.in_force,
    by_provider: providerIds.map((provider_id) => ({
      provider_id,
      rows: DEFAULT_MODEL_LEVELS.map((level) => {
        const modelId = mapped[level] ?? null;
        return {
          level,
          label: levelLabel(level),
          meaning: levelMeaning(level),
          model_id: modelId,
          in_force: describeLevelModelRow(modelId, fleetDefaultModelId),
        };
      }),
    })),
  };
}

const KEYS = [
  key("openrouter", "OpenRouter"),
  key("anthropic", "Anthropic"),
  key("openai", "OpenAI"),
];

function view(over: Partial<ConnectionsView> = {}): ConnectionsView {
  return {
    fleet: [connector(), ...KEYS],
    model_default: defaultView(),
    level_models: levelsFor([]),
    agents: [],
    older_agent_names: [],
    ...over,
  };
}

const drawAi = (document: ConnectionsView): string =>
  renderToStaticMarkup(<AiSettings view={document} canAct onChanged={() => undefined} />);

const drawKeys = (connectors: readonly FleetConnectorView[]): string =>
  renderToStaticMarkup(
    <AiKeys connectors={connectors} canAct onChanged={() => undefined} />,
  );

describe("which cards land on which tab", () => {
  it("draws the three model keys on AI and no sign-in", () => {
    const html = drawAi(view());
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Anthropic");
    expect(html).toContain("OpenAI");
    // The mailbox is the other tab's. A card on both would be the two-homes
    // defect this split exists to end, not a convenience.
    expect(html).not.toContain("Gmail");
  });

  it("leaves the sign-in on Connections and takes both halves of the key off it", () => {
    /*
     * Both halves, which is the part that is easy to get half right. Moving the
     * catalogue card and leaving the per-agent row would put one key on two
     * tabs in two shapes — and the AI tab's own card already names every agent
     * that needs it, so nothing goes unsaid.
     *
     * Asserted against the merged list (MAR-642) rather than against the two
     * sections that used to be there: `ServiceList` filters both halves by the
     * same fact, so this is the one place the split can be checked whole.
     */
    const agents: AgentConnections[] = [
      {
        name: "digest-writer",
        title: "Digest writer",
        avatar: null,
        rows: [
          {
            connection_id: "models",
            provider: "openrouter",
            service: "OpenRouter",
            purpose: "Write the digest",
            ownership: "dash",
            dash_can_hold: true,
            field_id: "key",
            masked_hint: null,
            delivered_to_agent: false,
            credential_kind: "provider_key",
            broker: null,
            also_connects: [],
            capabilities: [],
          } as unknown as AgentConnections["rows"][number],
        ],
        lapses: [],
      },
    ];
    const html = renderToStaticMarkup(
      <ServiceList
        view={view({ agents })}
        canAct
        onChanged={() => undefined}
      />,
    );
    expect(html).toContain("Gmail");
    expect(html).not.toContain("OpenRouter");
  });
});

describe("the keys, and the + that reveals the rest", () => {
  it("opens with every choice showing when DASH holds none", () => {
    // There is nothing to collapse and the whole page is this choice, so a
    // person arriving at a fresh DASH sees all three without pressing anything.
    const html = drawKeys(KEYS);
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Anthropic");
    expect(html).toContain("OpenAI");
    expect(html).not.toContain("Add a key");
  });

  it("draws the key it holds and puts the rest behind a control that says so", () => {
    const html = drawKeys([
      key("openrouter", "OpenRouter", { held: HELD }),
      key("anthropic", "Anthropic"),
      key("openai", "OpenAI"),
    ]);
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Add a key");
    // Not drawn, and not drawn disabled either: the button above is the door,
    // and three paragraphs of consequence for services this person did not
    // choose is the shape MAR-642 moved them here to fix.
    expect(html).not.toContain("Anthropic");
    expect(html).not.toContain("OpenAI");
  });

  it("names the one that is left when only one is", () => {
    const html = drawKeys([
      key("openrouter", "OpenRouter", { held: HELD }),
      key("anthropic", "Anthropic", { held: HELD }),
      key("openai", "OpenAI"),
    ]);
    expect(html).toContain("Add a key for OpenAI");
  });

  it("counts what it drew rather than asserting it", () => {
    expect(drawKeys(KEYS)).toContain("DASH holds no key yet");
    expect(
      drawKeys([
        key("openrouter", "OpenRouter", { held: HELD }),
        key("anthropic", "Anthropic"),
        key("openai", "OpenAI"),
      ]),
    ).toContain("DASH holds 1 key");
  });
});

describe("the default model", () => {
  const draw = (
    setting: FleetModelDefaultView,
    keys: readonly FleetConnectorView[],
    canAct = true,
    levels: FleetLevelModelsView = levelsFor([]),
  ): string =>
    renderToStaticMarkup(
      <ModelDefault
        setting={setting}
        levels={levels}
        keys={keys}
        canAct={canAct}
        onChanged={() => undefined}
      />,
    );

  it("draws no control at all until a key is held", () => {
    // Not a disabled dropdown: there is nothing to list and nothing to choose
    // between, and a greyed-out control would read as a claim about the
    // providers rather than about what DASH is holding.
    const html = draw(defaultView(), KEYS);
    expect(html).toContain("The model new agents use");
    expect(html).not.toContain("<select");
  });

  it("offers the choice once a key is held, with no default set", () => {
    const html = draw(defaultView(), [key("openrouter", "OpenRouter", { held: HELD }), ...KEYS.slice(1)]);
    expect(html).toContain("<select");
    expect(html).toContain("No default");
    expect(html).toContain("See what OpenRouter offers");
  });

  it("keeps a model already set in the list before anything has been asked for", () => {
    // A `select` whose value matches no option silently shows the first one,
    // and a person would read "no default" on a DASH that has one.
    const copy = describeFleetDefault("OpenRouter", "openai/gpt-5-mini", 1);
    const html = draw(
      defaultView({
        provider_id: "openrouter",
        model_id: "openai/gpt-5-mini",
        in_force: copy.in_force,
      }),
      [key("openrouter", "OpenRouter", { held: HELD }), ...KEYS.slice(1)],
    );
    expect(html).toContain('value="openai/gpt-5-mini" selected');
    expect(html).toContain("through your OpenRouter key");
  });

  it("hides the service dropdown while there is only one key to pick from", () => {
    const one = draw(defaultView(), [key("openrouter", "OpenRouter", { held: HELD }), ...KEYS.slice(1)]);
    expect(one).not.toContain("model-default-provider");

    const two = draw(defaultView(), [
      key("openrouter", "OpenRouter", { held: HELD }),
      key("anthropic", "Anthropic", { held: HELD }),
    ]);
    expect(two).toContain("model-default-provider");
  });

  it("says which window this is rather than greying the control out", () => {
    const html = draw(defaultView(), [key("openrouter", "OpenRouter", { held: HELD })], false);
    expect(html).toContain("Open the installed DASH app");
    expect(html).not.toContain("<select");
  });
});

/* ---------------------------------------------------------------------- *
 * What each kind of step runs on (MAR-654, A1.6)
 * ---------------------------------------------------------------------- */

/**
 * The three level rows, in all three states.
 *
 * A1.6's own table is the thing being checked: a row says the model id when it
 * has one, and when it has none it says what happens *instead* — the default
 * above, or that a step asking for this cannot run. Absence is a state here, not
 * a missing row, and the failure worth catching is a row going quiet.
 */
describe("what each kind of step runs on", () => {
  const HELD_KEYS = [key("openrouter", "OpenRouter", { held: HELD }), ...KEYS.slice(1)];

  const draw = (levels: FleetLevelModelsView, setting = defaultView()): string =>
    renderToStaticMarkup(
      <ModelDefault
        setting={setting}
        levels={levels}
        keys={HELD_KEYS}
        canAct
        onChanged={() => undefined}
      />,
    );

  it("draws all three levels, weakest first, with what each one means", () => {
    const html = draw(levelsFor(["openrouter"]));
    expect(html).toContain("What each kind of step runs on");
    for (const level of DEFAULT_MODEL_LEVELS) {
      expect(html).toContain(`level-model-${level}`);
      expect(html).toContain(levelLabel(level));
    }
    // Weakest first, so the column reads the way the plan's levels are ordered.
    expect(html.indexOf("level-model-cheap")).toBeLessThan(html.indexOf("level-model-standard"));
    expect(html.indexOf("level-model-standard")).toBeLessThan(html.indexOf("level-model-frontier"));
  });

  it("says a step cannot run when nothing is mapped and there is no default", () => {
    const html = draw(levelsFor(["openrouter"]));
    expect(html).toContain("No model chosen, and no default either.");
    expect(html).toContain("cannot run");
  });

  it("names the default a level falls back to, when there is one", () => {
    const html = draw(
      levelsFor(["openrouter"], {}, "openai/gpt-5-mini"),
      defaultView({ provider_id: "openrouter", model_id: "openai/gpt-5-mini" }),
    );
    expect(html).toContain("Steps that ask for this use openai/gpt-5-mini");
    expect(html).not.toContain("cannot run");
  });

  it("keeps a mapped model selected before the catalogue has been asked for", () => {
    // `ModelPicker`'s rule, one row along: a `select` whose value matches no
    // option silently shows the first one, and a person would read "no model" on
    // a level that has one.
    const html = draw(levelsFor(["openrouter"], { standard: "mapped/model" }, "openai/gpt-5-mini"));
    expect(html).toContain('value="mapped/model" selected');
    // And the row with a model says nothing about falling back, because it does
    // not fall back.
    expect(html).not.toContain("Steps that ask for this use openai/gpt-5-mini, DASH's default");
  });

  it("draws nothing for a provider DASH holds no key for", () => {
    // A row is picked from a catalogue a key returned, so a section offering
    // rows for a service DASH cannot ask would be three dropdowns with nothing
    // to put in them.
    expect(draw(levelsFor([]))).not.toContain("What each kind of step runs on");
  });
});

/* ---------------------------------------------------------------------- *
 * Task-first AI (MAR-877, UX-3)
 * ---------------------------------------------------------------------- */

/**
 * The two states this tab now has, and what each one leads with.
 *
 * The audit's finding was an order rather than a wording: the tab put repair
 * before setup and drew three routing cards on a DASH that could not route
 * anything. Every sentence below is the same sentence it was; the claims here
 * are all about **which of them a person meets without pressing something**.
 *
 * The one that must never regress is the adoption press. ADR 0013's third
 * moment — an agent imported after a key was connected, given that key by a
 * deliberate press — is what MAR-874 and MAR-878 both build on, and a fold that
 * hid it would break them silently.
 */
describe("a DASH with no model key (MAR-877)", () => {
  const NOTHING_HELD = view();

  it("asks one question and offers one card", () => {
    const html = drawAi(NOTHING_HELD);
    expect(html).toContain("Connect a model provider");
    // All three are still offered — as a chooser rather than as three stacked
    // paragraphs of consequence.
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Anthropic");
    expect(html).toContain("OpenAI");
    expect(html).toContain("ai-first-key-provider");
  });

  it("draws nothing about defaults, routing or repair", () => {
    /*
     * There is nothing yet to route, default or repair. A page that led with
     * recovery prose above a setup it had not offered is the defect; a page
     * that draws a folded *Troubleshoot* here would be the same defect one
     * press deep.
     */
    const html = drawAi(NOTHING_HELD);
    expect(html).not.toContain("The model new agents use");
    expect(html).not.toContain("Advanced routing");
    expect(html).not.toContain("Troubleshoot");
    expect(html).not.toContain("What each kind of step runs on");
  });

  it("still says what each provider will be able to do, before its button", () => {
    // ADR 0002 amendment 2's rule survives the rearrangement: the chosen card
    // is `FleetConnectorCard` unchanged, consequences and all.
    const html = drawAi(NOTHING_HELD);
    expect(html).toContain("What DASH would be able to do");
    expect(html.indexOf("What DASH would be able to do")).toBeLessThan(
      html.indexOf("button-primary"),
    );
  });
});

describe("a DASH that holds a key (MAR-877)", () => {
  const held = (): ConnectionsView =>
    view({
      fleet: [
        connector(),
        key("openrouter", "OpenRouter", { held: HELD }),
        key("anthropic", "Anthropic"),
        key("openai", "OpenAI"),
      ],
      model_default: defaultView({
        provider_id: "openrouter",
        model_id: "openai/gpt-5-mini",
        in_force: describeFleetDefault("OpenRouter", "openai/gpt-5-mini", 1).in_force,
      }),
      level_models: levelsFor(["openrouter"]),
    });

  it("leads with the one line that says what is in force", () => {
    const html = drawAi(held());
    const inForce = html.indexOf("through your OpenRouter key");
    const advanced = html.indexOf("Advanced routing");
    expect(inForce).toBeGreaterThan(-1);
    expect(advanced).toBeGreaterThan(-1);
    expect(inForce).toBeLessThan(advanced);
  });

  it("folds the level rows and the key cards, and offers a way in", () => {
    const html = drawAi(held());
    // Present — nothing is deleted — and behind a shut disclosure.
    expect(html).toContain("What each kind of step runs on");
    expect(html).toContain("Your keys");
    const at = html.indexOf("Advanced routing");
    const opening = html.lastIndexOf("<details", at);
    expect(html.slice(opening, at)).not.toContain("open");
    // And a person who came to change the model has a control that says so.
    expect(html).toContain("Change");
  });

  it("says the in-force sentence once, not once above the fold and once inside", () => {
    /*
     * Hidden text is still in the markup: a heading, a detail and an in-force
     * sentence repeated inside a shut disclosure is the same words twice for
     * anybody reading with a screen reader, and twice for the copy gates.
     * `ModelDefault`'s `standing` prop is what the page passes to say so.
     */
    const html = drawAi(held());
    expect(html.split("through your OpenRouter key")).toHaveLength(2);
    expect(html.split("The model new agents use")).toHaveLength(2);
  });

  it("opens the fold when no default has been chosen yet", () => {
    // The picker under it is the whole reason somebody who has just pasted a
    // key is on this page.
    const html = drawAi(
      view({
        fleet: [connector(), key("openrouter", "OpenRouter", { held: HELD }), ...KEYS.slice(1)],
        level_models: levelsFor(["openrouter"]),
      }),
    );
    const at = html.indexOf("Advanced routing");
    const opening = html.lastIndexOf("<details", at);
    expect(html.slice(opening, at)).toContain("open");
  });
});

describe("the adoption press stays findable (MAR-877, ADR 0013 moment 3)", () => {
  const WAITING = (): ConnectionsView =>
    view({
      fleet: [
        connector(),
        key("openrouter", "OpenRouter", { held: HELD, waiting: ["Proof Scout"] }),
        key("anthropic", "Anthropic"),
        key("openai", "OpenAI"),
      ],
      model_default: defaultView({
        provider_id: "openrouter",
        model_id: "openai/gpt-5-mini",
        in_force: describeFleetDefault("OpenRouter", "openai/gpt-5-mini", 1).in_force,
      }),
      level_models: levelsFor(["openrouter"]),
    });

  it("says above the fold that somebody is waiting", () => {
    expect(drawAi(WAITING())).toContain(
      "1 agent is waiting to be given a key DASH already holds",
    );
  });

  it("opens the fold so the press is on screen without a click", () => {
    /*
     * The press itself is `FleetConnectorCard`'s and its semantics are
     * untouched — this opens the fold rather than drawing a second button,
     * because two controls doing one thing is how a page comes to disagree with
     * itself about whether it was pressed.
     */
    const html = drawAi(WAITING());
    const at = html.indexOf("Advanced routing");
    const opening = html.lastIndexOf("<details", at);
    expect(html.slice(opening, at)).toContain("open");
    expect(html).toContain("Give it to Proof Scout");
    // And it is still the primary control on that card.
    const press = html.indexOf("Give it to Proof Scout");
    expect(html.lastIndexOf("button-primary", press)).toBeGreaterThan(
      html.lastIndexOf("button-secondary", press),
    );
  });
});

describe("a key DASH cannot read (MAR-877)", () => {
  const UNREADABLE = {
    ...HELD,
    secret_readable: false,
    unreadable: {
      headline: "DASH cannot read your OpenRouter key.",
      actor: "user" as const,
      meaning: "The key is stored, and this computer refused to hand it back.",
      next_action: "Try Refresh connections, then add the key again if that does not help.",
    },
  };

  it("says so above the fold, in a line that points at the recovery", () => {
    const html = drawAi(
      view({
        fleet: [
          connector(),
          key("openrouter", "OpenRouter", { held: UNREADABLE }),
          ...KEYS.slice(1),
        ],
        model_default: defaultView({
          provider_id: "openrouter",
          model_id: "openai/gpt-5-mini",
          in_force: describeFleetDefault("OpenRouter", "openai/gpt-5-mini", 1).in_force,
        }),
        level_models: levelsFor(["openrouter"]),
      }),
    );
    expect(html).toContain("There is 1 key DASH holds and cannot read right now.");
    // The card's own three-part explanation is untouched and still under its
    // chip — MAR-676's placement, which MAR-877 does not get to move.
    expect(html).toContain("DASH cannot read your OpenRouter key.");
  });
});

/* ---------------------------------------------------------------------- *
 * Services first, lapses summarised (MAR-877)
 * ---------------------------------------------------------------------- */

/**
 * The Connections page's order.
 *
 * Henrik's machine drew five per-agent lapse blocks, each with its own heading
 * and its own fold, before the word *Gmail* appeared. Every one was true; the
 * *list* of them was not what anybody opened this page for.
 */
describe("the Connections page leads with services (MAR-877)", () => {
  const LAPSING = (): AgentConnections[] => [
    {
      name: "ai-news-scout-4",
      title: "AI news scout",
      avatar: null,
      rows: [],
      lapses: [
        {
          kind: "dash_closed",
          sentence: "DASH was closed for part of this window.",
          qualifier: null,
          from_at: "2026-08-02T09:00:00.000Z",
          until_at: "2026-08-02T10:00:00.000Z",
        },
      ],
    },
    {
      name: "proof-scout",
      title: "Proof Scout",
      avatar: null,
      rows: [],
      lapses: [
        {
          kind: "dropped_by_runner",
          sentence: "The background service discarded 2 requests.",
          qualifier: null,
          from_at: "2026-08-03T09:00:00.000Z",
          until_at: "2026-08-03T09:00:02.000Z",
        },
      ],
    },
  ];

  const drawList = (agents: AgentConnections[]): string =>
    renderToStaticMarkup(
      <ServiceList view={view({ agents })} canAct onChanged={() => undefined} />,
    );

  it("puts the first service above anything about lapses", () => {
    const html = drawList(LAPSING());
    const service = html.indexOf("Gmail");
    const lapses = html.indexOf("DASH cannot account for");
    expect(service).toBeGreaterThan(-1);
    expect(lapses).toBeGreaterThan(-1);
    expect(service).toBeLessThan(lapses);
  });

  it("rolls five headings into one line with both numbers", () => {
    const html = drawList(LAPSING());
    expect(html).toContain("DASH cannot account for 2 periods across 2 agents.");
    // One disclosure, not one per agent.
    expect(html.match(/broker-lapse-summary/gu)).toHaveLength(1);
  });

  it("keeps every period, every window and the caveat", () => {
    const html = drawList(LAPSING());
    expect(html).toContain("DASH was closed for part of this window.");
    expect(html).toContain("The background service discarded 2 requests.");
    expect(html).toContain("These are not decisions.");
    // One row per agent, named the way a person reads a name.
    expect(html).toContain("AI news scout");
    expect(html).toContain("Proof Scout");
  });

  it("draws nothing at all when no agent has one", () => {
    // The ordinary case. An "everything is accounted for" panel would be a page
    // reassuring somebody about a thing they had not asked about.
    const html = drawList([]);
    expect(html).not.toContain("broker-lapse");
    expect(html).not.toContain("cannot account for");
  });
});

/**
 * Nothing is deleted, only moved (MAR-877).
 *
 * The first draft of `ModelDefault`'s `standing` prop suppressed the whole
 * three-line block, and with it `setting.detail` — the sentence saying that
 * choosing a model on an agent's own page always wins and that changing the
 * default never moves an agent that has chosen. That is a consequence rather
 * than a repetition of the summary line, and dropping it was a copy removal
 * wearing a layout change.
 *
 * It was caught by comparing the capture harness's own word counters across the
 * two builds, not by any test that existed. This is that finding, pinned.
 */
describe("the standing prop suppresses two lines, not three (MAR-877)", () => {
  const KEYS_HELD = [key("openrouter", "OpenRouter", { held: HELD }), ...KEYS.slice(1)];
  const SETTING = defaultView({
    provider_id: "openrouter",
    model_id: "openai/gpt-5-mini",
    in_force: describeFleetDefault("OpenRouter", "openai/gpt-5-mini", 1).in_force,
  });

  const draw = (standing: boolean): string =>
    renderToStaticMarkup(
      <ModelDefault
        setting={SETTING}
        levels={levelsFor(["openrouter"])}
        keys={KEYS_HELD}
        canAct
        onChanged={() => undefined}
        standing={standing}
      />,
    );

  it("keeps the sentence about whose decision this is", () => {
    // A fragment with no apostrophe in it: `renderToStaticMarkup` escapes them,
    // so comparing the whole sentence would fail on the entity rather than on
    // the claim.
    const detail = "changing this never moves an agent that has chosen";
    expect(SETTING.detail).toContain(detail);
    expect(draw(true)).toContain(detail);
    expect(draw(false)).toContain(detail);
  });

  it("drops only the heading and the in-force line", () => {
    const off = draw(false);
    expect(off).not.toContain(SETTING.headline);
    expect(off).not.toContain(SETTING.in_force);
    // And the picker it exists to hold is untouched.
    expect(off).toContain("model-default-select");
  });

  it("says all three when nothing above it is saying them", () => {
    const on = draw(true);
    expect(on).toContain(SETTING.headline);
    expect(on).toContain(SETTING.in_force);
    expect(on).toContain("changing this never moves an agent that has chosen");
  });
});
