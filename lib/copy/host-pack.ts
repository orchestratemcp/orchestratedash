/**
 * What DASH says about a server's host pack (MAR-629, ADR 0021).
 *
 * Separate from `lib/deploy/host-pack.ts` because that module returns a verdict
 * and this one words it — `lib/copy/bring-home.ts`'s split, for its reason: a
 * change to a rule and a change to a word should not look identical in a diff.
 *
 * ## The named stop, and why it is not `helper_too_old`
 *
 * ADR 0017 gave "this server cannot remove an agent" its own sentence rather
 * than a generic refusal, because a generic refusal sends somebody looking at
 * their server for DASH's version skew. ADR 0021 section 4 makes the same
 * choice again and says why reusing the first one would be wrong: the shipped
 * `helper_too_old` sentence is about not being able to **remove** an agent, and
 * collapsing "cannot run the host broker" into it would tell a person the wrong
 * thing about their own machine. The exit is the same act; the reason shown is
 * not.
 *
 * ## What is deliberately not said here yet
 *
 * There is no sentence in this file offering to put a key on a server, and that
 * absence is the honest state of this pack rather than an oversight.
 *
 * This pack builds the runtime: a host that has run setup since MAR-629 carries
 * a broker, an empty store and a version DASH can read, and an agent on that
 * host can reach a model **with a key that is already there**. What places the
 * key is ADR 0018's `install-key`, with its per-key, per-host consent ceremony,
 * and that is MAR-625's to write. Until it lands, `MODEL_KEY_STAYS_HOME_REFUSAL`
 * in `lib/ai/model-choice.ts` stays exactly as it is, because it is still true:
 * DASH does not send keys to a server.
 *
 * Writing "set this host up for AI" here today would be a receipt claiming a
 * path that stops one step short — the precise failure ADR 0002 exists to
 * prevent, and the one MAR-629's own issue text warns about: *no surface may
 * claim a deployed agent can do model work* until the whole path is proven.
 * When `install-key` ships, the sentence belongs here, beside the stop that
 * tells a person why the offer is not available on their older server.
 */

import type { HostPackVerdict } from "../deploy/host-pack";

/**
 * Why this server cannot run a host broker, and the one thing to do about it.
 *
 * ADR 0021 section 4 fixes the wording and a test pins it by value, for
 * `MODEL_KEY_STAYS_HOME_REFUSAL`'s reason: it reaches a surface, and a sentence
 * composed where it is rendered is a sentence the next person reworders.
 *
 * `label` is the name the person gave the server. Never an address, never a host
 * id — the rule every sentence in `lib/copy/bring-home.ts` keeps, and the reason
 * `186.240.156.166` appears in an ADR and never on a screen.
 */
export function describeHostPackTooOld(label: string): string {
  return (
    `${label} was set up with an older copy of DASH's setup step, which cannot run the host ` +
    `broker — so a key placed there could not be used yet. Run the setup step for this server ` +
    `again.`
  );
}

/**
 * What a server row says about its pack, or nothing.
 *
 * Null for a host that is current, because a row that announced "this server is
 * up to date" on every line would be noise on the ordinary case — the same
 * instinct `describeReadOnlyHost` follows when it returns null for the installed
 * app.
 *
 * Null too when DASH could not reach the server. That is the distinction
 * `HostPackVerdict` carries a third member for: an unreachable box has told DASH
 * nothing about its pack, and saying "run setup again" about a machine that is
 * merely asleep would send somebody to re-run an install they do not need. The
 * reachability failure has its own sentence elsewhere and is not this module's.
 */
export function describeHostPack(verdict: HostPackVerdict, label: string): string | null {
  if (verdict.ok || verdict.stop === "unreachable") {
    return null;
  }
  return describeHostPackTooOld(label);
}
