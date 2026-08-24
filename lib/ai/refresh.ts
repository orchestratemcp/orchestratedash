/**
 * Re-reading every connection DASH holds, and saying what happened to each one
 * (MAR-742, roadmap item 3).
 *
 * ## The recovery this exists to replace
 *
 * Disconnect and re-add. That is what Henrik did on 2026-08-24 when the chief
 * answered "check that a default model is set" from Discord, and it worked —
 * but it works by *destroying and replacing a credential*, which is a violent
 * answer to a question nobody had asked yet: is the credential actually gone?
 * Nothing on any surface could tell him. The vault self-check had recorded the
 * failure at startup and then never looked again, the standing chip renders
 * what a row says rather than what the vault currently does, and the runner
 * holds whatever it was last handed.
 *
 * So: one control that asks all three of those questions again, in order, and
 * reports each answer separately.
 *
 * 1. **Does the vault still hand this credential back?** The question
 *    disconnect-and-re-add never asks, and the one whose answer is usually
 *    *yes* — which means the re-add was unnecessary and the real fault was
 *    somewhere else.
 * 2. **Does the provider still accept it?** `lib/ai/liveness.ts`'s question,
 *    with `lib/ai/liveness.ts`'s discipline about what an answer proves.
 * 3. **Does the runner have it?** MAR-745's push, re-run — because a runner
 *    started before a credential was fixed goes on holding the broken one, and
 *    that is invisible from inside DASH's window.
 *
 * ## Why the report is per connection and not a verdict
 *
 * Because the failure that started this was *one* connection failing while its
 * neighbour in the same directory was fine. A control that collapsed that into
 * "connections refreshed" or a single red banner would have erased the only
 * fact that mattered. Every entry carries its own outcome, and the summary
 * counts rather than judges.
 *
 * ## What is deliberately not here
 *
 * Any path, and any value. `ConnectionRefreshEntry` carries the vault's
 * `path` because a person diagnosing "it says my key is missing" needs to know
 * *which directory DASH looked in* — that is MAR-742's whole finding — but no
 * sentence in this file interpolates it. Paths are rendered as their own
 * element beside the sentence, the way a model id is, so the plain-language
 * gate holds over the words and a filesystem path never becomes prose.
 *
 * Pure, and it renders nothing. `electron/main.ts` performs the three questions
 * and the AI tab draws what is here.
 */

import type { AiLivenessRecord } from "./liveness";

/* ---------------------------------------------------------------------- *
 * What one connection's refresh produced
 * ---------------------------------------------------------------------- */

/**
 * What the vault did when asked for one connection's credential.
 *
 * `held: false` carries the seam's own `code` and `cause` rather than a
 * flattened boolean, for `SecureStoreError`'s reason: `not_found` and
 * `vault_locked` are different next actions, and the whole MAR-684/MAR-742
 * lineage is about not rounding the second into the first.
 */
export type ConnectionVaultOutcome =
  | { held: true }
  | {
      held: false;
      /** The seam's code — `not_found`, `vault_locked`, `backend_unavailable`. */
      code: string;
      /** The mechanism, when the vault knew it: an errno, `decrypt_failed`, … */
      cause: string | null;
      /** Where DASH looked. A path, never a value. Null when not file-backed. */
      path: string | null;
    };

/**
 * One connection, after all three questions.
 *
 * `liveness` is null exactly when `vault.held` is false: there was no
 * credential to present, so no provider was contacted and nothing may be
 * claimed about the key. A record invented for that case would be the
 * `not_checked`-is-a-state rule broken in the one place it costs money to break
 * — it would read as "DASH asked and could not tell", when DASH did not ask.
 */
export interface ConnectionRefreshEntry {
  provider_id: string;
  /** Which account, for a provider that holds more than one. */
  account_id: string;
  /** What a person calls this service. Author content, not DASH vocabulary. */
  service: string;
  vault: ConnectionVaultOutcome;
  liveness: AiLivenessRecord | null;
}

/**
 * Whether the runner was given what DASH now holds.
 *
 * Four states and not a boolean, because "there is no runner" and "the runner
 * refused" are different facts about a machine and only one of them is a
 * problem. `not_attempted` is the honest answer when nothing was worth sending
 * — DASH holds no working credential, so pushing would replace whatever the
 * runner has with the same nothing.
 */
export type RunnerDeliveryOutcome = "delivered" | "no_runner" | "refused" | "not_attempted";

export interface ConnectionRefreshReport {
  checked_at: string;
  entries: readonly ConnectionRefreshEntry[];
  delivery: RunnerDeliveryOutcome;
}

/* ---------------------------------------------------------------------- *
 * What the surface says
 * ---------------------------------------------------------------------- */

export interface RefreshSentence {
  headline: string;
  detail: string;
  /** Null exactly when there is nothing for the person to do about it. */
  next_action: string | null;
  /** Whether this entry is one the person can stop reading. */
  ok: boolean;
}

/**
 * What DASH can say about one connection, having just asked.
 *
 * The vault legs come first and they are the ones this ticket added. Note what
 * `not_found` says now and did not before: **where DASH looked**. The sentence
 * names that a directory is involved and the renderer puts the directory beside
 * it — because "no secret stored as that" sent a person to re-paste a key that
 * was sitting on disk the whole time, and the missing word was never *what*, it
 * was *where*.
 */
export function describeRefreshEntry(entry: ConnectionRefreshEntry): RefreshSentence {
  if (!entry.vault.held) {
    switch (entry.vault.code) {
      case "not_found":
        return {
          headline: `DASH found nothing stored for ${entry.service}`,
          detail:
            "DASH looked in the folder below and there is no entry under this connection's " +
            "name. If you have connected this service on this computer before, the folder " +
            "DASH is reading now may not be the one it wrote to — that is worth checking " +
            "before you paste the key again.",
          next_action: `Connect ${entry.service} again, or check the folder below first`,
          ok: false,
        };
      case "vault_locked":
        return {
          headline: `This computer's vault would not release the ${entry.service} key`,
          detail:
            "The entry is still on disk. Something else is holding it, or the vault is " +
            "locked. Nothing has been changed and nothing has been lost.",
          next_action: "Unlock the vault or close anything else using DASH's folder, then refresh again",
          ok: false,
        };
      case "backend_unavailable":
        return {
          headline: "This computer has no vault DASH can use",
          detail:
            "DASH will not hold a credential without the operating system holding the key " +
            "for it, so there is nothing for it to read back. This is about the computer, " +
            "not about the key.",
          next_action: "Sort out the vault on this computer, then refresh again",
          ok: false,
        };
      default:
        return {
          headline: `DASH could not read the ${entry.service} key`,
          detail:
            "The vault answered with something DASH could not make sense of. Nothing has " +
            "been changed and nothing has been lost.",
          next_action: "Refresh again, and connect the service again if it keeps saying this",
          ok: false,
        };
    }
  }

  if (entry.liveness === null) {
    // Unreachable by construction — `liveness` is null exactly when the vault
    // did not hand a credential over, which every branch above has returned on.
    // Stated rather than asserted: a record that ever arrived in this shape is a
    // bug in the caller, and a sentence is a better outcome than a crash on a
    // page whose whole job is reporting.
    return {
      headline: `DASH holds a key for ${entry.service} and has not asked about it`,
      detail:
        "The key read back from the vault. DASH did not go on to ask the service whether " +
        "it still accepts it, so nothing is claimed about that.",
      next_action: "Refresh again to ask the service too",
      ok: true,
    };
  }

  switch (entry.liveness.state) {
    case "live":
      return {
        headline: `${entry.service} accepted the key DASH holds`,
        detail:
          "The key read back from this computer's vault and the service accepted it just " +
          "now. That is all DASH asked: whether the key is accepted. It does not tell you " +
          "the account has credit.",
        next_action: null,
        ok: true,
      };
    case "key_refused":
      return {
        headline: `${entry.service} would not accept the key DASH holds`,
        detail:
          "The key read back from the vault, so DASH has it — the service turned it down. " +
          "A key that has been deleted or replaced in your account looks exactly like this.",
        next_action: `Make a new key in your ${entry.service} account and connect it here`,
        ok: false,
      };
    case "unreachable":
      return {
        headline: `DASH could not reach ${entry.service}`,
        detail:
          "The key read back from the vault and DASH got no answer at all when it asked. " +
          "This says nothing about the key — it says DASH could not ask. Being offline " +
          "looks like this.",
        next_action: "Refresh again when you are back online",
        ok: false,
      };
    case "provider_error":
      return {
        headline: `${entry.service} answered with something DASH could not read`,
        detail:
          "The key read back from the vault and the service answered with neither an " +
          "acceptance nor a refusal. Being asked to slow down looks like this. DASH is " +
          "not treating it as a verdict on the key.",
        next_action: "Refresh again in a while",
        ok: false,
      };
    case "not_checked":
      return {
        headline: `DASH holds a key for ${entry.service} and has not asked about it`,
        detail:
          "The key read back from the vault. DASH did not go on to ask the service whether " +
          "it still accepts it, so nothing is claimed about that.",
        next_action: "Refresh again to ask the service too",
        ok: true,
      };
  }
}

/**
 * What was done with the result, in one sentence.
 *
 * Separate from the per-connection lines because it is about a different thing:
 * those are about credentials, this is about a process. A runner that never got
 * the fixed key is the exact state Henrik was in — the key was fine and the
 * chief still could not use it — so it gets its own line rather than being
 * folded into a count.
 */
export function describeRunnerDelivery(delivery: RunnerDeliveryOutcome): string {
  switch (delivery) {
    case "delivered":
      return "The background service was given what DASH now holds, so the chief is working from the same keys you are.";
    case "no_runner":
      return "Nothing is running in the background right now, so there was nothing to hand this to. It will be given the current keys when it next starts.";
    case "refused":
      return "The background service would not take the update. It is still working from whatever it had before; starting it again is what fixes that.";
    case "not_attempted":
      return "DASH held nothing worth sending, so the background service was left with what it already had rather than being handed the same problem.";
  }
}

/**
 * The count, and only the count.
 *
 * No verdict: "2 of 3 checked out" is a fact, and "your connections are
 * unhealthy" would be this module deciding how somebody should feel about a
 * provider being rate-limited. The per-connection lines carry the meaning.
 */
export function describeRefreshSummary(report: ConnectionRefreshReport): string {
  const total = report.entries.length;
  if (total === 0) {
    return "There is nothing connected to refresh yet.";
  }
  const ok = report.entries.filter((entry) => describeRefreshEntry(entry).ok).length;
  if (ok === total) {
    return total === 1
      ? "DASH re-read the one connection it holds and checked it with the service."
      : `DASH re-read all ${String(total)} connections it holds and checked each one with its service.`;
  }
  return `DASH re-read ${String(total)} connections and ${String(total - ok)} of them need your attention.`;
}

/* ---------------------------------------------------------------------- *
 * What crosses the bridge
 * ---------------------------------------------------------------------- */

/**
 * One connection's row, flat, already worded.
 *
 * Flat because `CommandResult.data` carries scalars and arrays of flat records
 * and nothing deeper — a shape worth keeping rather than widening, since it is
 * what stops a nested blob of provider content travelling to the renderer
 * unexamined.
 *
 * **Already worded** because that is this codebase's standing rule and not this
 * module's convenience: `ModelDefault` says it plainly — sentences are composed
 * on the trusted side "so the plain language gate holds over them and this page
 * cannot describe the setting differently from the process that resolves it."
 * A renderer handed a code and left to write its own sentence about it is a
 * second vocabulary for the same fact, and this one is about credentials.
 *
 * `next_action` and `path` are empty strings rather than null for the same
 * transport reason. Empty means *there is none* in both cases, and the renderer
 * draws neither element — it never prints an empty path as though DASH had
 * looked nowhere.
 */
export interface ConnectionRefreshRow extends Record<string, string | number | boolean> {
  provider_id: string;
  account_id: string;
  service: string;
  ok: boolean;
  headline: string;
  detail: string;
  next_action: string;
  /**
   * Where DASH looked, when a read failed and the vault knew. Empty otherwise.
   *
   * The one field here that is not a sentence, and it is the reason this ticket
   * exists: `describeRefreshEntry`'s `not_found` branch says a folder is
   * involved, and this is the folder. It stays out of the prose so the
   * plain-language gate reads words and the renderer draws the path as its own
   * element — the way a model id is drawn.
   */
  path: string;
}

/** The report, flattened for the bridge. Pure; the wording is above. */
export function toRefreshRows(report: ConnectionRefreshReport): ConnectionRefreshRow[] {
  return report.entries.map((entry) => {
    const sentence = describeRefreshEntry(entry);
    return {
      provider_id: entry.provider_id,
      account_id: entry.account_id,
      service: entry.service,
      ok: sentence.ok,
      headline: sentence.headline,
      detail: sentence.detail,
      next_action: sentence.next_action ?? "",
      path: entry.vault.held ? "" : entry.vault.path ?? "",
    };
  });
}

/* ---------------------------------------------------------------------- *
 * The copy sweep
 * ---------------------------------------------------------------------- */

/**
 * Every sentence this module can produce, for the plain-language gate.
 *
 * Derived by walking each leg rather than written out, `everyLivenessSentence`'s
 * shape and its reason: a branch added without being added here is one the copy
 * check never sees. The service name is the author's own word and is passed to
 * the gate as an allowance by the test, not sanitised here.
 */
export function everyRefreshSentence(): string[] {
  const held = (state: AiLivenessRecord["state"]): ConnectionRefreshEntry => ({
    provider_id: "openrouter",
    account_id: "account-1",
    service: "OpenRouter",
    vault: { held: true },
    liveness: { state, checked_at: "2026-08-24T18:57:34Z", model_count: state === "live" ? 312 : null },
  });
  const failed = (code: string): ConnectionRefreshEntry => ({
    provider_id: "openrouter",
    account_id: "account-1",
    service: "OpenRouter",
    vault: { held: false, code, cause: "ENOENT", path: null },
    liveness: null,
  });

  const entries: ConnectionRefreshEntry[] = [
    failed("not_found"),
    failed("vault_locked"),
    failed("backend_unavailable"),
    failed("unexpected_error"),
    held("live"),
    held("key_refused"),
    held("unreachable"),
    held("provider_error"),
    held("not_checked"),
    { ...held("live"), liveness: null },
  ];

  const summaries = [
    describeRefreshSummary({ checked_at: "", entries: [], delivery: "no_runner" }),
    describeRefreshSummary({ checked_at: "", entries: [held("live")], delivery: "delivered" }),
    describeRefreshSummary({
      checked_at: "",
      entries: [held("live"), held("live")],
      delivery: "delivered",
    }),
    describeRefreshSummary({
      checked_at: "",
      entries: [held("live"), failed("not_found")],
      delivery: "refused",
    }),
  ];

  return [
    ...entries.flatMap((entry) => {
      const sentence = describeRefreshEntry(entry);
      return [
        sentence.headline,
        sentence.detail,
        ...(sentence.next_action === null ? [] : [sentence.next_action]),
      ];
    }),
    ...summaries,
    ...(["delivered", "no_runner", "refused", "not_attempted"] as const).map(describeRunnerDelivery),
  ];
}
