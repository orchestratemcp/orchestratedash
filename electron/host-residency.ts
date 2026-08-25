/**
 * The press that makes a server come back by itself, and the push that gives it
 * something to come back to (MAR-795, ADR 0031).
 *
 * ## Two halves, one file, because neither is worth anything alone
 *
 * ADR 0030 found this the hard way on the other machine, before shipping: a
 * login entry that started a runner holding no schedules *"exists, and it does
 * nothing"*, and the packet had to decide both halves. The same is true here and
 * more sharply, because a server is a machine nobody opens — so the boot entry
 * and the standing set are one feature and are turned on by one switch.
 *
 * - `setHostResidency` is the switch. It sends the `service` verb, reads back
 *   what the server's own service manager says, and records the press.
 * - `pushHostSchedules` is the standing set. It reaches that server's runner on
 *   the control plane and hands over the whole set — every push, never on a
 *   change — for ADR 0029 decision 2's reason, quoted in `runner/schedule.ts`.
 *
 * ## Why the push is not on a five-second timer
 *
 * `electron/agent-adapters.ts` re-asserts the local set twelve times a minute
 * over a Unix socket, and ADR 0029 decision 2's argument for that cadence is
 * that a total re-assertion has no closed list of events somebody must widen
 * correctly forever. That argument is about *the shape*, not about the number,
 * and the number does not survive the transport: reaching a host is two `ssh`
 * children — `channel` for the runner's own session secret, then `connect` for
 * the pipe — which is two process spawns and two key exchanges per push. Twelve
 * times a minute per server is a cost a person pays on their own laptop, in
 * their own battery, for a document that changes when they edit a schedule.
 *
 * So the push rides the acts that already reach that server: turning residency
 * on, checking the server, and pressing Run on an agent there. Each is a
 * person's press and each re-asserts the **whole** set, so the property ADR 0029
 * wanted is kept and only the frequency changes. What covers the gap between
 * presses is the thing this packet is for: the server keeps what it was last
 * told, across a reboot, in `schedule_standing`. And the card says when it was
 * last told rather than implying it is current —
 * `describeSchedulesTold`, which is ADR 0014's third admission question answered
 * on screen.
 *
 * ## What this file never does
 *
 * **It does not reach `/broker/drain` or `/broker/responses`**, and it could not:
 * `sshHostChannel` returns a `RemoteRunnerChannel`, whose parameter does not
 * carry `BrokerRoute`, so the mistake ADR 0007 predicts is a compile error here
 * rather than a review nobody scheduled.
 *
 * **It does not store the server's session secret.** `electron/host-run.ts`'s
 * rule: fetched per act, spent, dropped. There is no member of anything this
 * module returns that one could travel in.
 */

import {
  readResidentHosts,
  recordHostResidency,
  recordHostSchedulesTold,
  forgetHostResidency,
} from "../lib/store";
import { splitSchedules, windowsFor } from "../lib/schedule/delegation";
import {
  newestScheduleWindows,
  readAgentSchedules,
  recordScheduleRuns,
} from "../lib/schedule/store";
import { describeHostPackTooOld } from "../lib/copy/host-pack";
import { describeResidencyRefusal } from "../lib/copy/host-residency";
import type { HostServiceAction, HostServiceReport } from "../lib/deploy/service-unit";
import type { AgentSchedule, ScheduleSettlement } from "../lib/schedule/plan";
import type { HostRecord } from "../lib/hosts";
import type { RemoteRunnerChannel } from "../lib/agent-dom/runner-channel";
import { classifyHostFailure } from "../lib/host-connect";
import {
  runDeployVerb,
  sshDeploySpawn,
  sshHostChannel,
  type SshDiagnostics,
} from "./ssh-host";

/** What DASH learned, or why it could not ask. */
export type HostResidencyRead =
  | { ok: true; report: HostServiceReport }
  | { ok: false; detail: string };

/**
 * Ask one server what it does when it restarts.
 *
 * A read, and it writes nothing anywhere — not on the server and not in this
 * store. That is what makes it safe to call from the same place a Check already
 * calls, and it is why `ServiceRequest.action` is a closed set with `status` in
 * it rather than a boolean that would have made reading require a write.
 *
 * The pack is not proved first, and that is deliberate rather than an omission.
 * `install-key` proves it because a key written beside an absent wrapping key is
 * a key nothing can read; a boot entry has nothing to do with the secret store,
 * and coupling them would make a host with a half-written pack unable to answer
 * a question that has a perfectly good answer. What a helper too old to know the
 * verb answers is `unknown_verb`, and that is mapped to the shipped
 * `host_pack_too_old` sentence below, because the exit is the same one: run the
 * setup step for that server again.
 */
export async function readHostResidencyState(
  record: HostRecord,
  dataDir: string,
): Promise<HostResidencyRead> {
  return await askService(record, dataDir, "status");
}

/**
 * Turn it on, or off, and write down that somebody did.
 *
 * ## The order, and it is the whole of the failure design
 *
 * **On:** the server is asked first and the row is written only after it agreed.
 * A row written on the attempt would start excluding that agent from the local
 * runner's push — so a failed enable would produce an agent that fires nowhere,
 * silently, which is the one outcome worse than firing twice.
 *
 * **Off:** the server is asked first and the row is deleted only after it
 * agreed, for the mirror reason. A row deleted on the attempt would resume local
 * firing while the server's entry was still enabled, which is the double-run
 * ADR 0031 decision 4 exists to prevent, arrived at from the other side.
 *
 * Both orders reduce to one sentence: **DASH's record follows the server, never
 * leads it.**
 */
export async function setHostResidency(
  record: HostRecord,
  dataDir: string,
  on: boolean,
): Promise<HostResidencyRead> {
  const answered = await askService(record, dataDir, on ? "enable" : "disable");
  if (!answered.ok) {
    return answered;
  }
  if (on) {
    recordHostResidency(record.host_id);
  } else {
    forgetHostResidency(record.host_id);
  }
  return answered;
}

async function askService(
  record: HostRecord,
  dataDir: string,
  action: HostServiceAction,
): Promise<HostResidencyRead> {
  // Collected by `openSshChannel` and never rendered: its text names this
  // machine's key location. `electron/host-install-key.ts` keeps the same rule.
  const diagnostics: SshDiagnostics = { stderr: "" };
  let answer;
  try {
    answer = await runDeployVerb(sshDeploySpawn(record, dataDir, diagnostics), {
      verb: "service",
      action,
    });
  } catch {
    // `assertHostKeyProtected` throws with a message that can name a local path.
    return { ok: false, detail: "DASH could not prepare the key for this server." };
  }
  if (!answer.ok) {
    /*
     * A helper that predates this verb answers `unknown_verb` without anybody
     * having written that branch — `checkDeployRequest` refuses a verb its own
     * bytes do not list. That is the same fact `pack` reports as
     * `host_pack_too_old`, with the same exit, so it is said with the same
     * sentence rather than with a second one a person would have to reconcile.
     */
    if (answer.problem === "unknown_verb") {
      return { ok: false, detail: describeHostPackTooOld(record.label) };
    }
    const reach = classifyHostFailure({
      stderr: diagnostics.stderr,
      pinned: record.host_fingerprint !== null,
    });
    return {
      ok: false,
      detail: reach === null ? describeResidencyRefusal(answer.problem) : answer.detail,
    };
  }
  if (answer.verb !== "service") {
    // A well-formed answer to a different question, reported rather than read
    // for fields it may not have — `installKeyOnHost`'s direction, and the safe
    // one: the cost of being wrong here is one repeated press.
    return { ok: false, detail: "The server answered something DASH could not read." };
  }
  return {
    ok: true,
    report: {
      state: answer.state,
      starts_at_boot: answer.starts_at_boot,
      units: answer.units,
    },
  };
}

/**
 * Hand one bundle's runner the standing instructions for the agent it holds.
 *
 * ## One runner per bundle, so one push per bundle
 *
 * A host does not run *a* runner; `start` spawns one **per bundle**, in that
 * bundle's own directory, with that bundle's own data directory and its own
 * `runner.sqlite`. So a push carrying the whole host's schedules would hand
 * agent X's runner an instruction about agent Y, which its supervisor refuses —
 * *"DASH has no registered setup for this agent on this computer"* — and spools
 * a refusal settlement that drains home as a run that never happened.
 *
 * `pushResidentSchedules` below is therefore a loop over bundles, and it pushes
 * to **every** resident bundle including ones whose agent has no schedule at
 * all. `RunnerSchedule.configure` replaces rather than merges, so an empty set
 * is how a withdrawn schedule reaches a machine — and a bundle skipped because
 * there was nothing to say would go on honouring what it was told last month,
 * across every reboot, forever.
 *
 * ## Drain first, then push — and the order is load-bearing
 *
 * `electron/agent-adapters.ts` gives the argument for the local pair and it
 * holds unchanged here: the push replaces what the runner holds **including the
 * cursor it resumes from**, so pushing before draining would hand it a `since`
 * computed without the rows still sitting in its own spool. Emptying the queue
 * before refilling the process is the ordering that stays true.
 *
 * On a server it matters more than it does locally, because that spool can hold
 * everything that happened since the last time anybody opened DASH — which is
 * the whole point of the feature.
 *
 * ## Nothing here throws
 *
 * A server that could not be reached leaves DASH exactly as it was: the rows
 * stay in its spool, its standing set stays whatever it was last told, and the
 * next press tries again. The caller gets `false`, which
 * `describeSchedulesTold` renders as the *previous* date — unchanged, rather
 * than a claim about a push that did not land.
 */
export async function pushHostSchedules(
  record: HostRecord,
  agentId: string,
  dataDir: string,
  schedules: readonly AgentSchedule[],
  since: Readonly<Record<string, string>>,
  log: (line: string) => void = (line) => {
    console.warn(line);
  },
): Promise<boolean> {
  let channel: RemoteRunnerChannel;
  try {
    const answered = await runDeployVerb(sshDeploySpawn(record, dataDir), {
      verb: "channel",
      bundle_id: agentId,
    });
    if (!answered.ok || answered.verb !== "channel") {
      return false;
    }
    channel = sshHostChannel({ record, dataDir, bundle_id: agentId, token: answered.token });
  } catch {
    return false;
  }

  try {
    const drained = await channel.call("/schedules/drain", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
    if (drained.ok) {
      const body = (await drained.json()) as { settled?: ScheduleSettlement[] };
      const written = recordScheduleRuns(body.settled ?? []);
      if (written > 0) {
        // Said once per drain and only when something arrived. These are the
        // runs nobody was there for, on a machine nobody was watching, and a
        // line in the log is the first place somebody debugging "did it run
        // while I was away" will look.
        log(
          `[dash-shell] took ${String(written)} scheduled window(s) ${record.label} settled while DASH was closed`,
        );
      }
    }
  } catch {
    // A drain that failed loses nothing, because nothing was deleted.
  }

  try {
    const pushed = await channel.call("/schedules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schedules, since }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!pushed.ok) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Tell one server everything it needs to know, one bundle at a time.
 *
 * The whole set for that host, partitioned by `splitSchedules` and then split
 * again per bundle — see `pushHostSchedules` for why the second split is not
 * optional. Every bundle the host holds is pushed to, including ones with
 * nothing scheduled, because an empty set is how a withdrawal travels.
 *
 * ## What is recorded, and when
 *
 * `recordHostSchedulesTold` runs after the loop and only when **at least one**
 * bundle answered. The column is DASH's record of its own act — *when this
 * server was last told* — and writing it on an attempt would put a date on the
 * card for a push that never landed, which is the class of claim
 * `recordKeyPlacement` refuses to make one verb over. The count is the number of
 * schedules that reached the machine, so `describeSchedulesTold` can say *DASH
 * last told this server about 2 scheduled times, on 25 August 2026* rather than
 * counting bundles nobody asked about.
 *
 * Returns nothing. Every caller here is a press whose outcome is about something
 * else — turning residency on, or checking a server — and a push that could not
 * land is reported by the card's own freshness sentence staying where it was,
 * which is the honest rendering of *DASH has not managed to tell it since*.
 */
export async function pushResidentSchedules(
  record: HostRecord,
  dataDir: string,
  log?: (line: string) => void,
): Promise<void> {
  const resident = readResidentHosts().find((one) => one.host_id === record.host_id);
  if (resident === undefined) {
    // Residency is off for this server. Not an error and not a refusal: the
    // press that reaches this is a Check, which happens on every server.
    return;
  }
  const mine = splitSchedules(readAgentSchedules(), readResidentHosts()).byHost.get(
    record.host_id,
  );
  const forHost = mine ?? [];
  const since = newestScheduleWindows();

  let told = 0;
  let reached = false;
  for (const agent of resident.agents) {
    const forBundle = forHost.filter((schedule) => schedule.agent === agent);
    const landed = await pushHostSchedules(
      record,
      agent,
      dataDir,
      forBundle,
      windowsFor(since, forBundle),
      log,
    );
    if (landed) {
      reached = true;
      told += forBundle.length;
    }
  }
  if (reached) {
    recordHostSchedulesTold(record.host_id, told);
  }
}
