/**
 * Which runner honours which schedule, once a server can honour one at all
 * (MAR-795, ADR 0031 decision 4).
 *
 * Pure: no store, no channel, no clock. `electron/agent-adapters.ts` reads the
 * two facts and this decides between them, for `lib/schedule/plan.ts`'s reason —
 * the question *"should this agent's schedule fire here"* is answerable without
 * anything being alive, and a question answerable that way should be answered
 * where a test can ask it.
 *
 * ## The problem this exists to prevent, stated before the rule
 *
 * `install` **copies** an agent to a server; it does not move it. So after a
 * deploy the same agent exists twice, with the same id, registered on two
 * runners — which is why `bring-home` exists at all. Before ADR 0031 that was
 * harmless for schedules, because only one of those two runners had ever been
 * told about any: `POST /schedules` was not on the remote channel, so a host
 * held an empty set forever and DASH's local runner was the only thing that
 * could fire.
 *
 * Admitting the route removes that accident. If DASH pushed the whole set to
 * both, one instruction — *run this agent at eight* — would produce **two runs**,
 * on two machines, at the same minute, each spending against its own broker and
 * each publishing into the same agent's history with nothing on the row to say
 * which machine it came from. `agent_dom_state` already refuses to hold a host's
 * snapshot for the same keying reason (ADR 0014 amendment 1), and run evidence
 * from two machines under one id is the same collision one table over.
 *
 * ## The rule, and why it is keyed on the press rather than on the deploy
 *
 * > **An agent's schedule is honoured by the server it was deployed to, and only
 * > while residency is on for that server. Everywhere else it is honoured here.**
 *
 * The obvious cheaper rule — *deployment delegates the schedule* — was refused,
 * and the reason is that it changes behaviour nobody asked to change. A person
 * who deployed an agent months ago and set a schedule for it has that schedule
 * firing on this machine today; a build that silently moved it to a server would
 * move it to a machine whose scheduled runs **cannot pay for a model call**
 * (ADR 0029 amendment 1, and the host broker's spend allowance needs a Run
 * press). That is a working thing quietly broken by an upgrade.
 *
 * Keying on residency ties the change to a press. Residency off — which is every
 * server until somebody turns it on — leaves the local runner holding exactly
 * what it holds today, and `lib/copy/host-residency.ts` says both halves beside
 * the switch before it is pressed.
 *
 * ## The case this rule does not settle, named rather than left to be found
 *
 * **One agent, two servers, both with residency on.** Both are told, and both
 * fire. It is a state a person can only reach by deploying the same agent to two
 * machines and turning the switch on twice, and two copies running on two
 * servers is arguably what that person asked for — but it is not a decision this
 * rule takes, and `delegationConflicts` names it so a surface can. The exit is a
 * per-agent *which machine runs this* choice, which belongs with the schedule's
 * own settings page rather than with the packet that admitted the route.
 */

import type { AgentSchedule } from "./plan";

/** One server residency is on for, and what it holds. */
export interface ResidentHost {
  host_id: string;
  /**
   * The agents whose copies are on this server right now.
   *
   * DASH's own deploy record with the brought-home ones already removed — not
   * the server's live answer. A partition that depended on a reachable server
   * would flip every time a laptop lost its network, and would flip in the
   * direction that fires a schedule twice.
   */
  agents: readonly string[];
}

/**
 * Split one set of schedules into what each runner is told.
 *
 * `local` is what `POST /schedules` on this machine's socket carries; `byHost`
 * is what each resident server is told over its own channel. Every schedule
 * appears in exactly one of them, which is the property worth having and the one
 * a test can assert directly: a schedule that is in neither is an instruction
 * silently dropped, and one in both is the double-run above.
 *
 * A schedule for an agent on a resident server goes to that server **whether or
 * not it is enabled**. `RunnerSchedule.configure` replaces rather than merges,
 * and `readAgentSchedules` includes disabled rows on purpose, *"because the
 * runner has to be able to see an instruction being withdrawn"* — a disabled
 * schedule dropped from the push would leave the server holding the enabled
 * version it was told last week, across a reboot, forever.
 */
export function splitSchedules(
  schedules: readonly AgentSchedule[],
  hosts: readonly ResidentHost[],
): { local: AgentSchedule[]; byHost: Map<string, AgentSchedule[]> } {
  const owner = new Map<string, string>();
  for (const host of hosts) {
    for (const agent of host.agents) {
      // First writer wins, and `delegationConflicts` reports the rest. Picking a
      // winner silently here would make the two-servers case look decided.
      if (!owner.has(agent)) {
        owner.set(agent, host.host_id);
      }
    }
  }

  const local: AgentSchedule[] = [];
  const byHost = new Map<string, AgentSchedule[]>();
  for (const host of hosts) {
    byHost.set(host.host_id, []);
  }
  for (const schedule of schedules) {
    const where = owner.get(schedule.agent);
    if (where === undefined) {
      local.push(schedule);
      continue;
    }
    byHost.get(where)?.push(schedule);
  }
  return { local, byHost };
}

/**
 * The cursor each runner resumes from, narrowed to what that runner was told.
 *
 * ADR 0029 decision 2's push carries the set *and* the cursor, because that is
 * what lets a runner *"know where to resume from without keeping anything of its
 * own across a restart"*. Sending a server the newest window of every agent in
 * DASH would hand it facts about agents it does not hold — harmless today, and
 * the kind of harmless that stops being harmless the first time somebody joins
 * two ids that happen to match.
 *
 * An agent with no recorded window is absent rather than present with a null:
 * `readScheduleConfiguration` takes a record of strings, and absence already
 * means *nothing has come round yet*.
 */
export function windowsFor(
  since: Readonly<Record<string, string>>,
  schedules: readonly AgentSchedule[],
): Record<string, string> {
  const narrowed: Record<string, string> = {};
  for (const schedule of schedules) {
    const newest = since[schedule.agent];
    if (newest !== undefined) {
      narrowed[schedule.agent] = newest;
    }
  }
  return narrowed;
}

/**
 * Agents whose copies sit on more than one resident server, sorted.
 *
 * Not a refusal and not a filter — reported. The module header explains why:
 * this is a state a person reached with two deliberate presses, the honest
 * answer is not for this function to invent, and a rule that quietly dropped the
 * schedule from every server would produce an agent that runs nowhere, which is
 * worse than one that runs twice and is much harder to notice.
 */
export function delegationConflicts(hosts: readonly ResidentHost[]): string[] {
  const seen = new Map<string, number>();
  for (const host of hosts) {
    for (const agent of new Set(host.agents)) {
      seen.set(agent, (seen.get(agent) ?? 0) + 1);
    }
  }
  return [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([agent]) => agent)
    .sort();
}
