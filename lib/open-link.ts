/**
 * `dash://open?…` — the second kind of deep link (MAR-588).
 *
 * `lib/handoff.ts` reserved this: "a fixed word rather than a free-form path so
 * that adding a second kind of deep link later is a new authority with its own
 * parser, rather than a change to how this one is recognised". This is that
 * second authority, and it is deliberately the smallest one that could exist.
 *
 * ## What it does, and the shorter list of what it cannot
 *
 * It names a surface already inside DASH and asks for it to be shown. That is
 * all. It registers nothing, starts nothing, approves nothing, and reaches no
 * agent, no runner, no vault and no provider. Following one is the same act as
 * clicking a row in the agents list, and is worth exactly as much authority.
 *
 * The handoff link had to be built around proof-of-possession — a nonce, a file
 * on disk, a TTL, a consent dialog — because opening one could end with DASH
 * spawning a command line somebody else wrote. Nothing here can end with
 * anything, so none of that apparatus is needed and none of it is present.
 * Adding a parameter that *did* need it would be the moment to stop and give
 * that thing its own authority.
 *
 * ## Why no approval id, and why that is a rule rather than an omission
 *
 * MAR-588 sends these links to a Discord channel. A channel has members, is
 * often more people than the one at the keyboard, and is a place a link can be
 * forwarded out of. So the rule the outbound half is built on — no approval
 * token in any URL — has to hold at this end too, where the URL is *read*:
 * `parseOpenLink` accepts two parameter names and rejects a URL carrying any
 * third, so a link that grew an `approval_id` in transit is refused rather than
 * quietly ignored. Refused, because ignoring it would let a crafted link differ
 * from the one DASH would have written while still opening a page, and the
 * difference is precisely what somebody probing this would be looking for.
 *
 * ## Why the ids are validated here rather than by the surface
 *
 * They become a query string on a renderer route. `lib/handoff.ts` states why
 * an agent id is a path-traversal boundary in its own right; here the concern is
 * narrower and still worth closing at the parser — an id is checked against the
 * same shape the handoff enforces, so nothing that was never a legal agent id can
 * reach a page and be looked up.
 */

import { HANDOFF_SCHEME } from "./handoff";

/**
 * The authority segment. `dash://open?agent=…`.
 *
 * A sibling of `HANDOFF_HOST`, not a path under it, so that the first thing a
 * reader of a URL — or of `electron/main.ts`'s dispatcher — learns is which of
 * the two very different things is being asked for.
 */
export const OPEN_HOST = "open";

/** The two parameter names, shared by the writer and the reader below. */
export const OPEN_PARAMS = { agent: "agent", run: "run" } as const;

/**
 * The id shape, matching `lib/handoff.ts`'s `AGENT_ID`.
 *
 * Written out rather than imported because that constant is deliberately not
 * exported: it is that module's own boundary rule, and reaching into it would
 * make this file's guarantee depend on somebody remembering the two are related.
 * `tests/open-link.test.ts` asserts they agree.
 */
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Run ids come from agents, so they are checked for shape rather than owned.
 *
 * Wider than an agent id — a run id is whatever the agent minted, and the
 * contract only requires it be a non-empty string — but still closed: no
 * separators, no spaces, nothing that could steer a path.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface OpenTarget {
  agent: string;
  /** Null when the link names an agent and no particular run. */
  run: string | null;
}

export type OpenLinkRefusal =
  | "not_a_url"
  | "wrong_scheme"
  | "wrong_authority"
  | "missing_agent"
  | "bad_agent"
  | "bad_run"
  | "unexpected_param";

export type OpenLinkParse =
  | { ok: true; target: OpenTarget }
  | { ok: false; refusal: OpenLinkRefusal };

/**
 * Build the link that goes in a Discord message.
 *
 * Callers pass ids they already hold; this does not validate them, because the
 * ids DASH holds came in through the import door and a builder that could refuse
 * would have no honest thing to return. What guards the boundary is
 * `parseOpenLink`, at the end where the URL is untrusted.
 */
export function buildOpenLink(target: OpenTarget): string {
  const params = new URLSearchParams({ [OPEN_PARAMS.agent]: target.agent });
  if (target.run !== null) {
    params.set(OPEN_PARAMS.run, target.run);
  }
  return `${HANDOFF_SCHEME}://${OPEN_HOST}?${params.toString()}`;
}

/**
 * Read a link that arrived from the operating system.
 *
 * Fully untrusted input: on Windows this string is whatever was in the argv of a
 * process something else launched. Every branch below returns a refusal rather
 * than a partial target — there is no "the agent was fine so open that anyway"
 * path, because a link DASH would not have written is a link DASH should not act
 * on part of.
 */
export function parseOpenLink(raw: string): OpenLinkParse {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, refusal: "not_a_url" };
  }

  if (url.protocol !== `${HANDOFF_SCHEME}:`) {
    return { ok: false, refusal: "wrong_scheme" };
  }
  // `dash://open?…` parses as an opaque-ish URL whose authority lands in
  // `hostname`. Lowercased because Windows hands back whatever case the caller
  // used and the authority is not the place to be case-sensitive.
  if (url.hostname.toLowerCase() !== OPEN_HOST) {
    return { ok: false, refusal: "wrong_authority" };
  }

  const known: readonly string[] = [OPEN_PARAMS.agent, OPEN_PARAMS.run];
  for (const key of url.searchParams.keys()) {
    if (!known.includes(key)) {
      // The rule from the module header, enforced. A third parameter is refused
      // whatever it is called, so `approval_id`, `token` and `nonce` are all
      // covered without this file having to guess at their names.
      return { ok: false, refusal: "unexpected_param" };
    }
  }

  const agent = url.searchParams.get(OPEN_PARAMS.agent);
  if (agent === null || agent === "") {
    return { ok: false, refusal: "missing_agent" };
  }
  if (!AGENT_ID.test(agent)) {
    return { ok: false, refusal: "bad_agent" };
  }

  const run = url.searchParams.get(OPEN_PARAMS.run);
  if (run !== null && !RUN_ID.test(run)) {
    return { ok: false, refusal: "bad_run" };
  }

  return { ok: true, target: { agent, run } };
}

/**
 * Which authority a `dash://` URL names, for the dispatcher in `electron/main.ts`.
 *
 * Returns the raw authority rather than a decided route: main routes on it, and
 * a URL whose authority is neither of the two known ones is reported by that
 * caller rather than silently dropped here — `lib/shell/deep-link.ts` makes the
 * same argument about why a malformed link must still reach a layer that can
 * produce a user-facing refusal.
 */
export function deepLinkAuthority(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${HANDOFF_SCHEME}:`) {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}
