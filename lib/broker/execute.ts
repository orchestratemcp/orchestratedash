/**
 * The broker itself: the one function a provider access token exists inside
 * (MAR-458, ADR 0002).
 *
 * Everything else in `lib/broker/` decides. This performs — and it is the only
 * place in DASH where a live provider credential is held, attached to a request,
 * and dropped. ADR 0002 invariant 2 is a property of this file's scope: the
 * authorization is a `const` inside one `async` function, it is never returned,
 * never stored, never logged, never audited, and never reachable from the value
 * that goes back to the agent.
 *
 * Since MAR-582 that credential is one of two things — a minted access token or
 * a model provider's key — and the difference is resolved before it gets here.
 * `mintAuthorization` returns finished headers, this file checks their names
 * against a frozen set and attaches them, and every other line is indifferent to
 * which kind it just sent.
 *
 * ## The order of the checks, and why it is this order
 *
 * 1. **Duplicate request id** — before anything is looked up, so a replayed line
 *    cannot even cause a vault read.
 * 2. **Rate limit** — before the manifest, so a flood costs a counter increment.
 * 3. **Operation exists** — before the connection, because an operation nothing
 *    implements can be refused without consulting the user's data at all.
 * 3b. **For a write: the durable replay check and the write budget** (MAR-469).
 *    Both before the vault, so a repeated or excessive write costs a query
 *    rather than a token — and the durable check has to come before anything
 *    irreversible rather than beside it.
 * 4. **Connection is brokered** — from the manifest.
 * 5. **Credential** — the first vault touch, and only for a request that has
 *    already survived four checks.
 * 6. **Grant covers the operation** — the intersection in `grant.ts`.
 * 7. **Input narrows to a request** — the operation's own validation.
 * 8. **Origin check** — the planned URL really is the profile's host, and for a
 *    write the path really is the operation's own frozen one.
 * 9. **Mint, call, project.**
 *
 * Every one of them writes an audit row. A refusal that left no trace would make
 * the audit a log of successful calls, which is the half nobody needs to
 * investigate.
 *
 * ## Why the grant is resolved on every single call
 *
 * Because consent is revocable and manifests are re-importable. A grant cached
 * for the life of an agent process is a grant that survives the user pressing
 * Disconnect, and "the agent kept reading my mail for twenty minutes after I
 * revoked it" is precisely the outcome a permission broker exists to prevent.
 * The cost is a manifest lookup and a vault read per call, which is the right
 * price.
 *
 * ## What the agent can learn from a failure
 *
 * A refusal code, and nothing else. No status line, no provider body, no header,
 * no URL, no vault error. `lib/broker/protocol.ts` explains why at length; the
 * short version is that a provider's error text reaching an agent is both a
 * channel out of the boundary and a way for provider content to write into an
 * agent's reasoning.
 */

import { AI_AUTH_HEADERS } from "../ai/providers";
import type { ConnectionSourceManifest } from "../connections";
import { connectionSecretName } from "../connection-credentials";
import { isOAuthError } from "../oauth/flow";
import { maskAccount } from "../secret-refs";
import {
  brokeredField,
  credentialAccount,
  grants,
  resolveGrant,
  type BrokerCredential,
  type BrokerGrant,
} from "./grant";
import { operationById, planCall } from "./operations";
import { fulfil, refuse, type BrokerRefusal, type BrokerRequest, type BrokerResponse } from "./protocol";

/* ---------------------------------------------------------------------- *
 * What the broker needs from the outside world
 * ---------------------------------------------------------------------- */

/** How a vault read turned out. The four cases lead to three different refusals. */
export type CredentialRead =
  | { kind: "found"; credential: BrokerCredential }
  /** Nothing under that name: the user has not connected it. */
  | { kind: "absent" }
  /** Something under that name that is not a grant this version can read. */
  | { kind: "unusable" }
  /** The vault itself refused — locked, or absent on this machine. */
  | { kind: "vault_error" };

/**
 * One audited brokered call.
 *
 * Note what is here and what is not. ADR 0002 invariant 5: "Every invocation is
 * audited by operation name and safe metadata, never token or message content."
 *
 * `input_keys` is the names of the fields the agent supplied and never their
 * values — the same discipline `command_audit.payload_keys` has held since
 * MAR-417, and for the same reason: a search query is the user's own words about
 * their own mail, and a durable table of every phrase an agent searched for is a
 * record nobody asked DASH to keep.
 *
 * `result_count` is a number. It says a call returned eleven things and never
 * what any of them were.
 */
export interface BrokerAuditRow {
  agent: string;
  connection_id: string;
  operation: string;
  request_id: string;
  decision: "allowed" | "refused";
  refusal: BrokerRefusal | null;
  input_keys: string[];
  result_count: number | null;
  /** The masked account, e.g. `he••@gmail.com`. Never the full address. */
  account_hint: string | null;
  duration_ms: number;
  decided_at: string;
}

export interface BrokerDeps {
  readManifest(agentId: string): ConnectionSourceManifest | null;
  readCredential(secretName: string): Promise<CredentialRead>;
  /**
   * Turn a stored credential into the headers that authorize one request.
   *
   * Injected rather than imported so that the one call that produces a live
   * credential is a seam a test can stand in front of — which is what lets
   * `tests/broker-threat-model.test.ts` hand the broker a value it planted and
   * then assert, from the outside, that no output of any kind contains it.
   *
   * **Headers rather than a token** since MAR-582, because the two kinds present
   * themselves differently: a sign-in becomes a bearer token DASH mints from a
   * refresh token, and a model key is carried in whichever header its provider
   * reads. Returning the finished headers means the branch lives with the
   * credential, in Electron main beside the vault, and this file stays the place
   * that attaches them and drops them.
   *
   * What comes back is checked against `AUTHORIZATION_HEADERS` before it is
   * used, so an implementation that returned `host`, `content-type` or a cookie
   * cannot reshape the request it is authorizing.
   *
   * Throws on failure, and the throw is classified by `isOAuthError`.
   */
  mintAuthorization(credential: BrokerCredential): Promise<Record<string, string>>;
  fetchImpl: typeof fetch;
  /**
   * Has this agent already had a request with this id adjudicated, ever
   * (MAR-469)?
   *
   * Consulted **only for a write**, and it is the durable half of replay
   * protection. The in-memory guard below is bounded by
   * `BROKER_REPLAY_MEMORY` and dies with the process, which was the honest and
   * sufficient answer while every operation was a read: replaying a read costs
   * a second read. Replaying a write costs a second draft in somebody's
   * mailbox, so the memory has to outlive the process, and `broker_audit`
   * already holds every request id DASH ever decided about.
   *
   * Optional so the pure tests can leave it out. Absent means "no durable
   * memory", which is a weaker broker rather than a broken one — and
   * `electron/broker-host.ts` supplies it, so the shipped one always has it.
   */
  hasHandledRequest?(agentId: string, requestId: string): boolean;
  /** Record one attempt. Called exactly once per request, on every path. */
  audit(row: BrokerAuditRow): void;
  /** Note that a grant was used, for the receipt's "last used". */
  touchGrant?(grant: BrokerGrant, at: string): void;
  now(): Date;
}

/* ---------------------------------------------------------------------- *
 * Bounds
 * ---------------------------------------------------------------------- */

/**
 * How many brokered calls one agent may make in a window, and how wide it is.
 *
 * Not a performance guard. An agent that may read one message at a time may read
 * a whole mailbox given enough time, and the difference between a helpful
 * assistant and a mail exfiltrator is partly a rate. Twenty a minute is more than
 * a drafting assistant needs and far less than a scraper wants, and exceeding it
 * is a `rate_limited` refusal that lands in the audit where a person can see it.
 */
export const BROKER_CALLS_PER_WINDOW = 20;
export const BROKER_WINDOW_MS = 60_000;

/**
 * How many of those calls may change something at the provider (MAR-469).
 *
 * A second, tighter budget over the same window rather than a share of the
 * first, because the two bound different harms. Twenty reads a minute is a busy
 * assistant; twenty drafts a minute is a mailbox nobody can use. Three is more
 * than a drafting agent needs — it replies to the messages a person asked it
 * about — and it means an agent that has gone wrong fills a Drafts folder at a
 * rate a person can notice and stop rather than faster than they can scroll.
 *
 * A write also costs a read from the budget above, so a write-only agent is
 * still bounded by both.
 */
export const BROKER_WRITES_PER_WINDOW = 3;

/**
 * How many request ids the broker remembers per agent, for replay detection.
 *
 * Bounded because the memory is the runner's lifetime and an agent chooses the
 * ids. When the window rolls, the oldest are forgotten — so this half of replay
 * protection is a *recent-history* property, and a replay after two hundred
 * intervening requests would not be caught by it.
 *
 * That was the whole story while every operation was a read, and MAR-458 said so
 * plainly: "the durable protection against a repeated effect is that every
 * operation in this slice is a read." MAR-469 ends that, so writes get a second
 * check against `broker_audit`, which is unbounded and survives a restart. See
 * `BrokerDeps.hasHandledRequest`.
 */
export const BROKER_REPLAY_MEMORY = 512;

/**
 * Every header name a credential is allowed to occupy (MAR-582).
 *
 * The broker builds a request's method, URL and content headers itself and then
 * merges in whatever `mintAuthorization` returned. Without this check that merge
 * is an arbitrary header write by whichever code holds the vault — which is
 * DASH's own code, and is therefore exactly the kind of thing that is fine until
 * a fourth provider's profile is added in a hurry.
 *
 * A superset of `AI_AUTH_HEADERS` by construction rather than a second list, so
 * a provider registry that grew a header would widen this automatically and a
 * reviewer would see it in that file's diff. `authorization` is named
 * separately because the OAuth path uses it and does not come from that
 * registry.
 */
const AUTHORIZATION_HEADERS: ReadonlySet<string> = new Set<string>([
  "authorization",
  ...AI_AUTH_HEADERS,
]);

/* ---------------------------------------------------------------------- *
 * The broker
 * ---------------------------------------------------------------------- */

interface AgentBudget {
  /** Request ids seen, newest last. Bounded to `BROKER_REPLAY_MEMORY`. */
  seen: string[];
  seenSet: Set<string>;
  /** Timestamps of recent calls, for the sliding window. */
  calls: number[];
  /** Timestamps of recent calls that changed something (MAR-469). */
  writes: number[];
}

export interface Broker {
  /**
   * Answer one request from one agent.
   *
   * `agentId` is the **supervisor's** identity for the child process, never a
   * value from the request. That binding is what stops one agent asking for
   * another agent's connection: the manifest looked up below is the one DASH
   * imported for the process that actually wrote the line.
   */
  handle(agentId: string, request: BrokerRequest): Promise<BrokerResponse>;
}

export function createBroker(deps: BrokerDeps): Broker {
  const budgets = new Map<string, AgentBudget>();

  function budgetFor(agentId: string): AgentBudget {
    let budget = budgets.get(agentId);
    if (budget === undefined) {
      budget = { seen: [], seenSet: new Set(), calls: [], writes: [] };
      budgets.set(agentId, budget);
    }
    return budget;
  }

  return {
    async handle(agentId: string, request: BrokerRequest): Promise<BrokerResponse> {
      const startedAt = deps.now().getTime();
      const inputKeys = Object.keys(request.input).sort();

      /** One exit. Every refusal goes through here, so every one is audited. */
      const no = (refusal: BrokerRefusal, accountHint: string | null = null): BrokerResponse => {
        deps.audit({
          agent: agentId,
          connection_id: request.connection_id,
          operation: request.operation,
          request_id: request.request_id,
          decision: "refused",
          refusal,
          input_keys: inputKeys,
          result_count: null,
          account_hint: accountHint,
          duration_ms: deps.now().getTime() - startedAt,
          decided_at: new Date(startedAt).toISOString(),
        });
        return refuse(request.request_id, refusal);
      };

      const budget = budgetFor(agentId);

      /* 1. Replay. Before anything is read, so a repeat costs a set lookup. */
      if (budget.seenSet.has(request.request_id)) {
        return no("duplicate_request");
      }

      /* 2. Rate. Recorded now rather than on success: a refused call still cost
         the broker work, and not counting refusals would leave a way to probe
         the boundary as fast as the pipe allows. */
      const windowStart = startedAt - BROKER_WINDOW_MS;
      budget.calls = budget.calls.filter((at) => at > windowStart);
      if (budget.calls.length >= BROKER_CALLS_PER_WINDOW) {
        return no("rate_limited");
      }
      budget.calls.push(startedAt);

      budget.seenSet.add(request.request_id);
      budget.seen.push(request.request_id);
      if (budget.seen.length > BROKER_REPLAY_MEMORY) {
        const evicted = budget.seen.shift();
        if (evicted !== undefined) {
          budget.seenSet.delete(evicted);
        }
      }

      /* 3. Does this operation exist at all? */
      const operation = operationById(request.operation);
      if (operation === null) {
        // Where `gmail.send`, `gmail.drafts.send` and everything else nobody
        // built lands — regardless of what the connected account's scopes allow.
        // `gmail.compose` is granted and usable now (MAR-469), and this line is
        // still where every send-shaped request ends.
        return no("unknown_operation");
      }

      /* 3b. A write, twice over (MAR-469).
         The durable replay check first, because the point of it is to survive
         the process that holds the set consulted in step 1 — and then the write
         budget, which is the second, tighter window. Both before the vault, so
         a repeated write costs a query rather than a token. */
      if (operation.access === "write") {
        if (deps.hasHandledRequest?.(agentId, request.request_id) === true) {
          return no("duplicate_request");
        }
        budget.writes = budget.writes.filter((at) => at > windowStart);
        if (budget.writes.length >= BROKER_WRITES_PER_WINDOW) {
          return no("rate_limited");
        }
        budget.writes.push(startedAt);
      }

      /* 4. Is the connection one DASH brokers for this agent? */
      const manifest = deps.readManifest(agentId);
      if (manifest === null) {
        return no("unknown_connection");
      }
      const field = brokeredField(manifest, request.connection_id);
      if (!field.ok) {
        return no(field.refusal === "unknown_connection" ? "unknown_connection" : "not_granted");
      }

      /* 5. The credential. First vault touch. */
      const secretName = connectionSecretName(
        agentId,
        request.connection_id,
        field.field.field_id,
      );
      const read = await deps.readCredential(secretName);
      if (read.kind === "vault_error") {
        return no("vault_unavailable");
      }
      if (read.kind !== "found") {
        return no("not_connected");
      }
      // Null for every keyed connection, because a provider key names nobody.
      // See `credentialAccount` on why deriving one from the key is not an
      // option (MAR-582).
      const account = credentialAccount(read.credential);
      const accountHint = account === null ? null : maskAccount(account);

      /* 6. Does the grant cover it? */
      const resolved = resolveGrant(
        agentId,
        manifest,
        request.connection_id,
        read.credential,
        secretName,
      );
      if (!resolved.ok) {
        return no(
          resolved.refusal === "no_operations_granted" ? "permission_missing" : "not_granted",
          accountHint,
        );
      }
      if (!grants(resolved.grant, operation.id)) {
        // The operation exists, the connection is brokered, and this grant does
        // not reach it — the user did not consent to what it needs, or the agent
        // never declared it. `permission_missing` when the scopes are the reason,
        // so the recovery can be "reconnect and tick the box" rather than a
        // dead end.
        return no(
          resolved.grant.missing_scopes.some((scope) => operation.required_scopes.includes(scope))
            ? "permission_missing"
            : "not_granted",
          accountHint,
        );
      }

      /* 7. The typed input. */
      const planned = planCall(operation, resolved.grant.profile.api_origin, request.input);
      if (!planned.ok) {
        return no("invalid_input", accountHint);
      }

      /* 8. The origin. A belt-and-braces check on DASH's own code: `planCall`
         built this URL from a constant path and an encoded id, so a mismatch
         here is a bug in an operation rather than an agent's doing — and the
         cost of the bug would be a live access token sent to whatever host it
         named. */
      if (new URL(planned.call.url).origin !== resolved.grant.profile.api_origin) {
        return no("broker_error", accountHint);
      }

      /* 8b. And for a write, the path as well (MAR-469).
         The origin check above would let a bug reach any path on the provider,
         which for Gmail includes `/gmail/v1/users/me/messages/send`. This is
         the second reading of the same fact `planCall` already guarantees
         structurally, and it is here for the reason step 8 is: the two are
         cheap, and the thing on the other side of them is somebody's mailbox.
         A mismatch is DASH's bug, so it is `broker_error` and not a refusal
         that would read as the agent's fault. */
      if (
        operation.access === "write" &&
        new URL(planned.call.url).pathname !== operation.path
      ) {
        return no("broker_error", accountHint);
      }

      /* 9. Mint, call, project. */
      let authorization: Record<string, string>;
      try {
        authorization = await deps.mintAuthorization(read.credential);
      } catch (error: unknown) {
        // `revoked` is the one that must not read as a transient failure: the
        // user, or Google, ended this grant, and retrying will not undo that.
        // A keyed credential never reaches this branch — there is nothing to
        // exchange, so nothing to be refused at exchange time. What a provider
        // thinks of the key is learned from the call below.
        return no(
          isOAuthError(error) && error.code === "revoked" ? "revoked" : "provider_unavailable",
          accountHint,
        );
      }

      // DASH's own code, checked anyway (MAR-582). The map above came from the
      // one function that holds a live credential, and merging it unchecked
      // would let a bug there decide the request's `host` or its content type
      // with a secret already in hand.
      for (const header of Object.keys(authorization)) {
        if (!AUTHORIZATION_HEADERS.has(header.toLowerCase())) {
          return no("broker_error", accountHint);
        }
      }

      let body: unknown;
      try {
        const response = await deps.fetchImpl(planned.call.url, {
          method: planned.call.method,
          headers: {
            // The only place these values are used, and they do not survive the
            // function. Nothing below reads `authorization` again.
            //
            // Spread first, so a credential header can never overwrite the
            // content type or the accept header DASH chose — the merge order is
            // the guard, and the name check above is the other half of it.
            ...authorization,
            accept: "application/json",
            ...(planned.call.method === "POST"
              ? { "content-type": "application/json" }
              : {}),
          },
          // Serialised here rather than in the operation, so the only thing that
          // ever becomes a request body is a value `compose` returned and
          // `JSON.stringify` rendered. There is no path by which an agent's own
          // string reaches the wire unquoted.
          ...(planned.call.method === "POST"
            ? { body: JSON.stringify(planned.call.json) }
            : {}),
          signal: AbortSignal.timeout(20_000),
        });

        if (!response.ok) {
          // 401 after a *fresh* mint means the grant stopped being honoured
          // between the token endpoint and the API — which is what a revocation
          // mid-request looks like from here.
          return no(
            response.status === 401 || response.status === 403 ? "revoked" : "provider_refused",
            accountHint,
          );
        }

        const text = await readBounded(response, operation.max_response_bytes);
        if (text === null) {
          return no("provider_refused", accountHint);
        }
        body = JSON.parse(text);
      } catch {
        // The caught value is dropped rather than inspected, for the reason
        // `lib/oauth/flow.ts` drops its own: a fetch rejection can carry the
        // request, and this request has a bearer token in its headers.
        return no("provider_unavailable", accountHint);
      }

      const result = operation.project(body);
      const decidedAt = new Date(startedAt).toISOString();

      deps.audit({
        agent: agentId,
        connection_id: request.connection_id,
        operation: operation.id,
        request_id: request.request_id,
        decision: "allowed",
        refusal: null,
        input_keys: inputKeys,
        result_count: countResults(result),
        account_hint: accountHint,
        duration_ms: deps.now().getTime() - startedAt,
        decided_at: decidedAt,
      });
      deps.touchGrant?.(resolved.grant, decidedAt);

      return fulfil(request.request_id, result);
    },
  };
}

/**
 * Read a response body, giving up past a ceiling.
 *
 * `response.text()` on a provider that answers with a gigabyte is an unbounded
 * allocation in the DASH process, and "the provider is trusted" is exactly the
 * assumption ADR 0002 invariant 7 refuses to make. Null means the ceiling was
 * hit, which the caller reports as a refusal rather than truncating and parsing
 * a fragment — half a JSON document parsed leniently is a worse outcome than a
 * refusal a person can see.
 */
async function readBounded(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value !== undefined) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/**
 * How many things came back, for the audit.
 *
 * The first array-valued member of the projection, or 1 for a single object.
 * Deliberately shallow: the number is context for a person reading an audit row,
 * not a measurement, and a recursive count over provider-derived data would be
 * one more thing that walks a hostile structure for no benefit.
 */
function countResults(result: Record<string, unknown>): number {
  for (const value of Object.values(result)) {
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return 1;
}
