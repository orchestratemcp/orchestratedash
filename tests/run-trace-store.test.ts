/**
 * What reaches the database, and what does not (MAR-889).
 *
 * Three claims, and each is checked against the bytes SQLite actually wrote or
 * the row it actually holds rather than against the intent of the code:
 *
 * 1. **A span is written twice and the second write revises the first.** That is
 *    what gives a run in flight a tree, and what leaves a span whose close never
 *    arrived honestly unfinished.
 * 2. **No credential reaches a row.** The filter is the same
 *    `forbiddenCredentialKeys` / `obviousSecretValues` pair
 *    `tests/contracts.test.ts` applies to every example in the repository — a
 *    `Bearer …` in `error.message` must never appear in the store, and neither
 *    must a token under an allowlisted attribute key.
 * 3. **The per-run cap refuses and counts.** A truncated trace that did not know
 *    it was truncated would draw a shorter run and call it complete.
 *
 * `tests/redaction.test.ts` established the pattern this file follows for the
 * second claim, including reading the `-wal`: in WAL mode a just-committed row
 * usually has not been checkpointed yet, so a scan of `dash.sqlite` alone can
 * pass while the value sits in plain sight beside it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { RunSpan } from "../lib/contracts";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-run-spans-"));
process.env["DASH_DATA_DIR"] = dataDir;

const { ingestSpans, spansForRun, MAX_SPANS_PER_RUN, REDACTED } = await import("../lib/store");
const { closeDb } = await import("../lib/db");
const { asStoredText, readStoreBytes } = await import("./helpers/store-bytes");

/** Distinctive values: if either appears in the store, it got there from here. */
const BEARER = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9payload";
const KEY = "sk-live-51H8kQrZ2vNpXwT9dEaLmB4c";

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

function span(over: Partial<RunSpan> & Pick<RunSpan, "span_id" | "run_id">): RunSpan {
  return {
    trace_version: 1,
    agent: "scout",
    parent_span_id: null,
    name: "Read a source",
    kind: "source_fetch",
    started_at: "2026-09-07T10:00:00.000Z",
    ended_at: null,
    status: "unknown",
    error: null,
    attributes: null,
    usage: null,
    ...over,
  };
}

describe("a span written twice", () => {
  it("revises the row rather than adding a second one", () => {
    const open = span({ span_id: "s-1", run_id: "run-open" });
    expect(ingestSpans(open)).toMatchObject({ accepted: 1, rejected: [] });

    const midRun = spansForRun("scout", "run-open");
    expect(midRun.spans).toHaveLength(1);
    // While it is open the row is honestly unfinished: no end, no outcome.
    expect(midRun.spans[0]?.ended_at).toBeNull();
    expect(midRun.spans[0]?.status).toBe("unknown");

    ingestSpans({ ...open, ended_at: "2026-09-07T10:00:02.000Z", status: "ok" });

    const settled = spansForRun("scout", "run-open");
    expect(settled.spans).toHaveLength(1);
    expect(settled.spans[0]?.ended_at).toBe("2026-09-07T10:00:02.000Z");
    expect(settled.spans[0]?.status).toBe("ok");
  });

  it("leaves a span whose close never arrived unfinished, for good", () => {
    // The agent died inside this operation. Nothing infers an ending from the
    // run having stopped, because an inferred ending is the one thing a trace
    // must never produce.
    ingestSpans(span({ span_id: "s-died", run_id: "run-died" }));
    const stored = spansForRun("scout", "run-died");
    expect(stored.spans[0]).toMatchObject({ ended_at: null, status: "unknown" });
  });

  it("keeps a null parent and a named one apart", () => {
    ingestSpans([
      span({ span_id: "root", run_id: "run-parents" }),
      span({ span_id: "child", run_id: "run-parents", parent_span_id: "root" }),
    ]);
    const stored = spansForRun("scout", "run-parents");
    const byId = new Map(stored.spans.map((each) => [each.span_id, each]));
    expect(byId.get("root")?.parent_span_id).toBeNull();
    expect(byId.get("child")?.parent_span_id).toBe("root");
  });
});

describe("the provenance the runner attaches", () => {
  it("refuses a span naming an agent other than the child that wrote it", () => {
    // The same binding `ingestEvents` and `ingestArtifacts` apply, and it
    // matters here for the artifact's reason: a span is drawn on a page beside
    // a run, so a hosted child publishing under another agent's run id would be
    // describing somebody else's work in its own words.
    const result = ingestSpans([span({ span_id: "s-x", run_id: "run-x", agent: "someone-else" })], {
      sourceAgents: ["scout"],
    });
    expect(result.accepted).toBe(0);
    expect(result.rejected[0]?.errors[0]).toContain("runner-hosted source");
    expect(spansForRun("someone-else", "run-x").spans).toEqual([]);
  });

  it("refuses a malformed span without discarding its neighbours", () => {
    const result = ingestSpans([
      span({ span_id: "good-1", run_id: "run-mixed" }),
      { trace_version: 1, agent: "scout", run_id: "run-mixed" },
      span({ span_id: "good-2", run_id: "run-mixed" }),
    ]);
    expect(result.accepted).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(spansForRun("scout", "run-mixed").spans).toHaveLength(2);
  });
});

describe("no credential reaches a row", () => {
  it("replaces a bearer token in an error message, in the bytes on disk", () => {
    ingestSpans(
      span({
        span_id: "s-leak",
        run_id: "run-leak",
        status: "error",
        ended_at: "2026-09-07T10:00:03.000Z",
        error: { code: "http_401", message: `the provider refused ${BEARER}` },
        attributes: { operation: `retry with ${KEY}` },
      }),
    );

    const stored = spansForRun("scout", "run-leak");
    expect(stored.spans[0]?.error?.message).toBe(REDACTED);
    expect(stored.spans[0]?.attributes?.["operation"]).toBe(REDACTED);
    // The code survives, because it carries no secret and is what makes the row
    // useful. The whole value goes rather than the match: a sentence with the
    // words around a redacted token left in would let a reader work out which
    // token it was from what was said about it.
    expect(stored.spans[0]?.error?.code).toBe("http_401");

    /*
     * And the claim made where it cannot be argued with: the bytes SQLite
     * wrote, including the write-ahead log. A test that read only the row it
     * just asked for would pass on an implementation that redacted on the way
     * out and stored the token.
     */
    const bytes = readStoreBytes(dataDir);
    expect(bytes).not.toContain(asStoredText(BEARER));
    expect(bytes).not.toContain(asStoredText(KEY));
  });

  it("drops an attribute key that is not on the allowlist", () => {
    // The bag is closed rather than merely bounded. A size limit would not have
    // stopped a prompt, a page body or a mailbox subject line from arriving —
    // only a list of the keys DASH actually draws does.
    ingestSpans(
      span({
        span_id: "s-attrs",
        run_id: "run-attrs",
        attributes: {
          attempt: 2,
          operation: "gmail.search",
          access_token: "not-a-real-token-but-still-not-welcome",
          prompt: "everything the model was told",
        },
      }),
    );

    const stored = spansForRun("scout", "run-attrs");
    expect(stored.spans[0]?.attributes).toEqual({ attempt: 2, operation: "gmail.search" });
  });

  it("refuses a payload wearing an allowlisted name, at the contract", () => {
    /*
     * An object under `operation` is a payload with an approved key on it, and
     * the schema refuses it before the allowlist is even consulted: attribute
     * values are strings, numbers, booleans or null and nothing else. Refused
     * rather than stringified — stringifying would put the whole thing in a
     * column the allowlist blessed for a short label, which is precisely the
     * shape a page body or a prompt would arrive in.
     */
    const result = ingestSpans(
      span({
        span_id: "s-nested",
        run_id: "run-nested",
        attributes: { operation: { nested: "payload" } } as unknown as RunSpan["attributes"],
      }),
    );
    expect(result.accepted).toBe(0);
    expect(spansForRun("scout", "run-nested").spans).toEqual([]);
  });

  it("bounds an attribute value, which the schema does not", () => {
    // The one bound the contract deliberately leaves to the store. An origin is
    // a scheme and a host and cannot honestly be 400 characters, but a schema
    // maxLength here would refuse the whole span over one long attribute — and
    // losing the operation because its origin was odd is a worse trade than
    // keeping the operation with a trimmed origin.
    ingestSpans(
      span({
        span_id: "s-long",
        run_id: "run-long",
        attributes: { origin: `https://example.test/${"y".repeat(400)}` },
      }),
    );
    expect(String(spansForRun("scout", "run-long").spans[0]?.attributes?.["origin"])).toHaveLength(
      200,
    );
  });

  it("refuses an error message longer than telemetry's own bound", () => {
    /*
     * 300 characters, which is exactly `detail`'s bound in
     * `contracts/run-event.schema.json`. The same sentence written to both
     * channels must not survive one and be cut by the other, and the contract is
     * the place to say so — `keepError` trims to the same number as a second
     * guard on the column, which is unreachable through this path and is meant
     * to be.
     */
    const result = ingestSpans(
      span({
        span_id: "s-shouty",
        run_id: "run-shouty",
        status: "error",
        ended_at: "2026-09-07T10:00:04.000Z",
        error: { message: "x".repeat(900) },
      }),
    );
    expect(result.accepted).toBe(0);
    expect(result.rejected[0]?.errors.join(" ")).toContain("message");
  });

  it("stamps usage as the agent's own figure, whatever the agent claimed", () => {
    ingestSpans(
      span({
        span_id: "s-usage",
        run_id: "run-usage",
        usage: { tokens_in: 10, tokens_out: 2, cost_usd: 0.001, source: "reported" },
      }),
    );
    // `source` is written by DASH rather than copied. It is the field that stops
    // a renderer presenting this as a provider's charge, and only a value DASH
    // wrote itself can carry that weight.
    expect(spansForRun("scout", "run-usage").spans[0]?.usage).toEqual({
      tokens_in: 10,
      tokens_out: 2,
      cost_usd: 0.001,
      source: "reported",
    });
  });
});

describe("the per-run cap", () => {
  it("refuses past the cap, counts what it refused, and still closes what it kept", () => {
    const runId = "run-flood";
    const batch: RunSpan[] = [];
    for (let index = 0; index < MAX_SPANS_PER_RUN + 5; index += 1) {
      batch.push(span({ span_id: `s-${String(index)}`, run_id: runId }));
    }
    ingestSpans(batch);

    const stored = spansForRun("scout", runId);
    expect(stored.spans).toHaveLength(MAX_SPANS_PER_RUN);
    // The count is what lets the page say the tree is incomplete. Without it a
    // truncated trace would draw a shorter run and call it complete.
    expect(stored.dropped).toBe(5);

    /*
     * A revision of a span already stored is never refused. The run is at its
     * cap either way, and dropping a close would strand a finished operation as
     * permanently unknown — which would put "the agent died inside this" on a
     * page about an operation that finished in four milliseconds.
     */
    ingestSpans(
      span({ span_id: "s-0", run_id: runId, ended_at: "2026-09-07T10:00:01.000Z", status: "ok" }),
    );
    const after = spansForRun("scout", runId);
    expect(after.spans).toHaveLength(MAX_SPANS_PER_RUN);
    expect(after.spans.find((each) => each.span_id === "s-0")?.status).toBe("ok");
    expect(after.dropped).toBe(5);
  });
});

describe("a run with no spans", () => {
  it("reads as empty rather than as missing", () => {
    // Every run already in somebody's store, and every run of an agent built
    // before this packet. Not an error, not a null, and not a reason for the
    // page to draw anything it inferred.
    expect(spansForRun("scout", "a-run-that-never-traced")).toEqual({ spans: [], dropped: 0 });
  });
});
