/**
 * The controlled browser, wired to the impure things it needs (MAR-628, ADR
 * 0019).
 *
 * `lib/browser/` decides everything and touches nothing. `electron/browser-view.ts`
 * is Chromium. This is the seam: the manifest read, the run lookup, the trail
 * writes, and the loop that moves requests one way and decisions the other.
 * `electron/broker-host.ts`'s shape, deliberately, because the two solve the
 * same transport problem and a second solution to it would be a second place
 * for the delivery bookkeeping to be wrong.
 *
 * ## Why this runs in Electron main and not in the runner
 *
 * Because the window does. A `WebContentsView` is attached to DASH's own
 * `BrowserWindow`, so the controller can only exist in the process that has one
 * — which turns *"a person can watch the actual page"* from a rule somebody must
 * follow into a fact about where the code can run. The runner relays; it never
 * holds a view, never attaches a debugger, and could not if it wanted to.
 *
 * The cost is the honest one and it is the broker's: **when DASH is not
 * running, the controlled browser is not running.** A hosted agent whose runtime
 * declares `continues_when_dash_closed` keeps working and its browser requests
 * stop being answered. That is the correct behaviour rather than a limitation to
 * design around, because the alternative is a browser navigating the web on
 * somebody's desktop with nobody watching it — which is the exact situation the
 * supervision surface exists to prevent.
 *
 * ## The one thing this file adds that the broker's does not
 *
 * `hostBrowserController().hasReadUntrusted(agent)` is handed to the broker, so
 * that a run which has read a web page cannot then write or spend without a
 * person. See `lib/browser/session.ts` for the rule and `lib/mcp/reach.ts` for
 * the four limits it inherits.
 */

import { localRunnerChannel } from "../lib/agent-dom/runner-channel";
import { declaredOriginsFor } from "../lib/browser/declaration";
import {
  encodeBrowserResponse,
  parseBrowserRequest,
  refuseBrowser,
  type BrowserResponse,
} from "../lib/browser/protocol";
import {
  createBrowserController,
  type BrowserController,
  type BrowserEndReason,
  type BrowserSession,
} from "../lib/browser/session";
import {
  recordBlockedRequest,
  recordBrowserAction,
  recordSessionOpened,
  recordSessionProgress,
} from "../lib/browser/store";
import { newestRunFor, readAgentManifest } from "../lib/store";
import {
  destroyBrowserSession,
  openBrowserSession,
  performBrowserGesture,
} from "./browser-view";
import { type RunnerHandle } from "./runner-process";

/** How often the controller looks for work when it just found some. */
export const BROWSER_BUSY_INTERVAL_MS = 200;
/** And when it did not. */
export const BROWSER_IDLE_INTERVAL_MS = 1_000;

interface DrainedRequest {
  agent_id: string;
  request: unknown;
}

let controller: BrowserController | null = null;

/**
 * Every session this process has opened, by id, so the trail writer can find one
 * from a `webRequest` callback that only knows a session id.
 *
 * The controller holds the same objects; this map exists because the blocked-request
 * path is called from Chromium's own callback, thousands of times for a busy
 * page, and walking the controller's agent map on each one to write a row would
 * put a linear scan inside a network hot path.
 */
const openSessions = new Map<string, BrowserSession>();

/**
 * The one controller in this process, made on first use.
 *
 * `hostBroker`'s argument, and it holds here for a sharper reason: the bounds in
 * `lib/browser/session.ts` are per-controller, so a second instance would be a
 * second rate limit and a second revocation ledger — and an agent whose Stop was
 * recorded on one of them while its requests were decided by the other is a Stop
 * button that does nothing.
 */
export function hostBrowserController(): BrowserController {
  if (controller !== null) {
    return controller;
  }
  controller = createBrowserController({
    declaredOrigins: (agentId: string) => declaredOriginsFor(readAgentManifest(agentId)),
    currentRun: (agentId: string) => newestRunFor(agentId),

    openSession: async (pending) => {
      const sessionId = await openBrowserSession(pending, (id, url, kind) => {
        const decided = controller?.noteRequest(id, url, kind) ?? false;
        const session = openSessions.get(id);
        if (session !== undefined && decided) {
          // Kept current while the session is open, so a person who opens DASH
          // mid-run sees where the browser has actually been rather than where
          // it started.
          recordSessionProgress(session);
        }
        return decided;
      });
      return sessionId;
    },

    sessionOpened: (session) => {
      openSessions.set(session.session_id, session);
      recordSessionOpened(session);
    },

    perform: (sessionId, gesture) => performBrowserGesture(sessionId, gesture),

    destroySession: async (sessionId) => {
      const session = openSessions.get(sessionId);
      if (session !== undefined) {
        recordSessionProgress(session);
        openSessions.delete(sessionId);
      }
      await destroyBrowserSession(sessionId);
    },

    audit: (row) => {
      recordBrowserAction(row);
      const session = openSessions.get(row.session_id);
      if (session !== undefined) {
        recordSessionProgress(session);
      }
    },

    auditBlocked: (row) => {
      recordBlockedRequest(row);
    },

    now: () => new Date(),
  });
  return controller;
}

/**
 * A person pressed Stop, or a run ended.
 *
 * Exported for `lib/shell/ipc.ts` and for the shutdown path in
 * `electron/main.ts`. There is deliberately no operation an agent can name that
 * reaches this — see `lib/browser/protocol.ts`, which has no `stop` and no
 * `close`.
 */
export async function revokeBrowser(agentId: string, reason: BrowserEndReason): Promise<void> {
  await hostBrowserController().revoke(agentId, reason);
}

/**
 * Start answering controlled-browser requests, returning a function that stops.
 *
 * A self-scheduling timeout rather than `setInterval`, for `startBroker`'s
 * reason: a slow pass must not overlap the next, and a page taking twenty
 * seconds to load would otherwise stack passes until something gave.
 */
export function startBrowserController(
  runner: RunnerHandle | null,
  log: (line: string) => void = (line) => {
    console.warn(line);
  },
): () => void {
  if (runner === null) {
    // No runner means no hosted agents means nothing to drain. It says nothing
    // about the controller itself, which `hostBrowserController` makes on demand
    // — the broker asks it about read-then-reach whether or not anything is
    // running.
    return () => undefined;
  }

  // A **broker-capable** channel, and the adjective carries the same weight it
  // does in `electron/broker-host.ts`: `BROWSER_ROUTES` is inside
  // `LocalRunnerChannel`'s brand and outside `RemoteRunnerChannel`'s parameter,
  // so `channel.call("/browser/drain")` on a host's channel is a compile error
  // at the call site. See `lib/agent-dom/runner-channel.ts` for why these two
  // routes are confined more tightly than the broker's, not less.
  const channel = localRunnerChannel(runner);
  const live = hostBrowserController();

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function pass(): Promise<boolean> {
    let drained: DrainedRequest[];
    try {
      const response = await channel.call("/browser/drain", {
        method: "POST",
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as { requests?: unknown; dropped?: unknown };
      if (typeof body.dropped === "number" && body.dropped > 0) {
        log(
          `[dash-shell] the runner dropped ${String(body.dropped)} browser ` +
            `request${body.dropped === 1 ? "" : "s"} before this pass; ` +
            `${body.dropped === 1 ? "that agent is" : "those agents are"} waiting for an answer that will not come`,
        );
      }
      drained = Array.isArray(body.requests) ? (body.requests as DrainedRequest[]) : [];
    } catch {
      // A runner that stopped answering is reported by the state poll, not by a
      // line on every tick of this one.
      return false;
    }

    if (drained.length === 0) {
      return false;
    }

    const answers: Array<{ agent_id: string; line: string }> = [];

    for (const candidate of drained) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        typeof candidate.agent_id !== "string" ||
        candidate.agent_id.length === 0
      ) {
        // No agent identity means no manifest to consult and nowhere to send an
        // answer. The runner attaches it from the child it read the line from,
        // so an envelope without one is a bug on that side rather than an
        // agent's doing — and it is refused rather than guessed at.
        log("[dash-shell] rejected a browser request envelope: no agent identity");
        continue;
      }

      const parsed = parseBrowserRequest(candidate.request);
      if (parsed === null) {
        // Deliberately unanswered. A malformed candidate has no request id, so
        // there is nothing to address a refusal to. The agent's own timeout
        // covers it.
        log(`[dash-shell] ${candidate.agent_id} sent a browser request DASH could not read`);
        continue;
      }

      let response: BrowserResponse;
      try {
        response = await live.handle(candidate.agent_id, parsed);
      } catch (error: unknown) {
        // An unexpected throw is DASH's bug. The agent still gets an answer,
        // because an agent blocked forever on a DASH bug is a worse outcome
        // than one told the browser failed — and the reason is logged here,
        // where a developer can see it, rather than crossing to the agent.
        log(
          `[dash-shell] the browser controller threw answering ${candidate.agent_id}: ` +
            `${error instanceof Error ? error.message : "unknown"}`,
        );
        response = refuseBrowser(parsed.request_id, "browser_error");
      }

      answers.push({ agent_id: candidate.agent_id, line: encodeBrowserResponse(response) });
    }

    if (answers.length > 0) {
      try {
        await channel.call("/browser/responses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ responses: answers }),
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        // The agents wait and time out. Nothing here is retried: a decision is
        // bound to a request id the agent has given up on by the time a retry
        // would arrive, and performing the navigation again to produce a fresh
        // one would be a second page load for a question nobody is still asking.
        //
        // Unlike a brokered answer this is not marked undelivered anywhere, and
        // the reason is that there is nothing to mark it *against* that a person
        // could not already see: the trail row for the decision is written, the
        // session is visible in DASH's own window, and the frame is on disk.
        // `broker_audit.delivered` exists because a brokered decision leaves no
        // other trace.
        log("[dash-shell] could not deliver browser decisions to the runner");
      }
    }

    return true;
  }

  const tick = (): void => {
    void pass()
      .catch(() => false)
      .then((busy) => {
        if (!stopped) {
          timer = setTimeout(tick, busy ? BROWSER_BUSY_INTERVAL_MS : BROWSER_IDLE_INTERVAL_MS);
          timer.unref?.();
        }
      });
  };

  tick();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
