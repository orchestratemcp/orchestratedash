/**
 * Setting an agent up again from the copy DASH already holds: the whole
 * decision, in one testable place (MAR-705).
 *
 * `electron/folder-repair.ts` opens the agent's folder, asks the person, writes
 * DASH's record and asks the supervisor to re-read its list. Everything that
 * *decides* anything happens here — is this still an agent, is there a program
 * to spawn, what exactly would be registered, and what is the person about to be
 * asked — so the paths that matter are covered by the suite that runs on every
 * push rather than by a local Electron run somebody has to remember to do.
 *
 * That split is `lib/folder-import.ts`'s and this deliberately reads like it,
 * because it is the same decision asked of a different folder.
 *
 * ## Why this is not `lib/folder-import.ts` pointed inwards
 *
 * It very nearly is, and the one difference is the whole reason the module
 * exists. `inspectChosenFolder` refuses a folder inside DASH's own keeping, and
 * says why:
 *
 * > Re-importing DASH's own folder from itself would stage a complete
 * > replacement and swap it in — the exact hazard `acceptFolderManifest` exists
 * > to avoid, which would take the agent's own reports and run history with it.
 *
 * That refusal is right and this module does not remove it. `writeAgentFolder`
 * builds a staging directory from exactly the files it is handed and renames it
 * over the old one, so re-importing a folder *from itself* deletes everything
 * the read skipped — a non-text file the agent wrote, an installed
 * `node_modules` — in exchange for rewriting bytes that are already identical,
 * because the folder was the source. There is no version of that trade worth
 * making.
 *
 * So this repairs the half that actually goes missing: **DASH's record.** The
 * row's manifest, the registration naming the program, the baseline MAR-584
 * compares against, and the supervisor's knowledge that the agent exists. The
 * folder is read and never written.
 *
 * ## What it is a repair *of*
 *
 * MAR-703's store restore is the case it was filed on, but the shape is older
 * than that incident: DASH's index is a SQLite store and its registrations are
 * files, and any of them can be rebuilt, restored, or lost without the folder
 * moving. Before this, the only way to put one back was `npm run open-in-dash`
 * from the agent's original project — a terminal command, against a folder the
 * person may no longer have, to reach a pipeline DASH was already holding every
 * ingredient for.
 *
 * ## What it deliberately cannot fix
 *
 * A broken program. Everything here reads the same folder the runner will spawn
 * from, so an agent whose code is wrong is wrong afterwards too. The door for
 * that is `folder.choose` — a fresh folder from outside — and this one must not
 * pretend to be it.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  AGENT_CODE_DIRECTORY,
  AGENT_MANIFEST_FILE,
  agentFolderCodePath,
  agentFolderManifestPath,
  readAgentFolderManifest,
  readStoredFileDigests,
} from "./agent-folders";
import { isManifestV2, validateManifest, type AnyAgentManifest } from "./contracts";
import { humanizeAgentName } from "./copy/agent-name";
import { REPAIR_AGENT_COPY } from "./copy/repair";
import {
  explainImportFailure,
  explainNoAgentInFolder,
  explainNotJson,
  type ImportFailureExplanation,
} from "./import-feedback";
import { startSentence, type HandoffPrompt, type RunnerPort } from "./handoff-flow";
import { checkManifestConstraints } from "./manifest-constraints";
import { AGENT_PROGRAM_FILE } from "./folder-import";
import {
  BUNDLED_NODE_COMMAND,
  readRegistration,
  writeRegistration,
  type AgentRegistration,
} from "./registration";
import { acceptFolderManifest, readAgentManifest } from "./store";
import type { FolderActionResult } from "./shell/ipc";

/** What the Electron half read out of the folder DASH already holds. */
export interface HeldFolderRead {
  /** The agent this folder belongs to, as DASH's own index names it. */
  agent: string;
  /**
   * `agent.manifest.json` from the folder root, or null when DASH cannot read
   * it.
   *
   * Null rather than an empty string, for `ChosenFolderRead`'s reason: "there is
   * no plan here" and "there is a plan here and it is empty" are different
   * faults with different sentences.
   */
  manifestJson: string | null;
  /**
   * Whether `code/agent.mjs` is in the folder.
   *
   * A boolean rather than the file list, because nothing here needs the bytes:
   * the question is only whether there is something to register, and the
   * registration names the path rather than carrying it. Handing this module a
   * folder listing would invite it to start deciding what to copy, which is the
   * one thing it must never do.
   */
  hasProgram: boolean;
}

/** What DASH would write, or why it will not. */
export type HeldFolderRepair =
  | {
      ok: true;
      agent: string;
      display_name: string;
      manifest: AnyAgentManifest;
      manifestJson: string;
      /**
       * The registration to write, or undefined for an agent DASH cannot start.
       *
       * Undefined leaves ADR 0008's manifest-only standing exactly as it is: the
       * record is still repaired, and DASH still says plainly that it has
       * nothing to run. Writing one anyway would produce a registration the
       * runner refuses at spawn, which is the after-the-press refusal every door
       * in this area is built to avoid.
       */
      registration: AgentRegistration | undefined;
      prompt: HandoffPrompt;
    }
  | {
      ok: false;
      refusal: "folder_unreadable" | "not_an_agent" | "different_agent";
      /** One sentence for the person, from `lib/copy/repair.ts` and nowhere else. */
      detail: string;
      /** The validator's own account, or null when no validator ran. */
      explanation: ImportFailureExplanation | null;
    };

/**
 * Decide what setting this agent up again would write, and what to ask first.
 *
 * The order is `inspectChosenFolder`'s and the argument is the same one: read,
 * validate, refuse anything the runner would refuse later, and only then compose
 * a question. Nothing here writes, and nothing that follows it may write before
 * the prompt has been answered.
 */
export function inspectHeldFolder(read: HeldFolderRead): HeldFolderRepair {
  if (read.manifestJson === null) {
    return {
      ok: false,
      refusal: "folder_unreadable",
      detail: REPAIR_AGENT_COPY.no_folder,
      explanation: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.manifestJson);
  } catch (error: unknown) {
    return {
      ok: false,
      refusal: "not_an_agent",
      detail: REPAIR_AGENT_COPY.plan_unreadable,
      explanation: explainNotJson(error instanceof Error ? error.message : String(error)),
    };
  }

  const validation = validateManifest(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      refusal: "not_an_agent",
      detail: REPAIR_AGENT_COPY.plan_refused,
      explanation: explainImportFailure(validation.errors),
    };
  }
  /*
   * Both gates, because both run at import.
   *
   * `readCurrentManifest`'s rule in `electron/folder-update.ts`, for the same
   * reason: a change that would be refused at the front door must not be
   * accepted through this one. A folder edited by hand since it was accepted is
   * the ordinary way to arrive here with a manifest that no longer passes.
   */
  const contradictions = checkManifestConstraints(validation.value);
  if (contradictions.length > 0) {
    return {
      ok: false,
      refusal: "not_an_agent",
      detail: REPAIR_AGENT_COPY.plan_refused,
      explanation: explainImportFailure(contradictions),
    };
  }

  const manifest = validation.value;
  /*
   * `acceptFolderManifest`'s check, made before the person is asked rather than
   * after they agree.
   *
   * A folder whose plan now names a different agent is a different agent, and
   * repairing this one from it would file somebody else's program under this
   * one's identity, history and connected accounts. The store refuses it too —
   * this is here so the refusal arrives before the dialog rather than after it.
   */
  if (manifest.agent.name !== read.agent) {
    return {
      ok: false,
      refusal: "different_agent",
      detail: REPAIR_AGENT_COPY.different_agent,
      explanation: null,
    };
  }

  /*
   * MAR-595 finding 10, at this door too: `display_name` is optional in the
   * schema and absent from the validated type, so it is read off the parsed
   * document and humanised when missing rather than shown as the raw slug.
   */
  const declaredName = (parsed as { agent?: { display_name?: unknown } }).agent?.display_name;
  const display_name =
    typeof declaredName === "string" && declaredName.length > 0
      ? declaredName
      : humanizeAgentName(read.agent);

  /*
   * A program, or honestly none — `inspectChosenFolder`'s pair of conditions,
   * unchanged.
   *
   * v1 is deliberately never startable: `runner/README.md` requires v2 before
   * spawning anything, so registering a v1 agent would write a registration the
   * runner refuses. The paths are the stored layout's own and are named rather
   * than discovered, because this module reads nothing.
   */
  const startable = read.hasProgram && isManifestV2(manifest);
  const registration: AgentRegistration | undefined = startable
    ? {
        agent_id: read.agent,
        manifest_path: AGENT_MANIFEST_FILE,
        // The bundled interpreter rather than `node`, and this is the whole
        // reason a novice can press this button: the person it is for installed
        // DASH from the Store and has never installed anything else. See
        // `BUNDLED_NODE_COMMAND`.
        command: BUNDLED_NODE_COMMAND,
        args: [AGENT_PROGRAM_FILE],
        cwd: AGENT_CODE_DIRECTORY,
      }
    : undefined;

  return {
    ok: true,
    agent: read.agent,
    display_name,
    manifest,
    manifestJson: read.manifestJson,
    registration,
    prompt: describeRepair({ display_name, registration }),
  };
}

/**
 * The consent question, for a folder DASH already holds.
 *
 * ## Why it is here and not in `lib/copy/repair.ts`
 *
 * `describeChosenFolder`'s placement relative to `inspectChosenFolder`, and here
 * it is load-bearing rather than merely consistent: this calls `startSentence`,
 * which lives in `lib/handoff-flow.ts`, which reaches `node:fs`. The copy module
 * is imported by a `"use client"` component, so a value imported from there
 * would pull a Node builtin into the browser bundle — `tests/client-bundle` is
 * the gate, and it caught exactly that. What a renderer can read stays in
 * `lib/copy/`; what only main composes stays beside main's decision.
 *
 * ## Why there is a dialog at all
 *
 * `chooseAgentFolder`'s guarantee is that nothing is written before a person has
 * been told what will be written, and this door keeps it rather than claiming an
 * exemption for being smaller. What it writes is less than an import — no folder
 * moves — but it does change what DASH will spawn, and a control that silently
 * re-pointed the thing that starts a program would be the one place in this
 * product where that happened without asking.
 *
 * ## Why it is shorter than `describeChosenFolder`'s
 *
 * Because the questions that dialog answers are already answered here. There is
 * no folder to name, since the person is not choosing one; no copy to warn
 * about, since nothing is copied; and no connections or permissions to disclose,
 * since this agent's are the ones it already had — the manifest being read is
 * the one DASH is already showing on the page behind the dialog. Repeating them
 * would turn a repair into a re-consent to an agent nobody is adding.
 *
 * What stays is what is genuinely changing: the program DASH would start, named
 * by `startSentence` for its own reason — a dialog that asks permission to run
 * something while declining to say what would be worse than the jargon it was
 * avoiding.
 */
export function describeRepair(input: {
  display_name: string;
  registration: AgentRegistration | undefined;
}): HandoffPrompt {
  // Bound to a const so the narrowing survives into `startSentence`: a parameter
  // is a mutable binding, and TypeScript will not carry a null check on one
  // across the array literal. `describeChosenFolder`'s note, same cause.
  const program = input.registration;

  return {
    title: "Set this agent up again?",
    message: `Set “${input.display_name}” up again from the copy DASH already keeps?`,
    detail: [
      ...(program === undefined
        ? [
            "DASH will bring its details up to date. There is no program in its folder that DASH can run, so this will not make it startable.",
          ]
        : [
            startSentence(program),
            "DASH will bring its details up to date and set it up to run again.",
          ]),
      "",
      "Its folder is only read, never changed. Everything it has produced, its character and any connected accounts are kept.",
    ].join("\n"),
    confirm_label: "Set it up again",
    cancel_label: "Not now",
  };
}

/* ---------------------------------------------------------------------- *
 * Performing it
 * ---------------------------------------------------------------------- */

/**
 * Everything this flow needs from the world that is not a file, injected.
 *
 * `lib/handoff-flow.ts`'s `HandoffPorts`, cut down to what this door actually
 * reaches. The reads and writes are not ports because they are DASH's own store
 * and DASH's own folder, which a test points somewhere else with
 * `DASH_DATA_DIR` — the same way every other store test does. What has to be
 * injected is the two things a test cannot have: a person, and a runner.
 */
export interface RepairPorts {
  /** DASH's data directory — the resolved one, never a computed convention. */
  dataDir: string;
  now(): Date;
  /**
   * Ask the person. Nothing above this returning true may write.
   *
   * A port rather than a call into Electron, which is what lets every branch
   * below run in the suite on every push instead of behind a native dialog
   * somebody has to press on one developer's Windows box.
   */
  confirm(prompt: HandoffPrompt): Promise<boolean>;
  /** Null on a machine where DASH could not start a runner. */
  runner: Pick<RunnerPort, "reload"> | null;
}

/**
 * Set one agent up again from the copy DASH already keeps.
 *
 * ## The order, which is the safety argument
 *
 * 1. **Read** the plan DASH holds, and look for a program. Nothing written.
 * 2. **Decide** — `inspectHeldFolder`. Still nothing written.
 * 3. **Ask the person**, naming what will run and promising the folder is only
 *    read.
 * 4. Only then write DASH's record, and only then ask the supervisor to re-read
 *    its list.
 *
 * There is no branch here that writes without step 3 returning true, which is
 * the guarantee `openHandoff` and `chooseAgentFolder` both state about their own
 * consent gates.
 */
export async function repairHeldAgent(
  agent: string,
  ports: RepairPorts,
): Promise<FolderActionResult> {
  /*
   * DASH's index first.
   *
   * `acceptFolderManifest` refuses an agent with no row too, but it does so
   * *after* the dialog — and somebody who agreed to a repair and was then told
   * the agent does not exist has been asked a question for nothing.
   */
  if (readAgentManifest(agent) === null) {
    return {
      ok: false,
      refusal: "unknown_agent",
      detail: "DASH has no saved setup for that agent.",
    };
  }

  const read = readAgentFolderManifest(ports.dataDir, agent);
  const decision = inspectHeldFolder({
    agent,
    manifestJson: read.ok ? read.json : null,
    // Resolved from the agent id, never from anything a caller said. The stored
    // layout puts the program at a path DASH itself chose, so this asks whether
    // the one file the registration would name is actually there.
    hasProgram: existsSync(
      path.join(agentFolderCodePath(ports.dataDir, agent), AGENT_PROGRAM_FILE),
    ),
  });

  if (!decision.ok) {
    return {
      ok: false,
      refusal: decision.refusal === "folder_unreadable" ? "folder_unreadable" : "refused_at_import",
      detail: decision.detail,
    };
  }

  if (!(await ports.confirm(decision.prompt))) {
    /*
     * Declined, and deliberately silent — `chooseAgentFolder`'s rule. Somebody
     * who opened a question and closed it again has not failed at anything, and
     * a notice saying so would be DASH reporting on a decision already theirs.
     */
    return { ok: false, refusal: "cancelled" };
  }

  /*
   * The row first, because it is the one write that can still refuse.
   *
   * `acceptFolderManifest` re-runs the schema, the constraints and the identity
   * check inside a transaction — everything just decided, at the moment of
   * writing. Reaching a refusal here means the folder changed between the
   * decision and the press, and stopping before the registration is written is
   * what keeps DASH's two records of one agent from disagreeing.
   */
  if (!acceptFolderManifest(agent, decision.manifestJson).ok) {
    return { ok: false, refusal: "refused_at_import", detail: REPAIR_AGENT_COPY.plan_refused };
  }

  if (!writeRepairedRegistration(agent, decision, ports)) {
    // The plan is repaired and there is nothing to start. ADR 0008's
    // manifest-only standing, reported as itself rather than as a success.
    return { ok: true, detail: REPAIR_AGENT_COPY.repaired_cannot_start };
  }

  /*
   * The re-read, and why its failure is not one.
   *
   * `chooseAgentFolder`'s argument, unchanged: a runner that cannot be reached
   * right now changes nothing about what was just written — the registration is
   * on disk and the next DASH open reads it — so an unreachable runner degrades
   * the *claim* rather than the repair. The two receipts are the two true
   * sentences, and that is the whole reason there are two.
   */
  const reloaded = ports.runner !== null && (await ports.runner.reload()).ok;
  return {
    ok: true,
    detail: reloaded ? REPAIR_AGENT_COPY.repaired : REPAIR_AGENT_COPY.repaired_next_open,
  };
}

/**
 * Write the registration this repair decided on, and report whether there is one.
 *
 * ## Whose registration this is
 *
 * DASH's, unless somebody wrote one by hand. `ownershipOf` reads a registration
 * with no `dash` block as `external`, which means exactly *somebody put this
 * here and DASH must leave it alone* — and the hand-written four-field
 * registration `runner/README.md` documents is a supported way to host an agent.
 * Overwriting one with `BUNDLED_NODE_COMMAND` and DASH's own paths would be this
 * button quietly taking ownership of a program somebody else set up, which is
 * not a repair of anything.
 *
 * So an external registration keeps its command, its arguments, its working
 * directory and its environment, and what the repair refreshes is the plan
 * beside it. DASH's own registration is rewritten in full, which is the point:
 * the stale or missing one is the thing being fixed.
 *
 * ## Why the baseline is preserved rather than recomputed
 *
 * `readStoredFileDigests` re-reads exactly the files DASH recorded and never
 * walks, because an agent writes its own reports into the folder it runs in and
 * a walk would record those as bytes DASH accepted. That rule holds here: this
 * command accepts a *plan*, not a new set of files, so it must not claim a
 * baseline it was never handed. An existing list is re-read and moved forward —
 * `moveBaseline`'s behaviour, for `folder.adopt`'s reason — and where there is
 * no list there is still no list, which `lib/folder-changes.ts` has its own
 * honest answer for.
 */
function writeRepairedRegistration(
  agent: string,
  decision: Extract<HeldFolderRepair, { ok: true }>,
  ports: RepairPorts,
): boolean {
  const { dataDir } = ports;
  const existing = readRegistration(dataDir, agent);
  const external = existing !== null && existing.dash.owner === "external";
  const program =
    external && existing !== null
      ? {
          agent_id: agent,
          manifest_path: existing.manifest_path,
          command: existing.command,
          args: existing.args,
          cwd: existing.cwd,
          env: existing.env,
        }
      : decision.registration === undefined
        ? undefined
        : {
            agent_id: agent,
            manifest_path: agentFolderManifestPath(dataDir, agent),
            command: decision.registration.command,
            args: decision.registration.args,
            cwd: agentFolderCodePath(dataDir, agent),
            env: decision.registration.env,
          };

  if (program === undefined) {
    return false;
  }

  const previous = existing?.dash.accepted_files;
  const baseline =
    previous === undefined
      ? undefined
      : readStoredFileDigests(
          dataDir,
          agent,
          previous.map((file) => file.path),
        )
          .filter((reading): reading is { path: string; sha256: string } => reading.sha256 !== null)
          .map((reading) => ({ path: reading.path, sha256: reading.sha256 }));

  writeRegistration(dataDir, {
    registration: program,
    ownership: {
      /*
       * Preserved where there was a registration, minted where there was not.
       *
       * `registered_at` is the day this agent was added and stays it — a repair
       * is not a new arrival, and rewriting the date would erase the one fact
       * the cleanup report uses to describe an agent's history. The same
       * argument `acceptFolderManifest` makes about leaving `imported_at` alone.
       */
      owner: existing?.dash.owner ?? "dash_handoff",
      handoff_id: existing?.dash.handoff_id,
      source_project: existing?.dash.source_project,
      display_name: existing?.dash.display_name ?? decision.display_name,
      summary: existing?.dash.summary ?? decision.manifest.agent.goal,
      registered_at: existing?.dash.registered_at ?? ports.now().toISOString(),
    },
    manifestJson: decision.manifestJson,
    // The folder's own file, which is where it already was. Named rather than
    // left to default, so this never falls back to the pre-ADR 0008 managed
    // manifest location and starts a second document — `moveBaseline`'s note.
    storedManifestPath: agentFolderManifestPath(dataDir, agent),
    filesDigest: existing?.dash.files_sha256,
    acceptedFiles: baseline,
    acceptedSources: existing?.dash.accepted_sources,
  });
  return true;
}
