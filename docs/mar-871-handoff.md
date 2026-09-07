# MAR-871 / UX-4 — the server page, 2026-09-06

Client: Claude Code `--model opus`, worker lane D of the wave-3 UX fan-out.
Worktree `C:\Users\henri\AppData\Local\Temp\wt-ux871-s1`, branch
`000henrik/mar-871-server-page` from `origin/master` `0e52211`, merged forward
to `ccfe220` before push. PR #325. Five commits: the packet, this handoff, two
fixes that a capture run and a re-read found, and the frames.

**Nothing here is machine-affecting.** No Electron shell smoke was run, no
installed store was opened, no host was reached, nothing was deployed, and no
schedule or channel was touched.

---

## What changed

| file | what |
| --- | --- |
| `lib/server-card.ts` | `ServerCardState`, `serverCardState`, `primaryServerAction`, `reachedTheServer`; `no_runner_there` becomes a success tone and reads *ready*; `ServerCheck` gains `running` and `residency_on`; `summariseServers` gains three clauses; `DEPLOY_LIVES_ON_THE_AGENT` rewritten |
| `app/_components/server-card.tsx` | the card renders one state and one primary action; `MoreAboutThisServer` overflow; `SetupPanel` becomes the five-step recipe with copy controls; `ResidencyOnThisServer` becomes one switch fed by the page; `SendAnAgentHere` disambiguates and separates a refusal |
| `app/settings/servers/page.tsx` | `contactedAt` and `residencyReports`; the summary's separate facts; the duplicate gate; the account placeholder; `AddressStep` takes the duplicate rather than computing it |
| `lib/host-wizard.ts` | `EMPTY_FIELD`, `describeSetupRecipe`, `USE_THE_SAVED_SERVER`; step 2's rail label is `Set it up` |
| `lib/copy/host-residency.ts` | `RESIDENCY_COPY.not_asked` |
| `app/globals.css` | one appended block, fenced `/* ==== MAR-871 begin/end ==== */`. Nothing edited in place |
| `electron/capture-servers.ts` | scenes, a `seed()`, a recipe press, two new measurements |
| `tests/server-card.test.ts`, `tests/server-card-render.test.tsx`, `tests/host-wizard.test.ts`, `tests/host-wizard-render.test.tsx`, `tests/host-residency.test.ts` | see the checklist below |

### The model

Fifteen `HostConnectState` members fold into the seven situations a *card* has
to behave differently in, and each gets exactly one control. The fifteen stay
distinct — MAR-572/573/600 spent three attended runs pulling them apart — and
**every sentence still comes from `describeConnectState`**. This decides what a
card does about a state, never what it says about one; a second set of state
sentences here would be MAR-605's defect with more words.

| state | from | one control |
| --- | --- | --- |
| `not_set_up` | `awaiting_key_install`, `helper_not_installed`, `key_not_on_server`, `runner_refused_credential` | Set up this server / Set it up again |
| `checking` | `probing` | none; the control says `Checking...` |
| `never_checked` | `not_checked` | Check now |
| `needs_your_ok` | `confirm_host_key` | Yes, this is my server |
| `needs_your_ok` | `host_key_not_trusted` | Check now — there is no code to compare yet |
| `up` | `no_runner_there`, `reachable` naming nothing | Put an agent here |
| `in_use` | `reachable` naming something | Check now |
| `unreachable` | the five walls where DASH never got in | Check now |

Everything that came off the face — the setup text, putting a second agent on a
machine that already has one, the pinned identity, disconnecting — is behind one
overflow rather than deleted. Unfindable is the same as missing, and this page
has already paid once for learning that.

---

## The nine defects

| | fix | test |
| --- | --- | --- |
| **D1** the banner contradicts the card | `reachedTheServer` reads the *described* state's `reach`, not `step`. The page stamps `contactedAt` from it and the summary counts that | `server-card.test.ts` — "says the server answered whenever DASH got on to it", "counts a server DASH signed in to but found no runner on as having answered" |
| **D2** an empty account field renders `""` | `checkDraft` substitutes `EMPTY_FIELD` only where the field is genuinely empty; the placeholder reads `for example, root` | `host-wizard.test.ts` — "never quotes an empty value back at somebody", "answers the question the field asked", "still quotes a value somebody did type"; `host-wizard-render.test.tsx` — "reads as an example rather than a value already filled in" |
| **D3** the duplicate warning does not gate the action | the duplicate moves up to `ConnectServer`; **Make key** is disabled while it holds; **Use the one you have** appears beside it; the notice now ends on its own `next_action` | `host-wizard-render.test.tsx` — "names the record, the cost, and what to do instead" |
| **D4** two agents share a name; a run-on refusal | the id is drawn as a `<code>` value **only** where titles collide; headline and detail are two blocks | `server-card-render.test.tsx` — "tells two agents with the same name apart", "separates a refusal's headline from its detail" |
| **D5** the schedule panel asserts the wrong machine | **not fixed — not this lane's file.** See *Needs orchestrator* | — |
| **D6** the schedule radios ignore clicks | **not fixed — not this lane's file.** See *Needs orchestrator* | — |
| **D7** the header chip is stale after a deploy | **not fixed — not this lane's file.** See *Needs orchestrator* | — |
| **D8** "Put an agent here" does not put an agent there | with exactly one sendable agent the control **is** a link to the step that sends it; with several the list is the choice, its rows read *Put it here*, and `DEPLOY_LIVES_ON_THE_AGENT` instructs instead of explaining a routing decision | `server-card-render.test.tsx` — "instructs rather than explaining a routing decision" |
| **D9** "DASH has not checked" survives acts that reached the machine | `contactedAt` is a second map, stamped by a check that signed in **and** by residency, bring-home and key placement. `checkedAt` still belongs to the standing, so a residency press cannot put a fresh moment beside a stale answer | `server-card.test.ts` — the contact assertions above; the page holds the join |
| **finding** no route back to the setup text once enrolled | the recipe is in every card's overflow, as five numbered steps: which program to open, the `ssh` line pre-filled from the record with a copy control, whose password the server will ask for, the snippet, and Check now | `server-card-render.test.tsx` — "still offers it on a server that is already set up"; `host-wizard.test.ts` — the five recipe assertions |

### Two more from the same run's notes

- **The rail label for step 2 was stale.** It read `The key` while the step's
  content has been the one-paste setup text since MAR-573. It reads `Set it up`.
- **`no_runner_there` was drawn amber.** It is the state every freshly enrolled
  server is in, with nothing left to repair — Henrik's ruling is that this is
  the one clear *your server is up*. Chip and card border are the success colour
  and the chip reads `SIGNED IN, READY`.

---

## What is deliberately **not** claimed

- **MAR-864** (a deployed agent is never started on the host) and **MAR-872**
  (`at_local` read against the host's clock) are untouched, and nothing here
  papers over either. Nothing says *running* that the host did not say: the
  running clause of the summary is skipped entirely when no host produced a
  number, and `null` is never read as nought.
- **Last successful job has no source.** UX-4 asks the summary to distinguish
  four facts and only three of them exist. `agent_deploys` is bounded by
  ADR 0010 to DASH's own outbound act, `evidence_pulls` holds only local rows,
  and MAR-865 established that no run has yet produced output on a host at all.
  There is no clause for it; adding one would be a field invented by a renderer.
- **Residency is DASH's own act, not the machine's state.** The summary says
  *you have asked*. Only the card reports what the server answered, and it says
  `RESIDENCY_COPY.not_asked` until a check has actually asked.

---

## What was verified, and how

Run from **PowerShell**, in the worktree.

```
pnpm typecheck        -> clean (no output)

pnpm brand:check      -> brand:check passed - 12 characters audited against the
                         vendored manifest, 12 action sheets / 96 frames, 3
                         rendered sizes, 9 files using the cast, 93 files
                         checked for remote fonts, 4 bundled font files verified

pnpm vitest run tests/server-card.test.ts tests/server-card-render.test.tsx
  tests/host-wizard.test.ts tests/host-wizard-render.test.tsx
  tests/copy-host.test.ts tests/host-residency.test.ts
  tests/host-sighting-render.test.tsx tests/deploying.test.ts
  tests/hosts-view.test.ts tests/host-connect.test.ts
                      -> Test Files 10 passed (10)
                         Tests 239 passed | 2 skipped (241)

pnpm test             -> Test Files 2 failed | 266 passed (268)
                         Tests 4 failed | 5069 passed | 13 skipped (5086)
```

The focused line above is the final one, taken after both fixes below. The four
failures in the full run are in `tools/dash-mcp/tests/template-run.test.ts` and
`tests/store-damage.test.ts` — **neither is this lane's file**, and
`store-damage` imports only `lib/copy/recovery`, which this packet does not
touch. Both were re-run alone, as the standing note about parallel load
requires:

```
pnpm vitest run tools/dash-mcp/tests/template-run.test.ts
                      -> Test Files 1 passed (1); Tests 11 passed (11)
pnpm vitest run tests/store-damage.test.ts
                      -> Test Files 1 passed (1); Tests 28 passed (28)
```

`store-damage`'s failure was a 5000ms test timeout, on a machine that had just
run three Electron capture scenes. Both are the known load flake, not a
regression.

### Two defects the capture run itself found

Worth recording, because neither would have been caught by a test:

1. **The recipe pushed the page sideways.** The first capture run photographed a
   horizontal scrollbar on the window with the disclosure clipped at the right
   edge — while its own measurement reported `page_overflows: false` on every
   frame. Two faults, and the second is why the first survived: the measurement
   ran *before* the recipe was opened, and the recipe holds the only thing on
   this card that will not reflow. A grid or flex item's automatic minimum size
   is its content width, so the `<pre>` holding the shell snippet refused to
   shrink however many `overflow-x` rules sat on it. `min-width: 0` fixes it,
   and the harness now measures a second time with the recipe open. Screenshots
   find what measurements cannot — and then the measurement is widened so that
   next time they do not have to.
2. **A dead confirm button.** The state fold sent both `confirm_host_key` and
   `host_key_not_trusted` to `needs_your_ok` and gave both the same control, but
   only the first carries a fingerprint — so on the second the press had no
   value behind it and did nothing. It gets **Check now** instead, which is what
   can actually fetch the code, and its guidance sentence stays above the
   button. Whether that sentence is suppressed is now decided by the control
   rather than by the state.

### Screenshots

`electron/capture-servers.ts` grew scenes and now seeds the scratch store
itself — `electron/capture-deploy.ts`'s shape — so a frame's filename and its
contents cannot drift apart. Run per scene with a scratch `DASH_DATA_DIR`, a
scratch `--user-data-dir` and `DASH_CAPTURE_SCENE`, after
`pnpm build:renderer; pnpm build:shell`:

- `no-server` — the wizard's first step, where somebody with no server begins.
- `saved` — one record, nothing asked: the card in `never_checked`. With
  `DASH_CAPTURE_CHECK=1` the run also presses the card's own **Check now**,
  which signs in for real against a seeded TEST-NET-1 address that black-holes,
  so the probe spends `ssh`'s connect timeout and the card lands in a genuine
  `unreachable` state through the real renderer -> preload -> main -> `ssh`
  path.
- `deployed` — one record DASH has already sent an agent to: the only scene in
  which "what is on this server" and the page's own table draw anything.

35 files landed under `qa-screenshots-mar-871/`: six per scene at 1280/768/375
in light and dark, six recipe frames per scene with a card, and two
`servers-checked-*`. What the run said:

```
[servers] seeded scene saved: 1 server
[servers]   comfortable {... "card_state":"is-never-checked",
                              "primary_actions":["Check now"], ...}
[servers]   recipe: 5 steps on screen
[servers] checked: the card now reads "No answer, at this address"
[servers] wrote 14 images and layout.json
[servers] no frame overflowed sideways
```

The checked frame is a real refusal: the probe went renderer -> preload -> main
-> `ssh` against the seeded TEST-NET-1 address and spent the connect timeout.
The banner and the card agree on it, which is D1's invariant in the direction
the old code happened to get right.

Every scene with a card also opens the **recipe** by pressing the real controls
— the overflow's summary, the setup control, then the button that fetches the
snippet from main — so the frame proves the controls work rather than looking as
if they do. `layout.json` now records `card_state` and `primary_actions`, so
"one card, one state, one primary action" is a claim a reader of the frames can
check without counting pixels.

**Three states this harness cannot photograph, and it fakes none of them.**
*Your server is up* and *a server with agents on it* are both **answers a
machine gave**; a standing is held in the window, not the store (ADR 0015), so a
scratch store cannot produce one. `electron/capture-deploy.ts` made the same
ruling for the same reason. **Two records for one machine** cannot be seeded
either: `saveHost` throws on a duplicate (MAR-574), which is the feature working.
All three are covered by render tests over the real components instead.

## Evidence class

**Fixture tests, plus scratch-store harness frames.** Nothing runtime: no
installed store, no packaged shell, no host. The issue's own proof line — *a
person who has never seen DASH enrols a fresh server unaided* — is attended and
owner-run, and **this session cannot produce it**. Nor can it photograph the two
success states above without a real machine answering.

---

## Needs orchestrator

1. ~~The headline still does not say "your server is up".~~ **Done** — the
   orchestrator extended this lane's ownership to `lib/host-connect.ts`. See
   the addendum.
2. **D5 — the schedule panel says "on this computer"** after residency has moved
   the schedule to the host, where ADR 0031 says the server honours it. Agent
   settings, not this lane. Belongs with MAR-874 or MAR-864.
3. **D6 — the schedule radios render saved state rather than draft state**, so a
   click does nothing until Save is pressed. Agent settings, not this lane.
4. **D7 — the header chip reads `LIVES ON Local` after a successful deploy**
   until an unrelated re-render. `app/_components/agent-header.tsx`, not this
   lane.
5. ~~`lib/host-sighting.ts` and `lib/host-connect.ts` still say "Check this
   server".~~ **Done** — same extension. See the addendum.
6. **The residency read now rides along with a check.** `check()` calls
   `residencyState` when the runner answered and named at least one agent, which
   is a second `ssh` round trip per press. It is quiet — no notice on failure —
   because the person asked one question. If that cost is unwanted, the fix is a
   condition, not a second button.
7. **`electron/capture-deploy.ts`'s `servers-refused` / `servers-chosen` scenes
   were already dead** before this packet: they focus `.deploy-panel`, which
   MAR-642 removed. Not touched here.

---

## Addendum — the ownership extension, 2026-09-07

The orchestrator extended this lane to two files it had filed above, so items 1
and 5 of *Needs orchestrator* are closed here rather than handed on. Items 2, 3
and 4 (D5, D6, D7) stay with MAR-874/MAR-864, and item 6 — the second `ssh`
round trip a check now costs — is accepted and left as it is.

**`lib/host-connect.ts`, the `no_runner_there` branch.** The headline read
*"<label> is reachable, with nothing running on it"*: three clauses, two of them
negative, on the state **every freshly enrolled server sits in before its first
deploy**. It is the first sentence a person ever reads about a machine they have
just rented and correctly set up, and the attended run photographed it under a
banner claiming nothing had answered. It now reads **"Your server is up. <label>
is signed in and ready."** — the only headline in that function that does not
open on a fault, because it is the only state that is not one. The label is
still named, because a page can hold several servers and a sentence about one of
them has to say which, and it comes second so the good news is read first. The
body carries the honest remainder: DASH signed in, found no agent runner yet,
*which is how every new server starts*, and nothing is wrong with the
connection. `next_action` and `reach` are untouched, so the chip, the tone and
the card's primary control are unchanged — which is the point: the words caught
up with what the rest of the card already said.

`tests/host-connect.test.ts` gains a pin asserting the headline *leads* with it
(`/^Your server is up\./`) rather than merely contains it — a sentence that
ended on the good news after two clauses of absence would pass a `toContain` and
fail the person reading it — and asserts no other problem's headline opens that
way. Every other state's wording is byte-identical.

**The two stale instructions.** `describeConnectState`'s `not_checked` next
action and `summariseWhatIsOnHost`'s sentence both told somebody to press
*"Check this server"*, which is not what the control says any more. They read
*"Check now"* and *"Press Check now to see what is on it."* A direction naming a
button that no longer exists fails while looking authoritative, which is the
fault `describeImportUnavailable` was corrected for one surface over.
`tests/host-sighting-render.test.tsx`'s pin moves with it, and two comments in
`app/_components/server-card.tsx` that quoted the old label as a present fact
were corrected with it.

**Merged forward** to `origin/master` `4ae4625` (MAR-875, #328). One conflict, in
`app/globals.css`: both packets append a fenced block to the end of it. Resolved
by keeping **both**, MAR-875's first and MAR-871's after — neither restyles a
shared rule, which is what the fences are for.
