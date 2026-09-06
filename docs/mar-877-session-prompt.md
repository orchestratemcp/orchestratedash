# Lane C — MAR-877: simplify GLOBAL AI, Connections and Discord settings (UX-3 global)

Tier: Opus (three pages, shared components, permission copy that must stay
honest). Read `ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux877-s1`
Branch: `000henrik/mar-877-global-settings` (from origin/master 0e52211)
Issue: MAR-877 (https://linear.app/martini-home/issue/MAR-877). This is
GLOBAL Settings only. MAR-874 (the per-agent Settings stage, `agent-settings.tsx`,
`model-choice.tsx`, the detail page) is a different lane later — do not touch it.

## What the installed build shows tonight (orchestrator screenshots, 2026-09-06)

Settings → Connections ("Accounts you connect"): the intro says "3 services
DASH can connect for you. None is connected yet.", then FIVE per-agent lapse
blocks ("AI-NEWS-SCOUT-4 — There is 1 period DASH cannot account for", …×5)
before the first service (Gmail) appears; under Gmail, two "Meeting Assistant"
rows both NOT CONNECTED with identical names (no disambiguation), then a
"DASH is in the middle" disclosure with three paragraphs of permission prose,
then SIGN IN TO GMAIL. Settings → AI: recovery prose first, then three
routing/level cards, then keys (per the audit). Settings → Notifications:
webhook alerts and chief Discord chat on one page with credential replacement
prominent.

Code map (orchestrator-verified): `app/settings/page.tsx` (Connections;
`lapsing` block using `BrokerLapseNotice` from `app/_components/connection-card.tsx:535`;
services via `app/_components/service-row.tsx`), `app/settings/ai/page.tsx`
(`AiKeys` :136 → `FleetConnectorCard` per provider from `app/_components/fleet-connector.tsx`;
`ModelDefault` + `LevelRows` from `app/_components/model-default.tsx:48/:298`),
`app/settings/notifications/page.tsx` (`NotificationSettings` :117, buttons :218-252;
`ChiefDiscordSection` :347 with in-page `chief-channel`/`chief-user` fields and
"Add a bot token"/"Replace the bot token" :475). Tab list is data:
`app/_data/routes.ts:128 SETTINGS_TABS`. Tests: `tests/ai-tab-render.test.tsx`,
`tests/notifications-render.test.tsx`, `tests/connection-card-render.test.tsx`,
`tests/service-row-render.test.tsx`, `tests/fleet-connector-render.test.tsx`,
`tests/model-render.test.tsx`, `tests/connections-list.test.ts`,
`tests/broker-lapses.test.ts`, `tests/chief-discord.test.ts`, `tests/notify-settings.test.ts`,
`tests/settings-tabs.test.tsx`.

## Design (orchestrator defaults; reversible; record deviations)

**AI page** — task-first, two states:
- *Nothing connected*: one card: "Connect a model provider" (the three provider
  cards become one chooser: pick provider → connect key), then "Choose the model
  DASH uses by default" appears only after a key is held. No recovery prose
  until there is something to recover.
- *Connected*: a one-line summary "Using <provider> · default <model>" with
  Change; the three level rows (cheap/standard/frontier) and per-provider key
  cards move under a closed "Advanced routing" disclosure; repair/lapse prose
  moves under a closed "Troubleshoot" disclosure that only renders when there
  is a real problem. The "Give it to N waiting agents" adoption button
  (`fleet-connector.tsx:336-354`) stays visible and primary whenever
  `waiting.length > 0` — it is the ADR 0013 moment-3 press and MAR-874/MAR-878
  depend on it being findable. Do not change its semantics.
- Expired/disconnected: the summary line states it and offers Reconnect;
  everything else stays collapsed.

**Connections page** — lead with services: the service list first; the
per-agent lapse notices collapse into ONE summary line ("DASH could not
account for N periods across M agents" + a closed disclosure listing them,
one row each). Agents with identical display names get a disambiguator
(agent id short form or folder name in a muted suffix — but no raw ids in
primary copy; use the existing disambiguation helper if one exists, else a
small one in `lib/views/` with a test). Explain shared-agent permissions ONCE,
at the point of authorization (the sign-in step / consequence note), not
above every service. Keep every sentence of the existing permission copy in
its module; only placement and default visibility change.

**Notifications page** — split into two clearly labelled sections with their
own state lines: "Alerts (Discord webhook)" and "Chat with the chief in
Discord". Each has: one state sentence, one primary action, and a closed
"Manage" disclosure holding replace-credential / disable / disconnect. Stop
and disconnect stay one click inside Manage, never hidden deeper. Keep the
distinct credentials and revocation semantics exactly as they are.

Rules: masked values stay masked; nothing about permission consequences or
failed verification is removed, only moved behind a disclosure that says
"Why?"/"Details"; keyboard focus order sane; disclosure open/closed state may
persist per viewer (localStorage or the existing view-settings mechanism —
check `dash-persisted-view-settings` pattern in `app/_data/` before inventing
one; if it needs a pre-paint script, skip persistence and say so).

Do NOT advertise Slack or any connector that is not built. Do not change what
Discord actually supports.

## Ownership (write)

`app/settings/page.tsx`, `app/settings/ai/page.tsx`,
`app/settings/notifications/page.tsx`, `app/_components/{fleet-connector,model-default,connection-card,service-row,connections-refresh}.tsx`,
new `lib/copy/settings-*.ts` copy modules you create (each with an
`every*Sentence()` enumerator and a `tests/copy-settings-*.test.ts` gate),
`lib/views/` additions only if new and self-contained (new file + test), and
the tests listed above. `app/globals.css`: append-only block. NOT:
`app/settings/{servers,add-agent,preferences,startup,reporting}/**`,
`app/_components/{model-choice,agent-settings,server-card,deploy}.tsx`,
`lib/fleet/**`, `lib/ai/**` (read-only), `lib/views/types.ts` (if you need a
new optional field on a view, add it as optional and list it under "Needs
orchestrator" — another lane may need the same file).

## Verification / evidence

Typecheck, focused tests, `pnpm test` once. For frames: `electron/capture-settings-polish.ts`
and `electron/capture-models.ts` exist (see `scripts/run-capture-groupD.ps1`
for the isolated scratch-store recipe); run them from PowerShell with a scratch
`DASH_DATA_DIR`, `DASH_CAPTURE_DIR` and `--user-data-dir` so nothing touches
the live app, and put before/after frames under `qa-screenshots-mar-877/`
(small PNGs, no keys visible). Update the harness counters/witnesses if your
structure changes what they measure. Evidence class: fixture tests + scratch
frames; the installed proof at 100%/80% scale is the orchestrator's.

Stop condition: PR open, tests green, `docs/mar-877-handoff.md` written.
