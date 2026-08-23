/**
 * The narrowest broker in DASH (MAR-743, ADR 0028 decisions 5 and 8).
 *
 * `runner/host-broker.ts` is the shape and ADR 0021 is the precedent: the same
 * protocol, adjudicated in the process that holds the key, with its own closed
 * set and its own refusals. This one is narrower than that one in every
 * direction, and the narrowing is the argument for it existing at all.
 *
 * | | DASH's broker | the host broker | this |
 * | --- | --- | --- | --- |
 * | principals | every agent, and the chief | every deployed agent | **the chief, and there is no other value** |
 * | connections | whatever a manifest declares | whatever a manifest declares | **one, `chief:model-provider`** |
 * | operations | the whole catalogue | nine | **one, `{provider}.chat.completion`** |
 * | opens an allowance | a Run press | a Run press on that host | **nothing can** |
 *
 * The last row is the one to read twice. `runner/host-broker.ts` has
 * `allowRunSpend`, because an agent on a host spends against a person's press.
 * There is no such method here and no allowance to open: the chief has no run
 * allowance anywhere in DASH (ADR 0023), and ADR 0028 decision 8 keeps that true
 * in the room where nobody is watching. A Discord message authorises **one chief
 * completion**, adjudicated here, and cannot cause any agent to spend anything.
 *
 * ## Why not `createBroker` with a different `deps`
 *
 * ADR 0021's answer, and it applies with more force at this size.
 * `lib/broker/execute.ts` resolves grants against DASH's vault, mints OAuth,
 * carries a write budget, and reaches `hasHandledRequest` in a SQLite table this
 * process must not open (ADR 0028 decision 6). A `deps` shaped to disable all of
 * that would be a security boundary defined by which argument somebody
 * remembered to pass null to.
 *
 * What *is* shared is everything that decides a provider request: `operationById`,
 * `planCall`, the frozen paths, the origins, `MAX_OUTPUT_TOKENS`, `aiAuthHeaders`,
 * the refusal vocabulary and the window constants. Those are imported rather than
 * restated, so widening a path stays a reviewed change to one catalogue.
 *
 * ## The vocabulary is identical; the limits are not
 *
 * ADR 0021 rule 2, inherited: every refusal below is a `BrokerRefusal` from
 * `lib/broker/protocol.ts` and this file invents none. A question asked here and
 * the same question asked at the window come back with the same word for the
 * same problem.
 */

import {
  BROKER_CALLS_PER_WINDOW,
  BROKER_REPLAY_MEMORY,
  BROKER_SPEND_PER_WINDOW,
  BROKER_WINDOW_MS,
} from "../lib/broker/execute";
import { hasFrozenPath, isSpendOperation, operationById, planCall } from "../lib/broker/operations";
import {
  fulfil,
  parseBrokerRequest,
  refuse,
  type BrokerRefusal,
  type BrokerRequest,
  type BrokerResponse,
} from "../lib/broker/protocol";
import { AI_AUTH_HEADERS, aiAuthHeaders, aiProviderById } from "../lib/ai/providers";
import { CHIEF_CONNECTION_ID, chiefOperationId } from "../lib/chief/manifest";

/**
 * One decision this broker took, on its way to `broker_audit` in DASH's store.
 *
 * `HostBrokerAuditRow`'s fields, minus the ones that cannot apply. There is no
 * `agent`, because the chief has no id — that absence is ADR 0023 decision 1 and
 * putting a name here would be inventing the very string the type system exists
 * to make impossible. There is no `account_hint`, because a fleet key identifies
 * nobody. `decided_on` is not on the row either: everything this file writes was
 * decided here, so the drain stamps `"runner"` on all of it and there is no
 * branch in which a row could claim otherwise.
 *
 * What it never records: the key, a digest of it, authorization headers, request
 * bodies, provider payloads, model prose, or the person's question. Only the
 * *names* of the input fields.
 */
export interface ChiefAuditRow {
  connection_id: string;
  operation: string;
  request_id: string;
  decision: "allowed" | "refused";
  refusal: BrokerRefusal | null;
  input_keys: string[];
  result_count: number | null;
  duration_ms: number;
  decided_at: string;
}

export interface ChiefBrokerDeps {
  /**
   * The provider and key to spend, or null when main has not handed one over.
   *
   * Null is the ordinary state after a restart, and it is a refusal rather than
   * a gap: `not_connected` is what a question gets, `lib/chief/answer.ts` never
   * reaches this file without a model, and the runner's reply says so in plain
   * words. ADR 0028 decision 9.
   *
   * A function rather than a field because main can push a new key at any
   * moment and a captured value would be a broker spending a key that has been
   * replaced.
   */
  credential(): { provider_id: string; api_key: string } | null;
  fetchImpl: typeof fetch;
  /** Record one decision. Called exactly once per adjudicated request. */
  audit(row: ChiefAuditRow): void;
  now(): Date;
}

export interface ChiefBroker {
  handle(request: BrokerRequest): Promise<BrokerResponse>;
}

export function createChiefBroker(deps: ChiefBrokerDeps): ChiefBroker {
  /*
   * One budget, for one principal. `runner/host-broker.ts` keys its budgets by
   * agent because it has several; there is exactly one chief, so a map here
   * would be a map with one key and a suggestion that a second principal could
   * appear.
   */
  let calls: number[] = [];
  let spends: number[] = [];
  const seen: string[] = [];

  return {
    async handle(candidate: BrokerRequest): Promise<BrokerResponse> {
      const request = parseBrokerRequest(candidate);
      if (request === null) {
        // Unreachable from `lib/chief/answer.ts`, which builds the request. Kept
        // because this method's argument is typed and its *value* comes through
        // a JSON boundary in the caller above it.
        return refuse("chief-malformed", "invalid_input");
      }

      const began = deps.now();
      const startedAt = began.getTime();

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
          connection_id: request.connection_id,
          operation: request.operation,
          request_id: request.request_id,
          decision: refusal === null ? "allowed" : "refused",
          refusal,
          // Names, never values, off the null-prototype copy `parseBrokerRequest`
          // made — so a hostile `__proto__` in the input cannot smuggle a value
          // into the audit either.
          input_keys: Object.keys(request.input).sort(),
          result_count: result === null ? null : 1,
          duration_ms: Math.max(0, decided.getTime() - startedAt),
          decided_at: decided.toISOString(),
        });
        return refusal === null
          ? fulfil(request.request_id, result ?? {})
          : refuse(request.request_id, refusal);
      };

      /* 1. Replay, before anything is looked up. In memory and bounded: this
         process is the only thing that adjudicates for the chief while DASH is
         closed, and a restart is a new broker with a new memory. Weaker than
         DASH's durable table, stated rather than papered over — and the thing
         it is weaker about cannot create anything in anybody's account. */
      if (seen.includes(request.request_id)) {
        return decide("duplicate_request");
      }

      /* 2. Rate, before the operation is resolved, so a flood costs a counter.
         Counted on the attempt rather than on success: a refused call still
         cost work, and not counting refusals leaves a way to probe the boundary
         as fast as the pipe allows. */
      const windowStart = startedAt - BROKER_WINDOW_MS;
      calls = calls.filter((at) => at > windowStart);
      if (calls.length >= BROKER_CALLS_PER_WINDOW) {
        return decide("rate_limited");
      }
      calls.push(startedAt);

      /* The id is remembered **after** the rate check, `runner/host-broker.ts`'
         order and its reason: a rate-limited request is one the caller retries
         with the same id, and burning it here would refuse that retry forever. */
      seen.push(request.request_id);
      if (seen.length > BROKER_REPLAY_MEMORY) {
        seen.shift();
      }

      /* 3. The connection, which is a constant. Not "the one this manifest
         declares" — there is one connection id in the chief's whole world and
         it is `lib/chief/manifest.ts`'s. A request naming anything else is a
         request for a connection this broker does not have. */
      if (request.connection_id !== CHIEF_CONNECTION_ID) {
        return decide("unknown_connection");
      }

      /* 4. The key, and with it which provider this broker is for.

         Read before the operation is resolved, because *which* provider decides
         which operation id is admissible below — and a broker with no key can
         answer nothing, so there is no ordering in which this read is wasted. */
      const held = deps.credential();
      if (held === null) {
        return decide("not_connected");
      }
      const profile = aiProviderById(held.provider_id);
      if (profile === null) {
        // Main pushed a provider this build does not know: a downgrade, or a
        // runner left over from a newer DASH. `not_connected` rather than
        // `broker_error`, because the honest next move is the same one — the
        // person opens DASH and it hands over a key this build understands.
        return decide("not_connected");
      }

      /* 5. The closed set, and it has one member.

         `{provider}.chat.completion` for the provider whose key is actually
         held, and nothing else. `.models.list` is refused, `.digest.curate` is
         refused, every Gmail name is refused, every `mcp.*` name is refused, and
         so is the same completion operation for a *different* provider — which
         is the check that stops an `openai.chat.completion` body being sent to
         Anthropic's origin with Anthropic's key on it. */
      if (request.operation !== chiefOperationId(profile.id)) {
        return decide("unknown_operation");
      }

      /* 5b. And the catalogue, which is the gate that matters. This broker
         cannot execute an operation DASH did not write, even if the check above
         named one — same frozen paths, same ceilings, same projections. */
      const operation = operationById(request.operation);
      if (operation === null) {
        return decide("unknown_operation");
      }

      let plannedInput: Record<string, unknown> = request.input;
      if (isSpendOperation(operation)) {
        spends = spends.filter((at) => at > windowStart);
        if (spends.length >= BROKER_SPEND_PER_WINDOW) {
          return decide("rate_limited");
        }
        spends.push(startedAt);

        /* The frame is written here and cannot be supplied.
           `lib/broker/execute.ts` decides it from the principal; this broker has
           exactly one principal, so the value is a constant rather than a
           branch — and `fleet_briefing` is the same frozen system prompt the
           window's chief is asked under. A caller able to send a frame would be
           a caller able to ask the agent-material prompt about fleet material,
           or the reverse. */
        plannedInput = { ...request.input, frame: "fleet_briefing" };
      }

      /* 6. Input narrows to a request, by the operation's own validation. */
      const planned = planCall(operation, profile.api_origin, plannedInput);
      if (!planned.ok) {
        return decide("invalid_input");
      }

      /* 7. The origin and the frozen path, re-checked. DASH's own code, checked
         anyway — both are cheap and the thing behind them is somebody's money in
         a process nobody is watching. A mismatch is this file's bug, so it is
         `broker_error` rather than a refusal that would read as the person's
         fault. */
      if (new URL(planned.call.url).origin !== profile.api_origin) {
        return decide("broker_error");
      }
      if (hasFrozenPath(operation) && new URL(planned.call.url).pathname !== operation.path) {
        return decide("broker_error");
      }

      /* 8. Attach the key, call, project. */
      const authorization = aiAuthHeaders(profile, held.api_key);
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
            // accept or content type this file chose. The merge order is the
            // guard and the name check above is its other half.
            ...authorization,
            accept: "application/json",
            ...(planned.call.method === "POST" ? { "content-type": "application/json" } : {}),
          },
          ...(planned.call.method === "POST" ? { body: JSON.stringify(planned.call.json) } : {}),
          signal: AbortSignal.timeout(30_000),
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
        /* Dropped rather than inspected: a fetch rejection can carry the
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

/**
 * How much of a provider's answer this broker will read.
 *
 * `runner/host-broker.ts`' local copy, restated for its reason: the bound is the
 * operation's, and `readBounded` in `lib/broker/execute.ts` is private.
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
