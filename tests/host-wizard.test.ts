/**
 * Connecting a server, as four steps (MAR-498).
 *
 * `tests/host-connect.test.ts` drives what a *connected* host's states say.
 * This drives the half in front of that: the steps, the provider cards, and the
 * gate that decides whether a step can be left.
 *
 * The assertion this file exists for is the negative one at the bottom. The
 * concept screen for this flow has a private-key textarea on it, and the whole
 * design is that DASH never draws one — so there is a check that no sentence
 * this module can produce asks for a private key, written against the module's
 * whole output rather than against the one string somebody remembered.
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PORT,
  EMPTY_DRAFT,
  PROVIDER_CARDS,
  WIZARD_STEPS,
  canLeave,
  checkDraft,
  describeKeyStep,
  describeStep,
  everyWizardSentence,
  providerCard,
  type HostDraft,
} from "../lib/host-wizard";
import { describeDeployArrangement, describeDeployReceipt } from "../lib/deploy/bundle";
import { expectPlainLanguage } from "./helpers/plain-language";

const good: HostDraft = {
  provider: "hetzner",
  label: "My server",
  address: "example.com",
  username: "root",
  port: DEFAULT_PORT,
};

describe("the four steps", () => {
  it("are named for what the person does, not for what DASH stores", () => {
    // The concept's rail reads TYPE — VPS_CONFIG — PARAMS — INIT. Three of those
    // four are DASH's vocabulary wearing a costume, and MAR-528's adoption is
    // explicit that the caps are typography and the words stay English.
    expect(WIZARD_STEPS.map((step) => describeStep(step).label)).toEqual([
      "Where it is",
      "How to reach it",
      "The key",
      "Check",
    ]);
  });

  it("gives each step a distinct purpose", () => {
    const purposes = WIZARD_STEPS.map((step) => describeStep(step).purpose);
    expect(new Set(purposes).size).toBe(WIZARD_STEPS.length);
  });
});

describe("leaving a step", () => {
  it("gates only on what that step asked for", () => {
    /*
     * Not "is the whole thing valid". A person on step 1 who has picked a
     * provider must be able to reach step 2, where the address they have not
     * typed yet is asked for — gating step 1 on the whole record is the
     * commonest way a four-step form becomes a dead end.
     */
    expect(canLeave("provider", EMPTY_DRAFT)).toBe(false);
    expect(canLeave("provider", { ...EMPTY_DRAFT, provider: "aws" })).toBe(true);
    expect(canLeave("address", { ...EMPTY_DRAFT, provider: "aws" })).toBe(false);
    expect(canLeave("address", good)).toBe(true);
  });

  it("never blocks the last two, because neither takes input", () => {
    expect(canLeave("key", EMPTY_DRAFT)).toBe(true);
    expect(canLeave("check", EMPTY_DRAFT)).toBe(true);
  });
});

describe("the draft's own refusals", () => {
  it("come from lib/hosts.ts rather than from a second set of rules", () => {
    /*
     * The load-bearing one. `checkHostRecord` is where MAR-484 put the refusal
     * that matters — a component `ssh` would read as an option rather than a
     * value — and a wizard with its own idea of a valid address would be a
     * weaker second gate in front of the real one.
     */
    const injected = checkDraft({ ...good, address: "-oProxyCommand=curl evil" });
    expect(injected.ok).toBe(false);
    if (!injected.ok) {
      expect(injected.problem).toBe("option_injection");
    }
  });

  it("refuses a port that is not a number, rather than sending NaN to argv", () => {
    const bad = checkDraft({ ...good, port: "twenty two" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.problem).toBe("malformed_port");
    }
  });

  it("accepts an ordinary server", () => {
    expect(checkDraft(good).ok).toBe(true);
  });
});

describe("the provider cards", () => {
  it("recommend nothing and rank nothing", () => {
    // MAR-485 — provider recommendations with affiliate links — is an explicit
    // non-goal of this issue. Every field on a card has to be a fact about that
    // provider rather than an opinion about it.
    for (const card of PROVIDER_CARDS) {
      const text = `${card.label} ${card.where_the_key_goes}`;
      for (const word of ["recommend", "best", "cheapest", "we suggest", "popular", "http"]) {
        expect(text.toLowerCase(), `${card.label} must not ${word}`).not.toContain(word);
      }
    }
  });

  it("has a Something else that is a first-class choice", () => {
    // Not a fallback. It answers the same question the named ones do, and it
    // answers it by admitting DASH does not know the account name — a guess
    // there would be a wrong answer presented as a helpful one.
    const other = providerCard("other");
    expect(other.default_username).toBeNull();
    expect(other.where_the_key_goes.length).toBeGreaterThan(0);
  });

  it("gives every named provider an account name to prefill", () => {
    for (const card of PROVIDER_CARDS.filter((one) => one.id !== "other")) {
      expect(card.default_username, card.label).not.toBeNull();
    }
  });
});

describe("the key step", () => {
  it("says out loud that DASH will never ask for a private key", () => {
    /*
     * Said, rather than merely not asked. Somebody who has connected a server
     * before *expects* to be asked — every other tool asks — and a flow that
     * quietly does not ask reads as one that forgot rather than as one that
     * decided.
     */
    const copy = describeKeyStep("My server");
    expect(copy.refusal).toContain("will not ask you to paste a private key");
    expect(copy.refusal).toContain("no way to read");
  });

  it("promises the private half never leaves, and offers no way to see it", () => {
    const copy = describeKeyStep("My server");
    expect(copy.detail).toContain("stays on this computer");
    expect(copy.detail).toContain("cannot show it to you");
  });
});

describe("the deploy receipt, before there is an agent to name", () => {
  it("is the same three limits as the named one, not a second copy", () => {
    /*
     * ADR 0007 requires the while-closed sentence to be said *before the first
     * deploy*, and the connect flow is the last moment that is still true. Two
     * copies of a disclosure are two copies that can be softened independently,
     * and the one that would get softened is the one somebody reads while
     * deciding rather than while confirming.
     */
    expect(describeDeployArrangement("My server").limits).toEqual(
      describeDeployReceipt("News Scout", "My server").limits,
    );
    expect(describeDeployArrangement("My server").revocation).toBe(
      describeDeployReceipt("News Scout", "My server").revocation,
    );
  });

  it("differs only in the one sentence that names an agent", () => {
    expect(describeDeployArrangement("My server").what).not.toBe(
      describeDeployReceipt("News Scout", "My server").what,
    );
    expect(describeDeployArrangement("My server").what).not.toContain("News Scout");
  });

  it("keeps the unpleasant limit unsoftened", () => {
    // Turning a connection off in DASH does not stop an agent that holds its own
    // credentials on a machine the user administers. A sentence implying
    // otherwise would be the exact dishonesty ADR 0006 spent its length refusing.
    expect(describeDeployArrangement("My server").limits[2]).toContain(
      "Turning this off in DASH does not stop it",
    );
  });
});

describe("every sentence in the flow", () => {
  it("is plain language", () => {
    expectPlainLanguage([
      ...everyWizardSentence(),
      ...describeDeployArrangement("My server").limits,
      describeDeployArrangement("My server").what,
      describeDeployArrangement("My server").revocation,
    ]);
  });

  it("never asks for a private key, in any wording", () => {
    /*
     * The negative assertion this whole file exists for, and it is written over
     * the module's entire output rather than over the one sentence somebody
     * remembered. The concept screen has an `SSH_PRIVATE_KEY` textarea; the only
     * mention of a private key DASH may make is a refusal to want one.
     */
    for (const sentence of everyWizardSentence()) {
      const mentions = sentence.toLowerCase().includes("private key");
      if (!mentions) {
        continue;
      }
      expect(sentence, "a private key may only be mentioned in order to refuse it").toMatch(
        /will not ask|never ask|no way to read/i,
      );
    }
    // …and no sentence invites one in.
    for (const sentence of everyWizardSentence()) {
      expect(sentence.toLowerCase()).not.toContain("paste your private");
      expect(sentence.toLowerCase()).not.toContain("begin openssh");
    }
  });
});
