# MAR-588 — Discord notifications, outbound half

What DASH sends to a Discord channel, where the sender lives, what it will not
say, and the evidence behind each claim.

Inbound is **out of scope** and unbuilt: nothing in DASH reads from Discord, no
command arrives from a channel, and no query is answered there. That half waits
on MAR-545.

## The shape of it

| | |
| --- | --- |
| Transport | One `POST` to a Discord channel webhook. No bot, no gateway, no relay, no hosted anything. |
| Cost | Zero. A channel webhook is a URL Discord hands out for free and DASH posts to it directly. |
| Credential | The webhook URL. Vault only (`notify.discord-webhook`), typed into the existing credential window, never rendered back, never logged. |
| Sender | The **runner**, not the app. See "Why the runner" below. |
| Events | An agent is waiting for an approval; an agent published a report. |
| Settings | `/notifications` — a seventh sidebar destination, the first that is about the person rather than an agent. |

## The exact payload

Two fields. There is no third, and `DiscordMessage` has no field a caller could
put one in.

```json
{
  "content": "AI agent news is waiting for your approval.\nOpen it in DASH: dash://open?agent=ai-agent-news",
  "allowed_mentions": { "parse": [] }
}
```

```json
{
  "content": "AI agent news published a new report.\nOpen it in DASH: dash://open?agent=ai-agent-news&run=run-2026-08-10-01",
  "allowed_mentions": { "parse": [] }
}
```

`allowed_mentions.parse: []` is the load-bearing half. Nothing stops an author
naming their agent `@everyone`, and escaping does not help — `@` is not markdown.
An empty parse list disables every mention class at the API, which is a stronger
guarantee than any escape this repository could keep current.

The agent's name is the only non-DASH string in a message. `agentLabel` collapses
it to one line, caps it at 60 characters, and escapes Discord's formatting, so a
name cannot end DASH's sentence and start a line that reads as DASH speaking.

### What a message never carries

- **No secret.** The webhook URL is a separate argument to
  `deliverDiscordMessage` and never joins the body. Nothing returns it: not the
  view, not a command result, not a log line, not an error.
- **No raw provider content.** Not the approval's label, not the report's title,
  not a line of what the agent read or wrote. MAR-421's OS toast does carry the
  action label, correctly — that message stays on the user's own screen. This one
  lands somewhere a channel's members can read.
- **No approval token in any URL.** The link carries an agent id, and a run id
  for a report. `parseOpenLink` **refuses** a URL carrying any third parameter, so
  a link that grew an `approval_id` in transit is rejected rather than ignored.
  Following a link approves nothing; it opens a page.

### The link is text, not a button

Discord linkifies `http`, `https` and a short list of other schemes. It does not
linkify `dash://`, and a markdown link to an unknown scheme renders as its own
literal text. So the URL sits on its own line, to be copied.

The alternative is an `https://` link on a host DASH owns that redirects to the
`dash://` one — which is a server, and a server is a recurring cost. The `$0` rule
decides it. The settings page says so in `NOTIFY_CONTENTS` rather than leaving it
to be discovered.

## Why the runner sends, and the liveness sentences

The setup copy tells a person, before they paste anything:

1. While DASH is open, messages are sent as things happen.
2. With DASH closed and the computer on, messages are still sent — DASH leaves
   the part that runs the agents running, and that is the part that posts.
3. With the computer off, asleep or restarted, nothing is sent. An agent that has
   to keep working then needs to live on a server.

Sentence 2 is why the notifier is `runner/notify.ts` and not
`electron/approval-notifier.ts`'s neighbour. `electron/runner-process.ts` spawns
the runner **detached**, which is what already makes "closing the DASH window
leaves running agents running" true; the same flag makes the thing that notices
them outlive the window. A notifier in Electron main would have been a third of
the size and would have made sentence 2 a lie — the poll loop that fills the work
inbox is main's, so with the app closed nothing would be watching.

Sentence 3 is the cost of the design, stated rather than closed. The runner holds
the address in **memory only** — never in `runner.sqlite`, never in a file, never
in a log — so a restart leaves it with nothing, and there is no restart policy
anywhere in DASH on purpose (`runner/README.md` item 3). DASH hands the address
over at startup and after every settings change; until it does, nothing is sent.

`tests/notify-runner.test.ts` asserts the placement structurally: the hook is
called from the supervisor's line handler, and `electron/main.ts` contains no
`DiscordNotifier`. Moving the sender into main to make the vault easier to reach
would fail those two checks.

## Evidence

### Proven

| Claim | Evidence |
| --- | --- |
| The exact bytes DASH puts on a socket | `tests/notify-transport.test.ts` — real `node:http` listener on loopback, real `deliverDiscordMessage`, method/headers/body asserted. Transcript below. |
| Mentions cannot fire | `allowed_mentions.parse` asserted empty on every composed message |
| No provider content leaves | `tests/notify-runner.test.ts` drives an approval whose label is `Wire 4,000 EUR to Acme Ltd` and asserts neither string reaches the wire |
| No approval token in a link | `tests/open-link.test.ts` — every extra parameter refused, by shape rather than by name |
| The address is not in the store | `tests/notify-settings.test.ts` scans the SQLite bytes including `-wal`, the way `tests/redaction.test.ts` does |
| The store refuses a raw value | `recordNotificationWebhook` throws unless `isMaskedHint` passes |
| Only a Discord webhook is accepted | `discord.com.example.net` refused as `not_discord`; `http:` refused; a query or fragment refused |
| Rate limits, refusals and outages are told apart | 429 / 404 / 503 / unreachable each exercised against the real listener |
| An unreachable host is reported without naming it | Node's own error carries the host in `cause`; the transport discards it |

### Not proven — attended, for Henrik

**A real webhook fired at a real Discord channel.** Nothing here has contacted
Discord. What is unproven by the above:

- that Discord accepts this body shape at the live endpoint (it matches the
  documented execute-webhook request, and that is a reading of documentation, not
  an observation);
- that the message renders in a channel the way it reads here;
- that `dash://open?…` is shown as copyable text rather than stripped.

The attended run is: open `/notifications` in the installed app, press **Add a
channel address**, paste a webhook from a channel's Integrations settings, press
**Send a test message**, and screenshot the channel. `notify.test` posts
`buildTestMessage()`, which says in the message itself that nothing has happened
to any agent — so pointing DASH at the wrong channel tells that channel nothing
about anybody's work.

**The end-to-end path with DASH closed** is also unproven. The pieces are each
covered — the supervisor calls the notifier on the line an agent wrote, the
notifier posts, the runner is detached — and nothing has yet run an agent to an
approval with the DASH window shut and watched a message arrive.

## Recorded exchange

Produced by `DASH_NOTIFY_TRANSCRIPT=<path> pnpm vitest run tests/notify-transport.test.ts`
on 2026-08-10. The path is rewritten to a placeholder because it carries the
ephemeral port that run happened to bind; the headers and bodies are exactly what
arrived. Requests 4–8 are the same test message re-sent to exercise the answer
branches (429, 429-clamped, 404, 503, unreachable).

```http
--- request 1 ---
POST /api/webhooks/{id}/{token} HTTP/1.1
host: 127.0.0.1:{port}
content-type: application/json
user-agent: OrchestrateDASH (local notifier)
content-length: 139

{"content":"AI agent news is waiting for your approval.\nOpen it in DASH: dash://open?agent=ai-agent-news","allowed_mentions":{"parse":[]}}

--- request 2 ---
POST /api/webhooks/{id}/{token} HTTP/1.1
host: 127.0.0.1:{port}
content-type: application/json
user-agent: OrchestrateDASH (local notifier)
content-length: 155

{"content":"AI agent news published a new report.\nOpen it in DASH: dash://open?agent=ai-agent-news&run=run-2026-08-10-01","allowed_mentions":{"parse":[]}}

--- request 3 ---
POST /api/webhooks/{id}/{token} HTTP/1.1
host: 127.0.0.1:{port}
content-type: application/json
user-agent: OrchestrateDASH (local notifier)
content-length: 225

{"content":"DASH is set up to post here. You will get a message when one of your agents is waiting for your approval, or has published a report. Nothing has happened yet — this is the test.","allowed_mentions":{"parse":[]}}
```

No `authorization` header and no cookie. The credential *is* the URL, which is
how a Discord webhook works; a second one would be a secret nobody supplied.

## Where each piece lives

| File | What it owns |
| --- | --- |
| `lib/notify/discord.ts` | Composition, the webhook-URL check, the name-escaping rules. Pure. |
| `lib/notify/deliver.ts` | One HTTP request and the five things an answer can mean. The only place the credential goes on a wire. |
| `lib/notify/settings.ts` | The record shape and every sentence, including the three liveness claims. |
| `lib/open-link.ts` | The `dash://open` authority — a second authority beside `handoff`, with its own parser. |
| `runner/notify.ts` | The queue, the dedup, the retry policy. Holds the address in memory. |
| `runner/server.ts` | `POST /notify/discord`, the one route in that file that carries a credential inbound. |
| `electron/notify-settings.ts` | The four commands on the trusted side: vault, prompt, push to runner. |
| `app/notifications/page.tsx` | The surface. Liveness and contents *before* the field, deliberately. |

## Open questions for the inbound half (MAR-545)

- A channel that can send commands is a channel whose members can act on somebody
  else's agents. The outbound half deliberately puts nothing in a message that
  could be replied to, so inbound starts from zero rather than from a token
  already in a channel's history.
- The webhook is one-way by construction. Inbound needs a bot or a gateway
  connection, which is a different credential, a different trust boundary, and —
  unless it is a local process — a different answer to the `$0` rule.
