/**
 * The credential prompt's contract (MAR-383).
 *
 * Channel names and the shape of what the prompt renders, in `lib/` so that the
 * preload, main and the page can all agree on them without any of the three
 * importing the others. `lib/shell/ipc.ts` and `lib/shell/read.ts` are the same
 * pattern for the two channels that already existed.
 *
 * Three channels rather than one with an action argument. The same reason
 * `dashShell` has seven methods instead of `command(name, payload)`: a single
 * channel taking a verb is a channel whose reachable surface is decided by a
 * string, and one of these three carries a credential while the other two do
 * not. That difference should be visible in the channel name.
 */

/** Ask main what this prompt is for. Carries nothing. */
export const CREDENTIAL_DESCRIBE_CHANNEL = "dash:credential-describe";

/** The one channel in DASH a secret travels on. */
export const CREDENTIAL_SUBMIT_CHANNEL = "dash:credential-submit";

/** Dismiss without storing. Carries nothing. */
export const CREDENTIAL_CANCEL_CHANNEL = "dash:credential-cancel";

/**
 * Begin a provider sign-in (MAR-446, MAR-594).
 *
 * A fourth channel rather than a flag on `submit`, for the reason there are
 * three rather than one: `submit` carries an API key, while this may carry the
 * Desktop app client needed for Google's code exchange. Provider, endpoints,
 * scopes and account still never come from the renderer.
 *
 * It resolves when the sign-in has finished, one way or another. The outcome is
 * not in the reply — main settles the prompt and the Connection Center reports
 * it, exactly as for a typed secret.
 */
export const CREDENTIAL_AUTHORIZE_CHANNEL = "dash:credential-authorize";

/** The only OAuth values the credential-only renderer may hand to main. */
export interface OAuthClientInput {
  client_id: string;
  client_secret: string;
}

/**
 * The route the prompt window loads, inside the packaged renderer.
 *
 * A route in the same static export rather than a separate HTML file, so it
 * inherits the app's styles and the same `dash-app://` origin rules — and so
 * `resolveRendererRequest` keeps being the only thing that decides which files
 * may be served. What makes it a *different* surface is the preload attached to
 * it, not where the bytes live.
 */
export const CREDENTIAL_PROMPT_ROUTE = "/credential-prompt";

/**
 * Everything the prompt renders, whichever kind of credential it is for.
 *
 * Every field is either DASH's own words or a manifest string that has already
 * been through v2 schema validation and is rendered as text by React. There is
 * no field here for a current value, because the prompt never shows one: a
 * credential DASH holds cannot be read back into a form, only replaced.
 */
interface CredentialPromptCommon {
  /** Friendly connection name, e.g. "Ledger". */
  service: string;
  /** Friendly field name, e.g. "Ledger API key". */
  field_label: string;
  /** Why the agent says it needs this. */
  purpose: string;
  /** The agent author's guidance, or null. */
  help: string | null;
  /** Which vault this is going into, e.g. "Windows Credential Manager". */
  vault_label: string;
  /** True when DASH already holds a value that connecting would replace. */
  replacing: boolean;
}

/** A credential the user types. The MAR-383 case, unchanged. */
export interface SecretPromptDescription extends CredentialPromptCommon {
  mode: "secret";
}

/**
 * A sign-in the user approves at the provider (MAR-446).
 *
 * The same window and the same preload, because the alternative — a third
 * surface — would mean a third preload to review for the sake of a page with
 * *fewer* capabilities than the one that already exists. This mode has no input
 * at all: nothing is typed here, and `submit` is never called from it.
 *
 * `permissions` is what makes the window worth showing before the browser opens.
 * A consent screen is the provider's, written in the provider's words, and it
 * does not say which agent asked or why. This does, in plain language, on a page
 * with no agent-authored content on it beyond the manifest strings the checklist
 * already renders.
 */
export interface OAuthPromptDescription extends CredentialPromptCommon {
  mode: "oauth";
  /** Friendly provider name, e.g. "Google". */
  provider_label: string;
  /**
   * One sentence per permission, from `lib/oauth/providers.ts`, write access
   * first. Never a scope — `lib/copy/identifiers.ts` forbids one here.
   */
  permissions: string[];
  /** The account DASH already holds, masked, or null. */
  account_hint: string | null;
  /** True once the browser has been opened and DASH is waiting. */
  waiting: boolean;
  /** True when this grant needs a Desktop app client entered before consent. */
  client_setup: boolean;
}

export type CredentialPromptDescription = SecretPromptDescription | OAuthPromptDescription;
