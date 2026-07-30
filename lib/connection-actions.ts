/**
 * Connect, test and disconnect — the three things a user can do to a credential
 * DASH holds (MAR-383).
 *
 * This is the layer between `lib/shell/ipc.ts`, which decided a command was
 * well-formed, and `lib/vault.ts`, which holds the bytes. It exists as its own
 * module, in `lib/` and not `electron/`, for the reason the rest of `lib/shell`
 * does: the decisions here — what counts as connected, which failure gets which
 * sentence, what a disconnect must delete and in which order — are exactly the
 * ones worth testing without launching Electron.
 *
 * ## What crosses back
 *
 * A state, a masked hint and a `Recovery`. Never the value, and never anything
 * computed from the value at read time: the hint returned by `connect` is the
 * one `maskSecret` produced at the moment the user typed it, and `test` returns
 * the hint already on the row rather than re-deriving one. Nothing in this file
 * reads a secret in order to display it — `test` reads one to find out whether
 * the read *works*, and drops it.
 *
 * ## Why `test` does not contact the provider
 *
 * It cannot, honestly. DASH holds an opaque string for a service it has no
 * client for; there is no request it could make that would distinguish a good
 * key from a bad one. What it *can* answer is whether the credential is still
 * there and still readable — which is a real question with three real answers
 * (gone, locked, present) and three different recoveries. The command's `effect`
 * string says exactly that, and the copy below never claims the provider
 * accepted anything.
 *
 * Whether the *provider* is happy is a question only the agent can answer, and
 * it already does: `agent-dom-state.schema.json` carries a per-connection health
 * that the workspace renders through `describeConnectionCondition`. Those two
 * facts stay separate because they fail separately.
 */

import type { CredentialTarget, CredentialTargetRefusal } from "./connection-credentials";
import { resolveCredentialTarget } from "./connection-credentials";
import type { ConnectionSourceManifest, ManifestConnection } from "./connections";
import {
  describeAuthorizationFailure,
  describeSecureStoreFailure,
  type AuthorizationFailureCode,
  type Recovery,
} from "./copy/recovery";
import {
  missingScopes,
  parseOAuthCredential,
  serializeOAuthCredential,
  type OAuthCredential,
} from "./oauth/credential";
import { describePermissions, oauthProviderById } from "./oauth/providers";
import {
  forgetSecretReference,
  listSecretReferences,
  maskAccount,
  maskSecret,
  recordSecretReference,
} from "./secret-refs";
import {
  assertCanHoldSecret,
  isSecureStoreError,
  SecureStoreError,
  type SecureStore,
} from "./secure-store";

/**
 * What DASH knows about one credential it may hold.
 *
 * `unknown` is not in this list. Every value is something DASH established by
 * asking the vault or the manifest, and a state that means "we did not look"
 * would end up rendered as if it meant "we looked and could not tell".
 */
export type CredentialState =
  /** The manifest declares it and the vault has nothing under its name. */
  | "not_connected"
  /** The vault holds it and DASH read it successfully. */
  | "connected"
  /** The vault holds it, but the OS would not open it just now. */
  | "locked"
  /** There is no usable vault on this machine, so DASH refuses to hold one. */
  | "unavailable"
  /**
   * The vault holds a sign-in the provider no longer honours (MAR-446).
   *
   * Separate from `not_connected` because the recoveries differ in a way that
   * matters: a credential that was never there invites a connection, and one
   * that was taken away invites a *decision*. Somebody withdrew this access, and
   * that somebody may have been the user on purpose — quietly re-offering
   * Connect as if nothing had happened would undo it without saying so.
   */
  | "revoked"
  /** DASH may not hold this one — agent-managed, external, or not declared. */
  | "not_held_by_dash";

export type ConnectionActionName = "connect" | "test" | "disconnect";

export interface ConnectionActionResult {
  ok: boolean;
  state: CredentialState;
  masked_hint: string | null;
  /** One sentence, safe to render. */
  detail: string;
  /** Present when the user has something to do about it. */
  recovery?: Recovery;
}

/**
 * Everything this module needs from the outside world.
 *
 * `promptForSecret` is the whole reason the interface exists. The real one
 * opens a window main owns; the test one returns a string. Neither this module
 * nor anything it calls can tell the difference, which is what makes "the
 * secret goes straight from the prompt to the vault" a property a test can
 * assert rather than a sequence a reviewer has to follow through Electron.
 */
export interface ConnectionActionDeps {
  store: SecureStore;
  /** The agent's validated manifest, or null when DASH has not imported one. */
  readManifest(agentId: string): ConnectionSourceManifest | null;
  /**
   * Ask the user for one secret. Resolves null when they cancel — a cancel is
   * an ordinary outcome and must not be reported as a failure.
   */
  promptForSecret(target: CredentialTarget, vaultLabel: string): Promise<string | null>;
  /**
   * The provider sign-in, for `oauth` targets only (MAR-446).
   *
   * Injected for the reason `promptForSecret` is: the real one opens a system
   * browser, binds a loopback port and talks to Google, and none of that can be
   * in the loop of a unit test asserting that a revoked grant produces the
   * revoked sentence. The fake returns an envelope; neither this module nor
   * anything it calls can tell the difference.
   */
  oauth: OAuthOperations;
}

/**
 * What a sign-in produced.
 *
 * A code rather than an error, so every path out of a provider flow is one the
 * caller must name — `lib/copy/recovery.ts` turns each into three sentences and
 * will not compile if a new one appears without them.
 */
export type AuthorizationOutcome =
  | { ok: true; credential: OAuthCredential }
  | { ok: false; code: AuthorizationFailureCode };

export interface OAuthOperations {
  /**
   * Run the sign-in and come back with something storable.
   *
   * `login_hint` is the account DASH already holds, when reconnecting. A
   * suggestion the user may override, and DASH records whichever account
   * actually came back rather than the one it proposed.
   */
  authorize(
    target: CredentialTarget,
    options: { login_hint: string | null },
  ): Promise<AuthorizationOutcome>;
  /**
   * Ask the provider whether a stored grant still works.
   *
   * This is the one place OAuth diverges from the API-key case on purpose. The
   * file header argues that `test` cannot honestly contact a provider DASH has
   * no client for — but for an OAuth connection DASH *is* a client, holds a
   * grant in its own name, and a token refresh is a real, cheap, side-effect-free
   * question with an unambiguous answer. Refusing to ask it here would mean
   * MAR-446's revoked-versus-expired requirement could never be met.
   */
  check(credential: OAuthCredential): Promise<{ ok: true } | { ok: false; code: AuthorizationFailureCode }>;
  /** Withdraw the grant at the provider. Best effort; returns whether it took. */
  revoke(credential: OAuthCredential): Promise<boolean>;
}

export interface ConnectionActionTarget {
  agent_id: string;
  connection_id: string;
  field_id: string;
}

/* ---------------------------------------------------------------------- *
 * Refusals
 * ---------------------------------------------------------------------- */

/**
 * Why DASH will not hold this one, said to the person looking at the row.
 *
 * Every branch names the connection the user can see rather than the id they
 * cannot, and none of them blames the user for a manifest they did not write.
 */
function refusalCopy(
  refusal: CredentialTargetRefusal,
  service: string,
  ownership: ManifestConnection["ownership"] | undefined,
): { detail: string; recovery?: Recovery } {
  switch (refusal) {
    case "not_dash_managed":
      return {
        detail:
          ownership === "external"
            ? `${service} is looked after by a separate password manager, so DASH does not keep a copy.`
            : `${service} is looked after by the agent itself, so DASH does not keep a copy.`,
      };

    case "no_oauth_flow":
      // MAR-383's OAuth deferral, now narrowed to the providers DASH genuinely
      // has no sign-in for. The words are unchanged from when it covered every
      // OAuth field, because for these connections the situation is unchanged.
      return {
        detail: `${service} signs in through its own provider, which DASH cannot do for you yet. The agent handles this sign-in.`,
      };

    case "not_a_secret_field":
      // A `non_secret` field. Nothing to hold, so nothing to offer.
      return {
        detail: `${service} needs no credential from you for this, so DASH stores nothing for it.`,
      };

    case "oauth_scopes_not_declared":
      return {
        detail: `DASH cannot sign you in to ${service} because the agent did not say what access it needs.`,
        recovery: {
          headline: `DASH will not ask ${service} for unspecified access.`,
          meaning:
            "The agent asks for a sign-in without saying what it wants to be able to do. DASH will not guess, because the guess would be what you were agreeing to.",
          next_action:
            "This needs a fix from whoever built the agent. Nothing was stored and nothing is at risk.",
          actor: "dash",
        },
      };

    case "oauth_scope_not_allowed":
      return {
        detail: `DASH will not ask ${service} for the access this agent wants.`,
        recovery: {
          headline: `The agent asks for more ${service} access than DASH offers.`,
          meaning:
            "DASH only asks for access it can describe to you in plain language on the sign-in screen. This agent wants something outside that list.",
          next_action:
            "This needs a fix from whoever built the agent. Nothing was stored and nothing is at risk.",
          actor: "dash",
        },
      };

    case "unknown_connection":
    case "unknown_field":
      return {
        detail: `This agent's manifest does not describe ${service} as something DASH can connect, so DASH will not store a credential for it.`,
      };

    case "reserved_environment_name":
    case "unsafe_environment_name":
    case "malformed_environment_name":
      return {
        detail: `The agent asked DASH to deliver its ${service} credential under a name DASH will not use.`,
        recovery: {
          headline: `DASH cannot connect ${service} safely.`,
          meaning:
            "The agent's manifest names an environment variable that DASH reserves, or that would change what the agent runs rather than what it connects to.",
          next_action:
            "This needs a fix from whoever built the agent. Nothing was stored and nothing is at risk.",
          actor: "dash",
        },
      };
  }
}

/* ---------------------------------------------------------------------- *
 * The action
 * ---------------------------------------------------------------------- */

function hintFor(target: ConnectionActionTarget): string | null {
  const reference = listSecretReferences(target.agent_id).find(
    (row) => row.connection_id === target.connection_id && row.field_id === target.field_id,
  );
  return reference?.masked_hint ?? null;
}

/**
 * Map a vault failure onto a state and the sentence that goes with it.
 *
 * The taxonomy is `SecureStoreErrorCode`'s and the words are
 * `describeSecureStoreFailure`'s; this only decides which of DASH's own states
 * each one means. Keeping the words there rather than here is what stops the
 * Connection Center and the workspace describing the same locked vault two
 * different ways.
 */
function fromStoreError(
  error: SecureStoreError,
  service: string,
  vault: string,
  hint: string | null,
): ConnectionActionResult {
  const recovery = describeSecureStoreFailure(error.code, { service, vault });
  const state: CredentialState =
    error.code === "not_found"
      ? "not_connected"
      : error.code === "vault_locked"
        ? "locked"
        : "unavailable";
  return { ok: false, state, masked_hint: hint, detail: recovery.headline, recovery };
}

export async function performConnectionAction(
  action: ConnectionActionName,
  target: ConnectionActionTarget,
  deps: ConnectionActionDeps,
): Promise<ConnectionActionResult> {
  const manifest = deps.readManifest(target.agent_id);
  if (manifest === null) {
    return {
      ok: false,
      state: "not_held_by_dash",
      masked_hint: null,
      detail: "DASH has not imported this agent's manifest, so it does not know what it connects to.",
    };
  }

  const resolved = resolveCredentialTarget(
    target.agent_id,
    manifest,
    target.connection_id,
    target.field_id,
  );

  if (!resolved.ok) {
    // Named from the manifest where possible so the sentence says "Gmail"
    // rather than "gmail", and falls back to the id only when the connection is
    // not in the manifest at all — in which case there is no friendly name to
    // use and pretending otherwise would invent one.
    const declared = manifest.agent_dom?.connections?.find(
      (connection) => connection.id === target.connection_id,
    );
    const service = declared?.label ?? target.connection_id;
    const { detail, recovery } = refusalCopy(resolved.refusal, service, resolved.ownership);
    return { ok: false, state: "not_held_by_dash", masked_hint: null, detail, recovery };
  }

  const credential = resolved.target;
  const backing = deps.store.describeBacking();

  if (credential.kind === "oauth") {
    return performOAuthAction(action, credential, backing.label, deps);
  }

  if (action === "disconnect") {
    // Vault first, then the row. The other order would leave a credential in
    // the vault that nothing in DASH remembers or can ever delete — an orphan
    // with no owner and no UI. Deleting the row after a failed vault delete
    // would do exactly that, so the row is only forgotten once the value is
    // actually gone.
    try {
      await deps.store.delete(credential.secret_name);
    } catch (error: unknown) {
      if (isSecureStoreError(error) && error.code !== "not_found") {
        return fromStoreError(error, credential.service, backing.label, hintFor(target));
      }
      // `not_found` is not a failure to disconnect. The user asked for the
      // credential to be gone and it is gone; forgetting the row below makes
      // DASH's record agree with the vault rather than arguing with it.
    }
    forgetSecretReference(target.agent_id, target.connection_id, target.field_id);
    return {
      ok: true,
      state: "not_connected",
      masked_hint: null,
      detail: `${credential.service} is disconnected. DASH deleted its copy of the ${credential.field_label.toLowerCase()} from ${backing.label}.`,
    };
  }

  if (action === "test") {
    try {
      // Read and drop. The value is never returned, never logged, never
      // compared, and never stored anywhere by this call — the only thing kept
      // is whether the read succeeded.
      await deps.store.get(credential.secret_name);
    } catch (error: unknown) {
      if (isSecureStoreError(error)) {
        return fromStoreError(error, credential.service, backing.label, hintFor(target));
      }
      throw error;
    }
    const hint = hintFor(target);
    return {
      ok: true,
      state: "connected",
      masked_hint: hint,
      // Carefully worded. DASH checked its own vault and nothing else, and a
      // sentence implying the provider accepted the key would be a lie the user
      // would only discover when the agent failed.
      detail: `DASH can still read the ${credential.field_label.toLowerCase()} it holds for ${credential.service}. Whether ${credential.service} accepts it is reported by the agent when it runs.`,
    };
  }

  /* connect */

  try {
    // Before the prompt, not after. Asking someone to paste a credential and
    // then telling them there was nowhere to put it wastes the one action that
    // required them to go and find it.
    assertCanHoldSecret(backing);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return fromStoreError(error, credential.service, backing.label, null);
    }
    throw error;
  }

  const secret = await deps.promptForSecret(credential, backing.label);
  if (secret === null) {
    const hint = hintFor(target);
    return {
      ok: true,
      state: hint === null ? "not_connected" : "connected",
      masked_hint: hint,
      detail: "No change was made.",
    };
  }

  try {
    await deps.store.set(credential.secret_name, secret);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return fromStoreError(error, credential.service, backing.label, hintFor(target));
    }
    throw error;
  }

  // Masked at the one point the plaintext is in hand, and `recordSecretReference`
  // refuses anything that is not already masked. So the row cannot receive a raw
  // value even if this line were wrong.
  recordSecretReference({
    agent: target.agent_id,
    connection_id: target.connection_id,
    field_id: target.field_id,
    secret_name: credential.secret_name,
    masked_hint: maskSecret(secret),
    backend: backing.backend,
  });

  return {
    ok: true,
    state: "connected",
    masked_hint: maskSecret(secret),
    detail: `${credential.service} is connected. DASH keeps the ${credential.field_label.toLowerCase()} in ${backing.label}.`,
  };
}

/* ---------------------------------------------------------------------- *
 * The OAuth action (MAR-446)
 * ---------------------------------------------------------------------- */

/**
 * Read and parse the stored envelope, distinguishing the three ways there is
 * nothing usable.
 *
 * `absent` is first-run. `unusable` is a value that is in the vault but is not
 * an envelope this version can read — an API key left behind by a manifest whose
 * field changed kind, or a credential written by a newer DASH. `error` is the
 * vault itself refusing. All three end in the user reconnecting, but only the
 * third is a failure worth showing vault recovery copy for.
 */
type StoredGrant =
  | { kind: "found"; credential: OAuthCredential }
  | { kind: "absent" }
  | { kind: "unusable" }
  | { kind: "error"; error: SecureStoreError };

async function readGrant(store: SecureStore, secretName: string): Promise<StoredGrant> {
  let raw: string;
  try {
    raw = await store.get(secretName);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return error.code === "not_found" ? { kind: "absent" } : { kind: "error", error };
    }
    throw error;
  }
  const credential = parseOAuthCredential(raw);
  return credential === null ? { kind: "unusable" } : { kind: "found", credential };
}

/**
 * Connect, check or disconnect a provider sign-in.
 *
 * Split from `performConnectionAction` rather than folded into it as three more
 * branches. The two kinds share the resolution, the refusals and the result
 * shape, and they share almost nothing after that — the API-key path stores a
 * string the user typed, and this one runs a browser flow, negotiates with an
 * authorization server and holds an envelope. Interleaving them would produce
 * three functions each doing two unrelated things.
 *
 * What is *not* different: nothing here returns a token, a refresh token or
 * anything derived from one. The strongest thing that leaves is a masked
 * account, and the granted-permission sentences, which are DASH's own words from
 * `lib/oauth/providers.ts`.
 */
async function performOAuthAction(
  action: ConnectionActionName,
  credential: CredentialTarget,
  vaultLabel: string,
  deps: ConnectionActionDeps,
): Promise<ConnectionActionResult> {
  const target: ConnectionActionTarget = {
    agent_id: credential.agent_id,
    connection_id: credential.connection_id,
    field_id: credential.field_id,
  };
  const service = credential.service;
  // Non-null by construction: `resolveCredentialTarget` sets `kind: "oauth"`
  // and `oauth` together or neither.
  const required = credential.oauth?.scopes ?? [];
  const provider = oauthProviderById(credential.oauth?.provider_id ?? "");

  if (provider === null) {
    // A stored credential naming a flow this build no longer has. Not reachable
    // from a manifest — `resolveCredentialTarget` would have refused — so it
    // means DASH dropped a provider between releases, which is DASH's problem
    // and is said as such.
    return {
      ok: false,
      state: "not_held_by_dash",
      masked_hint: null,
      detail: `This version of DASH no longer knows how to sign in to ${service}.`,
    };
  }

  /**
   * The permissions a partial grant is missing, in plain language.
   *
   * Turned into sentences here rather than passed as scopes, because the only
   * consumer is copy and `lib/copy/identifiers.ts` forbids a raw scope reaching
   * any guided surface.
   */
  const missingPermissions = (stored: OAuthCredential): string[] =>
    describePermissions(provider, missingScopes(stored, required));

  if (action === "disconnect") {
    const grant = await readGrant(deps.store, credential.secret_name);
    if (grant.kind === "error") {
      return fromStoreError(grant.error, service, vaultLabel, hintFor(target));
    }

    // Revoked at the provider *before* the local delete, because after the
    // delete DASH no longer holds the token that would authorise the
    // revocation. Best effort: disconnect's promise is that DASH stops holding
    // the credential, and DASH can keep that promise with no network at all.
    const withdrawn =
      grant.kind === "found" ? await deps.oauth.revoke(grant.credential) : false;

    try {
      await deps.store.delete(credential.secret_name);
    } catch (error: unknown) {
      if (isSecureStoreError(error) && error.code !== "not_found") {
        return fromStoreError(error, service, vaultLabel, hintFor(target));
      }
    }
    forgetSecretReference(target.agent_id, target.connection_id, target.field_id);

    return {
      ok: true,
      state: "not_connected",
      masked_hint: null,
      detail: withdrawn
        ? `${service} is disconnected. DASH deleted its sign-in from ${vaultLabel} and told ${provider.label} to withdraw the agent's access.`
        : // Says the smaller true thing rather than the larger convenient one.
          // A user who believes access was withdrawn and finds DASH still listed
          // in their account later has been misled by this sentence.
          `${service} is disconnected and DASH deleted its sign-in from ${vaultLabel}. DASH could not reach ${provider.label} to withdraw the agent's access, so you may want to remove it in your ${provider.label} account settings.`,
    };
  }

  if (action === "test") {
    const grant = await readGrant(deps.store, credential.secret_name);

    if (grant.kind === "error") {
      return fromStoreError(grant.error, service, vaultLabel, hintFor(target));
    }
    if (grant.kind === "absent" || grant.kind === "unusable") {
      return {
        ok: false,
        state: "not_connected",
        masked_hint: null,
        detail: `DASH has no working sign-in for ${service}.`,
        recovery: {
          headline: `${service} is not connected.`,
          meaning: "DASH has nothing it can use to reach it on the agent's behalf.",
          next_action: `Connect ${service}.`,
          actor: "user",
        },
      };
    }

    const checked = await deps.oauth.check(grant.credential);
    if (!checked.ok) {
      return {
        ok: false,
        // The distinction MAR-446 asks for. Only a grant the provider actively
        // rejected is `revoked`; a network failure leaves the state alone rather
        // than telling a user offline on a train that their access was taken
        // away.
        state: checked.code === "revoked" ? "revoked" : "connected",
        masked_hint: hintFor(target),
        detail: describeAuthorizationFailure(checked.code, { service }).headline,
        recovery: describeAuthorizationFailure(checked.code, { service }),
      };
    }

    const missing = missingPermissions(grant.credential);
    if (missing.length > 0) {
      return {
        ok: false,
        state: "connected",
        masked_hint: hintFor(target),
        detail: `${service} is connected, but not with everything the agent needs.`,
        recovery: describeAuthorizationFailure("missing_permissions", { service, missing }),
      };
    }

    return {
      ok: true,
      state: "connected",
      masked_hint: hintFor(target),
      // Stronger than the API-key equivalent can claim, and it is earned:
      // `check` exchanged the stored grant for a fresh token, so the provider
      // itself has just said yes. It still says nothing about whether the agent
      // will succeed, only that the sign-in is live.
      detail: `${provider.label} still accepts the sign-in DASH holds for ${service}.`,
    };
  }

  /* connect */

  try {
    // Before the browser opens, for the reason the API-key path checks before
    // the prompt: sending someone through a consent screen and then telling them
    // there was nowhere to put the result wastes the part that took effort.
    assertCanHoldSecret(deps.store.describeBacking());
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return fromStoreError(error, service, vaultLabel, null);
    }
    throw error;
  }

  // Best effort, and a nicety rather than a requirement: signing in again to the
  // account already connected should not mean picking it out of a list. A vault
  // that will not open here is not worth failing over — the sign-in below works
  // without a hint.
  let loginHint: string | null = null;
  const existing = await readGrant(deps.store, credential.secret_name);
  if (existing.kind === "found") {
    loginHint = existing.credential.account;
  }

  const outcome = await deps.oauth.authorize(credential, { login_hint: loginHint });
  if (!outcome.ok) {
    const hint = hintFor(target);
    const recovery = describeAuthorizationFailure(outcome.code, { service });
    return {
      ok: false,
      // A failed sign-in says nothing about what DASH already held. Reporting
      // `not_connected` after a cancelled reconnect would tell a user their
      // working connection had gone.
      state: hint === null ? "not_connected" : "connected",
      masked_hint: hint,
      detail: recovery.headline,
      recovery,
    };
  }

  const stored = outcome.credential;

  try {
    await deps.store.set(credential.secret_name, serializeOAuthCredential(stored));
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return fromStoreError(error, service, vaultLabel, hintFor(target));
    }
    throw error;
  }

  // The account, masked, rather than four characters of a refresh token. See
  // `maskAccount` — the question this row answers is "which of my accounts is
  // this", and the token's tail answers nothing.
  const hint =
    stored.account === null ? maskSecret(stored.refresh_token) : maskAccount(stored.account);

  recordSecretReference({
    agent: target.agent_id,
    connection_id: target.connection_id,
    field_id: target.field_id,
    secret_name: credential.secret_name,
    masked_hint: hint,
    backend: deps.store.describeBacking().backend,
  });

  const missing = missingPermissions(stored);
  if (missing.length > 0) {
    // Stored anyway. The user did grant something, it is real, and the agent can
    // do the part of its job it covers — throwing it away would waste a consent
    // they gave. The result is `ok: false` because there is something left to
    // do, and the recovery says exactly what.
    return {
      ok: false,
      state: "connected",
      masked_hint: hint,
      detail: `${service} is connected, but not with everything the agent needs.`,
      recovery: describeAuthorizationFailure("missing_permissions", { service, missing }),
    };
  }

  return {
    ok: true,
    state: "connected",
    masked_hint: hint,
    detail: `${service} is connected. DASH keeps the sign-in in ${vaultLabel} and never writes it to its own files.`,
  };
}

/* ---------------------------------------------------------------------- *
 * Reading the state back
 * ---------------------------------------------------------------------- */

/**
 * What DASH holds for one agent, without opening the vault.
 *
 * Deliberately does not call `get`. This runs on every render of the Connection
 * Center, and a vault read per row would pop an OS unlock prompt at the moment a
 * user merely looked at a page — `describeBacking` carries the same warning for
 * the same reason. "Is it there" comes from the row; "can it still be read"
 * comes from `test`, which the user asks for.
 */
export function heldCredentials(
  agentId: string,
): Array<{ connection_id: string; field_id: string; masked_hint: string | null }> {
  return listSecretReferences(agentId).map((reference) => ({
    connection_id: reference.connection_id,
    field_id: reference.field_id,
    masked_hint: reference.masked_hint,
  }));
}
