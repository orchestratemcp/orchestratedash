"use client";

/**
 * Reading a view, with the three states a page actually has (MAR-432).
 *
 * Server components had two: rendered, or did not. A client component reading
 * across a boundary has three, and the middle one is new to DASH — there is now
 * a moment where the page exists and its content does not.
 *
 * `docs/design-brief.md` has a rule that lands directly on that moment:
 * *"Nothing moves or refreshes without saying it did."* So loading is a state
 * the page renders deliberately rather than a blank frame it passes through, and
 * failure is a `Recovery` with a next action rather than an empty table that
 * implies there is nothing to show.
 */

import { useEffect, useState } from "react";

import type { Recovery } from "../../lib/copy/recovery";
import { onWindowFocus } from "../../lib/shell/focus-refresh";
import { dataSource, type DashDataSource, type ViewResult } from "./source";

export type ViewState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; recovery: Recovery };

/**
 * Read one view, once, on mount.
 *
 * Deliberately not polling. DASH does poll — `electron/agent-adapters.ts` reads
 * every agent's state every five seconds — but that writes to the store, and a
 * page that re-read itself on a timer would be the "nothing moves without saying
 * it did" rule broken by the module that quotes it. Live updating is a design
 * decision with copy attached, and it belongs with the UX pass rather than
 * arriving as a side effect of a hosting change.
 *
 * `read` is taken as a function of the source rather than as a bound promise so
 * that the source is resolved inside the effect, in the browser, after the
 * server-rendered pass on the developer path has already happened.
 */
export function useView<T>(
  read: (source: DashDataSource) => Promise<ViewResult<T>>,
  refreshKey: string | number = 0,
): ViewState<T> {
  const [state, setState] = useState<ViewState<T>>({ status: "loading" });

  useEffect(() => {
    // A page can be navigated away from mid-read. Applying the result then would
    // set state on a component nobody is looking at, and — worse — could show
    // one page's data under another page's heading.
    let current = true;
    setState({ status: "loading" });

    void read(dataSource()).then((result) => {
      if (!current) {
        return;
      }
      setState(result.ok ? { status: "ready", data: result.data } : { status: "failed", recovery: result.recovery });
    });

    return () => {
      current = false;
    };
    // `read` is a fresh closure on every render at every call site, so it is
    // deliberately not a dependency: including it would re-read on every render,
    // forever. The pages pass a pure function of the source and nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return state;
}

/**
 * Re-read a view while something is actually happening (MAR-457).
 *
 * `useView` above is deliberately not a poller, and this does not make it one.
 * The distinction is `active`: this re-reads only while the caller says a run is
 * in flight, and stops the moment it is not. A page that polled forever would be
 * the "nothing moves or refreshes without saying it did" rule broken by the
 * module that quotes it — so callers are expected to render `last_read_at`, and
 * the design of this hook makes that awkward to forget by returning it.
 *
 * Five seconds because that is already the cadence `electron/agent-adapters.ts`
 * drains the runner on. Reading faster would show the same bytes twice and cost
 * a database read to do it; the data does not arrive any sooner than the poll
 * that fetches it.
 */
export const LIVE_REFRESH_MS = 5_000;

export function useLiveView<T>(
  read: (source: DashDataSource) => Promise<ViewResult<T>>,
  key: string | number,
  active: boolean,
): ViewState<T> & { last_read_at: Date | null } {
  const [tick, setTick] = useState(0);
  const [lastReadAt, setLastReadAt] = useState<Date | null>(null);
  const state = useView(read, `${String(key)}:${String(tick)}`);

  useEffect(() => {
    if (state.status !== "loading") {
      setLastReadAt(new Date());
    }
  }, [state.status, tick]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setTick((value) => value + 1), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active]);

  return { ...state, last_read_at: lastReadAt };
}

/**
 * Whether this window can cause an effect, for the pages that need to say so.
 *
 * Resolved in an effect rather than during render, because the answer depends on
 * `window` and the developer path renders these pages on the server first. A
 * page that read it during render would claim "cannot act" for one frame in the
 * one host that can.
 */
export function useCanAct(): boolean {
  const [canAct, setCanAct] = useState(false);
  useEffect(() => {
    setCanAct(dataSource().can_act);
  }, []);
  return canAct;
}

/** Which host this is, for the notice `lib/copy/host.ts` produces. */
export function useHost(): DashDataSource["host"] | null {
  const [host, setHost] = useState<DashDataSource["host"] | null>(null);
  useEffect(() => {
    setHost(dataSource().host);
  }, []);
  return host;
}

/**
 * A key that bumps every time the window regains OS focus (MAR-595 finding
 * 13, moved here from `app/page.tsx` for MAR-640's sidebar badge, which
 * needs the same refresh key `AgentsPage` already had).
 *
 * Passed to `useView` as its `refreshKey`, so a page rereads its view rather
 * than staying on whatever it read at mount. `npm run open-in-dash`'s native
 * consent dialog adding an agent while a page was underneath it the whole
 * time is the case this exists for; a work-inbox item arriving the same way
 * is the same case for the badge. See `lib/shell/focus-refresh.ts` for why
 * `focus` rather than a poll.
 */
export function useRefreshOnWindowFocus(): number {
  const [key, setKey] = useState(0);
  useEffect(
    () =>
      onWindowFocus(window, () => {
        setKey((value) => value + 1);
      }),
    [],
  );
  return key;
}
