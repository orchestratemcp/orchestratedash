/**
 * The declarative panel's view model (MAR-554, ADR 0008 slice 3).
 *
 * `lib/panel-spec.ts` turns a manifest into a `PanelResolution` — three
 * surfaces, only one of which has sections to iterate. This turns that
 * resolution into the shapes a component draws, over the artifact machinery
 * MAR-434 already built. Nothing new is invented at either end: `report` and
 * `outputs` are `buildArtifactCards` filtered, `table` and `metrics` read the
 * bodies of the same records, and `note` is the author's string carried through.
 *
 * ## `resolvePanel` is the only door, and that is structural here
 *
 * `buildPanelView` takes the **manifest**, not a resolution. A signature that
 * accepted a `PanelResolution` would let a caller build one some other way — and
 * the one thing ADR 0008 asks the renderer never to do is draw part of a panel
 * it does not understand. Taking the manifest means every path into this module
 * goes through `resolvePanel`, so the `newer_version` case arrives here with no
 * sections in it and there is nothing to half-draw.
 *
 * ## Pure, and it has to stay that way
 *
 * No value import from anything that reaches a Node builtin. `RunArtifactRecord`
 * and `RunStatus` come from `lib/store.ts` as **types**, which erase;
 * `tests/client-bundle.test.ts` records at length what happens to the packaged
 * renderer when a module like that is imported for its values instead.
 *
 * That also decides why the DASH facts are a parameter rather than a lookup.
 * `run_count`, `last_run_at` and `last_run_verdict` are each already computed
 * for an existing view, in `lib/views/build.ts`, which reads the store — so this
 * module is handed them the way `buildArtifactCards` is handed its records. It
 * keeps this testable against a fixture rather than against a live store, and it
 * is what lets a panel render for a row-indexed agent with no folder anywhere,
 * which is the whole reason MAR-554 is unblocked by the schema alone.
 *
 * ## Which manifest, now that there are two (MAR-553)
 *
 * The folder store landed while this slice was in flight, so there are now two
 * copies of every author document: `agents/{name}/agent.manifest.json`, which
 * ADR 0008 makes **authoritative**, and the `agents` row's `manifest_json`,
 * which is a projection of it. They can disagree — a folder edited on disk
 * while DASH is running is drift DASH discovers late — and the ADR's rule for
 * that is decided rather than left to a bug report: **the folder wins, and the
 * disagreement is surfaced, never silently repaired.**
 *
 * So a caller wiring this to a page must pass `readAgentFolderManifest`'s
 * document, not the row's. `manifest: unknown` cannot enforce that, and it
 * deliberately does not try: `lib/agent-folders.ts` reaches `node:fs`, and
 * importing it here for its *value* would drag a Node builtin into the renderer
 * bundle — the failure `tests/client-bundle.test.ts` exists for. The rule lives
 * in this paragraph and in the wiring, which is `lib/views/build.ts`'s
 * `workspaceView`, where the store is already read.
 *
 * **The row's copy is a fallback, not an equal.** A row-indexed agent with no
 * folder — every agent that predates MAR-553's migration, and any whose name
 * failed the component guard — still renders its panel from `manifest_json`,
 * which is the standing MAR-553 keeps supported on purpose. That is why this
 * module takes a document rather than an agent name: it renders for both
 * stores, and neither one is named here.
 *
 * ## What "newest" means, and who decides it
 *
 * Every binding resolves against records the caller passes in **newest first**,
 * which is the order `artifactRecordsForRun` returns and the order
 * `buildArtifactCards` deliberately does not re-sort. A run that revised its
 * digest corrected it, and the corrected one belongs at the top; that decision
 * already lives in the query and having a second place decide it is how they
 * come to disagree.
 */

import type { RunArtifact } from "../contracts";
import type { RunArtifactRecord, RunStatus } from "../store";
import { plainMoment } from "../copy/when";
import {
  PANEL_ATTRIBUTION,
  PANEL_COPY,
  PANEL_NEWER_VERSION,
  PANEL_UNREADABLE,
  describeEmptyOutputSection,
  describeEmptyTable,
  describeFactMoment,
  describeOutputsCap,
  describeRowCap,
  describeRunVerdict,
  describeSkippedRows,
  type PanelCard,
  type PanelEmptyState,
} from "../copy/panel";
import {
  resolvePanel,
  type PanelMetricItem,
  type PanelSectionV1,
  type PanelTableColumn,
} from "../panel-spec";
import { buildArtifactCards, type ArtifactCardView } from "./artifacts";

/**
 * The render-side row cap ADR 0008 names.
 *
 * A number rather than a rule, and stated when it bites — see `describeRowCap`.
 * It is the only bound in the panel that is not already a schema bound, and it
 * exists because the schema can cap how many columns an author declares and
 * cannot cap how many rows an agent produces.
 */
export const PANEL_ROW_CAP = 200;

/**
 * The facts DASH observes about an agent, in the closed set `dash_fact` names.
 *
 * `last_run_status` rather than `last_run_verdict`: the manifest's word for the
 * binding is the author's, and the field it reads is DASH's own. Wording them
 * the same would suggest DASH stores a thing called a verdict, which it does
 * not — it stores a run status, and `describeRunVerdict` is what turns one into
 * a sentence.
 */
export interface PanelDashFacts {
  run_count: number;
  last_run_at: string | null;
  last_run_status: RunStatus | null;
}

export interface PanelContext {
  /** This agent's artifacts, newest first. Never another agent's — see below. */
  artifacts: readonly RunArtifactRecord[];
  facts: PanelDashFacts;
}

/* ---------------------------------------------------------------------- *
 * What a component draws
 * ---------------------------------------------------------------------- */

/** One cell. `text` is null exactly when the value was absent or the wrong kind. */
export interface PanelCellView {
  text: string | null;
}

export interface PanelMetricView {
  /** The author's word for it. Never the metric's id. */
  label: string;
  /** Null when there is nothing behind it; the renderer says so rather than blanking. */
  value: string | null;
  /** "The agent’s report" or "DASH’s record" — never merged. */
  attribution: string;
}

interface PanelSectionBaseView {
  /** The author's own label. The section's `id` is deliberately not carried. */
  label: string;
  /**
   * Distinguishes two sections whose labels match, for a React key.
   *
   * The manifest's `id` would do, and is exactly what MAR-507's rule keeps off a
   * surface — so it is not carried at all. A section's position in the declared
   * array is stable for a given manifest and is not a name, which makes it the
   * right key and an impossible thing to render by accident.
   */
  at: number;
}

export interface PanelReportView extends PanelSectionBaseView {
  kind: "report";
  /** The newest artifact of the bound role, or null. */
  card: ArtifactCardView | null;
  empty: PanelEmptyState;
}

export interface PanelOutputsView extends PanelSectionBaseView {
  kind: "outputs";
  cards: ArtifactCardView[];
  /** Stated when the author's own `max_items` hid some. */
  capped: string | null;
  empty: PanelEmptyState;
}

export interface PanelTableView extends PanelSectionBaseView {
  kind: "table";
  columns: PanelTableColumn[];
  /** Row-major, one entry per declared column, in declared order. */
  rows: PanelCellView[][];
  /** Stated when the row cap bit. */
  capped: string | null;
  /** Stated when entries in the list were not rows. */
  skipped: string | null;
  /** Null exactly when `rows` is non-empty. */
  empty: PanelEmptyState | null;
}

export interface PanelMetricsView extends PanelSectionBaseView {
  kind: "metrics";
  items: PanelMetricView[];
}

export interface PanelNoteView extends PanelSectionBaseView {
  kind: "note";
  /** The author's words, with the same standing as the manifest's goal. */
  text: string;
}

/**
 * The closed union a component switches on.
 *
 * Discriminated by `kind` so a sixth component type breaks every `switch` at
 * compile time rather than arriving as a silently unhandled section — the
 * property `PanelSectionV1` already has, carried one layer up so the renderer
 * inherits it rather than re-earning it.
 */
export type PanelSectionView =
  | PanelReportView
  | PanelOutputsView
  | PanelTableView
  | PanelMetricsView
  | PanelNoteView;

/**
 * What the workspace draws for this agent's panel.
 *
 * Four cases, mirroring `PanelResolution`'s four, because they are four
 * different surfaces: nothing at all, a drawn panel, one stated card about a
 * version, and one stated card about damage. Only the second has sections.
 */
export type PanelView =
  /** No panel declared. Renders nothing — never a placeholder, never an empty frame. */
  | { kind: "none" }
  | {
      kind: "declared";
      /** The author's title, or DASH's own when they declared none. */
      title: string;
      sections: PanelSectionView[];
    }
  /** One stated card and nothing else. See `PANEL_NEWER_VERSION`. */
  | { kind: "newer_version"; title: string; card: PanelCard }
  /** One stated card and nothing else. See `PANEL_UNREADABLE`. */
  | { kind: "unreadable"; title: string; card: PanelCard };

/* ---------------------------------------------------------------------- *
 * Building it
 * ---------------------------------------------------------------------- */

/**
 * Read a manifest's panel and bind it to what this agent has produced.
 *
 * The outer `switch` is on the resolution's `kind` and the inner one is on the
 * section's `type`, which is ADR 0008's shape rather than an implementation
 * choice: the version question is settled once, for the whole document, before
 * any section is looked at.
 */
export function buildPanelView(manifest: unknown, context: PanelContext): PanelView {
  const resolution = resolvePanel(manifest);

  switch (resolution.kind) {
    case "none":
      return { kind: "none" };

    case "newer_version":
      /*
       * No sections, and none are reachable: `PanelResolution` does not carry
       * them for this case. That is ADR 0008's "never partially" made
       * structural — there is no array here to iterate, so a later edit cannot
       * accidentally start drawing one.
       */
      return {
        kind: "newer_version",
        title: resolution.title ?? PANEL_COPY.heading,
        card: PANEL_NEWER_VERSION,
      };

    case "unreadable":
      /*
       * The errors are deliberately not rendered. They are technical register —
       * `lib/panel-spec.ts` says so where it defines them — and this is a guided
       * surface; the person reading it needs to know DASH is drawing none of the
       * panel and what to do, not which member of which section failed.
       */
      return { kind: "unreadable", title: PANEL_COPY.heading, card: PANEL_UNREADABLE };

    case "v1":
      return {
        kind: "declared",
        title: resolution.title ?? PANEL_COPY.heading,
        sections: resolution.sections.map((section, at) => buildSection(section, at, context)),
      };
  }
}

function buildSection(
  section: PanelSectionV1,
  at: number,
  context: PanelContext,
): PanelSectionView {
  switch (section.type) {
    case "report": {
      const record = newestOfRole(context.artifacts, section.artifact_role);
      return {
        kind: "report",
        at,
        label: section.label,
        card: record === null ? null : (buildArtifactCards([record])[0] ?? null),
        empty: describeEmptyOutputSection(),
      };
    }

    case "outputs": {
      /*
       * Absent `artifact_role` means every role, which is what the Outputs area
       * already shows — `lib/panel-spec.ts` records that reading where it makes
       * the field optional. The author has placed and scoped the existing panel
       * rather than asked for a new kind of thing.
       */
      const matching =
        section.artifact_role === undefined
          ? [...context.artifacts]
          : context.artifacts.filter(
              (record) => record.artifact.kind === section.artifact_role,
            );
      const limit = section.max_items ?? matching.length;
      const shown = matching.slice(0, limit);
      return {
        kind: "outputs",
        at,
        label: section.label,
        cards: buildArtifactCards(shown),
        capped: describeOutputsCap(shown.length, matching.length),
        empty: describeEmptyOutputSection(),
      };
    }

    case "table":
      return buildTable(section, at, context);

    case "metrics":
      return {
        kind: "metrics",
        at,
        label: section.label,
        items: section.items.map((item) => buildMetric(item, context)),
      };

    case "note":
      return { kind: "note", at, label: section.label, text: section.text };
  }
}

function buildTable(
  section: Extract<PanelSectionV1, { type: "table" }>,
  at: number,
  context: PanelContext,
): PanelTableView {
  const base = {
    kind: "table" as const,
    at,
    label: section.label,
    columns: section.columns,
  };

  const record = newestOfRole(context.artifacts, section.source_role);
  if (record === null) {
    return {
      ...base,
      rows: [],
      capped: null,
      skipped: null,
      empty: describeEmptyTable("no_artifact"),
    };
  }

  const body = tableBodyOf(record.artifact);
  if (body === null) {
    return {
      ...base,
      rows: [],
      capped: null,
      skipped: null,
      empty: describeEmptyTable("not_rows"),
    };
  }

  const readable = body.filter(isRow);
  const skipped = body.length - readable.length;
  const rows = readable
    .slice(0, PANEL_ROW_CAP)
    .map((row) => section.columns.map((column) => cellOf(row, column)));

  return {
    ...base,
    rows,
    capped: describeRowCap(rows.length, readable.length),
    skipped: describeSkippedRows(skipped),
    empty: rows.length === 0 ? describeEmptyTable("no_readable_rows") : null,
  };
}

/**
 * One cell, read as the author declared it and never coerced.
 *
 * ADR 0008: "a value that is not the declared kind renders as absent, never
 * coerced". Coercion is the tempting half — `String(value)` would fill every
 * cell and would turn `null` into "null", an object into "[object Object]" and a
 * number in a text column into a number that the author's column header now
 * describes wrongly. A blank cell that the surface says is blank is a smaller
 * lie than a filled one that is wrong.
 *
 * `timestamp` is the case that earns the whole per-kind design. Declaring the
 * kind is the author telling DASH the string is a moment, which is exactly the
 * licence DASH needs to render it in its own words rather than shipping
 * `2026-08-07T13:58:28.037Z` onto a guided surface — the defect MAR-533 was
 * filed for.
 */
function cellOf(row: Record<string, unknown>, column: PanelTableColumn): PanelCellView {
  // An own property only. A `key` of `constructor` or `toString` must read as
  // absent rather than reaching up the prototype chain and rendering a function.
  if (!Object.prototype.hasOwnProperty.call(row, column.key)) {
    return { text: null };
  }
  const value = row[column.key];

  switch (column.kind) {
    case "text":
      return { text: typeof value === "string" && value.length > 0 ? value : null };
    case "number":
      // Not `Number(value)`. A finite number or nothing — NaN and Infinity are
      // absent for `describeRecordSize`'s reason: a value that cannot be
      // computed is absent, not zero and not the word "NaN".
      return { text: typeof value === "number" && Number.isFinite(value) ? String(value) : null };
    case "timestamp":
      return { text: typeof value === "string" ? plainMoment(value) : null };
  }
}

/**
 * One metric, with its provenance kept attached to it.
 *
 * The two branches are why this is a function rather than a lookup: an
 * artifact field is read out of something the agent made, and a DASH fact is
 * read out of what DASH observed. They can produce the identical string and they
 * are not the same claim, which is why the attribution travels beside the value
 * instead of being derivable from it.
 */
function buildMetric(item: PanelMetricItem, context: PanelContext): PanelMetricView {
  if (item.source.kind === "dash_fact") {
    return {
      label: item.label,
      value: dashFact(item.source.fact, context.facts),
      attribution: PANEL_ATTRIBUTION.dash_fact,
    };
  }

  const record = newestOfRole(context.artifacts, item.source.artifact_role);
  return {
    label: item.label,
    value: record === null ? null : fieldOf(record.artifact, item.source.field),
    attribution: PANEL_ATTRIBUTION.artifact_field,
  };
}

function dashFact(fact: string, facts: PanelDashFacts): string | null {
  switch (fact) {
    case "run_count":
      return String(facts.run_count);
    case "last_run_at":
      return describeFactMoment(facts.last_run_at);
    case "last_run_verdict":
      return describeRunVerdict(facts.last_run_status);
    default:
      // Unreachable through the validated union, and deliberately not a throw.
      // The schema and the renderer are two authorities that can disagree across
      // a version, and a page a person is reading must not crash on the day they
      // do — `describeArtifactRole` taking `string` is the same call.
      return null;
  }
}

/**
 * One top-level field of an artifact, rendered only if it is renderable.
 *
 * A string or a finite number. An object, an array, a boolean or a null is not
 * a metric — a metric slot is one value beside one label, and anything else
 * would have to be flattened, which is coercion by another name.
 */
function fieldOf(artifact: RunArtifact, field: string): string | null {
  const body = artifact as unknown as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(body, field)) {
    return null;
  }
  const value = body[field];
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/* ---------------------------------------------------------------------- *
 * Reading an artifact
 * ---------------------------------------------------------------------- */

/**
 * The newest artifact of a role, or null.
 *
 * The role is matched against the artifact's own `kind`, which is DASH's word
 * for what a thing is and the same field `describeArtifactRole` reads. **The
 * search is over the records this agent produced and there is no way for it to
 * be anything else**: the binding carries no agent, so a panel cannot reach
 * another agent's artifacts, and the caller resolves the records the way the
 * Outputs area already does.
 */
function newestOfRole(
  records: readonly RunArtifactRecord[],
  role: string,
): RunArtifactRecord | null {
  return records.find((record) => record.artifact.kind === role) ?? null;
}

/**
 * The member of the artifact contract that carries this kind's payload.
 *
 * A by-value pin mirroring `contracts/run-artifact.schema.json`'s `allOf`
 * branches, where a digest is required to carry `items` and a draft is required
 * to carry `draft`. Adding a kind to that schema is already required to add a
 * branch — its own comment says so — and this is the render side of the same
 * obligation, in one line a reviewer can check against the schema.
 *
 * **This is the one call ADR 0008 left to this slice, so it is named rather than
 * buried.** The ADR says a `table` draws "the newest JSON artifact of
 * `source_role` whose body is an array of objects", and under the artifact
 * contract as it stands an artifact is always an object — its root cannot be an
 * array — so taken literally the component could never draw anything. Two
 * readings were available. A magic member name (`items`, always) would bind the
 * panel to one artifact kind by coincidence. This one binds it to the contract:
 * the body of an artifact is whatever that kind's schema branch requires it to
 * carry. `bodyOf` also still accepts an artifact that *is* an array, which is
 * the ADR's literal reading and the shape a future artifact version could take,
 * so neither reading has been foreclosed.
 */
const ARTIFACT_BODY_MEMBERS: Readonly<Record<string, string>> = {
  digest: "items",
  draft: "draft",
};

/** The rows a `table` section can draw, or null when there are none to draw. */
function tableBodyOf(artifact: RunArtifact): unknown[] | null {
  const value: unknown = artifact;
  if (Array.isArray(value)) {
    return value;
  }
  const member = ARTIFACT_BODY_MEMBERS[artifact.kind];
  if (member === undefined) {
    return null;
  }
  const body = (artifact as unknown as Record<string, unknown>)[member];
  return Array.isArray(body) ? body : null;
}

/** A row is a plain object of named values. An array or a null is not one. */
function isRow(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
