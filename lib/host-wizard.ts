/**
 * Connecting a server, as four steps (MAR-498).
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
 * ## What the provider cards are, and what they are deliberately not
 *
 * MAR-485 — provider recommendations with affiliate links — is an explicit
 * non-goal of this issue, so the cards recommend nothing, rank nothing and link
 * nowhere.
 *
 * They do exactly one thing: fill in the account name that provider gives you by
 * default, and say where its own interface keeps the key list. That is real help
 * for the one question a novice cannot answer from the outside — "it is asking
 * for a user, what is my user?" — and it is a fact about a provider rather than
 * an opinion about one. "Something else" is a first-class choice and not a
 * fallback, which is why it carries the same shape of answer as the named ones.
 */

import { describeBootstrap } from "./host-bootstrap";
import { checkHostRecord, type HostRecord, type HostRecordCheck } from "./hosts";

/* ---------------------------------------------------------------------- *
 * The steps
 * ---------------------------------------------------------------------- */

export type WizardStep = "provider" | "address" | "key" | "check";

export interface WizardStepCopy {
  /** The rail's own label. Plain words; the caps are typography. */
  label: string;
  /** What this step is for, in one line. */
  purpose: string;
}

/**
 * Four steps, named for what the person does rather than for what DASH stores.
 *
 * The concept's rail reads `TYPE — VPS_CONFIG — PARAMS — INIT`. Three of those
 * four are DASH's vocabulary wearing a costume, and MAR-528's adoption of this
 * system is explicit that the caps are typography and the words stay English.
 * "Where it is", "How to reach it", "The key", "Check" is the same rail saying
 * what it is for.
 */
export const WIZARD_STEPS: readonly WizardStep[] = ["provider", "address", "key", "check"];

export function describeStep(step: WizardStep): WizardStepCopy {
  switch (step) {
    case "provider":
      return {
        label: "Where it is",
        purpose:
          "Who you rent the server from. DASH does not recommend one — this only fills in the account name most of them use.",
      };
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

export type ProviderId = "digitalocean" | "hetzner" | "aws" | "other";

export interface ProviderCard {
  id: ProviderId;
  /** The provider's own name, as they spell it. */
  label: string;
  /**
   * The account name that provider hands out on a fresh server.
   *
   * Null for "Something else", which is not a gap: DASH does not know, and a
   * guessed default there would be a wrong answer presented as a helpful one.
   */
  default_username: string | null;
  /** Where the person will paste the public key, in that provider's own words. */
  where_the_key_goes: string;
}

/**
 * The cards, and every field on them is a fact rather than an opinion.
 *
 * No ranking, no prices, no links, no logos — MAR-485 owns all of that and this
 * issue's non-goals name it. What is here is the answer to the one question a
 * novice cannot get from the outside: the account name.
 */
export const PROVIDER_CARDS: readonly ProviderCard[] = [
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
  {
    id: "other",
    label: "Something else",
    default_username: null,
    where_the_key_goes:
      "Wherever that provider keeps its key list, or in the account's own list of allowed keys on the server itself.",
  },
];

export function providerCard(id: ProviderId): ProviderCard {
  const found = PROVIDER_CARDS.find((card) => card.id === id);
  if (found === undefined) {
    throw new Error("unknown provider");
  }
  return found;
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
    case "provider":
      return draft.provider !== null;
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
  const setup = describeSetupStep(hostLabel);
  return [
    ...WIZARD_STEPS.flatMap((step) => {
      const copy = describeStep(step);
      return [copy.label, copy.purpose];
    }),
    ...PROVIDER_CARDS.flatMap((card) => [card.label, card.where_the_key_goes]),
    key.headline,
    key.detail,
    key.refusal,
    key.next_action,
    setup.headline,
    setup.detail,
    setup.disclosure,
    setup.next_action,
    ...setup.what_it_does,
    ...setup.what_it_leaves,
  ];
}
