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
 * Everything the prompt renders.
 *
 * Every field is either DASH's own words or a manifest string that has already
 * been through v2 schema validation and is rendered as text by React. There is
 * no field here for a current value, because the prompt never shows one: a
 * credential DASH holds cannot be read back into a form, only replaced.
 */
export interface CredentialPromptDescription {
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
  /** True when DASH already holds a value that submitting would replace. */
  replacing: boolean;
}
