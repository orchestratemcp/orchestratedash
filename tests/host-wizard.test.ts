/**
 * Connecting a server, as three steps (MAR-498, revised by MAR-574).
 *
 * `tests/host-connect.test.ts` drives what a *connected* host's states say.
 * This drives the half in front of that: the steps, the provider list, and the
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
  PROVIDER_OPTIONS,
  WIZARD_STEPS,
  canLeave,
  checkDraft,
  describeHostingRecommendation,
  describeKeyStep,
  describeProviderChoice,
  describeStep,
  everyWizardSentence,
  providerOption,
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

describe("the three steps", () => {
  it("are named for what the person does, not for what DASH stores", () => {
    // The concept's rail reads TYPE — VPS_CONFIG — PARAMS — INIT. Three of those
    // four are DASH's vocabulary wearing a costume, and MAR-528's adoption is
    // explicit that the caps are typography and the words stay English.
    expect(WIZARD_STEPS.map((step) => describeStep(step).label)).toEqual([
      "How to reach it",
      "The key",
      "Check",
    ]);
  });

  it("starts at the form, because the provider step chose nothing", () => {
    /*
     * MAR-574. Henrik used the four-card provider grid five times and reported
     * that the choice it demanded set exactly one default string. The flow now
     * begins where a person thought it began — at the fields — and the provider
     * is a convenience on one of them.
     */
    expect(WIZARD_STEPS[0]).toBe("address");
    expect(WIZARD_STEPS).not.toContain("provider");
  });

  it("gives each step a distinct purpose", () => {
    const purposes = WIZARD_STEPS.map((step) => describeStep(step).purpose);
    expect(new Set(purposes).size).toBe(WIZARD_STEPS.length);
  });
});

describe("leaving a step", () => {
  it("gates only on what that step asked for", () => {
    /*
     * Not "is the whole thing valid". Each step gates on what it asked for, so
     * nobody is blocked by something they have not been shown — which is the
     * commonest way a stepped form becomes a dead end.
     */
    expect(canLeave("address", EMPTY_DRAFT)).toBe(false);
    expect(canLeave("address", good)).toBe(true);
  });

  it("never asks for a provider, because the field is genuinely optional", () => {
    // The one assertion that would fail if the dropdown quietly became required
    // again: a complete draft with no provider chosen is a draft that can go on.
    expect(canLeave("address", { ...good, provider: null })).toBe(true);
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

describe("the provider list", () => {
  it("recommends nothing and ranks nothing", () => {
    // The dropdown is a prefill and not an opinion. The one opinion DASH does
    // express lives in `describeHostingRecommendation`, where it can be read as
    // one — see the block below, which holds it to its own rules.
    for (const option of PROVIDER_OPTIONS) {
      const text = `${option.label} ${option.where_the_key_goes}`;
      for (const word of ["recommend", "best", "cheapest", "we suggest", "popular", "http"]) {
        expect(text.toLowerCase(), `${option.label} must not ${word}`).not.toContain(word);
      }
    }
  });

  it("gives every option an account name to prefill, because that is its only job", () => {
    /*
     * MAR-574. An option that prefilled nothing would be an entry in a list
     * whose whole purpose is prefilling — which is what "Something else" was,
     * and why it is gone: choosing nothing already means that.
     */
    for (const option of PROVIDER_OPTIONS) {
      expect(option.default_username.length, option.label).toBeGreaterThan(0);
    }
  });

  it("answers the same question when nothing is chosen", () => {
    // Not a blank. A dropdown whose unchosen state says nothing reads as a
    // question waiting to be answered; this one has an answer.
    expect(describeProviderChoice(null).where_the_key_goes.length).toBeGreaterThan(0);
    expect(describeProviderChoice("hostinger").where_the_key_goes).toBe(
      providerOption("hostinger").where_the_key_goes,
    );
  });

  it("carries the one provider DASH has actually been proven against", () => {
    // MAR-536's attended run on 2026-08-08 reached a real Hostinger box and the
    // host's own auth log recorded DASH's minted key signing in. Every other
    // name on the list is a fact about a default account name and nothing more.
    expect(PROVIDER_OPTIONS.map((option) => option.id)).toContain("hostinger");
  });
});

describe("the person who does not own a server", () => {
  const copy = describeHostingRecommendation();

  it("says the free local path first, so hosting cannot read as required", () => {
    /*
     * The load-bearing half of Henrik's own line. A person who reads a
     * recommendation must not come away thinking a server is needed, because it
     * is not — agents run on this computer and always have.
     */
    expect(copy.free_path).toContain("do not need a server");
    expect(copy.free_path.toLowerCase()).toContain("nothing");
  });

  it("names the one provider it recommends, and says why", () => {
    expect(copy.recommendation).toContain("Hostinger");
    expect(copy.recommendation).toContain("tested against");
  });

  it("carries no link, in either the label or the sentences", () => {
    /*
     * The outbound link is an affiliate link and the ratified plan puts it after
     * the attended proof passes (MAR-489). Until then no address exists here at
     * all — which is also what keeps this copy clean under the raw-identifier
     * rule, since a URL is one.
     */
    for (const sentence of [copy.free_path, copy.question, copy.recommendation, copy.link_label]) {
      expect(sentence).not.toContain("http");
      expect(sentence).not.toContain(".com");
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
