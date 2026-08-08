/**
 * The connection-requirements spec: reading `agent_dom.connection_requirements`
 * without Ajv (MAR-569, ADR 0008's discipline applied to connections).
 *
 * The schema in `contracts/agent.manifest.v2.schema.json` is normative and it is
 * what actually refuses a bad declaration at the import doors. This module
 * exists beside it, not instead of it, for the two reasons `lib/panel-spec.ts`
 * states and a third this block adds:
 *
 * 1. **Ajv cannot reach the renderer.** `lib/contracts.ts` finds and compiles
 *    schema files with `node:fs`; a client component cannot carry that. The
 *    Connections surface (MAR-570) needs to know which of the two flows a
 *    requirement asks for, with TypeScript narrowing on the same field the
 *    author wrote, in a chunk that ships to the browser. So this module has
 *    **no imports at all** — the standing `lib/panel-spec.ts` and
 *    `lib/import-feedback.ts` both hold, for the same reason.
 * 2. **Ajv's conditional errors are unusable as feedback.** A requirement typed
 *    `google_oauth` produces "must be equal to one of the allowed values"
 *    alongside two unrelated if/then failures, and nothing that names the actual
 *    mistake. `validateConnectionRequirements` returns typed errors so
 *    `lib/import-feedback.ts` can say the plain-language version.
 * 3. **A dead Connect button is worse than a missing one.** The panel's failure
 *    mode is a card that draws wrong; this block's is a button that fires
 *    nothing. That asymmetry is why `connector_kind` is closed by value and why
 *    `resolveConnectionRequirements` refuses to hand a caller anything it could
 *    place a button beside without first having checked it.
 *
 * **The two must not drift, and a test is what holds them together.**
 * `tests/connection-spec.test.ts` runs one corpus through both Ajv and this
 * reader and asserts they agree on every case. A pure re-statement of a schema
 * is a second source of truth unless something fails when they disagree; that
 * test is the something.
 *
 * ## What this module is not
 *
 * It reads the *declaration*. It does not know whether anything is connected —
 * that needs the store, and it is `lib/connection-requirements.ts`'s job, which
 * imports this and shares MAR-533's standings rather than forking them. The
 * split is deliberate: this half can be proved right against a JSON file, and
 * the half that needs a database is kept small enough to read.
 */

/* ---------------------------------------------------------------------- *
 * The closed vocabulary, by value
 * ---------------------------------------------------------------------- */

/**
 * Every flow a version 1 requirement may ask DASH to launch. The complete
 * answer, in one array.
 *
 * The membership rule is the whole point and is worth stating rather than
 * inferring: **a kind is in this list because DASH has built the flow.** Not
 * because a provider is popular, not because the emitter can name it, and not
 * because it is planned. A requirement is drawn as a line with a Connect button
 * beside it, so a kind DASH cannot launch is a lie on a button — and the person
 * it lies to is the novice this product is for, who will read a dead button as
 * their own mistake.
 *
 * - `google_oauth_broker` — MAR-458's brokered sign-in. DASH holds the token and
 *   performs the narrow operations itself; the agent never receives it.
 * - `api_key` — DASH-custodied secret entry, through the credential prompt.
 *
 * **Two, and the one that is missing is why this comment is long.** MAR-569 as
 * filed named a third, `mcp_server`, attributed to MAR-498's wizard. That wizard
 * connects an SSH deploy host — `HostRecord` is an address, a username, a key
 * name and a pinned fingerprint — so an agent can be put *on a server*. It
 * cannot connect a Notion workspace, and DASH has no MCP-server connect flow at
 * all: `remote_mcp_server` in `lib/broker/providers.ts` is a `TokenCustodian`
 * label whose own docblock records that `dash_vault` is the only reachable
 * value. The kind would have been unlaunchable on the day it shipped, which is
 * the precise failure this list exists to prevent, so Henrik's ruling on
 * 2026-08-08 was to drop it.
 *
 * A real MCP-server flow arrives the way any third kind does: a version bump,
 * accepted structurally by `checkRequirementOpaque` and drawn as one stated
 * "DASH cannot connect this yet" line — never a dead Connect button. Widening
 * this array in place is widening what agent-authored data can make DASH offer
 * to do, which is why it is a by-value pin in a reviewed commit rather than a
 * predicate — the way a widened `HOST_VERBS` fails its own pin.
 */
export const CONNECTOR_KINDS_V1 = ["google_oauth_broker", "api_key"] as const;

/**
 * Member names a requirement may never carry, because each one is where a
 * credential value would go.
 *
 * The manifest has forbidden these on every connection block since v2 was
 * written — "connection fields describe requirements only" is in the schema's
 * own title description — and this block is no exception just because it is
 * shorter. The reader repeats it rather than deferring to Ajv for the reason the
 * whole module exists: the surface that reads a stored document does not run
 * Ajv, and a requirement that arrived some other way carrying a live key is
 * precisely the document that must not be handed onward as readable.
 *
 * Kept identical to the schema's `propertyNames` guard by the corpus test, which
 * is what caught this list being absent here in the first place.
 */
export const FORBIDDEN_REQUIREMENT_MEMBERS = [
  "value",
  "secret",
  "password",
  "token",
  "access_token",
  "refresh_token",
  "client_secret",
  "api_key",
  "credential_value",
] as const;

/** Where the block sits in a manifest. Matches Ajv's `instancePath` so errors from both sides line up. */
export const CONNECTION_REQUIREMENTS_MANIFEST_PATH = "/agent_dom/connection_requirements";

export type ConnectorKindV1 = (typeof CONNECTOR_KINDS_V1)[number];

/* ---------------------------------------------------------------------- *
 * The document
 * ---------------------------------------------------------------------- */

/**
 * The block as declared, before anything is known about which vocabulary it is
 * written in.
 *
 * `requirements` is deliberately untyped here, for `PanelSpec.sections`' reason:
 * what shape those objects have depends entirely on `requirements_version`, and
 * a type that claimed otherwise would invite a caller to put buttons beside
 * requirements of a version DASH cannot launch.
 */
export interface ConnectionRequirementsSpec {
  requirements_version: number;
  requirements: readonly unknown[];
}

/** One thing that needs connecting, in a version 1 declaration. */
export interface ConnectionRequirementV1 {
  /** Technical vocabulary. Travels so a requirement can be addressed; never rendered. */
  id: string;
  /** What the user sees on the line: "Your Gmail". The author's words. */
  name: string;
  connector_kind: ConnectorKindV1;
  /**
   * Which `agent_dom.connections` entry this is about, by its `id`.
   *
   * Required, not optional, because both v1 kinds act on a declared connection —
   * so the resolution layer can rely on the link without a cast. Whether the id
   * names a connection this manifest actually declared is a different question,
   * and one only the resolution can answer.
   */
  connection_id: string;
  /** Operation ids, e.g. `gmail.search`. Absent means the whole connection's requested set. */
  operations?: string[];
  /** Absent means required. An agent that can run degraded is the one that says so. */
  optional?: boolean;
  /** The author's claim about what it is for, with the same standing as `goal`. */
  why?: string;
}

/* ---------------------------------------------------------------------- *
 * Typed errors
 * ---------------------------------------------------------------------- */

export type ConnectionSpecErrorCode =
  /** The block is present but is not an object — so nothing below can be read. */
  | "not_an_object"
  /** Missing, not an integer, or below 1. */
  | "requirements_version_invalid"
  /** Not an array, empty, or past the twelve the schema allows. */
  | "requirements_invalid"
  /** A requirement is not an object at all. */
  | "requirement_invalid"
  /** The load-bearing one: a version 1 requirement named a flow DASH has not built. */
  | "unknown_connector_kind"
  /** The requirement named no connection to act on. */
  | "connection_link_invalid"
  /** A member name is one a credential value would be written under. */
  | "credential_member"
  /** A member of a requirement — its id, its name, its operations — is missing or malformed. */
  | "requirement_member_invalid";

/**
 * One thing wrong with a declaration.
 *
 * `message` is technical register, like the Ajv strings it travels beside;
 * `lib/import-feedback.ts` is what says the plain-language version. That split
 * is `lib/manifest-constraints.ts`'s, and it exists so a raw error stays
 * available to whoever wants it without ever being the only thing shown.
 */
export interface ConnectionSpecError {
  code: ConnectionSpecErrorCode;
  /**
   * Where, rooted at the block itself — `/requirements/0/connector_kind`.
   * Prefix with `CONNECTION_REQUIREMENTS_MANIFEST_PATH` for a path comparable to
   * Ajv's `instancePath`.
   */
  path: string;
  message: string;
}

export type ConnectionRequirementsValidation =
  | { ok: true; spec: ConnectionRequirementsSpec }
  | { ok: false; errors: ConnectionSpecError[] };

/* ---------------------------------------------------------------------- *
 * Validation
 * ---------------------------------------------------------------------- */

const ID_PATTERN = /^[a-z0-9_]+$/;
/** An operation id, e.g. `gmail.draft.create`. Dots separate; nothing else does. */
const OPERATION_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

const MAX_REQUIREMENTS = 12;
const MAX_OPERATIONS = 12;
const MAX_ID = 64;
const MAX_NAME = 120;
const MAX_WHY = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ID &&
    ID_PATTERN.test(value)
  );
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_NAME;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}

/**
 * Everything wrong with one declared block. Empty means it matches the schema.
 *
 * Takes the block rather than the manifest, so the paths it returns are the
 * block's own and a caller can root them wherever the block came from — the
 * shape `validatePanel` established.
 */
export function validateConnectionRequirements(input: unknown): ConnectionRequirementsValidation {
  const errors: ConnectionSpecError[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "not_an_object",
          path: "",
          message: "connection_requirements must be an object",
        },
      ],
    };
  }

  const version = input["requirements_version"];
  if (!isBoundedInteger(version, 1, Number.MAX_SAFE_INTEGER)) {
    errors.push({
      code: "requirements_version_invalid",
      path: "/requirements_version",
      message: "requirements_version must be an integer of at least 1",
    });
  }

  const requirements = input["requirements"];
  if (!Array.isArray(requirements)) {
    errors.push({
      code: "requirements_invalid",
      path: "/requirements",
      message: "requirements must be an array",
    });
    return { ok: false, errors };
  }
  if (requirements.length < 1 || requirements.length > MAX_REQUIREMENTS) {
    errors.push({
      code: "requirements_invalid",
      path: "/requirements",
      message: `requirements must hold 1 to ${MAX_REQUIREMENTS} entries`,
    });
  }

  // The if/then/else the schema states, in the one place it can be stated in
  // TypeScript: version 1 is checked against the closed vocabulary, and any
  // other version is checked for structure only. A version DASH has never heard
  // of must not be measured against rules written before it existed.
  const strict = version === 1;
  requirements.forEach((requirement, index) => {
    const at = `/requirements/${index}`;
    if (!isRecord(requirement)) {
      errors.push({
        code: "requirement_invalid",
        path: at,
        message: "requirement must be an object",
      });
      return;
    }
    if (strict) {
      checkRequirementV1(requirement, at, errors);
    } else {
      checkRequirementOpaque(requirement, at, errors);
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    spec: { requirements_version: version as number, requirements },
  };
}

/** The structural floor every requirement clears, whatever vocabulary it is written in. */
function checkRequirementIdentity(
  requirement: Record<string, unknown>,
  at: string,
  errors: ConnectionSpecError[],
  idPattern: boolean,
): void {
  const id = requirement["id"];
  const idIsLegal = idPattern
    ? isIdentifier(id)
    : typeof id === "string" && id.length > 0 && id.length <= MAX_ID;
  if (!idIsLegal) {
    errors.push({
      code: "requirement_member_invalid",
      path: `${at}/id`,
      message: idPattern
        ? `id must be 1 to ${MAX_ID} characters of lowercase letters, digits and underscores`
        : `id must be a string of 1 to ${MAX_ID} characters`,
    });
  }
  if (!isName(requirement["name"])) {
    errors.push({
      code: "requirement_member_invalid",
      path: `${at}/name`,
      message: `name must be a string of 1 to ${MAX_NAME} characters`,
    });
  }
}

/**
 * A requirement from a declaration version DASH does not know.
 *
 * Structure only, deliberately: the closed enum belongs to version 1 and must
 * not rot into leniency to accommodate a version nobody has designed yet.
 */
function checkRequirementOpaque(
  requirement: Record<string, unknown>,
  at: string,
  errors: ConnectionSpecError[],
): void {
  checkRequirementIdentity(requirement, at, errors, false);
  const kind = requirement["connector_kind"];
  if (typeof kind !== "string" || kind.length === 0 || kind.length > MAX_ID) {
    errors.push({
      code: "requirement_member_invalid",
      path: `${at}/connector_kind`,
      message: `connector_kind must be a string of 1 to ${MAX_ID} characters`,
    });
  }
}

function checkRequirementV1(
  requirement: Record<string, unknown>,
  at: string,
  errors: ConnectionSpecError[],
): void {
  checkRequirementIdentity(requirement, at, errors, true);

  const kind = requirement["connector_kind"];
  if (!isConnectorKindV1(kind)) {
    // The refusal the closed enum exists for: a typo'd kind is refused at
    // import, loudly, rather than drawn at render as a button that fires
    // nothing. The message names the whole vocabulary because the author's next
    // move is to pick one of them.
    errors.push({
      code: "unknown_connector_kind",
      path: `${at}/connector_kind`,
      message: `connector_kind must be one of ${CONNECTOR_KINDS_V1.join(", ")}`,
    });
    return;
  }

  checkCredentialMembers(requirement, at, errors);
  checkConnectionLink(requirement, at, errors);
  checkOperations(requirement, at, errors);

  const optional = requirement["optional"];
  if (optional !== undefined && typeof optional !== "boolean") {
    errors.push({
      code: "requirement_member_invalid",
      path: `${at}/optional`,
      message: "optional must be true or false",
    });
  }

  const why = requirement["why"];
  if (why !== undefined && (typeof why !== "string" || why.length < 1 || why.length > MAX_WHY)) {
    errors.push({
      code: "requirement_member_invalid",
      path: `${at}/why`,
      message: `why must be a string of 1 to ${MAX_WHY} characters`,
    });
  }
}

/**
 * The credential guard, by member name.
 *
 * Checked on version 1 requirements only, which is where the schema checks it —
 * a requirement from a version DASH does not know is not measured against rules
 * written before it existed, and that holds for this rule as much as for the
 * enum. The block is drawn as one stated card either way, so nothing is read out
 * of it.
 */
function checkCredentialMembers(
  requirement: Record<string, unknown>,
  at: string,
  errors: ConnectionSpecError[],
): void {
  for (const member of FORBIDDEN_REQUIREMENT_MEMBERS) {
    if (Object.hasOwn(requirement, member)) {
      errors.push({
        code: "credential_member",
        path: `${at}/${member}`,
        message: `a requirement describes what is needed and must not carry ${member}`,
      });
    }
  }
}

/**
 * The link to the connection this requirement acts on.
 *
 * Required, because without it the requirement has no standing to compute and
 * no field for the Connect button to act on — it could only be drawn as a
 * sentence with a dead button beside it, which is the whole failure this block
 * is built to avoid.
 */
function checkConnectionLink(
  requirement: Record<string, unknown>,
  at: string,
  errors: ConnectionSpecError[],
): void {
  const declared = requirement["connection_id"];
  if (typeof declared !== "string" || declared.length < 1 || declared.length > MAX_ID) {
    errors.push({
      code: "connection_link_invalid",
      path: `${at}/connection_id`,
      message: `connection_id is required and must be a string of 1 to ${MAX_ID} characters`,
    });
  }
}

function checkOperations(
  requirement: Record<string, unknown>,
  at: string,
  errors: ConnectionSpecError[],
): void {
  const operations = requirement["operations"];
  if (operations === undefined) {
    return;
  }
  if (!Array.isArray(operations) || operations.length > MAX_OPERATIONS) {
    errors.push({
      code: "requirement_member_invalid",
      path: `${at}/operations`,
      message: `operations must be an array of at most ${MAX_OPERATIONS} entries`,
    });
    return;
  }

  const seen = new Set<string>();
  operations.forEach((operation, index) => {
    if (
      typeof operation !== "string" ||
      operation.length < 1 ||
      operation.length > MAX_ID ||
      !OPERATION_PATTERN.test(operation)
    ) {
      errors.push({
        code: "requirement_member_invalid",
        path: `${at}/operations/${index}`,
        message: `operation must be 1 to ${MAX_ID} characters of lowercase letters, digits, underscores and dots`,
      });
      return;
    }
    if (seen.has(operation)) {
      errors.push({
        code: "requirement_member_invalid",
        path: `${at}/operations/${index}`,
        message: "operations must not repeat an entry",
      });
      return;
    }
    seen.add(operation);
  });
}

function isConnectorKindV1(value: unknown): value is ConnectorKindV1 {
  return typeof value === "string" && (CONNECTOR_KINDS_V1 as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------- *
 * Resolution
 * ---------------------------------------------------------------------- */

/**
 * What DASH may draw for this agent's connection needs.
 *
 * A closed union rather than a nullable list, because "the author declared
 * nothing", "the author declared needs in a vocabulary this DASH has", and "the
 * author declared them in a newer format" are three different surfaces and only
 * the middle one has requirements to place buttons beside.
 */
export type ConnectionRequirementsResolution =
  /**
   * No declaration. Draws nothing — and specifically **not** "this agent needs
   * nothing connected", which is a different claim `agent_dom.connections` may
   * well contradict. Every agent built before this block existed lands here.
   */
  | { kind: "none" }
  /** Version 1, checked. `requirements` is the narrowed type. */
  | { kind: "v1"; requirements: ConnectionRequirementV1[] }
  /**
   * A version DASH does not know, accepted structurally per the contract's
   * additive-versioning rule. **Carries no requirements on purpose** — one
   * stated card is the whole render. A resolution that handed over a list would
   * be inviting a Connect button whose flow DASH resolved by guessing, which is
   * the connections-shaped version of ADR 0008's half-drawn panel.
   */
  | { kind: "newer_version"; requirements_version: number; declared_count: number }
  /**
   * Declared, and not readable at all.
   *
   * Unreachable through the import doors, which refuse this before a row is
   * written — it is here for the document that arrived some other way (a folder
   * edited on disk, a row from a store that has taken damage). The errors are
   * carried rather than swallowed because ADR 0008's damage rule is that
   * disagreement is surfaced, never silently repaired.
   */
  | { kind: "unreadable"; errors: ConnectionSpecError[] };

/**
 * Read a manifest's connection requirements.
 *
 * Takes the whole manifest, and `unknown` rather than a manifest type, for
 * `resolvePanel`'s reason: this runs over a row's stored document as readily as
 * over a freshly validated one, and a cast would be a promise this module
 * cannot keep.
 *
 * **Absence is `none`, and `none` draws nothing.** Restated because the wrong
 * reading is available and would be actively harmful here: an agent that
 * declared no requirements is not an agent that needs no connections. It is an
 * agent whose author did not fill this in — which is every agent exported before
 * MAR-569 — and its `agent_dom.connections` inventory is still the truth about
 * what it reaches.
 */
export function resolveConnectionRequirements(manifest: unknown): ConnectionRequirementsResolution {
  const declared = (
    manifest as { agent_dom?: { connection_requirements?: unknown } } | null
  )?.agent_dom?.connection_requirements;
  if (declared === undefined || declared === null) {
    return { kind: "none" };
  }

  const validation = validateConnectionRequirements(declared);
  if (!validation.ok) {
    return { kind: "unreadable", errors: validation.errors };
  }

  const { spec } = validation;
  if (spec.requirements_version !== 1) {
    return {
      kind: "newer_version",
      requirements_version: spec.requirements_version,
      declared_count: spec.requirements.length,
    };
  }

  return { kind: "v1", requirements: spec.requirements as ConnectionRequirementV1[] };
}
