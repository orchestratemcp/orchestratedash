/**
 * Handing DASH the import, and never performing it (MAR-862, ADR 0032
 * decision 2).
 *
 * This does not invent a fourth door. It writes `dash-handoff.json` and opens
 * the `dash://handoff` URL — the document `lib/handoff.ts` defines, built by
 * `lib/handoff.ts`'s own `buildHandoff`, with a nonce minted per install. The
 * URL ends where every other import ends: at `importManifest`, behind the
 * consent dialog.
 *
 * **The tool cannot install an agent.** It can only put a proposal in front of
 * the person, who is asked, in DASH's words, before anything is stored. A tool
 * built to make a coding agent's output land reliably must not also make it
 * land unasked.
 *
 * ## Why the file list is walked rather than declared
 *
 * The Agent Kit's own `open-in-dash` carries a fixed list of seven paths. That
 * is correct for a project the kit wrote and never correct for one somebody has
 * edited since: a file added after the scaffold is a file the fixed list drops
 * silently, and the agent DASH stores is missing a module it imports. This
 * scaffold has a file the kit's list does not name — `brief-fingerprint.mjs` —
 * so a fixed list here would ship an agent that crashes on its first line.
 *
 * Walking is bounded by the same ceilings `lib/handoff.ts` enforces, and skips
 * the same directories `lib/folder-import.ts` skips for a chosen folder, plus
 * the two directories a run writes into. An agent's own output is not part of
 * the agent.
 */

import { openSync, closeSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

import {
  HANDOFF_FILE_NAME,
  HANDOFF_TTL_MS,
  MAX_HANDOFF_FILES,
  MAX_HANDOFF_FILE_BYTES,
  buildHandoff,
  handoffUrl,
  type AgentHandoff,
  type HandoffFile,
} from "../../../lib/handoff";
import { isSkippedFolderEntry } from "../../../lib/folder-import";
import { humanizeAgentName } from "../../../lib/copy/agent-name";

/**
 * What a run writes, which is never part of the agent.
 *
 * `lib/folder-import.ts` skips build output and dependency trees; these two are
 * this template's equivalent. Copying them would put one machine's history into
 * DASH's stored copy and would grow without bound across re-imports.
 */
const SKIPPED_OUTPUT_DIRECTORIES = new Set(["reports", "runs"]);

export type HandoffOutcome =
  | { ok: true; file: string; url: string; handoff: AgentHandoff }
  | { ok: false; problem: string };

/**
 * Every file DASH should be offered, project-relative with forward slashes.
 *
 * Text only, read as UTF-8. The folder store holds text, so a compiled artifact
 * or an image in somebody's project is left behind rather than copied
 * corrupted — the same decision `ChosenFolderRead.skipped` exists to report.
 */
export function projectFiles(projectDir: string): readonly HandoffFile[] {
  const files: HandoffFile[] = [];
  let bytes = 0;

  const walk = (directory: string, prefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory).sort();
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_HANDOFF_FILES) {
        return;
      }
      if (entry === HANDOFF_FILE_NAME || isSkippedFolderEntry(entry)) {
        continue;
      }
      if (prefix === "" && SKIPPED_OUTPUT_DIRECTORIES.has(entry)) {
        continue;
      }

      const absolute = path.join(directory, entry);
      const relative = prefix === "" ? entry : `${prefix}/${entry}`;

      let stats;
      try {
        stats = statSync(absolute);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        walk(absolute, relative);
        continue;
      }
      if (!stats.isFile()) {
        continue;
      }

      let contents: string;
      try {
        contents = readFileSync(absolute, "utf8");
      } catch {
        continue;
      }
      // A file that does not survive a UTF-8 round trip is not text: Node
      // substitutes U+FFFD for every byte it could not decode, so a file
      // carrying one was not text to begin with. A silently mangled copy is
      // worse than an absent one, so it is left behind.
      if (contents.includes("\uFFFD")) {
        continue;
      }

      const size = Buffer.byteLength(contents, "utf8");
      if (bytes + size > MAX_HANDOFF_FILE_BYTES) {
        continue;
      }
      bytes += size;
      files.push({ path: relative, contents });
    }
  };

  walk(projectDir, "");
  return files;
}

/**
 * Write the handoff for a project and return the URL that opens it.
 *
 * Writes nothing on a refusal, which is the property `dash_agent_install`
 * depends on: an agent that would not import leaves no half-made proposal
 * behind for somebody to open later and be confused by.
 */
export function writeHandoff(projectDir: string, now: Date = new Date()): HandoffOutcome {
  const manifestPath = path.join(projectDir, "agent.manifest.json");

  let manifestJson: string;
  let manifest: { agent?: { name?: unknown; display_name?: unknown; goal?: unknown } };
  try {
    manifestJson = readFileSync(manifestPath, "utf8");
    manifest = JSON.parse(manifestJson) as typeof manifest;
  } catch {
    return {
      ok: false,
      problem:
        `There is no agent in ${projectDir}. It needs an agent.manifest.json at its root — ` +
        "run dash_agent_scaffold to make one.",
    };
  }

  const agentId = manifest.agent?.name;
  if (typeof agentId !== "string" || agentId.length === 0) {
    return { ok: false, problem: "This agent has no name, so DASH would have nothing to call it." };
  }

  const files = projectFiles(projectDir);
  if (!files.some((file) => file.path === "agent.manifest.json")) {
    return {
      ok: false,
      problem: "The manifest could not be read as text, so DASH cannot be offered a copy of it.",
    };
  }

  const built = buildHandoff(
    {
      agent_id: agentId,
      // Never the raw slug. A manifest with no `display_name` must not hand
      // DASH an id to store and show verbatim as this agent's name.
      display_name:
        typeof manifest.agent?.display_name === "string" && manifest.agent.display_name.length > 0
          ? manifest.agent.display_name
          : humanizeAgentName(agentId),
      summary: typeof manifest.agent?.goal === "string" ? manifest.agent.goal : "No description given.",
      project_dir: projectDir,
      manifest_path: manifestPath,
      // `node` rather than `process.execPath`. The path of the Node running
      // this is pinned to one install, and an agent registered against it stops
      // starting the day that install is upgraded or removed. The name is
      // resolved against PATH at spawn time, which is what a person means when
      // they say "run it with node".
      command: "node",
      args: ["agent.mjs"],
      env: {},
      files: [...files],
      produced_by: "dash-mcp",
    },
    {
      handoff_id: randomBytes(16).toString("hex"),
      /**
       * Proof of possession, minted fresh every time. Presenting it proves the
       * opener could read this file, which is exactly the capability a web page
       * that guessed the project path does not have. It authorises nothing
       * beyond "show the user this proposal" — DASH still asks.
       */
      nonce: randomBytes(32).toString("hex"),
    },
    now,
    HANDOFF_TTL_MS,
  );

  if (!built.ok) {
    return { ok: false, problem: built.detail };
  }

  const file = path.join(projectDir, HANDOFF_FILE_NAME);
  try {
    writeFileSync(file, `${JSON.stringify(built.value, null, 2)}\n`, {
      encoding: "utf8",
      // 0600. The nonce in here is a capability, and a world-readable one is a
      // capability anybody on the machine can spend.
      mode: 0o600,
    });
  } catch (error) {
    return { ok: false, problem: `Could not write the handoff file: ${String(error)}` };
  }

  return { ok: true, file, url: handoffUrl(file, built.value.nonce), handoff: built.value };
}

/** How long a written handoff stays openable, in minutes. */
export function handoffMinutes(): number {
  return Math.round(HANDOFF_TTL_MS / 60_000);
}

function openCommand(url: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

/**
 * Ask the operating system to open the handoff.
 *
 * Detached and unreferenced, and failures are swallowed: DASH not being
 * installed is a thing to say in words, not an exception to throw at a caller
 * who already has the URL and can be told to open it themselves.
 */
export function openUrl(url: string, platform: NodeJS.Platform = process.platform): void {
  const { command, args } = openCommand(url, platform);
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Deliberately silent. The caller reports the URL either way.
  }
}

/** True when a path exists and is a readable file. Used for the pre-flight report. */
export function fileExists(candidate: string): boolean {
  try {
    const handle = openSync(candidate, "r");
    closeSync(handle);
    return true;
  } catch {
    return false;
  }
}
