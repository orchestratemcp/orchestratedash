"use client";

import { useState, type ReactNode } from "react";

import { CHOOSE_FOLDER_COPY } from "../../lib/copy/add-agent";
import type { AddedAgentReport } from "../../lib/shell/ipc";
import { chooseAgentFolder } from "../_data/source";

/**
 * The Add agent page's primary action (MAR-598).
 *
 * ## One button, and everything else is DASH's job
 *
 * Henrik's sentence is the whole specification: *choose a folder, DASH does the
 * rest, and says what it did.* So this component has exactly one control. It
 * does not ask which kind of agent, does not offer a path field, does not
 * validate anything itself and does not word a single outcome — it presses a
 * command and renders the card that comes back.
 *
 * ## Why nothing here is a file input
 *
 * `<input type="file" webkitdirectory>` exists and would have been fewer lines.
 * It is refused for the reason `workspace.selectInput` refuses it: a folder
 * chosen in the page is a folder the *renderer* read, which means the renderer
 * holds a path and the file contents, and every guard about what may be copied
 * would then be running in the least trusted process in DASH. The real chooser
 * is a window the operating system draws; page script cannot see it, cannot
 * pre-fill it and cannot dismiss it. What arrives back here is a sentence.
 *
 * ## Every word comes from the trusted side
 *
 * The card, the receipt and the contract checker's errors are all composed in
 * `lib/copy/add-agent.ts` and `lib/import-feedback.ts`, in main — so a page
 * cannot describe a folder differently from the process that read it, and the
 * plain-language gate holds over every string a person can reach here. This
 * component words nothing, exactly as `FolderUpdate` words nothing.
 */
export function ChooseFolder({ canAct }: { canAct: boolean }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<AddedAgentReport | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function choose(): Promise<void> {
    setBusy(true);
    setRefusal(null);
    // Cleared before the chooser opens, not after it answers. A receipt from a
    // previous folder sitting on screen while somebody picks the next one would
    // read as a report on the folder they are choosing now.
    setReport(null);
    const result = await chooseAgentFolder();
    setBusy(false);

    if (result.added !== undefined) {
      setReport(result.added);
      return;
    }
    /*
     * No card and not ok. Two situations reach here and they are told apart by
     * whether there is anything to say: a cancelled chooser carries no detail
     * and deliberately shows nothing, because closing a dialog is not a failure
     * anybody needs reporting back to them. A host that cannot act carries the
     * sentence `chooseAgentFolder` composed.
     */
    if (!result.ok && result.detail !== undefined && result.detail !== "") {
      setRefusal(result.detail);
    }
  }

  return (
    /*
     * No heading, and that is deliberate rather than an omission.
     *
     * A section headed "Choose a folder" directly above a button labelled
     * "Choose a folder" is the same stutter MAR-599 removed from Servers and
     * Notifications, one level down: the heading repeated the control instead of
     * introducing it, and in a packaged frame the two read as one thing said
     * twice. The `<h1>` and the lede above already say what this page is for,
     * and the section has exactly one control — so the control is its own label
     * and a screen reader reaches it by the same words a person sees.
     */
    <div className="section choose-folder">
      {canAct ? (
        <>
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => void choose()}
          >
            {busy ? CHOOSE_FOLDER_COPY.pending : CHOOSE_FOLDER_COPY.action}
          </button>
          <p className="muted wrap">{CHOOSE_FOLDER_COPY.detail}</p>
        </>
      ) : (
        /*
         * Said rather than drawn disabled, for `FolderUpdate`'s reason: a
         * greyed-out control here would read as a claim about this person's
         * agents, and the true statement is about which window this is.
         */
        <p className="muted wrap">{CHOOSE_FOLDER_COPY.read_only}</p>
      )}

      {refusal === null ? null : (
        <div className="notice notice-err" role="status">
          <p className="wrap">{refusal}</p>
        </div>
      )}

      {report === null ? null : <AddedReport report={report} />}
    </div>
  );
}

/**
 * One answer to one folder.
 *
 * `notice-ok` for a success, `notice-err` for anything else — and "anything
 * else" here is never dramatic: a folder that is not an agent, a folder that is
 * already DASH's own, a question somebody answered no to. The tone is carried by
 * the card's own sentences, which say in every one of those cases that nothing
 * was copied and the person's folder is as they left it.
 *
 * Exported for `tests/add-agent-render.test.tsx`, like `FolderReport` is: the
 * states worth asserting arrive from main, and a test that had to drive a native
 * folder chooser to reach one would be testing the harness.
 */
export function AddedReport({ report }: { report: AddedAgentReport }): ReactNode {
  return (
    <div
      className={report.ok ? "notice notice-ok added-agent" : "notice added-agent"}
      role="status"
    >
      <p className="wrap">
        <strong>{report.card.headline}</strong>
      </p>
      <p className="wrap">{report.card.meaning}</p>

      {/*
        The contract checker's own account, under DASH's explanation of it and
        never instead of it (MAR-423). `headline` and `suggestion` are DASH's
        words; `raw` is the schema's, verbatim, in a monospaced block that looks
        like what it is. The same arrangement `FolderReport` uses, because it is
        the same refusal arriving through a different door.
      */}
      {report.failure === null ? null : (
        <div className="folder-invalid">
          <p className="wrap">
            <strong>{report.failure.headline}</strong>
          </p>
          {report.failure.suggestion === "" ? null : (
            <p className="wrap">{report.failure.suggestion}</p>
          )}
          <pre className="folder-errors" aria-label="What the contract checker said">
            {report.failure.raw.join("\n")}
          </pre>
        </div>
      )}

      {report.card.next_action === null ? null : (
        <p className="next-action wrap">{report.card.next_action}</p>
      )}
    </div>
  );
}
