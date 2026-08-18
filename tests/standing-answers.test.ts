/**
 * A person's standing answers to an agent's runtime questions (MAR-681).
 *
 * `tests/model-choice.test.ts`'s shape for the store half: a real SQLite
 * store rather than a mock, because the questions here are "what does the row
 * say", "what got deleted" and "what never got written". The pure half —
 * `standingAnswerQuestionKey` and `standingAutoAnswers` — needs no store at
 * all and is driven directly.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  standingAnswerQuestionKey,
  standingAutoAnswers,
  type StandingAnswer,
} from "../lib/agent-dom/standing-answers";
import type { AgentDomState } from "../lib/workspace";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(repoRoot, "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/* ---------------------------------------------------------------------- *
 * The pure half
 * ---------------------------------------------------------------------- */

describe("standingAnswerQuestionKey", () => {
  it("folds case and collapses whitespace, so a rewording keeps matching", () => {
    expect(standingAnswerQuestionKey("Which competitor should I focus on?")).toBe(
      "which competitor should i focus on?",
    );
    expect(standingAnswerQuestionKey("  Which   competitor should I focus on?  ")).toBe(
      standingAnswerQuestionKey("Which competitor should I focus on?"),
    );
  });

  it("treats a genuinely different question as a different key", () => {
    expect(standingAnswerQuestionKey("Which competitor should I focus on?")).not.toBe(
      standingAnswerQuestionKey("Which channel should I post to?"),
    );
  });
});

describe("standingAutoAnswers", () => {
  const NOW = new Date("2026-08-17T09:00:00.000Z");

  function choice(overrides: Partial<NonNullable<AgentDomState["choices"]>[number]> = {}) {
    return {
      id: "choice-1",
      task_id: "task-1",
      label: "Which competitor should I focus on?",
      options: [
        { id: "opt-a", label: "Widget Co" },
        { id: "opt-b", label: "Acme" },
      ],
      expires_at: "2026-08-18T09:00:00.000Z",
      ...overrides,
    };
  }

  function answer(overrides: Partial<StandingAnswer> = {}): StandingAnswer {
    return {
      agent: "competitor-scout",
      question_key: standingAnswerQuestionKey("Which competitor should I focus on?"),
      question_label: "Which competitor should I focus on?",
      option_id: "opt-a",
      option_label: "Widget Co",
      chosen_at: "2026-08-16T09:00:00.000Z",
      ...overrides,
    };
  }

  it("answers an unanswered, unexpired choice a standing answer covers", () => {
    const stored = answer();
    const result = standingAutoAnswers({ choices: [choice()] }, NOW, (key) =>
      key === stored.question_key ? stored : null,
    );
    expect(result).toEqual([{ choice_id: "choice-1", task_id: "task-1", option_id: "opt-a" }]);
  });

  it("does nothing for a choice already answered", () => {
    const stored = answer();
    const result = standingAutoAnswers(
      { choices: [choice({ selected_option_id: "opt-b" })] },
      NOW,
      () => stored,
    );
    expect(result).toEqual([]);
  });

  it("does nothing for a choice whose deadline has passed", () => {
    const stored = answer();
    const result = standingAutoAnswers(
      { choices: [choice({ expires_at: "2026-08-01T00:00:00.000Z" })] },
      NOW,
      () => stored,
    );
    expect(result).toEqual([]);
  });

  it("does nothing when no standing answer matches the question", () => {
    const result = standingAutoAnswers({ choices: [choice()] }, NOW, () => null);
    expect(result).toEqual([]);
  });

  it("does nothing when the standing answer names an option this choice no longer offers", () => {
    const stored = answer({ option_id: "opt-retired" });
    const result = standingAutoAnswers({ choices: [choice()] }, NOW, () => stored);
    expect(result).toEqual([]);
  });

  it("matches by the question's own words, not by the choice's per-occurrence id", () => {
    const stored = answer();
    const result = standingAutoAnswers(
      { choices: [choice({ id: "choice-999-a-fresh-occurrence" })] },
      NOW,
      (key) => (key === stored.question_key ? stored : null),
    );
    expect(result).toEqual([
      { choice_id: "choice-999-a-fresh-occurrence", task_id: "task-1", option_id: "opt-a" },
    ]);
  });
});

/* ---------------------------------------------------------------------- *
 * The store, driven through the real write-sites
 * ---------------------------------------------------------------------- */

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  store: typeof import("../lib/store");
  decisions: typeof import("../lib/fleet/decisions-store");
  standingAnswers: typeof import("../lib/agent-dom/standing-answers");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-standing-answers-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  const store = await import("../lib/store");
  const decisions = await import("../lib/fleet/decisions-store");
  const standingAnswers = await import("../lib/agent-dom/standing-answers");
  opened.push({ dataDir, closeDb: db.closeDb });
  return { dataDir, db, store, decisions, standingAnswers };
}

afterEach(() => {
  const entries = opened.splice(0);
  for (const { closeDb } of entries) {
    closeDb();
  }
  for (const dataDir of new Set(entries.map((entry) => entry.dataDir))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function now(): string {
  return new Date().toISOString();
}

describe("the standing_answers table", () => {
  it("has no row for a question nobody has answered", async () => {
    const { standingAnswers } = await freshStore();
    expect(standingAnswers.readStandingAnswer("scout", "which competitor?")).toBeNull();
    expect(standingAnswers.readStandingAnswers("scout")).toEqual([]);
  });

  it("round-trips a written answer, keyed by the question's own words", async () => {
    const { standingAnswers } = await freshStore();
    standingAnswers.writeStandingAnswer(
      "scout",
      "Which competitor should I focus on?",
      "opt-a",
      "Widget Co",
      now(),
    );
    const key = standingAnswers.standingAnswerQuestionKey("Which competitor should I focus on?");
    const row = standingAnswers.readStandingAnswer("scout", key);
    expect(row).toMatchObject({
      agent: "scout",
      question_key: key,
      question_label: "Which competitor should I focus on?",
      option_id: "opt-a",
      option_label: "Widget Co",
    });
  });

  it("upserts rather than duplicates a second answer to the same question", async () => {
    const { standingAnswers } = await freshStore();
    standingAnswers.writeStandingAnswer("scout", "Which competitor?", "opt-a", "Widget Co", now());
    standingAnswers.writeStandingAnswer("scout", "Which competitor?", "opt-b", "Acme", now());
    const rows = standingAnswers.readStandingAnswers("scout");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ option_id: "opt-b", option_label: "Acme" });
  });

  it("clears a row, and clearing an unset question changes nothing", async () => {
    const { standingAnswers } = await freshStore();
    standingAnswers.writeStandingAnswer("scout", "Which competitor?", "opt-a", "Widget Co", now());
    const key = standingAnswers.standingAnswerQuestionKey("Which competitor?");
    standingAnswers.clearStandingAnswer("scout", key, now());
    expect(standingAnswers.readStandingAnswer("scout", key)).toBeNull();
    // Idempotent: clearing again is not an error and files nothing further.
    standingAnswers.clearStandingAnswer("scout", key, now());
  });

  it("keeps separate agents' rows for the same question apart", async () => {
    const { standingAnswers } = await freshStore();
    standingAnswers.writeStandingAnswer("scout-a", "Which competitor?", "opt-a", "Widget Co", now());
    standingAnswers.writeStandingAnswer("scout-b", "Which competitor?", "opt-b", "Acme", now());
    const key = standingAnswers.standingAnswerQuestionKey("Which competitor?");
    expect(standingAnswers.readStandingAnswer("scout-a", key)?.option_id).toBe("opt-a");
    expect(standingAnswers.readStandingAnswer("scout-b", key)?.option_id).toBe("opt-b");
  });
});

describe("filing at the write-sites", () => {
  it("files a standing answer once per transition, and a clear only when a row existed", async () => {
    const { decisions, standingAnswers } = await freshStore();

    standingAnswers.writeStandingAnswer("scout", "Which competitor?", "opt-a", "Widget Co", now());
    // Pressing the same answer again is not a second decision (ADR 0024
    // decision 1 — a decision is a change to standing state).
    standingAnswers.writeStandingAnswer("scout", "Which competitor?", "opt-a", "Widget Co", now());
    expect(decisions.readDecisions()).toHaveLength(1);

    const key = standingAnswers.standingAnswerQuestionKey("Which competitor?");
    standingAnswers.clearStandingAnswer("scout", key, now());
    // Clearing an already-cleared row files nothing further.
    standingAnswers.clearStandingAnswer("scout", key, now());

    const log = decisions.readDecisions();
    expect(log).toHaveLength(2);
    expect(log.map((row) => row.kind)).toEqual(["standing_answer", "standing_answer"]);
    expect(log[0]).toMatchObject({
      subject_kind: "agent",
      subject_id: "scout",
      topic: key,
      outcome: { state: "set", option_id: "opt-a" },
      decided_by: "person",
    });
    expect(log[1]).toMatchObject({ topic: key, outcome: { state: "cleared" } });
  });

  it("files again when the answer to the same question actually changes", async () => {
    const { decisions, standingAnswers } = await freshStore();
    standingAnswers.writeStandingAnswer("scout", "Which competitor?", "opt-a", "Widget Co", now());
    standingAnswers.writeStandingAnswer("scout", "Which competitor?", "opt-b", "Acme", now());
    const log = decisions.readDecisions();
    expect(log).toHaveLength(2);
    expect(log.map((row) => row.outcome["option_id"])).toEqual(["opt-a", "opt-b"]);
  });

  it("removes an agent's standing answers when the agent is forgotten, filing nothing extra", async () => {
    const { decisions, standingAnswers, store } = await freshStore();
    const manifest = example("agent.manifest.example.json");
    const agent = String((manifest["agent"] as { name: string }).name);
    expect(store.importManifest(manifest)).toMatchObject({ ok: true });
    standingAnswers.writeStandingAnswer(agent, "Which competitor?", "opt-a", "Widget Co", now());

    store.forgetAgent(agent);

    const key = standingAnswers.standingAnswerQuestionKey("Which competitor?");
    expect(standingAnswers.readStandingAnswer(agent, key)).toBeNull();
    // Only the addition and the removal — the cascade delete files nothing of
    // its own, `agent_model_choice`'s own rule for the same reason.
    expect(decisions.readDecisions().map((row) => row.kind)).toEqual([
      "agent_added",
      "standing_answer",
      "agent_removed",
    ]);
  });
});
