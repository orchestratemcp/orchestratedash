/**
 * Save a brief as a PDF, and open it (MAR-674, ADR 0025 decision 4).
 *
 * Henrik's ruling, on 2026-08-18, against this ADR's first draft: *"text files
 * should download as html->PDF"*, and *save, then open*. Both are here.
 *
 * ## The order is the design, and it is `workspaceDownload`'s
 *
 * **Ask first, render second.** A cancelled dialog costs no window, no print and
 * no bytes; a flow that produced the PDF and then asked where to put it would
 * have had to choose a place on its own, and a downloads folder DASH picked is
 * a place a person has to go and find.
 *
 * ## What crosses back to the renderer
 *
 * A sentence and a folder. Not the path, not the bytes, not the markup —
 * `lib/shell/ipc.ts` states that a path never crosses that boundary in either
 * direction, and this route is the newest reason to keep it.
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

import { BrowserWindow, dialog, shell } from "electron";
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
import { describeReceiptMoment } from "../lib/copy/artifacts.js";

/** How long a print may take before DASH stops waiting and says so. */
const PRINT_TIMEOUT_MS = 30_000;

/**
 * A filename a person will recognise, out of the agent's own title.
 *
 * The agent's words, not DASH's, on `workspaceDownload`'s rule — the suggested
 * name is what the person will be looking for. Reduced to what a filesystem
 * will take: this string reaches `dialog.showSaveDialog` as a default, and a
 * title carrying a slash would otherwise propose a path.
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
 * Render, ask, print, save, open.
 *
 * Every failure is a sentence rather than a throw: this is reached from the
 * audited command dispatcher, and a rejected promise there becomes a generic
 * refusal a person cannot act on.
 */
export async function exportBriefAsPdf(
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

  // Ask before doing any work. See this module's header.
  const chosen = await dialog.showSaveDialog({
    defaultPath: briefFileName(brief.title),
    title: "Save this briefing as a PDF",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (chosen.canceled || chosen.filePath === undefined || chosen.filePath === "") {
    // Not a failure. The person answered the question, and the answer was no.
    return { ok: true, detail: "" };
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

    writeFileSync(chosen.filePath, pdf);
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
  // path is the one the person chose in the OS's own dialog.
  const opened = await shell.openPath(chosen.filePath);
  const folder = path.dirname(chosen.filePath);
  return opened === ""
    ? { ok: true, detail: `Saved to ${folder} and opened.` }
    : // The file is on disk either way. A machine with no PDF reader is not a
      // failed export, and saying so is more useful than repeating the OS error.
      { ok: true, detail: `Saved to ${folder}. DASH could not open it for you.` };
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
