/**
 * Save a brief as a PDF, and open it (MAR-674, ADR 0025 decision 4; MAR-697).
 *
 * Henrik's ruling, on 2026-08-18, against this ADR's first draft: *"text files
 * should download as html->PDF"*, and *save, then open*. Both are here.
 *
 * ## There is no dialog any more (MAR-697)
 *
 * Henrik, after the first real export: *"Can we have auto path to the agents
 * folder in dash."* So DASH chooses the place, and chooses the same one every
 * time: this agent's own exports folder, listed back on the Output stage by the
 * component MAR-697 asks for. A save nobody had to answer a question for, and
 * one they can find again without having remembered where they put it.
 *
 * MAR-674's argument for asking first was that *"a downloads folder DASH picked
 * is a place a person has to go and find"*. That was right about a folder
 * chosen silently and nothing more; it is answered by listing the folder rather
 * than by asking. What that argument also bought — a cancelled dialog costing no
 * window and no print — is simply gone, and it cost a press either way.
 *
 * **Where the folder is, and why it is not where MAR-697 said.** It asked for
 * `agents/<agent>/`. `lib/agent-exports.ts` records at length why that location
 * would lose the files: `writeAgentFolder` swaps the whole agent folder on any
 * re-import, folder adoption or template refresh. Exports live beside that tree
 * instead, in `exports/<agent>/`.
 *
 * ## What crosses back to the renderer
 *
 * A sentence. Not the path, not the bytes, not the markup — `lib/shell/ipc.ts`
 * states that a path never crosses that boundary in either direction, and this
 * route is the newest reason to keep it. MAR-674 returned the folder's name in
 * that sentence because the person had just chosen it; there is nothing to name
 * now, and the list on the stage is where the file is pointed to instead.
 *
 * ## The window, and the hazard that comes with it
 *
 * A hidden `BrowserWindow` that is not destroyed **blocks the quit**:
 * `window-all-closed` counts open windows whether or not anybody can see them,
 * and `electron/prove-quit.ts` exists to reproduce exactly that shape. So the
 * window is destroyed in a `finally` — on success, on a `printToPDF` rejection,
 * on a failed write, and on a load that never finishes. There is one `return`
 * path in this module that does not go through it, and it is the one taken
 * before any window exists.
 *
 * It carries no preload, no bridge and no navigation. `electron/splash.ts` makes
 * the same choices for the same reason: this document is one string DASH built,
 * so "never navigates" is a rule this window can actually keep.
 */

import { BrowserWindow, shell } from "electron";
/*
 * The **browser** server build, in a Node process, on purpose — the same
 * decision `electron/capture-panel.ts` documents at length. `react-dom/server`
 * resolves to a CommonJS build that reaches `util` through a dynamic `require`
 * an esbuild ESM bundle cannot honour, and `renderToStaticMarkup` is a pure
 * string function in both.
 */
import { renderToStaticMarkup } from "react-dom/server.browser";

import { writeFileSync } from "node:fs";
import path from "node:path";

import { BriefBody } from "../app/_components/digest.js";
import { briefPrintDocument } from "../lib/brief/print.js";
import { resolveBriefCitations } from "../lib/brief/fingerprint.js";
import { isBriefArtifact, isDigestArtifact } from "../lib/contracts.js";
import { artifactRecordsForAgent } from "../lib/store.js";
import { BRIEF_EXPORT_COPY, describeReceiptMoment } from "../lib/copy/artifacts.js";
import { prepareAgentExports, unusedExportName } from "../lib/agent-exports.js";

/** How long a print may take before DASH stops waiting and says so. */
const PRINT_TIMEOUT_MS = 30_000;

/**
 * A filename a person will recognise, out of the agent's own title.
 *
 * The agent's words, not DASH's, on `workspaceDownload`'s rule — the name is
 * what the person will be looking for. Reduced to what a filesystem will take,
 * and MAR-697 made that load-bearing rather than defensive: this string used to
 * be a *suggestion* in a save dialog somebody could edit, and it is now the
 * name of a file DASH writes unattended. A title carrying a slash would have
 * proposed a path before; now it would be one.
 */
export function briefFileName(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${cleaned.length === 0 ? "briefing" : cleaned}.pdf`;
}

/**
 * Render, print, save, open.
 *
 * Every failure is a sentence rather than a throw: this is reached from the
 * audited command dispatcher, and a rejected promise there becomes a generic
 * refusal a person cannot act on.
 *
 * `dataDir` is a parameter rather than an import, on `assertStoreLocation`'s
 * reasoning: main already holds the resolved directory, and reaching for it
 * here would put a second opinion about where the store lives into a module
 * whose job is to write a file beside it.
 */
export async function exportBriefAsPdf(
  dataDir: string,
  agentId: string,
  artifactId: string,
): Promise<{ ok: boolean; detail: string }> {
  const records = artifactRecordsForAgent(agentId);
  const record = records.find((entry) => entry.artifact.artifact_id === artifactId);

  if (record === undefined || !isBriefArtifact(record.artifact)) {
    // Said about the record rather than about the person. An id that names
    // nothing is a stale link, not a mistake somebody made.
    return {
      ok: false,
      detail: "DASH could not find that briefing. It may have been replaced by a newer run.",
    };
  }

  const brief = record.artifact;
  const citations = resolveBriefCitations(
    brief,
    records
      .map((entry) => entry.artifact)
      .filter(isDigestArtifact)
      .filter((digest) => digest.run_id === brief.run_id),
  );

  /*
   * Where it goes, decided rather than asked (MAR-697).
   *
   * Before the render, which is what asking first used to buy: a folder DASH
   * cannot create is a failure worth reporting without having spent a window
   * and a print on it first.
   *
   * The name is numbered rather than overwritten. An agent that runs daily
   * produces briefings with the same title, and replacing yesterday's document
   * with today's — no press, no dialog, nothing on screen — is the one way this
   * change could quietly lose something somebody wanted.
   */
  let destination: string;
  try {
    const { folder, existing } = prepareAgentExports(dataDir, agentId);
    destination = path.join(folder, unusedExportName(existing, briefFileName(brief.title)));
  } catch {
    return {
      ok: false,
      detail: "DASH could not make a place to keep this briefing on this computer.",
    };
  }

  /*
   * The same components as the screen.
   *
   * This is ADR 0025 decision 4's whole argument: React escapes text by
   * construction, so a model that wrote a markdown link or a script tag
   * produces inert characters here exactly as it does in the app. There is no
   * escaper on this path and there must never be one.
   */
  const document = briefPrintDocument({
    title: brief.title,
    subtitle: `${brief.agent} · ${describeReceiptMoment(brief.generated_at)}`,
    body: renderToStaticMarkup(BriefBody({ artifact: brief, citations })),
  });

  let window: BrowserWindow | null = null;
  try {
    window = new BrowserWindow({
      show: false,
      webPreferences: {
        // Stated rather than omitted, on `electron/splash.ts`' terms: this
        // window has no bridge and must not acquire one by somebody copying
        // `createWindow`'s options into it.
        preload: undefined,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        // Off for `electron/browser-view.ts`' reason: nothing here needs a
        // canvas, and it is one fewer surface in a process holding the vault.
        experimentalFeatures: false,
      },
    });

    // It never navigates. Not "only to allowed origins" — nowhere at all.
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });

    await withTimeout(
      window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(document)}`),
      "DASH could not lay out this briefing for printing.",
    );

    const pdf = await withTimeout(
      window.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4",
        // The margins are in the stylesheet's `@page`, so Chromium is told not
        // to add its own on top of them.
        margins: { marginType: "none" },
        // No header, no footer. Chromium's default prints the data: URL across
        // the foot of every page, which would put a base64 blob on a document
        // somebody forwards.
        displayHeaderFooter: false,
      }),
      "DASH could not turn this briefing into a PDF.",
    );

    writeFileSync(destination, pdf);
  } catch (error: unknown) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "DASH could not save this briefing.",
    };
  } finally {
    /*
     * The line that keeps DASH quittable.
     *
     * `window-all-closed` counts hidden windows too, so a print window left
     * behind on any path — a rejected load, a failed print, a disk that refused
     * the write — is a process a person cannot close from the taskbar and
     * cannot see to close from anywhere else. `prove-quit.ts`' `wedged` scene
     * is that shape on purpose.
     */
    if (window !== null && !window.isDestroyed()) {
      window.destroy();
    }
  }

  // Henrik's ruling: the document, not a sentence naming a folder. Safe on two
  // counts stated in the ADR — DASH composed these bytes a moment ago, and the
  // path is one DASH computed rather than one anything outside main supplied.
  const opened = await shell.openPath(destination);
  /*
   * The sentence names the list rather than a path (MAR-697).
   *
   * MAR-674 named the folder because the person had just chosen it and was
   * being told their choice was honoured. Nobody chose this one, so naming it
   * would put an `%APPDATA%` path on a guided surface, which is the shape of
   * thing `lib/copy/identifiers.ts` exists to keep off one. What replaces it is
   * better than a path anyway: the file is now on the stage the person is
   * looking at, one press from opening again.
   */
  return opened === ""
    ? { ok: true, detail: BRIEF_EXPORT_COPY.saved }
    : // The file is on disk either way. A machine with no PDF reader is not a
      // failed export, and saying so is more useful than repeating the OS error.
      { ok: true, detail: BRIEF_EXPORT_COPY.saved_not_opened };
}

/**
 * A promise, or a sentence.
 *
 * `printToPDF` against a renderer that never painted does not always settle —
 * the same shape `CDP enable` has against a rendererless `WebContents`, which a
 * `catch` cannot see either. A timeout is the only thing that can end it, and
 * without one the `finally` above never runs and the window is never destroyed.
 */
async function withTimeout<T>(work: Promise<T>, failure: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(failure));
        }, PRINT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
