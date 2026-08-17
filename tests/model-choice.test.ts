/**
 * Choosing a model, and what DASH does and does not record about it (MAR-583).
 *
 * Written against a real SQLite store and a real `Vault` over a fake
 * `safeStorage`, for `tests/ai-key-connection.test.ts`'s reason: the questions
 * here are "what does the row say", "what got deleted" and "what never got
 * written", and a mocked store answers none of them.
 *
 * The claims this file holds:
 *
 * 1. **Absence is the recommended setting.** An agent nobody has configured has
 *    no row, reads as matching each step, and choosing the default *back*
 *    deletes rather than writes.
 * 2. **A provider's catalogue is never stored.** The ids reach the caller that
 *    asked and land in no table — the constraint `ai_key_checks` was designed
 *    around and the one thing here that could quietly stop being true.
 * 3. **A run records DASH's own setting, once.** Changing the setting mid-run
 *    cannot revise what an already-started run reports.
 * 4. **There is no cost, anywhere.** Not in a column, not in a view, not in a
 *    sentence with a figure in it. MAR-299 owns spend.
 * 5. **A key that cannot travel refuses the deploy**, with a sentence rather
 *    than a broken push.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  LEVEL_MAP_LINK_LABEL,
  MODEL_KEY_STAYS_HOME_REFUSAL,
  applyFleetDefault,
  bundledModelChoice,
  describeRunModel,
  describeRunModelDetail,
  describeStepsNotInForce,
  everyModelChoiceSentence,
  matchEachStep,
  resolveModelSteps,
  resolveStepModels,
  type FleetModelDefault,
  type LevelModelMap,
} from "../lib/ai/model-choice";
import type { DefaultModelLevel } from "../lib/ai/model-levels";
import { classifyProbe } from "../lib/ai/liveness";
import type { ConnectionSourceManifest } from "../lib/connections";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";
import { refusingOAuth } from "./fakes/oauth-operations";
import { scriptedAi } from "./fakes/ai-operations";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-model-choice-"));
process.env.DASH_DATA_DIR = dataDir;

const { performConnectionAction } = await import("../lib/connection-actions");
const { listAiKeyModels } = await import("../lib/ai/actions");
const { resolveCredentialTarget } = await import("../lib/connection-credentials");
const { closeDb, db } = await import("../lib/db");
const { importManifest, ingestEvents, resetStore } = await import("../lib/store");
const {
  clearAgentModelChoice,
  clearFleetLevelModel,
  clearFleetModelDefault,
  clearStepLevelOverride,
  forgetAgentModelChoice,
  hasFleetLevelModels,
  readAgentModelChoice,
  readEffectiveModelChoice,
  readFleetLevelModels,
  readFleetModelDefault,
  readRunModel,
  readRunModels,
  readStepLevelOverrides,
  writeAgentModelChoice,
  writeFleetLevelModel,
  writeFleetModelDefault,
  writeStepLevelOverride,
} = await import("../lib/ai/model-store");
const { buildAgentModelSettings, buildRunModel } = await import("../lib/views/models");
const { readStoreBytes } = await import("./helpers/store-bytes");

/** Distinctive: if this appears anywhere, it got there from this test. */
const KEY = "sk-or-v1-4Kd8ZqPmXt2VnRwLbEy7";

const AGENT = "digest-writer";
const TARGET = { agent_id: AGENT, connection_id: "models", field_id: "key" };

const AT = "2026-08-10T09:00:00.000Z";
const LATER = "2026-08-10T10:00:00.000Z";

/* ---------------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------------- */

/**
 * A manifest with a model-provider key and a plan that needs one.
 *
 * Built here rather than added to `examples/` for `tests/ai-key-connection.ts`'s
 * reason: `examples/` is what DASH ships to authors as a model to copy, and the
 * one shipped example that declares a model provider is deliberately the one
 * MAR-583 added for the capture harness — see `examples/model-routing…`.
 */
function manifestWith(
  route: Array<Record<string, unknown>>,
  overrides: { provider?: string; ownership?: string } = {},
): ConnectionSourceManifest {
  return {
    planned_route: route as ConnectionSourceManifest["planned_route"],
    agent_dom: {
      connections: [
        {
          id: "models",
          provider: overrides.provider ?? "openrouter",
          label: "Your model provider",
          purpose: "Write the digest",
          ownership: (overrides.ownership ?? "dash_managed") as "dash_managed",
          capabilities: [{ id: "model.completion", label: "Write text", access: "write" }],
          fields: [
            {
              id: "key",
              label: "API key",
              purpose: "So DASH can reach the provider for this agent",
              kind: "secret",
              required: true,
            },
          ],
          validation_action: { id: "check", label: "Check", behavior: "test" },
        },
      ],
    },
  };
}

function step(index: number, tier: string, level?: string): Record<string, unknown> {
  return {
    step: index,
    component_id: `component-${String(index)}`,
    risk_level: "low",
    model_tier: tier,
    ...(level === undefined ? {} : { default_model_level: level }),
  };
}

/** Two AI steps at different strengths, plus one that needs nothing. */
const MIXED_ROUTE = [step(1, "none"), step(2, "small", "cheap"), step(3, "frontier", "frontier")];

function vault(): Vault {
  return new Vault({
    directory: path.join(dataDir, "vault"),
    safeStorage: new FakeSafeStorage(),
    platform: "win32",
  });
}

function event(runId: string, seq: number, model?: string): Record<string, unknown> {
  return {
    event_version: 1,
    agent: AGENT,
    run_id: runId,
    seq,
    ts: AT,
    type: seq === 0 ? "run_started" : "step_started",
    component_id: "component-2",
    ...(model === undefined ? {} : { model }),
  };
}

/** The events DASH holds for one run, in the shape `buildRunModel` reads. */
function reported(...models: Array<string | undefined>): Array<{ model?: string }> {
  return models.map((model) => ({ model }));
}

/**
 * A whole, schema-valid manifest for this agent, for the one caller that reads
 * it back out of the store rather than being handed it (MAR-642).
 *
 * The shipped example with this file's own connection block and route grafted
 * on, rather than a second hand-written manifest: what is under test is the
 * ingest path's provider lookup, and a fixture that drifted from the schema
 * would fail as an import error somewhere far away from the thing it was
 * checking.
 */
function storedManifest(): Record<string, unknown> {
  const example = JSON.parse(
    readFileSync(path.join(repoRoot, "examples", "agent.manifest.example.json"), "utf8"),
  ) as Record<string, unknown>;
  const source = manifestWith(MIXED_ROUTE);
  return {
    ...example,
    agent: { ...(example["agent"] as Record<string, unknown>), name: AGENT },
    planned_route: source.planned_route,
    agent_dom: source.agent_dom,
  };
}

async function connectKey(store: Vault, source: ConnectionSourceManifest): Promise<void> {
  const result = await performConnectionAction("connect", TARGET, {
    store,
    readManifest: () => source,
    promptForSecret: () => Promise.resolve(KEY),
    oauth: refusingOAuth(),
    ai: scriptedAi(),
  });
  expect(result.ok).toBe(true);
}

beforeEach(() => {
  resetStore();
  forgetAgentModelChoice(AGENT);
  db().prepare("DELETE FROM run_models").run();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * The choice
 * ---------------------------------------------------------------------- */

describe("an agent nobody has configured", () => {
  it("is matching each step, with no row to say so", () => {
    expect(readAgentModelChoice(AGENT)).toEqual({ kind: "match_each_step" });
    expect(readStepLevelOverrides(AGENT).size).toBe(0);

    const rows = db()
      .prepare("SELECT count(*) AS n FROM agent_model_choice WHERE agent = ?")
      .get(AGENT) as { n: number };
    expect(rows.n).toBe(0);
  });

  it("goes back to the default by losing its row, not by storing one", () => {
    expect(writeAgentModelChoice(AGENT, "openrouter", "anthropic/claude-sonnet-5", AT)).toBe(true);
    clearAgentModelChoice(AGENT);

    const rows = db()
      .prepare("SELECT count(*) AS n FROM agent_model_choice WHERE agent = ?")
      .get(AGENT) as { n: number };
    expect(rows.n).toBe(0);
    expect(readAgentModelChoice(AGENT)).toEqual({ kind: "match_each_step" });
  });

  it("does the same for one step's level", () => {
    expect(writeStepLevelOverride(AGENT, 2, "frontier", AT)).toBe(true);
    expect(readStepLevelOverrides(AGENT).get(2)).toBe("frontier");

    clearStepLevelOverride(AGENT, 2);
    expect(readStepLevelOverrides(AGENT).size).toBe(0);
  });
});

describe("what will not be stored", () => {
  it("refuses a provider this build does not broker", () => {
    expect(writeAgentModelChoice(AGENT, "some-other-service", "a-model", AT)).toBe(false);
    expect(readAgentModelChoice(AGENT)).toEqual({ kind: "match_each_step" });
  });

  it("refuses a model id that could become a path", () => {
    // MAR-582's own near-miss, one layer along. Its first draft accepted this
    // because a flat character class allowing `.` and `/` does; the predicate is
    // shared rather than restated, so the hardening reaches both callers.
    expect(writeAgentModelChoice(AGENT, "openrouter", "../../etc/passwd", AT)).toBe(false);
    expect(writeAgentModelChoice(AGENT, "openrouter", "a model", AT)).toBe(false);
    expect(writeAgentModelChoice(AGENT, "openrouter", "", AT)).toBe(false);
    expect(readAgentModelChoice(AGENT)).toEqual({ kind: "match_each_step" });
  });

  it("refuses a level this build does not know, and a step that is not one", () => {
    expect(writeStepLevelOverride(AGENT, 1, "genius", AT)).toBe(false);
    expect(writeStepLevelOverride(AGENT, 0, "cheap", AT)).toBe(false);
    expect(writeStepLevelOverride(AGENT, 1.5, "cheap", AT)).toBe(false);
    expect(readStepLevelOverrides(AGENT).size).toBe(0);
  });
});

/* ---------------------------------------------------------------------- *
 * What the page is offered
 * ---------------------------------------------------------------------- */

describe("what the agent page can offer", () => {
  it("offers nothing, and says nothing, for a plan with no model in it", () => {
    const settings = buildAgentModelSettings(AGENT, manifestWith([step(1, "none")]));
    expect(settings.can_choose).toBe(false);
    expect(settings).toMatchObject({ reason: "no_model_needed" });
    expect(settings.steps).toEqual([]);
  });

  it("says DASH does not choose, when the agent declares no key DASH can ask", () => {
    // The provider is one DASH has never heard of, so `aiKeyConnections` produces
    // no card. The sentence has to cover both of the things this might be — an
    // agent with its own model, or a service DASH cannot ask — because the
    // manifest does not distinguish them.
    const settings = buildAgentModelSettings(
      AGENT,
      manifestWith(MIXED_ROUTE, { provider: "some-other-service" }),
    );
    expect(settings).toMatchObject({ can_choose: false, reason: "no_provider_key" });
    // The declared levels are still readable. A shell that cannot act must still
    // be able to show what each step asked for.
    expect(settings.steps.map((entry) => entry.level)).toEqual(["cheap", "frontier"]);
  });

  it("sends the person to Connections when there is a key to connect and none held", () => {
    const settings = buildAgentModelSettings(AGENT, manifestWith(MIXED_ROUTE));
    expect(settings).toMatchObject({ can_choose: false, reason: "no_key_held" });
    expect(settings.can_choose === false ? settings.next_action : null).not.toBeNull();
  });

  it("offers the choice once a key is held, defaulting to matching each step", async () => {
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);

    const settings = buildAgentModelSettings(AGENT, source);
    expect(settings.can_choose).toBe(true);
    if (!settings.can_choose) {
      return;
    }
    expect(settings.chosen_model_id).toBeNull();
    expect(settings.provider_id).toBe("openrouter");
    expect(settings.steps_in_force).toBe(true);
    expect(settings.steps_note).toBeNull();
    // Two steps need a model and they ask for different strengths, which is the
    // sentence that justifies the whole per-step design.
    expect(settings.in_force).toContain("different");
  });

  it("keeps the step controls visible and says they are set aside when a model is named", async () => {
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);
    writeAgentModelChoice(AGENT, "openrouter", "anthropic/claude-sonnet-5", AT);

    const settings = buildAgentModelSettings(AGENT, source);
    if (!settings.can_choose) {
      throw new Error("expected a choice");
    }
    expect(settings.chosen_model_id).toBe("anthropic/claude-sonnet-5");
    expect(settings.steps_in_force).toBe(false);
    expect(settings.steps_note).toBe(
      describeStepsNotInForce("anthropic/claude-sonnet-5"),
    );
    // Hiding a setting that still exists is how somebody comes back in a month
    // to an agent behaving in a way the page does not explain.
    expect(settings.steps).toHaveLength(2);
  });

  it("marks a step the person changed, and leaves the plan's own answer readable", async () => {
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);
    writeStepLevelOverride(AGENT, 2, "frontier", AT);

    const settings = buildAgentModelSettings(AGENT, source);
    const changed = settings.steps.find((entry) => entry.step === 2);
    expect(changed).toMatchObject({ level: "frontier", declared: "cheap", overridden: true });
  });

  it("drops an override for a step the manifest no longer has", () => {
    writeStepLevelOverride(AGENT, 9, "frontier", AT);
    const settings = buildAgentModelSettings(AGENT, manifestWith(MIXED_ROUTE));
    expect(settings.steps.map((entry) => entry.step)).toEqual([2, 3]);
  });

  it("does not report an override when the person picked what the plan already said", () => {
    // `overridden` drives a chip that says "you changed this". A row that agrees
    // with the manifest is not a change, and drawing one would put a chip on a
    // step nobody touched the meaning of.
    writeStepLevelOverride(AGENT, 2, "cheap", AT);
    const settings = buildAgentModelSettings(AGENT, manifestWith(MIXED_ROUTE));
    expect(settings.steps.find((entry) => entry.step === 2)?.overridden).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * The model list, which is never stored
 * ---------------------------------------------------------------------- */

describe("asking a provider which models a key can reach", () => {
  it("returns the ids and writes none of them anywhere", async () => {
    const source = manifestWith(MIXED_ROUTE);
    const store = vault();
    await connectKey(store, source);

    const resolution = resolveCredentialTarget(AGENT, source, "models", "key");
    if (!resolution.ok) {
      throw new Error("expected a target");
    }

    /*
     * Ids nothing else in this file ever chooses or reports. The store-file
     * search below would otherwise find a *stored choice* — which is a row DASH
     * is supposed to have — and read it as a leaked catalogue.
     */
    const ai = scriptedAi({
      status: 200,
      model_count: 2,
      model_ids: ["listedonly/alpha-catalogue", "listedonly/beta-catalogue"],
    });
    const listed = await listAiKeyModels(resolution.target, "this computer's vault", {
      store,
      promptForSecret: () => Promise.resolve(null),
      ai,
      now: () => new Date(AT),
    });

    expect(listed.ok).toBe(true);
    expect(listed.models).toEqual(["listedonly/alpha-catalogue", "listedonly/beta-catalogue"]);
    // It asked for them. The narrow direction is asserted below.
    expect(ai.wantedIds).toEqual([true]);

    /*
     * The load-bearing assertion of this file. Which models a key can reach is
     * the provider's own content (ADR 0002 invariant 7), and `lib/db.ts` refuses
     * a durable table of them in as many words. This searches the whole store
     * file, so a future column, a JSON blob or a cache would all fail it.
     */
    const bytes = readStoreBytes(dataDir);
    expect(bytes).not.toContain("alpha-catalogue");
    expect(bytes).not.toContain("beta-catalogue");
    expect(bytes).not.toContain(KEY);
  });

  it("does not ask for the catalogue when it is only checking the key", async () => {
    // The narrow direction. A liveness check must not come back carrying a
    // provider's list, because the record it feeds has nowhere to put one and a
    // caller that received one might.
    const source = manifestWith(MIXED_ROUTE);
    const store = vault();
    const ai = scriptedAi();
    await performConnectionAction("test", TARGET, {
      store,
      readManifest: () => source,
      promptForSecret: () => Promise.resolve(null),
      oauth: refusingOAuth(),
      ai,
    });
    expect(ai.wantedIds).toEqual([false]);
  });

  it("records the same liveness observation a check would", async () => {
    const source = manifestWith(MIXED_ROUTE);
    const store = vault();
    await connectKey(store, source);

    const resolution = resolveCredentialTarget(AGENT, source, "models", "key");
    if (!resolution.ok) {
      throw new Error("expected a target");
    }
    await listAiKeyModels(resolution.target, "this computer's vault", {
      store,
      promptForSecret: () => Promise.resolve(null),
      ai: scriptedAi({ status: 401, model_count: null }),
      now: () => new Date(LATER),
    });

    const { readLivenessCheck } = await import("../lib/ai/store");
    // A person who pressed this and was told the key was refused has performed a
    // check. The card beside it must not go on reporting an older verdict
    // because the button had a different label.
    expect(readLivenessCheck(AGENT, "models")).toMatchObject({
      state: "key_refused",
      checked_at: LATER,
    });
  });

  it("keeps the catalogue off the durable record even when one comes back", () => {
    // The seam, directly: `classifyProbe` takes an outcome carrying ids and
    // produces a record that has no field for them.
    const record = classifyProbe(
      { status: 200, model_count: 2, model_ids: ["a-model", "b-model"] },
      AT,
    );
    expect(record).toEqual({ state: "live", checked_at: AT, model_count: 2 });
    expect(JSON.stringify(record)).not.toContain("a-model");
  });

  it("reports a provider that named nothing as an answer, not as a success", async () => {
    const source = manifestWith(MIXED_ROUTE);
    const store = vault();
    await connectKey(store, source);

    const resolution = resolveCredentialTarget(AGENT, source, "models", "key");
    if (!resolution.ok) {
      throw new Error("expected a target");
    }
    const listed = await listAiKeyModels(resolution.target, "this computer's vault", {
      store,
      promptForSecret: () => Promise.resolve(null),
      ai: scriptedAi({ status: 200, model_count: 0, model_ids: [] }),
      now: () => new Date(AT),
    });
    expect(listed.ok).toBe(false);
    expect(listed.models).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * The run record
 * ---------------------------------------------------------------------- */

describe("what a run records about its model", () => {
  it("records the setting in force when the run was first seen", () => {
    writeAgentModelChoice(AGENT, "openrouter", "anthropic/claude-sonnet-5", AT);
    expect(ingestEvents([event("run-a", 0)]).accepted).toBe(1);

    expect(readRunModel(AGENT, "run-a")).toMatchObject({
      choice: { kind: "one_model", model_id: "anthropic/claude-sonnet-5" },
    });
  });

  it("never revises a run that has already started", () => {
    /*
     * The whole correctness of the row. Somebody who changes an agent's model
     * halfway through a run must not thereby change what that run reports it
     * started under — `runs.first_seen_at` is written in the same transaction
     * with the same meaning.
     */
    expect(ingestEvents([event("run-b", 0)]).accepted).toBe(1);
    writeAgentModelChoice(AGENT, "openrouter", "anthropic/claude-sonnet-5", LATER);
    expect(ingestEvents([event("run-b", 1)]).accepted).toBe(1);

    expect(readRunModel(AGENT, "run-b")).toMatchObject({ choice: { kind: "match_each_step" } });
  });

  it("says nothing at all for an agent whose plan needs no model", () => {
    expect(ingestEvents([event("run-c", 0)]).accepted).toBe(1);
    // The row exists — the write path records one for every run, deliberately —
    // and the read side is what draws the line, because it has the manifest open.
    expect(readRunModel(AGENT, "run-c")).not.toBeNull();
    expect(buildRunModel(AGENT, "run-c", [step(1, "none")] as never)).toBeNull();
  });

  it("says which model DASH was set to give it, and whose fact that is", () => {
    writeAgentModelChoice(AGENT, "openrouter", "anthropic/claude-sonnet-5", AT);
    expect(ingestEvents([event("run-d", 0)]).accepted).toBe(1);

    const view = buildRunModel(AGENT, "run-d", MIXED_ROUTE as never);
    expect(view?.label).toBe("anthropic/claude-sonnet-5");
    // The caveat that makes the label honest: DASH makes no completion call, so
    // it has never observed a model doing an agent's work.
    expect(view?.detail).toContain("does not sit between");
    expect(view?.detail).toContain("DASH's record of the setting");
  });

  it("prefers what the run itself reported, attributed to the run", () => {
    /*
     * `model` has been in telemetry v1 since the contract was frozen and nothing
     * in DASH had ever drawn it. It is the better answer to "which model ran" —
     * it comes from inside the process that ran it — and it is still the agent's
     * claim rather than something DASH watched, so the sentence says so.
     */
    writeAgentModelChoice(AGENT, "openrouter", "anthropic/claude-sonnet-5", AT);
    expect(ingestEvents([event("run-h", 0, "openai/gpt-5-mini")]).accepted).toBe(1);

    const view = buildRunModel(
      AGENT,
      "run-h",
      MIXED_ROUTE as never,
      reported("openai/gpt-5-mini"),
    );
    expect(view?.label).toBe("openai/gpt-5-mini");
    expect(view?.detail).toContain("the agent's own account");
    // And the disagreement is reported rather than resolved silently. A run that
    // used a model DASH was not set to give it is exactly the interesting case.
    expect(view?.detail).toContain("do not agree");
  });

  it("counts distinct models when a run used more than one", () => {
    const view = buildRunModel(
      AGENT,
      "run-i",
      MIXED_ROUTE as never,
      reported("vendorone/small-model", "vendortwo/large-model", "vendorone/small-model"),
    );
    expect(view?.label).toBe("2 models");
  });

  it("ignores a reported model id it would not be willing to write down", () => {
    // It crosses the ingest boundary from a process DASH does not control, and
    // the event schema types the field without constraining its shape. The run
    // falls back to DASH's own setting rather than repeating what it was sent.
    expect(ingestEvents([event("run-j", 0)]).accepted).toBe(1);
    const view = buildRunModel(AGENT, "run-j", MIXED_ROUTE as never, reported("../../etc/passwd"));
    expect(view?.label).toBe("Matched to each step");
    expect(JSON.stringify(view)).not.toContain("passwd");
  });

  it("has no cost, in the column list or in the sentence", () => {
    writeAgentModelChoice(AGENT, "openrouter", "anthropic/claude-sonnet-5", AT);
    expect(ingestEvents([event("run-e", 0)]).accepted).toBe(1);

    /*
     * Pinned by value, `broker_lapses`' shape: no row in this table can be
     * mistaken for a bill by a careless join or a future renderer, because there
     * is no column for one. MAR-299 adds spend when it has numbers that came
     * from a provider.
     */
    const columns = (
      db().prepare("PRAGMA table_info(run_models)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(columns).toEqual([
      "agent",
      "run_id",
      "choice",
      "provider_id",
      "model_id",
      "recorded_at",
    ]);

    /*
     * And no figure in the sentence. Not "no digits" — a model's own name has
     * them, and `claude-sonnet-5` is content DASH is repeating rather than a
     * number DASH produced. What is forbidden is an *amount*: a currency, a
     * decimal, a rate.
     */
    const view = buildRunModel(AGENT, "run-e", MIXED_ROUTE as never);
    const said = `${view?.label ?? ""} ${view?.detail ?? ""}`.toLowerCase();
    expect(said).not.toMatch(/[$€£]|\d+\.\d|per token|cent|usd/);
  });

  it("reads every run's setting in one pass, for the runs list", () => {
    expect(ingestEvents([event("run-f", 0), event("run-g", 0)]).accepted).toBe(2);
    const all = readRunModels();
    expect(all.get(`${AGENT} run-f`)).not.toBeUndefined();
    expect(all.get(`${AGENT} run-g`)).not.toBeUndefined();
  });

  it("says nothing for a run DASH has no record of and that reported nothing", () => {
    expect(describeRunModel({ setting: null, reported: [] })).toBeNull();
    expect(describeRunModelDetail({ setting: null, reported: [] })).toBeNull();
  });

  it("still reads telemetry v1's cost field nowhere in the model surface", () => {
    /*
     * **This test used to say "nowhere", and MAR-545 changed what it guards
     * rather than deleting it.**
     *
     * `cost_usd` sits beside `model` on the same frozen event. MAR-583 drew
     * `model` and left this one alone with the condition written down: MAR-299
     * owns spend and needed an answer to "whose number is this" before any
     * surface repeated one. MAR-545 answered it — DASH shows amounts other
     * people stated and says who — and `lib/views/ask.ts` is the one reader,
     * where the sentence beside the figure attributes it to the agent.
     *
     * What survives unchanged is the narrower thing this file has always been
     * about: the *model* surface says which model ran and never what it cost.
     * A run row that grew an amount because the field happened to be adjacent is
     * still exactly the defect the original assertion was written against, and
     * it would still fail here.
     */
    const read = readFileSync(path.join(repoRoot, "lib", "views", "models.ts"), "utf8");
    expect(read).not.toContain("cost_usd");
    expect(readFileSync(path.join(repoRoot, "lib", "ai", "model-choice.ts"), "utf8")).not.toContain(
      "tokens_in",
    );
  });

  it("names every file whose code touches the cost field", () => {
    /*
     * The complement of the assertion above, and the reason it is safe to have
     * relaxed one. "Nothing reads it" was a strong guarantee and this is the
     * strongest available replacement: the files whose *code* touches the field
     * are listed here, and a new one is a diff somebody has to make against this
     * test. An unattributed amount on a screen is the failure both versions of
     * this test exist to prevent.
     *
     * Comments are stripped before the scan, which is not a convenience. Three
     * files in this repository discuss `cost_usd` at length precisely because
     * they decided not to read it, and a grep over raw text would report those
     * as readers — turning a guard about behaviour into a guard about how often
     * a decision is explained.
     */
    const withoutComments = (source: string): string =>
      source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*/g, "");

    const readers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) {
          continue;
        }
        if (withoutComments(readFileSync(full, "utf8")).includes("cost_usd")) {
          readers.push(path.relative(repoRoot, full).replaceAll("\\", "/"));
        }
      }
    };
    for (const root of ["lib", "app", "electron"]) {
      walk(path.join(repoRoot, root));
    }

    expect(readers.sort()).toEqual(
      [
        // The contract's own type. Declaring the field is not reading it.
        "lib/contracts.ts",
        // A provider's own statement of what it charged, projected at the
        // broker boundary and carried in DASH's own shape. Both are about a
        // question DASH asked, not about a run.
        "lib/broker/operations.ts",
        "lib/ai/ask.ts",
        // The one reader of the field on a run event, which attributes the
        // total to the agent in the sentence beside it.
        "lib/views/ask.ts",
        // The agent page's performance panel (MAR-635). Same field, same
        // attribution rule: a cost meter is omitted when the run never
        // posted one, and when it did the panel says the agent reported it.
        "lib/views/agent-feed.ts",
        // Not a reader: a capture harness that *seeds* two run events carrying
        // one, so the sentence attributing the agent's own figure is actually in
        // the photographs. Named here rather than excluded by a path rule,
        // because "which files touch this" is the question, and a rule that
        // skipped `electron/capture-*` would skip a real writer too.
        "electron/capture-ask.ts",
        // The same, for the cockpit's own scene (MAR-646). It seeds one run of
        // telemetry so the Run stage has meters rather than its empty arm, and
        // the cost meter is the one that carries `AGENT_TELEMETRY_COPY.cost_note`
        // — so a frame of that stage is also a frame of the attribution.
        "electron/capture-cockpit.ts",
      ].sort(),
    );

    // And the attribution itself, so the list above cannot be satisfied by a
    // reader that shows the number without saying whose it is.
    expect(readFileSync(path.join(repoRoot, "lib", "copy", "ask.ts"), "utf8")).toContain(
      "not something DASH watched",
    );
  });
});

/* ---------------------------------------------------------------------- *
 * What travels to a server
 * ---------------------------------------------------------------------- */

describe("the choice in a deploy bundle", () => {
  it("carries the setting and no credential", () => {
    const steps = resolveModelSteps(
      [
        { step: 2, component_id: "component-2", level: "cheap" },
        { step: 3, component_id: "component-3", level: "frontier" },
      ],
      new Map([[2, "standard" as const]]),
    );
    const document = bundledModelChoice(
      AGENT,
      { kind: "one_model", provider_id: "openrouter", model_id: "anthropic/claude-sonnet-5" },
      steps,
      // MAR-654. The person's level map, frozen for the reason the levels are:
      // the far side has the manifest and could recompute a level, and has
      // nothing at all that could recompute a person's map.
      new Map([["frontier", { provider_id: "openrouter", model_id: "mapped/frontier" }]]),
    );

    expect(document).toEqual({
      agent_id: AGENT,
      choice: "one_model",
      provider_id: "openrouter",
      model_id: "anthropic/claude-sonnet-5",
      // The person's override is frozen in, not the manifest's own answer: the
      // manifest travels in the same bundle and does not know about it.
      steps: [
        { step: 2, level: "standard" },
        { step: 3, level: "frontier" },
      ],
      level_models: [
        { level: "frontier", provider_id: "openrouter", model_id: "mapped/frontier" },
      ],
    });
    // There is no field a key could go in, and this says so over the serialised
    // document rather than over the type.
    expect(JSON.stringify(document)).not.toContain(KEY);
    expect(Object.keys(document)).not.toContain("key");
  });

  it("records matching each step as a decision, with the levels that were in force", () => {
    const document = bundledModelChoice(
      AGENT,
      matchEachStep(),
      resolveModelSteps([{ step: 2, component_id: "component-2", level: "cheap" }], new Map()),
    );
    expect(document).toMatchObject({
      choice: "match_each_step",
      provider_id: null,
      model_id: null,
      steps: [{ step: 2, level: "cheap" }],
    });
  });
});

/* ---------------------------------------------------------------------- *
 * DASH's own default (MAR-642)
 * ---------------------------------------------------------------------- */

/**
 * The fallback, and the three ways it is not allowed to reach an agent.
 *
 * Henrik's 2026-08-15 ruling has one sentence that has to be mechanically true
 * rather than merely intended — *it never overrides an explicit per-agent
 * choice* — so the first test here is the one that would fail if somebody ever
 * "simplified" the precedence in `applyFleetDefault`.
 *
 * The second rule is the one nobody asked for and that a wrong implementation
 * would ship silently: a default naming OpenRouter must not answer for an agent
 * whose plan reaches Anthropic. Nothing on screen would look wrong; the request
 * would carry a model id that provider never published, and the person would
 * read the refusal as their key being broken.
 */
describe("the model DASH falls back to", () => {
  beforeEach(() => {
    clearFleetModelDefault();
  });

  it("is absent until somebody sets one, with no row to say so", () => {
    expect(readFleetModelDefault()).toBeNull();
    const rows = db().prepare("SELECT count(*) AS n FROM fleet_model_default").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("goes back to absent by losing its row, not by storing an empty one", () => {
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    expect(readFleetModelDefault()).toEqual({
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
    });

    clearFleetModelDefault();
    expect(readFleetModelDefault()).toBeNull();
    const rows = db().prepare("SELECT count(*) AS n FROM fleet_model_default").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("refuses a provider DASH does not broker and a model id that could become a path", () => {
    // `writeAgentModelChoice`'s two refusals, on the fleet row. The same
    // predicates, imported rather than restated, so MAR-582's hardening reaches
    // this caller too.
    expect(writeFleetModelDefault("some-other-service", "a-model", AT)).toBe(false);
    expect(writeFleetModelDefault("openrouter", "../../etc/passwd", AT)).toBe(false);
    expect(writeFleetModelDefault("openrouter", "", AT)).toBe(false);
    expect(readFleetModelDefault()).toBeNull();
  });

  it("is one row however many times it is set", () => {
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    expect(writeFleetModelDefault("openrouter", "anthropic/claude-sonnet-5", LATER)).toBe(true);
    const rows = db().prepare("SELECT count(*) AS n FROM fleet_model_default").get() as { n: number };
    expect(rows.n).toBe(1);
    expect(readFleetModelDefault()?.model_id).toBe("anthropic/claude-sonnet-5");
  });

  it("never overrides an agent that has chosen", () => {
    // The ruling, as an assertion. Both rows exist and disagree; the agent's
    // wins, and `resolved_by` says which rung the caller is looking at —
    // MAR-654 replaced the boolean that could only express two of the four.
    expect(writeAgentModelChoice(AGENT, "openrouter", "anthropic/claude-sonnet-5", AT)).toBe(true);
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", LATER)).toBe(true);

    const effective = readEffectiveModelChoice(AGENT, "openrouter");
    expect(effective.choice).toEqual({
      kind: "one_model",
      provider_id: "openrouter",
      model_id: "anthropic/claude-sonnet-5",
    });
    expect(effective.resolved_by).toBe("agent_pin");
  });

  it("answers for an agent that has chosen nothing", () => {
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    const effective = readEffectiveModelChoice(AGENT, "openrouter");
    expect(effective.choice).toEqual({
      kind: "one_model",
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
    });
    expect(effective.resolved_by).toBe("fleet_default");
  });

  it("does not answer for an agent whose plan reaches another provider", () => {
    // The failure this prevents is invisible on screen: an OpenRouter model id
    // in a request bound for Anthropic, refused by the provider, read by the
    // person as their key being broken.
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    expect(readEffectiveModelChoice(AGENT, "anthropic").choice).toEqual({
      kind: "match_each_step",
    });
    // And not for a caller that does not know which provider this agent uses.
    // An unknown provider is not a match: DASH does not guess which account
    // gets billed.
    expect(readEffectiveModelChoice(AGENT, null).choice).toEqual({ kind: "match_each_step" });
  });

  it("writes nothing to any agent when it is set", () => {
    // The mechanical half of the ruling: there is no code path from setting a
    // default to a row in `agent_model_choice`, so nobody's pinned agent can be
    // changed by this control.
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    const rows = db().prepare("SELECT count(*) AS n FROM agent_model_choice").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("puts an agent back where it was when the default is cleared", () => {
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    expect(readEffectiveModelChoice(AGENT, "openrouter").resolved_by).toBe("fleet_default");

    clearFleetModelDefault();
    expect(readEffectiveModelChoice(AGENT, "openrouter").choice).toEqual({
      kind: "match_each_step",
    });
  });

  it("reads a default naming a dropped provider as no default at all", () => {
    // `readAgentModelChoice`'s rule one level up: a record this build cannot
    // interpret reads as the absence of a record, which a person can act on,
    // rather than as a value every reader downstream needs a branch for.
    db()
      .prepare(
        "INSERT INTO fleet_model_default (id, provider_id, model_id, chosen_at) VALUES (1, ?, ?, ?)",
      )
      .run("some-other-service", "a-model", AT);
    expect(readFleetModelDefault()).toBeNull();
  });

  it("shows the agent page a model in force that the agent has not chosen", async () => {
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);

    const settings = buildAgentModelSettings(AGENT, source);
    expect(settings.can_choose).toBe(true);
    if (!settings.can_choose) {
      return;
    }
    // The picker still shows nothing pinned — the agent chose nothing — and the
    // sentence beside it names the model that will run and says whose decision
    // it was. Those are two different facts and the view carries both.
    expect(settings.chosen_model_id).toBeNull();
    expect(settings.from_default).toBe(true);
    expect(settings.in_force).toContain("openai/gpt-5-mini");
    // And the option that means "leave this alone" no longer promises per-step
    // matching, because leaving it alone now means the default.
    expect(settings.unpinned_option).toContain("openai/gpt-5-mini");
  });

  it("records the default on a run of an agent that has chosen nothing", () => {
    // `run_models` records DASH's own setting at the moment it first saw the
    // run. With a default in force that setting *is* the default, and a row
    // saying "matched each step" would be a record of something that did not
    // happen.
    //
    // The manifest has to be **in the store** rather than handed in, because
    // this is the one caller that has nothing to hand it: `receiveEvents` reads
    // it back through `readAgentManifest`, and only when a default exists.
    importManifest(storedManifest());
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    ingestEvents([event("run-default", 0)] as never);

    expect(readRunModel(AGENT, "run-default")?.choice).toEqual({
      kind: "one_model",
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
    });
  });

  it("records matching each step when DASH cannot tell which provider an agent uses", () => {
    // The limit, stated rather than hidden. An agent DASH holds no manifest for
    // has no provider to match a default against, and inventing one would put a
    // model id in a run record that nothing ever sent. No manifest is imported
    // here, deliberately.
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    ingestEvents([event("run-unknown", 0)] as never);

    expect(readRunModel(AGENT, "run-unknown")?.choice).toEqual({ kind: "match_each_step" });
  });
});

/* ---------------------------------------------------------------------- *
 * The ladder (MAR-654, ADR 0011 amendment 1)
 * ---------------------------------------------------------------------- */

/**
 * A person may map a level to a model, and DASH still maps none.
 *
 * The amendment's own list of what is provable once built, in order:
 *
 * 1. **the ladder, as a pure test over the four rules and the four
 *    `resolved_by` values, including the negative** — an agent whose plan
 *    declares no level for a step cannot reach a level row;
 * 2. that `match_each_step` resolves rather than refusing, with every state that
 *    existed before this amendment behaving identically;
 * 3. that the run record freezes the resolution per step and never revises it.
 *
 * The fourth — a lying `step` reaching only a level that agent's own plan
 * declares — is `tests/broker-threat-model.test.ts`, where the seam is.
 */
describe("what each level means", () => {
  const OPENROUTER = { provider_id: "openrouter", model_id: "openai/gpt-5-mini" };

  beforeEach(() => {
    clearFleetModelDefault();
    for (const level of ["cheap", "standard", "frontier"]) {
      clearFleetLevelModel("openrouter", level);
      clearFleetLevelModel("anthropic", level);
    }
  });

  it("is absent until somebody writes a row, and clearing deletes rather than storing", () => {
    // Zero rows ship and none is ever seeded, which is what makes this
    // amendment safe to land: no existing DASH changes behaviour until a person
    // writes a row.
    expect(readFleetLevelModels("openrouter").size).toBe(0);
    expect(hasFleetLevelModels()).toBe(false);

    expect(writeFleetLevelModel("openrouter", "standard", "openai/gpt-5-mini", AT)).toBe(true);
    expect(hasFleetLevelModels()).toBe(true);
    expect(readFleetLevelModels("openrouter").get("standard")).toEqual(OPENROUTER);

    clearFleetLevelModel("openrouter", "standard");
    expect(readFleetLevelModels("openrouter").size).toBe(0);
    const rows = db().prepare("SELECT count(*) AS n FROM fleet_level_models").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("refuses a provider DASH does not broker, a level it does not know, and a bad id", () => {
    // `writeFleetModelDefault`'s three refusals, on the row one level down. The
    // same predicates, imported rather than restated.
    expect(writeFleetLevelModel("some-other-service", "standard", "a-model", AT)).toBe(false);
    expect(writeFleetLevelModel("openrouter", "enormous", "a-model", AT)).toBe(false);
    expect(writeFleetLevelModel("openrouter", "standard", "../../etc/passwd", AT)).toBe(false);
    expect(readFleetLevelModels("openrouter").size).toBe(0);
  });

  it("answers all four rungs, and each one names itself", () => {
    const levelModels: LevelModelMap = new Map([
      ["standard", { provider_id: "openrouter", model_id: "mapped/model" }],
    ]);
    const unpinned = matchEachStep();
    const pinned = {
      kind: "one_model" as const,
      provider_id: "openrouter",
      model_id: "pinned/model",
    };
    const ladder = (level: "cheap" | "standard" | "frontier" | null) => ({
      level,
      level_models: levelModels,
    });

    // 1. The agent's own pin wins, whatever anything else says, and it is first
    //    so it cannot be reached around.
    expect(applyFleetDefault(pinned, OPENROUTER, "openrouter", ladder("standard"))).toEqual({
      choice: pinned,
      resolved_by: "agent_pin",
    });

    // 2. The person's row for this step's level, above the default.
    expect(applyFleetDefault(unpinned, OPENROUTER, "openrouter", ladder("standard"))).toEqual({
      choice: { kind: "one_model", provider_id: "openrouter", model_id: "mapped/model" },
      resolved_by: "level_map",
    });

    // 3. A level with no row falls to the default, and is not silent about it.
    expect(applyFleetDefault(unpinned, OPENROUTER, "openrouter", ladder("cheap"))).toEqual({
      choice: { kind: "one_model", ...OPENROUTER },
      resolved_by: "fleet_default",
    });

    // 4. Nothing. `no_model_chosen`, now reachable per step.
    expect(applyFleetDefault(unpinned, null, "openrouter", ladder("frontier"))).toEqual({
      choice: unpinned,
      resolved_by: "none",
    });
  });

  it("cannot be reached by a step whose plan declares no level", () => {
    // The negative the amendment names. A null level is a step that needs no
    // model, a step the manifest does not have, and a request that named no step
    // at all — three different facts, all of which resolve the same way: past
    // rule 2 entirely, to the default and then to nothing.
    const levelModels: LevelModelMap = new Map([
      ["standard", { provider_id: "openrouter", model_id: "mapped/model" }],
    ]);
    expect(
      applyFleetDefault(matchEachStep(), OPENROUTER, "openrouter", {
        level: null,
        level_models: levelModels,
      }),
    ).toEqual({ choice: { kind: "one_model", ...OPENROUTER }, resolved_by: "fleet_default" });

    // And with no default either, a step with no level reaches no model at all.
    expect(
      applyFleetDefault(matchEachStep(), null, "openrouter", {
        level: null,
        level_models: levelModels,
      }).resolved_by,
    ).toBe("none");
  });

  it("does not answer for an agent whose plan reaches another provider", () => {
    // `applyFleetDefault` rule 2's established reason, applied to the new rung:
    // a model id means nothing without a provider, and `openai/gpt-5-mini`
    // presented to Anthropic would be DASH asking for something never offered.
    const levelModels: LevelModelMap = new Map([
      ["standard", { provider_id: "openrouter", model_id: "mapped/model" }],
    ]);
    const answer = applyFleetDefault(matchEachStep(), null, "anthropic", {
      level: "standard",
      level_models: levelModels,
    });
    expect(answer).toEqual({ choice: { kind: "match_each_step" }, resolved_by: "none" });
  });

  it("resolves each step through the ladder instead of refusing", () => {
    // A1.3's table, as one assertion. `match_each_step` used to be the state
    // every fresh agent sat in and the one state under which nothing could
    // spend; the name promised per-step matching and the behaviour delivered a
    // refusal. This is the promise being kept.
    const steps = resolveModelSteps(
      [
        { step: 2, component_id: "digest_curate", level: "cheap" },
        { step: 3, component_id: "deep_dive_synthesis", level: "standard" },
      ],
      new Map(),
    );
    const resolutions = resolveStepModels(
      steps,
      matchEachStep(),
      { provider_id: "openrouter", model_id: "meta-llama/llama-3.3-70b-instruct:free" },
      "openrouter",
      new Map<DefaultModelLevel, FleetModelDefault>([
        ["standard", { provider_id: "openrouter", model_id: "mapped/model" }],
      ]),
    );
    // The scout, worked through: the extraction step keeps the free model and
    // the synthesis step gets the one its author said that step needs.
    expect(resolutions).toEqual([
      {
        step: 2,
        component_id: "digest_curate",
        level: "cheap",
        provider_id: "openrouter",
        model_id: "meta-llama/llama-3.3-70b-instruct:free",
        resolved_by: "fleet_default",
      },
      {
        step: 3,
        component_id: "deep_dive_synthesis",
        level: "standard",
        provider_id: "openrouter",
        model_id: "mapped/model",
        resolved_by: "level_map",
      },
    ]);
  });

  it("records a run's per-step resolution once, and never revises it", async () => {
    // A1.5. `run_models` records `matched` with a provider and no model id,
    // because "the setting was a table" is not a model id — and the models are
    // the `run_step_models` rows beside it, written in the same transaction.
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);
    importManifest(storedManifest());
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    expect(writeFleetLevelModel("openrouter", "frontier", "mapped/frontier", AT)).toBe(true);

    ingestEvents([event("run-matched", 0)] as never);

    const record = readRunModel(AGENT, "run-matched");
    expect(record?.choice).toEqual({
      kind: "matched",
      provider_id: "openrouter",
      steps: [
        {
          step: 2,
          level: "cheap",
          provider_id: "openrouter",
          model_id: "openai/gpt-5-mini",
          resolved_by: "fleet_default",
        },
        {
          step: 3,
          level: "frontier",
          provider_id: "openrouter",
          model_id: "mapped/frontier",
          resolved_by: "level_map",
        },
      ],
    });

    // `run_models`' write-once rule, extended to the rows beside it: somebody
    // changing what a level means halfway through a run must not thereby change
    // what an already-started run reports it began under.
    expect(writeFleetLevelModel("openrouter", "frontier", "changed/frontier", LATER)).toBe(true);
    ingestEvents([event("run-matched", 1)] as never);
    const again = readRunModel(AGENT, "run-matched");
    expect(again?.choice.kind === "matched" && again.choice.steps[1]?.model_id).toBe(
      "mapped/frontier",
    );
  });

  it("leaves every state that existed before it exactly as it was", async () => {
    // A1.3's compatibility table, mechanically. The two rows that matter are the
    // ones a person could already be in: a default set with an empty map still
    // records one model, and no default with an empty map still records nothing.
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);
    importManifest(storedManifest());

    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    ingestEvents([event("run-empty-map", 0)] as never);
    expect(readRunModel(AGENT, "run-empty-map")?.choice).toEqual({
      kind: "one_model",
      provider_id: "openrouter",
      model_id: "openai/gpt-5-mini",
    });
    const stepRows = db()
      .prepare("SELECT count(*) AS n FROM run_step_models WHERE run_id = 'run-empty-map'")
      .get() as { n: number };
    expect(stepRows.n).toBe(0);

    clearFleetModelDefault();
    ingestEvents([event("run-nothing-set", 0)] as never);
    expect(readRunModel(AGENT, "run-nothing-set")?.choice).toEqual({ kind: "match_each_step" });
  });

  it("says on the agent's page what each step resolves to, and stops greying the control", async () => {
    // A1.6, and the defect it closes. The control Henrik found greyed was greyed
    // because DASH's default set the levels aside; a level now beats the
    // default, so an unpinned agent's levels decide something and are live.
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);
    expect(writeFleetModelDefault("openrouter", "openai/gpt-5-mini", AT)).toBe(true);
    expect(writeFleetLevelModel("openrouter", "frontier", "mapped/frontier", AT)).toBe(true);

    const settings = buildAgentModelSettings(AGENT, source);
    expect(settings.can_choose).toBe(true);
    if (!settings.can_choose) {
      return;
    }
    expect(settings.steps_in_force).toBe(true);
    expect(settings.steps_note).toBeNull();
    expect(settings.steps.map((one) => one.resolved_model_id)).toEqual([
      "openai/gpt-5-mini",
      "mapped/frontier",
    ]);
    expect(settings.steps.map((one) => one.resolved_by)).toEqual(["fleet_default", "level_map"]);
    // Two models across the steps, so the one sentence at the top says so rather
    // than naming one of them as though it answered both.
    expect(settings.in_force).toContain("2 models");
    // And it says where a level becomes a model, because the map is one place
    // and every step that depends on it has to name it.
    expect(settings.steps_link_label).toBe(LEVEL_MAP_LINK_LABEL);
  });

  it("still greys the control for an agent pinned to one model", async () => {
    // The one reason left, and the sentence under it now names only that reason.
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);
    expect(writeAgentModelChoice(AGENT, "openrouter", "pinned/model", AT)).toBe(true);

    const settings = buildAgentModelSettings(AGENT, source);
    expect(settings.can_choose).toBe(true);
    if (!settings.can_choose) {
      return;
    }
    expect(settings.steps_in_force).toBe(false);
    expect(settings.steps_note).toBe(describeStepsNotInForce("pinned/model"));
    expect(settings.steps.every((one) => one.resolved_by === "agent_pin")).toBe(true);
    clearAgentModelChoice(AGENT);
  });

  it("keeps no list of models anywhere, still", async () => {
    // ADR 0011's standing constraint, re-asserted over the new table: this
    // amendment adds a place a *chosen* model id lives and no place a catalogue
    // could. The store is searched for an id the fake provider offers that
    // nobody chose.
    const source = manifestWith(MIXED_ROUTE);
    await connectKey(vault(), source);
    expect(writeFleetLevelModel("openrouter", "cheap", "openai/gpt-5-mini", AT)).toBe(true);

    const bytes = readStoreBytes(dataDir);
    expect(bytes).toContain("openai/gpt-5-mini");
    // Offered by the fake catalogue and chosen by nobody: it must not be in the
    // store, because DASH keeps no copy of what a key can reach.
    expect(bytes).not.toContain("moonshotai/kimi-k2");
  });
});

/* ---------------------------------------------------------------------- *
 * The copy
 * ---------------------------------------------------------------------- */

describe("what a person reads", () => {
  it("is plain language on every branch", () => {
    expectPlainLanguage(everyModelChoiceSentence(), {
      // The refusal names what DASH does with a key; "this computer's vault" is
      // content rather than vocabulary.
      allow: [MODEL_KEY_STAYS_HOME_REFUSAL],
    });
  });

  it("never says what anything costs", () => {
    const said = [...everyModelChoiceSentence(), MODEL_KEY_STAYS_HOME_REFUSAL]
      .join(" ")
      .toLowerCase();
    for (const forbidden of ["$", "€", "cent", "per token", "usd", "dollar", "estimate"]) {
      expect(said).not.toContain(forbidden);
    }
  });
});
