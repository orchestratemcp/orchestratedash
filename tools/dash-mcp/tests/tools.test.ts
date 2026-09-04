/**
 * The three tools, end to end on a real disk (MAR-862).
 *
 * The first block is ADR 0032 decision 1 and is the most important thing in
 * this file: a tool that will happily write into `<dataDir>/agents/` produces a
 * defect nobody can see — the write succeeds, the change is discarded on the
 * next import, and there is no error anywhere. It cannot be caught downstream,
 * so it is caught here.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentsRoot } from "../../../lib/agent-folders";
import { validateManifest } from "../../../lib/contracts";
import { installAgent, scaffoldAgent, validateAgent } from "../src/agent-tools";
import { repoRoot } from "../src/paths";

let scratch: string;
let dataDir: string;
const originalDataDir = process.env.DASH_DATA_DIR;

/**
 * The scaffold copies the bundled `open-in-dash.mjs` into every project, and
 * `dist/` is not committed — see ADR 0032 decision 4 on why a build product of
 * DASH's validator must not be. Building it here keeps
 * `pnpm vitest run tools/dash-mcp` self-contained.
 */
beforeAll(() => {
  if (!existsSync(path.join(repoRoot(), "tools", "dash-mcp", "dist", "open-in-dash.mjs"))) {
    execFileSync(process.execPath, [path.join(repoRoot(), "tools", "dash-mcp", "build.mjs")], {
      cwd: repoRoot(),
      stdio: "pipe",
    });
  }
}, 60_000);

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "dash-mcp-"));
  dataDir = path.join(scratch, "data");
  mkdirSync(agentsRoot(dataDir), { recursive: true });
  process.env.DASH_DATA_DIR = dataDir;
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

function scaffold(directory: string) {
  return scaffoldAgent({
    directory,
    name: "example-agent",
    display_name: "Example agent",
    summary: "Reads a few public sources and says what came in.",
  });
}

describe("the folder DASH owns", () => {
  it("is refused as a scaffold target, and nothing is written", () => {
    const inside = path.join(agentsRoot(dataDir), "example-agent");
    const result = scaffold(inside);

    expect(result.ok).toBe(false);
    expect(String(result.refusal)).toContain("swaps");
    expect(existsSync(path.join(inside, "agent.manifest.json"))).toBe(false);
  });

  it("is refused as an install target", () => {
    const inside = path.join(agentsRoot(dataDir), "example-agent");
    mkdirSync(inside, { recursive: true });
    const result = installAgent({ directory: inside, open: false });

    expect(result.ok).toBe(false);
    expect(String(result.refusal)).toContain("swaps");
  });

  it("refuses the data directory itself, not only the agents folder inside it", () => {
    const result = scaffold(path.join(dataDir, "somewhere"));
    expect(result.ok).toBe(false);
  });

  /**
   * The separator rule. A naive `startsWith` would read
   * `…/orchestratedash-elsewhere` as being inside `…/orchestratedash`, and
   * refuse an ordinary project folder for a reason its owner could not act on.
   */
  it("does not refuse a directory whose name merely starts the same way", () => {
    const result = scaffold(`${dataDir}-elsewhere`);
    expect(result.ok).toBe(true);
  });
});

describe("dash_agent_scaffold", () => {
  it("writes a folder whose manifest passes DASH's validator", () => {
    const directory = path.join(scratch, "project");
    const result = scaffold(directory);

    expect(result.ok).toBe(true);
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(directory, "agent.manifest.json"), "utf8"),
    );
    expect(validateManifest(manifest).ok).toBe(true);
  });

  it("writes the program and the fingerprint mirror the program imports", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);

    expect(existsSync(path.join(directory, "agent.mjs"))).toBe(true);
    expect(existsSync(path.join(directory, "brief-fingerprint.mjs"))).toBe(true);
    expect(existsSync(path.join(directory, "scripts", "open-in-dash.mjs"))).toBe(true);
    expect(readFileSync(path.join(directory, "agent.mjs"), "utf8")).toContain(
      "./brief-fingerprint.mjs",
    );
  });

  it("refuses to scaffold over an agent that is already there", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);
    const again = scaffold(directory);

    expect(again.ok).toBe(false);
    expect(String(again.refusal)).toContain("already exists");
  });

  it("says when it had to change the name it was given", () => {
    const directory = path.join(scratch, "project");
    const result = scaffoldAgent({
      directory,
      name: "My Agent!",
      summary: "Reads a few public sources.",
    });

    expect(result.ok).toBe(true);
    expect(result.agent).toBe("my-agent");
    expect(result.renamed).toEqual({ asked: "My Agent!", using: "my-agent" });
  });

  it("refuses a name with nothing usable in it", () => {
    const result = scaffoldAgent({
      directory: path.join(scratch, "project"),
      name: "!!!",
      summary: "Reads a few public sources.",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a relative directory rather than resolving it against a cwd nobody chose", () => {
    const result = scaffoldAgent({
      directory: "relative/path",
      name: "example-agent",
      summary: "Reads a few public sources.",
    });
    expect(result.ok).toBe(false);
    expect(String(result.refusal)).toContain("full path");
  });
});

describe("dash_agent_validate", () => {
  it("passes a folder the scaffold wrote", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);
    expect(validateAgent({ directory }).ok).toBe(true);
  });

  it("checks a manifest that is not a file yet", () => {
    const result = validateAgent({ manifest: { manifest_version: 2, agent: { name: "x" } } });
    expect(result.ok).toBe(false);
    expect(Array.isArray(result.problems)).toBe(true);
  });

  it("says there is no agent, rather than failing obscurely, on an empty directory", () => {
    const result = validateAgent({ directory: scratch });
    expect(result.ok).toBe(false);
    expect(String(result.refusal)).toContain("no agent");
  });

  /**
   * ADR 0008's manifest-only standing. Importable, not startable — a real
   * outcome rather than an error, so it is a note and never a refusal.
   */
  it("notes a folder with no program without refusing it", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);
    rmSync(path.join(directory, "agent.mjs"));

    const result = validateAgent({ directory });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.notes)).toContain("cannot run it");
  });
});

describe("dash_agent_install", () => {
  it("writes a handoff and a dash:// url for a valid folder", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);

    const result = installAgent({ directory, open: false });
    expect(result.ok).toBe(true);
    expect(String(result.url)).toMatch(/^dash:\/\/handoff\?/);
    expect(existsSync(path.join(directory, "dash-handoff.json"))).toBe(true);
  });

  it("offers DASH every file the agent needs, including the one the kit's list omits", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);

    const result = installAgent({ directory, open: false });
    expect(result.files).toEqual(
      expect.arrayContaining([
        "agent.manifest.json",
        "agent.mjs",
        "brief-fingerprint.mjs",
        "package.json",
        "scripts/open-in-dash.mjs",
        "sources.json",
      ]),
    );
  });

  it("leaves a run's own output behind, because it is not part of the agent", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);
    mkdirSync(path.join(directory, "reports"), { recursive: true });
    writeFileSync(path.join(directory, "reports", "one.md"), "# a run\n", "utf8");
    mkdirSync(path.join(directory, "runs"), { recursive: true });
    writeFileSync(path.join(directory, "runs", "events.jsonl"), "{}\n", "utf8");

    const result = installAgent({ directory, open: false });
    expect(result.ok).toBe(true);
    expect(String(JSON.stringify(result.files))).not.toContain("reports/");
    expect(String(JSON.stringify(result.files))).not.toContain("runs/");
  });

  it("refuses an invalid agent and writes no handoff at all", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);
    writeFileSync(
      path.join(directory, "agent.manifest.json"),
      JSON.stringify({ manifest_version: 2, agent: { name: "example-agent" } }),
      "utf8",
    );

    const result = installAgent({ directory, open: false });
    expect(result.ok).toBe(false);
    expect(String(result.refusal)).toContain("no handoff was written");
    expect(existsSync(path.join(directory, "dash-handoff.json"))).toBe(false);
  });

  it("does not carry a previous handoff's nonce into the next one", () => {
    const directory = path.join(scratch, "project");
    scaffold(directory);

    installAgent({ directory, open: false });
    const first = readFileSync(path.join(directory, "dash-handoff.json"), "utf8");
    installAgent({ directory, open: false });
    const second = readFileSync(path.join(directory, "dash-handoff.json"), "utf8");

    expect(first).not.toBe(second);
    expect(JSON.stringify(JSON.parse(second))).not.toContain(
      (JSON.parse(first) as { nonce: string }).nonce,
    );
  });
});
