# Orchestrator handoff — MAR-861, Agent Tank — 2026-09-06

For the next orchestrator session. Everything below was verified against git,
`.orchestrate/state.json` and Linear on 2026-09-06 before it was written. Where
a claim rests on a worker's handoff rather than on something I checked myself,
it says so.

**Hard external deadline: 2026-09-17 15:30 UTC.** Eleven days.

---

## 1. Read these first, in this order

1. `AGENTS.md`, then `PROJECT_STATE.md` HEAD, then `.orchestrate/state.json`.
2. Linear epic **MAR-861** and every child. The children carry the decisions,
   the proof lines and the traps; this document is the index over them.
3. The four worker handoffs on master, newest first:
   `docs/mar-873-handoff.md`, `docs/mar-865-handoff.md`,
   `docs/mar-861-proving-handoff.md`, `docs/mar-863-handoff.md`.
4. The spike repo README: `github.com/orchestratemcp/brief-acceptance`. It is
   the public submission and it holds the measured numbers (verdict stability,
   latency, the validator-overrules-the-leader case).

## 2. Where things stand

Master: `a8e6f90` plus PR #317 (docs only, merged this session). Zero open PRs.
`pnpm state:check` valid, 83 pre-existing drift warnings, none from this wave.

| Packet | Lifecycle | What is true |
|---|---|---|
| MAR-862 plugin | **proven** | Fresh agent scaffolded, imported with zero failures, in the fleet. |
| MAR-863 adjudicate | **proven** | Button pressed on a brand-new agent's brief; verdict as receipt; two judgements, both REJECTED and both correct. |
| MAR-868 live poll | merged | Fix landed (#311). Proof is a *recording*, none taken. |
| MAR-865 VPS | merged | Enrol + deploy proven on `root@78.141.221.121`; Discord half not done, blocked on MAR-864. |
| MAR-864 remote start | planned | **Re-scoped**, needs an ADR. See §3. |
| MAR-869 fields to judge | planned | Needs Henrik's ruling, then an ADR. |
| MAR-870 `dash://` hijack | planned | Needs Henrik's ruling on deleting a store row. |
| MAR-871 server page | planned | UX, nine defects folded in, after deploy proof, before filming. |
| MAR-872 timezone | planned | Needs Henrik's ruling, then an ADR. |
| MAR-873 default model | planned | **Stopped correctly by the worker.** See §3. |
| MAR-874 settings page | planned | UX, after MAR-873. |
| MAR-866 video + submission | planned | Blocked on everything above it needs. |

## 3. The three findings that changed the plan, and what they need

### MAR-873 is not a one-line reorder (worker finding, verified by me)

The gate-order diagnosis held: `lib/views/ask.ts` refuses `no_provider` before
`readEffectiveModelChoice` runs. But reordering it would make things worse, and
the worker was right to stop. `proof-scout-mar861`'s manifest declares
`agent_dom.connections: []` and every step `model_tier: "none"`. Its own plan
never needed a model. `performAskAction` in `electron/ask-host.ts` spends by
resolving a `connection_id` against the manifest's *own* declared connections.
With none declared there is nothing to resolve, so the composer would say "can
ask" and every question would fail with a generic error.

The tempting patch, read the fleet key directly for this request, is rejected
by design. `lib/broker/execute.ts` derives the vault name from the agent id for
every non-chief principal so that *no agent, named anything at all, resolves to
the fleet credential's vault key* (ADR 0013, ADR 0023, both explicit).

**The real fix is upstream, and it is two things:**

1. **The MAR-862 plugin should always emit the ADR-0013-shaped `model_provider`
   connection**, regardless of what the agent's own steps need, because asking
   questions needs a model independent of the plan. This is a plugin change
   inside MAR-862's ownership and it is the one that makes Henrik's ruling true
   *for every agent the plugin builds*. Dispatch it as a new packet under
   MAR-873; the template lives in `tools/dash-mcp/template/`.
2. **Materialisation for agents imported *after* the provider was connected**
   is, per ADR 0013, deliberately a manual press. That press is MAR-874's
   surface (the new *Which model it talks with* row). So MAR-874 is no longer
   only a cleanup; it carries the adoption step.

Do not reorder the gate until (1) exists, or the reorder turns an honest
refusal into a broken composer.

### MAR-864 is a runtime gap, not a UI packet (verified by me)

The transport works with no new code: the host woke on its schedule and the
settlement drained home. The press exists. **Both refuse** because the deployed
copy is never started. Deploy verb `start` starts the *runner*; `runner/main.ts`
adopts registrations with `child: null` and starts none; `/agents/{id}/lifecycle`
is deliberately kept off the channel because it carries typed secrets. The
remote press does only the second of MAR-657's two acts.

**Needs an ADR** (number assigned at dispatch): either a narrow crossable
route that starts a *named, already-installed* agent with no arguments, or a
host-side rule that a registration with a schedule is spawned idle at adoption.
Henrik must pick. Until then Discord (MAR-865 half 2) and the cloud beat of the
video cannot move. Also: `collect` has no caller in `electron/`, so any proof
line that wants the host's log tail has to wire it first.

### `at_local` is read against the host's clock (verified by me)

`lib/schedule/plan.ts` defines it as *this machine's own local time, never a
timezone*. Right locally, wrong when it crosses to a UTC host under ADR 0031.
Two hours off, silently. **MAR-872, needs an ADR.** Recommend resolving at the
edge DASH controls (convert when pushing). A schedule is currently **on** at
18:20 UTC on the VPS and will write one refusal row a day until MAR-864 lands;
Henrik has been told where the off switch is.

## 4. Decisions only Henrik can make — do not decide these for him

1. **MAR-864's shape** (route vs spawn-at-adoption). Gates Discord and the
   cloud half of the video. The highest-leverage single answer.
2. **MAR-872's shape** (convert at the edge, carry a zone, or host clock).
3. **MAR-869**: carry extra digest fields to the judge, refuse them at ingest,
   or document a closed set. Recommend carry. Without it every brief that cites
   a number gets rejected and the verdicts become noise.
4. **MAR-870**: whether to delete the `dash-google-proof` row from his live
   store. Recommend delete, and fix the protocol registration so it cannot
   return. **Never delete from the live store yourself.** This repository has
   lost a store to a careless write.
5. Two from the spike README still open: is the competitor brief publishable
   in a public repo, and Studionet vs Bradbury for the escrow demo.

Reversible things take the orchestrator's default and get recorded on the
issue as "orchestrator default, owner may overrule". The five above are not
reversible in that sense.

## 5. Owner-only work already told to Henrik

- `loginctl enable-linger root` on the VPS (may be redundant; harmless).
- Turn the 18:20 UTC schedule off unless he wants a daily probe.
- Builder badge: **not a Studio task.** The Developer NFT mints automatically to
  whichever address sends a deploy. The spike deployed from throwaways, so
  nothing minted to him. One deploy from his MetaMask on Bradbury earns it. The
  CLI steps are on MAR-861. **No session ever handles his key.**
- His GEN was invisible in MetaMask because GEN is the native currency of
  chain 4221, not an ERC-20 on Ethereum; the network settings are in the
  conversation history and on MAR-861.

## 6. What is dispatchable without a ruling, in order

1. **MAR-873b** (new): the plugin always emits a `model_provider` connection.
   Sonnet tier, inside `tools/dash-mcp/**`, no ADR. Proof: a freshly built agent
   answers a question out of the box.
2. **Prove MAR-868** with a screen recording. Also the dress rehearsal for the
   video's central beat. Opus tier, installed build.
3. **MAR-871** server page and **MAR-874** settings page. Both UX, both have
   proposals on the issue awaiting Henrik's nod, both before filming.

Nothing else moves without §4.

## 7. Rules this wave learned the hard way — put them in the next prompts

- **A handoff can be wrong about time.** Two sessions asserted "the page polls"
  from the store and the component; both were right, the page was not. Where a
  proof line says *watch it happen*, a right row and right markup is evidence of
  two things out of three.
- **A field the payload carries and the case file hides does not exist** to an
  LLM judge, and the claim resting on it is unsupported. Render the whole row.
- **Three receipt fields, three questions.** `status_name` (decided?),
  `leader_receipt[0].execution_result` (leader succeeded?), `result_name`
  (committee agreed?). FINALIZED + SUCCESS + MAJORITY_DISAGREE applies **no
  state** and happens ~1 in 10.
- **Prompts must not say "packaged launch path"** (there isn't one; MAR-424 not
  landed), must not say "install the plugin" without saying it writes persistent
  MCP config, and must arrange the **computer-use grant before** a session whose
  proof ends in a press.
- **Grep for a caller.** `isRunning()` and `collect` both shipped with zero
  callers and each cost a session.
- **`state:check` refuses `proven` without a proof block.** It caught me. Fill
  `proof.command` and `proof.run` with the artefact and the hashes.
- Windows: run verify from PowerShell; close DASH before `pnpm verify`; never
  force-kill Electron; direct-mode GenLayer tests need the two shims in
  `brief-acceptance/tests/direct/conftest.py`.

## 8. Two things I flag rather than decide

- **The proven-debt gate reads 132 merged / 70 proven** against a budget of ten,
  so it is permanently on and therefore means nothing. My ruling: it should
  count the *current wave's* debt, not the project's history. I did not edit
  AGENTS.md at a deadline. Wave 3's own debt is 3 (MAR-865, MAR-868, and
  MAR-873's docs). Restate the rule after the 17th.
- **The spike repo's fixture is Henrik's real competitor brief.** It is a
  summary of public posts and holds nothing secret, but the repo is public and
  the question of whether he wants it there is his, not ours.

## 9. Session hygiene

Worktrees are stale from earlier waves under `%TEMP%\wt-*`; prune with
`git worktree prune` when convenient, not mid-packet. Every dispatched prompt is
committed under `docs/mar-<id>-session-prompt.md`; Henrik pastes them from chat
because the `.md` links do not open for him, so paste in chat *and* commit.
