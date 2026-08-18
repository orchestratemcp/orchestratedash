/**
 * The one question asked before anything leaves DASH's window (MAR-698).
 *
 * `createWindow` denies `window.open` and blocks navigation off the renderer's
 * origin, and that wall is the design rather than an obstacle to it — MAR-642
 * packet 3 and MAR-674's export planning both hit it and both left it standing.
 * So "clickable" cannot mean a loosened navigation policy. It means an anchor
 * whose click is intercepted and handed to `shell.openExternal` through one
 * explicit main-process route, and this module is the gate on that route.
 *
 * ## Pure, for `lib/shell/ipc.ts`' reason
 *
 * The decision is separated from the act so it can be tested without launching
 * Electron, and so a reviewer asking "what can DASH be made to open?" gets a
 * complete answer from one function rather than from an audit of every caller.
 * `electron/open-out.ts` is the only thing that performs it.
 *
 * ## `https` and nothing else
 *
 * MAR-698's own requirement, and worth stating what each refusal buys:
 *
 * - `javascript:` and `data:` are the ones that matter. `shell.openExternal`
 *   hands the string to the operating system, and the operating system has a
 *   handler for far more than the web — a `javascript:` URL is inert here only
 *   because this function refuses it.
 * - `file:` would turn a link in a digest into a way to open anything on this
 *   computer, which is the reach `electron/open-out.ts`' other half exists to
 *   bound to one folder.
 * - Registered custom schemes — `dash:` among them — would let a collected
 *   address re-enter DASH through the deep-link handler.
 * - `http:` is refused too, and that one is a real cost rather than a free
 *   win: a feed that publishes plain-http item addresses loses its link and
 *   keeps its headline. It is refused anyway because the alternative is DASH
 *   opening a downgraded connection on a person's behalf without saying so,
 *   and because the address on the card is one DASH collected rather than one
 *   the person typed.
 *
 * ## What this function is *not*
 *
 * It is not what keeps model-authored prose linkless. That property is
 * structural and lives one layer up: `app/_components/digest.tsx` renders the
 * model's characters as text and never as markup, so there is no anchor for a
 * URL in a paragraph to become. This gate would happily open an `https`
 * address a model wrote — it never sees one, because nothing offers it one.
 * Both halves are pinned by tests, and neither is a substitute for the other.
 */

/**
 * How long an address may be before DASH stops reading it.
 *
 * Generous for a real URL and far short of anything that could be a payload.
 * A refusal here is about the shape of the string rather than about its
 * contents, which is the only judgement this module is in a position to make.
 */
const MAX_LINK_LENGTH = 2_048;

export type OutboundLinkReview =
  | { ok: true; url: string }
  | { ok: false; refusal: OutboundLinkRefusal; detail: string };

export type OutboundLinkRefusal = "malformed" | "too_long" | "not_https";

/**
 * Said about the link rather than about the person.
 *
 * Nobody typed this address — it arrived in an agent's collected row — so the
 * sentence describes what DASH found rather than what somebody did wrong, and
 * it does not quote the address back onto the screen.
 */
const NOT_HTTPS =
  "DASH only opens secure web addresses, and this link is not one. It is shown as it was collected.";
const MALFORMED = "DASH could not read that link as a web address, so it did not open anything.";
const TOO_LONG = "That link is too long for DASH to open.";

/**
 * Whether this address may be handed to the operating system.
 *
 * Takes `unknown` on purpose. Every caller is downstream of the renderer, and a
 * function whose parameter is `string` is one whose type has already assumed
 * the thing this exists to check.
 */
export function inspectOutboundLink(candidate: unknown): OutboundLinkReview {
  if (typeof candidate !== "string" || candidate === "") {
    return { ok: false, refusal: "malformed", detail: MALFORMED };
  }
  if (candidate.length > MAX_LINK_LENGTH) {
    return { ok: false, refusal: "too_long", detail: TOO_LONG };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    // A relative address lands here too, and refusing it is right: there is
    // nothing for it to be relative *to* once it leaves this window.
    return { ok: false, refusal: "malformed", detail: MALFORMED };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, refusal: "not_https", detail: NOT_HTTPS };
  }

  /*
   * Belt and braces, and said honestly: today this branch cannot be reached.
   *
   * WHATWG parsing treats `https` as a special scheme, so `new URL("https://")`
   * throws and `new URL("https:///prices")` resolves the host to `prices`
   * rather than to nothing — the `catch` above already has both. The check
   * stays because what must hold is "no address naming nowhere leaves here",
   * and hanging that on a parser detail staying true is how it would stop
   * holding without anybody editing this file.
   */
  if (parsed.hostname === "") {
    return { ok: false, refusal: "malformed", detail: MALFORMED };
  }

  /*
   * The re-serialised form, not the string that came in.
   *
   * `URL` has already normalised the scheme, the host and the percent-encoding
   * by here, so what leaves is a string this module fully parsed rather than
   * one it merely approved of. The difference matters for exactly the input
   * this gate exists for: an address whose two readings disagree cannot have
   * one of them checked and the other one opened.
   */
  return { ok: true, url: parsed.toString() };
}
