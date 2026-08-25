/**
 * Setting and clearing a schedule, on the trusted side (MAR-742 item 8,
 * ADR 0029).
 *
 * `electron/notify-settings.ts`'s shape and a fraction of its size, because this
 * command family is the one in DASH's settings surfaces that touches **no
 * credential**: no vault read, no prompt, no window, no bytes on a network. A
 * schedule is an agent id and a time of day.
 *
 * ## Why this is a module and not four lines in `main.ts`
 *
 * `refreshSampleAgent`'s reason, which every settings action in this directory
 * cites: the gate a write needs belongs beside the write rather than at the IPC
 * seam, because a gate stated at the seam is a gate a second implementation
 * could forget. Here that gate is `writeAgentSchedule`'s own refusal of a time
 * this build would not accept — and the refusal it returns is the sentence the
 * page shows, so there is one place that decides what a bad time means.
 *
 * ## What is deliberately not here
 *
 * **No push to the runner.** ADR 0029 decision 2 re-asserts the whole set on the
 * evidence poll, so the runner has the new row within five seconds and a push
 * that failed here would be retried by something else anyway. Putting one here
 * would recreate the shape MAR-745 found: a configuration that reaches the
 * runner only on the events somebody remembered to list.
 *
 * **No run.** Setting a schedule does not start anything, and there is no branch
 * in this file that could. The first fire is the runner's, at the time the
 * person picked.
 */

import type { ScheduleAction } from "../lib/shell/ipc";
import { clearAgentSchedule, writeAgentSchedule } from "../lib/schedule/store";
import { listAgentNames } from "../lib/store";

export function performScheduleAction(
  action: ScheduleAction,
  target: { agent_id: string; at_local?: string },
): { ok: boolean; refusal?: string } {
  const agent = target.agent_id.trim();
  if (agent.length === 0) {
    return { ok: false, refusal: "A schedule has to name an agent." };
  }

  if (action === "clear") {
    /*
     * Not gated on the agent existing, unlike `set` below. Clearing a schedule
     * for an agent DASH no longer knows is the one shape of this command that
     * should always work — it is how a row left behind by a removal that went
     * wrong gets tidied up, and refusing it would leave a schedule alive with no
     * page to turn it off from.
     */
    clearAgentSchedule(agent);
    return { ok: true };
  }

  /*
   * `set` is gated, and on the agent list rather than on the manifest.
   *
   * A schedule for an agent that is not here would be a standing instruction the
   * runner is pushed every five seconds and refuses every time it comes due,
   * filling somebody's history with rows about an agent they cannot see. The
   * check is `listAgentNames` and not `readAgentManifest` because what has to be
   * true is that DASH knows this agent, not that its manifest is currently
   * readable — an agent with a damaged folder is one a person may well want to
   * un-schedule *and* one whose existing schedule should stay set while they
   * repair it.
   */
  if (!listAgentNames().includes(agent)) {
    return { ok: false, refusal: "DASH has no saved setup for that agent." };
  }

  return writeAgentSchedule(agent, target.at_local ?? "", new Date().toISOString());
}
