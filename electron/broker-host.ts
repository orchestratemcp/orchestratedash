/**
 * The broker, wired to the three impure things it needs (MAR-458, ADR 0002).
 *
 * `lib/broker/` decides everything and touches nothing. This is the other half:
 * the OS vault, the runner's socket, and the loop that moves requests one way
 * and answers the other. It is deliberately thin, for the reason `electron/`
 * modules generally are — what is here cannot be unit-tested without launching
 * Electron, so as little as possible should be here.
 *
 * ## Why the broker runs in Electron main and not in the runner
 *
 * Because the vault does. `safeStorage` is an Electron API, so the refresh token
 * is only readable in this process — which turns ADR 0002 invariant 1 from a
 * rule someone must follow into a fact about where the code can run. The runner
 * relays; it never holds a grant, never mints a token, and could not if it
 * wanted to.
 *
 * The cost is the honest one: **when DASH is not running, the broker is not
 * running.** A hosted agent whose runtime declares `continues_when_dash_closed`
 * keeps working and its brokered calls stop being answered. That is not a
 * limitation to design around — it is the correct behaviour, because the
 * alternative is a process that can reach a user's mailbox while the app they
 * granted it through is closed.
 *
 * ## Why the loop is faster than the agent poll
 *
 * `agent-adapters.ts` polls every five seconds, which is right for "is this
 * agent still alive" and absurd for a request an agent is blocked on. So this
 * has its own cadence: quick while there is work, slower when there is not, so
 * an idle machine is not paying for a busy one's latency.
 */

import { createBroker, type BrokerAuditRow, type CredentialRead } from "../lib/broker/execute";
import { recordBrokerCall, touchReceipt } from "../lib/broker/store";
import {
  encodeBrokerResponse,
  parseBrokerRequest,
  refuse,
  type BrokerResponse,
} from "../lib/broker/protocol";
import type { ConnectionSourceManifest } from "../lib/connections";
import { parseOAuthCredential } from "../lib/oauth/credential";
import { isSecureStoreError } from "../lib/secure-store";
import { readAgentManifest } from "../lib/store";
import { mintAccessToken } from "./oauth-session";
import { runnerFetch, type RunnerHandle } from "./runner-process";
import { secureStore } from "./secure-store";

/** How often the broker looks for work when it just found some. */
export const BROKER_BUSY_INTERVAL_MS = 250;
/** And when it did not. */
export const BROKER_IDLE_INTERVAL_MS = 1_000;

interface DrainedRequest {
  agent_id: string;
  request: unknown;
}

/**
 * Read one grant from the OS vault.
 *
 * The four outcomes are `lib/broker/execute.ts`'s, and they are kept apart for
 * the reason `lib/connection-actions.ts` keeps its own four apart: a vault that
 * will not open and a connection that was never made are different sentences and
 * different recoveries, and collapsing them here would make the broker's refusal
 * codes less honest than the Connection Center's.
 */
async function readCredential(secretName: string): Promise<CredentialRead> {
  let raw: string;
  try {
    raw = await secureStore().get(secretName);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return error.code === "not_found" ? { kind: "absent" } : { kind: "vault_error" };
    }
    return { kind: "vault_error" };
  }
  const credential = parseOAuthCredential(raw);
  return credential === null ? { kind: "unusable" } : { kind: "found", credential };
}

/**
 * Start answering brokered requests, returning a function that stops.
 *
 * A self-scheduling timeout rather than `setInterval`, for the reason
 * `startPolling` uses one: a slow pass must not overlap the next, and a machine
 * whose vault is prompting for an unlock would otherwise stack passes until
 * something gave.
 */
export function startBroker(
  runner: RunnerHandle | null,
  log: (line: string) => void = (line) => {
    console.warn(line);
  },
): () => void {
  if (runner === null) {
    // No runner means no hosted agents means nothing to broker for. Returning a
    // no-op rather than looping against a null keeps the caller from having to
    // know that.
    return () => undefined;
  }

  const call = runnerFetch(runner);

  const broker = createBroker({
    readManifest: (agentId: string) =>
      readAgentManifest(agentId) as ConnectionSourceManifest | null,
    readCredential,
    mintAccessToken,
    fetchImpl: fetch,
    audit: (row: BrokerAuditRow) => {
      recordBrokerCall(row);
    },
    touchGrant: (grant, at) => {
      touchReceipt(grant.agent_id, grant.connection_id, at);
    },
    now: () => new Date(),
  });

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function pass(): Promise<boolean> {
    let drained: DrainedRequest[];
    try {
      const response = await call(`${runner!.origin}/broker/drain`, {
        method: "POST",
        headers: { authorization: `Bearer ${runner!.token}` },
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as { requests?: unknown; dropped?: unknown };
      if (typeof body.dropped === "number" && body.dropped > 0) {
        log(
          `[dash-shell] the runner dropped ${String(body.dropped)} brokered ` +
            `request${body.dropped === 1 ? "" : "s"} before this pass; ` +
            `${body.dropped === 1 ? "that agent is" : "those agents are"} waiting for an answer that will not come`,
        );
      }
      drained = Array.isArray(body.requests) ? (body.requests as DrainedRequest[]) : [];
    } catch {
      // A runner that stopped answering is reported by the state poll, not by a
      // line on every tick of this one.
      return false;
    }

    if (drained.length === 0) {
      return false;
    }

    const answers: Array<{ agent_id: string; line: string }> = [];

    for (const candidate of drained) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        typeof candidate.agent_id !== "string" ||
        candidate.agent_id.length === 0
      ) {
        // No agent identity means no manifest to consult and nowhere to send an
        // answer. The runner attaches it from the child it read the line from,
        // so an envelope without one is a bug on that side rather than an agent's
        // doing — and it is refused rather than guessed at.
        log("[dash-shell] rejected a brokered request envelope: no agent identity");
        continue;
      }

      const parsed = parseBrokerRequest(candidate.request);
      if (parsed === null) {
        // Deliberately unanswered. A malformed candidate has no request id, so
        // there is nothing to address a refusal to — inventing one would be
        // answering a message nobody sent. The agent's own timeout covers it.
        log(`[dash-shell] ${candidate.agent_id} sent a brokered request DASH could not read`);
        continue;
      }

      let response: BrokerResponse;
      try {
        response = await broker.handle(candidate.agent_id, parsed);
      } catch (error: unknown) {
        // An unexpected throw is DASH's bug. The agent still gets an answer,
        // because an agent waiting forever on a DASH bug is a worse outcome than
        // one told the broker failed — and the reason is logged here, where a
        // developer can see it, rather than crossing to the agent.
        log(
          `[dash-shell] the broker threw answering ${candidate.agent_id}: ` +
            `${error instanceof Error ? error.message : "unknown"}`,
        );
        response = refuse(parsed.request_id, "broker_error");
      }

      answers.push({ agent_id: candidate.agent_id, line: encodeBrokerResponse(response) });
    }

    if (answers.length > 0) {
      try {
        await call(`${runner!.origin}/broker/responses`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${runner!.token}` },
          body: JSON.stringify({ responses: answers }),
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        // The agents wait and time out. Nothing here is retried: a brokered
        // answer is bound to a request id the agent has already given up on by
        // the time a retry would arrive, and re-running the operation to produce
        // a fresh one would be a second read of somebody's mail for a question
        // nobody is still asking.
        log("[dash-shell] could not deliver brokered answers to the runner");
      }
    }

    return true;
  }

  const tick = (): void => {
    void pass()
      .catch(() => false)
      .then((busy) => {
        if (!stopped) {
          timer = setTimeout(tick, busy ? BROKER_BUSY_INTERVAL_MS : BROKER_IDLE_INTERVAL_MS);
          timer.unref?.();
        }
      });
  };

  tick();

  return () => {
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
    }
  };
}
