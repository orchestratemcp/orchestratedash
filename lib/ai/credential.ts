/**
 * What DASH keeps in the vault for a model provider's key (MAR-582).
 *
 * Under the same `dash.connection.{agent}.{connection}.{field}` name
 * `lib/connection-credentials.ts` computes for every other credential — MAR-446
 * established that a second kind reuses the MAR-383 seam rather than inventing a
 * second store, and a third kind is not the moment to stop.
 *
 * ## Why an envelope, when the key is one string
 *
 * `lib/oauth/credential.ts` argues an envelope from *atomicity*: a token, its
 * scopes and its account are one fact and must be written together. A model key
 * has no scopes and no account, so that argument does not apply, and the obvious
 * thing to store is the string the user pasted.
 *
 * The reason not to is a confusion this vault name genuinely permits. One name
 * can hold, over the life of an installation, whatever the manifest's field kind
 * said at the time it was written. A manifest whose field changed from a sign-in
 * to a key — or the reverse — leaves the previous kind's value sitting under the
 * name the new kind now reads. `parseOAuthCredential` already refuses a bare
 * string for that reason, so one direction was covered; the other was not, and
 * the other is the dangerous one. A reader expecting a bare key would find an
 * OAuth envelope, take the whole JSON document as the key, and **send a refresh
 * token to a model provider as a bearer credential**.
 *
 * So a stored model key carries a discriminator, and reading refuses anything
 * that is not one. Neither kind can be mistaken for the other in either
 * direction, and the cost is a JSON wrapper around a string.
 *
 * ## The whole envelope is a secret
 *
 * The same rule `lib/oauth/credential.ts` states. Nothing here is logged, and
 * nothing derived from `key` leaves except the masked hint `lib/secret-refs.ts`
 * produces at the moment of storing.
 */

import { aiProviderById, type AiProviderId } from "./providers";

/**
 * The current envelope version.
 *
 * Present from the first release rather than added at the first migration, for
 * `OAUTH_CREDENTIAL_VERSION`'s reason: a stored credential outlives the code
 * that wrote it, and a value with no version is one a future reader has to guess
 * about.
 */
export const AI_KEY_CREDENTIAL_VERSION = 1;

/**
 * The discriminator, as a literal.
 *
 * `kind` rather than a distinguishing member name, so that a reader of either
 * envelope can tell what it is holding before it reads anything else — and so
 * the check that refuses the wrong one is a single equality rather than an
 * inference from which fields happen to be present.
 */
export const AI_KEY_CREDENTIAL_KIND = "ai_provider_key";

export interface AiKeyCredential {
  version: typeof AI_KEY_CREDENTIAL_VERSION;
  kind: typeof AI_KEY_CREDENTIAL_KIND;
  /** The `AiProviderProfile.id` this key is for, e.g. `openrouter`. */
  provider: AiProviderId;
  /**
   * The key itself.
   *
   * Never delivered to an agent, never rendered, never logged. It leaves this
   * process only as an authorization header built by `aiAuthHeaders`, inside the
   * one function in `lib/broker/execute.ts` that holds a live credential.
   */
  key: string;
  /** When the user gave it to DASH, ISO-8601. For display only. */
  obtained_at: string;
}

/** The longest key DASH will store. The credential prompt caps at the same size. */
const MAX_KEY_LENGTH = 8 * 1024;

export function serializeAiKeyCredential(credential: AiKeyCredential): string {
  return JSON.stringify(credential);
}

/**
 * Read a vault value back, or null when it is not one of ours.
 *
 * Null rather than a throw, for `parseOAuthCredential`'s reason: every realistic
 * cause is ordinary. A bare key written by the pre-MAR-582 typed-secret path, an
 * OAuth envelope left by a field that changed kind, or a document written by a
 * newer DASH all land here, and all three mean "DASH cannot use what is here" —
 * a state the Connection Center already renders as an invitation to connect.
 *
 * A provider this build does not know is also null. That is the load-bearing
 * one: an envelope naming a provider DASH has dropped must not resolve to a
 * profile-less credential that some later line then tries to build a request
 * from.
 *
 * Nothing about the offending value appears in what this returns. A parse
 * failure that quoted what it failed to parse would put a credential in whatever
 * caught it.
 */
export function parseAiKeyCredential(stored: string): AiKeyCredential | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate["version"] !== AI_KEY_CREDENTIAL_VERSION) {
    return null;
  }
  if (candidate["kind"] !== AI_KEY_CREDENTIAL_KIND) {
    return null;
  }

  const provider = candidate["provider"];
  if (aiProviderById(provider) === null) {
    return null;
  }

  const key = candidate["key"];
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) {
    return null;
  }

  const obtainedAt = candidate["obtained_at"];
  if (typeof obtainedAt !== "string") {
    return null;
  }

  return {
    version: AI_KEY_CREDENTIAL_VERSION,
    kind: AI_KEY_CREDENTIAL_KIND,
    provider: provider as AiProviderId,
    key,
    obtained_at: obtainedAt,
  };
}

/**
 * Is this stored value a model key envelope?
 *
 * A separate, cheaper question than parsing, for the one caller that needs to
 * tell the two kinds apart without wanting either: a reader deciding which
 * branch to take. Implemented by parsing anyway, because a second, looser answer
 * to "is this ours" is exactly the drift this module exists to prevent.
 */
export function isAiKeyCredential(stored: string): boolean {
  return parseAiKeyCredential(stored) !== null;
}
