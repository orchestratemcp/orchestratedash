/**
 * Where a saved briefing goes, and what a file name is allowed to name
 * (MAR-697).
 *
 * Two properties, and they are not the same shape of claim. The numbering is
 * arithmetic and is tested against a real directory only because the collision
 * it prevents is a real one. The containment check is the security argument
 * behind letting the renderer send a file name at all, so it is tested against
 * the strings somebody would actually send.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  EXPORTS_DIRECTORY,
  agentExportsPath,
  listAgentExports,
  prepareAgentExports,
  resolveAgentExport,
  unusedExportName,
} from "../lib/agent-exports";
import { briefFileName } from "../electron/brief-pdf";

const roots: string[] = [];

function dataDir(): string {
  const root = mkdtempSync(path.join(tmpdir(), "dash-exports-"));
  roots.push(root);
  return root;
}

/** One saved PDF, with a modified time the ordering test can rely on. */
function save(root: string, agent: string, file: string, minutesAgo: number): string {
  const folder = agentExportsPath(root, agent);
  mkdirSync(folder, { recursive: true });
  const full = path.join(folder, file);
  writeFileSync(full, "%PDF-1.7\n");
  const when = new Date(Date.UTC(2026, 7, 18, 12, 0, 0) - minutesAgo * 60_000);
  utimesSync(full, when, when);
  return full;
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("where exports live", () => {
  /**
   * The deviation from MAR-697's own wording, pinned so it cannot be quietly
   * undone.
   *
   * The issue asked for `agents/<agent>/`. `writeAgentFolder` commits by
   * renaming the whole agent folder aside and a freshly staged one into its
   * place, so anything under it that was not in the staged input is gone the
   * moment somebody re-imports the agent or accepts an outside edit — ordinary
   * actions, not repairs. A person's saved briefings must not depend on nobody
   * pressing Accept.
   */
  it("keeps exports out of the folder that gets swapped on re-import", () => {
    const root = dataDir();
    const exports = agentExportsPath(root, "ai-news-scout");

    expect(exports).toBe(path.join(root, EXPORTS_DIRECTORY, "ai-news-scout"));
    expect(exports.startsWith(path.join(root, "agents"))).toBe(false);
  });

  it("refuses an agent name that is not a folder component", () => {
    const root = dataDir();
    expect(() => agentExportsPath(root, "../elsewhere")).toThrow();
    expect(() => agentExportsPath(root, "a/b")).toThrow();
  });

  it("makes the folder on the first export and reports it as empty", () => {
    const root = dataDir();
    const { folder, existing } = prepareAgentExports(root, "ai-news-scout");

    expect(folder).toBe(agentExportsPath(root, "ai-news-scout"));
    expect(existing).toEqual([]);
  });
});

describe("naming a second copy of the same briefing", () => {
  it("uses the desired name when nothing has it", () => {
    expect(unusedExportName([], "News from 3 sources.pdf")).toBe("News from 3 sources.pdf");
  });

  /*
   * Overwriting was the alternative and is worse in exactly the case a daily
   * agent produces: the same title every morning, and Monday's document
   * replaced by Tuesday's with no press and nothing on screen to say so.
   */
  it("numbers rather than overwrites, in the shape every operating system uses", () => {
    const taken = ["News from 3 sources.pdf"];
    expect(unusedExportName(taken, "News from 3 sources.pdf")).toBe(
      "News from 3 sources (2).pdf",
    );
    expect(
      unusedExportName([...taken, "News from 3 sources (2).pdf"], "News from 3 sources.pdf"),
    ).toBe("News from 3 sources (3).pdf");
  });

  it("compares without regard to case, because Windows does", () => {
    expect(unusedExportName(["news from 3 sources.pdf"], "News from 3 sources.pdf")).toBe(
      "News from 3 sources (2).pdf",
    );
  });

  it("keeps the extension on the end where a program will look for it", () => {
    expect(unusedExportName(["a.b.pdf"], "a.b.pdf")).toBe("a.b (2).pdf");
  });
});

describe("listing what DASH has saved", () => {
  it("answers nothing for an agent that has exported nothing", () => {
    expect(listAgentExports(dataDir(), "ai-news-scout")).toEqual([]);
  });

  it("lists newest first, with the name a person would recognise", () => {
    const root = dataDir();
    save(root, "ai-news-scout", "Older briefing.pdf", 120);
    save(root, "ai-news-scout", "Newest briefing.pdf", 5);
    save(root, "ai-news-scout", "Middle briefing.pdf", 60);

    const listed = listAgentExports(root, "ai-news-scout");
    expect(listed.map((entry) => entry.file)).toEqual([
      "Newest briefing.pdf",
      "Middle briefing.pdf",
      "Older briefing.pdf",
    ]);
    // The label is the document's own name without the extension — what the
    // person called it, which is what the link on the stage says.
    expect(listed[0]?.label).toBe("Newest briefing");
    expect(listed[0]?.bytes).toBeGreaterThan(0);
  });

  it("shows one agent's exports and never another's", () => {
    const root = dataDir();
    save(root, "ai-news-scout", "Scout briefing.pdf", 5);
    save(root, "competitor-scout", "Rival briefing.pdf", 5);

    expect(listAgentExports(root, "ai-news-scout").map((entry) => entry.file)).toEqual([
      "Scout briefing.pdf",
    ]);
  });

  it("caps the list, because this is a component on a stage and not an archive", () => {
    const root = dataDir();
    for (let index = 0; index < 12; index += 1) {
      save(root, "ai-news-scout", `Briefing ${String(index)}.pdf`, index);
    }
    expect(listAgentExports(root, "ai-news-scout", 8)).toHaveLength(8);
  });

  it("offers no directory as if it were a document", () => {
    const root = dataDir();
    save(root, "ai-news-scout", "A briefing.pdf", 5);
    mkdirSync(path.join(agentExportsPath(root, "ai-news-scout"), "not-a-document"));

    expect(listAgentExports(root, "ai-news-scout").map((entry) => entry.file)).toEqual([
      "A briefing.pdf",
    ]);
  });
});

describe("what a file name from the renderer may resolve to", () => {
  it("resolves a file DASH saved", () => {
    const root = dataDir();
    const full = save(root, "ai-news-scout", "A briefing.pdf", 5);

    expect(resolveAgentExport(root, "ai-news-scout", "A briefing.pdf")).toBe(full);
  });

  /**
   * The security argument behind sending a name at all.
   *
   * This command ends in `shell.openPath`, so a name that could escape the
   * folder would be a page opening anything on the computer. Every one of these
   * is a string somebody would actually send.
   */
  it.each([
    "../../agents/ai-news-scout/agent.manifest.json",
    "..\\..\\dash.sqlite",
    "C:\\Windows\\System32\\cmd.exe",
    "/etc/passwd",
    "sub/dir.pdf",
    "..",
    ".",
    "NUL",
    "a\u0000.pdf",
  ])("refuses %j", (candidate) => {
    const root = dataDir();
    save(root, "ai-news-scout", "A briefing.pdf", 5);

    expect(resolveAgentExport(root, "ai-news-scout", candidate)).toBeNull();
  });

  it("refuses anything that is not a string, because the caller is downstream of a page", () => {
    const root = dataDir();
    for (const candidate of [undefined, null, 7, {}, ["A briefing.pdf"], ""]) {
      expect(resolveAgentExport(root, "ai-news-scout", candidate)).toBeNull();
    }
  });

  it("refuses one agent's name pointed at another agent's export", () => {
    const root = dataDir();
    save(root, "competitor-scout", "Rival briefing.pdf", 5);

    expect(resolveAgentExport(root, "ai-news-scout", "Rival briefing.pdf")).toBeNull();
  });

  it("answers null for a file that has since been deleted", () => {
    // A stale list is the ordinary way this happens: the page was drawn a
    // moment ago and somebody has removed the document since.
    const root = dataDir();
    const full = save(root, "ai-news-scout", "A briefing.pdf", 5);
    rmSync(full);

    expect(resolveAgentExport(root, "ai-news-scout", "A briefing.pdf")).toBeNull();
  });

  /**
   * MAR-740, end to end. A title carrying an em dash is what a model actually
   * writes, and this is the whole path a saved-files click drives: the same
   * name `briefFileName`/`unusedExportName` chose is the name a later click
   * must resolve, and the containment check must still hold on it.
   */
  it("resolves a name built from a title with an em dash, containment intact", () => {
    const root = dataDir();
    const { folder, existing } = prepareAgentExports(root, "competitor-scout");
    const name = unusedExportName(
      existing,
      briefFileName("Competitor brief — OpenClaw and Hermes Agent"),
    );
    expect(name).toBe("Competitor brief - OpenClaw and Hermes Agent.pdf");
    writeFileSync(path.join(folder, name), "%PDF-1.7\n");

    expect(resolveAgentExport(root, "competitor-scout", name)).toBe(path.join(folder, name));
    // The fold does not loosen the containment check next to it.
    expect(resolveAgentExport(root, "competitor-scout", "../elsewhere/" + name)).toBeNull();
  });
});
