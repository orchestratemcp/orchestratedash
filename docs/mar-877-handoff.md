# MAR-877 — task-first global Settings (AI, Connections, Discord)

Client: Claude Code, `claude --model opus`. Worktree
`C:\Users\henri\AppData\Local\Temp\wt-ux877-s1`, branch
`000henrik/mar-877-global-settings`, off `master` at `0e52211`, merged twice
during the session (`2894539`, then `4ae4625` after MAR-875 landed).

PR: https://github.com/orchestratemcp/orchestratedash/pull/327

Lane C of the 2026-09-06 UX wave, UX-3's **global** half. MAR-874's per-agent
Settings stage is a different lane and nothing here touches it.

---

## 1. The rule this change followed

**Not a word of copy was rewritten.** Every sentence about a permission, a
consequence, a credential, a shared grant or a failed verification is still
composed in the module that owned it, and still says what it said. What changed
is the order a person meets them in, and what is open on arrival.

That was the constraint the packet set, and it is also why the diff is mostly
structure: three page files, three shared components, one appended CSS block,
four new modules and eleven test files.

## 2. What changed, by surface

### AI tab (`app/settings/ai/page.tsx`)

Two states where there was one.

- **No model key.** `AiFirstKey` — one card: pick a provider from a chooser,
  read that provider's own `FleetConnectorCard`, add the key. Nothing about
  routing, defaults or repair is drawn at all, because there is nothing yet to
  route, default or repair; the tab used to open with recovery prose above a
  setup it had not offered.
- **A key held.** `ModelRouting` — the one line saying what is in force
  (`setting.in_force`, unchanged), then two folds: **Advanced routing** over the
  level rows and the key cards, **Troubleshoot** over the refresh control.

Both folds open themselves when there is a reason: no default chosen yet, an
agent waiting to be given a key DASH already holds, a key DASH cannot read. Two
new counted lines say why, above the fold.

**The ADR 0013 moment-3 adoption press is untouched.** It is the same button on
the same card. When anybody is waiting the fold opens rather than a second
button being drawn — two controls doing one thing is how a page comes to
disagree with itself about whether it was pressed. MAR-874 and MAR-878 both
depend on this being findable; the capture run in §4 exercises it end to end.

`ConnectionsRefresh` stays mounted **beside** the loading gate, never inside it
(MAR-685: `useView` returns to `loading` on every bump, so a control mounted
under the gate destroys the report it just produced). The Troubleshoot fold is
therefore a sibling of the gate, mounted from the first moment the page has seen
a key — a sticky `useState` + `useEffect`, deliberately, because a fold derived
from `held.length > 0` would unmount itself on every reload. See §6 for the one
consequence of that choice.

### Connections tab (`app/settings/page.tsx`, `connection-card.tsx`, `service-row.tsx`)

- **Services first.** The five per-agent lapse blocks that stood between the
  page title and the first service become one `BrokerLapseSummary` **below** the
  service list: one line carrying both numbers (how many periods, across how
  many agents) with every period, every window and every qualifier kept inside
  it, one row per agent. The caveat that these are not decisions was repeated
  under all five and is now said once.
- **Two agents with one name** are told apart by their folder, humanised, never
  by an id (MAR-589's ruling). New self-contained module
  `lib/views/agent-labels.ts`. `ServiceRow` asks it in both places a dependent's
  name is drawn — the list above the fold and the per-agent receipt inside it.
- **The consequences of authorizing** now sit under a summary naming the act
  (*Before you sign in* / *Before you add this key*), **open while the decision
  is live and folded once the grant exists** — MAR-642's own split on the
  Notifications page. ADR 0002 amendment 2 is intact: the person who has not
  connected yet reads every word without pressing anything, still above the
  button.

`BrokerLapseNotice` is unchanged and is still what an agent's own surface draws.

### Discord tab (`app/settings/notifications/page.tsx`)

Two labelled halves — *Alerts DASH sends you* and *Talk to the chief in
Discord* — with one grammar each: a state line, one primary action, and a closed
**Manage** holding replace-credential, pause and disconnect. Stop and disconnect
are exactly one press inside Manage, never a second fold deep.

- Configured channel: the primary press is *Send a test message*, not *Replace
  the address*.
- Configured bridge: there is no primary press — it is working — and *Start
  listening* takes that place while the bridge is paused.
- The two chief ids move into Manage beside the press that writes them, because
  `chiefDiscord.connect` (`electron/chief-discord.ts`) always opens the token
  window first, so a visible field with no visible save is an edit a person can
  make and not commit. The facts they carry stay above the fold in words, from
  `describeChiefDiscordStanding`.

Credentials, revocation semantics and what Discord actually supports are
unchanged. The `<h1>` is now *Discord alerts and chat*, because the page holds
both halves.

## 3. Files changed

Commits: `018014d` (the packet), `00403f5` (a found defect + the frames),
`39a9376` / `9d4d6dc` (merges of `origin/master`).

```
app/settings/page.tsx                     app/_components/connection-card.tsx
app/settings/ai/page.tsx                  app/_components/model-default.tsx
app/settings/notifications/page.tsx       app/_components/service-row.tsx
app/globals.css  (appended block only)    electron/capture-settings-polish.ts
lib/copy/settings-ai.ts             (new) tests/copy-settings-ai.test.ts        (new)
lib/copy/settings-connections.ts    (new) tests/copy-settings-connections.test.ts (new)
lib/copy/settings-notifications.ts  (new) tests/copy-settings-notifications.test.ts (new)
lib/views/agent-labels.ts           (new) tests/agent-labels.test.ts            (new)
tests/ai-tab-render.test.tsx              tests/service-row-render.test.tsx
tests/notifications-render.test.tsx       tests/connection-card-render.test.tsx
qa-screenshots-mar-877/{before,after}/    (15 PNGs + 2 layout JSONs, 3.3 MB)
```

Each new copy module has an `every*Sentence()` enumerator and a
`tests/copy-settings-*.test.ts` gate calling `expectPlainLanguage` over it.
`app/globals.css` is **appended to only**, inside a fenced `MAR-877` block; no
shared rule is restyled in place. The merge of MAR-875 conflicted there exactly
as expected — two appended blocks at one insertion point — and was resolved by
keeping both, MAR-875's first.

## 4. What was verified, and how

Everything below was run from **PowerShell** in the worktree.

| Command | Result |
|---|---|
| `pnpm typecheck` | clean (run after every edit and after both merges) |
| `pnpm brand:check` | green — 12 characters, 96 frames, 4 bundled fonts |
| focused: the 15 test files this lane touches or pins | **15 files, 253 tests, all passed** |
| `pnpm test` | see the summary line quoted in §5 |

### Capture frames

`electron/capture-settings-polish.ts` run twice, once per build, each against a
fresh isolated scratch root with the store and the Chromium profile both under
it and both passed (`scripts/run-capture-groupD.ps1`'s recipe, wrapped for this
packet's output directory):

- **before** — a detached worktree at `0e52211`, its own `pnpm install`, both
  builds.
- **after** — this branch.

47 frames each; `no frame overflowed sideways`, `no heading repeats its active
tab` on both. The curated set committed under `qa-screenshots-mar-877/` is the
three pages at 1280 and 375 from each build, plus the three frames that
exercise the adoption press. No raw key appears in either `layout-settings.json`
(the harness's own key is a scene-only fake and is masked anyway).

**The adoption press, proven in the real shell:**

```
MAR-624 before  waiting:2  has_this:0  share_label:"Give it to 2 waiting agents"
MAR-624 after   waiting:0  has_this:2  share_label:null
                store held: digest-writer -> models/key, market-watcher -> models/key
```

**Density, from the harness's own counters** (`main_words` is `innerText`, so it
counts what is *visible*, not what is in the markup):

| page (1280, light) | before | after |
|---|---|---|
| AI | 453 | 405 |
| Connections | 257 | 261 |
| Notifications | 286 | 292 |

The AI page shows 48 fewer words on arrival with nothing deleted — the
Troubleshoot fold's content is present and closed. The two flat numbers are the
expected result of a change that only moves things and adds two headings.

### Two findings the numbers and the pictures produced

1. **A real copy removal, caught by the counters.** The first draft of
   `ModelDefault`'s new `standing` prop suppressed all three of its lines,
   dropping `setting.detail` — the sentence saying that choosing a model on an
   agent's own page always wins and that changing the default never moves an
   agent that has chosen. That is a consequence, not a repetition of the summary
   line. The word count fell to 370, which is what exposed it. Fixed; the prop
   now suppresses only the heading and the in-force line, and three tests pin
   it.
2. **A pre-existing layout defect, caught by looking at the frame.** An `h3`
   inside a `section-disclosure` summary fell through the shared rule that only
   covers `h2`, so each of the chief bridge's three disclosures drew a bare
   triangle on its own line with its heading orphaned underneath. Visible on
   master in
   `qa-screenshots-mar-877/before/notifications-1280-light-comfortable.png`.
   Nothing overflowed, no counter moved, no test could see it. Fixed inside this
   packet's own CSS block; the Notifications page is the only surface in the app
   that puts an `h3` in a disclosure summary, so the blast radius is nil.

### Harness witnesses updated

The in-force sentence left `.model-default`, which would have made the
`model_default` witness go quietly empty on a page that still says it. The
harness now reads it from whichever section carries it, and records
`summary_line`, `advanced_fold`, `ai_first_key`, a `folds` list of every
disclosure label, and `refresh_control`. That last pair is what settled question
1 above: a restructure that folds something away and one that loses it look
identical in a word count.

## 5. Evidence class

**Fixture tests plus scratch-store capture frames. Nothing installed.**

- The render tests are `renderToStaticMarkup` over view documents. They prove
  markup and order, not that a press works.
- The capture frames are a real Electron shell against a **seeded scratch
  store**, never the live one. The MAR-624 scene is the only place a press is
  actually exercised end to end, and it is the one that matters most here.
- **The installed proof at 100% and 80% scale is the orchestrator's.** Nothing
  in this packet was run against `%APPDATA%\orchestratedash`, and Henrik's DASH
  was not touched.

`pnpm test` summary line, run after the final merge:

>  Test Files  275 passed (275)
>       Tests  5199 passed | 13 skipped (5212)

Exit code 0, no failing file. An earlier full run on this branch (before the
last two merges) had 11 failures, all of them the pre-existing dash-mcp cleanup
flake in §7.3; it did not fire this time.

## 6. What is NOT done, and what to watch

1. **The lapse roll-up has no frame.** The capture seed creates no broker
   lapses, so the Connections reordering is proved by
   `tests/ai-tab-render.test.tsx`'s `ServiceList` tests and
   `tests/connection-card-render.test.tsx`'s `BrokerLapseSummary` tests only.
   Henrik's own store has five; the orchestrator's installed pass is where that
   picture gets taken.
2. **The disambiguator has no frame either**, for the same reason — the seed has
   one *Meeting Assistant*, not two. `tests/agent-labels.test.ts` and
   `tests/service-row-render.test.tsx` carry the rule.
3. **Disclosure state is not persisted.** The lane allowed it if the existing
   view-settings mechanism could carry it; it cannot without a pre-paint script
   (four pieces, static renderer), which the lane said to skip and say so. Every
   fold uses the repo's `boolean | null` "null until somebody presses" shape, so
   a person's choice survives within a visit and not across one.
4. **The Troubleshoot fold is sticky, not derived.** Once the AI tab has seen a
   key it stays mounted for the life of the page. Removing the last key leaves
   the fold there until a reload. That is the deliberate trade against MAR-685;
   the alternative flickers the control in and out on every bump.
5. **`main_words` counts only visible text.** Anyone comparing these numbers to
   an earlier run should know that folding something changes the count without
   changing the page's content — §4's table is only meaningful read with the
   `folds` witness beside it.

## 7. Needs orchestrator

1. **Agent ids are rendered as labels on the Connections page, on master and
   still.** The Gmail row's button reads **GIVE IT TO MEETING-ASSISTANT** and the
   consequence sentence reads *"Connecting Gmail connects it for
   meeting-assistant"* — the folder slug, in primary copy, in a button. Both
   before and after frames show it, so it is not a regression here. The source is
   `fleet.waiting` / `describeSharedGrant` carrying agent **ids** where MAR-589's
   ruling wants titles, and both live in `lib/connectors.ts` / `lib/fleet/**`,
   which this lane is explicitly forbidden to write. It wants a small packet of
   its own: carry the title beside the id on the view, or resolve it at the
   composition site. It is the most visible remaining violation of the
   plain-language rule on this surface.
2. **No `lib/views/types.ts` field was needed**, so nothing is pending there for
   another lane.
3. **A pre-existing full-suite flake**, not from this branch:
   `tools/dash-mcp/tests/template-run.test.ts` fails with `EPERM` on `rmSync` in
   its `afterEach` — the known "cleanup racing a live child" shape (MAR-702). It
   failed 11/11 under an earlier full run on this branch and passed 11/11 on
   its own re-run immediately after; the final full run (§5) did not trip it
   at all. Nothing in this branch touches `tools/dash-mcp/**`. It is worth a
   small packet against that file's `afterEach`, which discards the wait it
   should be checking (MAR-702's own lesson).
4. **The capture wrapper is not committed.** `scripts/run-capture-groupD.ps1`
   hardcodes a 2026-08-25 output directory, and `scripts/**` is outside this
   lane's ownership, so the MAR-877 run used a copy in the session scratchpad
   with `-Slug` / `-StoreSlug` split apart (a re-run needs a fresh store root —
   the old one's runner holds `runner.sqlite`, and deleting it is what makes an
   unretirable runner). If group-D captures are going to keep happening, that
   wrapper wants generalising in `scripts/`, by whoever owns that directory.
5. **Three scratch runners are alive** from the capture runs, under
   `%TEMP%\mar877-capture\{after-r2,after-r3,after-r4}` and
   `%TEMP%\mar877-capture\before`. They were left deliberately — never
   force-killed, never had their stores deleted. `scripts/retire-groupD-runners.mjs`
   is the graceful end for them; it points at the group-D root, so it needs the
   path adjusting or the runners retiring by hand.
6. **The comparison worktree is already gone.** `wt-ux877-before` was detached
   at `0e52211` with its own `node_modules`, existed only to build the "before"
   frames, and was removed with `git worktree remove --force` once they were
   committed — nothing left to clean up there. Worth keeping, though:
   **Turbopack refuses a junctioned `node_modules`**
   (*"Symlink [project]/node_modules is invalid, it points out of the filesystem
   root"*), so a comparison worktree needs its own real install — about 100
   seconds — rather than a link to a sibling's.

## 8. The one thing the next session should do first

Open the installed DASH on Henrik's own store, go to **Settings → Connections**,
and photograph the top of the page at 100% and at 80%. That is the one claim
this packet makes that no test and no frame here can reach: on a store with five
lapsing agents, the first service should now be the first thing under the
summary line, with a single line about the periods below the list. Everything
else in §4 is already witnessed.
