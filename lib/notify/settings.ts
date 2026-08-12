/**
 * What DASH holds about Discord notifications, and what it tells a person
 * before they set them up (MAR-588, outbound half).
 *
 * Pure. The record shape and the words, in one module, because the words are
 * about the record: "DASH holds the address in this computer's vault" is a claim
 * about `masked_hint` being the only part that can ever be read back, and a copy
 * file that could drift from the store would be a claim nobody is holding.
 *
 * ## The liveness sentences are the point of this file
 *
 * `NOTIFY_LIVENESS` states, before anyone pastes anything, exactly when a
 * message will and will not arrive. Every other notification product in this
 * category leaves that to be discovered: a person sets it up on a laptop, closes
 * the lid, and finds out days later that the thing they were relying on to tell
 * them their agent needed an answer was only ever running while they were
 * looking at it.
 *
 * DASH can be precise about it because of where the sender lives. It is not in
 * the app — it is in the runner, which `electron/runner-process.ts` spawns
 * **detached** so that "closing the DASH window leaves running agents running".
 * The same flag that keeps the agents alive keeps the thing that notices them
 * alive. So the three claims are:
 *
 * 1. DASH open — messages are sent.
 * 2. DASH closed, computer on — messages are still sent, by the runner DASH left
 *    behind.
 * 3. Computer off or restarted — nothing is sent, because nothing is running.
 *    The runner has no restart policy anywhere in DASH (`runner/README.md` item
 *    3 records that as deliberate) and does not come back on its own. An agent
 *    that must survive that has to live on a server, which is what
 *    `host.deploy` is for.
 *
 * These are asserted in `tests/notify-settings.test.ts` against the sender's
 * actual placement, so the third one cannot quietly become false by somebody
 * moving the notifier into Electron main.
 */

import { DISCORD_WEBHOOK_SECRET_NAME } from "./discord";

export { DISCORD_WEBHOOK_SECRET_NAME };

/**
 * What the store holds. Never the address itself.
 *
 * `masked_hint` is four trailing characters of the webhook's token, and it is
 * the only part of the credential that exists outside the vault — the same
 * arrangement `lib/secret-refs.ts` describes for every other connection in DASH.
 * There is no field a value could be assigned to, which is what makes
 * "the address is never rendered back" a property of the type rather than a rule
 * the settings page has to remember.
 */
export interface NotificationSettings {
  /** True once an address has been stored and not since removed. */
  configured: boolean;
  /** `••••` plus four characters, or null when nothing is stored. */
  masked_hint: string | null;
  /** DASH's own clock at the moment it was stored. Null when nothing is. */
  configured_at: string | null;
  /**
   * Whether an agent waiting on an approval produces a message.
   *
   * Separate from `send_reports` because they are different urgencies: an
   * approval is something blocked on the person, and a report is something
   * finished. Somebody who wants to be interrupted for one and not the other is
   * the ordinary case, not a power user.
   */
  send_approvals: boolean;
  send_reports: boolean;
}

/** What DASH holds before anybody has set anything up. */
export const NO_NOTIFICATIONS: NotificationSettings = {
  configured: false,
  masked_hint: null,
  configured_at: null,
  send_approvals: true,
  send_reports: true,
};

/* ---------------------------------------------------------------------- *
 * The words
 * ---------------------------------------------------------------------- */

/**
 * When a message arrives and when it does not — shown before setup, not after.
 *
 * Three sentences and no fourth. The temptation with copy like this is to soften
 * the last one, and softening it is the only way it could be wrong: "messages
 * may be delayed while your computer is off" would be a sentence that is
 * technically about the same situation and tells the reader the opposite thing.
 */
export const NOTIFY_LIVENESS: readonly string[] = [
  "While DASH is open, messages are sent as things happen.",
  "With DASH closed and the computer on, messages are still sent: DASH leaves the part that runs your agents running, and that is the part that posts to Discord.",
  "With the computer off, asleep or restarted, nothing is sent — there is nothing running to send it. An agent that has to keep working then needs to live on a server.",
];

/**
 * What ends up in the channel, said plainly before anyone chooses a channel.
 *
 * This is the disclosure that decides whether a person picks a private channel
 * or a shared one, so it is on the page before the field rather than under it.
 * `lib/notify/discord.ts` is what makes each line true.
 */
export const NOTIFY_CONTENTS: readonly string[] = [
  "The agent's name, and whether it is waiting for you or has published something.",
  "Where to find it in DASH — Agents, then the agent's name — said in words, because the message does not rely on a link working.",
  "A link that opens that agent in DASH on this computer, for an installed copy that has claimed it. Discord shows it as text to copy, not as a button, and an unpackaged DASH never claims it at all.",
  "Nothing else. Not what the agent read or wrote, not what it is asking permission for, and nothing anybody could use to answer for you.",
];

/**
 * How to get the address, in the order Discord's own screens present it.
 *
 * Written from the Discord side rather than the DASH side, because that is where
 * the person has to go and it is the half they have not done before.
 */
export const NOTIFY_SETUP_STEPS: readonly string[] = [
  "In Discord, pick the channel you want the messages in. A private channel only you are in is a fine choice.",
  "Open that channel's settings, choose Integrations, then Webhooks, then New Webhook.",
  "Press Copy Webhook URL.",
  "Paste it into DASH. It goes straight into this computer's vault and is never shown again.",
];

/**
 * The one-line answer to "what is DASH about to do with this".
 *
 * Shown at the field, because a person pasting a credential should be told what
 * holds it at the moment they part with it and not on a different page.
 */
export const NOTIFY_CUSTODY =
  "The address is a credential: anyone holding it can post to that channel. DASH puts it in this computer's vault, never shows it again, and never writes it to a log.";

/** The prompt's own words, for the window `promptForSecret` opens. */
export const NOTIFY_PROMPT = {
  service: "Discord",
  field_label: "Discord webhook address",
  purpose: "So DASH can tell you in Discord when an agent is waiting for you or has published a report.",
  help: "In Discord: channel settings, then Integrations, then Webhooks, then Copy Webhook URL.",
} as const;

/**
 * What the settings surface says about the current state, in one sentence.
 *
 * A function rather than two constants so that the "off" case cannot be worded
 * as an error. Nothing is wrong with a person who has not set this up; the
 * sentence says what would happen if they did.
 */
export function describeNotificationState(settings: NotificationSettings): string {
  if (!settings.configured) {
    return "DASH is not posting to Discord. Nothing about your agents leaves this computer.";
  }
  if (!settings.send_approvals && !settings.send_reports) {
    return "DASH holds a channel address, and both kinds of message are switched off, so nothing is being sent.";
  }
  if (!settings.send_reports) {
    return "DASH posts to Discord when an agent is waiting for your approval.";
  }
  if (!settings.send_approvals) {
    return "DASH posts to Discord when an agent publishes a report.";
  }
  return "DASH posts to Discord when an agent is waiting for your approval, and when one publishes a report.";
}

/**
 * Whether an event of this kind should be sent at all.
 *
 * Here rather than in the runner, so the switch that a person set on a page and
 * the check that decides whether bytes leave the machine are the same function.
 */
export function shouldSend(
  settings: Pick<NotificationSettings, "configured" | "send_approvals" | "send_reports">,
  kind: "needs_approval" | "new_report",
): boolean {
  if (!settings.configured) {
    return false;
  }
  return kind === "needs_approval" ? settings.send_approvals : settings.send_reports;
}
