/**
 * The model section, drawn in every state it has (MAR-583).
 *
 * `tests/model-choice.test.ts` drives the resolution and the sentences. This
 * drives the surface that shows them, and the assertions that matter are about
 * **what is offered**:
 *
 * - the recommended option is first and is what a person lands on;
 * - a model already chosen is in the list even before a provider has been asked,
 *   so a `select` cannot silently show the wrong option;
 * - nothing is drawn at all for an agent whose plan uses no model;
 * - the per-step controls are visible and inert rather than hidden when a named
 *   model has set them aside;
 * - a browser tab is told which window can act rather than shown a dead control.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelChoice, ModelPicker } from "../app/_components/model-choice";
import { describeNoChoice } from "../lib/ai/model-choice";
import { AGENT_SETTINGS_COPY } from "../lib/copy/agent-page";
import { levelLabel } from "../lib/ai/model-levels";
import type { AgentModelSettingsView, ModelStepView } from "../lib/views/types";
import { expectPlainLanguage } from "./helpers/plain-language";

const STEPS: ModelStepView[] = [
  {
    step: 2,
    component_id: "public_feed_fetch",
    level: "cheap",
    label: levelLabel("cheap"),
    meaning: "This step pulls facts out of text that is already in front of it.",
    declared: "cheap",
    declared_label: levelLabel("cheap"),
    overridden: false,
    // MAR-654, A1.6. This step falls back to DASH's default; the one below is
    // answered by a row the person mapped. Two rungs in one fixture, so the
    // render test sees both sentences rather than one repeated.
    resolved_model_id: "meta-llama/llama-3.3-70b-instruct:free",
    resolved_by: "fleet_default",
    resolved_note:
      "Runs on meta-llama/llama-3.3-70b-instruct:free, DASH's default model. " +
      "Nothing is set for small and cheap steps yet.",
  },
  {
    step: 3,
    component_id: "digest_write",
    level: "frontier",
    label: levelLabel("frontier"),
    meaning: "This step plans or writes something new.",
    declared: "standard",
    declared_label: levelLabel("standard"),
    overridden: true,
    resolved_model_id: "anthropic/claude-opus-5",
    resolved_by: "level_map",
    resolved_note:
      "Runs on anthropic/claude-opus-5, which you chose for the best available steps.",
  },
];

function choosable(over: Partial<AgentModelSettingsView> = {}): AgentModelSettingsView {
  return {
    can_choose: true,
    provider_id: "openrouter",
    provider_label: "OpenRouter",
    connection_id: "models",
    field_id: "key",
    headline: "Choose which OpenRouter model this agent uses",
    detail: "Two steps in this agent's plan need a model.",
    chosen_model_id: null,
    in_force: "Two steps need a model and they ask for different strengths.",
    // MAR-642's two fields, at their no-default values: this DASH has no
    // fleet-wide model, so leaving the picker alone still means per-step
    // matching and the option says so. `describeUnpinnedOption` words both
    // states and `tests/model-choice.test.ts` drives the other one.
    from_default: false,
    unpinned_option: "Match each step to what it needs",
    steps: STEPS,
    steps_in_force: true,
    steps_note: null,
    steps_link_label: "Choose what each kind of step runs on",
    ...over,
  } as AgentModelSettingsView;
}

function section(settings: AgentModelSettingsView, canAct = true): string {
  return renderToStaticMarkup(
    <ModelChoice
      agent="ai-news-scout"
      settings={settings}
      canAct={canAct}
      onChanged={() => undefined}
      setFeedback={() => undefined}
    />,
  );
}

/**
 * The picker on its own (MAR-874).
 *
 * ## Why four assertions moved onto this rather than onto `section`
 *
 * The picker no longer stands open. The section leads with what is in force and
 * offers *Change*; the dropdown is what that press opens — the rule this stage
 * now follows everywhere, one state sentence and one action, applied to a
 * control almost nobody should touch.
 *
 * `renderToStaticMarkup` cannot press anything, and this repository has no DOM
 * testing library by choice. So the four assertions below are aimed at the
 * component that owns the property each is about, which is where they were
 * always really pointed: the recommended option being first, an already chosen
 * model surviving in the list, and the button saying what it will do are all
 * facts about `ModelPicker` and not about whether somebody has opened it.
 *
 * The closed state gets its own test beside them, so the press is pinned too.
 */
function picker(over: Partial<Parameters<typeof ModelPicker>[0]> = {}): string {
  return renderToStaticMarkup(
    <ModelPicker
      chosen={null}
      unpinned="Match each step to what it needs"
      models={null}
      provider="OpenRouter"
      busy={false}
      onChoose={() => undefined}
      onAsk={() => undefined}
      {...over}
    />,
  );
}

function noChoice(
  reason: Parameters<typeof describeNoChoice>[0],
  steps: ModelStepView[] = [],
): AgentModelSettingsView {
  const sentence = describeNoChoice(reason, "OpenRouter");
  return {
    can_choose: false,
    reason: sentence.reason,
    headline: sentence.headline,
    detail: sentence.detail,
    next_action: sentence.next_action,
    steps,
  };
}

/**
 * The one no-key state that has a press (MAR-874, ADR 0013 moment 2).
 *
 * `no_key_held` plus an `adopt` target, which `buildAgentModelSettings` sets
 * exactly when a fleet connection exists for the provider this agent declares.
 * The target carries an address and nothing else — see the field's own note on
 * what it may never carry.
 */
function adoptable(steps: ModelStepView[] = []): AgentModelSettingsView {
  return {
    ...noChoice("no_key_held", steps),
    adopt: { connection_id: "models", field_id: "key", provider_label: "OpenRouter" },
  } as AgentModelSettingsView;
}

describe("the model section", () => {
  it("draws nothing at all when the plan uses no model", () => {
    // A notice explaining an absence would be DASH describing its own internals
    // at somebody who came to look at their agent — `FolderUpdate`'s own call.
    expect(section(noChoice("no_model_needed"))).toBe("");
  });

  /**
   * MAR-874. The ordinary visit is one sentence and one press.
   *
   * The dropdown, the provider button and the catalogue sentence were on screen
   * for every visit to this stage, on a setting whose recommended value is right
   * for almost everybody. What a person came for is the line above them, and
   * this is the assertion that keeps it that way: `in_force` is drawn, *Change*
   * is drawn, and no `select` is.
   */
  it("leads with what is in force and offers one press, not a dropdown", () => {
    const html = section(choosable());
    expect(html).toContain("Two steps need a model and they ask for different strengths.");
    expect(html).toContain("Change");
    expect(html).not.toContain("<select id=\"model-picker-select\"");
  });

  it("puts the recommended option first and lands on it by default", () => {
    const html = picker();
    expect(html).toContain("Match each step to what it needs");
    expect(html).toContain("Recommended");
    // The recommended option is the empty value, which is what an unset choice
    // resolves to — so a person who has never touched this is on it.
    expect(html).toContain('value=""');
    // And the second group is not drawn at all before anything has been asked
    // for: an empty "One model for everything" would advertise a list that is
    // not there yet, which is what the button below the control is for.
    expect(html).not.toContain("One model for everything");
  });

  it("puts the recommended group above the models once there are models", () => {
    const html = picker({ chosen: "anthropic/claude-sonnet-5" });
    expect(html.indexOf("Recommended")).toBeLessThan(html.indexOf("One model for everything"));
  });

  it("keeps a chosen model in the list before any provider has been asked", () => {
    /*
     * The defect this prevents is silent: a `select` whose value matches no
     * option shows the first one instead, so an agent set to a named model would
     * appear to be on the recommended setting until somebody pressed the button
     * that fetches the list.
     */
    const html = picker({ chosen: "anthropic/claude-sonnet-5" });
    expect(html).toContain("anthropic/claude-sonnet-5");
    expect(html).toContain("One model for everything");
  });

  it("says what pressing the button will do before it does it", () => {
    const html = picker();
    expect(html).toContain("See what OpenRouter offers");
    expect(html).toContain("present the key it holds");
    // And that the answer is not kept, which is the property `ai_key_checks` was
    // designed around.
    expect(html).toContain("keeps no copy of the list");
  });

  it("shows the step controls set aside rather than hiding them", () => {
    const html = section(
      choosable({
        chosen_model_id: "anthropic/claude-sonnet-5",
        steps_in_force: false,
        steps_note: "These are set aside while every step uses anthropic/claude-sonnet-5.",
      }),
    );
    expect(html).toContain("set aside");
    // Still drawn, and disabled. Hiding a setting that still exists is how
    // somebody comes back to an agent behaving in a way the page does not explain.
    expect(html).toContain("Step 2");
    expect(html).toContain("disabled");
  });

  it("marks the step a person changed, and still offers the plan's own answer", () => {
    const html = section(choosable());
    expect(html).toContain("You changed this");
    expect(html).toContain(`What the plan asked for — ${levelLabel("standard").toLowerCase()}`);
  });

  it("says what each step resolves to and which rung answered (MAR-654)", () => {
    // A1.6. The control Henrik found greyed is live for an unpinned agent, and
    // each step names the model its level currently buys *and where that was
    // decided* — "this is what everything unmapped falls back to" and "you chose
    // this for balanced steps" are different facts about the same id.
    const html = section(choosable());
    expect(text(html)).toContain("DASH's default model");
    expect(text(html)).toContain("which you chose for the best available steps");
    expect(html).toContain("meta-llama/llama-3.3-70b-instruct:free");
    expect(html).toContain("anthropic/claude-opus-5");
    // And the link to where the map is set. Unfindable is the same as missing:
    // the map is one place, and every step depending on it says where.
    expect(html).toContain('href="/settings/ai"');
    expect(text(html)).toContain("Choose what each kind of step runs on");
  });

  it("drops the resolved line, and the link, when there is nothing to resolve", () => {
    // The section's own headline already says DASH does not choose this agent's
    // model. A second, differently-worded reason under every step would
    // contradict it, so `buildAgentModelSettings` leaves `resolved_note` null on
    // that arm — which is what these steps carry.
    const html = section(
      noChoice(
        "no_provider_key",
        STEPS.map((step) => ({
          ...step,
          resolved_model_id: null,
          resolved_by: "none",
          resolved_note: null,
        })),
      ),
    );
    expect(html).not.toContain("model-step-resolved");
    expect(html).not.toContain('href="/settings/ai"');
    // The declared strength is still drawn: it comes off the manifest and needs
    // no key.
    expect(html).toContain(levelLabel("cheap"));
  });

  it("drops the link while a pin has set the levels aside", () => {
    // A promise about a control has to be true of the control it is under: with
    // a model pinned, changing what a level means changes nothing here.
    const html = section(
      choosable({
        chosen_model_id: "anthropic/claude-sonnet-5",
        steps_in_force: false,
        steps_note: "These are set aside while every step uses anthropic/claude-sonnet-5.",
      }),
    );
    expect(html).not.toContain('href="/settings/ai"');
  });

  it("tells a browser tab which window can act instead of drawing a dead control", () => {
    const html = section(choosable(), false);
    expect(html).toContain("Open the installed DASH app");
    expect(html).not.toContain("<select");
  });

  it("still shows what each step asks for when there is nothing to choose", () => {
    // A shell that cannot act, and an agent whose model DASH does not choose,
    // both still get the plan's own answer — it comes off the manifest and needs
    // no bridge and no key.
    const html = section(noChoice("no_provider_key", STEPS));
    expect(text(html)).toContain("DASH does not choose this agent's model");
    expect(html).toContain(levelLabel("cheap"));
  });

  it("offers the one next step when a key would make this work", () => {
    const html = section(noChoice("no_key_held"));
    expect(html).toContain("Connections page");
  });

  /* ------------------------------------------------------------------ *
   * MAR-874: the four states, and the press that ends one of them
   * ------------------------------------------------------------------ */

  /**
   * **Waiting for your key** — the state ADR 0013 moment 2 always had an answer
   * for, in the one place nobody could find it.
   *
   * A plugin-built agent declares `model_provider`. DASH holds no key of its
   * own for it and already holds a fleet key for that same provider. Until
   * MAR-874 this row said *connect the key on the Connections page* and the
   * person had to go there, find this agent's row, and press Connect — a press
   * that adopts the key they already gave, asks for nothing and contacts
   * nobody.
   *
   * The button offers **that press**, from here. `settings.adopt` carries the
   * connection's address and nothing else, which is what these assertions pin:
   * a sentence about the person's own key, one button, and no claim anywhere
   * that the key has been checked.
   */
  it("offers the key DASH already holds, where the question is asked", () => {
    const html = section(adoptable());
    expect(text(html)).toContain(
      AGENT_SETTINGS_COPY.model.adopt_headline("OpenRouter"),
    );
    expect(html).toContain(AGENT_SETTINGS_COPY.model.adopt_action);
    // One press, not two. The Connections-page instruction is the *other*
    // state's next action and must not appear beside a button that does it.
    expect(html).not.toContain("Connections page");
  });

  /**
   * The promise on that button, kept honest.
   *
   * It says the press asks for nothing and contacts nobody, which is exactly
   * what `adoptFleetCredential` does. It must not also say the key works: that
   * is the fleet card's to say, and this row never read the credential.
   */
  it("promises nothing about whether the key still works", () => {
    const words = text(section(adoptable()));
    expect(words).toContain("asks you for nothing and contacts nobody");
    expect(words).not.toContain("working");
    expect(words).not.toContain("verified");
  });

  /**
   * **Needs a provider** — declares a model, holds no key, and DASH holds
   * nothing for the fleet either. There is nothing to adopt, so there is no
   * button: the next step really is on another page.
   */
  it("sends you to the Connections page only when there is nothing to adopt", () => {
    const html = section(noChoice("no_key_held"));
    expect(html).toContain("Connections page");
    expect(html).not.toContain(AGENT_SETTINGS_COPY.model.adopt_action);
  });

  /**
   * **Cannot talk** — and the sentence is deliberately not the one the brief
   * proposed.
   *
   * MAR-874's design asked for *"This agent was built without a model, so it
   * cannot answer questions."* `describeNoChoice` refuses to say that, in as
   * many words: the manifest does **not** distinguish an agent that arranges
   * its own model from one naming a service DASH has not been built to ask, and
   * DASH must not guess which it is looking at. So this row keeps the trusted
   * side's ambiguous-and-true sentence rather than the page's confident-and-
   * possibly-false one, and this test is what stops a later pass from
   * "improving" it.
   */
  it("does not claim an agent was built without a model", () => {
    const words = text(section(noChoice("no_provider_key", STEPS)));
    expect(words).toContain("DASH does not choose this agent's model");
    expect(words).not.toContain("built without a model");
    // No press, because there is nothing DASH could do about it.
    expect(section(noChoice("no_provider_key", STEPS))).not.toContain(
      AGENT_SETTINGS_COPY.model.adopt_action,
    );
  });

  it("is plain language in every state a person can reach", () => {
    const surfaces = [
      section(choosable()),
      section(choosable({ chosen_model_id: "anthropic/claude-sonnet-5", steps_in_force: false })),
      section(noChoice("no_provider_key", STEPS)),
      section(noChoice("no_key_held")),
      // MAR-874's fourth state, and the read-only rendering of it.
      section(adoptable()),
      section(adoptable(), false),
      section(choosable(), false),
    ];
    for (const html of surfaces) {
      expectPlainLanguage([text(html)], {
        // Content rather than vocabulary: a model id is a provider's own name for
        // a product and is the thing a person is choosing, and `component_id`
        // values are not rendered by this component at all.
        allow: ["anthropic/claude-sonnet-5"],
      });
    }
  });
});

/** The words, without the markup. Attribute names are not copy. */
function text(html: string): string {
  return html
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&mdash;", "—")
    .replaceAll("&rsquo;", "'");
}
