"use client";

/**
 * One renderer, two data sources, chosen at runtime (MAR-432, DASH-20).
 *
 * Every page below `app/` renders from this module and never from `lib/store.ts`.
 * That is the whole change: DASH's pages used to be server components in the
 * same process as SQLite, which the packaged app cannot be — the renderer there
 * is a static export with no server behind it.
 *
 * ## The two sources, and what is deliberately identical about them
 *
 * - **The installed app** reads over the preload bridge, `window.dashData`.
 * - **A browser tab** reads over `fetch`, from route handlers that exist only on
 *   the developer path.
 *
 * Neither source *builds* anything. Both end up calling the same functions in
 * `lib/views/build.ts`, on the same database, and return what they get. The only
 * difference between the two is transport, which is a much smaller thing to keep
 * honest than two renderings of the same data — and it is why "does the browser
 * tab show what the app shows" is a question with a structural answer rather than
 * a testing burden.
 *
 * ## What is *not* the same, and is not hidden
 *
 * A browser tab cannot act. `window.dashShell` is a preload bridge and a page
 * served over HTTP has no preload, so no command can be issued from one — not
 * today, and not when the buttons arrive. `capabilities.can_act` reports that,
 * and `lib/copy/host.ts` is what a page says about it. See that module for why
 * this is stated rather than quietly branched on.
 */

import { describeViewFailure, type Recovery } from "../../lib/copy/recovery";
import type { RenderHost } from "../../lib/copy/host";
import type { DashReadApi } from "../../lib/shell/read";
import type {
  AgentsView,
  ConnectionsView,
  RunView,
  RunsView,
} from "../../lib/views/types";

declare global {
  interface Window {
    /**
     * The read bridge, present only inside the installed app. Optional in the
     * type because a browser tab genuinely does not have it, and code that has
     * to check is code that cannot forget to.
     */
    dashData?: DashReadApi;
    /**
     * The audited command bridge. Named here only so that `can_act` can ask
     * whether it exists — nothing in `app/` calls it yet.
     */
    dashShell?: unknown;
  }
}

/** A read either produced its document or it did not, and says which. */
export type ViewResult<T> = { ok: true; data: T } | { ok: false; recovery: Recovery };

export interface DashDataSource {
  host: RenderHost;
  /**
   * Whether this window can cause an effect.
   *
   * Derived from the bridge's presence rather than from the host, because the
   * bridge is the thing that would actually be used. A host string can be wrong
   * about itself; `window.dashShell` cannot.
   */
  can_act: boolean;
  agents(): Promise<ViewResult<AgentsView>>;
  runs(): Promise<ViewResult<RunsView>>;
  run(agent: string, runId: string): Promise<ViewResult<RunView>>;
  connections(): Promise<ViewResult<ConnectionsView>>;
}

/**
 * Turn the bridge's answer into the page's.
 *
 * A refused read is DASH's fault, not the user's: the renderer asked for a
 * document this build does not offer, which can only be a wiring mistake. It is
 * reported as such rather than as "something went wrong".
 */
async function fromBridge<T>(call: () => Promise<{ ok: true; data: T } | { ok: false }>): Promise<
  ViewResult<T>
> {
  try {
    const response = await call();
    return response.ok
      ? { ok: true, data: response.data }
      : { ok: false, recovery: describeViewFailure("refused") };
  } catch {
    return { ok: false, recovery: describeViewFailure("unreachable") };
  }
}

function shellSource(bridge: DashReadApi): DashDataSource {
  return {
    host: "shell",
    can_act: typeof window !== "undefined" && window.dashShell !== undefined,
    agents: () => fromBridge(() => bridge.agents()),
    runs: () => fromBridge(() => bridge.runs()),
    run: (agent, runId) => fromBridge(() => bridge.run(agent, runId)),
    connections: () => fromBridge(() => bridge.connections()),
  };
}

/**
 * The developer path.
 *
 * These routes exist only when DASH is running as a Next server; the packaged
 * build does not contain them, which is enforced by their filenames rather than
 * by a runtime check — see `next.config.mjs`.
 */
async function fromHttp<T>(path: string): Promise<ViewResult<T>> {
  try {
    const response = await fetch(path, { headers: { accept: "application/json" } });
    if (!response.ok) {
      return { ok: false, recovery: describeViewFailure("refused") };
    }
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: false, recovery: describeViewFailure("unreachable") };
  }
}

function browserSource(): DashDataSource {
  return {
    host: "browser",
    // Always false, and not a decision this function makes: a page served over
    // HTTP has no preload, so there is no bridge to find.
    can_act: false,
    agents: () => fromHttp("/api/views/agents"),
    runs: () => fromHttp("/api/views/runs"),
    run: (agent, runId) =>
      fromHttp(
        `/api/views/run?agent=${encodeURIComponent(agent)}&run_id=${encodeURIComponent(runId)}`,
      ),
    connections: () => fromHttp("/api/views/connections"),
  };
}

/**
 * Which source this window has.
 *
 * Decided per call rather than cached at module scope: the module is evaluated
 * during server rendering on the developer path, where there is no `window` at
 * all, and a value captured then would be the wrong one forever.
 */
export function dataSource(): DashDataSource {
  const bridge = typeof window === "undefined" ? undefined : window.dashData;
  return bridge === undefined ? browserSource() : shellSource(bridge);
}
