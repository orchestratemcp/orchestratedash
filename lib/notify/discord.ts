/**
 * What DASH says to a Discord channel, and what it refuses to say (MAR-588,
 * outbound half).
 *
 * Two events reach a channel: an agent is waiting for an approval, and an agent
 * published a report. Everything about *how* that message is composed lives
 * here, pure and I/O-free, because the composition is the security boundary.
 * `lib/notify/deliver.ts` puts the bytes on the wire and is deliberately unable
 * to add a field.
 *
 * ## The four rules a message obeys, and why each one is here
 *
 * 1. **No secret.** The webhook URL is the credential — anyone holding it can
 *    post to that channel — and it appears in no message body, no log line and
 *    no error. It is not a field on `DiscordMessage` at all, so a future caller
 *    cannot pass one by accident: `deliverDiscordMessage` takes the endpoint as
 *    a separate argument that never joins the payload.
 *
 * 2. **No raw provider content, and no agent-authored prose.** MAR-421's OS
 *    notification carries the approval's own `action_label`, which is right for
 *    a toast on the user's own screen. This is not that: a Discord message
 *    leaves the machine and lands somewhere a channel's members can read. So the
 *    only non-DASH string in a message is the agent's *name* — the one the
 *    person accepted when they added it — and never the label of the action,
 *    the title of the report, or a line of what the agent read or wrote.
 *
 *    That is a real loss of usefulness and it is the correct trade. A channel
 *    message that quoted the approval would publish, to everyone in the channel,
 *    the contents of whatever the agent happened to be working on.
 *
 * 3. **No approval token in any URL.** The deep link carries an agent id, and a
 *    run id for a report. It carries no approval id, no nonce and no bearer of
 *    any kind, and following it approves nothing — see `lib/open-link.ts`, which
 *    states the same rule from the parsing side. A link that could approve would
 *    be a link anybody who joined the channel could press.
 *
 * 4. **The agent's name cannot become a message.** It is author-supplied text
 *    that DASH is about to place inside its own sentence, which is the shape
 *    every injection has. `agentLabel` collapses it to one line, caps it, and
 *    escapes Discord's markdown; `allowed_mentions` is sent empty so that no
 *    name, however it is spelled, can ping a channel. Both are asserted in
 *    `tests/notify-discord.test.ts` rather than intended here.
 *
 * ## Why the deep link is plain text and not a Discord link
 *
 * Discord linkifies `http`, `https` and a short list of other schemes. It does
 * not linkify `dash://`, and a markdown link whose target is an unknown scheme
 * renders as its own literal text. So the URL sits on its own line, to be
 * copied, and no amount of formatting will make it a button.
 *
 * The alternative — an `https://` link on a host DASH owns, which redirects to
 * the `dash://` one — is a server, and a server is a recurring cost. The whole
 * of this feature exists inside the "no recurring cost" rule, so the honest
 * answer is the copyable line and a sentence in the settings copy saying so.
 */

/** The one vault entry this feature uses. A name, never a value. */
export const DISCORD_WEBHOOK_SECRET_NAME = "notify.discord-webhook";

/**
 * The two things worth telling a channel about.
 *
 * Deliberately the same two the product already treats as "something needs
 * you": `lib/shell/approval-popup.ts` surfaces the first on this machine, and a
 * published report is what `AgentRow.glance` calls new. A third kind — a run
 * started, a run failed — is not here, because a channel that reports every
 * lifecycle transition is a channel people mute, and a muted channel delivers
 * nothing at all.
 */
export type NotificationKind = "needs_approval" | "new_report";

/**
 * One thing that happened, reduced to what may leave the machine.
 *
 * There is no field for the approval's label, the report's title, the run's
 * status or the agent's output, and that absence is rule 2 expressed as a type:
 * a caller cannot pass content this module would then have to remember not to
 * render.
 */
export interface NotifiableEvent {
  kind: NotificationKind;
  /** The agent's id, for the deep link. Never rendered as text. */
  agent_id: string;
  /** What the person calls this agent — `display_name`, or the id if there is none. */
  agent_title: string;
  /** The run a report belongs to, for the deep link. Null for an approval. */
  run_id: string | null;
}

/**
 * A Discord webhook execution body, narrowed to the two fields DASH sends.
 *
 * `embeds`, `username`, `avatar_url`, `tts`, `components` and `files` are all
 * absent and none of them is an oversight. Each is a way for more of somebody's
 * data — or more of somebody's formatting — to reach a channel, and this
 * feature's whole value is that the message is short, DASH's own words, and the
 * same shape every time.
 */
export interface DiscordMessage {
  content: string;
  /**
   * Empty on purpose, and the most load-bearing two words in this file.
   *
   * Discord resolves `@everyone`, `@here`, role and user mentions out of message
   * *content* unless told otherwise. An agent named `@everyone` — which nothing
   * stops an author calling their agent — would otherwise ping a whole server
   * every time it wanted an approval. An empty `parse` list disables all four
   * classes at the API, which is a stronger guarantee than escaping the text and
   * hoping the escape covers the next syntax Discord adds.
   */
  allowed_mentions: { parse: [] };
}

/* ---------------------------------------------------------------------- *
 * The webhook URL
 * ---------------------------------------------------------------------- */

/**
 * Hosts a Discord webhook can live on.
 *
 * A closed list, checked against the URL's host and not against a substring.
 * The reason is the thing that makes this feature dangerous if it is wrong: the
 * value a person pastes here is a place DASH will send messages about their
 * agents, unattended, for as long as it is stored. `discord.com.attacker.example`
 * contains "discord.com" and is somebody else's collector.
 *
 * The two staging hosts are Discord's own client channels and are accepted
 * because a person testing against them is testing against Discord.
 */
const DISCORD_WEBHOOK_HOSTS: ReadonlySet<string> = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
]);

/**
 * The path Discord's "Copy Webhook URL" button produces.
 *
 * The optional version segment is real — Discord hands out both `/api/webhooks/…`
 * and `/api/v10/webhooks/…` — and the two captures are the parts that matter: an
 * id, which identifies the webhook, and a token, which *is* the credential.
 */
const DISCORD_WEBHOOK_PATH = /^\/api(?:\/v\d{1,2})?\/webhooks\/(\d{5,32})\/([A-Za-z0-9_-]{16,120})$/;

export type WebhookRefusal =
  | "not_a_url"
  | "not_https"
  | "not_discord"
  | "not_a_webhook"
  | "carries_extra";

export type WebhookParse =
  | {
      ok: true;
      /**
       * The URL, trimmed and normalised. This is what goes to the vault.
       *
       * Returned rather than the caller reusing its own input, so that what is
       * stored is what was checked — a trailing newline from a paste is the
       * ordinary case, and storing the unchecked original would mean the value
       * on disk is not the value that passed.
       */
      endpoint: string;
      /**
       * Four trailing characters of the **token**, masked, for the settings page.
       *
       * The token and not the id: the id names a webhook and the token is what
       * lets anyone holding it post. Masking the half that is the credential is
       * what makes this hint the same kind of thing as every other masked hint in
       * DASH — see `lib/secret-refs.ts`, whose `isMaskedHint` this satisfies.
       */
      masked_hint: string;
    }
  | { ok: false; refusal: WebhookRefusal };

/**
 * Decide whether a pasted string is a Discord webhook DASH will post to.
 *
 * Pure, and strict on purpose. Every refusal here costs a person one look at
 * their Discord settings; the false negative this exists to prevent costs them
 * a stream of messages about their agents going somewhere they did not choose.
 *
 * It does **not** contact Discord. Whether the webhook still exists is a
 * question only a real request answers, which is `notify.test`'s job — and the
 * distinction is worth keeping: this says the string is well-formed, and only a
 * delivery says the channel is there.
 */
export function parseDiscordWebhook(raw: string): WebhookParse {
  const trimmed = raw.trim();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, refusal: "not_a_url" };
  }

  if (url.protocol !== "https:") {
    // Not a style preference. `http:` would put the token, which is the whole
    // credential, on the wire in clear text on whatever network the machine is
    // on at the time.
    return { ok: false, refusal: "not_https" };
  }
  if (!DISCORD_WEBHOOK_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, refusal: "not_discord" };
  }
  if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    // A query, a fragment or embedded credentials are all things the copy button
    // does not produce, so a URL carrying one was assembled by hand or by
    // something else. Refusing is cheaper than reasoning about what `?wait=true`
    // or a userinfo section would do to a request DASH makes unattended.
    return { ok: false, refusal: "carries_extra" };
  }

  const match = DISCORD_WEBHOOK_PATH.exec(url.pathname);
  if (match === null) {
    return { ok: false, refusal: "not_a_webhook" };
  }

  const token = match[2] as string;
  return {
    ok: true,
    endpoint: url.toString(),
    masked_hint: maskWebhookToken(token),
  };
}

/** How much of the token the hint shows. Matches `lib/secret-refs.ts`. */
const HINT_REVEALED = 4;
const HINT_MASK = "••••";

function maskWebhookToken(token: string): string {
  return token.length >= HINT_REVEALED * 2
    ? `${HINT_MASK}${token.slice(-HINT_REVEALED)}`
    : HINT_MASK;
}

/**
 * What to tell a person about a URL DASH would not take.
 *
 * One sentence per refusal, in the shape `lib/copy/recovery.ts` uses: what is
 * wrong, and what to do instead. No refusal echoes the value — a string somebody
 * pasted into a credential field is treated as a credential even when it turned
 * out not to be one.
 */
export function describeWebhookRefusal(refusal: WebhookRefusal): string {
  switch (refusal) {
    case "not_a_url":
      return "That does not look like a web address. In Discord, open the channel's settings, choose Integrations, then Webhooks, and use the Copy Webhook URL button.";
    case "not_https":
      return "A webhook address has to be a secure one. Use the Copy Webhook URL button in Discord rather than typing the address by hand.";
    case "not_discord":
      return "That address is not on Discord, so DASH will not send your agents' messages to it. Copy the address from the channel's own Webhooks settings.";
    case "not_a_webhook":
      return "That is a Discord address, but not a channel webhook. In the channel's settings, choose Integrations, then Webhooks, then Copy Webhook URL.";
    case "carries_extra":
      return "That address has something extra on the end. Paste exactly what Discord's Copy Webhook URL button gives you, with nothing added.";
    default: {
      const unreachable: never = refusal;
      throw new Error(`Unhandled refusal: ${String(unreachable)}`);
    }
  }
}

/* ---------------------------------------------------------------------- *
 * The message
 * ---------------------------------------------------------------------- */

/**
 * The longest an agent's name may be inside a message.
 *
 * Discord's own content limit is 2000 characters, so this is not about the API
 * refusing the request. It is about a name being one line of a short message
 * rather than the message: a 300-character "name" would push DASH's own sentence
 * and the link off the bottom of what a reader takes in, which is the cheapest
 * form of the injection this file's rule 4 is about.
 */
const MAX_TITLE_LENGTH = 60;

/**
 * Characters Discord treats as formatting, escaped so a name renders as a name.
 *
 * The backslash is first because escaping it after the others would double the
 * escapes this function just added.
 */
const MARKDOWN_SPECIALS = ["\\", "*", "_", "~", "`", ">", "|", "[", "]", "(", ")", "#", "-"];

/**
 * An agent's name, made safe to place inside DASH's own sentence.
 *
 * Three steps, in this order, each closing a different hole:
 *
 * 1. **Collapse to one line.** Any run of whitespace — including newlines, tabs
 *    and the assorted Unicode spaces — becomes one ordinary space. This is the
 *    step that matters most: a name containing a newline could otherwise end
 *    DASH's sentence and begin a line of its own that reads as DASH speaking.
 * 2. **Cap the length**, with an ellipsis so a truncated name is visibly one.
 * 3. **Escape Discord's markdown**, so a name is never also formatting.
 *
 * An empty or whitespace-only name falls back to a plain word rather than
 * rendering an empty gap. Nothing in DASH should produce one — `agent_title`
 * falls back to the id — but a message reading "**" needs a reader to guess.
 */
export function agentLabel(title: string): string {
  const collapsed = title.replace(/\s+/gu, " ").trim();
  if (collapsed === "") {
    return "An agent";
  }
  const capped =
    collapsed.length > MAX_TITLE_LENGTH
      ? `${collapsed.slice(0, MAX_TITLE_LENGTH - 1)}…`
      : collapsed;

  let escaped = capped;
  for (const special of MARKDOWN_SPECIALS) {
    escaped = escaped.split(special).join(`\\${special}`);
  }
  return escaped;
}

/**
 * DASH's own sentence for each kind. Present tense for the thing still waiting,
 * past tense for the thing already finished — which is the difference a person
 * scanning a channel needs before they read anything else.
 */
const HEADLINE: Record<NotificationKind, string> = {
  needs_approval: "is waiting for your approval.",
  new_report: "published a new report.",
};

/**
 * Compose the message for one event.
 *
 * The whole message is DASH's words plus `agentLabel(event.agent_title)` plus a
 * link built by `lib/open-link.ts`. Nothing else is interpolated, and there is
 * no branch that can add a field: a caller with a report title in hand has
 * nowhere to put it.
 */
export function buildDiscordMessage(
  event: NotifiableEvent,
  link: string,
): DiscordMessage {
  const label = agentLabel(event.agent_title);
  return {
    content: `${label} ${HEADLINE[event.kind]}\nOpen it in DASH: ${link}`,
    allowed_mentions: { parse: [] },
  };
}

/**
 * The message `notify.test` sends.
 *
 * Named rather than assembled at the call site, and it says what it is: a
 * person who set this up and then forgot which channel they pointed it at
 * should be able to tell from the message alone that DASH sent it and that
 * nothing has actually happened to any of their agents.
 */
export function buildTestMessage(): DiscordMessage {
  return {
    content:
      "DASH is set up to post here. You will get a message when one of your agents is waiting for your approval, or has published a report. Nothing has happened yet — this is the test.",
    allowed_mentions: { parse: [] },
  };
}
