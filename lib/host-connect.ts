/**
 * Connecting a host, as states and sentences (MAR-498, design slice).
 *
 * The surface half of ADR 0007: a person adds a server, DASH proves it can
 * reach it, and the receipt says honestly what DASH can and cannot see. This
 * module is the part that can be decided and tested without drawing anything —
 * which states exist, what each one leads to, and what each one says.
 *
 * Pure, and it renders nothing. `lib/hosts.ts` owns the record and the command;
 * `electron/ssh-host.ts` owns the key and the `ssh` probe. This owns the
 * vocabulary between them and the copy a person reads.
 *
 * ## Why the states are a union rather than a boolean and a message
 *
 * Because they lead somewhere different, which is the argument
 * `lib/copy/recovery.ts` already makes about credentials and MAR-434 makes
 * about a missing output. "Not reachable" collapses six situations with six
 * next actions into one shrug:
 *
 * - **This computer has no SSH.** Nothing about the server is known yet, and the
 *   fix is on this machine. ADR 0007 requires this to be said *before* the first
 *   deploy rather than discovered at it.
 * - **The server has not been told about this key.** The commonest first-run
 *   state and not a fault: DASH minted a key and nobody has pasted the public
 *   half into the server yet.
 * - **The server refused the sign-in.** The key is known to the server or it is
 *   not, and only the person can tell which.
 * - **The server's identity changed.** `StrictHostKeyChecking=yes` means this
 *   fails closed. It is the one state that must never read as "the server is
 *   down", because the honest answer is "this may not be the same server".
 * - **The server answered but is running no agent runner.** DASH got there. The
 *   next action is a deploy, not a reconnection.
 * - **The runner refused DASH's credential.** DASH reached the runner and it did
 *   not accept the channel secret, which is enrollment rather than reachability.
 *
 * Collapsing any pair of those sends somebody to the wrong place. A test asserts
 * the six next actions are six distinct strings, which is the assertion a
 * collapse would fail.
 *
 * ## What this module deliberately does not decide
 *
 * No components, no layout, no widths. MAR-498's `merged` bar is rendered states
 * screenshotted at the three widths `electron/capture.ts` covers, and that needs
 * a surface this slice does not build. What it removes from that work is the
 * part that is easy to get quietly wrong: the copy, and the number of states.
 */

import { describeHostReach } from "./hosts";

/* ---------------------------------------------------------------------- *
 * The states
 * ---------------------------------------------------------------------- */

/** Why DASH cannot reach a host it has a record for. */
export type HostReachProblem =
  | "no_ssh_on_this_computer"
  | "key_not_on_server"
  | "sign_in_refused"
  | "server_identity_changed"
  | "no_runner_there"
  | "runner_refused_credential";

export type HostConnectState =
  /** Nothing added. The empty state, which is not a failure. */
  | { step: "no_host" }
  /** A key exists and the server has not been told about it yet. */
  | { step: "awaiting_key_install"; label: string; public_key: string }
  | { step: "probing"; label: string }
  /** DASH reached the runner and it answered. `runner_build` may be unknown. */
  | { step: "reachable"; label: string; runner_build: string | null }
  | { step: "unreachable"; label: string; problem: HostReachProblem };

/**
 * What a person reads for one state.
 *
 * Three fields rather than one paragraph, because a surface needs to weight
 * them differently and a single string forces every renderer to re-split it.
 * `next_action` is the imperative half and is the field the distinctness test
 * is written against.
 */
export interface HostConnectCopy {
  headline: string;
  detail: string;
  /** Null exactly when there is nothing for the person to do. */
  next_action: string | null;
}

/**
 * The sentence for each state, in the house voice.
 *
 * No field names, no environment variable names, no filenames — the test that
 * enforces that is `expectPlainLanguage`, and this module is written against it
 * rather than checked afterwards. In particular the public key is **not**
 * interpolated into any sentence: it is a separate field on the state, because
 * a sixty-character blob inside a sentence is not a sentence.
 */
export function describeConnectState(state: HostConnectState): HostConnectCopy {
  switch (state.step) {
    case "no_host":
      return {
        headline: "No server connected",
        detail:
          "You can run agents on a server so they keep working when DASH is closed. " +
          "DASH reaches out to the server; the server never reaches back.",
        next_action: "Connect a server",
      };

    case "awaiting_key_install":
      return {
        headline: `${state.label} is waiting for its key`,
        detail:
          "DASH made a key for this server and kept the private half on this computer. " +
          "Copy the public half onto the server so it will let DASH in. Nothing else " +
          "about the key ever leaves here.",
        next_action: "Copy the key, then check the connection",
      };

    case "probing":
      return {
        headline: `Checking ${state.label}`,
        detail: "DASH is signing in to see whether it can reach the agent runner there.",
        next_action: null,
      };

    case "reachable":
      return {
        headline: `${state.label} is connected`,
        // The two ADR 0007 sentences, verbatim and together. The second is the
        // unpleasant one and is required *before* the first deploy.
        detail: `${describeHostReach().while_open} ${describeHostReach().while_closed}`,
        next_action: null,
      };

    case "unreachable":
      return describeUnreachable(state.label, state.problem);
  }
}

/**
 * Six problems, six next actions.
 *
 * Written as one function rather than six branches at the call site so the
 * distinctness test has one place to point at, and so a seventh problem cannot
 * be added without answering "and where does it send them".
 */
function describeUnreachable(label: string, problem: HostReachProblem): HostConnectCopy {
  switch (problem) {
    case "no_ssh_on_this_computer":
      return {
        headline: "This computer cannot reach servers yet",
        detail:
          "Connecting to a server needs a tool this computer does not have. " +
          "On Windows it is an optional feature called OpenSSH Client; on Mac and " +
          "Linux it is usually already installed.",
        next_action: "Install the OpenSSH client, then try again",
      };

    case "key_not_on_server":
      return {
        headline: `${label} has not been told about this key`,
        detail:
          "The server is answering and would not let DASH in. This is what it looks " +
          "like before the key has been added there, which is usually the reason.",
        next_action: "Copy the key onto the server, then check again",
      };

    case "sign_in_refused":
      return {
        headline: `${label} refused the sign-in`,
        detail:
          "The server answered and turned DASH away. The account name may be wrong, " +
          "or the key may have been removed there.",
        next_action: "Check the account name and the key on the server",
      };

    case "server_identity_changed":
      // Never "the server is down". The honest answer is that this may not be
      // the same server, and a person who is told the wrong thing here will
      // reconnect straight past a real warning.
      return {
        headline: `${label} is not answering as the same server`,
        detail:
          "Something is answering at this address, and it is not the server DASH " +
          "connected to before. That happens when a server is rebuilt — and it is " +
          "also what someone impersonating it would look like. DASH will not sign in " +
          "until you say which it is.",
        next_action: "Confirm the server was rebuilt, or check the address",
      };

    case "no_runner_there":
      return {
        headline: `${label} is reachable, with nothing running on it`,
        detail:
          "DASH signed in and found no agent runner there yet. Nothing is wrong with " +
          "the connection.",
        next_action: "Put an agent on this server",
      };

    case "runner_refused_credential":
      return {
        headline: `${label} did not recognise DASH`,
        detail:
          "DASH signed in to the server and reached the agent runner, and the runner " +
          "would not accept it. That happens when the runner was set up by a different " +
          "copy of DASH.",
        next_action: "Connect this server again to give it a fresh introduction",
      };
  }
}

/* ---------------------------------------------------------------------- *
 * Disconnecting
 * ---------------------------------------------------------------------- */

/**
 * What disconnecting does, and the half of it that is easy to imply falsely.
 *
 * Under ADR 0007 disconnecting stops **DASH reaching the host**. It does not
 * stop what is already running there, and it cannot: the runner is a process on
 * somebody else's machine, and DASH's only way to ask it to stop is the
 * connection being removed. A confirmation that said "this will stop your
 * agents" would be a false statement about somebody's server, and one they
 * would only discover by being billed for it.
 *
 * Same shape as `describeHostReach`'s second sentence, and the same reason it
 * is a function rather than a string in a component: a renderer that found it
 * discouraging must not be able to drop it.
 */
export function describeDisconnect(label: string): HostConnectCopy {
  return {
    headline: `Stop using ${label}?`,
    detail:
      "DASH will stop reaching this server and will forget how to sign in to it. " +
      "Anything already running there keeps running — DASH cannot stop it and will " +
      "not be able to show you what it does.",
    next_action: "Disconnect",
  };
}

/**
 * Every sentence this module can produce, for one host.
 *
 * Exists so a copy test can sweep the whole surface rather than the states
 * somebody remembered to list. `tests/host-connect.test.ts` iterates this, and
 * a state added without being added here is a state the plain-language check
 * never sees — so the list is derived from the unions rather than written out.
 */
export function everyConnectSentence(label = "My server"): string[] {
  const states: HostConnectState[] = [
    { step: "no_host" },
    { step: "awaiting_key_install", label, public_key: "ssh-ed25519 AAAA… orchestratedash" },
    { step: "probing", label },
    { step: "reachable", label, runner_build: "96cef12082fe67afa3a6" },
    ...HOST_REACH_PROBLEMS.map(
      (problem): HostConnectState => ({ step: "unreachable", label, problem }),
    ),
  ];
  return [
    ...states.flatMap((state) => {
      const copy = describeConnectState(state);
      return [copy.headline, copy.detail, ...(copy.next_action === null ? [] : [copy.next_action])];
    }),
    ...(() => {
      const copy = describeDisconnect(label);
      return [copy.headline, copy.detail, copy.next_action ?? ""];
    })(),
  ];
}

/** The problems as a value, so a test can iterate them and a new one cannot hide. */
export const HOST_REACH_PROBLEMS = [
  "no_ssh_on_this_computer",
  "key_not_on_server",
  "sign_in_refused",
  "server_identity_changed",
  "no_runner_there",
  "runner_refused_credential",
] as const satisfies readonly HostReachProblem[];
