/**
 * The handoff contract (MAR-428).
 *
 * These are the checks that stand between a `dash://` link — which any web page
 * can put in front of a user — and a command line DASH would hand to a process
 * supervisor. Each one is asserted on its own, and the negative cases outnumber
 * the positive one, because the negative cases are the feature.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  HANDOFF_FILE_NAME,
  MAX_HANDOFF_BYTES,
  buildHandoff,
  handoffUrl,
  isSafeAgentId,
  nonceMatches,
  parseHandoffUrl,
  readHandoff,
  secretsInEnvironment,
  validateHandoff,
  verifyHandoff,
  type AgentHandoff,
} from "../lib/handoff";

const workDir = mkdtempSync(path.join(tmpdir(), "dash-handoff-"));
afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const NONCE = "a".repeat(64);
const HANDOFF_ID = "b".repeat(32);

function facts(overrides: Record<string, unknown> = {}): Parameters<typeof buildHandoff>[0] {
  return {
    agent_id: "folder-digest",
    display_name: "Folder digest",
    summary: "Counts what is in a folder and writes a short report.",
    project_dir: path.join(workDir, "project"),
    manifest_path: path.join(workDir, "project", "agent.manifest.json"),
    command: "node",
    args: ["dist/agent.mjs"],
    produced_by: "create-dash-agent 0.1.1",
    ...overrides,
  } as Parameters<typeof buildHandoff>[0];
}

function handoff(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  const built = buildHandoff(facts(), { handoff_id: HANDOFF_ID, nonce: NONCE });
  if (!built.ok) {
    throw new Error(`the fixture itself is invalid: ${built.detail}`);
  }
  return { ...built.value, ...overrides };
}

describe("the handoff URL", () => {
  it("round-trips an absolute path with a space in it", () => {
    const file = path.join(workDir, "My Agents", "folder-digest", HANDOFF_FILE_NAME);
    const parsed = parseHandoffUrl(handoffUrl(file, NONCE));
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.file).toBe(path.normalize(file));
    expect(parsed.ok && parsed.value.nonce).toBe(NONCE);
  });

  it("encodes a Windows path without mangling it", () => {
    // The case a hand-built query string gets wrong on somebody else's machine:
    // a drive colon, backslashes and a space, all at once. Asserted on the
    // encoding rather than through `parseHandoffUrl`, because `path.isAbsolute`
    // is platform-dependent and CI is Linux — where "C:\..." is a relative path
    // and the parse would correctly refuse it.
    const file = "C:\\Users\\Someone\\My Agents\\folder-digest\\" + HANDOFF_FILE_NAME;
    const url = handoffUrl(file, NONCE);

    expect(url).toContain("C%3A%5CUsers%5CSomeone%5CMy+Agents");
    expect(new URL(url).searchParams.get("file")).toBe(file);
  });

  it.runIf(process.platform === "win32")("parses that Windows path on Windows", () => {
    const file = "C:\\Users\\Someone\\My Agents\\folder-digest\\" + HANDOFF_FILE_NAME;
    expect(parseHandoffUrl(handoffUrl(file, NONCE))).toMatchObject({ ok: true });
  });

  it("refuses a link that is not a DASH link", () => {
    expect(parseHandoffUrl("https://example.com/handoff?nonce=" + NONCE)).toMatchObject({
      ok: false,
      problem: "malformed",
    });
  });

  it("refuses a DASH link that is not a handoff", () => {
    expect(parseHandoffUrl(`dash://something-else?v=1&file=/a/${HANDOFF_FILE_NAME}&nonce=${NONCE}`))
      .toMatchObject({ ok: false, problem: "malformed" });
  });

  it("refuses a version it does not understand, and says what to do", () => {
    const result = parseHandoffUrl(`dash://handoff?v=9&file=/a/${HANDOFF_FILE_NAME}&nonce=${NONCE}`);
    expect(result).toMatchObject({ ok: false, problem: "unsupported_version" });
    expect(result.ok ? "" : result.detail).toMatch(/Open in DASH/);
  });

  it("refuses a relative path", () => {
    // Relative to *what*? Not a question DASH gets to answer on the user's
    // behalf, and a resolution against cwd would be a different file each launch.
    expect(parseHandoffUrl(`dash://handoff?v=1&file=./${HANDOFF_FILE_NAME}&nonce=${NONCE}`))
      .toMatchObject({ ok: false, problem: "relative_path" });
  });

  it("refuses a path that is not a handoff file", () => {
    expect(
      parseHandoffUrl(`dash://handoff?v=1&file=${encodeURIComponent("/etc/shadow")}&nonce=${NONCE}`),
    ).toMatchObject({ ok: false, problem: "malformed" });
  });

  it("refuses a nonce that is not one", () => {
    for (const nonce of ["", "short", "../../etc", "g".repeat(64)]) {
      expect(
        parseHandoffUrl(`dash://handoff?v=1&file=/a/${HANDOFF_FILE_NAME}&nonce=${nonce}`),
      ).toMatchObject({ ok: false });
    }
  });

  it("carries no command line, by construction", () => {
    // The property the whole design rests on: a URL cannot say what to run, so
    // an attacker-authored URL cannot make DASH propose running anything.
    const url = handoffUrl(path.join(workDir, HANDOFF_FILE_NAME), NONCE);
    expect(url).not.toMatch(/node|command|args|exe/i);
    expect([...new URL(url).searchParams.keys()].sort()).toEqual(["file", "nonce", "v"]);
  });
});

describe("the handoff document", () => {
  it("accepts one the builder produced", () => {
    expect(validateHandoff(handoff())).toMatchObject({ ok: true });
  });

  it("refuses a missing field rather than filling one in", () => {
    const { display_name: _dropped, ...withoutName } = handoff();
    expect(validateHandoff(withoutName)).toMatchObject({ ok: false, problem: "malformed" });
  });

  it("refuses an agent id that would escape the registration directory", () => {
    // The id becomes a file name. This is a path-traversal boundary.
    for (const agentId of ["../evil", "a/b", "..", "Has Spaces", "C:\\x"]) {
      expect(isSafeAgentId(agentId)).toBe(false);
      expect(validateHandoff(handoff({ agent_id: agentId }))).toMatchObject({
        ok: false,
        problem: "unsafe_agent_id",
      });
    }
    // An empty id is caught one check earlier, as an absent field. Asserted
    // rather than folded in above so the two refusals stay distinguishable.
    expect(isSafeAgentId("")).toBe(false);
    expect(validateHandoff(handoff({ agent_id: "" }))).toMatchObject({
      ok: false,
      problem: "malformed",
    });
    expect(isSafeAgentId("folder-digest")).toBe(true);
  });

  it("refuses an environment that looks like it carries a credential", () => {
    // The issue's rule, enforced rather than intended: "never place secrets or
    // runner bearer tokens in a URL, manifest or registration artifact".
    for (const key of [
      "API_KEY",
      "OPENAI_TOKEN",
      "db_password",
      "CLIENT_SECRET",
      "MY_CREDENTIAL",
      "GITHUB_AUTH",
    ]) {
      expect(secretsInEnvironment({ [key]: "x" })).toEqual([key]);
      expect(validateHandoff(handoff({ env: { [key]: "x" } }))).toMatchObject({
        ok: false,
        problem: "secret_in_environment",
      });
    }
  });

  it("refuses to let a registration claim a DASH name", () => {
    // The supervisor already refuses to *start* a child holding one. Refusing to
    // record one means the failure lands where a person can act on it.
    expect(secretsInEnvironment({ DASH_RUNNER_DATA_DIR: "/tmp" })).toEqual([
      "DASH_RUNNER_DATA_DIR",
    ]);
    expect(secretsInEnvironment({ dash_shell_url: "http://evil" })).toEqual(["dash_shell_url"]);
  });

  it("allows an ordinary setting", () => {
    expect(secretsInEnvironment({ DIGEST_FOLDER: "inbox", TZ: "UTC" })).toEqual([]);
  });

  it("refuses a relative project or manifest path", () => {
    expect(validateHandoff(handoff({ project_dir: "relative/dir" }))).toMatchObject({
      ok: false,
      problem: "relative_path",
    });
  });
});

describe("reading one from disk", () => {
  function write(name: string, body: string): string {
    const dir = path.join(workDir, name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, HANDOFF_FILE_NAME);
    writeFileSync(file, body, "utf8");
    return file;
  }

  it("reads a good one", () => {
    const file = write("good", JSON.stringify(handoff()));
    expect(readHandoff(file)).toMatchObject({ ok: true });
  });

  it("says so plainly when it is not there", () => {
    const result = readHandoff(path.join(workDir, "nope", HANDOFF_FILE_NAME));
    expect(result).toMatchObject({ ok: false, problem: "not_found" });
    expect(result.ok ? "" : result.detail).toMatch(/Open in DASH/);
  });

  it("refuses a damaged file without guessing at it", () => {
    expect(readHandoff(write("damaged", "{ not json"))).toMatchObject({
      ok: false,
      problem: "not_json",
    });
  });

  it("refuses one that is far too large to be a handoff", () => {
    // Bounded by a stat, not by reading it: pointing DASH at a huge file costs a
    // syscall rather than the heap.
    expect(readHandoff(write("huge", "x".repeat(MAX_HANDOFF_BYTES + 1)))).toMatchObject({
      ok: false,
      problem: "too_large",
    });
  });
});

describe("verifying one", () => {
  const pointer = { file: "/wherever/" + HANDOFF_FILE_NAME, nonce: NONCE };

  it("accepts the nonce that is in the file", () => {
    expect(verifyHandoff(handoff(), pointer, new Date())).toMatchObject({ ok: true });
  });

  it("refuses a nonce that is not", () => {
    // Proof of possession: this is what a page that guessed the project path,
    // but could not read the file, would fail.
    expect(verifyHandoff(handoff(), { ...pointer, nonce: "c".repeat(64) })).toMatchObject({
      ok: false,
      problem: "nonce_mismatch",
    });
  });

  it("refuses an expired link, and says it is not the agent's fault", () => {
    const stale = handoff({ expires_at: new Date(Date.now() - 1_000).toISOString() });
    const result = verifyHandoff(stale, pointer);
    expect(result).toMatchObject({ ok: false, problem: "expired" });
    expect(result.ok ? "" : result.detail).toMatch(/nothing is wrong with the agent/i);
  });

  it("refuses one with no expiry rather than treating it as forever", () => {
    expect(verifyHandoff(handoff({ expires_at: "never" }), pointer)).toMatchObject({
      ok: false,
      problem: "malformed",
    });
  });

  it("compares nonces without leaking a prefix", () => {
    expect(nonceMatches(NONCE, NONCE)).toBe(true);
    expect(nonceMatches(NONCE, NONCE.slice(0, -1) + "b")).toBe(false);
    // Different lengths must not throw, which is what timingSafeEqual does.
    expect(nonceMatches(NONCE, "short")).toBe(false);
  });
});

describe("building one", () => {
  it("refuses a file set whose JSON encoding would exceed the reader's bound", () => {
    const built = buildHandoff(
      facts({
        files: [
          { path: "agent.manifest.json", contents: "{}" },
          { path: "code.mjs", contents: "\u0000".repeat(3 * 1024 * 1024) },
        ],
      }),
      { handoff_id: HANDOFF_ID, nonce: NONCE },
    );
    expect(built).toMatchObject({ ok: false, problem: "too_large" });
  });

  it("cannot produce a document the reader would refuse", () => {
    // The producer and the consumer share this module precisely so a build-time
    // mistake surfaces on the author's machine rather than in a user's dialog.
    const built = buildHandoff(facts({ agent_id: "Not A Valid Id" }), {
      handoff_id: HANDOFF_ID,
      nonce: NONCE,
    });
    expect(built).toMatchObject({ ok: false, problem: "unsafe_agent_id" });
  });

  it("expires by default rather than lasting forever", () => {
    const built = buildHandoff(facts(), { handoff_id: HANDOFF_ID, nonce: NONCE });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(Date.parse(built.value.expires_at)).toBeGreaterThan(
        Date.parse(built.value.created_at),
      );
    }
  });
});
