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
 * Sources an agent reads
 * ---------------------------------------------------------------------- */

/**
 * What to say about one source a run could not use (MAR-457).
 *
 * Four outcomes, kept apart for the same reason the credential failures above
 * are: they lead somewhere different. Telling someone to check their internet
 * connection because an address had a typo in it wastes their afternoon, and
 * telling them an address is wrong when their wifi is off makes them edit a
 * setting that was never the problem.
 *
 * Every one of these is a *gap in a digest that still arrived*. None of them is
 * a failed run, and the copy never suggests otherwise — a run that read three
 * sources out of four did most of its job, and calling that a failure teaches
 * people to ignore the word.
 */
export function describeSourceFailure(source: {
  source_name: string;
  status: "ok" | "unreachable" | "not_a_feed" | "empty";
}): Recovery | null {
  const { source_name: name } = source;

  switch (source.status) {
    case "ok":
      // Null for the same reason a healthy connection returns null: a source
      // that worked is not a failure state, and rendering a recovery for one
      // would teach people to ignore recoveries.
      return null;

    case "empty":
      // Not a fault at all, and deliberately not worded as one. A feed with
      // nothing new in it today is a feed working exactly as intended.
      return {
        headline: `${name} had nothing new.`,
        meaning: "The source answered normally. There was simply nothing published since the last look.",
        next_action: "Nothing to do.",
        actor: "elsewhere",
      };

    case "unreachable":
      return {
        headline: `DASH could not reach ${name}.`,
        meaning: `Everything else in your digest arrived normally. Only what ${name} would have added is missing.`,
        next_action: `Check the address for ${name}, or remove it from your sources.`,
        actor: "user",
      };

    case "not_a_feed":
      return {
        headline: `${name} answered, but not with a news feed.`,
        // The distinction that matters: this address is reachable. Sending the
        // user to check their connection would send them to fix the one thing
        // demonstrably working.
        meaning:
          "This usually means the address points at an ordinary web page rather than a feed, or the kind of feed it is was set wrongly.",
        next_action: `Check the address and the kind of feed for ${name}.`,
        actor: "user",
      };
  }
}

/**
 * The one thing worth saying about the run as a whole, or nothing.
 *
 * Separate from the per-source copy because "every source failed the same way"
 * is a different fact from "this source failed", and only the first one is about
 * the machine rather than about a list. A user whose wifi is off should be told
 * that once, not once per source.
 *
 * Returns null whenever the per-source recoveries already tell the story, which
 * is the common case.
 */
export function describeDigestGaps(
  sources: ReadonlyArray<{
    source_name: string;
    status: "ok" | "unreachable" | "not_a_feed" | "empty";
  }>,
): Recovery | null {
  if (sources.length === 0) {
    return {
      headline: "This agent has no sources yet.",
      meaning: "It ran and had nothing to read, so the digest is empty. Nothing went wrong.",
      next_action: "Add a source for it to watch.",
      actor: "user",
    };
  }

  const unreachable = sources.filter((source) => source.status === "unreachable");
  if (unreachable.length === sources.length) {
    return {
      headline: "None of your sources could be reached.",
      // Said as the likely cause rather than as a diagnosis. DASH cannot tell a
      // dropped connection from every feed being down at once, and pretending to
      // know which would send half of the people who see this to the wrong place.
      meaning:
        "When every source fails at once it is usually this computer's internet connection rather than the sources themselves. Nothing is lost and nothing is broken.",
      next_action: "Check this computer is online, then run it again.",
      actor: "user",
    };
  }

  return null;
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
  | "missing_permissions"
  /**
   * DASH could not show the sign-in window, so there was never anything to sign
   * in with. Distinct from every other code here because nothing was asked of
   * the provider and nothing was asked of the user — the failure is entirely on
   * this side, and the previous behaviour was to wait silently forever.
   */
  | "prompt_unavailable";

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
      return {
        headline: `${service} refused the sign-in.`,
        meaning:
          "Nothing was stored. This can happen when an account is managed by a workplace or school that restricts which apps may connect.",
        next_action: `Try again, and if it keeps happening check whether ${service} allows this account to connect other apps.`,
        actor: "user",
      };

    /*
     * MAR-508 found what this used to share wording with `provider_error`
     * hid: `postForm` in `lib/oauth/flow.ts` produces this code from the
     * *token exchange*, and every response that lands here — RFC 6749 §5.2's
     * `invalid_request`, `unauthorized_client`, `unsupported_grant_type` (and,
     * before MAR-542, `invalid_client` too) — is the provider validating
     * DASH's own request and finding it malformed, not a person's account
     * being turned away. A missing `client_secret` produced exactly this
     * code, and the old copy told the user to go check their employer's
     * app-restriction policy for a fault that was entirely DASH's.
     * `provider_error`, by contrast, is `lib/oauth/loopback.ts`'s reading of
     * an `error=` the provider put on the *authorization* redirect itself —
     * org policy, disallowed user agent — which is a real signal about the
     * account and keeps the sentence above.
     */
    case "provider_refused":
      return {
        headline: `DASH's ${service} sign-in request was rejected.`,
        meaning:
          "Nothing was stored. This is a fault in how DASH asked, not something wrong with your account or anything you did.",
        next_action: "Try again. If it keeps happening, this needs reporting.",
        actor: "dash",
      };

    /*
     * MAR-542: split out of `provider_refused` above. `invalid_client` is
     * RFC 6749 §5.2's own name for client authentication failing, and for
     * this flow that has one cause — the client secret DASH sent (or failed
     * to send) does not match what Google has on file for
     * `lib/oauth/providers.ts`'s client id. That is a config error dressed as
     * DASH's defect until it is named as one: "report this" sends a person
     * looking for a bug, when the actual fix is a value they can set
     * themselves in the minute it takes to read the console page it came
     * from.
     */
    case "client_misconfigured":
      return {
        headline: `DASH's ${service} client secret is wrong or missing.`,
        meaning:
          "Nothing was stored, and this is not about your account — it never got that far. Every sign-in to " +
          `${service} needs DASH to prove which app it is, and the secret it used to prove that was rejected.`,
        next_action:
          "Set the Google client secret DASH is configured with to the value from the Google Cloud console, then try connecting again.",
        actor: "user",
      };

    case "prompt_unavailable":
      return {
        headline: `DASH could not open the ${service} sign-in window.`,
        meaning:
          "Nothing was stored and nothing was sent to the provider. This is a fault in DASH, not something you did or anything wrong with your account.",
        next_action: "Try again. If the window still does not appear, this needs reporting.",
        actor: "dash",
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
/**
 * What to say when DASH read its records and some of them were not there any
 * more.
 *
 * A fourth kind of store failure, and the distinction worth keeping is against
 * `describeViewFailure("unreachable")` directly above. That one means *nothing*
 * arrived and says "nothing is lost" — which is true when a read did not
 * complete, and would be a lie here. This one means the read succeeded and came
 * back short. Collapsing the two would let a page tell a user nothing is lost
 * while showing them a list with an agent missing from it.
 *
 * `actor` is `"dash"`, and that is the honest assignment even though the usual
 * cause is a machine losing power or a process being killed. The user cannot
 * repair a database and must not be asked to try, and the next action is
 * deliberately not "try again": a re-read returns the same damage, so offering a
 * retry would be sending them round a loop DASH already knows the end of.
 *
 * The counts are rendered, the names are not. `agents` is a list of agent names
 * — the user's own words, and the only way "which one is missing?" gets an
 * answer — but nothing derived from the damaged bytes appears anywhere: not the
 * parser's message, not the surviving fragment, not its length.
 */
export function describeStoreDamage(unreadable: {
  agents: readonly string[];
  events: number;
  /** Agent rows so damaged that not even the name came back. */
  unnamed_agents?: number;
  /** Folder/index disagreement found at startup (ADR 0008). */
  agent_folders?: ReadonlyArray<{
    agent: string;
    kind: "folder_unreadable" | "folder_missing" | "index_drift" | "missing_index";
  }>;
}): Recovery | null {
  const named = unreadable.agents;
  const unnamed = unreadable.unnamed_agents ?? 0;
  const agentCount = named.length + unnamed;
  const folderAgents = [
    ...new Set((unreadable.agent_folders ?? []).map((issue) => issue.agent)),
  ];
  const folderRecovery: Recovery | null =
    folderAgents.length === 0
      ? null
      : {
          headline:
            folderAgents.length === 1
              ? `DASH found that ${String(folderAgents[0])}'s agent folder and its index do not agree.`
              : `DASH found agent-folder/index disagreement for: ${folderAgents.join(", ")}.`,
          meaning:
            "The agent folder is authoritative. DASH used the folder where it was readable and kept the last readable index where it was not, so one damaged folder does not take down the Agents page. The disagreement is being shown rather than treated as proof that both stores agree.",
          next_action:
            folderAgents.length === 1
              ? "Re-import that agent to put a fresh complete copy in DASH's keeping."
              : "Re-import those agents to put fresh complete copies in DASH's keeping.",
          actor: "dash",
        };

  if (agentCount === 0 && unreadable.events === 0) {
    // Null for the same reason `describeConnectionCondition` returns null for a
    // healthy connection: an intact store is not a failure state, and a surface
    // that rendered a recovery for one would be teaching people to ignore them.
    return folderRecovery;
  }

  /**
   * The unnamed ones are counted, never invented. An agent whose row would not
   * read has no name left to render, and a placeholder in that position would be
   * shown to a user in the place their own agent's name goes.
   */
  const headline = ((): string => {
    if (agentCount === 0) {
      return "Some of DASH's own records are damaged and could not be read.";
    }
    if (named.length === 0) {
      return agentCount === 1
        ? "DASH could not read what it stored about one of your agents."
        : `DASH could not read what it stored about ${String(agentCount)} of your agents.`;
    }
    if (agentCount === 1) {
      return `DASH could not read what it stored about ${String(named[0])}.`;
    }
    const rest =
      unnamed === 0
        ? ""
        : unnamed === 1
          ? ", and one more it could not name"
          : `, and ${String(unnamed)} more it could not name`;
    return `DASH could not read what it stored about ${String(agentCount)} of your agents: ${named.join(", ")}${rest}.`;
  })();

  const rowRecovery: Recovery = {
    headline,
    // Says both halves plainly: what is still here, and what is not coming back
    // by waiting. A user who is told only the first will assume the second.
    meaning:
      "Everything else on this page is complete and correct. The damaged records cannot be repaired by reopening DASH, and they were damaged on this computer rather than lost in transit — so nothing was sent anywhere and no sign-in was affected.",
    next_action:
      agentCount === 0
        ? "Report this. DASH will keep working without the damaged records."
        : agentCount === 1
          ? "Add the agent again to replace what was lost. Its sign-ins are in your system's keyring and are untouched."
          : "Add those agents again to replace what was lost. Their sign-ins are in your system's keyring and are untouched.",
    actor: "dash",
  };

  if (folderRecovery === null) {
    return rowRecovery;
  }
  return {
    headline: `${rowRecovery.headline} ${folderRecovery.headline}`,
    meaning: `${rowRecovery.meaning} ${folderRecovery.meaning}`,
    next_action: `${rowRecovery.next_action} ${folderRecovery.next_action}`,
    actor: "dash",
  };
}

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
 * The runner's own records (MAR-506)
 * ---------------------------------------------------------------------- */

/**
 * The ways the runner's database can be unusable, as DASH words them.
 *
 * Declared here rather than in `runner/store-damage.ts` on purpose, and the
 * direction is the point: the runner already imports `lib/contracts.ts`, so
 * runner → lib is the established dependency, and putting the vocabulary in the
 * copy module means the classification exists in order to be *said*. A runner
 * that could classify a damage this file has no sentence for would be a runner
 * inventing a state the product cannot explain.
 *
 * Three rather than one, for the reason `describeSecureStoreFailure` keeps five:
 * they lead somewhere different. A malformed image is real damage to a real
 * database. A file that is not a database at all is usually something else
 * having been put there — a sync client's conflict copy, a restore from the
 * wrong place — and blaming the disk for it would send somebody hunting a
 * hardware fault that is not there. And a file DASH cannot read is a permission
 * or a lock, which is not damage and must never be offered a repair that throws
 * the file away.
 */
export type RunnerStoreDamageKind = "malformed" | "not_a_database" | "unreadable";

/**
 * The code the runner puts on the wire for this condition, and the one
 * `lib/agent-dom/transport.ts` matches on before it trusts anything else in the
 * body.
 *
 * Beside the vocabulary rather than in the runner for the same reason the union
 * is: the string exists so that a sentence can be chosen, and the two drifting
 * apart would mean a runner reporting a state DASH answers with a status code.
 */
export const STORE_DAMAGED_REASON = "store_damaged";

/**
 * What to say when the part of DASH that runs agents cannot read its own
 * records.
 *
 * **The distinction this exists to make is against a status code.** Before
 * MAR-506 the user was shown "The runner answered 500." — which names the
 * transport, blames nothing, and leads nowhere. What is actually true is
 * narrower and more useful: DASH reached the runner, the runner is running, and
 * the file it keeps its own records in cannot be read.
 *
 * **And against `describeStoreDamage`, which is the same fault in a different
 * database.** That one is about DASH's own store, where the loss is the user's
 * history: agents, runs, events, the things the pages are made of. This one is
 * about the runner's, which holds replay records, idempotency keys, approval
 * decisions and the index of task files. The consequence is different in a way
 * a user can feel — nothing they can see is missing, and nothing will run —
 * so the two must not share a sentence.
 *
 * `can_retire` is what makes the next action honest. Setting the damaged file
 * aside is a real repair and DASH can perform it, but only where a runner is
 * there to be asked; when there is not, promising a button that is not on the
 * screen would be worse than saying plainly that this one needs reporting.
 */
export function describeRunnerStoreDamage(
  kind: RunnerStoreDamageKind,
  context: { can_retire: boolean } = { can_retire: false },
): Recovery {
  /*
   * Said in every case, and it is the sentence that separates this from the
   * store damage above. A user who has just been told that records are damaged
   * will assume the worst thing they can think of, which is their own history.
   */
  const yourRecordsAreFine =
    "Your agents, runs and sign-ins are not affected — they are kept somewhere else and are intact.";

  /*
   * Also said in every case, because it is the consequence rather than the
   * mechanism. The runner refuses to supervise anything on a store it cannot
   * write, which is deliberate: replay protection and the approval record are
   * what make a run safe to repeat, and an agent running without them would be
   * an agent whose guarantees DASH is still printing and no longer keeping.
   */
  const nothingIsRunning = "No agent is running while this is true, and none will start.";

  const retire =
    "Set the damaged records aside. DASH keeps the old file rather than deleting it, and the runner starts a fresh one.";

  switch (kind) {
    case "malformed":
      return {
        headline: "The part of DASH that runs your agents cannot read its own records.",
        meaning: `${yourRecordsAreFine} What is damaged is the runner's own file — the record of which requests it has already carried out, and which files it is holding for a task. ${nothingIsRunning}`,
        next_action: context.can_retire
          ? retire
          : "Report this. Nothing here can be repaired by reopening DASH.",
        actor: context.can_retire ? "user" : "dash",
      };

    case "not_a_database":
      return {
        // Deliberately not "corrupted". A file that was never a database was
        // almost certainly put there by something else, and telling somebody
        // their disk is failing would send them after the wrong problem.
        headline: "The file the runner keeps its records in is not one of its records.",
        meaning: `${yourRecordsAreFine} Something replaced the runner's file — a backup restored over it, or a sync tool's copy of a conflict. ${nothingIsRunning}`,
        next_action: context.can_retire
          ? retire
          : "Report this. Nothing here can be repaired by reopening DASH.",
        actor: context.can_retire ? "user" : "dash",
      };

    case "unreadable":
      return {
        // Never offered the repair, whatever `can_retire` says: setting aside a
        // file DASH could not read is throwing away a file DASH could not read.
        headline: "The runner is not allowed to open its own records.",
        meaning: `${yourRecordsAreFine} The file is there and DASH could not open it, which is usually another program holding it or a permission that changed. Nothing has been lost. ${nothingIsRunning}`,
        next_action:
          "Close anything else that might be using DASH's folder, then open DASH again.",
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

/* ---------------------------------------------------------------------- *
 * The permission broker (MAR-458)
 * ---------------------------------------------------------------------- */

/**
 * What to say when a brokered request was refused.
 *
 * The agent gets a code; the *person* gets this. Both halves matter and they are
 * different audiences: an agent needs to know whether retrying is worth it, and a
 * user needs to know whether something of theirs needs doing.
 *
 * `actor` is what the split turns on. A refusal the user can fix — a connection
 * they have not made, a permission they declined, a sign-in that was withdrawn —
 * is theirs. Everything else is DASH's or the provider's, and saying so is what
 * stops the Connections page reading like a list of the user's mistakes.
 *
 * **`not_granted` and `unknown_operation` are deliberately the same words.** From
 * a person's side there is no difference worth drawing: an agent asked to do
 * something it is not allowed to do, DASH said no, and nothing about that is
 * theirs to fix. Splitting them would mean explaining DASH's operation catalogue
 * to somebody who did not ask about it, and one of the two sentences would have
 * to name an operation id — which `lib/copy/identifiers.ts` forbids and which
 * would tell them nothing anyway.
 */
export function describeBrokerRefusal(
  refusal:
    | "unknown_operation"
    | "not_granted"
    | "unknown_connection"
    | "not_connected"
    | "revoked"
    | "permission_missing"
    | "invalid_input"
    | "duplicate_request"
    | "rate_limited"
    | "provider_unavailable"
    | "provider_refused"
    | "vault_unavailable"
    | "broker_error",
  context: { service: string; agent: string },
): Recovery {
  const { service, agent } = context;

  switch (refusal) {
    case "unknown_operation":
    case "not_granted":
      return {
        headline: `${agent} asked to do something with ${service} that it is not allowed to do.`,
        meaning: `DASH refused it. Nothing was read and nothing was changed, and the permissions you approved are unchanged.`,
        next_action: `Nothing to do. If this keeps happening, whoever built ${agent} is asking for access it was not given.`,
        actor: "dash",
      };

    case "unknown_connection":
      return {
        headline: `${agent} asked about an account it never said it would use.`,
        meaning:
          "DASH only lets an agent reach the connections its own description lists, so this was refused before anything was read.",
        next_action: `Nothing to do. This needs a fix from whoever built ${agent}.`,
        actor: "dash",
      };

    case "not_connected":
      return {
        headline: `${agent} needs ${service}, and it is not connected.`,
        meaning: `DASH has no sign-in for ${service}, so there was nothing to work with.`,
        next_action: `Connect ${service}.`,
        actor: "user",
      };

    case "revoked":
      // The one refusal that must never read as "try again". Somebody ended
      // this access, and that somebody may have been the user on purpose —
      // `CredentialState.revoked` makes the same argument at more length.
      return {
        headline: `The sign-in DASH holds for ${service} is no longer accepted.`,
        meaning:
          "It was withdrawn, or it expired. Retrying will not help, and until it is reconnected the agent cannot use this account at all.",
        next_action: `Reconnect ${service} if you still want ${agent} to use it.`,
        actor: "user",
      };

    case "permission_missing":
      return {
        headline: `${service} is connected, but not with everything ${agent} needs.`,
        meaning:
          "Something it was asked to do needs a permission that was not granted when you signed in.",
        next_action: `Reconnect ${service} and approve everything on the sign-in screen.`,
        actor: "user",
      };

    case "invalid_input":
      return {
        headline: `${agent} asked ${service} for something DASH could not make sense of.`,
        meaning: "The request was refused before it was sent, so nothing was read.",
        next_action: `Nothing to do. This needs a fix from whoever built ${agent}.`,
        actor: "dash",
      };

    case "duplicate_request":
      return {
        headline: `${agent} sent the same request twice.`,
        meaning: "DASH answered it once and refused the repeat, so nothing happened twice.",
        next_action: "Nothing to do.",
        actor: "dash",
      };

    case "rate_limited":
      return {
        headline: `${agent} is asking for ${service} faster than DASH will allow.`,
        meaning:
          "DASH limits how much of an account an agent can reach in a short time. The extra requests were refused, and they are in this connection's history below.",
        next_action: `Look at what it has been doing. If it is not what you expected, disconnect ${service}.`,
        actor: "user",
      };

    case "provider_unavailable":
      return {
        headline: `DASH could not reach ${service}.`,
        meaning: "This computer may be offline, or the service may be having trouble.",
        next_action: "Try again in a few minutes.",
        actor: "user",
      };

    case "provider_refused":
      return {
        headline: `${service} refused the request.`,
        meaning:
          "The sign-in is still valid — the service said no to this particular request. DASH does not know why, and does not guess.",
        next_action: "Try again later.",
        actor: "user",
      };

    case "vault_unavailable":
      return {
        headline: `DASH could not open the place it keeps the ${service} sign-in.`,
        meaning:
          "The sign-in is not lost. This computer's secure storage would not open just now, so DASH could not read it.",
        next_action: "Unlock your keyring, then let the agent try again.",
        actor: "user",
      };

    case "broker_error":
      return {
        headline: `DASH could not complete a ${service} request for ${agent}.`,
        meaning: "Something went wrong on DASH's side. Nothing was read and nothing was changed.",
        next_action: "Try again. If it keeps happening, this is a fault in DASH.",
        actor: "dash",
      };
  }
}
