/**
 * What DASH says an outside editor did, over fixtures (MAR-584).
 *
 * `describeFolderChanges` is pure on purpose — the reading half is
 * `lib/agent-folders.ts` and `electron/folder-update.ts` — so this drives the
 * decision directly against two documents and a set of digests, which is the
 * only way to reach states a real directory makes awkward: a sources file that
 * is legal JSON and not a list, a baseline naming a file that has since been
 * deleted, an agent with no baseline at all.
 *
 * The assertions are on the **sentences**, not on a shape. That is deliberate
 * and it is what MAR-584's acceptance bullet asks for — *"the diff said plainly
 * … through the copy gates"* — so a change to the wording fails here rather than
 * passing because the right number of lines came back.
 */

import { describe, expect, it } from "vitest";

import { AGENT_CODE_DIRECTORY } from "../lib/agent-folders";
import { SOURCES_FILE_NAME } from "../lib/agent-sources";
import {
  describeFolderChanges,
  STORED_SOURCES_PATH,
  type AcceptedFolder,
  type CurrentFolder,
} from "../lib/folder-changes";
import {
  FOLDER_CHANGED,
  FOLDER_INVALID,
  FOLDER_NO_BASELINE,
  FOLDER_UNCHANGED,
  FOLDER_UNREADABLE,
} from "../lib/copy/folder";
import { expectPlainLanguage } from "./helpers/plain-language";

const PROGRAM = "code/agent.mjs";

function manifest(
  over: {
    name?: string;
    display_name?: string;
    goal?: string;
    trigger?: Record<string, unknown>;
    permissions?: unknown;
    connections?: unknown;
  } = {},
): unknown {
  return {
    manifest_version: 2,
    agent: {
      name: over.name ?? "ai-news-scout",
      display_name: over.display_name ?? "AI News Scout",
      goal: over.goal ?? "Reads the news sources you choose.",
    },
    agent_dom: {
      trigger: over.trigger ?? { type: "manual" },
      permissions: over.permissions ?? { read: [], write: [] },
      connections: over.connections ?? [],
    },
  };
}

/** A folder that agrees with the baseline in every way. */
function unchangedFolder(
  over: Partial<CurrentFolder> = {},
  /** Null is a real value here: a sources file DASH cannot read as a list. */
  sources: readonly string[] | null = ["Google News", "Hacker News"],
): CurrentFolder {
  return {
    manifest: { kind: "readable", manifest: manifest() },
    files: [
      { path: STORED_SOURCES_PATH, sha256: "sources-1" },
      { path: PROGRAM, sha256: "program-1" },
    ],
    sources,
    tracks_sources: true,
    ...over,
  };
}

function accepted(over: Partial<AcceptedFolder> = {}): AcceptedFolder {
  return {
    manifest: manifest(),
    files: [
      { path: STORED_SOURCES_PATH, sha256: "sources-1" },
      { path: PROGRAM, sha256: "program-1" },
    ],
    sources: ["Google News", "Hacker News"],
    ...over,
  };
}

describe("the stored sources path", () => {
  it("agrees with the folder layout it cannot import", () => {
    /*
     * `lib/folder-changes.ts` spells this constant out rather than composing it,
     * because it is imported by a `"use client"` tree and `lib/agent-folders.ts`
     * reaches `node:fs`. A constant that cannot import its counterpart is
     * asserted against it — the same round trip `REMOTE_DASH_MANAGED_PHRASE`
     * uses, and for the same reason: without this, moving `code/` would leave
     * the detector reading a file nothing writes and reporting no changes
     * forever.
     */
    expect(STORED_SOURCES_PATH).toBe(`${AGENT_CODE_DIRECTORY}/${SOURCES_FILE_NAME}`);
  });
});

describe("the four states that are not a comparison", () => {
  it("says DASH cannot read the folder, and blames itself", () => {
    const report = describeFolderChanges(accepted(), unchangedFolder({ manifest: { kind: "unreadable" } }));
    expect(report.kind).toBe("unreadable");
    expect(report.card).toEqual(FOLDER_UNREADABLE);
    expect(report.adoptable).toBe(false);
  });

  it("refuses an invalid edit with the schema's own error, and offers nothing", () => {
    /*
     * MAR-584's third bullet. The validator's output travels verbatim on
     * `failure.raw`; the headline and suggestion are `explainImportFailure`'s,
     * which is the *same* translation a first import gets — so an author sees
     * one vocabulary rather than a lenient side door with its own.
     *
     * `adoptable: false` is the load-bearing half: nothing was accepted, so
     * there is no button, and the agent keeps the setup it had.
     */
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder({
        manifest: { kind: "invalid", errors: ["/agent must have required property 'goal'"] },
      }),
    );
    expect(report.kind).toBe("invalid");
    expect(report.card).toEqual(FOLDER_INVALID);
    expect(report.adoptable).toBe(false);
    expect(report.failure?.raw).toEqual(["/agent must have required property 'goal'"]);
    expect(report.failure?.headline).toContain("missing");
  });

  it("says it never wrote down what it was handed, rather than saying nothing changed", () => {
    /*
     * The comfortable answer here is "unchanged" and it would be false: DASH has
     * not found the folder unchanged, it has found that it has no idea what
     * unchanged would mean. Every agent added before this record existed is in
     * this state.
     */
    const report = describeFolderChanges(accepted({ files: undefined }), unchangedFolder());
    expect(report.kind).toBe("no_baseline");
    expect(report.card).toEqual(FOLDER_NO_BASELINE);
    expect(report.card.meaning).not.toMatch(/unchanged|up to date/i);
  });

  it("reports an unreadable folder even for an agent with no baseline", () => {
    // Order matters: a missing folder is a real problem DASH can state without a
    // baseline, and answering "DASH never wrote down what it was handed" over it
    // would answer a question nobody asked.
    const report = describeFolderChanges(
      accepted({ files: undefined }),
      unchangedFolder({ manifest: { kind: "unreadable" } }),
    );
    expect(report.kind).toBe("unreadable");
  });

  it("says nothing changed, and says what it compared against", () => {
    const report = describeFolderChanges(accepted(), unchangedFolder());
    expect(report.kind).toBe("unchanged");
    expect(report.card).toEqual(FOLDER_UNCHANGED);
    expect(report.lines).toEqual([]);
    expect(report.adoptable).toBe(false);
  });
});

describe("the sentence the issue was opened for", () => {
  it("names the sources that were added", () => {
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder(
        { files: [{ path: STORED_SOURCES_PATH, sha256: "sources-2" }, { path: PROGRAM, sha256: "program-1" }] },
        ["Google News", "Hacker News", "Ars Technica", "The Verge"],
      ),
    );
    expect(report.kind).toBe("changed");
    expect(report.card).toEqual(FOLDER_CHANGED);
    expect(report.adoptable).toBe(true);
    expect(report.lines).toEqual([
      "It now reads 2 more sources: Ars Technica and The Verge.",
    ]);
  });

  it("names one added source in the singular", () => {
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder({}, ["Google News", "Hacker News", "Ars Technica"]),
    );
    expect(report.lines).toEqual(["It now reads 1 more source: Ars Technica."]);
  });

  it("names what was removed", () => {
    const report = describeFolderChanges(accepted(), unchangedFolder({}, ["Google News"]));
    expect(report.lines).toEqual(["It no longer reads Hacker News."]);
  });

  it("caps a long list and says how many it did not name", () => {
    // Forty names in a notice is not a report. The cap is in the sentence
    // rather than silent, so a reader is never shown three and left believing
    // that was all of them.
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder({}, ["Google News", "Hacker News", "A", "B", "C", "D", "E"]),
    );
    expect(report.lines).toEqual(["It now reads 5 more sources: A, B, C and 2 others."]);
  });

  it("does not count the sources file twice", () => {
    /*
     * The bytes moved *and* the names changed — one event. Before
     * `compareSources` returned `summarised`, this produced both "it now reads
     * 1 more source" and "1 file of the program has changed", which is the same
     * change reported twice in two vocabularies.
     */
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder(
        {
          files: [
            { path: STORED_SOURCES_PATH, sha256: "sources-2" },
            { path: PROGRAM, sha256: "program-1" },
          ],
        },
        ["Google News", "Hacker News", "Ars Technica"],
      ),
    );
    expect(report.lines).toEqual(["It now reads 1 more source: Ars Technica."]);
  });

  it("does not claim every source was removed over a file it cannot read as a list", () => {
    /*
     * `readSourceNames` returns null rather than an empty list precisely so this
     * branch exists. The alternative — treating unreadable as empty — would tell
     * a person their agent had stopped reading everything, over a file somebody
     * reformatted.
     */
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder(
        {
          files: [
            { path: STORED_SOURCES_PATH, sha256: "sources-2" },
            { path: PROGRAM, sha256: "program-1" },
          ],
        },
        null,
      ),
    );
    expect(report.lines).toContain(
      "The list of sources it reads has changed, in a way DASH cannot summarise.",
    );
    expect(report.lines.join(" ")).not.toMatch(/no longer reads/);
    // And it is handed back to the count, so the change is never invisible.
    expect(report.lines).toContain("1 file of the program DASH runs has changed.");
  });

  it("says nothing about sources for an agent that has none", () => {
    const report = describeFolderChanges(
      accepted({ files: [{ path: PROGRAM, sha256: "program-1" }], sources: undefined }),
      {
        manifest: { kind: "readable", manifest: manifest() },
        files: [{ path: PROGRAM, sha256: "program-2" }],
        sources: null,
        tracks_sources: false,
      },
    );
    expect(report.lines).toEqual(["1 file of the program DASH runs has changed."]);
  });
});

describe("the rest of the change list", () => {
  it("says a schedule arrived, in words rather than in seconds", () => {
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder({
        manifest: {
          kind: "readable",
          manifest: manifest({
            trigger: { type: "schedule", expected_interval_seconds: 3600 },
          }),
        },
      }),
    );
    expect(report.lines).toEqual([
      "It now runs on its own, about once an hour, instead of only when you ask.",
    ]);
  });

  it("says a schedule changed", () => {
    const report = describeFolderChanges(
      accepted({
        manifest: manifest({ trigger: { type: "schedule", expected_interval_seconds: 3600 } }),
      }),
      unchangedFolder({
        manifest: {
          kind: "readable",
          manifest: manifest({
            trigger: { type: "schedule", expected_interval_seconds: 86_400 },
          }),
        },
      }),
    );
    expect(report.lines).toEqual([
      "Its schedule changed: it now expects to run about once a day.",
    ]);
  });

  it("says a schedule was taken away", () => {
    const report = describeFolderChanges(
      accepted({
        manifest: manifest({ trigger: { type: "schedule", expected_interval_seconds: 3600 } }),
      }),
      unchangedFolder(),
    );
    expect(report.lines).toEqual(["It now runs only when you ask, instead of on its own."]);
  });

  it("falls back to a vaguer sentence rather than inventing an interval", () => {
    // A schedule with no interval DASH can read is still a real change, and
    // `describeExpectedInterval` has nothing to say about it. Saying "how often
    // it expects to run has changed" is the honest remainder.
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder({
        manifest: { kind: "readable", manifest: manifest({ trigger: { type: "schedule" } }) },
      }),
    );
    expect(report.lines).toEqual(["How often it expects to run has changed."]);
  });

  it("reports permissions and connections without trying to itemise them", () => {
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder({
        manifest: {
          kind: "readable",
          manifest: manifest({
            permissions: { read: ["network"], write: [] },
            connections: [{ id: "mail" }],
          }),
        },
      }),
    );
    expect(report.lines).toEqual([
      "What this agent declares it is allowed to do has changed.",
      "What this agent needs connected has changed.",
    ]);
  });

  it("ignores a reordered document", () => {
    /*
     * The edit under comparison was made by a code formatter's idea of JSON.
     * Reporting "what it needs connected has changed" because two keys swapped
     * places would train a person to press accept without reading, which is the
     * one habit this whole surface must not create.
     */
    const report = describeFolderChanges(
      accepted({
        manifest: {
          manifest_version: 2,
          agent: { goal: "Reads the news sources you choose.", name: "ai-news-scout", display_name: "AI News Scout" },
          agent_dom: {
            connections: [],
            permissions: { write: [], read: [] },
            trigger: { type: "manual" },
          },
        },
      }),
      unchangedFolder(),
    );
    expect(report.kind).toBe("unchanged");
  });

  it("names a rename, and reports a changed goal without quoting it", () => {
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder({
        manifest: {
          kind: "readable",
          manifest: manifest({ display_name: "News Scout", goal: "Something else." }),
        },
      }),
    );
    expect(report.lines).toEqual([
      "Its name changed from “AI News Scout” to “News Scout”.",
      "What this agent says it does has changed.",
    ]);
  });

  it("counts a deleted program file as gone rather than as changed", () => {
    const report = describeFolderChanges(accepted(), {
      manifest: { kind: "readable", manifest: manifest() },
      files: [
        { path: STORED_SOURCES_PATH, sha256: "sources-1" },
        { path: PROGRAM, sha256: null, problem: "missing" },
      ],
      sources: ["Google News", "Hacker News"],
      tracks_sources: true,
    });
    expect(report.lines).toEqual(["1 file of the program DASH runs is no longer there."]);
  });

  it("puts what the agent does before how much of it moved", () => {
    // The order is the order a person reads. A list opening with "2 files have
    // changed" buries the sentence they came for.
    const report = describeFolderChanges(
      accepted(),
      unchangedFolder(
        {
          manifest: {
            kind: "readable",
            manifest: manifest({
              trigger: { type: "schedule", expected_interval_seconds: 86_400 },
            }),
          },
          files: [
            { path: STORED_SOURCES_PATH, sha256: "sources-2" },
            { path: PROGRAM, sha256: "program-2" },
          ],
        },
        ["Google News", "Hacker News", "Ars Technica", "The Verge"],
      ),
    );
    expect(report.lines).toEqual([
      "It now reads 2 more sources: Ars Technica and The Verge.",
      "It now runs on its own, about once a day, instead of only when you ask.",
      "1 file of the program DASH runs has changed.",
    ]);
  });
});

describe("everything a person reads here is plain language", () => {
  it("passes the guided-path rule over every line the comparison can produce", () => {
    /*
     * MAR-423's rule over the *rendered* copy rather than over the constants, so
     * the interpolated halves — source names, an agent's own display name, a
     * count — are scanned too. `lib/copy/folder.ts` has its own test over the
     * static strings; this is the one that would catch a line composed from a
     * filename.
     */
    const reports = [
      describeFolderChanges(accepted(), unchangedFolder({}, ["Google News"])),
      describeFolderChanges(
        accepted(),
        unchangedFolder({}, ["Google News", "Hacker News", "Ars Technica"]),
      ),
      describeFolderChanges(accepted(), {
        manifest: { kind: "readable", manifest: manifest({ display_name: "News Scout" }) },
        files: [
          { path: STORED_SOURCES_PATH, sha256: "sources-2" },
          { path: PROGRAM, sha256: null, problem: "missing" },
        ],
        sources: null,
        tracks_sources: true,
      }),
      describeFolderChanges(
        accepted(),
        unchangedFolder({
          manifest: {
            kind: "readable",
            manifest: manifest({ trigger: { type: "schedule", expected_interval_seconds: 60 } }),
          },
        }),
      ),
    ];

    for (const report of reports) {
      expectPlainLanguage([
        report.card.headline,
        report.card.meaning,
        report.card.next_action ?? "",
        ...report.lines,
      ]);
    }
  });
});
