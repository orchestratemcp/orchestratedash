/**
 * Your agent.
 *
 * ## The two files, and which one is yours
 *
 * **This one.** `runOnce` below is the work — what it reads, what it collects,
 * and the document it writes about what it found. Everything under `runOnce` is
 * yours to change.
 *
 * `dash-agent-sdk.mjs` beside it is the runtime, and it is **not** yours: DASH
 * upgrades that file in place, by version, so an edit there is an edit a later
 * upgrade discards. It publishes progress, answers DASH's commands, records
 * telemetry, and hands DASH both of this run's documents — including the
 * fingerprint that binds the brief to its evidence, which is one half of a
 * function DASH holds the other half of. Read its header once; after that you
 * should be able to ignore it.
 *
 * `agent.manifest.json` is what DASH holds this agent to, and it is generated
 * rather than typed: change it through the tool that built this folder.
 *
 * ## What a run produces, and why it is two documents
 *
 * "One RAW and one curated. Don't mix them." The digest is the evidence and it
 * is never edited by the act of writing about it; the brief is the account, and
 * it is worth nothing unless you can check it against the evidence. So every
 * paragraph carries `items`: zero-based positions into the digest's own array.
 *
 * That only means anything if both documents are talking about the same list,
 * which is what `derived_from` is for — the runtime fills it in from the exact
 * digest it sent. DASH recomputes that fingerprint from the digest it holds; if
 * it differs, the brief is drawn with **no citations at all**, because a link
 * under a claim it does not support is worse than no link.
 *
 * This is what makes an agent's output adjudicable rather than merely readable.
 *
 * ## It does not run until you ask it to
 *
 * This agent starts idle and stays idle. No run begins at startup and no timer
 * starts one, because an agent that reaches out to the network the instant it
 * is added has acted before the person who added it has seen what it does. It
 * publishes one task — "Waiting to be run" — which is what DASH's Run now
 * targets.
 *
 * ## The one rule worth knowing
 *
 * Write your own logging with `log()`, never `console.log`. Anything that is
 * not one of the protocol's messages is forwarded to DASH's log, which is fine
 * and deliberate — but a stray `console.log` of an object that happens to have
 * a `type` field would be read as a protocol message. `log()` prefixes its
 * output so that cannot happen.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { log, readManifest, startAgent } from "./dash-agent-sdk.mjs";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const sourcesFile = path.join(projectDir, "sources.json");
const reportsDir = path.join(projectDir, "reports");

const MANIFEST = readManifest(projectDir);
const AGENT_NAME = String(MANIFEST?.agent?.name ?? "agent");

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
 * Starting up
 * ---------------------------------------------------------------------- */

startAgent({
  definition: {
    projectDir,
    // Three steps, so each one moves the bar a third of the way. The runtime
    // caps it at 0.9 until the run actually ends.
    stepProgress: 0.3,
    ready: () => `ready, watching ${String(readSources().length)} sources; waiting to be run`,
  },
  runOnce,
});
