/**
 * The broker on the host: a second security boundary, narrower than the first
 * (MAR-629, ADR 0021).
 *
 * ## What this is, in one paragraph
 *
 * A deployed agent emits `broker_request` lines exactly as a local one does.
 * Locally, `runner/supervisor.ts` buffers them and DASH drains them over
 * `/broker/drain`. Remotely there is nobody to drain them — that route is absent
 * from `RemoteRunnerChannel` by type, and ADR 0006 keeps it absent — so until
 * this file existed a key placed on a server sat beside a runner that could not
 * spend it. That is the wall Henrik hit on 2026-08-16, and DASH's refusal was
 * correct. This is its exit.
 *
 * So: the same protocol, adjudicated on the machine that holds the key, by a
 * broker with its own closed set and its own refusals.
 *
 * ## The three sentences that do not bend
 *
 * **The agent never holds the key.** That is why ADR 0021 chose a runner-local
 * broker over handing the agent an environment variable, and it is the whole
 * value of this file. A compromised agent on that host still cannot read
 * `wrap.key` or a sealed slot; it can only ask, and be refused or answered.
 *
 * **The runner still never reaches DASH's broker.** Nothing here opens a socket,
 * dials home, or knows DASH's address. `electron/broker-host.ts` is a different
 * program on a different machine and this file does not import it, call it, or
 * have a route to it. Closing DASH does not close this broker; ADR 0021 section
 * 5 is literal about that being the cost as well as the point.
 *
 * **A person is behind every penny.** ADR 0016's rule travels with the numbers.
 * A Run pressed on *this host* opens the allowance here, `runner/server.ts`
 * opens it and nothing else may, and starting the runner is not a Run.
 *
 * ## Why it is not `createBroker` with a different `deps`
 *
 * The temptation is real — the step order below is deliberately the same one —
 * and it is refused for the reason ADR 0021 refuses to copy
 * `lib/broker/operations.ts` by inertia. `createBroker` admits Gmail, admits
 * whatever the catalogue grows next, resolves grants against a DASH vault,
 * carries OAuth minting and a write budget, and reaches `hasHandledRequest` in a
 * SQLite table this machine does not have. A `deps` shaped to disable all of
 * that would be a security boundary defined by which of its arguments somebody
 * remembered to pass null to.
 *
 * What *is* shared is everything that decides a provider request:
 * `operationById`, `planCall`, the frozen paths, the origins,
 * `MAX_MATERIAL_CHARS`, `MAX_OUTPUT_TOKENS`, `aiAuthHeaders`, the refusal
 * vocabulary and the allowance numbers. Those are imported rather than restated,
 * so widening a path is a reviewed change to the same catalogue and never a host
 * exception.
 *
 * ## The vocabulary is identical; the limits are not
 *
 * ADR 0021 rule 2: *"the agent does not learn which machine it is on from the
 * shape of a refusal. The limits may differ; the vocabulary must not."* So every
 * refusal below is a `BrokerRefusal` from `lib/broker/protocol.ts` and this file
 * invents none. `gmail.search` is `unknown_operation` here, which is what an
 * agent gets locally for `gmail.send` — a name the broker does not answer to.
 */

import {
  BROKER_CALLS_PER_WINDOW,
  BROKER_REPLAY_MEMORY,
  BROKER_SPEND_PER_WINDOW,
  BROKER_WINDOW_MS,
} from "../lib/broker/execute";
import { isHostBrokerOperation } from "../lib/broker/host-operations";
import {
  hasFrozenPath,
  isSpendOperation,
  operationById,
  planCall,
} from "../lib/broker/operations";
import {
  fulfil,
  parseBrokerRequest,
  refuse,
  type BrokerRefusal,
  type BrokerRequest,
  type BrokerResponse,
} from "../lib/broker/protocol";
import {
  openRunSpend,
  spendAllowed,
  spendOne,
  type RunSpendAllowance,
} from "../lib/broker/spend-allowance";
import { brokeredField } from "../lib/broker/grant";
import { AI_AUTH_HEADERS, aiAuthHeaders, aiProviderFor } from "../lib/ai/providers";
import { validateManifest } from "../lib/contracts";
import type { ConnectionSourceManifest } from "../lib/connections";
import { proveHostPack, readHostKey, type HostKeyRead } from "./host-pack";

import { readFileSync } from "node:fs";
import path from "node:path";

/* ---------------------------------------------------------------------- *
 * What one host decision is written down as
 * ---------------------------------------------------------------------- */

/**
 * One host-broker audit row (ADR 0021 section 2).
 *
 * ADR 0002 invariant 5, moved one machine over: audited by operation name and
 * safe metadata, never token or message content. The fields are deliberately the
 * same as `BrokerAuditRow`'s so a row pulled off a host and a row DASH wrote
 * locally can sit in one table, plus the one field that must never be inferred.
 *
 * `decided_on` is that field. A pulled row is **evidence DASH observed a host
 * decision**, not DASH making one, and ADR 0021 requires every surface rendering
 * these to say where they came from — the way ADR 0014 made a run name the
 * machine it happened on. Carrying it on the row rather than adding it at
 * ingest means a row cannot lose its provenance by being copied.
 *
 * `account_hint` is always null here and the field is kept anyway. A pasted key
 * identifies nobody — the same null MAR-582 writes locally for a keyed grant —
 * and a row shaped differently from the local one would be a row that needs its
 * own renderer.
 *
 * What it never records: the key, a stable digest of the key, the wrapping key,
 * authorization headers, request bodies, provider payloads, model prose, or
 * anything that would make the spool a second copy of the secret store.
 */
export interface HostBrokerAuditRow {
  agent: string;
  connection_id: string;
  operation: string;
  request_id: string;
  decision: "allowed" | "refused";
  refusal: BrokerRefusal | null;
  /** The *names* of the fields the agent supplied. Never their values. */
  input_keys: string[];
  result_count: number | null;
  /** Always null: a pasted key identifies nobody. */
  account_hint: null;
  duration_ms: number;
  decided_at: string;
  /** Always `"host"`. See above — this is the field that cannot be inferred. */
  decided_on: "host";
}

/* ---------------------------------------------------------------------- *
 * What it needs from the machine around it
 * ---------------------------------------------------------------------- */

export interface HostBrokerDeps {
  /**
   * The agent's own manifest, as the bundle carries it.
   *
   * The author's document, read from `agent/` inside the installed bundle. It
   * decides which connection ids exist and which are DASH-managed, exactly as it
   * does locally — an agent naming a connection its own manifest does not
   * declare is `unknown_connection` on both machines, which is half of what
   * "the agent cannot tell which machine it is on" means.
   */
  readManifest(agentId: string): ConnectionSourceManifest | null;
  /**
   * One placed key, for this installed bundle only.
   *
   * The bundle scope lives in the closure `runner/main.ts` builds rather than in
   * a parameter here, and that is the isolation ADR 0021 asks for: *"The broker
   * that answers a runner reads only the slots `install-key` proved for that
   * installed bundle. Same-account `0600` is not isolation; this rule is."* A
   * `bundle_id` argument on this method would be a bundle id something could
   * pass a different value for.
   */
  readKey(connectionId: string): HostKeyRead;
  /**
   * Which model this agent's owner chose, or null (ADR 0011).
   *
   * Read from the bundle's own `data/models/{agent_id}.json`, which is DASH's
   * generated document rather than the author's folder — a setting a person
   * chose, sent with the bundle. Null is refused rather than defaulted: DASH
   * translating a level into a model name on the host would be a second copy of
   * the mapping ADR 0011 refuses to keep, on the machine where nobody is
   * watching it get billed.
   */
  readModelChoice(agentId: string): string | null;
  fetchImpl: typeof fetch;
  /** Record one attempt. Called exactly once per adjudicated request. */
  audit(row: HostBrokerAuditRow): void;
  now(): Date;
}

export interface HostBroker {
  /**
   * Adjudicate one line an agent wrote.
   *
   * Null for a candidate too malformed to answer — no request id means nowhere
   * to send a refusal, and inventing one would be answering a message nobody
   * sent. That is `parseBrokerRequest`'s own rule and the supervisor already
   * drops such lines.
   */
  adjudicate(agentId: string, candidate: unknown): Promise<BrokerResponse | null>;
  /**
   * A person pressed Run on this host. Open the allowance here.
   *
   * The only way an allowance comes into existence on this machine, and
   * `runner/server.ts` is its only caller — on the `retry` command and no other,
   * mirroring `electron/main.ts` line for line. Starting the runner is not a Run
   * and calls nothing. A schedule is not a Run; scheduled spending stays refused
   * and stays ADR 0014's deferred decision.
   *
   * Closing DASH neither opens one nor closes one already open. That is the
   * cost ADR 0021 accepts openly: it is the same fact as "closing DASH does not
   * close the host broker", seen from the side where it costs money.
   */
  allowRunSpend(agentId: string, at: Date): void;
}

/** Per-agent counters. One broker, one set, so a second cannot be a second budget. */
interface HostBudget {
  calls: number[];
  spends: number[];
  seen: string[];
  runSpend: RunSpendAllowance | undefined;
}

function freshBudget(): HostBudget {
  return { calls: [], spends: [], seen: [], runSpend: undefined };
}

/**
 * How much of a provider's answer this broker will read.
 *
 * Per operation, from the catalogue, exactly as `lib/broker/execute.ts` reads
 * it. Restated as a local helper only because `readBounded` there is private;
 * the bound itself is the operation's.
 */
async function readBounded(response: Response, max: number): Promise<string | null> {
  const body = response.body;
  if (body === null) {
    return null;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let read = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      read += chunk.value.byteLength;
      if (read > max) {
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}

export function createHostBroker(deps: HostBrokerDeps): HostBroker {
  const budgets = new Map<string, HostBudget>();

  const budgetFor = (agentId: string): HostBudget => {
    const existing = budgets.get(agentId);
    if (existing !== undefined) {
      return existing;
    }
    const created = freshBudget();
    budgets.set(agentId, created);
    return created;
  };

  return {
    allowRunSpend(agentId: string, at: Date): void {
      // Replaces rather than tops up, which is what makes a second press
      // harmless: the ceiling on what one agent may spend is always one press's
      // worth, however many times somebody presses.
      budgetFor(agentId).runSpend = openRunSpend(at.getTime());
    },

    async adjudicate(agentId: string, candidate: unknown): Promise<BrokerResponse | null> {
      const request: BrokerRequest | null = parseBrokerRequest(candidate);
      if (request === null) {
        return null;
      }

      const began = deps.now();
      const startedAt = began.getTime();
      const budget = budgetFor(agentId);
      let plannedInput: Record<string, unknown> = request.input;

      /**
       * Every exit goes through here, so the audit row is written exactly once
       * on every path — the property `lib/broker/execute.ts` holds and the one
       * that makes an audit table a record of decisions rather than of
       * successes.
       */
      const decide = (
        refusal: BrokerRefusal | null,
        result: Record<string, unknown> | null = null,
      ): BrokerResponse => {
        const decided = deps.now();
        deps.audit({
          agent: agentId,
          connection_id: request.connection_id,
          operation: request.operation,
          request_id: request.request_id,
          decision: refusal === null ? "allowed" : "refused",
          refusal,
          // Names, never values. `Object.keys` on the null-prototype copy
          // `parseBrokerRequest` made, so a hostile `__proto__` in the input
          // cannot smuggle a value into the audit either.
          input_keys: Object.keys(request.input).sort(),
          result_count: result === null ? null : countResults(result),
          account_hint: null,
          duration_ms: Math.max(0, decided.getTime() - startedAt),
          decided_at: decided.toISOString(),
          decided_on: "host",
        });
        return refusal === null
          ? fulfil(request.request_id, result ?? {})
          : refuse(request.request_id, refusal);
      };

      /* 1. Replay, before anything is looked up, so a repeated line is a refusal
         rather than a second execution. In memory and bounded: this process is
         the only thing on the host that adjudicates, and a runner restart is a
         new broker with a new memory — which is weaker than DASH's durable
         table and is stated rather than papered over. `install-key`'s ceremony
         is per key and per host, so the durable question DASH's table answers
         for a *write* has no equivalent here in v1: nothing this broker admits
         creates anything in somebody's account. */
      if (budget.seen.includes(request.request_id)) {
        return decide("duplicate_request");
      }
      budget.seen.push(request.request_id);
      if (budget.seen.length > BROKER_REPLAY_MEMORY) {
        budget.seen.shift();
      }

      /* 2. Rate, before the operation is resolved, so a flood costs a counter. */
      const windowStart = startedAt - BROKER_WINDOW_MS;
      budget.calls = budget.calls.filter((at) => at > windowStart);
      if (budget.calls.length >= BROKER_CALLS_PER_WINDOW) {
        return decide("rate_limited");
      }
      budget.calls.push(startedAt);

      /* 3. The closed set — the whole of ADR 0021's narrowing, in one call.

         `gmail.search`, `gmail.message.read`, `gmail.draft.create`, every Gmail
         name never built, every `mcp.*` name, every streaming or embedding
         dialect and every operation a future catalogue slice adds all stop
         here, as `unknown_operation`. That is the same refusal an agent gets
         locally for a name DASH does not answer to, which is the point: the
         agent learns that this broker does not do that, not which machine it is
         standing on.

         Before the store is touched, so an operation this host will never
         perform cannot cause a read of the secrets tree by being asked for. */
      if (!isHostBrokerOperation(request.operation)) {
        return decide("unknown_operation");
      }

      /* 3b. And the catalogue, which is the gate that matters. The host cannot
         execute an operation DASH did not write, even if the list above named
         one — same frozen paths, same ceilings, same projections. */
      const operation = operationById(request.operation);
      if (operation === null) {
        return decide("unknown_operation");
      }

      /* 4. A spend needs a person, and then a model the owner chose.

         The origin gate has no analogue here and that absence is the argued
         part. Locally, `origin` distinguishes a request DASH's own UI made from
         one read off a child's stdout. On a host **every** request is an agent's
         — there is no UI on that machine — so the allowance is not a second
         check in front of the origin gate, it is the whole gate. ADR 0021
         section 2 makes that transfer explicitly and says why the alternatives
         fail: freezing host spend when DASH closes undoes the reason option A
         exists, and letting the host spend without a press undoes ADR 0016. */
      if (isSpendOperation(operation)) {
        if (!spendAllowed(budget.runSpend, startedAt)) {
          return decide("needs_a_person");
        }
        // Consumed on the attempt rather than on a successful answer, for
        // `budget.calls`' reason: a refused call still reached a provider's
        // door, and an allowance counting only successes leaves a way to probe
        // the boundary for free.
        budget.runSpend = spendOne(budget.runSpend as RunSpendAllowance);

        budget.spends = budget.spends.filter((at) => at > windowStart);
        if (budget.spends.length >= BROKER_SPEND_PER_WINDOW) {
          return decide("rate_limited");
        }
        budget.spends.push(startedAt);

        /* The model is the owner's, never the agent's (ADR 0011 decision 1).
           Overwritten rather than validated, before `planCall` narrows anything,
           so there is no branch in which what an agent asked for survives into
           the body that leaves this machine. */
        const chosen = deps.readModelChoice(agentId);
        if (chosen === null) {
          return decide("no_model_chosen");
        }
        /* `frame` is `agent_material` and cannot be anything else here. The
           chief is a principal in DASH and has no presence on a host — there is
           no fleet on this machine — so the branch `lib/broker/execute.ts`
           writes is a constant here rather than a choice. Written anyway,
           because the operation reads it and a missing frame would be a caller
           supplying one. */
        plannedInput = { ...request.input, model: chosen, frame: "agent_material" };
      }

      /* 5. Is the connection one this agent's own manifest declares? */
      const manifest = deps.readManifest(agentId);
      if (manifest === null) {
        return decide("unknown_connection");
      }
      const field = brokeredField(manifest, request.connection_id);
      if (!field.ok) {
        return decide(
          field.refusal === "unknown_connection" ? "unknown_connection" : "not_granted",
        );
      }

      /* 5b. And does the operation belong to that connection's provider?

         Locally this is implied by the grant resolution. Here it is written out,
         because the host admits exactly one provider family and an agent naming
         `openai.chat.completion` against a connection whose provider is
         `anthropic` would otherwise reach the Anthropic origin with an OpenAI
         body — the sort of confusion that is a bug locally and a key sent to the
         wrong company here. */
      if (operation.connection_provider !== field.field.connection.provider) {
        return decide("not_granted");
      }

      const provider = aiProviderFor(field.field.connection.provider);
      if (provider === null) {
        /* The connection is DASH-managed and is not a model provider — a Gmail
           connection, or one this pack has no profile for. `not_granted` rather
           than `unknown_operation`, because the operation is real and this
           connection is not what it is for. */
        return decide("not_granted");
      }

      /* 6. The key. The first time the secrets tree is touched, and only for a
         request that has already survived every check above it. */
      const held = deps.readKey(request.connection_id);
      if (held.kind === "absent") {
        return decide("not_connected");
      }
      if (held.kind === "unusable") {
        /* Something is at that slot and this pack cannot open it: a re-minted
           wrapping key, a truncated write, a file placed by hand. `revoked` is
           the honest code because it is the one whose next move is right — stop,
           and let a person place a working key. */
        return decide("revoked");
      }
      const key = held.key;

      /* 7. Input narrows to a request, by the operation's own validation. */
      const planned = planCall(operation, field.field.profile.api_origin, plannedInput);
      if (!planned.ok) {
        return decide("invalid_input");
      }

      /* 8. The origin and the frozen path, re-checked. DASH's own code, checked
         anyway — both are cheap and the thing behind them is somebody's money on
         a machine nobody is watching. A mismatch is this pack's bug, so it is
         `broker_error` rather than a refusal that would read as the agent's
         fault. */
      if (new URL(planned.call.url).origin !== field.field.profile.api_origin) {
        return decide("broker_error");
      }
      if (hasFrozenPath(operation) && new URL(planned.call.url).pathname !== operation.path) {
        return decide("broker_error");
      }

      /* 9. Attach the key, call, project. */
      const authorization = aiAuthHeaders(provider, key);
      for (const header of Object.keys(authorization)) {
        if (!AI_AUTH_HEADERS.includes(header.toLowerCase())) {
          return decide("broker_error");
        }
      }

      let body: unknown;
      try {
        const response = await deps.fetchImpl(planned.call.url, {
          method: planned.call.method,
          headers: {
            // Spread first, so a credential header can never overwrite the
            // accept or content type this pack chose. The merge order is the
            // guard and the name check above is the other half of it.
            ...authorization,
            accept: "application/json",
            ...(planned.call.method === "POST" ? { "content-type": "application/json" } : {}),
          },
          ...(planned.call.method === "POST" ? { body: JSON.stringify(planned.call.json) } : {}),
          signal: AbortSignal.timeout(20_000),
        });

        if (!response.ok) {
          return decide(
            response.status === 401 || response.status === 403 ? "revoked" : "provider_refused",
          );
        }

        const text = await readBounded(response, operation.max_response_bytes);
        if (text === null) {
          return decide("provider_refused");
        }
        body = JSON.parse(text);
      } catch {
        /* The caught value is dropped rather than inspected, for the reason
           `lib/broker/execute.ts` drops its own: a fetch rejection can carry the
           request, and this request has a key in its headers. */
        return decide("provider_unavailable");
      }

      let projected: Record<string, unknown>;
      try {
        projected = operation.project(body);
      } catch {
        return decide("broker_error");
      }

      return decide(null, projected);
    },
  };
}

/* ---------------------------------------------------------------------- *
 * Wiring it to a host, or deciding there is not one
 * ---------------------------------------------------------------------- */

export interface HostBrokerEnvironment {
  /** `DASH_HOST_ROOT`, as the helper wrote it into this process's environment. */
  hostRoot: string | undefined;
  /** `DASH_HOST_BUNDLE_ID`. The only bundle whose keys this runner may read. */
  bundleId: string | undefined;
  /** This runner's data directory, which is where the bundle's model choice is. */
  dataDir: string;
  /** The registrations this runner supervises, for their manifest paths. */
  registrations: readonly { agent_id: string; manifest_path: string }[];
  log: (line: string) => void;
}

/**
 * Build a host broker, or answer null because this is not a host.
 *
 * **Null is the ordinary case.** DASH's own runner is started by
 * `electron/runner-process.ts`, which sets neither variable, so the local path
 * gets no host broker and nothing about it changes. A host runner is started by
 * `scripts/host-helper/main.ts`, which sets both — and sets them itself rather
 * than accepting them from a request, which is the distinction ADR 0018 draws
 * when it refuses caller-supplied environment.
 *
 * Null is also the answer when the pack cannot be proved. That is the honest
 * outcome rather than a degraded broker: a runner whose secrets tree is missing
 * or not owner-only has nowhere to read a key from, and a broker built anyway
 * would refuse every request as `not_connected` — which would send somebody to
 * place a key that is already there. Refusing to exist leaves the request
 * buffered, exactly as it was before this pack, and `pack` is what tells DASH
 * the real reason.
 */
export function hostBrokerFor(
  environment: HostBrokerEnvironment,
  deps: Pick<HostBrokerDeps, "fetchImpl" | "now"> & { audit?: HostBrokerDeps["audit"] },
): HostBroker | null {
  const { hostRoot, bundleId } = environment;
  if (hostRoot === undefined || hostRoot.length === 0 || bundleId === undefined || bundleId.length === 0) {
    return null;
  }
  const proved = proveHostPack(hostRoot);
  if (!proved.ok) {
    environment.log(`[runner] this server has no usable host pack (${proved.detail})`);
    return null;
  }
  environment.log(`[runner] host broker ready, pack version ${String(proved.pack_version)}`);

  const manifestPathFor = (agentId: string): string | null =>
    environment.registrations.find((entry) => entry.agent_id === agentId)?.manifest_path ?? null;

  return createHostBroker({
    fetchImpl: deps.fetchImpl,
    now: deps.now,
    readManifest: (agentId) => {
      const file = manifestPathFor(agentId);
      if (file === null) {
        return null;
      }
      try {
        const checked = validateManifest(JSON.parse(readFileSync(file, "utf8")) as unknown);
        return checked.ok ? (checked.value as ConnectionSourceManifest) : null;
      } catch {
        return null;
      }
    },
    /*
     * The bundle id is captured here and appears in no argument anywhere below.
     * That is the isolation ADR 0021 asks for, and writing it as a closure
     * rather than as a parameter is what makes "this runner can name no other
     * bundle" a property of the wiring instead of a rule every caller keeps.
     */
    readKey: (connectionId) => readHostKey(hostRoot, bundleId, connectionId),
    readModelChoice: (agentId) => {
      /*
       * The owner's choice, as the bundle carries it (MAR-583, ADR 0011).
       *
       * `data/models/{agent_id}.json` is DASH's generated document — a setting a
       * person chose, sent with the bundle — and it is read rather than derived.
       * `one_model` is the only shape that names a model; `match_each_step`
       * records that the owner named none, which is `no_model_chosen` and not
       * something this pack may resolve on their behalf.
       */
      try {
        const document = JSON.parse(
          readFileSync(path.join(environment.dataDir, "models", `${agentId}.json`), "utf8"),
        ) as { choice?: unknown; model_id?: unknown };
        return document.choice === "one_model" && typeof document.model_id === "string"
          ? document.model_id
          : null;
      } catch {
        return null;
      }
    },
    /*
     * The spool (ADR 0021 section 1c).
     *
     * The row goes into the runner's own log, which is the evidence surface
     * this host already has and which DASH already pulls with `collect`. That
     * is deliberately not a new route: ADR 0021 section 5 forbids a new
     * listener, and `/broker/drain` staying off the remote channel is the whole
     * boundary this pack is built inside.
     *
     * Written as one prefixed JSON line so it is greppable by a person on the
     * server and parseable by the later slice that gives these rows a table of
     * their own. What DASH does **not** yet do is render them as audit rows
     * beside its local ones — that is MAR-631's inheritance, and until it lands
     * no surface may claim DASH audits host-broker calls. What is true today is
     * that the host writes down every decision it made and DASH can read them.
     */
    audit:
      deps.audit ??
      ((row) => {
        environment.log(`[runner] host-broker-audit ${JSON.stringify(row)}`);
      }),
  });
}

/**
 * How many things one answer held.
 *
 * The same shape `lib/broker/execute.ts` uses — first array wins, otherwise one
 * — restated rather than exported from there because it is four lines and
 * because the two audit tables are meant to hold comparable numbers. If that
 * function ever changes, this one is the thing a reviewer has to notice, which
 * is why it is named identically rather than being inlined.
 */
function countResults(result: Record<string, unknown>): number {
  for (const value of Object.values(result)) {
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return 1;
}
