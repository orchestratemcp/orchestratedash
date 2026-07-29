/**
 * "Open in DASH", from inside an agent's own folder.
 *
 * Bundled to `agent-kit/dist/open-in-dash.mjs` and **copied into every scaffold**
 * as `scripts/open-in-dash.mjs`. It is bundled rather than templated so that the
 * handoff a project writes and the handoff DASH reads come from one compilation
 * of `lib/handoff.ts` — the producer and the consumer literally cannot disagree
 * about the shape, which is the property a hand-copied template would lose on
 * its first edit.
 *
 * ## What it does not do
 *
 * It does not talk to DASH, does not write into DASH's data directory, and does
 * not register anything. It writes one file in the user's own project and asks
 * the operating system to open a link. Every decision after that belongs to
 * DASH and, ultimately, to the person looking at the consent dialog.
 *
 * Not writing into DASH's data directory is a packaging constraint, not
 * fastidiousness. `docs/msix-lifecycle-evidence.md` measured it: a
 * package-activated MSIX app's AppData is transparently redirected to
 * `%LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming\...`, so this process —
 * which is emphatically not inside that package — would write to a path the
 * installed DASH cannot see. A handoff in the user's own project is visible to
 * both, which is why the link points at one.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  HANDOFF_FILE_NAME,
  HANDOFF_TTL_MS,
  buildHandoff,
  handoffUrl,
  type AgentHandoff,
} from "../lib/handoff";

export interface HandoffWriteResult {
  file: string;
  url: string;
  handoff: AgentHandoff;
}

/**
 * Compose and write the handoff for the project in `projectDir`.
 *
 * Exported and pure of process concerns so `tests/agent-kit.test.ts` can drive
 * it against a real scaffold on disk and check the document DASH would read.
 */
export function writeHandoff(
  projectDir: string,
  kitVersion: string,
  now: Date = new Date(),
): { ok: true; value: HandoffWriteResult } | { ok: false; problem: string } {
  const manifestPath = path.join(projectDir, "agent.manifest.json");

  let manifest: {
    agent?: { name?: unknown; display_name?: unknown; goal?: unknown };
  };
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
  } catch {
    return {
      ok: false,
      problem:
        "There is no agent here. Run this from the folder create-dash-agent made, or create one first.",
    };
  }

  const agentId = manifest.agent?.name;
  if (typeof agentId !== "string" || agentId.length === 0) {
    return { ok: false, problem: "This agent has no name, so DASH would have nothing to call it." };
  }

  const built = buildHandoff(
    {
      agent_id: agentId,
      display_name:
        typeof manifest.agent?.display_name === "string" ? manifest.agent.display_name : agentId,
      summary:
        typeof manifest.agent?.goal === "string" ? manifest.agent.goal : "No description given.",
      project_dir: projectDir,
      manifest_path: manifestPath,
      // `node` rather than `process.execPath`. The path of the Node that
      // happens to be running this script is pinned to one install, and an
      // agent registered against it stops starting the day that install is
      // upgraded or removed. The name is resolved against PATH at spawn time,
      // which is what a person means when they say "run it with node".
      command: "node",
      args: ["agent.mjs"],
      produced_by: `create-dash-agent ${kitVersion}`,
    },
    {
      handoff_id: randomBytes(16).toString("hex"),
      /**
       * Proof of possession, minted fresh every time.
       *
       * Presenting it proves the opener could read this file, which is exactly
       * the capability a web page that guessed the project path does not have.
       * It authorises nothing beyond "show the user this proposal" — DASH still
       * asks — so it is a capability handle rather than a credential, which is
       * why it may travel in a URL at all.
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
  // 0600 where it means something. The handoff carries no credential — that is
  // enforced in `lib/handoff.ts` — but the nonce is the thing another local user
  // would need in order to put a proposal in front of this one, and there is no
  // reason to let them read it.
  writeFileSync(file, `${JSON.stringify(built.value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  return { ok: true, value: { file, url: handoffUrl(file, built.value.nonce), handoff: built.value } };
}

/**
 * Ask the operating system to follow the link.
 *
 * Detached and with its output discarded: the opener is not this process's
 * child in any meaningful sense, and on Windows `start` returns immediately
 * while the app it launched is still coming up.
 */
export function openUrl(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? // `start` is a cmd builtin, so it needs cmd. The empty string is the
        // window title argument, which `start` otherwise takes the URL to be.
        ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];

  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Nothing to do about it here. `main` has already printed the link, which
    // is the recovery path: a person can open it themselves.
  }
}

/**
 * What the user sees in their terminal.
 *
 * The link is printed **before** it is opened, on purpose. If DASH is not
 * installed, opening it does nothing visible, and a terminal that has already
 * said "here is the link, and here is what to do if nothing happens" turns a
 * dead end into a next step.
 */
export function report(result: HandoffWriteResult, willOpen: boolean): string {
  return [
    ``,
    `  ${result.handoff.display_name} is ready.`,
    ``,
    ...(willOpen
      ? [
          `  Opening DASH so you can add it. DASH will ask you first.`,
          ``,
          `  If nothing happens, DASH is probably not installed yet.`,
          `  Install it, then run this command again.`,
        ]
      : [`  Open this link on the computer where DASH is installed. DASH will ask you first.`]),
    ``,
    `  The link expires in ${String(Math.round(HANDOFF_TTL_MS / 60_000))} minutes:`,
    `  ${result.url}`,
    ``,
  ].join("\n");
}

/**
 * The command, minus the process.
 *
 * `scriptDir` is passed in rather than derived from `import.meta.url` here,
 * because after bundling this module *is* `<project>/scripts/open-in-dash.mjs`
 * and the entry point is the file that knows that. Passing it also lets a test
 * drive the whole command against a scaffold in a temporary directory.
 */
export function main(
  argv: readonly string[],
  kitVersion: string,
  scriptDir: string,
): { code: number; output: string; url?: string } {
  // The project is the folder above `scripts/`, not the working directory: a
  // person may well run `npm run open-in-dash` from anywhere, and npm's own cwd
  // guarantees are not something to lean on.
  const explicit = argv.find((argument) => !argument.startsWith("-"));
  const projectDir = explicit === undefined ? path.resolve(scriptDir, "..") : path.resolve(explicit);

  const written = writeHandoff(projectDir, kitVersion);
  if (!written.ok) {
    return { code: 1, output: `\n  ${written.problem}\n\n` };
  }

  // The URL is returned rather than re-derived by the caller: writing a handoff
  // mints a fresh nonce and overwrites the file, so calling `writeHandoff`
  // twice would leave the printed link pointing at a nonce that no longer
  // matches — a link that fails verification the moment anyone clicks it.
  return {
    code: 0,
    output: report(written.value, !argv.includes("--no-open")),
    url: written.value.url,
  };
}
