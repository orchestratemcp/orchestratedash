/**
 * The four checks that say whether this agent still works.
 *
 * Run it with `node evals/run-evals.mjs`, or `npm run evals`. No network, no
 * model, no key, no dependency: node builtins only, the same rule the runtime
 * beside it keeps, because a check that needs an install is a check somebody
 * stops running.
 *
 * ## What it actually does
 *
 * It spawns `agent.mjs` the way DASH's runner does — a child process speaking
 * newline-delimited JSON on its own stdin and stdout — and plays DASH's side of
 * that conversation. So a pass means the program works, not that a test double
 * of the program works. The two things a run reaches outside itself are both
 * replaced by doubles that this file controls:
 *
 * - **The sources.** A local HTTP server on 127.0.0.1 serves fixed bytes, so a
 *   feed answers the same way every time and a failing source fails on purpose.
 * - **The broker.** Every `broker_request` the agent sends is answered here.
 *   Nothing reaches a provider and nothing costs anybody money.
 *
 * Each case runs in a fresh temporary folder holding a copy of the agent, so a
 * check never writes into the project and two cases cannot see each other.
 *
 * ## The four cases
 *
 * They are the four in `evals/cases.json`, which is generated from this
 * agent's own recipe: a normal run, a run with nothing to read, a run where one
 * source fails, and a run where every brokered request is refused. The last one
 * also asserts the negative that matters most — that the agent never asked for
 * an operation its own manifest does not declare.
 *
 * ## When one fails
 *
 * The failure names the case, the sentence from the recipe that was supposed to
 * be true, and what happened instead. Exit code 1, so this is usable from a
 * script; exit code 0 and one line per case otherwise.
 */

import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evalsDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(evalsDir);

/** How long one case gets before it is called a hang. */
const CASE_TIMEOUT_MS = 60_000;

/** The task the agent publishes and DASH's Run now targets. */
const READY_TASK_ID = "waiting-to-be-run";

/* ---------------------------------------------------------------------- *
 * The fixtures
 * ---------------------------------------------------------------------- */

/**
 * Two feeds and a broken one, as bytes.
 *
 * Written out rather than fetched, and small enough to read: the point of a
 * fixture is that somebody can see exactly what the agent was given when a
 * check fails.
 */
const FEED_A = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0"><channel><title>Fixture A</title>',
  "<item><title>A model that reads its own manifest</title>",
  "<link>https://example.invalid/a-1</link>",
  "<pubDate>Tue, 01 Sep 2026 09:00:00 GMT</pubDate></item>",
  "<item><title>An agent that waits to be asked</title>",
  "<link>https://example.invalid/a-2</link>",
  "<pubDate>Mon, 31 Aug 2026 09:00:00 GMT</pubDate></item>",
  "</channel></rss>",
].join("\n");

const FEED_B = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<rss version="2.0"><channel><title>Fixture B</title>',
  "<item><title>A folder is the unit of storage</title>",
  "<link>https://example.invalid/b-1</link>",
  "<pubDate>Sun, 30 Aug 2026 09:00:00 GMT</pubDate></item>",
  "</channel></rss>",
].join("\n");

/**
 * The source list one case gives the agent.
 *
 * `base` is the address of the local server, which is only known once it is
 * listening — which is why these are functions rather than constants.
 */
const SOURCE_SETS = {
  two_good: (base) => [
    { name: "Fixture A", url: `${base}/feed-a`, format: "rss" },
    { name: "Fixture B", url: `${base}/feed-b`, format: "rss" },
  ],
  none: () => [],
  one_broken: (base) => [
    { name: "Fixture A", url: `${base}/feed-a`, format: "rss" },
    { name: "Broken source", url: `${base}/broken`, format: "rss" },
  ],
};

/** What each case does about the sources and about the broker. */
const CASE_PLAN = {
  normal_input: { sources: "two_good", broker: "allow" },
  missing_input: { sources: "none", broker: "allow" },
  tool_failure: { sources: "one_broken", broker: "allow" },
  denied_permission: { sources: "two_good", broker: "refuse" },
};

/* ---------------------------------------------------------------------- *
 * Running one case
 * ---------------------------------------------------------------------- */

/**
 * Serve the fixtures, and one address that answers with an error.
 *
 * On 127.0.0.1 and on a port the operating system picks, so two checks running
 * at once — or a check running beside anything else — cannot collide.
 */
function startFixtureServer() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/feed-a") {
        response.writeHead(200, { "content-type": "application/rss+xml" });
        response.end(FEED_A);
        return;
      }
      if (request.url === "/feed-b") {
        response.writeHead(200, { "content-type": "application/rss+xml" });
        response.end(FEED_B);
        return;
      }
      // The failure this suite is about: a source that answers, and answers
      // with something that is not a feed and not a success.
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("this source is having a bad day");
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, base: `http://127.0.0.1:${String(address.port)}` });
    });
  });
}

/**
 * A copy of the agent, in a folder of its own.
 *
 * Only the four files a run needs. `reports/` and `runs/` are deliberately not
 * copied: a check must not read a document an earlier run left behind and call
 * it this run's output.
 */
function stageAgent(sources) {
  const workspace = mkdtempSync(path.join(tmpdir(), "dash-eval-"));
  for (const file of ["agent.mjs", "dash-agent-sdk.mjs", "agent.manifest.json"]) {
    cpSync(path.join(projectDir, file), path.join(workspace, file));
  }
  writeFileSync(
    path.join(workspace, "sources.json"),
    `${JSON.stringify({ sources }, null, 2)}\n`,
    "utf8",
  );
  return workspace;
}

/**
 * Spawn the agent, ask it to run once, and collect everything it said.
 *
 * The environment is stripped the way the runner strips it: no `DASH_INGEST_*`,
 * so nothing is posted anywhere and the only record is the conversation on this
 * pipe. `DASH_EVAL` is set so an agent that wants to behave differently under a
 * check can, and so the one variable in scope is obviously not a credential.
 */
function runAgent(workspace, plan, manifest) {
  return new Promise((resolve) => {
    const environment = { ...process.env, DASH_EVAL: "1" };
    delete environment.DASH_INGEST_URL;
    delete environment.DASH_INGEST_TOKEN;

    const child = spawn(process.execPath, ["agent.mjs"], {
      cwd: workspace,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const collected = {
      artifacts: [],
      events: [],
      brokerRequests: [],
      acks: [],
      logs: [],
      stderr: "",
      finished: null,
    };
    let asked = false;
    let buffer = "";
    let settling = false;

    /**
     * Stop the agent, and wait until it has actually stopped.
     *
     * The waiting is the part that matters. A check that resolved as soon as it
     * had sent SIGTERM would delete the workspace out from under a process that
     * still has files in it open, which on Windows is not a race that sometimes
     * works: it is `EPERM` on the folder, every time, reported as if the checks
     * themselves were broken.
     */
    const settle = () => {
      if (settling) {
        return;
      }
      settling = true;
      clearTimeout(timer);

      const done = () => resolve(collected);
      if (child.exitCode !== null || child.signalCode !== null) {
        done();
        return;
      }
      child.once("exit", done);
      try {
        child.kill("SIGTERM");
      } catch {
        done();
        return;
      }
      // A child that ignores the signal must not hang the suite.
      const hard = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
        done();
      }, 5_000);
      hard.unref?.();
      child.once("exit", () => clearTimeout(hard));
    };

    const timer = setTimeout(() => {
      collected.timedOut = true;
      settle();
    }, CASE_TIMEOUT_MS);

    const say = (message) => {
      if (!child.stdin.destroyed) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      }
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      collected.stderr += chunk;
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          collected.logs.push(line);
          continue;
        }

        if (message?.type === "state") {
          if (!asked) {
            asked = true;
            say({
              type: "command",
              command: "retry",
              command_id: "eval-1",
              target: { agent_id: manifest.agent.name, task_id: READY_TASK_ID },
            });
          }
          continue;
        }
        if (message?.type === "ack") {
          collected.acks.push(message);
          continue;
        }
        if (message?.type === "artifact") {
          collected.artifacts.push(message.artifact);
          continue;
        }
        if (message?.type === "telemetry") {
          collected.events.push(message.event);
          if (message.event?.type === "run_completed" || message.event?.type === "run_failed") {
            collected.finished = message.event;
            // Give the last artifact line time to be read before the pipe is
            // closed. The events and the artifacts arrive in order, but the
            // run's own end is not the last thing written to this pipe.
            setTimeout(settle, 100);
          }
          continue;
        }
        if (message?.type === "broker_request") {
          collected.brokerRequests.push(message.request);
          say(
            plan.broker === "allow"
              ? {
                  type: "broker_response",
                  request_id: message.request.request_id,
                  ok: true,
                  result: allowedResult(),
                }
              : {
                  type: "broker_response",
                  request_id: message.request.request_id,
                  ok: false,
                  // The refusal DASH gives for a connection nobody has
                  // connected. A refusal is a normal outcome, not an error.
                  refusal: "not_connected",
                },
          );
          continue;
        }
        if (message?.type === "browser_request") {
          say({
            type: "browser_response",
            request_id: message.request.request_id,
            ok: false,
            refusal: "origin_not_allowed",
          });
        }
      }
    });

    child.on("error", (error) => {
      collected.spawnError = String(error);
      settle();
    });
  });
}

/**
 * What a permitted brokered call answers with.
 *
 * Shaped like a curation because that is the one operation the templates in
 * this family use, and deliberately trivial: an eval that returned a convincing
 * summary would be an eval measuring the fixture's prose.
 */
function allowedResult() {
  return {
    groups: [{ label: "Everything in this run", items: [0], summary: "One group, for the check." }],
    overview: "A fixture answer. No model was reached.",
    model: "eval-double",
  };
}

/* ---------------------------------------------------------------------- *
 * What each case has to be true
 * ---------------------------------------------------------------------- */

/** Everything wrong with one case's run. Empty means it passed. */
function judge(kind, collected, manifest, spec) {
  const problems = [];
  const say = (problem) => problems.push(problem);

  if (collected.spawnError !== undefined) {
    say(`the agent could not be started: ${collected.spawnError}`);
    return problems;
  }
  if (collected.timedOut === true) {
    say(`nothing ended the run within ${String(CASE_TIMEOUT_MS / 1000)} seconds`);
    return problems;
  }
  if (collected.finished === null) {
    say("the run never reported an ending");
    return problems;
  }
  if (collected.finished.type !== "run_completed") {
    say(`the run ended as ${String(collected.finished.type)}: ${String(collected.finished.detail)}`);
  }

  // Every step the run reported has to be a step the manifest planned.
  // `lib/analyze.ts` grades a real run this way, so a program that has drifted
  // from its own route is caught here rather than in a verdict weeks later.
  const planned = new Set(spec.steps.map((step) => step.component_id));
  for (const event of collected.events) {
    if (event.type === "step_started" && !planned.has(event.component_id)) {
      say(
        `it ran a step called "${String(event.component_id)}", which this agent's recipe does not plan`,
      );
    }
  }

  // Nothing may be asked of the broker that this agent's own manifest does not
  // declare. True of every case, and the whole point of one of them.
  const declared = declaredOperations(manifest);
  for (const request of collected.brokerRequests) {
    const asked = `${String(request.connection_id)}:${String(request.operation)}`;
    if (!declared.has(asked)) {
      say(`it asked the broker for ${asked}, which its manifest does not declare`);
    }
  }

  const digest = collected.artifacts.find((artifact) => artifact.kind === "digest");

  if (kind === "normal_input") {
    for (const emission of spec.emits) {
      if (!collected.artifacts.some((artifact) => artifact.kind === emission.kind)) {
        say(`it never sent a ${String(emission.kind)}`);
      }
    }
    if (digest === undefined) {
      say("it never sent a digest");
    } else {
      const items = digest.items ?? [];
      if (items.length === 0) {
        say("the digest was empty, though both sources answered with items");
      }
      for (const item of items) {
        if (typeof item.source_url !== "string" || item.source_url.length === 0) {
          say(`the item "${String(item.headline)}" does not say where it came from`);
        }
      }
    }
  }

  if (kind === "missing_input") {
    if (digest === undefined) {
      say("it sent nothing at all, so there is no record that it ran and found nothing");
    } else if ((digest.items ?? []).length > 0) {
      say("the digest has items in it, though there were no sources to read");
    }
  }

  if (kind === "tool_failure") {
    if (digest === undefined) {
      say("it never sent a digest, so the source that failed was not reported anywhere");
    } else {
      const fetched = digest.sources_fetched ?? [];
      const failed = fetched.filter((entry) => entry.status !== "ok" && entry.status !== "empty");
      if (failed.length === 0) {
        say("the digest does not name the source that failed; a hidden failure reads as no news");
      }
      if ((digest.items ?? []).length === 0) {
        say("the items from the source that worked are missing; one bad source lost the whole run");
      }
    }
  }

  if (kind === "denied_permission") {
    if (digest === undefined) {
      say("a refused brokered request left the run with nothing to show");
    } else if ((digest.items ?? []).length === 0) {
      say("a refused brokered request lost the items the run had already collected");
    }
  }

  return problems;
}

/**
 * Every `connection:operation` pair this agent's manifest allows it to ask for.
 *
 * Read from the manifest rather than from a list here, because the manifest is
 * what DASH holds the agent to. A capability that is not in it is one the broker
 * would refuse, and an agent asking for one is an agent whose declaration and
 * whose behaviour have come apart.
 */
function declaredOperations(manifest) {
  const pairs = new Set();
  const connections = manifest?.agent_dom?.connections;
  if (!Array.isArray(connections)) {
    return pairs;
  }
  for (const connection of connections) {
    if (typeof connection?.id !== "string" || !Array.isArray(connection.capabilities)) {
      continue;
    }
    for (const capability of connection.capabilities) {
      if (typeof capability?.id === "string") {
        pairs.add(`${connection.id}:${capability.id}`);
      }
    }
  }
  return pairs;
}

/* ---------------------------------------------------------------------- *
 * The suite
 * ---------------------------------------------------------------------- */

async function main() {
  const spec = JSON.parse(readFileSync(path.join(evalsDir, "cases.json"), "utf8"));
  const manifest = JSON.parse(
    readFileSync(path.join(projectDir, "agent.manifest.json"), "utf8"),
  );

  const { server, base } = await startFixtureServer();
  let failures = 0;

  try {
    for (const acceptance of spec.cases) {
      const plan = CASE_PLAN[acceptance.kind];
      if (plan === undefined) {
        process.stdout.write(`?  ${acceptance.kind}: no check is written for this kind\n`);
        failures += 1;
        continue;
      }

      const workspace = stageAgent(SOURCE_SETS[plan.sources](base));
      let problems;
      try {
        const collected = await runAgent(workspace, plan, manifest);
        problems = judge(acceptance.kind, collected, manifest, spec);
      } finally {
        // `maxRetries` for the same reason `settle` waits: a file handle can
        // outlive the process that held it by a few milliseconds on Windows.
        rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }

      if (problems.length === 0) {
        process.stdout.write(`ok ${acceptance.kind}: ${acceptance.expect}\n`);
        continue;
      }
      failures += 1;
      process.stdout.write(`FAIL ${acceptance.kind}\n`);
      process.stdout.write(`     fixture:  ${acceptance.fixture}\n`);
      process.stdout.write(`     expected: ${acceptance.expect}\n`);
      for (const problem of problems) {
        process.stdout.write(`     but:      ${problem}\n`);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }

  process.stdout.write(
    `\n${String(spec.cases.length - failures)} of ${String(spec.cases.length)} checks passed.\n`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`the checks could not run: ${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
