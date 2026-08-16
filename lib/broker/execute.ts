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
 * 3c. **For a spend: who asked, then the same two checks** (MAR-545). The
 *    origin gate is first and is the cheapest refusal in the file — an agent
 *    that may not spend does not get so far as costing DASH a database query
 *    for asking.
 * 4. **Connection is brokered** — from the manifest.
 * 4b. **For the chief: the operation is one DASH declared** (MAR-659). The
 *    chief's manifest is DASH's own, so its capability list is authoritative in
 *    a way an agent author's is not.
 * 5. **Credential** — the first vault touch, and only for a request that has
 *    already survived four checks. Two names are computable here and exactly one
 *    is reachable per principal: see step 5's own note.
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
 * ## Who is asking is a type, not a string (MAR-659, ADR 0023)
 *
 * The first parameter of `handle` is a `BrokerPrincipal`, and every check below
 * that used to read an agent id now reads either the principal or the label
 * derived from it. There are two arms — an agent, and the chief — and they
 * differ in exactly three places in this file: which manifest is resolved (step
 * 4, through an injected dep), whether the declared capability list is enforced
 * (step 4b), and which vault name is computed (step 5). Everything else is
 * indifferent to which one it just answered, which is the property worth having.
 *
 * `lib/broker/principal.ts` argues why a union beats a reserved string. The
 * short version is that `dash.fleet` is a legal agent id, so a string comparison
 * here would be an authority an agent author could claim by choosing a name.
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
import { fleetSecretName } from "../fleet/catalogue";
import { FLEET_PRINCIPAL } from "../fleet/principal";
import { isOAuthError } from "../oauth/flow";
import { maskAccount } from "../secret-refs";
import { principalKey, type BrokerPrincipal } from "./principal";
import {
  brokeredField,
  credentialAccount,
  grants,
  resolveGrant,
  type BrokerCredential,
  type BrokerGrant,
} from "./grant";
import { hasFrozenPath, isSpendOperation, operationById, planCall } from "./operations";
import { fulfil, refuse, type BrokerRefusal, type BrokerRequest, type BrokerResponse } from "./protocol";
import {
  openRunSpend,
  spendAllowed,
  spendOne,
  type RunSpendAllowance,
} from "./spend-allowance";

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
  /**
   * Who asked, as a name a person reading the audit can recognise.
   *
   * The agent id for an agent, and `FLEET_PRINCIPAL` for the chief (MAR-659) —
   * which is exactly the job that constant's own docblock claims: *a label, not
   * a lock*. It already names the fleet's rows in `connection_secrets` and
   * `ai_key_checks`, and a chief's brokered call belongs beside them under the
   * same word. Nothing reads this column back as a principal; the principal is
   * `BrokerPrincipal` and has no string form.
   */
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
  /**
   * The connections DASH brokers for whoever is asking.
   *
   * Two answers from one seam since MAR-659, and the asymmetry is the whole of
   * ADR 0023 decision 2. For an agent this is the manifest DASH imported for
   * that agent, read out of the store exactly as it always was. For the chief
   * there is no imported document, so DASH **composes** one from
   * `lib/fleet/catalogue.ts` — one connection, one capability — and
   * `lib/chief/manifest.ts` is the builder.
   *
   * Injected rather than branched on here, so `lib/broker/` goes on being a pure
   * function of what it is handed and knows nothing about a catalogue, a
   * provider registry or a fleet default. `electron/broker-host.ts` is where the
   * two answers are actually chosen.
   */
  readManifest(principal: BrokerPrincipal): ConnectionSourceManifest | null;
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
  /**
   * Which model this agent's owner chose, or null (MAR-619, ADR 0011).
   *
   * Consulted **only for an agent-origin spend**, and it is what keeps ADR
   * 0011's first decision — *"a level is what an agent's author declares; a
   * model is what its owner chooses"* — true on a path where the author's own
   * program is doing the asking. The agent supplies a `model` in its input like
   * any other field, and DASH overwrites it with this before the operation ever
   * sees it. An agent that could name its own model would be an agent that
   * could name an expensive one.
   *
   * Null means the owner has left the agent on *match each step*, which is not
   * something DASH can ask a provider under — the same gap
   * `describeUnavailable`'s `no_model_chosen` words for the chat — and the
   * request is refused rather than run against a model DASH picked.
   *
   * Optional so the pure tests can leave it out; absent behaves as null, so a
   * broker built without it simply cannot spend on an agent's behalf.
   * `electron/broker-host.ts` supplies it.
   */
  readModelChoice?(agentId: string): string | null;
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
 * How many of those calls may cost the person money (MAR-545).
 *
 * A third budget over the same window, on the terms the second was added under:
 * it bounds a different harm, so it gets a different number rather than a share
 * of somebody else's. Six a minute is more than a person can read the answers
 * to, and it is the ceiling on what a stuck retry loop or a page rendering in a
 * loop can cost before somebody notices — which is the failure worth bounding,
 * because unlike a flood of reads this one arrives as a line on a bill.
 *
 * A question also costs a call from the general budget above, so nothing is
 * exempt from the coarser bound by being expensive.
 *
 * ## The chief gets its own six, and that is a real widening (MAR-659)
 *
 * The budgets below are keyed by **principal**, so the fleet-wide ceiling on
 * questions per minute rises by six the day the chief can ask one. Deliberate,
 * and ADR 0023 states the alternative it is refusing: sharing a window with an
 * agent would mean a person's own question failing because a scout was busy,
 * which is the failure a rate limit should never cause.
 */
export const BROKER_SPEND_PER_WINDOW = 6;

/**
 * Who asked for this (MAR-545).
 *
 * A required parameter of `handle` rather than a field on `BrokerRequest`,
 * which is the whole of its value: a request cannot carry its own origin,
 * because the origin is a fact about which code path DASH's own process took to
 * get here and an agent could otherwise assert it. The drain loop in
 * `electron/broker-host.ts` passes `"agent"` for every line it reads off a
 * child's stdout, and only a call DASH itself makes because somebody pressed
 * something passes `"person"`.
 *
 * **What it gates is spending, and only spending.** Every read and every write
 * behaves identically whichever value is passed; `gmail.draft.create` is an
 * agent's job and always was.
 *
 * ## The temporary standing, and how it ended (MAR-619, ADR 0016)
 *
 * This block used to say that a completion is refused for an agent because
 * MAR-582 named the thing that has to exist first — "a cost story and a per-run
 * budget" — and that slice built the first and not the second. It closed:
 * *"when MAR-299 has a per-run budget, letting an agent spend is this gate plus
 * that budget, and the diff is small and visible."*
 *
 * `lib/broker/spend-allowance.ts` is that budget and this is that diff. An
 * agent-origin spend is now permitted **while an allowance a person opened is
 * still open**, and refused with the same `needs_a_person` in every other case.
 * The sentence the gate was always protecting is unchanged and is now enforced
 * rather than approximated: a person is behind every penny DASH spends.
 *
 * `origin` keeps its full force for everything else and is still not weakened
 * here — an `"agent"` line with no allowance behind it is refused exactly as it
 * was, and there is no path by which a request can open its own.
 */
export type BrokerOrigin =
  /** A line read off an agent's stdout by the runner. */
  | "agent"
  /** A call DASH made because somebody at the keyboard asked for it. */
  | "person";

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

/**
 * One principal's windows.
 *
 * Named for the principal rather than the agent since MAR-659, because the chief
 * has one of these too and has no agent id. The four fields are unchanged; what
 * changed is only what the map is keyed by. See `principalKey`.
 */
interface PrincipalBudget {
  /** Request ids seen, newest last. Bounded to `BROKER_REPLAY_MEMORY`. */
  seen: string[];
  seenSet: Set<string>;
  /** Timestamps of recent calls, for the sliding window. */
  calls: number[];
  /** Timestamps of recent calls that changed something (MAR-469). */
  writes: number[];
  /** Timestamps of recent calls that cost money (MAR-545). */
  spends: number[];
  /**
   * What the last press of Run now bought this agent, or absent (MAR-619).
   *
   * Beside the three windows rather than in a map of its own, because it is the
   * same kind of fact about the same agent and `hostBroker`'s argument for one
   * broker applies to it exactly: two places counting what one agent may spend
   * is twice the ceiling, arrived at by accident.
   */
  runSpend?: RunSpendAllowance;
}

export interface Broker {
  /**
   * A person asked for a run: open this agent's spend allowance (MAR-619).
   *
   * Still an **agent id** and not a principal (MAR-659), because there is no
   * such thing as a chief run. ADR 0016's allowance is what lets an agent's own
   * program spend inside a window a person opened by pressing Run now; the chief
   * has no program, no scheduler can reach it, and every question it asks is
   * `origin: "person"` by the time it arrives. So an unattended chief spend is
   * not refused-by-policy — there is no method by which one could be opened.
   *
   * The **only** way an allowance comes into being, and it is a method on the
   * broker rather than a field on a request for `BrokerOrigin`'s reason — the
   * fact it records is which code path DASH's own process took, and a request
   * that could carry it is a request that could assert it. `electron/main.ts`
   * calls this from the one place a person's Run press is turned into a command,
   * and nothing else in DASH calls it at all.
   *
   * Idempotent in the direction that matters: a second press replaces the
   * allowance rather than adding to it, so the ceiling stays one press's worth
   * however many times somebody presses. See `openRunSpend`.
   */
  allowRunSpend(agentId: string, at: Date): void;
  /**
   * Answer one request about one principal's connection.
   *
   * `principal` is the **supervisor's** identity for whoever is asking, never a
   * value from the request. That binding is what stops one agent asking for
   * another agent's connection: the manifest looked up below is the one DASH
   * imported for the process that actually wrote the line.
   *
   * It is a union rather than an agent id since MAR-659 (ADR 0023 decision 1),
   * and `lib/broker/principal.ts` carries the argument. The short version is
   * that the chief needed to be let through and a reserved *string* would have
   * been an authority an agent author could claim by choosing a name; a variant
   * with no id field cannot be inhabited by any string at all.
   *
   * `origin` is required and has no default (MAR-545). A default would be a
   * decision about somebody's money taken by whichever call site forgot to pass
   * it, and there is no safe side to default to: `"agent"` would break the
   * person's own chat and `"person"` would let a child process spend. All three
   * call sites are in `electron/`, each is one line, and each says which it is.
   */
  handle(
    principal: BrokerPrincipal,
    request: BrokerRequest,
    origin: BrokerOrigin,
  ): Promise<BrokerResponse>;
}

export function createBroker(deps: BrokerDeps): Broker {
  const budgets = new Map<string, PrincipalBudget>();

  function budgetFor(principal: BrokerPrincipal): PrincipalBudget {
    const key = principalKey(principal);
    let budget = budgets.get(key);
    if (budget === undefined) {
      budget = { seen: [], seenSet: new Set(), calls: [], writes: [], spends: [] };
      budgets.set(key, budget);
    }
    return budget;
  }

  return {
    allowRunSpend(agentId: string, at: Date): void {
      budgetFor({ kind: "agent", agent_id: agentId }).runSpend = openRunSpend(at.getTime());
    },

    async handle(
      principal: BrokerPrincipal,
      request: BrokerRequest,
      origin: BrokerOrigin,
    ): Promise<BrokerResponse> {
      const startedAt = deps.now().getTime();
      const inputKeys = Object.keys(request.input).sort();
      /*
       * The name this principal stands under wherever a string is required — the
       * audit row, the durable replay check, and the receipt `touchGrant`
       * writes. `FLEET_PRINCIPAL` for the chief, which is that constant's
       * declared job: a label in DASH's own tables, never a principal. See
       * `BrokerAuditRow.agent`.
       */
      const auditName = principal.kind === "chief" ? FLEET_PRINCIPAL : principal.agent_id;

      /** One exit. Every refusal goes through here, so every one is audited. */
      const no = (refusal: BrokerRefusal, accountHint: string | null = null): BrokerResponse => {
        deps.audit({
          agent: auditName,
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

      const budget = budgetFor(principal);

      /**
       * What the operation will actually be planned against.
       *
       * The agent's own input everywhere except an agent-origin spend, where
       * DASH substitutes the owner's model below. Threaded as a separate value
       * rather than written back into `request.input`, so that `inputKeys` —
       * already taken, and documented as "the names of the fields the agent
       * supplied" — stays a record of what the agent supplied rather than of
       * what DASH added to it.
       */
      let plannedInput: Record<string, unknown> = request.input;

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
        if (deps.hasHandledRequest?.(auditName, request.request_id) === true) {
          return no("duplicate_request");
        }
        budget.writes = budget.writes.filter((at) => at > windowStart);
        if (budget.writes.length >= BROKER_WRITES_PER_WINDOW) {
          return no("rate_limited");
        }
        budget.writes.push(startedAt);
      }

      /* 3c. A spend, three times over (MAR-545).
         The origin gate first, and before the vault for the reason every check
         above it is: an agent that may not spend at all should not cause a
         vault read by asking. It is also before the durable replay check, so
         that an agent cannot learn from a refusal's *shape* which request ids
         DASH has adjudicated before.

         Then the same durable replay check a write gets — a repeated question
         is a repeated charge, which is exactly the kind of memory that has to
         outlive the process — and then the spend budget. */
      if (isSpendOperation(operation)) {
        if (origin !== "person") {
          /*
           * MAR-619, ADR 0016. An agent may spend inside an allowance a person
           * opened by pressing Run now, and nowhere else.
           *
           * Consumed on the attempt rather than on a successful answer, for the
           * reason `budget.calls` is: a refused call still reached a provider's
           * door, and an allowance that only counted successes would let a
           * failing loop probe the boundary for free.
           */
          if (!spendAllowed(budget.runSpend, startedAt)) {
            return no("needs_a_person");
          }
          budget.runSpend = spendOne(budget.runSpend as RunSpendAllowance);

          /*
           * MAR-659. Unreachable for the chief, and the reason is structural
           * rather than a check written here: `allowRunSpend` takes an agent id,
           * so no chief budget can ever hold an allowance, so the branch above
           * refuses first. This narrowing exists because the compiler needs it
           * to read `agent_id` below, and it is a `broker_error` rather than a
           * refusal that would read as somebody's fault: reaching it would mean
           * DASH opened an allowance for something with no id.
           */
          if (principal.kind !== "agent") {
            return no("broker_error");
          }

          /*
           * The model is the owner's, never the agent's (ADR 0011 decision 1).
           *
           * Overwritten rather than validated, and before `planCall` narrows
           * anything, so there is no branch in which what an agent asked for
           * survives into the body DASH sends. A missing choice is refused
           * here rather than defaulted: DASH translating a declared *level*
           * into a model name is the exact mapping ADR 0011 refuses to keep a
           * second copy of, and picking one anyway would be DASH choosing what
           * somebody's account gets billed for.
           */
          const chosen = deps.readModelChoice?.(principal.agent_id) ?? null;
          if (chosen === null) {
            return no("no_model_chosen");
          }
          plannedInput = { ...request.input, model: chosen };
        }
        if (deps.hasHandledRequest?.(auditName, request.request_id) === true) {
          return no("duplicate_request");
        }
        budget.spends = budget.spends.filter((at) => at > windowStart);
        if (budget.spends.length >= BROKER_SPEND_PER_WINDOW) {
          return no("rate_limited");
        }
        budget.spends.push(startedAt);

        /*
         * Which frame the model is asked under, decided by **who is asking**
         * (MAR-659, ADR 0023 decision 5).
         *
         * Written the way the model is written above — overwritten rather than
         * validated, after both branches so neither can lose it — and for the
         * same reason: a value a caller supplies is a value a caller could
         * choose, and the frame decides which of DASH's frozen system prompts
         * the question is set in. `lib/broker/operations.ts` holds both strings
         * and this decides which one; the caller supplies neither.
         *
         * That keeps `CHIEF_SYSTEM_PROMPT` unreachable from the agent path
         * without making the chief a second operation. The file's own rule for
         * when a prompt earns an operation of its own is that the card sentence,
         * the scope list, the request shape and the projection all differ —
         * `curateOperation` is a separate operation because all four do. Here
         * three of the four are identical: it is the same charge, the same
         * fields and the same answer, asked about different material.
         */
        plannedInput = {
          ...plannedInput,
          frame: principal.kind === "chief" ? "fleet_briefing" : "agent_material",
        };
      }

      /* 4. Is the connection one DASH brokers for this principal? */
      const manifest = deps.readManifest(principal);
      if (manifest === null) {
        return no("unknown_connection");
      }
      const field = brokeredField(manifest, request.connection_id);
      if (!field.ok) {
        return no(field.refusal === "unknown_connection" ? "unknown_connection" : "not_granted");
      }

      /* 4b. And for the chief, is it one of the capabilities DASH declared?
         (MAR-659, ADR 0023 decision 4.)

         The chief's manifest is DASH's own, so its declared capability list is
         authoritative in a way an agent's is not — an agent's manifest is its
         *author's* document, which is exactly why `resolveKeyGrant` ignores what
         it declares and grants every operation the provider has. That is right
         for an agent, whose owner connected a key knowing what DASH can do with
         it, and it is wrong for the chief, whose whole invariant is:

           > The chief can ask a model a question and be charged for it. It can
           > do nothing else.

         Without this line the chief would inherit `digest.curate` and
         `models.list` from the same provider, so the invariant would be a
         sentence rather than a property. Before the vault, for the reason every
         check above it is: a principal that may not reach an operation should
         not cause a vault read by naming it. */
      if (
        principal.kind === "chief" &&
        !field.field.connection.capabilities.some((one) => one.id === operation.id)
      ) {
        return no("not_granted");
      }

      /* 5. The credential. First vault touch — and the one `switch` on who is
         asking that is not the origin gate (MAR-659, ADR 0023 decision 3).

         `connectionSecretName` does not move and is **never called for a chief**.
         It goes on emitting `dash.connection.` for every agent, so the sentence
         `lib/fleet/principal.ts` protects survives verbatim: *no agent, named
         anything at all, resolves to the fleet credential's vault key.* It is
         now true for two independent reasons rather than one — the namespaces
         still cannot meet, and the chief principal is not a name.

         `fleetSecretName` is the key ADR 0013 already writes on connect and on
         re-key, so nothing is copied into a second place and re-key still writes
         N+1 vault entries rather than N+2.

         ## One overlap, recorded rather than pre-solved (MAR-643, PR #203)

         That PR gives a fleet connection more than one account and grows
         `fleetSecretName` an optional third segment, so a key connected *after*
         it lands stands under `dash.fleet.{provider}.{account}.{field}`. Its
         migration keeps the existing row's `secret_name` verbatim, so the
         two-argument call below goes on resolving the account every store today
         actually holds — which is why this is an overlap and not a defect.

         Whichever of the two merges second owns the fix, and it is one line:
         read the name off the `fleet_connections` row that PR makes the sole
         reference for fleet vault entries, rather than recomputing it here.
         Doing that now would mean this file reading a store, which it must not,
         so the seam would have to be a new `BrokerDeps` member — and adding one
         to dodge a merge conflict with an unmerged branch is speculative
         coupling. Named here so the resolver finds it at the site. */
      const secretName =
        principal.kind === "chief"
          ? fleetSecretName(field.field.connection.provider, field.field.field_id)
          : connectionSecretName(
              principal.agent_id,
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
        auditName,
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
      const planned = planCall(operation, resolved.grant.profile.api_origin, plannedInput);
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

      /* 8b. And for anything carrying a frozen path, the path as well
         (MAR-469, MAR-545).
         The origin check above would let a bug reach any path on the provider,
         which for Gmail includes `/gmail/v1/users/me/messages/send` and for a
         model provider includes every billed endpoint it has. This is the
         second reading of the same fact `planCall` already guarantees
         structurally, and it is here for the reason step 8 is: the two are
         cheap, and the thing on the other side of them is somebody's mailbox or
         somebody's money. A mismatch is DASH's bug, so it is `broker_error` and
         not a refusal that would read as the agent's fault. */
      if (hasFrozenPath(operation) && new URL(planned.call.url).pathname !== operation.path) {
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
        agent: auditName,
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
