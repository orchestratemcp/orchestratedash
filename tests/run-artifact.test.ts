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
    // Was `2` until ADR 0025 widened the enum. The intent is unchanged and the
    // number moved: an artifact declaring a version this build has never heard
    // of is refused whole rather than read partly.
    const result = validateArtifact(artifact({ artifact_version: 3 }));
    expect(result.ok).toBe(false);
  });

  it("accepts a digest at version 2", () => {
    const result = validateArtifact(artifact({ artifact_version: 2 }));
    expect(result.ok).toBe(true);
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
 * The deep dive (MAR-691)
 * ---------------------------------------------------------------------- */

describe("a digest's deep dive", () => {
  it("accepts a digest that never attempts one", () => {
    expect(validateArtifact(artifact()).ok).toBe(true);
  });

  it("accepts one the model wrote", () => {
    const result = validateArtifact(
      artifact({ deep_dive: { state: "written", text: "A closer look." } }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts one the model wrote with a reported provider", () => {
    const result = validateArtifact(
      artifact({
        deep_dive: { state: "written", text: "A closer look.", model: "openai/gpt-5-mini" },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a written deep dive with no text", () => {
    // The one thing that makes it written rather than not — the same rule
    // `curation`'s `curated` branch keeps for `groups`.
    const result = validateArtifact(artifact({ deep_dive: { state: "written" } }));
    expect(result.ok).toBe(false);
  });

  it("accepts every reason nothing was written, and refuses one missing its reason", () => {
    // The eight reasons the real sample agent emits today, including the two
    // that are not refusals at all (`nothing_picked`, `nothing_found`) — this
    // is what keeps a not-yet-armed first run validating against the same
    // schema as a run a provider actually refused.
    for (const reason of [
      "nothing_picked",
      "nothing_found",
      "no_model_connection",
      "not_connected",
      "no_model_chosen",
      "needs_a_person",
      "unreadable",
      "refused",
    ]) {
      const result = validateArtifact(
        artifact({ deep_dive: { state: "not_written", reason } }),
      );
      expect(result.ok, reason).toBe(true);
    }

    const missingReason = validateArtifact(artifact({ deep_dive: { state: "not_written" } }));
    expect(missingReason.ok).toBe(false);
  });

  it("refuses text over the length ceiling", () => {
    const result = validateArtifact(
      artifact({ deep_dive: { state: "written", text: "x".repeat(12_001) } }),
    );
    expect(result.ok).toBe(false);
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

/**
 * What the agent left out, and the regression this block exists to prevent
 * (ADR 0025).
 *
 * `set_aside` is not new to the wire. The competitor scout has emitted it since
 * MAR-647, travelling under this schema's open `additionalProperties` and
 * rendering nowhere — so the moment the contract *defines* the field, its shape
 * starts being checked, and a definition stricter than what is already flying
 * rejects every artifact the one real agent produces.
 *
 * The first case below is that agent's exact shape, read out of
 * `../competitor-scout/agent.mjs`. It is the whole reason `reason` is optional
 * and the reason nothing but `headline` is constrained.
 */
describe("what was set aside", () => {
  /** The scout's real shape, verbatim: no reason, and two fields DASH does not read. */
  const scoutEntries = [
    {
      headline: "orchestrate-ci published v0.4.2",
      competitor: "OpenClaw",
      item_url: "https://example.test/releases/v0-4-2",
    },
  ];

  it("accepts the shape the competitor scout already emits, at version 1", () => {
    const result = validateArtifact(artifact({ set_aside: scoutEntries }));
    expect(result.ok).toBe(true);
  });

  it("does not require version 2 for it, unlike a brief", () => {
    // Gating an in-flight field on a version bump would break a working agent
    // to enforce a number. The versioned member is the one carrying a new kind.
    const v2 = validateArtifact(artifact({ artifact_version: 2, set_aside: scoutEntries }));
    expect(v2.ok).toBe(true);
  });

  it("accepts every reason in the closed set", () => {
    for (const reason of ["no_signal", "duplicate", "off_topic", "too_old", "unparseable"]) {
      const result = validateArtifact(
        artifact({ set_aside: [{ headline: "Left out", reason }] }),
      );
      expect(result.ok, reason).toBe(true);
    }
  });

  it("refuses a reason DASH has no sentence for", () => {
    // Closed so the words a person reads are DASH's. Free text here would put
    // agent-authored prose on the surface whose job is DASH's own accounting.
    const result = validateArtifact(
      artifact({ set_aside: [{ headline: "Left out", reason: "did not like it" }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("requires the one field DASH renders", () => {
    const result = validateArtifact(artifact({ set_aside: [{ reason: "duplicate" }] }));
    expect(result.ok).toBe(false);
  });
});

/**
 * The brief, and the join it is only allowed to make when it can be checked
 * (ADR 0025 amendment 1).
 */
describe("a brief", () => {
  function brief(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      artifact_version: 2,
      agent: "ai-news-scout",
      run_id: "run-1",
      artifact_id: "brief-1",
      kind: "brief",
      title: "What the news adds up to",
      generated_at: "2026-08-01T09:00:00.000Z",
      document: {
        sections: [
          {
            heading: "Agents got cheaper",
            paragraphs: [{ body: "Two providers cut their prices this week.", items: [0, 1] }],
          },
        ],
      },
      derived_from: {
        artifact_id: "digest-1",
        run_id: "run-1",
        item_count: 2,
        items_digest: "a".repeat(64),
      },
      ...overrides,
    };
  }

  it("accepts a document bound to a digest it names", () => {
    expect(validateArtifact(brief()).ok).toBe(true);
  });

  it("refuses a brief at version 1", () => {
    // The version is what makes "this producer was written against the contract
    // that has a document in it" checkable rather than inferred from a member.
    expect(validateArtifact(brief({ artifact_version: 1 })).ok).toBe(false);
  });

  it("refuses a brief with no document", () => {
    const { document: _dropped, ...rest } = brief();
    expect(validateArtifact(rest).ok).toBe(false);
  });

  it("refuses a brief that does not say which list it cites", () => {
    // The sharp one. A paragraph's `items` are positions into another
    // artifact's array, so a brief with no `derived_from` carries numbers
    // pointing at nothing checkable — which is worse than carrying none.
    const { derived_from: _dropped, ...rest } = brief();
    expect(validateArtifact(rest).ok).toBe(false);
  });

  it("refuses a fingerprint that is not a SHA-256", () => {
    for (const bad of ["", "not-a-hash", "A".repeat(64), "a".repeat(63)]) {
      expect(
        validateArtifact(brief({ derived_from: { ...(brief().derived_from as object), items_digest: bad } })).ok,
        bad,
      ).toBe(false);
    }
  });

  it("keeps a paragraph that cites nothing", () => {
    // Uncited prose is a verdict input, not an error — the same rule that keeps
    // an uncited item on screen. Dropping it is how the document would come to
    // look better grounded than it is.
    const result = validateArtifact(
      brief({
        document: {
          sections: [{ heading: "Context", paragraphs: [{ body: "A quiet week overall." }] }],
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a section with no heading and a paragraph with no body", () => {
    expect(
      validateArtifact(
        brief({ document: { sections: [{ paragraphs: [{ body: "x" }] }] } }),
      ).ok,
    ).toBe(false);
    expect(
      validateArtifact(
        brief({ document: { sections: [{ heading: "H", paragraphs: [{ items: [0] }] }] } }),
      ).ok,
    ).toBe(false);
  });

  it("bounds how much document one artifact may carry", () => {
    const tooMany = {
      sections: Array.from({ length: 9 }, (_value, index) => ({
        heading: `Section ${String(index)}`,
        paragraphs: [{ body: "Text." }],
      })),
    };
    expect(validateArtifact(brief({ document: tooMany })).ok).toBe(false);
  });

  it("does not require items, sources_fetched or anything else a digest requires", () => {
    // A brief is not a digest wearing a different label. It carries no items of
    // its own by design: the items live in the roundup it points at, which is
    // what "one RAW and one curated, don't mix them" means in the contract.
    expect(validateArtifact(brief()).ok).toBe(true);
  });
});
