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

import { ModelChoice } from "../app/_components/model-choice";
import { describeNoChoice } from "../lib/ai/model-choice";
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

describe("the model section", () => {
  it("draws nothing at all when the plan uses no model", () => {
    // A notice explaining an absence would be DASH describing its own internals
    // at somebody who came to look at their agent — `FolderUpdate`'s own call.
    expect(section(noChoice("no_model_needed"))).toBe("");
  });

  it("puts the recommended option first and lands on it by default", () => {
    const html = section(choosable());
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
    const html = section(choosable({ chosen_model_id: "anthropic/claude-sonnet-5" }));
    expect(html.indexOf("Recommended")).toBeLessThan(html.indexOf("One model for everything"));
  });

  it("keeps a chosen model in the list before any provider has been asked", () => {
    /*
     * The defect this prevents is silent: a `select` whose value matches no
     * option shows the first one instead, so an agent set to a named model would
     * appear to be on the recommended setting until somebody pressed the button
     * that fetches the list.
     */
    const html = section(choosable({ chosen_model_id: "anthropic/claude-sonnet-5" }));
    expect(html).toContain("anthropic/claude-sonnet-5");
    expect(html).toContain("One model for everything");
  });

  it("says what pressing the button will do before it does it", () => {
    const html = section(choosable());
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

  it("is plain language in every state a person can reach", () => {
    const surfaces = [
      section(choosable()),
      section(choosable({ chosen_model_id: "anthropic/claude-sonnet-5", steps_in_force: false })),
      section(noChoice("no_provider_key", STEPS)),
      section(noChoice("no_key_held")),
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
