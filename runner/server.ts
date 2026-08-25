/**
 * The runner's HTTP surface: the contract's transport profile v0, served.
 *
 * ```
 * GET  /agents/{id}            one Agent DOM state snapshot
 * POST /agents/{id}/commands   one command envelope
 * POST /agents/{id}/lifecycle  start or stop the agent's process
 * POST /telemetry/drain        hosted-agent event candidates since the last poll
 * POST /artifacts/drain        hosted-agent artifact candidates since the last poll
 * GET  /health                 what this runner is supervising
 * POST /store/retire           set a damaged store aside and open a fresh one
 * ```
 *
 * ## When the runner's own records cannot be read (MAR-506)
 *
 * Every route below `/health`, `/shutdown` and `/store/retire` reaches for the
 * store, so when the store is damaged they answer one shape — 503 with
 * `reason: "store_damaged"` — rather than the 500 a thrown query used to
 * produce. `runner/store-damage.ts` explains why detection at open is not
 * enough on its own and why this is checked twice.
 *
 * The first two are the profile verbatim, which is what makes a runner-hosted
 * agent and a remote one reachable by the same adapter: DASH hands the adapter
 * a control location either way, and `lib/agent-dom/transport.ts` neither knows
 * nor cares that this one arrives down a socket rather than over a network.
 *
 * **`/lifecycle` is deliberately not a command.** `start` and `stop` are not in
 * the contract's seven verbs, and `docs/agent-command-channel.md` explains at
 * length why inventing them would be dishonest: they act on a process, not on a
 * run, and no manifest can declare them. So they get a different route, a
 * different request shape and a different audit path, and nothing about them
 * touches the envelope machinery.
 *
 * ## The posture
 *
 * - **No port at all.** Since MAR-430 the listener is a Unix socket or a
 *   Windows named pipe, so the endpoint is not reachable by every process on
 *   the machine the way a loopback port is. `runner/endpoint.ts` owns that and
 *   documents what each platform does and does not enforce.
 * - **Bearer token, compared in constant time.** The credential survives the
 *   move: OS access control is the first gate and this is the second, and on
 *   Windows the second is the one this project can both set and verify. A naive
 *   `===` on a secret leaks its prefix to anyone who can time requests.
 * - **Bounded bodies.** An unbounded read on a local port is a denial of
 *   service any local process can perform.
 * - **The token is never logged**, and neither is a request body: an envelope
 *   carries the user's free-text approval reason.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";

import { validateState } from "../lib/contracts";
import { executeCommand, type ChannelPrincipal } from "./execute";
import { RUNNER_BUILD_ID, RUNNER_PROTOCOL_VERSION } from "./identity";
import {
  STORE_DAMAGED_REASON,
  classifyStoreError,
  type RunnerStoreDamage,
} from "./store-damage";
import type { ChiefBridgeConfiguration } from "./chief";
import type { ChiefAuditRow } from "./chief-broker";
import type { NotifyConfiguration } from "./notify";
import type { ScheduleConfiguration, ScheduledAllowance } from "./schedule";
import type { AgentSchedule, ScheduleSettlement } from "../lib/schedule/plan";
import { allowanceCalls, isLocalTime } from "../lib/schedule/plan";
import { buildAgentDomState, type ProcessReport } from "./state";
import type { AdoptionResult, Supervisor } from "./supervisor";
import type { TaskWorkspaceApi } from "./task-api";

/** Generous for an envelope, far too small to be a useful memory attack. */
export const MAX_REQUEST_BYTES = 262_144;

export interface ReloadSummary extends AdoptionResult {
  /** Registration files that could not be used, by file name and why. */
  skipped: Array<{ file: string; problem: string }>;
}

export interface RunnerServerOptions {
  supervisor: Supervisor;
  /**
   * The open store, or nothing when it is damaged (MAR-506).
   *
   * A value on the ordinary path and a function on the standalone runner's,
   * because the answer changes: `POST /store/retire` sets a damaged file aside
   * and opens a fresh one, and a server holding the handle it was constructed
   * with would be a server whose repair repaired nothing until a restart.
   *
   * Absent rather than a closed handle: a caller that has been told its
   * database is unusable must not be given one that merely throws later.
   */
  database?: DatabaseSync | (() => DatabaseSync | null);
  /** The channel credential. Compared, never logged, never echoed. */
  token: string;
  principal: ChannelPrincipal;
  /**
   * Re-read the registration directory (MAR-428).
   *
   * Injected rather than done here because this module has no idea where the
   * data directory is, and should not: it serves a supervisor it was handed.
   * Absent means the route answers 501 rather than pretending to have reloaded,
   * which keeps a runner built without it honest instead of silently useless.
   */
  reload?: () => ReloadSummary;
  /**
   * The task workspace (MAR-434), when this runner has one.
   *
   * Optional for the reason `reload` is: absent means the routes answer 501
   * rather than pretending, which keeps a runner built without a data directory
   * honest instead of silently accepting files it has nowhere to put.
   *
   * A function for the reason `database` is one (MAR-506): the workspace is
   * built on the store, so retiring a damaged store replaces it.
   */
  workspace?: TaskWorkspaceApi | (() => TaskWorkspaceApi | undefined);
  /**
   * Take, replace or clear the Discord channel this runner posts to (MAR-588).
   *
   * Optional for the reason `reload` and `workspace` are: a runner built without
   * one answers 501 rather than reporting a channel configured that nothing will
   * ever post to. In practice `runner/main.ts` always supplies it — the notifier
   * costs nothing until DASH hands it an address.
   */
  configureNotifier?: (configuration: NotifyConfiguration | null) => void;
  /**
   * Take, replace or clear the chief's Discord bridge (MAR-743, ADR 0028).
   *
   * `configureNotifier`'s neighbour and its shape, carrying more: the notifier's
   * credential can only post, and this one can also *spend*. Everything that
   * follows from that is in `runner/chief.ts` and `runner/chief-broker.ts`; what
   * this option is, is the one door it comes through.
   */
  configureChief?: (configuration: ChiefBridgeConfiguration | null) => void;
  /**
   * Everything the chief did while DASH was closed, and forget it (ADR 0028
   * decision 6).
   *
   * `drainTelemetry`'s shape exactly. The runner cannot write `chief_messages`
   * or `broker_audit` — one writer on `dash.sqlite`, ADR 0027 — so it spools and
   * DASH pulls.
   */
  drainChief?: () => { turns: unknown[]; audit: ChiefAuditRow[] };
  /**
   * What the runner currently holds for the chief, and never the credentials
   * that let it answer (MAR-745).
   *
   * The read side of `configureChief`, on the same authenticated channel. It
   * exists because the push in `configureChief` can fail silently — the runner
   * was down, the request raced a restart — and a settings row with no way to
   * ask the runner what it actually has is a settings row a person has to take
   * on faith. `RunnerChief.describe` is the one function that can answer this
   * without touching the token or the model key it holds.
   */
  describeChief?: () => {
    configured: boolean;
    connected: boolean;
    snapshot_at: string | null;
    fleet_count: number;
    model: { provider_id: string; model_id: string; label: string } | null;
  };
  /**
   * Take the whole set of schedules DASH holds (MAR-742 item 8, ADR 0029).
   *
   * `configureNotifier`'s and `configureChief`'s seam, and their reason: the
   * runner is what fires, so it is what has to hold the instruction — a process
   * that had to ask something else at 03:00 could not fire at all.
   *
   * Unlike those two, **nothing that arrives here is a credential.** A schedule
   * is an agent id, a time of day and a flag, which is configuration a person is
   * entitled to read back off their own page. So this route may say how many it
   * took, where `POST /chief/discord` may only say that it took something.
   *
   * The push is the **whole set every time**, including the disabled rows. ADR
   * 0029 decision 2: an incremental push needs a closed list of every event that
   * must fire one, and MAR-745 is what happens when that list is one event short.
   */
  configureSchedules?: (configuration: ScheduleConfiguration) => void;
  /** What the scheduler settled while DASH was closed (ADR 0029 decision 8). */
  drainSchedules?: () => ScheduleSettlement[];
  /**
   * Which scheduled fires are still inside their ceiling (MAR-784).
   *
   * Read on the broker drain rather than drained, and the difference is the
   * point: a drain empties a queue, and this is a *standing* fact for as long as
   * the window lasts. DASH may poll twice inside one allowance and must get the
   * same answer both times — with the same `fire_id`, which is what lets it open
   * the ceiling exactly once. See `ScheduledAllowance`.
   *
   * Absent on a runner built without a scheduler, where the honest answer is an
   * empty list rather than a missing field: a reader must never have to decide
   * whether "no allowances" and "this runner cannot say" are different.
   */
  scheduledAllowances?: () => ScheduledAllowance[];
  /** Graceful process shutdown, supplied only by the standalone runner. */
  shutdown?: () => void;
  /**
   * A person pressed Run on this host, so the host broker may spend (MAR-629,
   * ADR 0016 via ADR 0021).
   *
   * Supplied only when this runner has a host broker, which is only on a machine
   * enrolled with a pack. Absent means there is nothing on this machine that
   * could spend, so there is nothing to open.
   *
   * The mirror of `electron/main.ts`'s one line, and it exists because that line
   * opens the *local* allowance — which is the one the host cannot spend. ADR
   * 0021 section 2: *"The host broker needs its own allowance, opened by the
   * same press, on the machine that will spend."*
   */
  allowRunSpend?: (agentId: string, at: Date) => void;
  /**
   * Whether the runner's own store is unusable, asked on every request
   * (MAR-506).
   *
   * A function rather than a value because the answer changes: `POST
   * /store/retire` sets the damaged file aside and the runner comes back. A
   * captured boolean would leave a repaired runner refusing every route until
   * it was restarted, which is a repair that does not repair anything.
   */
  storeDamage?: () => RunnerStoreDamage | null;
  /**
   * Set the damaged store aside so a fresh one can be created (MAR-506).
   *
   * Supplied only by the standalone runner, for the same reason `reload` and
   * `shutdown` are: this module serves what it was handed and has no idea where
   * the data directory is. Absent answers 501 rather than pretending.
   */
  retireStore?: () => Promise<StoreRetirement> | StoreRetirement;
  /**
   * Damage this server classified while handling a request (MAR-520).
   *
   * MAR-506 built two detections on purpose, because the open-time probe cannot
   * be complete. Only one of them was wired to anything. The runtime half below
   * turned a throw into the right *answer* — `sendStoreDamaged` rather than a
   * 500 — and then dropped the finding on the floor, so the runner's own
   * `storeDamage()` kept saying null and `POST /store/retire` kept replying
   * "There is nothing to set aside." to a user looking at a page that had just
   * told them their records were damaged and offered to set them aside.
   *
   * That is the case that actually happened: the damaged store on this
   * machine's installed data directory passed `quick_check` at open and threw
   * on twelve subsequent requests, so the open-time probe never fired once and
   * the repair was unreachable through the only route a person has.
   *
   * Optional for the same reason the others are — this module serves what it is
   * handed — and a runner that supplies no callback keeps the previous
   * behaviour, which is a 503 with the right words and no repair.
   */
  onStoreDamage?: (damage: RunnerStoreDamage) => void;
  now?: () => Date;
  log?: (line: string) => void;
}

/** What `POST /store/retire` reports back. */
export type StoreRetirement =
  | { ok: true; moved_to: string; moved: number }
  | { ok: false; detail: string };

export function createRunnerServer(options: RunnerServerOptions): Server {
  const log = options.log ?? ((line: string) => { console.warn(line); });

  return createServer((request, response) => {
    void handle(request, response, options, log).catch((error: unknown) => {
      // A thrown handler must not take the runner down or hang the caller.
      log(`[runner] request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (response.headersSent) {
        return;
      }
      /*
       * MAR-506. The open-time probe cannot be complete — a store can pass
       * `quick_check` and then throw when a write reaches the page that is
       * going — so the same classification runs here, on whatever a route
       * threw. This is the line that used to produce the 500 the user was
       * shown, and it is the reason detection at open was not enough on its
       * own.
       */
      const damage = classifyStoreError(error);
      if (damage !== null) {
        // MAR-520. Reported to the runner before it is reported to the caller,
        // so that by the time the user reads "your records are damaged" and
        // presses the button beside it, the repair that button reaches knows
        // there is something to repair.
        options.onStoreDamage?.(damage);
        sendStoreDamaged(response, damage);
        return;
      }
      send(response, 500, { ok: false, detail: "The runner failed to handle the request." });
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: RunnerServerOptions,
  log: (line: string) => void,
): Promise<void> {
  if (!isLocalPeer(request)) {
    // Belt and braces with the endpoint. A runner that ever grows a
    // non-loopback listener must not silently become reachable.
    send(response, 403, { ok: false, detail: "The runner accepts local connections only." });
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

  const damage = options.storeDamage?.() ?? null;
  // Resolved once per request rather than captured at construction: both of
  // these change when a damaged store is retired (MAR-506).
  const liveWorkspace =
    typeof options.workspace === "function" ? options.workspace() : options.workspace;

  // `/health` is the only unauthenticated route, and it says nothing an
  // unauthenticated caller could not learn by looking at the process list.
  //
  // MAR-506 adds `store_damaged` to it, which stays inside that rule: it is a
  // liveness fact about this process, in the same category as how many agents
  // it is supervising, and it carries no path and no detail. The classification
  // itself is authenticated, below.
  if (request.method === "GET" && segments.length === 1 && segments[0] === "health") {
    send(response, 200, {
      ok: damage === null,
      store_damaged: damage !== null,
      supervising: options.supervisor.list().length,
      runner_protocol: RUNNER_PROTOCOL_VERSION,
      runner_build: RUNNER_BUILD_ID,
    });
    return;
  }

  if (!isAuthorized(request, options.token)) {
    // No detail about why. A caller learning "the token was the right length"
    // is a caller learning something.
    send(response, 401, { ok: false, detail: "Unauthorized." });
    return;
  }

  // POST /shutdown — graceful owner-requested shutdown over the same protected
  // local channel. On Windows `process.kill(pid, "SIGTERM")` is implemented as
  // TerminateProcess and skips SQLite close/checkpoint entirely; this route is
  // the portable way to let the runner stop agents, close its server and close
  // its store in the order `runner/main.ts` owns.
  if (request.method === "POST" && segments.length === 1 && segments[0] === "shutdown") {
    if (options.shutdown === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner cannot shut down through its control channel.",
      });
      return;
    }
    send(response, 202, { ok: true, detail: "The runner is shutting down gracefully." });
    setImmediate(options.shutdown);
    return;
  }

  // POST /store/retire — set a damaged store aside so a fresh one can be made
  // (MAR-506). The one repair DASH can offer for a fault the user did not
  // cause, and the reason `describeRunnerStoreDamage`'s next action is an
  // action rather than "report this".
  //
  // Above the damage guard, obviously — it is the route that exists because of
  // it — but *below* the authentication check, which is the interesting
  // ordering. This deletes nothing and renames a file inside DASH's own data
  // directory, and it is still not something an unauthenticated local caller
  // gets to trigger: a runner that could be made to abandon its replay records
  // by anybody who could reach its socket would have a way to make a
  // once-executed command executable again.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "store" &&
    segments[1] === "retire"
  ) {
    if (options.retireStore === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner cannot set its store aside through its control channel.",
      });
      return;
    }
    if (damage === null) {
      // Refused rather than performed. Retiring a healthy store would throw
      // away the replay records and the approval decisions of a runner that was
      // working, in response to a request that can only have been a mistake.
      send(response, 409, {
        ok: false,
        detail: "The runner's records are readable, so there is nothing to set aside.",
      });
      return;
    }
    const outcome = await options.retireStore();
    send(response, outcome.ok ? 200 : 500, { ...outcome });
    log(
      outcome.ok
        ? `[runner] store retired to ${outcome.moved_to} (${String(outcome.moved)} file(s))`
        : `[runner] store could not be retired: ${outcome.detail}`,
    );
    return;
  }

  /*
   * MAR-506. Everything below this line reaches for the store, and the store
   * cannot answer.
   *
   * 503 rather than 500, and a typed body rather than a sentence:
   * `lib/agent-dom/transport.ts` matches on `reason` and hands DASH's copy layer
   * a `kind` it has words for. A status code is what the user was shown before
   * this issue, and it named the transport rather than the fault.
   *
   * `/health`, `/shutdown` and `/store/retire` are above it deliberately — they
   * are, respectively, how DASH learns this is happening, how it stops the
   * runner, and how it repairs it. A guard that also refused those would leave a
   * damaged runner with no way out except killing it, which AGENTS.md forbids.
   */
  if (damage !== null) {
    sendStoreDamaged(response, damage);
    return;
  }

  // GET /agents — which agents this runner hosts.
  //
  // DASH needs this to know whose control location is the runner's own route
  // rather than whatever their manifest declared: a runner listens on an
  // ephemeral port, so no manifest written in advance can name it. The runner
  // is the authority on what it supervises, so it is asked.
  //
  // Authenticated, unlike /health, because the list of an operator's agents is
  // more than a liveness fact.
  if (request.method === "GET" && segments.length === 1 && segments[0] === "agents") {
    send(response, 200, { ok: true, agents: processReports(options.supervisor) });
    return;
  }

  // POST /registrations/reload — take up a fresh reading of the directory.
  //
  // A POST rather than a GET because it changes what the runner supervises, and
  // a route of its own rather than a lifecycle action because it is not about
  // one agent. Note what it still cannot do: the body is ignored entirely, so
  // the caller chooses *when* the runner re-reads its directory and never *what*
  // it finds there. "The API chooses which registration to start, never what to
  // run" survives intact — this route does not even choose which.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "registrations" &&
    segments[1] === "reload"
  ) {
    if (options.reload === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner was started without the ability to re-read its registrations.",
      });
      return;
    }
    const summary = options.reload();
    send(response, 200, { ok: true, ...summary });
    log(
      `[runner] reload: +${String(summary.added.length)} ~${String(summary.updated.length)} ` +
        `-${String(summary.removed.length)} deferred=${String(summary.deferred.length)} ` +
        `skipped=${String(summary.skipped.length)}`,
    );
    return;
  }

  // POST /notify/discord — hand the runner the channel it should post to, or
  // take it away (MAR-588).
  //
  // **The one route in this file that carries a credential inbound**, and it is
  // worth reading `runner/notify.ts`'s header for why it has to exist at all:
  // the sender lives here because this process outlives the DASH window, and a
  // sender in a process that outlives the window needs the address in that
  // process.
  //
  // Three things bound it. It is on the authenticated channel like everything
  // else, so a caller has to hold `runner.key`. The value is handed to
  // `DiscordNotifier.configure` and nowhere else — it is never written to the
  // store, never to a file and never logged, which is a property of that class
  // rather than a promise here. And the reply says only whether a channel is
  // now configured, never which: a route that echoed what it had just been
  // given would make the credential readable by anything that could ask.
  //
  // `webhook_url: null` clears it, and clearing is the same route rather than a
  // DELETE because the two are one setting with two values, and a person
  // pressing Disconnect in DASH is entitled to have that reach the runner as
  // reliably as pressing Connect did.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "notify" &&
    segments[1] === "discord"
  ) {
    if (options.configureNotifier === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner was started without the ability to post notifications.",
      });
      return;
    }
    const raw = await readBody(request);
    if (raw === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      // No echo of the body. It may have held the address.
      send(response, 400, { ok: false, detail: "The request body was not valid JSON." });
      return;
    }
    const parsed = readNotifyConfiguration(body);
    if (parsed === "malformed") {
      send(response, 400, { ok: false, detail: "The notification settings were not understood." });
      return;
    }
    options.configureNotifier(parsed);
    send(response, 200, { ok: true, configured: parsed !== null });
    // Logged as a state change and never with the value, so a support session
    // can see that DASH handed one over without the log becoming the place the
    // credential ends up.
    log(`[runner] notifications ${parsed === null ? "cleared" : "configured"}`);
    return;
  }

  // POST /chief/discord — hand the runner the chief's second room, or take it
  // away (MAR-743, ADR 0028 decision 5).
  //
  // **The second route in this file that carries a credential inbound, and the
  // first that carries one that can spend.** `POST /notify/discord` above is the
  // precedent and the shape; what is different is worth stating rather than
  // leaving to be noticed: this body holds a Discord bot token *and* a model
  // provider key, and the second of those is somebody's money.
  //
  // The same three bounds hold it. It is on the authenticated channel, so a
  // caller has to hold `runner.key`. The values are handed to
  // `RunnerChief.configure` and nowhere else — never to the store, never to a
  // file, never to a log, which is a property of that class rather than a
  // promise here. And the reply says only whether a bridge is now configured,
  // never with what.
  //
  // A fourth bound is specific to this route and is in `runner/chief-broker.ts`:
  // the key that arrives here reaches exactly one operation. A runner holding a
  // model key that could reach the whole catalogue would be a much larger thing
  // than this feature asked for.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "chief" &&
    segments[1] === "discord"
  ) {
    if (options.configureChief === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner was started without the ability to carry the chief.",
      });
      return;
    }
    const raw = await readBody(request);
    if (raw === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      // No echo of the body. It held a token and may have held a key.
      send(response, 400, { ok: false, detail: "The request body was not valid JSON." });
      return;
    }
    const parsed = readChiefConfiguration(body);
    if (parsed === "malformed") {
      send(response, 400, { ok: false, detail: "The chief's Discord settings were not understood." });
      return;
    }
    options.configureChief(parsed);
    send(response, 200, { ok: true, configured: parsed !== null });
    log(`[runner] the chief's Discord bridge ${parsed === null ? "cleared" : "configured"}`);
    return;
  }

  // GET /chief/discord — what the runner currently holds for the chief, and
  // never the credentials (MAR-745). `POST /chief/discord`'s read side, on the
  // same authenticated channel, for the settings row that has no other way to
  // ask whether a push actually landed.
  if (
    request.method === "GET" &&
    segments.length === 2 &&
    segments[0] === "chief" &&
    segments[1] === "discord"
  ) {
    if (options.describeChief === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner was started without the ability to carry the chief.",
      });
      return;
    }
    send(response, 200, { ok: true, ...options.describeChief() });
    return;
  }

  // POST /chief/drain — everything the chief did while DASH was closed.
  //
  // `/telemetry/drain`'s shape and its terms: bounded, fire-and-forget, and the
  // bodies are not interpreted here. What comes back are turns for
  // `chief_messages` and decisions for `broker_audit`, and main is what writes
  // them — including the `decided_on` stamp, which this route deliberately does
  // not put on the rows. A runner that labelled its own rows would be a runner
  // asserting its own provenance; DASH stamps what it pulled, which is the same
  // arrangement ADR 0021 wrote for a host.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "chief" &&
    segments[1] === "drain"
  ) {
    if (options.drainChief === undefined) {
      send(response, 200, { ok: true, turns: [], audit: [] });
      return;
    }
    send(response, 200, { ok: true, ...options.drainChief() });
    return;
  }

  // POST /schedules — the whole set of standing instructions DASH holds
  // (MAR-742 item 8, ADR 0029).
  //
  // `POST /chief/discord`'s shape with one difference stated at the seam: no
  // credential arrives here, so this route may echo a count. A malformed member
  // is **dropped rather than failing the batch** — the alternative is that one
  // corrupt row on somebody's disk silently stops every other agent's schedule,
  // and a scheduler that stops silently is the failure this feature is against.
  // What DASH gets back is how many were taken, so a page could say so.
  if (request.method === "POST" && segments.length === 1 && segments[0] === "schedules") {
    if (options.configureSchedules === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner was started without a scheduler.",
      });
      return;
    }
    const raw = await readBody(request);
    if (raw === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      send(response, 400, { ok: false, detail: "The request body was not valid JSON." });
      return;
    }
    const parsed = readScheduleConfiguration(body);
    if (parsed === "malformed") {
      send(response, 400, { ok: false, detail: "The schedules were not understood." });
      return;
    }
    options.configureSchedules(parsed);
    send(response, 200, {
      ok: true,
      taken: parsed.schedules.length,
      enabled: parsed.schedules.filter((schedule) => schedule.enabled).length,
    });
    return;
  }

  // POST /schedules/drain — every window the scheduler settled while DASH was
  // closed, and then forget them.
  //
  // `/chief/drain`'s terms exactly, including the one that matters most here:
  // the runner does not stamp its own provenance. These rows say what happened
  // to a window; that they came off a runner is DASH's observation to record,
  // not the runner's claim to make.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "schedules" &&
    segments[1] === "drain"
  ) {
    if (options.drainSchedules === undefined) {
      send(response, 200, { ok: true, settled: [] });
      return;
    }
    send(response, 200, { ok: true, settled: options.drainSchedules() });
    return;
  }

  // POST /telemetry/drain — one bounded fire-and-forget batch from hosted
  // children. This is on the authenticated runner channel and therefore adds no
  // listener, credential or environment variable. The event bodies are not
  // interpreted here: main hands each one to the canonical ingest boundary.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "telemetry" &&
    segments[1] === "drain"
  ) {
    send(response, 200, { ok: true, ...options.supervisor.drainTelemetry() });
    return;
  }

  // POST /artifacts/drain — the same bounded fire-and-forget shape for what a
  // run produced (MAR-457). A separate route rather than more fields on the
  // telemetry drain: the two are validated against different schemas at
  // different ingest boundaries, and one response carrying both would make main
  // sort them apart again by inspecting untrusted bodies.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "artifacts" &&
    segments[1] === "drain"
  ) {
    send(response, 200, { ok: true, ...options.supervisor.drainArtifacts() });
    return;
  }

  // POST /broker/drain — brokered-operation requests waiting for an answer
  // (MAR-458). The runner does not interpret them: `lib/broker/protocol.ts`
  // parses each candidate on the DASH side, which is where the operation
  // allowlist and the vault are. What the runner contributes, and what nothing
  // else could, is the identity of the child that wrote each line.
  //
  // MAR-784 adds the second thing only this process can contribute: **which of
  // those children it started itself, on a schedule that carries a ceiling.**
  // It rides this reply rather than a route of its own, and that is the whole
  // safety argument for the feature. A ceiling delivered on a separate poll
  // would be a ceiling that might arrive after the request it was meant to
  // cover, and the failure would be a scheduled run refused at 03:00 for a
  // reason nobody could reproduce at nine. In one reply there is no ordering to
  // get wrong: every request in this body was written by a child of this
  // process, and every allowance in it was opened by this process before it
  // answered. See `ScheduledAllowance`.
  //
  // It is still only a claim. `electron/broker-host.ts` reads it against DASH's
  // own `agent_schedules` row and grants the smaller of the two, so this route
  // cannot widen anything the person did not already set on their own page.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "broker" &&
    segments[1] === "drain"
  ) {
    send(response, 200, {
      ok: true,
      ...options.supervisor.drainBrokerRequests(),
      scheduled_allowances: options.scheduledAllowances?.() ?? [],
    });
    return;
  }

  // POST /broker/responses — DASH's answers, on their way back to the children
  // that asked (MAR-458).
  //
  // The body names an agent and carries one already-encoded response line. The
  // runner writes it to that child's stdin and nothing else: it does not parse
  // the line, does not re-address it, and cannot invent one, so the only
  // responses that exist are the ones DASH decided. A caller on this channel is
  // already DASH — it holds the bearer token — so the authority question is
  // settled before this route is reached.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "broker" &&
    segments[1] === "responses"
  ) {
    const body = await readBody(request);
    if (body === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let parsed: { responses?: unknown };
    try {
      parsed = JSON.parse(body) as { responses?: unknown };
    } catch {
      send(response, 400, { ok: false, detail: "The request body was not JSON." });
      return;
    }
    const delivered = deliverBrokerResponses(options.supervisor, parsed.responses);
    send(response, 200, { ok: true, ...delivered });
    return;
  }

  // POST /browser/drain — controlled-browser requests waiting for a decision
  // (MAR-628, ADR 0019). The runner does not interpret them:
  // `lib/browser/protocol.ts` parses each candidate on the DASH side, which is
  // where the operation catalogue and the origin allowlist are. What the runner
  // contributes, and what nothing else could, is the identity of the child that
  // wrote each line.
  //
  // Its own pair of routes rather than a widening of `/broker/*`, for the reason
  // `AgentBrowserRequestMessage` gives: these carry no connection, and a broker
  // request without one is not a broker request.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "browser" &&
    segments[1] === "drain"
  ) {
    send(response, 200, { ok: true, ...options.supervisor.drainBrowserRequests() });
    return;
  }

  // POST /browser/responses — DASH's decisions, on their way back to the
  // children that asked (MAR-628).
  //
  // `/broker/responses`' contract exactly, down to the delivery reporting: the
  // body names an agent and carries one already-encoded response line, the
  // runner writes it to that child's stdin and nothing else, and a caller on
  // this channel is already DASH because it holds the bearer token.
  //
  // It reuses `deliverBrokerResponses` rather than growing a near-copy. That
  // function does not parse a response, does not know what a broker is, and
  // does exactly one thing — write the caller's own line to the named child and
  // report which positions in the caller's array reached a live pipe. A second
  // implementation of that would be a second place for the index bookkeeping
  // MAR-467 got right to be got wrong.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "browser" &&
    segments[1] === "responses"
  ) {
    const body = await readBody(request);
    if (body === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let parsed: { responses?: unknown };
    try {
      parsed = JSON.parse(body) as { responses?: unknown };
    } catch {
      send(response, 400, { ok: false, detail: "The request body was not JSON." });
      return;
    }
    const delivered = deliverBrokerResponses(options.supervisor, parsed.responses);
    send(response, 200, { ok: true, ...delivered });
    return;
  }

  // GET /workspace-artifacts — the file-backed index, with availability
  // recomputed (MAR-434).
  //
  // A GET returning the whole current picture rather than a `drain` returning
  // what is new, and the difference is the point. Telemetry, artifacts and
  // broker requests are *events*: each one happens once, so a buffer that is
  // emptied is a buffer that has been delivered. Availability is a *state* —
  // a file that was there five seconds ago may not be now, and nothing emits an
  // event when antivirus takes it. A drain would let DASH's picture be right
  // once and stale forever after.
  if (request.method === "GET" && segments.length === 1 && segments[0] === "workspace-artifacts") {
    if (liveWorkspace === undefined) {
      send(response, 501, { ok: false, detail: "This runner has no task workspace." });
      return;
    }
    send(response, 200, { ok: true, ...liveWorkspace.index() });
    return;
  }

  // GET  /artifacts/{id}/verify    re-hash the stored bytes (MAR-434)
  // GET  /artifacts/{id}/download  the bytes themselves (MAR-434)
  // POST /artifacts/{id}/delete    explicit, audited removal of the bytes
  //
  // Not under `/agents/{id}` even though an artifact has one, because an
  // artifact id is the thing a caller holds after a run has finished and
  // requiring it to also remember which agent produced it would invite the
  // caller to *supply* an agent — a field the runner would then have to
  // disbelieve. The runner reads the agent off its own row.
  //
  // `delete` is a POST rather than a DELETE. A body-less DELETE is easy for an
  // intermediary to retry, and this one destroys bytes.
  if (segments[0] === "artifacts" && segments.length === 3) {
    if (liveWorkspace === undefined) {
      send(response, 501, { ok: false, detail: "This runner has no task workspace." });
      return;
    }
    const artifactId = decodeURIComponent(segments[1] ?? "");

    if (request.method === "GET" && segments[2] === "verify") {
      const verified = liveWorkspace.verify(artifactId);
      if (verified === null) {
        send(response, 404, { ok: false, detail: "There is no such output." });
        return;
      }
      send(response, 200, { ok: verified.ok, sha256: verified.sha256, expected: verified.expected });
      return;
    }

    // Reached by the same bearer token as every other route here, which is
    // this route's whole authorization model: anything holding the channel
    // token may read an output's bytes, exactly as it may already read the
    // receipt describing them.
    if (request.method === "GET" && segments[2] === "download") {
      const downloaded = liveWorkspace.download(artifactId);
      if (downloaded === null) {
        send(response, 404, { ok: false, detail: "There is no such output." });
        return;
      }
      if (!downloaded.ok) {
        send(response, 404, { ok: false, detail: downloaded.detail });
        return;
      }
      response.writeHead(200, {
        "content-type": downloaded.media_type,
        "content-length": String(downloaded.byte_size),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(downloaded.display_name)}`,
        "x-artifact-sha256": downloaded.sha256,
        "cache-control": "no-store",
      });
      downloaded.stream.on("error", () => {
        response.destroy();
      });
      downloaded.stream.pipe(response);
      return;
    }

    if (request.method === "POST" && segments[2] === "delete") {
      const body = await readBody(request);
      if (body === null) {
        send(response, 413, { ok: false, detail: "The request body was too large." });
        return;
      }
      let agent: unknown;
      try {
        ({ agent } = JSON.parse(body) as { agent?: unknown });
      } catch {
        send(response, 400, { ok: false, detail: "The request body was not JSON." });
        return;
      }
      if (typeof agent !== "string" || agent.length === 0) {
        send(response, 400, { ok: false, detail: "agent must be the name of the owning agent." });
        return;
      }
      const removed = liveWorkspace.remove(agent, artifactId);
      send(response, 200, removed);
      return;
    }
  }

  if (segments[0] !== "agents" || segments[1] === undefined) {
    send(response, 404, { ok: false, detail: "No such route." });
    return;
  }
  const agentId = decodeURIComponent(segments[1]);

  // GET /agents/{id}
  if (request.method === "GET" && segments.length === 2) {
    serveState(response, agentId, options);
    return;
  }

  // POST /agents/{id}/commands
  if (request.method === "POST" && segments.length === 3 && segments[2] === "commands") {
    const body = await readBody(request);
    if (body === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(body);
    } catch {
      send(response, 400, { ok: false, detail: "The request body was not JSON." });
      return;
    }

    // Unreachable while `storeDamage` answers honestly: the guard above returns
    // before any route that needs a database. It is checked rather than asserted
    // because "unreachable" is a claim about another function, and a runner that
    // dereferenced an absent store would fail as a crash rather than as copy.
    const database = openDatabase(options);
    if (database === null) {
      sendStoreDamaged(response, { kind: "unreadable", detail: "The runner has no open store." });
      return;
    }

    /*
     * The press that pays for a model call on this machine (MAR-629, ADR 0021).
     *
     * `electron/main.ts` does exactly this, on the same verb, before the same
     * call, with the same comment about ordering — and what it opens is DASH's
     * allowance, on DASH's machine, which a runner on a server cannot spend
     * against. This is the same press arriving where the money will actually be
     * spent.
     *
     * **Why the agent id comes from the URL and not the envelope.** The route
     * already resolved `/agents/{id}/commands`, and that segment is what every
     * other branch in this handler is about. Reading `target.agent_id` out of an
     * unvalidated body would let one agent's press open another agent's
     * allowance — which is the mistake `BufferedBrokerRequest`'s own docblock
     * calls the single most load-bearing field in the broker's transport.
     *
     * **Why before adjudication.** The agent begins working the instant the
     * runner writes the line, so an allowance opened on the way back would race
     * it. The cost is a refused command that opened an allowance nothing spends;
     * it expires on its own, and the opposite ordering is a run whose curation
     * step is refused for a reason nobody can see. `electron/main.ts` weighed
     * these the same way.
     *
     * **What does not open one.** `POST /agents/{id}/lifecycle` with `start` is
     * next door and calls nothing: starting a runner is not a Run. Nor is a
     * schedule — scheduled spending stays refused, and stays ADR 0014's deferred
     * decision, blocked on restart-on-boot.
     */
    if ((envelope as { command?: unknown } | null)?.command === "retry") {
      options.allowRunSpend?.(agentId, options.now?.() ?? new Date());
    }

    const result = await executeCommand(envelope, {
      database,
      supervisor: options.supervisor,
      principal: options.principal,
      now: options.now,
    });
    // Deliberately 200 with `ok: false` for an adjudicated refusal rather than
    // a 4xx. A refusal is a *result the runner produced*, and the adapter needs
    // to tell it apart from "the request never got that far" — which is exactly
    // what `lib/agent-dom/transport.ts` maps a non-2xx onto.
    send(response, 200, {
      ok: result.ok,
      detail: result.detail,
      reason: result.reason,
      duplicate: result.duplicate,
    });
    log(
      `[runner] ${result.ok ? "accepted" : "refused"} command=${result.command_id}` +
        ` agent=${agentId}${result.reason ? ` reason=${result.reason}` : ""}`,
    );
    return;
  }

  // POST /agents/{id}/lifecycle
  if (request.method === "POST" && segments.length === 3 && segments[2] === "lifecycle") {
    const body = await readBody(request);
    if (body === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let action: unknown;
    let credentials: unknown;
    try {
      const parsed = JSON.parse(body) as { action?: unknown; credentials?: unknown };
      action = parsed.action;
      credentials = parsed.credentials;
    } catch {
      send(response, 400, { ok: false, detail: "The request body was not JSON." });
      return;
    }

    if (action === "start") {
      // MAR-383. DASH reads the OS vault and sends the values for this spawn
      // only; the runner holds them no longer than the `start` call. Nothing
      // about them is logged — the line below reports the outcome and the
      // agent id, and `readBody` never logs a body.
      const parsedCredentials = parseSpawnCredentials(credentials);
      if (parsedCredentials === null) {
        send(response, 400, {
          ok: false,
          detail: "credentials must be an object of environment names to string values.",
        });
        return;
      }
      const started = options.supervisor.start(agentId, parsedCredentials);
      send(response, 200, {
        ok: started.ok,
        detail: started.ok ? `Started as pid ${String(started.pid)}.` : started.detail,
        reason: started.ok ? undefined : started.problem,
      });
      log(`[runner] start ${agentId}: ${started.ok ? "ok" : started.problem}`);
      return;
    }
    if (action === "stop") {
      const stopped = options.supervisor.stop(agentId);
      send(response, 200, { ok: stopped.ok, detail: stopped.detail });
      log(`[runner] stop ${agentId}: ${stopped.ok ? "ok" : "failed"}`);
      return;
    }

    send(response, 400, { ok: false, detail: 'action must be "start" or "stop".' });
    return;
  }

  // GET  /agents/{id}/artifacts?run_id=…   what this run produced (MAR-434)
  if (request.method === "GET" && segments.length === 3 && segments[2] === "artifacts") {
    if (liveWorkspace === undefined) {
      send(response, 501, { ok: false, detail: "This runner has no task workspace." });
      return;
    }
    const runId = url.searchParams.get("run_id");
    if (runId === null || runId.length === 0) {
      send(response, 400, { ok: false, detail: "run_id is required." });
      return;
    }
    send(response, 200, { ok: true, artifacts: liveWorkspace.artifacts(agentId, runId) });
    return;
  }

  // The task workspace routes (MAR-434).
  //
  // POST /agents/{id}/tasks                    open a workspace
  // GET  /agents/{id}/tasks/{taskId}           the task and what is in it
  // POST /agents/{id}/tasks/{taskId}/inputs    admit one user-selected file
  // POST /agents/{id}/tasks/{taskId}/dispatch  bind a run, close it, hand it over
  //
  // Note what has no route: reading an input back out. DASH admitted the bytes
  // and does not need them again, the agent gets them through its own workspace,
  // and a route that served them would be a route that turns an opaque id into a
  // download for anything holding the channel token. The runner resolves ids to
  // paths for exactly one consumer — the child the task belongs to.
  if (segments.length >= 3 && segments[2] === "tasks") {
    if (liveWorkspace === undefined) {
      send(response, 501, { ok: false, detail: "This runner has no task workspace." });
      return;
    }
    const workspace = liveWorkspace;

    if (request.method === "POST" && segments.length === 3) {
      send(response, 200, { ok: true, task: workspace.create(agentId) });
      return;
    }

    const taskId = decodeURIComponent(segments[3] ?? "");
    if (taskId.length === 0) {
      send(response, 404, { ok: false, detail: "No such route." });
      return;
    }

    if (request.method === "GET" && segments.length === 4) {
      const task = workspace.describe(agentId, taskId);
      if (task === null) {
        send(response, 404, { ok: false, detail: "There is no such task." });
        return;
      }
      send(response, 200, { ok: true, task });
      return;
    }

    if (request.method === "POST" && segments.length === 5 && segments[4] === "inputs") {
      const body = await readBody(request);
      if (body === null) {
        send(response, 413, { ok: false, detail: "The request body was too large." });
        return;
      }
      let parsed: { role?: unknown; source_path?: unknown; limits?: unknown };
      try {
        parsed = JSON.parse(body) as typeof parsed;
      } catch {
        send(response, 400, { ok: false, detail: "The request body was not JSON." });
        return;
      }
      if (typeof parsed.role !== "string" || parsed.role.length === 0) {
        send(response, 400, { ok: false, detail: "role is required." });
        return;
      }
      if (typeof parsed.source_path !== "string" || parsed.source_path.length === 0) {
        send(response, 400, { ok: false, detail: "source_path is required." });
        return;
      }

      const admitted = await workspace.admit(agentId, taskId, {
        role: parsed.role,
        source_path: parsed.source_path,
        limits: parseDeclaredLimits(parsed.limits),
      });
      // 200 with `ok: false` for an adjudicated refusal, exactly as the command
      // route does and for the same reason: "the runner considered this file and
      // said no" is a result, and the caller has to tell it from "the request
      // never arrived". The refusal code is what DASH renders a sentence from.
      send(response, 200, admitted);
      // The path is not logged. It is the one string on this channel that names
      // something on the user's own disk.
      log(
        `[runner] input ${admitted.ok ? "admitted" : "refused"} agent=${agentId} task=${taskId}` +
          (admitted.ok ? "" : ` reason=${admitted.refusal}`),
      );
      return;
    }

    if (request.method === "POST" && segments.length === 5 && segments[4] === "dispatch") {
      const body = await readBody(request);
      if (body === null) {
        send(response, 413, { ok: false, detail: "The request body was too large." });
        return;
      }
      let runId: unknown;
      try {
        ({ run_id: runId } = JSON.parse(body) as { run_id?: unknown });
      } catch {
        send(response, 400, { ok: false, detail: "The request body was not JSON." });
        return;
      }
      if (typeof runId !== "string" || runId.length === 0) {
        send(response, 400, { ok: false, detail: "run_id is required." });
        return;
      }
      const dispatched = workspace.dispatch(agentId, taskId, runId);
      send(response, 200, dispatched);
      log(
        `[runner] task ${dispatched.ok ? "dispatched" : "refused"} agent=${agentId} task=${taskId}` +
          (dispatched.ok ? "" : ` reason=${dispatched.refusal}`),
      );
      return;
    }
  }

  send(response, 404, { ok: false, detail: "No such route." });
}

/**
 * Narrow the optional `limits` block of an input request.
 *
 * Every field is dropped unless it is a finite positive number, and nothing here
 * validates it *upwards*: `effectiveLimits` takes the minimum against the
 * runner's own ceiling, so a caller sending `max_file_bytes: 1e18` gets the
 * ceiling rather than an error. That asymmetry is deliberate — a limit block is
 * a narrowing request, and a narrowing request that cannot widen anything does
 * not need to be defended against, only ignored where it is nonsense.
 */
function parseDeclaredLimits(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const limits: Record<string, unknown> = {};
  for (const key of ["max_file_bytes", "max_total_bytes", "max_count"]) {
    const entry = source[key];
    if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) {
      limits[key] = entry;
    }
  }
  if (Array.isArray(source["media_types"])) {
    const types = source["media_types"].filter((entry): entry is string => typeof entry === "string");
    if (types.length > 0) {
      limits["media_types"] = types;
    }
  }
  return Object.keys(limits).length > 0 ? limits : undefined;
}

/**
 * Narrow the `credentials` block of a start request (MAR-383).
 *
 * Absent is the ordinary case and means an empty map, not a refusal: most
 * agents declare no DASH-managed connection, and requiring the key would make
 * every existing caller malformed.
 *
 * Values must be strings. An object or array here would be a caller trying to
 * put structure into an environment variable, and `null` would become the
 * literal `"null"` in the child — both are more likely a bug than an intent,
 * and neither is something to guess at. What this does *not* do is check the
 * names: that is `checkEnvironmentName`, applied in `childEnvironment`, so
 * there is one place the rule lives rather than two that can disagree.
 */
export function parseSpawnCredentials(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const credentials: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") {
      return null;
    }
    credentials[key] = entry;
  }
  return credentials;
}

/**
 * Hand each answer to the child it belongs to (MAR-458).
 *
 * The whole function is a narrowing plus a loop, and the narrowing is the part
 * worth reading. Two fields per entry: an agent id and a line. The line is
 * required to be a single newline-terminated string, because this is written
 * straight into a newline-delimited stream — a "line" containing an interior
 * newline would frame a second message the agent would then act on, and the one
 * place that could happen is a caller that built the string by concatenation.
 *
 * `undelivered` is reported rather than swallowed: an agent that exited while
 * DASH was deciding is an ordinary race, and one whose answers are all going
 * undelivered is a bug worth being able to see from the DASH side.
 */
function deliverBrokerResponses(
  supervisor: Supervisor,
  candidate: unknown,
): { delivered: number; undelivered: number; malformed: number; undelivered_index: number[] } {
  // `undelivered_index` carries the *positions* in the submitted array rather
  // than agent ids (MAR-467). DASH holds the batch it just sent, in order, and
  // needs to mark the audit row of the specific answer that did not arrive; two
  // answers to the same agent in one batch would be indistinguishable by id, and
  // marking the wrong decision undelivered is exactly the kind of small lie this
  // work exists to avoid. The runner adds nothing it did not observe: an index is
  // a fact about the caller's own array.
  const summary = { delivered: 0, undelivered: 0, malformed: 0, undelivered_index: [] as number[] };
  if (!Array.isArray(candidate)) {
    return summary;
  }

  for (const [index, entry] of candidate.entries()) {
    if (typeof entry !== "object" || entry === null) {
      summary.malformed += 1;
      continue;
    }
    const { agent_id: agentId, line } = entry as { agent_id?: unknown; line?: unknown };
    if (
      typeof agentId !== "string" ||
      agentId.length === 0 ||
      typeof line !== "string" ||
      !line.endsWith("\n") ||
      line.indexOf("\n") !== line.length - 1
    ) {
      summary.malformed += 1;
      continue;
    }
    if (supervisor.respondToBroker(agentId, line)) {
      summary.delivered += 1;
    } else {
      summary.undelivered += 1;
      summary.undelivered_index.push(index);
    }
  }

  return summary;
}

/**
 * Serve one snapshot, validated on the way out.
 *
 * The runner checks its own document against `agent-dom-state.schema.json`
 * before serving it, which sounds redundant — DASH validates it again on
 * arrival — and is not. A runner that emits a document failing its own contract
 * should discover that at the boundary it controls, not as a mysterious
 * rejection in someone else's store. It is the same argument
 * `lib/agent-dom/runner.ts` makes for validating an envelope it built itself.
 */
function serveState(
  response: ServerResponse,
  agentId: string,
  options: RunnerServerOptions,
): void {
  const facts = options.supervisor.facts(agentId);
  if (facts === null) {
    send(response, 404, { ok: false, detail: `No agent is registered as "${agentId}".` });
    return;
  }

  const state = buildAgentDomState(
    facts,
    options.supervisor.report(agentId),
    options.now?.() ?? new Date(),
  );
  const validation = validateState(state);
  if (!validation.ok) {
    send(response, 500, {
      ok: false,
      detail: `The runner built a state snapshot that fails the contract: ${validation.errors
        .slice(0, 5)
        .join("; ")}`,
    });
    return;
  }

  sendRaw(response, 200, JSON.stringify(state));
}

/** What `/health` and the shell's status command report. */
export function processReports(supervisor: Supervisor): ProcessReport[] {
  return supervisor.list().map((agentId) => {
    const facts = supervisor.facts(agentId);
    return {
      agent_id: agentId,
      pid: facts?.pid ?? null,
      lifecycle: facts?.lifecycle ?? "stopped",
      started_at: facts?.started_at ?? null,
      exit_code: facts?.exit_code ?? null,
      exit_signal: facts?.exit_signal ?? null,
      commands: supervisor.commands(agentId),
    };
  });
}

/* ---------------------------------------------------------------------- *
 * Request plumbing
 * ---------------------------------------------------------------------- */

/**
 * Compare the presented token with the real one in constant time.
 *
 * `a === b` on secrets returns as soon as two bytes differ, so the time it
 * takes reveals how long a shared prefix was. That is a practical attack
 * against a local port that anything on the machine may probe in a loop.
 * Lengths are compared first because `timingSafeEqual` throws on a mismatch —
 * and a length is not the secret.
 */
export function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }
  const presented = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}

/**
 * Is this connection one the runner may answer?
 *
 * Since MAR-430 the runner listens on a Unix socket or a named pipe and never
 * on a port, and an IPC connection has **no remote address** — there is no peer
 * IP because there is no IP. So an absent address is the expected case and is
 * allowed: the operating system already decided who may connect, by socket mode
 * and directory ownership on POSIX and by the pipe's descriptor on Windows.
 *
 * The loopback branch is kept for the case that no longer occurs. A future
 * change that reintroduces a TCP listener — for a remote runner, say — must not
 * get a non-loopback peer accepted by default just because this check was
 * written when there was nothing to check.
 */
export function isLocalPeer(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  if (address === undefined) {
    return true;
  }
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
}

/**
 * Read the notification settings out of a request body (MAR-588).
 *
 * Three answers, not two: a configuration, `null` for "clear it", and the string
 * `"malformed"` for anything else. Folding the last two together would mean a
 * body DASH did not understand silently switched somebody's notifications off,
 * which is the failure where a person believes they are being told about their
 * agents and is not.
 *
 * The address is checked for shape only — non-empty, and not absurdly long. It
 * is **not** re-validated against `parseDiscordWebhook` here, and that is
 * deliberate: main is what a person's paste passes through, main is what refuses
 * a URL that is not Discord's, and a second copy of that rule in a process that
 * receives an already-accepted value would be a second place for the two to
 * disagree about what is allowed. What this route protects is the runner, and
 * what protects the runner is that only a caller holding `runner.key` reaches it.
 */
function readNotifyConfiguration(body: unknown): NotifyConfiguration | null | "malformed" {
  if (typeof body !== "object" || body === null) {
    return "malformed";
  }
  const record = body as Record<string, unknown>;
  const url = record["webhook_url"];
  if (url === null) {
    return null;
  }
  if (typeof url !== "string" || url === "" || url.length > 2_048) {
    return "malformed";
  }
  return {
    endpoint: url,
    // Absent means on. A caller that named an address and no preferences is
    // asking for notifications, and defaulting to off would leave a person who
    // just connected a channel wondering why it is silent.
    send_approvals: record["send_approvals"] !== false,
    send_reports: record["send_reports"] !== false,
  };
}

/**
 * The chief's bridge, out of a JSON body (MAR-743).
 *
 * `readNotifyConfiguration`'s shape and the note above it applies unchanged: the
 * validation that matters happened in DASH, and a second policy here would be a
 * second place for the two to disagree about what is allowed. What this does is
 * make sure the object handed to `RunnerChief.configure` has the fields it
 * claims — because everything downstream reads them without asking again.
 *
 * **Nothing here is defaulted permissively.** `readNotifyConfiguration` can
 * default a switch to on, because the worst case is a message somebody did not
 * want. A missing channel or a missing allowed id here would be a bridge with no
 * boundary, so both are `malformed` — the one shape of failure this route must
 * never absorb.
 *
 * The snapshot is the exception and is defaulted to empty rather than refused: a
 * chief with no fleet facts answers "you have no agents", which is a true
 * sentence about a DASH that has none, and refusing the whole bridge over an
 * absent list would turn an empty fleet into a broken feature.
 */
/**
 * The schedules DASH pushed, checked field by field (MAR-742 item 8, ADR 0029).
 *
 * `readChiefConfiguration`'s discipline with one deliberate difference in how it
 * fails. That function refuses the whole bridge on a bad member, because a
 * bridge with no boundary is worse than no bridge. This one **drops the bad
 * member and keeps the rest**, because the thing on the other side of a refusal
 * here is every *other* agent's schedule silently not firing — and a scheduler
 * that stops without saying so is the one failure mode ADR 0029 is written
 * against.
 *
 * The check is not a duplicate of DASH's. `lib/schedule/store.ts` re-checks these
 * columns on the way out of the store and this re-checks them on the way into
 * the process that will start an agent at the time they name. Two boundaries, on
 * two sides of a channel — `runner/execute.ts`'s own argument for repeating
 * DASH's checks rather than trusting them.
 */
function readScheduleConfiguration(body: unknown): ScheduleConfiguration | "malformed" {
  if (typeof body !== "object" || body === null) {
    return "malformed";
  }
  const record = body as Record<string, unknown>;
  const rawSchedules = record["schedules"];
  if (!Array.isArray(rawSchedules)) {
    return "malformed";
  }

  const schedules: AgentSchedule[] = [];
  for (const raw of rawSchedules) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const agent = entry["agent"];
    const at = entry["at_local"];
    // `kind` is checked by value rather than coerced: a runner that met an
    // unknown kind and treated it as daily would be honouring an instruction
    // nobody wrote, at a time nobody picked.
    if (
      typeof agent !== "string" ||
      agent.length === 0 ||
      agent.length > 128 ||
      entry["kind"] !== "daily" ||
      typeof at !== "string" ||
      !isLocalTime(at)
    ) {
      continue;
    }
    const createdAt = entry["created_at"];
    schedules.push({
      agent,
      enabled: entry["enabled"] === true,
      kind: "daily",
      at_local: at,
      created_at: typeof createdAt === "string" ? createdAt : "",
      /*
       * MAR-784. Anything this build does not recognise as a ceiling becomes
       * zero — a schedule that runs and does not spend — rather than being
       * dropped along with the rest of the member. That split is deliberate and
       * is the same one this function already makes for every other field: a bad
       * *time* means DASH would start an agent at a moment nobody picked, so the
       * member goes; a bad *ceiling* means DASH would spend money nobody agreed
       * to, so the ceiling goes and the schedule keeps running. Dropping the
       * whole member for a bad ceiling would silently stop somebody's agent.
       */
      allowance_calls: allowanceCalls(entry["allowance_calls"]),
    });
  }

  const rawSince = record["since"];
  const since: Record<string, string> = {};
  if (typeof rawSince === "object" && rawSince !== null) {
    for (const [agent, value] of Object.entries(rawSince as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) {
        since[agent] = value;
      }
    }
  }

  return { schedules, since };
}

function readChiefConfiguration(body: unknown): ChiefBridgeConfiguration | null | "malformed" {
  if (typeof body !== "object" || body === null) {
    return "malformed";
  }
  const record = body as Record<string, unknown>;
  // `bot_token: null` clears it, the same way `webhook_url: null` does, and for
  // the same reason: connect and disconnect are one setting with two values.
  if (record["bot_token"] === null) {
    return null;
  }

  const token = record["bot_token"];
  const channel = record["channel_id"];
  const allowed = record["allowed_user_id"];
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 512 ||
    typeof channel !== "string" ||
    !/^[0-9]{15,25}$/u.test(channel) ||
    typeof allowed !== "string" ||
    !/^[0-9]{15,25}$/u.test(allowed)
  ) {
    return "malformed";
  }

  const model = readChiefModel(record["model"]);
  if (model === "malformed") {
    return "malformed";
  }

  const snapshot = record["snapshot"];
  const snapshotRecord =
    typeof snapshot === "object" && snapshot !== null ? (snapshot as Record<string, unknown>) : {};

  return {
    bot_token: token,
    channel_id: channel,
    allowed_user_id: allowed,
    model,
    snapshot: {
      fleet: Array.isArray(snapshotRecord["fleet"])
        ? (snapshotRecord["fleet"] as ChiefBridgeConfiguration["snapshot"]["fleet"])
        : [],
      briefing: Array.isArray(snapshotRecord["briefing"])
        ? (snapshotRecord["briefing"] as ChiefBridgeConfiguration["snapshot"]["briefing"])
        : [],
      /*
       * The fleet's own output (MAR-744).
       *
       * Absent rather than malformed when it is missing, which is the whole
       * reason it is read the same shallow way `fleet` and `briefing` are: an
       * older DASH pushes no library, and refusing the whole configuration over
       * it would turn a downgrade into a bridge that stops answering entirely.
       * An empty list means *nothing of your agents' to read here*, which the
       * chief says in words.
       */
      library: Array.isArray(snapshotRecord["library"])
        ? (snapshotRecord["library"] as ChiefBridgeConfiguration["snapshot"]["library"])
        : [],
      taken_at:
        typeof snapshotRecord["taken_at"] === "string" ? snapshotRecord["taken_at"] : "",
    },
  };
}

/**
 * The model half, which is allowed to be absent and not allowed to be partial.
 *
 * Null means "Discord is connected and AI is not", which is an ordinary state
 * somebody can be in for a week — ADR 0028 decision 9 is what makes it answer
 * anyway. A *partial* model is not a state anything produces, so it is
 * `malformed`: a key with no model id, or a model id with no key, would each
 * reach the broker and be refused there with a word that describes the wrong
 * problem.
 *
 * ## And the same argument, one step further (MAR-745)
 *
 * "Refused with a word that describes the wrong problem" is not hypothetical.
 * Main sent this route a stored credential **envelope** in the `api_key` slot
 * for a whole packet — a JSON document, not a key — and every consequence
 * happened downstream: a real round trip to OpenRouter, a 401, and a
 * `chief_audit_spool` row saying `revoked`, which is DASH telling somebody their
 * working key had been withdrawn. `electron/chief-discord.ts` is where that is
 * fixed and where it belongs. This is the second line, and it is here because
 * this is the boundary: the runner cannot check a key, but it can check that
 * what arrived is a key **shape** at all, and it is the last place to do so
 * before the value is spent.
 *
 * Refused as *no model* rather than as a malformed bridge. A malformed bridge is
 * a 400 that leaves the chief holding the previous configuration and silent in
 * Discord; no model leaves it answering from records, and `GET /chief/discord`
 * reports "no model" so Settings shows the gap instead of hiding it.
 */
function readChiefModel(value: unknown): ChiefBridgeConfiguration["model"] | "malformed" {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object") {
    return "malformed";
  }
  const record = value as Record<string, unknown>;
  const provider = record["provider_id"];
  const model = record["model_id"];
  const key = record["api_key"];
  if (
    typeof provider !== "string" ||
    provider.length === 0 ||
    typeof model !== "string" ||
    model.length === 0 ||
    typeof key !== "string" ||
    key.length === 0
  ) {
    return "malformed";
  }
  if (!looksLikeAKey(key)) {
    return null;
  }
  return { provider_id: provider, model_id: model, api_key: key };
}

/**
 * Whether this is a key, or something DASH holds *about* a key (MAR-745).
 *
 * Two shapes, and main has actually sent one of them. A stored `AiKeyCredential`
 * envelope is a JSON document, so it begins with `{`; a masked hint is four
 * bullet characters and a tail, which is what a settings row carries so that a
 * page can show a credential without holding one. No provider issues a key that
 * is either. Both were named as candidates in MAR-745's diagnosis and the first
 * one was the answer, so the check covers both rather than only the one that
 * happened.
 *
 * Deliberately not a positive test. "Starts with `sk-`" would be this runner
 * having an opinion about a provider's key format, which is a rule that breaks
 * on the day a provider changes its prefix and refuses a key that works. What is
 * excluded here is two things DASH itself constructs, and nothing else.
 *
 * The bullet is spelled out rather than imported: `isMaskedHint` lives in
 * `lib/secret-refs.ts`, which imports `lib/db.ts` — and the store DASH's own
 * process opens is the one file this process must never touch.
 */
function looksLikeAKey(key: string): boolean {
  return !key.trimStart().startsWith("{") && !key.includes("••••");
}

/**
 * Read a bounded body, or null when the caller sent too much.
 *
 * The early return **pauses** the request rather than walking away from it.
 * Abandoning a half-read stream leaves the peer writing into a reader that
 * will never drain, and the answer this runner has already decided on — a 413 —
 * then races the peer's remaining bytes. Over loopback TCP the kernel buffer
 * usually hid that; over a Unix socket the buffer is smaller and it surfaces as
 * an `EPIPE` on whichever side loses. Pausing stops the read without
 * discarding the connection, so the refusal reaches the caller first.
 */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      request.pause();
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The store as it is right now, which is not always as it was at construction. */
function openDatabase(options: RunnerServerOptions): DatabaseSync | null {
  const source = options.database;
  if (source === undefined) {
    return null;
  }
  return typeof source === "function" ? source() : source;
}

function send(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  sendRaw(response, status, JSON.stringify(body));
}

/**
 * The one shape a damaged store answers with (MAR-506).
 *
 * 503 because the condition is temporary in the only sense that matters: it is
 * about this runner's own state and it has a repair, which is exactly what 503
 * means and what 500 does not.
 *
 * `reason` is the field `lib/agent-dom/transport.ts` matches on, and `kind` is
 * what `describeRunnerStoreDamage` switches on. `detail` is SQLite's own status
 * sentence, carried for the log and a developer disclosure and never for the
 * headline — the user gets a sentence about their agents, not one about a disk
 * image.
 */
function sendStoreDamaged(response: ServerResponse, damage: RunnerStoreDamage): void {
  send(response, 503, {
    ok: false,
    reason: STORE_DAMAGED_REASON,
    kind: damage.kind,
    detail: damage.detail,
  });
}

function sendRaw(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "application/json",
    // Nothing here is cacheable and some of it is a decision about a
    // credential-adjacent action.
    "cache-control": "no-store",
  });
  response.end(body);
}
