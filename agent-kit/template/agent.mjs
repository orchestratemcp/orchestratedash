/**
 * Your agent.
 *
 * ## The two files, and which one is yours
 *
 * **This one.** `runOnce` below is the work, and everything under it — the
 * sources, the feed parsing, the summarising — is yours to change.
 *
 * `dash-agent-sdk.mjs` beside it is the runtime, and it is **not** yours: DASH
 * upgrades that file in place, by version, so an edit there is an edit a later
 * upgrade discards. It is what publishes progress, answers DASH's commands,
 * records telemetry, hands over what the run produced, and reaches accounts
 * through DASH without ever holding a credential. Read its header once; after
 * that you should be able to ignore it.
 *
 * `agent.manifest.json` is what DASH holds this agent to. Change what the agent
 * is allowed to do there, and run `npm run open-in-dash` again so DASH can ask
 * about the change.
 *
 * ## It does not run until you ask it to
 *
 * This agent starts idle and stays idle. No run begins at startup and no timer
 * starts one, because an agent that begins reaching out to the network the
 * instant it is added has acted before the person who added it has seen what it
 * does. It publishes one task — "Waiting to be run" — which is what DASH's
 * Run now targets.
 *
 * ## The one rule worth knowing
 *
 * Write your own logging with `log()`, not `console.log`. Anything that is not
 * one of the protocol's messages is treated as ordinary logging and forwarded
 * to DASH's log — which is fine and deliberate — but a stray `console.log` of a
 * JSON object that happens to have a `type` field would be read as a protocol
 * message. `log()` prefixes its output so that cannot happen.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ask, log, readManifest, startAgent } from "./dash-agent-sdk.mjs";

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const sourcesFile = path.join(projectDir, "sources.json");
const reportsDir = path.join(projectDir, "reports");

/**
 * This agent's own manifest, or null when it cannot be read.
 *
 * Read rather than hard-coded so that renaming the agent is one edit in one
 * place — and the place is the manifest, which is the document DASH holds this
 * agent to.
 */
const MANIFEST = readManifest(projectDir);

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
 * `step` marks a stage of the work so DASH can show progress and so the run's
 * events say more than "it started and then it stopped". `artifact` is how you
 * hand DASH what the run produced.
 *
 * To reach an account the user connected, call `ask(...)` — imported at the top
 * of this file rather than passed in, because it is not part of one run's
 * plumbing. Reading the news feeds themselves needs nobody's password, and this
 * agent uses `ask` for one thing only: handing what it found to a model, so the
 * digest is grouped and summarised rather than listed. See `curate`, and see
 * `ask`'s own comment in the SDK for why no token is ever in scope here.
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
 * Starting up
 * ---------------------------------------------------------------------- */

startAgent({
  definition: {
    projectDir,
    // Two steps, so each one moves the bar most of the way. The runtime caps it
    // at 0.9 until the run actually ends.
    stepProgress: 0.4,
    ready: () => `ready, watching ${String(readSources().length)} sources; waiting to be run`,
  },
  runOnce,
});
