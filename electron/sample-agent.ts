/**
 * "Try a sample agent" — the Electron half.
 *
 * Everything that decides anything is in `lib/sample-agent.ts` and
 * `lib/handoff-flow.ts`, both pure of Electron and both covered by the suite that
 * runs on every push. What is here is the part that cannot be: finding the two
 * template files inside whichever layout this build is running from, choosing a
 * folder, and reporting.
 *
 * ## Why this remains a menu item
 *
 * MAR-432 (DASH-20) replaced the packaged placeholder with the real UI, so a
 * page button can now exist in the installed product. Adding that button still
 * belongs to MAR-423's page work: this issue preserves the four pages while it
 * changes their host.
 *
 * The menu remains useful on its own terms. It is app-wide, reachable before a
 * page finishes loading, and maps directly to work owned by main rather than by
 * the renderer: choose a folder, write the sample, then raise the native consent
 * dialog. A future page button is another entrance to this same operation, not
 * a replacement implementation and not a reason to remove the menu.
 */

import { app, dialog, BrowserWindow } from "electron";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import type { TemplateSources } from "../agent-kit/scaffold";
import type { HandoffPorts } from "../lib/handoff-flow";
import { createSampleAgent, SAMPLE_PARENT_FOLDER } from "../lib/sample-agent";
import { openHandoffLink } from "./handoff-host";

/**
 * Where the sample's two template files live, in both layouts.
 *
 * Packaged, `scripts/build-shell.mjs` puts them beside `main.mjs`, exactly as it
 * does the renderer, and they are resolved relative to `import.meta.url` for the
 * same reason: it is the one anchor that is correct in a development tree *and*
 * under an immutable MSIX install root, where neither `cwd` nor a walk-up is —
 * see the argument in `electron/resources.ts`.
 *
 * Unpackaged, the repo's own `agent-kit/` is the fallback, so `pnpm shell`
 * works from a clean checkout without a separate build step for the template
 * and with the same code path as the package.
 */
function templateCandidates(): Array<{ agent: string; openInDash: string }> {
  const beside = fileURLToPath(new URL("./agent-kit/", import.meta.url));
  const repo = fileURLToPath(new URL("../../agent-kit/", import.meta.url));
  return [
    { agent: path.join(beside, "agent.mjs"), openInDash: path.join(beside, "open-in-dash.mjs") },
    {
      agent: path.join(repo, "template", "agent.mjs"),
      openInDash: path.join(repo, "dist", "open-in-dash.mjs"),
    },
  ];
}

export type TemplateLookup =
  | { ok: true; value: TemplateSources }
  | { ok: false; problem: string };

export function readTemplateSources(): TemplateLookup {
  for (const candidate of templateCandidates()) {
    if (existsSync(candidate.agent) && existsSync(candidate.openInDash)) {
      return {
        ok: true,
        value: {
          agent: readFileSync(candidate.agent, "utf8"),
          openInDash: readFileSync(candidate.openInDash, "utf8"),
        },
      };
    }
  }
  return {
    ok: false,
    // A packaging mistake, worded for whoever hits it — which in a shipped build
    // is a user, so it says what they can do rather than what went wrong.
    problem:
      "This copy of DASH is missing the files it needs to build a sample agent. " +
      "Reinstalling DASH restores them.",
  };
}

/**
 * Prove the sample's template files were actually shipped.
 *
 * The same argument as `assertRendererPresent`: without this, a packaging
 * mistake is a menu item that fails only in the built product, discovered by a
 * user rather than by a build. Called at startup so it is a crash on line one.
 *
 * `scripts/build-shell.mjs` writes both files into `dist/electron/agent-kit/`
 * on every shell build, so the dev path satisfies this too and cannot drift
 * away from what the package does.
 */
export function assertSampleTemplatesPresent(): void {
  const found = readTemplateSources();
  if (!found.ok) {
    throw new Error(
      "The sample agent's template files are missing. " +
        "scripts/build-shell.mjs writes agent.mjs and open-in-dash.mjs into dist/electron/agent-kit/.",
    );
  }
}

/**
 * Where sample projects go.
 *
 * The user's documents directory, not DASH's data directory. The sample is the
 * user's project — they are meant to open its `inbox` folder and drop files in
 * it, which is the entire demonstration — and something buried in
 * `%LOCALAPPDATA%\Packages\…` is something they will never find. It also
 * survives DASH being uninstalled, which ADR 0001 Amendment 2 established that
 * nothing inside the package's own tree does.
 */
export function sampleParentDirectory(): string {
  return path.join(app.getPath("documents"), SAMPLE_PARENT_FOLDER);
}

/**
 * Create the sample and take it through the ordinary handoff.
 *
 * `openHandoffLink` rather than a direct `openHandoff`: it surfaces the window
 * and reports the outcome, and going through it means the sample gets the same
 * treatment as a link from a terminal down to the dialog that appears at the
 * end. There is deliberately no branch anywhere in this file that registers
 * anything.
 */
export async function offerSampleAgent(ports: HandoffPorts | null): Promise<void> {
  if (ports === null) {
    showProblem("DASH is still starting up. Try again in a moment.");
    return;
  }

  const sources = readTemplateSources();
  if (!sources.ok) {
    showProblem(sources.problem);
    return;
  }

  const created = createSampleAgent({
    parentDir: sampleParentDirectory(),
    sources: sources.value,
    kitVersion: app.getVersion(),
    now: new Date(),
    ids: {
      handoff_id: randomBytes(16).toString("hex"),
      // Minted here and nowhere else, exactly as `open-in-dash` mints one: proof
      // that whoever presents this link could read the file it names.
      nonce: randomBytes(32).toString("hex"),
    },
  });

  if (!created.ok) {
    showProblem(created.problem);
    return;
  }

  await openHandoffLink(created.value.url, ports);
}

function showProblem(message: string): void {
  const parent = BrowserWindow.getAllWindows()[0];
  const options = {
    type: "warning" as const,
    title: "DASH could not make a sample agent",
    message,
    buttons: ["OK"],
    noLink: true,
  };
  if (parent === undefined) {
    void dialog.showMessageBox(options);
  } else {
    void dialog.showMessageBox(parent, options);
  }
}
