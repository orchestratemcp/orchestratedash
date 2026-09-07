"use client";

import { useState, type ReactNode } from "react";

import { ADD_AGENT_PATHS, CHOOSE_FOLDER_COPY } from "../../lib/copy/add-agent";
import type { AddedAgentReport } from "../../lib/shell/ipc";
import { chooseAgentFolder, createSampleAgent } from "../_data/source";

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

/**
 * The sample agent, offered on the page instead of only in a menu (MAR-879).
 *
 * ## One press, and why that needed a command
 *
 * DASH's sample is a main-process operation: it writes a project, mints a real
 * nonce and raises a native consent dialog, and until MAR-879 the only way to
 * reach it was the application menu's `sample_agent` action (`lib/shell/menu.ts`,
 * `electron/sample-agent.ts`). The renderer's one menu-touching command,
 * `shell.menu`, deliberately carries two numbers and nothing else — a page can
 * *show* the menu and can never invoke an item in it — so the first draft of
 * this control popped the menu and asked the person to find, in it, the thing
 * they had just pressed. That is the defect this page was rewritten to remove,
 * one layer in.
 *
 * So `sample.create` was added to the audited channel instead. It carries **no
 * payload at all**, which is the whole of its safety argument: there is nothing
 * for page script to name, and the widest thing it can ask for is the one thing
 * the menu item already asks for. See its entry in `lib/shell/ipc.ts`.
 *
 * ## Still one registration path
 *
 * Main routes the command to the same `offerSampleAgent(handoffContext)` that
 * `runMenuAction` calls. The menu item is untouched and still says what it has
 * always said, and `lib/sample-agent.ts`' standing argument — one path that
 * registers a sample — holds: this is a second door, not a second path. What
 * the button starts still ends at a native dialog a person answers, which page
 * script cannot answer and cannot read.
 */
export function TrySampleAgent({ canAct }: { canAct: boolean }): ReactNode {
  return <SampleAgentControl available={canAct} />;
}

/**
 * The control itself, taking the decided boolean as a prop.
 *
 * Split from the wrapper above for `SettingsTabsStrip`'s reason: a static render
 * runs no effects, so a component that discovered its own availability could
 * only ever be tested in one of its two states.
 *
 * It words nothing, as `ChooseFolder` words nothing. `createSampleAgent` in
 * `app/_data/source.ts` composes both refusals — a window with no bridge, and a
 * shell that has one without this command — and the second is the reason there
 * is no availability effect here any more: an older build is told about the
 * menu it still has, rather than shown a control that quietly does nothing.
 */
export function SampleAgentControl({ available }: { available: boolean }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function make(): Promise<void> {
    setBusy(true);
    setRefusal(null);
    const result = await createSampleAgent();
    setBusy(false);
    /*
     * A refusal is worth saying and a success is not.
     *
     * What follows a success is a native dialog DASH raises in front of this
     * window — the person is looking at the thing that happened. A receipt here
     * would be a second, quieter claim about a decision they have not made yet,
     * and if they say no it would be a claim that had already been contradicted.
     * The far side of that dialog is `offerSampleAgent`'s, and the fleet is
     * where the answer shows up.
     */
    if (!result.ok && result.detail !== undefined && result.detail !== "") {
      setRefusal(result.detail);
    }
  }

  if (!available) {
    /*
     * Said rather than drawn disabled, for `ChooseFolder`'s reason one door
     * along: a greyed-out button here would read as a claim about the sample,
     * and the true statement is about which window this is.
     */
    return <p className="muted wrap">{ADD_AGENT_PATHS.sample_read_only}</p>;
  }

  return (
    <div className="choose-folder">
      <button
        type="button"
        className="button-primary"
        disabled={busy}
        onClick={() => void make()}
      >
        {busy ? ADD_AGENT_PATHS.sample_pending : ADD_AGENT_PATHS.sample.action}
      </button>
      <p className="muted wrap">{ADD_AGENT_PATHS.sample.detail}</p>

      {refusal === null ? null : (
        <div className="notice notice-err" role="status">
          <p className="wrap">{refusal}</p>
        </div>
      )}
    </div>
  );
}

/**
 * One line somebody pastes somewhere else, with a way to get it there
 * (MAR-879).
 *
 * The same shape MAR-871 gave the Servers page's `CopyableText`, down to the
 * `.copyable` and `.setup-line` classes, and deliberately a second copy rather
 * than an extraction: that one is private to `server-card.tsx` and lifting it
 * into a shared component would be editing a file this packet does not own, in
 * a wave where three other lanes were live in the same tree. The duplication is
 * eleven lines and is recorded in the handoff as debt.
 *
 * Two attempts and a spoken failure, for its reason: `navigator.clipboard` is
 * gated on a secure context and DASH's pages are served over a custom scheme in
 * the packaged app and over loopback on the developer path, so the modern route
 * is the one to try and not the one to rely on. If neither works the button
 * says so, and the line is still on screen to select by hand.
 */
export function CopyableCommand({
  text,
  label,
  copied,
  failed,
}: {
  text: string;
  label: string;
  copied: string;
  failed: string;
}): ReactNode {
  const [said, setSaid] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="copyable">
      <pre className="setup-line">{text}</pre>
      <button
        type="button"
        className="button-secondary"
        onClick={() => {
          void copyText(text).then((ok) => {
            setSaid(ok ? "copied" : "failed");
          });
        }}
      >
        {said === "copied" ? copied : said === "failed" ? failed : label}
      </button>
    </span>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the selection route below, which works without a secure
    // context. A refusal here is a permission answer, not a bug to report.
  }
  try {
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "");
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    document.body.appendChild(holder);
    holder.select();
    const done = document.execCommand("copy");
    document.body.removeChild(holder);
    return done;
  } catch {
    return false;
  }
}
