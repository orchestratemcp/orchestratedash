/**
 * Connecting a server, as three steps (MAR-498, revised by MAR-574).
 *
 * `lib/host-connect.ts` is the *outcome* half of this issue — which states a
 * connected host can be in, and what each one says. It shipped as the design
 * slice with no surface, and the states it owns all begin after a record exists.
 * This is the half in front of that: how a person gets from no server at all to
 * a record DASH can probe, without a terminal at any point.
 *
 * Pure, and it renders nothing. `lib/hosts.ts` owns the record and its refusals;
 * `electron/ssh-host.ts` owns the key and the probe; this owns the order, what
 * each step is for, and the copy between them.
 *
 * ## Why there are three steps and not four
 *
 * There were four, and the first was a grid of provider cards. Henrik used it
 * five times against a real server and said what it was for:
 *
 * > We don't need different servers as examples. Just one "connect a server".
 * > Then if we want pre-filled fields we can have a dropdown once we started
 * > connecting a server.
 *
 * The card grid asked a question before the flow began, and the answer to that
 * question set **one default string** — the account name. That is a convenience
 * on a field, so it is now a field's dropdown rather than a step's worth of
 * screen, and the flow starts where the person thought it started: at the form.
 *
 * The dropdown is optional in the strong sense — no choice is a first-class
 * state with its own answer, not an empty value the form is waiting on. See
 * `describeProviderChoice`.
 *
 * ## The inversion, and why it is the whole design
 *
 * The concept screen for this flow has a field labelled `SSH_PRIVATE_KEY` with a
 * `-----BEGIN OPENSSH PRIVATE KEY-----` placeholder in it, and a
 * `SAVE_KEY_TO_VAULT` checkbox underneath.
 *
 * DASH will never draw that field. MAR-484 made key custody structural rather
 * than a policy: `electron/ssh-host.ts` has **no function that returns a private
 * key**, and a test asserts that over the module's exports rather than trusting a
 * comment, because that is where somebody would add a reader when the deploy
 * plane one day wants to "just check" it. A paste field would hand DASH the one
 * secret it has arranged not to be able to read, and would teach a novice that
 * pasting a private key into an application is a normal thing to do.
 *
 * So the flow is inverted. **DASH makes the key and keeps the private half.**
 * What the person is shown is the public half and where to put it, which is the
 * only part that should ever travel. Step 3 below is that inversion, and it is
 * the step this issue exists for.
 *
 * ## What the provider list is, and what it is deliberately not
 *
 * The options recommend nothing, rank nothing and link nowhere. They do exactly
 * one thing: fill in the account name that provider gives you by default, and
 * say where its own interface keeps the key list. That is real help for the one
 * question a novice cannot answer from the outside — "it is asking for a user,
 * what is my user?" — and it is a fact about a provider rather than an opinion
 * about one.
 *
 * The one opinion DASH does express is `describeHostingRecommendation`, and it
 * is deliberately somewhere else: it answers *"I don't own a server"*, which is
 * a different question from *"what is my account called"*, and it is the only
 * sentence here that names a provider DASH prefers. It is held to its own rules
 * — see that function.
 */

import { describeBootstrap } from "./host-bootstrap";
import { checkHostRecord, type HostRecord, type HostRecordCheck } from "./hosts";

/* ---------------------------------------------------------------------- *
 * The steps
 * ---------------------------------------------------------------------- */

export type WizardStep = "address" | "key" | "check";

export interface WizardStepCopy {
  /** The rail's own label. Plain words; the caps are typography. */
  label: string;
  /** What this step is for, in one line. */
  purpose: string;
}

/**
 * Three steps, named for what the person does rather than for what DASH stores.
 *
 * The concept's rail reads `TYPE — VPS_CONFIG — PARAMS — INIT`. Three of those
 * four are DASH's vocabulary wearing a costume, and MAR-528's adoption of this
 * system is explicit that the caps are typography and the words stay English.
 * "How to reach it", "The key", "Check" is the same rail saying what it is for.
 *
 * "Where it is" — the provider step — is gone rather than renamed. See the
 * module header: it asked a question whose whole effect was one default string.
 */
export const WIZARD_STEPS: readonly WizardStep[] = ["address", "key", "check"];

export function describeStep(step: WizardStep): WizardStepCopy {
  switch (step) {
    case "address":
      return {
        label: "How to reach it",
        purpose: "The address DASH connects to, and the account it signs in as.",
      };
    case "key":
      return {
        label: "The key",
        purpose:
          "DASH makes a key for this server and keeps the private half on this computer. You copy the public half onto the server.",
      };
    case "check":
      return {
        label: "Check",
        purpose: "DASH signs in once to see whether it can reach the agent runner there.",
      };
  }
}

/* ---------------------------------------------------------------------- *
 * Providers
 * ---------------------------------------------------------------------- */

export type ProviderId = "hostinger" | "digitalocean" | "hetzner" | "aws";

export interface ProviderOption {
  id: ProviderId;
  /** The provider's own name, as they spell it. */
  label: string;
  /**
   * The account name that provider hands out on a fresh server.
   *
   * Never null. An option that prefilled nothing would be an entry in a list
   * whose only job is prefilling — which is what "Something else" was, and why
   * it is gone: choosing nothing already means that, and two ways to say the
   * same thing is one of them being wrong later.
   */
  default_username: string;
  /** Where the person will paste the public key, in that provider's own words. */
  where_the_key_goes: string;
}

/**
 * The options, and every field on one is a fact rather than an opinion.
 *
 * No ranking, no prices, no links, no logos. What is here is the answer to the
 * one question a novice cannot get from the outside: the account name.
 *
 * Hostinger is first because it is the provider DASH has actually been proven
 * against — MAR-536's attended run on 2026-08-08 reached a real Hostinger box
 * and the host's own auth log recorded DASH's minted key signing in. That is a
 * fact about what has been tested, and the ordering says nothing more than the
 * list's own order; the recommendation lives in `describeHostingRecommendation`
 * where it can be read as one.
 */
export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    id: "hostinger",
    label: "Hostinger",
    default_username: "root",
    where_the_key_goes: "The SSH keys tab of the server, in its own control panel.",
  },
  {
    id: "digitalocean",
    label: "DigitalOcean",
    default_username: "root",
    where_the_key_goes: "Settings, then Security, then SSH keys.",
  },
  {
    id: "hetzner",
    label: "Hetzner",
    default_username: "root",
    where_the_key_goes: "Security, then SSH keys, on the project the server is in.",
  },
  {
    id: "aws",
    label: "Amazon Web Services",
    default_username: "ubuntu",
    where_the_key_goes: "The key pairs page for the region the server is in.",
  },
];

export function providerOption(id: ProviderId): ProviderOption {
  const found = PROVIDER_OPTIONS.find((option) => option.id === id);
  if (found === undefined) {
    throw new Error("unknown provider");
  }
  return found;
}

/**
 * What the form says beside the dropdown, including when nothing is chosen.
 *
 * The no-choice state is answered rather than left blank, and that is the whole
 * reason this is a function. A dropdown whose unchosen state says nothing reads
 * as a question waiting to be answered; this one has an answer — DASH does not
 * know your provider's default account, so type the account name — which is the
 * same shape of answer the named options give and is why the field is genuinely
 * optional rather than merely un-validated.
 */
export function describeProviderChoice(id: ProviderId | null): {
  where_the_key_goes: string;
} {
  return id === null
    ? {
        where_the_key_goes:
          "Wherever that provider keeps its key list, or in the account's own list of allowed keys on the server itself.",
      }
    : { where_the_key_goes: providerOption(id).where_the_key_goes };
}

/* ---------------------------------------------------------------------- *
 * The person who has no server at all
 * ---------------------------------------------------------------------- */

/**
 * The one opinion on this surface, and the two rules it is written under.
 *
 * Henrik, 2026-08-08: *"I want a 'don't own a server? We recommend Hostinger →
 * click here to get your own server'."* This is that line, and the ratified plan
 * attaches two conditions to it that are load-bearing rather than decorative:
 *
 * 1. **The free local path stays first-class on the same screen.** A person who
 *    reads this must not come away thinking a server is required, because it is
 *    not: agents run on this computer and always have. So `free_path` is part of
 *    the same block rather than a sentence somewhere further down, and it is
 *    stated first in the rendering order.
 * 2. **The outbound link is an affiliate link, and it appears only after the
 *    attended proof passes** (MAR-489). Until then `link_label` is a label with
 *    nothing behind it — see `app/hosts/page.tsx`, which renders it as text and
 *    carries the `TODO-affiliate` marker rather than shipping a control that
 *    does nothing when pressed.
 *
 * No URL appears in this module in either state. A link in copy would be a raw
 * identifier by `lib/copy/identifiers.ts`'s own rule, and keeping the address
 * out of here means the day it arrives is a change to a component and a review
 * of one line, rather than a string that has quietly been in the copy sweep.
 */
export function describeHostingRecommendation(): {
  free_path: string;
  question: string;
  recommendation: string;
  link_label: string;
} {
  return {
    free_path:
      "You do not need a server. Agents run on this computer, for nothing, and that is where most people should start.",
    question: "Do not own a server yet?",
    recommendation:
      "A server is for agents that must keep working while DASH is closed. We recommend Hostinger — it is the one DASH has been tested against on a real machine.",
    link_label: "Get a server from Hostinger",
  };
}

/* ---------------------------------------------------------------------- *
 * What the person has typed so far
 * ---------------------------------------------------------------------- */

export interface HostDraft {
  provider: ProviderId | null;
  label: string;
  address: string;
  username: string;
  port: string;
}

export const EMPTY_DRAFT: HostDraft = {
  provider: null,
  label: "",
  address: "",
  username: "",
  port: "22",
};

/**
 * The default port, as a string, because it lives in a text field.
 *
 * Named rather than written twice: the field's initial value and the check
 * below both need it, and a wizard whose placeholder disagreed with its own
 * default is a wizard that fails on the field nobody edited.
 */
export const DEFAULT_PORT = "22";

/**
 * Can this step be left yet?
 *
 * Deliberately not "is the whole thing valid". Each step gates only on what it
 * asked for, so a person is never blocked on step 2 by something they have not
 * been shown — which is the commonest way a four-step form becomes a dead end.
 */
export function canLeave(step: WizardStep, draft: HostDraft): boolean {
  switch (step) {
    case "address":
      return checkDraft(draft).ok;
    case "key":
    case "check":
      return true;
  }
}

/**
 * The draft as a record, checked by `lib/hosts.ts`'s own rules.
 *
 * Checked *there* rather than re-implemented here, and that is the point of this
 * function existing at all. `checkHostRecord` is where MAR-484 put the refusal
 * that matters — a component of the record that `ssh` would read as an option
 * rather than a value — and a wizard with its own idea of a valid address would
 * be a second, weaker gate in front of the real one.
 *
 * `host_id`, `key_name` and `added_at` are placeholders here: they are DASH's to
 * mint at the moment the record is written, and this function's job is to tell
 * somebody their address is wrong while they can still see the field.
 */
export function checkDraft(draft: HostDraft): HostRecordCheck {
  const port = Number(draft.port);
  const candidate: HostRecord = {
    host_id: "draft",
    label: draft.label.trim(),
    address: draft.address.trim(),
    port: Number.isInteger(port) ? port : -1,
    username: draft.username.trim(),
    key_name: "draft-key",
    host_fingerprint: null,
    added_at: new Date(0).toISOString(),
  };
  return checkHostRecord(candidate);
}

/* ---------------------------------------------------------------------- *
 * The key step
 * ---------------------------------------------------------------------- */

/**
 * What step 3 says, and what it refuses to say.
 *
 * `refusal` is rendered on the step rather than kept as a comment. A person who
 * has connected a server before *expects* to be asked for a private key — every
 * other tool asks — and a flow that simply does not ask reads as one that forgot.
 * Saying that DASH will never ask, on the step where the asking would have
 * happened, is the difference between an omission and a promise.
 */
export function describeKeyStep(hostLabel: string): {
  headline: string;
  detail: string;
  refusal: string;
  next_action: string;
} {
  return {
    headline: `DASH made a key for ${hostLabel}`,
    detail:
      "The private half stays on this computer, protected so only your account can read it. " +
      "DASH cannot show it to you, and it never leaves. Copy the public half below onto the " +
      "server so it will let DASH in.",
    refusal:
      "DASH will not ask you to paste a private key, here or anywhere. It has no way to read " +
      "one back out, which is what makes that a promise rather than a preference.",
    next_action: "Copy the public key, then check the connection",
  };
}

/**
 * The setup step, which is what step 3 should actually offer now (MAR-573).
 *
 * `describeKeyStep` above is unchanged and still true — DASH made a key, the
 * private half stays here, the public half is what travels. What changed is
 * that copying a key onto a server is no longer *enough*: a freshly rented box
 * has nothing on it that can answer DASH, and the 2026-08-08 run proved it by
 * getting all the way to a successful sign-in and being told
 * `status: command not found`.
 *
 * So this is a second thing to say on the same step, added beside the first
 * rather than replacing it. The two are both true and a surface may show either
 * or both: the snippet is the guided answer, and the bare key is what somebody
 * who already administers servers will want.
 *
 * `what_it_does` and `what_it_leaves` come from `lib/host-bootstrap.ts`'s own
 * description rather than being restated here, so the promise on screen and the
 * banner the script prints cannot drift apart.
 */
export function describeSetupStep(hostLabel: string): {
  headline: string;
  detail: string;
  /** The honesty about what the person is about to run. */
  disclosure: string;
  next_action: string;
  what_it_does: string[];
  what_it_leaves: string[];
} {
  const described = describeBootstrap();
  return {
    headline: `Set up ${hostLabel} for DASH`,
    detail:
      "A new server has nothing on it that can talk to DASH yet. Copy the setup text below " +
      "and paste it into your server once — your provider's website has a place to type " +
      "commands, or you can use any terminal you already sign in with.",
    disclosure:
      "You can read the whole thing before you run it. It says what it will install and what " +
      "it leaves behind, and it prints that on your screen before it changes anything.",
    next_action: "Copy the setup text, then run it on the server",
    what_it_does: described.installs,
    what_it_leaves: described.leaves_behind,
  };
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the unions rather than written out, so a step or a provider added
 * without being added here is one the plain-language check never sees — the shape
 * `lib/host-connect.ts`'s `everyConnectSentence` established.
 */
export function everyWizardSentence(hostLabel = "My server"): string[] {
  const key = describeKeyStep(hostLabel);
  const hosting = describeHostingRecommendation();
  const setup = describeSetupStep(hostLabel);
  return [
    ...WIZARD_STEPS.flatMap((step) => {
      const copy = describeStep(step);
      return [copy.label, copy.purpose];
    }),
    ...PROVIDER_OPTIONS.flatMap((option) => [option.label, option.where_the_key_goes]),
    describeProviderChoice(null).where_the_key_goes,
    key.headline,
    key.detail,
    key.refusal,
    key.next_action,
    hosting.free_path,
    hosting.question,
    hosting.recommendation,
    hosting.link_label,
    setup.headline,
    setup.detail,
    setup.disclosure,
    setup.next_action,
    ...setup.what_it_does,
    ...setup.what_it_leaves,
  ];
}
