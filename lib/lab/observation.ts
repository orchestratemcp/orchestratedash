/**
 * What DASH may say to a LAB, composed (MAR-479, ADR 0026).
 *
 * Pure, and the purity is the point: every function here turns a manifest DASH
 * already holds into the ten-field payload `orchestratelab`'s
 * `POST /api/insights/ingest` accepts, and none of them reaches a store, a
 * clock or a socket. `lib/lab/send.ts` is the only thing that posts;
 * `electron/lab-telemetry.ts` is the only thing that decides when.
 *
 * ## The one rule this module exists to make true
 *
 * *No character a person typed reaches the wire.*
 *
 * ADR 0026 decision 2. A manifest's `agent.goal` is arbitrary end-user prose
 * and `agent.name` is a slug somebody chose — `competitor-scout` here,
 * `acme-invoice-chaser` on somebody else's machine, and the second one names a
 * customer. Neither is read by anything below. What is read is
 * `planned_route[].component_id` and `agent.plan_source`, which are strings the
 * MCP's registry minted and shipped *to* DASH, plus `agent.playbook_id`, which
 * is a registry id or the empty string.
 *
 * That is a property of the composition rather than a rule a caller has to
 * remember: `composeObservation` takes the whole manifest and there is no branch
 * in it that reads a user-authored field. `tests/lab-observation.test.ts` feeds
 * it a manifest whose goal, name and display name are three distinctive strings
 * and asserts none of them appears anywhere in the payload bytes.
 *
 * ## The four fields DASH cannot honestly fill
 *
 * ADR 0026 decision 3, restated at the code that fills them so the constants
 * cannot drift from the reasoning: `route_score` is `0` meaning *absent* (DASH
 * has never held a route score — it is the registry's number and does not
 * survive into a manifest), `must_have_missing` and `forbidden_present` are
 * empty (DASH has no corpus, so no contract to violate), and `route_changed` is
 * `false` (under a route-derived slug a changed route is a *new slug*, so the
 * fact is expressed by an old slug going quiet rather than by this flag).
 */

import { createHash } from "node:crypto";

import type { AnyAgentManifest } from "../contracts";

/* ---------------------------------------------------------------------- *
 * The wire shape
 * ---------------------------------------------------------------------- */

/**
 * Exactly what LAB accepts: `PlanObservation` (`orchestratelab/lib/insights.ts`)
 * minus its `source`, which LAB fixes to `"dash-telemetry"` on the way in.
 *
 * Snake_case because it is a wire shape rather than a DASH type — this is the
 * object that is `JSON.stringify`d, and the field names are LAB's.
 */
export interface LabObservation {
  /** UTC `yyyy-mm-dd`. See `observationDay` for why UTC and not the local day. */
  observed_on: string;
  /** `dash_route_` + 12 hex. Never derived from anything a person wrote. */
  goal_slug: string;
  /** The component ids joined for reading. Registry vocabulary, not prose. */
  goal_text: string;
  components: string[];
  /** `"playbook"` or `"composed"` — the manifest's own `plan_source`. */
  route_selected: string;
  /** Always `ABSENT_ROUTE_SCORE`. */
  route_score: number;
  /** The manifest's `playbook_id`, which is `""` on a composed route. */
  playbook_candidate: string;
  must_have_missing: string[];
  forbidden_present: string[];
  route_changed: boolean;
}

/**
 * The namespace prefix, and ADR 0026 decision 8's whole mechanism.
 *
 * LAB's `goalsOn()` is first-occurrence-wins per day and `loadInsights()`
 * concatenates `lab-local` first, so a same-day same-slug collision would
 * silently resolve to LAB's own row. That precedence is right; this prefix makes
 * it unreachable, which is better than right — "which source wins" stops being a
 * rule somebody has to remember and becomes a fact about the strings.
 *
 * Deliberately distinct from `dash_demo_`, which `orchestratelab`'s
 * `pnpm seed:dash-telemetry` writes, so a real observation is distinguishable
 * from the synthetic fixture at a glance and by `LIKE`.
 */
export const ROUTE_SLUG_PREFIX = "dash_route_";

/** How much of the digest the slug carries. Long enough not to collide, short enough to read back in a query. */
const SLUG_HEX = 12;

/**
 * `0`, meaning *DASH does not have this number* — not *this route scored zero*.
 *
 * Named rather than inlined because the two readings are opposite and the
 * literal cannot say which one is meant. LAB requires the field and requires it
 * finite, so an absence has to be spelled as a number; ADR 0026 decision 3
 * records the consequence (DASH rows sort to the top of LAB's golden-path-gap
 * list) and the fix, which is a LAB-side lookup from `playbook_candidate`
 * rather than a plausible number invented here.
 */
export const ABSENT_ROUTE_SCORE = 0;

/* ---------------------------------------------------------------------- *
 * Composing one
 * ---------------------------------------------------------------------- */

/**
 * The unit separator, for the same reason `chainKeyOf` uses it: it cannot
 * appear in a component id, so two different routes cannot digest to the same
 * pre-image by concatenation.
 */
const SEP = "\u001f";

/**
 * The slug for one route.
 *
 * Exported so a caller can ask "have I sent this route?" without composing a
 * whole observation, and so the test corpus can assert stability directly.
 */
export function routeSlug(planSource: string, componentIds: readonly string[]): string {
  const digest = createHash("sha256")
    .update([planSource, ...componentIds].join(SEP))
    .digest("hex");
  return `${ROUTE_SLUG_PREFIX}${digest.slice(0, SLUG_HEX)}`;
}

/**
 * The UTC day of an ISO timestamp.
 *
 * UTC rather than the local day because LAB's own window
 * (`loadDashTelemetryObservations`) compares `observed_on` against a UTC day. A
 * local day here would silently shift a late-evening run into LAB's next bucket
 * — the kind of off-by-one that reads as missing data rather than as a bug.
 *
 * Returns null for a timestamp that does not parse, rather than today's date: a
 * store row DASH cannot read the time of is not an observation about today.
 */
export function observationDay(iso: string): string | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 10);
}

/**
 * One manifest and one day, as the payload LAB accepts — or null when the
 * manifest declares no route.
 *
 * Null rather than an observation with an empty `components`, because the slug
 * of an empty route is a digest of the plan source alone: every routeless agent
 * on every install would share one slug, and LAB would rank a golden-path gap
 * that does not exist. An agent with no planned route has nothing to say about
 * Decision 1's question.
 */
export function composeObservation(
  manifest: AnyAgentManifest,
  observedOn: string,
): LabObservation | null {
  const components = [...manifest.planned_route]
    .sort((a, b) => a.step - b.step)
    .map((step) => step.component_id);

  if (components.length === 0) {
    return null;
  }

  const planSource = manifest.agent.plan_source;

  return {
    observed_on: observedOn,
    goal_slug: routeSlug(planSource, components),
    goal_text: components.join(" → "),
    components,
    route_selected: planSource,
    route_score: ABSENT_ROUTE_SCORE,
    playbook_candidate: manifest.agent.playbook_id,
    must_have_missing: [],
    forbidden_present: [],
    route_changed: false,
  };
}

/* ---------------------------------------------------------------------- *
 * A batch
 * ---------------------------------------------------------------------- */

/**
 * The de-duplication key, and the same string `lab_telemetry_sends` stores.
 *
 * ADR 0026 decision 6: an observation is *about a day*, so a second run of the
 * same agent on the same day adds nothing. De-duplication is DASH's rather than
 * LAB's, which is what makes pressing Send now twice post nothing the second
 * time.
 */
export function observationKey(observation: Pick<LabObservation, "goal_slug" | "observed_on">): string {
  return `${observation.goal_slug}${SEP}${observation.observed_on}`;
}

/** The slice of the store this needs, so a test can build one as a literal. */
export interface ObservableStore {
  agents: Record<string, { manifest: AnyAgentManifest }>;
  events: Array<{ agent: string; ts: string }>;
}

/**
 * Every observation this store supports, newest day first, minus the ones
 * already sent.
 *
 * "A day an agent ran" is read off the events rather than off the `runs` table
 * for `listRuns`' own reason — a table that also cached this would be a second
 * source of truth free to disagree with the events it was computed from.
 *
 * An event naming an agent whose manifest was never imported is skipped. DASH
 * has no route for it, and a payload composed from an absent manifest would be
 * a claim about a plan nobody declared.
 */
export function pendingObservations(
  store: ObservableStore,
  alreadySent: ReadonlySet<string>,
): LabObservation[] {
  const byKey = new Map<string, LabObservation>();

  for (const event of store.events) {
    const stored = store.agents[event.agent];
    if (stored === undefined) {
      continue;
    }
    const day = observationDay(event.ts);
    if (day === null) {
      continue;
    }
    const observation = composeObservation(stored.manifest, day);
    if (observation === null) {
      continue;
    }
    const key = observationKey(observation);
    if (alreadySent.has(key) || byKey.has(key)) {
      continue;
    }
    byKey.set(key, observation);
  }

  return [...byKey.values()].sort((a, b) => b.observed_on.localeCompare(a.observed_on));
}

/**
 * The exact bytes DASH posts, and the exact bytes the receipt stores.
 *
 * One function so that the preview a person reads before deciding and the body
 * that actually goes over the socket cannot be composed differently — ADR 0026
 * decision 5's *before* and *after* halves are the same string or the receipt is
 * worthless. Indented, because it is read by a person as often as by LAB.
 */
export function payloadBody(observations: readonly LabObservation[]): string {
  return JSON.stringify(observations, null, 2);
}
