/**
 * That the state gate can fail (MAR-465).
 *
 * `scripts/check-project-state.mjs` was red on master for three merges and said
 * nothing true while it was: `actions/checkout@v4` shallow-clones, no recorded
 * commit is an ancestor of a one-commit HEAD, and every issue reported INVALID
 * at once. `pnpm verify` never reached typecheck or the suite behind it.
 *
 * The fix is `fetch-depth: 0`, which is a line in a workflow no test can see. So
 * what is testable — and what actually needed proving before trading a false red
 * for a false green — is the other half: that `INVALID` now means the packet is
 * wrong, that a shallow clone is reported as unchecked rather than invalid, and
 * that "unchecked" can never be the quiet answer in CI.
 *
 * These build throwaway repositories rather than reading the real one. A gate
 * asserted against the packet that currently passes is a gate nobody has seen
 * fail.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "check-project-state.mjs");

const scratch = mkdtempSync(path.join(tmpdir(), "dash-state-check-"));

/**
 * Each case builds a git repository and runs the gate in a grandchild process.
 * That is a lot of process spawning for Windows to do while the rest of the
 * suite is running, and the 5s default expires long before anything is wrong —
 * which would be this file failing for the reason it exists to catch elsewhere.
 */
const SPAWNS_PROCESSES = 60_000;

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function git(cwd: string, args: string[]): string {
  // stderr is dropped: building the fixtures emits detached-HEAD and line-ending
  // advice that would bury the assertions these tests are actually about.
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

type Packet = {
  schema_version?: number;
  project?: string;
  current_wave?: string;
  git?: { evidence_base_commit?: string };
  issues?: Array<Record<string, unknown>>;
};

function writePacket(root: string, packet: Packet): void {
  mkdirSync(path.join(root, ".orchestrate"), { recursive: true });
  writeFileSync(
    path.join(root, ".orchestrate", "state.json"),
    `${JSON.stringify(packet, null, 2)}\n`,
    "utf8",
  );
}

/**
 * A repository with two real commits, so "not an ancestor" and "not in this
 * repository" are distinguishable facts rather than the same git exit code.
 */
function originRepo(name: string): { root: string; first: string; second: string; orphan: string } {
  const root = path.join(scratch, name);
  mkdirSync(root, { recursive: true });
  git(root, ["init", "--initial-branch=master"]);
  git(root, ["config", "user.email", "gate@test.invalid"]);
  git(root, ["config", "user.name", "Gate Test"]);
  git(root, ["config", "commit.gpgsign", "false"]);

  writeFileSync(path.join(root, "one.txt"), "one\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "first"]);
  const first = git(root, ["rev-parse", "HEAD"]);

  writeFileSync(path.join(root, "two.txt"), "two\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "second"]);
  const second = git(root, ["rev-parse", "HEAD"]);

  // A commit that exists here but is on no branch master can reach: the shape
  // of a packet citing work that was rebased away or never merged.
  git(root, ["checkout", "--detach", first]);
  writeFileSync(path.join(root, "side.txt"), "side\n", "utf8");
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "orphan"]);
  const orphan = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "master"]);

  return { root, first, second, orphan };
}

/** Runs the gate and returns its exit code with combined output. */
function gate(
  root: string,
  env: Record<string, string | undefined> = {},
): { code: number; out: string } {
  const child = execFileSync(
    process.execPath,
    ["-e", captureRunner()],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: undefined,
        ...env,
        GATE_SCRIPT: script,
        GATE_ROOT: root,
      } as NodeJS.ProcessEnv,
    },
  );
  const parsed = JSON.parse(child) as { code: number; out: string };
  return parsed;
}

/**
 * Runs the gate as a child of a child so a non-zero exit is data rather than an
 * exception, and stdout and stderr arrive interleaved the way a reader sees them.
 */
function captureRunner(): string {
  return `
    const { spawnSync } = require("node:child_process");
    const env = { ...process.env };
    if (env.GATE_CI === "1") { env.CI = "true"; } else { delete env.CI; }
    const r = spawnSync(process.execPath, [env.GATE_SCRIPT, env.GATE_ROOT], {
      encoding: "utf8",
      env,
    });
    process.stdout.write(JSON.stringify({ code: r.status, out: (r.stdout || "") + (r.stderr || "") }));
  `;
}

describe("the state gate on a full clone", () => {
  it("passes a packet whose commits are all ancestors of HEAD", () => {
    const { root, first, second } = originRepo("valid");
    writePacket(root, {
      schema_version: 1,
      project: "DASH",
      current_wave: "test",
      git: { evidence_base_commit: second },
      issues: [
        { id: "MAR-1", lifecycle: "merged", linear_status: "Done", commit: first },
        {
          id: "MAR-2",
          lifecycle: "proven",
          linear_status: "Done",
          commit: second,
          proof: { command: "pnpm verify" },
        },
      ],
    });

    const { code, out } = gate(root);
    expect(out).not.toContain("INVALID");
    expect(out).not.toContain("UNVERIFIED");
    expect(code).toBe(0);
  }, SPAWNS_PROCESSES);

  it("fails a packet citing a commit that is not in the repository at all", () => {
    // The case a shallow clone was being mistaken for. It must stay INVALID.
    const { root, second } = originRepo("fabricated");
    writePacket(root, {
      schema_version: 1,
      project: "DASH",
      current_wave: "test",
      git: { evidence_base_commit: second },
      issues: [
        {
          id: "MAR-3",
          lifecycle: "merged",
          linear_status: "Done",
          commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        },
      ],
    });

    const { code, out } = gate(root);
    expect(out).toContain("INVALID");
    expect(out).toContain("MAR-3");
    expect(out).toContain("not a commit in this repository");
    expect(code).toBe(1);
  }, SPAWNS_PROCESSES);

  it("fails a packet citing a real commit HEAD cannot reach", () => {
    const { root, second, orphan } = originRepo("orphaned");
    writePacket(root, {
      schema_version: 1,
      project: "DASH",
      current_wave: "test",
      git: { evidence_base_commit: second },
      issues: [
        { id: "MAR-4", lifecycle: "proven", linear_status: "Done", commit: orphan, proof: { command: "pnpm verify" } },
      ],
    });

    const { code, out } = gate(root);
    expect(out).toContain("INVALID");
    expect(out).toContain("is not an ancestor of HEAD");
    expect(code).toBe(1);
  }, SPAWNS_PROCESSES);

  it("fails a proven issue with no reproducible proof command", () => {
    const { root, first, second } = originRepo("unproven");
    writePacket(root, {
      schema_version: 1,
      project: "DASH",
      current_wave: "test",
      git: { evidence_base_commit: second },
      issues: [{ id: "MAR-5", lifecycle: "proven", linear_status: "Done", commit: first }],
    });

    const { code, out } = gate(root);
    expect(out).toContain("INVALID");
    expect(out).toContain("proven without a reproducible proof command");
    expect(code).toBe(1);
  }, SPAWNS_PROCESSES);
});

describe("the state gate on a shallow clone", () => {
  function shallowClone(name: string): { root: string; first: string; second: string } {
    const origin = originRepo(`${name}-origin`);
    const root = path.join(scratch, name);
    execFileSync(
      "git",
      ["clone", "--depth", "1", `file://${origin.root.split(path.sep).join("/")}`, root],
      { cwd: scratch, stdio: "ignore" },
    );
    return { root, first: origin.first, second: origin.second };
  }

  it("reports an unfetched commit as unchecked, not as invalid", () => {
    /*
     * The regression this whole issue is. `first` is a real commit and a real
     * ancestor; a one-commit clone simply cannot see it. Calling that INVALID
     * is a claim about the packet that the checkout has no standing to make.
     */
    const { root, first, second } = shallowClone("shallow-tolerant");
    writePacket(root, {
      schema_version: 1,
      project: "DASH",
      current_wave: "test",
      git: { evidence_base_commit: second },
      issues: [{ id: "MAR-6", lifecycle: "merged", linear_status: "Done", commit: first }],
    });

    const { code, out } = gate(root);
    expect(out).toContain("UNVERIFIED");
    expect(out).toContain("history unavailable, ancestry not checked");
    expect(out).not.toContain("INVALID");
    expect(out).toContain("not ancestry evidence");
    expect(code).toBe(0);
  }, SPAWNS_PROCESSES);

  it("still fails a packet that is wrong for reasons a shallow clone can see", () => {
    /*
     * Tolerating the thin checkout must not become tolerating everything. The
     * proof-command rule needs no history, so it still binds.
     */
    const { root, first, second } = shallowClone("shallow-strict");
    writePacket(root, {
      schema_version: 1,
      project: "DASH",
      current_wave: "test",
      git: { evidence_base_commit: second },
      issues: [{ id: "MAR-7", lifecycle: "proven", linear_status: "Done", commit: first }],
    });

    const { code, out } = gate(root);
    expect(out).toContain("INVALID");
    expect(out).toContain("proven without a reproducible proof command");
    expect(code).toBe(1);
  }, SPAWNS_PROCESSES);

  it("refuses to run shallow in CI at all", () => {
    /*
     * The guard that keeps this fix from becoming the failure it replaced. In
     * CI the workflow owns `fetch-depth: 0`; if that line is ever removed the
     * gate must say the gate is broken, not quietly pass having checked nothing.
     * Without this, deleting one workflow line would turn a false red into a
     * false green, which is strictly worse.
     */
    const { root, first, second } = shallowClone("shallow-ci");
    writePacket(root, {
      schema_version: 1,
      project: "DASH",
      current_wave: "test",
      git: { evidence_base_commit: second },
      issues: [
        {
          id: "MAR-8",
          lifecycle: "merged",
          linear_status: "Done",
          commit: first,
        },
      ],
    });

    const { code, out } = gate(root, { GATE_CI: "1" });
    expect(out).toContain("INVALID");
    expect(out).toContain("shallow clone in CI");
    expect(out).toContain("fetch-depth: 0");
    expect(code).toBe(1);
  }, SPAWNS_PROCESSES);
});
