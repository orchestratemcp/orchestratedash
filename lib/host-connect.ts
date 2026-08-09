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
 * about a missing output. "Not reachable" collapses nine situations with nine
 * next actions into one shrug:
 *
 * - **This computer has no SSH.** Nothing about the server is known yet, and the
 *   fix is on this machine. ADR 0007 requires this to be said *before* the first
 *   deploy rather than discovered at it.
 * - **Nothing answered at the address.** Before every question below, because
 *   none of them is knowable until something is listening.
 * - **The server's identity has not been confirmed.** DASH dials with strict
 *   host-key checking against a file only an explicit confirmation writes to, so
 *   a server nobody has vouched for is refused before a key is ever offered.
 * - **The server has not been told about this key.** The commonest first-run
 *   state and not a fault: DASH minted a key and nobody has pasted the public
 *   half into the server yet.
 * - **The server refused the sign-in.** The key is known to the server or it is
 *   not, and only the person can tell which.
 * - **The server's identity changed.** `StrictHostKeyChecking=yes` means this
 *   fails closed. It is the one state that must never read as "the server is
 *   down", because the honest answer is "this may not be the same server".
 * - **The server has nothing to answer with.** DASH signed in and the server has
 *   never been set up, which is a step to offer rather than a fault to report.
 * - **The server answered but is running no agent runner.** DASH got there. The
 *   next action is a deploy, not a reconnection.
 * - **The runner refused DASH's credential.** DASH reached the runner and it did
 *   not accept the channel secret, which is enrollment rather than reachability.
 *
 * Collapsing any pair of those sends somebody to the wrong place. A test asserts
 * the nine next actions are nine distinct strings, which is the assertion a
 * collapse would fail.
 *
 * The middle three arrived together on 2026-08-08 (MAR-572, MAR-573) and are
 * worth naming as a group, because until then they were **one sentence**: *"DASH
 * could not sign in, or the helper is not installed there."* The attended run
 * against a real host produced all three in sequence, and the server's own
 * `auth.log` distinguished them at every step — a connection aborting at preauth
 * with no key offered, then an accepted publickey, then a shell reporting it had
 * never heard of what was asked. A surface that cannot tell apart what the
 * server itself can is a surface guessing on the user's behalf.
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
  /** Nothing answered at the address and port at all (MAR-572). */
  | "no_answer_at_address"
  /** Answering, but its identity has never been confirmed by a person (MAR-572). */
  | "host_key_not_trusted"
  | "key_not_on_server"
  | "sign_in_refused"
  | "server_identity_changed"
  /** Signed in, and the server has nothing there to answer DASH (MAR-573). */
  | "helper_not_installed"
  | "no_runner_there"
  | "runner_refused_credential";

export type HostConnectState =
  /** Nothing added. The empty state, which is not a failure. */
  | { step: "no_host" }
  /** A key exists and the server has not been told about it yet. */
  | { step: "awaiting_key_install"; label: string; public_key: string }
  /**
<<<<<<< HEAD
   * The enrollment moment: DASH has this server's key and nobody has said yet
   * whether it is the right one (MAR-572).
   *
   * A step rather than a `HostReachProblem`, because nothing is wrong. The
   * server answered, DASH read its identity, and what is missing is a person's
   * decision — which is a different thing from a failure and leads somewhere
   * different. `host_key_not_trusted` above is the *refusal* that follows when
   * that decision has not been made and DASH dialled anyway.
   */
  | {
      step: "confirm_host_key";
      label: string;
      /** `SHA256:…`, as `ssh-keygen -l` prints it and a provider's console shows it. */
      fingerprint: string;
      /** `ssh-ed25519` and friends. Shown because a console lists one per type. */
      key_type: string;
      /** How many keys the server offered in total, chosen included. */
      offered_count: number;
    }
=======
   * A saved server DASH has not signed in to since it opened (MAR-574).
   *
   * The state the Servers page opens in for every record it has, and it is not
   * a failure and not a probe result: DASH holds the connection facts and has
   * not used them yet. Kept distinct from `probing` — which is a check in
   * flight — and from `unreachable`, because a page that showed a saved server
   * as unreachable before asking would be inventing a fault.
   */
  | { step: "not_checked"; label: string }
>>>>>>> origin/master
  | { step: "probing"; label: string }
  /**
   * DASH reached the runner and it answered. `runner_build` may be unknown.
   *
   * `agents_running` is what the *server* said when asked, counted from its own
   * answer rather than from anything DASH stored — DASH keeps no record of what
   * it has deployed where, so this number is only ever as fresh as the check
   * that produced it. See `lib/server-card.ts` for why that is stated on screen
   * rather than smoothed over.
   */
  | { step: "reachable"; label: string; runner_build: string | null; agents_running: number }
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

<<<<<<< HEAD
    case "confirm_host_key":
      return {
        headline: `Is this ${state.label}?`,
        // Three sentences doing three jobs: what the code below is, where the
        // person can check it, and — the one most tools leave out — that DASH
        // cannot check it for them. A flow that showed a fingerprint and a
        // "Confirm" button without that last sentence would be teaching people
        // that clicking yes is a verification. It is not; it is the moment the
        // trust becomes theirs, and saying so is the whole value of the step.
        detail:
          `Every server has an identity code of its own. This one says its code is ${state.fingerprint}. ` +
          "Your provider shows the same code on the server's page, and they should match. " +
          "DASH cannot check this for you — anything answering at this address could say " +
          "the same thing, so this is the one part only you can confirm.",
        next_action: "Compare the code, then confirm this is your server",
=======
    case "not_checked":
      return {
        headline: `${state.label} has not been checked yet`,
        detail:
          "DASH knows how to reach this server and has not signed in to it since you opened " +
          "DASH. Nothing is wrong — it simply has not looked.",
        next_action: "Check this server",
>>>>>>> origin/master
      };

    case "probing":
      return {
        headline: `Checking ${state.label}`,
        detail: "DASH is signing in to see whether it can reach the agent runner there.",
        next_action: null,
      };

    case "reachable":
      return {
        // The count is in the headline rather than in a line below it, because
        // it is the answer to the question the page is open for. "Connected"
        // and "connected, running two agents" are different facts and reading
        // one of them at a glance should not require reading the other.
        headline:
          state.agents_running === 0
            ? `${state.label} is connected`
            : state.agents_running === 1
              ? `${state.label} is connected, running 1 agent`
              : `${state.label} is connected, running ${String(state.agents_running)} agents`,
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

    case "no_answer_at_address":
      // Before any of the three below, because none of them is knowable until
      // something answers. Tonight's run never saw this state and a typed
      // address is the commonest way somebody would: without it, "nothing is
      // listening" wears whichever sentence follows it, and sends a person to
      // check a key on a server that does not exist.
      return {
        headline: `Nothing answered at ${label}'s address`,
        detail:
          "DASH could not get as far as the server. The address or the port may be wrong, " +
          "the server may still be starting up, or its own firewall may not be letting " +
          "this computer in.",
        next_action: "Check the address and port, then try again",
      };

    case "host_key_not_trusted":
      // The wall the attended run hit on 2026-08-08, which until now wore the
      // sentence below it and sent people to check a key that was never
      // offered: the server's own auth.log recorded the connection aborting at
      // preauth with no sign-in attempt at all.
      return {
        headline: `${label} has not been confirmed yet`,
        detail:
          "The server answered, and DASH will not sign in to it until you have confirmed " +
          "that its identity code is the one your provider shows. Nothing was sent to it.",
        next_action: "Confirm this is your server",
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

    case "helper_not_installed":
      // The third of the three, and the one that used to be the same sentence
      // as "could not sign in". They are opposite facts: here the sign-in
      // *worked*. The server's answer on 2026-08-08 was its own shell saying it
      // had never heard of what DASH asked for, which is a setup step nobody
      // had been offered rather than anything being wrong.
      return {
        headline: `${label} is not set up for DASH yet`,
        detail:
          "DASH signed in — the key is right and the server let it in. There is nothing " +
          "there yet for DASH to talk to, which is how every new server starts.",
        next_action: "Set this server up for DASH",
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
<<<<<<< HEAD
    {
      step: "confirm_host_key",
      label,
      // A real fingerprint's shape, because this string is rendered into a
      // sentence and the copy sweep must see what a person would actually read.
      fingerprint: "SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA",
      key_type: "ssh-ed25519",
      offered_count: 3,
    },
=======
    { step: "not_checked", label },
>>>>>>> origin/master
    { step: "probing", label },
    // Both wordings of the count, so neither escapes the copy sweep.
    { step: "reachable", label, runner_build: "96cef12082fe67afa3a6", agents_running: 1 },
    { step: "reachable", label, runner_build: "96cef12082fe67afa3a6", agents_running: 2 },
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
  "no_answer_at_address",
  "host_key_not_trusted",
  "key_not_on_server",
  "sign_in_refused",
  "server_identity_changed",
  "helper_not_installed",
  "no_runner_there",
  "runner_refused_credential",
] as const satisfies readonly HostReachProblem[];

/* ---------------------------------------------------------------------- *
 * Turning what `ssh` said into one of the nine
 * ---------------------------------------------------------------------- */

/**
 * What DASH knows about a probe that did not work.
 *
 * `stderr` is `ssh`'s own diagnostic text, and it arrives here to be *reduced*
 * rather than read out. See `classifyHostFailure` for why that distinction is
 * the whole design of this function.
 */
export interface HostFailureEvidence {
  stderr: string;
  /** Whether this host's identity has been confirmed and pinned already. */
  pinned: boolean;
}

/**
 * `ssh`'s diagnostics, as one of the nine problems — or as nothing.
 *
 * ## Why this parses stderr, when `openSshChannel` says not to
 *
 * That module's rule is that `ssh`'s text must not reach a person: its
 * diagnostics name the account, the address, the port and the local path of
 * DASH's private key, so a transport that carried them into an error message
 * would be a transport that leaks all four. The rule was kept by *not looking*,
 * and the cost showed up the first time DASH met a host it had not seen: three
 * different failures — the identity was never confirmed, the sign-in was
 * refused, the server had nothing to answer with — arrived as one shrug, and
 * the person was sent to check a key on a server that had never been asked for
 * one.
 *
 * So the rule is kept a stronger way instead. This function takes the text and
 * returns **a member of a closed union**, and there is no branch in it that
 * puts any of that text into its result. The diagnostics still go only where
 * they always went — this machine's own log. What crosses the boundary is nine
 * possible values, and a reviewer can check that by reading the return type.
 *
 * Returning `null` is a real answer and the important one: an `ssh` failure
 * this function does not recognise must stay unrecognised rather than be
 * rounded to the nearest sentence. The caller then says the honest generic
 * thing, which is what today's single refusal already does.
 *
 * ## The order of the tests, which is the substance
 *
 * A changed key is checked first and separately from an unconfirmed one. Both
 * make `ssh` print "Host key verification failed", and they mean opposite
 * things: one is a server nobody has vouched for yet, and the other is ADR
 * 0007's fail-closed alarm. The banner OpenSSH prints for the second case is
 * unambiguous, and the record's own `pinned` state is the tiebreaker when a
 * build words it differently — a host DASH already pinned that now fails
 * verification is a changed key by definition.
 */
export function classifyHostFailure(evidence: HostFailureEvidence): HostReachProblem | null {
  const text = evidence.stderr;

  if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(text)) {
    return "server_identity_changed";
  }
  if (/host key verification failed|no matching host key|key type .* not in/i.test(text)) {
    return evidence.pinned ? "server_identity_changed" : "host_key_not_trusted";
  }
  if (
    /could not resolve hostname|name or service not known|nodename nor servname|no address associated/i.test(
      text,
    ) ||
    /connection refused|no route to host|network is unreachable|connection timed out|operation timed out|connect to host .* port .*: /i.test(
      text,
    )
  ) {
    return "no_answer_at_address";
  }
  if (/permission denied.*\bpublickey\b|no supported authentication methods/i.test(text)) {
    return "key_not_on_server";
  }
  if (/permission denied|too many authentication failures|authentication failed/i.test(text)) {
    return "sign_in_refused";
  }
  /*
   * The remote shell's own words, and the reason this branch is last: it is the
   * only one whose text came from the far end rather than from `ssh`, so
   * anything `ssh` itself had to say about the connection has already had its
   * chance to claim the failure.
   *
   * `command not found` is what a shell says when DASH sent a verb to a server
   * that has never been set up — the exact line the 2026-08-08 run recorded.
   * The forced command MAR-573 installs makes it unreachable on a prepared
   * host, which is the point of that decision; a host prepared by hand, or one
   * whose setup was removed, still lands here and is still told the truth.
   */
  if (/command not found|not found\s*$|no such file or directory/i.test(text)) {
    return "helper_not_installed";
  }
  return null;
}
