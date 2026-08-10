# MAR-588 handoff — Discord notifications, outbound half

Session of 2026-08-10. Branch `000henrik/mar-588-discord-outbound`, PR
[#115](https://github.com/orchestratemcp/orchestratedash/pull/115), open and
human-gated, **both CI buckets green at the head commit** (`1f0f260`, run
`31369327370`), `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN`.

`docs/mar-588-discord-outbound.md` is the technical record — exact payload,
recorded HTTP exchange, file map. This is the shorter thing: what to do next, and
what is not true yet.

## What shipped

DASH posts to a Discord channel when an agent is waiting for an approval or has
published a report. Channel webhook, no bot, no gateway, no hosted relay, **no
recurring cost**. The address is a credential and lives in the OS vault.

New surface at `/notifications` — seventh sidebar destination, and the first that
is about the *person* rather than an agent or a machine. One channel serves the
whole fleet, so adding an agent never comes with a notification setup step.

**Inbound is untouched and unbuilt.** Nothing reads from Discord, no command
arrives from a channel, no query is answered there. That half is MAR-545's, and
this one deliberately puts nothing in a message that could be replied to — so
inbound starts from zero rather than from a token already sitting in a channel's
history.

## The one decision worth re-reading before changing anything

**The sender is in the runner, not in Electron main**, and a sentence in the
setup copy is why:

> With DASH closed and the computer on, messages are still sent: DASH leaves the
> part that runs your agents running, and that is the part that posts to Discord.

That is only true because `electron/runner-process.ts` spawns the runner
**detached**. A notifier beside `electron/approval-notifier.ts` would have been a
third of the size and would have made that sentence a lie: the poll loop that
fills the work inbox is main's, so with the app closed nothing would be watching.

`tests/notify-runner.test.ts` asserts the placement structurally. Moving the
sender into main — which is tempting, because the vault is right there — fails a
check rather than quietly falsifying a page.

## What Henrik has to do that this session could not

### 1. The attended real-channel proof (5 minutes)

Nothing in this branch has contacted Discord. That the live endpoint accepts this
body is a reading of Discord's documentation, not an observation.

1. Open the installed DASH app, go to **Notifications**.
2. In Discord: pick a channel → its settings → **Integrations** → **Webhooks** →
   **New Webhook** → **Copy Webhook URL**.
3. Press **Add a channel address** and paste it.
4. Press **Send a test message**.
5. Screenshot the channel.

The test message says in itself that nothing has happened to any agent, so
pointing DASH at the wrong channel tells that channel nothing about your work.

**What the screenshot settles**, and nothing else does: that Discord accepts the
body, that the message reads the way it reads in the code, and whether
`dash://open?…` survives as copyable text. Expect it to render as **plain text,
not a clickable link** — Discord does not linkify custom schemes, the settings
copy says so, and the only fix is an `https://` redirector on a host we own,
which is a server, which breaks the `$0` rule.

### 2. The end-to-end run with DASH closed (longer)

Each piece is covered and the whole is not. Run `ai-agent-news` to a report with
the DASH window shut and watch a message arrive. That is the proof that promotes
this issue past `merged`.

### 3. `verify:shell` locally

It did not run here. **Roughly two dozen orphan Electron processes** from earlier
sessions are alive on this machine holding the app's single-instance lock — the
smoke printed its store line and died with the Windows cache-contention errors
that signature produces, and `AGENTS.md` forbids force-killing them. CI's Windows
`shell-smoke` is this branch's installed witness and it passes.

## What CI caught that no local gate could

The first push **failed** `shell-smoke` at proof 2c — *the preload exposes only
the named read methods* — because that proof pins the read-method list **by
value** and `notifications` is the eighth read. Its own comment says the line
going red on a first push is the gate doing its job; this is that, and the fix is
one list entry plus a note.

`pnpm test` could not have found it. `tests/shell.test.ts` pins the *command*
catalogue; the read bridge is asserted only against the real installed preload,
which is exactly where a list like this belongs.

## Where things are

| | |
| --- | --- |
| Worktree | `C:\Users\henri\Desktop\projekt\MCP\dash-mar588` |
| Branch | `000henrik/mar-588-discord-outbound` → `master` |
| PR | #115, open, green, mergeable |
| Base | cut from `0048a37`; merged `origin/master` at `4719ea6` (MAR-587 Phase B) mid-flight |
| Local gates | `state:check` valid · `typecheck` clean · `brand:check` green · **133 files / 2644 passed / 10 skipped / 0 failed** |
| Lifecycle | `planned` — nothing was promoted to `proven` |

Two conflicts on the master merge, both the ones a packet always produces:
`state.json`'s `updated_at` and `PROJECT_STATE.md`'s header and tail. Resolved as
unions with MAR-587's section ahead of MAR-588's. Every code file auto-merged, the
repo was grepped for conflict markers, and the full suite was re-run **after** the
merge rather than trusted from before it.

## Next session

Two candidates, and they are not the same size.

**Small, and finishes this issue:** run the two attended proofs above, promote
MAR-588 `planned → merged → proven` with the screenshot and the run cited, and
correct the pre-merge sentences in the packet the way every session before this
one has corrected its predecessor's.

**Large, and is the other half:** MAR-545, inbound. Note what it actually needs
before scoping it — a webhook is one-way by construction, so inbound means a bot
or a gateway connection, which is a different credential, a different trust
boundary, and, unless it runs locally, a different answer to the `$0` rule. A
channel that can send commands is also a channel whose members can act on
somebody else's agents, and none of the outbound work assumed that away.

Recommended for either: **Claude Code `--model sonnet`** for the attended
promotion (bounded, mechanical, evidence-shaped) and **`--model opus` with
extended thinking** for scoping MAR-545, where the trust boundary is the whole
problem and the code is the easy part.
