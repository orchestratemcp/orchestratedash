/**
 * The deploy plane, driven end to end against the real host helper (MAR-487,
 * ADR 0007).
 *
 * ## What makes this the merged bar rather than a mock
 *
 * ADR 0007 claims CI-provability precisely and this file is the claim executed:
 *
 * > A test can spawn a local child that speaks HTTP over its own stdio and
 * > exercise every property `ipcFetch` is tested for […] with no SSH, no host
 * > and no network. What stays unproven by that is `ssh` itself: authentication,
 * > the far-side helper, and the host's socket. So the seam is one file wide […]
 * > **the only variable between the CI proof and the attended one is which
 * > process is on the other end of the pipe.**
 *
 * MAR-484 made that true for the control plane. This makes it true for the
 * deploy plane, and it goes one step further than the ADR promised: **the
 * far-side helper is no longer unproven.** `runDeployVerb` is the production
 * function, `scripts/host-helper/main.ts` is the production helper, and the only
 * substitution is `spawn("node", [helper, verb])` where production writes
 * `spawn("ssh", sshArgv(...))`. `ssh` itself, the key, and the host's `sshd`
 * stay attended, permanently, under ADR 0004.
 *
 * ## Why the helper runs from source rather than from a build
 *
 * `tsx`-free: the helper is bundled to a temporary `.mjs` by esbuild once, in
 * `beforeAll`, from the same entry point `scripts/build-runner-standalone.mjs`
 * bundles. A test that drove a hand-written stub would prove the stub.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { StdioChannel } from "../lib/agent-dom/ssh-fetch";
import {
  BUNDLE_ENTRY_POINT,
  assembleBundle,
  describeDeployReceipt,
  type SourceFile,
} from "../lib/deploy/bundle";
import {
  DEPLOY_VERBS,
  checkDeployRequest,
  isDeployVerb,
  type DeployAnswer,
  type DeployRequest,
} from "../lib/deploy/verbs";
import { runDeployVerb, type DeploySpawn } from "../electron/ssh-host";
import { helperArgv } from "../scripts/host-helper/main";
import { sshArgv, type HostRecord } from "../lib/hosts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories: string[] = [];
let helperBundle = "";

function freshDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `dash-deploy-${prefix}-`));
  directories.push(dir);
  return dir;
}

beforeAll(async () => {
  const out = freshDir("helper");
  const { build } = await import("esbuild");
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    logLevel: "silent",
    external: ["electron"],
    define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify("deploy-bridge-test") },
    entryPoints: [path.join(repoRoot, "scripts", "host-helper", "entry.ts")],
    outfile: path.join(out, "host-helper.mjs"),
  });
  helperBundle = path.join(out, "host-helper.mjs");
}, 60_000);

afterEach(() => {
  /* directories are cleaned once, in afterAll — a bundle survives its test */
});

afterAll(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The one substitution: a local child where production spawns `ssh`.
 *
 * `DASH_HOST_ROOT` stands in for the host's home directory, which is what makes
 * this a test about a filesystem the helper is told to own rather than about
 * one it happens to be running in.
 */
function localHelper(hostRoot: string): DeploySpawn {
  return (verb, bundleId): StdioChannel => {
    const argv = [helperBundle, verb, ...(bundleId === undefined ? [] : [bundleId])];
    const child = spawn(process.execPath, argv, {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, DASH_HOST_ROOT: hostRoot },
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      close: () => {
        child.stdin.end();
        child.kill();
      },
    };
  };
}

/**
 * The same child, invoked the way `sshd`'s forced command invokes it (MAR-573).
 *
 * With ADR 0009's `command="…"` in the host's allowed-keys file, `sshd` runs
 * the helper with **no arguments at all** and puts DASH's actual request in
 * `SSH_ORIGINAL_COMMAND`. So this spawner deliberately passes an empty argv:
 * every byte that decides what happens travels in the environment, which is
 * exactly the substitution the real host makes.
 *
 * It is the closest CI can get to the forced command without an `sshd`, and it
 * is worth more than it looks — the failure it guards against is a helper that
 * works perfectly under `ssh host status` and answers "no operation was named"
 * on every real host, which is what would have shipped without it.
 */
function forcedCommandHelper(hostRoot: string): DeploySpawn {
  return (verb, bundleId): StdioChannel => {
    const child = spawn(process.execPath, [helperBundle], {
      stdio: ["pipe", "pipe", "inherit"],
      env: {
        ...process.env,
        DASH_HOST_ROOT: hostRoot,
        SSH_ORIGINAL_COMMAND: [verb, ...(bundleId === undefined ? [] : [bundleId])].join(" "),
      },
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      close: () => {
        child.stdin.end();
        child.kill();
      },
    };
  };
}

function sourceFile(relative: string, body: string, executable = false): SourceFile {
  return { path: relative, content: Buffer.from(body, "utf8"), executable };
}

/** A manifest the MAR-482 constraint accepts: a local runtime, no connections. */
function legalManifest(): Record<string, unknown> {
  return {
    manifest_version: 2,
    agent: { id: "scout", name: "Scout" },
    agent_dom: {
      locations: { runtime: { kind: "local" } },
      connections: [],
    },
  };
}

/** The one MAR-482 refuses: remote runtime beside a DASH-managed connection. */
function contradictoryManifest(): Record<string, unknown> {
  return {
    manifest_version: 2,
    agent: { id: "scout", name: "Scout" },
    agent_dom: {
      locations: { runtime: { kind: "remote" } },
      connections: [{ id: "gmail", label: "Gmail", ownership: "dash_managed" }],
    },
  };
}

/* ---------------------------------------------------------------------- *
 * The verb set, which is the boundary
 * ---------------------------------------------------------------------- */

describe("the closed verb set", () => {
  it("is exactly ADR 0007's six, and nothing composes a command line", () => {
    // Pinned by value. ADR 0007 names these six and this array is the whole
    // vocabulary DASH has for a machine it does not administer; a seventh
    // arriving without a line here is a verb nobody decided to add.
    expect([...DEPLOY_VERBS]).toEqual(["install", "start", "stop", "status", "collect", "connect"]);
  });

  it("refuses anything that is not one of them", () => {
    for (const candidate of ["exec", "sh", "bash -c ls", "INSTALL", "", "install; rm -rf /"]) {
      expect(isDeployVerb(candidate)).toBe(false);
      expect(checkDeployRequest({ verb: candidate, bundle_id: "abc" }).ok).toBe(false);
    }
  });

  it("reads the verb from the forced command's environment when argv is empty", () => {
    /*
     * ADR 0009, at the seam. `helperArgv` prefers argv so that every existing
     * caller — and the local children in this file — behave exactly as before,
     * and falls back to `SSH_ORIGINAL_COMMAND`, which is the only thing a
     * forced command leaves for the program it forces.
     *
     * The string is split and never interpreted. There is no shell between the
     * environment variable and `checkDeployRequest`, which is why a request
     * with a semicolon in it becomes tokens that are not verbs rather than
     * something that runs.
     */
    expect(helperArgv([], "status")).toEqual(["status"]);
    expect(helperArgv([], "connect news-scout")).toEqual(["connect", "news-scout"]);
    expect(helperArgv([], "  status  ")).toEqual(["status"]);
    expect(helperArgv([], undefined)).toEqual([]);
    expect(helperArgv([], "")).toEqual([]);

    // Argv wins, so nothing an environment carries can redirect an invocation
    // that already named its verb.
    expect(helperArgv(["status"], "install")).toEqual(["status"]);

    // Not a verb, and not run: the tokens go to the same check as everything
    // else, which draws from a closed array.
    expect(isDeployVerb(helperArgv([], "status; rm -rf /")[0] as string)).toBe(false);
  });

  it("puts nothing on the command line that a request could choose", () => {
    /*
     * The argv rule, asserted rather than described. Everything variable
     * travels on stdin, so the only strings `ssh` can be made to interpret are
     * the fixed options, the destination, the verb — and, for `connect` alone,
     * an identifier whose alphabet cannot spell a path, a separator or a
     * leading "-".
     */
    const record: HostRecord = {
      host_id: "h1",
      label: "My server",
      address: "example.com",
      port: 22,
      username: "dash",
      key_name: "my-server",
      host_fingerprint: null,
      added_at: "2026-08-07T00:00:00.000Z",
    };
    const argv = sshArgv(record, "install", {
      identity_file: "/keys/id",
      known_hosts_file: "/keys/known_hosts",
    });
    expect(argv[argv.length - 1]).toBe("install");
    expect(argv).not.toContain("-L");
    expect(argv).not.toContain("-R");
    expect(argv).not.toContain("-D");

    const withId = sshArgv(
      record,
      "connect",
      { identity_file: "/keys/id", known_hosts_file: "/keys/known_hosts" },
      "news-scout",
    );
    expect(withId.slice(-2)).toEqual(["connect", "news-scout"]);
  });

  it("will not carry an identifier that could be a path", () => {
    for (const bad of [
      "../../etc",
      "/etc/passwd",
      "a/b",
      "a\\b",
      "-oProxyCommand=x",
      "..",
      "C:",
      "NUL",
    ]) {
      expect(checkDeployRequest({ verb: "start", bundle_id: bad }).ok).toBe(false);
    }
    expect(checkDeployRequest({ verb: "start", bundle_id: "news-scout" }).ok).toBe(true);
  });
});

/* ---------------------------------------------------------------------- *
 * Assembly, and the refusal before a byte ships
 * ---------------------------------------------------------------------- */

describe("assembling a bundle", () => {
  it("refuses a manifest MAR-482 refuses, before anything is hashed", () => {
    const result = assembleBundle({
      bundle_id: "news-scout",
      agent_id: "scout",
      runner_build: "test",
      manifest: contradictoryManifest() as never,
      files: [sourceFile(BUNDLE_ENTRY_POINT, "export {};", true)],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toBe("manifest_refused");
      // The user is told nothing left this machine, because nothing did — the
      // check runs before a single file is read into the request.
      expect(result.detail).toContain("Nothing was sent.");
    }
  });

  it("refuses a bundle with no entry point, because nothing could start it", () => {
    const result = assembleBundle({
      bundle_id: "news-scout",
      agent_id: "scout",
      runner_build: "test",
      manifest: legalManifest() as never,
      files: [sourceFile("runner.mjs", "export {};")],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toBe("no_entry_point");
    }
  });

  it("sends only two modes, and never one a bundle chose", () => {
    const result = assembleBundle({
      bundle_id: "news-scout",
      agent_id: "scout",
      runner_build: "test",
      manifest: legalManifest() as never,
      files: [sourceFile(BUNDLE_ENTRY_POINT, "export {};", true), sourceFile("data.json", "{}")],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.files.map((f) => f.mode).sort()).toEqual([0o644, 0o755]);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The whole plane, against the real helper
 * ---------------------------------------------------------------------- */

describe("install, start, status, collect, stop — against the real host helper", () => {
  /**
   * A bundle whose entry point is a real program that keeps running, so
   * `start`, `status` and `collect` are asked about a process that exists.
   *
   * Not the standalone runner: this test is about the deploy plane, and
   * `tests/runner-standalone.test.ts` already proves the runner starts under a
   * plain Node on a tree containing nothing but itself. Pulling it in here
   * would make one failure look like the other's.
   */
  function bundleFiles(): SourceFile[] {
    return [
      sourceFile(
        BUNDLE_ENTRY_POINT,
        [
          "process.stdout.write('[runner] listening\\n');",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
        true,
      ),
      sourceFile("contracts/note.txt", "frozen schemas live here"),
    ];
  }

  async function send(hostRoot: string, request: DeployRequest): Promise<DeployAnswer> {
    return await runDeployVerb(localHelper(hostRoot), request);
  }

  it("answers a verb that arrived only as a forced command's environment", async () => {
    /*
     * The MAR-573 finding, closed against the real helper binary.
     *
     * On 2026-08-08 DASH authenticated to a real sshd and the host answered
     * `bash: line 1: status: command not found` — the verb reached a server
     * with nothing on it named `status`. ADR 0009's answer is a forced command
     * in the allowed-keys file, which means the verb no longer arrives on the
     * command line at all: `sshd` runs the helper with empty argv and leaves
     * the request in `SSH_ORIGINAL_COMMAND`.
     *
     * This spawns the built helper exactly that way. The answer below is the
     * same one the attended run finally got by hand — `{"ok":true,
     * "verb":"status","bundles":[]}` — reached without a single argument.
     */
    const hostRoot = freshDir("host-forced");
    const answer = await runDeployVerb(forcedCommandHelper(hostRoot), { verb: "status" });

    expect(answer).toEqual({ ok: true, verb: "status", bundles: [] });
  });

  it("installs, verifies every digest on arrival, and starts what it installed", async () => {
    const hostRoot = freshDir("host");
    const assembled = assembleBundle({
      bundle_id: "news-scout",
      agent_id: "scout",
      runner_build: "deploy-bridge-test",
      manifest: legalManifest() as never,
      files: bundleFiles(),
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) {
      return;
    }

    const installed = await send(hostRoot, assembled.request);
    expect(installed).toMatchObject({ ok: true, verb: "install", bundle_id: "news-scout", files: 2 });

    // The bytes are on the "host", under the id and nowhere else.
    const bundleDir = path.join(hostRoot, "bundles", "news-scout");
    expect(readdirSync(bundleDir).sort()).toEqual(["contracts", BUNDLE_ENTRY_POINT].sort());
    const written = readFileSync(path.join(bundleDir, BUNDLE_ENTRY_POINT));
    expect(createHash("sha256").update(written).digest("hex")).toBe(
      assembled.request.files.find((f) => f.path === BUNDLE_ENTRY_POINT)?.sha256,
    );

    const started = await send(hostRoot, { verb: "start", bundle_id: "news-scout" });
    expect(started).toMatchObject({ ok: true, verb: "start" });
    const pid = (started as { pid: number }).pid;
    expect(pid).toBeGreaterThan(0);

    try {
      const status = await send(hostRoot, { verb: "status" });
      expect(status).toMatchObject({ ok: true, verb: "status" });
      const bundles = (status as unknown as { bundles: Array<Record<string, unknown>> }).bundles;
      expect(bundles).toHaveLength(1);
      expect(bundles[0]).toMatchObject({
        bundle_id: "news-scout",
        agent_id: "scout",
        runner_build: "deploy-bridge-test",
        running: true,
      });

      // `collect` returns the host's own account and says when it truncated,
      // rather than truncating silently.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const collected = await send(hostRoot, { verb: "collect", bundle_id: "news-scout", lines: 10 });
      expect(collected).toMatchObject({ ok: true, verb: "collect", truncated: false });
      expect((collected as { log: string[] }).log.join("\n")).toContain("[runner] listening");
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 30_000);

  it("reports a running runner it cannot sign in to rather than killing it", async () => {
    /*
     * The honest failure, and it is MAR-520's lesson one machine over. A runner
     * that left no session key is one the helper cannot authenticate to, and
     * the helper says so and stops. Escalating to a signal would be the
     * force-kill AGENTS.md forbids, performed on a machine nobody is watching,
     * against the process holding somebody's agent history.
     */
    const hostRoot = freshDir("host");
    const assembled = assembleBundle({
      bundle_id: "news-scout",
      agent_id: "scout",
      runner_build: "deploy-bridge-test",
      manifest: legalManifest() as never,
      files: bundleFiles(),
    });
    if (!assembled.ok) {
      throw new Error("bundle did not assemble");
    }
    await send(hostRoot, assembled.request);
    const started = await send(hostRoot, { verb: "start", bundle_id: "news-scout" });
    const pid = (started as { pid: number }).pid;

    try {
      const stopped = await send(hostRoot, { verb: "stop", bundle_id: "news-scout" });
      expect(stopped).toMatchObject({ ok: true, verb: "stop", stopped: false });
      expect((stopped as { detail: string }).detail).toContain("cannot ask it to stop");
      // Still alive. The helper reported rather than acted.
      expect(() => {
        process.kill(pid, 0);
      }).not.toThrow();
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 30_000);

  it("stops a runner that recorded a credential, through its own route", async () => {
    /*
     * The path MAR-520 made possible. The bundle's runner writes
     * `runner.json` and `runner.session.key` into its own data directory
     * exactly as `runner/main.ts` does, and the helper uses them — so this is
     * the deploy plane asking a runner to stop through the same authenticated
     * shutdown route DASH's own Stop button uses, one machine over.
     */
    const hostRoot = freshDir("host");
    const secret = randomBytes(32).toString("base64url");
    const socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\dash-deploy-${randomBytes(6).toString("hex")}`
        : path.join(freshDir("sock"), "runner.sock");

    // An entry point that behaves like the runner: listen, then write the two
    // files the helper reads, then wait to be asked to stop.
    const runnerSource = [
      "import http from 'node:http';",
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      `const endpoint = ${JSON.stringify(socketPath)};`,
      `const secret = ${JSON.stringify(secret)};`,
      "const dataDir = process.env.DASH_RUNNER_DATA_DIR;",
      "const server = http.createServer((req, res) => {",
      "  const ok = req.headers.authorization === `Bearer ${secret}`;",
      "  res.writeHead(ok ? 202 : 401, { 'content-type': 'application/json' });",
      "  res.end(JSON.stringify({ ok }));",
      "  if (ok) { server.close(() => process.exit(0)); }",
      "});",
      "server.listen(endpoint, () => {",
      "  mkdirSync(dataDir, { recursive: true });",
      "  writeFileSync(path.join(dataDir, 'runner.json'), JSON.stringify({ pid: process.pid, endpoint }));",
      "  writeFileSync(path.join(dataDir, 'runner.session.key'), secret + '\\n');",
      "  process.stdout.write('[runner] listening\\n');",
      "});",
    ].join("\n");

    const assembled = assembleBundle({
      bundle_id: "news-scout",
      agent_id: "scout",
      runner_build: "deploy-bridge-test",
      manifest: legalManifest() as never,
      files: [sourceFile(BUNDLE_ENTRY_POINT, runnerSource, true)],
    });
    if (!assembled.ok) {
      throw new Error("bundle did not assemble");
    }
    await send(hostRoot, assembled.request);
    const started = await send(hostRoot, { verb: "start", bundle_id: "news-scout" });
    const pid = (started as { pid: number }).pid;

    // Wait for it to publish its endpoint file, which is what the helper reads.
    const dataDir = path.join(hostRoot, "bundles", "news-scout", "data");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        statSync(path.join(dataDir, "runner.session.key"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const stopped = await send(hostRoot, { verb: "stop", bundle_id: "news-scout" });
    expect(stopped).toMatchObject({ ok: true, verb: "stop", stopped: true });

    const status = await send(hostRoot, { verb: "status", bundle_id: "news-scout" });
    expect((status as { bundles: Array<{ running: boolean }> }).bundles[0]?.running).toBe(false);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone, which is the point */
    }
  }, 30_000);
});

/* ---------------------------------------------------------------------- *
 * What the helper will not do, asked of the helper itself
 * ---------------------------------------------------------------------- */

describe("the helper's own refusals", () => {
  async function send(hostRoot: string, request: unknown): Promise<DeployAnswer> {
    return await runDeployVerb(localHelper(hostRoot), request as DeployRequest);
  }

  it("refuses a bundle file that names a location outside the bundle", async () => {
    const hostRoot = freshDir("host");
    const content = Buffer.from("owned", "utf8");
    // Hand-built rather than assembled: `assembleBundle` refuses these too, and
    // the point of this case is that **the helper** refuses them — a check that
    // lives only in the sender is a check a different sender does not perform.
    for (const badPath of ["../escaped.txt", "a/../../escaped.txt", "sub/../../x"]) {
      const answer = await send(hostRoot, {
        verb: "install",
        bundle_id: "news-scout",
        agent_id: "scout",
        runner_build: "test",
        files: [
          {
            path: badPath,
            content_base64: content.toString("base64"),
            sha256: createHash("sha256").update(content).digest("hex"),
            mode: 0o644,
          },
        ],
      });
      expect(answer.ok).toBe(false);
    }
    // Nothing escaped: the host root's parent is untouched.
    expect(readdirSync(hostRoot)).not.toContain("escaped.txt");
  }, 30_000);

  it("refuses bytes that did not arrive as they were sent", async () => {
    const hostRoot = freshDir("host");
    const answer = await send(hostRoot, {
      verb: "install",
      bundle_id: "news-scout",
      agent_id: "scout",
      runner_build: "test",
      files: [
        {
          path: BUNDLE_ENTRY_POINT,
          content_base64: Buffer.from("something else", "utf8").toString("base64"),
          sha256: createHash("sha256").update(Buffer.from("expected", "utf8")).digest("hex"),
          mode: 0o755,
        },
      ],
    });
    expect(answer).toMatchObject({ ok: false, problem: "digest_mismatch" });
  }, 30_000);

  it("refuses a mode DASH does not send", async () => {
    const hostRoot = freshDir("host");
    const content = Buffer.from("x", "utf8");
    // 0o4755 is setuid. Admitting arbitrary bits would let a bundle ask for it
    // on a machine DASH does not administer.
    const answer = await send(hostRoot, {
      verb: "install",
      bundle_id: "news-scout",
      agent_id: "scout",
      runner_build: "test",
      files: [
        {
          path: BUNDLE_ENTRY_POINT,
          content_base64: content.toString("base64"),
          sha256: createHash("sha256").update(content).digest("hex"),
          mode: 0o4755,
        },
      ],
    });
    expect(answer).toMatchObject({ ok: false, problem: "malformed_mode" });
  }, 30_000);

  it("has no verb that starts something a request named", async () => {
    const hostRoot = freshDir("host");
    /*
     * The whole plane's premise, asked directly. There is no verb taking a
     * command, so a request carrying one is refused at the verb rather than
     * sanitised — and a request smuggling one *beside* a real verb is ignored,
     * because `start` reads a bundle id and nothing else.
     */
    for (const attempt of [
      { verb: "exec", command: "id" },
      { verb: "run", argv: ["sh", "-c", "id"] },
      { verb: "start", bundle_id: "news-scout", command: "id", argv: ["sh"] },
    ]) {
      const answer = await send(hostRoot, attempt);
      // Either refused outright, or accepted as `start` on a bundle that is not
      // installed. Never "ran something".
      if (answer.ok) {
        throw new Error("a request with a command in it was accepted");
      }
      expect(["unknown_verb", "not_installed"]).toContain(answer.problem);
    }
  }, 30_000);
});

/* ---------------------------------------------------------------------- *
 * The receipt ADR 0006 requires before the push
 * ---------------------------------------------------------------------- */

describe("what the person is told before they press it", () => {
  const receipt = describeDeployReceipt("News Scout", "My server");

  it("says all three things DASH cannot do", () => {
    expect(receipt.limits).toHaveLength(3);
    const all = receipt.limits.join(" ").toLowerCase();
    expect(all).toContain("cannot limit");
    expect(all).toContain("only show you what the server still has");
    expect(all).toContain("does not stop it");
  });

  it("offers the revocation that works and not the one that does not", () => {
    // ADR 0006's option-1 receipt "ending with the revocation that works". The
    // failure this forbids is a sentence implying the DASH-side toggle is one.
    expect(receipt.revocation).toContain("My server");
    expect(receipt.revocation.toLowerCase()).toContain("the server is what decides");
  });

  it("uses no field name, file name or environment variable name", () => {
    // `lib/copy/identifiers.ts`'s rule, and ADR 0007's test for this plane: a
    // receipt that cannot describe the arrangement honestly rules the option out.
    const prose = [receipt.what, ...receipt.limits, receipt.revocation].join(" ");
    for (const forbidden of [
      "bundle_id",
      "agent_id",
      "runner.json",
      "start.mjs",
      "DASH_",
      "ssh",
      "sha256",
      "_",
    ]) {
      expect(prose).not.toContain(forbidden);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The exclusion ADR 0007 exists to keep
 * ---------------------------------------------------------------------- */

describe("the broker stays on this machine", () => {
  it("has no deploy verb that names a brokered route, and no route that is a verb", () => {
    /*
     * ADR 0007's excluded routes are `/broker/drain` and `/broker/responses`,
     * and `lib/agent-dom/runner-channel.ts` makes them unreachable on a remote
     * channel by type. This asserts the *other* direction, which nothing else
     * covers: the deploy plane is a second way to reach a host, and it must not
     * have grown a door of its own.
     *
     * Two facts, both mechanical. No verb is broker-shaped, and the deploy
     * plane speaks JSON to a helper rather than HTTP to the runner — so there
     * is no route string in it at all.
     */
    for (const verb of DEPLOY_VERBS) {
      expect(verb).not.toContain("broker");
      expect(verb).not.toContain("/");
    }

    const helperSource = readFileSync(
      path.join(repoRoot, "scripts", "host-helper", "main.ts"),
      "utf8",
    );
    // Comments stripped, for `tests/broker-channel-exclusion.test.ts`'s reason:
    // the file explaining why it cannot carry them is the last place that
    // should be punished for naming them.
    const code = helperSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toContain("/broker/drain");
    expect(code).not.toContain("/broker/responses");
    // The one route the helper does reach is the runner's own shutdown, on the
    // host's own socket, with the host's own credential.
    expect(code).toContain("/shutdown");
  });
});
