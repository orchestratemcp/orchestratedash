/**
 * Which credentials DASH is allowed to hold, and where each one may go.
 *
 * `lib/secret-refs.ts` has recorded *where a credential is* since MAR-416, and
 * has had no production caller: nothing in DASH could put a credential anywhere
 * for it to record. This module is the missing decision layer — the part that
 * says whether a given (agent, connection, field) is something DASH may take a
 * secret for at all, and which environment variable that secret is allowed to
 * become when the runner spawns the agent.
 *
 * It is pure. No vault, no database, no Electron, no `process.env`. Everything
 * here is a function of a validated manifest, which is what makes the refusals
 * below unit-testable rather than reasoned about — the same argument
 * `lib/connections.ts` and `lib/shell/ipc.ts` make for themselves.
 *
 * ## The rule that shapes the file
 *
 * DASH takes a secret only for a field the manifest **declared** as one. Not a
 * field it inferred, not a row it derived, not a connection the agent said
 * someone else owns. Three separate refusals rather than one, because
 * "this agent never mentioned that connection" and "that connection is real but
 * the agent holds its own credential" need different words in front of a user,
 * and collapsing them would make the Connection Center lie about one of them.
 *
 * ## Why delivery is decided here and not at spawn
 *
 * A credential DASH holds but cannot give to the agent is a credential that
 * does nothing. The delivery target is `field.technical.environment_name`, which
 * `agent.manifest.v2.schema.json` has always had and nothing has ever read.
 *
 * Reading it *here*, against the manifest, means an agent that asks for a
 * reserved name is refused at the moment a user tries to connect it — with a
 * sentence about which name is reserved — rather than at spawn, where the same
 * refusal surfaces as an agent that will not start. `runner/supervisor.ts` keeps
 * its own guards regardless: this is the early, explicable refusal, not a
 * replacement for the enforcing one.
 */

import type { ConnectionSourceManifest, ManifestConnection, ManifestConnectionField } from "./connections";
import { checkRequestedScopes, oauthProviderFor } from "./oauth/providers";

/* ---------------------------------------------------------------------- *
 * Environment names
 * ---------------------------------------------------------------------- */

/**
 * The namespace `runner/supervisor.ts` refuses to hand any child, mirrored here
 * so the refusal can carry an explanation.
 *
 * Deliberately the *prefix* rule and not the three exact names in
 * `FORBIDDEN_ENVIRONMENT`. The supervisor applies both — the broad `DASH_`
 * check on registration env and the exact-name check on the assembled
 * environment — and a manifest that asks for anything in the DASH namespace is
 * refused by the first of them. Duplicating the narrower list would let this
 * module accept a name the supervisor then rejects, which is the one outcome
 * worth designing out: an agent that connects successfully and cannot start.
 */
const RESERVED_ENVIRONMENT_PREFIX = "DASH_";

/**
 * A conventional environment variable name: uppercase, digits, underscores, not
 * starting with a digit.
 *
 * Stricter than most shells actually allow, on purpose. This name is written
 * into a child process's environment by DASH, so the set of things it may be is
 * a set we choose rather than a set the platform tolerates. Lowercase and
 * punctuation are rejected because a manifest asking for `PATH ` or `a=b` is
 * either confused or probing.
 */
const ENVIRONMENT_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/;

/**
 * Names that are not DASH's but would break the agent, or the machine, if a
 * manifest were allowed to claim them.
 *
 * `PATH` and friends are assembled by the supervisor from
 * `INHERITED_ENVIRONMENT`; letting a credential land on one would replace the
 * child's search path with an API key. `NODE_OPTIONS` is worse — it is
 * arbitrary code execution in the child, and a manifest that wants a secret
 * delivered there is not describing a connection.
 */
const UNSAFE_ENVIRONMENT_NAMES = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "LANG",
  "TZ",
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
]);

export type EnvironmentNameRefusal =
  | "malformed_environment_name"
  | "reserved_environment_name"
  | "unsafe_environment_name";

/**
 * May a credential be delivered as this environment variable?
 *
 * Returns the refusal rather than a boolean so the caller can say which rule
 * was broken. A Connection Center that can only say "no" to an agent author is
 * a Connection Center they cannot fix their manifest from.
 */
export function checkEnvironmentName(name: string): EnvironmentNameRefusal | null {
  if (!ENVIRONMENT_NAME_PATTERN.test(name)) {
    return "malformed_environment_name";
  }
  if (name.startsWith(RESERVED_ENVIRONMENT_PREFIX)) {
    return "reserved_environment_name";
  }
  if (UNSAFE_ENVIRONMENT_NAMES.has(name)) {
    return "unsafe_environment_name";
  }
  return null;
}

/* ---------------------------------------------------------------------- *
 * Vault names
 * ---------------------------------------------------------------------- */

/**
 * The vault key a connection field's secret lives under.
 *
 * Namespaced `dash.connection.` so it cannot collide with
 * `dash.adapter.{id}.token`, which is DASH's own credential for *reaching* an
 * agent rather than one the agent uses. Those two are different kinds of thing
 * and a disconnect that wiped both would be a surprise.
 *
 * Every segment is lowercased and narrowed to the character set
 * `isValidSecretName` accepts, in the same shape as `adapterTokenName`. The
 * separator is `.` and every other character collapses to `-`, so two distinct
 * ids cannot merge into one name by way of a dot in an id.
 */
export function connectionSecretName(
  agentId: string,
  connectionId: string,
  fieldId: string,
): string {
  const safe = (part: string): string => part.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `dash.connection.${safe(agentId)}.${safe(connectionId)}.${safe(fieldId)}`;
}

/* ---------------------------------------------------------------------- *
 * Targets
 * ---------------------------------------------------------------------- */

/**
 * Why DASH will not take a credential for something a caller named.
 *
 * `not_dash_managed` and `agent_holds_this` are one code, not two: from DASH's
 * side "the agent owns it" and "an external manager owns it" produce the same
 * answer — DASH does not store it — and the *ownership* field already carries
 * which one it is, for the UI to word.
 */
export type CredentialTargetRefusal =
  | "unknown_connection"
  | "unknown_field"
  | "not_a_secret_field"
  | "not_dash_managed"
  /** MAR-446: an OAuth field for a provider DASH has no sign-in flow for. */
  | "no_oauth_flow"
  /** MAR-446: an OAuth field whose manifest named no permissions to request. */
  | "oauth_scopes_not_declared"
  /** MAR-446: an OAuth field asking for access DASH will not request. */
  | "oauth_scope_not_allowed"
  | EnvironmentNameRefusal;

/**
 * What kind of credential a target holds (MAR-446).
 *
 * The two differ in every direction: how DASH obtains one (a text box versus a
 * browser sign-in), what it stores (an opaque string versus an envelope), what
 * it can honestly check (that the vault still opens versus whether the provider
 * still accepts the grant), and what it hands an agent (the value itself versus
 * a token minted at spawn). Carrying the distinction on the target means each of
 * those four places branches on a declared field rather than re-deriving it from
 * the manifest.
 */
export type CredentialKind = "secret" | "oauth";

/** The sign-in DASH would run for an OAuth target. */
export interface OAuthTarget {
  /** `OAuthProvider.id`, e.g. `google`. */
  provider_id: string;
  /**
   * The scopes the manifest declared, already checked against the provider's
   * allowlist. Never rendered — `describePermissions` turns them into sentences.
   */
  scopes: string[];
}

export interface CredentialTarget {
  kind: CredentialKind;
  /** Present exactly when `kind` is `oauth`. */
  oauth: OAuthTarget | null;
  agent_id: string;
  connection_id: string;
  field_id: string;
  /** Friendly connection name, for the prompt's title. Never an id. */
  service: string;
  /** Friendly field name, e.g. "API key". */
  field_label: string;
  /** Why the agent says it needs this. Rendered in the prompt. */
  purpose: string;
  /** Optional author-written guidance, e.g. where to find the key. */
  help: string | null;
  /** The vault key. A name, not a value. */
  secret_name: string;
  /**
   * The variable this becomes in the agent's process, or null when the manifest
   * declared no delivery target.
   *
   * Null is not a refusal. An agent may legitimately want DASH to hold a
   * credential it fetches some other way later; what it may not do is name a
   * variable DASH refuses to write, which is a refusal above.
   */
  environment_name: string | null;
}

export type CredentialTargetResolution =
  | { ok: true; target: CredentialTarget }
  | { ok: false; refusal: CredentialTargetRefusal; ownership?: ManifestConnection["ownership"] };

function findConnection(
  manifest: ConnectionSourceManifest,
  connectionId: string,
): ManifestConnection | undefined {
  return manifest.agent_dom?.connections?.find((connection) => connection.id === connectionId);
}

function findField(
  connection: ManifestConnection,
  fieldId: string,
): ManifestConnectionField | undefined {
  return connection.fields.find((field) => field.id === fieldId);
}

/**
 * Decide whether DASH may hold a secret for one declared field.
 *
 * The order of the checks is the order a user would ask the questions, and each
 * one is answered from the manifest alone — never from what happens to be in the
 * vault already. A target that resolves is a target the *agent asked for*, which
 * is what stops the Connection Center from becoming a place to stash arbitrary
 * secrets against an agent's name.
 */
export function resolveCredentialTarget(
  agentId: string,
  manifest: ConnectionSourceManifest,
  connectionId: string,
  fieldId: string,
): CredentialTargetResolution {
  const connection = findConnection(manifest, connectionId);
  if (connection === undefined) {
    // Covers the derived model-provider row too: it has no manifest entry by
    // construction, so it can never resolve to a target. That is the correct
    // answer rather than a special case — DASH inferred that row, and taking a
    // credential for something nobody declared is exactly the guessing
    // `lib/connections.ts` refuses to do.
    return { ok: false, refusal: "unknown_connection" };
  }

  if (connection.ownership !== "dash_managed") {
    return { ok: false, refusal: "not_dash_managed", ownership: connection.ownership };
  }

  const field = findField(connection, fieldId);
  if (field === undefined) {
    return { ok: false, refusal: "unknown_field" };
  }

  // MAR-446. An `oauth_reauthorization` field used to land in the refusal below
  // unconditionally, because DASH had no authorization flow and a masked text
  // box taking a pasted token DASH could never refresh would have been a worse
  // answer than an honest no. It now asks three questions first, and the honest
  // no survives all three as the default: a provider with no flow is refused in
  // exactly the words it was before.
  let oauth: OAuthTarget | null = null;
  if (field.kind === "oauth_reauthorization") {
    const provider = oauthProviderFor(connection.provider);
    if (provider === null) {
      return { ok: false, refusal: "no_oauth_flow" };
    }

    const scopes = field.technical?.provider_scopes ?? [];
    if (scopes.length === 0) {
      // Refused rather than defaulted. DASH could pick a reasonable set for
      // Gmail, and picking it would be DASH deciding what an agent may read —
      // the same guessing `lib/connections.ts` refuses when it declines to
      // infer a connection from a value. An empty list is a manifest that has
      // not said, and a consent screen for access nobody declared is the one
      // outcome worth making impossible.
      return { ok: false, refusal: "oauth_scopes_not_declared" };
    }

    if (checkRequestedScopes(provider, scopes).length > 0) {
      // A manifest is the agent author's file. Without this, one could name
      // full mailbox access, DASH would request it, and the checklist above
      // would go on describing whatever the connection's friendly capability
      // labels said — a consent screen and a checklist that disagree, with DASH
      // vouching for both.
      return { ok: false, refusal: "oauth_scope_not_allowed" };
    }

    oauth = { provider_id: provider.id, scopes: [...scopes] };
  } else if (field.kind !== "secret") {
    return { ok: false, refusal: "not_a_secret_field" };
  }

  const declared = field.technical?.environment_name;
  if (declared !== undefined) {
    const refusal = checkEnvironmentName(declared);
    if (refusal !== null) {
      return { ok: false, refusal };
    }
  }

  return {
    ok: true,
    target: {
      kind: oauth === null ? "secret" : "oauth",
      oauth,
      agent_id: agentId,
      connection_id: connection.id,
      field_id: field.id,
      service: connection.label,
      field_label: field.label,
      purpose: field.purpose,
      help: field.help ?? null,
      secret_name: connectionSecretName(agentId, connection.id, field.id),
      environment_name: declared ?? null,
    },
  };
}

/**
 * Every field of this manifest that DASH may hold a credential for.
 *
 * Used two ways: to decide which Connection Center rows get a Connect button,
 * and — at spawn — to know which vault entries to look for. Both callers ask the
 * *manifest*, so a credential left in the vault by a manifest that has since
 * stopped declaring the field is not delivered to anything. The vault is not the
 * list of what to deliver; the manifest is.
 */
export function connectableFields(
  agentId: string,
  manifest: ConnectionSourceManifest,
): CredentialTarget[] {
  const targets: CredentialTarget[] = [];
  for (const connection of manifest.agent_dom?.connections ?? []) {
    for (const field of connection.fields) {
      const resolved = resolveCredentialTarget(agentId, manifest, connection.id, field.id);
      if (resolved.ok) {
        targets.push(resolved.target);
      }
    }
  }
  return targets;
}

/**
 * The subset of `connectableFields` that names somewhere to be delivered.
 *
 * Separate from `connectableFields` so the spawn path cannot accidentally
 * iterate the wider set: a target with a null `environment_name` is one DASH
 * holds and does not hand over, and the difference should be a filter someone
 * wrote rather than a null check someone forgot.
 *
 * Both kinds appear here, and the caller must still branch: an API-key target
 * delivers the stored value, an OAuth target delivers a short-lived access token
 * minted at spawn from a refresh token that never leaves DASH (MAR-446). What
 * they share is that the manifest named somewhere to put it, which is what this
 * filter is about.
 */
export function deliverableFields(
  agentId: string,
  manifest: ConnectionSourceManifest,
): Array<CredentialTarget & { environment_name: string }> {
  return connectableFields(agentId, manifest).filter(
    (target): target is CredentialTarget & { environment_name: string } =>
      target.environment_name !== null,
  );
}
