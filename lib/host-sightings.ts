/**
 * What DASH saw when it last asked a server, for the life of this window
 * (MAR-606, ADR 0015).
 *
 * ## Why anything is remembered at all
 *
 * The check lives on the Servers page and the question lives everywhere else.
 * Henrik's ask was about the fleet card:
 *
 * > *"AN agent that is hosted online should have like an icon or somthing on
 * > its fleet card."*
 *
 * A fleet card cannot ask a server anything. Doing so would mean a probe per
 * host on every render of the agents list, which is the polling ADR 0015, the
 * deploy panel's copy and `agentDeployTargets`'s own comment all separately
 * refuse. So the answer a person already asked for is kept, and every surface
 * that draws it draws the same one.
 *
 * ## Why it is not stored
 *
 * ADR 0015, and this is the narrower half of that decision. `agent_deploys` is
 * durable because a deploy is DASH's own act and stays true forever. A sighting
 * is a claim about a machine DASH does not control and begins going stale the
 * instant it is taken — so it lives here, in memory, and is gone on reload.
 *
 * The failure that avoids is specific: a persisted sighting would produce, on
 * the next cold start, an emerald chip and a running-claim about a server DASH
 * has not spoken to since, with a timestamp that makes it *look* accountable
 * while nothing distinguishes "a minute ago" from "last Tuesday, before the
 * server was rebuilt". A person who wants a fresh answer presses Check.
 *
 * ## Pure, and no React in it
 *
 * The same shape `lib/shell/focus-refresh.ts` uses. The store is a plain object
 * with a subscribe/snapshot contract so it can be driven by a test with no
 * jsdom; `app/_data/sightings.ts` is the twelve lines that make it a hook.
 *
 * The snapshot is **referentially stable** until something is recorded, which is
 * not an optimisation — `useSyncExternalStore` re-renders forever if
 * `getSnapshot` returns a new object each call, and a fresh `{}` per read is the
 * commonest way to write that bug.
 */

import type { HostAgentSighting } from "./host-connect";

/** What one check established about one server, and when. */
export interface HostSighting {
  /** What the person calls the server. Carried so a reader needs no second join. */
  label: string;
  /** Every agent the server named, running or not. */
  agents: readonly HostAgentSighting[];
  /** DASH's own clock when the answer arrived. Never when the check began. */
  at: string;
}

/** Every server asked so far this session, by host id. */
export type SightingLog = Readonly<Record<string, HostSighting>>;

export interface SightingStore {
  /**
   * Write down what a server answered.
   *
   * Only ever called with a real reply. There is deliberately no way to record
   * that a check *failed*: a failed check tells you nothing about what is on
   * the machine, and an entry meaning "DASH asked and does not know" would be
   * indistinguishable on a card from one meaning "DASH asked and it was empty".
   * A server that stops answering keeps its last sighting, whose timestamp is
   * what says how much to trust it.
   */
  record(hostId: string, sighting: HostSighting): void;
  /** Forget one server, for `host.forget` — ADR 0010's deletion rule. */
  forget(hostId: string): void;
  /** Stable between writes. See the header. */
  snapshot(): SightingLog;
  /** Returns the unsubscribe, `onWindowFocus`'s contract. */
  subscribe(listener: () => void): () => void;
}

export function createSightingStore(): SightingStore {
  let log: SightingLog = {};
  const listeners = new Set<() => void>();

  function announce(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  return {
    record(hostId, sighting) {
      log = { ...log, [hostId]: sighting };
      announce();
    },
    forget(hostId) {
      if (!(hostId in log)) {
        // No new object and no announcement: forgetting something that was
        // never seen is not a change, and re-rendering every card because a
        // person disconnected an unchecked server is churn with nothing behind
        // it.
        return;
      }
      const next = { ...log };
      delete next[hostId];
      log = next;
      announce();
    },
    snapshot() {
      return log;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Reading it from an agent's side
 * ---------------------------------------------------------------------- */

/**
 * What this session saw of one agent, on the servers DASH sent it to.
 *
 * The join a fleet card needs and the reason it is here rather than in the
 * component: the card knows an agent's name and DASH's own deploy record, the
 * log knows what servers answered, and putting the two together is a decision
 * about evidence rather than about layout.
 *
 * Only servers this agent was **sent** to are considered. A server that named
 * an agent DASH never sent there is a real and interesting state, and it is the
 * *server card's* to report — see `describeWhatIsOnHost`. Surfacing it on the
 * agent's own fleet card would be telling somebody their agent is on a machine
 * DASH has no record of sending it to, which is alarming, unactionable from
 * there, and one bundle-id collision away from being wrong.
 */
export function sightingFor(input: {
  agent: string;
  /** The servers DASH's own record says this agent was sent to. */
  sent_to: readonly { host_id: string; label: string }[];
  log: SightingLog;
}): { label: string; seen: HostAgentSighting | null; at: string } | null {
  /*
   * The newest answer wins when an agent is on more than one server, because a
   * fleet card has room for one line and the freshest evidence is the one worth
   * spending it on. The card links through to the Servers page, which is where
   * all of them are listed.
   */
  let best: { label: string; seen: HostAgentSighting | null; at: string } | null = null;
  for (const target of input.sent_to) {
    const sighting = input.log[target.host_id];
    if (sighting === undefined) {
      continue;
    }
    if (best !== null && sighting.at <= best.at) {
      continue;
    }
    best = {
      label: target.label,
      seen: sighting.agents.find((one) => one.agent_id === input.agent) ?? null,
      at: sighting.at,
    };
  }
  return best;
}
