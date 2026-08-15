/**
 * The guided checklist a never-run agent gets instead of empty sections
 * (MAR-609's rule, MAR-641's stage).
 *
 * The assertion that matters most is not about the list at all — it is that
 * every line comes off the same view the Model tile and the settings picker
 * read. MAR-624 is one need surfaced by three cards that did not acknowledge
 * each other, and a checklist that computed its own answer about a key would be
 * the fourth.
 */

import { describe, expect, it } from "vitest";

import { buildAgentChecklist, isEmptyAgent } from "../lib/views/agent-checklist";
import { AGENT_COCKPIT_COPY } from "../lib/copy/agent-page";
import type { AgentModelSettingsView } from "../lib/views/types";
import { expectPlainLanguage } from "./helpers/plain-language";

const CHOSEN: AgentModelSettingsView = {
  can_choose: true,
  provider_id: "openrouter",
  provider_label: "OpenRouter",
  connection_id: "models",
  field_id: "key",
  headline: "Which model this agent uses",
  detail: "DASH holds your OpenRouter key and asks on this agent's behalf.",
  chosen_model_id: "openai/gpt-5-mini",
  in_force: "Every step that needs a model uses openai/gpt-5-mini.",
  // This agent was pinned by hand rather than left on DASH's default (MAR-642).
  from_default: false,
  unpinned_option: "Match each step to what it needs",
  steps: [],
  steps_in_force: false,
  steps_note: null,
};

function unavailable(reason: string, next: string | null = null): AgentModelSettingsView {
  return {
    can_choose: false,
    reason,
    headline: "Connect your model provider to choose a model",
    detail: "This agent has a step that needs a language model and DASH holds no key for it.",
    next_action: next,
    steps: [],
  };
}

describe("whether an agent has anything to show yet", () => {
  it("is empty only when it has neither run nor produced", () => {
    const base = { models: CHOSEN, run_count: 0, output_count: 0 };
    expect(isEmptyAgent(base)).toBe(true);
    // Both halves, because they fail apart: a run that produced nothing is
    // still worth reading, and an output whose run record has been pruned is
    // still the thing a person came for.
    expect(isEmptyAgent({ ...base, run_count: 1 })).toBe(false);
    expect(isEmptyAgent({ ...base, output_count: 1 })).toBe(false);
  });
});

describe("the checklist", () => {
  it("opens with a step that is already done", () => {
    const [first] = buildAgentChecklist({ models: CHOSEN, run_count: 0, output_count: 0 });
    // A list whose every line is undone reads as a list of failures, and
    // "this agent is here" is both true and the thing a person just did.
    expect(first?.id).toBe("added");
    expect(first?.done).toBe(true);
    expect(first?.action).toBeNull();
  });

  it("reads the model line off the view rather than deciding for itself", () => {
    const ready = buildAgentChecklist({ models: CHOSEN, run_count: 0, output_count: 0 });
    const line = ready.find((step) => step.id === "model");
    expect(line?.done).toBe(true);
    // The view's own sentence about what DASH would use right now — the same
    // field the picker shows, which is what keeps the two from disagreeing.
    expect(line?.detail).toBe(CHOSEN.in_force);
  });

  it("points at the settings stage when a model is missing, in the view's words", () => {
    const steps = buildAgentChecklist({
      models: unavailable("no_key_held", "Connect OpenRouter"),
      run_count: 0,
      output_count: 0,
    });
    const line = steps.find((step) => step.id === "model");
    expect(line?.done).toBe(false);
    expect(line?.detail).toBe(unavailable("no_key_held").detail);
    expect(line?.action).toEqual({ label: "Connect OpenRouter", stage: "settings" });
  });

  it("falls back to a label rather than a blank when the view offers no action", () => {
    const steps = buildAgentChecklist({
      models: unavailable("no_provider_key", null),
      run_count: 0,
      output_count: 0,
    });
    expect(steps.find((step) => step.id === "model")?.action?.label).toBe(
      AGENT_COCKPIT_COPY.checklist.model.action,
    );
  });

  it("omits the model line entirely for an agent whose plan needs none", () => {
    /*
     * Not drawn as a satisfied tick. A tick beside "it has a model" on an agent
     * that needs none would teach a reader that DASH has connected something
     * for them, which is exactly the confusion MAR-624 is about.
     */
    const steps = buildAgentChecklist({
      models: unavailable("no_model_needed"),
      run_count: 0,
      output_count: 0,
    });
    expect(steps.map((step) => step.id)).toEqual(["added", "first_run"]);
  });

  it("ticks the first run once there has been one", () => {
    const never = buildAgentChecklist({ models: CHOSEN, run_count: 0, output_count: 0 });
    expect(never.find((step) => step.id === "first_run")?.done).toBe(false);
    expect(never.find((step) => step.id === "first_run")?.action).toEqual({
      label: AGENT_COCKPIT_COPY.checklist.first_run.action,
      stage: "run",
    });
    const ran = buildAgentChecklist({ models: CHOSEN, run_count: 2, output_count: 0 });
    expect(ran.find((step) => step.id === "first_run")?.done).toBe(true);
    expect(ran.find((step) => step.id === "first_run")?.action).toBeNull();
  });

  it("stays short, because the empty agent is what it is sized for", () => {
    expect(buildAgentChecklist({ models: CHOSEN, run_count: 0, output_count: 0 })).toHaveLength(3);
  });

  it("speaks plain language", () => {
    const copy = AGENT_COCKPIT_COPY.checklist;
    expectPlainLanguage([
      copy.heading,
      copy.added.label,
      copy.added.detail,
      copy.model.label,
      copy.model.ready,
      copy.model.action,
      copy.first_run.label,
      copy.first_run.detail,
      copy.first_run.action,
      copy.done,
      copy.todo,
    ]);
  });
});
