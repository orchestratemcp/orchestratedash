/**
 * Bringing an agent home from a server (MAR-611, ADR 0017).
 *
 * Deploy has been one-way since MAR-487. DASH can put an agent on a host, start
 * it, ask what is there and read evidence back; it has never been able to take
 * the agent off again. `host.forget` removes the key and the label and leaves
 * the bundle running on a machine DASH can no longer name.
 *
 * Henrik's own words on the issue, which are also the shape of the feature:
 *
 * > *"If an agent lives on VPS - It should disconnect and delete/copy down to
 * > the local file (say it has some output that its nice it follows "home").
 * > Then if you still want to delete the agent you delete it locally. So it
 * > lives on the VPS but can move home ;p"*
 *
 * ## The one rule this file exists to hold
 *
 * > **DASH does not remove what it could not copy.**
 *
 * Every branch below is that sentence. The bundle directory holds the runner's
 * own store — the host's entire account of what that agent did there — so the
 * two orders are not symmetric failures. Remove-then-copy loses somebody's
 * evidence permanently, on a machine DASH was mid-conversation with.
 * Copy-then-remove, when the copy fails, leaves the agent exactly where it was:
 * a state that is recoverable by pressing the same control again.
 *
 * So a failure at any stage before the removal **changes nothing on the server**,
 * and the outcome says which stage stopped it rather than reporting a generic
 * refusal. `runner/execute.ts`'s habit — the refusals are the interesting part,
 * and collapsing three situations into one sends a person to the wrong end of
 * their own problem.
 *
 * ## Why this file has no `ssh` in it
 *
 * Every step is injected. That is `lib/deploy/verbs.ts`'s split for the same
 * reason it gives: everything decided here is decided on answers, so CI runs the
 * whole sequence — including the orders it refuses to perform — on a machine
 * with no host, no key and no network. `electron/host-bring-home.ts` supplies
 * the real steps, and `tests/bring-home.test.ts` supplies ones that record what
 * they were asked to do in what order.
 *
 * ## What this deliberately does not do
 *
 * **It does not delete anything on this computer.** That is the two-step Henrik
 * described and it is worth keeping structurally rather than by convention:
 * *stop hosting this* and *destroy this* are different decisions, and a bring-home
 * that also removed the local agent would collapse them into one press. Removing
 * an agent is `removeAgent`'s, from the agent's own page, afterwards.
 *
 * **It does not touch the local run history**, and it must not: MAR-604 owns the
 * question of what happens to an agent's runs when the agent goes, and this act
 * *adds* to that history rather than taking anything out of it.
 *
 * **It does not bring the agent's own files down.** DASH is where they came
 * from — `agent_deploys` holds the digest of what went — so a copy pulled back
 * is older-or-equal by construction and writing it over the local folder would
 * be a silent downgrade nobody asked for. An agent on a host that DASH does *not*
 * hold is refused by the caller rather than reconstructed here; adopting a
 * stranger's agent off a server is a different feature with a different verb.
 */

import type { EvidencePull } from "../agent-dom/evidence";
import type { ArtifactToFetch, FetchedArtifact } from "../agent-dom/artifact-bytes";
import type { RemoteRunnerChannel } from "../agent-dom/runner-channel";
import type { DeployAnswer } from "./verbs";

/* ---------------------------------------------------------------------- *
 * What the sequence is made of
 * ---------------------------------------------------------------------- */

/** A control channel to the host's runner, or why one could not be opened. */
export type ChannelAttempt =
  | { ok: true; channel: RemoteRunnerChannel }
  /**
   * `problem` is the helper's own code and is what the retry decides on.
   *
   * Carried separately from `detail` because the two are read by different
   * things: a person reads the sentence, and this file branches on the code. The
   * one that matters is `no_channel_credential` — see `openWithRetry`.
   */
  | { ok: false; problem: string; detail: string };

/** Where the copies went, or why they did not go anywhere. */
export type SaveOutcome =
  | { ok: true; saved: number; where: string }
  /** The person closed the folder dialog. An answer, not a failure. */
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; detail: string };

/**
 * Every act the sequence performs, as injected functions.
 *
 * Each returns rather than throws. A step that threw would make the ordering
 * rule depend on a `catch` somewhere, and the whole value of this module is that
 * the order is readable in one function.
 */
export interface BringHomeSteps {
  /** Open the control plane, fetching and spending the host runner's credential. */
  connect: () => Promise<ChannelAttempt>;
  /** Ask the host to start the installed runner, so it can be asked what it did. */
  start: () => Promise<DeployAnswer>;
  /** Ask the runner to stop, through its own authenticated route. */
  stop: () => Promise<DeployAnswer>;
  /** Take the bundle off the host. The only step that destroys anything. */
  uninstall: () => Promise<DeployAnswer>;
  /** Drain what the agent did, and learn which files that machine is holding. */
  pull: (channel: RemoteRunnerChannel) => Promise<EvidencePull>;
  /** Fetch those files' bytes. */
  fetch: (
    channel: RemoteRunnerChannel,
    artifacts: readonly ArtifactToFetch[],
  ) => Promise<FetchedArtifact[]>;
  /** Ask the person where the files should land, and put them there. */
  save: (files: readonly BroughtHomeFile[]) => Promise<SaveOutcome>;
  /** Injected so a test does not wait real seconds. See `openWithRetry`. */
  wait: (ms: number) => Promise<void>;
}

export interface BroughtHomeFile {
  /**
   * Carried beside the name because the name is **untrusted** and this is not.
   *
   * `display_name` is what an agent on a machine DASH does not administer chose
   * to call its own file. The saver has to put it on this computer's disk, so it
   * needs something to fall back to when that name turns out to be a path, a
   * reserved device name, or empty — and an opaque id over a narrow alphabet is
   * the thing that is always safe to use.
   */
  artifact_id: string;
  display_name: string;
  bytes: Uint8Array;
}

/** Which stage stopped it. Every one of these means nothing on the server changed. */
export type BringHomeStop =
  /** The host says it has no copy of this agent. */
  | "nothing_there"
  /** It is installed there and DASH could not get it running to ask it anything. */
  | "could_not_start"
  /** DASH could not sign in to the runner on that machine. */
  | "could_not_sign_in"
  /** The runner answered nothing DASH could read. */
  | "could_not_read"
  /** One or more of its outputs could not be copied off. */
  | "outputs_left_behind"
  /** The person closed the folder dialog. */
  | "cancelled"
  /** The copies could not be written on this computer. */
  | "could_not_save"
  /** The runner would not stop, so its files must not be removed underneath it. */
  | "would_not_stop"
  /**
   * Everything was copied and the server's helper is too old to know this verb.
   *
   * Its own stop rather than a shade of `could_not_remove`, because it is the
   * one failure here with a precise and performable exit: the helper is
   * installed once by the setup step a person pastes, with its bytes embedded,
   * so a host enrolled before MAR-611 answers `unknown_verb` forever until that
   * step is run again. A generic "the server would not remove it" would send
   * somebody looking at their server for a fault that is DASH's own version skew
   * — which is `runner/execute.ts`'s argument for not collapsing refusals, on the
   * refusal that would waste the most of somebody's evening.
   */
  | "helper_too_old"
  /** Everything was copied and the removal itself failed. */
  | "could_not_remove";

export type BringHomeOutcome =
  | {
      ok: false;
      stopped_at: BringHomeStop;
      /**
       * The server's own sentence when there is one.
       *
       * Passed through rather than replaced: the helper distinguishes a bundle
       * that is not installed from a runner that left no way to sign in to it,
       * and those are different next steps. Null when the stage produced no
       * sentence worth a person's time.
       */
      detail: string | null;
      /** Named for `outputs_left_behind`, so the sentence can list them. */
      left_behind: readonly string[];
    }
  | {
      ok: true;
      /** True when DASH had to start the runner to ask it anything. */
      started_it: boolean;
      /** What the last look drained, so the surface can say what came home. */
      pull: EvidencePull;
      files_saved: number;
      /** The folder the person chose. Null when there were no files to save. */
      saved_where: string | null;
      /** The ids of the outputs that were on that machine, for the store to mark. */
      brought_home: readonly string[];
      /** False when the host had already lost the bundle between two steps. */
      removed: boolean;
    };

/* ---------------------------------------------------------------------- *
 * The sequence
 * ---------------------------------------------------------------------- */

/**
 * How long DASH gives a runner it just started to publish its own credential.
 *
 * `start` answers as soon as the host has a pid, and the runner writes
 * `runner.json` and its session key a moment later — so the first `channel`
 * after a start can honestly answer `no_channel_credential` about a runner that
 * is two hundred milliseconds from having one. Retried rather than slept
 * through, because a fixed sleep is either too short on a loaded VPS or wasted
 * on an idle one.
 */
const CREDENTIAL_ATTEMPTS = 6;
const CREDENTIAL_WAIT_MS = 1_000;

/**
 * Copy an agent's work off a server, then take the agent off it.
 *
 * Read top to bottom: every `return` before the `uninstall` call is a promise
 * that the server is untouched.
 */
export async function bringAgentHome(
  agentId: string,
  steps: BringHomeSteps,
): Promise<BringHomeOutcome> {
  /*
   * Stage 1 — reach the runner, starting it if it is not running.
   *
   * There is no restart policy anywhere in DASH or in the host helper —
   * `runner/README.md` item 3 records that as deliberate, and ADR 0007 leaves
   * restart-on-boot undecided on purpose. So *installed and not running* is the
   * ordinary state of a host that has rebooted, not an unusual one, and a
   * bring-home that refused there would refuse in the commonest case.
   *
   * Starting the runner does not start a run. It brings up the process that
   * supervises registrations; a manual-first agent still only runs when
   * something asks it to, which is ADR 0014's whole reason for admitting a run
   * route separately.
   */
  let opened = await steps.connect();
  let startedIt = false;

  if (!opened.ok && opened.problem === "not_installed") {
    return stop("nothing_there", opened.detail);
  }
  if (!opened.ok && (opened.problem === "not_running" || opened.problem === "no_channel_credential")) {
    const started = await steps.start();
    if (!started.ok) {
      return stop("could_not_start", started.detail);
    }
    startedIt = true;
    opened = await openWithRetry(steps);
  }
  if (!opened.ok) {
    return stop("could_not_sign_in", opened.detail);
  }
  const channel = opened.channel;

  /*
   * Stage 2 — the last look, and it is the one that has to succeed.
   *
   * Everywhere else a failed pull is fire-and-forget: `pullEvidence` swallows
   * each drain's failure because a poll that stopped the loop would be worse
   * than a poll that missed a beat. Here the pull is the copy, and a pull that
   * reached nothing is a copy that took nothing — so this is the one caller that
   * treats `reached` as load-bearing rather than as a note for the Runs page.
   */
  const pull = await steps.pull(channel);
  if (!pull.reached) {
    return stop("could_not_read", null);
  }

  /*
   * Stage 3 — the files.
   *
   * `pull.workspace_index` is the only place DASH ever learns which outputs are
   * on *that* machine: `workspace_artifacts` has no column for it and a deployed
   * agent has the same id in both places, so this list cannot be reconstructed
   * afterwards and must not be guessed at. See `IndexedArtifact`.
   *
   * Filtered to this agent, because a host may hold several bundles and one
   * runner serves whatever is registered with it. Filtered to `available`,
   * because the runner has already looked and told DASH the others are gone —
   * asking for the bytes of a file its own index calls deleted would produce a
   * refusal DASH would then have to explain away.
   */
  const wanted: ArtifactToFetch[] = pull.workspace_index
    .filter((entry) => entry.agent === agentId && entry.availability === "available")
    .map((entry) => ({
      artifact_id: entry.artifact_id,
      display_name: entry.display_name,
      byte_size: entry.byte_size,
    }));

  let savedWhere: string | null = null;
  let savedCount = 0;

  if (wanted.length > 0) {
    const fetched = await steps.fetch(channel, wanted);
    const missed = fetched.filter((one) => !one.ok);
    if (missed.length > 0) {
      /*
       * The rule, at the only place it can be broken.
       *
       * One file DASH could not take off the server is enough to stop the
       * removal, and it is deliberately not a warning the person can wave
       * through. A partial copy followed by a removal is the outcome nobody
       * would choose and everybody would click past.
       */
      return stop(
        "outputs_left_behind",
        null,
        missed.map((one) => (one.ok ? "" : `${one.display_name} — ${one.reason}`)),
      );
    }

    const saved = await steps.save(
      fetched.flatMap((one) =>
        one.ok
          ? [{ artifact_id: one.artifact_id, display_name: one.display_name, bytes: one.bytes }]
          : [],
      ),
    );
    if (!saved.ok) {
      return saved.cancelled ? stop("cancelled", null) : stop("could_not_save", saved.detail);
    }
    savedWhere = saved.where;
    savedCount = saved.saved;
  }

  /*
   * Stage 4 — stop, then remove.
   *
   * Refused here as well as by the helper, and the duplication is the point. The
   * helper refuses to remove a running bundle because it owns the filesystem and
   * a directory deleted under a live process is the quiet version of the
   * force-kill AGENTS.md forbids. DASH refuses first because it can say *why* in
   * the runner's own words — "did not leave a way to sign in to it" is a
   * different problem from "would not answer", and the helper's `still_running`
   * cannot tell them apart.
   */
  const stopped = await steps.stop();
  if (!stopped.ok) {
    return stop("would_not_stop", stopped.detail);
  }
  if (stopped.verb === "stop" && !stopped.stopped) {
    return stop("would_not_stop", stopped.detail);
  }

  const removed = await steps.uninstall();
  if (!removed.ok) {
    // The copy has already happened by this line, in both branches. What differs
    // is what the person should do next, which is the only reason to tell them
    // apart at all.
    return stop(
      removed.problem === "unknown_verb" ? "helper_too_old" : "could_not_remove",
      removed.detail,
    );
  }

  return {
    ok: true,
    started_it: startedIt,
    pull,
    files_saved: savedCount,
    saved_where: savedWhere,
    brought_home: wanted.map((one) => one.artifact_id),
    // `uninstall` answers `removed: false` when the bundle had already gone —
    // between DASH's first look and this step, on a machine somebody else
    // administers. The act still succeeded; the sentence is a different one.
    removed: removed.verb === "uninstall" ? removed.removed : false,
  };
}

/**
 * Re-open the channel while a just-started runner gets around to publishing its
 * credential.
 *
 * Only `no_channel_credential` is retried. Every other refusal is a state that
 * waiting cannot change — a bundle that is not installed will not become
 * installed, and a runner reporting itself not running after a successful start
 * is telling DASH something a second look will repeat.
 */
async function openWithRetry(steps: BringHomeSteps): Promise<ChannelAttempt> {
  let attempt = await steps.connect();
  for (let tries = 1; tries < CREDENTIAL_ATTEMPTS; tries += 1) {
    if (attempt.ok || attempt.problem !== "no_channel_credential") {
      return attempt;
    }
    await steps.wait(CREDENTIAL_WAIT_MS);
    attempt = await steps.connect();
  }
  return attempt;
}

function stop(
  stopped_at: BringHomeStop,
  detail: string | null,
  left_behind: readonly string[] = [],
): BringHomeOutcome {
  return { ok: false, stopped_at, detail, left_behind };
}
