/**
 * The agent page keeps looking while a run is going (MAR-680, MAR-685).
 *
 * ## Why this file reads source rather than rendering
 *
 * Everything this pins is a *hook wiring* decision, and no test in this
 * repository can render one: every render test here is `renderToStaticMarkup`,
 * which renders once and runs no effect. That gap has cost this page before —
 * `app/agents/detail/page.tsx`'s own note records a hook-ordering crash that
 * 190 test files could not see and two capture harnesses found.
 *
 * So this reads the one file that decides, for the reason
 * `tests/agent-one-home.test.tsx` reads it and `tests/fleet-view.test.ts` reads
 * the stylesheet. It is crude, and it is checking three crude things: that the
 * page follows a run at all, that it starts following from the press rather
 * than from the snapshot, and that it reads once more after the run ends.
 *
 * ## What each one is protecting
 *
 * Henrik, 2026-08-17, after a real run: *"The only information we get is that
 * it has started a new run."* All three of these were the cause, and any one of
 * them silently reverting brings the whole symptom back.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* Normalised at the read. A regex over source that anchors on `\n` is blind on
   a machine that checked the file out with CRLF endings, and a blind assertion
   is a green one. */
const pageSource = readFileSync(
  path.join(repoRoot, "app", "agents", "detail", "page.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("following a run", () => {
  it("follows every in-flight status rather than only `running`", () => {
    /*
     * The predicate lives in `lib/workspace.ts` with its own test and the
     * argument for why it is wider than `hasActiveRun`. What this pins is that
     * the page asks *it* — an inline `run.status === "running"` here would
     * compile, pass everything, and freeze the page the moment a run reached an
     * approval.
     */
    expect(pageSource).toContain("isRunInFlight(run.status)");
    expect(pageSource).not.toContain('run.status === "running"');
  });

  it("follows from the press, not from the first snapshot that admits a run", () => {
    /*
     * The snapshot is drained from the runner every five seconds, so for up to
     * a poll after Run now it still says idle. Without this the page fired one
     * re-read, found nothing, and stopped — which is the whole of the reported
     * symptom.
     */
    expect(pageSource).toContain("const following = running || asked > 0");
    expect(pageSource).toContain("setAsked((value) => value + 1)");
    // And the hopeful state is bounded, or a refused press polls forever.
    expect(pageSource).toContain("RUN_APPEARS_WITHIN_MS");
  });

  it("reads once more after the run leaves flight", () => {
    /*
     * MAR-680's second ask — *"It should trigger a reload so a new output
     * lands"* — and it is not automatic: the last telemetry event and the
     * artifact are two writes on two channels, so the poll that sees the run
     * end can land between them and leave "Finished" above the previous run's
     * output.
     */
    expect(pageSource).toContain("RUN_SETTLE_MS");
    expect(pageSource).toContain("wasRunning");
  });

  it("says it is following, in the band that never scrolls", () => {
    // `docs/design-brief.md`: nothing moves or refreshes without saying it did.
    // The header's live region is the saying, and it must be driven by the same
    // boolean that drives the polling — not by a narrower one, or the page
    // would refresh silently for the whole grace window.
    expect(pageSource).toContain("live={following ? timeOnly(state.last_read_at) : null}");
  });
});

describe("the header cell that no longer acts (MAR-687)", () => {
  it("passes no run-triggering handler to the header at all", () => {
    /*
     * `tests/agent-cockpit-render.test.tsx` proves the grid renders no button.
     * This is the other half: the page must not hand it a handler either, or a
     * later edit restores the auto-fire with one prop.
     *
     * Matched as a JSX *attribute* — an identifier alone on the line — rather
     * than as a substring. The page carries a comment naming both departed
     * props and saying why they went, which is this codebase's habit and is
     * worth more than the two characters a looser assertion would save.
     */
    const start = pageSource.indexOf("<AgentCockpitHeader");
    expect(start).toBeGreaterThan(-1);
    const header = pageSource.slice(start, pageSource.indexOf("<HostNotice", start));
    expect(header).not.toMatch(/\n\s+onTriggerRun[=\s]/);
    expect(header).not.toMatch(/\n\s+canTrigger[=\s]/);
  });

  it("still owns the two functions that do start a run", () => {
    // Nothing was removed from the product. `AgentControls` on the Run stage
    // reaches both, from the same `control` the header is handed.
    expect(pageSource).toContain("startAndRunHere");
    expect(pageSource).toContain("onStart={() => {");
  });
});
