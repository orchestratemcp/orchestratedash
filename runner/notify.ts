/**
 * The thing that actually posts to Discord (MAR-588, outbound half).
 *
 * ## Why this is in the runner and not in Electron main
 *
 * Because of one sentence in the setup copy: *with DASH closed and the computer
 * on, messages are still sent*. `lib/notify/settings.ts` states it, a person
 * reads it before they paste a credential, and it has to be true.
 *
 * DASH already has exactly one process that survives its window closing.
 * `electron/runner-process.ts` spawns the runner **detached** — "closing the
 * DASH window leaves running agents running" — and the runner is what holds the
 * agents' pipes. So it is the only place in the system that can see an agent
 * ask for an approval at a moment when nobody is looking at DASH, which is the
 * only moment this feature is worth anything.
 *
 * A notifier in main would have been a third of the size and would have made the
 * copy a lie: the poll loop that populates the work inbox is main's, so with the
 * app closed there would be nothing watching, nothing to notice, and a person
 * relying on a message that was never coming. `electron/approval-notifier.ts` is
 * that design, correctly, for an OS toast — a toast is for somebody at the
 * machine, and there is no point delivering one to an empty desk.
 *
 * ## What it costs, stated rather than buried
 *
 * The webhook address is a credential and it lives in the OS vault. To send from
 * the runner, DASH has to hand it over: main reads the vault and posts it to the
 * runner's authenticated control endpoint whenever DASH starts or the setting
 * changes. So the value exists in a second process.
 *
 * The bound on that is deliberate and is the reason this class holds it the way
 * it does: **it is memory only**. It is never written to `runner.sqlite`, never
 * to a file, never to a log, and it is gone the moment the runner exits. The
 * endpoint is a private field on one object, and nothing on this class returns
 * it — `describe()` reports whether one is configured, never which.
 *
 * The consequence a reader should draw is the third liveness sentence: once the
 * computer restarts, the runner is gone and comes back with nothing, so nothing
 * is sent until DASH is opened again and hands it over. That is not a gap this
 * file should close by persisting the credential. It is the honest shape of a
 * local-first product with no server, and the copy says it.
 *
 * ## Delivery policy
 *
 * One request at a time, in order, with a bounded queue. Discord rate-limits per
 * webhook, and a burst of agents finishing at once would otherwise produce a
 * burst of parallel requests that earn a 429 each. A dropped message is logged,
 * because a message nobody sent and nobody knows about is the failure this whole
 * feature exists to prevent, one layer up.
 */

import {
  buildDiscordMessage,
  type NotifiableEvent,
  type NotificationKind,
} from "../lib/notify/discord";
import { deliverDiscordMessage, type FetchLike } from "../lib/notify/deliver";
import { buildOpenLink } from "../lib/open-link";

/**
 * What main hands over. Never persisted, never returned.
 *
 * The two switches travel with the address because the runner is what decides
 * whether bytes leave the machine, and a runner that had the address but had to
 * ask something else whether to use it would be a runner that sends during the
 * window in which it has not asked yet.
 */
export interface NotifyConfiguration {
  endpoint: string;
  send_approvals: boolean;
  send_reports: boolean;
}

/**
 * How many messages may be waiting before DASH starts dropping them.
 *
 * Small on purpose. This queue holds notifications about things that just
 * happened, and a notification that has been waiting behind forty others is not
 * a notification any more. Dropping the newest — see `enqueue` — rather than the
 * oldest keeps the first thing that went wrong in the channel, which is the one
 * a person needs.
 */
const MAX_QUEUE = 16;

/**
 * How many ids to remember before forgetting the oldest.
 *
 * The dedup sets are what stop one approval producing a message on every state
 * line an agent emits, which for a chatty agent is several a second. Bounded
 * because a runner is expected to stay up for weeks: an unbounded set is a slow
 * leak whose symptom would be a memory graph nobody connects to notifications.
 */
const MAX_REMEMBERED = 512;

/** Attempts per message before it is given up on. */
const MAX_ATTEMPTS = 3;

export interface NotifierOptions {
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
  /** Injected so tests do not spend real seconds waiting out a 429. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * A pending approval, as it appears in an agent's own state document.
 *
 * Declared locally rather than imported from `lib/copy/approval.ts` for the
 * reason that module declares its own: everything here is read defensively out
 * of `unknown`, because the agent wrote it and an agent may write anything.
 */
interface RawApproval {
  id: string;
  status: string;
  runner_enforced: boolean;
  expires_at: string;
}

export class DiscordNotifier {
  /**
   * The credential. Private, never logged, never returned, never written down.
   * Null until DASH hands one over and again the moment it is taken away.
   */
  private configuration: NotifyConfiguration | null = null;

  /** Approval ids already announced. */
  private readonly announcedApprovals = new Set<string>();

  /**
   * Runs already announced, **not** artifact ids.
   *
   * A run that publishes a digest and then two supporting files is one thing
   * happening, and a person watching a channel wants to hear about it once. So
   * the first artifact of a run produces the message and the rest are silent —
   * which is also why the key is the run and the message says "published a new
   * report" rather than naming a count it would then have to keep updating.
   */
  private readonly announcedRuns = new Set<string>();

  private readonly queue: NotifiableEvent[] = [];
  private draining = false;
  private stopped = false;

  private readonly fetchImpl: FetchLike | undefined;
  private readonly log: (line: string) => void;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: NotifierOptions = {}) {
    this.fetchImpl = options.fetchImpl;
    this.log =
      options.log ??
      ((line) => {
        console.warn(line);
      });
    this.sleep =
      options.sleep ??
      ((ms) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, ms);
          timer.unref?.();
        }));
  }

  /**
   * Take, replace or clear the configuration.
   *
   * Clearing empties the queue. A message still waiting when somebody
   * disconnected their channel is a message they asked DASH not to send, and
   * delivering it because it was already in a list would be the least defensible
   * moment for this to fire.
   */
  configure(configuration: NotifyConfiguration | null): void {
    this.configuration = configuration;
    if (configuration === null) {
      this.queue.length = 0;
    }
  }

  /** Whether a channel is set up. Deliberately not *which* — see the header. */
  describe(): { configured: boolean; queued: number } {
    return { configured: this.configuration !== null, queued: this.queue.length };
  }

  /** Stop delivering. The runner's shutdown path calls this. */
  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
  }

  /**
   * An agent published something.
   *
   * `artifact` is `unknown` because that is what the supervisor holds: the
   * runner does not validate artifacts (`runner/protocol.ts` says why — DASH
   * does, against the real schema), so everything below is a defensive read. An
   * artifact whose `run_id` is not a usable string produces no message rather
   * than a message about a run nobody can open.
   */
  observeArtifact(agentId: string, agentTitle: string, artifact: unknown): void {
    const runId = readString(artifact, "run_id");
    if (runId === null) {
      return;
    }
    const key = `${agentId} ${runId}`;
    if (this.announcedRuns.has(key)) {
      return;
    }
    remember(this.announcedRuns, key);
    this.enqueue({
      kind: "new_report",
      agent_id: agentId,
      agent_title: agentTitle,
      run_id: runId,
    });
  }

  /**
   * An agent published a state document. Look for approvals nobody has heard of.
   *
   * The filter is the same one `lib/shell/approval-popup.ts` applies on this
   * machine — pending, runner-enforced, not expired — and it is applied here for
   * the reason that module exists at all: a notification for something DASH
   * would not show, or the reverse, is drift a person experiences as DASH lying
   * about which of its surfaces to believe. `runner_enforced` in particular is
   * what separates a gate from a suggestion, and a channel message about a
   * suggestion would be asking somebody to hurry to their machine for something
   * that was never going to wait for them.
   */
  observeState(agentId: string, agentTitle: string, state: unknown, now: Date = new Date()): void {
    const requests = readArray(state, "approval_requests");
    for (const raw of requests) {
      const request = readApproval(raw);
      if (request === null || !isLiveApproval(request, now)) {
        continue;
      }
      const key = `${agentId} ${request.id}`;
      if (this.announcedApprovals.has(key)) {
        continue;
      }
      remember(this.announcedApprovals, key);
      this.enqueue({
        kind: "needs_approval",
        agent_id: agentId,
        agent_title: agentTitle,
        // Deliberately null even though the approval belongs to a task that
        // belongs to a run. The link opens the agent, and the agent's page is
        // where the approval can actually be answered; a link to the run would
        // land somebody on a history page next to the thing they came to do.
        run_id: null,
      });
    }
  }

  private enqueue(event: NotifiableEvent): void {
    if (this.stopped) {
      return;
    }
    const configuration = this.configuration;
    if (configuration === null) {
      // Not a drop worth logging. Nobody set this up, so nothing was expected.
      return;
    }
    const wanted =
      event.kind === "needs_approval" ? configuration.send_approvals : configuration.send_reports;
    if (!wanted) {
      return;
    }

    if (this.queue.length >= MAX_QUEUE) {
      this.log(
        `[runner] a Discord notification for ${event.agent_id} was dropped: ${String(MAX_QUEUE)} messages are already waiting`,
      );
      return;
    }

    this.queue.push(event);
    void this.drain();
  }

  /**
   * Send what is queued, one at a time.
   *
   * Re-entrant by way of `draining` rather than by a lock, because there is only
   * one caller and it is this class: `enqueue` starts a drain and the drain runs
   * until the queue is empty, so a second `enqueue` during a request adds to the
   * list the running drain is already walking.
   */
  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      while (!this.stopped) {
        const event = this.queue.shift();
        if (event === undefined) {
          return;
        }
        await this.send(event);
      }
    } finally {
      this.draining = false;
    }
  }

  private async send(event: NotifiableEvent): Promise<void> {
    const message = buildDiscordMessage(
      event,
      buildOpenLink({ agent: event.agent_id, run: event.run_id }),
    );

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      // Re-read every attempt. A disconnect during a backoff must stop the
      // retry, not resume against an endpoint the person has removed.
      const configuration = this.configuration;
      if (configuration === null || this.stopped) {
        return;
      }

      const outcome = await deliverDiscordMessage(
        configuration.endpoint,
        message,
        this.fetchImpl,
      );

      if (outcome.kind === "delivered") {
        return;
      }
      if (outcome.kind === "rejected") {
        // Terminal by definition — Discord understood and refused, so a retry
        // sends the same message to the same refusal. Logged with the status,
        // never with the endpoint. `notify.test` is how a person finds out what
        // to do about it; this is how a support session finds out it happened.
        this.log(
          `[runner] Discord refused a notification (status ${String(outcome.status)}); nothing further will be tried for it`,
        );
        return;
      }
      if (outcome.kind === "rate_limited") {
        await this.sleep(outcome.retry_after_ms);
        continue;
      }
      // `unavailable` and `unreachable`: worth another go, after a pause that
      // grows, so a network that is down for a minute does not consume all three
      // attempts in half a second.
      await this.sleep(attempt * 1_000);
    }

    this.log(
      `[runner] a Discord notification for ${event.agent_id} could not be delivered after ${String(MAX_ATTEMPTS)} attempts`,
    );
  }
}

/* ---------------------------------------------------------------------- *
 * Defensive reads
 * ---------------------------------------------------------------------- */

function readString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function readArray(value: unknown, key: string): unknown[] {
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field : [];
}

function readApproval(value: unknown): RawApproval | null {
  const id = readString(value, "id");
  const status = readString(value, "status");
  const expiresAt = readString(value, "expires_at");
  if (id === null || status === null || expiresAt === null) {
    return null;
  }
  const enforced = (value as Record<string, unknown>)["runner_enforced"];
  return { id, status, expires_at: expiresAt, runner_enforced: enforced === true };
}

/**
 * Pending, enforced, and not already past its deadline.
 *
 * An unparseable `expires_at` counts as live. `lib/copy/approval.ts` takes the
 * same reading for the same reason: a bad timestamp is not evidence that the
 * agent stopped waiting, and treating it as expired would silently swallow the
 * one class of approval most likely to be from an agent with something wrong
 * with it.
 */
function isLiveApproval(request: RawApproval, now: Date): boolean {
  if (request.status !== "pending" || !request.runner_enforced) {
    return false;
  }
  const deadline = Date.parse(request.expires_at);
  return Number.isNaN(deadline) || deadline > now.getTime();
}

/** Add to a bounded set, evicting in insertion order. */
function remember(set: Set<string>, key: string): void {
  set.add(key);
  if (set.size > MAX_REMEMBERED) {
    const oldest = set.values().next();
    if (!oldest.done) {
      set.delete(oldest.value);
    }
  }
}

export const NOTIFY_QUEUE_LIMIT = MAX_QUEUE;
export const NOTIFY_MEMORY_LIMIT = MAX_REMEMBERED;
export type { NotificationKind };
