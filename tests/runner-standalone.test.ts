/**
 * The standalone runner, started the way a host would start it (MAR-497).
 *
 * ADR 0007's account of what CI can and cannot prove about a remote host is
 * precise, and this file sits on the provable side of it. What stays unproven
 * here is `ssh`, the deploy verbs and somebody's VPS; what is proven is that
 * **the built artifact starts under a plain Node with no Electron anywhere, on
 * a directory tree that contains nothing but the artifact itself**, serves the
 * task route over its OS-local endpoint, and stops through the authenticated
 * route rather than a signal.
 *
 * ## The copy out of the repository is the test
 *
 * `lib/contracts.ts` finds its schemas by walking up from its own module
 * location. Run in place, `dist/runner-standalone/` sits under a repository
 * that has a `contracts/` directory at its root — so an artifact that shipped
 * no schemas at all would start perfectly, and would fail on somebody's host
 * the first time an agent was asked to run. Copying the artifact to a temporary
 * directory removes the repository from above it, which is the only way this
 * test can tell the two apart. The assertion on the `contracts:` line the
 * runner prints is what turns that from a hope into a check: it must name the
 * artifact's own directory.
 *
 * `DASH_CONTRACTS_DIR` is deliberately stripped from the child's environment
 * for the same reason. It is the documented override, so a machine that
 * happened to have it set would make this test pass having proven nothing.
 *
 * ## Why the build runs here rather than being a prerequisite
 *
 * A test that skipped when `dist/` was missing would be a test that passes on
 * every machine that has never built the thing. It costs under a second: two
 * esbuild bundles and a directory copy.
 */

import { execFileSync } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { computeRunnerBuildId } from "../scripts/runner-build-id.mjs";

import { ipcFetch, IPC_ORIGIN } from "../lib/agent-dom/ipc-fetch";
import {
  checkNodeVersion,
  defaultDataDir,
  describeMissingSqlite,
  HOST_UNSUITABLE_EXIT,
  MINIMUM_HOST_NODE_MAJOR,
  nodeMajor,
} from "../runner/host-runtime";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------------------------------------------- *
 * The rules, on any platform
 * ---------------------------------------------------------------------- */

describe("what a host must provide", () => {
  it("reads a major version out of both spellings, and refuses to guess at a third", () => {
    expect(nodeMajor("24.13.1")).toBe(24);
    expect(nodeMajor("v22.5.0")).toBe(22);
    expect(nodeMajor("bun-1.2")).toBeNull();
  });

  it("refuses a Node below the floor, naming the version found and the version needed", () => {
    const refusal = checkNodeVersion("22.5.0");
    expect(refusal?.problem).toBe("node_too_old");
    expect(refusal?.detail).toContain("22.5.0");
    expect(refusal?.detail).toContain(String(MINIMUM_HOST_NODE_MAJOR));
  });

  it("says nothing from the version alone when the version is at or above the floor", () => {
    expect(checkNodeVersion(`${String(MINIMUM_HOST_NODE_MAJOR)}.0.0`)).toBeNull();
    expect(checkNodeVersion(`${String(MINIMUM_HOST_NODE_MAJOR + 1)}.2.3`)).toBeNull();
  });

  /**
   * A version string this module cannot parse is not a refusal, and that is the
   * interesting half. The module probe in `runner/standalone.ts` is a fact
   * about the runtime; a regex over a string the runtime chose for itself is
   * not, and refusing on it would turn "we could not read your version" into
   * "your host is unsuitable".
   */
  it("does not refuse a runtime whose version string it cannot read", () => {
    expect(checkNodeVersion("not-a-version")).toBeNull();
  });

  it("keeps the missing-SQLite refusal a different sentence from the old-Node one", () => {
    const missing = describeMissingSqlite("24.0.0", "Cannot find module 'node:sqlite'");
    expect(missing.problem).toBe("no_sqlite");
    // The runtime's own words are carried rather than replaced: they are the
    // only part of the diagnosis this project did not write.
    expect(missing.detail).toContain("Cannot find module 'node:sqlite'");
    expect(missing.detail).not.toBe(checkNodeVersion("20.0.0")?.detail);
  });

  it("puts the host's state under the user's own home, needing no privilege", () => {
    expect(defaultDataDir("/home/dash")).toBe(path.join("/home/dash", ".orchestratedash", "runner"));
  });

  /**
   * 78 is `EX_CONFIG`. The number matters because a deploy helper's `start`
   * verb branches on it rather than reading English out of a log, so it is
   * pinned here as a value and not left as whatever the constant happens to be.
   */
  it("exits 78 for an unsuitable host, which is not the code for a runner that failed", () => {
    expect(HOST_UNSUITABLE_EXIT).toBe(78);
    expect(HOST_UNSUITABLE_EXIT).not.toBe(1);
  });
});

/* ---------------------------------------------------------------------- *
 * The identity two builds on two platforms have to agree about
 * ---------------------------------------------------------------------- */

/**
 * `runner_build` is what DASH compares before adopting a runner, and MAR-497 is
 * the first time two machines compute it — a Linux-built host artifact beside a
 * Windows-built shell, from one commit. The algorithm hashed `path.relative`
 * output and raw file bytes, and both differ by platform: separators one way,
 * and CRLF the other, since this repository has no `.gitattributes` and
 * `core.autocrlf` is on by default on Windows.
 *
 * Neither normalisation can be observed from inside one checkout, which is why
 * these tests build the two checkouts they need. Without them the claim "the
 * host runs the build this DASH shipped" would be false in exactly the
 * situation anybody would ask it.
 */
describe("the runner build identity", () => {
  const roots: string[] = [];

  function fixtureTree(eol: "\n" | "\r\n"): string {
    const root = mkdtempSync(path.join(tmpdir(), "dash-buildid-"));
    roots.push(root);
    for (const [file, body] of [
      ["runner/main.ts", "const listen = true;"],
      ["runner/deep/nested.ts", "export const nested = 1;"],
      ["lib/contracts.ts", "export const schemas = [];"],
      ["contracts/agent.manifest.schema.json", '{ "type": "object" }'],
    ] as const) {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `${body}${eol}// a second line${eol}`, "utf8");
    }
    return root;
  }

  afterAll(() => {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is the same for a checkout with CRLF line endings as for one with LF", () => {
    expect(computeRunnerBuildId(fixtureTree("\r\n"), "0.1.1")).toBe(
      computeRunnerBuildId(fixtureTree("\n"), "0.1.1"),
    );
  });

  it("still changes when the source actually changes", () => {
    const root = fixtureTree("\n");
    const before = computeRunnerBuildId(root, "0.1.1");
    writeFileSync(path.join(root, "runner", "main.ts"), "const listen = false;\n", "utf8");
    expect(computeRunnerBuildId(root, "0.1.1")).not.toBe(before);
  });

  it("still changes when only the version changes", () => {
    const root = fixtureTree("\n");
    expect(computeRunnerBuildId(root, "0.1.2")).not.toBe(computeRunnerBuildId(root, "0.1.1"));
  });
});

/* ---------------------------------------------------------------------- *
 * The artifact, started for real
 * ---------------------------------------------------------------------- */

describe("the built artifact on a host that has only the artifact", () => {
  let host: string;
  let artifact: string;
  let dataDir: string;
  let child: ChildProcess | null = null;
  let output = "";
  let endpoint: string;
  let token: string;
  let call: typeof globalThis.fetch;

  beforeAll(async () => {
    execFileSync(process.execPath, [path.join(repoRoot, "scripts", "build-runner-standalone.mjs")], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    host = mkdtempSync(path.join(tmpdir(), "dash-host-"));
    artifact = path.join(host, "runner");
    dataDir = path.join(host, "state");
    cpSync(path.join(repoRoot, "dist", "runner-standalone"), artifact, { recursive: true });

    // Plain Node: this is the process running vitest, which is `node` and not
    // Electron, and no `ELECTRON_RUN_AS_NODE` is set. That absence is the point
    // — the bundled runner needs that flag and this one must not.
    const environment: NodeJS.ProcessEnv = { ...process.env, DASH_RUNNER_DATA_DIR: dataDir };
    delete environment["DASH_CONTRACTS_DIR"];
    delete environment["ELECTRON_RUN_AS_NODE"];
    delete environment["DASH_DATA_DIR"];

    child = spawn(process.execPath, [path.join(artifact, "start.mjs")], {
      env: environment,
      // A neutral working directory, so `findContractsDir`'s `process.cwd()`
      // fallback cannot be what answers.
      cwd: host,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));

    const file = path.join(dataDir, "runner.json");
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !existsSync(file)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!existsSync(file)) {
      throw new Error(`the standalone runner never reported an endpoint. It said:\n${output}`);
    }
    const recorded = JSON.parse(readFileSync(file, "utf8")) as { endpoint: string };
    endpoint = recorded.endpoint;
    token = readFileSync(path.join(dataDir, "runner.key"), "utf8").trim();
    call = ipcFetch(endpoint);
  }, 90_000);

  afterAll(() => {
    // Whatever happened above, do not leave a runner behind — and stop it the
    // way `AGENTS.md` requires rather than by killing it.
    if (child !== null && child.exitCode === null) {
      child.kill("SIGTERM");
    }
    rmSync(host, { recursive: true, force: true });
  });

  it("starts under plain Node, with no Electron and no repository above it", () => {
    expect(child?.exitCode).toBeNull();
    expect(output).toContain("[runner] standalone start:");
    expect(output).toContain("[runner] listening on");
  });

  it("finds its schemas inside itself rather than in whatever tree it was unpacked under", () => {
    expect(output).toContain(`[runner] contracts: ${path.join(artifact, "contracts")}`);
  });

  /**
   * Not a port, on either platform. This is MAR-430's property surviving the
   * move to a host, and ADR 0007's "neither plane opens a listening port" is
   * the sentence it belongs to.
   */
  it("listens on an OS-local endpoint and never on a port", () => {
    expect(endpoint.length).toBeGreaterThan(0);
    expect(Number.isNaN(Number(endpoint))).toBe(true);
    expect(endpoint).toMatch(process.platform === "win32" ? /^\\\\\.\\pipe\\/ : /\.sock$/);
  });

  it("mints its own channel credential, and keeps it out of the file that names the endpoint", () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(readFileSync(path.join(dataDir, "runner.json"), "utf8")).not.toContain(token);
  });

  it("carries the same build identity the shell's bundled runner would", async () => {
    const declared = JSON.parse(readFileSync(path.join(artifact, "package.json"), "utf8")) as {
      dash: { runner_build: string };
    };
    const health = (await call(`${IPC_ORIGIN}/health`)) as Response;
    const body = (await health.json()) as { runner_build?: string };
    expect(body.runner_build).toBe(declared.dash.runner_build);
  });

  it("refuses an unauthenticated caller on the routes that are not /health", async () => {
    const response = await call(`${IPC_ORIGIN}/agents`);
    expect(response.status).toBe(401);
  });

  /** The acceptance criterion: a task, opened over the socket, on the host's runner. */
  it("opens a task over its own endpoint", async () => {
    const response = await call(`${IPC_ORIGIN}/agents/host-agent/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; task: { task_id: string; agent: string } };
    expect(body.ok).toBe(true);
    expect(body.task.agent).toBe("host-agent");
    expect(body.task.task_id.length).toBeGreaterThan(0);

    const readBack = await call(
      `${IPC_ORIGIN}/agents/host-agent/tasks/${encodeURIComponent(body.task.task_id)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(readBack.status).toBe(200);
  });

  it("stops through the authenticated route, not a signal", async () => {
    const response = await call(`${IPC_ORIGIN}/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(202);

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && child?.exitCode === null) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(child?.exitCode).toBe(0);
  }, 30_000);
});
