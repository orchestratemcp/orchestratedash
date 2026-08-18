/**
 * The decisions half of the fleet's memory (MAR-673, ADR 0024).
 *
 * ## The one sentence this module exists to make true
 *
 * *A decision is filed where it is made, and activity is never filed at all.*
 *
 * A decision is a committed change to standing state — what may the fleet do,
 * or with what — plus one non-standing entry, a person's approval of an
 * irreversible command. It is filed by the write-site that committed the
 * change, in the same transaction, which is what makes the log complete for
 * the kinds it covers: a memory assembled by observation can miss; a memory
 * written by the hand that made the change cannot, for exactly the kinds and
 * write-sites the closed list below names.
 *
 * ## Pure
 *
 * No store, no clock, no React. Filing and reading live in
 * `lib/fleet/decisions-store.ts`; what lives here is what can be driven by
 * tests with no database — the closed kind list, the chain arithmetic
 * (supersession and drift, ADR 0024 decision 3), and the declared-manifest
 * diff that turns a re-import into decision drafts.
 *
 * ## What is deliberately absent
 *
 * No function here composes a *reason*. The reason is the person's own words
 * or a dash-rule's name, written by the write-site (ADR 0024 decision 2), and
 * a helper that phrased one would be the exact speculation surface the ADR
 * exists to refuse. Absence renders as "no reason was recorded" — see
 * `lib/copy/decisions.ts` — because that is the true sentence.
 */

/* ---------------------------------------------------------------------- *
 * The closed list
 * ---------------------------------------------------------------------- */

/**
 * Read this array as the answer to "what can appear in my decisions log?".
 * It is the complete answer.
 *
 * `WRITE_PATHS` and `SPEND_PATHS`' terms: short enough to read in ten
 * seconds, frozen by value in `tests/fleet-decisions.test.ts`, and every
 * entry names the write-site that files it. A kind that is not here cannot be
 * filed, so the log cannot quietly widen into the event stream it exists not
 * to be (ADR 0024 decision 1).
 *
 * What is deliberately not listed, and where it lives instead: run outcomes,
 * artifact arrivals, telemetry, refusals and lapses are *activity* — `runs`,
 * `events`, `run_artifacts`, `command_audit`, `broker_audit` are already
 * DASH's account of them, and the memory reads those tables fresh rather than
 * keeping a copy. Step-level overrides, deploy targets and notification
 * routes are standing state this list does not cover yet; adding one is a
 * visible edit here plus a filing call at its write-site, which is the shape
 * ADR 0024 wants that extension to take.
 */
export const DECISION_KINDS = [
  /** An agent joined the fleet. Filed by `saveAgent`'s insert arm. */
  "agent_added",
  /** An agent was removed. Filed by `forgetAgent`. */
  "agent_removed",
  /**
   * A re-import changed which connections the manifest declares. One row per
   * connection that appeared or went, topic = the connection id — which is
   * what makes "why did the scout stop covering Reddit?" a chain lookup
   * rather than a text search. Filed by `saveAgent`'s replace arm.
   */
  "declared_connection",
  /**
   * A re-import changed the planned route. One row per component that
   * appeared or went, topic = the component id. Filed beside
   * `declared_connection`.
   */
  "declared_route",
  /** A model pinned to an agent, or the pin cleared. Filed by `lib/ai/model-store.ts`. */
  "agent_model",
  /** DASH's fleet-wide default model set or cleared. Subject is the fleet. */
  "fleet_model_default",
  /**
   * What one level means, set or cleared (MAR-654, ADR 0011 amendment 1).
   *
   * Subject is the fleet; topic is `{provider}/{level}`, which is that table's
   * own primary key — so a chain lookup answers "what have my Balanced steps
   * been on?" for one provider rather than mixing three levels into one
   * history. A separate kind from `fleet_model_default` because the two are
   * separate standing states: `applyFleetDefault` reads the default only where
   * a level row is absent, and a view resolving one against the other's current
   * value would report a setting nobody made.
   */
  "fleet_level_model",
  /** An agent's own connection granted or revoked. Filed by `lib/broker/store.ts`. */
  "connection_grant",
  /** A fleet connection made or disconnected. Subject is the provider. */
  "fleet_connection",
  /** One agent granted or withheld from a fleet connection. Filed by `lib/fleet/store.ts`. */
  "fleet_grant",
  /**
   * A person approved a command marked irreversible. The one entry that is
   * not a standing change (ADR 0024 decision 1 names why it earns the place:
   * "who let this happen" is the question a memory exists to answer about a
   * single afternoon). Filed by `lib/agent-dom/runner.ts`' single exit, only
   * for `decision: "allowed"`, a principal of type `"user"`, and
   * `irreversible: true`.
   */
  "irreversible_approval",
  /**
   * A standing answer to one of an agent's runtime questions, set or cleared
   * (MAR-681). Filed by `lib/agent-dom/standing-answers.ts`. Topic is the
   * question's own key, `chainKeyOf`'s reason exactly: "what has this agent's
   * 'which competitor' question been answered?" is a chain lookup rather than a
   * search through every decision this agent has ever produced.
   */
  "standing_answer",
] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];

export function isDecisionKind(value: unknown): value is DecisionKind {
  return typeof value === "string" && (DECISION_KINDS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------- *
 * One decision
 * ---------------------------------------------------------------------- */

/** What the decision is about. `subject_id` is null exactly for the fleet. */
export type DecisionSubjectKind = "agent" | "connection" | "fleet";

/**
 * Who committed the change. Never asserted by a request — decided by which
 * write-site filed, `origin`'s discipline from ADR 0012 decision 2.
 */
export type DecisionAuthor = "person" | "dash-rule";

/** What a write-site hands to `fileDecision`. */
export interface DecisionDraft {
  decided_at: string;
  subject_kind: DecisionSubjectKind;
  subject_id: string | null;
  kind: DecisionKind;
  /** The chain key within the kind. Empty when the kind needs none. */
  topic: string;
  /** DASH's own sentence of what changed. Frozen phrasing — see the schema note. */
  summary: string;
  /** The resulting standing state, as a JSON-serialisable value. Frozen. */
  outcome: Record<string, unknown>;
  decided_by: DecisionAuthor;
  /** The rule's name when `decided_by` is `dash-rule`, null otherwise. */
  rule: string | null;
  /** The person's own words, verbatim, or null. Never composed by DASH. */
  reason: string | null;
  /** Record references this row was filed from. References, never prose. */
  receipts: readonly string[];
}

/** One stored decision, read back. */
export interface DecisionRecord extends Omit<DecisionDraft, "outcome"> {
  id: number;
  outcome: Record<string, unknown>;
  /** Set only when the reason arrived after the decision. */
  reason_added_at: string | null;
}

/**
 * The chain key. Two rows with the same key describe the same setting, and
 * the newer one supersedes (ADR 0024 decision 3).
 *
 * A joined string rather than a tuple so it can key a `Map`; the unit
 * separator cannot appear in an agent id, a provider, a connection id or a
 * kind, so two distinct chains cannot collide into one string.
 */
export function chainKeyOf(
  row: Pick<DecisionRecord, "subject_kind" | "subject_id" | "kind" | "topic">,
): string {
  return [row.subject_kind, row.subject_id ?? "", row.kind, row.topic].join("\u001f");
}

/* ---------------------------------------------------------------------- *
 * Supersession and drift, computed rather than stored
 * ---------------------------------------------------------------------- */

/**
 * One decision as a surface or a briefing renders it: the row, plus the two
 * computed announcements ADR 0024 decision 3 requires of a stale one.
 *
 * `superseded_by` names the successor so "we decided X" can never be
 * presented bare when X was reversed — every rendering carries *later
 * changed, on date*. `drifted` marks the other failure: the fleet no longer
 * matches this decision and no decision says why, which is both the honest
 * answer and the log auditing its own write-sites.
 */
export interface MarkedDecision {
  decision: DecisionRecord;
  /** The newer row on the same chain, or null for the chain's head. */
  superseded_by: DecisionRecord | null;
  /**
   * True when this is the chain's head, the current standing state is known,
   * and it no longer matches the frozen outcome. Never true for a superseded
   * row — its successor is the explanation.
   */
  drifted: boolean;
}

/**
 * What the same standing state is *now*, keyed by `chainKeyOf`.
 *
 * Absent means the reader could not or did not compute one, and absent never
 * marks a row — `fleetChangedSince`'s posture: the weaker claim is the right
 * default, and a drift marker that fired on "I did not look" would teach
 * people to ignore it.
 */
export type CurrentOutcomes = ReadonlyMap<string, Record<string, unknown>>;

/**
 * Every decision, marked. Rows arrive in id order (the store's order) and
 * come back newest first, which is how the surface draws them.
 *
 * Supersession is computed here and nowhere else, from ordering alone —
 * there is no flag to get out of step with the rows. Drift compares the
 * chain head's frozen outcome with the current state, field for field via
 * JSON identity: `outcome` is written and read through JSON.stringify on the
 * same shape, so key order is stable and a byte difference is a value
 * difference.
 */
export function markDecisions(
  rows: readonly DecisionRecord[],
  now: CurrentOutcomes,
): MarkedDecision[] {
  const heads = new Map<string, DecisionRecord>();
  for (const row of rows) {
    heads.set(chainKeyOf(row), row); // id order: the last write per chain wins.
  }

  const marked: MarkedDecision[] = rows.map((row) => {
    const key = chainKeyOf(row);
    const head = heads.get(key);
    const isHead = head !== undefined && head.id === row.id;
    const current = now.get(key);
    return {
      decision: row,
      superseded_by: isHead ? null : (head ?? null),
      drifted:
        isHead &&
        current !== undefined &&
        JSON.stringify(current) !== JSON.stringify(row.outcome),
    };
  });
  return marked.reverse();
}

/* ---------------------------------------------------------------------- *
 * The declared diff
 * ---------------------------------------------------------------------- */

/**
 * What a re-import changed about an agent's declarations, as the decision
 * drafts it should file — one per connection and one per route component
 * that appeared or went, so each has its own chain and "why did this source
 * go" stays a lookup.
 *
 * Computed from the two documents the write-site holds at the only moment
 * both exist: `agents` keeps the latest manifest alone, so the delta frozen
 * into `outcome` here is recorded nowhere else the moment after (ADR 0024's
 * cost section names this copy as deliberate).
 *
 * Parsed defensively even though DASH validated both documents on the way
 * in: this also runs against the stored copy, which survives upgrades, and
 * an unreadable side yields no drafts rather than a throw — a diff DASH
 * cannot compute must not take an import down with it. The summaries are
 * `lib/copy/decisions.ts`' sentences, so the frozen phrasing and the
 * surface's phrasing start identical.
 */
export function declarationDiff(
  agent: string,
  previousManifestJson: string,
  nextManifestJson: string,
  at: string,
  summarise: {
    connection: (connectionId: string, state: "declared" | "dropped") => string;
    route: (componentId: string, state: "declared" | "dropped") => string;
  },
): DecisionDraft[] {
  const previous = declaredIn(previousManifestJson);
  const next = declaredIn(nextManifestJson);
  if (previous === null || next === null) {
    return [];
  }

  const drafts: DecisionDraft[] = [];
  const receipt = `agents.imported_at ${at}`;

  for (const id of next.connections) {
    if (!previous.connections.has(id)) {
      drafts.push(
        declarationDraft(agent, at, "declared_connection", id, {
          summary: summarise.connection(id, "declared"),
          outcome: { state: "declared", connection: id },
          receipt,
        }),
      );
    }
  }
  for (const id of previous.connections) {
    if (!next.connections.has(id)) {
      drafts.push(
        declarationDraft(agent, at, "declared_connection", id, {
          summary: summarise.connection(id, "dropped"),
          outcome: { state: "dropped", connection: id },
          receipt,
        }),
      );
    }
  }
  for (const id of next.route) {
    if (!previous.route.has(id)) {
      drafts.push(
        declarationDraft(agent, at, "declared_route", id, {
          summary: summarise.route(id, "declared"),
          outcome: { state: "declared", component: id },
          receipt,
        }),
      );
    }
  }
  for (const id of previous.route) {
    if (!next.route.has(id)) {
      drafts.push(
        declarationDraft(agent, at, "declared_route", id, {
          summary: summarise.route(id, "dropped"),
          outcome: { state: "dropped", component: id },
          receipt,
        }),
      );
    }
  }
  return drafts;
}

function declarationDraft(
  agent: string,
  at: string,
  kind: Extract<DecisionKind, "declared_connection" | "declared_route">,
  topic: string,
  parts: { summary: string; outcome: Record<string, unknown>; receipt: string },
): DecisionDraft {
  return {
    decided_at: at,
    subject_kind: "agent",
    subject_id: agent,
    kind,
    topic,
    summary: parts.summary,
    outcome: parts.outcome,
    // A re-import is a person's act: somebody chose to replace the document.
    // The *author* wrote the manifest, but the author is not deciding what
    // this fleet runs — the person importing it is.
    decided_by: "person",
    rule: null,
    reason: null,
    receipts: [parts.receipt],
  };
}

/**
 * What one manifest declares, or null for a document this build cannot read.
 *
 * Ids only, and deliberately not the author's labels: the frozen `outcome` is
 * what the drift marker compares against the same declaration now, and a
 * label the author reworded is not a change to *what is declared* — it would
 * fire the marker on a rename. The id is also what the summary sentence
 * carries, as a labelled value.
 *
 * Exported for `lib/views/decisions.ts`, whose drift reader must ask "what
 * is declared *now*" with exactly the eyes the diff used — a second parser
 * would be a second opinion about what counts as declared.
 */
export function declaredIn(
  manifestJson: string,
): { connections: Set<string>; route: Set<string> } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const manifest = parsed as Record<string, unknown>;

  const connections = new Set<string>();
  const agentDom = manifest["agent_dom"];
  if (typeof agentDom === "object" && agentDom !== null) {
    const declared = (agentDom as Record<string, unknown>)["connections"];
    if (Array.isArray(declared)) {
      for (const entry of declared) {
        if (typeof entry !== "object" || entry === null) {
          continue;
        }
        const id = (entry as Record<string, unknown>)["id"];
        if (typeof id === "string" && id.length > 0) {
          connections.add(id);
        }
      }
    }
  }

  const route = new Set<string>();
  const planned = manifest["planned_route"];
  if (Array.isArray(planned)) {
    for (const entry of planned) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const componentId = (entry as Record<string, unknown>)["component_id"];
      if (typeof componentId === "string" && componentId.length > 0) {
        route.add(componentId);
      }
    }
  }

  return { connections, route };
}
