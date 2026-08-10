/**
 * The four notification commands, on the trusted side (MAR-588, outbound half).
 *
 * `lib/shell/ipc.ts` names them and cannot perform them; this is where the vault
 * is opened, the credential window is raised, and the runner is told. The split
 * is the one every command family in DASH keeps, and here it earns its keep
 * twice over — this module is the only place in the product that holds a Discord
 * webhook address in a variable.
 *
 * ## Where the address goes, exactly, and nowhere else
 *
 * 1. A person types it into the window `electron/credential-prompt.ts` owns. It
 *    reaches main over `dash:credential-submit`, which is the one channel in
 *    DASH a secret travels on and was reviewed once for that purpose.
 * 2. `parseDiscordWebhook` checks it. A URL that is not a Discord webhook over
 *    HTTPS is refused here and never stored — see that function for why the host
 *    check is a closed set rather than a substring.
 * 3. The value goes to the OS vault under `notify.discord-webhook`. A masked
 *    hint and a date go to SQLite. Nothing else is written down.
 * 4. It is read back out and posted to the runner's authenticated control
 *    endpoint, which is what makes the second liveness sentence true.
 *
 * It is never returned to the renderer, never logged, and never placed in a
 * `CommandResult`. `NotifyActionResult` has no field it could occupy.
 *
 * ## Why the runner is told at every opportunity rather than once
 *
 * `pushNotifyConfiguration` is called after a connect, after a disconnect, after
 * a switch, and at startup once the runner's fate is known. That is more calls
 * than strictly necessary and it is the cheap side of the trade: the runner
 * holds the address in memory only, so a runner that restarted while DASH was
 * running has forgotten it, and the failure of *not* re-pushing is silence
 * nobody notices. Sending it again costs one local request.
 */

import type { BrowserWindow } from "electron";

import {
  DISCORD_WEBHOOK_SECRET_NAME,
  buildTestMessage,
  describeWebhookRefusal,
  parseDiscordWebhook,
} from "../lib/notify/discord";
import { deliverDiscordMessage } from "../lib/notify/deliver";
import { NOTIFY_PROMPT } from "../lib/notify/settings";
import { SecureStoreError, type SecureStore } from "../lib/secure-store";
import type { NotifyAction, NotifyActionResult } from "../lib/shell/ipc";
import {
  forgetNotificationWebhook,
  readNotificationSettings,
  recordNotificationWebhook,
  setNotificationKind,
} from "../lib/store";

/**
 * What this module needs from main, injected for the reason every other port in
 * `electron/` is: so the whole of it can be exercised without launching Electron
 * or opening a real vault.
 */
export interface NotifyPorts {
  store: SecureStore;
  /** Raise the credential window. Resolves with what was typed, or null. */
  promptForSecret(request: {
    service: string;
    field_label: string;
    purpose: string;
    help: string | null;
    ai_provider_id: string | null;
  }): Promise<string | null>;
  /**
   * Tell the runner. Resolves either way — a runner that is not up is a
   * temporary state and not a reason to refuse a person's setting.
   */
  pushToRunner(): Promise<void>;
  /** The parent for the modal, or null when there is no window yet. */
  parent?: BrowserWindow | null;
}

/**
 * Run one notification command.
 *
 * Every branch returns a sentence. A settings surface that got back a bare
 * `ok: false` would have to invent one, and the sentence for "the vault is
 * locked" is not something a page is in a position to write.
 */
export async function performNotifyAction(
  action: NotifyAction,
  target: { kind?: string; enabled?: boolean },
  ports: NotifyPorts,
): Promise<NotifyActionResult> {
  switch (action) {
    case "connect":
      return connect(ports);
    case "disconnect":
      return disconnect(ports);
    case "test":
      return test(ports);
    case "set_kind":
      return setKind(target, ports);
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled notification action: ${String(unreachable)}`);
    }
  }
}

async function connect(ports: NotifyPorts): Promise<NotifyActionResult> {
  const backing = ports.store.describeBacking();
  if (!backing.os_backed) {
    // Refused before the window opens, not after the person has pasted. Asking
    // somebody for a credential and *then* saying there is nowhere to put it is
    // the one order this must never happen in.
    return {
      ok: false,
      refusal: "vault_unavailable",
      detail: `This computer has no credential vault available${
        backing.unavailable_reason === undefined ? "" : ` (${backing.unavailable_reason})`
      }, so DASH will not take a channel address it cannot protect.`,
    };
  }

  const typed = await ports.promptForSecret({
    service: NOTIFY_PROMPT.service,
    field_label: NOTIFY_PROMPT.field_label,
    purpose: NOTIFY_PROMPT.purpose,
    help: NOTIFY_PROMPT.help,
    ai_provider_id: null,
  });
  if (typed === null) {
    return { ok: false, refusal: "cancelled", detail: "Nothing was stored." };
  }

  const parsed = parseDiscordWebhook(typed);
  if (!parsed.ok) {
    // The refusal describes the *shape* problem and never quotes the value. A
    // string somebody pasted into a credential field is treated as a credential
    // even once it has turned out not to be one.
    return {
      ok: false,
      refusal: `webhook_${parsed.refusal}`,
      detail: describeWebhookRefusal(parsed.refusal),
    };
  }

  try {
    await ports.store.set(DISCORD_WEBHOOK_SECRET_NAME, parsed.endpoint);
  } catch (error: unknown) {
    return {
      ok: false,
      refusal: error instanceof SecureStoreError ? error.code : "vault_error",
      detail:
        error instanceof SecureStoreError
          ? error.message
          : "This computer's vault would not take the address.",
    };
  }

  // The row goes in after the vault write, never before. A row without a vault
  // entry is a DASH that says it is posting to Discord and cannot.
  recordNotificationWebhook(parsed.masked_hint);
  await ports.pushToRunner();

  return {
    ok: true,
    masked_hint: parsed.masked_hint,
    detail:
      "DASH will post here when an agent is waiting for you, or has published a report. Send a test message to check it arrives.",
  };
}

async function disconnect(ports: NotifyPorts): Promise<NotifyActionResult> {
  // The vault first, then the row, then the runner — the reverse of connect, and
  // for the same reason. A row surviving a deleted credential says DASH is
  // posting when it cannot; a credential surviving a deleted row is a value
  // nothing in DASH will ever read again, which is untidy rather than dishonest.
  try {
    await ports.store.delete(DISCORD_WEBHOOK_SECRET_NAME);
  } catch (error: unknown) {
    // `not_found` is success here: there was nothing to remove and the caller
    // wanted there to be nothing. Anything else is reported, because a vault
    // that refused a delete still holds the address.
    if (!(error instanceof SecureStoreError) || error.code !== "not_found") {
      return {
        ok: false,
        refusal: error instanceof SecureStoreError ? error.code : "vault_error",
        detail:
          "This computer's vault would not remove the address, so DASH has left everything as it was.",
      };
    }
  }

  forgetNotificationWebhook();
  await ports.pushToRunner();

  return {
    ok: true,
    detail:
      "DASH has forgotten the channel and will not post again. Messages it already sent stay in Discord.",
  };
}

/**
 * Send one test message, from main rather than from the runner.
 *
 * Deliberately not routed through the runner, even though the runner is what
 * sends every real message. The two answer different questions: this one is
 * "does the address I just pasted reach a channel", asked by somebody sitting in
 * front of DASH, and answering it here means it works on a machine whose runner
 * failed to start — which is exactly the machine where a person most needs to
 * find out what is wrong.
 *
 * The cost of the split is that a successful test does not prove the runner can
 * also reach Discord. Both processes are on the same machine behind the same
 * network, so that is a narrow gap; it is named here rather than papered over.
 */
async function test(ports: NotifyPorts): Promise<NotifyActionResult> {
  let endpoint: string;
  try {
    endpoint = await ports.store.get(DISCORD_WEBHOOK_SECRET_NAME);
  } catch (error: unknown) {
    if (error instanceof SecureStoreError && error.code === "not_found") {
      return {
        ok: false,
        refusal: "not_configured",
        detail: "DASH has no channel address stored, so there is nothing to test.",
      };
    }
    return {
      ok: false,
      refusal: error instanceof SecureStoreError ? error.code : "vault_error",
      detail:
        "This computer's vault would not hand back the address. Unlock it and try again.",
    };
  }

  const outcome = await deliverDiscordMessage(endpoint, buildTestMessage());
  if (outcome.kind === "delivered") {
    return { ok: true, detail: "Discord took the message. Check the channel." };
  }
  if (outcome.kind === "rate_limited") {
    return {
      ok: false,
      refusal: "rate_limited",
      detail: "Discord asked DASH to slow down. Wait a moment and try again.",
    };
  }
  return { ok: false, refusal: outcome.kind, detail: outcome.detail };
}

async function setKind(
  target: { kind?: string; enabled?: boolean },
  ports: NotifyPorts,
): Promise<NotifyActionResult> {
  // Checked here rather than in the pure command layer, beside the write it
  // guards — the same placement `refreshSampleAgent`'s ownership gate has, and
  // for the same reason: a check at the seam is one a second caller can miss.
  if (target.kind !== "needs_approval" && target.kind !== "new_report") {
    return {
      ok: false,
      refusal: "unknown_kind",
      detail: "DASH does not have a setting by that name.",
    };
  }
  if (target.enabled === undefined) {
    return { ok: false, refusal: "missing_value", detail: "Nothing was changed." };
  }

  setNotificationKind(target.kind, target.enabled);
  await ports.pushToRunner();

  return { ok: true, detail: readNotificationSettings().configured ? "Saved." : "Saved." };
}

/**
 * What to POST to the runner: the address it should use, or `null` to clear it.
 *
 * Separated from the request itself so the decision — *should the runner be
 * posting at all, and where* — is one pure-ish function reading the vault and
 * the store, testable without a runner. It returns `null` for every reason there
 * is: nothing configured, both switches off, the vault locked, the entry gone.
 * All four mean the same thing to the runner, which is "do not post", and
 * collapsing them here is what keeps that endpoint from having to know why.
 */
export async function buildNotifyConfiguration(store: SecureStore): Promise<{
  webhook_url: string | null;
  send_approvals: boolean;
  send_reports: boolean;
}> {
  const settings = readNotificationSettings();
  const silent = { webhook_url: null, send_approvals: false, send_reports: false };

  if (!settings.configured || (!settings.send_approvals && !settings.send_reports)) {
    return silent;
  }

  try {
    return {
      webhook_url: await store.get(DISCORD_WEBHOOK_SECRET_NAME),
      send_approvals: settings.send_approvals,
      send_reports: settings.send_reports,
    };
  } catch {
    // Not reported anywhere. This runs at startup and after every settings
    // change, and a locked vault at one of those moments is an ordinary state —
    // the settings page is where a person finds out, by pressing Send a test
    // message and being told the vault would not answer.
    return silent;
  }
}
