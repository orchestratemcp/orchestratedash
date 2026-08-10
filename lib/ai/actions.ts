/**
 * Connect, check and disconnect a model provider's key (MAR-582).
 *
 * The third branch of `performConnectionAction`, split into its own module for
 * the reason `performOAuthAction` is split: the three kinds share a resolution,
 * a set of refusals and a result shape, and share almost nothing after that.
 * Interleaving them would produce three functions each doing three unrelated
 * things.
 *
 * ## What is different from the typed-secret path it grew out of
 *
 * `lib/connection-actions.ts`'s header argues that `test` cannot honestly
 * contact a provider: "DASH holds an opaque string for a service it has no
 * client for; there is no request it could make that would distinguish a good
 * key from a bad one."
 *
 * That argument is **true and now scoped**, in the way ADR 0002 amendment 4
 * scoped four of its own sentences. It holds for every service DASH has no
 * client for, which is all of them except the three in `lib/ai/providers.ts` —
 * and for those three DASH knows the origin, knows how the key is presented, and
 * has one cheap side-effect-free question with an unambiguous answer. Declining
 * to ask it would be declining to know something DASH can know, which is a
 * different failure from claiming something it cannot.
 *
 * ## What is different from the sign-in path it resembles
 *
 * Disconnect. `performOAuthAction` asks the provider to withdraw the grant and
 * then says whether that worked; there is no such request for a key. DASH can
 * delete its copy and nothing more, and the sentence below says so rather than
 * letting "disconnected" imply the key is gone. That is the same choice the
 * OAuth path makes when a revocation fails — "says the smaller true thing rather
 * than the larger convenient one".
 *
 * ## What never crosses back
 *
 * The key, and anything computed from it at read time. The masked hint is the
 * one `maskSecret` produced at the moment the user typed it. `probe` takes the
 * key and returns a status code and a count; the value it was given does not
 * appear in its result, and no branch here puts it in a sentence.
 */

import { describeSecureStoreFailure, type Recovery } from "../copy/recovery";
import type { CredentialTarget } from "../connection-credentials";
import {
  isSecureStoreError,
  type SecureStore,
  type SecureStoreError,
} from "../secure-store";
import {
  forgetSecretReference,
  listSecretReferences,
  maskSecret,
  recordSecretReference,
} from "../secret-refs";
import {
  AI_KEY_CREDENTIAL_KIND,
  AI_KEY_CREDENTIAL_VERSION,
  parseAiKeyCredential,
  serializeAiKeyCredential,
} from "./credential";
import {
  classifyProbe,
  describeLiveness,
  type AiLivenessRecord,
  type AiProbeOutcome,
} from "./liveness";
import { aiProviderById, type AiProviderProfile } from "./providers";
import { forgetLivenessCheck, recordLivenessCheck } from "./store";

/* ---------------------------------------------------------------------- *
 * What this needs from the outside world
 * ---------------------------------------------------------------------- */

/**
 * The one impure thing this module cannot do for itself.
 *
 * Injected for `OAuthOperations`' reason: the real implementation makes an HTTPS
 * request to a third party, and none of that can be in the loop of a unit test
 * asserting that a refused key produces the refused-key sentence. The fake
 * returns an outcome; nothing here can tell the difference.
 *
 * **Never throws.** A rejected promise would have to be classified by whichever
 * branch happened to await it, and a rejection from `fetch` can carry the
 * request — which for this call has a live key in its headers. So the
 * implementation catches its own failure and reports a null status, and the
 * classification is `classifyProbe`'s, in a pure function a test can drive.
 */
export interface AiKeyOperations {
  /**
   * `wantIds` asks the same question and keeps more of the answer (MAR-583).
   *
   * One operation and not two, because it *is* one request: the model picker's
   * list and the liveness check are the same call to the same path with the same
   * key, and a second method would be a second place for the URL, the headers
   * and the timeout to be decided. What changes is only how much of the reply
   * survives the projection, and it defaults to the narrower answer so a caller
   * that has nowhere to put a catalogue cannot accidentally receive one.
   */
  probe(profile: AiProviderProfile, key: string, wantIds?: boolean): Promise<AiProbeOutcome>;
}

export interface AiKeyActionDeps {
  store: SecureStore;
  /** Ask the user for one key. Null when they cancelled — an ordinary outcome. */
  promptForSecret(target: CredentialTarget, vaultLabel: string): Promise<string | null>;
  ai: AiKeyOperations;
  now(): Date;
}

/**
 * The result shape, restated structurally rather than imported.
 *
 * `lib/connection-actions.ts` imports this module, so importing its types back
 * would be a cycle. The members are pinned against it by
 * `tests/ai-key-connection.test.ts`, which assigns one of these into a
 * `ConnectionActionResult` — a compile-time check that costs one line and would
 * fail the moment the two drift.
 */
export interface AiKeyActionResult {
  ok: boolean;
  state:
    | "not_connected"
    | "connected"
    | "locked"
    | "unavailable"
    | "revoked"
    | "not_held_by_dash";
  masked_hint: string | null;
  detail: string;
  recovery?: Recovery;
}

export type AiKeyActionName = "connect" | "test" | "disconnect";

/* ---------------------------------------------------------------------- *
 * Small shared pieces
 * ---------------------------------------------------------------------- */

function hintFor(target: CredentialTarget): string | null {
  const reference = listSecretReferences(target.agent_id).find(
    (row) => row.connection_id === target.connection_id && row.field_id === target.field_id,
  );
  return reference?.masked_hint ?? null;
}

/**
 * A vault failure, as a result.
 *
 * The same mapping `fromStoreError` makes in `lib/connection-actions.ts`, on the
 * same taxonomy and through the same copy function. Written here rather than
 * imported because importing a value from that module would close a cycle; what
 * is duplicated is three lines of correspondence, and the words — the part that
 * could actually drift — come from `describeSecureStoreFailure` in both.
 */
function fromStoreError(
  error: SecureStoreError,
  service: string,
  vault: string,
  hint: string | null,
): AiKeyActionResult {
  const recovery = describeSecureStoreFailure(error.code, { service, vault });
  return {
    ok: false,
    state:
      error.code === "not_found"
        ? "not_connected"
        : error.code === "vault_locked"
          ? "locked"
          : "unavailable",
    masked_hint: hint,
    detail: recovery.headline,
    recovery,
  };
}

/**
 * Turn a recorded observation into the half of a result that talks about the
 * provider.
 *
 * One place, so `connect` and `test` cannot describe the same observation two
 * different ways. `ok` is false for anything that is not `live`, including the
 * two states that are nobody's fault: there is something left to find out, and a
 * green result would tell a user their connection is finished when DASH has not
 * established that.
 */
function fromLiveness(
  record: AiLivenessRecord,
  profile: AiProviderProfile,
  hint: string | null,
): AiKeyActionResult {
  const sentence = describeLiveness(record, profile.label);
  if (record.state === "live") {
    return { ok: true, state: "connected", masked_hint: hint, detail: sentence.headline };
  }
  return {
    ok: false,
    // Only a key the provider actively turned down is `revoked`. A network
    // failure leaves the state alone rather than telling a user offline on a
    // train that their key has been taken away — `performOAuthAction` makes
    // exactly this distinction and it is the same mistake to make here.
    state: record.state === "key_refused" ? "revoked" : "connected",
    masked_hint: hint,
    detail: sentence.headline,
    recovery: {
      headline: sentence.headline,
      meaning: sentence.detail,
      next_action: sentence.next_action ?? `Check the key again when you want to know.`,
      actor: record.state === "key_refused" ? "user" : "elsewhere",
    },
  };
}

/* ---------------------------------------------------------------------- *
 * The action
 * ---------------------------------------------------------------------- */

/**
 * Connect, check or disconnect a model provider key.
 *
 * `target.ai_provider_id` is non-null by construction — `resolveCredentialTarget`
 * sets `kind: "provider_key"` and the id together or neither — but it is
 * resolved rather than asserted, because a stored target naming a provider this
 * build has dropped is a real document and deserves a sentence rather than a
 * crash.
 */
export async function performAiKeyAction(
  action: AiKeyActionName,
  target: CredentialTarget,
  vaultLabel: string,
  deps: AiKeyActionDeps,
): Promise<AiKeyActionResult> {
  const profile = aiProviderById(target.ai_provider_id);
  if (profile === null) {
    return {
      ok: false,
      state: "not_held_by_dash",
      masked_hint: null,
      detail: `This version of DASH no longer knows how to reach ${target.service}.`,
    };
  }

  if (action === "disconnect") {
    return disconnect(target, profile, vaultLabel, deps);
  }
  if (action === "test") {
    return check(target, profile, vaultLabel, deps);
  }
  return connect(target, profile, vaultLabel, deps);
}

async function connect(
  target: CredentialTarget,
  profile: AiProviderProfile,
  vaultLabel: string,
  deps: AiKeyActionDeps,
): Promise<AiKeyActionResult> {
  const key = await deps.promptForSecret(target, vaultLabel);
  if (key === null) {
    const hint = hintFor(target);
    return {
      ok: true,
      state: hint === null ? "not_connected" : "connected",
      masked_hint: hint,
      detail: "No change was made.",
    };
  }

  try {
    await deps.store.set(
      target.secret_name,
      serializeAiKeyCredential({
        version: AI_KEY_CREDENTIAL_VERSION,
        kind: AI_KEY_CREDENTIAL_KIND,
        provider: profile.id,
        key,
        obtained_at: deps.now().toISOString(),
      }),
    );
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return fromStoreError(error, target.service, vaultLabel, hintFor(target));
    }
    throw error;
  }

  // Masked at the one point the plaintext is in hand, and `recordSecretReference`
  // refuses anything that is not already masked — so the row cannot receive a raw
  // value even if this line were wrong.
  const hint = maskSecret(key);
  recordSecretReference({
    agent: target.agent_id,
    connection_id: target.connection_id,
    field_id: target.field_id,
    secret_name: target.secret_name,
    masked_hint: hint,
    backend: deps.store.describeBacking().backend,
  });

  // Asked immediately, and this is the whole difference from the typed-secret
  // path. A person who has just gone and made a key wants to know whether it
  // works, and the moment they are still looking at the screen is the only cheap
  // moment to tell them. The key is already stored before the question is asked:
  // a provider that is down must not cost the user the key they just pasted.
  const { record } = await runProbe(target, profile, key, deps);
  const outcome = fromLiveness(record, profile, hint);

  return {
    ...outcome,
    detail: `${target.service} is connected. DASH keeps the key in ${vaultLabel} and never gives it to the agent. ${outcome.detail}`,
  };
}

async function check(
  target: CredentialTarget,
  profile: AiProviderProfile,
  vaultLabel: string,
  deps: AiKeyActionDeps,
): Promise<AiKeyActionResult> {
  let raw: string;
  try {
    raw = await deps.store.get(target.secret_name);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      return fromStoreError(error, target.service, vaultLabel, hintFor(target));
    }
    throw error;
  }

  const stored = parseAiKeyCredential(raw);
  if (stored === null || stored.provider !== profile.id) {
    // Either not a key envelope at all — a sign-in left by a field that changed
    // kind, or a bare value written before this path existed — or one filed
    // against a different provider. Both are refused rather than coerced: the
    // alternative is presenting one provider's credential to another.
    return {
      ok: false,
      state: "not_connected",
      masked_hint: null,
      detail: `DASH has no usable ${profile.label} key.`,
      recovery: {
        headline: `${target.service} is not connected.`,
        meaning: "DASH has nothing it can use to reach it on the agent's behalf.",
        next_action: `Connect ${target.service}.`,
        actor: "user",
      },
    };
  }

  const { record } = await runProbe(target, profile, stored.key, deps);
  return fromLiveness(record, profile, hintFor(target));
}

async function disconnect(
  target: CredentialTarget,
  profile: AiProviderProfile,
  vaultLabel: string,
  deps: AiKeyActionDeps,
): Promise<AiKeyActionResult> {
  // Vault first, then the records. The other order would leave a key in the
  // vault that nothing in DASH remembers or can ever delete — an orphan with no
  // owner and no surface, which is the exact argument the typed-secret path
  // makes for the same ordering.
  try {
    await deps.store.delete(target.secret_name);
  } catch (error: unknown) {
    if (isSecureStoreError(error) && error.code !== "not_found") {
      return fromStoreError(error, target.service, vaultLabel, hintFor(target));
    }
    // `not_found` is not a failure to disconnect. The user asked for the key to
    // be gone and it is gone.
  }

  forgetSecretReference(target.agent_id, target.connection_id, target.field_id);
  // The observation goes with the credential it was about. A verdict on a key
  // DASH has deleted would be shown beside the next key somebody connects.
  forgetLivenessCheck(target.agent_id, target.connection_id);

  return {
    ok: true,
    state: "not_connected",
    masked_hint: null,
    // Says the smaller true thing. DASH has no request it could make that would
    // delete a key at a provider — that is a management action on the account,
    // not something a key can do to itself — so "disconnected" must not be
    // allowed to imply the key no longer exists.
    detail:
      `${target.service} is disconnected. DASH deleted its copy of the key from ${vaultLabel}. ` +
      `The key itself still exists in your ${profile.label} account, and DASH cannot remove it for you — ` +
      "delete it there if you want it gone.",
  };
}

/**
 * Ask the provider, record what it said, and hand back the record.
 *
 * The one place a stored key is passed to anything, and it goes to the injected
 * `probe` and nowhere else. What comes back is a status code and a count, so
 * nothing downstream of this line has the key or anything derived from it.
 *
 * Recorded before it is returned, so a check whose answer the user never sees —
 * because they closed the window — is still an observation the next render can
 * report with its date.
 */
async function runProbe(
  target: CredentialTarget,
  profile: AiProviderProfile,
  key: string,
  deps: AiKeyActionDeps,
  wantIds = false,
): Promise<{ record: AiLivenessRecord; models: readonly string[] | null }> {
  let outcome: AiProbeOutcome;
  try {
    outcome = await deps.ai.probe(profile, key, wantIds);
  } catch {
    // `AiKeyOperations.probe` is documented never to throw, and this is what
    // holds that documentation to something. The caught value is dropped rather
    // than inspected, for the reason `lib/oauth/flow.ts` drops its own: a fetch
    // rejection can carry the request, and this request has a key in it.
    outcome = { status: null, model_count: null };
  }
  const record = classifyProbe(outcome, deps.now().toISOString());
  recordLivenessCheck(target.agent_id, target.connection_id, record);
  // The ids come back from this function and are never handed to
  // `recordLivenessCheck`, which takes the record and not the outcome. That is
  // the seam that keeps a provider's catalogue out of the database — see
  // `AiProbeOutcome.model_ids`.
  return { record, models: outcome.model_ids ?? null };
}

/* ---------------------------------------------------------------------- *
 * The models a key can reach (MAR-583)
 * ---------------------------------------------------------------------- */

/**
 * What one ask produced: a list to pick from, or a reason there is none.
 *
 * `models` is an array and never null. An empty array is a real answer — this
 * key reaches nothing DASH can name — and it is reported with `ok: false` and
 * the liveness sentence beside it, because a picker with no options and no
 * explanation is the dead end `ConnectFlowRefusal` exists to prevent.
 */
export interface AiKeyModelList {
  ok: boolean;
  models: string[];
  detail: string;
  recovery?: Recovery;
}

/**
 * Ask a provider which models this agent's key can reach.
 *
 * **The same request `test` makes**, with more of the answer kept. So it records
 * the same liveness observation: a person who presses this and is told the key
 * was refused has performed a check, and the card beside it must not go on
 * reporting last week's verdict because the button had a different label.
 *
 * The list is returned and never stored. It exists for as long as the window
 * showing the picker does, which is what keeps a provider's catalogue out of
 * DASH's tables — the constraint `ai_key_checks` was designed around and the one
 * thing about this feature that could quietly stop being true.
 */
export async function listAiKeyModels(
  target: CredentialTarget,
  vaultLabel: string,
  deps: AiKeyActionDeps,
): Promise<AiKeyModelList> {
  const profile = aiProviderById(target.ai_provider_id);
  if (profile === null) {
    return {
      ok: false,
      models: [],
      detail: `This version of DASH no longer knows how to reach ${target.service}.`,
    };
  }

  let raw: string;
  try {
    raw = await deps.store.get(target.secret_name);
  } catch (error: unknown) {
    if (isSecureStoreError(error)) {
      const failed = fromStoreError(error, target.service, vaultLabel, hintFor(target));
      return { ok: false, models: [], detail: failed.detail, recovery: failed.recovery };
    }
    throw error;
  }

  const stored = parseAiKeyCredential(raw);
  if (stored === null || stored.provider !== profile.id) {
    // The two-envelope refusal, restated here rather than shared with `check`:
    // both refuse the same document for the same reason, and what differs is the
    // shape of the answer. See `check` for the argument.
    return {
      ok: false,
      models: [],
      detail: `DASH has no usable ${profile.label} key.`,
      recovery: {
        headline: `${target.service} is not connected.`,
        meaning: "DASH has nothing it can use to ask which models are available.",
        next_action: `Connect ${target.service}.`,
        actor: "user",
      },
    };
  }

  const { record, models } = await runProbe(target, profile, stored.key, deps, true);
  if (record.state !== "live" || models === null) {
    const outcome = fromLiveness(record, profile, hintFor(target));
    return { ok: false, models: [], detail: outcome.detail, recovery: outcome.recovery };
  }

  const sentence = describeLiveness(record, profile.label);
  return { ok: models.length > 0, models: [...models], detail: sentence.headline };
}
