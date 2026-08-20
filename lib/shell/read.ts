/**
 * The read-only channel, beside the audited command channel (MAR-432, DASH-20).
 *
 * A second way data crosses the main/renderer boundary, and the second one
 * only. It exists because DASH's pages became a static export that cannot reach
 * SQLite, and because reads return *documents* — an agents list, a run's events,
 * a connection checklist — which the command channel is deliberately unable to
 * carry.
 *
 * ## Why this is not a widening of `lib/shell/ipc.ts`
 *
 * `CommandResult.data` is `Record<string, string | number | boolean>` by
 * design, and that restriction is load-bearing: it is what makes "no secret
 * crosses this boundary" a property a reviewer can check by reading a type
 * rather than by auditing every command's result. A document-shaped result is
 * exactly where a masked hint, a token or an environment block would hide. So
 * the answer to "reads return documents" is a separate channel with its own
 * rules, not a looser rule on the channel whose whole value is its tightness.
 *
 * ## Why reads do not need the audit trail
 *
 * The audit trail's subject is **effects**. Every field on `CommandAuditRecord`
 * describes something that happened in the world and can be asked about
 * afterwards — `mutates`, and the `irreversible` flag beside it. A read leaves
 * nothing to reconstruct.
 *
 * The stronger argument is that auditing reads would make the audit trail
 * *worse*. A rendering UI reads continuously and the packaged app re-reads agent
 * state every five seconds. A log in which tens of thousands of rows say "the
 * agents list was rendered" and a dozen say "an irreversible action was
 * approved" is a log that has buried the only rows it exists to surface.
 *
 * And the threat auditing reads would notionally answer — a compromised renderer
 * quietly enumerating the store — is not answered by writing the reads down.
 * That renderer already has the window. The defence has to be *what can be read
 * at all*, so it is placed there instead: named methods, an allowlist, no
 * generic invoke, a declared shape per read, and no route from this channel to
 * the vault, to `connection_secrets`, or to anything that is not already on the
 * screen the user is looking at.
 *
 * The residual is named rather than argued away: a compromised renderer can
 * enumerate agents, runs and connection requirements without leaving a trace. It
 * is bounded by all of that being the window's own content, and none of it being
 * a credential.
 *
 * ## Shape
 *
 * Pure, like `ipc.ts`, and for the same two reasons: it is unit-testable without
 * launching Electron, and it must be importable from a sandboxed preload, which
 * can run no Node built-ins and resolve no imports at runtime.
 */

// `import type` throughout, which is what keeps this module importable from a
// sandboxed preload: the declarations are erased at compile time, so nothing
// here resolves an import at runtime. `BrowserView` comes from
// `../views/browser` rather than `../views/types` for that reason and no other —
// that module reaches the store, and a value import of it here would put SQLite
// on the preload's dependency graph.
import type { BrowserView } from "../views/browser";
import type {
  AgentsView,
  ConnectionsView,
  HostsView,
  LabTelemetryView,
  NotificationsView,
  RunView,
  RunsView,
  WorkInboxView,
  WorkspaceView,
} from "../views/types";

/** The single read channel. Separate from `SHELL_COMMAND_CHANNEL` on purpose. */
export const SHELL_READ_CHANNEL = "dash:shell-read";

export interface ReadSpec {
  /**
   * Plain-language description of what this returns. Written for a person
   * auditing the surface — "what can the renderer see?" should be answerable by
   * reading this catalogue and nothing else.
   */
  returns: string;
  /**
   * Parameter names this read accepts. Every value must be a non-empty string,
   * matching the command channel's rule for the same reason: a read that takes
   * an object is a read that can be handed a prototype, a buffer or a blob of
   * somebody else's choosing.
   */
  params: readonly string[];
}

/**
 * Every document the renderer may ask for. Adding an entry is the only way to
 * add a read, and is a deliberate review event.
 *
 * Seven entries, one per page-shaped document. Deliberately not a general "query the store"
 * surface: the catalogue *is* the security argument above, and it only holds
 * while somebody can read it in one sitting and say what the renderer can see.
 */
export const READS = {
  "view.agents": {
    returns: "Every imported agent, where it came from, and how its recent runs behaved.",
    params: [],
  },
  "view.runs": {
    returns: "Every run reconstructed from received events, with its plan-vs-actual verdict.",
    params: [],
  },
  "view.run": {
    returns: "One run's events, its verdict, and the planned steps it did and did not take.",
    params: ["agent", "run_id"],
  },
  "view.connections": {
    returns: "What each imported agent declares it needs to be connected to.",
    params: [],
  },
  "view.inbox": {
    returns: "Pending choices and enforceable approvals across every imported agent.",
    params: [],
  },
  "view.workspace": {
    returns: "One agent's safe live state, capability-driven controls, memory and audit history.",
    params: ["agent"],
  },
  /*
   * MAR-574. The seventh, and the one whose absence was the defect: hosts have
   * been in the store since MAR-536 and no read returned them, so the Servers
   * page could not know a server had ever been saved.
   *
   * What it returns is worth reading against the catalogue's own promise above —
   * "no route from this channel to the vault, to `connection_secrets`, or to
   * anything that is not already on the screen". A host record names a key on
   * this computer, and `hostsView` drops that field rather than the renderer
   * being trusted to ignore it.
   */
  "view.hosts": {
    returns:
      "Every server DASH has saved: what it is called, where it is, which account it signs in as, when it was added and the identity it is pinned to. Never which key it uses.",
    params: [],
  },
  /*
   * MAR-588. The eighth, and the one most worth reading against the catalogue's
   * own promise — "no route from this channel to the vault".
   *
   * What comes back is whether a channel is set up, four masked characters, the
   * date, and two switches. The address itself is in the vault under one name,
   * `notificationsView` never opens it, and there is no field on
   * `NotificationsView` it could be assigned to. So this read cannot become a
   * route to the credential even if somebody later adds a caller that wants one.
   */
  "view.notifications": {
    returns:
      "Whether DASH is set up to post to Discord, when it was set up, and which kinds of message it sends. Never the channel address.",
    params: [],
  },
  /*
   * MAR-479, ADR 0026. The tenth, and the one that has to be readable *before*
   * anybody consents to anything.
   *
   * What comes back is whether DASH is sending, to which address, four masked
   * characters, and two payload bodies: the one DASH would post right now, and
   * every one it has posted. The token is in the vault under one name,
   * `labTelemetryView` never opens it, and there is no field on
   * `LabTelemetryView` it could be assigned to — the closure
   * `view.notifications` keeps over a webhook address, applied to a token.
   *
   * Read against the catalogue's promise: the bodies are safe to hand a renderer
   * for the reason ADR 0026 decision 2 makes them safe to send at all — every
   * field in one is a registry id, an enum, a digest or a date, and no branch of
   * `composeObservation` reads a user-authored string. A read that could return
   * an agent's goal would be a read that had quietly become the thing this whole
   * feature is built not to do.
   */
  "view.labTelemetry": {
    returns:
      "Whether DASH reports its agents' plans to a LAB, which one, exactly what it would send right now, and exactly what it has sent. Never the token.",
    params: [],
  },
  /*
   * MAR-628, ADR 0019. The ninth, and the one whose whole point is that a person
   * can see it: the controlled browser's own record — where DASH let its browser
   * go, where it went, what it decided about each request, and what it refused
   * on the page's behalf.
   *
   * Read against the catalogue's promise above. What comes back is a projection
   * of `browser_sessions`, `browser_actions` and a count from `browser_blocked`,
   * none of which hold a credential — an ephemeral session has no cookie jar to
   * leak and no sign-in to name. The page's *content* never crosses this read
   * either: the text an agent asked for goes to the agent through
   * `lib/browser/protocol.ts` and is not stored, so there is nothing here for a
   * hostile page to write into a DASH surface through.
   *
   * `frame_after` is a file name and never a path, so this read cannot become a
   * way to name a file outside the run's own frame folder.
   */
  "view.browser": {
    returns:
      "One agent's controlled browser: which addresses DASH set it up for, where it went, what DASH decided about each request, and what it refused on the page's behalf.",
    params: ["agent"],
  },
} as const satisfies Record<string, ReadSpec>;

export type ReadName = keyof typeof READS;

export function isReadName(value: unknown): value is ReadName {
  return typeof value === "string" && Object.hasOwn(READS, value);
}

/**
 * What each read answers with.
 *
 * Written as a map rather than inferred, so that a read added to `READS`
 * without a declared result type is a compile error rather than an `unknown`
 * the renderer casts away.
 */
export interface ReadResults {
  "view.agents": AgentsView;
  "view.runs": RunsView;
  "view.run": RunView;
  "view.connections": ConnectionsView;
  "view.inbox": WorkInboxView;
  "view.workspace": WorkspaceView;
  "view.hosts": HostsView;
  "view.notifications": NotificationsView;
  "view.labTelemetry": LabTelemetryView;
  "view.browser": BrowserView;
}

type UntypedRead = Exclude<ReadName, keyof ReadResults>;
const _everyReadHasAResultType: UntypedRead extends never ? true : never = true;
void _everyReadHasAResultType;

/** What the renderer sends. Fully untrusted until reviewed. */
export interface ReadRequest {
  read: string;
  params?: Record<string, unknown>;
}

export type ReadDenialReason =
  | "unknown_read"
  | "malformed_request"
  | "unexpected_param"
  | "missing_param";

export type ReadReview =
  | { decision: "allowed"; read: ReadName; params: Record<string, string> }
  | { decision: "denied"; reason: ReadDenialReason };

/**
 * The gate. Given anything at all from the renderer, decide whether it names a
 * document this surface is willing to produce.
 *
 * No audit record, per the argument in the module header — which is the one
 * structural difference from `reviewCommand`, and is why this is a separate
 * function rather than a parameterised version of that one. Everything else is
 * deliberately the same: allowlist not denylist, declared params only, and a
 * whole-request denial rather than a silent drop of the part we did not
 * understand.
 */
export function reviewRead(request: unknown): ReadReview {
  if (typeof request !== "object" || request === null) {
    return { decision: "denied", reason: "malformed_request" };
  }

  const { read, params } = request as Partial<ReadRequest>;
  if (typeof read !== "string" || read === "") {
    return { decision: "denied", reason: "malformed_request" };
  }
  if (!isReadName(read)) {
    return { decision: "denied", reason: "unknown_read" };
  }
  if (params !== undefined && (typeof params !== "object" || params === null)) {
    return { decision: "denied", reason: "malformed_request" };
  }

  const spec: ReadSpec = READS[read];
  const given = params === undefined ? {} : (params as Record<string, unknown>);
  const narrowed: Record<string, string> = {};

  for (const key of Object.keys(given)) {
    if (!spec.params.includes(key)) {
      return { decision: "denied", reason: "unexpected_param" };
    }
    const value = given[key];
    if (typeof value !== "string" || value === "") {
      // Strings only, and non-empty. An empty string is a present-but-absent
      // argument, and answering it would mean returning the document for an
      // agent nobody named.
      return { decision: "denied", reason: "missing_param" };
    }
    narrowed[key] = value;
  }

  for (const required of spec.params) {
    if (narrowed[required] === undefined) {
      return { decision: "denied", reason: "missing_param" };
    }
  }

  return { decision: "allowed", read, params: narrowed };
}

/**
 * The bridge the preload exposes, described once.
 *
 * Declared here rather than inferred from `electron/preload.ts` because both
 * sides need it and only one of them may import that file: the preload imports
 * `electron`, and a page that reached for its type would be one bundler
 * heuristic away from trying to resolve it. This module is pure and imports
 * nothing at runtime, so a client component can name the shape without pulling
 * anything toward the browser.
 *
 * `electron/preload.ts` satisfies this, which is what keeps the two in step.
 */
export interface DashReadApi {
  agents(): Promise<ReadResponse<ReadResults["view.agents"]>>;
  runs(): Promise<ReadResponse<ReadResults["view.runs"]>>;
  run(agent: string, runId: string): Promise<ReadResponse<ReadResults["view.run"]>>;
  connections(): Promise<ReadResponse<ReadResults["view.connections"]>>;
  inbox(): Promise<ReadResponse<ReadResults["view.inbox"]>>;
  workspace(agent: string): Promise<ReadResponse<ReadResults["view.workspace"]>>;
  /**
   * Optional for the reason the command bridge's host methods are optional: a
   * build of the shell older than MAR-574 exposes a `dashData` without it, and a
   * page that called through would throw where the honest answer is that this
   * window cannot see saved servers. `app/_data/source.ts` checks before calling.
   */
  hosts?(): Promise<ReadResponse<ReadResults["view.hosts"]>>;
  /** Optional for `hosts`'s reason: a shell older than MAR-588 has no such read. */
  notifications?(): Promise<ReadResponse<ReadResults["view.notifications"]>>;
  /** Optional for `hosts`'s reason: a shell older than MAR-479 has no such read. */
  labTelemetry?(): Promise<ReadResponse<ReadResults["view.labTelemetry"]>>;
  /** Optional for `hosts`'s reason: a shell older than MAR-628 has no such read. */
  browser?(agent: string): Promise<ReadResponse<ReadResults["view.browser"]>>;
}

/**
 * What a denied read looks like to the renderer.
 *
 * A read is answered with a document, so a refusal needs a shape the caller can
 * tell apart from one. `ok: false` and a reason code — no detail, no echo of
 * what was asked, nothing a probe could learn from beyond "not that".
 */
export type ReadResponse<T> = { ok: true; data: T } | { ok: false; reason: ReadDenialReason };
