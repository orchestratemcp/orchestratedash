/**
 * The window in which the broker was shut and something could still have asked
 * (MAR-467, ADR 0005).
 *
 * ## What kind of fact this is
 *
 * The other two ways a brokered request goes untraced were *observed by
 * somebody*. The runner watched its own buffer destroy a request; DASH watched
 * an answer fail to reach a child. This one was observed by nobody, by
 * construction: the broker lives in Electron main because the vault does, so
 * while DASH is closed there is no broker to notice anything, and the requests
 * an agent made in that time exist only in the agent's own memory.
 *
 * So there is nothing here to record as an attempt, and this module deliberately
 * does not invent one. What DASH can state is narrower and entirely its own:
 * **DASH was not running between these two times.** That is a fact about DASH's
 * uptime, which DASH observes perfectly well by noticing, on starting, that it
 * last wrote a heartbeat some time ago.
 *
 * Everything a user actually wants to know is then *derived* rather than stored:
 * which agents that window mattered for depends on whose runtime keeps running
 * while DASH is closed, and that answer changes when a manifest changes. Storing
 * it would freeze it.
 *
 * ## Why the runner has to have spanned the window
 *
 * DASH is closed far more often than anything interesting happens. A window in
 * which nothing was running is not a lapse, it is a night, and recording one per
 * launch would bury the windows that matter under the ones that never could.
 *
 * The test is exact rather than heuristic: DASH *adopted* a runner — it attached
 * to a process that was already up rather than spawning a fresh one — and that
 * runner reports having started at or before DASH's last heartbeat. Those two
 * together mean one process was alive at the start of the window and is alive
 * now, so it was alive throughout. A spawned runner fails the test because there
 * was nothing to spawn to; a runner started *during* the window fails it because
 * DASH cannot see when in the window it started, and a lapse claiming more
 * darkness than can be shown is the failure this whole issue is about.
 */

/** DASH's own uptime facts, as known at the moment of starting up. */
export interface UptimeObservation {
  /**
   * The last heartbeat DASH wrote before this launch, or null on a first run or
   * a store that has never held one.
   */
  last_alive_at: string | null;
  /** This launch. */
  now: string;
  /** True when DASH attached to a runner that was already up. */
  runner_adopted: boolean;
  /** The adopted runner's own report of when it started, if it gave one. */
  runner_started_at: string | null;
}

export interface ClosedWindow {
  from_at: string;
  until_at: string;
}

/**
 * The shortest gap worth calling an absence.
 *
 * A restart is not a lapse. Below this, DASH was down for about as long as it
 * takes to relaunch it, and an agent's own brokered call would have to land in a
 * window narrower than the retry it is already entitled to. The threshold buys
 * signal: a page listing every restart is a page nobody reads, which is the same
 * failure as a page listing nothing.
 */
export const MIN_CLOSED_WINDOW_MS = 60_000;

/**
 * The window DASH can honestly say it was closed for, or null.
 *
 * Null is the common answer and is not a failure. It means one of: this is a
 * first run, DASH was only down for a moment, or nothing was running while it
 * was down — and in each case there is no fact here worth a row.
 */
export function closedWindow(observation: UptimeObservation): ClosedWindow | null {
  const { last_alive_at: lastAlive, now, runner_adopted: adopted, runner_started_at: runnerStarted } =
    observation;

  if (lastAlive === null || !adopted || runnerStarted === null) {
    return null;
  }

  const from = Date.parse(lastAlive);
  const until = Date.parse(now);
  const runnerFrom = Date.parse(runnerStarted);
  if (Number.isNaN(from) || Number.isNaN(until) || Number.isNaN(runnerFrom)) {
    // An unparseable timestamp is not an excuse to guess. A window with a made-up
    // boundary would be a claim about a period DASH cannot actually delimit.
    return null;
  }

  if (until - from < MIN_CLOSED_WINDOW_MS) {
    return null;
  }

  // The runner must have been up already when DASH stopped. Started later and
  // DASH cannot say when within the window, so it cannot say how much of the
  // window it was there for.
  if (runnerFrom > from) {
    return null;
  }

  // A clock that moved backwards — a manual change, a VM resume, a DST-naive
  // write — would otherwise produce a window that ends before it starts.
  if (until <= from) {
    return null;
  }

  return { from_at: lastAlive, until_at: now };
}
