# MAR-861 proving handoff — MAR-862 and MAR-863 are both `proven`

**Session:** Claude Code, `claude --model opus`, extended thinking, 2026-09-04.
**Checkout:** the main checkout on `master` at `13f648b`. No worktree, deliberately —
the real installed store lives here.
**Packets:** MAR-862 (dash-agent plugin) and MAR-863 (`genlayer.brief.adjudicate`),
both `merged` at the start of this session.

**Proposed lifecycle: `proven` for both.** The evidence is below, and it is
behavioural on the installed build in both cases. I do not edit
`.orchestrate/state.json`; the orchestrator promotes.

---

## The short version

| Packet | Proposed | The one piece of evidence |
| -- | -- | -- |
| MAR-862 | `proven` | `proof-scout-mar861` scaffolded by the plugin in a clean session, imported into the installed DASH at `2026-09-04T19:03:06.144Z` with zero validation failures, run from *Run now*, and it produced a digest and a brief that DASH stored. |
| MAR-863 | `proven` | Two verdicts from the button on DASH's own output card. Second one: `evaluate_tx` `0x01f3b1df3f3f52584a918396f7eee2b85cf84eb6230adc2e743d830ad30d6877`, FINALIZED / SUCCESS / MAJORITY_AGREE, `REJECTED` with two reasons, rendered as a receipt beneath the citations. |

Screenshots are in `qa-screenshots-mar-861/`.

**Two things happened that were not in the plan and both matter more than the
proofs themselves.** First, MAR-862's scaffold produced an agent that DASH
imported cleanly, ran happily, and then silently discarded every artifact from —
a defect that only appears on the installed build, which is exactly what a
`merged`-to-`proven` session exists to find. Second, the GenLayer committee
**rejected** both briefings, correctly, for claims the evidence rows do not
carry. Neither of those is a failure of the session; both are the machinery
working.

---

## 1. Build

`dist/` was built at **15:30** today. MAR-863 merged at **18:10** and master's
head landed at **20:18**. So the DASH that was running when this session opened
was a *pre-merge* build and did not contain the adjudicate button at all.
Rebuilding was load-bearing, not ceremony.

```
pnpm build:renderer          -> wrote out
pnpm build:shell             -> [build-shell] wrote dist\electron runner_build=095ae40ee1a2cc09897a
```

Checked the merged code actually reached the bundles rather than assuming:

```
dist/electron/main.mjs        adjudicate.start, open_commission, submit_deliverable,
                              MAJORITY_DISAGREE, studio.genlayer.com   — all present
dist/electron/renderer/…      "Judge it again" and adjudicateBrief present in the chunks
```

DASH was closed with `CloseMainWindow()` (WM_CLOSE — never a force-kill) and
relaunched from Henrik's own `C:\Users\henri\dash-launcher.cmd`.

---

## 2. MAR-862 — proven

### The clean session was a real one

The proof line asks for *a coding agent with no memory of this repo*. I ran one:
a subagent whose entire prompt was the plugin's path, a user-level request in
Henrik's voice ("watch the Hacker News front page and write me a short
briefing"), and an explicit instruction not to read any source outside
`tools/dash-mcp/`. It drove the MCP server over the real stdio JSON-RPC protocol.

What it did, unaided:

- `dash_agent_scaffold` → 8 files, `manifest_valid: true`, `emits: ["digest","brief"]`.
- Edited **only `agent.mjs`** — it did not touch `agent.manifest.json` — raising
  the item cap to 30 and rewriting the sections for a Hacker News shape.
- `dash_agent_validate` → **clean on the first attempt**, no fixes needed. Twice.
- Ran the agent against the live HN API and got a digest of 30 items plus a
  brief carrying `derived_from`. It then **independently recomputed
  `items_digest` from the skill's own formula and confirmed it matched**, which
  is the check that decides whether DASH draws citations or drops them.
- `dash_agent_install` → handoff file and a `dash://handoff` URL.

**Zero validation failures, on a manifest no human corrected.**

### The import, on the installed build

The dialog reached DASH and I pressed **Add and start**:

> "Proof Scout" has been added to DASH. It is running now, and it keeps running
> when you close DASH.

Read back from a WAL-inclusive copy of the live `%APPDATA%\orchestratedash\dash.sqlite`:

```
proof-scout-mar861   v2   imported_at 2026-09-04T19:03:06.144Z
```

and DASH's own copy of the folder, with the manifest hoisted and the code in
`code/`, plus a `registration.json` of
`{"command":"node","args":["agent.mjs"],"cwd":"code"}` — so it is startable, not
manifest-only. The fleet grid shows it as **PROOF SCOUT** among seven agents
(`01-mar862-fleet-proof-scout.png`).

### Then it produced nothing, and that is the finding

I pressed **Run now**. DASH said *"Started a new run."* The agent really ran —
it wrote `reports/report-2026-09-04T19-06-22-841Z.md` and an `events.jsonl` with
`run_started`, its three planned steps in order, and `run_completed — Read 30
front-page stories`. And DASH stored **nothing**: no run, no artifact, not one
telemetry row. On screen, "Nothing has run yet", indefinitely.

Root cause, and it is a one-liner with a large blast radius:

- `tools/dash-mcp/template/agent.mjs` read its manifest from
  `path.join(projectDir, "agent.manifest.json")`, where `projectDir` is the
  directory of `agent.mjs`.
- **DASH splits the folder on import**: the manifest goes to
  `<agents>/<name>/agent.manifest.json` and the program runs from
  `<agents>/<name>/code/`. So inside DASH the manifest is one level *up* and the
  lookup always misses.
- The template then falls back to `AGENT_NAME = "agent"`, and stamps that on
  every event and every artifact.
- `lib/store.ts:1213` — `ingestArtifacts` — rejects any artifact whose `/agent`
  does not match the agent DASH spawned: *"/agent must match the runner-hosted
  source"*.

So every artifact was refused for a name mismatch, silently. The agent looks
perfectly healthy the whole time. This cannot be seen from the author's project
folder, where the manifest *is* beside the program — it only exists on the
installed build.

Worth saying plainly: **DASH gives the agent no way to learn its own id except
the manifest.** `childEnvironment` in `runner/supervisor.ts` refuses the whole
`DASH_*` namespace by design, so there is no env var to fall back to. Reading
the manifest is the only route, and the template was reading the wrong path.

### The bounded fix

One file, and it is a file MAR-862 owns:

**`tools/dash-mcp/template/agent.mjs`** — look for `agent.manifest.json` beside
the program *and* one level up, and say so out loud when neither is found,
because the consequence is otherwise invisible. 32 insertions, 4 deletions,
CRLF preserved.

Allowed because it unblocks the proof: without it the packet cannot produce a
brief, and without a brief MAR-863 has nothing of this agent's to act on.

I applied the identical change to the already-scaffolded project at
`C:\Users\henri\Desktop\projekt\MCP\proof-scout-mar861\agent.mjs` and re-ran
`dash_agent_install` rather than re-scaffolding, so the clean session's own work
survived.

### After the fix

Re-import → *"Proof Scout has been updated"* → **Run now**:

```
proof-scout-mar861
  digest  digest-5c752a10-7131-431d-9a8f-ea574c511735  30 stories on the Hacker News front page
  brief   brief-5c752a10-7131-431d-9a8f-ea574c511735   What is on the Hacker News front page
  runs:   5c752a10-7131-431d-9a8f-ea574c511735
```

Both artifacts, one run, in the live installed store
(`02-mar862-run-digest-and-brief.png`). The brief renders on the output card
with its citations resolved to real links — so the `items_digest` join held
across the author's `brief-fingerprint.mjs` and DASH's `lib/brief/fingerprint.ts`.

### Two smaller things the re-import taught

- **A running agent blocks its own update.** The first update attempt failed
  with *"DASH could not finish copying 'Proof Scout', so it was not added"*,
  because the agent process DASH had started at import held `code/` open. DASH's
  advice — *"Build the agent again with a current Agent Kit"* — points at the
  wrong cause. Stopping the agent process made the same update succeed
  immediately. The `...` menu offers Refresh, Open folder and Remove this agent;
  there is no Stop.
- **After an update the page serves a stale snapshot.** *Run now* answered
  *"The runner refused the request: stale_snapshot."* until I used `...` →
  Refresh. Not fatal, but it is the first thing a person does after updating.

---

## 3. MAR-863 — proven

### The endpoint was checked first, as instructed

Studionet is explicitly temporary, so before assuming any failure was DASH's:

```
eth_chainId    -> 0xf22f  (61999)          ✓ matches STUDIONET_CHAIN_ID
eth_blockNumber-> 0x6a9b1213               ✓ live
eth_getCode    -> 0x                        (inconclusive — GenLayer intelligent
                                             contracts are not EVM bytecode)
readContract get_verdict("probe-…") -> "execution failed"
                                             (the node executed and the contract
                                              rejected an unknown commission)
```

The contract at `0xD08455a5Cfc53E43731834d6C92a6FE4aA0b3B75` had **not** been
reset. No redeploy was needed and the shipped constant does not move.

### The press, and what came back

Pressed **HAVE IT JUDGED** on DASH's own output card for
`brief-5c752a10-…`. The consequence copy above the button is the shipped text
verbatim, including "Anyone can read them there and nobody can take them down"
and "Nothing is charged to you" (`03-mar863-button-and-consequence.png`). The
banner then showed the patience line, *"A judgement usually takes one to five
minutes. You can leave this page."*

**Judgement 1** — `dash-5c752a10-mtnc2gpr-mdrv`, **131 seconds** (19:14:50 →
19:17:01):

```
open_tx      0x1ea2c9bd73cf9201648dc449d8c61cb33ed2394d1a6136611b445ff90bcdfc30
submit_tx    0x1f2d532b60d54854f8c61dfb6a7b3874008e14887f83d14cc4ba03db9c8b93c9
evaluate_tx  0x7e374f0f5e88010908aa28321b5ba5cd161cfa2c35410ce26013f71405f933d7
FINALIZED / SUCCESS / MAJORITY_AGREE   outcome=applied
leader       llm-router/policy:prd-sonnet
verdict      REJECTED, four reasons
```

**Judgement 2**, from the **Judge it again** button —
`dash-5c752a10-mtnc76q2-4818`, **129 seconds** (19:18:30 → 19:20:39):

```
open_tx      0xba5cbc096e82e104ff2ab23e9354268d880d5a2a98c55d4c80f4dd05730cac34
submit_tx    0xe33c6eb8623433f05bc7eca06f5c34d0f0d6ef582110a97288e76b4008940d53
evaluate_tx  0x01f3b1df3f3f52584a918396f7eee2b85cf84eb6230adc2e743d830ad30d6877
FINALIZED / SUCCESS / MAJORITY_AGREE   outcome=applied
leader       openrouter/google/gemini-3-flash-preview
verdict      REJECTED, two reasons
```

Both rendered as a receipt directly beneath the citations, with the heading
*Judged on GenLayer*, a `REJECTED` chip, *What the committee said*, and a
four-field footer — Network `GenLayer Studionet`, the transaction hash as text,
`Judged by` the model the network says wrote it, and the moment. The button
relabelled to **Judge it again**. No spinner anywhere
(`04-…-rejected.png`, `05-…-second-verdict-after-refresh.png`).

### The verdict is REJECTED, and it is right

This is the most interesting result of the session, so it should not be buried.
Both committees rejected the briefing for the same substantive reason:

> P2 assigns specific point totals (2105, 1128, 668, 446, 327) to stories, but
> the cited evidence (E1-E5) contains only titles and published_at timestamps
> with no point data.

The clean session had added `points` and `comment_count` to the digest's items
and wrote a briefing about them — and reported, in its own findings, that it was
**guessing** whether extra fields on digest items were allowed, because the
skill only documents unknown fields for the *manifest*. The payload builder does
not carry those fields to the judge, so the briefing makes claims its evidence
rows genuinely do not support, and the committee caught it.

That is DASH's whole thesis working end to end on the first real try: an agent
wrote something plausible, and an independent committee refused it for a
specific, checkable reason. **It is a better video beat than an ACCEPTED would
have been.** It is also a genuine finding about the scaffold, not about the
adjudicator — see finding 4.

### What did NOT happen

The 1-in-10 no-verdict path (`MAJORITY_DISAGREE`, no state applied) did not come
up in either judgement. Both were `MAJORITY_AGREE`. Still unreproduced live; the
test drives it against the recorded receipt shape.

---

## 4. Findings

### 1. The receipt does not arrive on the page's own poll — it needs a refresh

**This one directly affects MAR-866's video.** After judgement 2 settled at
19:20:39, the card still showed judgement 1's receipt — tx `0x7e374f0f…`, judged
"at 21:17", `llm-router/policy:prd-sonnet`, four reasons — for as long as I left
the page alone. `...` → Refresh, and the new receipt appeared immediately
(`0x01f3b1df…`, 21:20, gemini-3-flash-preview, two reasons).

Reproduced deliberately, on the second press, precisely to check it. Related:
the button never showed **Being judged**; it read *Have it judged* through the
whole of judgement 1 and *Judge it again* through the whole of judgement 2.

So the flow a video wants — press it, watch it arrive — does not work today
without a manual refresh. The verdict is correct and the receipt is correct;
what is missing is the live update. Needs its own packet, and it is small.

### 2. Firing a `dash://handoff` link starts the month-old google-proof harness

MAR-862's finding 1 is confirmed and it is worse than "the link appears to do
nothing". `dash://` on this machine still resolves to
`dist\google-proof\main.mjs`, dated 2026-08-07. When the plugin's
`dash_agent_install` opened its URL at 18:56:58, the harness started and
**imported its own agent into the live installed store** one second later:

```
dash-google-proof   v2   imported_at 2026-09-04T18:56:59.446Z
```

It is in Henrik's fleet right now, showing as a second "Meeting Assistant". The
link *did* reach DASH — because the harness collides on DASH's single-instance
lock, quits, and Windows hands the argv to the running DASH as a
`second-instance`, which is what raised the Add dialog. So the deep link works
by accident, via a route that also writes a stray agent into the real store on
every use.

I did not remove `dash-google-proof`: the brief forbids deleting from the store,
and that row is now evidence.

### 3. A scaffolded agent cannot be stopped from DASH

See §2. There is no Stop control; the only way to release the agent's own folder
was to stop its process outside DASH. This makes *update an agent* fail for a
reason DASH misdiagnoses out loud.

### 4. The clean session's report on the skill is the most valuable artifact here

It listed eleven things, unprompted. The four that cost real money:

1. **The skill never says how to run the agent.** The stdin command shape
   (`{"type":"command","command":"retry","command_id":"1"}`) is only in the
   generated README, and there is no one-shot mode — `npm start` idles forever,
   so every author writes the same harness. A `--once` flag would remove it.
2. **Nothing validates an artifact.** `dash_agent_validate` checks the manifest
   only, while the skill's longest section is about artifact shape. The agent
   had to guess whether extra fields on digest items were allowed — **and that
   guess is exactly what the GenLayer committee rejected the briefing for.** The
   loop was green end to end and the output was still wrong.
3. **The scaffold writes CRLF** and the skill says "edit `agent.mjs`" with no
   warning; the first programmatic edit pass matched zero anchors.
4. **`MAX_ITEMS_PER_SOURCE = 10` is a silent truncation** that contradicts the
   skill's own "the digest is the evidence".

Also: `artifact_role` vs `source_role` is undocumented, `component_id`'s
vocabulary is undocumented, and the skill never mentions that the scaffold
already speaks `hn_algolia`.

### 5. `registration.json` says `node`, not `dash:node`

MAR-862's earlier handoff recorded DASH writing `"command":"dash:node"` — its
bundled-Node sentinel. The plugin's handoff produces `"command":"node"`. It
works here because Node is on PATH; on a machine without it, it would not.

### 6. Step 3 of every run reports "Did not finish"

*Local file write* shows `Did not finish` and the header reads "2 of 3 steps
ran", on a run that completed and wrote its file. The step is started and never
completed before `run_completed`. Cosmetic, in the template, not chased.

---

## 5. Contradictions between the prompt and the repo

1. **"`electron .` skips the store guard. Use the packaged launch path."** There
   is no packaged install on this machine — MAR-424 has not landed, and
   `dash-launcher.cmd`, which is Henrik's own door and the target of
   `Desktop\DASH.lnk`, launches `electron <app dir>`. That *is* the app-directory
   form. I used the launcher, because using anything else would have proved
   something about a build Henrik never runs.
2. **"Install the plugin from `tools/dash-mcp`."** It is not published to a
   marketplace (a stated MAR-862 non-goal), and every plugin on this machine is
   installed from a git marketplace. There is no install path that does not mean
   writing persistent MCP config to Henrik's machine, which I did not do
   uninvited. I ran the plugin's real server over its real protocol instead —
   the same thing an install produces, minus the config line. To actually
   install it for a future session:
   `claude mcp add -s user dash -- node C:\Users\henri\Desktop\projekt\MCP\orchestratedash\tools\dash-mcp\launch.mjs`
3. **"Run the agent so it emits a brief… if the template cannot produce one
   unaided, say so plainly."** It produced one unaided *outside* DASH on the
   first attempt. Inside DASH it produced one only after the fix in §2. Both
   halves of that sentence are true and the difference is the whole finding.
4. **A human press was unavoidable.** DASH asks before importing and before
   publishing, by design. The first `request_access` for Electron was denied; I
   stopped and asked rather than routing around it, Henrik granted it, and every
   press in this session is a real pointer event on the real dialog.

---

## 6. Verification

Run from PowerShell, because I changed code.

```
pnpm typecheck    -> tsc --noEmit, no output, EXIT 0

pnpm test         -> Test Files  1 failed | 265 passed (266)
                     Tests       1 failed | 5021 passed | 13 skipped (5035)
                     EXIT 1
```

The single failure is **`tests/store-damage.test.ts > the agents view > carries
the damage as a recovery, beside the agents that survived`** — `Test timed out
in 5000ms`, under full parallel load. Re-run alone:

```
pnpm vitest run tests/store-damage.test.ts   -> Tests  28 passed (28)
```

It touches nothing this session changed. Same class of flake in the plugin's own
suite: `tools/dash-mcp/tests/template-run.test.ts` failed once with `EPERM` in
its own `afterEach` `rmSync` — cleanup racing a live child, not an assertion —
and `pnpm vitest run tools/dash-mcp/tests/template-run.test.ts` gives **11/11
passed**. Both are the documented parallel-load behaviour, not consequences of
the template change.

**The working tree is left uncommitted**, because the brief did not ask for a
commit and nothing here is mine to merge:

```
 M tools/dash-mcp/template/agent.mjs      the bounded fix (32 +, 4 -)
?? qa-screenshots-mar-861/                five frames
?? docs/mar-861-proving-handoff.md        this file
```

The template fix is the one thing in that list that must not be lost — without
it, every agent this plugin scaffolds imports cleanly and then silently produces
nothing.

`pnpm verify` was **not** run: it needs DASH closed, and this session ends with
DASH open on the proof by instruction.

---

## 7. What is NOT done

- **The no-verdict path is still unreproduced live.** Two for two on
  `MAJORITY_AGREE`.
- **`dash-google-proof` is still in the fleet** and `dash://` still belongs to
  the 2026-08-07 harness.
- **The receipt still needs a manual refresh** (finding 1).
- **The scaffolded brief is still rejectable** — the fix for that is a skill and
  payload question, not a bug fix, and it needs a decision about whether extra
  digest item fields should travel to the judge. I did not decide it.
- **No ADR.** 0032 and 0033 stand; nothing here is a new decision.
- **`.orchestrate/state.json` untouched.**
- **An orphan runner from MAR-863's own session is still alive**, from a worktree
  that no longer matters:
  `C:\Users\henri\AppData\Local\Temp\wt-mar863-adjudicate-b1\dist\electron\runner.mjs`.
  It did not interfere with anything here — DASH started its own runner and
  every proof above went through it — but it is the shape that has blocked
  `verify:shell` before, so retire it (session key + `POST /shutdown`, never by
  deleting a store) before the next full `pnpm verify`.

---

## 8. The one thing the next session should do first

**Make the receipt arrive without a refresh** (finding 1), because MAR-866's
video is a recording of exactly this flow and the beat it wants — press it,
watch the verdict land — is the one beat that does not currently happen. It is
small: the record is written, the component renders it correctly, and a manual
refresh proves the whole path works. What is missing is the page noticing.

Second, and cheaper: **decide whether a digest item's extra fields travel to the
judge.** Both committees rejected the briefing for claims about `points` and
`comment_count` that the agent genuinely put in its digest and the payload
builder genuinely did not send. Today an author can write a truthful briefing
that is provably rejected, and neither the skill nor the validator warns them.
That is a design decision, which is why this session did not take it.
