/**
 * What a host has to provide before this runner can start on it (MAR-497).
 *
 * ADR 0007 chose to run *this repository's runner* on the VPS and left one
 * question unowned in its follow-ups: the bundled runner is
 * `dist/electron/runner.mjs`, launched by the Electron binary with
 * `ELECTRON_RUN_AS_NODE=1`, and a host has no Electron binary to launch it
 * with. Something has to supply a Node runtime. This module is where that
 * answer is enforced, and `docs/adr/0007-the-deploy-transport.md` amendment 1
 * is where it is argued.
 *
 * **The host supplies Node; DASH does not ship one.** The whole of the reason
 * is in the next paragraph, and the part that decides it is not size.
 *
 * ## The runner is not "plain Node" in the sense that phrase suggests
 *
 * `runner/store.ts` opens its database with `DatabaseSync` from `node:sqlite`,
 * which is a *standard library* module rather than a native dependency — that
 * is why the runner has no compiled addon to rebuild per Electron ABI, and it
 * is a good trade. What it costs is a version floor: `node:sqlite` did not
 * exist before Node 22.5, and it spent its first releases behind
 * `--experimental-sqlite`. So "the bundled runner is plain Node already" is
 * true about the *language* and not about the *runtime*, and a host with a Node
 * that predates any of that will fail on the first line that touches the store
 * — which is deep inside module evaluation, with a stack trace naming a file
 * the operator has never heard of.
 *
 * ## Why the check is empirical rather than a version comparison alone
 *
 * A major-version floor is a claim about which release unflagged the module,
 * and this project would then be carrying a changelog fact it cannot verify on
 * the machine it is refusing. So the version is checked *and* the module is
 * actually resolved: `MINIMUM_HOST_NODE_MAJOR` catches the ordinary case with a
 * sentence naming a version an operator can go and install, and
 * `describeMissingSqlite` catches every other way the module can be absent —
 * a flag that was not passed, a stripped build, a runtime that is not Node at
 * all — without this file having to know which.
 *
 * The shape is `prepareEndpoint`'s and the argument is ADR 0007's own, made
 * there about the `ssh` binary: probe for what the host must have and say so
 * plainly, rather than failing at the first real operation with a mysterious
 * error. A runner that refuses on line one naming the version it found is a
 * deploy an operator can fix; one that dies inside SQLite is a support thread.
 *
 * Pure and platform-independent on purpose, so CI on Linux exercises the rule
 * that exists for a host it will never run on — the same reason
 * `inspectAcl` takes an SDDL string rather than a file.
 *
 * The two host conventions below — where state goes and what an unsuitable host
 * exits with — live here rather than in `runner/standalone.ts` for a smaller
 * reason that is worth stating: that module is an entry point, so importing it
 * *runs* it. A test that needed a constant out of it would start a runner
 * inside the test process to get one.
 */

import { homedir } from "node:os";
import path from "node:path";

/** Where the standalone runner refuses, so a caller can branch without parsing prose. */
export type HostRuntimeProblem =
  /** The Node major version is below the floor `node:sqlite` needs. */
  | "node_too_old"
  /** Node is new enough and `node:sqlite` still could not be loaded. */
  | "no_sqlite";

export interface HostRuntimeRefusal {
  problem: HostRuntimeProblem;
  /** Plain language, naming what was found and what to do. Reaches an operator's terminal. */
  detail: string;
}

/**
 * The floor, and it is a support claim rather than the earliest version that
 * might work.
 *
 * 24 is Node's current LTS, is what `.github/workflows/ci.yml` runs, and is the
 * line `node:sqlite` is unflagged on throughout. 22.5 is where the module first
 * appeared and is deliberately *not* the number here: a floor that admits a
 * release where the module needs a command-line flag would make the documented
 * start command wrong on a host that satisfies the floor, which is a worse
 * failure than refusing a runtime that would have worked.
 *
 * Nothing stops an operator running the artifact on an older Node that happens
 * to expose the module — `describeMissingSqlite` is what would actually stop
 * them, and it would not fire. This number is what DASH will answer questions
 * about.
 */
export const MINIMUM_HOST_NODE_MAJOR = 24;

/**
 * Parse the major version out of whatever `process.versions.node` said.
 *
 * Returns null rather than throwing or defaulting. A runtime whose version
 * string this cannot read is not one to guess about, and the caller's job is
 * then to try the module itself — which is a fact rather than an inference.
 */
export function nodeMajor(version: string): number | null {
  const match = /^v?(\d+)\./.exec(version.trim());
  if (match === null) {
    return null;
  }
  const major = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * Is this Node old enough to be the answer before anything else is tried?
 *
 * Null means "nothing to say from the version alone", which includes a version
 * string that did not parse. Saying nothing there is deliberate: the module
 * probe below is a stronger check than a regex on a string a non-Node runtime
 * chose for itself.
 */
export function checkNodeVersion(version: string): HostRuntimeRefusal | null {
  const major = nodeMajor(version);
  if (major === null || major >= MINIMUM_HOST_NODE_MAJOR) {
    return null;
  }
  return {
    problem: "node_too_old",
    detail:
      `This host runs Node ${version}, and the runner needs Node ` +
      `${String(MINIMUM_HOST_NODE_MAJOR)} or newer. The runner keeps its own database with the ` +
      `SQLite module built into Node itself, which older versions either do not have or keep ` +
      `behind a command-line flag. Install Node ${String(MINIMUM_HOST_NODE_MAJOR)} on this host ` +
      `and start the runner again.`,
  };
}

/**
 * The sentence for a Node that is new enough and still cannot open the store.
 *
 * Separate from the version check because it is a different fact and leads
 * somewhere different: the version case has a fix an operator can carry out,
 * and this one usually means the runtime is not the thing it claimed to be.
 * `lib/copy/recovery.ts` makes the same argument about credentials — two
 * conditions with two next actions are two conditions.
 */
export function describeMissingSqlite(version: string, reason: string): HostRuntimeRefusal {
  return {
    problem: "no_sqlite",
    detail:
      `This host runs Node ${version}, which reports that it has no built-in SQLite. ` +
      `The runner keeps its own database there and cannot start without it. ` +
      `Node ${String(MINIMUM_HOST_NODE_MAJOR)} or newer, from nodejs.org or this system's own ` +
      `packages, is what the runner is built against. The runtime said: ${reason}`,
  };
}

/**
 * The exit code for "this host cannot run the runner", as opposed to "the
 * runner tried and failed".
 *
 * 78 is `EX_CONFIG` from `sysexits.h`, which is what a deploy helper's `start`
 * verb can branch on without parsing English out of a log. `runner/main.ts`
 * exits 1 for its own failures and that distinction is the point: 1 means read
 * `runner.log`, 78 means fix the host.
 */
export const HOST_UNSUITABLE_EXIT = 78;

/**
 * Where a host keeps this runner's state when nobody said otherwise.
 *
 * Under the user's home rather than `/var/lib`, because the artifact installs
 * as an ordinary user and a path needing `sudo` would push the whole deploy up
 * a privilege level for no gain — the runner has no reason to run as root, and
 * ADR 0007's key custody says nothing that would justify one.
 *
 * It is a default and not a policy: `DASH_RUNNER_DATA_DIR` wins whenever it is
 * set, which is how a host with a data volume points at it.
 */
export function defaultDataDir(home: string = homedir()): string {
  return path.join(home, ".orchestratedash", "runner");
}
