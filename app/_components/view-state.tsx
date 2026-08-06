"use client";

import type { ReactNode } from "react";

import { describeReadOnlyHost, type RenderHost } from "../../lib/copy/host";
import type { Recovery } from "../../lib/copy/recovery";
import { VIEW_STATE_ATTRIBUTE } from "../../lib/shell/first-paint";

/**
 * The two states every page gained when it stopped being a server component
 * (MAR-432), rendered the same way on all four of them.
 *
 * One implementation rather than four, because these are the states most likely
 * to be written carelessly — they are the ones nobody looks at while the happy
 * path is being built — and because `docs/design-brief.md`'s rule about failures
 * is a rule about *every* failure. A recovery rendered on three pages and
 * forgotten on the fourth is the rule not holding.
 */

/**
 * Waiting.
 *
 * Says what it is waiting for, rather than spinning. The brief's "nothing moves
 * or refreshes without saying it did" is about not surprising the reader, and an
 * unlabelled spinner surprises them with whatever appears next.
 *
 * ## The attribute, and why the product carries it
 *
 * `data-view-state` is the one hook that makes "the first page left its loading
 * state" checkable from outside the renderer, and it is on the product rather
 * than on a fixture because the thing worth checking is the shipped page. A
 * check that matched the sentence instead would be pinned to prose — the part
 * of this component most likely to be improved for good reasons, and the part
 * whose change says nothing at all about whether the page works.
 *
 * It is what `electron/first-paint.ts` waits to disappear. See
 * `lib/shell/first-paint.ts` for why the absence of this attribute is the
 * assertion rather than the presence of any particular content.
 */
export function ViewLoading({ what }: { what: string }): ReactNode {
  return (
    <div className="empty" aria-live="polite" {...{ [VIEW_STATE_ATTRIBUTE]: "loading" }}>
      <p>Reading {what}…</p>
    </div>
  );
}

/**
 * A failure, as the three things a failure has to name.
 *
 * All three are rendered, always. `Recovery` is three fields rather than one
 * string precisely so a surface cannot show two of them and drop the third —
 * which is always the next action, and is the only one that helps.
 */
export function ViewFailed({ recovery }: { recovery: Recovery }): ReactNode {
  return (
    /*
      Marked as well as `ViewLoading`, and the distinction is the point. A page
      that failed has left the loading state and is still not a working page, so
      a check that only waited for "loading" to go would call a rendered failure
      a success. `electron/first-paint.ts` reports the three outcomes as three
      different things.
    */
    <div className="empty" role="alert" {...{ [VIEW_STATE_ATTRIBUTE]: "failed" }}>
      <p>
        <strong>{recovery.headline}</strong>
      </p>
      <p>{recovery.meaning}</p>
      <p>{recovery.next_action}</p>
    </div>
  );
}

/**
 * The notice a browser tab carries and the installed app does not.
 *
 * Renders nothing in the app, and nothing at all until the host is known — which
 * is after the first paint on the developer path, where these pages are still
 * server-rendered before they hydrate. Showing it optimistically would mean
 * flashing "this is a browser" inside the installed app for one frame.
 */
export function HostNotice({ host }: { host: RenderHost | null }): ReactNode {
  if (host === null) {
    return null;
  }
  const notice = describeReadOnlyHost(host);
  if (notice === null) {
    return null;
  }
  return (
    <details className="host-notice">
      <summary>{notice.headline}</summary>
      <p className="muted">{notice.meaning}</p>
    </details>
  );
}
