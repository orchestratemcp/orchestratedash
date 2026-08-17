/**
 * The host pack's version, and the one place "too old" is decided (MAR-629,
 * ADR 0021).
 *
 * Pure: no filesystem, no `ssh`, no child process. `runner/host-pack.ts` is the
 * pack on a host's disk; this is what DASH knows about it from one answer.
 *
 * ## Why the mapping lives in a function rather than at each call site
 *
 * Three different facts mean the same thing to a person, and they arrive by
 * three different routes:
 *
 * - a helper that predates the pack answers `unknown_verb`, because
 *   `checkDeployRequest` refuses a verb its own bytes do not list;
 * - a helper that carries the pack but cannot prove it — no `pack.json`, an
 *   unreadable wrapping key, a secrets root that is not `0700` — answers
 *   `pack_unproved`;
 * - a helper that answers a version older than this DASH requires is current
 *   for some other DASH and not for this one.
 *
 * All three are `host_pack_too_old` and all three have the same exit: run the
 * setup step for that server again. ADR 0021 section 4 makes that a named stop
 * rather than a reuse of `helper_too_old`, because `helper_too_old`'s shipped
 * sentence is about not being able to *remove* an agent, and collapsing "cannot
 * run the host broker" into it would send somebody looking at their server for
 * the wrong thing.
 *
 * The function exists so that a caller cannot get the third case wrong by
 * accident. `answer.pack_version >= 1` written at a call site is a comparison
 * somebody will one day write as `!== undefined`, and a missing version read as
 * present is exactly the failure the verb was invented to avoid.
 */

import type { DeployAnswer } from "./verbs";

/**
 * What the pack this DASH ships *is*.
 *
 * A positive integer, bumped when the pack's contents change in a way an older
 * host cannot serve. **v1 is `1`** and contains ADR 0021's four things: the host
 * broker, an empty host secret store, the spool extension, and this number.
 *
 * It is not the runner build id and must not be derived from one. A runner build
 * changes on every source edit; a pack version changes when the *runtime
 * contract with an enrolled host* changes, which is rarely and deliberately.
 */
export const HOST_PACK_VERSION = 1;

/**
 * The oldest pack this DASH will talk to.
 *
 * Equal to `HOST_PACK_VERSION` today, and separate from it on purpose: they
 * answer different questions, and the day they diverge is the day a DASH ships
 * a pack whose predecessor is still good enough. Writing one constant now would
 * make that day a refactor instead of a number.
 */
export const REQUIRED_HOST_PACK_VERSION = 1;

/**
 * The helper's own refusal when it carries the pack and cannot prove it.
 *
 * Distinct from `unknown_verb` on the wire so the host's log and DASH's log can
 * tell "these bytes are old" from "these bytes are current and the tree under
 * them is wrong" — two different repairs for whoever ends up on that machine,
 * even though the exit DASH offers is the same one.
 */
export const PACK_UNPROVED = "pack_unproved";

/**
 * What DASH learned about a host's pack, in the only two shapes there are.
 *
 * There is deliberately no third member for "DASH could not reach the server".
 * Unreachability is a fact about the channel and is already carried by
 * `runDeployVerb`'s own `unreachable` problem; folding it in here would let a
 * server that was merely asleep be reported as needing its setup re-run.
 */
export type HostPackVerdict =
  | { ok: true; pack_version: number }
  | { ok: false; stop: "host_pack_too_old" }
  /** The channel failed. Says nothing about the pack, on purpose. */
  | { ok: false; stop: "unreachable"; detail: string };

/**
 * Read one `pack` answer.
 *
 * The default is `host_pack_too_old`, and the ordering matters: an answer this
 * function does not positively recognise as a proved, new-enough version is one
 * DASH treats as too old. That is the safe direction — the cost of being wrong
 * is one unnecessary setup re-run, and the cost of the other direction is DASH
 * offering to place a key on a machine that cannot use it.
 */
export function readHostPack(answer: DeployAnswer): HostPackVerdict {
  if (answer.ok) {
    if (answer.verb !== "pack") {
      // A well-formed answer to a different question. Not a pack fact at all,
      // and reported as too old rather than as a version, because whatever this
      // helper is doing it is not answering `pack`.
      return { ok: false, stop: "host_pack_too_old" };
    }
    const version = answer.pack_version;
    if (!Number.isInteger(version) || version < REQUIRED_HOST_PACK_VERSION) {
      return { ok: false, stop: "host_pack_too_old" };
    }
    return { ok: true, pack_version: version };
  }

  /*
   * `unreachable` and `unreadable_answer` are `runDeployVerb`'s own problems and
   * describe the channel rather than the host. A server DASH could not sign in
   * to has not told DASH anything about its pack, and saying "run setup again"
   * about a box that is merely off would be the generic refusal ADR 0017
   * refused to write, one layer up.
   */
  if (answer.problem === "unreachable" || answer.problem === "unreadable_answer") {
    return { ok: false, stop: "unreachable", detail: answer.detail };
  }

  return { ok: false, stop: "host_pack_too_old" };
}

/**
 * Whether this host can run a host broker at all.
 *
 * The question every surface that is about to offer a key placement asks, and
 * the reason `pack` exists rather than discovering the answer when `install-key`
 * fails: ADR 0021 section 4 says finding out a host is too old *at the moment a
 * key would leave* is too late for the row that should have said so.
 */
export function hostCanBrokerKeys(verdict: HostPackVerdict): boolean {
  return verdict.ok;
}
