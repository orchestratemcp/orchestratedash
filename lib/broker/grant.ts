/**
 * Which operations one agent may actually perform against one connection, and
 * the card a person approves (MAR-458, ADR 0002).
 *
 * ## The rule
 *
 * An operation is granted when **three independent parties all say yes**:
 *
 * 1. **DASH** — the operation is in `lib/broker/operations.ts`. Nothing else
 *    exists, whatever anyone asks for.
 * 2. **The agent's author** — every scope the operation needs is in the
 *    manifest's declared `provider_scopes` for that connection. An agent gets no
 *    access it did not describe in the document DASH holds it to.
 * 3. **The user, through the provider** — every scope the operation needs is in
 *    the credential the provider actually issued. A consent screen has
 *    checkboxes, so what was asked for and what was granted are different lists,
 *    and only the second one is a fact.
 *
 * Intersecting rather than picking one is the whole design. Any single source
 * would be wrong in a way the other two catch: DASH alone ignores what the user
 * agreed to, the manifest alone lets an agent author widen its own access, and
 * the credential alone is the raw-token model ADR 0002 exists to end.
 *
 * ## What this makes true about `gmail.compose`
 *
 * A user may grant it — the meeting-assistant example asks for it, and Google's
 * scope really does permit sending. Until MAR-469, step 1 found no operation
 * that required it, so it contributed nothing to the granted set: live at
 * Google, dead at the broker.
 *
 * Stage 2 built exactly one thing on it, `gmail.draft.create`, and ADR 0002
 * invariant 6 is unchanged by that — "the fact that Google's `gmail.compose`
 * scope can technically send does not enlarge the broker's operation set" is a
 * statement about *sending*, and the operation set still contains nothing that
 * sends.
 *
 * What did change is which sentence has to say so. A scope nothing uses shows up
 * in `unused_scopes`, and the card admits DASH offers no action for it. A scope
 * something uses does not — so the disclosure would have disappeared from the
 * card at the moment it started to matter, which is why `describeGrant` now
 * carries `wider_permission_sentence` as well. The honest half is unchanged and
 * is now the more important half: a user who granted `gmail.compose` **has**
 * given Google's permission to send mail as them, to whatever holds a token.
 * DASH's answer is not that the permission is narrower than it is; it is that
 * DASH never gives the agent anything that could use it.
 *
 * Pure, like every other module in this directory: a manifest and a credential
 * in, a decision out. No vault, no network, no clock.
 */

import type { AiKeyCredential } from "../ai/credential";
import type { ConnectionSourceManifest, ManifestConnection, ManifestConnectionField } from "../connections";
import type { OAuthCredential } from "../oauth/credential";
import { operationsForProvider, type BrokerOperation } from "./operations";
import {
  brokerProfileFor,
  describeClientOwner,
  describeCustody,
  describeKeyNarrowing,
  operationProviderFor,
  type BrokerProviderProfile,
} from "./providers";

/**
 * A credential the broker can act on (MAR-582).
 *
 * A discriminated union rather than a widened `OAuthCredential`, so every place
 * that reads `scopes` has to say what it does when there are none. The two are
 * told apart by `kind`, which only the key envelope carries — see
 * `lib/ai/credential.ts` on why that discriminator exists at all, and on the
 * confusion between the two that this union makes unrepresentable.
 */
export type BrokerCredential = OAuthCredential | AiKeyCredential;

/** Is this a pasted provider key rather than a sign-in DASH negotiated? */
export function isKeyCredential(credential: BrokerCredential): credential is AiKeyCredential {
  return "kind" in credential && credential.kind === "ai_provider_key";
}

/**
 * Whose account this credential belongs to, or null when it does not say.
 *
 * Always null for a key, and that is a fact rather than a gap: a provider key is
 * an opaque string that identifies nobody. The audit's `account_hint` is
 * therefore empty for every keyed call, which is the honest answer — deriving
 * one from the key would put four characters of a live secret into a durable
 * table to answer a question the key cannot answer.
 */
export function credentialAccount(credential: BrokerCredential): string | null {
  return isKeyCredential(credential) ? null : credential.account;
}

/** Why an agent has no brokered access to something it named. */
export type GrantRefusal =
  /** The manifest declares no connection with this id. */
  | "unknown_connection"
  /** The connection is real and someone other than DASH holds its credential. */
  | "not_dash_managed"
  /** DASH brokers nothing for this provider. */
  | "no_broker_profile"
  /** The connection declares no OAuth field, so there is no grant to resolve. */
  | "no_oauth_field"
  /**
   * The connection declares no single required secret field, so there is
   * nowhere for a provider key to live (MAR-582).
   *
   * Its own code rather than reusing `no_oauth_field`, because the fix differs:
   * one manifest is missing a sign-in declaration and the other is missing a key
   * field, and a refusal that named the wrong one would send an author to the
   * wrong line of their own document.
   */
  | "no_key_field"
  /**
   * The stored credential is the wrong kind for this connection (MAR-582).
   *
   * A sign-in envelope under a connection whose manifest now declares a key, or
   * the reverse. Reachable when an author changes a field's kind between
   * exports, and refused rather than coerced: the alternative is presenting a
   * refresh token to a model provider as a bearer key.
   */
  | "credential_kind_mismatch"
  /** DASH holds no credential for it yet. */
  | "not_connected"
  /**
   * Everything resolved and the intersection was empty.
   *
   * Its own code rather than an empty success, because it is the case a user can
   * act on: they granted something, and none of it reaches an operation. A
   * connection that renders as "connected" while every call is refused is the
   * confusing outcome this exists to name.
   */
  | "no_operations_granted";

/**
 * One granted operation, as a card line and as an authorization fact.
 *
 * `label` is what a person reads. `id` is what an agent names. They are kept
 * together so a card and an allowlist can never drift into describing different
 * sets — the card is rendered *from* the grant, not written beside it.
 */
export interface GrantedOperation {
  id: string;
  label: string;
  access: "read" | "write";
  /**
   * What a person will be able to see and do because this ran, or null for a
   * read (MAR-469).
   *
   * Carried on the granted operation rather than looked up beside it, for the
   * reason `label` is: a card rendered from the grant cannot describe a
   * different set from the one the broker will honour. A write whose
   * consequence went missing between here and the page would be a capability
   * list that reads like a read, which is the failure this field exists to stop.
   */
  consequence: string | null;
}

export interface BrokerGrant {
  agent_id: string;
  connection_id: string;
  field_id: string;
  profile: BrokerProviderProfile;
  /** The vault key the credential lives under. A name, never a value. */
  secret_name: string;
  /** The account that granted it, as stored. Null when the provider did not say. */
  account: string | null;
  operations: GrantedOperation[];
  /**
   * Scopes the user granted that no operation uses.
   *
   * Surfaced rather than dropped: this is the list that makes the
   * `gmail.compose` story checkable instead of asserted, and the card says out
   * loud that DASH asked for something it then builds nothing on.
   */
  unused_scopes: string[];
  /**
   * Scopes an operation would need that the credential does not carry.
   *
   * Drives the reconnect prompt. An agent whose search is refused because the
   * user unticked a box deserves a sentence about the box, not a failure.
   */
  missing_scopes: string[];
}

export type GrantResolution =
  | { ok: true; grant: BrokerGrant }
  | { ok: false; refusal: GrantRefusal; missing_scopes?: string[] };

/** Everything about a brokered connection that is knowable without a credential. */
export interface BrokeredField {
  connection: ManifestConnection;
  field_id: string;
  declared_scopes: string[];
  profile: BrokerProviderProfile;
}

export type BrokeredFieldResolution =
  | { ok: true; field: BrokeredField }
  | { ok: false; refusal: GrantRefusal };

function findConnection(
  manifest: ConnectionSourceManifest,
  connectionId: string,
): ManifestConnection | undefined {
  return manifest.agent_dom?.connections?.find((connection) => connection.id === connectionId);
}

/**
 * The one field of this connection a brokered credential lives in, or null.
 *
 * A connection with two fields of the wanted kind is not modelled and is refused
 * rather than guessed at: which of them a credential belongs to would be DASH's
 * choice, and a credential filed against the wrong field is one a disconnect
 * would not delete.
 *
 * Which kind is wanted comes from the **profile**, not from the manifest
 * (MAR-582). That direction matters: DASH decides how it holds a credential for
 * a given provider, and a manifest that declared a pasted key for a connection
 * DASH signs into would otherwise choose the weaker of the two custody models
 * for itself.
 */
function brokeredCredentialField(
  connection: ManifestConnection,
  profile: BrokerProviderProfile,
): { id: string; scopes: string[] } | null {
  const wanted: ManifestConnectionField["kind"] =
    profile.credential_kind === "provider_key" ? "secret" : "oauth_reauthorization";
  const fields = connection.fields.filter((field) => field.kind === wanted);
  const only = fields.length === 1 ? fields[0] : undefined;
  if (only === undefined) {
    return null;
  }
  return { id: only.id, scopes: [...(only.technical?.provider_scopes ?? [])] };
}

/** The refusal for a connection with no usable field, worded by what is missing. */
function noFieldRefusal(profile: BrokerProviderProfile): GrantRefusal {
  return profile.credential_kind === "provider_key" ? "no_key_field" : "no_oauth_field";
}

/**
 * Everything the manifest alone decides about a brokered connection.
 *
 * Split out because the caller has a chicken-and-egg problem: the vault key is
 * `dash.connection.{agent}.{connection}.{field}`, so reading the credential
 * needs the field id, and resolving the grant needs the credential. This answers
 * the first half without one, and `resolveGrant` re-derives it — the lookup is a
 * `find` over a handful of array entries, and two callers agreeing by
 * construction is worth more than one saved comparison.
 */
export function brokeredField(
  manifest: ConnectionSourceManifest,
  connectionId: string,
): BrokeredFieldResolution {
  const connection = findConnection(manifest, connectionId);
  if (connection === undefined) {
    return { ok: false, refusal: "unknown_connection" };
  }
  if (connection.ownership !== "dash_managed") {
    return { ok: false, refusal: "not_dash_managed" };
  }
  const profile = brokerProfileFor(connection.provider);
  if (profile === null) {
    return { ok: false, refusal: "no_broker_profile" };
  }
  const field = brokeredCredentialField(connection, profile);
  if (field === null) {
    return { ok: false, refusal: noFieldRefusal(profile) };
  }
  return {
    ok: true,
    field: { connection, field_id: field.id, declared_scopes: field.scopes, profile },
  };
}

/**
 * Resolve what an agent may do, from the manifest and the stored credential.
 *
 * `credential` is null when DASH holds nothing, which is a refusal rather than
 * an empty grant — the difference between "you have not connected this" and "you
 * connected it and it grants nothing" is the difference between two recoveries.
 *
 * Called on **every** brokered request, never cached. A grant is a function of a
 * manifest that can be re-imported and a credential that can be revoked between
 * two calls a second apart, so a cached grant is a grant that outlives the
 * consent behind it.
 */
export function resolveGrant(
  agentId: string,
  manifest: ConnectionSourceManifest,
  connectionId: string,
  credential: BrokerCredential | null,
  secretName: string,
): GrantResolution {
  const connection = findConnection(manifest, connectionId);
  if (connection === undefined) {
    return { ok: false, refusal: "unknown_connection" };
  }
  if (connection.ownership !== "dash_managed") {
    // A connection the agent or an external manager holds is one DASH has no
    // credential for and brokers nothing on. Refusing here rather than falling
    // through to "not connected" keeps the two apart: one is a state the user
    // can change, and the other is what the manifest says.
    return { ok: false, refusal: "not_dash_managed" };
  }

  const profile = brokerProfileFor(connection.provider);
  if (profile === null) {
    return { ok: false, refusal: "no_broker_profile" };
  }

  const field = brokeredCredentialField(connection, profile);
  if (field === null) {
    return { ok: false, refusal: noFieldRefusal(profile) };
  }
  if (credential === null) {
    return { ok: false, refusal: "not_connected" };
  }

  // The two kinds must agree before anything is read out of the credential. A
  // mismatch here is a manifest whose field kind changed under a stored value,
  // and coercing it would mean presenting one provider's credential to another
  // (MAR-582). Written as two checks around the narrowing rather than one
  // equality, so the compiler carries the distinction into the branches instead
  // of a reader having to.
  if (isKeyCredential(credential)) {
    return profile.credential_kind === "provider_key"
      ? resolveKeyGrant(agentId, connectionId, field.id, profile, secretName)
      : { ok: false, refusal: "credential_kind_mismatch" };
  }
  if (profile.credential_kind === "provider_key") {
    return { ok: false, refusal: "credential_kind_mismatch" };
  }

  const declared = new Set(field.scopes);
  const granted = new Set(credential.scopes);

  const candidates = operationsForProvider(operationProviderFor(profile));
  const operations: GrantedOperation[] = [];
  const missing = new Set<string>();

  for (const operation of candidates) {
    // Step 2 before step 3, so an operation the agent never asked for does not
    // report the user's consent as "missing". A scope is only missing when
    // something actually wanted it.
    if (!operation.required_scopes.every((scope) => declared.has(scope))) {
      continue;
    }
    const absent = operation.required_scopes.filter((scope) => !granted.has(scope));
    if (absent.length > 0) {
      for (const scope of absent) {
        missing.add(scope);
      }
      continue;
    }
    operations.push({
      id: operation.id,
      label: operation.label,
      access: operation.access,
      consequence: operation.access === "write" ? operation.consequence : null,
    });
  }

  if (operations.length === 0) {
    return { ok: false, refusal: "no_operations_granted", missing_scopes: [...missing] };
  }

  const used = new Set(
    operations.flatMap((granted_operation) =>
      candidates
        .filter((operation) => operation.id === granted_operation.id)
        .flatMap((operation) => [...operation.required_scopes]),
    ),
  );

  return {
    ok: true,
    grant: {
      agent_id: agentId,
      connection_id: connectionId,
      field_id: field.id,
      profile,
      secret_name: secretName,
      account: credential.account,
      // Write operations first, for the reason `describePermissions` orders a
      // consent screen that way: the line worth reading should not be under the
      // line that is not.
      operations: [
        ...operations.filter((operation) => operation.access === "write"),
        ...operations.filter((operation) => operation.access === "read"),
      ],
      unused_scopes: credential.scopes.filter(
        (scope) => !used.has(scope) && declared.has(scope),
      ),
      missing_scopes: [...missing],
    },
  };
}

/**
 * What a pasted key grants (MAR-582).
 *
 * **Two of the three parties, and the missing one is named rather than
 * simulated.** DASH's half is real and is the whole of the narrowing: the
 * operations below are the ones this file's own list holds for the provider, and
 * nothing else can be reached with the key however it is asked for. The author's
 * half is real too, in the weaker sense that the manifest had to declare the
 * connection at all for any of this to resolve.
 *
 * The user's half does not exist. There is no consent screen, no scope, and
 * nothing on the credential that could be intersected — so `unused_scopes` and
 * `missing_scopes` are empty because there is nothing to compare, not because
 * everything matched. A reader of a grant cannot tell those two apart from the
 * arrays alone, which is exactly why `describeKeyNarrowing` exists and why
 * `describeGrant` puts its sentence on every card built from one of these.
 *
 * `account` is null. A key does not say whose it is, and a masked hint derived
 * from the key itself would answer "which of my accounts is this" with four
 * characters of a secret — the mistake `maskAccount` was added to stop.
 */
function resolveKeyGrant(
  agentId: string,
  connectionId: string,
  fieldId: string,
  profile: BrokerProviderProfile,
  secretName: string,
): GrantResolution {
  const operations: GrantedOperation[] = operationsForProvider(
    operationProviderFor(profile),
  ).map((operation) => ({
    id: operation.id,
    label: operation.label,
    access: operation.access,
    consequence: operation.access === "write" ? operation.consequence : null,
  }));

  if (operations.length === 0) {
    // A profile DASH has built nothing on. Reported as the same code an empty
    // OAuth intersection produces, because it is the same fact from the user's
    // side — the connection is real and reaches no action.
    return { ok: false, refusal: "no_operations_granted", missing_scopes: [] };
  }

  return {
    ok: true,
    grant: {
      agent_id: agentId,
      connection_id: connectionId,
      field_id: fieldId,
      profile,
      secret_name: secretName,
      account: null,
      operations: [
        ...operations.filter((operation) => operation.access === "write"),
        ...operations.filter((operation) => operation.access === "read"),
      ],
      unused_scopes: [],
      missing_scopes: [],
    },
  };
}

/**
 * What a keyed connection grants, **without reading the key** (MAR-582).
 *
 * Not a convenience. It is the statement that a provider key contributes nothing
 * to the decision: the operations DASH will perform with one are a function of
 * the manifest and this repository's own list, and the credential is only ever
 * the thing that authorizes the request afterwards. `resolveGrant` needs a
 * credential because the OAuth half genuinely reads scopes off it; this half
 * never could, and a caller made to produce a credential-shaped object in order
 * to ask would be a caller inventing one.
 *
 * Used where a receipt is written — the moment a key is stored, before anything
 * has been done with it — and it resolves the same grant the broker itself would
 * for the same connection, which is what stops a card listing something a
 * request would then be refused.
 *
 * Refuses a connection whose profile is a sign-in, because the answer for one of
 * those is genuinely unknowable without the credential.
 */
export function resolveKeyGrantWithoutCredential(
  agentId: string,
  manifest: ConnectionSourceManifest,
  connectionId: string,
  secretName: string,
): GrantResolution {
  const connection = findConnection(manifest, connectionId);
  if (connection === undefined) {
    return { ok: false, refusal: "unknown_connection" };
  }
  if (connection.ownership !== "dash_managed") {
    return { ok: false, refusal: "not_dash_managed" };
  }
  const profile = brokerProfileFor(connection.provider);
  if (profile === null) {
    return { ok: false, refusal: "no_broker_profile" };
  }
  if (profile.credential_kind !== "provider_key") {
    return { ok: false, refusal: "credential_kind_mismatch" };
  }
  const field = brokeredCredentialField(connection, profile);
  if (field === null) {
    return { ok: false, refusal: "no_key_field" };
  }
  return resolveKeyGrant(agentId, connectionId, field.id, profile, secretName);
}

/** Is this operation one this grant covers? The allowlist check, by id. */
export function grants(grant: BrokerGrant, operationId: string): boolean {
  return grant.operations.some((operation) => operation.id === operationId);
}

/* ---------------------------------------------------------------------- *
 * The card
 * ---------------------------------------------------------------------- */

/**
 * What a person sees and approves, for a native OAuth connection or — when one
 * exists — an authenticated MCP server.
 *
 * Conforms to `contracts/connection-capability.schema.json`, which is the shared
 * grammar ADR 0002 asks the two kinds to render through. Everything here is
 * plain language or a stable id; `lib/copy/identifiers.ts`'s rule holds, so no
 * raw provider scope appears in any field a surface renders.
 */
export interface CapabilityCard {
  connection_id: string;
  service: string;
  requesting_agent: string;
  token_custodian: string;
  custody_sentence: string;
  /** Whose consent screen this connection uses, or null when not OAuth. */
  client_sentence: string | null;
  capabilities: GrantedOperation[];
  /**
   * The sentence about granted-but-unused provider permissions, or null.
   *
   * This is the one line on the card that admits DASH asked for more than it
   * uses. Leaving it off would make the card technically true and practically
   * misleading, which is the failure mode `PROJECT_STATE.md` records for
   * `network: read`: a declaration DASH renders is not a boundary DASH enforces,
   * and every surface has to say which it is.
   */
  unused_permission_sentence: string | null;
  /**
   * How the provider permissions behind the granted *write* actions are wider
   * than the actions themselves, or null when nothing here writes (MAR-469).
   *
   * The line `unused_permission_sentence` used to carry for Gmail, and no longer
   * can. Until stage 2, `gmail.compose` reached no operation, so it appeared in
   * `unused_scopes` and the card said DASH offers no action for it — true, and
   * the whole disclosure. Now it reaches one, so it is a *used* scope, and the
   * uncomfortable half of it would have silently vanished from the card at
   * exactly the moment it started to matter.
   *
   * So it gets its own sentence, sourced from the operation rather than written
   * here: `WriteOperation.wider_permission` is a required field, which means a
   * future write cannot be added without someone answering the question this
   * line asks.
   */
  wider_permission_sentence: string | null;
  /**
   * How much of the three-party check this connection actually got, or null
   * when it got all of it (MAR-582).
   *
   * Required-and-nullable, in `wider_permission_sentence`'s shape and for its
   * reason: the fact this line carries is uncomfortable and specific to one
   * custody model, and a card that could omit it would omit it exactly when a
   * second keyed provider arrived and nobody remembered. `describeKeyNarrowing`
   * writes it; a signed-in connection gets null and says nothing.
   */
  key_narrowing_sentence: string | null;
}

/**
 * Turn a grant into the card.
 *
 * `describeUnused` is deliberately given the *count* rather than the scope
 * names: naming `https://www.googleapis.com/auth/gmail.compose` at a user is
 * exactly the identifier leak `lib/copy/identifiers.ts` forbids, and the fact
 * worth communicating is that something was granted which no capability below
 * uses — not which URL it was.
 */
export function describeGrant(grant: BrokerGrant, displayName: string): CapabilityCard {
  const unusedCount = grant.unused_scopes.length;
  return {
    wider_permission_sentence: widerPermissionSentence(grant),
    key_narrowing_sentence: describeKeyNarrowing(grant.profile),
    connection_id: grant.connection_id,
    service: grant.profile.label,
    requesting_agent: displayName,
    token_custodian: grant.profile.token_custodian,
    custody_sentence: describeCustody(grant.profile),
    client_sentence: describeClientOwner(grant.profile),
    capabilities: grant.operations,
    unused_permission_sentence:
      unusedCount === 0
        ? null
        : `You granted ${String(unusedCount)} further permission${unusedCount === 1 ? "" : "s"} that ${grant.profile.label} allows and DASH offers no action for. ` +
          `The agent cannot use ${unusedCount === 1 ? "it" : "them"} through DASH, and you can withdraw ${unusedCount === 1 ? "it" : "them"} in your account settings.`,
  };
}

/**
 * The wider-permission disclosure for whatever writes this grant covers
 * (MAR-469), or null.
 *
 * Deduplicated, because two write operations built on `gmail.compose` would
 * otherwise say the same uncomfortable thing twice and a user would read it
 * once. Ordered by the operation list, which puts writes first.
 *
 * Reads contribute nothing here even when their scope is arguably wide, and that
 * is deliberate: this line is about an action that changes something, and
 * diluting it with "reading your mail lets it read your mail" is how a warning
 * stops being read.
 */
function widerPermissionSentence(grant: BrokerGrant): string | null {
  const candidates = operationsForProvider(operationProviderFor(grant.profile));
  const sentences: string[] = [];
  for (const granted of grant.operations) {
    if (granted.access !== "write") {
      continue;
    }
    const operation = candidates.find((entry) => entry.id === granted.id);
    if (operation === undefined || operation.access !== "write") {
      continue;
    }
    if (operation.wider_permission !== null && !sentences.includes(operation.wider_permission)) {
      sentences.push(operation.wider_permission);
    }
  }
  return sentences.length === 0 ? null : sentences.join(" ");
}

/**
 * Every operation an agent's manifest asks for on this connection, granted or
 * not — for the card shown *before* a sign-in, when there is no credential yet.
 *
 * Distinct from `resolveGrant` because it answers a different question: not
 * "what may this agent do now", which needs a credential, but "what is this
 * agent asking to be able to do", which is answerable from the manifest alone.
 * A user deciding whether to connect needs the second one.
 */
export function requestedOperations(
  manifest: ConnectionSourceManifest,
  connectionId: string,
): BrokerOperation[] {
  const connection = findConnection(manifest, connectionId);
  if (connection === undefined) {
    return [];
  }
  const profile = brokerProfileFor(connection.provider);
  if (profile === null) {
    return [];
  }
  const field = brokeredCredentialField(connection, profile);
  if (field === null) {
    return [];
  }
  // A key field declares no scopes, and every model-provider operation requires
  // none — so the filter below passes them all, which is the right answer rather
  // than a coincidence: what a keyed connection asks for is everything DASH has
  // built for that provider (MAR-582). `describeKeyNarrowing` is what stops that
  // reading as a permission the user chose.
  const declared = new Set(field.scopes);
  return operationsForProvider(operationProviderFor(profile)).filter((operation) =>
    operation.required_scopes.every((scope) => declared.has(scope)),
  );
}

/**
 * The other half of the same list: every operation **DASH offers** for this
 * connection's provider that the manifest did *not* ask for (MAR-533).
 *
 * `requestedOperations` above is already an intersection — DASH's operation set
 * meets the manifest's declared scopes — so from a card's point of view two of
 * the three parties in a grant are indistinguishable inside it. That is fine for
 * a list of what an agent may do and useless for explaining *why* it may do it,
 * which is what the Connections page now has to do for somebody who has never
 * heard of OAuth.
 *
 * The difference is what makes the explanation checkable rather than a slogan.
 * "Send an email" appearing here, on a Gmail connection, is DASH saying: this is
 * an action we have never built, and it would still not happen if you granted
 * every permission Google has. That is a stronger and more surprising statement
 * than any reassurance, and it is one this repository can be held to — the list
 * is `lib/broker/operations.ts` and nothing else.
 *
 * Complement rather than a second filter, so the two lists cannot overlap and
 * cannot both miss an operation: every operation for the provider is in exactly
 * one of them.
 */
export function unrequestedOperations(
  manifest: ConnectionSourceManifest,
  connectionId: string,
): BrokerOperation[] {
  const connection = findConnection(manifest, connectionId);
  if (connection === undefined) {
    return [];
  }
  const profile = brokerProfileFor(connection.provider);
  if (profile === null) {
    return [];
  }
  const asked = new Set(requestedOperations(manifest, connectionId).map((one) => one.id));
  return operationsForProvider(operationProviderFor(profile)).filter(
    (operation) => !asked.has(operation.id),
  );
}
