/**
 * What an agent's manifest says about the browser it wants (MAR-628, ADR 0019).
 *
 * ADR 0019 puts this in the manifest rather than in a connection: *"Browser
 * access is a **manifest capability named `browser`**, with declared origins and
 * action classes... It is not a new connection plane."* A connection carries an
 * owner, fields and a validation action, and a controlled browser has none of
 * those in this slice — there is no credential, so there is nothing to own,
 * nothing to fill in and nothing to test.
 *
 * ## Two kinds of literal, and only one of them is DASH's
 *
 * It is worth being exact about who typed what, because a card that blurs the
 * two would be claiming more review than happened.
 *
 * - **The operation catalogue** — `browser.open`, `browser.read` — is literals
 *   *DASH's own developers* typed, in `lib/browser/operations.ts`, pinned by
 *   value in a test. That is the same property `WRITE_PATHS` has and it is the
 *   strong one.
 * - **The origin list** is literals *the agent's author* typed. DASH parses it,
 *   refuses everything that is not an exact HTTPS origin, and shows it to the
 *   person before the run — but DASH did not choose it, and no surface may imply
 *   it did.
 *
 * What the person contributes is the decision to run the agent at all, having
 * seen the list. That is a smaller claim than approval-per-gesture and it is the
 * true one for this slice.
 *
 * ## Why the block is separate from `agent_dom.permissions`
 *
 * `permissions` is explicitly *a declaration, not a boundary* — its own schema
 * description says so, and DASH's `network: read` entry is the standing example:
 * the runner spawns an ordinary child process with unrestricted network access.
 * This block **is** enforced, for the browser DASH provides and for nothing
 * else. Putting an enforced list inside the block whose contract is "DASH does
 * not enforce this" would have made both halves unreadable.
 */

import { parseDeclaredOrigins, type OriginRefusal } from "./origins";

/** What one agent asked for, as DASH read it. */
export interface BrowserDeclaration {
  /** Exact HTTPS origins, normalised. Never a prefix and never a path. */
  origins: readonly string[];
  /** The author's one sentence about why. Rendered; never parsed. */
  purpose: string | null;
}

export type BrowserDeclarationResult =
  | { ok: true; declaration: BrowserDeclaration }
  /** The manifest declares no browser at all. Not an error. */
  | { ok: false; reason: "absent" }
  /** It declares one and DASH will not accept it. The person is told which value. */
  | { ok: false; reason: "refused"; refusal: OriginRefusal; value: string };

/** The longest purpose sentence DASH will carry onto a card. */
const MAX_PURPOSE = 300;

/**
 * Read the `browser` block out of a manifest.
 *
 * Takes `unknown` and checks every field. The manifest is the agent author's
 * document — DASH validates it against a schema on import, and this function
 * still does not assume that happened, because a store written by an older
 * build and a document handed straight to this function are both real callers.
 *
 * A refusal is returned rather than thrown and carries the offending value, so
 * that the agent's own page can say *which* address DASH would not accept. An
 * author who typed `https://example.com/news` needs to be told about the path,
 * not told that something was wrong.
 */
export function readBrowserDeclaration(manifest: unknown): BrowserDeclarationResult {
  if (typeof manifest !== "object" || manifest === null) {
    return { ok: false, reason: "absent" };
  }
  const dom = (manifest as Record<string, unknown>)["agent_dom"];
  if (typeof dom !== "object" || dom === null) {
    return { ok: false, reason: "absent" };
  }
  const block = (dom as Record<string, unknown>)["browser"];
  if (typeof block !== "object" || block === null) {
    return { ok: false, reason: "absent" };
  }

  const parsed = parseDeclaredOrigins((block as Record<string, unknown>)["origins"]);
  if (!parsed.ok) {
    return { ok: false, reason: "refused", refusal: parsed.refusal, value: parsed.value };
  }
  if (parsed.origins.length === 0) {
    // An empty list is refused rather than treated as "no browser". They mean
    // different things: one is an author who wants a browser and named nowhere
    // for it to go, which is a mistake worth reporting, and the other is an
    // author who wants no browser, which is the ordinary case and says nothing.
    return { ok: false, reason: "refused", refusal: "too_many", value: "0" };
  }

  const purpose = (block as Record<string, unknown>)["purpose"];
  return {
    ok: true,
    declaration: {
      origins: parsed.origins,
      purpose: typeof purpose === "string" && purpose.length > 0 ? purpose.slice(0, MAX_PURPOSE) : null,
    },
  };
}

/**
 * The origins for one manifest, or null.
 *
 * The narrow answer `BrowserControllerDeps.declaredOrigins` wants: null covers
 * both "declares no browser" and "declared one DASH will not accept", because
 * the controller's next move is identical — refuse with `browser_not_declared`.
 * The distinction is kept for the *person*, on the agent's page, where there is
 * room to say which value was wrong and what to do about it.
 */
export function declaredOriginsFor(manifest: unknown): readonly string[] | null {
  const read = readBrowserDeclaration(manifest);
  return read.ok ? read.declaration.origins : null;
}
