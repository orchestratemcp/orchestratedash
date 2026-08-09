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
import { type HostConnectState } from "./host-connect";

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
 * The one line above the list, when anything is duplicated.
 *
 * Counted rather than asserted, for the reason the Connections page's summary is
 * counted: a hand-written sentence at the top of a list is the thing that goes
 * stale first.
 */
export function summariseServers(servers: readonly { same_server_count: number }[]): string {
  const duplicated = servers.filter((server) => server.same_server_count > 1).length;
  if (servers.length === 0) {
    return "No server is connected.";
  }
  const kept =
    servers.length === 1 ? "1 server is connected." : `${String(servers.length)} records are saved.`;
  if (duplicated === 0) {
    return kept;
  }
  return `${kept} ${String(duplicated)} of them describe a server DASH already had — DASH kept them rather than deleting anything.`;
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
    { step: "not_checked", label: "My server" },
    { step: "probing", label: "My server" },
    { step: "reachable", label: "My server", runner_build: "96cef12082fe67afa3a6", agents_running: 0 },
    { step: "reachable", label: "My server", runner_build: "96cef12082fe67afa3a6", agents_running: 1 },
    { step: "reachable", label: "My server", runner_build: "96cef12082fe67afa3a6", agents_running: 2 },
    { step: "unreachable", label: "My server", problem: "no_runner_there" },
    { step: "unreachable", label: "My server", problem: "sign_in_refused" },
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
    ...facts.flatMap((fact) => [
      fact.headline,
      fact.detail,
      ...(fact.next_action === null ? [] : [fact.next_action]),
    ]),
    summariseServers([]),
    summariseServers([{ same_server_count: 1 }]),
    summariseServers([{ same_server_count: 4 }, { same_server_count: 4 }]),
  ];
}
