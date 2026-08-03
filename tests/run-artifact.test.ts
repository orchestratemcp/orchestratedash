/**
 * Run artifacts: the contract, the pipe, and the ingest boundary (MAR-457).
 *
 * Wave 0's "digest artifact" proof looked for a file in the agent's own project
 * folder. That is evidence the *agent* wrote something and no evidence at all
 * that DASH can show it. These cover the seam that turns the second claim into
 * one that can honestly be made, and they cover it at the same three points the
 * telemetry path is covered at: the schema, the NDJSON envelope, and ingest.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateArtifact } from "../lib/contracts";
import { parseAgentMessage } from "../runner/protocol";

/** A minimal artifact that validates, so each case can vary one thing. */
function artifact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifact_version: 1,
    agent: "ai-news-scout",
    run_id: "run-1",
    artifact_id: "digest-1",
    kind: "digest",
    title: "Today's AI agent news",
    generated_at: "2026-08-01T09:00:00.000Z",
    sources_fetched: [
      {
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
        status: "ok",
        item_count: 2,
      },
    ],
    items: [
      {
        headline: "Something happened",
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
      },
    ],
    ...overrides,
  };
}

describe("the artifact contract", () => {
  it("accepts a digest carrying sources and cited items", () => {
    const result = validateArtifact(artifact());
    expect(result.ok).toBe(true);
  });

  it("keeps an uncited item rather than requiring a source", () => {
    // Dropping it would be how a grounded verdict becomes theatre: the run would
    // score clean by hiding the evidence against it. `source_url` is therefore
    // optional in the schema and a finding in the analysis, not a validation
    // error here.
    const result = validateArtifact(
      artifact({ items: [{ headline: "No source for this one" }] }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses an artifact with no stable id", () => {
    const result = validateArtifact(artifact({ artifact_id: "" }));
    expect(result.ok).toBe(false);
  });

  it("refuses a version it was not written for", () => {
    const result = validateArtifact(artifact({ artifact_version: 2 }));
    expect(result.ok).toBe(false);
  });

  it("keeps the four source outcomes apart", () => {
    // They lead to four different recoveries. A schema that collapsed them into
    // a boolean would make `lib/copy/recovery.ts` unable to tell "that address
    // is not a feed" from "this computer may be offline".
    for (const status of ["ok", "unreachable", "not_a_feed", "empty"]) {
      const result = validateArtifact(
        artifact({
          sources_fetched: [
            { source_name: "A source", source_url: "https://example.com/feed", status },
          ],
        }),
      );
      expect(result.ok, status).toBe(true);
    }

    const invalid = validateArtifact(
      artifact({
        sources_fetched: [
          { source_name: "A source", source_url: "https://example.com/feed", status: "broken" },
        ],
      }),
    );
    expect(invalid.ok).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * Where a draft actually is (MAR-469)
 * ---------------------------------------------------------------------- */

/** A minimal draft artifact. `placement` is supplied per case, never defaulted. */
function draftArtifact(placement: unknown): Record<string, unknown> {
  return {
    artifact_version: 1,
    agent: "synthetic-gmail-meeting-assistant",
    run_id: "run-1",
    artifact_id: "draft-1",
    kind: "draft",
    title: "Reply to Thursday",
    generated_at: "2026-08-03T09:00:00.000Z",
    draft: {
      to: ["colleague@example.com"],
      subject: "Re: Thursday",
      body: "The afternoon works.",
      placement,
    },
  };
}

describe("a draft's placement", () => {
  it("accepts the local placement MAR-458 shipped", () => {
    expect(validateArtifact(draftArtifact({ where: "dash_only" })).ok).toBe(true);
  });

  it("accepts a draft the agent says it created at the provider", () => {
    expect(
      validateArtifact(
        draftArtifact({ where: "provider_draft", service: "Gmail", draft_id: "r-991" }),
      ).ok,
    ).toBe(true);
  });

  /**
   * The load-bearing one, and the reason `placement` is required rather than
   * optional.
   *
   * Until MAR-469 the `draft` kind *meant* local, and both the schema and the
   * renderer said so. Stage 2 made that false for some drafts without changing
   * the kind, so an artifact that does not say where the reply is would leave a
   * renderer to guess — and the wrong guess tells a person nothing left DASH
   * when a copy is sitting in their mailbox. There is no safe default here, so
   * there is no default.
   */
  it("refuses a draft that does not say where the reply is", () => {
    const artifact = draftArtifact({ where: "dash_only" });
    delete (artifact["draft"] as Record<string, unknown>)["placement"];
    expect(validateArtifact(artifact).ok).toBe(false);
  });

  it("refuses a placement DASH has no meaning for", () => {
    expect(validateArtifact(draftArtifact({ where: "sent" })).ok).toBe(false);
    expect(validateArtifact(draftArtifact({ where: "provider_draft" })).ok).toBe(false);
  });

  /**
   * The absence fixture that pairs with the presence one above.
   *
   * A `dash_only` placement carrying a provider draft id is a contradiction: it
   * asserts nothing exists at the provider while naming the thing that does.
   * Refusing it means a renderer reading `where` alone is reading the whole
   * truth, which is what lets the copy branch on one field.
   */
  it("refuses a local placement that names a provider draft anyway", () => {
    expect(
      validateArtifact(draftArtifact({ where: "dash_only", draft_id: "r-991" })).ok,
    ).toBe(false);
  });
});

describe("the runner pipe", () => {
  it("recognises an artifact message", () => {
    const message = parseAgentMessage(
      `${JSON.stringify({ type: "artifact", artifact: artifact() })}\n`,
    );
    expect(message?.type).toBe("artifact");
  });

  it("hands the body on unvalidated, so ingest can reject it alone", () => {
    // The envelope parser deliberately does not apply the artifact schema. If it
    // did, a malformed artifact would be indistinguishable from ordinary agent
    // logging and would vanish instead of being recorded as rejected.
    const message = parseAgentMessage(
      `${JSON.stringify({ type: "artifact", artifact: { nonsense: true } })}\n`,
    );
    expect(message).toEqual({ type: "artifact", artifact: { nonsense: true } });
  });

  it("ignores an artifact message with no body", () => {
    expect(parseAgentMessage(`${JSON.stringify({ type: "artifact" })}\n`)).toBeNull();
  });
});

describe("ingest", () => {
  const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

  afterEach(() => {
    for (const entry of opened.splice(0)) {
      entry.closeDb();
      rmSync(entry.dataDir, { recursive: true, force: true });
    }
    delete process.env.DASH_DATA_DIR;
    vi.resetModules();
  });

  async function freshStore(): Promise<typeof import("../lib/store")> {
    const dataDir = mkdtempSync(path.join(tmpdir(), "dash-artifact-"));
    process.env.DASH_DATA_DIR = dataDir;
    vi.resetModules();
    const db = await import("../lib/db");
    const store = await import("../lib/store");
    opened.push({ dataDir, closeDb: db.closeDb });
    return store;
  }

  it("stores an artifact and reads it back for its run", async () => {
    const store = await freshStore();
    expect(store.ingestArtifacts(artifact()).accepted).toBe(1);

    const found = store.artifactsForRun("ai-news-scout", "run-1");
    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe("Today's AI agent news");
    const stored = found[0];
    expect(stored?.kind).toBe("digest");
    expect(stored?.kind === "digest" ? stored.items[0]?.source_url : null).toBe(
      "https://hn.algolia.com/api/v1/search",
    );
  });

  it("does not need the run row to exist first", async () => {
    // The pipe delivers what the agent wrote in the order it wrote it, and a
    // digest finished before the first telemetry drain is ordinary rather than
    // exceptional. A foreign key here would drop exactly the prompt ones.
    const store = await freshStore();
    expect(store.ingestArtifacts(artifact({ run_id: "never-seen" })).accepted).toBe(1);
    expect(store.artifactsForRun("ai-news-scout", "never-seen")).toHaveLength(1);
  });

  it("replaces a revised artifact rather than keeping both", async () => {
    const store = await freshStore();
    store.ingestArtifacts(artifact());
    store.ingestArtifacts(artifact({ title: "Corrected" }));

    const found = store.artifactsForRun("ai-news-scout", "run-1");
    expect(found).toHaveLength(1);
    expect(found[0]?.title).toBe("Corrected");
  });

  it("rejects one malformed artifact without discarding its neighbours", async () => {
    const store = await freshStore();
    const result = store.ingestArtifacts([
      artifact({ artifact_id: "good-1" }),
      { artifact_version: 1, agent: "ai-news-scout" },
      artifact({ artifact_id: "good-2" }),
    ]);

    expect(result.accepted).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.index).toBe(1);
  });

  it("refuses an artifact published under another agent's name", async () => {
    // Stricter in consequence than the equivalent event check: an artifact is
    // the document a person reads and acts on, so this would be one agent
    // putting words in another's mouth on a surface built to be trusted.
    const store = await freshStore();
    const result = store.ingestArtifacts([artifact()], { sourceAgents: ["some-other-agent"] });

    expect(result.accepted).toBe(0);
    expect(result.rejected[0]?.errors[0]).toContain("must match the runner-hosted source");
    expect(store.artifactsForRun("ai-news-scout", "run-1")).toHaveLength(0);
  });
});
