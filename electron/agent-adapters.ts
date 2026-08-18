/**
 * How DASH reaches an agent, and how it learns what that agent is doing.
 *
 * Two jobs, together because they are the same decision seen twice: an agent
 * DASH can send a command to is an agent DASH can read state from, over the
 * same channel with the same credential.
 *
 * ## Where a control location comes from
 *
 * For an agent the bundled runner hosts, the runner's own route is the answer —
 * `{runner-origin}/agents/{id}` — and the manifest's declared `uri` is not
 * consulted. That is not DASH overriding the agent author: the runner listens
 * on an **ephemeral port**, so no manifest written in advance could name it,
 * and the runner is the authority on what it supervises. DASH asks it.
 *
 * For every other agent the manifest is the only source, resolved by
 * `resolveControlLocation`, which is where "loopback may use http, everything
 * else must use https" is enforced.
 *
 * ## The same code path, which is the point
 *
 * Both kinds end up as a `ControlChannel` handed to the same `httpAdapter`.
 * Nothing below branches on local versus remote once a channel exists — the
 * issue's fifth acceptance criterion, met by construction rather than by
 * arranging for two implementations to behave alike.
 *
 * What a remote agent still needs, and DASH cannot yet mint, is a credential.
 * Adapter enrollment is on the Agent DOM v2 contract's deferred list, so DASH
 * reads one from the vault if an operator put it there and otherwise leaves
 * that agent on `noAdapter` — read-only, and honest about why.
 */

import { resolveControlLocation } from "../lib/agent-dom/control-location";
import { pullEvidence } from "../lib/agent-dom/evidence";
import { noAdapter, runAgentCommand, type AgentDomAdapter } from "../lib/agent-dom/runner";
import { localRunnerChannel } from "../lib/agent-dom/runner-channel";
import { putAgentDomState, readAgentDomState } from "../lib/agent-dom/store";
import {
  readStandingAnswer,
  standingAnswerPrincipal,
  standingAutoAnswers,
} from "../lib/agent-dom/standing-answers";
import { fetchAgentDomState, httpAdapter, type ControlChannel } from "../lib/agent-dom/transport";
import { isManifestV2 } from "../lib/contracts";
import { isSecureStoreError, type SecureStore } from "../lib/secure-store";
import { listAgentNames, readAgentManifest, recordEvidencePull } from "../lib/store";
import { runnerFetch, type RunnerHandle } from "./runner-process";

/**
 * How often DASH re-reads every agent's state.
 *
 * The issue's acceptance criterion is that a killed agent shows as stopped
 * "within one poll interval", so this value is that promise. Five seconds is
 * short enough that a person watching the screen sees it happen and long enough
 * that a dozen agents cost nothing.
 */
export const POLL_INTERVAL_MS = 5_000;

/** Where a remote agent's channel credential would live, if an operator set one. */
export function adapterTokenName(agentId: string): string {
  // Lowercased and narrowed to satisfy `isValidSecretName`.
  const safe = agentId.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  return `dash.adapter.${safe}.token`;
}

export interface AgentChannels {
  /** The channel for an agent, or null when DASH cannot reach it. */
  channelFor(agentId: string): ControlChannel | null;
  adapterFor(agentId: string): AgentDomAdapter;
  /** Re-read which agents the runner hosts. Cheap; called on the poll tick. */
  refresh(): Promise<void>;
  /** One pass over every agent DASH can reach. */
  poll(): Promise<void>;
}

interface HostedAgent {
  agent_id: string;
}

/**
 * The source id DASH records its own reading of the local runner under
 * (MAR-488).
 *
 * A constant rather than a derived name because there is exactly one runner on
 * this machine, by design — `electron/runner-process.ts` adopts the running one
 * rather than starting a second. A host gets its own id from its host record
 * when MAR-498's surface can produce one.
 */
const LOCAL_SOURCE = "local";

export function createAgentChannels(
  runner: RunnerHandle | null,
  store: SecureStore,
  log: (line: string) => void = (line) => { console.warn(line); },
): AgentChannels {
  /** Agent ids the runner reports supervising. Empty when there is no runner. */
  let hosted = new Set<string>();
  /** Remote credentials read from the vault, by agent id. Absent means none. */
  const remoteTokens = new Map<string, string | null>();

  async function refresh(): Promise<void> {
    if (runner === null) {
      return;
    }
    try {
      // The runner's own endpoint, not the network. `runnerFetch` speaks HTTP
      // down the socket or pipe; global `fetch` cannot reach either.
      const response = await runnerFetch(runner)(`${runner.origin}/agents`, {
        headers: { authorization: `Bearer ${runner.token}` },
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) {
        return;
      }
      const body = (await response.json()) as { agents?: HostedAgent[] };
      hosted = new Set((body.agents ?? []).map((agent) => agent.agent_id));
    } catch {
      // A runner that stopped answering is not an error to shout about on every
      // tick; the agents it held will report as unreachable on their own.
    }
  }

  async function remoteToken(agentId: string): Promise<string | null> {
    const cached = remoteTokens.get(agentId);
    if (cached !== undefined) {
      return cached;
    }
    let token: string | null = null;
    try {
      token = await store.get(adapterTokenName(agentId));
    } catch (error: unknown) {
      if (!isSecureStoreError(error) || error.code !== "not_found") {
        log(`[dash-shell] could not read the adapter token for ${agentId}`);
      }
    }
    remoteTokens.set(agentId, token);
    return token;
  }

  /**
   * One pass over the local runner's evidence routes (MAR-488).
   *
   * The three drains this replaced lived here and each opened with
   * `if (runner === null) { return; }`, hardcoded to the one runner this machine
   * spawned. `lib/agent-dom/evidence.ts` holds them now, written against a
   * channel — so a runner on a host is pulled by the same implementation, and
   * `/broker/drain` cannot join them because the channel type they take does not
   * carry it. ADR 0007's load-bearing paragraph is about exactly this refactor;
   * the module's own header is where it is answered.
   *
   * The runner still resolves to `null` when this machine has none, and the
   * check stays here rather than moving into the module: a source that does not
   * exist has no reading to record, and writing "DASH looked and found nothing"
   * about a runner that was never started would be the kind of false completeness
   * this whole slice is against.
   */
  async function pullLocalEvidence(): Promise<void> {
    if (runner === null) {
      return;
    }

    const pull = await pullEvidence(localRunnerChannel(runner), {
      source: LOCAL_SOURCE,
      kind: "this_machine",
      log,
    });

    try {
      // Recorded on every pass, including the ones with nothing to disclose:
      // "when DASH last looked" is half the sentence the Runs page carries, and
      // it is only true if it is written when the answer is boring.
      recordEvidencePull(pull);
    } catch {
      // The store being unwritable is already reported by everything else that
      // touches it. A poll that could not record its own reading must not be a
      // poll that stops.
    }
  }

  /** Synchronous channel resolution, for the command path. */
  function channelFor(agentId: string): ControlChannel | null {
    if (runner !== null && hosted.has(agentId)) {
      return {
        uri: `${runner.origin}/agents/${encodeURIComponent(agentId)}`,
        token: runner.token,
        // What makes this channel local. `lib/agent-dom/transport.ts` dials the
        // endpoint instead of resolving the uri, and everything else about the
        // adapter — the byte ceiling, the timeout, the scrubbed detail — is the
        // same code a remote agent gets.
        ipc_path: runner.endpoint,
      };
    }

    const manifest = readAgentManifest(agentId);
    if (manifest === null || !isManifestV2(manifest)) {
      return null;
    }
    const location = resolveControlLocation(manifest);
    if (!location.ok) {
      return null;
    }
    const token = remoteTokens.get(agentId);
    if (token === undefined || token === null) {
      // Declared, reachable in principle, and DASH holds no credential for it.
      return null;
    }
    return { uri: location.uri, token };
  }

  /** The command path's own resolution, `channelFor`'s neighbour so `poll` can share it. */
  function adapterFor(agentId: string): AgentDomAdapter {
    const channel = channelFor(agentId);
    return channel === null ? noAdapter : httpAdapter(channel);
  }

  /**
   * Answer, without a popup, every fresh choice a standing answer covers
   * (MAR-681, build item 1).
   *
   * Reads the row `putAgentDomState` just wrote rather than trusting the
   * document the runner sent this tick — `observed_at` has to be the value
   * DASH actually holds, `enforceCommand`'s `stale_snapshot` check otherwise
   * refuses every one of these on the freeze `lib/agent-dom/store.ts`
   * describes. Goes through the same `runAgentCommand` pipeline a live click
   * does: the same nonce, the same idempotency key, the same audit row, and
   * the same `choice_expired`/`choice_already_made`/`unknown_option` checks —
   * a second, narrower path to "the runner accepted a choose" is exactly how
   * a standing answer could come to bypass a rule enforcement already makes.
   */
  async function applyStandingAnswers(agentId: string): Promise<void> {
    const held = readAgentDomState(agentId);
    if (held === null) {
      return;
    }
    const answers = standingAutoAnswers(held.state, new Date(), (questionKey) =>
      readStandingAnswer(agentId, questionKey),
    );
    for (const answer of answers) {
      const issued = await runAgentCommand(
        {
          request_id: `standing-answer:${answer.choice_id}`,
          command: "choose",
          target: { agent_id: agentId, task_id: answer.task_id, choice_id: answer.choice_id },
          observed_at: held.observed_at,
          option_id: answer.option_id,
          payload_keys: ["agent_id", "task_id", "choice_id", "option_id", "observed_at"],
          mutates: true,
          irreversible: true,
          reason: "Answered automatically from a standing answer.",
        },
        { principal: standingAnswerPrincipal(), adapter: adapterFor(agentId) },
      );
      if (!issued.ok) {
        log(
          `[dash-shell] ${agentId}'s standing answer for one question could not be applied: ` +
            `${issued.reason ?? issued.detail ?? "unknown"}`,
        );
      }
    }
  }

  return {
    channelFor,
    adapterFor,
    refresh,

    async poll(): Promise<void> {
      await refresh();
      await pullLocalEvidence();

      for (const agentId of listAgentNames()) {
        // Warm the vault lookup so `channelFor` can stay synchronous on the
        // command path, where an await would sit between the user's click and
        // the enforcement that decides whether it was allowed.
        await remoteToken(agentId);

        const channel = channelFor(agentId);
        if (channel === null) {
          continue;
        }

        const result = await fetchAgentDomState(channel);
        if (!result.ok) {
          continue;
        }

        // The first non-fixture caller of `putAgentDomState`. It validates
        // against `agent-dom-state.schema.json` before storing, so a runner
        // that emitted a bad document is refused here rather than being allowed
        // to decide whether a command may run.
        const stored = putAgentDomState(result.state);
        if (!stored.ok) {
          log(
            `[dash-shell] ${agentId} published a state snapshot that fails the contract: ` +
              stored.errors.slice(0, 3).join("; "),
          );
        }

        if (stored.ok) {
          await applyStandingAnswers(agentId);
        }
      }
    },
  };
}

/**
 * Start the poll loop, returning a function that stops it.
 *
 * `setInterval` would overlap a slow pass with the next one; a self-scheduling
 * timeout cannot. With a dozen agents on one unreachable runner, each pass
 * costs a full round of connection timeouts, and overlapping passes would pile
 * up until something gave.
 */
export function startPolling(
  channels: AgentChannels,
  intervalMs: number = POLL_INTERVAL_MS,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = (): void => {
    void channels
      .poll()
      .catch(() => {
        // Individual failures are handled inside `poll`; this is the guard that
        // keeps one unexpected throw from ending the loop for every agent.
      })
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(tick, intervalMs);
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
