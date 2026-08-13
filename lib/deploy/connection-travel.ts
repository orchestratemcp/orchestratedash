/**
 * Which of an agent's connections cannot go to a server with it (MAR-591,
 * corrected by MAR-626).
 *
 * ## The gap this closes
 *
 * `host.deploy` copies an agent's folder, DASH's own runner and a generated
 * registration onto a machine the user administers. It copies **no credential**,
 * because DASH does not send credentials to servers — ADR 0006 and 0007 — and
 * that is not going to change here. What that means for a `dash_managed`
 * connection is precise and, until this module, unsaid: the copy on the server
 * starts with nothing to sign in with, the agent fails at whichever step needed
 * it, and DASH does not watch runs there so nothing on this computer ever says
 * so.
 *
 * MAR-583 said it for exactly one case — a model provider's key — and named the
 * general case rather than half-solving it in the wrong issue. This is the
 * general case.
 *
 * ## Why the vault is the gate, not the manifest (MAR-626)
 *
 * MAR-591's first cut read only the **shape of the arrangement** — the agent
 * asks DASH to hold this, and DASH holds it here — and deliberately never asked
 * whether a credential happened to be in the vault right now. The argument was
 * that a deploy whose outcome depended on how far somebody had got with
 * connecting would be a rule nobody could predict.
 *
 * MAR-626 is the case that argument did not survive. MAR-619's News Scout
 * declares its model-provider connection `optional: true` — it is built to run
 * keyless, headlines with no curation — and every fresh scaffold of it refused
 * to deploy anyway: `needsAModel` came from the plan alone, so a connection
 * nobody had ever typed a key into still read as "DASH holds a credential here
 * that will not travel." There was nothing in this computer's vault to strand.
 * Reading the manifest is not "the shape of the arrangement" either — it is
 * what the agent *might one day ask DASH to hold*, and refusing on a maybe was
 * not the stable rule it was meant to be: it was a refusal that fired for every
 * new agent, unconditionally, until somebody connected something.
 *
 * The gate now asks the narrower, truer question: does `connection_secrets`
 * say DASH is actually holding a credential for this (agent, connection,
 * field)? That is the one fact a deploy can strand. A connection nothing is
 * held for strands nothing — DASH is not withholding a credential from the
 * server, because DASH does not have one — so the agent deploys, and whatever
 * the manifest says about running without it (MAR-619's degraded digest, or any
 * other template's own honest fallback) is simply what happens over there. A
 * fleet connector's own key existing is not this agent's answer either:
 * `fleetReach` (`lib/fleet/grants.ts`) writes the *same* `connection_secrets`
 * row a direct connect would when it materializes a credential onto an agent,
 * which is why one lookup — never a second table, never a fleet-key existence
 * check — settles both paths.
 *
 * ## Where the custody vocabulary comes from
 *
 * Not from a second reading of the manifest. `connectableFields` is what the
 * spawn path itself iterates, and its `CredentialKind` already draws the only
 * distinction that matters here:
 *
 * - `oauth` — a grant DASH's broker holds. The broker is this machine. There is
 *   no arrangement, on any server, that reaches it.
 * - `provider_key` — a model provider's key DASH presents on the agent's behalf.
 *   Same custody, MAR-582's boundary.
 * - `secret` — a value the user typed for a service DASH has no client for.
 *   DASH delivers it as an environment variable when it spawns the agent *here*.
 *
 * All three stay. A connection whose every field DASH refuses to hold at all
 * never reaches this module, which is right rather than a gap: DASH holds
 * nothing for it, so nothing of DASH's fails to travel.
 *
 * ## Refuse or warn, and which document decides
 *
 * A connection reaches this decision at all only once it has cleared the vault
 * gate above: DASH must be holding a credential for it, or there is nothing to
 * strand and it is never on the list. Of what remains, the rule is one
 * sentence: **a stranded connection refuses the deploy when the agent's own
 * document says a run needs it, and warns when it does not say that.** DASH
 * never decides which of a person's connections matter.
 *
 * Two things count as the document saying a run needs it, and both are
 * declarations rather than inferences:
 *
 * 1. MAR-569's `connection_requirements` names this connection and does not mark
 *    it optional. `ConnectionRequirementV1.optional`'s own rule is that absent
 *    means required — "an agent that can run degraded is the one that says so".
 * 2. The plan has a step that needs a model and this is the model key. That is
 *    MAR-583's refusal, unchanged and still carrying its own sentence.
 *
 * Everything else warns. In particular **an agent with no requirements block
 * warns rather than refusing**, and that is the finding this module was written
 * around: not one manifest in `examples/` declares the block, so refusing there
 * would refuse every agent with a `dash_managed` connection that exists today,
 * on the strength of a guess about whether a run needs it. DASH does not know,
 * and the line says it does not know — MAR-584's `comparable: false` discipline,
 * which reports "DASH cannot tell" rather than defaulting to reassurance or to
 * alarm.
 *
 * The same restraint runs the other way, and a screenshot is what enforced it:
 * see `requirementNeed` for the sentence DASH nearly put on screen about a
 * connection its author had merely not mentioned.
 *
 * Pure, and it imports nothing that reaches a disk — `held` arrives as data,
 * the same way `withheld` arrives at `lib/fleet/grants.ts`'s door, so the vault
 * lookup this module now depends on stays a caller's job. Both deploy entry
 * points are `"use client"` trees — see `lib/deploy/receipt.ts`'s header for the
 * packaged renderer that stopped hydrating when that rule was broken.
 */

import { MODEL_KEY_STAYS_HOME_REFUSAL } from "../ai/model-choice";
import { planNeedsAModel } from "../ai/model-levels";
import { resolveConnectionRequirements } from "../connection-spec";
import { connectableFields, type CredentialKind } from "../connection-credentials";
import type { ConnectionSourceManifest } from "../connections";

/**
 * The one fact `connection_secrets` can state about a field: DASH has a vault
 * entry for it. Deliberately the narrowest shape that fact needs — `lib/secret-refs.ts`'s
 * `SecretReference` and `lib/connection-actions.ts`'s `heldCredentials` both
 * satisfy this structurally, so either caller hands its row straight through
 * with nothing to reshape.
 */
export interface HeldCredential {
  connection_id: string;
  field_id: string;
}

/* ---------------------------------------------------------------------- *
 * The assessment
 * ---------------------------------------------------------------------- */

/**
 * What the agent's own document says about needing this connection.
 *
 * Three values and not a boolean, because "the file says it can run without
 * this" and "the file does not say" are different sentences to a person and
 * collapsing them would make DASH claim a declaration that was never written.
 */
export type ConnectionNeed =
  /** Declared required, or the plan itself needs it. Refuses. */
  | "run_needs_it"
  /** MAR-569's `optional: true`, or a requirements block that never names it. */
  | "agent_runs_without_it"
  /** No requirements block at all. DASH cannot tell, and says so. */
  | "undeclared";

/** One connection DASH holds that will not be on the server. */
export interface StrandedConnection {
  /** Technical vocabulary, carried so a caller can key on it. Never rendered. */
  connection_id: string;
  /** The author's friendly name for the service — "Your Gmail". Never an id. */
  service: string;
  /** `CredentialKind`, reused exactly rather than restated. */
  custody: CredentialKind;
  need: ConnectionNeed;
}

export type TravelVerdict = "clear" | "warn" | "refuse";

/**
 * Every `dash_managed` connection this agent has, and what happens to each one
 * when the agent is copied to a server.
 *
 * `verdict` is the rollup, in `rollUpStanding`'s shape and for its reason: the
 * panel has room for one decision, and it is the worst one on the list.
 */
export interface ConnectionTravel {
  verdict: TravelVerdict;
  /**
   * Empty exactly when `verdict` is `clear`. In the author's declared order.
   *
   * `readonly` because this crosses to a renderer and `NOTHING_STRANDED` below
   * is one shared value: a component that sorted it in place would sort every
   * other agent's answer with it.
   */
  stranded: readonly StrandedConnection[];
}

/** The answer for an agent with nothing DASH holds. Shared so callers cannot vary it. */
export const NOTHING_STRANDED: ConnectionTravel = Object.freeze({
  verdict: "clear" as const,
  stranded: Object.freeze([]) as readonly StrandedConnection[],
});

/**
 * Assess one agent's manifest against what DASH actually holds for it.
 *
 * `agentId` is required because `connectableFields` builds a vault name per
 * target, and asking it for the real one keeps this on the exact list the spawn
 * path uses rather than on a copy that could drift from it.
 *
 * `held` is every `connection_secrets` row for this agent — `heldCredentials`'s
 * or `listSecretReferences`'s shape, unreshaped. A target this agent could
 * connect but has not is not read here at all (MAR-626): it is not a
 * declaration DASH failed to honour, it is nothing DASH has to withhold.
 */
export function assessConnectionTravel(
  agentId: string,
  manifest: ConnectionSourceManifest | null,
  held: readonly HeldCredential[],
): ConnectionTravel {
  if (manifest === null) {
    return NOTHING_STRANDED;
  }

  // `${connection_id} ${field_id}`, the key `lib/views/build.ts`'s
  // `credentialStatus` and `lib/ai/connection-view.ts`'s `aiKeyConnections`
  // already use for the same lookup — one convention for "is this held", not a
  // second one invented here.
  const heldFields = new Set(held.map((one) => `${one.connection_id} ${one.field_id}`));

  const needsAModel = planNeedsAModel(manifest.planned_route ?? []);
  const need = requirementNeed(manifest);

  const stranded: StrandedConnection[] = [];
  for (const target of connectableFields(agentId, manifest)) {
    if (!heldFields.has(`${target.connection_id} ${target.field_id}`)) {
      // Nothing in the vault for this field. DASH holds nothing here to send or
      // withhold, so nothing of DASH's fails to travel — the same reasoning
      // "Where the custody vocabulary comes from" above already applies to a
      // field DASH refuses to hold at all, extended to one it simply does not
      // hold yet.
      continue;
    }
    // One line per connection, not per field. A person reads "your Gmail", and a
    // connection with two fields is still one thing they connected once.
    if (stranded.some((one) => one.connection_id === target.connection_id)) {
      continue;
    }
    stranded.push({
      connection_id: target.connection_id,
      service: target.service,
      custody: target.kind,
      need:
        target.kind === "provider_key" && needsAModel
          ? // MAR-583's rule, expressed as what it always was: the plan is part
            // of the agent's own document, and a step above `none` is that
            // document saying a run needs a model. Reached only for a key DASH
            // is actually holding — an agent that has never connected one never
            // gets here, however strongly its plan wants a model.
            "run_needs_it"
          : need(target.connection_id),
    });
  }

  if (stranded.length === 0) {
    return NOTHING_STRANDED;
  }
  return {
    verdict: stranded.some((one) => one.need === "run_needs_it") ? "refuse" : "warn",
    stranded,
  };
}

/**
 * What MAR-569's block says about one connection, as a lookup.
 *
 * ## Only a named requirement says anything
 *
 * The first draft read a declared block as authoritative over the whole
 * connection list, so a connection the block never mentioned came out as
 * `agent_runs_without_it`. A screenshot killed it: an agent declaring Gmail as
 * required and saying nothing about its calendar drew *"This agent's own file
 * says it can work without Google Calendar"* — a claim its file had not made,
 * from an omission.
 *
 * `lib/views/glance.ts` does treat the block as authoritative, and correctly:
 * there the question is *which things need connecting*, and a list answers that
 * by being a list. Here the question is *can this agent work without this one*,
 * and a list is silent about anything outside it. So only an explicit
 * `optional: true` earns `agent_runs_without_it`, which is exactly
 * `ConnectionRequirementV1.optional`'s own rule read in both directions: an
 * agent that can run degraded is the one that **says so**.
 */
function requirementNeed(manifest: ConnectionSourceManifest): (id: string) => ConnectionNeed {
  const resolution = resolveConnectionRequirements(manifest);
  if (resolution.kind !== "v1") {
    // `newer_version` lands here too, and deliberately: that resolution carries
    // no requirements at all, so a block DASH cannot read says nothing about any
    // connection rather than saying they are all fine.
    return () => "undeclared";
  }
  const declared = new Map<string, ConnectionNeed>();
  for (const requirement of resolution.requirements) {
    // First declaration wins. Two requirements naming one connection is a
    // manifest disagreeing with itself, and the worse-blocked reading is the one
    // that must not be lost — so `run_needs_it` is never overwritten.
    const said: ConnectionNeed =
      requirement.optional === true ? "agent_runs_without_it" : "run_needs_it";
    if (declared.get(requirement.connection_id) !== "run_needs_it") {
      declared.set(requirement.connection_id, said);
    }
  }
  return (id) => declared.get(id) ?? "undeclared";
}

/* ---------------------------------------------------------------------- *
 * What the person reads
 * ---------------------------------------------------------------------- */

export interface TravelNotice {
  headline: string;
  /**
   * Why nothing of this kind travels — one sentence per **custody present**,
   * never one per connection.
   *
   * The split between this and `lines` was made by a screenshot. The first draft
   * put the custody clause on every line, so an agent with Gmail and a calendar
   * drew "DASH does the signing in for this, and DASH is on this computer. The
   * copy on My server has nothing to ask." twice, word for word — two identical
   * paragraphs at 375px, which is where a person stops reading. The reason is a
   * fact about the **arrangement**, so it is said once about the arrangement.
   */
  reasons: string[];
  /** One short line per stranded connection: its name, and what its file says. */
  lines: string[];
  /** What to do about it, or null when the deploy may simply go ahead. */
  next_action: string | null;
}

/**
 * The sentences, from the assessment.
 *
 * Here rather than in either component, for `describeDeployReceipt`'s reason and
 * with more force: two entry points can begin a deploy, and a disclosure written
 * twice is a disclosure that gets softened once. The server card and the agent
 * page call this same function with their own two names.
 *
 * Nothing here says the agent will fail. DASH does not know what is on that
 * server or what the agent does when a connection is missing — `lib/server-card.ts`'s
 * rule about somebody else's machine — so every line is a statement about what
 * DASH itself sends and does not send, and about what this agent's own file says.
 */
export function describeConnectionTravel(
  travel: ConnectionTravel,
  agent: string,
  server: string,
): TravelNotice | null {
  if (travel.verdict === "clear") {
    return null;
  }
  // In the order the custodies are declared here rather than in the order the
  // connections happen to appear, so two agents with the same arrangement read
  // the same way round.
  const present: CredentialKind[] = ["oauth", "provider_key", "secret"];
  const reasons = present
    .filter((custody) => travel.stranded.some((one) => one.custody === custody))
    .map((custody) => custodyReason(custody, server));
  const lines = travel.stranded.map((one) => `${one.service} — ${needClause(one, server)}`);

  if (travel.verdict === "refuse") {
    return {
      headline: `${agent} needs something DASH cannot send to ${server}.`,
      reasons,
      lines,
      next_action:
        `You can still run ${agent} on this computer, where its sign-ins are. ` +
        `To run it on ${server}, it needs an agent that holds its own sign-ins there.`,
    };
  }
  return {
    headline: `Some of what ${agent} is connected to stays on this computer.`,
    reasons,
    lines,
    next_action: `You can put ${agent} on ${server} anyway — this is what it will be like there.`,
  };
}

/**
 * Why a credential of this custody cannot travel, in terms of what DASH does.
 *
 * Worded for one connection or several without a count, because a sentence that
 * needed one would need the count threaded through every caller for no gain to
 * the reader: "a key you typed" is true whether there is one or four.
 */
function custodyReason(custody: CredentialKind, server: string): string {
  switch (custody) {
    case "oauth":
      return (
        `DASH does the signing in for these, here on this computer. ` +
        `The copy on ${server} has no way to ask it.`
      );
    case "provider_key":
      return (
        `The key DASH holds for a language model is in this computer's vault, ` +
        `and DASH does not send keys to a server.`
      );
    case "secret":
      return (
        `A key you typed is in this computer's vault, and DASH does not send keys ` +
        `to a server.`
      );
  }
}

/** What this agent's own file says about needing it, and never what DASH guesses. */
function needClause(stranded: StrandedConnection, server: string): string {
  switch (stranded.need) {
    case "run_needs_it":
      return "this agent's own file says it needs this to do its work.";
    case "agent_runs_without_it":
      return (
        "this agent's own file says it can work without this, so the copy there " +
        "does less than the one here."
      );
    case "undeclared":
      return (
        `this agent's file does not say whether it can work without this. ` +
        `If it cannot, it will fail on ${server}, and DASH does not watch runs there.`
      );
  }
}

/**
 * What is true of a copy DASH has already sent (MAR-591).
 *
 * ## Why this is not a connection standing
 *
 * The obvious home for it was MAR-569's resolution: give the deployed copy a
 * line on the connections surface and let `rollUpStanding` say where it stands.
 * It cannot, and the reason is structural rather than a missing case. Those four
 * standings are the intersection of three parties — DASH implements it, the
 * manifest declared it, the provider issued it — and none of the three is the
 * server. `rollUpStanding([])` would answer `awaiting_you`, which is *literally*
 * true of the copy over there and renders as an invitation to sign in; the
 * Connect button beside it fires `connection.connect`, which writes to this
 * computer's vault and changes nothing on the server. That is precisely the
 * "button DASH cannot fire" MAR-569 was written to make impossible, and a fifth
 * standing to dodge it would ripple through every `switch` MAR-533 owns for the
 * sake of one row.
 *
 * So the deployed copy is not a row in that model at all. What DASH can say
 * about it is what MAR-584 says about everything else on this surface: a fact
 * about **DASH's own act**. DASH sent an agent there and did not send this, and
 * both halves are things DASH watched itself do.
 *
 * Returns null when nothing was held back — including for a `refuse` assessment,
 * which by construction never got sent.
 */
export function describeStrandedCopy(travel: ConnectionTravel, server: string): string | null {
  if (travel.stranded.length === 0) {
    return null;
  }
  const services = plainList(travel.stranded.map((one) => one.service));
  const plural = travel.stranded.length > 1;
  return (
    `The copy on ${server} does not have ${services}. DASH keeps ${plural ? "those" : "that"} ` +
    `on this computer, and does not watch runs on ${server} — so if a run there needs ` +
    `${plural ? "them" : "it"}, nothing here will say it failed.`
  );
}

/**
 * The refusal the **producer** returns, for the same assessment.
 *
 * Separate from `describeConnectionTravel` because it is a different moment and
 * a different tense: the notice above is read while deciding, and this is what
 * comes back when a page ignored it and pressed anyway. It says what happened —
 * nothing was sent — which the forward-looking notice cannot.
 *
 * The model-key case returns `MODEL_KEY_STAYS_HOME_REFUSAL` **verbatim**. That
 * sentence is MAR-583's, is pinned by value in two test files, and reached the
 * audited command result before this issue existed; rewording it here would
 * quietly retire a proof to make a new function tidier.
 */
export function describeTravelRefusal(travel: ConnectionTravel): string {
  const blocking = travel.stranded.filter((one) => one.need === "run_needs_it");
  const model = blocking.find((one) => one.custody === "provider_key");
  if (model !== undefined && blocking.length === 1) {
    return MODEL_KEY_STAYS_HOME_REFUSAL;
  }
  const services = plainList(blocking.map((one) => one.service));
  return (
    `This agent's own file says it needs ${services} to do its work, and DASH keeps ` +
    `${blocking.length === 1 ? "that sign-in" : "those sign-ins"} on this computer. ` +
    `DASH does not send them to a server, so the copy it would put there would have ` +
    `nothing to work with. Nothing was sent.`
  );
}

/** "A", "A and B", "A, B and C". A list a person would say out loud. */
function plainList(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the two unions rather than written out — the shape
 * `everyConnectSentence` established in `lib/host-connect.ts` — so a custody or
 * a need added without a sentence turns the plain-language check red instead of
 * shipping a blank half-line.
 */
export function everyTravelSentence(agent = "News Scout", server = "My server"): string[] {
  const custodies: CredentialKind[] = ["oauth", "provider_key", "secret"];
  const needs: ConnectionNeed[] = ["run_needs_it", "agent_runs_without_it", "undeclared"];
  const said: string[] = [];
  for (const custody of custodies) {
    for (const need of needs) {
      const stranded: StrandedConnection = {
        connection_id: "one",
        service: "Your Gmail",
        custody,
        need,
      };
      const travel: ConnectionTravel = {
        verdict: need === "run_needs_it" ? "refuse" : "warn",
        stranded: [stranded],
      };
      const notice = describeConnectionTravel(travel, agent, server);
      if (notice !== null) {
        said.push(notice.headline, ...notice.reasons, ...notice.lines);
        if (notice.next_action !== null) {
          said.push(notice.next_action);
        }
      }
      if (need === "run_needs_it") {
        said.push(describeTravelRefusal(travel));
      }
      const sent = describeStrandedCopy(travel, server);
      if (sent !== null) {
        said.push(sent);
      }
    }
  }
  // Two connections, which the loop above cannot reach: both the refusal and the
  // already-sent line word a list of names differently from a single one.
  const two: ConnectionTravel = {
    verdict: "refuse",
    stranded: [
      { connection_id: "one", service: "Your Gmail", custody: "oauth", need: "run_needs_it" },
      { connection_id: "two", service: "Your calendar", custody: "oauth", need: "run_needs_it" },
    ],
  };
  said.push(describeTravelRefusal(two));
  const bothSent = describeStrandedCopy(two, server);
  if (bothSent !== null) {
    said.push(bothSent);
  }
  return said;
}
