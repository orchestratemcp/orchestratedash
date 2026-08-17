/**
 * The deploy plane's verb set, and the envelope a verb carries (MAR-487,
 * ADR 0007).
 *
 * Pure: no `ssh`, no filesystem, no child process. `electron/ssh-host.ts` sends
 * these and `scripts/host-helper/main.ts` answers them. The split is
 * `lib/hosts.ts`'s and it is kept for that file's stated reason — everything
 * decided here is decided on strings, so CI runs all of it on a machine with no
 * host, no key and no network.
 *
 * ## The rule this file exists to enforce
 *
 * ADR 0007, on the plane that wants exactly the power `runner/README.md`
 * declined to expose:
 *
 * > SSH exec is a general shell, which is the thing `runner/README.md` refused
 * > to build. So DASH does not compose command lines. […] **DASH chooses which
 * > operation, never what to run.** A verb takes arguments the helper
 * > validates; it does not take a command.
 *
 * Two things follow, and both are structural rather than remembered.
 *
 * **A verb is a member of a closed array**, so the string that reaches `ssh`'s
 * argv is drawn from a set a reader can count. Adding one is a change to
 * `DEPLOY_VERBS` *and* to the argument type derived from it, in this file,
 * reviewed as a widening.
 *
 * **A verb's arguments do not reach argv at all.** They travel as a JSON
 * envelope on the child's stdin, and the only strings on the command line are
 * the fixed options `sshArgv` composes and the verb itself. That is not a
 * convenience: argv is where option injection lives — `lib/hosts.ts` refuses a
 * leading `-` on every component for exactly that reason — and a bundle's file
 * list could never have gone there anyway. Keeping *all* variable data off argv
 * means the set of strings `ssh` can be made to interpret is fixed at compile
 * time.
 *
 * ## What an identifier may be, and why it is not a path
 *
 * `bundle_id` and `agent_id` are opaque tokens over a narrow alphabet. The
 * helper joins them to a root it chose; it never receives a path. This is
 * MAR-507's rule pointed one machine over — *"the renderer names a kind of file
 * and never a file"* — and the sharper version of it, because here the far end
 * is a machine DASH does not administer: a payload that could name a directory
 * would be a payload that could name `/etc`.
 */

/* ---------------------------------------------------------------------- *
 * The set
 * ---------------------------------------------------------------------- */

/**
 * Every verb DASH will ever send a host, as a closed set.
 *
 * ADR 0007 named six and specified none, saying the set "belongs with the
 * deploy bridge, where there is something to validate against". MAR-484 wrote
 * `connect` — the control plane's — and left the other five as vocabulary for
 * an implementation that did not exist. This is that implementation, so they
 * are written now and not before.
 *
 * - `install` — put a bundle on the host. Files, validated, under an id.
 * - `start` — run the installed bundle. **What** runs is the helper's decision.
 * - `stop` — ask the running runner to stop, through its own authenticated route.
 * - `status` — what is installed and what is alive.
 * - `collect` — the host's own account of a bundle: log tail, endpoint identity.
 * - `connect` — join the runner's socket to stdio. The control plane (MAR-484).
 * - `channel` — hand back the credential `connect`'s pipe has to be spoken with
 *   (MAR-602). See below; it is the seventh, and the set is closed again.
 * - `uninstall` — take one bundle off the host. The eighth (MAR-611, ADR 0017),
 *   and the only verb that removes anything. See below.
 * - `pack` — which host pack this helper carries. The ninth (MAR-629, ADR 0021),
 *   and the only verb that asks about the machine rather than about a bundle.
 *   See below.
 *
 * ## The seventh, and why the set opened once (MAR-602, ADR 0014 amendment 1)
 *
 * ADR 0007 amendment 3 fixed the six above and said "no more". This adds one,
 * and the widening is written here rather than assumed because a closed set that
 * grows quietly is a set that was never closed.
 *
 * **What forced it.** ADR 0007 runs two planes with two credentials, and the
 * control plane's is "that runner's own channel secret". Nothing ever minted or
 * exchanged it — `runner/README.md` item 6 has named that gap for months — so
 * `sshHostChannel` took a `token` parameter that no caller anywhere could
 * supply. The evidence plane was written, tested, and unreachable: a channel
 * with no credential is a channel that answers 401 to every route on it.
 *
 * **Why it is a verb rather than a bundled secret.** The alternative was for
 * DASH to mint the secret and ship it in the install payload at
 * `data/runner.key`, which needs no new verb at all. It is rejected on two
 * counts. `checkDeployRequest` admits exactly `0o644` and `0o755`, so a
 * credential arriving as a bundle file lands world-readable on a machine whose
 * home directory ordinarily is — and widening the mode set for one file would
 * put a hole in the closed set to avoid opening a closed set. And it inverts
 * custody: ADR 0007 says the credential is the runner's **own**, minted where
 * `hardenOwnerOnly` already runs, and a pushed secret makes DASH the supplier of
 * a credential for a process on a machine it does not administer.
 *
 * **Why it is not a widening of what the helper can do.** `stop` already reads
 * this exact file — `{bundle}/data/runner.session.key`, MAR-520's record of the
 * secret the runner actually resolved — and already authenticates to the
 * runner's own `POST /shutdown` with it. The capability is three months old.
 * What is new is returning the value instead of spending it, to a caller that
 * signed in with the key whose `authorized_keys` line runs this program and
 * nothing else.
 *
 * **Held to ADR 0014's three questions, which is the test a route joins by.**
 * (1) *Does it carry a credential?* Yes, outbound host→DASH, and it is the only
 * member of either plane that does — so it is the one that had to be argued
 * rather than counted. It is not a *user's* credential and not a brokered one:
 * it is a value the host's own runner minted for itself, and its whole authority
 * is over that runner, on that machine, through a socket only a session `sshd`
 * authenticated can reach. ADR 0006's line is untouched, because reaching this
 * runner grants the evidence routes and the run route and nothing else — the
 * broker is excluded by the *type* of the channel this credential is used on.
 * (2) *Does it choose what runs, or only which?* Neither. It reads one file
 * under a root the helper chose, named by an id that cannot spell a path.
 * (3) *Can DASH describe the result honestly?* It does not have to: nothing
 * about this verb reaches a surface. It is spent inside one action and never
 * stored — see `electron/host-run.ts`, which is where that promise is kept.
 *
 * ## The eighth, and the first verb that destroys something (MAR-611, ADR 0017)
 *
 * Deploy has been one-way since MAR-487: DASH can put an agent on a host and
 * read evidence back, and can never take the agent off again. `host.forget`
 * removes the key and the label and leaves the bundle where it is. So the only
 * way to get an agent off a server was to sign in to that server by hand.
 *
 * **Held to ADR 0014's three questions, like the seventh.**
 * (1) *Does it carry a credential?* No, in either direction. A bundle id out;
 * `{removed, detail}` back.
 * (2) *Does it choose what runs, or only which?* Neither — it runs nothing. It
 * names one directory under a root the helper chose, by an id whose alphabet
 * cannot spell a path, and the helper is what joins the two.
 * (3) *Can DASH describe the result honestly?* Yes, and this is the question
 * that shaped the verb. Removing a bundle destroys the runner's store inside it,
 * which is where the host's account of what that agent did lives — so a verb
 * that could be sent on its own would be a way to lose evidence DASH had never
 * read. Two things follow, and they are in different places on purpose:
 *
 * - **The helper refuses while the runner is running** (`still_running`). Not a
 *   courtesy: a directory removed out from under a live process leaves a runner
 *   writing into a deleted tree on a machine nobody is watching. The ordering is
 *   therefore enforced on the side that owns the filesystem, which is
 *   `checkDeployRequest`'s own argument for living on both ends — a rule that
 *   lived only in DASH is a rule the host does not have.
 * - **DASH copies before it removes**, and refuses to remove when the copy
 *   failed. That rule is `lib/deploy/bring-home.ts`'s and is not expressible
 *   here, because this plane cannot see the control plane's evidence. Naming it
 *   in both files is deliberate: this is the verb somebody would otherwise reach
 *   for on its own.
 *
 * **It is idempotent, and that is a decision rather than a convenience.** A
 * bundle that is not installed answers `ok` with `removed: false` rather than
 * `not_installed` — unlike `stop`, where a missing bundle means the caller is
 * confused. Here "it is not there" is the outcome being asked for, and a
 * bring-home that failed at its last step must be safe to press again.
 *
 * ## The ninth, and the first verb that asks about the machine (MAR-629, ADR 0021)
 *
 * Every verb above names a bundle, because until now a host was a place bundles
 * sat. ADR 0021 makes it a small DASH runtime — a broker, a secret store and a
 * spool, installed at enrolment — and a runtime has a version. `pack` reads it.
 *
 * **Why a verb rather than a field on `status`.** `status` already answers, on
 * every host ever enrolled, including the ones that predate the pack. A version
 * carried there would be missing rather than refused on an old helper, and a
 * missing field read as zero — or as "assume current" — is how
 * `186.240.156.166` would look upgraded forever. The too-old probe has to be a
 * question the old bytes cannot answer, and a verb is the only thing on this
 * plane with that property: `checkDeployRequest` refuses an unknown verb by
 * construction, so an old helper answers `unknown_verb` without anybody having
 * written the refusal. ADR 0021 section 4 rejects the `status` field by name.
 *
 * `status` may still carry `pack_version` later as a convenience. It may not
 * become the probe.
 *
 * **Held to ADR 0014's three questions, like the seventh and the eighth.**
 * (1) *Does it carry a credential in either direction?* No, and this is the one
 * verb where that is worth checking twice, because it is the verb that stands
 * next to the secret store. A verb out; an integer back. Not a key, not a key's
 * digest, not a count of keys, not a slot name, not the wrapping key, not a
 * path. The answer type below is the enforcement — there is no member on it a
 * secret could travel in.
 * (2) *Does it choose what runs, or only which?* Neither. It reads an identity
 * file the helper wrote under a root the helper chose, and the request carries
 * no identifier at all — not even an optional one, unlike `status`. There is
 * nothing in it to validate because there is nothing in it.
 * (3) *Can DASH describe the result honestly afterwards?* Yes, in two sentences
 * and no third: this helper's pack version at the time DASH asked, or that the
 * helper is too old to know the question. `lib/deploy/host-pack.ts` is where
 * those two become one verdict, and it deliberately cannot produce a third.
 *
 * **What it is not.** It is not `install-key` (ADR 0018's verb, and still
 * unimplemented), and it is not a way to reach the host broker. The host broker
 * answers the agent beside it, on that machine, and has no route on this plane
 * or on the control plane — see ADR 0021 section 5, and the test at the bottom
 * of `tests/deploy-bridge.test.ts` that checks no verb is broker-shaped.
 */
export const DEPLOY_VERBS = [
  "install",
  "start",
  "stop",
  "status",
  "collect",
  "connect",
  "channel",
  "uninstall",
  "pack",
] as const;

export type DeployVerb = (typeof DEPLOY_VERBS)[number];

export function isDeployVerb(candidate: string): candidate is DeployVerb {
  return (DEPLOY_VERBS as readonly string[]).includes(candidate);
}

/* ---------------------------------------------------------------------- *
 * What a verb carries
 * ---------------------------------------------------------------------- */

/**
 * Opaque identifiers, over an alphabet that cannot spell a path.
 *
 * No `/`, no `\`, no `.`, no `:`, no leading `-`. A value passing this cannot
 * traverse, cannot name a drive, cannot become an `ssh` option and cannot be a
 * Windows reserved device name — the last because a name that is only letters,
 * digits, `_` and `-` and is at least three characters long is not `NUL`,
 * `COM1` or `AUX`.
 *
 * Deliberately not "a safe path": `runner/path-guard.ts` exists for paths and
 * is used by the helper on the *file names inside* a bundle. An id is a
 * different thing and the difference is the point — the helper joins it to a
 * root it chose.
 */
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{2,63}$/;

/** A file inside a bundle, as it travels. */
export interface BundleFile {
  /**
   * A relative path inside the bundle, `/`-separated.
   *
   * The one field here that is a path, and the helper is what validates it —
   * with `runner/path-guard.ts`, the module MAR-434 wrote for a child that runs
   * as the same user as the runner. It is checked on the receiving side rather
   * than only here, because a check that lives only in the sender is a check a
   * different sender does not perform.
   */
  path: string;
  /** Base64. JSON has no bytes, and a bundle holds a compiled runner. */
  content_base64: string;
  /** SHA-256 of the decoded bytes, hex. Re-computed by the helper after writing. */
  sha256: string;
  /** POSIX mode. Only `0o644` and `0o755` are admitted — see `checkDeployRequest`. */
  mode: number;
}

export interface InstallRequest {
  verb: "install";
  bundle_id: string;
  agent_id: string;
  /** What DASH believes it built, for the receipt and for the log. */
  runner_build: string;
  files: BundleFile[];
}

export interface StartRequest {
  verb: "start";
  bundle_id: string;
}
export interface StopRequest {
  verb: "stop";
  bundle_id: string;
}
export interface StatusRequest {
  verb: "status";
  /** Absent asks about every bundle, which is what a Connection Center row needs. */
  bundle_id?: string;
}
export interface CollectRequest {
  verb: "collect";
  bundle_id: string;
  /** How many trailing log lines to return, bounded below and above. */
  lines?: number;
}
export interface ConnectRequest {
  verb: "connect";
  bundle_id: string;
}
/**
 * Ask for the credential the control plane is spoken with (MAR-602).
 *
 * Carries a bundle id and nothing else — deliberately not a nonce, a challenge
 * or an expiry. Adding one would suggest this request is what authorises the
 * answer, and it is not: the authorisation is the SSH session, whose key is
 * pinned to a `restrict,command=` line that can run this program and no other.
 * A second mechanism in front of that would be decoration, and decoration on a
 * credential path is worse than none because it reads as a guarantee.
 */
export interface ChannelRequest {
  verb: "channel";
  bundle_id: string;
}
/**
 * Take one bundle off the host (MAR-611).
 *
 * A bundle id and nothing else — in particular no `force`, no `even_if_running`
 * and no `keep_data`. Each of those would be a caller telling the helper to
 * relax a rule the helper exists to hold, and the closed-set discipline this
 * file opens with is worth as much on a verb's *fields* as on its name: the
 * helper decides, the request identifies.
 */
export interface UninstallRequest {
  verb: "uninstall";
  bundle_id: string;
}
/**
 * Which host pack this helper carries (MAR-629, ADR 0021).
 *
 * The only request in this union with no fields but its verb, and the emptiness
 * is the design rather than an omission. `status` takes an *optional* bundle id
 * because a Connection Center row asks about a host and an agent row asks about
 * a bundle; this asks about the machine only, and there is no second question it
 * could be pointed at. A `bundle_id` here would be a field the helper had to
 * decide to ignore, and `checkDeployRequest` refuses one rather than ignoring
 * it — for `runHelper`'s stated reason about a surplus argument, which applies
 * with more force to the verb that stands beside the secret store.
 */
export interface PackRequest {
  verb: "pack";
}

export type DeployRequest =
  | InstallRequest
  | StartRequest
  | StopRequest
  | StatusRequest
  | CollectRequest
  | ConnectRequest
  | ChannelRequest
  | UninstallRequest
  | PackRequest;

/* ---------------------------------------------------------------------- *
 * The check, run on both ends
 * ---------------------------------------------------------------------- */

export type DeployRequestProblem =
  | "unknown_verb"
  | "malformed_identifier"
  | "malformed_files"
  | "malformed_mode"
  | "too_large"
  | "malformed_lines";

export type DeployRequestCheck =
  | { ok: true; request: DeployRequest }
  | { ok: false; problem: DeployRequestProblem; detail: string };

/**
 * A bundle is a compiled runner plus an agent. Sixty-four megabytes is far more
 * than one needs and far less than a way to fill somebody's disk.
 */
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
/** One log read is an answer to a question, not a download. */
export const MAX_COLLECT_LINES = 500;

/**
 * Check a candidate request, or say which part is wrong.
 *
 * Called by the sender before anything is spawned **and by the helper on
 * whatever arrives**. Two calls to one function rather than two
 * implementations: the helper is the side that matters, because it is the side
 * that would be talked to by something other than DASH, and a rule that lived
 * only in the sender would be a rule the host does not have.
 *
 * The first problem is returned rather than all of them, for
 * `checkHostRecord`'s reason: the caller renders one sentence.
 */
export function checkDeployRequest(candidate: unknown): DeployRequestCheck {
  if (typeof candidate !== "object" || candidate === null) {
    return { ok: false, problem: "unknown_verb", detail: "The request was not an object." };
  }
  const request = candidate as Record<string, unknown>;
  const verb = request["verb"];
  if (typeof verb !== "string" || !isDeployVerb(verb)) {
    return {
      ok: false,
      problem: "unknown_verb",
      detail: `"${String(verb)}" is not an operation this helper performs.`,
    };
  }

  // `status` is the one verb whose identifier is optional, because a
  // Connection Center row asks about a host rather than about a bundle.
  //
  // `pack` is the one verb that takes no identifier at all (MAR-629). Refused
  // rather than ignored when one arrives, because a caller that sent one has a
  // different model of this verb than this file does — the argument `runHelper`
  // makes about a surplus argv token, and the reason `PackRequest` has no
  // fields.
  const bundleId = request["bundle_id"];
  if (verb === "pack") {
    if (bundleId !== undefined) {
      return {
        ok: false,
        problem: "malformed_identifier",
        detail: "The pack question is about the server itself and names no agent.",
      };
    }
  } else if (verb === "status") {
    if (bundleId !== undefined && !isIdentifier(bundleId)) {
      return identifierProblem("bundle_id");
    }
  } else if (!isIdentifier(bundleId)) {
    return identifierProblem("bundle_id");
  }

  if (verb === "collect") {
    const lines = request["lines"];
    if (lines !== undefined && (!Number.isInteger(lines) || (lines as number) < 1 || (lines as number) > MAX_COLLECT_LINES)) {
      return {
        ok: false,
        problem: "malformed_lines",
        detail: `A log read is between 1 and ${String(MAX_COLLECT_LINES)} lines.`,
      };
    }
  }

  if (verb === "install") {
    if (!isIdentifier(request["agent_id"])) {
      return identifierProblem("agent_id");
    }
    if (typeof request["runner_build"] !== "string" || request["runner_build"].length === 0) {
      return {
        ok: false,
        problem: "malformed_identifier",
        detail: "The bundle did not say which runner build it holds.",
      };
    }
    const files = request["files"];
    if (!Array.isArray(files) || files.length === 0) {
      return { ok: false, problem: "malformed_files", detail: "The bundle carried no files." };
    }
    let total = 0;
    for (const entry of files as unknown[]) {
      if (typeof entry !== "object" || entry === null) {
        return { ok: false, problem: "malformed_files", detail: "A bundle entry was not an object." };
      }
      const file = entry as Record<string, unknown>;
      if (
        typeof file["path"] !== "string" ||
        typeof file["content_base64"] !== "string" ||
        typeof file["sha256"] !== "string" ||
        !/^[0-9a-f]{64}$/.test(file["sha256"])
      ) {
        return {
          ok: false,
          problem: "malformed_files",
          detail: "A bundle entry did not carry a name, its bytes and their digest.",
        };
      }
      // Two values rather than a mask. A mode is a small closed choice here —
      // a file is either readable or runnable — and admitting arbitrary bits
      // would let a bundle ask for setuid on a machine DASH does not administer.
      if (file["mode"] !== 0o644 && file["mode"] !== 0o755) {
        return {
          ok: false,
          problem: "malformed_mode",
          detail: "A bundle file asked for permissions DASH does not send.",
        };
      }
      total += Math.ceil((file["content_base64"].length * 3) / 4);
      if (total > MAX_BUNDLE_BYTES) {
        return {
          ok: false,
          problem: "too_large",
          detail: `A bundle is at most ${String(MAX_BUNDLE_BYTES / (1024 * 1024))} MB.`,
        };
      }
    }
  }

  return { ok: true, request: request as unknown as DeployRequest };
}

function isIdentifier(candidate: unknown): candidate is string {
  return typeof candidate === "string" && IDENTIFIER.test(candidate);
}

function identifierProblem(field: string): DeployRequestCheck {
  return {
    ok: false,
    problem: "malformed_identifier",
    detail:
      `The ${field} must be 3-64 characters of lowercase letters, digits, "-" or "_". ` +
      `It names a thing on the server and can never be a path.`,
  };
}

/* ---------------------------------------------------------------------- *
 * What comes back
 * ---------------------------------------------------------------------- */

/** One installed bundle, as the host describes it. */
export interface HostBundleStatus {
  bundle_id: string;
  agent_id: string;
  runner_build: string;
  installed_at: string;
  /** Whether the host still finds a live process for it. */
  running: boolean;
  /** The pid the host recorded, when it recorded one. Null once it has gone. */
  pid: number | null;
}

export type DeployAnswer =
  | { ok: true; verb: "install"; bundle_id: string; files: number; bytes: number }
  | { ok: true; verb: "start"; bundle_id: string; pid: number }
  | { ok: true; verb: "stop"; bundle_id: string; stopped: boolean; detail: string }
  | { ok: true; verb: "status"; bundles: HostBundleStatus[] }
  | { ok: true; verb: "collect"; bundle_id: string; log: string[]; truncated: boolean }
  /**
   * The one answer in this union that carries a credential (MAR-602).
   *
   * `token` is the running runner's own channel secret. Three rules travel with
   * it and they are enforced elsewhere, so they are named here where somebody
   * reading the type will meet them:
   *
   * 1. **It never reaches a renderer.** `HostActionResult` has no member that
   *    could carry it, which makes that a fact about the boundary rather than a
   *    rule a future caller must remember.
   * 2. **It is never stored.** `electron/host-run.ts` asks for it, spends it on
   *    one exchange, and drops it. A vault entry would go stale the moment the
   *    host's runner restarted and mint a fresh secret, and a stale bearer is a
   *    401 with no sentence attached to it.
   * 3. **It is never logged.** `runDeployVerb` reports the shape of an answer
   *    it could not read and never its contents, which is the existing rule and
   *    is why this member needs no exception to it.
   *
   * `fingerprint` is `channel_secret_fingerprint` from the runner's own
   * `runner.json` — a truncated SHA-256, published on purpose, and not a
   * secret. It lets DASH check it was handed the credential the *running*
   * runner is using rather than one left behind by a previous install, which
   * turns a bare 401 into a named answer. That is `runner/session-key.ts`'s
   * argument, used one machine over by the only caller that ever could.
   */
  | {
      ok: true;
      verb: "channel";
      bundle_id: string;
      token: string;
      fingerprint: string | null;
    }
  /**
   * What was taken off the host (MAR-611).
   *
   * `removed` is false in exactly one successful case — the bundle was not
   * there — and that case is an `ok` rather than a refusal for the reason
   * `DEPLOY_VERBS` gives: absence is the outcome being asked for. A caller
   * distinguishing "DASH removed it" from "it was already gone" has both facts;
   * a caller that does not care may ignore the field.
   */
  | {
      ok: true;
      verb: "uninstall";
      bundle_id: string;
      removed: boolean;
      detail: string;
    }
  /**
   * Which host pack this helper carries (MAR-629, ADR 0021).
   *
   * **One integer, and the shape is the guarantee.** This answer comes back from
   * the machine that holds the host secret store, so the interesting property is
   * what it has no room for: there is no member here a key, a wrapping key, a
   * key's digest, a slot name, a bundle id, a count of placed keys or a path
   * could travel in. `channel` is the only member of this union that carries a
   * credential and it had to be argued for at length; this one is stated as
   * carrying none, and the type is what makes that a fact rather than a promise
   * somebody keeps.
   *
   * A helper too old to know the verb answers `unknown_verb` instead, and a
   * helper whose pack cannot be proved answers `pack_unproved`. Both are
   * `host_pack_too_old` by the time a person reads them —
   * `lib/deploy/host-pack.ts` is the one place that mapping lives, so that a
   * caller cannot accidentally treat a missing pack as a present one.
   */
  | { ok: true; verb: "pack"; pack_version: number }
  | { ok: false; problem: string; detail: string };
