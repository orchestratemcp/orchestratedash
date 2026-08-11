/**
 * The scout, run for real, with a feed on this machine and a broker that is a
 * function (MAR-619).
 *
 * Every other test in this issue drives one half of the chain: the broker's
 * parsing is pure, the renderer takes a fixture, the manifest is a document.
 * **Nothing checked that the agent actually asks.** That gap is the one worth
 * closing here, because it is where this feature would fail silently: an agent
 * that never sends a `broker_request` produces a perfectly good digest, and the
 * only symptom is that it is never grouped.
 *
 * So this spawns `agent-kit/template/agent.mjs` as the runner would, speaks the
 * newline-JSON protocol at it over stdin and stdout, serves it a real RSS feed
 * from `127.0.0.1`, and answers its brokered request the way `electron/broker-host.ts`
 * would. No provider, no key, no Electron, no network beyond the loopback.
 *
 * The two cases are the two the issue asks for:
 *
 * 1. **A grant resolves.** The agent asks, the answer is a grouping, and the
 *    artifact carries it with every item still pointing at its own source.
 * 2. **No grant.** The agent does not ask at all, and the artifact says why in
 *    a reason DASH has a sentence for.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { CURATE_OPERATION_ID } from "../lib/sample-agent";
import type { DigestArtifact } from "../lib/contracts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = path.join(repoRoot, "agent-kit", "template", "agent.mjs");

const created: string[] = [];
afterAll(() => {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /*
       * A temp directory that would not delete is not a failed test, and under
       * this suite's parallel load it was reported as one: Windows refuses to
       * remove a directory any process still has open, `rmSync` threw EPERM out
       * of `afterAll`, and vitest failed the whole **file** while all four of
       * its tests had passed. `tests/host-run-channel.test.ts` fails the same
       * way for the same reason.
       *
       * `runOnce` now waits for the child to exit rather than only signalling
       * it, which is the actual fix; this is the belt to that pair of braces.
       * The operating system reclaims the directory.
       */
    }
  }
});

const FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>A lab shipped a smaller model</title><link>https://example.invalid/one</link><pubDate>Mon, 11 Aug 2026 08:00:00 GMT</pubDate></item>
  <item><title>A round closed at a supervision startup</title><link>https://example.invalid/two</link><pubDate>Mon, 11 Aug 2026 07:00:00 GMT</pubDate></item>
  <item><title>An unrelated thing happened</title><link>https://example.invalid/three</link><pubDate>Mon, 11 Aug 2026 06:00:00 GMT</pubDate></item>
</channel></rss>`;

/** A feed on the loopback, so the agent does a real fetch against a real server. */
async function serveFeed(): Promise<{ url: string; close: () => void }> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/rss+xml" });
    response.end(FEED);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the feed server did not take a port");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}/feed.xml`,
    close: () => {
      server.close();
    },
  };
}

/**
 * A project on disk, with or without a model provider declared.
 *
 * The manifest is the narrow thing the agent reads — `curateCapability` looks
 * for a capability id ending in the curation suffix and nothing else — so
 * `declaresProvider: false` produces the ordinary hand-scaffolded agent, which
 * is the degraded case rather than a broken one.
 */
function project(feedUrl: string, declaresProvider: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dash-scout-"));
  created.push(dir);

  copyFileSync(templatePath, path.join(dir, "agent.mjs"));
  writeFileSync(
    path.join(dir, "sources.json"),
    JSON.stringify({ sources: [{ name: "Test Wire", url: feedUrl, format: "rss" }] }),
    "utf8",
  );
  writeFileSync(
    path.join(dir, "agent.manifest.json"),
    JSON.stringify({
      manifest_version: 2,
      agent: { name: "scout-under-test" },
      agent_dom: {
        connections: declaresProvider
          ? [
              {
                id: "model_provider",
                provider: "openrouter",
                capabilities: [{ id: CURATE_OPERATION_ID, label: "Summarise", access: "spend" }],
              },
            ]
          : [],
      },
    }),
    "utf8",
  );
  return dir;
}

interface RunOutcome {
  artifact: DigestArtifact;
  /** Every brokered request the agent made. Empty is a real and expected answer. */
  asked: Array<{ connection_id: string; operation: string; input: Record<string, unknown> }>;
}

/**
 * Run the agent once and collect what it produced.
 *
 * Speaks the protocol rather than importing anything: `retry` is the verb Run
 * now sends, an `artifact` message is what the run produces, and a
 * `broker_request` is answered on the same pipe. That is the whole contract
 * between DASH and an agent, and driving it as bytes is what makes this a test
 * of the template rather than of a reimplementation of it.
 */
async function runOnce(
  dir: string,
  answer: (input: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<RunOutcome> {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ["agent.mjs"], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const asked: RunOutcome["asked"] = [];

  const outcome = await new Promise<RunOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("the agent produced no artifact in time"));
    }, 20_000);
    timer.unref?.();

    let buffer = "";
    let started = false;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // The agent's own `log()` output, which is prefixed so it cannot be
          // mistaken for a protocol message. Ignored here exactly as the runner
          // ignores it.
          continue;
        }

        if (message["type"] === "state" && !started) {
          // The first state means it is up and waiting. Run now is a `retry`.
          started = true;
          child.stdin.write(
            `${JSON.stringify({ type: "command", command: "retry", command_id: "press-1" })}\n`,
          );
          continue;
        }

        if (message["type"] === "broker_request") {
          const request = message["request"] as {
            request_id: string;
            connection_id: string;
            operation: string;
            input: Record<string, unknown>;
          };
          asked.push({
            connection_id: request.connection_id,
            operation: request.operation,
            input: request.input,
          });
          const result = answer(request.input);
          child.stdin.write(
            `${JSON.stringify(
              result === null
                ? {
                    type: "broker_response",
                    request_id: request.request_id,
                    ok: false,
                    refusal: "needs_a_person",
                  }
                : {
                    type: "broker_response",
                    request_id: request.request_id,
                    ok: true,
                    result,
                  },
            )}\n`,
          );
          continue;
        }

        if (message["type"] === "artifact") {
          clearTimeout(timer);
          resolve({ artifact: message["artifact"] as DigestArtifact, asked });
        }
      }
    });

    child.on("error", reject);
  });

  /*
   * Signalled, then actually waited for.
   *
   * `child.kill()` returns as soon as the signal is sent, and on Windows the
   * process still has its working directory open for a moment afterwards — long
   * enough that `afterAll`'s `rmSync` raced it and threw EPERM, failing a file
   * whose every test had passed. Waiting here is what makes the cleanup
   * ordinary rather than lucky.
   *
   * Bounded, because a child that will not die must not hang the suite: after
   * the grace period this gives up and lets the temp directory be the operating
   * system's problem.
   */
  child.kill();
  await new Promise<void>((resolve) => {
    const giveUp = setTimeout(resolve, 5_000);
    giveUp.unref?.();
    child.on("exit", () => {
      clearTimeout(giveUp);
      resolve();
    });
  });
  return outcome;
}

describe("the scout summarises what it found", () => {
  it("asks a model, and the digest comes back grouped with every source kept", async () => {
    const feed = await serveFeed();
    try {
      const dir = project(feed.url, true);
      const { artifact, asked } = await runOnce(dir, () => ({
        overview: "One model release and one funding round.",
        groups: [
          { label: "New models", summary: "A lab shipped something.", items: [1] },
          { label: "Money", summary: "A round closed.", items: [2] },
        ],
        model: "openai/gpt-5-mini",
      }));

      // It asked, on the connection its own manifest declares, for the
      // operation its own manifest names.
      expect(asked).toHaveLength(1);
      expect(asked[0]?.connection_id).toBe("model_provider");
      expect(asked[0]?.operation).toBe(CURATE_OPERATION_ID);

      // And what it sent was the headlines with **no addresses in them**. A URL
      // in the material is a URL a model can repeat into a group's title.
      const material = String(asked[0]?.input["material"] ?? "");
      expect(material).toContain("A lab shipped a smaller model");
      expect(material).not.toContain("https://");
      // No question member on this operation, and no model: the agent does not
      // name one and DASH substitutes the owner's.
      expect(asked[0]?.input["question"]).toBeUndefined();
      expect(asked[0]?.input["model"]).toBeUndefined();

      expect(artifact.curation?.state).toBe("curated");
      if (artifact.curation?.state !== "curated") {
        throw new Error("expected a curated digest");
      }
      expect(artifact.curation.overview).toContain("One model release");
      expect(artifact.curation.model).toBe("openai/gpt-5-mini");
      // The model answered in 1-based numbers; the artifact carries positions.
      expect(artifact.curation.groups.map((group) => group.items)).toEqual([[0], [1]]);

      // The point of the whole issue: every item still has its own link, and the
      // flat list is untouched so the grounding verdict is computed over exactly
      // what it always was.
      expect(artifact.items).toHaveLength(3);
      expect(artifact.items.map((item) => item.item_url)).toEqual([
        "https://example.invalid/one",
        "https://example.invalid/two",
        "https://example.invalid/three",
      ]);
    } finally {
      feed.close();
    }
  }, 30_000);

  it("drops a group naming an item this run does not have", async () => {
    const feed = await serveFeed();
    try {
      const dir = project(feed.url, true);
      const { artifact } = await runOnce(dir, () => ({
        groups: [
          { label: "Real", items: [1] },
          // A model naming an item that does not exist. The agent checks the
          // numbers against its own list, which is the only place that check
          // can be made — the broker's projection bounds them and cannot know
          // how many items this run found.
          { label: "Invented", items: [99] },
        ],
      }));

      if (artifact.curation?.state !== "curated") {
        throw new Error("expected a curated digest");
      }
      expect(artifact.curation.groups.map((group) => group.label)).toEqual(["Real"]);
    } finally {
      feed.close();
    }
  }, 30_000);

  it("writes the plain digest and says why when a grant does not resolve", async () => {
    const feed = await serveFeed();
    try {
      const dir = project(feed.url, true);
      // The refusal an agent gets when nobody pressed Run now — which cannot
      // happen through this test's own `retry`, and is exactly what an agent on
      // a timer would meet.
      const { artifact, asked } = await runOnce(dir, () => null);

      expect(asked).toHaveLength(1);
      expect(artifact.curation).toEqual({ state: "not_curated", reason: "needs_a_person" });
      // Complete either way. That is the honest degradation.
      expect(artifact.items).toHaveLength(3);
      expect(artifact.items[0]?.item_url).toBe("https://example.invalid/one");
    } finally {
      feed.close();
    }
  }, 30_000);

  it("does not ask at all when the agent declares no provider", async () => {
    const feed = await serveFeed();
    try {
      const dir = project(feed.url, false);
      const { artifact, asked } = await runOnce(dir, () => {
        throw new Error("an agent with no declared provider must not ask");
      });

      // The ordinary hand-scaffolded agent. It costs nothing, asks nothing, and
      // its digest is the digest it was always going to write.
      expect(asked).toEqual([]);
      expect(artifact.curation).toEqual({
        state: "not_curated",
        reason: "no_model_connection",
      });
      expect(artifact.items).toHaveLength(3);
    } finally {
      feed.close();
    }
  }, 30_000);
});
