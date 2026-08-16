/**
 * The controlled browser's decisions, driven without Electron (MAR-628, ADR
 * 0019).
 *
 * `createBrowserController` takes its three impure verbs — open, perform,
 * destroy — as dependencies, which is what lets this file exercise the whole
 * decision path against a fake Chromium: revocation, replay, the rate limit, the
 * origin check, the trail rows and the read-then-reach mark.
 *
 * Every clock reading comes from `deps.now`, so nothing here sleeps and nothing
 * is timing-dependent.
 */

import { describe, expect, it } from "vitest";

import type { BrowserGesture } from "../lib/browser/operations";
import {
  createBrowserController,
  type BlockedRequestRow,
  type BrowserControllerDeps,
  type BrowserSession,
  type BrowserTrailRow,
  type PerformResult,
} from "../lib/browser/session";
import { BROWSER_CALLS_PER_WINDOW } from "../lib/browser/session";

const ARTICLE = "https://example.com/article";

interface Harness {
  controller: ReturnType<typeof createBrowserController>;
  trail: BrowserTrailRow[];
  blocked: BlockedRequestRow[];
  destroyed: string[];
  gestures: BrowserGesture[];
  /** The receipts the controller wrote, in order. See `sessionOpened`. */
  receipts: BrowserSession[];
  /** Move the fake clock, for the rate-limit window. */
  advance(ms: number): void;
}

function harness(
  options: {
    origins?: readonly string[] | null;
    run?: string | null;
    perform?: (gesture: BrowserGesture) => PerformResult;
  } = {},
): Harness {
  const trail: BrowserTrailRow[] = [];
  const blocked: BlockedRequestRow[] = [];
  const destroyed: string[] = [];
  const gestures: BrowserGesture[] = [];
  const receipts: BrowserSession[] = [];
  let clock = Date.parse("2026-08-16T09:00:00.000Z");
  let opened = 0;

  const deps: BrowserControllerDeps = {
    declaredOrigins: () =>
      options.origins === undefined ? ["https://example.com"] : options.origins,
    currentRun: () => (options.run === undefined ? "run-1" : options.run),
    openSession: (_pending: Omit<BrowserSession, "session_id">) => {
      opened += 1;
      return Promise.resolve(`bs-${String(opened)}`);
    },
    sessionOpened: (session) => receipts.push(session),
    perform: (_sessionId, gesture) => {
      gestures.push(gesture);
      const result =
        options.perform?.(gesture) ??
        ({
          ok: true,
          reading: {
            url: ARTICLE,
            title: "An article",
            ...(gesture.kind === "read_page" ? { text: "the words on the page" } : {}),
          },
          frame: "frame-001.png",
        } satisfies PerformResult);
      return Promise.resolve(result);
    },
    destroySession: (sessionId) => {
      destroyed.push(sessionId);
      return Promise.resolve();
    },
    audit: (row) => trail.push(row),
    auditBlocked: (row) => blocked.push(row),
    now: () => new Date(clock),
  };

  return {
    controller: createBrowserController(deps),
    trail,
    blocked,
    destroyed,
    gestures,
    receipts,
    advance: (ms) => {
      clock += ms;
    },
  };
}

const open = (id: string, url = ARTICLE) => ({
  request_id: id,
  operation: "browser.open",
  input: { url },
});
const read = (id: string) => ({ request_id: id, operation: "browser.read", input: {} });

describe("one article, one session", () => {
  it("opens, reads, and writes a trail row for each", async () => {
    const h = harness();
    expect(await h.controller.handle("scout", open("r1"))).toMatchObject({ ok: true });
    const answer = await h.controller.handle("scout", read("r2"));

    expect(answer).toMatchObject({ ok: true });
    expect(answer.ok && answer.result["text"]).toBe("the words on the page");
    expect(h.trail.map((row) => [row.operation, row.decision])).toEqual([
      ["browser.open", "allowed"],
      ["browser.read", "allowed"],
    ]);
    // The frame is a file name, never a path.
    expect(h.trail[0]?.frame_after).toBe("frame-001.png");
    expect(h.controller.sessionFor("scout")?.visited_origins).toEqual(["https://example.com"]);
  });

  it("writes the receipt itself, rather than leaving it to whoever delivered the request", async () => {
    // The correction the first real proof run forced. The session row used to
    // be written by the drain loop, so any other caller of `handle` produced
    // action rows pointing at a session with no row — and `browserView` lists
    // sessions and then their actions, so the whole trail rendered as nothing.
    const h = harness();
    await h.controller.handle("scout", open("r1"));

    expect(h.receipts).toHaveLength(1);
    expect(h.receipts[0]?.session_id).toBe(h.trail[0]?.session_id);
    // Once per session, not once per action.
    await h.controller.handle("scout", read("r2"));
    expect(h.receipts).toHaveLength(1);
  });

  it("refuses a read with nothing open, rather than navigating somewhere to answer it", async () => {
    const h = harness();
    expect(await h.controller.handle("scout", read("r1"))).toMatchObject({
      ok: false,
      refusal: "no_session",
    });
    expect(h.gestures).toEqual([]);
  });
});

describe("the origin check happens before anything opens", () => {
  it("refuses an undeclared origin and opens no session at all", async () => {
    const h = harness();
    const answer = await h.controller.handle("scout", open("r1", "https://evil.test/a"));

    expect(answer).toMatchObject({ ok: false, refusal: "origin_not_allowed" });
    expect(h.gestures).toEqual([]);
    expect(h.controller.sessionFor("scout")).toBeNull();
    // Refused, and in the trail — a refusal that left no trace would make this
    // a log of successful page loads.
    expect(h.trail[0]).toMatchObject({
      decision: "refused",
      refusal: "origin_not_allowed",
      origin: "https://evil.test",
    });
  });

  it("reports a redirect that left the declared origins as the trail saying so", async () => {
    const h = harness({
      perform: () => ({ ok: false, refusal: "origin_not_allowed", origin: "https://elsewhere.test" }),
    });
    const answer = await h.controller.handle("scout", open("r1"));

    expect(answer).toMatchObject({ ok: false, refusal: "origin_not_allowed" });
    expect(h.trail[0]).toMatchObject({ origin: "https://elsewhere.test" });
  });

  it("refuses an agent whose manifest declares no browser", async () => {
    const h = harness({ origins: null });
    expect(await h.controller.handle("scout", open("r1"))).toMatchObject({
      ok: false,
      refusal: "browser_not_declared",
    });
  });
});

describe("a page's own requests", () => {
  it("records what it refused, in a shape that is not an agent's conduct", async () => {
    const h = harness();
    await h.controller.handle("scout", open("r1"));
    const sessionId = h.controller.sessionFor("scout")?.session_id ?? "";

    expect(h.controller.noteRequest(sessionId, "https://tracker.test/p.gif", "subresource")).toBe(
      false,
    );
    expect(h.controller.noteRequest(sessionId, "https://example.com/a.css", "subresource")).toBe(
      true,
    );

    const row = h.blocked[0];
    expect(row).toMatchObject({ origin: "https://tracker.test", reason: "origin_not_declared" });
    // No request id, no operation, no decision. Nobody asked for this.
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "agent",
      "blocked_at",
      "kind",
      "origin",
      "reason",
      "session_id",
    ]);
  });

  it("refuses a request from a session DASH has stopped tracking", async () => {
    const h = harness();
    await h.controller.handle("scout", open("r1"));
    const sessionId = h.controller.sessionFor("scout")?.session_id ?? "";
    await h.controller.revoke("scout", "stopped_by_person");

    // The safe direction: a teardown racing a load must not let the load finish.
    expect(h.controller.noteRequest(sessionId, "https://example.com/a", "top_level")).toBe(false);
  });
});

describe("Stop", () => {
  it("destroys the session and refuses everything else in the run", async () => {
    const h = harness();
    await h.controller.handle("scout", open("r1"));
    const sessionId = h.controller.sessionFor("scout")?.session_id ?? "";

    await h.controller.revoke("scout", "stopped_by_person");
    expect(h.destroyed).toEqual([sessionId]);
    expect(h.controller.sessionFor("scout")).toBeNull();

    expect(await h.controller.handle("scout", open("r2"))).toMatchObject({
      ok: false,
      refusal: "revoked",
    });
    expect(await h.controller.handle("scout", read("r3"))).toMatchObject({
      ok: false,
      refusal: "revoked",
    });
  });

  it("is checked before anything else, so a request in flight cannot overtake it", async () => {
    const h = harness();
    await h.controller.handle("scout", open("r1"));
    await h.controller.revoke("scout", "stopped_by_person");

    // A replayed id would normally be `duplicate_request`; revocation is first.
    expect(await h.controller.handle("scout", open("r1"))).toMatchObject({ refusal: "revoked" });
  });

  it("does not punish the agent's next run for a Stop in this one", async () => {
    const h = harness();
    await h.controller.handle("scout", open("r1"));
    await h.controller.revoke("scout", "stopped_by_person");

    // A second controller reading a different run: the revocation was recorded
    // against `run-1` and this is not it.
    const later = harness({ run: "run-2" });
    expect(await later.controller.handle("scout", open("r1"))).toMatchObject({ ok: true });
  });

  it("destroys every open session on the way out", async () => {
    const h = harness();
    await h.controller.handle("a", open("r1"));
    await h.controller.handle("b", open("r2"));
    await h.controller.revokeEverything("run_ended");
    expect(h.destroyed).toHaveLength(2);
  });
});

describe("replay and rate", () => {
  it("does the same request once", async () => {
    const h = harness();
    await h.controller.handle("scout", open("r1"));
    expect(await h.controller.handle("scout", open("r1"))).toMatchObject({
      refusal: "duplicate_request",
    });
    expect(h.gestures).toHaveLength(1);
  });

  it("counts refusals against the window, so probing is not free", async () => {
    const h = harness();
    for (let i = 0; i < BROWSER_CALLS_PER_WINDOW; i += 1) {
      await h.controller.handle("scout", open(`r${String(i)}`, "https://evil.test/a"));
    }
    expect(await h.controller.handle("scout", open("last"))).toMatchObject({
      refusal: "rate_limited",
    });
  });

  it("lets the window roll", async () => {
    const h = harness();
    for (let i = 0; i < BROWSER_CALLS_PER_WINDOW; i += 1) {
      await h.controller.handle("scout", open(`r${String(i)}`, "https://evil.test/a"));
    }
    h.advance(61_000);
    expect(await h.controller.handle("scout", open("later"))).toMatchObject({ ok: true });
  });
});

describe("read-then-reach", () => {
  it("is unmarked before a read, and after a navigation", async () => {
    const h = harness();
    expect(h.controller.hasReadUntrusted("scout")).toBe(false);
    await h.controller.handle("scout", open("r1"));
    // A navigation returns a destination and a title, not the words on a page.
    expect(h.controller.hasReadUntrusted("scout")).toBe(false);
  });

  it("marks the run once page content comes back", async () => {
    const h = harness();
    await h.controller.handle("scout", open("r1"));
    await h.controller.handle("scout", read("r2"));
    expect(h.controller.hasReadUntrusted("scout")).toBe(true);
  });

  it("outlives the session, because closing the browser does not un-read the article", async () => {
    const h = harness();
    await h.controller.handle("scout", open("r1"));
    await h.controller.handle("scout", read("r2"));
    await h.controller.revoke("scout", "closed_by_agent");
    expect(h.controller.hasReadUntrusted("scout")).toBe(true);
  });

  it("holds when DASH can observe no run, which is the tight direction", async () => {
    const h = harness({ run: null });
    await h.controller.handle("scout", open("r1"));
    await h.controller.handle("scout", read("r2"));
    expect(h.controller.hasReadUntrusted("scout")).toBe(true);
  });
});
