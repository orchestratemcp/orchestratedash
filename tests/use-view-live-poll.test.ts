/**
 * MAR-881: the agent page must keep its scroll position across a live poll
 * tick.
 *
 * ## What was on the screen
 *
 * Pressing *Judge it again* on the Output stage, scrolled down to the
 * receipt, showed BEING JUDGED — and by the next few poll ticks had scrolled
 * itself back to the top and stayed there for the rest of the two-minute
 * judgement. Henrik's report could not tell whether the refresh-key bump
 * remounted the stage once, or every tick re-created the scroll container.
 *
 * ## The mechanism
 *
 * It is the second one, and it was never actually about the refresh key.
 * `useLiveView` (`app/_data/use-view.ts`) folded its own five-second `tick`
 * into the key it handed `useView`: `` `${key}:${tick}` ``. `useView`'s
 * effect resets to `{ status: "loading" }` synchronously on *any* change to
 * that composed key, before the read resolves — which is the right behaviour
 * for a key change a person caused, and exactly wrong for a key that changes
 * every five seconds on its own. `app/agents/detail/page.tsx` returns
 * `<ViewLoading />` whenever `status === "loading"`, unmounting the whole
 * workspace — including whatever the Output stage's scroll container held —
 * and remounting it fresh at the top once the read landed. That happened on
 * *every* tick for as long as a judgement kept the page polling, not once.
 *
 * ## What this file holds
 *
 * `useLiveView` no longer routes through `useView` at all; it keeps its own
 * `ViewState` and decides, via the exported `isBackgroundPoll`, whether a
 * re-read is a heartbeat on an unchanged resource (update the data in place,
 * no loading flash) or a real change of resource (show loading, same as
 * `useView` always has). This is a source-level test of that decision function
 * rather than a rendered one: the repository's test suite runs under plain
 * Node with no DOM (`vitest.config.ts` declares no `environment`, and neither
 * `jsdom` nor `@testing-library/react` is installed — `package.json` is out
 * of this lane's reach to add them), so there is no harness here that can
 * mount `AgentWorkspace`, advance a fake timer past a poll tick, and read a
 * real `scrollTop`. `tests/shell-focus-refresh.test.ts` sets the precedent for
 * testing a hook's extracted decision logic directly instead.
 */

import { describe, expect, it } from "vitest";

import { isBackgroundPoll, type ViewState } from "../app/_data/use-view";

describe("isBackgroundPoll", () => {
  it("is not a background poll on the very first read", () => {
    // No previous key at all — there is nothing yet for a tick to be a
    // heartbeat *of*. This is `useLiveView`'s first render, and it must show
    // loading like `useView` always has for one.
    expect(isBackgroundPoll(null, "ai-agent-news:0", "loading")).toBe(false);
  });

  it("is a background poll when only the tick moved and the last read was good", () => {
    // The MAR-881 case: same agent, same explicit refreshKey, five seconds
    // later, with a good answer already on screen. The page must not drop
    // back to loading and lose the reader's scroll position.
    expect(isBackgroundPoll("ai-agent-news:0", "ai-agent-news:0", "ready")).toBe(true);
  });

  it("is not a background poll when the key itself changed", () => {
    // A different agent, or a press that bumped an explicit refreshKey — a
    // real new question, not a heartbeat. This must still show loading, the
    // same as it always has.
    expect(isBackgroundPoll("ai-agent-news:0", "proof-scout:0", "ready")).toBe(false);
    expect(isBackgroundPoll("ai-agent-news:0", "ai-agent-news:1", "ready")).toBe(false);
  });

  it("is not a background poll while the previous read is still loading", () => {
    // The read from the previous tick has not resolved yet (or this is the
    // first tick and the initial read is still in flight) — there is no good
    // data on screen to keep showing, so nothing is lost by staying in the
    // loading state a caller already renders.
    expect(isBackgroundPoll("ai-agent-news:0", "ai-agent-news:0", "loading")).toBe(false);
  });

  it("is not a background poll after a failed read, even on the same key", () => {
    // `useView`'s contract is that a failure means `Recovery` with a next
    // action. A poll that revalidates a failed resource should say it is
    // checking again rather than silently sit on a stale recovery notice.
    expect(isBackgroundPoll("ai-agent-news:0", "ai-agent-news:0", "failed")).toBe(false);
  });

  it("treats a numeric key the same as a string one", () => {
    // `useLiveView`'s `key` parameter is typed `string | number` (`fleet-strip.tsx`
    // and `browser-panel.tsx` both pass agent ids; other callers pass plain
    // strings), so the comparison must not coerce one into matching the other
    // by accident.
    const state: ViewState<unknown>["status"] = "ready";
    expect(isBackgroundPoll(0, 0, state)).toBe(true);
    expect(isBackgroundPoll(0, "0", state)).toBe(false);
  });
});
