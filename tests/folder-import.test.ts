/**
 * Choosing a folder, decided (MAR-598).
 *
 * `lib/folder-import.ts` is pure of Electron precisely so this file can exist:
 * every branch a person can reach — a folder that is not an agent, a plan that
 * is damaged, a plan the contract refuses, a folder DASH may not store, a folder
 * that is already DASH's own, a project with no program in it — is exercised
 * here on every push rather than by driving a native folder chooser on one
 * developer's Windows box.
 *
 * The assertions come in two flavours and both matter:
 *
 * - **Nothing was decided in favour.** For every refusal the contract checker's
 *   own account is checked to have travelled, because MAR-598 asks for the
 *   folder to refuse with `explainImportFailure`'s words rather than a shrug.
 * - **The words of the question.** The consent prompt is held to the same
 *   acceptance criterion the handoff's is — a fresh user never sees internal
 *   field names, environment names or raw scopes — and additionally to this
 *   door's own promise: that DASH is taking a copy and is not taking the folder.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AGENT_MANIFEST_FILE } from "../lib/agent-folders";
import { BUNDLED_NODE_COMMAND } from "../lib/registration";
import {
  AGENT_PROGRAM_FILE,
  inspectChosenFolder,
  isSkippedFolderEntry,
  type ChosenFolderRead,
} from "../lib/folder-import";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DATA_DIR =
  process.platform === "win32" ? "C:\\Users\\sam\\AppData\\Roaming\\orchestratedash" : "/home/sam/.dash";
const CHOSEN = process.platform === "win32" ? "C:\\Users\\sam\\projects\\news" : "/home/sam/projects/news";
const AGENT_ID = "ai-news-scout";

/**
 * Derived from the shipped example rather than transcribed, so it stays valid as
 * the schema evolves — `tests/handoff-flow.test.ts`'s reason for doing the same.
 */
function v2Manifest(mutate: (manifest: Record<string, unknown>) => void = () => {}): string {
  const manifest = JSON.parse(
    readFileSync(
      path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const agent = manifest["agent"] as { name: string; display_name?: string };
  agent.name = AGENT_ID;
  agent.display_name = "AI News Scout";
  mutate(manifest);
  return JSON.stringify(manifest, null, 2);
}

function read(over: Partial<ChosenFolderRead> = {}): ChosenFolderRead {
  return {
    dataDir: DATA_DIR,
    folder: CHOSEN,
    manifestJson: v2Manifest(),
    files: [
      { path: AGENT_MANIFEST_FILE, contents: v2Manifest() },
      { path: AGENT_PROGRAM_FILE, contents: "// the agent\n" },
      { path: "sources.json", contents: '{"sources":[]}' },
    ],
    skipped: 0,
    known: false,
    ...over,
  };
}

describe("what DASH will not walk into", () => {
  it("skips what is never part of an agent", () => {
    /*
     * The list is why an ordinary project does not hit the ceilings. Its
     * contents are reproducible from the program, routinely larger than
     * everything else combined, and not what anybody means by "this agent's
     * folder".
     */
    for (const name of ["node_modules", ".git", "dist", "build", ".next"]) {
      expect(isSkippedFolderEntry(name), name).toBe(true);
    }
  });

  it("does not skip anything an agent is made of", () => {
    for (const name of [AGENT_PROGRAM_FILE, "sources.json", "code", "assets", "README.md"]) {
      expect(isSkippedFolderEntry(name), name).toBe(false);
    }
  });
});

describe("a folder that is not an agent", () => {
  it("refuses a folder with no plan in it, and says which folder to pick instead", () => {
    const decision = inspectChosenFolder(read({ manifestJson: null, files: [] }));
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe("not_an_agent");
    expect(decision.explanation?.kind).toBe("no_agent_in_folder");
    // The person's next move is a different folder, and no amount of editing
    // this one would help — so the suggestion is about choosing, not fixing.
    expect(decision.explanation?.suggestion).toMatch(/choose the folder/i);
  });

  it("refuses a damaged plan with the not-JSON explanation, not a schema one", () => {
    const decision = inspectChosenFolder(read({ manifestJson: "{ not json" }));
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.explanation?.kind).toBe("not_json");
  });

  it("refuses a plan the contract rejects, in the contract's own words", () => {
    /*
     * MAR-598's gate, and the whole reason this door reuses
     * `explainImportFailure`: an agent author who picks a folder gets the same
     * headline, the same suggestion and the same validator output they would get
     * from pasting the plan or from editing the folder from outside. One
     * refusal, three doors.
     */
    const decision = inspectChosenFolder(
      read({
        manifestJson: JSON.stringify({ manifest_version: 2, agent: { name: AGENT_ID } }),
      }),
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.explanation).not.toBeNull();
    expect(decision.explanation?.raw.length ?? 0).toBeGreaterThan(0);
    expect(decision.card.meaning).toMatch(/exactly as you left it/i);
  });

  it("refuses a version DASH does not understand with the version explanation", () => {
    const decision = inspectChosenFolder(
      read({ manifestJson: JSON.stringify({ manifest_version: 9, agent: { name: AGENT_ID } }) }),
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.explanation?.kind).toBe("unsupported_version");
  });
});

describe("a folder DASH already keeps", () => {
  /**
   * Every way of landing inside DASH's own keeping, because a check that only
   * recognised the exact destination would let the two neighbours through into a
   * self-overwriting import.
   */
  const insideDash = [
    path.join(DATA_DIR, "agents", AGENT_ID),
    path.join(DATA_DIR, "agents"),
    path.join(DATA_DIR, "agents", "some-other-agent"),
    path.join(DATA_DIR, "agents", AGENT_ID, "code"),
  ];

  for (const folder of insideDash) {
    it(`refuses ${path.basename(folder)} rather than re-importing it over itself`, () => {
      const decision = inspectChosenFolder(read({ folder, known: true }));
      expect(decision.ok).toBe(false);
      if (decision.ok) return;
      expect(decision.refusal).toBe("already_stored");
      // No validator ran and none should have: the plan is fine. What is wrong
      // is the folder, and there is a door for it.
      expect(decision.explanation).toBeNull();
      expect(decision.card.next_action).toMatch(/check for changes/i);
    });
  }

  it("does not refuse a folder that merely sits beside DASH's data directory", () => {
    const decision = inspectChosenFolder(
      read({ folder: path.join(DATA_DIR, "..", "my-agents", AGENT_ID) }),
    );
    expect(decision.ok).toBe(true);
  });
});

describe("a folder DASH may not store", () => {
  it("refuses a name that cannot be a folder, in the contract's own words", () => {
    const decision = inspectChosenFolder(
      read({ manifestJson: v2Manifest((m) => ((m["agent"] as { name: string }).name = "../escape")) }),
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.explanation?.kind).toBe("invalid_agent_folder_name");
  });

  it("refuses a file that would leave the agent's own folder", () => {
    const decision = inspectChosenFolder(
      read({
        files: [
          { path: AGENT_MANIFEST_FILE, contents: v2Manifest() },
          { path: "../../elsewhere.mjs", contents: "// no" },
        ],
      }),
    );
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe("cannot_store");
    expect(decision.explanation?.raw.length ?? 0).toBeGreaterThan(0);
  });
});

describe("a folder DASH can take", () => {
  it("copies it into DASH's own keeping, and says so", () => {
    const decision = inspectChosenFolder(read());
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.agent).toBe(AGENT_ID);
    expect(decision.destination).toBe(path.join(DATA_DIR, "agents", AGENT_ID));
    expect(decision.replaced).toBe(false);
  });

  it("registers it against the interpreter DASH ships, not the machine's", () => {
    /*
     * The single decision that makes this button usable by the person it is for.
     * The Agent Kit registers `node` because somebody who typed `npx`
     * demonstrably has it; the reader of this page installed DASH from the Store
     * and has never installed anything else. A registration naming `node` would
     * spawn-fail on their machine and end first run in a setup.
     */
    const decision = inspectChosenFolder(read());
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.registration?.command).toBe(BUNDLED_NODE_COMMAND);
    expect(decision.registration?.args).toEqual([AGENT_PROGRAM_FILE]);
  });

  it("finds the program whether the project keeps it at the root or under code", () => {
    // Both layouts map to the same stored location, so both are startable. A
    // check written against the declared path would have recognised one.
    const nested = inspectChosenFolder(
      read({
        files: [
          { path: AGENT_MANIFEST_FILE, contents: v2Manifest() },
          { path: `code/${AGENT_PROGRAM_FILE}`, contents: "// the agent\n" },
        ],
      }),
    );
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect(nested.registration).not.toBeUndefined();
  });

  it("takes a plan with no program, and refuses to pretend it can run it", () => {
    /*
     * ADR 0008's manifest-only standing, reached honestly. Writing a
     * registration here would produce a Start button the runner refuses at
     * spawn, which is the dead control `lib/connection-spec.ts` closes its
     * vocabulary to prevent.
     */
    const decision = inspectChosenFolder(
      read({ files: [{ path: AGENT_MANIFEST_FILE, contents: v2Manifest() }] }),
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.registration).toBeUndefined();
    expect(decision.prompt.detail).toMatch(/without running it/i);
  });

  it("says it is replacing, not adding, when DASH already holds the agent", () => {
    const decision = inspectChosenFolder(read({ known: true }));
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.replaced).toBe(true);
    expect(decision.prompt.title).toBe("Update this agent?");
    expect(decision.prompt.confirm_label).toBe("Replace it");
    // What survives is named, because the two things people fear losing are what
    // the agent made and the agent they recognise.
    expect(decision.prompt.detail).toMatch(/everything it has produced/i);
  });
});

describe("the question DASH asks", () => {
  const decision = inspectChosenFolder(read());
  const prompt = decision.ok ? decision.prompt : null;

  it("is plain language, apart from the two folders and the program", () => {
    expect(prompt).not.toBeNull();
    if (prompt === null) return;
    /*
     * The exemptions are the caller's, at the call site, and they are the two
     * `lib/copy/identifiers.ts` names as content rather than vocabulary: a
     * folder the user chose, a folder DASH chose on their behalf, and the
     * command that is about to run. Everything else in this dialog is held to
     * the rule.
     */
    expectPlainLanguage([prompt.title, prompt.message, prompt.detail], {
      allow: [
        CHOSEN,
        decision.ok ? decision.destination : "",
        AGENT_PROGRAM_FILE,
        // The example manifest's own author text, which is content by definition.
        JSON.parse(v2Manifest()).agent.goal as string,
      ],
    });
  });

  it("names both folders before a byte is copied", () => {
    // The issue's rule, in the one place it has to hold: the dialog, before the
    // decision, rather than only in the receipt afterwards.
    expect(prompt?.detail).toContain(CHOSEN);
    expect(prompt?.detail).toContain(decision.ok ? decision.destination : "never");
  });

  it("counts what it will copy, and says out loud what it is leaving", () => {
    /*
     * "DASH is about to take a copy of your folder" is only exactly true when
     * everything is coming. A file DASH cannot store — an icon, a compiled
     * artifact — is a real gap in that promise, so it is stated with its number
     * before anybody agrees, rather than discovered afterwards by a person
     * wondering why their agent's picture is missing.
     */
    expect(prompt?.detail).toMatch(/copy 3 files into a folder of its own/);
    expect(prompt?.detail).not.toMatch(/not being copied/);

    const withSkips = inspectChosenFolder(read({ skipped: 2 }));
    expect(withSkips.ok).toBe(true);
    if (!withSkips.ok) return;
    expect(withSkips.prompt.detail).toMatch(/2 files are not being copied/);

    // "1 files are" is the smallest possible way for a dialog to look
    // unfinished, so the verb agrees too.
    const one = inspectChosenFolder(read({ skipped: 1 }));
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.prompt.detail).toMatch(/1 file is not being copied, because it is not text/);
  });

  it("promises a copy and never a move", () => {
    expect(prompt?.detail).toMatch(/DASH will copy .* into a folder of its own/i);
    expect(prompt?.detail).toMatch(/not moved, changed or deleted/i);
  });

  it("says what will run, and does not claim it starts now", () => {
    /*
     * `startSentence` is the handoff's own function rather than a copy, so both
     * doors describe the same program the same way. What differs is the
     * *when*, and this door's honest answer is not "now" — nothing in this flow
     * makes the part of DASH that supervises agents re-read its list.
     */
    expect(prompt?.detail).toMatch(/DASH will start it by running/i);
    expect(prompt?.detail).toMatch(/next time you open DASH/i);
    expect(prompt?.confirm_label).toBe("Add it");
    expect(prompt?.confirm_label).not.toMatch(/start/i);
  });

  it("defaults to no, by never labelling the cancel as a decision to act", () => {
    expect(prompt?.cancel_label).toBe("Not now");
  });
});
