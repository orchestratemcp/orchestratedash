# MAR-861 → orchestrator: promote two, file five

**From:** the proving session, Claude Code `--model opus`, 2026-09-04.
**Evidence commit:** `cb3962d`, merged as PR #309, master now `7c8c72a`.
**Narrative:** `docs/mar-861-proving-handoff.md`. **Frames:** `qa-screenshots-mar-861/`.

This is the decision list. Everything here is already committed; nothing is
waiting on a branch.

---

## 1. Promote

Both packets reached a behavioural proof on the installed build. `state.json`
still reads `merged` for both — these are yours to write.

**MAR-862 → `proven`**

```json
"proof": {
  "command": "installed DASH via dash-launcher.cmd; dash-agent plugin driven from a clean session; Add and start pressed on DASH's own import dialog",
  "run": "2026-09-04: proof-scout-mar861 validated clean on the first attempt, imported at 19:03:06.144Z with zero validation failures and visible in the fleet; Run now then produced digest-5c752a10-7131-431d-9a8f-ea574c511735 and brief-5c752a10-7131-431d-9a8f-ea574c511735 in the live store. qa-screenshots-mar-861/01,02"
}
```

**MAR-863 → `proven`**

```json
"proof": {
  "command": "installed DASH; 'Have it judged' pressed on DASH's own output card",
  "run": "2026-09-04: two judgements on brief-5c752a10-7131-431d-9a8f-ea574c511735 — evaluate_tx 0x7e374f0f5e88010908aa28321b5ba5cd161cfa2c35410ce26013f71405f933d7 (131s, prd-sonnet) and 0x01f3b1df3f3f52584a918396f7eee2b85cf84eb6230adc2e743d830ad30d6877 (129s, gemini-3-flash-preview). Both FINALIZED/SUCCESS/MAJORITY_AGREE, both REJECTED, both rendered as a receipt beneath the citations. qa-screenshots-mar-861/03,04,05"
}
```

`git.evidence_base_commit` can move to `7c8c72a`.

**Read the proof line before you promote MAR-863.** The verdict was `REJECTED`,
twice. That is the packet working — the committee caught claims the evidence
rows genuinely do not carry — not the packet failing. If the epic's acceptance
language says "a verdict renders", it is met. If anyone wrote "an ACCEPTED
renders", that sentence is wrong and should be fixed rather than re-run.

---

## 2. File, in this order

### P1 — The receipt does not arrive on the page's own poll *(blocks MAR-866)*

After a judgement settles, the card keeps showing the **previous** receipt until
`...` → Refresh. Reproduced deliberately on a second press. The button also never
shows `Being judged` — it reads *Have it judged* then *Judge it again*
throughout.

The record is written correctly and the component renders it correctly; the page
does not notice. **MAR-866's video is a recording of exactly this flow and
"press it, watch the verdict land" is the one beat that does not happen today.**

Scope: `app/_components/outputs.tsx`, `app/_data/source.ts`, the adjudication
resolver in `lib/views/`. Small, no decision needed. **Dispatch this before
MAR-866.**

### P2 — A digest item's extra fields do not reach the judge *(needs a decision)*

Both committees rejected for the same thing: the briefing cited `points` and
`comment_count`, which the agent really put in its digest and
`buildAdjudicationPayload` really does not send. An author can write a truthful
briefing that is provably rejected, and neither the skill nor the validator warns
them.

Three ways out — carry extra item fields into the payload, refuse them at
ingest, or document the closed set and say so in the skill. **That is an ADR, so
assign the number at dispatch.** Do not let a worker session pick it.

### P3 — `dash://` is owned by the 2026-08-07 google-proof harness

Confirmed and worse than MAR-862's finding 1 recorded. Firing the handoff URL
started the harness, which **wrote its own agent into the live installed
store**: `dash-google-proof v2 imported_at 2026-09-04T18:56:59.446Z`. It is in
Henrik's fleet now as a second "Meeting Assistant". The Add dialog appeared only
because the harness collides on the single-instance lock and Windows forwards its
argv as a `second-instance`.

Scope: `registerProtocolClient` / `isAppEntryPoint` in
`electron/handoff-host.ts` + `lib/shell/app-identity.ts`. The guard over-refuses
the one launch form a person uses. Includes a decision you own: whether to remove
the `dash-google-proof` row (this session left it — deleting from the store was
out of scope and the row is evidence).

### P4 — The plugin's skill has eleven documented gaps

The clean session listed them unprompted; they are in
`docs/mar-861-proving-handoff.md` §4.4. The four that cost real time: the skill
never says how to run an agent and there is no one-shot mode, **nothing validates
an artifact** (manifest only — and that gap is what P2 is about), the scaffold
writes CRLF without warning, and `MAX_ITEMS_PER_SOURCE = 10` truncates silently.

Scope: `tools/dash-mcp/skills/**` and `tools/dash-mcp/template/**`. Bounded,
sonnet-sized.

### P5 — A running agent blocks its own update, and DASH misdiagnoses it

Updating an imported agent fails with *"DASH could not finish copying … Build the
agent again with a current Agent Kit"* when the cause is that the agent's own
process holds `code/` open. There is no Stop control in the `...` menu. Also:
after an update, *Run now* answers `stale_snapshot` until a manual refresh.

---

## 3. Chores

- **Retire the orphan runner** from MAR-863's own session:
  `C:\Users\henri\AppData\Local\Temp\wt-mar863-adjudicate-b1\dist\electron\runner.mjs`.
  It did not interfere here, but it is the shape that has blocked `verify:shell`
  before. Session key + `POST /shutdown`, never by deleting a store.
- **`pnpm verify` was not run** this session — it needs DASH closed and the
  session ends with DASH open on the proof by instruction. `pnpm typecheck` clean,
  `pnpm test` 5021 passed with one parallel-load timeout that passes 28/28 alone.
  Worth a clean full `verify` on the next session that can close the app.

---

## 4. Fix these in your dispatch templates

1. **"Use the packaged launch path"** — there isn't one. MAR-424 has not landed;
   `dash-launcher.cmd` (which `Desktop\DASH.lnk` points at) runs
   `electron <app dir>`, the same form the prompt warned against. Say "launch via
   `dash-launcher.cmd`" until MAR-424 lands.
2. **"Install the plugin"** — `tools/dash-mcp` is not on a marketplace (a stated
   MAR-862 non-goal) and every plugin on this machine installs from a git
   marketplace. There is no install that is not persistent MCP config on Henrik's
   machine. Either say "run its server directly", or make publishing it a packet.
3. **Both proof lines ended in a press only a person can make.** DASH asks before
   importing and before publishing, by design. A proving session needs the
   computer-use grant arranged up front, or Henrik at the keyboard — the first
   `request_access` here was denied and the session had to stop and ask. Worth a
   line in every prompt that ends at a dialog.

---

## 5. Next dispatch, recommended

**P1, as a bounded Claude Code `--model sonnet` packet**, owning
`app/_components/outputs.tsx`, `app/_data/source.ts` and the adjudication
resolver, with MAR-866 blocked behind it. It is the only P-item standing between
the current build and a recordable video, it needs no decision, and the receipt
path is already proven end to end — the page just has to notice.

Then **P2 with an ADR number assigned at dispatch**, because it is the only item
on this list that a worker session must not decide for itself.
