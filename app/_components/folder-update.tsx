"use client";

import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { FOLDER_CHECK_COPY } from "../../lib/copy/folder";
import type { FolderChangeReport } from "../../lib/folder-changes";
import { adoptAgentFolder, checkAgentFolder, revealAgentFolder } from "../_data/source";

/**
 * Updating an agent by editing its folder from outside DASH (MAR-584).
 *
 * ## The journey this section is the whole of
 *
 * Open your AI editor, point it at this agent's folder, ask for a change, come
 * back, press one button, read what changed, accept it. Three controls in the
 * order a person meets them — open the folder, check it, accept — and nothing
 * else on the page moves until the third.
 *
 * ## Why there is no watcher
 *
 * DASH looks when asked. A background watch would be cheaper to *use* and is
 * the wrong default here, because the interesting moment is not "the file
 * changed" — an editor saves twenty times while it works — but "I am finished,
 * tell me what you would be accepting". A person pressing a button is a person
 * who has finished. `FOLDER_CHECK_COPY.detail` says DASH is not watching, out
 * loud, because an app that quietly looked and an app that does not are
 * indistinguishable on screen right up until it matters.
 *
 * ## Every sentence comes from the trusted side
 *
 * This component renders `FolderChangeReport` and words nothing. The card, the
 * change lines and the validator's own errors are all composed in
 * `lib/folder-changes.ts` and `lib/copy/folder.ts` — so a page cannot describe a
 * folder differently from the process that read it, and the plain-language gate
 * holds over every string a person can reach here.
 */
export function FolderUpdate({
  agent,
  canAct,
  checkable,
  onAdopted,
  setFeedback,
}: {
  agent: string;
  canAct: boolean;
  /** False for an agent DASH holds no folder of its own for. */
  checkable: boolean;
  /** Re-read the workspace, so the page redraws as the version it just accepted. */
  onAdopted: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [report, setReport] = useState<FolderChangeReport | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!checkable) {
    /*
     * Nothing at all, rather than a section explaining an absence.
     *
     * An agent with no folder of DASH's own is the row-only standing MAR-553
     * keeps supported on purpose. There is no folder to open, nothing to
     * compare, and a person on that page has no action to take — so a notice
     * would be DASH describing its own internals at somebody who came to look
     * at their agent.
     */
    return null;
  }

  async function check(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await checkAgentFolder({ agent_id: agent });
    setBusy(false);
    if (!result.ok || result.folder === undefined) {
      setReport(null);
      setCheckedAt(null);
      setFeedback({
        ok: false,
        message: result.detail ?? "DASH could not look at this agent's folder.",
      });
      return;
    }
    setReport(result.folder);
    // DASH's own clock, in the renderer, and used for nothing but this
    // sentence. It says when the *look* happened, which is the fact that makes
    // "nothing has changed" mean anything at all: without it the answer is
    // undated and could be from any point in the session.
    setCheckedAt(new Date().toISOString());
  }

  async function adopt(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await adoptAgentFolder({ agent_id: agent });
    setBusy(false);
    setFeedback({
      ok: result.ok,
      message:
        result.detail ??
        (result.ok ? FOLDER_CHECK_COPY.adopted : FOLDER_CHECK_COPY.adopt_failed),
    });
    if (result.ok) {
      // The report described a difference that no longer exists. Leaving it on
      // screen beside a success message would show a person a change list and a
      // confirmation that it had been applied, which reads as two states at
      // once.
      setReport(null);
      setCheckedAt(null);
      onAdopted();
    }
  }

  async function reveal(): Promise<void> {
    const result = await revealAgentFolder({ agent_id: agent });
    if (!result.ok) {
      setFeedback({
        ok: false,
        message: result.detail ?? "DASH could not open this agent's folder.",
      });
    }
  }

  return (
    <section className="section folder-update" aria-labelledby="folder-update">
      <h2 id="folder-update">Change this agent with your own editor</h2>

      {canAct ? (
        <div className="folder-update-do">
          <button type="button" className="button-secondary" onClick={() => void reveal()}>
            {FOLDER_CHECK_COPY.reveal}
          </button>
          <p className="muted wrap">{FOLDER_CHECK_COPY.reveal_detail}</p>
        </div>
      ) : (
        /*
         * Said rather than drawn disabled, for `DeployToServerPanel`'s reason: a
         * greyed-out control here would read as a claim about the agent, and the
         * true statement is about which window this is.
         */
        <p className="muted wrap">
          Open the installed DASH app to change this agent from its folder.
        </p>
      )}

      {canAct ? (
        <div className="folder-update-do">
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => void check()}
          >
            {busy ? FOLDER_CHECK_COPY.pending : FOLDER_CHECK_COPY.action}
          </button>
          <p className="muted wrap">{FOLDER_CHECK_COPY.detail}</p>
        </div>
      ) : null}

      {report === null ? null : (
        <FolderReport
          report={report}
          checkedAt={checkedAt}
          busy={busy}
          canAct={canAct}
          onAdopt={() => void adopt()}
        />
      )}
    </section>
  );
}

/**
 * One answer to one check.
 *
 * `notice-warn` for a change and for a refusal, `notice` for the calm one. A
 * folder that changed is not a fault and is not drawn as one — the warmer tone
 * is there because it is a thing waiting for a decision, which is the same
 * reason `ManifestGapNotice` uses it.
 *
 * Exported for `tests/folder-render.test.tsx`, like `DeployToServerPanel` and
 * `DeployOutcome` are: the states worth asserting are reached by a report
 * arriving from main, and a test that had to drive a click and a bridge to see
 * one would be testing the harness.
 */
export function FolderReport({
  report,
  checkedAt,
  busy,
  canAct,
  onAdopt,
}: {
  report: FolderChangeReport;
  checkedAt: string | null;
  busy: boolean;
  canAct: boolean;
  onAdopt: () => void;
}): ReactNode {
  const calm = report.kind === "unchanged";
  return (
    <div
      className={calm ? "notice folder-report" : "notice notice-warn folder-report"}
      role="status"
    >
      <p className="wrap">
        <strong>{report.card.headline}</strong>
      </p>
      <p className="wrap">{report.card.meaning}</p>

      {report.lines.length === 0 ? null : (
        <ul className="folder-changes">
          {report.lines.map((line) => (
            <li key={line} className="wrap">
              {line}
            </li>
          ))}
        </ul>
      )}

      {/*
        The validator's own account, under DASH's explanation of it and never
        instead of it (MAR-423). `headline` and `suggestion` are DASH's words;
        `raw` is the schema's, verbatim, in a monospaced block that looks like
        what it is. MAR-584 asks for the schema's own error and this is it —
        shown as evidence, attributed, rather than paraphrased into something
        friendlier that would send an editor looking in the wrong place.
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

      {report.adoptable && canAct ? (
        <div className="folder-update-do">
          <button type="button" className="button-primary" disabled={busy} onClick={onAdopt}>
            {busy ? FOLDER_CHECK_COPY.adopting : FOLDER_CHECK_COPY.adopt}
          </button>
          <p className="muted wrap">{FOLDER_CHECK_COPY.adopt_detail}</p>
        </div>
      ) : null}

      {/*
        When DASH looked, and it is not decoration. "Nothing has changed" is a
        claim about a moment, and an undated one keeps looking true for the rest
        of the session while an editor carries on working in another window.
      */}
      {checkedAt === null ? null : (
        <p className="card-meta">
          DASH looked at{" "}
          {new Date(checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
        </p>
      )}
    </div>
  );
}
