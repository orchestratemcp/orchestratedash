# MAR-865 / MAR-864 — a real VPS, attended session 2026-09-05

Client: Claude Code `--model opus`, extended thinking. Main checkout, branch
`chore/mar-865-vps-enrol-deploy`. Machine-affecting throughout: every act below
reached `78.141.221.121` for real.

**Correction to the dispatch brief.** It states `hosts` = 0 rows and
`agent_deploys` = 0 rows as of 2026-09-04. When this session opened the store,
`hosts` already held **one row** — `Vultr box`, `78.141.221.121`, `root`, port
22, added `2026-09-05T17:25:14.195Z`, with `host_fingerprint`
`SHA256:MpGLd1YWGve5kI9k21/GJ2O1MwHi6ptAc285P369Y2g` **already pinned**. Henrik
confirmed he had run the wizard *and* the setup text earlier the same evening.
So the enrolment was half-done before this session started, and the wizard was
swept rather than re-walked. `agent_deploys` was 0 and is now 1.

---

## Page defects

Swept against the real server before anything was changed. Severity is stated
against Henrik's own bar: novice-first, commercial polish. **None of these
blocked enrolment, so per the brief none were fixed — all are filed here.**

### D1 — The summary line contradicts the card directly beneath it

The first sentence on the page disagrees with the card it introduces.

| | |
| --- | --- |
| Expected | The banner agrees with the card. |
| Got | Banner: *"1 server is saved. **None answered** when DASH checked on 5 September 2026 at 19:38."* Card, immediately below: *"Vultr box is reachable, with nothing running on it / DASH signed in and found no agent runner there yet. **Nothing is wrong with the connection.**"* Badge: `SIGNED IN, NOTHING RUNNING`. |
| Draws it | `app/settings/servers/page.tsx:1255` |
| Evidence | `docs/mar-865-evidence/01-banner-contradicts-card.png` |

Reproduced on a fresh probe: pressing **Check this server** moved both
timestamps 19:38 → 19:47 and the contradiction persisted.

**Root cause.** The banner's predicate is

```ts
answered: standing !== undefined && standing.step === "reachable",
```

but `no_runner_there` is modelled as a `HostReachProblem` under
`step: "unreachable"` (`lib/host-connect.ts:96`), even though
`describeConnectState` gives that same state `reach: "signed_in"` and copy that
asserts the server answered (`lib/host-connect.ts:506`). One layer down,
`electron/main.ts:3080` returns a *successful* `status` answer carrying zero
running bundles as `{ ok: false }`.

**Why it matters more than it looks.** `no_runner_there` is the state **every
freshly-enrolled server is in before its first deploy** — the default first-run
experience for this whole feature. A new user's first sentence about their
brand-new server is that nothing answered.

**Fix shape.** Count `answered` from the described state's `reach === "signed_in"`
rather than from `step === "reachable"`. `helper_not_installed`,
`no_runner_there` and `runner_refused_credential` all already carry that field.

**This is MAR-605 returning inverted.** The comment immediately above the
offending line describes the attended run that photographed *"1 server is
connected"* above a card saying DASH could not get in. The fix went in; the same
class of drift came back the other way round.

Confirmed as a state-specific bug, not a general one: once an agent was deployed
and the state became `reachable`, the banner correctly read *"It answered"*
(`05-connected-seen-running.png`).

### D2 — An empty account field renders a literal `""` into user-facing copy

| | |
| --- | --- |
| Steps | Wizard step 1. Fill name and address, leave *Account on the server* blank. |
| Expected | Something like *"Type the account name DASH should sign in as."* |
| Got | `"" is not an account name DASH will sign in with.` |
| Draws it | `lib/hosts.ts:152`, duplicated verbatim at `lib/host-bootstrap.ts:235` |
| Evidence | `docs/mar-865-evidence/02-empty-quotes-account.png` |

Both sites interpolate the raw value into the sentence, so the empty case prints
two quote marks at a novice.

**Compounded by the placeholder.** That field's placeholder is `root`, which
reads as a value already filled in. The person is invited to skip the field and
is then shown `""`. The two defects together make a dead end out of the only
field a novice genuinely cannot guess — which is the exact question
`describeProviderChoice` exists to answer.

### D3 — The duplicate warning does not gate the primary action

Typing the address and account of the already-saved host produces the correct
warning — *"You already have this server, saved as Vultr box… Saving it again
would make a second key for one machine, and DASH would show you the same server
twice."* — and **`MAKE KEY` stays enabled**, with no "use the existing one"
affordance.

This is the mechanism that previously put four rows for one machine in Henrik's
store, described in this page's own header docblock. The current behaviour is a
deliberate "DASH kept them rather than deleting anything", so this is filed as
UX rather than correctness: the warning names a consequence and then offers only
the button that causes it.

### D4 — Two agents share a display name, with nothing to tell them apart

Under **Put an agent here**, `Meeting Assistant` is listed **twice**, with two
different refusal reasons:

- *"Meeting Assistant cannot be put on a server DASH cannot read what it saved for this agent, so it has nothing to send to a server."*
- *"Meeting Assistant cannot be put on a server This agent's build lives outside DASH; re-import it to put a copy in DASH's keeping."*

The store rows are `synthetic-gmail-meeting-assistant` and `dash-google-proof`;
both have `display_name` NULL and both resolve to "Meeting Assistant" from their
manifests. The list renders no id, so the two are indistinguishable — and the
same pair appears twice on the Connections tab.

Secondary copy defect visible in the same strings: the bold headline and the
detail concatenate with no separator, producing *"cannot be put on a server DASH
cannot read what it saved"*.

Evidence: `docs/mar-865-evidence/03-duplicate-meeting-assistant.png`

### D5 — The schedule panel asserts the wrong machine

The agent settings panel says, both on the radio and in the saved summary:

> Every day at a set time — DASH starts it for you, **on this computer**, at the time you pick.
> DASH starts this agent every day at 20:10, **on this computer**.

Under ADR 0031 (`lib/schedule/delegation.ts`) the governing rule is: *"An agent's
schedule is honoured by the server it was deployed to, and only while residency
is on for that server."* Once this agent was deployed and residency turned on,
the sentence became false and **did not change**.

This is MAR-602's second finding one layer earlier than MAR-864 states it: not
only does nothing say which machine a run *happened* on, nothing says which
machine a schedule *will* run on. Directly relevant to MAR-864's build.

### D6 — The schedule radios do not respond to clicks

Clicking *"Every day at a set time"* — on the radio itself or on its label — does
not select it. Verified twice by zoom. Selection changes only after pressing
**Save schedule**, because the radios render *saved* state rather than draft
state.

A radio that ignores a direct click reads as broken to everyone, and the only
way to discover the real interaction model is to press a Save button for a
setting that appears not to have been chosen.

### D7 — The header chip is stale after a successful deploy

After **Put Proof Scout on Vultr box** reported success, the header chip still
read `LIVES ON Local`. It flipped to `LIVES ON Cloud` only after an unrelated
**Save schedule** press re-rendered the page. The deploy does not refresh the one
control on screen that names where the agent lives.

### D8 — "Put an agent here" does not put an agent there

The primary-styled button on the server card expands a list whose text is *"Putting
an agent on a server starts on the agent, where its connections and its model
are. Open one and its settings will offer this server."* The action a novice
pressed is answered by being sent somewhere else. It is explained, but the label
promises a verb the control does not perform.

### D9 — "DASH has not checked since you opened it" survives acts that reached the machine

After turning residency on — which signed in over SSH and pushed the schedule set,
recorded as `told_at 2026-09-05T17:55:53.598Z` — the banner still read *"1 server
is saved. DASH has not checked since you opened it."*

The design intent is real and defensible (standing is never stored, every card
opens `not_checked`). But a residency press demonstrably reached the server two
seconds earlier. Low severity, filed for consistency with D1: both are the
summary line disagreeing with what DASH actually knows.

### Finding — no way to re-obtain the setup text for an enrolled server

The setup text (step 2) is reachable only inside the add-a-server wizard. An
already-enrolled server's card offers **Ask the server**, **Turn on**, **Check**,
**Put an agent here**, **Stop using this server** — and nothing that shows the
bootstrap snippet again. If a helper is removed, or a future DASH ships a newer
helper, the only route back to that text is to start enrolling a *second* record
for the same machine, which lands in D3.

This is also why steps 2 and 3 of the wizard were **not** re-walked in this
session: doing so would have written a duplicate host row into the live store.

---

## What the wizard actually asked, versus the design docs

Fields on step 1, in render order: **What you call it**, **Address**, **Account on
the server**, **Who you rent it from** (dropdown, default *"I will type it
myself"*), **Port** (pre-filled `22`).

- **The inversion holds.** No private-key field appears anywhere in the flow.
  `lib/host-wizard.ts`'s promise — *"DASH makes the key and keeps the private
  half"* — is what the surface does. Henrik was never asked for a private key and
  this session never saw one.
- **Vultr is not in the dropdown**, as the brief said. The no-choice state is a
  first-class answer (*"I will type it myself"*), which matches
  `describeProviderChoice`'s stated intent and worked correctly.
- **The rail label for step 2 is stale.** It reads `02 THE KEY`, from
  `describeStep`. Since MAR-573 that step's *content* is `describeSetupStep` — the
  bootstrap text a person pastes into the server — and the brief itself describes
  step 2 as "copy the setup text and run it on the server once". The rail still
  names the older, smaller thing.
- **`The key goes in [?]`** renders as a sentence fragment plus a tooltip button.
  The full sentence is behind the `?`. Not a bug — the tooltip works — but on a
  novice-first surface the one sentence answering *"where do I put this?"* is the
  one hidden behind an affordance.

---

## Enrolment — proven

DASH signs in to `78.141.221.121` as `root` on port 22, key-only, forced command.
Evidence is the server's own answer, read through the app:

| moment | what the host said |
| --- | --- |
| 19:47 | `status` answered; no agent runner yet (`no_runner_there`) |
| 19:53 | deploy finished; *"The server reported 1 agent running"* |
| 19:55:53Z | residency on; schedule set pushed (`told_count 1`) |
| 19:57 | `CONNECTED`, *"running 1 agent"*, `proof-scout-mar861` **SEEN RUNNING** |

The helper is genuinely installed: `no_runner_there` is only reachable *after* a
successful `status` answer (`electron/main.ts:3080`); a missing helper diagnoses
earlier as `helper_not_installed`.

Store rows written:

```
hosts            1  Vultr box / 78.141.221.121 / root / fingerprint pinned
agent_deploys    1  proof-scout-mar861 -> c0409dcf…, sent_at 2026-09-05T17:53:02.016Z
host_residency   1  asked_at 17:55:51.189Z, told_at 17:55:53.598Z, told_count 1
agent_schedules  2  proof-scout-mar861 daily 20:10 (new), competitor-scout daily 20:55
```

## Deploy — which agent, and why

`proof-scout-mar861` ("Proof Scout"). Chosen because
`lib/deploy/connection-travel.ts` is categorical that no credential travels to a
server (ADR 0006/0007), so the deployed agent must need none. Its manifest
declares `connections: null`, `automation_clearance: "L1"`, no approval gates and
no irreversible components; its route is `public_feed_fetch` → `brief_compose` →
`local_file_write` against the Hacker News front page. Nothing brokered has to
cross.

The one predicted weakness is on the record and is **stated by the product
itself**, on the server card, unprompted:

> A run that starts this way cannot reach your model. Putting a key on this
> server lets an agent you press Run on use it; it does not pay for a run nobody
> asked for.

That is `brief_compose`. Per the brief's scope limit, **no key was placed on the
host.**

---

## MAR-864 — the spike

### Step 1: the routing works, and it is provable without waiting

Before any window came round, the delegation half is already demonstrated on the
live store. After residency was turned on, DASH re-asserted the **local** runner's
standing set at `2026-09-05T18:01:23.727Z`. `runner.sqlite` `schedule_standing`
then held:

```json
{"schedules":[{"agent":"competitor-scout","enabled":true,"kind":"daily",
  "at_local":"20:55","created_at":"2026-08-25T18:47:13.765Z","allowance_calls":0}],
 "since":{"competitor-scout":"2026-09-04T18:55:00.000Z"}}
```

`proof-scout-mar861` is **absent from the local set** — it was removed from this
computer's runner and pushed to the host instead (`host_residency.told_count 1`,
`told_at 17:55:53.598Z`). That is `splitSchedules` (ADR 0031) working against a
real machine: the schedule is held by exactly one runner, so the double-run the
ADR exists to prevent cannot happen here.

### Finding — `at_local` means a different moment on each machine

`lib/schedule/plan.ts:44` documents `at_local` as *"`HH:MM`, 24-hour, **this
machine's own local time**. Never a timezone."* `nextDueAfter` applies it with
`candidate.setHours(...)`, which resolves against **whichever machine is
honouring the schedule**. `runner/schedule.ts:915` passes the literal `at_local`
string across the channel unchanged.

So the same instruction means two different moments depending on where it is
honoured. A schedule typed as `20:10` on a Stockholm laptop is 20:10 Stockholm
while it lives locally, and 20:10 **in the host's own timezone** the moment
residency moves it to a default Vultr Ubuntu box, which is UTC — a two-hour
shift, silently, on a press that says nothing about time zones.

Nothing on the schedule panel mentions this, and D5 above makes it worse: the
panel actively says *"on this computer"* while the server is the machine that
will apply its own clock. Saying which machine runs it is incomplete without
saying which clock it uses.

**Proven, not inferred.** A schedule set to `20:10` produced nothing at 20:10
Stockholm. The same schedule reset to `18:20` settled with
`due_at = 2026-09-05T18:20:00.000Z` — the host applied the literal string
against its own UTC clock, two hours from where the person set it.

### Step 2: the answer — it runs on the host, and the evidence comes home

**Yes, with no new code.** The settlement DASH drained at 20:21:

```json
{ "agent": "proof-scout-mar861",
  "due_at":    "2026-09-05T18:20:00.000Z",
  "settled_at":"2026-09-05T18:20:24.712Z",
  "outcome":   "refused",
  "detail": "The agent started but did not publish anything to run, so DASH had nothing to begin." }
```

That row is the whole transport working end to end: DASH pushed the set over the
channel, **the host's own runner woke at its own due time**, acted, wrote a
settlement, and DASH drained it home on the next Check. No code was written.

### The run itself was refused, and the reason is not the model

`runner/schedule.ts:614-628` makes the sequence readable from the one word
`refused`. The host got **past** the two earlier gates:

1. `supervisor.facts(agent)` was non-null — the agent **is registered on the host**;
   otherwise the detail would read *"DASH has no registered setup for this agent
   on this computer."*
2. `supervisor.start(agent)` succeeded — **the agent process started on the host**.
3. `#waitForPendingTask` polled `PENDING_TASK_LOOKS = 80` times over ~24s
   (`settled_at` is 24.7s after `due_at`) for a task with `status: "pending"` and
   no `run_id`, and found none.

**This is not the model limitation.** A missing model would fail inside
`brief_compose`, during a run. This is earlier: no run ever began.

### The press fails identically, which is what makes this conclusive

`RUN ON VULTR BOX` — the named per-server control, which **already exists** and is
already wired (`app/_components/agent-header.tsx:530-563` →
`app/agents/detail/page.tsx:700` → `electron/main.ts:2773` →
`electron/host-run.ts`) — was pressed. It answered:

> The copy of this agent on Vultr box is not waiting for anything to be started.
> It may already be running.

`electron/host-run.ts:256` refuses on `waitingTask(state) === null` — **the same
predicate** the scheduler uses. And it refuses *after* succeeding at everything
before it: the `channel` verb returned the runner's credential, `GET state`
returned a snapshot, and the snapshot **parsed** (a bad one answers *"described
itself in a way DASH could not read"*). DASH declined to post the command
because there was nothing to point it at.

So the control plane is proven end to end **up to the command post**, by two
independent paths, on a real machine.

### What this means for MAR-864 — it is not the packet the issue describes

The issue's revised plan says: if the schedule works, *"this is a **UI packet**:
route the press to the right machine and say on screen which machine ran."* Two
of those three are already done:

| MAR-864's assumption | what is actually true |
| --- | --- |
| The transport may not exist | It exists and is proven against a real host, both ways |
| Route the press to the right machine | **Already built** — `RUN ON VULTR BOX` sits beside `RUN NOW` on the run stage |
| Nothing says which machine | Partly false — the agent grid badges `CLOUD` vs `LOCAL`, the header chip says `LIVES ON Cloud` |

**The real blocker is none of those.** It is that a freshly-deployed agent on a
host publishes no pending task, so *both* ways of starting it refuse before
anything runs. Until that is fixed, routing a press correctly routes it to a
refusal.

That is a deploy/runtime question — what a deployed bundle carries, or how the
host runner initialises an agent that has never run there — not a UI question.
**MAR-864 should be re-scoped accordingly**, and the surface work that genuinely
remains is smaller than the issue assumes: D5 (the panel says the wrong machine),
the timezone finding above, and saying which machine a *finished run* happened
on.

### What was not established

- **No run has yet produced output on the host**, so no host-sourced run evidence
  came home. `evidence_pulls` holds only `local` rows; the remote pull happens
  *after* a successful command post, which never occurred.
- **`collect` is unreachable from the app.** The verb is typed in
  `lib/deploy/verbs.ts` and implemented in `scripts/host-helper/main.ts`, but
  **nothing in `electron/` ever invokes it** — the invoked verbs are `install`,
  `start`, `stop`, `status`, `channel`, `service`, `pack`, `install-key`,
  `uninstall`. So the brief's proof line "the `status` and `collect` output"
  can only be half-satisfied today: `status` is on the card, `collect` has no
  caller and no control. Evidence instead travels by `pullEvidence` on the
  control plane.
- **No key was placed on the host**, per the scope limit.

---

## For Henrik — the one thing only you can do

For boot survival the host account needs lingering enabled, so its user service
keeps running with nobody signed in:

```
loginctl enable-linger root
```

This session did **not** run it. Note that the host already reports the stronger
claim on its own — *"This server starts your agents when it reboots. It does this
on its own, with DASH closed and with nobody signed in to the server."* — after
the `service` verb installed the unit, so this may already be satisfied; running
it is harmless either way and is the documented belt-and-braces step.

## State left behind

Live and deliberate — nothing here is scratch:

- `hosts` 1 (unchanged, pre-existing), `agent_deploys` 1, `host_residency` 1
  (**residency on**), `agent_schedules` 2.
- `proof-scout-mar861` is **deployed to and running on** `78.141.221.121`, with a
  daily schedule at `18:20` **which the host reads as 18:20 UTC**. It will refuse
  again each day with the same detail until the pending-task gap is fixed. Turn
  the schedule off from the agent's settings if the daily refusal row is unwanted.
- Nothing was deleted. The `dash-google-proof` row is untouched (MAR-870).
- One duplicate host record was **not** created: the wizard was walked to the
  point of validation and cancelled.
