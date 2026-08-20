/**
 * Setting an agent up again from the copy DASH already holds, decided (MAR-705).
 *
 * `lib/folder-repair.ts` is pure of Electron precisely so this file can exist:
 * every branch a person can reach — no folder, a damaged plan, a plan the
 * contract refuses, a plan that has become a *different agent*, a folder with no
 * program in it — is exercised on every push rather than by pressing a native
 * dialog on one developer's Windows box.
 *
 * ## The property these tests exist to hold
 *
 * That this door does everything the import door does **except copy the
 * folder**. `inspectChosenFolder` refuses a folder inside DASH's own keeping
 * because re-importing it would stage a replacement and swap it in, taking the
 * agent's own reports and run history with it. This module is that refusal's
 * answer rather than a way around it, so what is asserted below is that the
 * validation is the same, the registration is the same, the consent question is
 * still asked — and that nothing in the returned decision is a file to write.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AGENT_MANIFEST_FILE, AGENT_CODE_DIRECTORY } from "../lib/agent-folders";
import { BUNDLED_NODE_COMMAND } from "../lib/registration";
import { AGENT_PROGRAM_FILE } from "../lib/folder-import";
import { inspectHeldFolder, type HeldFolderRead } from "../lib/folder-repair";
import { REPAIR_AGENT_COPY } from "../lib/copy/repair";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const AGENT_ID = "ai-news-scout";

/**
 * Derived from the shipped example rather than transcribed, so it stays valid as
 * the schema evolves — `tests/folder-import.test.ts`'s reason for doing the same.
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

function read(over: Partial<HeldFolderRead> = {}): HeldFolderRead {
  return {
    agent: AGENT_ID,
    manifestJson: v2Manifest(),
    hasProgram: true,
    ...over,
  };
}

describe("an agent DASH can set up again", () => {
  /**
   * The whole point of MAR-705 in one test: the registration DASH would write is
   * the one the import door writes, built from the stored layout's own paths.
   */
  it("registers the bundled interpreter against the stored program", () => {
    const decision = inspectHeldFolder(read());

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.registration).toEqual({
      agent_id: AGENT_ID,
      manifest_path: AGENT_MANIFEST_FILE,
      // Not `node`. The person this button is for installed DASH from the Store
      // and has never installed anything else.
      command: BUNDLED_NODE_COMMAND,
      args: [AGENT_PROGRAM_FILE],
      cwd: AGENT_CODE_DIRECTORY,
    });
  });

  it("carries the author's display name into the question", () => {
    const decision = inspectHeldFolder(read());

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.display_name).toBe("AI News Scout");
    expect(decision.prompt.message).toContain("AI News Scout");
  });

  /**
   * MAR-595 finding 10, at this door too. `display_name` is optional in the
   * schema, and an agent without one must not be shown the raw slug.
   */
  it("humanises a name the author did not declare", () => {
    const decision = inspectHeldFolder(
      read({
        manifestJson: v2Manifest((manifest) => {
          delete (manifest["agent"] as Record<string, unknown>)["display_name"];
        }),
      }),
    );

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.display_name).toBe("Ai news scout");
    expect(decision.display_name).not.toBe(AGENT_ID);
  });

  /**
   * The promise the dialog has to make, because it is the fear somebody brings
   * to a button called Repair.
   *
   * This door reads the folder and never writes it — that is the entire
   * difference between it and a re-import, and it is the reason
   * `inspectChosenFolder`'s refusal of DASH's own folder stays in place. A
   * dialog that did not say so would be asking for consent to the wrong act.
   */
  it("promises the folder is only read, and names what will run", () => {
    const decision = inspectHeldFolder(read());

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.prompt.detail).toContain("only read, never changed");
    // `startSentence`'s sentence: a dialog asking permission to execute
    // something must say what.
    expect(decision.prompt.detail).toContain(AGENT_PROGRAM_FILE);
    expectPlainLanguage(
      [
        decision.prompt.title,
        decision.prompt.message,
        decision.prompt.detail,
        decision.prompt.confirm_label,
        decision.prompt.cancel_label,
      ],
      {
        // The program's own filename, allowed for `describeChosenFolder`'s
        // reason and named in the same way its test names it: a dialog that
        // asks permission to execute something while declining to say what
        // would be worse than the jargon it was avoiding.
        allow: [AGENT_PROGRAM_FILE],
      },
    );
  });
});

describe("an agent DASH cannot start", () => {
  /**
   * ADR 0008's manifest-only standing, kept rather than papered over.
   *
   * The record is still repairable — the plan is valid and DASH will accept it —
   * but there is nothing to spawn, so no registration is written. Writing one
   * would produce exactly the after-the-press refusal every door in this area is
   * built to avoid.
   */
  it("repairs the plan and writes no registration when the folder has no program", () => {
    const decision = inspectHeldFolder(read({ hasProgram: false }));

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.registration).toBeUndefined();
    expect(decision.prompt.detail).toContain("will not make it startable");
  });

  /**
   * v1 is deliberately never startable: `runner/README.md` requires v2 before
   * spawning anything, so a registration here would be one the runner refuses.
   */
  it("writes no registration for a v1 plan even with a program present", () => {
    const decision = inspectHeldFolder(
      read({
        manifestJson: JSON.stringify({
          manifest_version: 1,
          agent: { name: AGENT_ID, goal: "Find the news", display_name: "AI News Scout" },
        }),
      }),
    );

    if (decision.ok) {
      expect(decision.registration).toBeUndefined();
    }
  });
});

describe("what it refuses, before anybody is asked", () => {
  it("refuses when there is no plan to read", () => {
    const decision = inspectHeldFolder(read({ manifestJson: null }));

    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe("folder_unreadable");
    expect(decision.detail).toBe(REPAIR_AGENT_COPY.no_folder);
  });

  it("refuses a damaged plan and says the validator ran on nothing", () => {
    const decision = inspectHeldFolder(read({ manifestJson: "{not json" }));

    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe("not_an_agent");
    expect(decision.explanation).not.toBeNull();
  });

  /**
   * The same bar a fresh import applies, applied here.
   *
   * `readCurrentManifest`'s rule: a change that would be refused at the front
   * door must not be accepted through this one, and a folder edited by hand
   * since it was accepted is the ordinary way to arrive with a plan that no
   * longer passes.
   */
  it("refuses a plan the contract rejects, and carries the checker's own account", () => {
    const decision = inspectHeldFolder(
      read({ manifestJson: JSON.stringify({ manifest_version: 9, agent: { name: AGENT_ID } }) }),
    );

    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe("not_an_agent");
    expect(decision.explanation).not.toBeNull();
    expect(decision.explanation?.raw.length ?? 0).toBeGreaterThan(0);
  });

  /**
   * The one refusal here that is about identity.
   *
   * `acceptFolderManifest` refuses this too, inside the transaction — this is
   * here so it arrives *before* the dialog rather than after somebody agreed.
   * Repairing from a folder that now describes a different agent would file
   * somebody else's program under this agent's history and connected accounts.
   */
  it("refuses a folder whose plan has become a different agent", () => {
    const decision = inspectHeldFolder(
      read({
        manifestJson: v2Manifest((manifest) => {
          (manifest["agent"] as Record<string, unknown>)["name"] = "someone-elses-scout";
        }),
      }),
    );

    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe("different_agent");
    expect(decision.detail).toBe(REPAIR_AGENT_COPY.different_agent);
  });

  /**
   * Every sentence a person can reach here, held to the plain-language bar.
   *
   * All of them together rather than the refusals alone, because this control is
   * met by somebody whose agent has stopped working — the least forgiving moment
   * on the page for DASH's internal vocabulary to surface.
   */
  it("says every sentence a person can reach in plain language", () => {
    expectPlainLanguage(Object.values(REPAIR_AGENT_COPY));
  });
});
