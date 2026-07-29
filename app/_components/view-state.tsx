"use client";

import type { ReactNode } from "react";

import { describeReadOnlyHost, type RenderHost } from "../../lib/copy/host";
import type { Recovery } from "../../lib/copy/recovery";

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
 */
export function ViewLoading({ what }: { what: string }): ReactNode {
  return (
    <div className="empty" aria-live="polite">
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
    <div className="empty" role="alert">
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
