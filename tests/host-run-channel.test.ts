/**
 * The control plane, reached end to end for the first time (MAR-602, ADR 0014).
 *
 * ## What had never been executed before this file
 *
 * `sshHostChannel` was written by MAR-484 and had **no caller anywhere**, so
 * every property claimed for it was claimed by reading. Two things were wrong in
 * ways only running it could show:
 *
 * 1. It passed no bundle id to `connect`, which joins **one bundle's** runner
 *    socket to stdio. The helper would have read `argv[1]` as `undefined` and
 *    answered a refusal into a pipe DASH was about to speak HTTP down.
 * 2. Nothing could supply its `token`. The host's runner mints its own channel
 *    secret and records it under an owner-only proven ACL (MAR-520); DASH had no
 *    way to obtain it, which `runner/README.md` item 6 has said since May. So the
 *    evidence plane was written, tested, and answered 401 to everything.
 *
 * Both are closed here, against the **real host helper**, built from the entry
 * point `scripts/build-runner-standalone.mjs` ships.
 *
 * ## The one substitution, and what stays unproven
 *
 * `spawn("node", [helper, verb])` where production writes
 * `spawn("ssh", sshArgv(…))`. That is ADR 0007's seam, in its own words: *"the
 * only variable between the CI proof and the attended one is which process is on
 * the other end of the pipe."*
 *
 * `ssh`, the key, `sshd` and somebody's actual VPS stay unproven and, under
 * ADR 0004, are permanently unprovable by a blocking gate. MAR-489's `V8` owns
 * them and it is attended, dated, and Henrik's to press.
 *
 * ## Why the runner here is a fake and the helper is not
 *
 * The helper is the program under test and is the real one. What it starts is a
 * small HTTP server on a socket, because this file is about **whether DASH can
 * reach a runner on a host at all** — `tests/runner-standalone.test.ts` already
 * proves the real runner starts under a plain Node on a tree containing nothing
 * but itself, and pulling it in would make one failure look like the other's.
 * What the fake reproduces exactly is the part this test depends on: it writes
 * `runner.session.key` and `runner.json` where MAR-520 puts them, and it refuses
 * a request that does not carry that secret.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories: string[] = [];

function freshDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `dash-hostrun-${prefix}-`));
  directories.push(dir);
  return dir;
}

// The store this file writes an `evidence_pulls` row into. Set before the store
// module is imported, which is why the imports below are dynamic — the same
// shape `tests/agent-command.test.ts` uses and for the same reason.
const dataDir = freshDir("dash-data");
process.env.DASH_DATA_DIR = dataDir;

const { closeDb } = await import("../lib/db");
const { recordEvidencePull, readEvidencePulls } = await import("../lib/store");
const { pullEvidence } = await import("../lib/agent-dom/evidence");
const { remoteRunnerChannel, RemoteRouteRefused, pathOf } = await import(
  "../lib/agent-dom/runner-channel"
);
const { stdioFetch } = await import("../lib/agent-dom/ssh-fetch");
const { runDeployVerb } = await import("../electron/ssh-host");
const { assembleBundle, BUNDLE_ENTRY_POINT } = await import("../lib/deploy/bundle");
const { fetchAgentDomState, httpAdapter } = await import("../lib/agent-dom/transport");

type StdioChannel = import("../lib/agent-dom/ssh-fetch").StdioChannel;
type DeploySpawn = import("../electron/ssh-host").DeploySpawn;
type RemoteRunnerChannel = import("../lib/agent-dom/runner-channel").RemoteRunnerChannel;

let helperBundle = "";

const AGENT = "scout";
const BUNDLE = "news-scout";
/** What the fake runner writes down and demands back. Shaped like a real one. */
const SECRET = "Kx9_test-channel-secret-for-mar602-proof-0123456789";
const FINGERPRINT = "0123456789abcdef";
/** A task the *host* publishes and this machine has never heard of. */
const HOST_TASK = "task-on-the-server-01";

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
    define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify("host-run-test") },
    entryPoints: [path.join(repoRoot, "scripts", "host-helper", "entry.ts")],
    outfile: path.join(out, "host-helper.mjs"),
  });
  helperBundle = path.join(out, "host-helper.mjs");
}, 120_000);

afterAll(() => {
  closeDb();
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The one substitution: a local child where production spawns `ssh`.
 *
 * The `bundleId` argument is the whole reason this signature exists —
 * `sshArgv` appends it for `connect` and nothing else, and a spawner that
 * dropped it is the defect this file was written to catch.
 */
function localHelper(hostRoot: string): DeploySpawn {
  return (verb, bundleId): StdioChannel => {
    const child = spawn(
      process.execPath,
      [helperBundle, verb, ...(bundleId === undefined ? [] : [bundleId])],
      { stdio: ["pipe", "pipe", "inherit"], env: { ...process.env, DASH_HOST_ROOT: hostRoot } },
    );
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
 * A runner as MAR-520 leaves one: a socket, a session key, and an endpoint file.
 *
 * The endpoint is a Windows named pipe or a Unix socket, chosen the way
 * `runner/endpoint.ts` chooses — a socket path under a temporary directory is
 * over the 104-byte `sun_path` limit on some machines, so the name is kept
 * short deliberately rather than by luck.
 */
function fakeRunnerSource(): string {
  return `
import { writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";

const dataDir = process.env.DASH_RUNNER_DATA_DIR;
const secret = ${JSON.stringify(SECRET)};
const endpoint =
  process.platform === "win32"
    ? "\\\\\\\\.\\\\pipe\\\\dash-mar602-" + process.pid
    : path.join(os.tmpdir(), "dash-mar602-" + process.pid + ".sock");

const state = {
  state_version: 1,
  manifest_version: 2,
  agent_id: ${JSON.stringify(AGENT)},
  observed_at: "2026-08-11T10:00:00.000Z",
  status: "idle",
  tasks: [{ id: ${JSON.stringify(HOST_TASK)}, label: "Waiting to be asked", status: "pending", created_at: "2026-08-11T09:59:00.000Z" }],
};

const server = http.createServer((request, response) => {
  // The credential the whole verb exists to deliver. A request without it is
  // refused, so a test that never obtained it could not pass by accident.
  if (request.headers["authorization"] !== "Bearer " + secret) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
    return;
  }
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    const send = (value) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.url === "/agents/" + ${JSON.stringify(AGENT)}) { send(state); return; }
    if (request.url === "/agents/" + ${JSON.stringify(AGENT)} + "/commands") {
      const envelope = JSON.parse(body);
      writeFileSync(path.join(dataDir, "last-command.json"), JSON.stringify(envelope));
      send({ ok: true, detail: "The host accepted it." });
      return;
    }
    if (request.url === "/telemetry/drain") { send({ events: [], dropped: 0 }); return; }
    if (request.url === "/artifacts/drain") { send({ artifacts: [], dropped: 0 }); return; }
    if (request.url === "/workspace-artifacts") { send({ artifacts: [], truncated: false }); return; }
    if (request.url === "/health") { send({ ok: true }); return; }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false }));
  });
});

server.listen(endpoint, () => {
  // Session key first, then the endpoint file — MAR-520's ordering, so that by
  // the time anything can find out *where* this runner listens, the credential
  // for talking to it is already recorded.
  writeFileSync(path.join(dataDir, "runner.session.key"), secret + "\\n");
  writeFileSync(
    path.join(dataDir, "runner.json"),
    JSON.stringify({ endpoint, pid: process.pid, channel_secret_fingerprint: ${JSON.stringify(FINGERPRINT)} }),
  );
});
setInterval(() => {}, 1000);
`;
}

async function settle(hostRoot: string): Promise<void> {
  const endpointFile = path.join(hostRoot, "bundles", BUNDLE, "data", "runner.json");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(endpointFile)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the fake runner never published an endpoint");
}

/** Install and start a bundle, returning the host root and the runner's pid. */
async function deployed(): Promise<{ hostRoot: string; pid: number }> {
  const hostRoot = freshDir("host");
  const assembled = assembleBundle({
    bundle_id: BUNDLE,
    agent_id: AGENT,
    runner_build: "host-run-test",
    manifest: {
      manifest_version: 2,
      agent: { id: AGENT, name: "Scout" },
      agent_dom: { locations: { runtime: { kind: "local" } }, connections: [] },
    } as never,
    files: [
      { path: BUNDLE_ENTRY_POINT, content: Buffer.from(fakeRunnerSource(), "utf8"), executable: true },
    ],
  });
  if (!assembled.ok) {
    throw new Error("bundle did not assemble");
  }

  const installed = await runDeployVerb(localHelper(hostRoot), assembled.request);
  expect(installed).toMatchObject({ ok: true, verb: "install" });
  const started = await runDeployVerb(localHelper(hostRoot), { verb: "start", bundle_id: BUNDLE });
  expect(started).toMatchObject({ ok: true, verb: "start" });
  await settle(hostRoot);
  return { hostRoot, pid: (started as { pid: number }).pid };
}

/** The channel `sshHostChannel` builds, with the local helper on the pipe. */
function channelTo(hostRoot: string, token: string): RemoteRunnerChannel {
  return remoteRunnerChannel({
    token,
    dial: stdioFetch(() => localHelper(hostRoot)("connect", BUNDLE)),
  });
}

describe("the channel verb", () => {
  it("hands back the credential the running runner is actually using", async () => {
    const { hostRoot, pid } = await deployed();
    try {
      const answer = await runDeployVerb(localHelper(hostRoot), {
        verb: "channel",
        bundle_id: BUNDLE,
      });

      expect(answer).toEqual({
        ok: true,
        verb: "channel",
        bundle_id: BUNDLE,
        token: SECRET,
        // Published on purpose and not a secret — a truncated SHA-256, which is
        // what lets DASH tell "wrong credential" from "wedged runner" instead of
        // reading a bare 401.
        fingerprint: FINGERPRINT,
      });
      // The value came off the file the *runner* wrote, not one the helper
      // invented. A minted secret would authenticate to nothing.
      expect(
        readFileSync(path.join(hostRoot, "bundles", BUNDLE, "data", "runner.session.key"), "utf8").trim(),
      ).toBe(SECRET);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  it("refuses for a bundle nobody installed", async () => {
    const hostRoot = freshDir("host-empty");
    const answer = await runDeployVerb(localHelper(hostRoot), {
      verb: "channel",
      bundle_id: BUNDLE,
    });
    expect(answer).toMatchObject({ ok: false, problem: "not_installed" });
  }, 60_000);

  it("refuses for a runner that is not running rather than handing out a stale one", async () => {
    /*
     * The credential is per *running* process. A helper that returned whatever
     * was left on disk after a runner died would hand DASH a bearer for nothing,
     * and DASH would spend an `ssh` connection discovering that as a refused
     * request instead of as a named answer here.
     */
    const { hostRoot, pid } = await deployed();
    process.kill(pid, "SIGKILL");
    // The pid is recorded and now dead; the session key file is still on disk.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const answer = await runDeployVerb(localHelper(hostRoot), {
      verb: "channel",
      bundle_id: BUNDLE,
    });
    expect(answer).toMatchObject({ ok: false, problem: "not_running" });
  }, 60_000);
});

describe("the remote runner channel, reached for the first time", () => {
  it("carries the bundle id to connect, and speaks HTTP to the runner behind it", async () => {
    /*
     * The defect this file exists for. `sshHostChannel` opened `connect` with no
     * bundle id, and `connect` joins one bundle's socket — so the helper would
     * have refused before a byte of HTTP was written. Nothing observed it,
     * because nothing had ever called the function.
     */
    const { hostRoot, pid } = await deployed();
    try {
      const answered = await runDeployVerb(localHelper(hostRoot), {
        verb: "channel",
        bundle_id: BUNDLE,
      });
      if (!answered.ok || answered.verb !== "channel") {
        throw new Error("the host did not hand back a channel credential");
      }
      const channel = channelTo(hostRoot, answered.token);

      const response = await channel.call("/health");
      expect(response.status).toBe(200);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  it("reads the snapshot the host published, which names a task this machine has never seen", async () => {
    const { hostRoot, pid } = await deployed();
    try {
      const answered = await runDeployVerb(localHelper(hostRoot), {
        verb: "channel",
        bundle_id: BUNDLE,
      });
      if (!answered.ok || answered.verb !== "channel") {
        throw new Error("no credential");
      }
      const channel = channelTo(hostRoot, answered.token);
      const control = { uri: `${channel.origin}/agents/${AGENT}`, token: channel.token };

      const fetched = await fetchAgentDomState(control, {
        fetch: ((_input: unknown, init: RequestInit | undefined) =>
          channel.call({ agent_id: AGENT, leaf: "state" }, init)) as typeof globalThis.fetch,
      });

      expect(fetched.ok).toBe(true);
      if (!fetched.ok) {
        return;
      }
      // The whole reason `AgentStateRoute` was admitted: a run request has to
      // name a target the *host's* snapshot published, and this is where that
      // target comes from.
      expect((fetched.state as { tasks: Array<{ id: string }> }).tasks[0]?.id).toBe(HOST_TASK);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  it("posts a run request the runner receives whole", async () => {
    const { hostRoot, pid } = await deployed();
    try {
      const answered = await runDeployVerb(localHelper(hostRoot), {
        verb: "channel",
        bundle_id: BUNDLE,
      });
      if (!answered.ok || answered.verb !== "channel") {
        throw new Error("no credential");
      }
      const channel = channelTo(hostRoot, answered.token);
      const control = { uri: `${channel.origin}/agents/${AGENT}`, token: channel.token };

      const adapter = httpAdapter(control, {
        fetch: ((_input: unknown, init: RequestInit | undefined) =>
          channel.call({ agent_id: AGENT, leaf: "commands" }, init)) as typeof globalThis.fetch,
      });
      const outcome = await adapter.submit({
        command_version: 1,
        manifest_version: 2,
        command_id: "cmd-mar602",
        command: "retry",
        actor: { id: "tester", type: "user", authenticated_by: "dash_session" },
        target: { agent_id: AGENT, task_id: HOST_TASK },
        issued_at: "2026-08-11T10:00:10.000Z",
        expires_at: "2026-08-11T10:02:10.000Z",
        nonce: "nonce-mar602-proof",
        idempotency_key: "idem-mar602-proof",
        payload: { observed_at: "2026-08-11T10:00:00.000Z" },
        audit: { correlation_id: "corr-mar602" },
      });

      expect(outcome).toMatchObject({ ok: true, detail: "The host accepted it." });

      // Read off the *host's* disk: the envelope arrived intact, targeting the
      // task the host published. This is the byte-level version of ADR 0014's
      // "DASH asks; the host decides".
      const received = JSON.parse(
        readFileSync(path.join(hostRoot, "bundles", BUNDLE, "data", "last-command.json"), "utf8"),
      ) as { command: string; target: { task_id: string }; nonce: string };
      expect(received.command).toBe("retry");
      expect(received.target.task_id).toBe(HOST_TASK);
      expect(received.nonce).toBe("nonce-mar602-proof");
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  it("still refuses a brokered route on the channel that now reaches a host", async () => {
    /*
     * ADR 0006's boundary, asserted on the one channel that finally has a
     * credential. Until this file, the exclusion was true of a channel nothing
     * could use; it is worth re-asserting on a channel that works, because "the
     * remote channel cannot reach the broker" means much more now than it did
     * when it could not reach anything.
     */
    const { hostRoot, pid } = await deployed();
    try {
      const channel = channelTo(hostRoot, SECRET);
      await expect(
        (channel as unknown as { call: (route: string) => Promise<Response> }).call("/broker/drain"),
      ).rejects.toBeInstanceOf(RemoteRouteRefused);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 60_000);

  it("refuses an agent id that would normalise away the segment it was written into", async () => {
    /*
     * `encodeURIComponent` leaves `.` and `..` untouched, because dots are
     * unreserved. For a state route — whose path *ends* at the agent —
     * `/agents/..` normalises to `/agents`, which is a real route on the
     * evidence list. Nothing escalates, but a caller that asked for one agent
     * and silently got every agent is a caller whose next line is wrong.
     */
    const { hostRoot, pid } = await deployed();
    try {
      const channel = channelTo(hostRoot, SECRET);
      for (const hostile of ["..", "."]) {
        await expect(channel.call({ agent_id: hostile, leaf: "state" })).rejects.toBeInstanceOf(
          RemoteRouteRefused,
        );
      }
      // And an ordinary-looking id that spells a route stays in one segment.
      expect(pathOf({ agent_id: "/broker/drain", leaf: "commands" })).toBe(
        "/agents/%2Fbroker%2Fdrain/commands",
      );
      expect(pathOf({ agent_id: AGENT, leaf: "state" })).toBe(`/agents/${AGENT}`);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 60_000);
});

describe("what DASH writes down about looking at a host", () => {
  it("records a pull from another machine, which is the row V9 was blocked on", async () => {
    /*
     * MAR-488's remote drain, executed against a runner on the other end of the
     * helper for the first time. The attended run's `V9` was *"not run — blocked
     * by V8; `evidence_pulls` holds one row, `source=local`"*, and the reason is
     * that nothing had ever given the remote drain a runner to drain.
     *
     * The counts are all zero and the row is written anyway. That is the
     * property, not a shortcoming: "when DASH last looked" is half the sentence
     * the Runs page carries, and it is only true if it is written when the
     * answer is boring.
     */
    const { hostRoot, pid } = await deployed();
    try {
      const channel = channelTo(hostRoot, SECRET);
      const pull = await pullEvidence(channel, {
        source: "host-e3fa1674",
        kind: "another_machine",
        now: () => "2026-08-11T10:05:00.000Z",
        log: () => {},
      });

      expect(pull).toMatchObject({
        source: "host-e3fa1674",
        kind: "another_machine",
        reached: true,
        events_ingested: 0,
        artifacts_ingested: 0,
      });

      recordEvidencePull(pull);
      const recorded = readEvidencePulls();
      expect(recorded.some((row) => row.kind === "another_machine")).toBe(true);
    } finally {
      process.kill(pid, "SIGKILL");
    }
  }, 60_000);
});
