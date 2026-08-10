/**
 * The folder section, drawn in every state it has (MAR-584).
 *
 * `tests/folder-changes.test.ts` drives the sentences. This drives the surface
 * that shows them, and the assertions that matter are about **what is offered**:
 * an answer that is not a change offers no accept button, a refused edit offers
 * the validator's own output and no accept button, and a browser tab is told
 * which window can act rather than being shown a dead control.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FolderReport, FolderUpdate } from "../app/_components/folder-update";
import { FOLDER_CHECK_COPY } from "../lib/copy/folder";
import { describeFolderChanges, type CurrentFolder } from "../lib/folder-changes";
import { expectPlainLanguage } from "./helpers/plain-language";

const MANIFEST = {
  manifest_version: 2,
  agent: { name: "ai-news-scout", display_name: "AI News Scout", goal: "Reads the news." },
  agent_dom: { trigger: { type: "manual" }, permissions: { read: [], write: [] }, connections: [] },
};

const ACCEPTED = {
  manifest: MANIFEST,
  files: [{ path: "code/sources.json", sha256: "sources-1" }],
  sources: ["Google News"],
};

function folder(over: Partial<CurrentFolder> = {}): CurrentFolder {
  return {
    manifest: { kind: "readable", manifest: MANIFEST },
    files: [{ path: "code/sources.json", sha256: "sources-1" }],
    sources: ["Google News"],
    tracks_sources: true,
    ...over,
  };
}

function report(current: CurrentFolder, checkedAt: string | null = null): string {
  return renderToStaticMarkup(
    <FolderReport
      report={describeFolderChanges(ACCEPTED, current)}
      checkedAt={checkedAt}
      busy={false}
      canAct
      onAdopt={() => undefined}
    />,
  );
}

function section(over: { canAct?: boolean; checkable?: boolean } = {}): string {
  return renderToStaticMarkup(
    <FolderUpdate
      agent="ai-news-scout"
      canAct={over.canAct ?? true}
      checkable={over.checkable ?? true}
      onAdopted={() => undefined}
      setFeedback={() => undefined}
    />,
  );
}

describe("the section before anything has been checked", () => {
  it("offers the folder and the check, and says DASH is not watching", () => {
    const markup = section();
    // Derived from the constant rather than typed out, so the assertion still
    // fails if the label is reworded anywhere but in `lib/copy/folder.ts`.
    // React escapes the apostrophe in a text node and the label has one.
    expect(markup).toContain(FOLDER_CHECK_COPY.reveal.replaceAll("'", "&#x27;"));
    expect(markup).toContain(FOLDER_CHECK_COPY.action);
    // The one fact a person cannot see. Without it, an app that looks when asked
    // is indistinguishable from one that watches, right up until it matters.
    expect(markup).toContain("does not watch this folder in the background");
  });

  it("draws nothing at all for an agent DASH holds no folder for", () => {
    /*
     * The row-only standing MAR-553 keeps supported on purpose. There is no
     * folder to open and nothing to compare, and a notice explaining that would
     * be DASH describing its own internals at somebody who came to look at their
     * agent.
     */
    expect(section({ checkable: false })).toBe("");
  });

  it("says which window can act rather than drawing a disabled control", () => {
    // `lib/workspace.ts`'s rule about dead controls. A greyed-out button here
    // reads as a claim about the agent; the true statement is about the window.
    const markup = section({ canAct: false });
    expect(markup).toContain("Open the installed DASH app");
    expect(markup).not.toContain(FOLDER_CHECK_COPY.action);
    expect(markup).not.toContain("disabled");
  });
});

describe("an answer that is not a change", () => {
  it("offers no accept button, and stamps when DASH looked", () => {
    const markup = report(folder(), "2026-08-09T14:35:00.000Z");
    expect(markup).toContain("is the one DASH accepted");
    expect(markup).not.toContain(FOLDER_CHECK_COPY.adopt);
    // The moment is not decoration: "nothing has changed" is a claim about a
    // moment, and an undated one keeps looking true while an editor carries on
    // working in another window.
    expect(markup).toContain("DASH looked at");
  });

  it("does not draw the warm tone over a calm answer", () => {
    expect(report(folder())).not.toContain("notice-warn");
  });
});

describe("a change", () => {
  const changed = folder(
    { files: [{ path: "code/sources.json", sha256: "sources-2" }] },
    );

  it("lists what changed and offers the accept, with what survives beside it", () => {
    const markup = renderToStaticMarkup(
      <FolderReport
        report={describeFolderChanges(ACCEPTED, {
          ...changed,
          sources: ["Google News", "Ars Technica"],
        })}
        checkedAt={null}
        busy={false}
        canAct
        onAdopt={() => undefined}
      />,
    );
    expect(markup).toContain("It now reads 1 more source: Ars Technica.");
    expect(markup).toContain(FOLDER_CHECK_COPY.adopt);
    expect(markup).toContain("Keeps its character");
    expect(markup).toContain("notice-warn");
  });

  it("does not promise the approved program is what is running", () => {
    /*
     * The claim this surface must never make. An agent's working directory is
     * the folder an editor just changed and nothing verifies it before spawning,
     * so changed instructions run at the next run either way. Asserted on the
     * rendered markup, not on the constant, because that is where a person reads
     * it.
     */
    const markup = renderToStaticMarkup(
      <FolderReport
        report={describeFolderChanges(ACCEPTED, {
          ...changed,
          sources: ["Google News", "Ars Technica"],
        })}
        checkedAt={null}
        busy={false}
        canAct
        onAdopt={() => undefined}
      />,
    );
    expect(markup).not.toMatch(/still running the version you approved/);
    expect(markup).toContain("take effect the next time it runs");
  });

  it("offers no accept in a window that cannot act", () => {
    const markup = renderToStaticMarkup(
      <FolderReport
        report={describeFolderChanges(ACCEPTED, {
          ...changed,
          sources: ["Google News", "Ars Technica"],
        })}
        checkedAt={null}
        busy={false}
        canAct={false}
        onAdopt={() => undefined}
      />,
    );
    expect(markup).toContain("It now reads 1 more source: Ars Technica.");
    expect(markup).not.toContain(FOLDER_CHECK_COPY.adopt);
  });
});

describe("an edit that cannot be read as an agent", () => {
  const invalid = folder({
    manifest: { kind: "invalid", errors: ["/agent must have required property 'goal'"] },
  });

  it("shows the contract checker's own words, under DASH's explanation of them", () => {
    /*
     * MAR-584's third bullet. `raw` is the validator's output verbatim, in a
     * block that looks like what it is; the headline and suggestion above it are
     * DASH's, from `explainImportFailure` — the same translation a first import
     * gets, so an author is not sent to a different vocabulary depending on which
     * door they came through.
     */
    const markup = report(invalid);
    expect(markup).toContain("cannot be read as an agent");
    expect(markup).toContain("/agent must have required property &#x27;goal&#x27;");
    expect(markup).toContain("What the contract checker said");
  });

  it("says the agent is untouched, and offers nothing to accept", () => {
    const markup = report(invalid);
    expect(markup).toContain("still the version you approved");
    expect(markup).not.toContain(FOLDER_CHECK_COPY.adopt);
  });
});

describe("an agent DASH kept no record for", () => {
  it("says it cannot tell, and names the way to start keeping one", () => {
    const markup = renderToStaticMarkup(
      <FolderReport
        report={describeFolderChanges({ ...ACCEPTED, files: undefined }, folder())}
        checkedAt={null}
        busy={false}
        canAct
        onAdopt={() => undefined}
      />,
    );
    expect(markup).toContain("cannot tell whether this agent&#x27;s folder has changed");
    expect(markup).toContain("Add this agent again from its own folder");
    expect(markup).not.toContain(FOLDER_CHECK_COPY.adopt);
  });
});

describe("everything a person reads on this surface", () => {
  it("is plain language", () => {
    /*
     * Over the rendered markup rather than the constants, which is what MAR-423
     * asks for — the interpolated halves are scanned too.
     *
     * The validator's own errors are the deliberate exception and are exempted
     * by name. They are raw identifiers and are *meant* to be: MAR-584 requires
     * the refusal to carry the schema's own error, and the rule
     * `lib/copy/identifiers.ts` enforces is about DASH's voice, not about
     * evidence DASH is quoting from something else. The exemption is a string in
     * this diff rather than a hole in the detector — which is exactly what
     * `IdentifierScanOptions.allow` is for.
     */
    const surfaces = [
      section(),
      section({ canAct: false }),
      report(folder(), "2026-08-09T14:35:00.000Z"),
      report(
        folder({ files: [{ path: "code/sources.json", sha256: "sources-2" }], sources: null }),
      ),
      renderToStaticMarkup(
        <FolderReport
          report={describeFolderChanges({ ...ACCEPTED, files: undefined }, folder())}
          checkedAt={null}
          busy={false}
          canAct
          onAdopt={() => undefined}
        />,
      ),
    ];
    for (const markup of surfaces) {
      expectPlainLanguage([textOf(markup)]);
    }
  });
});

/**
 * The words, without the markup.
 *
 * Tag names and class names are DASH's own vocabulary and are not copy — a
 * scanner run over raw markup would report `folder-update` and `card-meta` as
 * internal field names, which is true and is not what this rule is about.
 */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
