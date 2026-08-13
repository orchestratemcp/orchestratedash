/**
 * Bringing an agent home, wired to a real server (MAR-611, ADR 0017).
 *
 * `lib/deploy/bring-home.ts` owns the order and every refusal in it, and has no
 * `ssh` in it on purpose. This file supplies the steps: four deploy verbs, one
 * control-plane channel, a save dialog, and the two store writes that record
 * what DASH did. It is a file of its own for `electron/host-run.ts`'s reason —
 * every gate belongs beside the call it guards, and main holds the seam rather
 * than the argument.
 *
 * ## The shape of one press
 *
 * ```
 *   channel verb   ─ the credential the host's runner is using
 *   pull evidence  ─ what it did, and which files it is holding
 *   download × n   ─ those files' bytes, one `ssh` each
 *   save           ─ into a folder the person picks
 *   stop           ─ through the runner's own authenticated route
 *   uninstall      ─ the bundle, and the store inside it
 * ```
 *
 * Six or more `ssh` children, because ADR 0007 spawns one connection per request
 * and declined a pool. This is the slowest thing DASH does to a host and it is
 * also the one thing nobody does twice a day.
 *
 * ## The credential promise, unchanged
 *
 * `electron/host-run.ts` states it and this file keeps it identically:
 * **DASH asks for the credential, spends it, and drops it.** No vault entry, no
 * module-level cache, nothing returned from here that could carry it —
 * `HostActionResult` has no member it would fit in. A bring-home fetches it once
 * and holds it for the length of the sequence, which is longer than a run press
 * and still one function's stack frame.
 *
 * ## What this file writes down, and what it refuses to
 *
 * Two store writes, both after the removal succeeded and both about **DASH's own
 * act**: the deploy row gains the date DASH took the agent back, and the outputs
 * that were on that machine are marked as having come home. Neither is a claim
 * about the server's present state, which is ADR 0010's bound and ADR 0015's,
 * unchanged.
 *
 * What it will not do is delete anything on this computer. The agent, its
 * folder, its runs and its outputs all stay, because *stop hosting this* and
 * *destroy this* are the two decisions Henrik asked to keep apart.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { writeFileSync } from "node:fs";

import { dialog } from "electron";

import { fetchArtifacts } from "../lib/agent-dom/artifact-bytes";
import { pullEvidence } from "../lib/agent-dom/evidence";
import type { RemoteRunnerChannel } from "../lib/agent-dom/runner-channel";
import { describeBringHomeOutcome } from "../lib/copy/bring-home";
import {
  bringAgentHome,
  type BringHomeSteps,
  type BroughtHomeFile,
  type ChannelAttempt,
  type SaveOutcome,
} from "../lib/deploy/bring-home";
import { checkDeployRequest } from "../lib/deploy/verbs";
import type { HostRecord } from "../lib/hosts";
import type { HostActionResult } from "../lib/shell/ipc";
import {
  markArtifactsBroughtHome,
  recordAgentBroughtHome,
  recordEvidencePull,
} from "../lib/store";
import { inspectComponent } from "../runner/path-guard";
import { appWindow } from "./app-window";
import {
  runDeployVerb,
  sshDeploySpawn,
  sshHostChannel,
  type SshDiagnostics,
} from "./ssh-host";

/**
 * Take one agent off one server, having copied what it has.
 *
 * `agentIsHere` is passed in rather than read here, because whether DASH holds
 * an agent is a question about the handoff context main already owns — and the
 * refusal it produces is the one this feature deliberately does not solve. A
 * host may name a bundle DASH never sent (ADR 0015 permits exactly that
 * sentence), and reconstructing an agent DASH does not have out of a server's
 * files is a different feature with a different verb.
 */
export async function bringAgentHomeFromHost(
  record: HostRecord,
  agentId: string,
  dataDir: string,
  agentIsHere: boolean,
  log: (line: string) => void = (line) => {
    console.warn(line);
  },
): Promise<HostActionResult> {
  const checked = checkDeployRequest({ verb: "uninstall", bundle_id: agentId });
  if (!checked.ok) {
    return {
      ok: false,
      detail: "This agent's name is not one DASH can address on a server, so it was never put there.",
    };
  }
  if (!agentIsHere) {
    return {
      ok: false,
      detail:
        `DASH does not have this agent on this computer, so there is nowhere to bring it home to. ` +
        `It can still be removed from ${record.label} on the server itself.`,
    };
  }

  // Collected by `openSshChannel` and never rendered: its text names this
  // machine's key location. One object for the whole sequence, so a failure at
  // any step is classified the same way every other host action's is.
  const diagnostics: SshDiagnostics = { stderr: "" };
  const spawn = (): ReturnType<typeof sshDeploySpawn> =>
    sshDeploySpawn(record, dataDir, diagnostics);

  /*
   * The channel, opened fresh on every attempt.
   *
   * Deliberately not built once and reused across the retry: a runner that has
   * just been started mints its credential a moment after it has a pid, so the
   * *value* is what the retry is waiting for. Holding the first answer and
   * re-dialling with it would retry the transport and never the thing that was
   * actually missing.
   */
  const openChannel = async (): Promise<ChannelAttempt> => {
    let answered;
    try {
      answered = await runDeployVerb(spawn(), { verb: "channel", bundle_id: agentId });
    } catch {
      // `assertHostKeyProtected` and `hardenOwnerOnly` both throw with messages
      // that can name a local path. The renderer gets the fact, never the
      // diagnostic — `hostAction`'s rule, kept rather than relaxed.
      return {
        ok: false,
        problem: "key_unavailable",
        detail: "DASH could not prepare the key for this server.",
      };
    }
    if (!answered.ok) {
      return { ok: false, problem: answered.problem, detail: answered.detail };
    }
    if (answered.verb !== "channel") {
      return {
        ok: false,
        problem: "unreadable_answer",
        detail: "The server did not answer the request DASH sent.",
      };
    }
    try {
      return {
        ok: true,
        channel: sshHostChannel({ record, dataDir, bundle_id: agentId, token: answered.token }),
      };
    } catch {
      return {
        ok: false,
        problem: "key_unavailable",
        detail: "DASH could not prepare the key for this server.",
      };
    }
  };

  const steps: BringHomeSteps = {
    connect: openChannel,
    start: () => runDeployVerb(spawn(), { verb: "start", bundle_id: agentId }),
    stop: () => runDeployVerb(spawn(), { verb: "stop", bundle_id: agentId }),
    uninstall: () => runDeployVerb(spawn(), { verb: "uninstall", bundle_id: agentId }),
    pull: (channel: RemoteRunnerChannel) =>
      pullEvidence(channel, { source: record.host_id, kind: "another_machine", log }),
    fetch: fetchArtifacts,
    save: (files) => saveBroughtHomeFiles(files, record.label),
    wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };

  const outcome = await bringAgentHome(agentId, steps);
  const detail = describeBringHomeOutcome(outcome, record.label);

  if (!outcome.ok) {
    return { ok: false, detail };
  }

  /*
   * The pull is written down whether or not it found anything, for the reason
   * `electron/host-run.ts` gives: *"when DASH last looked" is half the sentence
   * the Runs page carries, and it is only true if it is written when the answer
   * is boring.* It is written **after** the sequence rather than inside it,
   * because a bring-home that got as far as looking and then refused to remove
   * anything has still looked — and the pull is a record of the looking.
   */
  try {
    recordEvidencePull(outcome.pull);
    recordAgentBroughtHome(agentId, record.host_id);
    if (outcome.brought_home.length > 0) {
      markArtifactsBroughtHome(
        outcome.brought_home,
        outcome.saved_where === null
          ? `DASH copied this off ${record.label} and removed the server's copy.`
          : `DASH saved this to ${outcome.saved_where} and removed the copy on ${record.label}.`,
      );
    }
  } catch {
    // `pullLocalEvidence` swallows this for the same reason: the store being
    // unwritable is already reported by everything else that touches it, and the
    // act on the server has already happened. Losing the record of it is bad;
    // reporting the act as failed when the agent really is off the server would
    // be worse, because the person's next move would be to press again.
    log("[dash-shell] an agent came home and DASH could not write down that it had");
  }

  return {
    ok: true,
    action: "bringHome",
    host_id: record.host_id,
    label: record.label,
    agent_id: agentId,
    files_saved: outcome.files_saved,
    detail,
  };
}

/* ---------------------------------------------------------------------- *
 * Where the files land
 * ---------------------------------------------------------------------- */

/**
 * Ask once where the outputs should go, then write them there.
 *
 * ## One folder, not one dialog per file
 *
 * `workspaceDownload` asks per file because a person is saving one file they
 * chose. Here DASH is saving everything an agent left on a server, on one press,
 * and a dialog per file would turn a bring-home of twelve outputs into twelve
 * decisions about a question that was already answered.
 *
 * ## The name a server chose is not a name this computer will use
 *
 * `display_name` is what an agent on a machine DASH does not administer decided
 * to call its file. It reaches this function as a string, and it is about to
 * become a path on the user's own disk — so it goes through `inspectComponent`,
 * the guard MAR-434 wrote for exactly this class of value, and anything it
 * refuses is written under the artifact's own opaque id instead. `..`, a colon
 * opening an alternate data stream, a trailing dot Windows silently strips, a
 * reserved device name: each is a property of one component, and the component
 * here is the whole name because a `basename` is taken first.
 *
 * A collision within one batch gets a numbered suffix rather than being
 * overwritten. Two outputs called the same thing is an ordinary way for an agent
 * to behave, and silently keeping the last one would lose a file in the middle
 * of an operation whose entire purpose is not to.
 */
async function saveBroughtHomeFiles(
  files: readonly BroughtHomeFile[],
  label: string,
): Promise<SaveOutcome> {
  const window = appWindow();
  const options = {
    title: `Where should this agent's files from ${label} go?`,
    buttonLabel: "Save here",
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
  };
  const chosen =
    window === null
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options);

  const folder = chosen.filePaths[0];
  if (chosen.canceled || folder === undefined || folder === "") {
    // The person answered the question, and the answer was no. Not a failure —
    // `workspaceDownload` treats a cancelled save the same way — but here it
    // stops the removal, because there is nowhere for the files to go.
    return { ok: false, cancelled: true };
  }

  const used = new Set<string>();
  try {
    for (const file of files) {
      writeFileSync(path.join(folder, uniqueName(file, used)), file.bytes);
    }
  } catch (error: unknown) {
    return {
      ok: false,
      cancelled: false,
      detail: `DASH could not write them there: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
  return { ok: true, saved: files.length, where: folder };
}

/** A safe, unused name for one file, and the reason for each half is above. */
function uniqueName(file: BroughtHomeFile, used: Set<string>): string {
  const proposed = path.basename(file.display_name);
  const safe = proposed.length > 0 && inspectComponent(proposed) === null ? proposed : fallback(file);

  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const extension = path.extname(safe);
  const stem = safe.slice(0, safe.length - extension.length);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${String(n)})${extension}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/**
 * A name derived from the artifact's own id, for a `display_name` that could not
 * be one.
 *
 * Hashed rather than used directly, because an artifact id is opaque to DASH and
 * nothing guarantees *its* alphabet is one a filesystem accepts either — the ids
 * in this store are minted by runners, and a value DASH did not choose is a
 * value DASH should not assume the shape of twice in a row.
 */
function fallback(file: BroughtHomeFile): string {
  return `output-${createHash("sha256").update(file.artifact_id).digest("hex").slice(0, 12)}`;
}
