/**
 * The living fleet (MAR-544).
 *
 * The issue's hard rule is the thing under test: **motion signals real state,
 * or it doesn't run.** So the cases here are mostly about honesty at the
 * boundaries — an O that must not look busy while its agent sleeps, a pulse
 * that must not claim work during a wait on the person, a boot glyph that must
 * not cost the first-paint gate its attribute — rather than about what the
 * animation looks like, which is the capture matrix's question.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewLoading } from "../app/_components/view-state";
import { WorkingLine } from "../app/_components/working";
import { describeWorkingPhase } from "../lib/copy/working";
import {
  FLEET_RECENT_MS,
  describeFleetActivity,
  fleetMotion,
  fleetMotionSignals,
} from "../lib/views/fleet-motion";
import type { RunRow } from "../lib/views/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = readFileSync(path.join(repoRoot, "app", "tokens.css"), "utf8");
const globals = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8");

const NOW = new Date("2026-08-07T12:00:00.000Z");

function run(agent: string, status: RunRow["status"], lastEventAt: string): RunRow {
  return {
    agent,
    run_id: `run-${agent}-${lastEventAt}`,
    status,
    event_count: 3,
    started_at: lastEventAt,
    last_event_at: lastEventAt,
    has_sequence_gap: false,
    known_agent: true,
    analysis: null,
    model: null,
  };
}

describe("the behaviour is a pure function of real signals", () => {
  it("a running run means working", () => {
    expect(
      fleetMotion({ running: true, needs_decision: false, last_event_at: null }, NOW),
    ).toBe("working");
  });

  it("a decision waiting on the person outranks work in flight", () => {
    // The person is what the agent is blocked on, so the O asks rather than
    // performs busyness the person cannot help with.
    expect(
      fleetMotion(
        { running: true, needs_decision: true, last_event_at: "2026-08-07T11:59:00.000Z" },
        NOW,
      ),
    ).toBe("waiting");
  });

  it("recent activity walks; long quiet sleeps", () => {
    expect(
      fleetMotion(
        { running: false, needs_decision: false, last_event_at: "2026-08-07T11:30:00.000Z" },
        NOW,
      ),
    ).toBe("walking");
    const beyond = new Date(NOW.getTime() - FLEET_RECENT_MS - 1000).toISOString();
    expect(
      fleetMotion({ running: false, needs_decision: false, last_event_at: beyond }, NOW),
    ).toBe("sleeping");
  });

  it("an agent that never ran sleeps, and a malformed timestamp sleeps too", () => {
    // Sleeping is the no-claim state: a timestamp DASH cannot read must not
    // invent recency out of NaN arithmetic.
    expect(fleetMotion({ running: false, needs_decision: false, last_event_at: null }, NOW)).toBe(
      "sleeping",
    );
    expect(
      fleetMotion({ running: false, needs_decision: false, last_event_at: "not a time" }, NOW),
    ).toBe("sleeping");
  });
});

describe("the signals come from the store's own rows", () => {
  const runs = [
    run("scout", "completed", "2026-08-07T10:00:00.000Z"),
    run("scout", "running", "2026-08-07T11:59:30.000Z"),
    run("other", "completed", "2026-08-07T09:00:00.000Z"),
  ];

  it("reads only the agent's own runs, and the newest event wins", () => {
    const signals = fleetMotionSignals("scout", runs, { items: [], stalled: [] });
    expect(signals.running).toBe(true);
    expect(signals.last_event_at).toBe("2026-08-07T11:59:30.000Z");
    expect(fleetMotionSignals("other", runs, { items: [], stalled: [] }).running).toBe(false);
  });

  it("a stalled agent needs a decision, same as an inbox item", () => {
    const stalled = {
      items: [],
      stalled: [
        { agent: "scout", agent_title: "Scout", last_activity_at: null, next_action: "look" },
      ],
    };
    expect(fleetMotionSignals("scout", runs, stalled).needs_decision).toBe(true);
  });

  it("degrades to stillness when a view is missing, never to invention", () => {
    // A failed read costs the fleet its motion — the pre-MAR-544 strip — and
    // must not cost more or claim anything.
    const signals = fleetMotionSignals("scout", null, null);
    expect(signals).toEqual({ running: false, needs_decision: false, last_event_at: null });
    expect(fleetMotion(signals, NOW)).toBe("sleeping");
  });
});

describe("the caption states in words what the motion draws", () => {
  it("says the counts that are non-zero and no others", () => {
    expect(describeFleetActivity(3, 0, 1, 0)).toBe("3 agents · 1 working");
    expect(describeFleetActivity(3, 0, 0, 2)).toBe("3 agents · 2 waiting for you");
    expect(describeFleetActivity(1, 0, 0, 0)).toBe("1 agent");
    expect(describeFleetActivity(5, 2, 1, 1)).toBe(
      "5 agents · 1 waiting for you · 1 working · 2 not shown",
    );
  });
});

describe("the working line never claims a phase the system is not in", () => {
  it("names the in-flight phases and only those", () => {
    expect(describeWorkingPhase("running")).toBe("Working…");
    expect(describeWorkingPhase("queued")).toBe("Waiting to start…");
  });

  it("returns null for waits on the person and for records", () => {
    // A pulse on "waiting for approval" would say the system is working when
    // the truth is that it is waiting for you.
    for (const status of ["waiting_for_approval", "waiting_for_choice", "paused", "completed", "failed", "cancelled"]) {
      expect(describeWorkingPhase(status), status).toBeNull();
    }
  });

  it("renders the phase once, with silent pips", () => {
    const markup = renderToStaticMarkup(<WorkingLine phase="Working…" />);
    expect(markup).toContain("Working…");
    expect(markup).toMatch(/working-pips[^>]*aria-hidden="true"/);
  });
});

describe("the motion rides the tokens, so reduced motion stills the fleet for free", () => {
  it("zeroes every behaviour duration under prefers-reduced-motion", () => {
    const reduce = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/.exec(tokens)?.[0] ?? "";
    for (const token of ["--motion-hop", "--motion-beckon", "--motion-stroll", "--motion-boot", "--motion-blink"]) {
      expect(reduce).toContain(`${token}: 0ms`);
    }
  });

  it("animates working, waiting and walking on tokens — and sleeping not at all", () => {
    expect(globals).toMatch(/\.fleet-strip-o\.is-working \.o-avatar\s*\{[^}]*var\(--motion-hop\)/);
    expect(globals).toMatch(/\.fleet-strip-o\.is-waiting \.o-avatar\s*\{[^}]*var\(--motion-beckon\)/);
    expect(globals).toMatch(/\.fleet-strip-o\.is-walking \.o-avatar\s*\{[^}]*var\(--motion-stroll\)/);
    // Stillness is the design for sleep, not an omission: see the comment in
    // globals.css. A rule arriving for it should have to argue with this test.
    // Comments are stripped first, because the design comment naming the class
    // is exactly what this must not trip over.
    const withoutComments = globals.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/\.is-sleeping[^{}]*\{/);
  });

  it("outranks the costume idle loop with real state, class for class (MAR-615)", () => {
    // `OAvatar`'s own docblock explains why the strip can carry both `action`
    // and `fleet-motion` without "two motions in one sprite": whichever rule
    // has more class selectors wins the `animation` property outright, and a
    // working/waiting/walking agent must always be the one that does. This
    // counts classes in the selector text rather than asking a browser to
    // compute specificity, which is what every other assertion in this file
    // already does against raw CSS.
    const idleSelector = /(\.o-avatar\.is-action)\s*\{/.exec(globals)?.[1];
    expect(idleSelector).toBeDefined();
    const idleClasses = idleSelector?.match(/\.[a-zA-Z-]+/g)?.length ?? 0;
    for (const state of ["is-working", "is-waiting", "is-walking"]) {
      const stateSelector = new RegExp(`(\\.fleet-strip-o\\.${state} \\.o-avatar)\\s*\\{`).exec(globals)?.[1];
      expect(stateSelector, state).toBeDefined();
      const stateClasses = stateSelector?.match(/\.[a-zA-Z-]+/g)?.length ?? 0;
      expect(stateClasses, state).toBeGreaterThan(idleClasses);
    }
  });

  it("never resizes the chief's composer sprite by box, and the --o-size/!important mechanism it used to need is gone (MAR-615, MAR-696)", () => {
    /*
     * This used to pin `.chief-glyph`'s three-rule, `!important`-carrying
     * `--o-size` override — a 100px portrait that had to shrink at two
     * breakpoints inside `ChiefBand`'s bordered box, which is what forced the
     * cascade fight this test's own history explains at length. MAR-696
     * deleted that box. The sprite that replaced it, `.chief-composer-o` in
     * `chief-chat.tsx`'s `ChiefComposerGlyph`, is a fixed `size={50}` accent
     * perched on the composer — it never needs to shrink at any width, so it
     * never reaches for `--o-size` in CSS at all, and the `!important`
     * mechanism this file used to regression-test has nothing left to test.
     *
     * What still matters, and what this keeps proving: `.chief-glyph` must
     * not quietly come back (the trap it names is real for *any* element
     * carrying `OAvatar`'s inline style, not just the one this file used to
     * track), and whatever rule *does* position `.chief-composer-o` must
     * never reach for `width`/`height`/`--o-size` — the same crop-vs-cascade
     * trap, caught before a capture run has to find it a second time.
     */
    /*
     * Comments stripped first — this test's own explanation names the class
     * it must not find, `tests/chief.test.ts`'s `source()` reason exactly: an
     * assertion that reads the raw file fails on its own documentation.
     */
    const withoutComments = globals.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(withoutComments, "the old bordered-box mechanism must not come back").not.toMatch(
      /\.chief-glyph\b/,
    );

    const bodies = [...globals.matchAll(/\.chief-composer-o\s*\{([^}]*)\}/g)].map(
      (match) => match[1] ?? "",
    );
    expect(bodies.length, "no rule positions the composer's perched O").toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body, "sizing the perched O by box or by override crops the sheet").not.toMatch(
        /(?:^|[\s;])(?:width|height|--o-size)\s*:/,
      );
    }
  });
});

describe("the boot sequence does not cost the first-paint gate its attribute", () => {
  it("still stamps data-view-state=loading, and keeps the sentence", () => {
    const markup = renderToStaticMarkup(<ViewLoading what="your agents" />);
    expect(markup).toContain('data-view-state="loading"');
    expect(markup).toContain("Reading your agents…");
  });

  it("keeps the glyph and the cursor silent", () => {
    const markup = renderToStaticMarkup(<ViewLoading what="your agents" />);
    expect(markup).toMatch(/boot-glyph[^>]*aria-hidden="true"/);
    expect(markup).toMatch(/aria-hidden="true"[^>]*class="boot-cursor"|boot-cursor[^>]*aria-hidden="true"/);
  });
});
