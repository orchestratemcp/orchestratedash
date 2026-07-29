/**
 * Failures, worded as recoveries.
 *
 * MAR-423: *"Every failure state names what happened, what it means, and the
 * next action."* That is the shape of `Recovery`, and it is three fields rather
 * than one string so a surface cannot render two of them and drop the third —
 * which is always the third, and is the only one that helps.
 *
 * ## The distinctions this exists to preserve
 *
 * The issue is explicit: *"Missing, invalid and revoked credentials are three
 * different recoveries, and `lib/secure-store.ts` already keeps those failure
 * modes distinguishable at the seam. Do not collapse them in the UI."*
 *
 * They are kept apart here because they lead somewhere different:
 *
 * - **Nothing stored** — connect it. An ordinary first-run state, not a fault.
 * - **Vault locked** — unlock it. Treating this as "nothing stored" would ask a
 *   user to re-enter a credential they already gave, and would overwrite it.
 * - **Revoked** — reconnect *and reconsider*: somebody withdrew this access, and
 *   that somebody may have been the user, on purpose. Reconnecting without
 *   saying so would quietly undo a decision.
 * - **Expired** — reconnect. Routine, nobody's fault, no decision to revisit.
 * - **No vault at all** — DASH will not store the credential here, and no
 *   amount of retrying changes that. `lib/secure-store.ts` refuses to fall back
 *   to plaintext, so the honest recovery is about the machine, not the
 *   credential.
 *
 * ## Never blame the user, including by implication
 *
 * "That link has expired" is a recovery. "Invalid handoff" is an accusation with
 * no next step. Where the fault is DASH's, `actor` says so and the copy does not
 * imply the user did anything.
 */

import type { SecureStoreErrorCode } from "../secure-store";

/** Who can do something about it. Surfaces use this to decide whether to offer a button. */
export type RecoveryActor =
  /** The user can fix this, and `next_action` tells them how. */
  | "user"
  /** DASH's own fault. The user is told plainly and asked for nothing. */
  | "dash"
  /** Nothing can be done here, and pretending otherwise would waste their time. */
  | "elsewhere";

export interface Recovery {
  /** What happened. One sentence, in plain language, never an accusation. */
  headline: string;
  /** What it means for them — the consequence, not the mechanism. */
  meaning: string;
  /** The single next action. Imperative, and exactly one. */
  next_action: string;
  actor: RecoveryActor;
}

/* ---------------------------------------------------------------------- *
 * Credentials DASH holds
 * ---------------------------------------------------------------------- */

/**
 * What to say when the OS vault refuses.
 *
 * `service` is the plain label a user recognises — "Gmail", not a connection id
 * and not a secret name. `vault` is `SecureStoreBacking.label`, which the seam
 * guarantees is safe to render: "Windows Credential Manager", never a value.
 */
export function describeSecureStoreFailure(
  code: SecureStoreErrorCode,
  context: { service: string; vault: string },
): Recovery {
  switch (code) {
    case "not_found":
      return {
        headline: `${context.service} is not connected yet.`,
        // Deliberately not an error's worth of alarm: on first run this is
        // simply the truth about a thing that has not happened.
        meaning: `The agent cannot do the parts of its job that need ${context.service} until it is.`,
        next_action: `Connect ${context.service}.`,
        actor: "user",
      };

    case "vault_locked":
      return {
        headline: `${context.vault} is locked, so DASH could not read your ${context.service} sign-in.`,
        meaning:
          "Your sign-in is still there and still safe. DASH simply cannot open it while the vault is locked.",
        next_action: `Unlock ${context.vault} and try again.`,
        actor: "user",
      };

    case "backend_unavailable":
      return {
        headline: `This computer has no secure place for DASH to keep your ${context.service} sign-in.`,
        meaning:
          "DASH will not store a sign-in anywhere it cannot be kept safely, so it has not stored one. Nothing was saved and nothing was lost.",
        next_action:
          "Set up your system's keyring, then connect again. DASH will use it as soon as it is there.",
        actor: "user",
      };

    case "invalid_name":
      // The user cannot have caused this and must not be asked to fix it.
      return {
        headline: `DASH could not file your ${context.service} sign-in correctly.`,
        meaning: "This is a fault in DASH, not something you did. Nothing was stored.",
        next_action: "Report this, and connect again in the meantime.",
        actor: "dash",
      };
  }
}

/* ---------------------------------------------------------------------- *
 * Connections an agent reports on
 * ---------------------------------------------------------------------- */

/**
 * The health an agent reports for one connection, from
 * `contracts/agent-dom-state.schema.json`.
 */
export type ConnectionHealth =
  | "not_configured"
  | "connected"
  | "degraded"
  | "expired"
  | "revoked"
  | "unknown";

export interface ConnectionCondition {
  state: ConnectionHealth;
  reauthorization_required?: boolean;
  /**
   * The agent's own words about this connection, if it gave any. Rendered
   * verbatim as the meaning when present: the agent knows why its own
   * connection is unhappy and DASH does not.
   */
  detail?: string;
}

/**
 * What to say about a connection an agent is reporting on, or null when there is
 * nothing to recover from.
 *
 * Null rather than a cheerful "everything is fine" Recovery: a healthy
 * connection is not a failure state, and a surface that renders a recovery for
 * it would be teaching users to ignore recoveries.
 */
export function describeConnectionCondition(
  service: string,
  condition: ConnectionCondition,
): Recovery | null {
  // Checked before `state`, because an agent can report a working connection
  // that will nonetheless stop working until the user signs in again, and the
  // sign-in is the more urgent of the two facts.
  if (condition.reauthorization_required === true && condition.state === "connected") {
    return {
      headline: `${service} needs you to sign in again.`,
      meaning: `It still works for now. ${service} asks for a fresh sign-in from time to time.`,
      next_action: `Sign in to ${service} again.`,
      actor: "user",
    };
  }

  switch (condition.state) {
    case "connected":
      return null;

    case "not_configured":
      return {
        headline: `${service} is not connected yet.`,
        meaning: `The agent will skip the parts of its job that need ${service}.`,
        next_action: `Connect ${service}.`,
        actor: "user",
      };

    case "degraded":
      return {
        headline: `${service} is connected, but not working properly.`,
        meaning: condition.detail ?? "The agent reached it, and did not get back what it expected.",
        next_action: `Test the connection to ${service}.`,
        actor: "user",
      };

    case "expired":
      return {
        headline: `Your ${service} sign-in has expired.`,
        // Naming it as routine matters: an expiry that reads like a security
        // incident sends people looking for a breach that did not happen.
        meaning: `This happens on a schedule ${service} sets. Nothing has gone wrong.`,
        next_action: `Sign in to ${service} again.`,
        actor: "user",
      };

    case "revoked":
      return {
        headline: `Access to ${service} was withdrawn.`,
        // The distinction the issue insists on. Revoked is not expired: somebody
        // took this access away, possibly the user, possibly on purpose.
        meaning: `Someone removed this agent's access to ${service} — that may have been you, or ${service} itself.`,
        next_action: `Connect ${service} again, if you still want the agent to use it.`,
        actor: "user",
      };

    case "unknown":
      return {
        headline: `DASH cannot tell whether ${service} is working.`,
        meaning:
          condition.detail ??
          "The agent has not said, and DASH does not guess. It may be fine.",
        next_action: `Test the connection to ${service}.`,
        actor: "user",
      };
  }
}

/* ---------------------------------------------------------------------- *
 * Hosting
 * ---------------------------------------------------------------------- */

/**
 * Why an agent is not running, when DASH could not start it.
 *
 * The no-runner case is the one worth wording carefully. It is not a failure the
 * user caused or can retry, and the registration *was* saved — so the copy has
 * to hold two things at once: nothing is broken, and nothing is running.
 */
export function describeHostingFailure(
  reason: "no_runner" | "unreachable" | "did_not_start",
  context: { detail?: string } = {},
): Recovery {
  switch (reason) {
    case "no_runner":
      return {
        headline: "The agent is saved, but this computer cannot run agents.",
        meaning:
          "DASH keeps a secure place for sign-ins, and it will not run agents without one. Your agent and its folder are untouched.",
        next_action: "Set up your system's keyring, then reopen DASH.",
        actor: "user",
      };

    case "unreachable":
      return {
        headline: "The agent is saved, but DASH could not reach the part of itself that runs it.",
        meaning: "Nothing is lost. DASH will try again the next time it starts.",
        next_action: "Close DASH and open it again.",
        actor: "user",
      };

    case "did_not_start":
      return {
        headline: "The agent is saved, but it did not start.",
        meaning: context.detail ?? "It stopped as soon as it began, and did not say why.",
        next_action: "Check the agent's own folder, then try starting it again.",
        actor: "user",
      };
  }
}
