/**
 * What a fleet connection's standing says, when the vault is part of the answer
 * (MAR-676).
 *
 * ## The three surfaces that described one fact three ways
 *
 * On 2026-08-17 Henrik's AI tab said **CONNECTED**, the scout's briefing box said
 * *"connect its model provider"*, and the tab's own outcome line said *"DASH holds
 * OpenRouter but could not read it from windows credential manager (dpapi) just
 * now, so nothing was given out."* All three were built from true records and only
 * one of them was true about the situation.
 *
 * The chip was the liar, and it lied for a structural reason rather than a copy
 * reason: it was drawn from `held !== null`, which is *the row*. A row says what
 * the person gave DASH. Whether DASH can still read what they gave it is a
 * different question, and on the most credential-sensitive surface DASH has,
 * nothing was asking it. That is MAR-624's shape — a cheerful tile over a
 * mechanism that is not working — on the one page where the reassuring answer
 * costs the most.
 *
 * So standing takes two facts, not one, and the rule is stated as narrowly as it
 * can be: **the chip may say connected only when the secret resolves.**
 *
 * ## Why the words are here and not in the card
 *
 * `lib/copy/`'s standing rule: a sentence composed in a component is a sentence
 * the plain-language sweep does not see. `everyFleetStandingSentence` is what
 * `tests/fleet-standing.test.ts` holds all of these to at once, and it sweeps the
 * **real** vault labels — including the one with `dpapi` in it, which is the OS's
 * own name for its vault and is allowed as content at the call site rather than
 * quietly kept out of the sweep.
 *
 * ## One sentence, two callers
 *
 * `describeFleetSecretUnreadable` is the sentence the standing line renders *and*
 * the one `shareFleetConnection` puts in front of its own "nothing was given out".
 * That is deliberate and it is the "after this they agree" half of MAR-676: two
 * surfaces describing one fact in one set of words cannot drift, and the version
 * Henrik read was already the better wording of the two.
 */

import type { Recovery } from "./recovery";

/**
 * Where a credential-backed fleet connection stands.
 *
 * Three values rather than two, because the middle one has a recovery of its own.
 * Collapsing `unreadable` into `not_connected` would tell somebody to connect
 * something they already connected — and, worse, invite them to overwrite a
 * credential that is probably still good, which `lib/vault.ts`' own `get` refuses
 * to risk for exactly this reason.
 */
export type FleetStanding = "connected" | "unreadable" | "not_connected";

export interface FleetStandingFacts {
  /** Whether DASH holds a record of this connection at all — the row. */
  held: boolean;
  /**
   * Whether the vault gave the secret back when this view was built.
   *
   * Not nullable, and that is the decision rather than an omission. A view built
   * where nothing could look at a vault has not established that the secret
   * resolves, so it passes `false` and gets the honest chip — the developer GET
   * routes are the only producer of that case, and there genuinely *is* no vault
   * behind them. `rollUpConnector`'s rule applied one surface along: on a page
   * about what is safe to run, the one wrong answer is the reassuring one.
   */
  secret_readable: boolean;
}

export function fleetStanding(facts: FleetStandingFacts): FleetStanding {
  if (!facts.held) {
    return "not_connected";
  }
  return facts.secret_readable ? "connected" : "unreadable";
}

export interface FleetStandingChip {
  /** Two to four ordinary words. Caps are typography. */
  label: string;
  tone: "ok" | "warn" | "muted";
}

/**
 * The chip, in the tones the system already has.
 *
 * `unreadable` is amber and not red, on `standingChip`'s own precedent for a
 * reachable-but-empty server: something is wrong and nothing is broken, and a red
 * chip would tell somebody their setup is ruined when a restart may fix it.
 *
 * The label is in DASH's voice rather than the vault's — "DASH cannot read this",
 * beside the existing "DASH does not hold this". A chip naming the credential
 * store would put a machine word on a guided surface, and the sentence underneath
 * is where the mechanism belongs.
 */
export function fleetStandingChip(standing: FleetStanding): FleetStandingChip {
  switch (standing) {
    case "connected":
      return { label: "Connected", tone: "ok" };
    case "unreadable":
      return { label: "DASH cannot read this", tone: "warn" };
    case "not_connected":
      return { label: "Not connected", tone: "muted" };
  }
}

/**
 * The one sentence about a credential DASH holds and cannot read.
 *
 * Henrik's own wording, kept: *"DASH holds OpenRouter but could not read it from
 * windows credential manager (dpapi) just now"*. `vaultLabel` arrives from
 * `describeBacking().label` and is lowered here rather than by each caller, so the
 * two places this appears cannot disagree about the casing of the one clause a
 * person would recognise from having read it before.
 *
 * **The second sentence is the one that had to be checked rather than assumed.**
 * The credential is *not* usually gone. DASH keeps one encrypted file per secret
 * and asks the OS to decrypt it; an envelope that is intact and will not decrypt
 * is reported as `vault_locked` by `lib/vault.ts` precisely so that nobody is told
 * to re-enter a key they already gave — because being told that, and doing it,
 * overwrites the good one. So this says the key is still there.
 *
 * **And the third names a remedy that exists.** `describeBrokerRefusal`'s
 * `vault_unavailable` says "unlock your keyring", which is true on Linux and
 * macOS and means nothing on Windows, where DPAPI is bound to the login session
 * and there is nothing to unlock. Restarting DASH is the remedy that is true
 * everywhere, and connecting again is the honest fallback rather than the first
 * suggestion.
 */
export function describeFleetSecretUnreadable(service: string, vaultLabel: string): Recovery {
  return {
    headline: `DASH holds ${service} but could not read it from ${vaultLabel.toLowerCase()} just now.`,
    meaning:
      "The key itself is almost certainly still there — DASH could not open the place it keeps " +
      "it, so nothing can use it until it can. Nothing was sent and nothing was charged.",
    // No possessive in front of `service`, which is a rule rather than a
    // preference: callers pass a brand name or a description, and "your OpenRouter"
    // reads while "your its model provider" does not. See `describeNotCurated`.
    next_action: `Close DASH and start it again. If it says this a second time, connect ${service} again.`,
    actor: "user",
  };
}

/* ---------------------------------------------------------------------- *
 * The copy sweep
 * ---------------------------------------------------------------------- */

/**
 * Every vault label `lib/vault.ts` can produce, by value.
 *
 * Swept rather than represented by one friendly example, because the label is
 * interpolated into a sentence a person reads and the sweep is the only thing
 * looking at it. `lib/copy/identifiers.ts` would flag `dpapi` as vocabulary, and
 * it is right to — so the exemption is made at the call site in the test, where
 * it shows up in a diff, rather than by keeping the real string out of the set.
 */
export const VAULT_LABELS = [
  "Windows Credential Manager (DPAPI)",
  "macOS Keychain",
  "KDE Wallet",
  "GNOME Keyring",
  "No OS credential vault",
] as const;

export const FLEET_STANDINGS = ["connected", "unreadable", "not_connected"] as const satisfies
  readonly FleetStanding[];

/**
 * Every sentence this module can produce, for the plain-language check.
 *
 * Derived from the two unions rather than written out, so a standing or a vault
 * label added without being added here is one the copy gate never sees — the
 * shape `everyCurationSentence` established and `everyConnectSentence` before it.
 */
export function everyFleetStandingSentence(): string[] {
  const sentences: string[] = FLEET_STANDINGS.map((standing) => fleetStandingChip(standing).label);
  /*
   * Both forms of `service`, for `everyCurationSentence`'s reason: a caller
   * passes a brand name where one is known and a description where one is not,
   * and the possessive rule only fails on the second.
   */
  for (const service of ["OpenRouter", "its model provider"]) {
    for (const label of VAULT_LABELS) {
      const said = describeFleetSecretUnreadable(service, label);
      sentences.push(said.headline, said.meaning, said.next_action);
    }
  }
  return sentences;
}
