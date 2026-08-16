/**
 * What one agent's controlled browser looks like on screen (MAR-628, ADR 0019).
 *
 * The supervision surface is the product of this whole decision. ADR 0019 is
 * explicit that the reason to build a browser out of an Electron
 * `WebContentsView` rather than to add Playwright is *not* automation quality —
 * Playwright is better at automation — but that **a person can watch the actual
 * page, interrupt the run, and inspect what DASH asked the browser to do without
 * changing applications.** This module is the second and third of those.
 *
 * The page itself is not here and cannot be: it is a native view Chromium paints
 * over the window, positioned by `setBrowserViewportBounds`. What this projects
 * is everything around it — where the browser is allowed to go, where it has
 * been, what DASH decided about each request, and what DASH refused on the
 * page's behalf.
 *
 * ## Every claim on this view is qualified where it is made
 *
 * A list of visited origins reads as *the addresses this agent reached* unless
 * something says otherwise, and nothing else on the screen can. So `reach` is
 * not a bare count — it is `describeReach`'s sentence, built in
 * `lib/browser/origins.ts` so that one wording serves the card, the receipt and
 * this view. `lib/copy/browser.ts` carries the rest.
 *
 * Nothing here reads a clock or performs a decision. It is a pure function of
 * rows `lib/browser/store.ts` returned, which is what lets
 * `tests/browser-view.test.ts` drive every shape including the ones a live run
 * is unlikely to produce.
 */

import {
  browserNotice,
  describeBlocked,
  describeBrowserRefusal,
  describeEnd,
  describeStop,
  type BrowserNotice,
} from "../copy/browser";
import { readBrowserDeclaration } from "../browser/declaration";
import { describeReach } from "../browser/origins";
import type { BrowserRefusal } from "../browser/protocol";
import {
  countBlockedRequests,
  listBrowserActions,
  listBrowserSessions,
  listSessionlessBrowserActions,
  type StoredBrowserAction,
} from "../browser/store";
import { readAgentManifest } from "../store";

/** One decided action, in the words a person reads. */
export interface BrowserActionView {
  /**
   * What was asked for, in plain language — never the operation id.
   *
   * `lib/copy/identifiers.ts`'s rule. The id is still in the table for anybody
   * investigating; what a person reads is what happened.
   */
  what: string;
  /** Allowed or refused, and the sentence when it was refused. */
  allowed: boolean;
  why: string | null;
  /** The origin DASH resolved, or null. Shown as a value, in the mono face. */
  origin: string | null;
  /** Where the view ended up. Origin and path; never a query string. */
  url: string | null;
  /** The frame file name, or null when DASH could not take one. */
  frame: string | null;
  at: string;
}

/** One session, past or present. */
export interface BrowserSessionView {
  session_id: string;
  run_id: string | null;
  /** The exact addresses this run was set up for. */
  declared_origins: string[];
  /** And the ones the browser actually reached. A subset, by construction. */
  visited_origins: string[];
  /** `describeReach`'s qualified sentence. Never a bare count. */
  reach: string;
  opened_at: string;
  /** Null while it is still open — which is what makes the Stop control live. */
  ended_at: string | null;
  /** Why it ended, in plain language, or null while it is open. */
  ended_because: string | null;
  /**
   * When this session first returned page content, or null.
   *
   * Rendered, because it is the moment the read-then-reach rule started
   * applying to the rest of the run: after it, a write or a spend needs a
   * person. A user who is asked to approve something later should be able to
   * find the reason on this screen.
   */
  first_read_at: string | null;
  actions: BrowserActionView[];
  /** How many requests the *page* made that DASH refused. Never the agent's. */
  blocked_count: number;
  blocked: string;
}

export interface BrowserView {
  agent: string;
  /**
   * What the agent's manifest asks for, or null when it asks for no browser.
   *
   * Null is the ordinary case and the surface renders nothing at all for it —
   * an agent that wants no browser should not have a browser panel explaining
   * that it has no browser.
   */
  declared: { purpose: string | null; origins: string[] } | null;
  /**
   * The declaration DASH refused, when there was one.
   *
   * Separate from `declared` being null, because they are different situations
   * with different next actions: one is an author who wants no browser, and one
   * is an author who typed an address DASH will not accept and needs telling
   * which.
   */
  refused_declaration: string | null;
  /** The open session, or null. Drives whether Stop is live. */
  open: BrowserSessionView | null;
  /** Finished sessions, newest first. */
  past: BrowserSessionView[];
  /**
   * Actions DASH decided before any browser existed (MAR-628).
   *
   * Almost always empty, and the exception is the single most interesting row
   * this system produces: an agent asking for an address the run was not set up
   * for is refused *before* a session opens, so it belongs to no session. It
   * had nowhere to render until the first real proof run noticed it had been
   * written and could not be seen.
   */
  refused_before_opening: BrowserActionView[];
  notice: BrowserNotice;
  stop: { label: string; meaning: string };
}

/**
 * What each operation did, in the words a person reads.
 *
 * A switch over ids rather than a label read off the operation, because the
 * operation's own `label` is written for a permission card — *"Open one web
 * page in the browser DASH is watching"* — and a trail wants the past tense of
 * what happened. An unknown id is the interesting case: it is an agent that
 * asked for something DASH does not build, and it renders verbatim so the row
 * says what was asked for rather than hiding it behind a generic sentence.
 */
function describeOperation(operation: string): string {
  switch (operation) {
    case "browser.open":
      return "Open a page";
    case "browser.read":
      return "Read the page";
    default:
      return `Asked for something DASH does not do: ${operation}`;
  }
}

function actionView(row: StoredBrowserAction): BrowserActionView {
  return {
    what: describeOperation(row.operation),
    allowed: row.decision === "allowed",
    why:
      row.decision === "allowed" || row.refusal === null
        ? null
        : describeBrowserRefusal(row.refusal as BrowserRefusal),
    origin: row.origin,
    url: row.url_after ?? row.url_before,
    frame: row.frame_after,
    at: row.decided_at,
  };
}

/**
 * Build one agent's browser view.
 *
 * `openSessionId` comes from the live controller in Electron main rather than
 * from the store, and the reason is worth stating: a session row has an
 * `ended_at` that is null both while it is open and when DASH was killed with
 * one open. Only the process holding the `WebContents` knows which — so an
 * abandoned row from a previous DASH renders as a finished session, and the Stop
 * control is live only for a browser that actually exists.
 */
export function browserView(agent: string, openSessionId: string | null): BrowserView {
  const declaration = readBrowserDeclaration(readAgentManifest(agent));

  const sessions = listBrowserSessions(agent).map((stored) => {
    const isOpen = stored.session_id === openSessionId;
    const blockedCount = countBlockedRequests(stored.session_id);
    const view: BrowserSessionView = {
      session_id: stored.session_id,
      run_id: stored.run_id,
      declared_origins: stored.declared_origins,
      visited_origins: stored.visited_origins,
      reach: describeReach(stored.declared_origins.length),
      opened_at: stored.opened_at,
      ended_at: isOpen ? null : (stored.ended_at ?? stored.opened_at),
      ended_because: isOpen
        ? null
        : stored.end_reason === null
          ? // A row whose session outlived the DASH that opened it. Said plainly
            // rather than guessed at, because the three real reasons are all
            // things DASH observed and this is the case where it observed none.
            "DASH closed while it was open, so there is no record of how it ended."
          : describeEnd(stored.end_reason),
      first_read_at: stored.first_read_at,
      actions: listBrowserActions(stored.session_id).map(actionView),
      blocked_count: blockedCount,
      blocked: describeBlocked(blockedCount),
    };
    return view;
  });

  return {
    agent,
    declared: declaration.ok
      ? { purpose: declaration.declaration.purpose, origins: [...declaration.declaration.origins] }
      : null,
    refused_declaration:
      declaration.ok || declaration.reason === "absent"
        ? null
        : describeDeclarationRefusal(declaration.refusal, declaration.value),
    open: sessions.find((session) => session.session_id === openSessionId) ?? null,
    past: sessions.filter((session) => session.session_id !== openSessionId),
    refused_before_opening: listSessionlessBrowserActions(agent).map(actionView),
    notice: browserNotice(),
    stop: describeStop(),
  };
}

/**
 * What a person reads when DASH would not accept an agent's address list.
 *
 * It names the value, because the author's next action is to fix that value and
 * a message that does not say which one sends them to read their whole
 * manifest. It is one of the few places in DASH where an identifier appears in a
 * sentence on purpose: the identifier *is* the finding.
 */
function describeDeclarationRefusal(refusal: string, value: string): string {
  switch (refusal) {
    case "not_https":
      return `This agent asks for ${value}, and DASH only opens https:// addresses.`;
    case "has_path":
      return (
        `This agent asks for ${value}. DASH needs the address of a website and not a page ` +
        "on it — everything after the host has to go."
      );
    case "has_credentials":
      return `This agent asks for an address with a username and password in it. DASH will not open one.`;
    case "too_many":
      return "This agent asks for more addresses than DASH will open for one run, or for none at all.";
    default:
      return `This agent asks for ${value}, which DASH could not read as a web address.`;
  }
}
