/**
 * Telling two agents apart when their authors gave them the same name
 * (MAR-877, UX-3).
 *
 * ## The defect this exists for
 *
 * Settings → Connections drew two rows under Gmail, both reading **Meeting
 * Assistant**, both NOT CONNECTED, with a Connect control each. There is no way
 * to know which is which, and the two presses do different things: a grant is
 * keyed per agent, so connecting one leaves the other exactly as it was.
 *
 * ## Why a suffix and not the id
 *
 * MAR-589's ruling is that a display name is the name and an id is a value:
 * every surface that labels an agent says the name, and a surface that needs
 * the id renders it in a value slot rather than as a label. This does not break
 * that. The suffix is the agent's **folder**, humanised the way
 * `humanizeAgentName` humanises a missing display name — *"Meeting assistant
 * two"*, not `meeting-assistant-2` — so it is readable as words and carries no
 * raw identifier onto a guided surface.
 *
 * ## Only where it is needed
 *
 * An agent whose name nobody shares gets no suffix. A suffix on a unique name
 * is DASH explaining a distinction the reader cannot see the need for, and the
 * cost is paid by every row on the page rather than by the two that are
 * ambiguous.
 *
 * A suffix that would repeat the title says nothing either, so it is dropped
 * too: two agents both called *Meeting Assistant* whose folders are also both
 * `meeting-assistant` cannot be told apart by anything DASH holds, and drawing
 * the same words twice would claim they can.
 */

import { humanizeAgentName } from "../copy/agent-name";

/** One agent, as any list on a settings surface holds it. */
export interface AgentIdentity {
  /** The agent's own folder name. Never rendered as a label. */
  name: string;
  /** The name a person reads — `agentDisplayName`'s answer. */
  title: string;
}

export interface AgentLabel extends AgentIdentity {
  /**
   * The muted words drawn after the title, or null when the title stands alone.
   *
   * Null is the ordinary case and is why callers can render this
   * unconditionally: a list with no collision draws exactly what it drew
   * before.
   */
  suffix: string | null;
}

/**
 * Work out which titles in a list need telling apart.
 *
 * Pure and total: the input order is the output order, an empty list is an
 * empty list, and nothing here reads a store. That is what lets a render test
 * and a view builder call the same function and get the same answer.
 */
export function disambiguateAgentTitles(
  agents: readonly AgentIdentity[],
): AgentLabel[] {
  const seen = new Map<string, number>();
  for (const agent of agents) {
    const key = agent.title.trim().toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  return agents.map((agent) => {
    const key = agent.title.trim().toLowerCase();
    if ((seen.get(key) ?? 0) < 2) {
      return { ...agent, suffix: null };
    }
    const folder = humanizeAgentName(agent.name);
    // A suffix identical to the title distinguishes nothing. Said as a
    // comparison on the trimmed, case-folded forms so that "Meeting assistant"
    // and "Meeting Assistant" are recognised as the same words.
    return {
      ...agent,
      suffix: folder.trim().toLowerCase() === key ? null : folder,
    };
  });
}

/**
 * The suffix for one agent in a list, or null.
 *
 * A convenience over the function above for a renderer that already has the
 * whole list and wants one row's answer; it exists so that a component does not
 * build its own index and get the collision rule subtly different.
 */
export function agentTitleSuffix(
  agent: AgentIdentity,
  among: readonly AgentIdentity[],
): string | null {
  return (
    disambiguateAgentTitles(among).find(
      (one) => one.name === agent.name && one.title === agent.title,
    )?.suffix ?? null
  );
}
