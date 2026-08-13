/**
 * A channel to a runner, typed by **which routes it is allowed to be asked
 * for** (MAR-484, ADR 0007).
 *
 * ADR 0007's load-bearing paragraph is a finding about this file's absence. Its
 * exclusion —
 *
 * > `/broker/drain` and `/broker/responses` are never called on a remote
 * > channel. Not conditionally, not behind a flag… The remote channel type does
 * > not carry the capability.
 *
 * — was, until now, enforced by an accident of control flow.
 * `electron/agent-adapters.ts`'s three drains each open with `if (runner ===
 * null) { return; }`, where `runner` is the *local* `RunnerHandle`. They are not
 * written against a channel; they are hardcoded to the one runner this machine
 * spawned. And `POST /broker/drain` sits in the same list of routes as
 * `/telemetry/drain` and `/artifacts/drain`, on the same authenticated channel,
 * answering the same shape.
 *
 * So the failure mode ADR 0007 names is not somebody *arguing* for extending
 * the broker. It is somebody generalising the drains to take a channel — the
 * obvious, correct-looking refactor — and `/broker/drain` coming along because
 * it was in the same loop. ADR 0006 would be gone, silently, in a commit whose
 * message says "pull remote run evidence".
 *
 * ## What actually makes it impossible, before any type says so
 *
 * **A broker-capable channel is built on `ipcFetch`, and `ipcFetch` dials a
 * `socketPath`.** There is no host in it, no name to resolve and no route to a
 * network — `node:http` given a `socketPath` reaches an OS-local endpoint or it
 * reaches nothing. The URL it carries is deliberately unresolvable
 * (`.invalid`), so even a leak into a real `fetch` fails closed. That is a fact
 * about where the bytes can physically go, which is the standard ADR 0002
 * amendment 1 set and ADR 0006 spent a paragraph on: a boundary made of what
 * the code *can* do rather than what a reader must remember.
 *
 * The types below are that fact made checkable at compile time, so the mistake
 * is caught in the editor rather than in a review nobody scheduled.
 *
 * ## How the type expresses it, and one trap it had to avoid
 *
 * `call` is declared as a **property with a function type**, never as a method.
 * TypeScript checks method parameters *bivariantly* even under
 * `strictFunctionTypes`, so writing `call(route: Route): …` would let a
 * narrow-routed channel satisfy a wide-routed one and this whole module would be
 * decoration. As a property, parameters are contravariant: a channel accepting
 * only evidence routes is **not** assignable where broker routes may be asked
 * for, and `tests/broker-channel-exclusion.test.ts` pins that with a
 * `@ts-expect-error` — which starts failing the typecheck the moment the
 * exclusion stops holding, because an unused expected error is itself an error.
 *
 * The direction that *is* allowed is the useful one: a local channel satisfies
 * `RemoteRunnerChannel`, so evidence code written once works for both. That is
 * the generalising refactor ADR 0007 warned about, available and safe.
 */

import { ipcFetch, IPC_ORIGIN } from "./ipc-fetch";

/* ---------------------------------------------------------------------- *
 * The routes, as values first
 * ---------------------------------------------------------------------- */

/**
 * What any runner answers, wherever it is running.
 *
 * Evidence and lifecycle: what an agent did, what it produced, what is still
 * on disk, and whether the runner is alive. None of these carry a credential
 * *to* anybody — they are DASH reading a record — which is why they are the
 * set that may cross a machine boundary.
 */
export const EVIDENCE_ROUTES = [
  "/health",
  "/agents",
  "/telemetry/drain",
  "/artifacts/drain",
  "/workspace-artifacts",
  "/registrations/reload",
  "/shutdown",
] as const;

/**
 * The two routes ADR 0006 exists to keep on this machine, named as a value so
 * a runtime check and a test can both point at the same list.
 *
 * They are different in kind from everything above: `/broker/drain` carries a
 * request *for a credentialled operation DASH will perform*, and
 * `/broker/responses` carries the answer back to the process that asked. A
 * runner that can reach them is a runner whose children can reach the user's
 * mailbox through DASH's grant. That is precisely what "the broker's reach ends
 * at the machine DASH is installed on" means.
 */
export const BROKER_ROUTES = ["/broker/drain", "/broker/responses"] as const;

export type EvidenceRoute = (typeof EVIDENCE_ROUTES)[number];
export type BrokerRoute = (typeof BROKER_ROUTES)[number];

/* ---------------------------------------------------------------------- *
 * The one route that is not a fixed string
 * ---------------------------------------------------------------------- */

/**
 * Asking a runner to start a run, wherever that runner is (MAR-602, ADR 0014).
 *
 * ## Why this is admitted at all
 *
 * MAR-489's `V8` failed because DASH could put an agent on a server and then
 * never cause it to do anything there. ADR 0014 settles the question the issue
 * raised — *may a start-a-run route cross the boundary* — and the answer is yes,
 * for a reason narrower than the one the issue offered. "It carries no
 * credential" is true of this route and is **not** the test: it is also true of
 * `/agents/{id}/lifecycle`, which takes the user's typed secrets as an argument
 * and is in neither list. What has been holding the line is that
 * `EVIDENCE_ROUTES` is an allowlist, and this is a reviewed widening of it.
 *
 * The route passes the two questions that actually decide it. It carries no
 * credential in either direction: an envelope of identifiers, a nonce and an
 * expiry out, and an adjudicated `{ok, detail, reason}` back. And it chooses
 * *which* and never *what* — `runner/README.md`'s rule, which ADR 0007 says
 * decides more of that ADR than anything in ADR 0006. It names an agent the
 * host already installed and a target the host's own snapshot published;
 * `runner/execute.ts` then adjudicates it against the host's own store and is
 * free to refuse. DASH asks; the host decides.
 *
 * ## Why it is an object and not a string
 *
 * `/agents/{id}/commands` has a variable segment, and this module's entire
 * mechanism is that a route is a **value the type system can enumerate** rather
 * than a string it cannot see into. Admitting a template, a prefix or a plain
 * `string` here would return the module to decoration in one line.
 *
 * So the variable part travels as a field and `pathOf` is the only thing that
 * builds a path from it. That makes a second property true for free, and it is
 * the one worth checking: **the variable part cannot spell a path.**
 * `encodeURIComponent` puts it in exactly one segment, so an `agent_id` of
 * `/broker/drain` addresses an agent whose name contains slashes and never the
 * broker. It is `lib/deploy/verbs.ts`'s rule one machine over — an identifier is
 * not a path — reached here from the opposite direction.
 */
export interface AgentCommandRoute {
  /** Opaque to this module. Encoded into one segment and never joined as a path. */
  readonly agent_id: string;
  /**
   * The only leaf this route family has.
   *
   * A literal rather than a free string, so `{ agent_id, leaf: "lifecycle" }` is
   * a compile error rather than a widening nobody reviewed. Adding a member is a
   * change to this union, in this file, held to ADR 0014's three questions.
   */
  readonly leaf: "commands";
}

/**
 * Reading one agent's state snapshot, wherever that agent is (MAR-602,
 * ADR 0014 amendment 1).
 *
 * ## Why the run route could not be used alone
 *
 * `AgentCommandRoute` above admits the press and nothing else, and the press
 * cannot be composed without this. A run command names *a target the host's own
 * snapshot published* — `runner/execute.ts` refuses an `unknown_target`, and the
 * two stores deliberately never consult each other, so the task id in DASH's
 * store is a fact about the copy on this computer and is not one about the copy
 * on a server. `GET /agents/{id}` is where the host says what it is currently
 * offering; without it the run route is admitted and unreachable, which is the
 * state MAR-602 inherited and exists to end.
 *
 * `/agents` — the list — has been in `EVIDENCE_ROUTES` since MAR-484, so this is
 * one level deeper on a route family already crossing. It was not there for the
 * same reason the run route was not: the list is a fixed string and this has a
 * variable segment, and until `AgentCommandRoute` there was no shape in this
 * module for a route that was not a literal. That is an absence of vocabulary
 * rather than a decision anybody took, which is precisely the failure mode
 * ADR 0014 says to name rather than inherit.
 *
 * ## ADR 0014's three questions
 *
 * 1. **A credential in either direction?** None. Out goes an agent id; back
 *    comes a document `agent-dom-state.schema.json` validates.
 * 2. **Does it choose what runs, or only which?** Neither — it is a read, and
 *    the only route admitted here that changes nothing at all.
 * 3. **Can DASH describe the result honestly?** Yes, and the honest thing turns
 *    out to be that it must not keep it. `agent_dom_state` is keyed by agent id
 *    alone, and a deployed agent has the same id in both places, so storing a
 *    host's snapshot would overwrite this machine's — two runners' clocks
 *    fighting over one row through `putAgentDomState`'s ordering guard. So this
 *    route is read *through* and never *into* the store: `electron/host-run.ts`
 *    holds the answer for the length of one command and drops it. The day a
 *    snapshot carries its machine of origin, that becomes a storage decision;
 *    today it is a refusal, and the refusal is the honest one.
 */
export interface AgentStateRoute {
  /** Opaque to this module, exactly as `AgentCommandRoute.agent_id` is. */
  readonly agent_id: string;
  /**
   * Not a path segment.
   *
   * `commands` next door names the last segment of `/agents/{id}/commands`.
   * This route's path *ends* at the agent, so this member is a discriminant and
   * `pathOf` appends nothing for it. Spelled as a distinct literal rather than
   * as an absent field, because two object shapes distinguished by which key is
   * missing is the kind of union a later reader narrows wrongly.
   */
  readonly leaf: "state";
}

/**
 * Reading the bytes of one output a runner is holding (MAR-611, ADR 0017).
 *
 * ## Why an index was not enough
 *
 * `/workspace-artifacts` — in `EVIDENCE_ROUTES` since MAR-484 — brings home a
 * runner's *picture* of its file-backed outputs: name, size, digest, whether the
 * file is still where it was. It has never brought a byte. On this machine that
 * was invisible, because `workspaceDownload` reaches the local runner over its
 * own socket whenever somebody presses Save. On a host it is the whole problem:
 * the file exists only there, and ADR 0017 removes the bundle that holds it.
 *
 * So a bring-home that copied only the index would list, on the Outputs panel,
 * files that no longer exist anywhere — with a Save button that would go looking
 * on the wrong machine. That is not a smaller feature; it is a surface that
 * lies, which is the thing this repository spends its length refusing.
 *
 * ## ADR 0014's three questions
 *
 * 1. **A credential in either direction?** None. An artifact id out; the file's
 *    own bytes back, under a `content-type` the runner chose.
 * 2. **Does it choose what runs, or only which?** Neither. It runs nothing and
 *    changes nothing — the second read-only member of this union, and like
 *    `AgentStateRoute` it can only name something the host's own index published
 *    a moment earlier. `runner/workspace.ts` still resolves the opaque id to a
 *    location and still refuses to hand back the path, so the caller names a
 *    file it has never been told the whereabouts of.
 * 3. **Can DASH describe the result honestly?** Yes, and here the honest thing
 *    turned out to be *possible* rather than a refusal, which is the difference
 *    from `AgentStateRoute`. A host's snapshot could not be stored because
 *    `agent_dom_state` is keyed by agent id and both machines share one. Bytes
 *    have no such row: they go to a folder the person chose, in a window DASH
 *    does not draw, and DASH says which files it wrote and which it could not.
 *
 * ## The normalising hole, one route further along
 *
 * ADR 0014 amendment 1 recorded that `encodeURIComponent` leaves `.` and `..`
 * untouched, so an `agent_id` of `..` turns `/agents/{id}` into `/agents` — a
 * real route answering the whole list. This route's path does not *end* at the
 * variable segment, so `..` normalises to `/artifacts/download`, which no runner
 * serves. That makes the guard defensive here rather than load-bearing — and it
 * is applied anyway, because "this one is safe by accident of where the segment
 * sits" is a property the next leaf would silently not have.
 */
export interface ArtifactBytesRoute {
  /** Opaque to this module, exactly as the two `agent_id`s above are. */
  readonly artifact_id: string;
  /**
   * The only leaf, spelled as a literal for `AgentCommandRoute.leaf`'s reason.
   *
   * It is deliberately not a shared discriminant with the two routes above:
   * `pathOf` switches on it, so a leaf added to either family is a compile error
   * in that switch rather than a path quietly built from a name.
   */
  readonly leaf: "download";
}

/** Everything any channel in this module can be asked for. */
export type RunnerRoute =
  | EvidenceRoute
  | BrokerRoute
  | AgentCommandRoute
  | AgentStateRoute
  | ArtifactBytesRoute;

/**
 * The path a route names, built in one place.
 *
 * Exported so a test can assert what a hostile `agent_id` turns into, rather
 * than asserting it about a private function by reaching through the module.
 */
export function pathOf(route: RunnerRoute): string {
  if (typeof route === "string") {
    return route;
  }
  // Exhaustive over the leaf union, so a fourth member is a compile error here
  // rather than a path silently built from a name.
  switch (route.leaf) {
    // `state` is a discriminant and not a segment — see `AgentStateRoute`.
    case "state":
      return `/agents/${encodeURIComponent(route.agent_id)}`;
    case "commands":
      return `/agents/${encodeURIComponent(route.agent_id)}/commands`;
    case "download":
      return `/artifacts/${encodeURIComponent(route.artifact_id)}/download`;
  }
}

/**
 * Whether a run route addresses an agent at all.
 *
 * `encodeURIComponent` puts any `agent_id` in one segment, which is what stops
 * it spelling a second route — but it leaves `.` and `..` **untouched**, because
 * dots are unreserved. `/agents/../commands` is then normalised by every URL
 * parser between here and the socket into `/commands`, and the segment this
 * module thought it had written is gone.
 *
 * For a command route nothing reachable lives there — `/commands` is not a route
 * a runner serves — so that case was a guard against a shape rather than a
 * disclosed hole. **`AgentStateRoute` makes it a real one** (MAR-602): its path
 * ends at the agent, so an `agent_id` of `..` normalises to `/agents`, which is
 * a route, is in `EVIDENCE_ROUTES`, and answers the whole list. Nothing about
 * that is a privilege escalation — the same channel may ask for `/agents`
 * directly — but a caller that asked for one agent and silently received every
 * agent is a caller whose next line is wrong about what it is holding.
 *
 * So the guard is load-bearing now rather than defensive, and it is written down
 * because the reasoning "the encoder handles it" is *almost* true, and an
 * almost-true guard is the kind somebody later simplifies away.
 */
export function addressesAnAgent(route: AgentCommandRoute | AgentStateRoute): boolean {
  return namesOneSegment(route.agent_id);
}

/**
 * The same question for an artifact id (MAR-611).
 *
 * Its own exported function rather than a widened `addressesAnAgent`, because
 * the two are asking about different fields and a single function taking a union
 * would have to reach for whichever key happened to be present — which is the
 * narrowing-by-absent-key shape `AgentStateRoute.leaf` exists to avoid.
 */
export function addressesAnArtifact(route: ArtifactBytesRoute): boolean {
  return namesOneSegment(route.artifact_id);
}

/**
 * Whether a value survives being put in a path segment as itself.
 *
 * `encodeURIComponent` confines any string to one segment, but leaves `.` and
 * `..` alone because dots are unreserved — and those two are the segments every
 * URL parser between here and the socket removes. See `addressesAnAgent` for
 * what that costs on a route whose path ends at the variable part.
 */
function namesOneSegment(value: string): boolean {
  const segment = encodeURIComponent(value);
  return segment.length > 0 && segment !== "." && segment !== "..";
}

/* ---------------------------------------------------------------------- *
 * The channel
 * ---------------------------------------------------------------------- */

/**
 * One runner, and the routes it may be asked for.
 *
 * `call` takes a **route** rather than a URL. Callers used to build
 * `${runner.origin}/telemetry/drain` by concatenation, which types cannot see
 * into — a string is a string, and `${origin}/broker/drain` would have compiled
 * anywhere. A route parameter is what makes the capability checkable at all.
 */
export interface RunnerChannel<Route extends RunnerRoute> {
  /** For diagnostics only. The bytes go wherever `call` sends them. */
  readonly origin: string;
  /** Bearer credential. Never logged, never placed in a URL. */
  readonly token: string;
  readonly call: (route: Route, init?: RequestInit) => Promise<Response>;
}

/**
 * A runner on another machine. Evidence, a run request, and nothing else.
 *
 * There is no `BrokerRoute` in its parameter, so `channel.call("/broker/drain")`
 * is a compile error at the call site and passing one where a broker-capable
 * channel is required is a compile error at the boundary.
 *
 * `AgentCommandRoute` joined it in MAR-602 and the direction of the change
 * matters: it was added to **both** channels, so `LocalRunnerChannel` stays
 * assignable here. Adding it to the remote one alone would have quietly broken
 * that — parameters are contravariant, so a local channel that could not accept
 * a run request would stop satisfying this type — and `lib/agent-dom/evidence.ts`
 * would have lost the one-implementation-serves-both property this module's
 * header calls the useful direction.
 *
 * `AgentStateRoute` joined on the same terms in the same issue, and the rule it
 * demonstrates is worth stating once for whoever adds the next one: **a route is
 * added to both channels or to neither.** There is no such thing as a route the
 * remote channel carries and the local one does not.
 *
 * `ArtifactBytesRoute` joined in MAR-611 under that rule — added to both, so the
 * local channel stays assignable here and `lib/agent-dom/artifact-bytes.ts` is
 * one implementation serving a runner on either machine.
 */
export type RemoteRunnerChannel = RunnerChannel<
  EvidenceRoute | AgentCommandRoute | AgentStateRoute | ArtifactBytesRoute
>;

/**
 * The runner this machine spawned, reached down its own socket or pipe.
 *
 * The brand is phantom — no such property exists at runtime — and it is not
 * exported, so **no other module can name it and therefore no other module can
 * produce this type without a deliberate cast.** `localRunnerChannel` below is
 * the only constructor, it dials with `ipcFetch`, and `ipcFetch` cannot leave
 * the machine.
 */
declare const BROKER_CAPABLE: unique symbol;

export interface LocalRunnerChannel
  extends RunnerChannel<
    EvidenceRoute | AgentCommandRoute | AgentStateRoute | ArtifactBytesRoute | BrokerRoute
  > {
  readonly [BROKER_CAPABLE]: true;
}

/** What `electron/runner-process.ts`'s `RunnerHandle` already is, narrowed to what is needed. */
export interface LocalRunnerEndpoint {
  origin: string;
  token: string;
  /** The Unix socket path or Windows pipe name. Not a host, and not resolvable. */
  endpoint: string;
}

/**
 * Build the channel to the local runner.
 *
 * The single cast in this module, and it is the brand rather than the
 * behaviour: the returned object genuinely has `origin`, `token` and `call`,
 * and genuinely does not have a symbol nobody reads. Casting here is what makes
 * the type nominal — it is the one door, and it takes an OS-local endpoint.
 */
export function localRunnerChannel(runner: LocalRunnerEndpoint): LocalRunnerChannel {
  const dial = ipcFetch(runner.endpoint);
  return {
    origin: runner.origin,
    token: runner.token,
    call: (route, init) => dial(`${runner.origin}${pathOf(route)}`, withBearer(init, runner.token)),
  } as LocalRunnerChannel;
}

/**
 * Build a channel to a runner on a host, over a dialer somebody else supplied.
 *
 * The dialer is injected rather than constructed here for the reason
 * `TransportOptions.fetch` is injected in `lib/agent-dom/transport.ts`: this
 * module must stay testable without spawning `ssh`, and — more to the point —
 * *which* transport reaches the host is ADR 0007's decision and not this
 * module's. What this module owns is the capability, and that is the same
 * whether the bytes travel over `ssh` or over something later.
 *
 * The runtime refusal is belt and braces behind the type. A cast, an `any`, or
 * a JavaScript caller with no types at all still cannot reach a broker route
 * through this channel, and the throw names the rule rather than the route so
 * the message is the same one ADR 0006 would give.
 */
export function remoteRunnerChannel(options: {
  origin?: string;
  token: string;
  dial: typeof globalThis.fetch;
}): RemoteRunnerChannel {
  const origin = options.origin ?? IPC_ORIGIN;
  const permitted = new Set<string>(EVIDENCE_ROUTES);
  return {
    origin,
    token: options.token,
    call: (route, init) => {
      /*
       * Two shapes, checked separately rather than by falling through to
       * `pathOf` and matching the result.
       *
       * A check against the built path would be a check against a string, and
       * this module's whole argument is that a string is the thing types cannot
       * see into — a runtime guard written that way would be one clever
       * `agent_id` away from being wrong, in a function whose reason to exist is
       * to be right when the types have been cast away.
       *
       * MAR-602 widened this to exactly two new shapes — a run request and a
       * read of the snapshot that run request has to name a target from — and
       * MAR-611 to a third, the bytes of one output the host's own index named.
       * A leaf outside those three cannot be spelled by a typed caller and is
       * refused here for the one that was not.
       *
       * The leaf is checked against the set by value rather than by asking
       * whether it is "not undefined", so a cast carrying `{agent_id, leaf:
       * "lifecycle"}` is refused by this function and not only by the compiler
       * that a cast has already been used to get past. Each leaf is paired with
       * *its own* segment guard rather than with whichever id the object happens
       * to carry — a cast could supply both keys, and a guard that read the wrong
       * one would be checking a field the path never uses.
       */
      const named =
        typeof route === "string"
          ? permitted.has(route)
          : route.leaf === "download"
            ? addressesAnArtifact(route)
            : (route.leaf === "commands" || route.leaf === "state") && addressesAnAgent(route);
      if (!named) {
        return Promise.reject(new RemoteRouteRefused(pathOf(route)));
      }
      return options.dial(`${origin}${pathOf(route)}`, withBearer(init, options.token));
    },
  };
}

/**
 * A route a channel off this machine was asked for and does not carry.
 *
 * Its own class rather than a bare `Error` so a caller can tell this apart from
 * a transport failure. They mean opposite things: a transport failure is a host
 * that could not be reached, and this is a host DASH refused to ask.
 */
export class RemoteRouteRefused extends Error {
  readonly route: string;
  constructor(route: string) {
    super(
      `A runner on another machine is never asked for ${route}. The brokered-credential ` +
        `routes stay on the computer DASH is installed on.`,
    );
    this.name = "RemoteRouteRefused";
    this.route = route;
  }
}

/**
 * Attach the channel credential without letting a caller drop it.
 *
 * Every route on both channels is authenticated except `/health`, and sending
 * the header there costs nothing. Doing it here rather than at each call site
 * is the same argument `lib/agent-dom/transport.ts` makes for its single
 * `request` function: the properties worth having should be properties of the
 * transport rather than things each caller remembered.
 */
function withBearer(init: RequestInit | undefined, token: string): RequestInit {
  return {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
  };
}
