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
          /*
           * MAR-871. "nothing running" read as a fault on the state every
           * freshly enrolled server is in before its first deploy — the first
           * sentence a new user got about their brand-new machine. It is the
           * *success* of setting a server up, so the chip says what has been
           * achieved rather than what has not happened yet.
           */
          return "ready";
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
 *
 * MAR-871 moved one rung further. `no_runner_there` was amber, and amber is
 * what a person reads as *almost*: it sat over the sentence a freshly rented,
 * correctly set-up server shows on the day it is enrolled. Henrik's own ruling
 * is that this state is the one clear **your server is up** — success styling,
 * not a warning — because there is nothing left for the person to repair. The
 * one thing left to do is put an agent on it, which is an invitation and not a
 * fault, and the card draws it as the single primary action.
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
        case "no_runner_there":
          return "chip-ok";
        case "host_key_not_trusted":
        case "key_not_on_server":
        case "helper_not_installed":
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
 * One card, one state, one primary action (MAR-871)
 * ---------------------------------------------------------------------- */

/**
 * What this card is *for*, right now.
 *
 * ## Why a second vocabulary beside `HostConnectState`
 *
 * `HostConnectState` has fifteen members and each of them is a real, separate
 * diagnosis — MAR-572/573/600 spent three attended runs pulling them apart and
 * nothing here merges them back. What the fifteen do not carry is the thing a
 * *card* has to decide: how many controls to draw, and which one is the one.
 * The Servers page answered that per control, so a server that was simply up
 * offered five buttons — check, ask, turn on, put an agent here, stop using it —
 * and Henrik's own report of that page is that he could not tell what state his
 * server was in or what he was meant to press.
 *
 * So this is the fold, stated once and tested once: fifteen diagnoses, seven
 * situations, one primary action each. The diagnosis is still what the sentences
 * are read out of — `describeConnectState` is untouched and still says exactly
 * which wall DASH met — and this decides only what the card does about it.
 *
 * ## The two that are not failures
 *
 * `up` is `no_runner_there`, and it is the state **every freshly enrolled
 * server is in before its first deploy**. `in_use` is a server that named
 * something. Splitting them is the whole of Henrik's shape: the first has one
 * thing left to do and the second is a machine you manage.
 */
export type ServerCardState =
  /** No record at all. The page draws the wizard, not a card. */
  | "no_server"
  /** DASH cannot talk to a runner there yet, and the setup text is the way out. */
  | "not_set_up"
  /** A check is in flight. No buttons, one sentence. */
  | "checking"
  /** A saved record nobody has asked anything yet. */
  | "never_checked"
  /** The one decision only the person can make: is this your machine? */
  | "needs_your_ok"
  /** Signed in, set up, and holding nothing. Your server is up. */
  | "up"
  /** The server named at least one agent. This is the manage state. */
  | "in_use"
  /** Something is wrong or unknown, and the sentence beside it says which. */
  | "unreachable";

export function serverCardState(state: HostConnectState): ServerCardState {
  switch (state.step) {
    case "no_host":
      return "no_server";
    case "not_checked":
      return "never_checked";
    case "probing":
      return "checking";
    case "awaiting_key_install":
      return "not_set_up";
    case "confirm_host_key":
      return "needs_your_ok";
    case "reachable":
      /*
       * Empty is a real answer and not the same as absent. A server that
       * answered and named nothing is up and holding nothing; anything with a
       * name on it is a machine somebody manages.
       */
      return state.agents_there.length === 0 ? "up" : "in_use";
    case "unreachable":
      switch (state.problem) {
        case "no_runner_there":
          return "up";
        case "host_key_not_trusted":
          return "needs_your_ok";
        case "helper_not_installed":
        case "key_not_on_server":
        // The runner is there and was introduced by a different copy of DASH.
        // Running the setup text again is what gives it a fresh introduction,
        // so this is the same exit as a server that was never set up.
        case "runner_refused_credential":
          return "not_set_up";
        case "no_ssh_on_this_computer":
        case "ssh_tools_cannot_check_here":
        case "no_answer_at_address":
        case "sign_in_refused":
        case "server_identity_changed":
          return "unreachable";
      }
  }
}

/**
 * What the card asks a person to do, and there is exactly one of them.
 *
 * `kind` rather than a callback, because this module renders nothing and must
 * not learn what a press does. The card maps the kind to its own handler, and a
 * state added without an action here is a compile error in the switch rather
 * than a card with no button on it.
 *
 * `null` for the two states where pressing anything would be wrong: a check
 * already in flight, and a page with no record on it.
 */
export interface ServerPrimaryAction {
  label: string;
  kind: "check" | "setup" | "put_agent" | "confirm";
}

export function primaryServerAction(state: HostConnectState): ServerPrimaryAction | null {
  switch (serverCardState(state)) {
    case "no_server":
    case "checking":
      return null;
    case "not_set_up":
      return {
        // "Set it up again" only where a runner already answered and did not
        // know DASH. Everywhere else this server has never been set up, and a
        // word implying it was would send somebody looking for what they broke.
        label:
          state.step === "unreachable" && state.problem === "runner_refused_credential"
            ? "Set it up again"
            : "Set up this server",
        kind: "setup",
      };
    case "needs_your_ok":
      /*
       * Only `confirm_host_key` carries a fingerprint, and a confirmation is a
       * decision *about* one — so it is the only state where this card can
       * offer the press.
       *
       * `host_key_not_trusted` is the refusal that follows the same decision
       * not having been made, and it arrives with nothing to compare: DASH was
       * turned away before it read anything. A **Yes, this is my server** there
       * would be a control with no value behind it, which is the dead button
       * `NoServerYet` refuses to draw one page over. A check asks the server
       * again and comes back with the code, and the sentence above the button
       * still says what the decision is.
       */
      return state.step === "confirm_host_key"
        ? { label: "Yes, this is my server", kind: "confirm" }
        : { label: "Check now", kind: "check" };
    case "up":
      return { label: "Put an agent here", kind: "put_agent" };
    case "never_checked":
    case "in_use":
    case "unreachable":
      /*
       * One refresh, everywhere (MAR-871). The card used to carry two — "Check
       * this server" in the button row and "Ask the server" inside the restart
       * section — which asked a person to know that one of them signs in for the
       * standing and the other signs in for the boot entry. Both are DASH going
       * to the machine and asking, so both are this.
       */
      return { label: "Check now", kind: "check" };
  }
}

/**
 * Did DASH actually get onto this machine?
 *
 * ## The defect this replaces
 *
 * The summary above the list counted a server as having answered when its
 * standing was `step: "reachable"`, and `no_runner_there` is modelled as a
 * problem under `step: "unreachable"` even though `describeConnectState` gives
 * it `reach: "signed_in"` and copy asserting the server answered. So the
 * attended run of 2026-09-05 photographed *"1 server is saved. **None
 * answered** when DASH checked"* directly above a card reading *"Vultr box is
 * reachable, with nothing running on it — nothing is wrong with the
 * connection."* The banner and the card it introduces disagreed, on the state
 * every new server is in.
 *
 * It is MAR-605 returning inverted: that run photographed *"1 server is
 * connected"* over a card saying DASH could not get in, and the fix was to
 * count from a check rather than from a record. The same class of drift came
 * back the other way round, because the count read a `step` and the sentence
 * read a `reach`.
 *
 * So the question is asked of the *described* state, which is the same object
 * the sentence is read out of. A renderer cannot count a server as silent while
 * the sentence beside it says the server let DASH in.
 */
export function reachedTheServer(state: HostConnectState): boolean {
  const { reach } = describeConnectState(state);
  return reach === "signed_in" || reach === "connected";
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
  /**
   * What the server itself said was running, or null when it has not said
   * (MAR-871).
   *
   * The third of the four facts this line must keep apart, and the one that is
   * hardest to keep honest: **null is not zero**. A server DASH signed in to
   * and never asked about its agents, and a server that answered and named
   * nothing, look identical to a counter and mean opposite things to a reader.
   * Only a number the *host* produced may reach this field.
   */
  running: number | null;
  /**
   * Whether this person asked this server to keep its agents running by itself
   * (MAR-871).
   *
   * DASH's own record of its own act, so it is knowable with the server asleep
   * — which is exactly why it is a separate fact from the three above. A card
   * that let "residency is on" imply "and it is running" would be claiming a
   * machine's state from a switch somebody flipped in August.
   */
  residency_on: boolean;
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
 *
 * ## Four facts, kept apart (MAR-871, UX-4)
 *
 * The attended run found the line disagreeing with the card beneath it, and the
 * reason it could was that it had one fact where the card had four. So the
 * clauses below are separate and each is drawn only from its own source:
 *
 * - **Last contact** — did DASH get onto the machine, and when. Counted from
 *   `reachedTheServer`, which reads the described state rather than a `step`,
 *   so it cannot disagree with the sentence on the card. A residency press or a
 *   key placement is contact too: both sign in, and the old line went on saying
 *   *"DASH has not checked since you opened it"* two seconds after one.
 * - **Running state** — only a number the host itself produced, and absent
 *   entirely when no host has produced one.
 * - **Residency** — DASH's own record of a switch this person pressed. True
 *   with the server asleep, which is why it may never imply the one above.
 * - **Duplicates** — unchanged, and still says DASH kept them.
 *
 * There is deliberately no *last successful job* clause. Nothing in DASH holds
 * one for a host: `agent_deploys` is bounded by ADR 0010 to DASH's own outbound
 * act, `evidence_pulls` holds only local rows, and the attended run established
 * that no run has yet produced output on a server at all. A clause for it would
 * be a field invented by a renderer.
 */
/**
 * Why this card cannot put an agent on this server any more (MAR-642).
 *
 * One sentence, and it names the destination rather than the rule. "Deploy
 * initiation has moved to the agent's Settings stage" is a changelog; what a
 * person needs is *where to press next*, which is why the list under this line
 * is links and this line is one clause of context above them.
 *
 * A constant rather than a function because it varies with nothing — not the
 * server, not the agent, not whether anything is deployed.
 * `MODEL_KEY_STAYS_HOME_REFUSAL` is a constant for the same reason.
 */
/*
 * MAR-871 rewrote it. The old sentence — *"Putting an agent on a server starts
 * on the agent […] Open one and its settings will offer this server."* — was
 * the answer to a question nobody asked. The attended run's own finding: a
 * novice pressed a primary-styled control reading **Put an agent here** and was
 * told, in DASH's voice, that the thing they had just pressed happens somewhere
 * else. The label promised a verb the control did not perform.
 *
 * The control is unchanged and the list under it is unchanged. What changed is
 * that this line now *instructs* rather than explains a routing decision: pick
 * the agent, and the press after this one sends it. The destination is named
 * because the person is about to be moved there, which is the difference
 * between a hand-off and a bounce.
 */
export const DEPLOY_LIVES_ON_THE_AGENT =
  "Choose the agent to put here. DASH opens that agent's own settings at the step that sends " +
  "it, because its connections and its model are set there.";

/**
 * One deployed copy, as the table at the top of the page reads it (MAR-642).
 *
 * ## What this may say, and the one thing it may not
 *
 * **It reads the deploy record and never a liveness claim.** ADR 0010 bounds
 * `agent_deploys` to DASH's memory of its own outbound act — it sent these
 * bytes, on this date — and forbids a `running` column for a later feature to
 * reach for. A table whose third column said "Running" would be that column,
 * arrived at through a renderer instead of a migration.
 *
 * So the standing is *"DASH sent it on 12 August 2026"*: a fact DASH witnessed,
 * with DASH named as the actor so it cannot be read as a report about the
 * machine. What the server itself says is a different account and lives on the
 * card below, beside the moment it was said — `lib/host-sighting.ts` is where
 * the two are put side by side without being blended into one.
 *
 * A row exists only while DASH believes a copy is there: `sent` already drops
 * anything brought home (`lib/views/build.ts`), so a bring-home empties this
 * table rather than leaving a row nothing corrects.
 */
export function describeSentStanding(sentOn: string | null): string {
  return sentOn === null
    ? "DASH sent it. The date DASH recorded cannot be read."
    : `DASH sent it on ${sentOn}.`;
}

/**
 * The one line above that table, counted rather than asserted.
 *
 * `summariseServers`' rule, which that function's own header explains at length
 * and which this one inherits whole: a summary that asserts something the rows
 * under it do not is a summary that will eventually be the only wrong thing on
 * the page.
 */
export function summariseDeployedCopies(copies: number, servers: number): string {
  if (copies === 0) {
    return "DASH has not put any agent on a server.";
  }
  const what = copies === 1 ? "One agent copy" : `${String(copies)} agent copies`;
  const where = servers === 1 ? "one server" : `${String(servers)} servers`;
  return `${what} DASH sent, on ${where}. Each row opens that agent's own settings, where the sending happens.`;
}

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

  /*
   * What the *hosts* said, added only where a host said it. `null` is skipped
   * rather than read as nought — a server DASH signed in to and never asked
   * about its agents is not a server with no agents on it.
   */
  const many = servers.length > 1;
  const counted = checks
    .map((check) => check.running)
    .filter((running): running is number => running !== null);
  const running = counted.reduce((total, one) => total + one, 0);
  const runningClause =
    counted.length === 0
      ? ""
      : running === 0
        ? many
          ? " None of them reported an agent running."
          : " It reported nothing running."
        : running === 1
          ? ` ${many ? "They" : "It"} reported 1 agent running.`
          : ` ${many ? "They" : "It"} reported ${String(running)} agents running.`;

  /*
   * DASH's own record, and worded as one. "You have asked" rather than "it
   * does", because the server's own answer to that question lives on the card
   * and can disagree — somebody may have switched it off on the machine itself.
   */
  const kept = checks.filter((check) => check.residency_on).length;
  const residencyClause =
    kept === 0
      ? ""
      : !many
        ? " You have asked it to keep its agents running after a restart."
        : kept === 1
          ? " You have asked 1 of them to keep its agents running after a restart."
          : ` You have asked ${String(kept)} of them to keep their agents running after a restart.`;

  const duplicated = servers.filter((server) => server.same_server_count > 1).length;
  const duplicates =
    duplicated === 0
      ? ""
      : ` ${String(duplicated)} of them describe a server DASH already had — DASH kept them rather than deleting anything.`;

  return `${saved} ${standing}${runningClause}${residencyClause}${duplicates}`;
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
    summariseServers([{ same_server_count: 1 }], [check({ answered: false })]),
    summariseServers([{ same_server_count: 1 }], [check({ answered: true })]),
    summariseServers(
      [{ same_server_count: 1 }, { same_server_count: 1 }],
      [check({ answered: true }), check({ answered: false })],
    ),
    summariseServers(
      [{ same_server_count: 4 }, { same_server_count: 4 }],
      [check({ answered: true }), check({ answered: true })],
    ),
    /*
     * MAR-871's three added clauses, every branch of each — including the
     * singular forms, which is where a summary about one server would otherwise
     * read "1 of them". The gate only ever sees a string a fixture reaches.
     */
    summariseServers([{ same_server_count: 1 }], [check({ answered: true, running: 0 })]),
    summariseServers([{ same_server_count: 1 }], [check({ answered: true, running: 1 })]),
    summariseServers([{ same_server_count: 1 }], [check({ answered: true, running: 3 })]),
    summariseServers(
      [{ same_server_count: 1 }, { same_server_count: 1 }],
      [check({ answered: true, running: 0 }), check({ answered: true, running: 0 })],
    ),
    summariseServers(
      [{ same_server_count: 1 }, { same_server_count: 1 }],
      [check({ answered: true, running: 1 }), check({ answered: true, running: 0 })],
    ),
    summariseServers(
      [{ same_server_count: 1 }, { same_server_count: 1 }],
      [check({ answered: true, running: 2 }), check({ answered: true, running: 1 })],
    ),
    summariseServers([{ same_server_count: 1 }], [check({ residency_on: true })]),
    summariseServers(
      [{ same_server_count: 1 }, { same_server_count: 1 }],
      [check({ residency_on: true }), check({ residency_on: false })],
    ),
    summariseServers(
      [{ same_server_count: 1 }, { same_server_count: 1 }],
      [check({ residency_on: true }), check({ residency_on: true })],
    ),
    // MAR-871. The seven card states, as the one control each of them offers.
    ...states.map((state) => primaryServerAction(state)?.label ?? ""),
    /*
     * MAR-642's four sentences, every branch of each. The gate only ever sees a
     * string a fixture reaches — MAR-620's lesson about an optional field no
     * fixture populated — and three of these are second branches of functions
     * whose first branch is the one a reader would think to check.
     */
    DEPLOY_LIVES_ON_THE_AGENT,
    describeSentStanding("12 August 2026"),
    describeSentStanding(null),
    summariseDeployedCopies(0, 0),
    summariseDeployedCopies(1, 1),
    summariseDeployedCopies(3, 2),
  ];
}

/** One fixed instant, so the sweep reads the same on two runs. */
const CHECKED_AT = "2026-08-10T21:14:37Z";

/**
 * One check for the sweep, with every fact stated.
 *
 * Defaults rather than optional fields on `ServerCheck` itself. An optional
 * field is one a fixture can leave unset, and a clause behind an unset field is
 * a clause the copy gate never reads — which is how a sentence ships green and
 * unchecked. Here the defaults live in the *fixture*, so the type still obliges
 * every caller to answer all four questions.
 */
function check(over: Partial<ServerCheck> = {}): ServerCheck {
  return { answered: false, at: CHECKED_AT, running: null, residency_on: false, ...over };
}

/** A real runner build's shape, because it is rendered as a value. */
const BUILD = "96cef12082fe67afa3a6";
