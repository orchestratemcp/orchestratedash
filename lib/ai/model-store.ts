/**
 * Reading and writing which model an agent uses (MAR-583).
 *
 * The impure half of `lib/ai/model-choice.ts`, in `lib/ai/store.ts`'s shape: it
 * stores decisions that module already made and reads them back for whoever is
 * drawing a control. No policy lives here. A function in this file that decided
 * what a missing row *meant* would be a second authority beside
 * `matchEachStep()`, free to drift from it.
 *
 * ## Absence is the default, everywhere
 *
 * There is no row for an agent nobody has configured, no row for a step nobody
 * has overridden, and reading either returns the recommended answer rather than
 * an absence a caller has to interpret. Choosing the default *back* deletes the
 * row rather than writing the default into it — a stored copy of a manifest's
 * own answer would go stale the moment its author published a new one, which is
 * the trap `agent_step_levels`' own note in `lib/db.ts` describes.
 *
 * ## A model id is provider content
 *
 * It arrives from a provider's catalogue and travels through a renderer, so it
 * is checked with `isModelId` on the way in — the same predicate the broker's
 * models-list projection uses, imported rather than restated. ADR 0002 invariant
 * 7, and MAR-582's own note about the draft that accepted a path traversal.
 */

import type { DatabaseSync } from "node:sqlite";

import { isModelId } from "../broker/operations";
import {
  describeFleetDefaultCleared,
  describeFleetDefaultSet,
  describeLevelModelCleared,
  describeLevelModelSet,
  describeModelPinned,
  describeModelUnpinned,
} from "../copy/decisions";
import { db } from "../db";
import { fileDecision } from "../fleet/decisions-store";
import { aiProviderById } from "./providers";
import {
  applyFleetDefault,
  matchEachStep,
  type AgentModelChoice,
  type EffectiveModelChoice,
  type FleetModelDefault,
  type LevelModelMap,
  type ModelResolvedBy,
  type RunModelRecord,
  type RunModelSetting,
  type RunStepModel,
} from "./model-choice";
import { isDefaultModelLevel, levelLabel, type DefaultModelLevel } from "./model-levels";

/* ---------------------------------------------------------------------- *
 * One agent's choice
 * ---------------------------------------------------------------------- */

/**
 * The model named for this agent, or the recommended default.
 *
 * A stored row naming a provider this build no longer has, or a model id that no
 * longer passes, reads as the default. That is `readLivenessCheck`'s rule: a
 * record this build cannot interpret should read as the absence of a record,
 * which a person can act on, rather than as a value every renderer downstream
 * then needs a branch for.
 */
export function readAgentModelChoice(agent: string): AgentModelChoice {
  let row: unknown;
  try {
    row = db()
      .prepare("SELECT provider_id, model_id FROM agent_model_choice WHERE agent = ?")
      .get(agent);
  } catch (error: unknown) {
    console.warn(`[dash] could not read a model choice: ${message(error)}`);
    return matchEachStep();
  }
  if (row === undefined || row === null) {
    return matchEachStep();
  }

  const record = row as Record<string, unknown>;
  const providerId = String(record["provider_id"]);
  const modelId = String(record["model_id"]);
  if (aiProviderById(providerId) === null || !isModelId(modelId)) {
    return matchEachStep();
  }
  return { kind: "one_model", provider_id: providerId, model_id: modelId };
}

/**
 * Name one model for this agent.
 *
 * Returns whether it was stored. False is a refusal and not a failure to report
 * as a fault: it means the provider is not one DASH brokers or the id is not one
 * DASH is willing to write down, and the caller renders a sentence rather than a
 * stack trace.
 */
export function writeAgentModelChoice(
  agent: string,
  providerId: string,
  modelId: string,
  at: string,
): boolean {
  if (aiProviderById(providerId) === null || !isModelId(modelId)) {
    return false;
  }
  // Read before write, so the decision log records transitions and not
  // re-saves: pressing the same choice twice is one decision, not two
  // (ADR 0024 decision 1 — a decision is a change to standing state).
  const before = readAgentModelChoice(agent);
  try {
    db()
      .prepare(
        "INSERT INTO agent_model_choice (agent, provider_id, model_id, chosen_at) " +
          "VALUES (?, ?, ?, ?) " +
          "ON CONFLICT (agent) DO UPDATE SET " +
          "provider_id = excluded.provider_id, model_id = excluded.model_id, " +
          "chosen_at = excluded.chosen_at",
      )
      .run(agent, providerId, modelId, at);
  } catch (error: unknown) {
    console.warn(`[dash] could not record a model choice: ${message(error)}`);
    return false;
  }
  const unchanged =
    before.kind === "one_model" &&
    before.provider_id === providerId &&
    before.model_id === modelId;
  if (!unchanged) {
    fileDecision({
      decided_at: at,
      subject_kind: "agent",
      subject_id: agent,
      kind: "agent_model",
      topic: "",
      summary: describeModelPinned(modelId),
      outcome: { state: "pinned", provider_id: providerId, model_id: modelId },
      decided_by: "person",
      rule: null,
      reason: null,
      receipts: [`agent_model_choice ${agent}`],
    });
  }
  return true;
}

/** Go back to matching each step. Deletes rather than storing the default. */
export function clearAgentModelChoice(agent: string): void {
  try {
    const result = db().prepare("DELETE FROM agent_model_choice WHERE agent = ?").run(agent);
    // Filed only when a row actually went: clearing a pin that was never set
    // is not a transition, and a decision row for it would say something
    // happened that did not.
    if (Number(result.changes) > 0) {
      fileDecision({
        decided_at: new Date().toISOString(),
        subject_kind: "agent",
        subject_id: agent,
        kind: "agent_model",
        topic: "",
        summary: describeModelUnpinned(),
        outcome: { state: "match_each_step" },
        decided_by: "person",
        rule: null,
        reason: null,
        receipts: [`agent_model_choice ${agent}`],
      });
    }
  } catch (error: unknown) {
    console.warn(`[dash] could not clear a model choice: ${message(error)}`);
  }
}

/* ---------------------------------------------------------------------- *
 * The fleet default (MAR-642)
 * ---------------------------------------------------------------------- */

/**
 * DASH's own default model, or null when nobody has set one.
 *
 * Null is the shipped state and every caller treats it as "there is no fallback"
 * rather than as a failure. A row naming a provider this build no longer has, or
 * a model id that no longer passes `isModelId`, reads as null — which is
 * `readAgentModelChoice`'s rule applied one level up: a record this build cannot
 * interpret should read as the absence of a record.
 */
export function readFleetModelDefault(): FleetModelDefault | null {
  let row: unknown;
  try {
    row = db().prepare("SELECT provider_id, model_id FROM fleet_model_default WHERE id = 1").get();
  } catch (error: unknown) {
    console.warn(`[dash] could not read the default model: ${message(error)}`);
    return null;
  }
  if (row === undefined || row === null) {
    return null;
  }

  const record = row as Record<string, unknown>;
  const providerId = String(record["provider_id"]);
  const modelId = String(record["model_id"]);
  if (aiProviderById(providerId) === null || !isModelId(modelId)) {
    return null;
  }
  return { provider_id: providerId, model_id: modelId };
}

/**
 * Name the model DASH falls back to.
 *
 * Returns whether it was stored, in `writeAgentModelChoice`'s shape and for its
 * reason: false is a refusal — a provider DASH does not broker, or an id DASH is
 * not willing to write down — and the caller renders a sentence rather than a
 * fault.
 *
 * **It writes nothing to any agent.** Not one row in `agent_model_choice` is
 * touched, which is the mechanical half of "it never overrides an explicit
 * per-agent choice": there is no code path here that could.
 */
export function writeFleetModelDefault(providerId: string, modelId: string, at: string): boolean {
  if (aiProviderById(providerId) === null || !isModelId(modelId)) {
    return false;
  }
  // `writeAgentModelChoice`'s read-before-write, for its reason: the log
  // records transitions, and re-saving the same default is not one.
  const before = readFleetModelDefault();
  try {
    db()
      .prepare(
        "INSERT INTO fleet_model_default (id, provider_id, model_id, chosen_at) " +
          "VALUES (1, ?, ?, ?) " +
          "ON CONFLICT (id) DO UPDATE SET " +
          "provider_id = excluded.provider_id, model_id = excluded.model_id, " +
          "chosen_at = excluded.chosen_at",
      )
      .run(providerId, modelId, at);
  } catch (error: unknown) {
    console.warn(`[dash] could not record the default model: ${message(error)}`);
    return false;
  }
  if (before === null || before.provider_id !== providerId || before.model_id !== modelId) {
    fileDecision({
      decided_at: at,
      subject_kind: "fleet",
      subject_id: null,
      kind: "fleet_model_default",
      topic: "",
      summary: describeFleetDefaultSet(modelId),
      outcome: { state: "set", provider_id: providerId, model_id: modelId },
      decided_by: "person",
      rule: null,
      reason: null,
      receipts: ["fleet_model_default 1"],
    });
  }
  return true;
}

/**
 * Go back to having no default.
 *
 * Deletes rather than writing an empty row, `clearAgentModelChoice`'s rule: "no
 * default" and "a default nothing can read" would be two states meaning one
 * thing, and only one of them is the state DASH ships in.
 *
 * Agents that were running on it fall back to what they were on before it
 * existed — each step at the level its plan asked for — and agents that chose
 * their own model are, again, untouched.
 */
export function clearFleetModelDefault(): void {
  try {
    const result = db().prepare("DELETE FROM fleet_model_default WHERE id = 1").run();
    if (Number(result.changes) > 0) {
      fileDecision({
        decided_at: new Date().toISOString(),
        subject_kind: "fleet",
        subject_id: null,
        kind: "fleet_model_default",
        topic: "",
        summary: describeFleetDefaultCleared(),
        outcome: { state: "cleared" },
        decided_by: "person",
        rule: null,
        reason: null,
        receipts: ["fleet_model_default 1"],
      });
    }
  } catch (error: unknown) {
    console.warn(`[dash] could not clear the default model: ${message(error)}`);
  }
}

/**
 * What one agent actually runs on, default included (MAR-642).
 *
 * The reader every consumer of a model should use, and the reason it exists
 * rather than each caller reading two rows and comparing them: the precedence
 * between an agent's own choice and DASH's default is a product decision, it
 * lives in `applyFleetDefault`, and five surfaces reading it separately is five
 * chances to disagree about whose setting wins.
 *
 * `agentProviderId` is the provider DASH would ask for this agent, resolved from
 * its manifest by the caller — which is why this takes it rather than reading it
 * here. This module holds no manifest and should not learn to.
 */
export function readEffectiveModelChoice(
  agent: string,
  agentProviderId: string | null,
): EffectiveModelChoice {
  return applyFleetDefault(
    readAgentModelChoice(agent),
    readFleetModelDefault(),
    agentProviderId,
  );
}

/* ---------------------------------------------------------------------- *
 * The level map (MAR-654, ADR 0011 amendment 1)
 * ---------------------------------------------------------------------- */

/**
 * What each level means to this person, for one provider or for all of them.
 *
 * Zero rows is the shipped state and the ordinary one: nothing seeds this table
 * and DASH never writes a row into it on somebody's behalf. A row naming a
 * provider this build no longer has, a level this build does not know, or a model
 * id that no longer passes is dropped — `readFleetModelDefault`'s rule applied one
 * table along: a record this build cannot interpret should read as the absence of
 * a record.
 *
 * The value keeps its provider beside it (`FleetModelDefault`) rather than being
 * flattened to a model id, so `applyFleetDefault` can apply to a level row the
 * same provider check it applies to the default. Reading *every* provider's rows
 * is what the AI tab does when somebody switches the service dropdown; passing a
 * provider is what everything that resolves a model does.
 */
export function readFleetLevelModels(providerId?: string): LevelModelMap {
  const map = new Map<DefaultModelLevel, FleetModelDefault>();
  let rows: unknown[];
  try {
    rows =
      providerId === undefined
        ? (db().prepare("SELECT provider_id, level, model_id FROM fleet_level_models").all() as unknown[])
        : (db()
            .prepare(
              "SELECT provider_id, level, model_id FROM fleet_level_models WHERE provider_id = ?",
            )
            .all(providerId) as unknown[]);
  } catch (error: unknown) {
    console.warn(`[dash] could not read the level map: ${message(error)}`);
    return map;
  }

  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const rowProvider = String(record["provider_id"]);
    const level = record["level"];
    const modelId = String(record["model_id"]);
    if (aiProviderById(rowProvider) === null || !isDefaultModelLevel(level) || !isModelId(modelId)) {
      continue;
    }
    /*
     * Read for one provider, a later row cannot displace an earlier one: the
     * primary key is (provider, level). Read for all of them it could, and the
     * first wins rather than the last — an arbitrary but *stable* answer to a
     * question with no single one. Every caller that resolves a model passes a
     * provider; this branch exists for the tab that is drawing rows, and it
     * groups them itself.
     */
    if (!map.has(level)) {
      map.set(level, { provider_id: rowProvider, model_id: modelId });
    }
  }
  return map;
}

/**
 * Whether anybody has mapped anything at all.
 *
 * One cheap query, so the ingest path can keep the promise MAR-642 made about
 * itself: on a DASH nobody has configured, not one manifest is opened when events
 * arrive. See `ingestEvents`.
 */
export function hasFleetLevelModels(): boolean {
  try {
    const row = db().prepare("SELECT 1 AS present FROM fleet_level_models LIMIT 1").get();
    return row !== undefined && row !== null;
  } catch (error: unknown) {
    console.warn(`[dash] could not read the level map: ${message(error)}`);
    return false;
  }
}

/**
 * Say what one level means, for one provider.
 *
 * Returns whether it was stored, in `writeFleetModelDefault`'s shape and for its
 * reason: false is a refusal — a provider DASH does not broker, a level this
 * build does not know, or an id DASH is not willing to write down — and the
 * caller renders a sentence rather than a fault.
 *
 * **It writes nothing to any agent and nothing to the default.** There is no code
 * path here that could, which is the mechanical half of "the per-agent escape
 * already exists and already wins": an agent with a pin keeps it, because
 * `applyFleetDefault` reads this only where that row is absent.
 */
export function writeFleetLevelModel(
  providerId: string,
  level: string,
  modelId: string,
  at: string,
): boolean {
  if (aiProviderById(providerId) === null || !isDefaultModelLevel(level) || !isModelId(modelId)) {
    return false;
  }
  // `writeFleetModelDefault`'s read-before-write, for its reason: the decisions
  // log records transitions, and re-saving the same row is not one.
  const before = readFleetLevelModels(providerId).get(level) ?? null;
  try {
    db()
      .prepare(
        "INSERT INTO fleet_level_models (provider_id, level, model_id, chosen_at) " +
          "VALUES (?, ?, ?, ?) " +
          "ON CONFLICT (provider_id, level) DO UPDATE SET " +
          "model_id = excluded.model_id, chosen_at = excluded.chosen_at",
      )
      .run(providerId, level, modelId, at);
  } catch (error: unknown) {
    console.warn(`[dash] could not record a level's model: ${message(error)}`);
    return false;
  }
  if (before === null || before.model_id !== modelId) {
    fileDecision({
      decided_at: at,
      subject_kind: "fleet",
      subject_id: null,
      kind: "fleet_level_model",
      // The table's own primary key, so the log threads one level of one
      // provider together: `topic` is what `fleet_decisions_by_chain` groups by,
      // and three levels sharing one empty topic would read as a single setting
      // changed nine times.
      topic: `${providerId}/${level}`,
      summary: describeLevelModelSet(levelLabel(level), modelId),
      outcome: { state: "set", provider_id: providerId, model_id: modelId },
      decided_by: "person",
      rule: null,
      reason: null,
      receipts: [`fleet_level_models ${providerId} ${level}`],
    });
  }
  return true;
}

/**
 * Go back to having nothing mapped for one level.
 *
 * Deletes rather than writing a sentinel, `clearFleetModelDefault`'s rule: "no
 * model for this level" and "a level whose model nothing can read" would be two
 * states meaning one thing, and only one of them is the state DASH ships in.
 * Steps that asked for it go back to the default, which is what they were on
 * before anybody mapped anything.
 */
export function clearFleetLevelModel(providerId: string, level: string): void {
  if (!isDefaultModelLevel(level)) {
    return;
  }
  try {
    const result = db()
      .prepare("DELETE FROM fleet_level_models WHERE provider_id = ? AND level = ?")
      .run(providerId, level);
    if (Number(result.changes) > 0) {
      fileDecision({
        decided_at: new Date().toISOString(),
        subject_kind: "fleet",
        subject_id: null,
        kind: "fleet_level_model",
        topic: `${providerId}/${level}`,
        summary: describeLevelModelCleared(levelLabel(level)),
        outcome: { state: "cleared" },
        decided_by: "person",
        rule: null,
        reason: null,
        receipts: [`fleet_level_models ${providerId} ${level}`],
      });
    }
  } catch (error: unknown) {
    console.warn(`[dash] could not clear a level's model: ${message(error)}`);
  }
}

/**
 * What one agent runs one step on, the whole ladder applied (MAR-654).
 *
 * `readEffectiveModelChoice` with a step, and the reader every per-step consumer
 * should use for the reason that one exists: the precedence between a pin, the
 * person's map and DASH's default is a product decision, it lives in
 * `applyFleetDefault`, and six surfaces reading three rows separately is six
 * chances to disagree about which wins.
 *
 * A null `level` is a step whose plan declared none, and it resolves exactly as
 * the whole-agent question does — pin, then default, then nothing.
 */
export function readEffectiveStepModel(
  agent: string,
  agentProviderId: string | null,
  level: DefaultModelLevel | null,
): EffectiveModelChoice {
  return applyFleetDefault(readAgentModelChoice(agent), readFleetModelDefault(), agentProviderId, {
    level,
    level_models: agentProviderId === null ? new Map() : readFleetLevelModels(agentProviderId),
  });
}

/* ---------------------------------------------------------------------- *
 * Per-step overrides
 * ---------------------------------------------------------------------- */

/** Every step this agent's owner set to something other than the plan's answer. */
export function readStepLevelOverrides(agent: string): Map<number, DefaultModelLevel> {
  const overrides = new Map<number, DefaultModelLevel>();
  let rows: unknown[];
  try {
    rows = db()
      .prepare("SELECT step, level FROM agent_step_levels WHERE agent = ? ORDER BY step")
      .all(agent) as unknown[];
  } catch (error: unknown) {
    console.warn(`[dash] could not read step levels: ${message(error)}`);
    return overrides;
  }

  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const step = Number(record["step"]);
    const level = record["level"];
    if (Number.isInteger(step) && isDefaultModelLevel(level)) {
      overrides.set(step, level);
    }
  }
  return overrides;
}

/** Set one step's level. Returns false for a level this build does not know. */
export function writeStepLevelOverride(
  agent: string,
  step: number,
  level: string,
  at: string,
): boolean {
  if (!Number.isInteger(step) || step < 1 || !isDefaultModelLevel(level)) {
    return false;
  }
  try {
    db()
      .prepare(
        "INSERT INTO agent_step_levels (agent, step, level, chosen_at) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT (agent, step) DO UPDATE SET " +
          "level = excluded.level, chosen_at = excluded.chosen_at",
      )
      .run(agent, step, level, at);
    return true;
  } catch (error: unknown) {
    console.warn(`[dash] could not record a step level: ${message(error)}`);
    return false;
  }
}

/** Put one step back on what its plan asked for. */
export function clearStepLevelOverride(agent: string, step: number): void {
  try {
    db().prepare("DELETE FROM agent_step_levels WHERE agent = ? AND step = ?").run(agent, step);
  } catch (error: unknown) {
    console.warn(`[dash] could not clear a step level: ${message(error)}`);
  }
}

/* ---------------------------------------------------------------------- *
 * The run record
 * ---------------------------------------------------------------------- */

/**
 * Record what the setting was, the first time DASH sees a run.
 *
 * `ON CONFLICT DO NOTHING` and never an update, which is the whole correctness
 * of the row: somebody who changes an agent's model halfway through a run must
 * not thereby change what an already-started run reports. `runs.first_seen_at`
 * is written in the same transaction with the same meaning.
 *
 * Takes the open database rather than calling `db()` so it can join the caller's
 * transaction — `insertEventRow`'s shape, and for its reason: a run's identity
 * and the setting that run started under should either both land or neither.
 */
export function recordRunModel(
  database: DatabaseSync,
  agent: string,
  runId: string,
  choice: RunModelSetting,
  at: string,
): void {
  try {
    database
      .prepare(
        "INSERT INTO run_models (agent, run_id, choice, provider_id, model_id, recorded_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
      )
      .run(
        agent,
        runId,
        choice.kind,
        // MAR-654. `matched` names its provider and no model, because "the
        // setting was a table" is not a model id and must not be squeezed into a
        // column shaped for one. The models are the rows written below.
        choice.kind === "match_each_step" ? null : choice.provider_id,
        choice.kind === "one_model" ? choice.model_id : null,
        at,
      );
    if (choice.kind !== "matched") {
      return;
    }
    /*
     * A1.5. The per-step resolution, in the caller's transaction beside the row
     * above, so a run has both or neither. `ON CONFLICT DO NOTHING` for
     * `run_models`' own reason: a later batch for the same run must not revise
     * what an already-started run reports it began under, and somebody changing
     * a level map mid-run must not reach backwards through this.
     */
    const insert = database.prepare(
      "INSERT INTO run_step_models " +
        "(agent, run_id, step, level, provider_id, model_id, resolved_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
    );
    for (const step of choice.steps) {
      insert.run(
        agent,
        runId,
        step.step,
        step.level,
        step.provider_id,
        step.model_id,
        step.resolved_by,
      );
    }
  } catch (error: unknown) {
    console.warn(`[dash] could not record a run's model setting: ${message(error)}`);
  }
}

/**
 * What one run started under, or null when DASH has no record.
 *
 * Null is the ordinary answer for every run that finished before this table
 * existed, and the surface says DASH has no record rather than filling in
 * today's setting — which would be a claim about the past made out of the
 * present.
 */
export function readRunModel(agent: string, runId: string): RunModelRecord | null {
  let row: unknown;
  try {
    row = db()
      .prepare(
        "SELECT choice, provider_id, model_id, recorded_at FROM run_models " +
          "WHERE agent = ? AND run_id = ?",
      )
      .get(agent, runId);
  } catch (error: unknown) {
    console.warn(`[dash] could not read a run's model setting: ${message(error)}`);
    return null;
  }
  if (row === undefined || row === null) {
    return null;
  }
  return projectRunModel(row, () => readRunStepModels(agent, runId));
}

/**
 * What DASH resolved for each step of one run, in step order (MAR-654).
 *
 * Read lazily by `projectRunModel` — only a `matched` row has any — so a store
 * full of runs recorded before this amendment costs exactly what it did.
 *
 * A row this build cannot interpret is dropped rather than downgraded, which is
 * this module's standing rule: an unreadable level or model id is the absence of
 * a resolution for that step, and a run whose every row is unreadable reads as a
 * setting DASH cannot describe rather than as one it invents.
 */
function readRunStepModels(agent: string, runId: string): RunStepModel[] {
  let rows: unknown[];
  try {
    rows = db()
      .prepare(
        "SELECT step, level, provider_id, model_id, resolved_by FROM run_step_models " +
          "WHERE agent = ? AND run_id = ? ORDER BY step",
      )
      .all(agent, runId) as unknown[];
  } catch (error: unknown) {
    console.warn(`[dash] could not read a run's step models: ${message(error)}`);
    return [];
  }

  const steps: RunStepModel[] = [];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const step = Number(record["step"]);
    const level = record["level"];
    const providerId = String(record["provider_id"]);
    const modelId = String(record["model_id"]);
    const resolvedBy = String(record["resolved_by"]);
    if (
      !Number.isInteger(step) ||
      !isDefaultModelLevel(level) ||
      aiProviderById(providerId) === null ||
      !isModelId(modelId) ||
      !isModelResolvedBy(resolvedBy)
    ) {
      continue;
    }
    steps.push({ step, level, provider_id: providerId, model_id: modelId, resolved_by: resolvedBy });
  }
  return steps;
}

/** Whether a stored string is one of the ladder's four rungs. */
function isModelResolvedBy(value: string): value is ModelResolvedBy {
  return (
    value === "agent_pin" ||
    value === "level_map" ||
    value === "fleet_default" ||
    value === "none"
  );
}

/** Every recorded run setting, keyed `${agent} ${run_id}`, for the runs list. */
export function readRunModels(): Map<string, RunModelRecord> {
  const byRun = new Map<string, RunModelRecord>();
  let rows: unknown[];
  try {
    rows = db()
      .prepare("SELECT agent, run_id, choice, provider_id, model_id, recorded_at FROM run_models")
      .all() as unknown[];
  } catch (error: unknown) {
    console.warn(`[dash] could not read run model settings: ${message(error)}`);
    return byRun;
  }

  for (const row of rows) {
    const fields = row as Record<string, unknown>;
    const agent = String(fields["agent"]);
    const runId = String(fields["run_id"]);
    const record = projectRunModel(row, () => readRunStepModels(agent, runId));
    if (record === null) {
      continue;
    }
    byRun.set(`${agent} ${runId}`, record);
  }
  return byRun;
}

/**
 * One stored row as a record, or null.
 *
 * A row claiming `one_model` without a usable provider and id is null rather
 * than being downgraded to `match_each_step`: the two say different things about
 * what happened, and quietly reporting the second for a row that meant the first
 * would put a sentence on a run page that nobody's setting ever produced.
 */
function projectRunModel(row: unknown, steps: () => RunStepModel[]): RunModelRecord | null {
  const record = row as Record<string, unknown>;
  const recordedAt = String(record["recorded_at"]);
  const choice = record["choice"];

  if (choice === "match_each_step") {
    return { choice: matchEachStep(), recorded_at: recordedAt };
  }
  const providerId = String(record["provider_id"]);
  if (aiProviderById(providerId) === null) {
    return null;
  }
  if (choice === "matched") {
    /*
     * MAR-654. The step rows are the models, so they are read here rather than
     * by every caller — and only here, which is why they arrive as a thunk: a
     * store full of runs recorded before this amendment never touches the table.
     *
     * A `matched` row with no readable step rows is null rather than
     * `match_each_step`, on `one_model`'s rule below: the two say different
     * things about what happened, and reporting "DASH had no model for this
     * agent" for a run whose setting was a table would be a sentence nobody's
     * setting ever produced.
     */
    const resolved = steps();
    return resolved.length === 0
      ? null
      : {
          choice: { kind: "matched", provider_id: providerId, steps: resolved },
          recorded_at: recordedAt,
        };
  }
  if (choice !== "one_model") {
    return null;
  }
  const modelId = String(record["model_id"]);
  if (!isModelId(modelId)) {
    return null;
  }
  return {
    choice: { kind: "one_model", provider_id: providerId, model_id: modelId },
    recorded_at: recordedAt,
  };
}

/**
 * Forget everything about one agent's model, when the agent itself goes.
 *
 * The run rows are deliberately **not** deleted: they record what DASH's setting
 * was while those runs happened, and a run's history outliving the agent's
 * current configuration is the same call `broker_audit` makes when a connection
 * is disconnected. What goes is the live configuration, which has nothing left
 * to configure.
 */
export function forgetAgentModelChoice(agent: string): void {
  // The deletes inline rather than through `clearAgentModelChoice`, because
  // this is the cascade of removing the agent, not a decision about its
  // model: `agent_removed` is the decision row (ADR 0024), and a second row
  // saying somebody cleared a pin would record a choice nobody made.
  try {
    db().prepare("DELETE FROM agent_model_choice WHERE agent = ?").run(agent);
  } catch (error: unknown) {
    console.warn(`[dash] could not clear a model choice: ${message(error)}`);
  }
  try {
    db().prepare("DELETE FROM agent_step_levels WHERE agent = ?").run(agent);
  } catch (error: unknown) {
    console.warn(`[dash] could not clear step levels: ${message(error)}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
