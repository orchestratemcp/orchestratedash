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

import { performAiKeyAction, type AiKeyOperations } from "./ai/actions";
import type { CredentialTarget, CredentialTargetRefusal } from "./connection-credentials";
import { resolveCredentialTarget } from "./connection-credentials";
import { recordReceipt, forgetReceipt } from "./broker/store";
import { resolveGrant, resolveKeyGrantWithoutCredential } from "./broker/grant";
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
import { adoptFleetCredential, noteAgentDecision, performFleetAction } from "./fleet/actions";
import { isFleetPrincipal } from "./fleet/principal";
import {
  describePermissions,
  oauthProviderById,
  type OAuthClientConfiguration,
} from "./oauth/providers";
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

/**
 * `share` is a fleet verb and is refused for an agent (MAR-593).
 *
 * Widened here rather than given a dependency of its own, and that is the whole
 * reason the fleet commands need no change in `electron/main.ts`: main injects
 * `connectionAction` as an arrow whose parameter types come from this union, so
 * a fourth member arrives at `performConnectionAction` with the vault, the
 * prompt, the sign-in and the provider probe already wired. Every seam a fleet
 * connection needs was already being supplied to the per-agent one.
 */
export type ConnectionActionName = "connect" | "test" | "disconnect" | "share";

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
  /**
   * Every agent DASH has imported, for the shared-grant fan-out (MAR-570).
   *
   * A list of names rather than a resolver, so this module does the deciding: a
   * dependency that answered "who shares this provider" would be a second place
   * the sharing rule lives, free to disagree with the sentence
   * `lib/connectors.ts` shows the person before they sign in.
   *
   * Optional, and its absence means **no fan-out** rather than an error. A
   * caller built before this feature — every existing test, and any host that
   * has not been updated — connects exactly the agent it named, which is what it
   * has always done and is never wrong, only narrower.
   */
  listAgentIds?(): string[];
  /**
   * Asking a model provider whether a key still works (MAR-582).
   *
   * The third seam, beside the prompt and the sign-in, injected for the reason
   * both of those are: the real one makes an HTTPS request to a third party.
   * `lib/ai/actions.ts` owns what is done with the answer.
   */
  ai: AiKeyOperations;
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
    options: {
      login_hint: string | null;
      /** The client stored with an existing grant, so reconnect needs no re-entry. */
      client: OAuthClientConfiguration | null;
    },
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

    case "brokered_provider_delivery":
      // MAR-582. Refused at connect rather than dropped at spawn, so the author
      // hears about it while there is still a screen in front of somebody.
      return {
        detail: `DASH holds ${service} keys itself and will not hand this one to the agent.`,
        recovery: {
          headline: `${service} is a service DASH can reach on the agent's behalf.`,
          meaning:
            "The agent asks DASH to pass it the key. DASH keeps keys for this kind of service and " +
            "makes the requests itself, so the agent never holds one — and it will not make an " +
            "exception because an agent asked for it.",
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
  /*
   * MAR-593, ADR 0013. A target standing for the fleet rather than an agent.
   *
   * First, before the manifest read, because there is no manifest to read: a
   * fleet connection is resolved against `lib/fleet/catalogue.ts` instead. The
   * branch is here rather than at the IPC seam so that both kinds of target
   * reach the vault through one function with one set of dependencies — the
   * property that let the fleet commands ship without `electron/main.ts`
   * learning about them.
   */
  if (isFleetPrincipal(target.agent_id)) {
    return performFleetAction(action, target.connection_id, deps);
  }

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

  /*
   * MAR-593. What this agent's connection is a connection *to*.
   *
   * Non-null by construction — `resolveCredentialTarget` found the connection in
   * order to succeed — and read again here rather than carried on the target,
   * because `CredentialTarget` deliberately holds the *service* a person reads
   * and not the provider string, and adding one for this would put machine
   * vocabulary on a type that crosses to the credential prompt.
   */
  const declaredProvider =
    manifest.agent_dom?.connections?.find(
      (connection) => connection.id === target.connection_id,
    )?.provider ?? "";

  if (action === "share") {
    // A fleet verb aimed at an agent. Refused rather than quietly treated as a
    // connect: `share` means "give out a consent DASH already holds", and there
    // is no such thing to give out for a connection that belongs to one agent.
    return {
      ok: false,
      state: "not_held_by_dash",
      masked_hint: hintFor(target),
      detail: `${credential.service} is connected for one agent at a time here, so there is nothing to share.`,
    };
  }

  if (action === "connect") {
    /*
     * The consent DASH already holds, rather than a second consent screen.
     *
     * Null when there is no fleet connection for this provider, or when this
     * agent does not qualify for it — in which case the ordinary flow below runs
     * exactly as it always has. This is also what puts a revoked agent back:
     * pressing Connect on its own row is the decision, and `adoptFleetCredential`
     * records it before it writes.
     */
    const adopted = await adoptFleetCredential(declaredProvider, target.agent_id, deps);
    if (adopted !== null) {
      return adopted;
    }
  }

  const result = await performDeclaredAction(
    action,
    target,
    credential,
    manifest,
    backing,
    deps,
  );

  /*
   * The decision this press just made about a fleet connection.
   *
   * After the action and only when it succeeded, so a refused disconnect leaves
   * no decision behind it. Silent when the provider has no fleet connection,
   * which is every connection DASH held before ADR 0013.
   */
  if (result.ok && (action === "connect" || action === "disconnect")) {
    noteAgentDecision(
      declaredProvider,
      target.agent_id,
      action === "connect" ? "granted" : "withheld",
      new Date().toISOString(),
    );
  }
  return result;
}

/**
 * The three verbs against a connection an agent declared — everything this
 * function did before MAR-593 gave it a caller.
 *
 * Split out so `performConnectionAction` above can wrap it: the fleet branch, the
 * adoption and the decision record all have to happen either side of this body,
 * and threading them through it would have put fleet knowledge inside three
 * branches that have no business holding any.
 */
async function performDeclaredAction(
  action: Exclude<ConnectionActionName, "share">,
  target: ConnectionActionTarget,
  credential: CredentialTarget,
  manifest: ConnectionSourceManifest,
  backing: ReturnType<SecureStore["describeBacking"]>,
  deps: ConnectionActionDeps,
): Promise<ConnectionActionResult> {
  if (credential.kind === "oauth") {
    return performOAuthAction(action, credential, backing.label, manifest, deps);
  }

  if (credential.kind === "provider_key") {
    return performProviderKeyAction(action, credential, backing.label, manifest, deps);
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
 * The model-provider key action (MAR-582)
 * ---------------------------------------------------------------------- */

/**
 * Connect, check or disconnect a key DASH holds for a model provider.
 *
 * A thin wrapper rather than a fourth long branch: `lib/ai/actions.ts` owns the
 * behaviour and knows nothing about receipts or the vault's capability check,
 * and this function owns the two things that have to happen in the same order
 * they happen for a sign-in.
 *
 * **The receipt is written from a grant resolved without the key**, which is a
 * stronger version of what the OAuth path does. There, the grant is resolved
 * from the credential that just came back, because scopes live on it. Here there
 * are no scopes, so the same grant the broker would resolve is knowable from the
 * manifest alone — and writing the receipt from it means the capability list a
 * person approves is the list a request will actually be allowed to use.
 */
async function performProviderKeyAction(
  action: Exclude<ConnectionActionName, "share">,
  credential: CredentialTarget,
  vaultLabel: string,
  manifestForGrant: ConnectionSourceManifest,
  deps: ConnectionActionDeps,
): Promise<ConnectionActionResult> {
  if (action === "connect") {
    try {
      // Before the prompt, for the reason the typed-secret path checks before
      // its own: asking someone to go and make an API key and then telling them
      // there was nowhere to put it wastes the part that took effort.
      assertCanHoldSecret(deps.store.describeBacking());
    } catch (error: unknown) {
      if (isSecureStoreError(error)) {
        return fromStoreError(error, credential.service, vaultLabel, null);
      }
      throw error;
    }
  }

  const result = await performAiKeyAction(action, credential, vaultLabel, {
    store: deps.store,
    promptForSecret: deps.promptForSecret,
    ai: deps.ai,
    now: () => new Date(),
  });

  if (action === "disconnect") {
    // After the credential is gone, and for `forgetReceipt`'s reason: a receipt
    // describing access DASH no longer holds would outlive the thing it is a
    // receipt for. The brokered-call audit rows deliberately stay.
    forgetReceipt(credential.agent_id, credential.connection_id);
  } else if (action === "connect" && result.masked_hint !== null) {
    // A hint means a key was stored — a cancel returns the previous hint, and a
    // vault failure returns before this line. `granted_at` survives an update,
    // so re-pasting a key does not make an old approval look like a new one.
    const grant = resolveKeyGrantWithoutCredential(
      credential.agent_id,
      manifestForGrant,
      credential.connection_id,
      credential.secret_name,
    );
    if (grant.ok) {
      recordReceipt(grant.grant, new Date().toISOString());
    }
  }

  return result;
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
  action: Exclude<ConnectionActionName, "share">,
  credential: CredentialTarget,
  vaultLabel: string,
  /** The agent's manifest, for resolving the grant a receipt describes (MAR-458). */
  manifestForGrant: ConnectionSourceManifest,
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
    // MAR-458. The receipt goes with the credential, and after it: a receipt
    // describing access DASH no longer holds would outlive the thing it is a
    // receipt for. The audit rows deliberately stay — they are the record of
    // what was done while the access existed, and a disconnect that erased them
    // would delete exactly the history a suspicious user disconnected to check.
    forgetReceipt(target.agent_id, target.connection_id);

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
  let existingClient: OAuthClientConfiguration | null = null;
  const existing = await readGrant(deps.store, credential.secret_name);
  if (existing.kind === "found") {
    loginHint = existing.credential.account;
    existingClient = existing.credential.client ?? null;
  }

  const outcome = await deps.oauth.authorize(credential, {
    login_hint: loginHint,
    client: existingClient,
  });
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

  // MAR-458, ADR 0002 invariant 4: the moment a grant exists is the moment a
  // receipt for it should. Written from the grant the broker itself would
  // resolve, so what the card lists is what a request would actually be allowed
  // to do — rather than a second derivation that could disagree with it.
  //
  // A grant that resolves to nothing writes no receipt. The connection is real
  // and the user did approve something; what they approved reaches no action, and
  // `missingPermissions` below is already the sentence for that.
  const resolvedGrant = resolveGrant(
    target.agent_id,
    manifestForGrant,
    target.connection_id,
    stored,
    credential.secret_name,
  );
  if (resolvedGrant.ok) {
    recordReceipt(resolvedGrant.grant, new Date().toISOString());
  }

  /*
   * MAR-570. One consent, every agent that needs this provider.
   *
   * After the granting agent's own write, never instead of it: if the fan-out
   * throws, the person's sign-in is already stored and their agent works. The
   * provider comes from this manifest's own declaration rather than from the
   * flow, because the flow serves several services through one authorization
   * server and it is the *service* two agents share.
   *
   * The disclosure for this is on the tile, before the button —
   * `describeSharedGrant`. This is where it comes true.
   */
  const declaredProvider = manifestForGrant.agent_dom?.connections?.find(
    (connection) => connection.id === target.connection_id,
  )?.provider;
  const alsoConnected =
    declaredProvider === undefined
      ? []
      : await shareGrant(
          findGrantSharers(declaredProvider, target, stored, deps),
          stored,
          deps,
        );

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
    // The fan-out is reported rather than left to be noticed. A person who
    // pressed one button and silently granted a second agent access would have
    // learned it from a receipt later, which is the shape of consequence ADR
    // 0002 amendment 2 exists to stop.
    detail:
      alsoConnected.length === 0
        ? `${service} is connected. DASH keeps the sign-in in ${vaultLabel} and never writes it to its own files.`
        : `${service} is connected for this agent and for ${listNames(alsoConnected)}. DASH keeps the sign-in in ${vaultLabel} and never writes it to its own files.`,
  };
}

/** Names in a sentence, with the comma rules a list of two does not need. */
function listNames(names: readonly string[]): string {
  if (names.length === 1) {
    return names[0] as string;
  }
  const last = names[names.length - 1] as string;
  return names.length === 2
    ? `${names[0] as string} and ${last}`
    : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/* ---------------------------------------------------------------------- *
 * One consent, every agent that needs it (MAR-570)
 * ---------------------------------------------------------------------- */

/**
 * One other agent the grant DASH just received also belongs to.
 *
 * `missing` is that agent's own shortfall, computed against **its** declared
 * scopes rather than the granting agent's. Two agents naming one provider can
 * ask for different things, and a fan-out that assumed otherwise would report a
 * connection as complete for an agent whose actions the consent never covered.
 */
export interface GrantSharer {
  agent_id: string;
  target: CredentialTarget;
  missing: string[];
}

/**
 * Which other agents a sign-in for this provider also connects.
 *
 * ## Why this exists at all
 *
 * Henrik's ruling on MAR-570: *"connecting Gmail once lights up both agents that
 * need it."* Before this, a grant was keyed `dash.connection.{agent}.{connection}
 * .{field}` and stopped at the agent it was made for, so a person with two agents
 * needing Gmail signed in twice. The tile that now says otherwise is only honest
 * because of this function.
 *
 * ## What it will not do
 *
 * **Only OAuth.** A typed secret is a value a person handed DASH for a named
 * agent, with no consent screen and no scopes; copying it elsewhere would be
 * DASH redistributing something it was given for one purpose. A sign-in is
 * different in kind — the provider issued a grant, DASH is recording who may use
 * it, and the person is told before they press. The narrower rule is the safe
 * one and `describeSharedGrant` promises only this much.
 *
 * **Only what each agent independently qualifies for.** Every candidate goes
 * through `resolveCredentialTarget`, which is the same gate the direct path
 * uses: it refuses an agent whose manifest declared no scopes, asked for access
 * DASH does not offer, or named an environment variable DASH will not use. A
 * sharer is therefore an agent that would have been allowed to run this exact
 * sign-in itself.
 *
 * **Never the granting agent.** It is excluded by name, because it has already
 * been written by the caller and a second write would re-record its receipt.
 */
export function findGrantSharers(
  provider: string,
  granting: ConnectionActionTarget,
  granted: OAuthCredential,
  deps: Pick<ConnectionActionDeps, "listAgentIds" | "readManifest">,
): GrantSharer[] {
  const listed = deps.listAgentIds?.() ?? [];
  const sharers: GrantSharer[] = [];

  for (const agentId of listed) {
    if (agentId === granting.agent_id) {
      continue;
    }
    const manifest = deps.readManifest(agentId);
    if (manifest === null) {
      continue;
    }
    for (const connection of manifest.agent_dom?.connections ?? []) {
      if (connection.provider !== provider) {
        continue;
      }
      for (const field of connection.fields) {
        const resolved = resolveCredentialTarget(agentId, manifest, connection.id, field.id);
        // A refusal here is not an error and is not reported: it means this
        // agent could not have run this sign-in itself, so a grant made for
        // somebody else must not appear on its behalf either.
        if (!resolved.ok || resolved.target.kind !== "oauth") {
          continue;
        }
        sharers.push({
          agent_id: agentId,
          target: resolved.target,
          // This agent's own declared scopes against what the consent actually
          // issued. Its shortfall, not the granting agent's — which is the whole
          // reason a sharer is resolved rather than assumed.
          missing: missingScopes(granted, resolved.target.oauth?.scopes ?? []),
        });
      }
    }
  }

  return sharers;
}

/**
 * Write one received grant to every agent that shares the provider.
 *
 * Each write is the same three steps the direct path takes — the vault entry,
 * the masked reference, and the receipt resolved from *that agent's* manifest —
 * so what the broker later resolves for a shared agent is indistinguishable from
 * a grant it received directly. That is the property that keeps the fan-out out
 * of broker semantics: nothing downstream can tell, because there is nothing to
 * tell.
 *
 * **A failure here does not fail the connect.** The person's sign-in worked and
 * their credential is stored; a vault that refused a second write is a smaller
 * problem than a page reporting that the whole thing failed, and the agent it
 * failed for simply reads as not connected — which is true. The names that did
 * succeed come back so the caller can say what happened.
 */
export async function shareGrant(
  sharers: readonly GrantSharer[],
  granted: OAuthCredential,
  deps: Pick<ConnectionActionDeps, "store" | "readManifest">,
): Promise<string[]> {
  const connected: string[] = [];

  for (const sharer of sharers) {
    try {
      await deps.store.set(sharer.target.secret_name, serializeOAuthCredential(granted));
    } catch {
      continue;
    }
    recordSecretReference({
      agent: sharer.agent_id,
      connection_id: sharer.target.connection_id,
      field_id: sharer.target.field_id,
      secret_name: sharer.target.secret_name,
      masked_hint:
        granted.account === null ? maskSecret(granted.refresh_token) : maskAccount(granted.account),
      backend: deps.store.describeBacking().backend,
    });

    const manifest = deps.readManifest(sharer.agent_id);
    if (manifest !== null) {
      const resolvedGrant = resolveGrant(
        sharer.agent_id,
        manifest,
        sharer.target.connection_id,
        granted,
        sharer.target.secret_name,
      );
      if (resolvedGrant.ok) {
        recordReceipt(resolvedGrant.grant, new Date().toISOString());
      }
    }
    if (!connected.includes(sharer.agent_id)) {
      connected.push(sharer.agent_id);
    }
  }

  return connected;
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
