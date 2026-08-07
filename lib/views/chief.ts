/**
 * The Chief's view of the fleet (MAR-419).
 *
 * Built from the *views* rather than from the store, which is the one
 * unusual thing about this module and is deliberate. `agentsView`, `inboxView`
 * and `runsView` are already the projections both hosts agree on and are already
 * tested; a Chief reading `readStore()` directly would be a fourth answer to
 * "what agents are there", free to disagree with the page the user just came
 * from. Every number in the side rail is therefore a number that is already on
 * another screen, which is what makes it checkable.
 *
 * `capabilities` is the one thing no existing view carried, because until now
 * nothing needed the declared route as a *set*. It comes off the manifest,
 * which is where the author declared it.
 */

import type { ChiefFleet } from "../chief/route";
import type { StoreShape } from "../store";
import { readStore } from "../store";
import { agentsView, runsView, workInboxView } from "./build";

/**
 * Everything the Chief is allowed to know.
 *
 * Note what is absent: no run history, no verdicts, no artifact bodies, no
 * telemetry. MAR-419's routing rule forbids inferring capability from telemetry,
 * and the cheapest way to keep a rule like that is to not hand the module the
 * data it would need to break it. The side rail's three numbers are counts and
 * a timestamp — nothing an agent wrote reaches this structure at all, except
 * `goal`, which is the author's declaration and is marked as such everywhere it
 * travels.
 */
export function chiefFleet(store: StoreShape = readStore()): ChiefFleet {
  const agents = agentsView(store);
  // `workInboxView` reads the store itself and takes a clock rather than a
  // store, because expiry is a function of now. Left as it is rather than
  // widened for this caller: a second parameter added for one consumer is how a
  // signature stops describing what a function is for.
  const inbox = workInboxView();
  const runs = runsView(store);

  return {
    agents: agents.agents.map((agent) => ({
      name: agent.name,
      goal: agent.goal,
      avatar: agent.avatar,
      capabilities: (store.agents[agent.name]?.manifest?.planned_route ?? [])
        .slice()
        .sort((a, b) => a.step - b.step)
        .map((entry) => entry.component_id),
    })),
    counts: {
      agents: agents.agents.length,
      waiting: inbox.items.length,
      last_evidence_at: runs.evidence?.last_looked_at ?? null,
    },
  };
}
