/**
 * Did the first page ever become a page?
 *
 * ## The defect this exists for
 *
 * `pnpm shell` built a fresh shell, pointed it at whatever was listening on
 * `http://127.0.0.1:3000`, and displayed a window that said "Reading your
 * agents…" and never said anything else. Every gate in this repository was
 * green while it did so, and each of them was green for a reason worth writing
 * down, because the same reason will make the next one green too:
 *
 * - `pnpm verify:shell` forces `DASH_SHELL_URL=dash-app://ui/` (see
 *   `scripts/verify-shell.mjs`, and its comment explaining that the proof must
 *   be self-contained). So the mandatory gate has never once loaded the
 *   developer path. It is not that the gate failed to catch this; it is that
 *   the gate does not go here.
 * - Proof `1` asserts `document.querySelectorAll("h1,h2").length > 0`. The
 *   server-rendered markup already contains `<h1>Agents</h1>`, so that check
 *   passes on markup that never executed a line of the renderer's JavaScript.
 * - Proof `2d` calls `window.dashData.agents()` from the harness. That proves
 *   the bridge answers; it says nothing about the page, because the harness is
 *   not the page.
 *
 * All three are the shape MAR-473 named when `6j` asserted only that *a*
 * verdict existed: a check that is satisfied by the failure it is meant to
 * exclude. The distinguishing fact about a shell whose renderer never ran is
 * not that content is missing — the content is all there, delivered by the
 * server — it is that the content never *changed*.
 *
 * ## So the assertion is an absence
 *
 * `ViewLoading` renders `data-view-state="loading"`. Every page in `app/` opens
 * in that state, because since MAR-432 every page is a client component that
 * reads across a boundary in an effect. If the renderer's JavaScript runs, the
 * effect resolves and the attribute goes. If it does not, the attribute is
 * still there an hour later.
 *
 * That is why the check waits for an attribute to *disappear* rather than for
 * any particular content to appear. Content is a claim about what a view holds
 * — which is a different question, already answered by the view tests — and a
 * check that waited for the word "Agents" would have passed against the frozen
 * window, since the word was on screen the whole time.
 *
 * Pure and I/O-free, for the same reason `lib/shell/window.ts` is: the rule is
 * worth more than the wiring, and a rule that lives inside an Electron harness
 * can only be tested by launching Electron.
 */

/**
 * The attribute `app/_components/view-state.tsx` stamps on its two states.
 *
 * A `data-` attribute rather than a class, because classes are styling and a
 * future stylesheet pass is entitled to rename one. This is a statement about
 * what the page is doing.
 */
export const VIEW_STATE_ATTRIBUTE = "data-view-state";

/** What the first page settled into, or that it never settled at all. */
export type FirstPaintOutcome =
  /** No page-level loading placeholder remains. The renderer ran. */
  | "ready"
  /**
   * The read completed and reported a failure, which is a working renderer
   * showing a recovery. Kept apart from `ready` because it is a different
   * thing to learn, and apart from `stuck` because the renderer plainly ran.
   */
  | "failed"
  /** A loading placeholder is still on screen. This is the regression. */
  | "stuck";

/**
 * What one look at the document saw.
 *
 * Deliberately three counts and a URL rather than a boolean. MAR-473's lesson
 * is that `FAIL 6g …: null` cannot distinguish three different defects, and a
 * first-paint check that reported only `false` would be the same mistake: it
 * could not tell "the page never loaded" from "the page loaded and froze" from
 * "the page is not the page we meant to look at".
 */
export interface FirstPaintObservation {
  url: string;
  /** Elements still declaring themselves a page-level loading placeholder. */
  loading: number;
  /** Elements declaring a rendered failure. */
  failed: number;
  /** Headings, so a report can say whether *anything* was on screen. */
  headings: number;
}

/**
 * The expression `electron/first-paint.ts` and `electron/smoke.ts` evaluate in
 * the renderer.
 *
 * A string here rather than a function in each harness, so the two cannot drift
 * into asking slightly different questions and reporting them under the same
 * name. It is built from `VIEW_STATE_ATTRIBUTE` for the same reason.
 */
export const FIRST_PAINT_PROBE = `(() => ({
  url: location.href,
  loading: document.querySelectorAll('[${VIEW_STATE_ATTRIBUTE}="loading"]').length,
  failed: document.querySelectorAll('[${VIEW_STATE_ATTRIBUTE}="failed"]').length,
  headings: document.querySelectorAll('h1,h2').length,
}))()`;

/**
 * Read one observation.
 *
 * `failed` is checked *after* `loading` on purpose. A page mid-refresh can show
 * a recovery from the previous read while the next one is in flight, and
 * calling that settled would let the check pass on a window that is still
 * moving.
 */
export function readFirstPaint(observation: FirstPaintObservation): FirstPaintOutcome {
  if (observation.loading > 0) {
    return "stuck";
  }
  return observation.failed > 0 ? "failed" : "ready";
}

/**
 * How long a first paint may take before it is a defect rather than a wait.
 *
 * Twenty seconds, and the number is chosen against what the step actually does
 * rather than against a feeling — MAR-473's other lesson, where a 20-second
 * budget covered a fetch that could take 45. This budget covers one read over
 * either transport: `window.dashData.agents()` is a synchronous SQLite read
 * behind one IPC hop, and the developer path's `GET /api/views/agents` was
 * measured at 917ms on the machine this was written on, against a store holding
 * three agents and forty-five runs. Twenty seconds is two orders of magnitude
 * of headroom, which is what a check wants when the failure it exists to catch
 * is unbounded rather than slow.
 */
export const FIRST_PAINT_BUDGET_MS = 20_000;

/** What the check concluded, in the shape a log line and an exit code need. */
export interface FirstPaintVerdict {
  ok: boolean;
  outcome: FirstPaintOutcome | "never_loaded";
  detail: string;
}

/**
 * Turn a settled — or unsettled — observation into a verdict a person can act
 * on.
 *
 * The three failing sentences are three different pieces of advice, which is
 * the whole reason the outcomes are not collapsed into a boolean. Somebody
 * whose page is stuck should look at what is serving it; somebody whose page
 * rendered a recovery should read the recovery; somebody whose window never
 * loaded at all has a different problem again.
 */
export function judgeFirstPaint(
  observation: FirstPaintObservation | null,
  elapsedMs: number,
): FirstPaintVerdict {
  if (observation === null) {
    return {
      ok: false,
      outcome: "never_loaded",
      detail:
        "The window never finished loading, so there was no page to look at. " +
        "Check what is answering at the renderer's address.",
    };
  }

  const outcome = readFirstPaint(observation);
  if (outcome === "ready") {
    return {
      ok: true,
      outcome,
      detail: `The first page left its loading state after ${String(elapsedMs)}ms.`,
    };
  }
  if (outcome === "failed") {
    return {
      ok: false,
      outcome,
      detail:
        "The renderer ran and the page reported a failure it could not read past. " +
        "The recovery on screen names what happened; this check only reports that it is there.",
    };
  }
  return {
    ok: false,
    outcome,
    detail:
      `The first page was still saying it was loading after ${String(elapsedMs)}ms, ` +
      `with ${String(observation.headings)} heading(s) on screen. ` +
      "That is markup the server delivered and the renderer never replaced, so the " +
      "renderer's JavaScript did not run. Check what is serving the renderer.",
  };
}
