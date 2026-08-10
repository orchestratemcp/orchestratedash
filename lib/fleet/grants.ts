/**
 * Which agents a fleet connection reaches (MAR-593, ADR 0013).
 *
 * `findGrantSharers` answers this for a sign-in a person made *on one agent*:
 * which other agents does the consent that just arrived also belong to. This
 * module answers the same question with the agent removed from it — which agents
 * does a connection that exists on its own belong to — and the rule is
 * deliberately the same rule, not a second one.
 *
 * ## The gate is `resolveCredentialTarget`, and that is the whole safety argument
 *
 * Every candidate goes through it, which is the same gate the direct path uses:
 * it refuses an agent whose manifest declared no scopes, asked for access DASH
 * does not offer, named an environment variable DASH will not use, or holds its
 * own credential. So a materialized agent is one that **would have been allowed
 * to run this connect itself** — and the credential it receives is one its own
 * manifest asked for, resolved against its own declaration.
 *
 * That is what keeps ADR 0002's three-party intersection intact with the
 * connection moved up a level. DASH built the operation; the *agent's own
 * manifest* declared the scopes it needs; the person granted them at the
 * provider. Moving where the third party's answer is recorded does not move the
 * second party, and the second party is the one that stops an author widening
 * their own access.
 *
 * Pure, and it touches no store — `withheld` arrives as a set. `lib/fleet/store.ts`
 * owns what the tables say; this owns what it means.
 */

import { resolveCredentialTarget, type CredentialTarget } from "../connection-credentials";
import type { ConnectionSourceManifest } from "../connections";
import type { FleetConnector } from "./catalogue";

/** One agent DASH holds a manifest for, as this module needs it. */
export interface FleetCandidate {
  agent_id: string;
  manifest: ConnectionSourceManifest;
}

/**
 * One agent a fleet connection materializes into.
 *
 * The resolved `target` travels whole rather than as three ids, because the
 * caller has to write the same three things the direct path writes — the vault
 * entry, the masked reference and the receipt — and a caller that had to
 * re-resolve them would be a second chance to resolve them differently.
 */
export interface FleetMaterialization {
  agent_id: string;
  target: CredentialTarget;
}

/**
 * Why an agent that names this provider is not materialized.
 *
 * A closed union rather than a silent skip, because the Connections card has to
 * be able to *say* why an agent it lists is not lit up — and the three cases
 * point at three different next actions: undo a revocation, re-export the agent,
 * or nothing at all because the agent keeps its own credential.
 */
export type FleetSkip =
  /** Somebody revoked this agent from this connection. Undoing it is theirs to do. */
  | "withheld"
  /**
   * The agent names the provider and could not have run this connect itself:
   * no declared scopes, access DASH does not offer, a delivery variable DASH
   * refuses, or a field kind that does not match the connector. The fix is a
   * re-export, and it is the agent author's.
   */
  | "does_not_qualify"
  /**
   * The agent holds its own credential for this provider, or an external manager
   * does. Not a gap and not a fault — `classifyProof`'s distinction, one level
   * up — and it must never be drawn as something a button would fix.
   */
  | "not_dash_held";

export interface FleetSkipped {
  agent_id: string;
  reason: FleetSkip;
}

export interface FleetReach {
  materializes: FleetMaterialization[];
  skipped: FleetSkipped[];
}

/**
 * Every agent this connector reaches, and every agent it names and does not.
 *
 * Both halves, from one pass, because the sentence a person reads before they
 * press ("this connects Gmail for these agents") and the list a card draws after
 * ("and not for this one, because you revoked it") have to be computed from one
 * fact. Two functions would be two chances for the promise and the act to
 * disagree, which is precisely what `describeSharedGrant` exists to prevent.
 *
 * Order is the candidate order the caller supplied, which is the order DASH
 * lists agents. A connection does not reorder the fleet.
 */
export function fleetReach(
  connector: FleetConnector,
  candidates: readonly FleetCandidate[],
  withheld: ReadonlySet<string>,
): FleetReach {
  const materializes: FleetMaterialization[] = [];
  const skipped: FleetSkipped[] = [];

  for (const candidate of candidates) {
    const named = (candidate.manifest.agent_dom?.connections ?? []).filter(
      (connection) => connection?.provider === connector.provider,
    );
    if (named.length === 0) {
      // Not skipped and not reported: an agent that never mentioned this
      // provider is not part of this connection's story at all, and listing it
      // as "not connected" would be the page inventing a gap.
      continue;
    }

    if (withheld.has(candidate.agent_id)) {
      skipped.push({ agent_id: candidate.agent_id, reason: "withheld" });
      continue;
    }

    const resolved = resolveOne(connector, candidate, named);
    if (resolved === null) {
      skipped.push({
        agent_id: candidate.agent_id,
        reason: named.every((connection) => connection.ownership !== "dash_managed")
          ? "not_dash_held"
          : "does_not_qualify",
      });
      continue;
    }
    materializes.push({ agent_id: candidate.agent_id, target: resolved });
  }

  return { materializes, skipped };
}

/**
 * The first field of the first connection this agent declares for the provider
 * that DASH may hold a credential for, of the kind this connector holds.
 *
 * First-wins matches `credentialStatus`, which is what decides the row the
 * Connections page draws a button on: an agent whose manifest declares two
 * connectable fields for one connection gets the first, in the author's order.
 * A materialization that picked a different one would fill a vault entry no card
 * reads.
 *
 * **The kind must match**, and that is not a formality. A connector that holds a
 * sign-in must not write its envelope into a field an agent declared as a typed
 * secret, because the agent would then hold a value it will present as a key to
 * a provider expecting a bearer token — and `deliverableSecretFields` would hand
 * it to the child process, which is the raw-token model ADR 0002 exists to end.
 */
function resolveOne(
  connector: FleetConnector,
  candidate: FleetCandidate,
  named: readonly { id: string; fields?: unknown }[],
): CredentialTarget | null {
  const wanted = connector.connector_kind === "google_oauth_broker" ? "oauth" : "provider_key";

  for (const connection of named) {
    if (!Array.isArray(connection.fields)) {
      // A connection whose fields DASH cannot read is one it holds no credential
      // for — `connectableFields`' reason for skipping rather than throwing on a
      // damaged row, applied to the same shape of document.
      continue;
    }
    for (const field of connection.fields as Array<{ id?: unknown }>) {
      if (typeof field?.id !== "string") {
        continue;
      }
      const resolved = resolveCredentialTarget(
        candidate.agent_id,
        candidate.manifest,
        connection.id,
        field.id,
      );
      if (resolved.ok && resolved.target.kind === wanted) {
        return resolved.target;
      }
    }
  }
  return null;
}

/* ---------------------------------------------------------------------- *
 * What the surface says
 * ---------------------------------------------------------------------- */

/**
 * What one skip means, in the house voice.
 *
 * Here rather than in the component for `describeStanding`'s reason: a sentence
 * a novice has to guess at is not a sentence. None of the three blames the
 * person, and each names the actual next move — including the one where the
 * answer is that there is nothing to do.
 */
export function describeSkip(reason: FleetSkip, service: string): {
  label: string;
  meaning: string;
} {
  switch (reason) {
    case "withheld":
      return {
        label: "you turned this one off",
        meaning:
          `You took this agent's access to ${service} away, so connecting again does not give it back. ` +
          "Turn it back on here when you want it.",
      };
    case "does_not_qualify":
      return {
        label: "this agent's file does not match",
        meaning:
          `This agent names ${service} and does not say what it needs in a way DASH can act on. ` +
          "DASH will not guess. Re-export the agent and add it again.",
      };
    case "not_dash_held":
      return {
        label: "the agent holds its own",
        meaning:
          `This agent keeps its own ${service} sign-in, so there is nothing here for DASH to give it — ` +
          "and nothing DASH can take away.",
      };
  }
}

/**
 * The disclosure that has to be read **before** the connect (MAR-570, ADR 0013).
 *
 * `describeSharedGrant` says this for a tile whose dependents are agents already
 * on screen. This says it for a connection a person is making with the agents
 * somewhere else entirely — which is the case the fleet page creates and the one
 * where a consequence is easiest to miss.
 *
 * Null when nothing is reached, which on a freshly cleared DASH is every
 * connector. An unconditional "this may also connect your agents" would be a
 * warning about nobody, and a warning that is usually about nobody is one people
 * stop reading.
 *
 * It names what each agent gets rather than only that it gets something: an
 * agent that asked for more than this consent covers still shows "you did not
 * give this one" on its own actions, and this sentence must not promise
 * otherwise.
 */
export function describeFleetReach(connector: FleetConnector, reach: FleetReach): string | null {
  const names = reach.materializes.map((one) => one.agent_id);
  if (names.length === 0) {
    return null;
  }
  const last = names[names.length - 1] as string;
  const list =
    names.length === 1
      ? last
      : names.length === 2
        ? `${names[0] as string} and ${last}`
        : `${names.slice(0, -1).join(", ")} and ${last}`;

  return (
    `Connecting ${connector.service} connects it for ${list}. ` +
    `DASH keeps a separate record for each, so you can turn one off without the others, ` +
    `and each agent only gets the actions it asked for.`
  );
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the union rather than written out, so a skip added without being
 * added here is one the plain-language check never sees — the shape
 * `everyConnectSentence` established.
 */
export const FLEET_SKIPS = [
  "withheld",
  "does_not_qualify",
  "not_dash_held",
] as const satisfies readonly FleetSkip[];
