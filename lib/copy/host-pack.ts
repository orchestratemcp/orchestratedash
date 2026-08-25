/**
 * What DASH says about a server's host pack (MAR-629, ADR 0021).
 *
 * Separate from `lib/deploy/host-pack.ts` because that module returns a verdict
 * and this one words it — `lib/copy/bring-home.ts`'s split, for its reason: a
 * change to a rule and a change to a word should not look identical in a diff.
 *
 * ## The named stop, and why it is not `helper_too_old`
 *
 * ADR 0017 gave "this server cannot remove an agent" its own sentence rather
 * than a generic refusal, because a generic refusal sends somebody looking at
 * their server for DASH's version skew. ADR 0021 section 4 makes the same
 * choice again and says why reusing the first one would be wrong: the shipped
 * `helper_too_old` sentence is about not being able to **remove** an agent, and
 * collapsing "cannot run the host broker" into it would tell a person the wrong
 * thing about their own machine. The exit is the same act; the reason shown is
 * not.
 *
 * ## The sentence this file was waiting to earn (MAR-794, ADR 0018)
 *
 * MAR-629 left a paragraph here saying there was no sentence in this file
 * offering to put a key on a server, *"and that absence is the honest state of
 * this pack rather than an oversight"*. `install-key` has landed, so the
 * sentences are written below, beside the stop that tells a person why the offer
 * is not available on their older server — which is where MAR-629 said they
 * would belong.
 *
 * ## And the one that is still not said, which is not the same sentence
 *
 * `MODEL_KEY_STAYS_HOME_REFUSAL` in `lib/ai/model-choice.ts` is **unchanged**,
 * and that is a decision rather than an omission. It fires on the *deploy* path,
 * when an agent whose plan needs a model has a key DASH is holding for it: the
 * deploy is refused and no bundle is installed. `install-key` cannot help there,
 * because it can only target a bundle that is **already installed** — so naming
 * it as the exit would point a person at a control that would refuse them.
 *
 * ADR 0018 does describe that exit (*"DASH installs the ordinary bundle without
 * starting it, performs the ceremony, invokes `install-key`, records the
 * receipt, and only then starts the remote runner"*), and it is a re-ordering of
 * the deploy sequence rather than a sentence. It is not in this packet, and
 * writing the sentence without the sequence would be the failure ADR 0002 exists
 * to prevent — a surface claiming a path that stops one step short — arrived at
 * from the other side.
 *
 * What **is** reachable today is the path the attended proof takes: an agent
 * that deploys without its key (MAR-619's News Scout declares its model
 * connection optional and runs degraded), and then one press on the server row.
 * Every sentence below is about that path.
 */

import type { HostPackVerdict } from "../deploy/host-pack";
import type { PlacementStanding } from "../deploy/key-placement";

/**
 * Why this server cannot run a host broker, and the one thing to do about it.
 *
 * ADR 0021 section 4 fixes the wording and a test pins it by value, for
 * `MODEL_KEY_STAYS_HOME_REFUSAL`'s reason: it reaches a surface, and a sentence
 * composed where it is rendered is a sentence the next person reworders.
 *
 * `label` is the name the person gave the server. Never an address, never a host
 * id — the rule every sentence in `lib/copy/bring-home.ts` keeps, and the reason
 * `186.240.156.166` appears in an ADR and never on a screen.
 */
export function describeHostPackTooOld(label: string): string {
  return (
    `${label} was set up with an older copy of DASH's setup step, which cannot run the host ` +
    `broker — so a key placed there could not be used yet. Run the setup step for this server ` +
    `again.`
  );
}

/**
 * What a server row says about its pack, or nothing.
 *
 * Null for a host that is current, because a row that announced "this server is
 * up to date" on every line would be noise on the ordinary case — the same
 * instinct `describeReadOnlyHost` follows when it returns null for the installed
 * app.
 *
 * Null too when DASH could not reach the server. That is the distinction
 * `HostPackVerdict` carries a third member for: an unreachable box has told DASH
 * nothing about its pack, and saying "run setup again" about a machine that is
 * merely asleep would send somebody to re-run an install they do not need. The
 * reachability failure has its own sentence elsewhere and is not this module's.
 */
export function describeHostPack(verdict: HostPackVerdict, label: string): string | null {
  if (verdict.ok || verdict.stop === "unreachable") {
    return null;
  }
  return describeHostPackTooOld(label);
}

/* ---------------------------------------------------------------------- *
 * Putting a key on a server (MAR-794, ADR 0018)
 * ---------------------------------------------------------------------- */

/**
 * What a server that is ready and holds nothing of yours says about itself.
 *
 * The middle state of the residency line: the pack is current, so a key placed
 * there could be used — and nothing has been placed. Said out loud rather than
 * left blank, because a blank reads as "nothing to know here" and the thing a
 * person needs to know before they press anything is that this server is empty.
 *
 * Two sentences and no offer. The offer is a control, and a sentence that
 * described a control would be a second place for it to go missing from.
 */
export const HOST_READY_AND_EMPTY =
  "Ready to hold a key for an agent. Nothing of yours is on it yet.";

/**
 * The affirmative action, naming the movement (ADR 0018's ceremony, "Action").
 *
 * *"'Continue' and 'Allow' hide the consequence and are not admitted."* So the
 * label says what happens and where, and it is built from the server's own
 * displayed name — the same rule every sentence in this file keeps, and the
 * reason `186.240.156.166` appears in an ADR and never on a screen.
 *
 * Short on purpose: [[buttons-force-uppercase-globally]], and a long label in
 * capitals is a label nobody reads.
 */
export function describeKeyPlacementAction(label: string): string {
  return `Put this key on ${label}`;
}

/** The frame ADR 0018 requires before a byte moves, as the four things it names. */
export interface KeyPlacementFrame {
  /** What the frame is for, in one line. */
  headline: string;
  /** The key, by its human provider label and the connection that owns it. Never a value. */
  key: string;
  /** The server, by label, address and confirmed identity. */
  server: string;
  /** The deployed copy and the declared need this key satisfies. */
  agent: string;
  /** The custody sentence, verbatim and load-bearing. */
  custody: string;
  /** What one press authorises, and what it does not. */
  scope: string;
  /** The affirmative action's label. */
  action: string;
}

/**
 * The consent ceremony, in words (ADR 0018 "The consent ceremony").
 *
 * ## Why the whole frame is one function
 *
 * *"The ceremony is not a generic confirmation with a secret-looking icon."*
 * Four facts have to be on screen **together** before the press is available,
 * and a component that assembled them from four call sites is a component
 * somebody can ship with three. Built here, the frame either has all of them or
 * does not compile.
 *
 * ## Every argument is a name a person chose or an author wrote
 *
 * `keyLabel` is the provider's human label — "Your OpenRouter key" — and never
 * the value; ADR 0018 admits a masked suffix to disambiguate two keys and
 * refuses one as a substitute for the name, which is why this takes a label and
 * has nowhere to put a suffix that arrived on its own.
 *
 * `fingerprint` is the confirmed host key. It is the one technical-looking
 * string on the frame and it is there for the reason ADR 0018 gives: the label
 * makes the row readable and the address and fingerprint make it *the enrolled
 * machine rather than another row with the same label*. `lib/copy/identifiers.ts`
 * is told about it explicitly where this is tested, rather than the rule being
 * loosened.
 *
 * ## The custody sentence is quoted, not composed
 *
 * ADR 0018 fixes the first clause and ADR 0021 section 3 extends it, and
 * `HOST_KEY_PROTECTION_SENTENCE` is already a constant in `runner/host-pack.ts`
 * for `MODEL_KEY_STAYS_HOME_REFUSAL`'s reason. Composed here from that constant
 * so the two cannot drift, and never softened: the word it must not contain is
 * "keychain", because the local vault is one and this is not.
 */
export function describeKeyPlacementFrame(options: {
  keyLabel: string;
  serverLabel: string;
  address: string;
  fingerprint: string | null;
  agentName: string;
  need: string;
}): KeyPlacementFrame {
  return {
    headline: `Put ${options.keyLabel} on ${options.serverLabel}`,
    key: `${options.keyLabel}, which DASH holds in this computer's vault.`,
    server:
      options.fingerprint === null
        ? `${options.serverLabel}, at ${options.address}. You have not confirmed this server's identity yet.`
        : `${options.serverLabel}, at ${options.address}, with the identity you confirmed: ${options.fingerprint}`,
    agent: `${options.agentName}, the copy on this server, which asks for ${options.need}.`,
    custody: describeKeyCustody(options.serverLabel),
    /*
     * ADR 0018: *"The press authorises one attempt. If SSH is unreachable, the
     * helper refuses, or the mode/owner proof fails, the approval is spent and
     * no automatic retry waits for the host to return."* Said on the frame,
     * because a person who is told a press is one attempt reads a failure as a
     * thing that did not happen rather than as a thing that might still.
     */
    scope:
      "This is one press for this key on this server. If it does not work, nothing is retried on its own and nothing is sent later.",
    action: describeKeyPlacementAction(options.serverLabel),
  };
}

/**
 * The custody sentence, whole (ADR 0018 rule 1, extended by ADR 0021 section 3).
 *
 * Three clauses and a test pins it by value. The first is ADR 0018's, the
 * second is ADR 0021's honest protection claim, and the third is the only act
 * this product calls revocation.
 */
export function describeKeyCustody(label: string): string {
  return (
    `From this moment the key lives on ${label} too — DASH cannot see or take back what uses it ` +
    `there; ${HOST_KEY_PROTECTION_CLAUSE}; revoking means rotating at the provider.`
  );
}

/**
 * ADR 0021's protection clause, restated rather than imported.
 *
 * `runner/host-pack.ts` already holds this as `HOST_KEY_PROTECTION_SENTENCE` and
 * that is where ADR 0021 put it — but that module opens `node:fs` and
 * `node:crypto` at the top, and this one is read by `"use client"` trees.
 * [[is-masked-hint-is-node-only]] is the last time an import like that crossed
 * the same line, and the symptom was a page that stopped hydrating rather than a
 * type error.
 *
 * So it is two constants, and `tests/install-key.test.ts` asserts the sentence
 * below **contains** the runner's — a check that can only run in Node, which is
 * exactly where it belongs. A copy that drifted would fail there rather than on
 * somebody's screen.
 */
const HOST_KEY_PROTECTION_CLAUSE =
  "the key is protected by that machine's account, not by a keychain";

/**
 * What one placed key says on the server row afterwards.
 *
 * A report with an age on it, in `describeSentStanding`'s shape and for its
 * reason: DASH proved the placement at a moment and has proved nothing since.
 * *"A later unreachable host makes the row stale, not false."*
 */
export function describePlacedKey(keyLabel: string, agentName: string, placedOn: string): string {
  return `${keyLabel} — placed for ${agentName} on ${placedOn}. DASH cannot see what uses it there.`;
}

/**
 * The orphan sentence: a key that has lost the agent it was placed for.
 *
 * ## Why this is a line on the card and not a refusal later
 *
 * ADR 0018 requires it in the packet that builds the verb: *"an orphaned slot
 * must appear on the server row rather than surface as a refusal when an agent
 * next asks."* The failure it prevents is the remote half of
 * [[store-and-vault-are-two-roots]] — a host has two roots as well, `bundles/`
 * which a re-install replaces and `secrets/` which `install` never writes, so a
 * key can be addressed to an agent that is no longer there and nothing on either
 * machine would say so.
 *
 * It does not offer to remove anything, because nothing can: taking a key off a
 * host is its own verb, it is not in this packet, and an offer that led to a
 * refusal would be worse than the line. What it offers is the act that always
 * works, which is the one the custody sentence has named all along.
 */
export function describeOrphanedKeys(count: number): string {
  const what = count === 1 ? "One key is" : `${String(count)} keys are`;
  const its = count === 1 ? "the agent it was" : "the agents they were";
  return (
    `${what} still on this server for ${its} placed for, and ${count === 1 ? "that agent is" : "those agents are"} no longer installed here. ` +
    `DASH cannot take a key off a server yet. Rotating at the provider is what stops it being used.`
  );
}

/**
 * Every key still on a server, said before DASH forgets that server.
 *
 * ADR 0018: *"the forget flow must preserve an unresolved custody warning until
 * the user rotates the provider key or explicitly records that they removed the
 * remote copy themselves."* ADR 0010 forbids the row that would carry that
 * warning afterwards — a record that outlived its label could only render as a
 * claim about a machine DASH can no longer name — so the warning is said at the
 * last moment it can be true, which is before the press. ADR 0018 amendment 1
 * records the split.
 *
 * Null when nothing was placed, so the ordinary forget keeps the confirmation it
 * already has.
 */
export function describeForgettingWithKeys(count: number, label: string): string | null {
  if (count <= 0) {
    return null;
  }
  const what = count === 1 ? "a key you placed" : `${String(count)} keys you placed`;
  return (
    `${label} still holds ${what}. Forgetting this server does not remove ${count === 1 ? "it" : "them"}, and ` +
    `DASH will no longer be able to tell you ${count === 1 ? "it is" : "they are"} there. Rotating at the provider is the only certain step.`
  );
}

/**
 * Every sentence this module can produce, for the copy test.
 *
 * `everyServerCardSentence`'s shape: derived from the states rather than
 * written out, so a state added without being added here is one the
 * plain-language check never sees.
 */
export function everyHostPackSentence(): string[] {
  const frame = describeKeyPlacementFrame({
    keyLabel: "Your OpenRouter key",
    serverLabel: "My server",
    address: "example.test",
    fingerprint: null,
    agentName: "News Scout",
    need: "a language model",
  });
  return [
    describeHostPackTooOld("My server"),
    HOST_READY_AND_EMPTY,
    frame.headline,
    frame.key,
    frame.server,
    frame.agent,
    frame.custody,
    frame.scope,
    frame.action,
    describePlacedKey("Your OpenRouter key", "News Scout", "20 August 2026"),
    describeOrphanedKeys(1),
    describeOrphanedKeys(2),
    describeForgettingWithKeys(1, "My server") ?? "",
    describeForgettingWithKeys(2, "My server") ?? "",
  ];
}

/**
 * Whether this server row has anything to say about placed keys at all.
 *
 * A helper rather than a component's `.length > 0`, so the card and the test
 * agree on what "has something to say" means.
 */
export function hasPlacementNews(standings: readonly PlacementStanding[]): boolean {
  return standings.length > 0;
}

