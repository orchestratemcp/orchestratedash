/**
 * The only addresses the chief will ever fetch, and the one thing a question
 * may contribute to them (MAR-744, ADR 0028's "what the chief can *read*").
 *
 * ## The rule this file exists to make structural
 *
 * MAR-419's analysis: *the chief's tool surface is the declared command set and
 * nothing more. It cannot construct a command an adapter did not declare.* Read
 * literally, the dangerous half of a follow-up fetch is not *what comes back* —
 * that is quoted material, and DASH already knows how to fence quoted material.
 * It is **where the request goes**. A chief that could choose an address is a
 * chief a summarised hostile headline could point at somebody's router.
 *
 * So this file borrows `WriteOperation.path`'s shape exactly, one layer out. A
 * source is a **frozen template with one hole in it**, the hole takes a topic
 * that has been narrowed to a character set with nothing addressable in it, and
 * `address()` is the only function in DASH that builds one of these URLs. There
 * is no field on a `ChiefSource` that could carry an address a caller supplied,
 * and `CHIEF_SOURCE_ORIGINS` is re-checked against the built URL afterwards, so
 * a bug in a template is a refusal rather than a request.
 *
 * The set of hosts the chief can reach is therefore knowable by reading one
 * array, which is the property `WRITE_PATHS` has and the reason it is written
 * the way it is.
 *
 * ## Why these three
 *
 * They are `DEFAULT_SOURCES` in `lib/agent-sources.ts` — the credential-free set
 * MAR-455 chose for the scout, restated here rather than imported, and the
 * restatement is deliberate. That array is **the scout's own configuration**: a
 * person may edit `sources.json` in their agent folder, and an agent folder is
 * content DASH reads rather than content DASH wrote. Deriving the chief's
 * allowlist from it would mean an edited file changed where DASH itself fetches
 * from — the exact untrusted-content-chooses-the-target path the section above
 * closes. Same hosts, same formats, same argument for being credential-free;
 * different authority.
 *
 * What that costs is a second list to keep in step, and the honest bound on that
 * cost is `tests/chief-sources.test.ts`, which pins the origins by value.
 *
 * ## Pure
 *
 * No fetch, no store, no clock. Building an address and reading a feed body are
 * both total functions of their arguments, which is what lets
 * `tests/chief-sources.test.ts` attack this boundary — the topics worth trying
 * are all about what a URL becomes — with no network at all.
 */

/* ---------------------------------------------------------------------- *
 * The topic, narrowed before it is anywhere near a URL
 * ---------------------------------------------------------------------- */

/**
 * The longest topic the chief will search for.
 *
 * Short on purpose. A topic is a subject — *"agent frameworks"*, *"tariffs"* —
 * and every one of these three sources ranks worse the longer the query gets.
 * It is also a second bound under the character set below: a value that cannot
 * escape a query string still should not be able to fill one.
 */
export const MAX_TOPIC_LENGTH = 80;

/** The shortest topic worth a request. One or two letters match everything. */
const MIN_TOPIC_LENGTH = 3;

/**
 * What a topic may be made of.
 *
 * Letters, digits, spaces, and the three joiners that appear inside real subject
 * names — `-` in *open-source*, `.` in *GPT-4.5*, `+` in *C++*. Unicode letters
 * are in, because a person may well ask about a subject in their own language
 * and `encodeURIComponent` carries them correctly.
 *
 * **Look at what is not here.** No `/`, no `:`, no `?`, no `#`, no `&`, no `=`,
 * no `%`, no `@`, no backslash, no quotes, no angle brackets, no control
 * characters and no whitespace other than the space itself. Nothing in the
 * permitted set can add a path segment, open or extend a query, escape upward,
 * introduce a scheme, or reach a userinfo field — so a topic cannot turn a
 * frozen template into an address to somewhere else even before it is encoded.
 *
 * The encoding below is the second line, not the first. A guarantee that rests
 * only on `encodeURIComponent` is a guarantee that rests on nobody ever
 * interpolating a topic anywhere else.
 */
const TOPIC_CHARACTERS = /^[\p{L}\p{N} .+-]+$/u;

/**
 * A question's topic, narrowed to something safe to interpolate, or null.
 *
 * Null means *DASH will not search for this*, and the caller says so in words
 * rather than fetching something approximate. Three ways to get one: nothing
 * left after trimming, something too short to be a subject, or a character the
 * set above does not admit.
 *
 * The last of those is the interesting refusal, and it is deliberately a refusal
 * rather than a strip. Silently deleting the characters would turn
 * `https://evil.example/?x=` into the topic `httpsevil.examplex`, search for
 * that, find nothing, and tell somebody DASH found no sources — when what
 * actually happened is that they asked for something DASH does not do. A
 * refusal is the sentence they can act on.
 */
export function topicFrom(raw: string): string | null {
  // Collapse runs of whitespace first: a topic pasted out of a document arrives
  // with newlines in it, and those are a formatting artefact rather than a
  // refusable character. Every other rejection below is about content.
  const topic = raw.replace(/\s+/gu, " ").trim();
  if (topic.length < MIN_TOPIC_LENGTH || topic.length > MAX_TOPIC_LENGTH) {
    return null;
  }
  return TOPIC_CHARACTERS.test(topic) ? topic : null;
}

/* ---------------------------------------------------------------------- *
 * The allowlist
 * ---------------------------------------------------------------------- */

/** How a source's body is read. Declared per source, never sniffed from bytes. */
export type ChiefSourceFormat = "rss" | "atom" | "hn_algolia";

/**
 * One public source the chief may read.
 *
 * `address` is a method rather than a `url` field, and that is the whole design
 * rather than a style choice: a field can hold a value somebody assigned, and a
 * method closed over a literal in this file cannot. There is no member of this
 * interface that could carry an address from outside it.
 */
export interface ChiefSource {
  /** DASH's key for the source. A value: it keys a citation and never enters prose. */
  id: string;
  /** What a person reads. Never a URL — `FeedSource.name`'s own rule. */
  name: string;
  format: ChiefSourceFormat;
  /** The one address this source will ever be fetched at, for one topic. */
  address(topic: string): string;
}

/**
 * Every origin the chief will ever send a request to (MAR-744).
 *
 * Read this array as the answer to *what can the chief reach on the internet?*
 * It is the complete answer: `addressFor` builds a URL from a template in this
 * file and from an encoded topic, and re-checks the result's origin against this
 * list before returning it, so a template edited to point somewhere else fails
 * to build rather than failing open.
 *
 * `tests/chief-sources.test.ts` pins it by value, which is the conversation ADR
 * 0005's column-list test exists to force, pointed at the one outbound thing
 * this packet adds.
 */
export const CHIEF_SOURCE_ORIGINS: readonly string[] = Object.freeze([
  "https://news.google.com",
  "https://hn.algolia.com",
  "https://export.arxiv.org",
]);

/**
 * The three the chief searches, and nothing else.
 *
 * All three answer an anonymous GET. No account, no key, no billing
 * relationship, nothing to exhaust — which is what makes a follow-up fetch a
 * thing DASH can do without asking the person to connect anything first, and
 * what keeps this packet off anybody's monthly bill.
 *
 * arXiv is reached over **https** here where `DEFAULT_SOURCES` uses `http`. The
 * host serves both; the scout's plain-text address predates this file and is the
 * agent's own business, and there is no reason for DASH's own request to be the
 * one that goes in the clear.
 */
export const CHIEF_SOURCES: readonly ChiefSource[] = Object.freeze([
  Object.freeze({
    id: "google-news",
    name: "Google News",
    format: "rss" as const,
    address: (topic: string) =>
      `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-US&gl=US&ceid=US:en`,
  }),
  Object.freeze({
    id: "hacker-news",
    name: "Hacker News",
    format: "hn_algolia" as const,
    address: (topic: string) =>
      `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(topic)}` +
      `&tags=story&hitsPerPage=15`,
  }),
  Object.freeze({
    id: "arxiv",
    name: "arXiv",
    format: "atom" as const,
    address: (topic: string) =>
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(topic)}` +
      `&sortBy=submittedDate&sortOrder=descending&max_results=15`,
  }),
]);

/**
 * The address one source is fetched at for one topic, or null.
 *
 * Null on three counts, and each of them is this file's own bug rather than the
 * person's: a topic the narrowing above would have refused, a template that did
 * not produce a parsable URL, and a URL whose origin is not on the allowlist.
 * The caller records a refusal and fetches nothing.
 *
 * The origin re-check is DASH's own code checked anyway, `runner/chief-broker.ts`
 * step 7's reason: it is cheap, and the thing behind it is an outbound request
 * from a person's own machine.
 */
export function addressFor(source: ChiefSource, topic: string): string | null {
  if (topicFrom(topic) !== topic) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(source.address(topic));
  } catch {
    return null;
  }
  return CHIEF_SOURCE_ORIGINS.includes(url.origin) ? url.toString() : null;
}

/* ---------------------------------------------------------------------- *
 * What comes back
 * ---------------------------------------------------------------------- */

/**
 * One thing a source listed, as DASH read it.
 *
 * Deliberately the same four fields `ArtifactItem` carries for a collected item,
 * so that a fetched thing and a saved thing are the same shape by the time
 * anything renders either. What is *not* here is a body: DASH reads the feed's
 * own summary of an entry and never follows the link to the page behind it. That
 * is the difference between this packet and ADR 0019's supervised browser, and
 * it is the reason this one needs no window.
 */
export interface FetchedItem {
  headline: string;
  /** The entry's own address, from the feed. May be absent. */
  item_url: string | null;
  /** ISO-8601 where the feed gave a date DASH could read, else null. */
  published_at: string | null;
}

/**
 * How many entries DASH keeps from one source.
 *
 * A feed answers with fifteen or a hundred depending on the host and the day,
 * and the difference must not be what decides what a question costs. Six from
 * each of three sources is eighteen, which is a list a person can actually read
 * and check.
 */
export const MAX_ITEMS_PER_SOURCE = 6;

/**
 * Turn a response body into entries, or null when it is not the feed it claimed.
 *
 * The parser is chosen by the source's **declared** format and never by what the
 * bytes resemble — `parseFeed`'s rule in the scout template, and its reason: a
 * parser chosen by sniffing reads an error page as an empty feed, and *"no news
 * today"* is the most damaging wrong answer this whole feature could give. Null
 * and empty are different outcomes here for exactly that reason, and the caller
 * keeps them different.
 *
 * Never throws. A malformed body is a null, not an exception a caller has to
 * remember to catch on the one path where the source is having a bad day.
 */
export function readFeed(body: string, format: ChiefSourceFormat): FetchedItem[] | null {
  try {
    return format === "hn_algolia" ? readAlgolia(body) : readXmlFeed(body, format);
  } catch {
    return null;
  }
}

function readAlgolia(body: string): FetchedItem[] | null {
  const parsed: unknown = JSON.parse(body);
  const hits = (parsed as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) {
    return null;
  }
  const items: FetchedItem[] = [];
  for (const hit of hits) {
    const entry = hit as { title?: unknown; url?: unknown; created_at?: unknown };
    if (typeof entry.title !== "string" || entry.title.trim().length === 0) {
      continue;
    }
    items.push({
      headline: entry.title.trim(),
      item_url: typeof entry.url === "string" && entry.url.length > 0 ? entry.url : null,
      published_at: typeof entry.created_at === "string" ? entry.created_at : null,
    });
  }
  return items;
}

function readXmlFeed(body: string, format: "rss" | "atom"): FetchedItem[] | null {
  const blockTag = format === "atom" ? "entry" : "item";
  if (!body.includes(`<${blockTag}`)) {
    // Not the feed it declared. An HTML error page reaches here, and this is
    // where it stops being mistaken for a source with no news in it.
    return null;
  }

  const items: FetchedItem[] = [];
  for (const block of body.split(new RegExp(`<${blockTag}[\\s>]`, "u")).slice(1)) {
    const headline = decodeText(tagText(block, "title"));
    if (headline === null) {
      continue;
    }
    items.push({
      headline,
      item_url: format === "atom" ? atomLink(block) : decodeText(tagText(block, "link")),
      published_at: isoDate(tagText(block, format === "atom" ? "published" : "pubDate")),
    });
  }
  return items;
}

/** The text of the first `<tag>` in a block, or null. */
function tagText(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "u").exec(block);
  return match === null ? null : (match[1] ?? "").trim();
}

/** Atom puts the address in an attribute rather than in the element's text. */
function atomLink(block: string): string | null {
  const match = /<link[^>]*\shref="([^"]+)"/u.exec(block);
  return match === null ? null : (match[1] ?? null);
}

/**
 * Unwrap CDATA and the five XML entities.
 *
 * Deliberately not a general HTML decoder, the scout template's own note: this
 * text is rendered as text and never as markup, so the only job is to stop a
 * headline reading `AT&amp;T`.
 */
function decodeText(raw: string | null): string | null {
  if (raw === null || raw.length === 0) {
    return null;
  }
  const unwrapped = raw.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/u, "$1").trim();
  if (unwrapped.length === 0) {
    return null;
  }
  return unwrapped
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#3[49];/gu, "'")
    .replace(/&amp;/gu, "&")
    .trim();
}

/** A feed's date as ISO-8601, or null when it is not a date DASH can read. */
function isoDate(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}
