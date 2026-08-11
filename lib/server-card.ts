/**
 * A saved server, as the thing you manage (MAR-574).
 *
 * `lib/host-wizard.ts` is how a server gets added and `lib/host-connect.ts` is
 * what a check says. This is the surface between them that did not exist: what
 * one saved record says about itself once it is saved.
 *
 * Pure, and it renders nothing. `app/_components/server-card.tsx` draws it.
 *
 * ## The defect this module exists because of
 *
 * The Servers route rendered the add-a-server wizard unconditionally. A saved
 * server was therefore invisible — Henrik connected a real Hostinger box, the
 * probe passed, he restarted DASH, and the page showed step 1 again as if
 * nothing had ever been added. The record was never lost: a consistent snapshot
 * of his store holds **four** rows, one per attempt, all one machine, because
 * "add another" was the only affordance the page had.
 *
 * So two things are wrong and only one of them is the wizard. This module is the
 * other one: the vocabulary for a record that exists.
 *
 * ## What DASH does not know, and says so
 *
 * DASH keeps **no record of what it has deployed where**. `host.deploy` pushes a
 * bundle and starts it and stores nothing; the only account of what is running
 * on a server is the server's own answer to a check. Every sentence here about
 * what is deployed is therefore worded as a report with an age, never as a fact
 * DASH holds — which is the same discipline `draft.placement` keeps between the
 * agent's claim and DASH's record, applied to a machine somebody else owns.
 *
 * ## Two states this surface can render that nothing can yet reach
 *
 * A record whose `fingerprint` is null is MAR-572's state — DASH pins a host key
 * at first connect and the enrollment flow that would record one was never
 * built, so every real record has a null here. It is rendered as what it is
 * rather than hidden, because the alternative is a page that silently omits the
 * one fact a person would want before trusting a machine.
 *
 * A server that is not set up yet is where MAR-573's bootstrap belongs. MAR-579
 * wired it: the setup snippet (`describeSetupStep`, `host.setup`) is offered on
 * the card, so what used to be a dead-end gap sentence is now an action.
 */

import { plainMoment } from "./copy/when";
import {
  describeConnectState,
  HOST_REACH_PROBLEMS,
  type HostConnectState,
  type HostReach,
} from "./host-connect";

/* ---------------------------------------------------------------------- *
 * The standing at a glance (MAR-605)
 * ---------------------------------------------------------------------- */

/**
 * The chip beside a server's name.
 *
 * ## Why this is here and not in the component
 *
 * It used to be a `switch` in `app/_components/server-card.tsx`, and that
 * location was the defect rather than a detail of it. MAR-489's attended run
 * photographed a card whose chip read **CANNOT REACH** directly above a body
 * reading *"The server is answering and would not let DASH in."* Two places
 * decided one fact — the prose in `describeUnreachable`, the chip in a switch
 * beside the JSX — and nothing obliged them to agree.
 *
 * So the chip is copy, it lives with the copy, and it is under the same
 * plain-language sweep every other sentence on this card is.
 *
 * ## The label is built, not typed
 *
 * `reachWord` turns the standing's own `reach` into the first half of the
 * label, and the switch below may only supply the second half. That is the
 * whole mechanism: a chip cannot say "cannot reach" beside a sentence that says
 * the server answered, because the words "Answering" and "Signed in" are
 * generated from the same value the sentence's author set, and no branch here
 * is given the chance to write its own.
 *
 * A person reading the chip should reach the same conclusion as a person
 * reading the body. MAR-605 states the cost of the alternative exactly: *"A
 * person reading the chip concludes their network is broken; a person reading
 * the body concludes they have one step left."*
 */
export interface StandingChip {
  label: string;
  tone: string;
  /** Carried so a test can assert the chip and the body agree by construction. */
  reach: HostReach;
}

/**
 * How far DASH got, as the two or three words a chip opens with.
 *
 * Null for the rungs where DASH has made no claim about the server at all —
 * nothing has been asked, or a check is still in flight — because a chip that
 * opened with a reach word there would be reporting a result that does not
 * exist yet.
 */
function reachWord(reach: HostReach): string | null {
  switch (reach) {
    case "not_asked":
    case "asking":
      return null;
    case "this_computer":
      return "This computer";
    case "no_answer":
      return "No answer";
    case "answering":
      return "Answering";
    case "signed_in":
      return "Signed in";
    case "connected":
      return "Connected";
  }
}

/**
 * What is blocking, given that the reach word above has already said where.
 *
 * Short enough to sit beside it: the chip is uppercased and letter-spaced by
 * `app/globals.css`, so the pair has to survive being read as one phrase at the
 * narrowest frame `electron/capture-servers.ts` shoots.
 *
 * Null when the reach word is the whole answer. That is only the top of the
 * ladder — DASH reached the runner and it answered, so there is nothing left
 * to qualify — and it is why the rung exists apart from `signed_in`.
 */
function standingQualifier(state: HostConnectState): string | null {
  switch (state.step) {
    case "no_host":
      return "Not connected";
    case "not_checked":
      return "Not checked";
    case "awaiting_key_install":
      return "Waiting for its key";
    case "probing":
      return "Checking";
    case "confirm_host_key":
      return "needs your OK";
    case "reachable":
      return null;
    case "unreachable":
      switch (state.problem) {
        case "no_ssh_on_this_computer":
          return "cannot reach servers yet";
        case "ssh_tools_cannot_check_here":
          return "could not finish the check";
        case "no_answer_at_address":
          return "at this address";
        case "host_key_not_trusted":
          return "needs your OK";
        case "key_not_on_server":
          return "key not installed there";
        case "sign_in_refused":
          return "sign-in refused";
        case "server_identity_changed":
          return "as a different server";
        case "helper_not_installed":
          return "not set up yet";
        case "no_runner_there":
          return "nothing running";
        case "runner_refused_credential":
          return "not recognised";
      }
  }
}

/**
 * How loudly the chip is drawn.
 *
 * `no_runner_there` is deliberately **not** an error tone, and neither is
 * `key_not_on_server`. Both are what a working server looks like before
 * somebody has finished setting it up — the attended run's own copy calls the
 * first *"reachable, with nothing running on it"* — and colouring them red
 * tells a person their server is broken on the day they rented it.
 *
 * Red is spent on the three states where something is genuinely wrong or
 * unknown: nothing answered, the sign-in was turned away, and the machine may
 * not be the one DASH connected to before.
 */
function standingTone(state: HostConnectState): string {
  switch (state.step) {
    case "reachable":
      return "chip-ok";
    case "probing":
    case "not_checked":
    case "no_host":
      return "chip-muted";
    case "awaiting_key_install":
    case "confirm_host_key":
      return "chip-warn";
    case "unreachable":
      switch (state.problem) {
        case "no_answer_at_address":
        case "sign_in_refused":
        case "server_identity_changed":
        case "no_ssh_on_this_computer":
        case "ssh_tools_cannot_check_here":
          return "chip-err";
        case "host_key_not_trusted":
        case "key_not_on_server":
        case "helper_not_installed":
        case "no_runner_there":
        case "runner_refused_credential":
          return "chip-warn";
      }
  }
}

export function standingChip(state: HostConnectState): StandingChip {
  const { reach } = describeConnectState(state);
  const word = reachWord(reach);
  const qualifier = standingQualifier(state);
  /*
   * The two halves, and neither branch lets one place write both. A reach with
   * no word (nothing asked, or a check in flight) is carried by the qualifier
   * alone, because there is no result to report yet; a reach with no qualifier
   * is the top of the ladder and needs nothing added to it.
   */
  const label =
    word === null
      ? (qualifier ?? "Not checked")
      : qualifier === null
        ? word
        : `${word}, ${qualifier}`;
  return { label, tone: standingTone(state), reach };
}

/* ---------------------------------------------------------------------- *
 * The facts on the card
 * ---------------------------------------------------------------------- */

/**
 * When this record was added, in words.
 *
 * `plainMoment` returns null for anything it cannot read, and the fallback here
 * says that rather than echoing the stored string — which would put the exact
 * machine spelling `lib/copy/when.ts` exists to remove back on the screen.
 */
export function describeAdded(addedAt: string): string {
  const moment = plainMoment(addedAt);
  return moment === null ? "Added at a time DASH cannot read" : `Added ${moment}`;
}

/**
 * How DASH reaches it, as one sentence rather than three labelled values.
 *
 * The port appears only when it is not the ordinary one. A person who never
 * chose a port is not helped by being shown the number everybody uses, and a
 * person who did choose one needs to see it — so the field earns its place on
 * the card by being unusual, which is `lib/copy/record-card.ts`'s cut between
 * the primary line and the disclosure applied to a single value.
 */
export function describeSignIn(server: {
  address: string;
  username: string;
  port: number;
}): string {
  const signIn = `DASH signs in to ${server.address} as ${server.username}`;
  return server.port === 22 ? signIn : `${signIn}, on port ${String(server.port)}`;
}

/* ---------------------------------------------------------------------- *
 * The pinned identity (MAR-572's state, rendered)
 * ---------------------------------------------------------------------- */

export interface ServerFact {
  headline: string;
  detail: string;
  /** Null exactly when there is nothing for the person to do about it. */
  next_action: string | null;
}

/**
 * What DASH has recorded about *which machine* this is.
 *
 * The null case is the honest one and it is the case every real record is in
 * today. It deliberately does **not** say "check this server to record it":
 * MAR-572 is the finding that no enrollment flow exists, so an instruction to
 * produce the pin by checking would be an instruction that does not work. A
 * next action that fails is worse than none, because the person who follows it
 * concludes their server is broken.
 *
 * The fingerprint itself is never interpolated into a sentence — it is a value,
 * and the card draws it as one. Same rule the public key already gets.
 */
export function describePin(fingerprint: string | null): ServerFact {
  return fingerprint === null
    ? {
        headline: "DASH has not recorded this server's identity",
        detail:
          "The first time DASH signs in to a server it records the fingerprint that server " +
          "answers with, so it can warn you later if something else answers at the same " +
          "address. There is no such record for this one, so DASH cannot make that " +
          "comparison yet.",
        next_action: null,
      }
    : {
        headline: "This server's identity is recorded",
        detail:
          "DASH will only sign in to a server that answers with this fingerprint. If " +
          "anything else ever answers at this address, DASH stops rather than signing in " +
          "to it and tells you.",
        next_action: null,
      };
}

/* ---------------------------------------------------------------------- *
 * What is running there
 * ---------------------------------------------------------------------- */

/**
 * What DASH can say about what is deployed, given the standing it has.
 *
 * Every branch is worded as a report rather than as a holding: DASH stores
 * nothing about what it deployed, and a card that said "2 agents" without
 * saying *when the server said so* would be claiming a record DASH does not
 * keep. The person can then read a stale number as a live one, which is the
 * failure this whole surface exists to stop.
 */
export function describeDeployed(state: HostConnectState): string {
  switch (state.step) {
    case "reachable":
      return state.agents_running === 0
        ? "The server answered DASH's check and reported nothing running."
        : state.agents_running === 1
          ? "The server reported 1 agent running, when DASH last checked. DASH keeps no list of its own — this is the server's own answer."
          : `The server reported ${String(state.agents_running)} agents running, when DASH last checked. DASH keeps no list of its own — this is the server's own answer.`;

    case "unreachable":
      return state.problem === "no_runner_there"
        ? "The server answered and had no agent runner on it."
        : "DASH could not ask the server what is running there.";

    case "probing":
      return "DASH is asking the server what is running there.";

    case "not_checked":
    case "awaiting_key_install":
    // MAR-572's enrollment moment joins this group at the MAR-574/572 merge:
    // DASH has read the server's identity and has not signed in, so it knows
    // exactly as much about what runs there as it does before any check.
    case "confirm_host_key":
    case "no_host":
      return "DASH does not know what is running there. It asks the server each time you check, and keeps no list of its own.";
  }
}

/*
 * `describeBootstrapGap` used to live here — a sentence that told a person their
 * fresh server could not take an agent and offered no way to fix it. MAR-579
 * deleted it, exactly as MAR-573 said it would: the guided bootstrap
 * (`describeSetupStep` and the `host.setup` snippet, offered on the card) is the
 * way out the gap description never had, so the honest thing to render for that
 * state is now an action rather than an apology.
 */

/* ---------------------------------------------------------------------- *
 * The four rows on Henrik's machine
 * ---------------------------------------------------------------------- */

/**
 * Where this record sits among the records that are the same server.
 *
 * Null when it is the only one, which is the case this whole function hopes to
 * be in. One short line rather than a paragraph, because the paragraph belongs
 * to the page: four cards each carrying the same three sentences is a wall of
 * repeated text where the reader needed one fact per card — *which* of the four
 * this one is. `describeDuplicateRecords` is the explanation, said once.
 *
 * Positional rather than a list of the other labels, because duplicates made by
 * pressing one wizard four times all carry one label, and "the same server as My
 * server, My server" is a sentence that helps nobody.
 */
export function describeSameServer(index: number, count: number): string | null {
  return count <= 1 ? null : `Record ${String(index)} of ${String(count)} for this server`;
}

/**
 * Why DASH is showing you the same server more than once, said once per page.
 *
 * The honest half of MAR-574's own instruction not to delete anything. Those
 * four rows on Henrik's machine are **real data**: each carries its own minted
 * key, which may be installed on that server, so a page that tidied them away
 * would be removing the only evidence of what is where. Saying so is what makes
 * "DASH kept them" a decision the reader can see rather than a mess.
 */
export function describeDuplicateRecords(): ServerFact {
  return {
    headline: "Some of these are the same server",
    detail:
      "More than one record here has the same address and the same account. They were saved " +
      "before DASH refused to save one server twice. Each has its own key, so DASH keeps them " +
      "rather than merging them — and removing one removes that key with it.",
    next_action: "Keep the one you recognise and stop using the others",
  };
}

/**
 * What one saved record's last check established, if anything (MAR-605).
 *
 * `answered` is the server's own reply and nothing else: it is true only where
 * `describeConnectState` reports the top rung, which is DASH having reached the
 * runner and been answered by it. Every other standing — including the ones
 * where the server is plainly alive and refusing the key — is `false` here,
 * because the summary above the list is counting *proofs*, not signs of life.
 *
 * `at` is when the answer arrived, and it is not optional decoration. A count
 * with no moment on it is the sentence this whole surface exists to stop.
 */
export interface ServerCheck {
  answered: boolean;
  /** DASH's own clock when the server replied, or null if nothing has asked. */
  at: string | null;
}

/**
 * The one line above the list.
 *
 * ## What it used to say, and why that was a lie the page could not see
 *
 * *"1 server is connected."* — printed above a card whose own body said DASH
 * could not get in. MAR-489's attended run photographed the pair. The count was
 * honest about the wrong noun: it counted **saved records** and then described
 * them with a word that means *a check succeeded*, and nothing in the function
 * had access to a check to contradict it.
 *
 * The codebase already had the rule this broke. `summariseConnectors` and
 * `FleetConnectors` are counted-not-asserted precisely so a summary cannot
 * drift from the cards underneath it; this one counted, and then asserted
 * anyway. So the fix is not a wording change — it is giving the function the
 * standings, so that "connected" is a thing it can only say about a server that
 * answered, and only with the moment the answer came.
 *
 * ## Three separate counts, because they are three separate facts
 *
 * **Saved** is what DASH holds and is always knowable. **Answered** is what a
 * check proved this session. **Unasked** is the honest majority state — a page
 * that has just opened has checked nothing, and saying so is what stops the
 * reader assuming silence means working.
 */
export function summariseServers(
  servers: readonly { same_server_count: number }[],
  /**
   * The standing per server, positionally aligned with `servers`.
   *
   * Positional rather than keyed by host id for the reason `describeSameServer`
   * is positional: this module is copy and must not know what a host id is, let
   * alone hold a map of them. The page has both lists and does the join.
   */
  checks: readonly ServerCheck[] = [],
): string {
  if (servers.length === 0) {
    return "No server is saved.";
  }

  const saved =
    servers.length === 1 ? "1 server is saved." : `${String(servers.length)} records are saved.`;
  const answered = checks.filter((check) => check.answered);
  const asked = checks.filter((check) => check.at !== null);

  /*
   * Nothing has been asked, which is the state every visit begins in. It says
   * so rather than staying quiet: a bare "1 server is saved" invites the reader
   * to supply the missing half themselves, and the half they supply is the
   * reassuring one.
   */
  const standing =
    asked.length === 0
      ? "DASH has not checked since you opened it."
      : answered.length === 0
        ? `None answered when DASH checked${lastAsked(asked)}.`
        : answered.length === servers.length
          ? `${answered.length === 1 ? "It answered" : "All of them answered"} when DASH checked${lastAsked(answered)}.`
          : `${String(answered.length)} of them answered when DASH checked${lastAsked(answered)}.`;

  const duplicated = servers.filter((server) => server.same_server_count > 1).length;
  const duplicates =
    duplicated === 0
      ? ""
      : ` ${String(duplicated)} of them describe a server DASH already had — DASH kept them rather than deleting anything.`;

  return `${saved} ${standing}${duplicates}`;
}

/**
 * The moment attached to a count, or nothing when DASH cannot read the clock
 * it was given.
 *
 * The newest of them, because the sentence is about the freshest thing the
 * reader is being told — and absolute rather than relative, which is
 * `lib/copy/when.ts`'s standing rule: a relative phrase needs a clock at render
 * time, so the same list would produce different markup on two runs and a
 * render test would stop asserting anything.
 */
function lastAsked(checks: readonly ServerCheck[]): string {
  const moments = checks
    .map((check) => check.at)
    .filter((at): at is string => at !== null)
    .sort();
  const newest = moments[moments.length - 1];
  if (newest === undefined) {
    return "";
  }
  const moment = plainMoment(newest);
  /*
   * " on ", not " at ". `plainMoment` already ends in a clock time — "11 August
   * 2026 at 11:37" — so an "at" here produced "when DASH checked, at 11 August
   * 2026 at 11:37" in the first captured frame. `describeAskedAt` next door
   * words the same join the same way, which is the point.
   */
  return moment === null ? "" : ` on ${moment}`;
}

/* ---------------------------------------------------------------------- *
 * The sweep
 * ---------------------------------------------------------------------- */

/**
 * Every sentence this module can produce, for the copy test.
 *
 * Derived from the state union rather than written out, so a state added
 * without being added here is one the plain-language check never sees — the
 * shape `everyConnectSentence` established.
 */
export function everyServerCardSentence(): string[] {
  const states: HostConnectState[] = [
    { step: "no_host" },
    { step: "not_checked", label: "My server" },
    { step: "probing", label: "My server" },
    { step: "awaiting_key_install", label: "My server", public_key: "ssh-ed25519 AAAA… dash" },
    {
      step: "confirm_host_key",
      label: "My server",
      fingerprint: "SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA",
      key_type: "ssh-ed25519",
      offered_count: 3,
    },
    {

      step: "reachable",

      label: "My server",

      runner_build: BUILD,

      agents_running: 0,

      agents_there: [],

    },
    {
      step: "reachable",
      label: "My server",
      runner_build: BUILD,
      agents_running: 1,
      agents_there: [{ agent_id: "News Scout", running: true }],
    },
    {
      step: "reachable",
      label: "My server",
      runner_build: BUILD,
      agents_running: 2,
      // One running and one not, so `describeDeployed`'s count and the card's
      // per-agent list are swept against a server that disagrees with a naive
      // reading of either.
      agents_there: [
        { agent_id: "News Scout", running: true },
        { agent_id: "Weather Watch", running: false },
      ],
    },
    // Every problem rather than the two somebody remembered, because MAR-605
    // added a chip label per problem and a label nobody sweeps is a label that
    // can quietly acquire a field name.
    ...HOST_REACH_PROBLEMS.map(
      (problem): HostConnectState => ({ step: "unreachable", label: "My server", problem }),
    ),
  ];
  const facts = [
    describePin(null),
    describePin("SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA"),
    describeDuplicateRecords(),
  ];

  return [
    describeAdded("2026-08-08T14:14:37Z"),
    describeAdded("not a time"),
    describeSignIn({ address: "example.com", username: "root", port: 22 }),
    describeSignIn({ address: "example.com", username: "root", port: 2222 }),
    describeSameServer(2, 4) ?? "",
    ...states.map(describeDeployed),
    // MAR-605. The chips are copy now and are swept as copy.
    ...states.map((state) => standingChip(state).label),
    ...facts.flatMap((fact) => [
      fact.headline,
      fact.detail,
      ...(fact.next_action === null ? [] : [fact.next_action]),
    ]),
    summariseServers([]),
    // Every branch of the summary, which is four sentences and not one: nothing
    // asked, none answered, all answered, some answered.
    summariseServers([{ same_server_count: 1 }]),
    summariseServers([{ same_server_count: 1 }], [{ answered: false, at: CHECKED_AT }]),
    summariseServers([{ same_server_count: 1 }], [{ answered: true, at: CHECKED_AT }]),
    summariseServers(
      [{ same_server_count: 1 }, { same_server_count: 1 }],
      [
        { answered: true, at: CHECKED_AT },
        { answered: false, at: CHECKED_AT },
      ],
    ),
    summariseServers(
      [{ same_server_count: 4 }, { same_server_count: 4 }],
      [
        { answered: true, at: CHECKED_AT },
        { answered: true, at: CHECKED_AT },
      ],
    ),
  ];
}

/** One fixed instant, so the sweep reads the same on two runs. */
const CHECKED_AT = "2026-08-10T21:14:37Z";

/** A real runner build's shape, because it is rendered as a value. */
const BUILD = "96cef12082fe67afa3a6";
