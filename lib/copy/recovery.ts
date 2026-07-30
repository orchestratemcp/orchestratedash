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

import type { OAuthFailureCode } from "../oauth/flow";
import type { LoopbackFailureCode } from "../oauth/loopback";
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
 * Signing in to a provider
 * ---------------------------------------------------------------------- */

/**
 * Every way a sign-in can end without a usable credential (MAR-446).
 *
 * The union is imported from the two modules that actually produce these codes
 * rather than retyped, so adding a failure mode there is a compile error here
 * until somebody writes the sentence for it. That is the intended pressure: a
 * new failure with no copy would otherwise reach a user as a blank notice.
 */
export type AuthorizationFailureCode =
  | OAuthFailureCode
  | LoopbackFailureCode
  /** The sign-in worked, but the user did not grant everything the agent needs. */
  | "missing_permissions";

/**
 * What to say when a sign-in did not produce a credential DASH can keep.
 *
 * `revoked` is deliberately delegated to `describeConnectionCondition` rather
 * than given its own words here. That function has carried the revoked sentence
 * since MAR-423 and nothing had ever been able to produce the condition — an
 * agent could *report* revoked access, but DASH held no grant of its own to have
 * revoked. It does now, and the two paths reaching one sentence is the point:
 * "someone withdrew this" should read identically whether the agent noticed or
 * DASH did.
 *
 * `denied` and `cancelled` are not failures and do not read as any. A user who
 * pressed Cancel on a consent screen got the outcome they asked for, and copy
 * that treated it as an error would be arguing with them.
 */
export function describeAuthorizationFailure(
  code: AuthorizationFailureCode,
  context: { service: string; missing?: readonly string[] },
): Recovery {
  const { service } = context;

  switch (code) {
    case "revoked":
      // The one condition MAR-446 names explicitly. Non-null because `revoked`
      // is a state `describeConnectionCondition` always answers for — only
      // `connected` returns null, and that is not reachable from here.
      return describeConnectionCondition(service, { state: "revoked" }) as Recovery;

    case "denied":
      return {
        headline: `${service} was not connected.`,
        meaning: `You chose not to give the agent access, so nothing was stored and nothing changed.`,
        next_action: `Connect ${service} again whenever you want to.`,
        actor: "user",
      };

    case "cancelled":
      return {
        headline: `The ${service} sign-in was cancelled.`,
        meaning: "Nothing was stored and nothing changed.",
        next_action: `Connect ${service} again when you are ready.`,
        actor: "user",
      };

    case "timeout":
      return {
        headline: `The ${service} sign-in took too long.`,
        meaning:
          "DASH stopped waiting for the browser to come back. This usually means the sign-in tab was left open or closed partway through.",
        next_action: `Connect ${service} again, and finish signing in when the browser opens.`,
        actor: "user",
      };

    case "network":
      return {
        headline: `DASH could not reach ${service}.`,
        meaning:
          "Nothing was stored. This is usually a connection problem on this computer rather than anything wrong with your account.",
        next_action: "Check this computer is online, then try again.",
        actor: "user",
      };

    case "missing_permissions": {
      const missing = context.missing ?? [];
      return {
        headline: `${service} is connected, but not with everything the agent needs.`,
        meaning:
          missing.length > 0
            ? `The agent also needs to: ${missing.join("; ")}. Without that it will skip the parts of its job that need it.`
            : "Some of the access the agent asked for was not granted, so it will skip the parts of its job that need it.",
        next_action: `Connect ${service} again and leave every permission ticked.`,
        actor: "user",
      };
    }

    case "provider_error":
    case "provider_refused":
      return {
        headline: `${service} refused the sign-in.`,
        meaning:
          "Nothing was stored. This can happen when an account is managed by a workplace or school that restricts which apps may connect.",
        next_action: `Try again, and if it keeps happening check whether ${service} allows this account to connect other apps.`,
        actor: "user",
      };

    case "malformed_response":
      return {
        headline: `DASH could not understand ${service}'s reply.`,
        meaning:
          "Nothing was stored. This is a fault in DASH or a change at the provider's end, not something you did.",
        next_action: "Try again. If it keeps happening, this needs reporting.",
        actor: "dash",
      };
  }
}

/* ---------------------------------------------------------------------- *
 * Reading DASH's own store
 * ---------------------------------------------------------------------- */

/**
 * What to say when a page could not get the thing it is meant to show
 * (MAR-432).
 *
 * A new failure state, and it exists because the pages stopped being rendered on
 * the same side of the boundary as the database. A server component that could
 * not read the store did not render at all; a client component that cannot read
 * the store renders, and has to say something.
 *
 * Neither of these is ever the user's doing, so neither asks them to fix
 * anything they caused. `refused` is DASH's fault outright — a page asked for a
 * document this build does not offer, which is a wiring mistake — and says so
 * rather than inventing a plausible-sounding cause.
 */
export function describeViewFailure(reason: "unreachable" | "refused"): Recovery {
  switch (reason) {
    case "unreachable":
      return {
        headline: "DASH could not read its own records just now.",
        meaning:
          "Nothing is lost and nothing has changed. This page simply has nothing to show until it can read them.",
        next_action: "Try again in a moment.",
        actor: "user",
      };

    case "refused":
      return {
        headline: "This page asked DASH for something it does not offer.",
        meaning: "This is a fault in DASH, not something you did. Nothing was changed.",
        next_action: "Report this, and use the other pages in the meantime.",
        actor: "dash",
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
