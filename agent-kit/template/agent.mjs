/**
 * Your agent.
 *
 * One file, no dependencies, and four things wired for you:
 *
 * 1. **DASH can watch it.** It publishes what it is doing on stdout, in the
 *    shape DASH's runner understands, every couple of seconds.
 * 2. **DASH can control it.** Pause, resume, cancel and retry arrive on stdin
 *    and are acknowledged. An unacknowledged command is reported as
 *    unacknowledged rather than assumed to have worked, so the acknowledgement
 *    below is not a formality.
 * 3. **It records what it did.** Every run appends events to `runs/events.jsonl`
 *    in the telemetry v1 format and emits them on the runner pipe. An agent run
 *    outside the bundled runner can still post to DASH when explicitly given a
 *    remote ingest URL.
 * 4. **It records what it produced.** The digest is written to `reports/` and
 *    emitted as a run artifact, so DASH can show it with its sources attached
 *    rather than merely reporting that a run finished.
 *
 * The part that is yours is `runOnce`. Everything else is plumbing you should
 * be able to ignore.
 *
 * ## It does not run until you ask it to
 *
 * This agent starts idle and stays idle. No run begins at startup and no timer
 * starts one, because an agent that begins reaching out to the network the
 * instant it is added has acted before the person who added it has seen what it
 * does. It publishes one task — "Waiting to be run" — which is what DASH's
 * Run now targets.
 *
 * The task is a real description of queued work, not a prerequisite DASH
 * manufactures. Since MAR-621 an idle `retry` may target the agent itself, so
 * manual agents that publish no queue are startable too. This scaffold keeps
 * its task because "Waiting to be run" is true and gives older DASH builds a
 * concrete target; it is no longer ceremony required by the command contract.
 *
 * ## The one rule worth knowing
 *
 * Write your own logging with `log()`, not `console.log`. Anything that is not
 * one of this protocol's messages is treated as ordinary logging and forwarded
 * to DASH's log — which is fine and deliberate — but a stray `console.log` of a
 * JSON object that happens to have a `type` field would be read as a protocol
 * message. `log()` prefixes its output so that cannot happen.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/**
 * How many items are sent to a model to be grouped, and how much text goes
 * with them.
 *
 * Both bounds are the agent's own courtesy rather than the boundary: DASH's
 * broker refuses anything past `MAX_MATERIAL_CHARS` regardless of what is sent,
 * and that refusal is what actually holds. Staying comfortably inside it means
 * an ordinary run is never refused for a reason its owner cannot act on — the
 * same gap `MAX_MATERIAL_BUDGET` keeps for the chat, and for the same reason.
 */
const MAX_ITEMS_TO_CURATE = 40;
const MAX_CURATION_CHARS = 16_000;

/** The capability this agent looks for in its own manifest, by its ending. */
const CURATE_CAPABILITY_SUFFIX = ".digest.curate";

/* ---------------------------------------------------------------------- *
 * The work. This part is yours.
 * ---------------------------------------------------------------------- */

/**
 * One run.
 *
 * `report` is how you say what happened; `step` marks a stage of the work so
 * DASH can show progress and so the run's events say more than "it started and
 * then it stopped". `artifact` is how you hand DASH what the run produced.
 *
 * To reach an account the user connected, call `ask(...)` — it is in scope here
 * rather than passed in, because it is not part of one run's plumbing. Reading
 * the news feeds themselves needs nobody's password, and this agent uses `ask`
 * for one thing only: handing what it found to a model, so the digest is
 * grouped and summarised rather than listed. See `curate`, and see `ask`'s own
 * comment for why no token is ever in scope here.
 *
 * That call **costs the owner money**, which is why it is the one part of this
 * run that can be refused for a reason nothing is wrong with: DASH only pays
 * for it while a run somebody asked for is going. Every refusal ends as a
 * complete digest with a sentence about why it was not summarised.
 */
async function runOnce({ step, artifact }) {
  step("public_feed_fetch", "Reading your news sources");

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

  // What this step is about to try, said before it tries it. The label is the
  // progress line a person watching sees, so it must not claim a summary on a
  // run that has nothing to summarise with.
  const capability = curateCapability();
  step(
    "local_file_write",
    capability === null ? "Writing the digest" : "Summarising what it found",
  );

  items.sort((a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? "")));

  const generatedAt = new Date().toISOString();
  const digest = {
    title: `News from ${String(fetched.length)} source${fetched.length === 1 ? "" : "s"}`,
    generated_at: generatedAt,
    sources_fetched: fetched,
    items,
    curation: await curate(capability, items),
  };

  mkdirSync(reportsDir, { recursive: true });
  const reportFile = path.join(reportsDir, `${generatedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(reportFile, `${JSON.stringify(digest, null, 2)}\n`, "utf8");

  artifact(digest);

  // What the run says about itself, in the words a person reads. A partial
  // result is reported as a partial result and not as a failure: a source that
  // was unreachable is a named gap in a digest that still has everything else
  // in it, and calling that a failed run would teach people to ignore failures.
  const reachable = fetched.filter((entry) => entry.status === "ok").length;
  if (items.length === 0) {
    return fetched.length === 0
      ? "No sources are set up yet, so there was nothing to read."
      : "Nothing new was found in your sources.";
  }
  const found =
    reachable === fetched.length
      ? `Found ${String(items.length)} item${items.length === 1 ? "" : "s"}`
      : `Found ${String(items.length)} item${items.length === 1 ? "" : "s"} from ${String(reachable)} of ${String(fetched.length)} sources`;
  // Whether it was summarised belongs in the run's own sentence, because that
  // sentence is what a person reads on the run list without opening anything —
  // and "summarised" is the difference between this run and the one before the
  // key was connected. The *reason* it was not lives on the artifact, where
  // DASH can word it properly.
  return digest.curation.state === "curated"
    ? `${found}, grouped into ${String(digest.curation.groups.length)} ${digest.curation.groups.length === 1 ? "subject" : "subjects"}.`
    : `${found}. It was not summarised this time.`;
}

/* ---------------------------------------------------------------------- *
 * Sources
 * ---------------------------------------------------------------------- */

/**
 * What to read, from the file the user edits.
 *
 * A missing or damaged file is an empty source list rather than a crash. An
 * agent that refuses to start because a list it was told to watch is malformed
 * is an agent whose next run has to be rescued by hand; reporting "no sources"
 * and letting the user fix the file is recoverable from inside DASH.
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
 * The four outcomes are kept apart because they are four different things for a
 * user to do about them: a source that is unreachable, one that answered with
 * something that is not a feed, one that answered with an empty feed, and one
 * that worked. Collapsing them into "failed" would send somebody to check their
 * internet connection because an address had a typo in it.
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
 * error page as an empty feed, and "no news today" is the most damaging wrong
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

  const blocks = body.split(new RegExp(`<${blockTag}[\\s>]`)).slice(1);
  return blocks
    .map((block) => {
      const headline = decodeText(tagText(block, "title"));
      if (headline === undefined) {
        return null;
      }
      return {
        headline,
        source_name: source.name,
        source_url: source.url,
        item_url: source.format === "atom" ? atomLink(block) : decodeText(tagText(block, "link")),
        published_at: isoDate(
          tagText(block, source.format === "atom" ? "published" : "pubDate"),
        ),
      };
    })
    .filter((item) => item !== null);
}

/** The text of the first `<tag>` in a block, or undefined. */
function tagText(block, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return match === null ? undefined : match[1].trim();
}

/** Atom puts the address in an attribute rather than in the element's text. */
function atomLink(block) {
  const match = /<link[^>]*\shref="([^"]+)"/.exec(block);
  return match === null ? undefined : match[1];
}

/**
 * Unwrap CDATA and the five XML entities. Deliberately not a general HTML
 * decoder: this text is rendered as text, never as markup, so the only job here
 * is to stop a headline reading `AT&amp;T`.
 */
function decodeText(raw) {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const unwrapped = raw.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1").trim();
  if (unwrapped.length === 0) {
    return undefined;
  }
  return unwrapped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** A date DASH can use, or undefined. An unparseable date is not a failure. */
function isoDate(raw) {
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

/* ---------------------------------------------------------------------- *
 * Summarising what was found
 * ---------------------------------------------------------------------- */

/**
 * The connection and operation this agent would summarise with, or null.
 *
 * **Read out of this agent's own manifest, never hard-coded.** The manifest is
 * the document DASH holds this agent to, so it is also the honest place to ask
 * what this agent is allowed to try — and it means the same template works for
 * an agent whose provider is OpenRouter, one whose provider is something else,
 * and one that declares no provider at all. That last case is the ordinary one:
 * a project somebody scaffolded by hand declares no connections, finds nothing
 * here, and writes the plain digest it always wrote.
 *
 * The suffix is the contract. DASH names its curation operations
 * `<provider>.digest.curate` — see `CURATE_OPERATION_SUFFIX` in
 * `lib/broker/operations.ts`, which exists so this line and that one cannot
 * drift — and an agent that finds one in its own declared capabilities is an
 * agent whose author asked for it.
 */
function curateCapability() {
  const connections = MANIFEST?.agent_dom?.connections;
  if (!Array.isArray(connections)) {
    return null;
  }
  for (const connection of connections) {
    if (typeof connection?.id !== "string" || !Array.isArray(connection.capabilities)) {
      continue;
    }
    for (const capability of connection.capabilities) {
      if (
        typeof capability?.id === "string" &&
        capability.id.endsWith(CURATE_CAPABILITY_SUFFIX)
      ) {
        return { connection_id: connection.id, operation: capability.id };
      }
    }
  }
  return null;
}

/**
 * Turn the items just collected into a grouped summary, or say why not.
 *
 * ## Never throws, and never fails the run
 *
 * Every path returns a `curation` block, and the run carries on either way. A
 * digest that reached its sources and could not be summarised is a complete
 * digest with a sentence about the summary missing from it — the same judgement
 * `readSource` makes about a source that would not answer, and for the same
 * reason: calling that a failed run teaches people to ignore failures.
 *
 * ## What is sent, and what is deliberately not
 *
 * The headlines, their sources, their dates and their summaries. **No links.**
 * A URL in the material is a URL the model can repeat into a group's title, and
 * a link that came out of a model is a link nobody checked — so the addresses
 * stay here, on DASH's own record of each item, and the model works from text.
 * `lib/ai/ask.ts` makes the identical argument about its own material.
 *
 * ## Why the model's answer cannot invent an item
 *
 * What comes back names items by **number**, and those numbers are read against
 * the list this function already has. A group naming an item that does not
 * exist loses it here; a group naming a headline the model made up has no way
 * to express that at all, because there is no field for a headline. That is the
 * whole reason the broker's projection returns numbers rather than prose.
 */
async function curate(capability, items) {
  if (capability === null) {
    return { state: "not_curated", reason: "no_model_connection" };
  }
  if (items.length === 0) {
    // Nothing to group, and nothing worth paying to be told so.
    return { state: "not_curated", reason: "unreadable" };
  }

  const sent = items.slice(0, MAX_ITEMS_TO_CURATE);
  const answer = await ask(capability.connection_id, capability.operation, {
    material: renderForCuration(sent),
  });

  if (!answer.ok) {
    log(`could not summarise this digest: ${String(answer.refusal)}`);
    return { state: "not_curated", reason: curationReason(answer.refusal) };
  }

  const groups = readGroups(answer.result?.groups, sent.length);
  if (groups.length === 0) {
    // A provider answered, was paid, and said nothing this agent could read a
    // grouping out of. Reported as its own thing rather than as a refusal,
    // because it is the one case where the money is gone.
    return { state: "not_curated", reason: "unreadable" };
  }

  const curation = { state: "curated", groups };
  const overview = answer.result?.overview;
  if (typeof overview === "string" && overview.length > 0) {
    curation.overview = overview;
  }
  const model = answer.result?.model;
  if (typeof model === "string" && model.length > 0) {
    curation.model = model;
  }
  return curation;
}

/** A broker refusal as the reason a digest carries. Anything unknown is a plain refusal. */
function curationReason(refusal) {
  switch (refusal) {
    case "not_connected":
    case "revoked":
      return "not_connected";
    case "no_model_chosen":
      return "no_model_chosen";
    case "needs_a_person":
      return "needs_a_person";
    default:
      return "refused";
  }
}

/**
 * The items as the model sees them: numbered, labelled, and with no addresses.
 *
 * Numbered from 1 because that is what a person and a model both count from,
 * and the numbers are translated back to positions in `readGroups`. Stops at
 * the character budget rather than skipping long items, for `selectMaterial`'s
 * reason: skipping would quietly reorder the material by length.
 */
function renderForCuration(items) {
  const lines = [];
  let spent = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const block = [`[${String(index + 1)}] ${item.headline}`];
    if (item.source_name !== undefined) {
      block.push(`Source: ${item.source_name}`);
    }
    if (item.published_at !== undefined) {
      block.push(`Published: ${item.published_at}`);
    }
    if (item.summary !== undefined) {
      block.push(item.summary);
    }
    const rendered = `${block.join("\n")}\n\n`;
    if (spent + rendered.length > MAX_CURATION_CHARS) {
      break;
    }
    lines.push(rendered);
    spent += rendered.length;
  }
  return lines.join("").trimEnd();
}

/**
 * Read the groups DASH handed back into positions in this run's own item list.
 *
 * The numbers arrive already bounded and deduplicated by the broker's
 * projection; what this adds is the only check that module could not make —
 * whether an item number names an item **this run actually has**. A group left
 * with nothing after that is dropped, because a titled group with no items
 * under it is a heading about nothing.
 *
 * An item claimed by two groups goes to the first, so nothing is drawn twice.
 * An item claimed by none is not mentioned here at all, and DASH renders it
 * under its own heading rather than losing it.
 */
function readGroups(candidate, available) {
  if (!Array.isArray(candidate)) {
    return [];
  }
  const taken = new Set();
  const groups = [];
  for (const entry of candidate) {
    if (typeof entry?.label !== "string" || entry.label.length === 0) {
      continue;
    }
    const positions = [];
    for (const number of Array.isArray(entry.items) ? entry.items : []) {
      const position = Number(number) - 1;
      if (!Number.isInteger(position) || position < 0 || position >= available) {
        continue;
      }
      if (taken.has(position)) {
        continue;
      }
      taken.add(position);
      positions.push(position);
    }
    if (positions.length === 0) {
      continue;
    }
    const group = { label: entry.label, items: positions };
    if (typeof entry.summary === "string" && entry.summary.length > 0) {
      group.summary = entry.summary;
    }
    groups.push(group);
  }
  return groups;
}

/* ---------------------------------------------------------------------- *
 * Talking to DASH
 * ---------------------------------------------------------------------- */

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** Ordinary logging. Goes to DASH's log; never mistaken for a protocol message. */
function log(line) {
  process.stdout.write(`[agent] ${line}\n`);
}

/* ---------------------------------------------------------------------- *
 * Reaching an account through DASH
 * ---------------------------------------------------------------------- */

/**
 * Ask DASH to do one named thing with an account you connected.
 *
 * ## There is no token here, and there is not meant to be
 *
 * Look at what this agent's environment contains: no API key for your mail, no
 * OAuth token, nothing you could use to reach a provider directly. That is
 * deliberate. DASH holds the sign-in and performs the operation itself, so the
 * most a compromised agent — or a careless one, or one that read a hostile email
 * and did what it said — can do is ask for an operation on the list, and be
 * refused for anything else.
 *
 * ## What you can ask for
 *
 * Whatever DASH implements and you connected and the user approved: all three,
 * intersected. Today that is `gmail.search`, `gmail.message.read`,
 * `gmail.draft.create` and `<provider>.digest.curate`. There is no operation
 * that sends anything, and asking for one is refused rather than queued — so an
 * agent built on this cannot mail somebody by accident.
 *
 * `<provider>.digest.curate` is the one that **costs the user money**, and it
 * carries a condition none of the others do: DASH answers it only while a run
 * the user asked for is going. An agent that calls it on a timer, or long after
 * its run finished, is refused with `needs_a_person` — which is not a fault and
 * should not be reported as one. Ask for it during your run or not at all.
 *
 * `gmail.draft.create` is the one that changes something. It saves a reply in
 * the user's own Drafts folder, where they can send it or delete it themselves.
 * You supply `to`, `subject`, `body_text` and optionally `thread_id`; DASH
 * writes the message, so there is no header for you to set and no sender for you
 * to choose. A recipient carrying a newline is refused rather than cleaned up.
 *
 * ## Handle the refusal
 *
 * `{ ok: false, refusal }` is a normal outcome, not an exception. `revoked`
 * means the person withdrew access and no amount of retrying will change it;
 * `not_connected` means they never granted it; `no_model_chosen` means they
 * connected a model provider and never said which model to use;
 * `needs_a_person` means no run they asked for is open; `rate_limited` means
 * slow down.
 * DASH shows the user a sentence for each of these on its Connections page, so
 * your job is to stop cleanly rather than to explain.
 *
 * A request that DASH never answers — because DASH is closed, which is the
 * ordinary case for an agent that outlives it — settles as `broker_unavailable`
 * after the timeout below.
 */
const BROKER_TIMEOUT_MS = 30_000;

const pendingBrokerRequests = new Map();
let brokerSequence = 0;

function ask(connectionId, operation, input = {}) {
  const requestId = `${String(process.pid)}-${String((brokerSequence += 1))}`;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingBrokerRequests.delete(requestId);
      resolve({ ok: false, refusal: "broker_unavailable" });
    }, BROKER_TIMEOUT_MS);
    timer.unref?.();

    pendingBrokerRequests.set(requestId, (response) => {
      clearTimeout(timer);
      resolve(response);
    });

    send({
      type: "broker_request",
      request: { request_id: requestId, connection_id: connectionId, operation, input },
    });
  });
}

function handleBrokerResponse(message) {
  const settle = pendingBrokerRequests.get(message.request_id);
  if (settle === undefined) {
    // An answer to something already timed out, or one we never asked for.
    // Dropped rather than acted on: the request it refers to is settled.
    return;
  }
  pendingBrokerRequests.delete(message.request_id);
  settle(
    message.ok === true
      ? { ok: true, result: message.result ?? {} }
      : { ok: false, refusal: String(message.refusal ?? "broker_error") },
  );
}

/* ---------------------------------------------------------------------- *
 * Telemetry v1
 * ---------------------------------------------------------------------- */

/**
 * The agent's own name, read from the manifest beside this file.
 *
 * Read rather than hard-coded so that renaming the agent is one edit in one
 * place — and the place is the manifest, which is the document DASH holds this
 * agent to. A fallback rather than a crash: the name is a monitoring detail,
 * not a precondition for doing the work.
 */
const MANIFEST = (() => {
  // In the author's project the manifest is beside this file. After DASH
  // acquires the project, code lives in `code/` under the authoritative agent
  // folder and the manifest lives one level above it. Accept both standings so
  // the same source runs before and after import without an injected path.
  for (const manifestPath of [
    path.join(projectDir, "agent.manifest.json"),
    path.join(projectDir, "..", "agent.manifest.json"),
  ]) {
    try {
      return JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      // Try the other supported layout.
    }
  }
  // Null rather than a throw: the manifest is how this agent describes itself
  // to DASH, and a copy of it that cannot be read is a reason to run plainly
  // rather than a reason not to run. Every reader below treats null as "this
  // agent declares nothing", which is the true and harmless reading.
  return null;
})();

const AGENT_NAME = String(MANIFEST?.agent?.name ?? "agent");

const ingestUrl = process.env.DASH_INGEST_URL;
const ingestToken = process.env.DASH_INGEST_TOKEN;

/**
 * Emit one telemetry v1 event.
 *
 * Always to disk, and to DASH as well when this process was given somewhere to
 * post. The local file is the primary record on purpose: an agent whose history
 * exists only in whatever happened to be listening is an agent with no history.
 *
 * `seq` is monotonic within a run, which is what lets a monitor spot a gap.
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

  // The runner frames and buffers this candidate. Electron main applies the
  // canonical telemetry schema at ingest, exactly as POST /api/events does.
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

/**
 * Hand DASH what a run produced.
 *
 * `artifact_id` is stable for the run, so re-sending a revised digest corrects
 * the one DASH holds rather than adding a second answer to the same question.
 * The file in `reports/` remains the primary record; this is the copy DASH can
 * render, and losing it costs the user nothing they cannot still open.
 */
function emitArtifact(runId, digest) {
  send({
    type: "artifact",
    artifact: {
      artifact_version: 1,
      agent: AGENT_NAME,
      run_id: runId,
      artifact_id: `digest-${runId}`,
      kind: "digest",
      ...digest,
    },
  });
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
  /** "running" | "paused" | "ready" — what a live agent may call itself. */
  status: "ready",
  runs: [],
  tasks: [],
  paused: false,
  /** Set while a run is in flight, so a cancel can reach it. */
  current: null,
};

/**
 * Publish what the agent knows about itself.
 *
 * Note what is *not* here: any claim about whether this process is alive. The
 * runner owns that, because it started the process and this process cannot
 * honestly report its own death. Sending `status: "running"` from a program
 * that is about to crash is exactly the report that would make DASH draw a
 * healthy agent forever.
 */
function publish() {
  // No `run_id`: this task belongs to no run, which is the whole point of it —
  // it is the work the agent is waiting to be given. The state contract allows
  // the omission for exactly this case.
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
    run.progress = Math.min(0.9, run.progress + 0.4);
    emit({ run_id: runId, seq: seq++, ts, type: "step_started", component_id: componentId });
    publish();
  };

  const artifact = (digest) => {
    emitArtifact(runId, digest);
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

  state.current = { runId, cancel: () => finish("run_failed", "Cancelled from DASH.", "cancelled") };

  runOnce({ step, artifact })
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
 * Returning `{ ok: false }` is a refusal, and DASH shows it as one. That is a
 * better answer than silently ignoring a command DASH offered — a control that
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

    if (message?.type === "broker_response" && typeof message.request_id === "string") {
      handleBrokerResponse(message);
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
