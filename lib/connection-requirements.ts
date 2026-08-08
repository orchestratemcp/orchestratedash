/**
 * A declared requirement, resolved against what DASH actually holds (MAR-569).
 *
 * `lib/connection-spec.ts` reads the declaration and can be proved right against
 * a JSON file. This is the other half: it takes one requirement and the
 * connection row it names, and answers the two questions the Connections surface
 * (MAR-570) puts on every line — **where does this stand, and what happens when
 * I press the button?**
 *
 * ## The standings are MAR-533's, not a second set
 *
 * `capabilityStandings` in `lib/connection-card.ts` already computes where one
 * action stands, as the intersection of the three parties PROJECT_STATE.md has
 * recorded since MAR-458: DASH implements it, the manifest declared it, the
 * provider issued it. This module **calls that function**. It does not
 * re-derive `issued`/`signedIn` from a receipt, and the reason is the one the
 * four standings exist for in the first place: `not_issued` is the state a
 * second implementation would collapse into `awaiting_you`, and the collapse
 * tells somebody to sign in again to fix something signing in again does not
 * fix. A fork here would reintroduce that bug on a different page.
 *
 * So the only thing this module adds is the **rollup** — a requirement names
 * several operations and a line has room for one chip — plus the flow
 * descriptor, which is new.
 *
 * ## Why a disagreement is not a standing
 *
 * A requirement can name an operation its own manifest's `agent_dom.connections`
 * never declared scopes for. That is two blocks of one document contradicting
 * each other, and it is tempting to round it into `not_asked_for` — the standing
 * that already means "DASH offers this and this agent never asked".
 *
 * It would be wrong, and specifically it would make DASH say something false.
 * The requirement *did* ask; that is what a requirement is. `not_asked_for`
 * renders as "nobody asked for this", which on this line would be DASH
 * contradicting the sentence directly above it. So a disagreement travels in its
 * own field, with its own sentence, and the fix it points at is a re-export
 * rather than a sign-in. The four standings are reused exactly, never stretched.
 *
 * Pure, and it renders nothing — the shape `lib/connection-card.ts` and
 * `lib/host-connect.ts` established.
 */

import {
  capabilityStandings,
  type CapabilityStanding,
  type StandingCapability,
} from "./connection-card";
import type { ConnectionRequirementV1, ConnectorKindV1 } from "./connection-spec";
import type { ConnectionRowWithCredential } from "./views/types";

/* ---------------------------------------------------------------------- *
 * The flow the button fires
 * ---------------------------------------------------------------------- */

/**
 * What pressing Connect on this line actually does.
 *
 * A descriptor rather than a handler, because this module is pure and the IPC
 * call belongs to the surface. What it carries is exactly what
 * `lib/shell/ipc.ts`'s `connection.connect` channel requires — the agent, the
 * connection and the field — so MAR-570 can fire it without deriving anything
 * of its own. A descriptor the surface had to complete would be a descriptor
 * that could be completed wrongly.
 *
 * One member today, and it is a union anyway: the second connector kind arrives
 * as a second variant, and a `switch` that has to grow is better than a shape
 * that silently accommodates one.
 */
export type ConnectFlow = {
  /** `lib/shell/ipc.ts`'s channel, by name. */
  channel: "connection.connect";
  agent_id: string;
  connection_id: string;
  field_id: string;
};

/**
 * Why no button can be drawn on this line.
 *
 * A closed union rather than a null, because MAR-570 has to *say* something in
 * each case and "no flow" is not a sentence. Every member here is a real
 * document DASH can be handed, and the surface that renders them is choosing
 * between three different next actions — re-export, wait, or nothing at all.
 */
export type ConnectFlowRefusal =
  /**
   * The requirement names a `connection_id` this manifest never declared. Two
   * blocks of one document disagreeing; the fix is a re-export.
   */
  | "connection_not_declared"
  /**
   * The connection is declared and DASH has no field to act on — a row whose
   * `field_id` is null. Nothing to prompt for, so nothing to press.
   */
  | "no_field_to_act_on";

/* ---------------------------------------------------------------------- *
 * The disagreements a resolution surfaces rather than repairs
 * ---------------------------------------------------------------------- */

/**
 * One operation a requirement named that its own connection does not offer.
 *
 * ADR 0008's damage rule applied to a manifest's internal consistency:
 * disagreement is surfaced, never silently repaired. Dropping these would make
 * a requirement that asks for something impossible look identical to one that
 * asks for nothing — and the second is fine while the first is a build to fix.
 */
export interface RequirementDisagreement {
  operation_id: string;
  /**
   * Which side is missing, as far as this connection can tell.
   *
   * `not_on_connection` is the honest limit of what a pure module knows: the
   * operation is absent from both the requested and the unrequested lists of the
   * connection this requirement names, which means either DASH has no such
   * operation or it belongs to a different provider. Both are the same next
   * move for the reader, and distinguishing them would need the operation
   * registry this module deliberately does not import.
   */
  reason: "not_on_connection";
}

/* ---------------------------------------------------------------------- *
 * The resolution
 * ---------------------------------------------------------------------- */

export interface ResolvedRequirement {
  /** Technical vocabulary, carried so the surface can key on it. Never rendered. */
  id: string;
  /** The author's words, what a person reads on the line. */
  name: string;
  connector_kind: ConnectorKindV1;
  /** False when the agent cannot run without it. The declaration's `optional`, defaulted. */
  optional: boolean;
  /** The author's claim about what it is for, or null. */
  why: string | null;
  /**
   * Where the requirement stands as a whole — the chip on the line.
   *
   * The rollup of `operations` below, by `rollUpStanding`'s stated precedence.
   * Never invented: a requirement with no resolvable operations does not get a
   * cheerful default, it gets `awaiting_you`, which is the true statement about
   * a connection nobody has signed into.
   */
  standing: CapabilityStanding;
  /**
   * Each operation this requirement covers, with its own standing, in the
   * connection's declared order.
   *
   * These come straight from `capabilityStandings`, so a line can be expanded
   * into the same per-action detail the capability card draws — the surface
   * never needs a second source for the same fact.
   */
  operations: StandingCapability[];
  /** Named by the requirement, absent from the connection. Empty is the good case. */
  disagreements: RequirementDisagreement[];
  /** What Connect fires, or null. */
  flow: ConnectFlow | null;
  /** Why there is no flow, or null when there is one. Exactly one of the two is set. */
  flow_refusal: ConnectFlowRefusal | null;
}

/**
 * Resolve one declared requirement against the connections DASH holds for this
 * agent.
 *
 * `rows` is the agent's whole connection list rather than the single matching
 * row, because "the id names nothing" is one of the answers this has to give,
 * and a caller that had already looked the row up would have had to decide what
 * to do about that before calling — which is the decision this function exists
 * to make.
 */
export function resolveRequirement(
  requirement: ConnectionRequirementV1,
  agentId: string,
  rows: readonly ConnectionRowWithCredential[],
): ResolvedRequirement {
  const base = {
    id: requirement.id,
    name: requirement.name,
    connector_kind: requirement.connector_kind,
    optional: requirement.optional === true,
    why: typeof requirement.why === "string" ? requirement.why : null,
  };

  const row = rows.find((one) => one.connection_id === requirement.connection_id) ?? null;
  if (row === null) {
    // The manifest disagreeing with itself. No standings can be computed,
    // because the three-party intersection needs a connection to intersect on —
    // so this reports the true thing rather than the reassuring one, and the
    // surface says the fix is a re-export.
    return {
      ...base,
      standing: "awaiting_you",
      operations: [],
      disagreements: (requirement.operations ?? []).map((operation_id) => ({
        operation_id,
        reason: "not_on_connection" as const,
      })),
      flow: null,
      flow_refusal: "connection_not_declared",
    };
  }

  // The shared source. Everything below is selection and rollup over this list;
  // no standing is computed here.
  const standings = row.broker === null ? [] : capabilityStandings(row.broker);
  const named = requirement.operations;

  const covered =
    named === undefined
      ? // Absent means the whole connection's requested set, which is what
        // `agent_dom.connections` already declared. `not_asked_for` entries are
        // excluded deliberately: they are actions DASH offers that this agent
        // never asked for, so they are not part of what this requirement needs
        // and would drag the rollup to a state no sign-in could clear.
        standings.filter((one) => one.standing !== "not_asked_for")
      : standings.filter((one) => named.includes(one.id));

  const disagreements =
    named === undefined
      ? []
      : named
          .filter((operation_id) => !standings.some((one) => one.id === operation_id))
          .map((operation_id) => ({ operation_id, reason: "not_on_connection" as const }));

  return {
    ...base,
    standing: rollUpStanding(covered),
    operations: covered,
    disagreements,
    ...describeFlow(agentId, row),
  };
}

/**
 * Every declared requirement, resolved, in the author's order.
 *
 * A thin map, and it exists so a caller cannot forget to pass the same `rows` to
 * each one — a resolution built from two different reads of the store would be
 * a page whose lines disagreed with each other.
 */
export function resolveRequirements(
  requirements: readonly ConnectionRequirementV1[],
  agentId: string,
  rows: readonly ConnectionRowWithCredential[],
): ResolvedRequirement[] {
  return requirements.map((requirement) => resolveRequirement(requirement, agentId, rows));
}

/**
 * One chip for several operations.
 *
 * The precedence is **what the reader should do next**, worst-blocked first:
 *
 * 1. `not_asked_for` — an operation this requirement needs is one DASH offers
 *    and the manifest's connection never asked for. No sign-in changes it, so it
 *    is the strongest thing that can be true of a line and it must not hide
 *    under a chip that invites an action.
 * 2. `awaiting_you` — nobody has signed in. The next action is a sign-in.
 * 3. `not_issued` — signed in, and this one was left out. The next action is a
 *    different sign-in, and merging it upward is the exact bug MAR-533 called
 *    out.
 * 4. `allowed` — every operation agreed. Only reachable when nothing else is.
 *
 * An empty list resolves to `awaiting_you` rather than `allowed`, which is the
 * load-bearing default: a requirement whose connection has no broker at all has
 * granted nothing, and reporting that as "can do this right now" would be the
 * one wrong answer on a page about what is safe to run.
 */
export function rollUpStanding(operations: readonly StandingCapability[]): CapabilityStanding {
  if (operations.length === 0) {
    return "awaiting_you";
  }
  const has = (standing: CapabilityStanding): boolean =>
    operations.some((one) => one.standing === standing);

  if (has("not_asked_for")) {
    return "not_asked_for";
  }
  if (has("awaiting_you")) {
    return "awaiting_you";
  }
  if (has("not_issued")) {
    return "not_issued";
  }
  return "allowed";
}

/**
 * What Connect fires for this row, or why it cannot.
 *
 * Both connector kinds land on the same channel, which is not a simplification:
 * `connection.connect` already asks for a credential for one declared connection
 * and the row's own field kind is what decides whether that is a sign-in or a
 * typed secret. Deriving a second channel from `connector_kind` here would put
 * DASH's decision in the manifest's hands.
 */
function describeFlow(
  agentId: string,
  row: ConnectionRowWithCredential,
): { flow: ConnectFlow | null; flow_refusal: ConnectFlowRefusal | null } {
  if (row.field_id === null) {
    return { flow: null, flow_refusal: "no_field_to_act_on" };
  }
  return {
    flow: {
      channel: "connection.connect",
      agent_id: agentId,
      connection_id: row.connection_id,
      field_id: row.field_id,
    },
    flow_refusal: null,
  };
}

/* ---------------------------------------------------------------------- *
 * What the surface says
 * ---------------------------------------------------------------------- */

/**
 * What one flow refusal means, in the house voice.
 *
 * Here rather than in the component for `describeStanding`'s reason: a sentence
 * a novice has to guess at is not a sentence, and these two are the states where
 * a person is most likely to think the fault is theirs. Neither blames them, and
 * both name the actual next move.
 */
export function describeFlowRefusal(refusal: ConnectFlowRefusal): {
  label: string;
  meaning: string;
} {
  switch (refusal) {
    case "connection_not_declared":
      return {
        label: "this agent's file disagrees with itself",
        meaning:
          "This agent says it needs this, and the same file does not describe the connection it names. " +
          "DASH will not guess at one. Re-export the agent and add it again.",
      };
    case "no_field_to_act_on":
      return {
        label: "nothing for DASH to ask you for",
        meaning:
          "The connection is described, and it has nothing DASH can prompt you for — so there is no " +
          "sign-in to start here. Re-export the agent and add it again.",
      };
  }
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the union rather than written out, so a refusal added without
 * being added here is one the plain-language check never sees — the shape
 * `lib/host-connect.ts`'s `everyConnectSentence` established and
 * `lib/connection-card.ts` repeats.
 */
export const CONNECT_FLOW_REFUSALS = [
  "connection_not_declared",
  "no_field_to_act_on",
] as const satisfies readonly ConnectFlowRefusal[];
