/**
 * The controlled browser's decision layer: one session per run, an append-only
 * trail, and a Stop that means something (MAR-628, ADR 0019).
 *
 * `lib/browser/operations.ts` says what may be asked for and
 * `lib/browser/origins.ts` says where it may go. This is the module that holds
 * them together and decides one request at a time — the same split
 * `lib/broker/execute.ts` has from `lib/broker/operations.ts`, and for the same
 * reason: the decisions are worth testing without Electron, and the only way to
 * keep them that way is for the thing that performs to be injected.
 *
 * ## The order of the checks, and why it is this order
 *
 * 1. **Revoked** — before anything else, because a person pressing Stop must
 *    not be overtaken by a request already in flight. A revoked run refuses
 *    everything for as long as it lasts.
 * 2. **Duplicate request id** — before an operation is looked up, so a replayed
 *    line cannot cause a second navigation.
 * 3. **Rate limit** — before the manifest is consulted.
 * 4. **Operation exists** — before the declaration, because an operation nobody
 *    built can be refused without reading the agent's document.
 * 5. **The agent declares a browser** — the first thing that reads a manifest.
 * 6. **Input narrows to a gesture** — the operation's own validation.
 * 7. **Origin** — for a navigation, against the run's exact declared list.
 * 8. **Open the session if there is not one, perform, project.**
 *
 * Every one of them writes a trail row. A refusal that left no trace would make
 * the trail a log of successful page loads, which is the half nobody needs to
 * inspect afterwards.
 *
 * ## What the trail may honestly claim
 *
 * ADR 0019 is precise about this and the wording is load-bearing:
 *
 * > That is a record of **what DASH asked its browser to do**. It is not proof
 * > of what the website did with the event.
 *
 * So a row says which operation was requested, which origin DASH resolved,
 * which decision DASH took, where the view was before and after, and which
 * frame was captured. It does not say what the site did, whether a request was
 * processed, or whether anything was recorded at the other end. Revocation
 * destroys the session and refuses later commands; **it cannot recall a request
 * already sent**, and `lib/copy/browser.ts` says so on the surface rather than
 * leaving it to this comment.
 *
 * ## Read-then-reach
 *
 * A successful `browser.read` is a read of content DASH did not control, which
 * is exactly the first link of the chain `lib/mcp/reach.ts` describes. So a
 * successful read marks the session, `hasReadUntrusted` reports the mark, and
 * `electron/broker-host.ts` hands that answer to the broker — where any write
 * or spend for the same agent afterwards needs a person. The rule's four
 * limits are stated in `lib/mcp/reach.ts` and every one of them applies here
 * unchanged; the fifth, which is specific to this wiring, is on
 * `hasReadUntrusted` below.
 *
 * Nothing in this module performs I/O, opens a view, or reads a clock of its
 * own. The caller supplies the time and the three impure verbs, so
 * `tests/browser-session.test.ts` drives the whole thing deterministically.
 */

import {
  browserOperationById,
  projectReading,
  type BrowserGesture,
  type BrowserOperation,
  type PageReading,
} from "./operations";
import { decideRequest, trailUrl, type RequestKind } from "./origins";
import {
  fulfilBrowser,
  refuseBrowser,
  type BrowserRefusal,
  type BrowserRequest,
  type BrowserResponse,
} from "./protocol";

/* ---------------------------------------------------------------------- *
 * Bounds
 * ---------------------------------------------------------------------- */

/**
 * How many browser operations one agent may ask for in a window, and how wide
 * it is.
 *
 * `BROKER_CALLS_PER_WINDOW`'s argument, applied to page loads: an agent allowed
 * one article at a time is allowed a whole site given enough time, and the
 * difference between reading a citation and crawling a publisher is partly a
 * rate. Twelve a minute is more than a scout reading one article needs and far
 * less than a crawler wants, and exceeding it is a `rate_limited` row a person
 * can see in the trail.
 */
export const BROWSER_CALLS_PER_WINDOW = 12;
export const BROWSER_WINDOW_MS = 60_000;

/**
 * How many request ids one agent's controller remembers, for replay detection.
 *
 * Bounded, and the direction of the bound is the unsafe one, so it is stated:
 * a replay after this many intervening requests would not be caught. That is
 * acceptable here in a way it is not for a write, because every operation in
 * this slice is a read — replaying one costs a second page load, which the rate
 * limit already bounds and the trail already shows. The moment an operation
 * dispatches an input event it needs the durable check `lib/broker/execute.ts`
 * gives a write, and ADR 0019 amendment 1 records that as a precondition rather
 * than as a nicety.
 */
export const BROWSER_REPLAY_MEMORY = 256;

/* ---------------------------------------------------------------------- *
 * What a session is, and what the trail records
 * ---------------------------------------------------------------------- */

/** Why a session ended. Rendered, so the three are kept apart. */
export type BrowserEndReason =
  /** A person pressed Stop while it was open. */
  | "stopped_by_person"
  /** The agent said it was finished with it. */
  | "closed_by_agent"
  /** The run ended, or DASH is shutting down. */
  | "run_ended";

/**
 * One run's browser session, as DASH knows it.
 *
 * `session_id` is DASH's own and never an agent's: an agent has no field to
 * name a session in, which is what stops one agent's request reaching another
 * agent's view. See `lib/browser/protocol.ts`.
 */
export interface BrowserSession {
  agent: string;
  /** The run this session belongs to. Null when DASH could not observe one. */
  run_id: string | null;
  session_id: string;
  /** Exact origins, resolved from the manifest before the session opened. */
  declared_origins: readonly string[];
  opened_at: string;
  /** Origins the view actually reached, in the order they were first allowed. */
  visited_origins: string[];
  /** When this session first returned page content, or null. */
  first_read_at: string | null;
  ended_at: string | null;
  end_reason: BrowserEndReason | null;
}

/**
 * One decided action, append-only.
 *
 * The fields are ADR 0019's list, minus the ones this slice's catalogue cannot
 * produce. There is no `target` column and no `typed_value` column, because no
 * shipped operation resolves a target or supplies a value — a column that is
 * null in every row would be a column inviting a later reader to believe DASH
 * once recorded something it never did. Amendment 1 records that the first
 * input-dispatching operation adds them.
 */
export interface BrowserTrailRow {
  agent: string;
  run_id: string | null;
  session_id: string;
  request_id: string;
  /** The operation the agent named, verbatim, even when DASH has no such one. */
  operation: string;
  decision: "allowed" | "refused";
  refusal: BrowserRefusal | null;
  /** The origin DASH resolved for this action, or null when there was none. */
  origin: string | null;
  /** Where the view was before, origin and path only. See `trailUrl`. */
  url_before: string | null;
  /** And where it ended up, which for a redirect is not where it was sent. */
  url_after: string | null;
  /**
   * The frame captured after the action, as a file name in the run's folder.
   *
   * **After only, where ADR 0019 asks for before and after.** The deferral is
   * argued in amendment 1 rather than left as a silent shortfall, and the short
   * version is that the frame *pair* exists over there to evidence what a
   * gesture landed on — a state a later screenshot cannot recover. No operation
   * in this slice's catalogue dispatches an input event, so the state before an
   * action is fully described by `url_before`, and a second screenshot of a page
   * nothing was aimed at would double the capture cost for no evidentiary gain.
   * The first operation that clicks brings the before-frame with it.
   */
  frame_after: string | null;
  decided_at: string;
}

/**
 * One request the controlled browser was about to make and DASH refused
 * (MAR-628).
 *
 * Its own shape rather than a `BrowserTrailRow` with empty fields, on
 * `broker_lapses`' terms: **there is no request id, no operation and no
 * decision column here, because the agent asked for none of this.** A page
 * chose it — a script, a font, a redirect — and DASH stopped it. Giving it the
 * columns of an adjudication would let a careless join present a font request
 * as something an agent did.
 */
export interface BlockedRequestRow {
  agent: string;
  session_id: string;
  kind: RequestKind;
  /** The refused origin, or a scheme like `data:` when there was no origin. */
  origin: string | null;
  reason: "unreadable_url" | "not_https" | "origin_not_declared";
  blocked_at: string;
}

/* ---------------------------------------------------------------------- *
 * What the controller needs from the outside world
 * ---------------------------------------------------------------------- */

/** What performing a gesture turned into. Three outcomes, three trail rows. */
export type PerformResult =
  | { ok: true; reading: PageReading; frame: string | null }
  /** Chromium would not load it, or the load did not finish. */
  | { ok: false; refusal: "page_unavailable" }
  /**
   * A redirect, a window.location or a meta refresh took the view somewhere the
   * run did not declare. The controller stopped it; this is DASH reporting
   * that the destination changed under it.
   */
  | { ok: false; refusal: "origin_not_allowed"; origin: string | null };

export interface BrowserControllerDeps {
  /**
   * The origins this agent's manifest declares, or null when it declares no
   * browser at all.
   *
   * Injected rather than read here for `BrokerDeps.readManifest`'s reason:
   * `lib/browser/` touches no store, which is what lets the whole decision layer
   * be driven by a test with no database and no Electron.
   */
  declaredOrigins(agentId: string): readonly string[] | null;
  /** Which run this agent is in, or null when DASH cannot observe one. */
  currentRun(agentId: string): string | null;
  /**
   * Create the real view: one ephemeral session partition, attached to DASH's
   * window, with popups, downloads, permissions, new windows and every
   * non-HTTPS protocol denied.
   *
   * Returns DASH's own session id. It is the one impure verb that must not be
   * reachable except through a request that has already survived every check
   * above it, which is why it is called at step 8 and not at step 1.
   */
  openSession(session: Omit<BrowserSession, "session_id">): Promise<string>;
  /**
   * A session now exists, with the id `openSession` minted.
   *
   * Separate from `openSession` because that one is called before the
   * controller has assembled the whole `BrowserSession` — it mints an id and
   * the controller adds it — and the receipt has to carry the id the trail rows
   * point at.
   *
   * **Called by the controller and by nothing else**, which is the correction
   * MAR-628's first proof run forced. The session row was originally written by
   * the drain loop in `electron/browser-host.ts`, which is the *transport*: any
   * other caller of `handle` produced action rows whose session had no row, and
   * `browserView` lists sessions and then their actions, so the whole trail
   * rendered as nothing at all. A receipt written by whoever happened to deliver
   * the request is a receipt with a caller-shaped hole in it.
   */
  sessionOpened(session: BrowserSession): void;
  /** Perform one gesture in the open session. */
  perform(sessionId: string, gesture: BrowserGesture): Promise<PerformResult>;
  /**
   * Destroy the view and its partition.
   *
   * Called on Stop, on the agent's own close, and when a run ends. It is what
   * makes `revoked` mean the session is gone rather than paused — and ADR 0019
   * requires the surface to say what it still cannot do, which is unsend a
   * request that already left.
   */
  destroySession(sessionId: string): Promise<void>;
  /** Record one decided action. Called exactly once per request, on every path. */
  audit(row: BrowserTrailRow): void;
  /** Record one request a page made and DASH refused. */
  auditBlocked(row: BlockedRequestRow): void;
  now(): Date;
}

interface AgentState {
  session: BrowserSession | null;
  /**
   * Revoked until the run changes.
   *
   * The run id a person pressed Stop during, so that a later run of the same
   * agent is not punished for it. Null means nothing is revoked.
   */
  revoked_run: string | null;
  /** True when Stop was pressed outside any run DASH could observe. */
  revoked_without_run: boolean;
  seen: string[];
  seenSet: Set<string>;
  calls: number[];
  /**
   * The run in which this agent last read page content, or null.
   *
   * Kept beside the session rather than inside it because it must outlive the
   * session: closing the browser does not un-read the article, and the whole
   * point of the read-then-reach rule is that what the agent learned is still
   * in its head afterwards. See `hasReadUntrusted`.
   */
  read_untrusted_run: string | null;
  read_untrusted_at: string | null;
}

export interface BrowserController {
  handle(agentId: string, request: BrowserRequest): Promise<BrowserResponse>;
  /**
   * A person pressed Stop.
   *
   * Destroys the session and refuses every later command for this run. It is
   * deliberately not a method an agent can reach: `lib/browser/protocol.ts` has
   * no operation for it, so the only callers are DASH's own IPC handler and the
   * run-ended path.
   */
  revoke(agentId: string, reason: BrowserEndReason): Promise<void>;
  /**
   * Every open session, destroyed.
   *
   * The quit path. It exists as its own method rather than as a loop at the
   * call site because the call site is `before-quit`, where the window is about
   * to go and getting the iteration wrong means a view that outlives the surface
   * justifying it. `reason` is passed through so the trail says the run ended
   * rather than that somebody pressed a button nobody pressed.
   */
  revokeEverything(reason: BrowserEndReason): Promise<void>;
  /** One request a page made, decided against the session's origins. */
  noteRequest(sessionId: string, url: string, kind: RequestKind): boolean;
  /** The open session for an agent, for the supervision surface. */
  sessionFor(agentId: string): BrowserSession | null;
  /**
   * Whether this agent has read page content in the run it is in now
   * (MAR-628, ADR 0020's rule).
   *
   * The answer `electron/broker-host.ts` hands the broker, and the reason a
   * browsed read makes the same run's writes and spends need a person.
   *
   * **The fifth limit, which is this wiring's own.** `lib/mcp/reach.ts` keys its
   * ledger by run id because every MCP call arrives inside one. A brokered call
   * does not carry a run id at all — `BrokerRequest` has no field for one and
   * adding one would let an agent assert which run it was in. So the mark is
   * keyed by agent and compared against the run DASH believes the agent is in
   * now. Where DASH can observe no run, the mark stands until the agent's next
   * observed run begins, which errs towards asking a person more often rather
   * than less.
   */
  hasReadUntrusted(agentId: string): boolean;
}

let sessionCounter = 0;

export function createBrowserController(deps: BrowserControllerDeps): BrowserController {
  const agents = new Map<string, AgentState>();
  /** Reverse index, so a `webRequest` callback can find the run it is inside. */
  const bySession = new Map<string, string>();

  function stateFor(agentId: string): AgentState {
    let state = agents.get(agentId);
    if (state === undefined) {
      state = {
        session: null,
        revoked_run: null,
        revoked_without_run: false,
        seen: [],
        seenSet: new Set(),
        calls: [],
        read_untrusted_run: null,
        read_untrusted_at: null,
      };
      agents.set(agentId, state);
    }
    return state;
  }

  async function end(
    agentId: string,
    state: AgentState,
    reason: BrowserEndReason,
  ): Promise<void> {
    const session = state.session;
    if (session === null) {
      return;
    }
    state.session = null;
    bySession.delete(session.session_id);
    session.ended_at = deps.now().toISOString();
    session.end_reason = reason;
    // Destroyed even if this throws on the way out: a view DASH has stopped
    // tracking but not destroyed is the one failure mode a Stop control must
    // not have. The error is swallowed rather than surfaced because the
    // caller's next move is identical either way.
    try {
      await deps.destroySession(session.session_id);
    } catch {
      // Nothing to recover. `electron/browser-view.ts` logs its own failure.
    }
  }

  return {
    sessionFor(agentId: string): BrowserSession | null {
      return agents.get(agentId)?.session ?? null;
    },

    hasReadUntrusted(agentId: string): boolean {
      const state = agents.get(agentId);
      // `read_untrusted_at` is the mark and `read_untrusted_run` is only *where*
      // it was taken. Testing the run for the mark's existence was this
      // function's first bug: a read during a run DASH could not observe sets
      // the run to null, which read as "never read anything" — the loosest
      // possible answer in exactly the situation with the least supervision.
      if (state === undefined || state.read_untrusted_at === null) {
        return false;
      }
      // A mark whose own run is unknown holds until something better is known,
      // and so does a mark checked at a moment when DASH can observe no run.
      // Both are the tight direction: they ask a person more often rather than
      // less, which is the only side of this rule it is safe to be wrong on.
      const run = deps.currentRun(agentId);
      if (state.read_untrusted_run === null || run === null) {
        return true;
      }
      // A mark from a run that has demonstrably been replaced by another does
      // not hold. That is the per-run boundary, arrived at with the only run
      // identity this side of the wiring has.
      return state.read_untrusted_run === run;
    },

    async revoke(agentId: string, reason: BrowserEndReason): Promise<void> {
      const state = stateFor(agentId);
      const run = state.session?.run_id ?? deps.currentRun(agentId);
      if (reason === "stopped_by_person") {
        if (run === null) {
          state.revoked_without_run = true;
        } else {
          state.revoked_run = run;
        }
      }
      await end(agentId, state, reason);
    },

    async revokeEverything(reason: BrowserEndReason): Promise<void> {
      // The keys are copied before the loop, because `end` mutates the state it
      // finds and a destroy that throws must not leave the rest of the map
      // untouched. Sequential rather than concurrent: these are Chromium
      // teardowns during quit, and doing them one at a time is the version whose
      // failure mode is "slow" rather than "raced".
      for (const agentId of [...agents.keys()]) {
        await end(agentId, stateFor(agentId), reason);
      }
    },

    noteRequest(sessionId: string, url: string, kind: RequestKind): boolean {
      const agentId = bySession.get(sessionId);
      const session = agentId === undefined ? null : agents.get(agentId)?.session ?? null;
      if (session === null || session.session_id !== sessionId) {
        // A request from a session DASH has stopped tracking. Refused, which is
        // the safe direction: the alternative is a view whose teardown raced a
        // load and got to finish it.
        return false;
      }
      const decision = decideRequest(session.declared_origins, url, kind);
      if (!decision.allowed) {
        deps.auditBlocked({
          agent: session.agent,
          session_id: sessionId,
          kind,
          origin: decision.origin,
          reason: decision.reason,
          blocked_at: deps.now().toISOString(),
        });
        return false;
      }
      if (!session.visited_origins.includes(decision.origin)) {
        session.visited_origins.push(decision.origin);
      }
      return true;
    },

    async handle(agentId: string, request: BrowserRequest): Promise<BrowserResponse> {
      const decidedAt = deps.now();
      const startedAt = decidedAt.getTime();
      const state = stateFor(agentId);
      const run = deps.currentRun(agentId);
      const urlBefore = state.session === null ? null : lastUrl(state.session);

      /** One exit. Every refusal goes through here, so every one is in the trail. */
      const no = (refusal: BrowserRefusal, origin: string | null = null): BrowserResponse => {
        deps.audit({
          agent: agentId,
          run_id: run,
          session_id: state.session?.session_id ?? "",
          request_id: request.request_id,
          operation: request.operation,
          decision: "refused",
          refusal,
          origin,
          url_before: urlBefore,
          url_after: urlBefore,
          frame_after: null,
          decided_at: decidedAt.toISOString(),
        });
        return refuseBrowser(request.request_id, refusal);
      };

      /* 1. Revoked. Before anything, so a Stop is not overtaken by a request
         already on the wire. */
      if (state.revoked_without_run || (run !== null && state.revoked_run === run)) {
        return no("revoked");
      }

      /* 2. Replay. Before an operation is looked up, so a repeated line cannot
         cause a second page load. */
      if (state.seenSet.has(request.request_id)) {
        return no("duplicate_request");
      }

      /* 3. Rate. Counted on the attempt rather than on success, for
         `budget.calls`' reason in the broker: a refused request still cost the
         controller work, and not counting refusals leaves a way to probe the
         origin list as fast as the pipe allows. */
      const windowStart = startedAt - BROWSER_WINDOW_MS;
      state.calls = state.calls.filter((at) => at > windowStart);
      if (state.calls.length >= BROWSER_CALLS_PER_WINDOW) {
        return no("rate_limited");
      }
      state.calls.push(startedAt);

      state.seenSet.add(request.request_id);
      state.seen.push(request.request_id);
      if (state.seen.length > BROWSER_REPLAY_MEMORY) {
        const evicted = state.seen.shift();
        if (evicted !== undefined) {
          state.seenSet.delete(evicted);
        }
      }

      /* 4. Does this operation exist at all? Where `browser.click`,
         `browser.type` and `browser.evaluate` land, whatever a page persuaded
         an agent to ask for. */
      const operation = browserOperationById(request.operation);
      if (operation === null) {
        return no("unknown_operation");
      }

      /* 5. Does this agent declare a browser? The first manifest read. */
      const declared = deps.declaredOrigins(agentId);
      if (declared === null || declared.length === 0) {
        return no("browser_not_declared");
      }

      /* 6. The typed input. */
      const resolved = operation.resolve(request.input);
      if (!resolved.ok) {
        return no("invalid_input");
      }

      /* 7. The origin, for anything that navigates. Exact, and against the run's
         own list — not a prefix, and not the origin the view happens to be on. */
      let origin: string | null = null;
      if (resolved.gesture.kind === "navigate") {
        const decision = decideRequest(declared, resolved.gesture.url, "top_level");
        if (!decision.allowed) {
          return no("origin_not_allowed", decision.origin);
        }
        origin = decision.origin;
      } else if (state.session === null) {
        // A read with nothing open. Refused rather than opening a session,
        // because "read the page" with no page is a question about a document
        // that does not exist, and opening one to answer it would put DASH's
        // browser somewhere nobody asked for.
        return no("no_session");
      } else {
        origin = state.session.visited_origins[state.session.visited_origins.length - 1] ?? null;
      }

      /* 8. Open if needed, perform, project. */
      if (state.session === null) {
        const pending: Omit<BrowserSession, "session_id"> = {
          agent: agentId,
          run_id: run,
          declared_origins: declared,
          opened_at: decidedAt.toISOString(),
          visited_origins: [],
          first_read_at: null,
          ended_at: null,
          end_reason: null,
        };
        let sessionId: string;
        try {
          sessionId = await deps.openSession(pending);
        } catch {
          return no("browser_error", origin);
        }
        state.session = { ...pending, session_id: sessionId };
        bySession.set(sessionId, agentId);
        // The receipt, written by the controller at the one moment a session
        // comes into being — see `sessionOpened` for why it is not the
        // transport's job.
        deps.sessionOpened(state.session);
      }
      const session = state.session;

      let performed: PerformResult;
      try {
        performed = await deps.perform(session.session_id, resolved.gesture);
      } catch {
        // A throw out of Electron is DASH's bug, not the agent's, and the agent
        // still gets an answer — an agent blocked forever on a DASH bug is a
        // worse outcome than one told the browser failed.
        return no("browser_error", origin);
      }

      if (!performed.ok) {
        return no(
          performed.refusal,
          performed.refusal === "origin_not_allowed" ? performed.origin : origin,
        );
      }

      const after = trailUrl(performed.reading.url);
      if (origin !== null && !session.visited_origins.includes(origin)) {
        session.visited_origins.push(origin);
      }

      // The mark, and only on a read that actually returned content. A
      // navigation returns a destination and a title; a `read` returns the
      // words on the page, which is the thing the rule is about.
      if (resolved.gesture.kind === "read_page") {
        session.first_read_at ??= decidedAt.toISOString();
        state.read_untrusted_run = run;
        state.read_untrusted_at ??= decidedAt.toISOString();
      }

      deps.audit({
        agent: agentId,
        run_id: run,
        session_id: session.session_id,
        request_id: request.request_id,
        operation: operation.id,
        decision: "allowed",
        refusal: null,
        origin,
        url_before: urlBefore,
        url_after: after,
        frame_after: performed.frame,
        decided_at: decidedAt.toISOString(),
      });

      return fulfilBrowser(request.request_id, projectReading(operation, performed.reading));
    },
  };
}

/** Where the view was, as the trail last saw it. Origin only; there is no path yet. */
function lastUrl(session: BrowserSession): string | null {
  return session.visited_origins[session.visited_origins.length - 1] ?? null;
}

/**
 * A session id DASH minted.
 *
 * Exported so `electron/browser-view.ts` and the tests mint them the same way.
 * Monotonic within a process rather than random: it is written into a trail and
 * a frame's file name, and a value a person may have to match across two
 * surfaces is better readable than unguessable — there is nothing to guess,
 * because an agent has no field to name a session in.
 */
export function mintSessionId(): string {
  sessionCounter += 1;
  return `bs-${String(sessionCounter)}`;
}
