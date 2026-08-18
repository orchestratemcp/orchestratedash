/**
 * Reading and writing a person's standing answers to an agent's runtime
 * questions (MAR-681).
 *
 * "Which competitor should I focus on?" is an Agent DOM `choice` — a runtime
 * fork the agent's own plan declared, offered through the Work Inbox and
 * answered by the `choose` command (`lib/agent-dom/enforce.ts`,
 * `lib/agent-dom/runner.ts`). This module is a second, narrower thing beside
 * it: a person's own record that a question should stop being asked, kept
 * until they revoke it.
 *
 * **Not `agent_questions`.** That table (migration 18) is the Ask feature's
 * transcript — a person asking an agent's model about what it has saved. It
 * shares no code and no row with this table; see `lib/db.ts`'s migration 29
 * note for why the two do not merge.
 *
 * `lib/ai/model-store.ts`'s shape throughout: absence is the default and
 * means "ask", a stored row is upserted rather than duplicated, clearing
 * deletes rather than writing a sentinel, and a write files a decision only
 * when something actually changed.
 */

import { db } from "../db";
import { describeStandingAnswerCleared, describeStandingAnswerSet } from "../copy/decisions";
import type { CommandActor } from "./envelope";
import { fileDecision } from "../fleet/decisions-store";
import { hasExpired, type AgentDomState } from "../workspace";

export interface StandingAnswer {
  agent: string;
  question_key: string;
  /** The choice's own `label`, verbatim, at the moment this was recorded. */
  question_label: string;
  option_id: string;
  /** The chosen option's own `label`, verbatim, at the moment this was recorded. */
  option_label: string;
  chosen_at: string;
}

/**
 * What "the same question" means, across runs that mint a fresh `choice.id`
 * every time.
 *
 * The Agent DOM v1 contract gives a choice no identity that survives its own
 * occurrence — `choice.id` is instance-scoped, and the only field two runs of
 * the same question plausibly share verbatim is the label the agent's author
 * wrote. So the key is that label, trimmed, case-folded and collapsed to
 * single spaces: a rewording is a new question rather than a corrected one,
 * and that is the honest limit of what this build can tell apart.
 *
 * This is the one place that decision is made. A second normalisation written
 * against the same field is how a write path and a read path come to
 * disagree about whether two questions are the same one.
 */
export function standingAnswerQuestionKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export function readStandingAnswer(agent: string, questionKey: string): StandingAnswer | null {
  let row: unknown;
  try {
    row = db()
      .prepare(
        "SELECT agent, question_key, question_label, option_id, option_label, chosen_at " +
          "FROM standing_answers WHERE agent = ? AND question_key = ?",
      )
      .get(agent, questionKey);
  } catch (error: unknown) {
    console.warn(`[dash] could not read a standing answer: ${message(error)}`);
    return null;
  }
  return row === undefined || row === null ? null : projectStandingAnswer(row);
}

/** Every standing answer for one agent, newest first — the Settings stage's list. */
export function readStandingAnswers(agent: string): StandingAnswer[] {
  let rows: unknown[];
  try {
    rows = db()
      .prepare(
        "SELECT agent, question_key, question_label, option_id, option_label, chosen_at " +
          "FROM standing_answers WHERE agent = ? ORDER BY chosen_at DESC",
      )
      .all(agent) as unknown[];
  } catch (error: unknown) {
    console.warn(`[dash] could not read standing answers: ${message(error)}`);
    return [];
  }
  return rows.map(projectStandingAnswer);
}

function projectStandingAnswer(row: unknown): StandingAnswer {
  const record = row as Record<string, unknown>;
  return {
    agent: String(record["agent"]),
    question_key: String(record["question_key"]),
    question_label: String(record["question_label"]),
    option_id: String(record["option_id"]),
    option_label: String(record["option_label"]),
    chosen_at: String(record["chosen_at"]),
  };
}

/**
 * Remember an answer to one of an agent's questions: "always this."
 *
 * `questionLabel` is the choice's own `label`, verbatim — this function
 * derives the key rather than accepting one, so a caller cannot pass a key
 * that disagrees with `standingAnswerQuestionKey`'s own answer for the label
 * it is stored beside.
 */
export function writeStandingAnswer(
  agent: string,
  questionLabel: string,
  optionId: string,
  optionLabel: string,
  at: string,
): void {
  const questionKey = standingAnswerQuestionKey(questionLabel);
  // Read before write, `writeAgentModelChoice`'s reason: pressing the same
  // answer twice is one decision, not two (ADR 0024 decision 1).
  const before = readStandingAnswer(agent, questionKey);
  try {
    db()
      .prepare(
        "INSERT INTO standing_answers " +
          "(agent, question_key, question_label, option_id, option_label, chosen_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT (agent, question_key) DO UPDATE SET " +
          "question_label = excluded.question_label, option_id = excluded.option_id, " +
          "option_label = excluded.option_label, chosen_at = excluded.chosen_at",
      )
      .run(agent, questionKey, questionLabel, optionId, optionLabel, at);
  } catch (error: unknown) {
    console.warn(`[dash] could not record a standing answer: ${message(error)}`);
    return;
  }
  const unchanged = before !== null && before.option_id === optionId;
  if (!unchanged) {
    fileDecision({
      decided_at: at,
      subject_kind: "agent",
      subject_id: agent,
      kind: "standing_answer",
      topic: questionKey,
      summary: describeStandingAnswerSet(questionKey),
      outcome: { state: "set", question_label: questionLabel, option_id: optionId, option_label: optionLabel },
      decided_by: "person",
      rule: null,
      reason: null,
      receipts: [`standing_answers ${agent} ${questionKey}`],
    });
  }
}

/** Forget one standing answer. Deletes rather than writing an empty row. */
export function clearStandingAnswer(agent: string, questionKey: string, at: string): void {
  try {
    const result = db()
      .prepare("DELETE FROM standing_answers WHERE agent = ? AND question_key = ?")
      .run(agent, questionKey);
    // Filed only when a row actually went — `clearAgentModelChoice`'s rule:
    // clearing an answer nobody set is not a transition.
    if (Number(result.changes) > 0) {
      fileDecision({
        decided_at: at,
        subject_kind: "agent",
        subject_id: agent,
        kind: "standing_answer",
        topic: questionKey,
        summary: describeStandingAnswerCleared(questionKey),
        outcome: { state: "cleared" },
        decided_by: "person",
        rule: null,
        reason: null,
        receipts: [`standing_answers ${agent} ${questionKey}`],
      });
    }
  } catch (error: unknown) {
    console.warn(`[dash] could not clear a standing answer: ${message(error)}`);
  }
}

/* ---------------------------------------------------------------------- *
 * Auto-answering a fresh choice (MAR-681, build item 1)
 * ---------------------------------------------------------------------- */

/** One unanswered choice a standing answer covers, ready to be issued. */
export interface StandingAutoAnswer {
  choice_id: string;
  task_id: string;
  option_id: string;
}

/**
 * Every unanswered, unexpired choice in `state` that `lookup` has a standing
 * answer for.
 *
 * Pure — `lookup` is injected so this is testable without a database, the
 * same seam `enforceCommand` takes `now` through. The caller still has to
 * check `lookup`'s answer names an option the choice actually offers: an
 * agent that changed its own options between runs can leave a standing answer
 * pointing at an id that no longer exists, and this function reports that
 * mismatch as "nothing to auto-answer" rather than a stale target.
 */
export function standingAutoAnswers(
  state: Pick<AgentDomState, "choices">,
  now: Date,
  lookup: (questionKey: string) => StandingAnswer | null,
): StandingAutoAnswer[] {
  const answers: StandingAutoAnswer[] = [];
  for (const choice of state.choices ?? []) {
    if (choice.selected_option_id !== undefined) {
      continue;
    }
    if (hasExpired(choice.expires_at, now)) {
      continue;
    }
    const standing = lookup(standingAnswerQuestionKey(choice.label));
    if (standing === null) {
      continue;
    }
    if (!choice.options.some((option) => option.id === standing.option_id)) {
      continue;
    }
    answers.push({ choice_id: choice.id, task_id: choice.task_id, option_id: standing.option_id });
  }
  return answers;
}

/**
 * Who DASH says it is when it applies a standing answer without a person at
 * the keyboard.
 *
 * **Not `localPrincipal`.** That function's whole honesty is that
 * `dash_session` names the one OS user running this copy of DASH — true of a
 * live click, false of a choice DASH is issuing on a five-second poll. `type:
 * "service"` is what keeps `lib/agent-dom/runner.ts`'s `finish()` from filing
 * an `irreversible_approval` decision here: that kind exists to answer "who
 * approved this", and the honest answer for an auto-applied standing answer
 * is that nobody did, this once — the approval was the person's original
 * "always this" press, already filed under `standing_answer`. The distinct
 * `actor_id` is the receipt instead: `command_audit` shows this row was
 * issued by the standing answer, not by whoever was signed into this machine.
 */
export function standingAnswerPrincipal(): CommandActor {
  return {
    id: "dash.standing_answer",
    type: "service",
    authenticated_by: "dash_session",
    display_name: "A standing answer",
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
