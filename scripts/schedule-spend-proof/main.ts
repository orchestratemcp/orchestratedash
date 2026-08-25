/**
 * MAR-784 acceptance proof: a scheduled fire spends inside a ceiling, and stops
 * at it (ADR 0029 amendment 1).
 *
 * Launched by `node scripts/prove-schedule-spend.mjs`, which bundles this file
 * and the runner beside it. A **sibling** of `scripts/schedule-proof/main.ts`
 * rather than an extension of it, and the split is the point: that proof's whole
 * content is *nothing polls the runner*, and this one's is *DASH is open and
 * answering*. Folding them together would have produced a harness with a flag
 * for whether its own premise held.
 *
 * ## What it is a proof of, precisely
 *
 * The unit suite proves that a ceiling is stored, parsed, bounded, reported and
 * clamped — all in one process, against injected clocks and fake channels. None
 * of that can answer the two questions this feature is judged on:
 *
 * > *When the runner starts an agent by itself at a time somebody picked, does
 * > that agent's model step actually get paid for — by a real provider, with a
 * > real key, through DASH's own broker?*
 *
 * > *And when it has used the number the person allowed, does the next step get
 * > refused and the run finish anyway?*
 *
 * So: a real detached runner, a real schedule that comes round in real
 * wall-clock time, the real Agent Kit template as one of the two agents, and
 * DASH's real `createBroker` standing where `electron/broker-host.ts` stands.
 *
 * ## Why DASH is open here, and why that is not a weaker proof
 *
 * ADR 0029 amendment 1 decides that the ceiling travels **from** the runner
 * **to** the broker that holds the key, and that broker is in DASH's window. So
 * a scheduled run spends while DASH is open and cannot while it is closed — the
 * amendment says so, and `AGENT_TRIGGER_COPY.spend.needs_dash_open` puts it on
 * the panel beside the switch.
 *
 * This harness therefore plays DASH's side of the pipe, the way
 * `tests/scout-curates.test.ts` does and for its stated reason: it drains
 * `/broker/drain`, reads the `scheduled_allowances` the runner reported,
 * corroborates each against its own scratch store, opens the allowance on a real
 * broker, adjudicates, and writes the answer back. Every line of that is the
 * code `electron/broker-host.ts` runs; what is not here is Electron, which holds
 * the vault and nothing else this proof needs.
 *
 * ## The key, and the two modes
 *
 * `DASH_PROOF_MODEL_KEY` makes it a **real** run: two calls, at most, to a real
 * provider, on the key in that variable. The key is never printed, never
 * written to the scratch store, and never leaves the broker's own authorization
 * header.
 *
 * Without it the harness serves a provider on the loopback and says so in every
 * line that could otherwise be read as a claim about a real one. That mode
 * proves the seam and the ceiling and **does not** prove that a provider
 * answered — project memory has a note about exactly this trap (a loopback
 * fixture cannot refuse the way a real service does), so the mode is named in
 * the PASS line rather than in a comment.
 *
 * ## It touches only its own scratch directory
 *
 * `mkdtemp` plus `DASH_DATA_DIR`, `scripts/schedule-proof/main.ts`' rule
 * verbatim: this never resolves the installed `dash.sqlite`, and the runner it
 * spawns publishes its own endpoint so it cannot be confused with the one a live
 * DASH is talking to.
 */

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function say(line: string): void {
  console.log(`[spend-proof] ${line}`);
}

/* ---------------------------------------------------------------------- *
 * The runner's own channel, spoken by hand
 * ---------------------------------------------------------------------- */

/**
 * One HTTP request down the runner's endpoint.
 *
 * Copied from `scripts/schedule-proof/main.ts` rather than shared, for that
 * file's own stated reason: this is the DASH side of the channel and should
 * reach the runner the way anything else would, over the socket it published,
 * with the credential it minted. A helper both proofs imported would make each
 * of them partly a test of the helper.
 */
async function callRunner(
  endpoint: string,
  token: string,
  route: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint);
    let raw = "";
    socket.on("error", reject);
    socket.on("connect", () => {
      socket.write(
        `POST ${route} HTTP/1.1\r\n` +
          "Host: 127.0.0.1\r\n" +
          `Authorization: Bearer ${token}\r\n` +
          "Content-Type: application/json\r\n" +
          `Content-Length: ${String(Buffer.byteLength(payload))}\r\n` +
          "Connection: close\r\n\r\n" +
          payload,
      );
    });
    socket.on("data", (chunk) => {
      raw += chunk.toString("utf8");
    });
    socket.on("close", () => {
      const split = raw.indexOf("\r\n\r\n");
      const head = raw.slice(0, split);
      const rest = raw.slice(split + 4);
      if (!head.startsWith("HTTP/1.1 200")) {
        reject(new Error(`the runner answered: ${head.split("\r\n")[0] ?? "nothing"}`));
        return;
      }
      const start = rest.indexOf("{");
      const end = rest.lastIndexOf("}");
      if (start < 0 || end < start) {
        reject(new Error("the runner's reply carried no JSON"));
        return;
      }
      try {
        resolve(JSON.parse(rest.slice(start, end + 1)) as Record<string, unknown>);
      } catch (error: unknown) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ---------------------------------------------------------------------- *
 * Two loopback servers: a feed to read, and — in fixture mode — a provider
 * ---------------------------------------------------------------------- */

const FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item><title>A lab shipped a smaller model</title><link>https://example.invalid/one</link><pubDate>Mon, 24 Aug 2026 08:00:00 GMT</pubDate></item>
  <item><title>A round closed at a supervision startup</title><link>https://example.invalid/two</link><pubDate>Mon, 24 Aug 2026 07:00:00 GMT</pubDate></item>
</channel></rss>`;

async function serve(handler: (body: string) => { status: number; body: string }): Promise<{
  url: string;
  hits: () => number;
  close: () => void;
}> {
  let hits = 0;
  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    request.on("end", () => {
      hits += 1;
      const answer = handler(raw);
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("a loopback server did not take a port");
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    hits: () => hits,
    close: () => {
      server.close();
    },
  };
}

/* ---------------------------------------------------------------------- *
 * The two agents
 * ---------------------------------------------------------------------- */

/**
 * The manifest both agents stand on.
 *
 * **A real example manifest with one connection swapped**, rather than the four
 * fields the broker happens to read. The first draft of this harness wrote the
 * short version and every fire settled as `refused`, because the runner
 * validates a manifest against the whole v2 contract before it will start
 * anything — `planned_route`, `safety_contract`, `monitoring`, `provenance` and
 * `agent.goal` are all required, and none of them is the broker's business.
 * That refusal is the contract working, and building on top of a document that
 * satisfies it is the only honest way to get past it.
 *
 * What is swapped is `agent_dom.connections`, down to one: `lib/sample-agent.ts`'
 * shape for the model connection, with the four fields the broker actually
 * reads — `ownership: "dash_managed"` (so a key may be brokered at all), the
 * provider (which selects the profile), the capability, and the secret field.
 */
function manifestFor(name: string): string {
  const example = JSON.parse(
    readFileSync(
      path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;

  return JSON.stringify(
    {
      ...example,
      agent: { ...(example["agent"] as Record<string, unknown>), name },
      agent_dom: {
        ...(example["agent_dom"] as Record<string, unknown>),
        connections: [
          {
            id: "model_provider",
            provider: "openrouter",
            label: "Your model provider",
            purpose: "Turns what this agent found into a short summary.",
            ownership: "dash_managed",
            capabilities: [
              {
                id: "openrouter.digest.curate",
                label: "Turn what it found into a summary",
                access: "spend",
              },
            ],
            fields: [
              {
                id: "api_key",
                label: "API key",
                purpose: "So DASH can reach OpenRouter on this agent's behalf.",
                kind: "secret",
                required: true,
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  );
}

async function main(): Promise<void> {
  const runnerBundle = process.env["DASH_PROOF_RUNNER"];
  if (runnerBundle === undefined) {
    throw new Error(
      "DASH_PROOF_RUNNER must name the bundled runner. Use scripts/prove-schedule-spend.mjs.",
    );
  }

  const realKey = process.env["DASH_PROOF_MODEL_KEY"];
  const modelId = process.env["DASH_PROOF_MODEL_ID"] ?? "openai/gpt-4o-mini";
  const mode = realKey === undefined ? "loopback" : "real provider";

  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-spend-proof-"));
  process.env["DASH_DATA_DIR"] = dataDir;
  say(`scratch store: ${dataDir}`);
  say(`model calls will go to: ${mode}${realKey === undefined ? "" : ` (${modelId})`}`);

  /* ------------------------------------------------------------------ *
   * 1. A feed to read and, when there is no key, a provider to answer
   * ------------------------------------------------------------------ */

  const feed = await serve(() => ({ status: 200, body: FEED }));
  const provider = await serve(() => ({
    status: 200,
    body: JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              overview: "One model release and one funding round.",
              groups: [
                { label: "New models", summary: "A lab shipped something.", items: [1] },
                { label: "Money", summary: "A round closed.", items: [2] },
              ],
            }),
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 40 },
    }),
  }));

  /* ------------------------------------------------------------------ *
   * 2. Two agents: the real template, and one willing to ask past its ceiling
   * ------------------------------------------------------------------ */

  const agentsDir = path.join(dataDir, "agents");
  mkdirSync(agentsDir, { recursive: true });

  // `scout` — the Agent Kit template itself, unmodified, reading a real feed.
  const scoutDir = path.join(dataDir, "scout-project");
  mkdirSync(scoutDir, { recursive: true });
  copyFileSync(
    path.join(repoRoot, "agent-kit", "template", "agent.mjs"),
    path.join(scoutDir, "agent.mjs"),
  );
  writeFileSync(
    path.join(scoutDir, "sources.json"),
    JSON.stringify({ sources: [{ name: "Test Wire", url: `${feed.url}/feed.xml`, format: "rss" }] }),
    "utf8",
  );
  writeFileSync(path.join(scoutDir, "agent.manifest.json"), manifestFor("scout"), "utf8");
  writeFileSync(
    path.join(agentsDir, "scout.json"),
    JSON.stringify(
      {
        agent_id: "scout",
        manifest_path: path.join(scoutDir, "agent.manifest.json"),
        command: process.execPath,
        args: [path.join(scoutDir, "agent.mjs")],
        cwd: scoutDir,
      },
      null,
      2,
    ),
    "utf8",
  );

  // `probe` — the protocol fixture, told to ask twice. The template curates
  // exactly once per run, so nothing real in this repository can demonstrate
  // running out; see `AGENT_CURATE` in `tests/fixtures/protocol-agent.mjs`.
  const probeManifest = path.join(dataDir, "probe.manifest.json");
  writeFileSync(probeManifest, manifestFor("probe"), "utf8");
  writeFileSync(
    path.join(agentsDir, "probe.json"),
    JSON.stringify(
      {
        agent_id: "probe",
        manifest_path: probeManifest,
        command: process.execPath,
        args: [path.join(repoRoot, "tests", "fixtures", "protocol-agent.mjs")],
        env: { AGENT_PENDING: "1", AGENT_CURATE: "2" },
      },
      null,
      2,
    ),
    "utf8",
  );
  say("registered two agents, stopped, with nothing running");

  /* ------------------------------------------------------------------ *
   * 3. A runner, detached
   * ------------------------------------------------------------------ */

  const runner = spawn(process.execPath, [runnerBundle], {
    env: { ...process.env, DASH_RUNNER_DATA_DIR: dataDir },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [runner.stdout, runner.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[runner] ${chunk.toString("utf8")}`);
    });
  }

  const endpointFile = path.join(dataDir, "runner.json");
  let endpoint: string | null = null;
  for (let look = 0; look < 60 && endpoint === null; look += 1) {
    await sleep(250);
    try {
      endpoint = (JSON.parse(readFileSync(endpointFile, "utf8")) as { endpoint: string }).endpoint;
    } catch {
      // Not listening yet.
    }
  }
  if (endpoint === null) {
    throw new Error("the runner never published an endpoint");
  }
  const token = readFileSync(path.join(dataDir, "runner.key"), "utf8").trim();
  say(`runner listening, pid ${String(runner.pid)}`);

  /* ------------------------------------------------------------------ *
   * 4. DASH's own store, and DASH's own broker
   * ------------------------------------------------------------------ */

  const { db } = await import("../../lib/db");
  const { writeAgentSchedule, readAgentSchedule, readAgentSchedules, recordScheduleRuns, readScheduleRuns, readScheduleSpend } =
    await import("../../lib/schedule/store");
  const { buildAgentScheduleView } = await import("../../lib/views/agent-schedule");
  const { createBroker } = await import("../../lib/broker/execute");
  const { agentPrincipal } = await import("../../lib/broker/principal");
  const { parseBrokerRequest, encodeBrokerResponse } = await import("../../lib/broker/protocol");
  const { SPEND_ALLOWANCE_MS } = await import("../../lib/broker/spend-allowance");
  const { aiAuthHeaders, aiProviderById } = await import("../../lib/ai/providers");

  db();

  const profile = aiProviderById("openrouter");
  if (profile === null) {
    throw new Error("openrouter is not a provider this build knows");
  }

  /**
   * The broker, wired the way `electron/broker-host.ts` wires it minus the vault.
   *
   * Every dependency here is one that file also supplies; what is different is
   * only where the values come from. The key is an environment variable rather
   * than `safeStorage`, and `fetchImpl` is redirected to the loopback provider
   * when there is no key — which is the one seam this harness moves, and it is
   * named in the PASS line for that reason.
   */
  const audited: Array<{ agent: string; operation: string; decision: string; refusal: string | null }> = [];
  const broker = createBroker({
    readManifest: (principal) =>
      principal.kind === "chief"
        ? null
        : (JSON.parse(
            readFileSync(
              principal.agent_id === "scout"
                ? path.join(scoutDir, "agent.manifest.json")
                : probeManifest,
              "utf8",
            ),
          ) as never),
    readCredential: async () => {
      await Promise.resolve();
      return {
        kind: "found" as const,
        credential: {
          version: 1 as never,
          kind: "ai_provider_key" as never,
          provider: "openrouter" as never,
          // The one place the key exists in this process. Never logged, never
          // written to the scratch store, never put in a settlement row.
          key: realKey ?? "loopback-not-a-real-key",
          obtained_at: new Date().toISOString(),
        } as never,
      };
    },
    mintAuthorization: async (credential) => {
      await Promise.resolve();
      return aiAuthHeaders(profile, (credential as { key: string }).key);
    },
    /*
     * Real `fetch` when there is a key, and the loopback otherwise. The
     * substitution is total — a request that would have gone to the provider
     * goes to `provider.url` with the same method, headers and body — so the
     * broker's own step order, its path check and its response bounds are all
     * exercised either way. What is not exercised without a key is the provider.
     */
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (realKey !== undefined) {
        return fetch(input, init);
      }
      return fetch(`${provider.url}/v1/chat/completions`, init);
    }) as typeof fetch,
    readModelChoice: () => modelId,
    audit: (row) => {
      audited.push({
        agent: row.agent,
        operation: row.operation,
        decision: row.decision,
        refusal: row.refusal,
      });
      // Written into the same table `electron/broker-host.ts` writes, because
      // `readScheduleSpend` reads it back and the receipt on the panel is the
      // thing being proven.
      db()
        .prepare(
          "INSERT INTO broker_audit (agent, connection_id, operation, request_id, decision, " +
            "refusal, input_keys, result_count, account_hint, duration_ms, decided_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          row.agent,
          row.connection_id,
          row.operation,
          row.request_id,
          row.decision,
          row.refusal,
          JSON.stringify(row.input_keys),
          row.result_count,
          row.account_hint,
          row.duration_ms,
          row.decided_at,
        );
    },
    now: () => new Date(),
  });

  /* ------------------------------------------------------------------ *
   * 5. Two schedules, one with room for two calls and one with room for one
   * ------------------------------------------------------------------ */

  const due = new Date(Date.now() + 60_000);
  due.setSeconds(0, 0);
  const at = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
  const createdAt = new Date(Date.now() - 60_000).toISOString();

  for (const [agent, allowance] of [
    ["scout", 2],
    ["probe", 1],
  ] as const) {
    const saved = writeAgentSchedule(agent, at, createdAt, allowance);
    if (!saved.ok) {
      throw new Error(`${agent}'s schedule would not save: ${saved.refusal ?? "no reason"}`);
    }
    say(`schedule saved: ${agent} every day at ${at}, allowed ${String(allowance)} model call(s)`);
  }

  const pushed = await callRunner(endpoint, token, "/schedules", {
    schedules: readAgentSchedules(),
    since: {},
  });
  say(`pushed to the runner: ${JSON.stringify(pushed)}`);

  /* ------------------------------------------------------------------ *
   * 6. DASH stays open and answers, which is what the amendment requires
   * ------------------------------------------------------------------ */

  const openedFires = new Set<string>();
  let granted = 0;

  /** One pass of `electron/broker-host.ts`, in miniature but not in outline. */
  async function brokerPass(): Promise<void> {
    const body = (await callRunner(endpoint as string, token, "/broker/drain", {})) as {
      requests?: Array<{ agent_id: string; request: unknown }>;
      scheduled_allowances?: Array<{
        agent_id: string;
        fire_id: string;
        opened_at: string;
        calls: number;
      }>;
    };

    // The ordering the whole design rests on: allowances first, in the same
    // reply as the requests they cover.
    for (const allowance of body.scheduled_allowances ?? []) {
      if (openedFires.has(allowance.fire_id)) {
        continue;
      }
      const standing = readAgentSchedule(allowance.agent_id);
      if (standing === null || !standing.enabled || standing.allowance_calls <= 0) {
        continue;
      }
      const calls = Math.min(allowance.calls, standing.allowance_calls);
      openedFires.add(allowance.fire_id);
      granted += 1;
      broker.allowRunSpend(allowance.agent_id, new Date(), calls);
      say(
        `opened ${allowance.agent_id}'s scheduled allowance: ${String(calls)} call(s) ` +
          `(runner said ${String(allowance.calls)}, store says ${String(standing.allowance_calls)})`,
      );
    }

    const answers: Array<{ agent_id: string; line: string }> = [];
    for (const entry of body.requests ?? []) {
      const parsed = parseBrokerRequest(entry.request);
      if (parsed === null) {
        continue;
      }
      const response = await broker.handle(agentPrincipal(entry.agent_id), parsed, "agent");
      say(
        `${entry.agent_id} asked for ${parsed.operation}: ` +
          `${response.ok ? "allowed" : `refused (${response.refusal ?? "no reason"})`}`,
      );
      answers.push({ agent_id: entry.agent_id, line: encodeBrokerResponse(response) });
    }
    if (answers.length > 0) {
      await callRunner(endpoint as string, token, "/broker/responses", { responses: answers });
    }
  }

  const until = due.getTime() + 110_000;
  say(`DASH is open and polling. Waiting for ${at} and both fires…`);
  while (Date.now() < until) {
    await brokerPass();
    await sleep(500);
  }

  /* ------------------------------------------------------------------ *
   * 7. The drain, the write, and the two panels
   * ------------------------------------------------------------------ */

  const drained = (await callRunner(endpoint, token, "/schedules/drain", {})) as {
    settled?: Array<Record<string, unknown>>;
  };
  const settled = drained.settled ?? [];
  say(`the runner had ${String(settled.length)} settled window(s) waiting`);
  for (const row of settled) {
    say(`  ${JSON.stringify(row)}`);
  }
  say(`wrote ${String(recordScheduleRuns(settled as never))} row(s) into dash.sqlite`);

  const panels: Record<string, ReturnType<typeof buildAgentScheduleView>> = {};
  for (const agent of ["scout", "probe"]) {
    const runs = readScheduleRuns(agent);
    const newest = runs[0] ?? null;
    const view = buildAgentScheduleView(
      readAgentSchedule(agent),
      runs,
      newest === null || newest.allowance_calls <= 0
        ? null
        : readScheduleSpend(agent, newest.settled_at, SPEND_ALLOWANCE_MS),
    );
    panels[agent] = view;

    say("");
    say(`── what ${agent}'s page draws ───────────────────────────────`);
    say(view.standing_line);
    say(`  · ${view.spend_line}`);
    if (view.spend_bound !== "") {
      say(`  · ${view.spend_bound}`);
    }
    if (view.last === null) {
      say("Scheduled runs: nothing has come round yet.");
    } else {
      say(`Scheduled runs: [${view.last.outcome_label}] ${view.last.due_at}`);
      say(`  ${view.last.detail}`);
      if (view.last.spend !== null) {
        say(`  ${view.last.spend.line}`);
        if (view.last.spend.ceiling_line !== null) {
          say(`  ${view.last.spend.ceiling_line}`);
        }
      }
    }
    say("─────────────────────────────────────────────────────────────");
  }
  say("");

  /* ------------------------------------------------------------------ *
   * 8. The verdict
   * ------------------------------------------------------------------ */

  const failures: string[] = [];
  const spendRows = audited.filter((row) => row.operation.endsWith(".digest.curate"));
  const allowedRows = spendRows.filter((row) => row.decision === "allowed");
  const refusedRows = spendRows.filter((row) => row.decision === "refused");

  if (granted < 2) {
    failures.push(`only ${String(granted)} scheduled allowance(s) were opened; expected 2`);
  }
  if (!settled.some((row) => row["agent"] === "scout" && row["outcome"] === "ran")) {
    failures.push("scout's window did not settle as ran");
  }
  if (allowedRows.length < 2) {
    failures.push(
      `only ${String(allowedRows.length)} model call(s) were allowed; expected one per agent`,
    );
  }
  if (!refusedRows.some((row) => row.agent === "probe" && row.refusal === "needs_a_person")) {
    failures.push("probe was never refused for want of allowance, so no ceiling was reached");
  }
  if (panels["probe"]?.last?.spend?.ceiling_line === null) {
    failures.push("probe's panel does not say the ceiling was reached");
  }
  if (panels["scout"]?.spend_line === "" || panels["scout"]?.spend_bound === "") {
    failures.push("scout's panel does not carry both money sentences");
  }
  if (realKey === undefined && provider.hits() === 0) {
    failures.push("the loopback provider was never reached, so nothing was actually asked");
  }

  say(
    `model calls: ${String(allowedRows.length)} allowed, ${String(refusedRows.length)} refused; ` +
      `provider hits: ${String(realKey === undefined ? provider.hits() : allowedRows.length)}`,
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      say(`FAIL: ${failure}`);
    }
    process.exitCode = 1;
  } else if (realKey === undefined) {
    say(
      "PASS (loopback): the ceiling opened, was spent, and stopped the next call — " +
        "against a provider on 127.0.0.1. No real provider was asked. " +
        "Re-run with DASH_PROOF_MODEL_KEY set to prove that half.",
    );
  } else {
    say(
      "PASS (real provider): a scheduled fire spent a real, bounded model call, " +
        "and the run that hit its ceiling degraded and said so.",
    );
  }

  try {
    await callRunner(endpoint, token, "/shutdown", {});
  } catch {
    // A runner that closed the socket on its way out is a runner that stopped.
  }
  feed.close();
  provider.close();
  say(`scratch store left at ${dataDir} for reading`);
}

void main().catch((error: unknown) => {
  console.error(
    `[spend-proof] failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exit(1);
});
