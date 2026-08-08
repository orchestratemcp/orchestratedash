/**
 * The panel spec: reading `agent_dom.panel` without Ajv (ADR 0008, MAR-552).
 *
 * The schema in `contracts/agent.manifest.v2.schema.json` is normative and it
 * is what actually refuses a bad panel at the import doors. This module exists
 * beside it, not instead of it, for two reasons a schema cannot serve:
 *
 * 1. **Ajv cannot reach the renderer.** `lib/contracts.ts` finds and compiles
 *    schema files with `node:fs`; a client component cannot carry that. The
 *    panel renderer (slice 3) needs to know *which* of the five shapes a
 *    section is, with TypeScript narrowing on the same field the author wrote,
 *    and it needs that in a chunk that ships to the browser. So this module has
 *    **no imports at all** — the same standing `lib/import-feedback.ts` holds,
 *    and for the same reason.
 * 2. **Ajv's `oneOf` errors are unusable as feedback.** A section typed
 *    `reprot` produces five copies of "must be equal to constant" and nothing
 *    that names the actual mistake. `validatePanel` returns typed errors, so
 *    `lib/import-feedback.ts` can say the plain-language version — the same
 *    division of labour `lib/manifest-constraints.ts` already uses.
 *
 * **The two must not drift, and a test is what holds them together.**
 * `tests/panel-spec.test.ts` runs one corpus through both Ajv and
 * `validatePanel` and asserts they agree on every case. A pure re-statement of
 * a schema is a second source of truth unless something fails when they
 * disagree; that test is the something.
 *
 * ## Why the resolution refuses to carry what it cannot draw
 *
 * ADR 0008: a panel whose version DASH does not know is "accepted structurally
 * and rendered as one stated card… never partially, because a half-drawn panel
 * is a guess rendered as a fact." `PanelResolution`'s `newer_version` case
 * therefore carries no sections at all. That makes the rule structural rather
 * than something a renderer has to remember: there is no array to iterate, so
 * there is no way to half-draw it.
 */

/* ---------------------------------------------------------------------- *
 * The closed vocabularies, by value
 * ---------------------------------------------------------------------- */

/**
 * Every section type a version 1 panel may use. The complete answer, in one
 * array — the standard ADR 0008 holds this union to, and the reason a reviewer
 * can check what a panel is capable of by reading a single line.
 *
 * Widening this is widening what agent-authored data can make DASH draw, which
 * is why it is a by-value pin in a reviewed commit rather than a predicate.
 */
export const PANEL_SECTION_TYPES_V1 = [
  "report",
  "outputs",
  "table",
  "metrics",
  "note",
] as const;

/** How a table cell is rendered. A value of another kind renders as absent, never coerced. */
export const PANEL_COLUMN_KINDS = ["text", "number", "timestamp"] as const;

/**
 * The facts DASH observes about an agent and will report in its own voice.
 *
 * Closed, and every member is already computed for an existing view — nothing
 * here asks DASH to derive something new because a manifest requested it.
 */
export const PANEL_DASH_FACTS = ["run_count", "last_run_at", "last_run_verdict"] as const;

/** Where the panel sits in a manifest. Matches Ajv's `instancePath` so errors from both sides line up. */
export const PANEL_MANIFEST_PATH = "/agent_dom/panel";

export type PanelSectionTypeV1 = (typeof PANEL_SECTION_TYPES_V1)[number];
export type PanelColumnKind = (typeof PANEL_COLUMN_KINDS)[number];
export type PanelDashFact = (typeof PANEL_DASH_FACTS)[number];

/* ---------------------------------------------------------------------- *
 * The document
 * ---------------------------------------------------------------------- */

/**
 * The block as declared, before anything is known about which vocabulary it is
 * written in.
 *
 * `sections` is deliberately untyped here. What shape those objects have
 * depends entirely on `panel_version`, and a type that claimed otherwise would
 * be inviting a caller to iterate sections of a version DASH cannot draw.
 * `resolvePanel` is what turns a version into narrowed types.
 */
export interface PanelSpec {
  panel_version: number;
  title?: string;
  sections: readonly unknown[];
}

/** One column of a `table` section. */
export interface PanelTableColumn {
  /** One own property of a row object. Never rendered; `label` is what a person reads. */
  key: string;
  label: string;
  kind: PanelColumnKind;
}

/**
 * Where one metric's value comes from.
 *
 * The union is the attribution: `artifact_field` is *the agent's report* and
 * `dash_fact` is *DASH's record*. ADR 0008 is explicit that collapsing the two
 * would let an agent's own number wear DASH's voice, which is the
 * `stated_at`/`received_at` split applied to a number — so the renderer is made
 * to branch rather than being handed a value with the provenance flattened out.
 */
export type PanelMetricSource =
  | { kind: "artifact_field"; artifact_role: string; field: string }
  | { kind: "dash_fact"; fact: PanelDashFact };

export interface PanelMetricItem {
  /** Technical vocabulary. Travels; never rendered. */
  id: string;
  label: string;
  source: PanelMetricSource;
}

/** What every version 1 section carries, whatever its type. */
interface PanelSectionBase {
  /** Technical vocabulary, e.g. `latest_digest`. Travels so a section can be addressed; never rendered. */
  id: string;
  label: string;
}

export interface PanelReportSection extends PanelSectionBase {
  type: "report";
  artifact_role: string;
}

export interface PanelOutputsSection extends PanelSectionBase {
  type: "outputs";
  /** Absent means every role this agent produced — what the Outputs area already shows. */
  artifact_role?: string;
  max_items?: number;
}

export interface PanelTableSection extends PanelSectionBase {
  type: "table";
  source_role: string;
  columns: PanelTableColumn[];
}

export interface PanelMetricsSection extends PanelSectionBase {
  type: "metrics";
  items: PanelMetricItem[];
}

export interface PanelNoteSection extends PanelSectionBase {
  type: "note";
  /** The author's words, with the same standing as the manifest's `goal`. */
  text: string;
}

/**
 * The closed union a version 1 panel renders from.
 *
 * Discriminated by `type`, so a renderer that grows a sixth component gets a
 * compile error at every `switch` rather than a silently unhandled section —
 * the lesson `RunArtifact`'s union records at length.
 */
export type PanelSectionV1 =
  | PanelReportSection
  | PanelOutputsSection
  | PanelTableSection
  | PanelMetricsSection
  | PanelNoteSection;

/* ---------------------------------------------------------------------- *
 * Typed errors
 * ---------------------------------------------------------------------- */

export type PanelSpecErrorCode =
  /** The block is present but is not an object — so nothing below can be read. */
  | "not_an_object"
  /** Missing, not an integer, or below 1. */
  | "panel_version_invalid"
  /** Not an array, empty, or past the eight the schema allows. */
  | "sections_invalid"
  /** A section is not an object at all. */
  | "section_invalid"
  /** The load-bearing one: a version 1 section named a type outside the closed set. */
  | "unknown_section_type"
  /** A member of a section — its id, its label, or something its type requires — is missing or malformed. */
  | "section_member_invalid";

/**
 * One thing wrong with a panel.
 *
 * `message` is technical register, like the Ajv strings it travels beside;
 * `lib/import-feedback.ts` is what says the plain-language version. That split
 * is `lib/manifest-constraints.ts`'s, and it exists so a raw error stays
 * available to whoever wants it without ever being the only thing shown.
 */
export interface PanelSpecError {
  code: PanelSpecErrorCode;
  /**
   * Where, rooted at the panel itself — `/sections/0/type`. Prefix with
   * `PANEL_MANIFEST_PATH` for a path comparable to Ajv's `instancePath`.
   */
  path: string;
  message: string;
}

export type PanelValidation =
  | { ok: true; panel: PanelSpec }
  | { ok: false; errors: PanelSpecError[] };

/* ---------------------------------------------------------------------- *
 * Validation
 * ---------------------------------------------------------------------- */

const ID_PATTERN = /^[a-z0-9_]+$/;

const MAX_SECTIONS = 8;
const MAX_COLUMNS = 8;
const MAX_METRICS = 8;
const MAX_LABEL = 120;
const MAX_NAME = 64;
const MAX_NOTE_TEXT = 400;
const MAX_OUTPUT_ITEMS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NAME &&
    ID_PATTERN.test(value)
  );
}

function isLabel(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_LABEL;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

/**
 * Everything wrong with one declared panel. Empty means it matches v0.
 *
 * Takes the panel block rather than the manifest, so the paths it returns are
 * the panel's own and a caller can root them wherever the panel came from.
 */
export function validatePanel(input: unknown): PanelValidation {
  const errors: PanelSpecError[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "not_an_object",
          path: "",
          message: "panel must be an object",
        },
      ],
    };
  }

  const version = input["panel_version"];
  const versionIsLegal = isBoundedInteger(version, 1, Number.MAX_SAFE_INTEGER);
  if (!versionIsLegal) {
    errors.push({
      code: "panel_version_invalid",
      path: "/panel_version",
      message: "panel_version must be an integer of at least 1",
    });
  }

  const title = input["title"];
  if (title !== undefined && !isLabel(title)) {
    errors.push({
      code: "section_member_invalid",
      path: "/title",
      message: `title must be a string of 1 to ${MAX_LABEL} characters`,
    });
  }

  const sections = input["sections"];
  if (!Array.isArray(sections)) {
    errors.push({
      code: "sections_invalid",
      path: "/sections",
      message: "sections must be an array",
    });
    return { ok: false, errors };
  }
  if (sections.length < 1 || sections.length > MAX_SECTIONS) {
    errors.push({
      code: "sections_invalid",
      path: "/sections",
      message: `sections must hold 1 to ${MAX_SECTIONS} entries`,
    });
  }

  // The if/then/else the schema states, in the one place it can be stated in
  // TypeScript: version 1 is checked against the closed vocabulary, and any
  // other version is checked for structure only. A version DASH has never
  // heard of must not be measured against rules written before it existed.
  const strict = version === 1;
  sections.forEach((section, index) => {
    const at = `/sections/${index}`;
    if (!isRecord(section)) {
      errors.push({ code: "section_invalid", path: at, message: "section must be an object" });
      return;
    }
    if (strict) {
      checkSectionV1(section, at, errors);
    } else {
      checkSectionOpaque(section, at, errors);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    panel: {
      panel_version: version as number,
      ...(typeof title === "string" ? { title } : {}),
      sections,
    },
  };
}

/** The structural floor every section clears, whatever vocabulary it is written in. */
function checkSectionIdentity(
  section: Record<string, unknown>,
  at: string,
  errors: PanelSpecError[],
  namePattern: boolean,
): void {
  const id = section["id"];
  const idIsLegal = namePattern
    ? isName(id)
    : typeof id === "string" && id.length > 0 && id.length <= MAX_NAME;
  if (!idIsLegal) {
    errors.push({
      code: "section_member_invalid",
      path: `${at}/id`,
      message: namePattern
        ? `id must be 1 to ${MAX_NAME} characters of lowercase letters, digits and underscores`
        : `id must be a string of 1 to ${MAX_NAME} characters`,
    });
  }
  if (!isLabel(section["label"])) {
    errors.push({
      code: "section_member_invalid",
      path: `${at}/label`,
      message: `label must be a string of 1 to ${MAX_LABEL} characters`,
    });
  }
}

/**
 * A section of a panel version DASH does not know.
 *
 * Structure only, deliberately: the closed enum belongs to version 1 and must
 * not rot into leniency to accommodate a version nobody has designed yet.
 */
function checkSectionOpaque(
  section: Record<string, unknown>,
  at: string,
  errors: PanelSpecError[],
): void {
  checkSectionIdentity(section, at, errors, false);
  const type = section["type"];
  if (typeof type !== "string" || type.length === 0 || type.length > MAX_NAME) {
    errors.push({
      code: "section_member_invalid",
      path: `${at}/type`,
      message: `type must be a string of 1 to ${MAX_NAME} characters`,
    });
  }
}

function checkSectionV1(
  section: Record<string, unknown>,
  at: string,
  errors: PanelSpecError[],
): void {
  checkSectionIdentity(section, at, errors, true);

  const type = section["type"];
  if (!isSectionTypeV1(type)) {
    // The refusal ADR 0008 asks for by name: a typo'd type is refused at
    // import, loudly, rather than dropped at render. The message names the
    // whole vocabulary because the author's next move is to pick one of them.
    errors.push({
      code: "unknown_section_type",
      path: `${at}/type`,
      message: `type must be one of ${PANEL_SECTION_TYPES_V1.join(", ")}`,
    });
    return;
  }

  switch (type) {
    case "report": {
      if (!isName(section["artifact_role"])) {
        errors.push(roleError(`${at}/artifact_role`, "artifact_role"));
      }
      return;
    }
    case "outputs": {
      // Absent means every role, which is what the Outputs area already shows.
      // Present and malformed is a different thing and is refused.
      if (section["artifact_role"] !== undefined && !isName(section["artifact_role"])) {
        errors.push(roleError(`${at}/artifact_role`, "artifact_role"));
      }
      if (
        section["max_items"] !== undefined &&
        !isBoundedInteger(section["max_items"], 1, MAX_OUTPUT_ITEMS)
      ) {
        errors.push({
          code: "section_member_invalid",
          path: `${at}/max_items`,
          message: `max_items must be an integer from 1 to ${MAX_OUTPUT_ITEMS}`,
        });
      }
      return;
    }
    case "table": {
      if (!isName(section["source_role"])) {
        errors.push(roleError(`${at}/source_role`, "source_role"));
      }
      const columns = section["columns"];
      if (!Array.isArray(columns) || columns.length < 1 || columns.length > MAX_COLUMNS) {
        errors.push({
          code: "section_member_invalid",
          path: `${at}/columns`,
          message: `columns must be an array of 1 to ${MAX_COLUMNS} entries`,
        });
        return;
      }
      columns.forEach((column, index) => {
        const columnAt = `${at}/columns/${index}`;
        if (!isRecord(column)) {
          errors.push({
            code: "section_member_invalid",
            path: columnAt,
            message: "column must be an object",
          });
          return;
        }
        if (!isName(column["key"])) {
          errors.push({
            code: "section_member_invalid",
            path: `${columnAt}/key`,
            message: `key must be 1 to ${MAX_NAME} characters of lowercase letters, digits and underscores`,
          });
        }
        if (!isLabel(column["label"])) {
          errors.push({
            code: "section_member_invalid",
            path: `${columnAt}/label`,
            message: `label must be a string of 1 to ${MAX_LABEL} characters`,
          });
        }
        if (!isColumnKind(column["kind"])) {
          errors.push({
            code: "section_member_invalid",
            path: `${columnAt}/kind`,
            message: `kind must be one of ${PANEL_COLUMN_KINDS.join(", ")}`,
          });
        }
      });
      return;
    }
    case "metrics": {
      const items = section["items"];
      if (!Array.isArray(items) || items.length < 1 || items.length > MAX_METRICS) {
        errors.push({
          code: "section_member_invalid",
          path: `${at}/items`,
          message: `items must be an array of 1 to ${MAX_METRICS} entries`,
        });
        return;
      }
      items.forEach((item, index) => {
        checkMetricItem(item, `${at}/items/${index}`, errors);
      });
      return;
    }
    case "note": {
      const text = section["text"];
      if (typeof text !== "string" || text.length < 1 || text.length > MAX_NOTE_TEXT) {
        errors.push({
          code: "section_member_invalid",
          path: `${at}/text`,
          message: `text must be a string of 1 to ${MAX_NOTE_TEXT} characters`,
        });
      }
      return;
    }
  }
}

function checkMetricItem(item: unknown, at: string, errors: PanelSpecError[]): void {
  if (!isRecord(item)) {
    errors.push({ code: "section_member_invalid", path: at, message: "metric must be an object" });
    return;
  }
  if (!isName(item["id"])) {
    errors.push({
      code: "section_member_invalid",
      path: `${at}/id`,
      message: `id must be 1 to ${MAX_NAME} characters of lowercase letters, digits and underscores`,
    });
  }
  if (!isLabel(item["label"])) {
    errors.push({
      code: "section_member_invalid",
      path: `${at}/label`,
      message: `label must be a string of 1 to ${MAX_LABEL} characters`,
    });
  }

  const source = item["source"];
  if (!isRecord(source)) {
    errors.push({
      code: "section_member_invalid",
      path: `${at}/source`,
      message: "source must be an object naming an artifact field or a fact DASH observes",
    });
    return;
  }

  if (source["kind"] === "artifact_field") {
    if (!isName(source["artifact_role"])) {
      errors.push(roleError(`${at}/source/artifact_role`, "artifact_role"));
    }
    if (!isName(source["field"])) {
      errors.push({
        code: "section_member_invalid",
        path: `${at}/source/field`,
        message: `field must be 1 to ${MAX_NAME} characters of lowercase letters, digits and underscores`,
      });
    }
    return;
  }

  if (source["kind"] === "dash_fact") {
    if (!isDashFact(source["fact"])) {
      errors.push({
        code: "section_member_invalid",
        path: `${at}/source/fact`,
        message: `fact must be one of ${PANEL_DASH_FACTS.join(", ")}`,
      });
    }
    return;
  }

  errors.push({
    code: "section_member_invalid",
    path: `${at}/source/kind`,
    message: "kind must be artifact_field or dash_fact",
  });
}

function roleError(path: string, member: string): PanelSpecError {
  return {
    code: "section_member_invalid",
    path,
    message: `${member} must be 1 to ${MAX_NAME} characters of lowercase letters, digits and underscores`,
  };
}

function isSectionTypeV1(value: unknown): value is PanelSectionTypeV1 {
  return (
    typeof value === "string" &&
    (PANEL_SECTION_TYPES_V1 as readonly string[]).includes(value)
  );
}

function isColumnKind(value: unknown): value is PanelColumnKind {
  return (
    typeof value === "string" && (PANEL_COLUMN_KINDS as readonly string[]).includes(value)
  );
}

function isDashFact(value: unknown): value is PanelDashFact {
  return typeof value === "string" && (PANEL_DASH_FACTS as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------- *
 * Resolution
 * ---------------------------------------------------------------------- */

/**
 * What DASH may draw for this agent.
 *
 * A closed union rather than a nullable panel, because "the author declared
 * nothing", "the author declared a panel in a vocabulary this DASH has", and
 * "the author declared one in a newer format" are three different surfaces and
 * only the middle one has sections to iterate.
 */
export type PanelResolution =
  /** No panel declared. Renders nothing — never a placeholder, never an empty frame. */
  | { kind: "none" }
  /** Version 1, checked. `sections` is the closed union, narrowed. */
  | { kind: "v1"; title: string | null; sections: PanelSectionV1[] }
  /**
   * A version DASH does not know, accepted structurally per the contract's
   * additive-versioning rule. **Carries no sections on purpose** — one stated
   * card is the whole render, and a resolution that handed over an array would
   * be inviting the half-drawn panel ADR 0008 refuses.
   */
  | { kind: "newer_version"; panel_version: number; title: string | null }
  /**
   * Declared, and not readable as a panel at all.
   *
   * Unreachable through the import doors, which refuse this before a row is
   * written — it is here for the document that arrived some other way (a folder
   * edited on disk, a row from a store that has taken damage). The errors are
   * carried rather than swallowed because ADR 0008's damage rule is that
   * disagreement is surfaced, never silently repaired; which surface says so is
   * the renderer slice's decision, not this module's.
   */
  | { kind: "unreadable"; errors: PanelSpecError[] };

/**
 * Read a manifest's panel.
 *
 * Takes the whole manifest, and `unknown` rather than a manifest type, for the
 * reason `buildInputRoles` does: this runs over a row's stored document as
 * readily as over a freshly validated one, and a cast would be a promise this
 * module cannot keep.
 *
 * **Absence is `none`, and `none` renders nothing.** The rule `task_inputs`
 * shipped with, restated because the other reading is available and wrong: an
 * agent that declared no panel is not an agent that gets a default one.
 */
export function resolvePanel(manifest: unknown): PanelResolution {
  const declared = (manifest as { agent_dom?: { panel?: unknown } } | null)?.agent_dom?.panel;
  if (declared === undefined || declared === null) {
    return { kind: "none" };
  }

  const validation = validatePanel(declared);
  if (!validation.ok) {
    return { kind: "unreadable", errors: validation.errors };
  }

  const { panel } = validation;
  const title = typeof panel.title === "string" ? panel.title : null;

  if (panel.panel_version !== 1) {
    return { kind: "newer_version", panel_version: panel.panel_version, title };
  }

  return { kind: "v1", title, sections: panel.sections as PanelSectionV1[] };
}
