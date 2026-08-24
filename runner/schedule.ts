/**
 * The scheduler, in the process that outlives the window (MAR-742 item 8,
 * ADR 0029).
 *
 * `runner/chief.ts` is its immediate neighbour and deliberately its shape: thin,
 * because it holds a timer and a database handle, and everything that could be
 * decided somewhere testable is. *When* a window is due, whether it was missed
 * and how many, and the sentence a missed window is recorded with are all
 * `lib/schedule/plan.ts` — pure, clock-injected, and reachable by the test suite
 * without anything having to wait for real minutes.
 *
 * ## Why the scheduler is here and not in main
 *
 * `runner/notify.ts` has the paragraph and it is the same one:
 *
 * > DASH already has exactly one process that survives its window closing.
 * > `electron/runner-process.ts` spawns the runner **detached** … So it is the
 * > only place in the system that can see [this] at a moment when nobody is
 * > looking at DASH, which is the only moment this feature is worth anything.
 *
 * A schedule that fired only while DASH was open would not be a schedule, and
 * `AGENT_TRIGGER_COPY` has told people so on screen since MAR-641. ADR 0029
 * decision 3 also refuses a *second* scheduler in main beside this one: two
 * schedulers with different liveness would make "did my agent run at eight" a
 * question about which process happened to be alive, which is precisely the
 * question this feature exists to answer.
 *
 * ## What a fire actually is
 *
 * ADR 0022's two acts, composed here, exactly as that decision said a cadence
 * would compose them: start the process if there is none, wait for the pending
 * task the kit template publishes on startup, then deliver a `retry` bound to
 * it. **No new verb.** Nothing in the contract, the catalogue or the supervisor
 * learns the word "schedule" — a scheduled run is a `retry` with a different
 * actor, which is what lets every surface that already renders runs render this
 * one.
 *
 * And it goes through `executeCommand`, not through a shortcut to
 * `supervisor.deliver`. `runner/execute.ts`'s header is the reason: the runner
 * validates, checks replay, claims idempotency and writes its own audit row
 * because the threat model says it must, and a second narrower path to "the
 * runner accepted a retry" is how a rule enforcement already makes comes to be
 * bypassed. `applyStandingAnswers` made the same choice for the same reason.
 *
 * ## The actor is not a person
 *
 * `SCHEDULE_PRINCIPAL` asserts `runtime_adapter` and may assert nothing else.
 * `DASH_LOCAL_PRINCIPAL`'s `dash_session` means "the OS user running this copy
 * of DASH", and at 03:00 with the window closed there is no such user — writing
 * one into `runner_audit` would be this file inventing a session to make its own
 * command look ordinary. ADR 0029 decision 5.
 *
 * ## What this file may not do
 *
 * **Open a spend allowance.** It cannot: `allowRunSpend` is main's broker's, the
 * local runner holds no broker of its own, and ADR 0029 decision 6 decides it
 * stays that way. A scheduled run does everything the agent does that does not
 * cost money; a step that needs a model is refused, recorded where every other
 * brokered refusal is, and named in the copy on the settings page rather than
 * discovered.
 *
 * **Write to `dash.sqlite`.** It writes to `schedule_spool` in the runner's own
 * store and DASH drains it. ADR 0028 decision 6, ADR 0027, and the file that was
 * destroyed twice.
 */

import { randomUUID, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { buildEnvelope } from "../lib/agent-dom/envelope";
import {
  decideSchedule,
  missedRowFor,
  type AgentSchedule,
  type ScheduleSettlement,
} from "../lib/schedule/plan";
import { executeCommand, type ChannelPrincipal } from "./execute";
import { buildAgentDomState } from "./state";
import type { Supervisor } from "./supervisor";

/**
 * The channel a scheduled command stands under.
 *
 * Its own principal rather than `DASH_LOCAL_PRINCIPAL` widened, so that
 * `may_assert` stays a closed statement about each channel: this one may assert
 * a runtime and nothing else, and the local shell may assert a session and
 * nothing else. A single principal permitting both would let either path claim
 * either, which is the check `runner/execute.ts` step 1 exists to be.
 */
export const SCHEDULE_PRINCIPAL: ChannelPrincipal = {
  channel_id: "dash-schedule",
  may_assert: ["runtime_adapter"],
};

/**
 * How often the loop looks.
 *
 * Thirty seconds. The grace window in `lib/schedule/plan.ts` is five minutes, so
 * this is ten times finer than the thing it has to catch — a tick can be skipped
 * entirely, or run a minute late on a loaded machine, and the window still
 * fires rather than being recorded as missed.
 *
 * Not one second: a scheduler that wakes sixty times a minute for a fleet of
 * three agents is a battery cost with nothing to show for it, and the resolution
 * a person can even express is one minute.
 */
export const SCHEDULE_TICK_MS = 30_000;

/**
 * How long the runner waits for a freshly started agent to publish its pending
 * task, expressed as **how many times it looks** rather than as a deadline.
 *
 * Eighty looks a quarter of a second apart, so twenty seconds in the runner. The
 * kit template opens `waiting-to-be-run` as it starts, so the ordinary case is
 * one or two looks; this is slack for a cold Node start on a machine that has
 * just woken up. An agent that has published nothing by then is settled as
 * `refused` and says so, rather than leaving a window with no row — a schedule
 * that reports nothing is indistinguishable from a schedule that is not running.
 *
 * ## Why a count and not a deadline
 *
 * The obvious implementation compares `now()` against a deadline, and it is
 * wrong here in a way that only shows up where it matters. `now` is **injected**,
 * because every scheduling decision in this file has to be reachable at a moment
 * a test can name — and a clock that a caller can hold still is a clock a
 * deadline can never be reached on. The first version of this loop spun forever
 * against a frozen clock.
 *
 * Reaching for `Date.now()` here instead would fix the hang and reintroduce the
 * thing the injection exists to avoid: two clocks in one file, one of them
 * unmockable. Counting looks has neither problem — the bound is the injected
 * `sleep`, which the same caller already controls, and the duration is a
 * property of the pair rather than of a second time source.
 */
const PENDING_TASK_LOOKS = 80;
const PENDING_TASK_POLL_MS = 250;

/**
 * How many settled windows may wait for DASH to open.
 *
 * `chief_turn_spool`'s bound and its reasoning, at a tenth the size because
 * these rows are one a day rather than one a message. Dropping the **oldest**: a
 * person who comes back after a fortnight wants the recent history, and the
 * fortnight-old miss is the least interesting row in it.
 */
const MAX_SPOOLED_WINDOWS = 200;

/** What main pushes: the whole set, every time. ADR 0029 decision 2. */
export interface ScheduleConfiguration {
  schedules: AgentSchedule[];
  /** Newest window DASH already has a record of, by agent id. */
  since: Record<string, string>;
}

export interface RunnerScheduleOptions {
  /** The runner's store, or null while it is damaged. Resolved per use. */
  database: () => DatabaseSync | null;
  supervisor: Supervisor;
  log: (line: string) => void;
  now?: () => Date;
  /** Injected so tests do not spend real seconds waiting for a task. */
  sleep?: (ms: number) => Promise<void>;
}

export class RunnerSchedule {
  #configuration: ScheduleConfiguration = { schedules: [], since: {} };
  #timer: NodeJS.Timeout | null = null;
  #stopped = false;
  /**
   * True while a fire is in flight.
   *
   * A serial gate rather than a queue, `RunnerChief`'s `#busy` and its argument:
   * a tick that arrived while the previous one was still waiting out
   * `PENDING_TASK_TIMEOUT_MS` must not start a second agent, and the honest
   * behaviour is to let the next tick thirty seconds later find the same window
   * still due.
   */
  #firing = false;

  /**
   * Windows this process has already settled, by agent.
   *
   * In memory and deliberately not durable: the durable cursor is `since`, which
   * DASH pushes from `agent_schedule_runs`. This exists only to stop a window
   * being fired twice in the gap between the spool write and the next push —
   * which for a five-second poll is at most one tick, and for a DASH that is
   * closed is the entire time it stays closed.
   */
  readonly #settled = new Map<string, string>();

  readonly #options: RunnerScheduleOptions & { now: () => Date; sleep: (ms: number) => Promise<void> };

  constructor(options: RunnerScheduleOptions) {
    this.#options = {
      ...options,
      now: options.now ?? (() => new Date()),
      sleep:
        options.sleep ??
        ((ms) =>
          new Promise((resolve) => {
            const timer = setTimeout(resolve, ms);
            timer.unref?.();
          })),
    };
  }

  /**
   * Take the current set.
   *
   * Replaces rather than merges, because the push is the whole set every time
   * and a merge would leave a schedule the person deleted alive in this process
   * forever. `readAgentSchedules` includes disabled rows for exactly this
   * reason — the runner has to be able to see an instruction being withdrawn.
   */
  configure(configuration: ScheduleConfiguration): void {
    this.#configuration = configuration;
    /*
     * Forget what this process settled for an agent DASH now agrees about.
     * Without this the in-memory guard would grow for the life of the runner and
     * would go on suppressing a window after the person cleared the history it
     * was protecting.
     */
    for (const [agent, due] of this.#settled) {
      const known = configuration.since[agent];
      if (known !== undefined && known >= due) {
        this.#settled.delete(agent);
      }
    }
  }

  /** Whether anything is standing, for `/health` and for the tests. */
  describe(): { schedules: number; enabled: number; spooled: number } {
    return {
      schedules: this.#configuration.schedules.length,
      enabled: this.#configuration.schedules.filter((schedule) => schedule.enabled).length,
      spooled: this.#count(),
    };
  }

  start(): void {
    if (this.#timer !== null || this.#stopped) {
      return;
    }
    const loop = (): void => {
      void this.tick().finally(() => {
        if (!this.#stopped) {
          this.#timer = setTimeout(loop, SCHEDULE_TICK_MS);
          this.#timer.unref?.();
        }
      });
    };
    this.#timer = setTimeout(loop, SCHEDULE_TICK_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * One pass. Public so a test can drive it without a timer, and so the proof
   * harness can too.
   */
  async tick(): Promise<void> {
    if (this.#stopped || this.#firing) {
      return;
    }
    const now = this.#options.now();

    for (const schedule of this.#configuration.schedules) {
      if (this.#stopped) {
        return;
      }
      const since = this.#since(schedule.agent);
      const decision = decideSchedule(schedule, since, now);

      if (decision.kind === "idle") {
        continue;
      }

      if (decision.kind === "missed") {
        this.#spool(missedRowFor(schedule.agent, decision.due_at, decision.count, now));
        this.#settled.set(schedule.agent, decision.due_at.toISOString());
        continue;
      }

      this.#firing = true;
      try {
        const settlement = await this.#fire(schedule.agent, decision.due_at);
        this.#spool(settlement);
        this.#settled.set(schedule.agent, decision.due_at.toISOString());
      } finally {
        this.#firing = false;
      }
      /*
       * One agent per tick. Two agents scheduled for the same minute would
       * otherwise both start inside one pass, each waiting out its own cold
       * start; the next tick is thirty seconds away and the grace window is five
       * minutes, so the second one still fires and still fires on time.
       */
      return;
    }
  }

  /**
   * The cursor for one agent: the later of what DASH knows and what this process
   * has done since the last push.
   *
   * String comparison on ISO 8601, which is ordered lexicographically for any two
   * stamps `toISOString` produced — both sides of this are, so there is nothing
   * here for a locale or a parser to disagree about.
   */
  #since(agent: string): Date | null {
    const pushed = this.#configuration.since[agent];
    const local = this.#settled.get(agent);
    const newest =
      pushed === undefined ? local : local === undefined ? pushed : pushed > local ? pushed : local;
    if (newest === undefined) {
      return null;
    }
    const parsed = new Date(newest);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /* -------------------------------------------------------------------- *
   * One fire
   * -------------------------------------------------------------------- */

  /**
   * ADR 0022's two acts, in order.
   *
   * Every exit is a settlement. There is no path through this function that
   * returns nothing, because a window with no row is a window a person cannot
   * tell from a scheduler that is not running — and ADR 0029's whole claim is
   * that DASH says what happened while nobody was watching.
   */
  async #fire(agent: string, due: Date): Promise<ScheduleSettlement> {
    const refused = (detail: string): ScheduleSettlement => ({
      agent,
      due_at: due.toISOString(),
      settled_at: this.#options.now().toISOString(),
      outcome: "refused",
      detail,
    });

    const database = this.#options.database();
    if (database === null) {
      return refused(
        "The runner's own records could not be read, so it started nothing. Open DASH and set them aside to repair it.",
      );
    }

    // Act one. `already_running` is not a failure here — an agent that is
    // already up is an agent there is nothing to start, and the second act is
    // the one that matters. Asked for unconditionally rather than gated on the
    // lifecycle this process last recorded: the supervisor holds the child
    // handle and is the only thing that can answer without a race.
    if (this.#options.supervisor.facts(agent) === null) {
      return refused("DASH has no registered setup for this agent on this computer.");
    }
    const started = this.#options.supervisor.start(agent);
    if (!started.ok && started.problem !== "already_running") {
      return refused(started.detail);
    }

    // Act two, once there is something to bind to.
    const task = await this.#waitForPendingTask(agent);
    if (task === null) {
      return refused(
        "The agent started but did not publish anything to run, so DASH had nothing to begin.",
      );
    }

    const now = this.#options.now();
    const envelope = buildEnvelope({
      command: "retry",
      target: { agent_id: agent, task_id: task.task_id },
      /*
       * The actor, and every field of it is deliberate. `service`, because
       * nobody is at the keyboard; `runtime_adapter`, because that is what
       * authenticated it; and an id that names the schedule rather than a
       * person, so `runner_audit` can be read afterwards and a scheduled run is
       * distinguishable from a pressed one by a column and not by inference.
       */
      actor: {
        id: "dash-schedule",
        type: "service",
        authenticated_by: "runtime_adapter",
        display_name: "Scheduled by DASH",
      },
      observed_at: task.observed_at,
      reason: `Started by this agent's daily schedule, due ${due.toISOString()}.`,
      correlation_id: `schedule-${randomUUID()}`,
      command_id: randomUUID(),
      nonce: randomBytes(16).toString("hex"),
      now,
    });

    const result = await executeCommand(envelope, {
      database,
      supervisor: this.#options.supervisor,
      principal: SCHEDULE_PRINCIPAL,
      now: this.#options.now,
    });

    if (!result.ok) {
      return refused(
        `The runner refused to start this run (${result.reason ?? "unknown"}): ${result.detail ?? "no detail"}`,
      );
    }
    return {
      agent,
      due_at: due.toISOString(),
      settled_at: this.#options.now().toISOString(),
      outcome: "ran",
      detail: "Started on time by this agent's daily schedule.",
    };
  }

  /**
   * Wait for the agent to publish a pending task with no run attached.
   *
   * The same predicate `buildAgentControl` uses for Run now, and it has to stay
   * the same one: *"a pending task with no run attached is what 'there is
   * something to start' means in the Agent DOM"*. A scheduler that widened it
   * would deliver a `retry` the supervisor answers with a refusal, which is the
   * after-the-press failure that module refuses to create — arriving at 03:00
   * where nobody can see it.
   */
  async #waitForPendingTask(
    agent: string,
  ): Promise<{ task_id: string; observed_at: string } | null> {
    for (let look = 0; look < PENDING_TASK_LOOKS; look += 1) {
      const facts = this.#options.supervisor.facts(agent);
      if (facts !== null) {
        const state = buildAgentDomState(
          facts,
          this.#options.supervisor.report(agent),
          this.#options.now(),
        );
        const tasks = Array.isArray(state["tasks"]) ? (state["tasks"] as unknown[]) : [];
        for (const raw of tasks) {
          if (typeof raw !== "object" || raw === null) {
            continue;
          }
          const task = raw as Record<string, unknown>;
          if (task["status"] === "pending" && (task["run_id"] ?? null) === null) {
            const id = task["id"];
            if (typeof id === "string" && id.length > 0) {
              return { task_id: id, observed_at: String(state["observed_at"] ?? "") };
            }
          }
        }
      }
      if (this.#stopped) {
        return null;
      }
      await this.#options.sleep(PENDING_TASK_POLL_MS);
    }
    return null;
  }

  /* -------------------------------------------------------------------- *
   * The spool
   * -------------------------------------------------------------------- */

  #count(): number {
    const database = this.#options.database();
    if (database === null) {
      return 0;
    }
    try {
      const row = database.prepare("SELECT COUNT(*) AS n FROM schedule_spool").get() as
        | { n?: number }
        | undefined;
      return Number(row?.n ?? 0);
    } catch {
      return 0;
    }
  }

  #spool(settlement: ScheduleSettlement): void {
    const database = this.#options.database();
    if (database === null) {
      // Logged rather than swallowed: a window nobody can ever read about is the
      // failure this whole feature is against, and the runner saying so on its
      // own stderr is the only record left.
      this.#options.log(
        `[runner] ${settlement.agent}'s scheduled window at ${settlement.due_at} settled as ` +
          `${settlement.outcome} and could not be written down: the runner's records are unreadable`,
      );
      return;
    }
    try {
      database
        .prepare(
          "INSERT INTO schedule_spool (agent, due_at, settled_at, outcome, detail) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          settlement.agent,
          settlement.due_at,
          settlement.settled_at,
          settlement.outcome,
          settlement.detail,
        );
      database
        .prepare(
          "DELETE FROM schedule_spool WHERE id NOT IN " +
            "(SELECT id FROM schedule_spool ORDER BY id DESC LIMIT ?)",
        )
        .run(MAX_SPOOLED_WINDOWS);
    } catch (error: unknown) {
      this.#options.log(
        `[runner] ${settlement.agent}'s scheduled window could not be spooled: ${describeError(error)}`,
      );
    }
  }

  /**
   * Hand DASH everything settled since it last asked, and forget it.
   *
   * Read-then-delete in one transaction, `RunnerChief.drain`'s pattern and its
   * reason: a drain interrupted between the two would otherwise lose the rows,
   * and these rows are the only account of what happened while DASH was closed.
   */
  drain(): ScheduleSettlement[] {
    const database = this.#options.database();
    if (database === null) {
      return [];
    }
    try {
      database.exec("BEGIN IMMEDIATE");
      const rows = database
        .prepare("SELECT agent, due_at, settled_at, outcome, detail FROM schedule_spool ORDER BY id")
        .all()
        .map((raw) => {
          const row = raw as Record<string, unknown>;
          const outcome = String(row["outcome"] ?? "");
          return {
            agent: String(row["agent"] ?? ""),
            due_at: String(row["due_at"] ?? ""),
            settled_at: String(row["settled_at"] ?? ""),
            outcome:
              outcome === "ran" || outcome === "missed" || outcome === "refused"
                ? outcome
                : ("refused" as const),
            detail: String(row["detail"] ?? ""),
          } satisfies ScheduleSettlement;
        });
      database.exec("DELETE FROM schedule_spool");
      database.exec("COMMIT");
      return rows;
    } catch (error: unknown) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // No transaction was open. Nothing to undo.
      }
      this.#options.log(`[runner] the schedule spool could not be drained: ${describeError(error)}`);
      return [];
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
