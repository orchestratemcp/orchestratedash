import type { MouseEvent, ReactNode } from "react";

import { inspectOutboundLink } from "../../lib/shell/outbound";
import { openLink } from "../_data/source";

/**
 * A link DASH collected, made pressable without touching the wall (MAR-698).
 *
 * Henrik, reading the first real brief in the installed app: *"The briefing and
 * outputs are full of links but none is clickable."* They were anchors already
 * — `DigestItem` has drawn one since MAR-434 — and they did nothing, because
 * `createWindow` denies `window.open` and refuses navigation off the renderer's
 * origin. Both denials are deliberate: without them any link in the UI, or
 * injected into it, could navigate a privileged renderer to a remote page that
 * then has the command channel in reach.
 *
 * So this component asks for no exception. It renders the same anchor and
 * intercepts its own click, handing the address to main through `open.link` —
 * one audited command, `https` only. Nothing about the navigation policy
 * changes, and a link that somehow reached the browser's own handling would
 * still be blocked exactly as it is today.
 *
 * ## An address DASH will not open is drawn as text, not as a dead anchor
 *
 * `inspectOutboundLink` is asked here as well as in main, and that is one rule
 * in one module rather than two copies of it: `lib/shell/outbound.ts` is the
 * only place the rule is written, main is where it is *enforced*, and this is
 * where it decides what to draw. A renderer that skipped the question would
 * change nothing about what can be opened.
 *
 * What it buys is the difference between the two failures. An anchor whose
 * press is refused in main looks exactly like the defect this issue was filed
 * on — a link that does nothing — so a feed publishing plain `http` addresses
 * would have shipped MAR-698's own complaint back to Henrik under a fix for it.
 * Text is honest: the headline is still there, the address is still in the
 * record, and nothing on screen promises a press that cannot work. It is the
 * same rule `OutputsPanel` applies to its Download button, one surface along.
 *
 * ## Why it stays an `<a>` with a real `href`
 *
 * 1. A person reading a briefing expects a link to look and behave like one —
 *    hover, focus ring, "copy link address". A `<button>` styled blue has none
 *    of that.
 * 2. The developer path is an ordinary browser tab with no bridge. There the
 *    click is not intercepted and the anchor does what anchors do.
 * 3. `electron/brief-pdf.ts` renders these same components through
 *    `renderToStaticMarkup` to make the exported document. Handlers are dropped
 *    there and the `href` is kept — which is why the PDF has had live citation
 *    links since MAR-674 and keeps them.
 *
 * ## What this is not
 *
 * It is not what keeps model-authored prose linkless. That property is
 * structural: `app/_components/digest.tsx` renders a model's characters as
 * text, so a URL in a paragraph has no anchor to be, and nothing ever offers
 * this component a string a model produced. See `lib/shell/outbound.ts`, which
 * says at greater length why its gate is not that guarantee either. Both halves
 * are pinned by tests and neither stands in for the other.
 */
export function LinkOut({
  href,
  className,
  children,
}: {
  /** An address DASH collected. Never a string a model produced. */
  href: string;
  className?: string;
  children: ReactNode;
}): ReactNode {
  if (!inspectOutboundLink(href).ok) {
    // Shown as it was collected. See the header: a dead anchor would be this
    // issue's own complaint wearing the shape of its fix.
    return <>{children}</>;
  }

  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        followCollectedLink(event, href);
      }}
      /* Unchanged from the anchors this replaced. `target` is inert in the app
         — the window-open handler denies it — and correct in a browser tab;
         `rel` is what stops the opened page from reaching back through
         `window.opener`. */
      rel="noreferrer noopener"
      target="_blank"
    >
      {children}
    </a>
  );
}

/**
 * Decide what a press on a collected link should do, and do it.
 *
 * Exported, and taking the event as an argument, so it can be tested: this
 * repository's render tests are `renderToStaticMarkup`, which drops handlers
 * and never dispatches an event, so a decision left inside the JSX would be a
 * decision no test in the suite can reach.
 *
 * `void` on the command rather than an `await`: nothing on screen changes when
 * a link opens, so there is no state to settle. A refusal from main is silent
 * here on purpose — by then the person is looking at their browser, and the
 * one refusal a correctly drawn link can still meet is a computer with no web
 * browser set up, which is not a fact about the briefing they are reading.
 */
export function followCollectedLink(
  event: Pick<MouseEvent, "preventDefault">,
  href: string,
  bridge: { open: (args: { url: string }) => Promise<unknown> } | null = defaultBridge(),
): boolean {
  /*
   * No bridge means a browser tab, and there the anchor is already right.
   *
   * `preventDefault` is not called, so the click falls through to the browser's
   * own handling. An installed shell older than `open.link` lands here too, and
   * the link stays as dead as it is today — the honest degradation rather than
   * a new failure.
   */
  if (bridge === null) {
    return false;
  }

  event.preventDefault();
  void bridge.open({ url: href });
  return true;
}

/**
 * The bridge, or null when this window has none.
 *
 * Resolved at press time rather than at render, because these components are
 * also rendered in the main process for the exported PDF, where there is no
 * `window` to touch at all.
 */
function defaultBridge(): { open: (args: { url: string }) => Promise<unknown> } | null {
  if (typeof window === "undefined" || window.dashShell?.openLink === undefined) {
    return null;
  }
  return { open: openLink };
}
