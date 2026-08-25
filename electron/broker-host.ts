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
import { parseAiKeyCredential } from "../lib/ai/credential";
import { aiKeyConnections, pickAiKeyCard } from "../lib/ai/connection-view";
import { resolveModelSteps } from "../lib/ai/model-choice";
import {
  readEffectiveStepModel,
  readFleetModelDefault,
  readStepLevelOverrides,
} from "../lib/ai/model-store";
import {
  stepsNeedingAModel,
  type DefaultModelLevel,
  type PlannedRouteStep,
} from "../lib/ai/model-levels";
import { aiAuthHeaders, aiProviderById } from "../lib/ai/providers";
import { chiefManifest } from "../lib/chief/manifest";
import { isKeyCredential, type BrokerCredential } from "../lib/broker/grant";
import { createBroker, type Broker, type BrokerAuditRow, type CredentialRead } from "../lib/broker/execute";
import { agentPrincipal } from "../lib/broker/principal";
import { SPEND_ALLOWANCE_MS } from "../lib/broker/spend-allowance";
import { readAgentSchedule } from "../lib/schedule/store";
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
import { readFleetConnection } from "../lib/fleet/store";
import { readAgentManifest } from "../lib/store";
import { hostBrowserController } from "./browser-host";
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
 * One ceiling the runner says it opened, read out of an untrusted drain body
 * (MAR-784, ADR 0029 amendment 1).
 *
 * `parseDroppedDetail`'s discipline and one of its two reasons, sharpened. That
 * function calls the runner "DASH's own child and not a security boundary"
 * because a drop tally can only ever make DASH write a row about a lapse. This
 * field decides whether an agent may spend somebody's money, so it is read as if
 * the sender were hostile even though it is not — and then, having been read, it
 * is still not believed: `openScheduledAllowances` grants the smaller of this
 * number and the ceiling in DASH's own store.
 *
 * A member that does not parse is skipped, which means no allowance, which means
 * the scheduled run behaves exactly as it did before this feature existed. Every
 * failure of this parser degrades to ADR 0029 decision 6.
 */
interface DrainedAllowance {
  agent_id: string;
  fire_id: string;
  opened_at: string;
  calls: number;
}

function parseScheduledAllowances(candidate: unknown): DrainedAllowance[] {
  if (!Array.isArray(candidate)) {
    return [];
  }
  const allowances: DrainedAllowance[] = [];
  for (const entry of candidate) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const {
      agent_id: agentId,
      fire_id: fireId,
      opened_at: openedAt,
      calls,
    } = entry as Record<string, unknown>;
    if (
      typeof agentId !== "string" ||
      agentId.length === 0 ||
      typeof fireId !== "string" ||
      fireId.length === 0 ||
      typeof openedAt !== "string" ||
      Number.isNaN(new Date(openedAt).getTime()) ||
      typeof calls !== "number" ||
      !Number.isInteger(calls) ||
      calls <= 0
    ) {
      continue;
    }
    allowances.push({ agent_id: agentId, fire_id: fireId, opened_at: openedAt, calls });
  }
  return allowances;
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
  // Two parsers, each of which refuses the other's envelope, tried in a fixed
  // order (MAR-582). Neither can accept a value the other wrote — see
  // `lib/ai/credential.ts` on the discriminator — so the order is for
  // readability rather than for correctness, and `unusable` still means what it
  // meant: something is under that name and this version cannot read it.
  const grant = parseOAuthCredential(raw);
  if (grant !== null) {
    return { kind: "found", credential: grant };
  }
  const key = parseAiKeyCredential(raw);
  return key === null ? { kind: "unusable" } : { kind: "found", credential: key };
}

/**
 * Turn a stored credential into the headers that authorize one request
 * (MAR-582).
 *
 * The branch that decides which of DASH's two custody models is in force, kept
 * in main beside the vault because both halves need something only main has:
 * the OAuth half exchanges a refresh token over the network, and the key half
 * holds the key itself.
 *
 * Neither branch returns the credential. `mintAccessToken` returns a short-lived
 * token that this function immediately spends on a header string, and
 * `aiAuthHeaders` is the one function in DASH that puts a model key anywhere.
 * What leaves is a header map whose names `lib/broker/execute.ts` checks against
 * a frozen set before it uses them.
 */
async function mintAuthorization(credential: BrokerCredential): Promise<Record<string, string>> {
  if (isKeyCredential(credential)) {
    const profile = aiProviderById(credential.provider);
    if (profile === null) {
      // An envelope naming a provider this build has dropped. Unreachable
      // through `parseAiKeyCredential`, which refuses one — so reaching it means
      // DASH changed its registry between the parse and here, and a throw is the
      // honest answer rather than an unauthorized request.
      throw new Error("no model provider profile for a stored key");
    }
    return aiAuthHeaders(profile, credential.key);
  }
  const minted = await mintAccessToken(credential);
  return { authorization: `Bearer ${minted.access_token}` };
}

/**
 * Start answering brokered requests, returning a function that stops.
 *
 * A self-scheduling timeout rather than `setInterval`, for the reason
 * `startPolling` uses one: a slow pass must not overlap the next, and a machine
 * whose vault is prompting for an unlock would otherwise stack passes until
 * something gave.
 */
/**
 * Every audit row the broker has written, newest last (MAR-467).
 *
 * Module-level since MAR-545, because the broker is. `BrokerDeps.audit` is
 * documented as "called exactly once per request, on every path" and `pass`
 * awaits one `handle` at a time, so the entry appended across one `handle` call
 * belongs to that request — but a question the *person* asked can now be
 * awaiting a provider at the same moment, and its row lands in this array too.
 *
 * That is why the request id is checked before an id is used rather than the
 * newest row being trusted. A mismatch yields no id, and no id means the
 * delivery failure is recorded as unrecordable instead of being pinned on
 * somebody else's row — which is the outcome that was already written down for
 * a broker that threw, arrived at now for a second reason.
 *
 * Truncated at the top of every drain pass, so it is a scratchpad for the batch
 * in hand and not a second copy of the audit table in memory.
 */
const written: Array<{ id: number | null; request_id: string }> = [];

let broker: Broker | null = null;

/**
 * The one broker in this process, made on first use (MAR-545).
 *
 * It used to live inside `startBroker`'s closure, which was right while the only
 * thing that could reach it was the loop that drains an agent's requests. It is
 * out here now because a **person** can reach it too: the agent page's chat
 * asks a model a question, and ADR 0002 invariant 2 says the credential exists
 * inside one function — so the question goes through the same `handle` as
 * everything an agent asks for, with `"person"` rather than `"agent"`.
 *
 * One instance and not two, which is the part worth being deliberate about. The
 * budgets in `lib/broker/execute.ts` are per-broker, so a second instance for
 * the chat would have been a second set of budgets — and an agent and a person
 * reaching the same account through two independently-counted windows is twice
 * the rate limit, arrived at by accident.
 *
 * Made without a runner, because it does not need one. The chat works on a
 * machine where no agent is running at all.
 */
export function hostBroker(): Broker {
  if (broker !== null) {
    return broker;
  }
  broker = createBroker({
    /*
     * Two answers, and the branch lives here rather than in the broker
     * (MAR-659, ADR 0023 decision 2).
     *
     * An agent gets the document DASH imported for it, read out of the store
     * exactly as it always was — that path is not edited, which is what keeps
     * "what the broker resolves for an agent is indistinguishable from today" a
     * consequence of not touching it rather than a claim needing proof.
     *
     * The chief has no imported document, so DASH composes one from the fleet
     * catalogue for whichever provider its own default names. No default means
     * no provider means no manifest, which the broker reports as
     * `unknown_connection` — the chief cannot spend before somebody has chosen
     * what it would spend on, and `lib/copy/chief-chat.ts` is where that becomes
     * a sentence pointing at the AI tab.
     */
    readManifest: (principal) =>
      principal.kind === "chief"
        ? chiefManifest(readFleetModelDefault()?.provider_id ?? "")
        : (readAgentManifest(principal.agent_id) as ConnectionSourceManifest | null),
    readFleetSecretName: (provider) => readFleetConnection(provider)?.secret_name ?? null,
    readCredential,
    mintAuthorization,
    fetchImpl: fetch,
    // The durable replay memory a write needs (MAR-469) and a spend needs
    // (MAR-545). Supplied here rather than imported inside the broker because
    // `lib/broker/` touches no store, and this is the same seam
    // `readCredential` and `mintAuthorization` occupy.
    hasHandledRequest: hasBrokerRequest,
    // Which model this agent's owner named, for an agent-origin spend
    // (MAR-619). Supplied here for `hasHandledRequest`'s reason — the broker
    // touches no store — and it reads the same row the model picker writes and
    // the chat asks under, so an agent's own step and a person's question
    // cannot end up on two different models.
    //
    // MAR-642: the same row, plus DASH's default underneath it. The provider is
    // resolved from this agent's own manifest rather than assumed, because a
    // default naming one service must not put its model id into a request bound
    // for another — `applyFleetDefault` is where that is decided, and this is
    // the one seam where the manifest has to be opened to answer it.
    //
    // MAR-654, A1.4: the same rows plus the person's level map, resolved for the
    // step the agent named. **The level is read here and never carried in the
    // request.** `agentStepLevel` joins DASH's own copy of the manifest to the
    // person's per-step overrides, so a `step` an agent invented reaches at most
    // a level that agent's own author declared — and a step the manifest does not
    // have reaches nothing at all. That is the bound A1.4 states and
    // `tests/broker-threat-model.test.ts` proves.
    readModelChoice: (agentId: string, step: number | null) => {
      const provider = agentProviderId(agentId);
      const choice = readEffectiveStepModel(
        agentId,
        provider,
        step === null ? null : agentStepLevel(agentId, step),
      ).choice;
      return choice.kind === "one_model" ? choice.model_id : null;
    },
    // MAR-628, ADR 0019. Whether this agent has read a web page through DASH's
    // controlled browser in the run it is in now — after which a write or a
    // spend in the same run needs a person. Supplied here for
    // `hasHandledRequest`'s reason: `lib/broker/` touches no store and knows
    // nothing about a browser, and this is the seam where the module that owns
    // both the session and DASH's view of the run can be asked.
    hasReadUntrusted: (agentId: string) => hostBrowserController().hasReadUntrusted(agentId),
    audit: (row: BrokerAuditRow) => {
      written.push({ id: recordBrokerCall(row), request_id: row.request_id });
    },
    touchGrant: (grant, at) => {
      touchReceipt(grant.agent_id, grant.connection_id, at);
    },
    now: () => new Date(),
  });
  return broker;
}

/**
 * Which model provider DASH would ask for one agent, or null (MAR-642).
 *
 * Only ever used to decide whether DASH's default model reaches this agent, and
 * null — an agent DASH has no manifest for, or one that declares no model
 * provider — is a complete answer to that: no provider means no match, which
 * means no default, which is what the agent had before a default existed.
 *
 * The manifest read is the one `createBroker` already does for every request
 * through `readManifest`, repeated here rather than threaded through the seam
 * because widening `readModelChoice` would put an agent's connection vocabulary
 * inside `lib/broker/execute.ts`, which is the module that must stay a pure
 * function of what it is handed.
 */
function agentProviderId(agentId: string): string | null {
  const manifest = readAgentManifest(agentId) as ConnectionSourceManifest | null;
  if (manifest === null) {
    return null;
  }
  return pickAiKeyCard(aiKeyConnections(agentId, manifest))?.provider_id ?? null;
}

/**
 * What level one of an agent's steps asks for, or null (MAR-654, A1.4).
 *
 * **The join that makes a named step safe.** The agent said a number; this reads
 * DASH's own copy of that agent's manifest, takes the steps that declare a level,
 * folds the person's own `agent_step_levels` overrides onto them exactly as the
 * screen does, and returns the level for that number. Nothing from the request
 * reaches any of it except the number itself.
 *
 * Null for three different things, all of which resolve the same way — pin, then
 * default, then refusal:
 *
 * - an agent DASH holds no manifest for;
 * - a step number that plan does not have, which is what a lying `step` is;
 * - a step that declares no level, which is a step that needs no model.
 *
 * So an agent's ceiling is the strongest level **its own author declared**, which
 * is exactly what an author writing `frontier` is already asking the person to
 * pay for. A step number is not a capability.
 *
 * The manifest read is the one `createBroker` already does through
 * `readManifest`, repeated here rather than threaded through the seam for
 * `agentProviderId`'s stated reason: widening `readModelChoice` would put an
 * agent's plan vocabulary inside `lib/broker/execute.ts`, which must stay a pure
 * function of what it is handed.
 */
function agentStepLevel(agentId: string, step: number): DefaultModelLevel | null {
  const manifest = readAgentManifest(agentId) as
    | (ConnectionSourceManifest & { planned_route?: readonly PlannedRouteStep[] })
    | null;
  if (manifest === null) {
    return null;
  }
  const declared = stepsNeedingAModel(manifest.planned_route ?? []);
  const resolved = resolveModelSteps(declared, readStepLevelOverrides(agentId));
  return resolved.find((one) => one.step === step)?.level ?? null;
}

export function startBroker(
  runner: RunnerHandle | null,
  log: (line: string) => void = (line) => {
    console.warn(line);
  },
): () => void {
  if (runner === null) {
    // No runner means no hosted agents means nothing to *drain*. Returning a
    // no-op rather than looping against a null keeps the caller from having to
    // know that — and note it says nothing about the broker itself, which
    // `hostBroker` makes on demand for the person's own questions.
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

  const broker = hostBroker();

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  /**
   * Scheduled fires this loop has already opened an allowance for (MAR-784).
   *
   * **The whole reason `ScheduledAllowance` carries a `fire_id`.** The runner
   * reports a live ceiling on every drain for as long as it lasts — it has to,
   * because a drain that failed must not cost somebody their run — and
   * `allowRunSpend` *replaces* what it holds rather than topping it up. Opening
   * on every mention would therefore restore the ceiling to full several times a
   * minute, which is not a ceiling. Opening on the first mention of each fire id
   * and ignoring the rest is what makes "at most N calls per scheduled run" true.
   *
   * Bounded, and the bound is generous because the entries are tiny and the cost
   * of forgetting one is real: a fire id dropped from this set while its window
   * is still open would let the next drain re-open the allowance. Twenty times
   * `BROKER_REPLAY_MEMORY` would still be nothing; two hundred is far more fires
   * than can exist inside one ten-minute window on a machine with a sane number
   * of agents, and dropping the oldest first means the entry that goes is the one
   * whose window closed longest ago.
   */
  const openedFires: string[] = [];
  const openedFireSet = new Set<string>();
  const MAX_REMEMBERED_FIRES = 200;

  /**
   * Believe the runner exactly as far as DASH's own store already agrees
   * (MAR-784, ADR 0029 amendment 1).
   *
   * Three things have to be true before a call is opened, and each one is a
   * separate sentence rather than a combined condition because they fail for
   * different reasons and a reader should be able to tell which:
   *
   * 1. **DASH has not already opened this fire.** See `openedFires`.
   * 2. **DASH's own `agent_schedules` row says this agent has a standing
   *    schedule.** A runner still holding an instruction the person deleted a
   *    minute ago — which ADR 0029 decision 2's five-second re-assertion makes
   *    a real, if brief, state — opens nothing.
   * 3. **The ceiling granted is the smaller of the two numbers.** So the field on
   *    the wire can only ever *narrow* what the person set on their own page,
   *    never widen it, and a compromised runner's best move is to ask for less.
   *
   * The clock is DASH's own. `opened_at` is read only to check the window has
   * not already passed — a stale report from a runner whose fire is long over
   * opens nothing — and never used as the allowance's start, because
   * `openRunSpend` times from the moment DASH opens it and a timestamp a caller
   * supplies is a timestamp a caller could choose.
   */
  function openScheduledAllowances(candidate: unknown): void {
    const allowances = parseScheduledAllowances(candidate);
    if (allowances.length === 0) {
      return;
    }
    const at = new Date();
    for (const allowance of allowances) {
      if (openedFireSet.has(allowance.fire_id)) {
        continue;
      }
      if (at.getTime() - new Date(allowance.opened_at).getTime() >= SPEND_ALLOWANCE_MS) {
        continue;
      }
      const standing = readAgentSchedule(allowance.agent_id);
      if (standing === null || !standing.enabled || standing.allowance_calls <= 0) {
        continue;
      }
      const granted = Math.min(allowance.calls, standing.allowance_calls);
      if (granted <= 0) {
        continue;
      }

      openedFireSet.add(allowance.fire_id);
      openedFires.push(allowance.fire_id);
      while (openedFires.length > MAX_REMEMBERED_FIRES) {
        const oldest = openedFires.shift();
        if (oldest !== undefined) {
          openedFireSet.delete(oldest);
        }
      }

      broker.allowRunSpend(allowance.agent_id, at, granted);
      log(
        `[dash-shell] ${allowance.agent_id}'s scheduled run may spend ${String(granted)} model ` +
          `call${granted === 1 ? "" : "s"}, which is the ceiling on its schedule`,
      );
    }
  }

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
        scheduled_allowances?: unknown;
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
      /*
       * MAR-784. Before the requests are looked at and before the early return
       * below, which is the ordering the whole feature rests on: every request in
       * this body was written by a child of the process that reported these
       * ceilings, so opening them first means no scheduled request can be
       * adjudicated before the allowance that covers it exists. A pass that
       * carries an allowance and no requests still opens it — the agent's first
       * ask may land in the next pass, and an allowance that waited for a request
       * to justify it would be one poll too late.
       */
      openScheduledAllowances(body.scheduled_allowances);
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
        // `"agent"` and never anything else, on every line this loop reads
        // (MAR-545). This is the whole enforcement of the standing described on
        // `BrokerOrigin`: a request that came off a child process's stdout is an
        // agent's request, whatever it contains, because the value is decided by
        // which function read it rather than by anything in it.
        response = await broker.handle(agentPrincipal(candidate.agent_id), parsed, "agent");
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
