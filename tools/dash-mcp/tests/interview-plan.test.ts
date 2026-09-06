/**
 * The recap, and the one thing it must not be allowed to lie about (MAR-876).
 *
 * A recap is the last thing a person reads before a folder exists, and it is
 * the only description of the agent they will ever be shown in their own
 * words. Everything in it therefore has to be read out of the artefact rather
 * than written beside it, and this file's job is to hold that line in three
 * places:
 *
 * 1. **The route.** `lib/analyze.ts` grades a run by matching its executed
 *    steps to `planned_route` by exact `component_id`. A recap describing the
 *    steps in its own words could promise something the telemetry will later
 *    call drift, so the recap reads the manifest and this test compares the
 *    two by value. That is MAR-876's "route matches telemetry" criterion, made
 *    structural rather than remembered.
 * 2. **The request.** What the recap describes and what `dash_agent_scaffold`
 *    is handed have to be the same thing, so the plan's `scaffold_request` is
 *    actually scaffolded here and the folder that comes out is checked against
 *    the recap's claims.
 * 3. **Intent is not activation.** Somebody who asked for a daily run gets a
 *    manual agent and a recap that says so. If that ever stops being true, an
 *    agent starts running on a schedule nobody switched on — the exact class
 *    of surprise ADR 0003 and ADR 0032 decision 2 exist to prevent.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentsRoot } from "../../../lib/agent-folders";
import { interviewAgent, planAgent, scaffoldAgent } from "../src/agent-tools";
import { repoRoot } from "../src/paths";
import { UNDESCRIBED_STEP } from "../src/interview";
import { scaffoldManifest, type FeedSource } from "../src/scaffold";

const NOW = new Date("2026-09-06T09:00:00.000Z");
const originalDataDir = process.env.DASH_DATA_DIR;

let scratch: string;
let project: string;
let counter: number;

beforeAll(() => {
  if (!existsSync(path.join(repoRoot(), "tools", "dash-mcp", "dist", "open-in-dash.mjs"))) {
    execFileSync(process.execPath, [path.join(repoRoot(), "tools", "dash-mcp", "build.mjs")], {
      cwd: repoRoot(),
      stdio: "pipe",
    });
  }
}, 60_000);

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "dash-mcp-plan-"));
  mkdirSync(agentsRoot(path.join(scratch, "data")), { recursive: true });
  process.env.DASH_DATA_DIR = path.join(scratch, "data");
  project = path.join(scratch, "project");
  mkdirSync(project, { recursive: true });
  counter = 0;
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

afterAll(() => {
  if (originalDataDir === undefined) {
    delete process.env.DASH_DATA_DIR;
  } else {
    process.env.DASH_DATA_DIR = originalDataDir;
  }
});

function ids(): () => string {
  return () => {
    counter += 1;
    return `draft-plan-${String(counter)}`;
  };
}

interface Plan {
  ok: boolean;
  recap?: {
    name: string;
    agent_id: string;
    summary: string;
    collects: string[];
    how_often: string;
    where_results_go: string;
    will_not_do: string[];
    route: { step: number; component_id: string; does: string }[];
    model_provider: string;
    model_provider_note: string;
  };
  scaffold_request?: {
    directory: string;
    name: string;
    display_name: string;
    summary: string;
    sources: FeedSource[];
    model_provider?: string;
  };
  remaining?: string[];
  refusal?: string;
}

/** Run a whole interview and hand back the finished plan. */
function interviewed(answers: Record<string, string>[]): { draftId: string; plan: Plan } {
  let draftId: string | undefined;
  for (const answer of answers) {
    const step = interviewAgent(
      { directory: project, draft_id: draftId, answers: answer },
      NOW,
      ids(),
    );
    expect(step.ok, JSON.stringify(step)).toBe(true);
    draftId = String(step["draft_id"]);
  }
  return {
    draftId: draftId!,
    plan: planAgent({ directory: project, draft_id: draftId! }, NOW) as unknown as Plan,
  };
}

const MANUAL_INTERVIEW: Record<string, string>[] = [
  { outcome: "keep an eye on AI news for me" },
  { sources: "the usual" },
  { result_format: "roundup_and_summary" },
  { trigger: "manual", autonomy: "tell_me" },
  { destination: "dash" },
];

/* ---------------------------------------------------------------------- *
 * 1. The route
 * ---------------------------------------------------------------------- */

describe("the recap's route", () => {
  it("is the manifest's planned_route, by value", () => {
    const { plan } = interviewed(MANUAL_INTERVIEW);
    expect(plan.ok).toBe(true);

    const request = plan.scaffold_request!;
    const manifest = scaffoldManifest({
      directory: request.directory,
      agent_id: request.name,
      display_name: request.display_name,
      summary: request.summary,
      sources: request.sources,
      now: NOW,
    });
    const route = manifest["planned_route"] as { step: number; component_id: string }[];

    expect(plan.recap!.route.map((step) => [step.step, step.component_id])).toEqual(
      route.map((step) => [step.step, step.component_id]),
    );
  });

  it("gives every step its own sentence, never the fallback", () => {
    // The fallback existed and two of the three steps were using it, because
    // the sentences were keyed off ids retyped by hand rather than off
    // `lib/agent-sources.ts`'s constants. A length check passed anyway. This
    // one is what would have caught it.
    const { plan } = interviewed(MANUAL_INTERVIEW);
    const sentences = plan.recap!.route.map((step) => step.does);
    expect(sentences).not.toContain(UNDESCRIBED_STEP);
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const step of plan.recap!.route) {
      expect(step.does).not.toContain(step.component_id);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * 2. The request
 * ---------------------------------------------------------------------- */

describe("the request the recap describes", () => {
  it("scaffolds a folder DASH's own validator accepts", () => {
    const { plan } = interviewed(MANUAL_INTERVIEW);
    const request = plan.scaffold_request!;

    // Handed on exactly as it stands. `scaffoldAgent` runs the manifest through
    // `verdictForManifest` before it writes and again from the bytes on disk;
    // the interview adds no validator of its own (ADR 0032 decision 4).
    const built = scaffoldAgent({ ...request, directory: path.join(project, "agent") }, NOW);
    expect(built.ok, JSON.stringify(built)).toBe(true);
    expect(built["manifest_valid"]).toBe(true);

    const written = JSON.parse(
      readFileSync(path.join(project, "agent", "agent.manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const agent = written["agent"] as { name: string; display_name: string; goal: string };
    expect(agent.name).toBe(plan.recap!.agent_id);
    expect(agent.display_name).toBe(plan.recap!.name);
    expect(agent.goal).toBe(plan.recap!.summary);
  });

  it("names every source the recap says it collects", () => {
    const { plan } = interviewed([
      { outcome: "watch AI news" },
      { sources: "Techcrunch - https://techcrunch.com/feed/\nhacker news" },
      { result_format: "roundup_and_summary" },
      { trigger: "manual", autonomy: "tell_me" },
      { destination: "dash" },
    ]);
    expect(plan.recap!.collects).toEqual(["Techcrunch", "Hacker News front page"]);
    expect(plan.scaffold_request!.sources.map((source) => source.name)).toEqual(
      plan.recap!.collects,
    );
  });

  it("refuses while anything is unanswered, and says what is missing", () => {
    const started = interviewAgent({ directory: project, answers: {} }, NOW, ids());
    const plan = planAgent(
      { directory: project, draft_id: String(started["draft_id"]) },
      NOW,
    ) as unknown as Plan;
    expect(plan.ok).toBe(false);
    expect(plan.remaining).toContain("outcome");
  });
});

/* ---------------------------------------------------------------------- *
 * 3. Intent is not activation
 * ---------------------------------------------------------------------- */

describe("somebody who asked for a daily run", () => {
  // The opening settles sources, result format and trigger; autonomy,
  // destination and then the host question are what is left.
  const DAILY: Record<string, string>[] = [
    { outcome: "every morning at 7, read the Hacker News front page and summarise it" },
    { autonomy: "tell_me" },
    { destination: "dash" },
    { cloud: "this_computer" },
  ];

  it("gets a manual agent, and a recap that says the schedule is theirs to switch on", () => {
    const { plan } = interviewed(DAILY);
    expect(plan.ok, JSON.stringify(plan)).toBe(true);
    expect(plan.recap!.how_often).toContain("07:00");
    expect(plan.recap!.how_often).toContain("only when you press Run");

    const built = scaffoldAgent(
      { ...plan.scaffold_request!, directory: path.join(project, "agent") },
      NOW,
    );
    expect(built.ok).toBe(true);

    const written = JSON.parse(
      readFileSync(path.join(project, "agent", "agent.manifest.json"), "utf8"),
    ) as Record<string, unknown>;
    const dom = written["agent_dom"] as { trigger: { type: string } };
    // The whole point. Nothing about wanting a schedule sets one.
    expect(dom.trigger.type).toBe("manual");
  });

  it("has no scheduled step in the route, which would be drift on every run", () => {
    const { plan } = interviewed(DAILY);
    for (const step of plan.recap!.route) {
      expect(step.component_id).not.toContain("schedule");
      expect(step.component_id).not.toContain("trigger");
    }
  });

  it("is told the daily run is what they asked for, in the agent's own goal", () => {
    const { plan } = interviewed(DAILY);
    expect(plan.recap!.summary).toContain("once a day");
  });
});

/* ---------------------------------------------------------------------- *
 * What it will not do
 * ---------------------------------------------------------------------- */

describe("the recap's what-it-will-not-do", () => {
  it("always says it starts idle and reaches nothing else, whatever was asked", () => {
    const { plan } = interviewed(MANUAL_INTERVIEW);
    const sentences = plan.recap!.will_not_do.join(" ");
    expect(sentences).toContain("starts idle");
    expect(sentences).toContain("reaches nothing else");
  });

  it("carries the unsupported thing that was asked for, with what to use instead", () => {
    const { plan } = interviewed([
      { outcome: "watch AI news" },
      { sources: "the usual" },
      { result_format: "roundup_and_summary" },
      { trigger: "manual", autonomy: "tell_me" },
      { destination: "slack" },
    ]);
    const slack = plan.recap!.will_not_do.find((line) => line.includes("Slack"));
    expect(slack).toBeDefined();
    expect(slack).toContain("Instead:");
  });

  it("says a source it could not turn into an address was left out", () => {
    const { plan } = interviewed([
      { outcome: "watch AI news" },
      { sources: "my competitor's blog\nhttps://techcrunch.com/feed/" },
      { result_format: "roundup_and_summary" },
      { trigger: "manual", autonomy: "tell_me" },
      { destination: "dash" },
    ]);
    expect(plan.recap!.collects).toEqual(["Techcrunch"]);
    expect(plan.recap!.will_not_do.join(" ")).toContain("my competitor's blog");
  });
});

/* ---------------------------------------------------------------------- *
 * Credentials
 * ---------------------------------------------------------------------- */

describe("credentials", () => {
  it("are never asked for and never written into the draft", () => {
    const { draftId, plan } = interviewed(MANUAL_INTERVIEW);
    const draft = readFileSync(
      path.join(project, ".dash", `interview-${draftId}.json`),
      "utf8",
    );
    for (const word of ["api_key", "apikey", "password", "token", "secret", "Bearer"]) {
      expect(draft.toLowerCase()).not.toContain(word.toLowerCase());
    }
    // A provider choice is a name, not a key, and the recap says so.
    expect(plan.recap!.model_provider).toBe("openrouter");
    expect(plan.recap!.model_provider_note).toContain("No key is asked for here");
  });

  it("carries a named provider through to the scaffold request", () => {
    const { plan } = interviewed([
      { outcome: "watch AI news, I already have Anthropic connected" },
      { sources: "the usual" },
      { result_format: "roundup_and_summary" },
      { trigger: "manual", autonomy: "tell_me" },
      { destination: "dash" },
    ]);
    expect(plan.scaffold_request!.model_provider).toBe("anthropic");
    expect(plan.recap!.model_provider).toBe("anthropic");
  });
});

/* ---------------------------------------------------------------------- *
 * Where the draft may live
 * ---------------------------------------------------------------------- */

describe("the draft file", () => {
  it("is refused inside DASH's own agents folder, like every other path here", () => {
    const inside = path.join(agentsRoot(process.env.DASH_DATA_DIR!), "somebody");
    const refused = interviewAgent({ directory: inside }, NOW, ids());
    expect(refused.ok).toBe(false);
    expect(String(refused["refusal"])).toContain("swaps");
    expect(existsSync(path.join(inside, ".dash"))).toBe(false);
  });
});
