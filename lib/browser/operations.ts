/**
 * What an agent may ask the controlled browser to do (MAR-628, ADR 0019).
 *
 * This file is to the browser what `lib/broker/operations.ts` is to a provider
 * account, and it is deliberately written to the same rule: **an operation is a
 * named thing DASH knows how to do**, whose gesture is constructed here from a
 * small typed input, and whose result is projected down to named fields before
 * anything the agent can read is built.
 *
 * ADR 0019 says what that has to rule out, by name:
 *
 * > no generic `evaluateJavaScript`, `pressKey`, raw mouse, raw keyboard or raw
 * > CDP escape hatch exists for an agent, because each would bypass that
 * > catalogue.
 *
 * The guarantee is structural rather than promised, in the shape `WRITE_PATHS`
 * uses over there: **the field an escape would have to fill is not there.** A
 * `BrowserGesture` is a union of two members. One carries a URL that this file
 * validated; the other carries nothing at all. There is no member with a
 * selector, an expression, a key name, a coordinate, a CDP method or a CDP
 * parameter object, so a bug anywhere in this module cannot produce one — the
 * type has nowhere to put it. Reaching `Runtime.evaluate` means adding a member
 * here, which `tests/browser-threat-model.test.ts` pins by value.
 *
 * ## Why slice 1 has two operations and not five
 *
 * ADR 0019's smallest slice named four: `navigate`, `read`, `scroll` and one
 * approval-required `click`. This slice ships the first two. The reason is not
 * that the others are hard — it is that `scroll` and `click` are the operations
 * that need the approval surface, and an approval surface built beside an
 * unproven controller would be a person approving gestures against a browser
 * nobody has watched work yet. Amendment 1 to ADR 0019 records the narrowing and
 * what it defers; `docs/adr/0019-...md` is the document, not this comment.
 *
 * What the narrowing buys is a claim that is entirely true for the catalogue as
 * shipped: **every operation DASH offers reads, and none of them dispatches an
 * input event.** A person watching this browser is watching something that
 * cannot type, cannot click and cannot submit, because none of those exist.
 *
 * ## Nothing here performs I/O
 *
 * `resolve` turns an untrusted input into a gesture. `project` turns what the
 * controller observed into the agent's answer. Neither touches Electron, the
 * network, a `WebContents` or a debugger — which is what lets the threat-model
 * test attack this boundary with no Electron and no network at all.
 */

import { MAX_URL_LENGTH } from "./origins";

/**
 * What the controller will actually do, fully decided by DASH.
 *
 * Read the union as the complete answer to "what can an agent make this browser
 * do?". Two members, and the widest thing either carries is one absolute HTTPS
 * URL that `resolveOperation` parsed. See the note at the top of this file on
 * why the absences are the design.
 */
export type BrowserGesture =
  /** Load one page in the view. The URL is still checked against the run's origins. */
  | { kind: "navigate"; url: string }
  /** Take the current page's title and visible text. Carries no target of any kind. */
  | { kind: "read_page" };

/** Why an input was refused. Returned rather than thrown so it can be audited. */
export type BrowserInputRefusal =
  | "input_not_an_object"
  | "missing_required_input"
  | "input_wrong_type"
  | "input_out_of_range"
  | "input_malformed";

export type ResolveResult =
  | { ok: true; gesture: BrowserGesture }
  | { ok: false; refusal: BrowserInputRefusal; field: string };

/**
 * Which class of thing an operation does, for the trail and for approval.
 *
 * Two values because the catalogue has two, and the second one is empty on
 * purpose. `input` is declared and unreachable: no operation in
 * `BROWSER_OPERATIONS` carries it, so `tests/browser-threat-model.test.ts` can
 * assert that the shipped catalogue contains no input-dispatching operation
 * against a type that would let one exist. Deleting the value would make that
 * test assert a tautology about a union of one.
 */
export type BrowserAccess = "read" | "input";

export interface BrowserOperation {
  /** Stable id an agent names, e.g. `browser.open`. */
  id: string;
  /** One sentence, plain language, no identifiers. Rendered on the card. */
  label: string;
  access: BrowserAccess;
  /**
   * Whether a person must approve each use before it is dispatched.
   *
   * False for both shipped operations, and that is a claim about the catalogue
   * rather than a relaxation: neither of them dispatches an input event, and
   * both are confined to origins a person saw before the run started. The first
   * operation that types or clicks arrives with this true and with the surface
   * that makes it mean something — see ADR 0019 amendment 1.
   */
  approval_required: boolean;
  /**
   * How many characters of page text this operation will carry back.
   *
   * Per operation for `max_response_bytes`'s reason in the broker: it is a
   * property of the thing being done, not something a caller gets to decide per
   * request, and the value on the other side of it is an unbounded allocation
   * in the DASH process driven by a page DASH did not write.
   */
  max_result_chars: number;
  /** Turn a validated input into the gesture DASH will perform. */
  resolve(input: Record<string, unknown>): ResolveResult;
}

/**
 * The longest page text one read will carry across the boundary.
 *
 * A long article is a few tens of thousands of characters. This is generous for
 * that and small enough that a page built to exhaust the reader — a megabyte of
 * generated text, a script writing into the DOM in a loop — is truncated rather
 * than carried. The agent is told the text was truncated; see `PageReading`.
 */
export const MAX_PAGE_TEXT_CHARS = 40_000;

/** And the longest title. A title longer than this is a paragraph in a title tag. */
export const MAX_PAGE_TITLE_CHARS = 300;

/**
 * Open one page.
 *
 * The URL is the only value an agent supplies to this whole subsystem, and it
 * is narrowed three times before anything loads: here, for shape; in
 * `decideRequest`, against the run's declared origins; and again by the
 * controller on every redirect the page chooses, because a redirect is a
 * navigation the agent did not ask for and the ADR requires the trail to say so.
 *
 * Note what is absent from the input. There is no `wait_for`, no `timeout`, no
 * `referrer`, no `headers` and no `user_agent` — each of which would be a value
 * an agent chooses that changes what a site is asked, and none of which any
 * first-slice task needs.
 */
const BROWSER_OPEN: BrowserOperation = {
  id: "browser.open",
  label: "Open one web page in the browser DASH is watching",
  access: "read",
  approval_required: false,
  // A navigation returns a URL and a title, not a document.
  max_result_chars: MAX_PAGE_TITLE_CHARS,

  resolve(input) {
    const raw = input["url"];
    if (raw === undefined || raw === null) {
      return { ok: false, refusal: "missing_required_input", field: "url" };
    }
    if (typeof raw !== "string") {
      // Not coerced, for `requireString`'s reason in the broker: `String(value)`
      // on an object produces a string DASH would then really try to open.
      return { ok: false, refusal: "input_wrong_type", field: "url" };
    }
    if (raw.length === 0 || raw.length > MAX_URL_LENGTH) {
      return { ok: false, refusal: "input_out_of_range", field: "url" };
    }

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      // Absolute or nothing. A relative URL would have to be resolved against
      // "wherever the view happens to be", which makes the destination a
      // function of the page rather than of the request — and the page is the
      // untrusted party.
      return { ok: false, refusal: "input_malformed", field: "url" };
    }
    if (url.protocol !== "https:") {
      return { ok: false, refusal: "input_malformed", field: "url" };
    }
    if (url.username.length > 0 || url.password.length > 0) {
      return { ok: false, refusal: "input_malformed", field: "url" };
    }

    // `url.href` rather than the agent's own spelling: normalised once, here,
    // so the string the controller loads is the same string the origin check
    // was taken against. Two spellings of one URL is how a check and an action
    // end up disagreeing.
    return { ok: true, gesture: { kind: "navigate", url: url.href } };
  },
};

/**
 * Read what is on the page now.
 *
 * **The input is empty and the type says so.** `resolve` ignores what it is
 * handed and returns a gesture carrying nothing, so there is no field for a
 * selector, an XPath, a frame name or a script — which is the property ADR 0019
 * asks for and the reason this operation is a separate one rather than an
 * optional argument to `browser.open`.
 *
 * What comes back is the page's title and its visible text. Both are content
 * from the open web and are therefore untrusted data under ADR 0002 invariant
 * 7 — see `lib/browser/session.ts`, which is where a successful read marks the
 * run and stops the same run reaching outward without a person.
 */
const BROWSER_READ: BrowserOperation = {
  id: "browser.read",
  label: "Read the words on the page it has open",
  access: "read",
  approval_required: false,
  max_result_chars: MAX_PAGE_TEXT_CHARS,

  resolve() {
    return { ok: true, gesture: { kind: "read_page" } };
  },
};

/**
 * Every operation an agent may name, by value (MAR-628).
 *
 * Read this array as the answer to "what can an agent make DASH's browser do?".
 * It is the complete answer: `operationById` is a lookup over this frozen list
 * rather than a dispatch over anything an agent supplies, and
 * `tests/browser-threat-model.test.ts` asserts it by value — which is the
 * conversation `WRITE_PATHS` forces for a mailbox, pointed at the one thing in
 * this subsystem that could grow an escape hatch.
 *
 * `browser.click`, `browser.type`, `browser.evaluate`, `browser.press` and
 * `browser.screenshot_element` are not here, and adding any of them is a
 * one-line diff in a file whose test reads this array out loud.
 */
export const BROWSER_OPERATIONS: readonly BrowserOperation[] = Object.freeze([
  BROWSER_OPEN,
  BROWSER_READ,
]);

/** Resolve an operation id against the frozen list. Never a dispatch. */
export function browserOperationById(id: string): BrowserOperation | null {
  return BROWSER_OPERATIONS.find((operation) => operation.id === id) ?? null;
}

/**
 * What the controller observed after a gesture, projected for the agent.
 *
 * Named fields, and the list is short on purpose. There is no HTML, no DOM
 * tree, no cookie, no header, no status code and no network log: each would be
 * a larger surface for a hostile page to write into an agent's reasoning, and
 * none of them is needed to read an article.
 *
 * `truncated` is a field rather than a silence. An agent handed forty thousand
 * characters of a hundred-thousand-character page, with no way to tell, is an
 * agent that will summarise the first third of a document and report it as the
 * whole — the same failure `optionalCount` refuses to commit by clamping.
 */
export interface PageReading {
  /** Where the view actually ended up, which may not be where it was sent. */
  url: string;
  title: string;
  /** Absent for `browser.open`, which reports a destination and not a document. */
  text?: string;
  truncated?: boolean;
}

/**
 * Bound one reading to the operation's own ceilings.
 *
 * A pure function over values the controller read off a page, applied before
 * anything crosses to the agent and before anything is written to the trail.
 * The page chose every one of these strings.
 */
export function projectReading(operation: BrowserOperation, reading: PageReading): Record<string, unknown> {
  const projected: Record<string, unknown> = {
    url: reading.url.slice(0, MAX_URL_LENGTH),
    title: reading.title.slice(0, MAX_PAGE_TITLE_CHARS),
  };
  if (reading.text !== undefined) {
    const bounded = reading.text.slice(0, operation.max_result_chars);
    projected["text"] = bounded;
    projected["truncated"] = bounded.length < reading.text.length;
  }
  return projected;
}
