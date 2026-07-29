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
import { describeSecureStoreFailure, type Recovery } from "./copy/recovery";
import { forgetSecretReference, listSecretReferences, maskSecret, recordSecretReference } from "./secret-refs";
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
  /** DASH may not hold this one — OAuth, agent-managed, or not declared. */
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

    case "not_a_secret_field":
      // The OAuth deferral, in front of a user. It says what DASH cannot do and
      // who can do it instead, and it does not offer a text box that would take
      // a token DASH could never refresh.
      return {
        detail: `${service} signs in through its own provider, which DASH cannot do for you yet. The agent handles this sign-in.`,
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
