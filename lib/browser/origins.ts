/**
 * Where the browser DASH provides is allowed to go (MAR-628, ADR 0019).
 *
 * ADR 0019 says this in one sentence and the sentence is the whole module:
 * *"The first implementation must allowlist **origins, not string prefixes**.
 * `https://example.com.attacker.test` is not inside `https://example.com`."*
 *
 * So there is no `startsWith` here, no `includes`, and no regular expression
 * over a URL. A declared origin is parsed by `URL` into a scheme, a host and a
 * port; a candidate is parsed the same way; and the comparison is between two
 * parsed origins, which is the one comparison that cannot be tricked by a
 * hostname a registrar will happily sell.
 *
 * ## What an origin allowlist is not
 *
 * ADR 0019 is blunt about this and so is `describeReach` below: an origin
 * allowlist constrains **only the browser DASH provides**. The agent is an
 * ordinary child process with an ordinary network stack. It can `fetch`, it can
 * open a socket, it can shell out to another browser, and nothing in this file
 * sees any of it. `agent_dom.permissions` already carries the same warning about
 * DASH's `network: read` declaration, and adding a controlled browser does not
 * turn either into a sandbox.
 *
 * Every surface built on this therefore says **"DASH limited this browser
 * run"** and never **"this agent could only visit these sites."** The
 * distinction is not pedantry: the second sentence would be false, and it would
 * be false in the direction that makes a person relax.
 *
 * ## Subresources count
 *
 * A page's scripts, fonts, images and API calls are requests the controlled
 * browser makes. Checking only top-level navigation would leave the card
 * claiming a destination list while the browser could still talk anywhere, so
 * `decideRequest` is applied to every request the session makes and
 * `RequestKind` exists to keep the two readable apart in the trail rather than
 * to give one of them a weaker rule.
 *
 * Nothing here performs I/O, touches Electron, or reads a clock. Every decision
 * is a pure function of a declared list and one candidate string, which is what
 * lets `tests/browser-origins.test.ts` attack it with the hostnames an attacker
 * would actually register.
 */

/**
 * The most origins one run may declare.
 *
 * A real article needs its own origin plus a handful of asset and API hosts —
 * a CDN, a font host, an image host. Twelve is generous for that and far too
 * small to be a way of declaring the web. A manifest asking for more is refused
 * whole rather than truncated, because a silently shortened allowlist is an
 * allowlist whose card is wrong.
 */
export const MAX_DECLARED_ORIGINS = 12;

/** The longest string this module will attempt to read as an origin. */
const MAX_ORIGIN_LENGTH = 253;

/**
 * The longest URL the controller will carry, decide about, or write down.
 *
 * Bounded because a URL arrives from three untrusted directions — an agent's
 * request, a redirect chosen by a page, and a subresource chosen by a script —
 * and every one of them ends up in a trail row a person reads. Two kilobytes is
 * past what any article link needs and short of what a data-carrying URL wants.
 */
export const MAX_URL_LENGTH = 2_048;

/** Why a declared origin was not usable. Returned rather than thrown, to audit. */
export type OriginRefusal =
  | "not_a_string"
  | "too_long"
  | "unparseable"
  | "not_https"
  | "has_path"
  | "has_credentials"
  | "too_many";

export type DeclaredOrigins =
  | { ok: true; origins: readonly string[] }
  | { ok: false; refusal: OriginRefusal; value: string };

/**
 * Read a manifest's declared origin list, or refuse it.
 *
 * **HTTPS only, and that is a rule rather than a default.** `http://` in a
 * controlled browser is a page any network between here and there can rewrite,
 * and the trail would then record a URL DASH asked for beside content somebody
 * else chose. There is no first-slice task that needs it, so there is no branch
 * that allows it.
 *
 * A path is refused rather than ignored. `https://example.com/safe/` looks like
 * it narrows the allowlist to a directory and does not — an origin has no path,
 * so accepting the string and comparing origins would silently grant the whole
 * host while the manifest, the card and the person all read a directory. The
 * refusal is the only honest answer; declaring the origin and asking for one
 * article is what a manifest is supposed to say.
 *
 * Credentials in the authority (`https://user:pass@host`) are refused for the
 * reason `lib/broker/operations.ts` refuses a header an agent could name: it is
 * a secret written into a destination, and this module writes destinations into
 * a durable trail a person reads.
 */
export function parseDeclaredOrigins(candidate: unknown): DeclaredOrigins {
  if (!Array.isArray(candidate)) {
    return { ok: false, refusal: "not_a_string", value: "" };
  }
  if (candidate.length > MAX_DECLARED_ORIGINS) {
    return { ok: false, refusal: "too_many", value: String(candidate.length) };
  }

  const origins: string[] = [];
  for (const entry of candidate) {
    if (typeof entry !== "string") {
      return { ok: false, refusal: "not_a_string", value: "" };
    }
    if (entry.length === 0 || entry.length > MAX_ORIGIN_LENGTH) {
      return { ok: false, refusal: "too_long", value: entry.slice(0, 64) };
    }

    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      return { ok: false, refusal: "unparseable", value: entry };
    }
    if (url.protocol !== "https:") {
      return { ok: false, refusal: "not_https", value: entry };
    }
    if (url.username.length > 0 || url.password.length > 0) {
      return { ok: false, refusal: "has_credentials", value: url.origin };
    }
    // `new URL("https://example.com")` normalises to a "/" pathname, so the
    // check is against anything longer than that — plus a query or a fragment,
    // both of which are the same mistake wearing a different punctuation mark.
    if (url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
      return { ok: false, refusal: "has_path", value: entry };
    }

    // `url.origin` rather than the author's own spelling. It lower-cases the
    // host, drops a default port and resolves punycode, so two spellings of one
    // origin cannot both appear in a list a person is asked to read — and the
    // stored value is the one every later comparison is made against.
    if (!origins.includes(url.origin)) {
      origins.push(url.origin);
    }
  }

  return { ok: true, origins: Object.freeze(origins) };
}

/** What kind of request the controlled browser was about to make. */
export type RequestKind =
  /** A page load in the view itself, including one a redirect chose. */
  | "top_level"
  /** A script, style, font, image or API call the page asked for. */
  | "subresource";

export type RequestDecision =
  | { allowed: true; origin: string }
  | {
      allowed: false;
      /** The origin DASH refused, or null when it could not read one. */
      origin: string | null;
      reason: "unreadable_url" | "not_https" | "origin_not_declared";
    };

/**
 * Decide one request against a run's declared origins.
 *
 * The only comparison in this module, and it is `===` between two values
 * `URL` produced. Every property that makes an origin an origin — the scheme,
 * the exact host, the port — is inside that string, and nothing about the path
 * is. `https://example.com.attacker.test` and `https://evil.example.com.co` are
 * both refused here for the same uninteresting reason: they are not equal to
 * anything in the list.
 *
 * A scheme other than HTTPS is refused before the list is consulted, so
 * `data:`, `file:`, `blob:`, `javascript:` and every external protocol handler
 * land on one branch with one name. That branch is why the controller can say
 * it denies external protocols without keeping a list of them.
 */
export function decideRequest(
  declared: readonly string[],
  url: string,
  _kind: RequestKind,
): RequestDecision {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) {
    return { allowed: false, origin: null, reason: "unreadable_url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, origin: null, reason: "unreadable_url" };
  }
  if (parsed.protocol !== "https:") {
    // `parsed.origin` is the string "null" for an opaque scheme, which is a
    // value nobody should see in a trail. The scheme itself is the useful fact
    // and it is what gets written down.
    return { allowed: false, origin: parsed.protocol, reason: "not_https" };
  }
  if (!declared.includes(parsed.origin)) {
    return { allowed: false, origin: parsed.origin, reason: "origin_not_declared" };
  }
  return { allowed: true, origin: parsed.origin };
}

/**
 * A URL as DASH is willing to write it into a trail and show a person.
 *
 * Truncated rather than refused, because this runs on a URL a decision has
 * *already* been taken about and the trail's job at that point is to say what
 * happened. What it drops is the query string and the fragment: an article URL
 * carries session ids, tracking parameters and occasionally an email address in
 * its query, and a durable table of every one of them is a record nobody asked
 * DASH to keep. The origin and the path are what a person needs to recognise
 * the page.
 *
 * Returns null for anything unreadable, which the callers render as an absent
 * URL rather than as the literal string an attacker chose.
 */
export function trailUrl(url: string): string | null {
  if (url.length === 0 || url.length > MAX_URL_LENGTH) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`.slice(0, MAX_URL_LENGTH);
  } catch {
    return null;
  }
}

/**
 * The sentence a card, a receipt and a trail all have to carry.
 *
 * One function rather than three copies, for `lib/copy/`'s usual reason and one
 * specific to this decision: ADR 0019 requires the claim to be qualified
 * *everywhere it appears*, and a qualification that lives in three files is a
 * qualification that will eventually be dropped from one of them. The wording is
 * pinned by `tests/copy-browser.test.ts`.
 */
export function describeReach(count: number): string {
  return (
    `DASH kept the browser it opened to ${String(count)} ` +
    `${count === 1 ? "address" : "addresses"} for this run. That limits the browser ` +
    "DASH provides, not the agent: an agent is an ordinary program and can reach the " +
    "internet by other means that DASH does not see."
  );
}
