/**
 * MAR-595 finding 13: the Agents list never refetched after `open-in-dash`'s
 * native consent dialog added an agent, because `useView` reads once on
 * mount and nothing told it the window had ever regained focus. Exercised
 * against a fake `focus`-event target rather than a real `window` — see
 * `lib/shell/focus-refresh.ts` for why.
 */

import { describe, expect, it, vi } from "vitest";

import { onWindowFocus, type FocusTarget } from "../lib/shell/focus-refresh";

function fakeFocusTarget(): FocusTarget & { dispatch: () => void } {
  const listeners = new Set<() => void>();
  return {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
    dispatch: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe("onWindowFocus", () => {
  it("calls back every time the target focuses", () => {
    const target = fakeFocusTarget();
    const onFocus = vi.fn();
    onWindowFocus(target, onFocus);

    target.dispatch();
    target.dispatch();

    expect(onFocus).toHaveBeenCalledTimes(2);
  });

  it("stops calling back once the returned unsubscribe runs", () => {
    const target = fakeFocusTarget();
    const onFocus = vi.fn();
    const unsubscribe = onWindowFocus(target, onFocus);

    unsubscribe();
    target.dispatch();

    expect(onFocus).not.toHaveBeenCalled();
  });

  it("does not affect a second subscriber sharing the same target", () => {
    const target = fakeFocusTarget();
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = onWindowFocus(target, first);
    onWindowFocus(target, second);

    unsubscribeFirst();
    target.dispatch();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
