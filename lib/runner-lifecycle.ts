/**
 * Starting and stopping one agent through the runner's authenticated routes.
 *
 * Extracted from `electron/handoff-host.ts` (MAR-597) so the one decision that
 * matters here is testable outside Electron: **when is a stop true?**
 *
 * A stop is true when the runner's own list says the agent is not running —
 * not merely when the lifecycle route said yes. That cuts both ways:
 *
 * - A route that answered ok is still polled until the list agrees, because
 *   "accepted the request" and "the process exited" are different facts.
 * - A route that answered not-ok is given one look at the list anyway, because
 *   a runner that has never heard of the agent has nothing to stop. A
 *   manifest-only agent (ADR 0008 slice 4) has no program and was never
 *   registered; an agent registered before a runner-store reset is a stranger
 *   to the fresh runner. Refusing their removal strands them forever — the
 *   MAR-597 finding, two agents nobody could remove.
 *
 * A genuinely running agent whose stop failed still refuses: it is in the
 * list, its lifecycle is live, and the poll runs out honestly.
 */

/** The one fetch shape this module needs; `runnerFetch` satisfies it. */
export type RunnerCall = (
  url: string,
  init: {
    method?: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface RunnerLifecycleOptions {
  /** How long a stop may wait for the runner's list to agree. */
  waitMs?: number;
  /** Poll interval while waiting. */
  pollMs?: number;
  /** Per-request timeout. */
  requestTimeoutMs?: number;
}

interface AgentFacts {
  agent_id?: string;
  lifecycle?: string;
}

const STOPPED_LIFECYCLES = new Set(["stopped", "exited", "failed_to_start"]);

export function runnerLifecycle(
  call: RunnerCall,
  origin: string,
  authorized: Record<string, string>,
  options: RunnerLifecycleOptions = {},
) {
  const waitMs = options.waitMs ?? 10_000;
  const pollMs = options.pollMs ?? 50;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;

  /** Is the agent absent from the runner's list, or present and not running? */
  async function listSaysStopped(agentId: string): Promise<boolean> {
    const response = await call(`${origin}/agents`, {
      headers: authorized,
      signal: AbortSignal.timeout(Math.min(requestTimeoutMs, 2_000)),
    });
    if (!response.ok) {
      throw new Error("the runner's list did not answer");
    }
    const body = (await response.json()) as { agents?: AgentFacts[] };
    const facts = body.agents?.find((agent) => agent.agent_id === agentId);
    return facts === undefined || STOPPED_LIFECYCLES.has(facts.lifecycle ?? "");
  }

  async function waitForStopped(agentId: string): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      try {
        if (await listSaysStopped(agentId)) {
          return true;
        }
      } catch {
        return false;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  async function lifecycle(
    agentId: string,
    action: "start" | "stop",
  ): Promise<{ ok: boolean; detail?: string }> {
    try {
      const response = await call(`${origin}/agents/${encodeURIComponent(agentId)}/lifecycle`, {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      if (action === "stop") {
        if (body.ok === true) {
          return (await waitForStopped(agentId))
            ? { ok: true, detail: body.detail }
            : {
                ok: false,
                detail: `The runner accepted the stop request for "${agentId}" but did not confirm that it stopped.`,
              };
        }
        // The not-ok path gets one look at the list, not the full wait: either
        // the agent was never the runner's to stop (absent, or already down)
        // and the stop is vacuously true, or it is genuinely running and the
        // route's refusal stands as given.
        try {
          if (await listSaysStopped(agentId)) {
            return { ok: true };
          }
        } catch {
          // The list did not answer; the route's refusal is all we know.
        }
      }
      return { ok: body.ok === true, detail: body.detail };
    } catch {
      return { ok: false, detail: "The runner could not be reached." };
    }
  }

  return { lifecycle, waitForStopped };
}
