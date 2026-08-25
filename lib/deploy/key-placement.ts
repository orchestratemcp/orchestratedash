/**
 * Which key slot a bundle's agent actually declared, and which placed keys
 * still have a bundle to serve (MAR-794, ADR 0018).
 *
 * Pure: no filesystem, no `ssh`, no child process, no store. `lib/deploy/verbs.ts`
 * decides what a *request* may look like; this decides what an **agent's own
 * document** says the request is allowed to be about, and it is imported by both
 * ends for `checkDeployRequest`'s reason — a rule that lived only in DASH is a
 * rule the host does not have, and the host is the side something other than
 * DASH could talk to.
 *
 * ## The narrowing this file is
 *
 * ADR 0018 rule 2 admits `install-key` only for *"a provider-key need that
 * bundle's agent declares"*, and step 1 of the owner-only install path is
 * *"proves the bundle record exists and its agent declares the named need"*.
 * Without that, the verb is arbitrary encrypted file transfer with a JSON
 * costume: a caller could invent a slot name, the helper would happily create a
 * directory for it, and the host secret store would become a place to stash
 * anything. The declaration is the authority; the press selects among facts it
 * already contains.
 *
 * `connectableFields` is what answers it, and reusing it rather than re-reading
 * the manifest is the point. It is the same list the spawn path iterates on this
 * machine, so a connection DASH would not hold a credential for locally is one
 * this verb cannot place remotely — one vocabulary for custody, in
 * `lib/connection-credentials.ts`, not a second one written next to a server.
 *
 * ## Only `provider_key`, and the two refusals that are not oversights
 *
 * A `secret` field is a value DASH delivers as an environment variable when it
 * spawns the agent *here*, and there is no host-side counterpart admitted yet —
 * the host broker's closed set is model-provider operations and nothing else
 * (ADR 0021 section 2), so a secret placed there would be a file no admitted
 * operation reads.
 *
 * An `oauth` grant is refused harder, and ADR 0021 argues it at length: a Gmail
 * refresh token is *"a different custody class: OAuth, restricted scopes, a third
 * party at consent, revocation that is not 'rotate at the provider' in the same
 * way. Putting one on a VPS is a new ceremony, not a reuse of `install-key`."*
 * The refusal is named separately from "this connection does not exist" so that
 * whoever meets it is told which of the two walls they hit.
 */

import { connectableFields } from "../connection-credentials";
import type { ConnectionSourceManifest } from "../connections";
import { RESERVED_HOST_BUNDLE_ID, RESERVED_HOST_SLOTS } from "./verbs";

/* ---------------------------------------------------------------------- *
 * What the agent's document says about one slot
 * ---------------------------------------------------------------------- */

/**
 * Why this connection is not a slot a key may be placed in.
 *
 * Four names rather than one, because they have four different next moves: fix
 * the manifest, use a different connection, wait for a ceremony that does not
 * exist yet, or re-run setup on the server.
 */
export type KeySlotRefusal =
  /** The bundle's agent declares no connection with that id. */
  | "undeclared_slot"
  /** It declares one, and DASH holds no provider key for it — an OAuth grant. */
  | "oauth_is_a_different_custody_class"
  /** It declares one, and it is a typed secret rather than a model key. */
  | "not_a_provider_key"
  /** The reserved bundle id, whose slot list is closed and does not name this. */
  | "reserved_slot_not_admitted";

export type KeySlotCheck =
  | {
      ok: true;
      /**
       * The declared field the key satisfies.
       *
       * Carried out so the caller does not have to search the manifest twice,
       * and so a placement record can name *which* field of a multi-field
       * connection this was — ADR 0018's receipt names a local key record, and
       * a connection is not one.
       */
      field_id: string;
      /** The author's friendly name for the service. Never an id, never rendered as one. */
      service: string;
      /** The model provider this key is for, e.g. `openrouter`. */
      ai_provider_id: string;
    }
  | { ok: false; refusal: KeySlotRefusal };

/**
 * Whether this bundle's agent declared this connection as a model-provider need.
 *
 * `manifest` is null for the reserved bundle id, which has no agent and
 * therefore no document — its admission is the closed list in
 * `RESERVED_HOST_SLOTS`, which this packet ships empty. A caller that hands a
 * null manifest for an ordinary bundle gets `undeclared_slot`, which is the
 * honest answer: a bundle whose manifest cannot be read has declared nothing.
 */
export function checkKeySlot(
  agentId: string,
  bundleId: string,
  manifest: ConnectionSourceManifest | null,
  connectionId: string,
): KeySlotCheck {
  if (bundleId === RESERVED_HOST_BUNDLE_ID) {
    return RESERVED_HOST_SLOTS.includes(connectionId)
      ? // Unreachable while the list is empty, and written rather than thrown
        // so that the packet which adds a name to that list adds a name and not
        // a branch. `ai_provider_id` is empty because a reserved slot is not
        // required to be a model key — the Discord bot token ADR 0028 needs is
        // the obvious first one — and the packet that admits it says what it is.
        { ok: true, field_id: connectionId, service: connectionId, ai_provider_id: "" }
      : { ok: false, refusal: "reserved_slot_not_admitted" };
  }

  if (manifest === null) {
    return { ok: false, refusal: "undeclared_slot" };
  }

  for (const target of connectableFields(agentId, manifest)) {
    if (target.connection_id !== connectionId) {
      continue;
    }
    if (target.kind === "provider_key" && target.ai_provider_id !== null) {
      return {
        ok: true,
        field_id: target.field_id,
        service: target.service,
        ai_provider_id: target.ai_provider_id,
      };
    }
  }

  /*
   * Nothing placeable. Which of the three walls it was needs the author's raw
   * document rather than `connectableFields`, because that iterator answers a
   * different question — *which fields may DASH hold a credential for* — and a
   * connection it declines for its own reasons drops out of the list entirely.
   * A sign-in whose provider this build has no flow for is one such case, and it
   * would otherwise be reported as a connection the agent never declared.
   *
   * Read as one enum off the document, not as a second custody vocabulary. The
   * question here is only *what kind of thing did the author say this is*, so
   * that the person is told which wall they hit — ADR 0021 refuses a Gmail token
   * on a host by name and gives the reason, and collapsing that into "no such
   * connection" would send somebody looking for a typo in a manifest that is
   * correct.
   */
  const declared = manifest.agent_dom?.connections?.find((one) => one.id === connectionId);
  if (declared === undefined) {
    return { ok: false, refusal: "undeclared_slot" };
  }
  return {
    ok: false,
    refusal: declared.fields.some((field) => field.kind === "oauth_reauthorization")
      ? "oauth_is_a_different_custody_class"
      : "not_a_provider_key",
  };
}

/**
 * One sentence per refusal, for the helper's `detail` and for a log.
 *
 * Plain, and it names no path, no id and no value. The helper's answers travel
 * to DASH and into a log, and everything in them is a string a machine DASH does
 * not administer chose to send back — the discipline `uninstall` keeps for a
 * filesystem error, kept here for a credential refusal.
 */
export function describeKeySlotRefusal(refusal: KeySlotRefusal): string {
  switch (refusal) {
    case "undeclared_slot":
      return "That agent's own file does not ask for this connection, so no key may be placed for it.";
    case "oauth_is_a_different_custody_class":
      return "This connection is a sign-in DASH holds on your behalf, not a key. Sending one to a server is a separate decision that has not been made.";
    case "not_a_provider_key":
      return "This connection is not a model provider key, and a server holds only model provider keys.";
    case "reserved_slot_not_admitted":
      return "Nothing may be placed in that reserved slot yet.";
  }
}

/* ---------------------------------------------------------------------- *
 * The orphan question (ADR 0018, the split-roots lesson applied remotely)
 * ---------------------------------------------------------------------- */

/**
 * One key DASH placed on one server, as DASH remembers it.
 *
 * DASH's memory of its **own outbound act**, exactly as `agent_deploys` is —
 * ADR 0010's shape one custody class over. It is not a reading of the server:
 * the host is never asked to enumerate its secret store, and `pack`'s answer has
 * no room to reply if it were. So an unreachable host makes a row stale rather
 * than false, which is ADR 0018's own sentence: *"DASH last proved placement at
 * that time and has not proved removal since."*
 */
export interface KeyPlacement {
  host_id: string;
  bundle_id: string;
  connection_id: string;
  /** The declared field it satisfied. Names a local key record, never a value. */
  field_id: string;
  placed_at: string;
}

/** A placement, plus whether the bundle it was placed for is still installed. */
export interface PlacementStanding {
  placement: KeyPlacement;
  /**
   * True when the host no longer holds a bundle for this placement's id.
   *
   * The failure this exists to catch is the remote half of
   * [[store-and-vault-are-two-roots]]. A host has two roots too — `bundles/`,
   * which `uninstall` wipes and a re-`install` replaces, and `secrets/`, which
   * `install` never writes — and a key is *named by* a bundle and *stored
   * outside* the bundle tree. So a bring-home or a re-deploy can leave a `0600`
   * file addressed to an agent that is no longer there, and nothing on either
   * machine would say so until an agent asked and was refused.
   *
   * A placement under `RESERVED_HOST_BUNDLE_ID` is never orphaned: that id
   * belongs to no bundle by construction, because `checkDeployRequest` refuses
   * it on every verb that could install one.
   */
  orphaned: boolean;
}

/**
 * Join what DASH placed against what the host says is installed.
 *
 * `installed` is the bundle ids from a `status` answer — the host's own account,
 * with an age on it, never DASH's memory of what it deployed. Using
 * `agent_deploys` here instead would compare one of DASH's records against
 * another and could never discover an agent somebody removed on the server.
 *
 * Null `installed` means nothing has asked yet, and the answer is that nothing
 * is orphaned rather than that everything is. `describeWhatIsOnHost` draws the
 * same distinction and for the same reason: an unchecked server and an empty
 * server are different claims, and only one of them is a finding.
 */
export function standingForPlacements(
  placements: readonly KeyPlacement[],
  installed: readonly string[] | null,
): PlacementStanding[] {
  const present = installed === null ? null : new Set(installed);
  return placements.map((placement) => ({
    placement,
    orphaned:
      present !== null &&
      placement.bundle_id !== RESERVED_HOST_BUNDLE_ID &&
      !present.has(placement.bundle_id),
  }));
}

/** Whether any placement on this server has lost the bundle it was placed for. */
export function anyOrphaned(standings: readonly PlacementStanding[]): boolean {
  return standings.some((one) => one.orphaned);
}
