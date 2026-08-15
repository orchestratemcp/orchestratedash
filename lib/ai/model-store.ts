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
import { db } from "../db";
import { aiProviderById } from "./providers";
import {
  applyFleetDefault,
  matchEachStep,
  type AgentModelChoice,
  type EffectiveModelChoice,
  type FleetModelDefault,
  type RunModelRecord,
} from "./model-choice";
import { isDefaultModelLevel, type DefaultModelLevel } from "./model-levels";

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
    return true;
  } catch (error: unknown) {
    console.warn(`[dash] could not record a model choice: ${message(error)}`);
    return false;
  }
}

/** Go back to matching each step. Deletes rather than storing the default. */
export function clearAgentModelChoice(agent: string): void {
  try {
    db().prepare("DELETE FROM agent_model_choice WHERE agent = ?").run(agent);
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
    return true;
  } catch (error: unknown) {
    console.warn(`[dash] could not record the default model: ${message(error)}`);
    return false;
  }
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
    db().prepare("DELETE FROM fleet_model_default WHERE id = 1").run();
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
  choice: AgentModelChoice,
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
        choice.kind === "one_model" ? choice.provider_id : null,
        choice.kind === "one_model" ? choice.model_id : null,
        at,
      );
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
  return row === undefined || row === null ? null : projectRunModel(row);
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
    const record = projectRunModel(row);
    if (record === null) {
      continue;
    }
    const fields = row as Record<string, unknown>;
    byRun.set(`${String(fields["agent"])} ${String(fields["run_id"])}`, record);
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
function projectRunModel(row: unknown): RunModelRecord | null {
  const record = row as Record<string, unknown>;
  const recordedAt = String(record["recorded_at"]);
  const choice = record["choice"];

  if (choice === "match_each_step") {
    return { choice: matchEachStep(), recorded_at: recordedAt };
  }
  if (choice !== "one_model") {
    return null;
  }
  const providerId = String(record["provider_id"]);
  const modelId = String(record["model_id"]);
  if (aiProviderById(providerId) === null || !isModelId(modelId)) {
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
  clearAgentModelChoice(agent);
  try {
    db().prepare("DELETE FROM agent_step_levels WHERE agent = ?").run(agent);
  } catch (error: unknown) {
    console.warn(`[dash] could not clear step levels: ${message(error)}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
