/**
 * The only way out of DASH's window (MAR-697, MAR-698).
 *
 * Two features arrive here and they are one mechanism. A citation link in a
 * briefing and a saved PDF on the Output stage are both "a thing on the screen
 * that a press should hand to another program", and `createWindow` denies both
 * by design: `window.open` is refused outright and `will-navigate` is refused
 * for anything off the renderer's origin. That wall is not an obstacle this
 * module works around — it is the reason this module exists. Nothing here
 * loosens the navigation policy. The renderer keeps its origin and DASH gains
 * one narrow, reviewable route through which a person's press can reach the
 * operating system.
 *
 * ## One module, two doors, and each one is bounded by a different check
 *
 * - **A link** must be `https`. `lib/shell/outbound.ts` owns that decision, is
 *   pure, and is tested without Electron — see its header for what each refused
 *   scheme would otherwise have bought an attacker.
 * - **A file** must already be in this agent's own exports folder.
 *   `resolveAgentExport` owns that decision: the renderer sends a file *name*,
 *   never a path, and main resolves it inside one directory it computed itself.
 *
 * Neither door can be reached with the other's argument. The command catalogue
 * declares `url` on one and `agent_id`/`file` on the other, so a payload that
 * named a path could not have arrived at the link door and a payload that named
 * an address could not have arrived at the file door.
 *
 * ## What is deliberately not checked here
 *
 * Whether the address is one DASH collected rather than one a model wrote. That
 * property is structural and lives in the renderer:
 * `app/_components/digest.tsx` draws model prose as text and never as markup,
 * so a URL inside a paragraph is inert characters with no anchor to click. This
 * module would open an `https` address a model produced; it is never offered
 * one, because nothing renders one as a link. Both halves are pinned by tests
 * and neither stands in for the other.
 */

import { shell } from "electron";

import { resolveAgentExport } from "../lib/agent-exports";
import { inspectOutboundLink } from "../lib/shell/outbound";

export interface OpenResult {
  ok: boolean;
  /** A code for a caller that wants to branch. Never rendered. */
  refusal?: string;
  /** The plain sentence a person reads. */
  detail?: string;
}

/**
 * Open one address DASH collected, in the person's own web browser.
 *
 * Every failure is a sentence rather than a throw, on `exportBriefAsPdf`'s
 * reasoning: this is reached from the audited command dispatcher, and a
 * rejected promise there becomes a generic refusal a person cannot act on.
 */
export async function openCollectedLink(url: unknown): Promise<OpenResult> {
  const review = inspectOutboundLink(url);
  if (!review.ok) {
    return { ok: false, refusal: review.refusal, detail: review.detail };
  }

  try {
    await shell.openExternal(review.url);
  } catch {
    /*
     * Said without quoting the address back.
     *
     * The most likely cause by far is a machine with no browser registered for
     * `https`, which is a fact about the computer rather than about the link —
     * and repeating a URL the person can already see on the card would be DASH
     * showing its work instead of saying what happened.
     */
    return {
      ok: false,
      refusal: "open_failed",
      detail: "DASH could not open that link. This computer may have no web browser set up.",
    };
  }
  return { ok: true };
}

/**
 * Open one file DASH saved for this agent.
 *
 * `openPath` and not `showItemInFolder`: the person pressed the name of a
 * document, so they are asking to read it, not to be shown where it lives. The
 * same call `revealFolder` makes for the opposite ask, and for the same stated
 * reason.
 */
export async function openAgentExport(
  dataDir: string,
  agent: string,
  file: unknown,
): Promise<OpenResult> {
  const resolved = resolveAgentExport(dataDir, agent, file);
  if (resolved === null) {
    /*
     * One sentence for two situations, and that is deliberate.
     *
     * A name that failed the containment check and a name whose file has been
     * deleted are indistinguishable to the person, whose list was drawn a
     * moment ago either way. Splitting them would put a sentence on screen that
     * only means something to whoever wrote the payload.
     */
    return {
      ok: false,
      refusal: "no_such_export",
      detail: "DASH could not find that file any more. It may have been moved or deleted.",
    };
  }

  // `openPath` reports its failure in the resolved string rather than by
  // throwing — an empty string is success. A machine with no PDF reader lands
  // here, and the file is still on disk, so the sentence says where it is
  // rather than treating the export as failed.
  const problem = await shell.openPath(resolved);
  return problem === ""
    ? { ok: true }
    : {
        ok: false,
        refusal: "open_failed",
        detail:
          "DASH saved this file but could not open it. This computer may have no program set up for it.",
      };
}
