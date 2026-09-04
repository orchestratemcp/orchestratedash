/**
 * A scaffolded agent, actually run (MAR-862, ADR 0032 decision 6).
 *
 * Every other test in this package judges documents. This one spawns the
 * program the scaffold writes, speaks DASH's runner protocol to it, and holds
 * what comes back to the contracts DASH holds it to. It is the closest a source
 * test gets to the behavioural proof — a fresh agent importing into the
 * installed build — and it is here because the claim being made is behavioural:
 * *an agent built by this plugin is adjudication-ready by construction.* A
 * template whose manifest validates and whose program emits a brief DASH would
 * reject is a template that passes every other test in this directory.
 *
 * No network. `sources.json` is emptied first, so the run reads nothing and
 * still has to produce both documents — which is also the honest edge case: an
 * agent that only emits a well-formed brief when it found something is an agent
 * whose worst runs are its least legible.
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentsRoot } from "../../../lib/agent-folders";
import { validateArtifact, validateEvent, type DigestArtifact } from "../../../lib/contracts";
import { resolveBriefCitations } from "../../../lib/brief/fingerprint";
import { scaffoldAgent } from "../src/agent-tools";
import { repoRoot } from "../src/paths";

let scratch: string;
const originalDataDir = process.env.DASH_DATA_DIR;

beforeAll(() => {
  if (!existsSync(path.join(repoRoot(), "tools", "dash-mcp", "dist", "open-in-dash.mjs"))) {
    execFileSync(process.execPath, [path.join(repoRoot(), "tools", "dash-mcp", "build.mjs")], {
      cwd: repoRoot(),
      stdio: "pipe",
    });
  }
}, 60_000);

beforeEach(() => {
  scratch = mkdtempSync(path.join(os.tmpdir(), "dash-mcp-run-"));
  const dataDir = path.join(scratch, "data");
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

interface Transcript {
  messages: Record<string, unknown>[];
  logs: string[];
}

/**
 * Start the agent, ask it to run once, and collect what it said.
 *
 * Resolves on `run_completed` or `run_failed` rather than on a timer: a fixed
 * wait either flakes on a slow machine or wastes the difference on every other
 * one, and the agent tells us when it is finished.
 */
async function runAgentOnce(projectDir: string): Promise<Transcript> {
  const child = spawn(process.execPath, ["agent.mjs"], {
    cwd: projectDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, DASH_INGEST_URL: undefined },
  });

  const transcript: Transcript = { messages: [], logs: [] };

  return await new Promise<Transcript>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the agent did not finish a run; it said: ${transcript.logs.join(" | ")}`));
    }, 20_000);

    const finish = (): void => {
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      resolve(transcript);
    };

    let buffer = "";
    let asked = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (line.startsWith("[agent]")) {
          transcript.logs.push(line);
          // It publishes before it is asked to do anything; the first line it
          // writes is the one that says it is ready.
          if (!asked) {
            asked = true;
            child.stdin.write(
              `${JSON.stringify({ type: "command", command: "retry", command_id: "1" })}\n`,
            );
          }
          continue;
        }

        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        transcript.messages.push(message);

        const event = message["event"] as { type?: string } | undefined;
        if (
          message["type"] === "telemetry" &&
          (event?.type === "run_completed" || event?.type === "run_failed")
        ) {
          finish();
          return;
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => transcript.logs.push(`[stderr] ${chunk}`));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function artifacts(transcript: Transcript): Record<string, unknown>[] {
  return transcript.messages
    .filter((message) => message["type"] === "artifact")
    .map((message) => message["artifact"] as Record<string, unknown>);
}

describe("an agent this plugin scaffolded", () => {
  let projectDir: string;
  let transcript: Transcript;

  beforeEach(async () => {
    projectDir = path.join(scratch, "project");
    const built = scaffoldAgent({
      directory: projectDir,
      name: "example-agent",
      display_name: "Example agent",
      summary: "Reads a few public sources and says what came in.",
    });
    expect(built.ok).toBe(true);

    // No network in this suite. The run still has to produce both documents.
    writeFileSync(
      path.join(projectDir, "sources.json"),
      `${JSON.stringify({ sources: [] }, null, 2)}\n`,
      "utf8",
    );

    transcript = await runAgentOnce(projectDir);
  }, 60_000);

  it("does not start a run until it is asked to", () => {
    // The first state it published, before the command was sent, has no run in
    // it — the property ADR 0003's manual-first rule turns on.
    const first = transcript.messages.find((message) => message["type"] === "state");
    expect((first?.["state"] as { runs: unknown[] }).runs).toEqual([]);
  });

  it("publishes one pending task, which is what Run now targets", () => {
    const first = transcript.messages.find((message) => message["type"] === "state");
    const tasks = (first?.["state"] as { tasks: { id: string; status: string }[] }).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("pending");
  });

  it("emits telemetry every one of DASH's own validators accepts", () => {
    const events = transcript.messages
      .filter((message) => message["type"] === "telemetry")
      .map((message) => message["event"]);

    expect(events.length).toBeGreaterThan(2);
    for (const event of events) {
      const validated = validateEvent(event);
      expect(validated.ok ? [] : validated.errors).toEqual([]);
    }
  });

  it("completes the run rather than failing it", () => {
    const events = transcript.messages
      .filter((message) => message["type"] === "telemetry")
      .map((message) => (message["event"] as { type: string }).type);
    expect(events).toContain("run_completed");
    expect(events).not.toContain("run_failed");
  });

  it("emits both documents, and the digest before the brief", () => {
    const kinds = artifacts(transcript).map((artifact) => artifact["kind"]);
    expect(kinds).toEqual(["digest", "brief"]);
  });

  it("emits artifacts DASH's own validator accepts", () => {
    for (const artifact of artifacts(transcript)) {
      const validated = validateArtifact(artifact);
      expect(validated.ok ? [] : validated.errors).toEqual([]);
    }
  });

  /**
   * The whole point. `resolveBriefCitations` is the join DASH performs on its
   * own side: it recomputes the fingerprint from the digest it holds and
   * withdraws every citation on a mismatch. `matched` here means a freshly
   * scaffolded agent's first run is adjudicable — the claim MAR-862 makes, held
   * to DASH's own function rather than to a re-implementation of it.
   */
  it("writes a brief DASH can join back to its digest", () => {
    const emitted = artifacts(transcript);
    const digest = validateArtifact(emitted[0]);
    const brief = validateArtifact(emitted[1]);
    expect(digest.ok && brief.ok).toBe(true);
    if (!digest.ok || !brief.ok || brief.value.kind !== "brief") {
      return;
    }

    const resolved = resolveBriefCitations(brief.value, [digest.value as DigestArtifact]);
    expect(resolved.state).toBe("matched");
  });

  it("binds every citation to a paragraph, and cites nothing that is not there", () => {
    const emitted = artifacts(transcript);
    const digest = validateArtifact(emitted[0]);
    const brief = validateArtifact(emitted[1]);
    if (!digest.ok || !brief.ok || brief.value.kind !== "brief" || digest.value.kind !== "digest") {
      throw new Error("expected a digest and a brief");
    }

    const count = digest.value.items.length;
    for (const section of brief.value.document.sections) {
      for (const paragraph of section.paragraphs) {
        for (const index of paragraph.items ?? []) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(count);
        }
      }
    }
  });

  it("claims no model, because none wrote it", () => {
    const brief = validateArtifact(artifacts(transcript)[1]);
    if (!brief.ok || brief.value.kind !== "brief") {
      throw new Error("expected a brief");
    }
    expect(brief.value.document.model).toBeUndefined();
  });

  it("carries no address in its prose, where a link would be dropped whole", () => {
    const brief = validateArtifact(artifacts(transcript)[1]);
    if (!brief.ok || brief.value.kind !== "brief") {
      throw new Error("expected a brief");
    }
    for (const section of brief.value.document.sections) {
      for (const paragraph of section.paragraphs) {
        expect(paragraph.body).not.toMatch(/(^|\s)(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i);
      }
    }
  });

  it("acknowledges the command it was given", () => {
    const ack = transcript.messages.find((message) => message["type"] === "ack");
    expect(ack).toMatchObject({ command_id: "1", ok: true });
  });
});
