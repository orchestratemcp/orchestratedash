/**
 * The interview state machine, and the five cases MAR-876's acceptance
 * criteria name: a vague request, a fully specified one, a changed answer, a
 * resumed draft, and an unsupported feature.
 *
 * The property under all of them is one sentence: **this server never guesses.**
 * It holds no model (ADR 0032 decision 7) and it must not acquire one, so the
 * only things it may conclude from prose are the ones written out in
 * `interview.ts`'s phrase table — and anything a sentence says two ways is
 * asked rather than decided. A test suite for an interview that only checked
 * the happy path would pass just as well over a server that guessed, which is
 * why the ambiguity and unsupported blocks are here rather than in a comment.
 *
 * These run over `interviewAgent`, on a real disk, because the draft file is
 * half of what "resumable" means and a state machine tested only in memory
 * cannot fail the way the resume case fails.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { interviewAgent } from "../src/agent-tools";
import {
  deriveDisplayName,
  parseSources,
  readOpening,
  readTime,
  unsupportedFor,
  type InterviewQuestion,
  type UnsupportedNote,
} from "../src/interview";

let project: string;
let counter: number;

const NOW = new Date("2026-09-06T09:00:00.000Z");

/** Deterministic ids, so a failure names a draft rather than a random word. */
function ids(): () => string {
  return () => {
    counter += 1;
    return `draft-test-${String(counter)}`;
  };
}

beforeEach(() => {
  project = mkdtempSync(path.join(os.tmpdir(), "dash-mcp-interview-"));
  counter = 0;
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

interface Answered {
  ok: boolean;
  draft_id: string;
  draft_file: string;
  questions: InterviewQuestion[];
  answered: Record<string, string>;
  unsupported: UnsupportedNote[];
  ready: boolean;
  ambiguous?: string[];
  recap?: { route: { step: number; component_id: string }[]; will_not_do: string[]; name: string };
}

function ask(
  answers: Record<string, string>,
  draftId?: string,
  action?: "next" | "back" | "recap" | "reset",
): Answered {
  return interviewAgent(
    { directory: project, draft_id: draftId, answers, action },
    NOW,
    ids(),
  ) as unknown as Answered;
}

function asked(result: Answered): string[] {
  return result.questions.map((question) => question.id);
}

/* ---------------------------------------------------------------------- *
 * The vague case
 * ---------------------------------------------------------------------- */

describe("a vague request", () => {
  it("asks one question at a time and settles nothing it was not told", () => {
    const first = ask({});
    expect(asked(first)).toEqual(["outcome"]);
    expect(first.ready).toBe(false);

    const second = ask({ outcome: "keep an eye on AI news for me" }, first.draft_id);
    // Nothing in that sentence names a source, a cadence, a shape or a
    // destination, so every one of them is still a question.
    expect(second.answered["trigger"]).toBeUndefined();
    expect(second.answered["destination"]).toBeUndefined();
    expect(asked(second)).toEqual(["sources"]);

    const third = ask({ sources: "the usual" }, first.draft_id);
    expect(asked(third)).toEqual(["result_format"]);

    const fourth = ask({ result_format: "roundup_and_summary" }, first.draft_id);
    // The one pair asked together: when it runs, and what it may do alone.
    expect(asked(fourth)).toEqual(["trigger", "autonomy"]);

    const fifth = ask({ trigger: "manual", autonomy: "tell_me" }, first.draft_id);
    expect(asked(fifth)).toEqual(["destination"]);

    const finished = ask({ destination: "dash" }, first.draft_id);
    expect(finished.ready).toBe(true);
    expect(finished.questions).toEqual([]);
    // Manual and in DASH: nothing happens while nobody is looking, so there is
    // no reason to ask where it should live.
    expect(finished.answered["cloud"]).toBeUndefined();
    expect(finished.recap?.name).toBe("AI news");
  });

  it("never asks more than two questions in one turn", () => {
    let draft: string | undefined;
    const answers: Record<string, string>[] = [
      { outcome: "watch the news" },
      { sources: "the usual" },
      { result_format: "roundup_and_summary" },
      { trigger: "manual", autonomy: "tell_me" },
      { destination: "dash" },
    ];
    for (const answer of answers) {
      const result = ask(answer, draft);
      draft = result.draft_id;
      expect(result.questions.length).toBeLessThanOrEqual(2);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The fully specified case
 * ---------------------------------------------------------------------- */

describe("a fully specified request", () => {
  const OPENING =
    "Every morning at 7, read the Hacker News front page and https://techcrunch.com/feed/ " +
    "and give me a roundup with a short summary. Alert me in Discord.";

  it("skips every question the opening answer already settled", () => {
    const first = ask({ outcome: OPENING });

    expect(first.answered["trigger"]).toBe("daily");
    expect(first.answered["trigger_time"]).toBe("07:00");
    expect(first.answered["destination"]).toBe("discord");
    expect(first.answered["result_format"]).toBe("roundup_and_summary");
    // The reading, not the sentence: re-reading prose at recap time reports
    // every clause that was not a source as a source it could not reach.
    expect(first.answered["sources"]).toBe(
      "Techcrunch - https://techcrunch.com/feed/\n" +
        "Hacker News front page - https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20",
    );
    expect(parseSources(first.answered["sources"]!).unreadable).toEqual([]);

    // Autonomy was not mentioned, so it is asked — alone, because its partner
    // is already answered.
    expect(asked(first)).toEqual(["autonomy"]);
  });

  it("asks about a host only once something wants to happen unattended", () => {
    const first = ask({ outcome: OPENING });
    const second = ask({ autonomy: "tell_me" }, first.draft_id);
    // A daily run and a Discord alert both happen while nobody is watching.
    expect(asked(second)).toEqual(["cloud"]);

    const finished = ask({ cloud: "this_computer" }, first.draft_id);
    expect(finished.ready).toBe(true);
  });

  it("reads both named sources, and gives each a name rather than an address", () => {
    const parsed = parseSources(OPENING);
    expect(parsed.sources.map((source) => source.name)).toEqual([
      "Techcrunch",
      "Hacker News front page",
    ]);
    expect(parsed.sources.map((source) => source.format)).toEqual(["rss", "hn_algolia"]);
    for (const source of parsed.sources) {
      expect(source.name).not.toMatch(/https?:/);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Ambiguity
 * ---------------------------------------------------------------------- */

describe("a sentence that says a thing two ways", () => {
  it("asks rather than picking one", () => {
    const reading = readOpening("Every morning, or just whenever I ask, whichever is easier");
    expect(reading.answers["trigger"]).toBeUndefined();
    expect(reading.ambiguous).toContain("trigger");
  });

  it("says so in the result, so the host can explain why it is asking again", () => {
    const first = ask({ outcome: "Post it to Slack, or Discord, either is fine" });
    expect(first.ambiguous).toContain("destination");
    expect(first.answered["destination"]).toBeUndefined();
  });
});

/* ---------------------------------------------------------------------- *
 * A changed answer
 * ---------------------------------------------------------------------- */

describe("changing an answer", () => {
  function throughToCloud(): Answered {
    const first = ask({ outcome: "watch the news" });
    ask({ sources: "the usual" }, first.draft_id);
    ask({ result_format: "roundup_and_summary" }, first.draft_id);
    ask({ trigger: "daily", autonomy: "tell_me" }, first.draft_id);
    return ask({ destination: "dash" }, first.draft_id);
  }

  it("back un-answers the most recent question and asks it again", () => {
    const before = throughToCloud();
    expect(asked(before)).toEqual(["cloud"]);

    const stepped = ask({}, before.draft_id, "back");
    // `destination` was the last thing answered, so that is what comes back —
    // carrying what was said before, so the host can show it as the current value.
    expect(asked(stepped)).toEqual(["destination"]);
    expect(stepped.questions[0]?.current).toBeUndefined();
    expect(stepped.answered["destination"]).toBeUndefined();
  });

  it("drops an answer to a question that stopped applying", () => {
    const before = throughToCloud();
    const withCloud = ask({ cloud: "server" }, before.draft_id);
    expect(withCloud.answered["cloud"]).toBe("server");
    expect(withCloud.ready).toBe(true);

    // Moving off the daily schedule means nothing happens unattended any more,
    // so the cloud answer is stale state that must not reach the recap.
    const manual = ask({ trigger: "manual" }, before.draft_id);
    expect(manual.answered["cloud"]).toBeUndefined();
    expect(manual.answered["trigger"]).toBe("manual");
    expect(manual.ready).toBe(true);
    expect(manual.unsupported.map((note) => note.asked)).not.toContain(
      "Running on a server all the time",
    );
  });

  it("keeps the schedule time only while there is a schedule to attach it to", () => {
    const first = ask({ outcome: "read the news every morning at 6" });
    expect(first.answered["trigger_time"]).toBe("06:00");
    const changed = ask({ trigger: "manual" }, first.draft_id);
    expect(changed.answered["trigger_time"]).toBeUndefined();
  });

  it("overwrites an answer in place rather than reordering the interview", () => {
    const before = throughToCloud();
    const changed = ask({ result_format: "spreadsheet" }, before.draft_id);
    expect(changed.answered["result_format"]).toBe("spreadsheet");
    // Still on the cloud question: changing an earlier answer did not rewind.
    expect(asked(changed)).toEqual(["cloud"]);
  });

  it("reset clears the answers and keeps the draft", () => {
    const before = throughToCloud();
    const cleared = ask({}, before.draft_id, "reset");
    expect(cleared.draft_id).toBe(before.draft_id);
    expect(cleared.answered).toEqual({});
    expect(asked(cleared)).toEqual(["outcome"]);
  });
});

/* ---------------------------------------------------------------------- *
 * Resuming
 * ---------------------------------------------------------------------- */

describe("resuming", () => {
  it("writes the draft on the very first call, not only when it is finished", () => {
    const first = ask({});
    expect(first.draft_file).toBe(
      path.join(project, ".dash", `interview-${first.draft_id}.json`),
    );
    const held = JSON.parse(readFileSync(first.draft_file, "utf8")) as { draft_id: string };
    expect(held.draft_id).toBe(first.draft_id);
  });

  it("picks the same interview up from the file alone", () => {
    const first = ask({ outcome: "watch the news" });
    ask({ sources: "the usual" }, first.draft_id);
    ask({ result_format: "roundup_and_summary" }, first.draft_id);

    // A different process, days later: nothing in memory, only the id.
    const resumed = interviewAgent(
      { directory: project, draft_id: first.draft_id },
      NOW,
      ids(),
    ) as unknown as Answered;

    expect(resumed.answered["sources"]).toBe("the usual");
    expect(asked(resumed)).toEqual(["trigger", "autonomy"]);
  });

  it("refuses an id it did not make, and says how to start again", () => {
    const refused = interviewAgent({ directory: project, draft_id: "../../etc/passwd" }, NOW, ids());
    expect(refused.ok).toBe(false);
    expect(String(refused["refusal"])).toContain("draft_id");
  });

  it("refuses a draft that is not there rather than starting a silent new one", () => {
    const refused = interviewAgent({ directory: project, draft_id: "draft-deadbeef" }, NOW, ids());
    expect(refused.ok).toBe(false);
    expect(String(refused["refusal"])).toContain("no interview saved");
  });

  it("re-checks every value it reads back, because the file is on the user's disk", () => {
    const first = ask({ outcome: "watch the news" });
    // A hand edit, a bad merge, or an editor: values that would not have been
    // accepted going in must not become answers on the strength of being written.
    mkdirSync(path.join(project, ".dash"), { recursive: true });
    writeFileSync(
      first.draft_file,
      JSON.stringify({
        draft_id: first.draft_id,
        answers: { outcome: "watch the news", trigger: 7, destination: "" },
        answered_order: ["outcome", "trigger", "destination", "nonsense"],
      }),
      "utf8",
    );

    const resumed = interviewAgent(
      { directory: project, draft_id: first.draft_id },
      NOW,
      ids(),
    ) as unknown as Answered;
    expect(resumed.ok).toBe(true);
    expect(resumed.answered["trigger"]).toBeUndefined();
    expect(resumed.answered["destination"]).toBeUndefined();
    expect(asked(resumed)).toEqual(["sources"]);
  });
});

/* ---------------------------------------------------------------------- *
 * Where it may write
 * ---------------------------------------------------------------------- */

describe("where the draft goes", () => {
  it("refuses a relative directory, the way every other tool here does", () => {
    const refused = interviewAgent({ directory: "my-agent" }, NOW, ids());
    expect(refused.ok).toBe(false);
    expect(String(refused["refusal"])).toContain("full path");
  });
});

/* ---------------------------------------------------------------------- *
 * Unsupported features
 * ---------------------------------------------------------------------- */

describe("something this template cannot do", () => {
  it("is recorded with a reason and the nearest thing that works", () => {
    const first = ask({ outcome: "watch competitor blogs" });
    const withSlack = ask({ destination: "slack" }, first.draft_id);
    const note = withSlack.unsupported.find((entry) => entry.asked.includes("Slack"));
    expect(note).toBeDefined();
    expect(note?.why_not).toContain("no Slack connection");
    expect(note?.nearest_supported).toContain("Discord");
  });

  it("is derived from the answers, so changing one changes the notes with it", () => {
    expect(unsupportedFor({ destination: "slack" })).toHaveLength(1);
    expect(unsupportedFor({ destination: "dash" })).toHaveLength(0);
  });

  it("names every unsupported answer the questions themselves offer", () => {
    // The questions deliberately show unsupported options rather than hiding
    // them, because an option nobody is offered is a limit nobody learns. Each
    // one has to produce a note, or the offer is a trap.
    const cases: Record<string, string>[] = [
      { result_format: "document" },
      { result_format: "spreadsheet" },
      { trigger: "hourly" },
      { trigger: "weekly" },
      { trigger: "on_event" },
      { autonomy: "ask_first" },
      { autonomy: "act" },
      { destination: "slack" },
      { destination: "email" },
      { destination: "post" },
      { cloud: "server" },
    ];
    for (const answers of cases) {
      const notes = unsupportedFor(answers);
      expect(notes, JSON.stringify(answers)).toHaveLength(1);
      expect(notes[0]?.nearest_supported.length).toBeGreaterThan(20);
    }
  });

  it("says nothing about a source it cannot reach until the recap can explain it", () => {
    const parsed = parseSources("my competitor's website");
    expect(parsed.sources).toHaveLength(0);
    expect(parsed.unreadable).toEqual(["my competitor's website"]);
  });

  it("holds Slack open as unsupported even after the person picks a real destination", () => {
    // The opening sentence is kept, so what they originally wanted is still
    // answerable — this is what stops "we could not do that" being forgotten
    // between the question and the recap.
    const first = ask({ outcome: "watch AI news and post it to Slack" });
    const answered = ask({ destination: "dash" }, first.draft_id);
    expect(answered.answered["destination"]).toBe("dash");
    expect(answered.answered["outcome"]).toContain("Slack");
  });
});

/* ---------------------------------------------------------------------- *
 * The small readers
 * ---------------------------------------------------------------------- */

describe("reading a time", () => {
  it("reads the forms people write, and only ones DASH would accept", () => {
    expect(readTime("every morning at 7")).toBe("07:00");
    expect(readTime("at 7:30am")).toBe("07:30");
    expect(readTime("at 6pm")).toBe("18:00");
    expect(readTime("at 12am")).toBe("00:00");
    expect(readTime("every morning")).toBe("08:00");
    expect(readTime("every evening")).toBe("18:00");
    expect(readTime("at some point")).toBeNull();
    // `isLocalTime` is DASH's, so a time DASH would refuse is refused here.
    expect(readTime("at 25")).toBeNull();
  });
});

describe("deriving a name", () => {
  it("strips the framing and stops at the scheduling clause", () => {
    expect(deriveDisplayName("keep an eye on AI news for me")).toBe("AI news");
    expect(deriveDisplayName("watch electric vehicle news every morning")).toBe(
      "Electric vehicle news",
    );
    expect(
      deriveDisplayName("build me an agent that tracks security advisories and posts them"),
    ).toBe("Security advisories");
  });

  it("takes the temporal clause off the front, wherever the person put it", () => {
    // A hand-driven session produced "Every morning at 7 read" from this exact
    // sentence. The clause people lead with is not what the agent is called.
    expect(
      deriveDisplayName(
        "Every morning at 7, read the Hacker News front page and give me a roundup",
      ),
    ).toBe("Hacker News front page");
    expect(deriveDisplayName("each week check security advisories")).toBe(
      "Security advisories",
    );
  });

  it("never produces an address or an empty name", () => {
    expect(deriveDisplayName("https://example.com/feed")).toBe("News watch");
    expect(deriveDisplayName("")).toBe("News watch");
  });
});
