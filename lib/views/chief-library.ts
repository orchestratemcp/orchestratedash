/**
 * The fleet's output, read out of the store for the chief (MAR-744).
 *
 * The one impure half of `lib/chief/library.ts`, kept apart from it for the
 * reason that module's header gives: the selector has to be pure so both rooms
 * can run it, and only one of the two rooms may open `dash.sqlite` at all — ADR
 * 0028 decision 6 keeps that store to a single writer, so the runner is handed
 * what this function produced rather than calling it.
 *
 * Beside `lib/views/ask.ts`' `savedThingsForAgent` and doing the fleet-wide
 * version of its job. Not *in* it, because that file builds a page view and this
 * builds an argument for a procedure; and not in `lib/chief/`, because
 * everything under there is imported by a plain Node process that must not
 * acquire a database.
 */

import type { RunArtifact } from "../contracts";
import { chiefLibrary, type ChiefAgentOutputs, type ChiefItem } from "../chief/library";
import { artifactRecordsForAgent } from "../store";
import type { AgentRow } from "./types";

/**
 * How far back the chief looks per agent.
 *
 * Deliberately smaller than `ASK_ARTIFACT_LIMIT`'s sixty, and the difference is
 * the point: that number bounds a read for **one** agent whose whole page is
 * about its history, and this one is multiplied by the size of the fleet. Twelve
 * reports of a daily agent is a fortnight, which is what *"the most current
 * news"* means by any reading, and `MAX_LIBRARY_ITEMS` bounds the total
 * afterwards regardless of how many agents somebody owns.
 */
export const CHIEF_ARTIFACT_LIMIT = 12;

/**
 * Every agent's recent output, as the chief's library.
 *
 * The agents arrive as the `AgentRow`s the fleet page already holds, so the
 * titles here are `agentDisplayName`'s answers — the same string on the card,
 * in the briefing, and on a citation. One read per agent, each an indexed query
 * against `run_artifacts`, in the order `agentsView` sorted them; the ordering
 * that matters is by date and `chiefLibrary` does it.
 *
 * A store that will not answer for one agent yields an empty list for that agent
 * rather than taking the question down — `readStore`'s standing rule, and the
 * chief's own: an answer that is missing one agent's reports is worth more than
 * a chat room that fails to reply.
 */
export function chiefLibraryFor(agents: readonly AgentRow[]): ChiefItem[] {
  const outputs: ChiefAgentOutputs[] = agents.map((agent) => ({
    agent: agent.name,
    title: agent.title,
    artifacts: readArtifacts(agent.name),
  }));
  return chiefLibrary(outputs);
}

function readArtifacts(agent: string): RunArtifact[] {
  try {
    return artifactRecordsForAgent(agent, CHIEF_ARTIFACT_LIMIT).map((record) => record.artifact);
  } catch {
    return [];
  }
}
