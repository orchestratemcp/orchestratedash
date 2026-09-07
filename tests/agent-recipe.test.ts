/**
 * The build recipe (MAR-888, stage 2 of MAR-886).
 *
 * Three claims, and each section below is one of them executed rather than
 * described.
 *
 * 1. **Nothing is written by a build that refuses.** Every refusal
 *    `validateRecipe` and `planFromRecipe` make is exercised, and one test runs
 *    the real CLI against a folder with somebody's work in it and asserts the
 *    work is still there and nothing else is.
 * 2. **The definition and the manifest cannot come apart unnoticed.** A manifest
 *    edited by hand still passes DASH's own validator — that is the whole
 *    difficulty — and `checkRecipeAgainstManifest` is what notices.
 * 3. **A build brief becomes a running agent.** The fixture is put through
 *    validate, plan, files on disk, `validateManifest`, and then a real
 *    `Supervisor` spawns what was written and it produces a digest. That is the
 *    whole local path the stage was asked for, with no step taken on trust.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { run as runCli } from "../agent-kit/cli";
import {
  RECIPE_FILE_NAME,
  SDK_VERSION,
  agentBuilderDocument,
  checkRecipeAgainstManifest,
  defaultAcceptance,
  evalCases,
  manifestFromRecipe,
  planFromRecipe,
  readTargetState,
  validateRecipe,
  type AgentRecipe,
  type RecipeSources,
} from "../agent-kit/recipe";
import { recipeFor, type TemplateSources } from "../agent-kit/scaffold";
import { validateArtifact, validateManifest } from "../lib/contracts";
import { planSampleAgent } from "../lib/sample-agent";
import { Supervisor } from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KIT_TEMPLATE = path.join(repoRoot, "agent-kit", "template");
const TEMPLATE_AGENT = readFileSync(path.join(KIT_TEMPLATE, "agent.mjs"), "utf8");
const TEMPLATE_SDK = readFileSync(path.join(KIT_TEMPLATE, "dash-agent-sdk.mjs"), "utf8");
const TEMPLATE_EVALS = readFileSync(
  path.join(KIT_TEMPLATE, "evals", "run-evals.mjs"),
  "utf8",
);
const BUILD_BRIEF = JSON.parse(
  readFileSync(path.join(repoRoot, "tests", "fixtures", "build-brief.recipe.json"), "utf8"),
) as AgentRecipe;

const NOW = new Date("2026-09-07T09:00:00.000Z");

/** Hex of the right length, which is all `buildHandoff` asks of these. */
const IDS = { handoff_id: "a".repeat(32), nonce: "b".repeat(64) };

const roots: string[] = [];
const supervisors: Supervisor[] = [];

afterAll(async () => {
  for (const supervisor of supervisors) {
    supervisor.stopAll();
  }
  await waitFor(
    () =>
      supervisors.every((supervisor) =>
        supervisor.list().every((agentId) => supervisor.facts(agentId)?.pid === null),
      ),
    "generated agent processes to stop",
  );
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function temporary(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(directory);
  return directory;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/**
 * The real template bytes, with the `open-in-dash` bundle stubbed.
 *
 * The bundle is a build artifact (`pnpm build:agent-kit`) and `pnpm verify` must
 * not depend on one having been produced. Everything else here is the file that
 * actually ships.
 */
const SOURCES: RecipeSources = {
  agent: TEMPLATE_AGENT,
  sdk: TEMPLATE_SDK,
  evals: TEMPLATE_EVALS,
  openInDash: "// bundled by scripts/build-agent-kit.mjs\n",
  readme: "# a project\n",
  gitignore: "node_modules/\n",
};

const KIT_SOURCES: TemplateSources = {
  agent: TEMPLATE_AGENT,
  sdk: TEMPLATE_SDK,
  evals: TEMPLATE_EVALS,
  openInDash: "// bundled by scripts/build-agent-kit.mjs\n",
};

/** A recipe for an agent nothing is wrong with. */
function soundRecipe(): AgentRecipe {
  return recipeFor({
    directory: path.join(tmpdir(), "unused"),
    agent_id: "folder-digest",
    display_name: "Folder digest",
    summary: "Counts what is in its inbox folder and writes a short report.",
    kit_version: "0.1.1",
    now: NOW,
  });
}

/* ---------------------------------------------------------------------- *
 * One document, three writers
 * ---------------------------------------------------------------------- */

describe("the recipe", () => {
  it("pins the runtime version it names against the runtime file itself", () => {
    // Two copies of one number: `SDK_VERSION` in TypeScript, and the export in
    // the `.mjs` the scaffold actually writes. The recipe records the second
    // and can only be trusted if they are the same, so this is the only thing
    // standing between a bump in one and a recipe that lies about the other.
    const declared = /export const SDK_VERSION = "([^"]+)"/.exec(TEMPLATE_SDK);
    expect(declared?.[1]).toBe(SDK_VERSION);
    expect(soundRecipe().runtime.sdk_version).toBe(SDK_VERSION);
  });

  it("produces the manifest the scaffolders used to assemble by hand", () => {
    const manifest = manifestFromRecipe(soundRecipe(), NOW);
    const validated = validateManifest(manifest);
    expect(validated.ok).toBe(true);
  });

  it("gives the MCP's three-step agent a manifest DASH accepts too", () => {
    // The other writer, on the same planner. Its agent differs in every way a
    // recipe is allowed to differ — a third step, a second document, a declared
    // connection, a write permission, a four-section panel — and none of that
    // needs a second manifest assembler.
    const manifest = manifestFromRecipe(BUILD_BRIEF, NOW);
    const validated = validateManifest(manifest);
    if (!validated.ok) {
      throw new Error(validated.errors.join("\n"));
    }
    expect((manifest["planned_route"] as unknown[]).length).toBe(3);
  });

  it("keeps the shared skeleton out of every recipe", () => {
    // What is *not* on a recipe is the claim: an agent built by any of the
    // three declares the same runtime class, the same manual trigger and the
    // same four commands, because none of them gets to choose. A template that
    // varied these would teach every agent built from it to overstate itself.
    const kit = manifestFromRecipe(soundRecipe(), NOW) as Record<string, Record<string, unknown>>;
    const mcp = manifestFromRecipe(BUILD_BRIEF, NOW) as Record<string, Record<string, unknown>>;
    for (const block of ["safety_contract", "monitoring"]) {
      expect(kit[block]).toEqual(mcp[block]);
    }
    const kitDom = kit["agent_dom"] as Record<string, unknown>;
    const mcpDom = mcp["agent_dom"] as Record<string, unknown>;
    for (const block of ["runtime", "trigger", "control", "memory"]) {
      expect(kitDom[block]).toEqual(mcpDom[block]);
    }
  });

  it("writes itself into the project it describes", () => {
    const plan = planFromRecipe(soundRecipe(), SOURCES, {
      directory: path.join(temporary("dash-recipe-"), "folder-digest"),
      now: NOW,
    });
    if (!plan.ok) {
      throw new Error(plan.problem);
    }
    const written = plan.files.find((file) => file.path === RECIPE_FILE_NAME);
    expect(written).toBeDefined();
    // No absolute path anywhere in it: a recipe that carried the machine it was
    // built on could not be committed as a fixture or shared between two.
    expect(JSON.stringify(JSON.parse(written?.contents ?? "{}"))).not.toContain(tmpdir());
  });
});

/* ---------------------------------------------------------------------- *
 * Refusals
 * ---------------------------------------------------------------------- */

describe("what a recipe is refused for", () => {
  it("refuses an id that could not be a folder name", () => {
    const recipe = { ...soundRecipe(), agent: { ...soundRecipe().agent, id: "../escape" } };
    const verdict = validateRecipe(recipe, NOW);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.map((problem) => problem.where)).toContain("/agent/id");
  });

  it("refuses a dependency pinned to a range rather than a version", () => {
    // The reproducibility rule, enforced rather than documented: `latest` is
    // not a strategy, and neither is a caret.
    const sound = soundRecipe();
    const recipe: AgentRecipe = {
      ...sound,
      runtime: { ...sound.runtime, dependencies: { "some-parser": "^2.0.0" } },
    };
    const verdict = validateRecipe(recipe, NOW);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]?.constraint).toBe("exact_version");
  });

  it("refuses a brief with no digest to be about", () => {
    const sound = soundRecipe();
    const recipe: AgentRecipe = {
      ...sound,
      contract: { ...sound.contract, emits: [{ kind: "brief", artifact_version: 2 }] },
    };
    const verdict = validateRecipe(recipe, NOW);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.map((problem) => problem.constraint)).toContain("brief_needs_digest");
  });

  it("refuses a recipe missing any of the four acceptance cases", () => {
    const sound = soundRecipe();
    const recipe: AgentRecipe = {
      ...sound,
      acceptance: sound.acceptance.filter((entry) => entry.kind !== "denied_permission"),
    };
    const verdict = validateRecipe(recipe, NOW);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]?.problem).toContain("denied_permission");
  });

  it("carries DASH's own import verdict, not an imitation of it", () => {
    // A recipe whose panel binds a role no schema value allows. The complaint
    // has to come from `validateManifest`, addressed at the manifest, because a
    // second opinion about DASH's contract is a second contract.
    const sound = soundRecipe();
    const recipe: AgentRecipe = {
      ...sound,
      panel: { panel_version: 1, title: "Broken", sections: [{ id: "x", type: "nonsense" }] },
    };
    const verdict = validateRecipe(recipe, NOW);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.some((problem) => problem.where.startsWith("manifest:"))).toBe(true);
  });

  it("refuses a directory that is not a full path, and one that walks out", () => {
    // Written out rather than built with `path.join`, which normalises the
    // traversal away before the planner could ever be asked about it.
    for (const directory of ["relative/thing", `${tmpdir()}${path.sep}..${path.sep}elsewhere`]) {
      const plan = planFromRecipe(soundRecipe(), SOURCES, { directory, now: NOW });
      expect(plan.ok).toBe(false);
    }
  });

  it("refuses a folder that already has something in it", () => {
    const plan = planFromRecipe(soundRecipe(), SOURCES, {
      directory: path.join(tmpdir(), "somewhere"),
      now: NOW,
      target: { existing: ["notes.txt", "agent.mjs"], symlink: false },
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.problem).toContain("notes.txt");
    }
  });

  it("refuses a target that is a link to somewhere else", () => {
    // Not a theoretical worry: a scaffolder that follows a link writes into a
    // directory nobody named, and the refusal is the only place that can be
    // noticed before the bytes are gone.
    const plan = planFromRecipe(soundRecipe(), SOURCES, {
      directory: path.join(tmpdir(), "linked"),
      now: NOW,
      target: { existing: [], symlink: true },
    });
    expect(plan.ok).toBe(false);
  });

  it("refuses to write inside the folder DASH owns", () => {
    const agents = path.join(tmpdir(), "dash-data", "agents");
    const plan = planFromRecipe(soundRecipe(), SOURCES, {
      directory: path.join(agents, "folder-digest"),
      now: NOW,
      dashAgentsRoot: agents,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      // ADR 0008's failure, named: the write succeeds and the change does not
      // survive, which is invisible from the writer's side.
      expect(plan.problem).toContain("ADR 0008");
    }
  });

  it("will not let a build replace a file the author owns", () => {
    const plan = planFromRecipe(soundRecipe(), SOURCES, {
      directory: path.join(tmpdir(), "somewhere"),
      now: NOW,
      overwrite: ["agent.mjs"],
    });
    expect(plan.ok).toBe(false);
  });

  it("will not let a build name a file outside the project", () => {
    for (const candidate of ["../package.json", "C:\\windows\\system32", "a/../../b"]) {
      const plan = planFromRecipe(soundRecipe(), SOURCES, {
        directory: path.join(tmpdir(), "somewhere"),
        now: NOW,
        overwrite: [candidate],
      });
      expect(plan.ok).toBe(false);
    }
  });

  it("leaves no half-written project behind when it refuses", () => {
    // The property the whole "decide everything first" shape is for, proven
    // through the real command against a real disk: one file of somebody's, and
    // afterwards exactly that one file.
    const cwd = temporary("dash-recipe-cli-");
    const kitRoot = temporary("kit-");
    mkdirSync(path.join(kitRoot, "template", "evals"), { recursive: true });
    mkdirSync(path.join(kitRoot, "dist"), { recursive: true });
    writeFileSync(path.join(kitRoot, "template", "agent.mjs"), TEMPLATE_AGENT, "utf8");
    writeFileSync(path.join(kitRoot, "template", "dash-agent-sdk.mjs"), TEMPLATE_SDK, "utf8");
    writeFileSync(
      path.join(kitRoot, "template", "evals", "run-evals.mjs"),
      TEMPLATE_EVALS,
      "utf8",
    );
    writeFileSync(path.join(kitRoot, "dist", "open-in-dash.mjs"), "// stub\n", "utf8");

    const directory = path.join(cwd, "mine");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "notes.txt"), "a year of work\n", "utf8");

    const result = runCli(["mine"], { kitRoot, kitVersion: "0.1.1", cwd, now: NOW });

    expect(result.code).toBe(1);
    expect(readdirSync(directory)).toEqual(["notes.txt"]);
    expect(readFileSync(path.join(directory, "notes.txt"), "utf8")).toBe("a year of work\n");
  });

  it("reads what is really at a target, including that it is not a link", () => {
    const directory = path.join(temporary("dash-recipe-"), "made");
    expect(readTargetState(directory)).toEqual({ existing: [], symlink: false });
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "one.txt"), "", "utf8");
    expect(readTargetState(directory)).toEqual({ existing: ["one.txt"], symlink: false });
  });
});

/* ---------------------------------------------------------------------- *
 * Drift
 * ---------------------------------------------------------------------- */

describe("the recipe against the manifest", () => {
  it("agrees with the manifest it just generated", () => {
    const recipe = soundRecipe();
    expect(checkRecipeAgainstManifest(recipe, manifestFromRecipe(recipe, NOW))).toEqual([]);
  });

  it("notices a route edited in the manifest, which still validates", () => {
    const recipe = soundRecipe();
    const manifest = manifestFromRecipe(recipe, NOW) as Record<string, unknown>;
    (manifest["planned_route"] as Array<Record<string, unknown>>)[1]!["component_id"] =
      "something_else";

    // The difficulty, stated: this document is still perfectly valid. Nothing
    // DASH validates would say a word about it, and every run from now on would
    // be graded against a step the program does not take.
    expect(validateManifest(manifest).ok).toBe(true);

    const drift = checkRecipeAgainstManifest(recipe, manifest);
    expect(drift.map((entry) => entry.where)).toEqual(["/planned_route"]);
    expect(drift[0]?.manifest).toContain("something_else");
  });

  it("notices a connection added to the manifest and not to the recipe", () => {
    const recipe = soundRecipe();
    const manifest = manifestFromRecipe(recipe, NOW) as Record<string, unknown>;
    const dom = manifest["agent_dom"] as Record<string, unknown>;
    dom["connections"] = [
      { id: "model_provider", provider: "openrouter", ownership: "dash_managed" },
    ];
    const drift = checkRecipeAgainstManifest(recipe, manifest);
    expect(drift.map((entry) => entry.where)).toContain("/agent_dom/connections");
  });

  it("notices a panel binding a document the run never emits", () => {
    const recipe = soundRecipe();
    const manifest = manifestFromRecipe(recipe, NOW) as Record<string, unknown>;
    const dom = manifest["agent_dom"] as Record<string, unknown>;
    const panel = dom["panel"] as Record<string, unknown>;
    (panel["sections"] as Array<Record<string, unknown>>)[0]!["artifact_role"] = "brief";
    const drift = checkRecipeAgainstManifest(recipe, manifest);
    expect(drift.map((entry) => entry.where)).toContain("/agent_dom/panel");
  });

  it("says so plainly when handed something that is not a manifest at all", () => {
    expect(checkRecipeAgainstManifest(soundRecipe(), "not a document")).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------------- *
 * The sample is a recipe too
 * ---------------------------------------------------------------------- */

describe("DASH's own sample", () => {
  it("writes a recipe and a manifest that agree with each other", () => {
    // The sample amends the *recipe* rather than the finished manifest, and
    // this is why: before MAR-888 it rewrote the manifest afterwards, which
    // would now produce a folder DASH's own check calls drifted on the day it
    // was created.
    const planned = planSampleAgent({
      parentDir: path.join(tmpdir(), "DASH agents"),
      sources: KIT_SOURCES,
      kitVersion: "0.1.1",
      now: NOW,
      ids: IDS,
      taken: [],
    });
    if (!planned.ok) {
      throw new Error(planned.problem);
    }
    const contentsOf = (name: string): string =>
      planned.value.files.find((file) => file.path === name)?.contents ?? "";

    const recipe = JSON.parse(contentsOf(RECIPE_FILE_NAME)) as AgentRecipe;
    const manifest = JSON.parse(contentsOf("agent.manifest.json")) as unknown;

    expect(checkRecipeAgainstManifest(recipe, manifest)).toEqual([]);
    // And the two declarations DASH is entitled to make on its own behalf are
    // in the recipe, where the next build will find them.
    expect(recipe.connections.map((connection) => connection["id"])).toEqual(["model_provider"]);
    expect(
      recipe.steps.find((step) => step.component_id === "local_file_write")?.default_model_level,
    ).toBe("cheap");
  });

  it("is the Agent Kit's agent plus exactly those declarations", () => {
    // "The CLI and the installed sample use the same generator", made
    // structural: every file the sample writes is byte-identical to the kit's
    // for the same request, except the two documents the amendment touches and
    // the handoff the sample adds.
    const request = {
      directory: path.join(tmpdir(), "DASH agents", "ai-news-scout"),
      agent_id: "ai-news-scout",
      display_name: "AI News Scout",
      summary:
        "Reads the news sources you choose and writes you a short summary of what is new, with a link to where each item came from.",
      kit_version: "0.1.1",
      now: NOW,
    };
    const kit = planFromRecipe(recipeFor(request), SOURCES, {
      directory: request.directory,
      now: NOW,
    });
    const sample = planSampleAgent({
      parentDir: path.join(tmpdir(), "DASH agents"),
      sources: KIT_SOURCES,
      kitVersion: "0.1.1",
      now: NOW,
      ids: IDS,
      taken: [],
    });
    if (!kit.ok || !sample.ok) {
      throw new Error("neither of these should be able to fail");
    }

    const differing = kit.files
      .filter((file) => {
        const theirs = sample.value.files.find((other) => other.path === file.path);
        return theirs === undefined || theirs.contents !== file.contents;
      })
      .map((file) => file.path);

    // README and .gitignore are rendered by the scaffolder rather than by the
    // recipe, and this test hands the kit a stub for both — so they are
    // excluded here rather than pretended to be equal.
    expect(differing.filter((name) => name !== "README.md" && name !== ".gitignore")).toEqual([
      "agent.manifest.json",
      RECIPE_FILE_NAME,
    ]);
  });
});

/* ---------------------------------------------------------------------- *
 * The generated instructions and checks
 * ---------------------------------------------------------------------- */

describe("what a coding assistant is handed", () => {
  it("says which files are the author's and which are DASH's", () => {
    const document = agentBuilderDocument(soundRecipe());
    expect(document).toContain("agent.mjs");
    expect(document).toContain("dash-agent-sdk.mjs");
    expect(document).toContain(RECIPE_FILE_NAME);
    // The two sentences that are not true of this runtime, said out loud,
    // because a document that implied either would be teaching the next author
    // something ADR 0034 decision 5 forbids.
    expect(document).toContain("not a sandbox");
    expect(document).toContain("No credential is ever in this folder");
  });

  it("names every step the recipe plans, in order", () => {
    const document = agentBuilderDocument(BUILD_BRIEF);
    const positions = BUILD_BRIEF.steps.map((step) => document.indexOf(step.component_id));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("hands the checks the four cases and the route to hold the run to", () => {
    const cases = evalCases(BUILD_BRIEF) as Record<string, unknown>;
    expect((cases["cases"] as unknown[]).length).toBe(4);
    expect(cases["steps"]).toEqual(
      BUILD_BRIEF.steps.map((step) => ({ component_id: step.component_id, intent: step.intent })),
    );
    expect(cases["emits"]).toEqual(BUILD_BRIEF.contract.emits);
  });

  it("describes what the run emits in the case it is about", () => {
    const [normal] = defaultAcceptance([{ kind: "digest" }, { kind: "brief" }]);
    expect(normal?.expect).toContain("digest and a brief");
  });

  it("writes checks that need no registry", () => {
    // The same rule the runtime keeps (ADR 0034), for the same reason: a
    // project with an empty dependency list cannot run a check that imports
    // anything from one.
    const imports = [...TEMPLATE_EVALS.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
    expect(imports.every((specifier) => specifier?.startsWith("node:"))).toBe(true);
  });
});

/* ---------------------------------------------------------------------- *
 * A build brief, all the way to a run
 * ---------------------------------------------------------------------- */

describe("a build brief becomes an agent that runs", () => {
  it("goes from recipe to a digest, with nothing taken on trust", { timeout: 30_000 }, async () => {
    const verdict = validateRecipe(BUILD_BRIEF, NOW);
    if (!verdict.ok) {
      throw new Error(JSON.stringify(verdict.problems, null, 2));
    }

    const directory = path.join(temporary("dash-brief-"), BUILD_BRIEF.agent.id);
    const plan = planFromRecipe(BUILD_BRIEF, SOURCES, {
      directory,
      now: NOW,
      target: readTargetState(directory),
    });
    if (!plan.ok) {
      throw new Error(plan.problem);
    }
    for (const file of plan.files) {
      const target = path.join(directory, ...file.path.split("/"));
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, file.contents, "utf8");
    }

    // The manifest, read back off the disk rather than out of the plan: a
    // serialiser that lost something between the two is exactly the defect a
    // plan-only check cannot see.
    const manifestPath = path.join(directory, "agent.manifest.json");
    const written = validateManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    if (!written.ok) {
      throw new Error(written.errors.join("\n"));
    }
    expect(existsSync(path.join(directory, "evals", "run-evals.mjs"))).toBe(true);
    expect(existsSync(path.join(directory, "AGENT_BUILDER.md"))).toBe(true);

    // No sources, so this run reaches no network. The fixture's two addresses
    // are `example.invalid` on purpose, and a suite that depended on them
    // resolving would be a suite that fails on somebody else's machine.
    writeFileSync(path.join(directory, "sources.json"), `{ "sources": [] }\n`, "utf8");

    const supervisor = new Supervisor(
      [
        {
          agent_id: BUILD_BRIEF.agent.id,
          manifest_path: manifestPath,
          command: process.execPath,
          args: [path.join(directory, "agent.mjs")],
          cwd: directory,
        },
      ],
      () => {},
    );
    supervisors.push(supervisor);
    supervisor.start(BUILD_BRIEF.agent.id);

    await waitFor(
      () => supervisor.report(BUILD_BRIEF.agent.id) !== null,
      "the agent to publish what it is",
    );
    const asked = await supervisor.deliver(BUILD_BRIEF.agent.id, {
      command_id: "cmd-brief-1",
      command: "retry",
      target: { agent_id: BUILD_BRIEF.agent.id, task_id: "waiting-to-be-run" },
    });
    expect(asked).toMatchObject({ ok: true });

    // Drained into a local list because draining empties the buffer: polling it
    // inside the predicate would throw away the artifact the next poll waits for.
    const drained: Array<Record<string, unknown>> = [];
    await waitFor(() => {
      for (const entry of supervisor.drainArtifacts().artifacts) {
        drained.push(entry.artifact as Record<string, unknown>);
      }
      return drained.some((artifact) => artifact["kind"] === "digest");
    }, "the generated agent to hand DASH a digest");

    const digest = drained.find((artifact) => artifact["kind"] === "digest");
    expect(validateArtifact(digest)).toMatchObject({ ok: true });
    expect(digest?.["agent"]).toBe(BUILD_BRIEF.agent.id);
  });
});
