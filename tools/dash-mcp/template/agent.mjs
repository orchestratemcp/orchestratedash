/**
 * Your agent.
 *
 * One file, no dependencies, and five things wired for you:
 *
 * 1. **DASH can watch it.** It publishes what it is doing on stdout, in the
 *    shape DASH's runner understands, every couple of seconds.
 * 2. **DASH can control it.** Retry, pause, resume and cancel arrive on stdin
 *    and are acknowledged. An unacknowledged command is reported as
 *    unacknowledged rather than assumed to have worked.
 * 3. **It records what it did.** Every run appends telemetry v1 events to
 *    `runs/events.jsonl` and emits them on the runner pipe.
 * 4. **It records what it produced.** A `digest` artifact — the raw roundup,
 *    every item carrying the address it came from.
 * 5. **It produces something that can be judged.** A `brief` artifact: a short
 *    document about that digest, whose every paragraph cites the items it is
 *    talking about by position, bound to the exact list it was written from.
 *
 * The part that is yours is `runOnce`. Everything below it is plumbing you
 * should be able to ignore, and `brief-fingerprint.mjs` is the one file you
 * should not touch at all — see its own header.
 *
 * ## Why the brief exists, and why it is a second document
 *
 * "One RAW and one curated. Don't mix them." The digest is the evidence and it
 * is never edited by the act of writing about it; the brief is the account, and
 * it is worth nothing unless you can check it against the evidence. So every
 * paragraph carries `items`: zero-based positions into the digest's own array.
 *
 * That only means anything if both documents are talking about the same list,
 * which is what `derived_from` is for. It carries the digest's id, its run, how
 * many items it had, and a fingerprint of them in order. DASH recomputes that
 * fingerprint from the digest it holds; if it differs, the brief is drawn with
 * **no citations at all**, because a link under a claim it does not support is
 * worse than no link.
 *
 * This is what makes an agent's output adjudicable rather than merely readable.
 *
 * ## It does not run until you ask it to
 *
 * This agent starts idle and stays idle. No run begins at startup and no timer
 * starts one, because an agent that reaches out to the network the instant it
 * is added has acted before the person who added it has seen what it does.
 *
 * It publishes one task — "Waiting to be run" — which is what DASH's Run now
 * targets. That task is load-bearing rather than decoration: a `retry` command
 * has to name a run or a task, and a freshly added agent has no runs. Without
 * it there is nothing for the control to point at.
 *
 * ## The one rule worth knowing
 *
 * Write your own logging with `log()`, never `console.log`. Anything that is
 * not one of this protocol's messages is forwarded to DASH's log, which is
 * fine and deliberate — but a stray `console.log` of an object that happens to
 * have a `type` field would be read as a protocol message. `log()` prefixes its
 * output so that cannot happen.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprintItems } from "./brief-fingerprint.mjs";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const sourcesFile = path.join(projectDir, "sources.json");
const reportsDir = path.join(projectDir, "reports");
const runsDir = path.join(projectDir, "runs");

/** How often the agent tells DASH what it is doing. */
const PUBLISH_INTERVAL_MS = 2_000;

/** How long one source gets before the agent gives up on it and says so. */
const FETCH_TIMEOUT_MS = 15_000;

/** How many items from any one source reach the digest. */
const MAX_ITEMS_PER_SOURCE = 10;

/* ---------------------------------------------------------------------- *
 * The work. This part is yours.
 * ---------------------------------------------------------------------- */

/**
 * One run.
 *
 * `step` marks a stage so DASH can show progress and so the run's events say
 * more than "it started and then it stopped". `digest` hands DASH what the run
 * collected. `brief` hands DASH what the run has to say about it, and must be
 * called after `digest` because it cites it.
 *
 * Returning a string ends the run as completed and that string is what DASH
 * shows as the outcome. Throwing ends it as failed, with the message.
 */
async function runOnce({ step, digest, brief }) {
  step("public_feed_fetch", "Reading your sources");

  const sources = readSources();
  const fetched = [];
  const items = [];

  for (const source of sources) {
    const outcome = await readSource(source);
    fetched.push(outcome.record);
    for (const item of outcome.items.slice(0, MAX_ITEMS_PER_SOURCE)) {
      items.push(item);
    }
  }

  const answered = fetched.filter((record) => record.status === "ok").length;
  digest({
    title: `${String(items.length)} items from ${String(answered)} of ${String(fetched.length)} sources`,
    sources_fetched: fetched,
    items,
  });

  step("brief_compose", "Writing what it found");
  brief({
    title: "What came in this run",
    document: { sections: composeSections(items, fetched) },
  });

  step("local_file_write", "Saving the report");
  writeReport(items, fetched);

  return items.length === 0
    ? "No items. Check the addresses in sources.json."
    : `Read ${String(items.length)} items from ${String(answered)} of ${String(fetched.length)} sources.`;
}

/**
 * The document, written from the items and citing them.
 *
 * No model is involved and none is claimed: `document.model` is deliberately
 * absent, because nothing but this file wrote these sentences. That is the
 * honest version, and it is also what lets this agent be added to DASH and
 * watched working without anybody having a credential to hand.
 *
 * When you connect a model and have it write these paragraphs instead, keep two
 * things: the `items` array on every paragraph, and `derived_from` — which the
 * plumbing below fills in for you. Set `document.model` to whatever the
 * provider says wrote it.
 */
function composeSections(items, fetched) {
  const answered = fetched.filter((record) => record.status === "ok");
  const silent = fetched.filter((record) => record.status !== "ok");

  const sections = [
    {
      heading: "What came in",
      paragraphs: [
        {
          body:
            items.length === 0
              ? `Nothing. ${String(fetched.length)} ${fetched.length === 1 ? "source was" : "sources were"} asked and none returned an item this run.`
              : `${String(items.length)} ${items.length === 1 ? "item" : "items"} from ${String(answered.length)} of ${String(fetched.length)} sources.`,
          items: items.map((_item, index) => index).slice(0, 200),
        },
      ],
    },
  ];

  // One section per source that answered, up to the contract's ceiling of eight
  // sections. The first is "What came in", so seven are left for sources, and
  // whatever is past that is still in the digest — the brief being shorter than
  // the evidence is the normal case, not a loss.
  for (const record of answered.slice(0, 7)) {
    const cited = items
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.source_name === record.source_name);
    if (cited.length === 0) {
      continue;
    }
    sections.push({
      heading: plain(record.source_name).slice(0, 80) || "A source",
      paragraphs: [
        {
          body: `${String(cited.length)} ${cited.length === 1 ? "item" : "items"}, most recent first: ${
            cited
              .slice(0, 5)
              .map((entry) => plain(entry.item.headline))
              .join("; ")
          }`.slice(0, 1200),
          items: cited.map((entry) => entry.index).slice(0, 200),
        },
      ],
    });
  }

  if (silent.length > 0 && sections.length < 8) {
    sections.push({
      heading: "What did not answer",
      // No `items`: this paragraph is about sources rather than about anything
      // in the list, and an absent citation is a legitimate answer the renderer
      // marks rather than drops. Citing unrelated items to look well-sourced is
      // the exact failure the whole citation design exists to prevent.
      paragraphs: [
        {
          body: `${silent.map((record) => plain(record.source_name)).join(", ")} — ${
            silent.length === 1 ? "this source" : "these sources"
          } returned nothing usable this run.`.slice(0, 1200),
        },
      ],
    });
  }

  return sections;
}

/**
 * Text with anything address-shaped taken out.
 *
 * A brief's prose carries no links, on purpose: the evidence is the digest,
 * where every item keeps the address it came from and DASH renders it as a real
 * link. A paragraph containing something that looks like an address is dropped
 * whole rather than cleaned, so a headline that happens to contain one would
 * take its whole paragraph with it. Removing it here is cheaper than losing the
 * sentence.
 */
function plain(value) {
  return String(value ?? "")
    .replace(/(^|\s)(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** The run's own record on the author's disk, which outlives what DASH holds. */
function writeReport(items, fetched) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const lines = [
    `# ${AGENT_NAME} — ${new Date().toISOString()}`,
    "",
    `${String(items.length)} items from ${String(fetched.length)} sources.`,
    "",
    ...items.map((item, index) => `${String(index)}. ${item.headline}${item.item_url === undefined ? "" : ` — ${item.item_url}`}`),
    "",
  ];
  try {
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(path.join(reportsDir, `report-${stamp}.md`), lines.join("\n"), "utf8");
  } catch (error) {
    log(`could not write the report file: ${String(error)}`);
  }
}

/* ---------------------------------------------------------------------- *
 * Sources
 * ---------------------------------------------------------------------- */

/**
 * What to read, from the file you edit.
 *
 * A missing or damaged file is an empty source list rather than a crash. An
 * agent that refuses to start because its list is malformed has to be rescued
 * by hand; reporting "no sources" is recoverable from inside DASH.
 */
function readSources() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(sourcesFile, "utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.sources;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      typeof entry.name === "string" &&
      typeof entry.url === "string",
  );
}

/**
 * Read one source, and never throw.
 *
 * The four outcomes are kept apart because they are four different things to do
 * something about: unreachable, answered-with-something-that-is-not-a-feed,
 * answered-empty, and worked. Collapsing them into "failed" sends somebody to
 * check their internet connection because an address had a typo in it.
 */
async function readSource(source) {
  const record = { source_name: source.name, source_url: source.url, status: "ok" };

  let body;
  try {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/rss+xml, application/atom+xml, application/json, text/xml" },
      redirect: "follow",
    });
    if (!response.ok) {
      return { record: { ...record, status: "unreachable" }, items: [] };
    }
    body = await response.text();
  } catch {
    return { record: { ...record, status: "unreachable" }, items: [] };
  }

  let items;
  try {
    items = parseFeed(body, source);
  } catch {
    return { record: { ...record, status: "not_a_feed" }, items: [] };
  }
  if (items === null) {
    return { record: { ...record, status: "not_a_feed" }, items: [] };
  }

  return {
    record: {
      ...record,
      status: items.length === 0 ? "empty" : "ok",
      fetched_at: new Date().toISOString(),
      item_count: items.length,
    },
    items,
  };
}

/**
 * Turn a response body into items, or null when it is not the feed it claimed.
 *
 * The format comes from the source's own declaration rather than from sniffing
 * the body. A parser chosen by what the bytes resemble will happily read an
 * error page as an empty feed, and "nothing today" is the most damaging wrong
 * answer this agent could give.
 */
function parseFeed(body, source) {
  if (source.format === "hn_algolia") {
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed?.hits)) {
      return null;
    }
    return parsed.hits
      .filter((hit) => typeof hit?.title === "string" && hit.title.length > 0)
      .map((hit) => ({
        headline: hit.title,
        source_name: source.name,
        source_url: source.url,
        item_url: typeof hit.url === "string" && hit.url.length > 0 ? hit.url : undefined,
        published_at: typeof hit.created_at === "string" ? hit.created_at : undefined,
      }));
  }

  const blockTag = source.format === "atom" ? "entry" : "item";
  if (!body.includes(`<${blockTag}`)) {
    return null;
  }

  return body
    .split(new RegExp(`<${blockTag}[\\s>]`))
    .slice(1)
    .map((block) => {
      const headline = decodeText(tagText(block, "title"));
      if (headline === undefined) {
        return null;
      }
      return {
        headline,
        source_name: source.name,
        source_url: source.url,
        item_url:
          source.format === "atom" ? atomLink(block) : decodeText(tagText(block, "link")),
        published_at: isoDate(
          tagText(block, "updated") ?? tagText(block, "published") ?? tagText(block, "pubDate"),
        ),
      };
    })
    .filter((item) => item !== null);
}

function tagText(block, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return match === null ? undefined : match[1];
}

function atomLink(block) {
  const match = /<link[^>]*href="([^"]+)"/i.exec(block);
  return match === null ? undefined : decodeText(match[1]);
}

function decodeText(value) {
  if (value === undefined) {
    return undefined;
  }
  const text = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length === 0 ? undefined : text;
}

function isoDate(value) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/* ---------------------------------------------------------------------- *
 * Talking to DASH
 * ---------------------------------------------------------------------- */

/** One protocol message. Newline-delimited JSON on this process's own stdout. */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** Ordinary logging. Goes to DASH's log; never mistaken for a protocol message. */
function log(line) {
  process.stdout.write(`[agent] ${line}\n`);
}

const MANIFEST = (() => {
  /*
   * Two locations, because DASH's copy is not the author's folder.
   *
   * On import DASH splits the project: the manifest is written to
   * `<agents>/<name>/agent.manifest.json` and the program runs from
   * `<agents>/<name>/code/`. Looking only beside this file finds the manifest
   * in the author's own project and misses it inside DASH.
   *
   * That miss is not cosmetic. `AGENT_NAME` below is stamped on every event
   * and every artifact, and `ingestArtifacts` in DASH rejects anything whose
   * `/agent` does not match the agent DASH spawned. An agent that cannot read
   * its own manifest therefore runs perfectly, writes its report, and has
   * every artifact silently discarded — on screen, "Nothing has run yet",
   * forever.
   */
  const candidates = [
    path.join(projectDir, "agent.manifest.json"),
    path.join(projectDir, "..", "agent.manifest.json"),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(readFileSync(candidate, "utf8"));
    } catch {
      // Not this layout. Try the next one.
    }
  }
  return null;
})();

const AGENT_NAME = String(MANIFEST?.agent?.name ?? "agent");

if (MANIFEST === null) {
  // Said out loud, because the consequence is invisible otherwise: every
  // artifact this run produces will be refused by DASH for a name mismatch.
  log("could not read agent.manifest.json beside this file or one level up; running as \"agent\", and DASH will refuse this run's artifacts");
}

const ingestUrl = process.env.DASH_INGEST_URL;
const ingestToken = process.env.DASH_INGEST_TOKEN;

/**
 * Emit one telemetry v1 event.
 *
 * Always to disk, and to DASH as well when this process was given somewhere to
 * post. The local file is the primary record on purpose: an agent whose history
 * exists only in whatever happened to be listening is an agent with no history.
 */
function emit(event) {
  const emitted = { event_version: 1, agent: AGENT_NAME, ...event };
  const line = JSON.stringify(emitted);
  try {
    mkdirSync(runsDir, { recursive: true });
    appendFileSync(path.join(runsDir, "events.jsonl"), `${line}\n`, "utf8");
  } catch (error) {
    log(`could not record an event: ${String(error)}`);
  }

  send({ type: "telemetry", event: emitted });

  if (ingestUrl === undefined) {
    return;
  }
  const headers = { "content-type": "application/json" };
  if (ingestToken !== undefined) {
    headers.authorization = `Bearer ${ingestToken}`;
  }
  // Fire and forget: a monitor that is not listening must not stop the work.
  fetch(ingestUrl, { method: "POST", headers, body: line }).catch(() => {});
}

function sendArtifact(artifact) {
  send({ type: "artifact", artifact });
}

/* ---------------------------------------------------------------------- *
 * State
 * ---------------------------------------------------------------------- */

/** The task DASH's Run now targets. See the module header on why it exists. */
const READY_TASK_ID = "waiting-to-be-run";

/**
 * Fixed at startup rather than recomputed on every publish. A `created_at` that
 * moved every two seconds would make a task that has sat untouched since the
 * agent started look like it had just been created, every time anybody looked.
 */
const READY_TASK_CREATED_AT = new Date().toISOString();

const state = {
  status: "ready",
  runs: [],
  tasks: [],
  paused: false,
  current: null,
};

/**
 * Publish what the agent knows about itself.
 *
 * Note what is not here: any claim about whether this process is alive. The
 * runner owns that, because it started the process and this process cannot
 * honestly report its own death.
 */
function publish() {
  const waiting = {
    id: READY_TASK_ID,
    label: state.paused ? "Paused" : "Waiting to be run",
    status: state.current === null ? "pending" : "in_progress",
    created_at: READY_TASK_CREATED_AT,
  };
  send({
    type: "state",
    state: {
      status: state.paused ? "paused" : state.status,
      runs: state.runs.slice(-10),
      tasks: [waiting, ...state.tasks.slice(-20)],
    },
  });
}

function startRun() {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  let seq = 0;

  const run = { id: runId, status: "running", started_at: startedAt, progress: 0 };
  state.runs.push(run);
  state.status = "running";
  emit({ run_id: runId, seq: seq++, ts: startedAt, type: "run_started" });

  const step = (componentId, label) => {
    const ts = new Date().toISOString();
    state.tasks.push({
      id: randomUUID(),
      run_id: runId,
      label,
      status: "in_progress",
      created_at: ts,
    });
    run.current_step = componentId;
    run.progress = Math.min(0.9, run.progress + 0.3);
    emit({ run_id: runId, seq: seq++, ts, type: "step_started", component_id: componentId });
    publish();
  };

  /**
   * The digest, and the list the brief will be checked against.
   *
   * Held in `emitted` after it is sent so `brief` below can fingerprint exactly
   * the array DASH received. Recomputing it from a second read of the same
   * sources would be a different list and would fail the join for a reason
   * nobody could see.
   */
  const emitted = { digest: null };

  const digest = (body) => {
    const artifact = {
      artifact_version: 1,
      agent: AGENT_NAME,
      run_id: runId,
      artifact_id: `digest-${runId}`,
      kind: "digest",
      generated_at: new Date().toISOString(),
      ...body,
    };
    emitted.digest = artifact;
    sendArtifact(artifact);
  };

  const brief = (body) => {
    if (emitted.digest === null) {
      // A brief with nothing to derive from is not a brief. Refusing here is
      // better than emitting one with a fingerprint of an empty list, which
      // would be a document claiming evidence that does not exist.
      log("a brief was composed before its digest; not sending it");
      return;
    }
    const items = emitted.digest.items;
    sendArtifact({
      artifact_version: 2,
      agent: AGENT_NAME,
      run_id: runId,
      artifact_id: `brief-${runId}`,
      kind: "brief",
      generated_at: new Date().toISOString(),
      derived_from: {
        artifact_id: emitted.digest.artifact_id,
        run_id: runId,
        item_count: items.length,
        items_digest: fingerprintItems(items),
      },
      ...body,
    });
  };

  const finish = (type, detail, status) => {
    run.status = status;
    run.progress = 1;
    run.finished_at = new Date().toISOString();
    for (const task of state.tasks) {
      if (task.run_id === runId && task.status === "in_progress") {
        task.status = status === "completed" ? "completed" : status;
      }
    }
    state.status = "ready";
    state.current = null;
    emit({ run_id: runId, seq: seq++, ts: run.finished_at, type, detail });
    publish();
  };

  state.current = {
    runId,
    cancel: () => finish("run_failed", "Cancelled from DASH.", "cancelled"),
  };

  runOnce({ step, digest, brief })
    .then((detail) => {
      if (state.current?.runId === runId || run.status === "running") {
        finish("run_completed", detail, "completed");
      }
    })
    .catch((error) => {
      finish("run_failed", String(error instanceof Error ? error.message : error), "failed");
    });

  return runId;
}

/* ---------------------------------------------------------------------- *
 * Commands from DASH
 * ---------------------------------------------------------------------- */

/**
 * Handle one command and say what happened.
 *
 * Returning `{ ok: false }` is a refusal and DASH shows it as one. That is a
 * better answer than silently ignoring a command DASH offered: a control that
 * does nothing is worse than a control that says no.
 */
function handleCommand(message) {
  switch (message.command) {
    case "retry":
      if (state.current !== null) {
        return { ok: false, detail: "A run is already in progress." };
      }
      if (state.paused) {
        return { ok: false, detail: "This agent is paused. Resume it first." };
      }
      startRun();
      return { ok: true, detail: "Started a new run." };

    case "pause":
      state.paused = true;
      publish();
      return { ok: true, detail: "Paused. No run will start until you resume it." };

    case "resume":
      state.paused = false;
      publish();
      return { ok: true, detail: "Resumed. It still only runs when you ask it to." };

    case "cancel":
      if (state.current === null) {
        return { ok: false, detail: "There is no run to cancel." };
      }
      state.current.cancel();
      return { ok: true, detail: "Cancelled the current run." };

    default:
      // Everything else, including the three approval verbs this agent's
      // manifest deliberately does not declare.
      return { ok: false, detail: `This agent does not support "${String(message.command)}".` };
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
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
      continue;
    }
    if (message?.type !== "command") {
      continue;
    }

    const result = handleCommand(message);
    // Acknowledgement is mandatory. A line written to a pipe proves nothing
    // about whether this process read it, so DASH settles an unacknowledged
    // command as unacknowledged rather than as success.
    send({ type: "ack", command_id: message.command_id, ok: result.ok, detail: result.detail });
  }
});

/* ---------------------------------------------------------------------- *
 * Running
 * ---------------------------------------------------------------------- */

process.on("SIGTERM", () => {
  log("stopping");
  process.exit(0);
});

log(`ready, watching ${String(readSources().length)} sources; waiting to be run`);
publish();

// No run here, and no timer. See the module header: this agent acts when a
// person asks it to, and not before.
setInterval(publish, PUBLISH_INTERVAL_MS).unref?.();
