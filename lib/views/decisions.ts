/**
 * The decisions log as the fleet page draws it (MAR-673, ADR 0024).
 *
 * The join between the pure chain arithmetic in `lib/fleet/decisions.ts` and
 * the store: this module reads the log, asks each standing what it is *now*,
 * and hands the page rows that are strings all the way down — ADR 0023's
 * briefing rule, applied ahead of the chief's memory briefing (the next
 * slice) so that when the briefing arrives, every field on it is already a
 * string DASH renders on this surface.
 *
 * ## The current-outcome readers ask with the writer's eyes
 *
 * Drift (ADR 0024 decision 3) is a JSON comparison between the frozen
 * `outcome` and the same standing now, so each reader here must produce
 * exactly the shape its write-site froze — same fields, same order. That
 * pairing is pinned by `tests/fleet-decisions.test.ts` per kind; a reader
 * that drifted from its writer would report every decision as stale, which
 * is the marker crying wolf.
 *
 * ## When DASH does not look, it does not mark
 *
 * A subject that is gone (a removed agent) gets no current outcome: its
 * `agent_removed` row tells that story, and a drift marker beside every old
 * decision about a removed agent would drown the one marker that matters.
 * `markDecisions` treats an absent entry as "did not look", which is the
 * weaker claim and the right default.
 */

import { hasReceipt } from "../broker/store";
import { plainDay } from "../copy/when";
import {
  chainKeyOf,
  declaredIn,
  markDecisions,
  type CurrentOutcomes,
  type DecisionRecord,
} from "../fleet/decisions";
import { readDecisions } from "../fleet/decisions-store";
import { readFleetConnection, readFleetGrants } from "../fleet/store";
import { readStandingAnswer } from "../agent-dom/standing-answers";
import {
  readAgentModelChoice,
  readFleetLevelModels,
  readFleetModelDefault,
} from "../ai/model-store";
import type { DefaultModelLevel } from "../ai/model-levels";
import type { StoreShape } from "../store";
import type { AgentRow, FleetDecisionsView } from "./types";

/**
 * How many decisions the fleet page draws.
 *
 * `CHIEF_HISTORY_LIMIT`'s kind of number: a read limit, not a retention rule
 * — nothing is deleted by this, and the log itself is append-only. The
 * `total` beside the rows is what keeps the cut honest on the surface.
 */
export const DECISIONS_PAGE_LIMIT = 30;

export function decisionsView(store: StoreShape, agents: readonly AgentRow[]): FleetDecisionsView {
  const rows = readDecisions();
  const marked = markDecisions(rows, currentOutcomes(store, rows));
  const titles = new Map(agents.map((agent) => [agent.name, agent.title]));

  return {
    total: marked.length,
    rows: marked.slice(0, DECISIONS_PAGE_LIMIT).map((one) => ({
      id: one.decision.id,
      when: plainDay(one.decision.decided_at),
      subject: subjectLabel(one.decision, titles),
      summary: one.decision.summary,
      decided_by: one.decision.decided_by,
      rule: one.decision.rule,
      reason: one.decision.reason,
      reason_added_on:
        one.decision.reason_added_at === null ? null : plainDay(one.decision.reason_added_at),
      superseded_on:
        one.superseded_by === null ? null : plainDay(one.superseded_by.decided_at),
      drifted: one.drifted,
      receipts: [...one.decision.receipts],
    })),
  };
}

/** The fleet as a subject, worded once. Everything else is a name DASH holds. */
const FLEET_SUBJECT = "Your fleet";

function subjectLabel(decision: DecisionRecord, titles: ReadonlyMap<string, string>): string {
  if (decision.subject_kind === "fleet" || decision.subject_id === null) {
    return FLEET_SUBJECT;
  }
  if (decision.subject_kind === "agent") {
    return titles.get(decision.subject_id) ?? decision.subject_id;
  }
  return decision.subject_id;
}

/* ---------------------------------------------------------------------- *
 * What each standing is now
 * ---------------------------------------------------------------------- */

function currentOutcomes(store: StoreShape, rows: readonly DecisionRecord[]): CurrentOutcomes {
  const map = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = chainKeyOf(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const outcome = currentOutcomeFor(store, row);
    if (outcome !== null) {
      map.set(key, outcome);
    }
  }
  return map;
}

/**
 * The standing this chain describes, as it is now — in exactly the shape the
 * write-site froze — or null when there is nothing honest to compare.
 *
 * Null for the three act kinds (an approval, an addition and a removal are
 * things that happened, not settings that can drift), for a subject DASH no
 * longer knows, and for a fleet-grant chain whose row is gone: "never
 * decided" is `fleet_grants`' own third state and no frozen outcome spells
 * it, so comparing would mark rows over a distinction the table cannot hold.
 */
function currentOutcomeFor(
  store: StoreShape,
  row: DecisionRecord,
): Record<string, unknown> | null {
  const agentAlive = (name: string | null): name is string =>
    name !== null && store.agents[name] !== undefined;

  switch (row.kind) {
    case "agent_added":
    case "agent_removed":
    case "irreversible_approval":
      return null;
    case "agent_model": {
      if (!agentAlive(row.subject_id)) {
        return null;
      }
      const choice = readAgentModelChoice(row.subject_id);
      return choice.kind === "one_model"
        ? { state: "pinned", provider_id: choice.provider_id, model_id: choice.model_id }
        : { state: "match_each_step" };
    }
    case "fleet_model_default": {
      const current = readFleetModelDefault();
      return current === null
        ? { state: "cleared" }
        : { state: "set", provider_id: current.provider_id, model_id: current.model_id };
    }
    case "fleet_level_model": {
      /*
       * MAR-654. The topic is `{provider}/{level}`, which is `fleet_level_models`'
       * own primary key — so one chain is one level of one provider and the
       * comparison below is against the row that decision actually wrote. Split
       * at the last separator rather than the first: neither an `AI_PROVIDER_IDS`
       * member nor a `DEFAULT_MODEL_LEVELS` member contains one, so either works
       * today, and the last is the one that stays right if a provider id ever
       * does.
       */
      const cut = row.topic.lastIndexOf("/");
      if (cut < 0) {
        return null;
      }
      const providerId = row.topic.slice(0, cut);
      const level = row.topic.slice(cut + 1);
      const current = readFleetLevelModels(providerId).get(level as DefaultModelLevel) ?? null;
      return current === null
        ? { state: "cleared" }
        : { state: "set", provider_id: current.provider_id, model_id: current.model_id };
    }
    case "connection_grant": {
      if (!agentAlive(row.subject_id)) {
        return null;
      }
      return hasReceipt(row.subject_id, row.topic)
        ? { state: "granted", connection: row.topic }
        : { state: "revoked", connection: row.topic };
    }
    case "fleet_connection": {
      if (row.subject_id === null) {
        return null;
      }
      return readFleetConnection(row.subject_id) === null
        ? { state: "disconnected", provider: row.subject_id }
        : { state: "connected", provider: row.subject_id };
    }
    case "fleet_grant": {
      if (!agentAlive(row.subject_id)) {
        return null;
      }
      const grant = readFleetGrants(row.topic).find((one) => one.agent === row.subject_id);
      return grant === undefined ? null : { state: grant.standing, provider: row.topic };
    }
    case "declared_connection":
    case "declared_route": {
      if (!agentAlive(row.subject_id)) {
        return null;
      }
      const manifest = store.agents[row.subject_id]?.manifest;
      if (manifest === undefined) {
        return null;
      }
      const declared = declaredIn(JSON.stringify(manifest));
      if (declared === null) {
        return null;
      }
      if (row.kind === "declared_connection") {
        return declared.connections.has(row.topic)
          ? { state: "declared", connection: row.topic }
          : { state: "dropped", connection: row.topic };
      }
      return declared.route.has(row.topic)
        ? { state: "declared", component: row.topic }
        : { state: "dropped", component: row.topic };
    }
    case "standing_answer": {
      // MAR-681. Topic is the question's own key — `standing_answers`' primary
      // key alongside the agent — so the comparison is against the exact row
      // that decision actually wrote, `fleet_level_model`'s shape above.
      if (!agentAlive(row.subject_id)) {
        return null;
      }
      const current = readStandingAnswer(row.subject_id, row.topic);
      return current === null
        ? { state: "cleared" }
        : {
            state: "set",
            question_label: current.question_label,
            option_id: current.option_id,
            option_label: current.option_label,
          };
    }
  }
}
