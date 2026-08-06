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

import { localRunnerChannel } from "../lib/agent-dom/runner-channel";
import { createBroker, type BrokerAuditRow, type CredentialRead } from "../lib/broker/execute";
import {
  hasBrokerRequest,
  markBrokerAnswerUndelivered,
  recordBrokerCall,
  recordBrokerLapse,
  touchReceipt,
} from "../lib/broker/store";
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
import { type RunnerHandle } from "./runner-process";
import { secureStore } from "./secure-store";

/** How often the broker looks for work when it just found some. */
export const BROKER_BUSY_INTERVAL_MS = 250;
/** And when it did not. */
export const BROKER_IDLE_INTERVAL_MS = 1_000;

interface DrainedRequest {
  agent_id: string;
  request: unknown;
}

/** One agent's share of what the runner destroyed, as drained (MAR-467). */
interface DroppedTally {
  agent_id: string;
  count: number;
  first_at: string;
  last_at: string;
}

/**
 * Read the runner's drop tallies out of an untrusted drain body (MAR-467).
 *
 * The runner is DASH's own child and this is not a security boundary, but it is
 * a *version* boundary — an installed DASH can meet a runner from a different
 * build, which `runner_protocol` exists to catch and which a field added in one
 * release is the ordinary way to trip. A tally that does not parse is skipped
 * rather than defaulted, because a lapse row with an invented timestamp is a
 * record of something that did not happen at that time.
 */
function parseDroppedDetail(candidate: unknown): DroppedTally[] {
  if (!Array.isArray(candidate)) {
    return [];
  }
  const tallies: DroppedTally[] = [];
  for (const entry of candidate) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { agent_id: agentId, count, first_at: firstAt, last_at: lastAt } = entry as Record<string, unknown>;
    if (
      typeof agentId !== "string" ||
      agentId.length === 0 ||
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      count <= 0 ||
      typeof firstAt !== "string" ||
      typeof lastAt !== "string"
    ) {
      continue;
    }
    tallies.push({ agent_id: agentId, count, first_at: firstAt, last_at: lastAt });
  }
  return tallies;
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

  /**
   * A **broker-capable** channel, and that adjective is load-bearing (MAR-484).
   *
   * `localRunnerChannel` is the only constructor of `LocalRunnerChannel`, it
   * takes an OS-local endpoint, and it dials with `ipcFetch` — which speaks to
   * a `socketPath` and therefore cannot leave this machine. A remote host's
   * channel is a `RemoteRunnerChannel`, which is not assignable here, so the
   * refactor ADR 0007 warns about — generalise the drains to take a channel, and
   * `/broker/drain` comes along because it was in the same loop — stops
   * compiling instead of quietly shipping. See
   * `lib/agent-dom/runner-channel.ts` and
   * `tests/broker-channel-exclusion.test.ts`.
   *
   * Routes are now named rather than concatenated onto an origin, which is what
   * lets the type see them at all: `${origin}/broker/drain` is just a string.
   */
  const channel = localRunnerChannel(runner);

  /**
   * Every audit row this loop has written, in the order the broker wrote them
   * (MAR-467).
   *
   * `BrokerDeps.audit` is documented as "called exactly once per request, on
   * every path", and `pass` awaits one `handle` at a time, so the entries
   * appended across one `handle` call belong to that request. That is a real
   * coupling to a documented contract rather than a hopeful one — and the
   * request id is checked anyway before the id is used, because marking the
   * wrong decision undelivered would be a false statement in the one table that
   * must not contain any.
   *
   * Truncated at the top of every pass, so it is a scratchpad for the batch in
   * hand and not a second copy of the audit table in memory.
   */
  const written: Array<{ id: number | null; request_id: string }> = [];

  const broker = createBroker({
    readManifest: (agentId: string) =>
      readAgentManifest(agentId) as ConnectionSourceManifest | null,
    readCredential,
    mintAccessToken,
    fetchImpl: fetch,
    // The durable replay memory a write needs (MAR-469). Supplied here rather
    // than imported inside the broker because `lib/broker/` touches no store,
    // and this is the same seam `readCredential` and `mintAccessToken` occupy.
    hasHandledRequest: hasBrokerRequest,
    audit: (row: BrokerAuditRow) => {
      written.push({ id: recordBrokerCall(row), request_id: row.request_id });
    },
    touchGrant: (grant, at) => {
      touchReceipt(grant.agent_id, grant.connection_id, at);
    },
    now: () => new Date(),
  });

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function pass(): Promise<boolean> {
    written.length = 0;
    let drained: DrainedRequest[];
    try {
      const response = await channel.call("/broker/drain", {
        method: "POST",
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as {
        requests?: unknown;
        dropped?: unknown;
        dropped_detail?: unknown;
      };
      if (typeof body.dropped === "number" && body.dropped > 0) {
        log(
          `[dash-shell] the runner dropped ${String(body.dropped)} brokered ` +
            `request${body.dropped === 1 ? "" : "s"} before this pass; ` +
            `${body.dropped === 1 ? "that agent is" : "those agents are"} waiting for an answer that will not come`,
        );
      }
      // Written down rather than only logged (MAR-467). This is the first of the
      // three ways a brokered request leaves no trace: the runner read it, the
      // bounded buffer was full, and it was destroyed before DASH ever saw it.
      // DASH is recording somebody else's observation here, which is why the row
      // says `observed_by: "runner"` and carries no operation — see
      // `BrokerDropTally` for why the runner does not know one.
      for (const tally of parseDroppedDetail(body.dropped_detail)) {
        recordBrokerLapse({
          kind: "dropped_by_runner",
          agent: tally.agent_id,
          attempts: tally.count,
          from_at: tally.first_at,
          until_at: tally.last_at,
          observed_by: "runner",
        });
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
    /**
     * The audit row behind each answer, positionally aligned with `answers`
     * (MAR-467), or null where there is none to point at — a request the broker
     * threw on before auditing, or an audit write that itself failed. Null means
     * the delivery failure is real and unrecordable, which is better left blank
     * than pinned on the nearest row.
     */
    const auditIds: Array<number | null> = [];

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
      // Checked, not assumed. If the broker threw before auditing, the newest
      // entry belongs to an earlier request — or there is none — and this answer
      // gets no row to point at rather than the wrong one.
      const audited = written[written.length - 1];
      auditIds.push(
        audited !== undefined && audited.request_id === parsed.request_id ? audited.id : null,
      );
    }

    if (answers.length > 0) {
      try {
        const delivery = await channel.call("/broker/responses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ responses: answers }),
          signal: AbortSignal.timeout(3_000),
        });
        // The response body was previously discarded, and it already carried the
        // answer (MAR-467): the runner writes each line to a child's stdin and
        // knows perfectly well when there is no child left to write to. The third
        // way a brokered request leaves no trace was observed all along and
        // thrown away one line short of a place to put it.
        const settled = (await delivery.json()) as { undelivered_index?: unknown };
        const lost = Array.isArray(settled.undelivered_index) ? settled.undelivered_index : [];
        for (const index of lost) {
          if (typeof index !== "number" || !Number.isInteger(index)) {
            continue;
          }
          const auditId = auditIds[index];
          if (auditId !== undefined && auditId !== null) {
            markBrokerAnswerUndelivered(auditId);
          }
        }
        if (lost.length > 0) {
          log(
            `[dash-shell] ${String(lost.length)} brokered answer${lost.length === 1 ? "" : "s"} ` +
              `could not be delivered: the agent had exited by the time DASH decided`,
          );
        }
      } catch {
        // The agents wait and time out. Nothing here is retried: a brokered
        // answer is bound to a request id the agent has already given up on by
        // the time a retry would arrive, and re-running the operation to produce
        // a fresh one would be a second read of somebody's mail for a question
        // nobody is still asking.
        //
        // Every answer in the batch is marked undelivered, because none of them
        // can be shown to have arrived (MAR-467). This branch also catches a
        // body that would not parse, which is why it marks rather than assumes:
        // the request may well have been delivered and DASH cannot say so, and
        // "not known to have arrived" is the claim the column is built to make.
        for (const auditId of auditIds) {
          if (auditId !== null) {
            markBrokerAnswerUndelivered(auditId);
          }
        }
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
