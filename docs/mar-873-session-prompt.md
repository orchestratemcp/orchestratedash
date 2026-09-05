# Session prompt — MAR-873: every agent talks out of the box

Dispatched by the orchestrator 2026-09-05. Packet 11 of MAR-861. Blocks the
"talk to your agent" beat of the video. Small, decided, no ADR.

---

**Client:** Claude Code, `claude --model sonnet`.

**Why this tier:** the design is Henrik's ruling verbatim, the root cause is
one gate in one file, and the change is a reorder plus one copy string. If the
diagnosis below does not hold, stop and hand off rather than redesigning.

**Repository:** `orchestratedash`, `master` at or after `d4a9a19`.
**Worktree:** `C:\Users\henri\AppData\Local\Temp\wt-mar873-default-model-d1`.
**Branch:** `000henrik/mar-873-default-model-fallthrough`.
**Linear issue:** MAR-873. Read it first; it carries the store evidence.

## The ruling

Henrik: *"All agents should have an default model so we always can talk to it
out of the box."*

## The defect, verified

On `proof-scout-mar861` the chat says: *"Proof Scout has no way to answer
questions. … this agent's description does not name one. Nothing to do here."*

Meanwhile the live store holds a fleet default — `fleet_model_default` →
`openrouter` / `anthropic/claude-sonnet-5` since 2026-08-19 — and a connected
`openrouter` key with `is_default = 1`. The agent could have answered.

## The diagnosis — verify it before you fix it

`lib/views/ask.ts` gates the chat in this order:

1. `no_provider` — manifest names no model provider → **refuse**
2. `no_key` — provider named, no key → refuse with connect flow
3. `no_model_chosen` — MAR-642: `readEffectiveModelChoice(agent, card.provider_id)`;
   a `fleet_default` counts as chosen → proceed
4. `nothing_saved`

Step 3 is the rescue Henrik wants and it already exists. It sits **behind**
step 1, so an agent naming no provider never reaches it. The fleet default
names a provider *and* a model, so it answers step 1 too; the gate never asks.

Confirm this by reading the function before editing. If the refusal shown is
not `no_provider`, or the effective-choice reader cannot run without a
`provider_id`, say so in the handoff.

## What to change

1. **Resolve the effective choice first.** If it resolves to `one_model` with
   `resolved_by === "fleet_default"`, the agent can be asked regardless of what
   its manifest declares. Use the fleet default's own `provider_id` for the
   `no_key` check and the provider label.
2. **`no_provider` becomes the refusal only when there is no fleet default
   either.** Its `next_action` in `lib/copy/ask.ts` must then be *choose a
   default model in Settings*, carrying the flow — never *"nothing to do here"*.
3. **Keep main and page agreeing by construction.** `electron/ask-host.ts`
   reads the same effective choice; make the reorder in the shared function so
   there is one change, not two.
4. **Keep the "from your default" note.** `describeAskModel(true)` already says
   the model is borrowed from the fleet. Assert it renders on this path.

## Do not

- Do not touch the scheduled-run spend rule (*"A scheduled run cannot spend on
  a model"*, ADR 0016). This packet is the attended chat only.
- Do not change the manifest contract or `lib/ai/model-choice.ts`' resolution
  order for steps.
- Do not write an ADR. Nothing is being decided.

## File ownership

**You own:** `lib/views/ask.ts`, `lib/copy/ask.ts`, `electron/ask-host.ts`
only if the shared function forces it, the tests for those (`tests/ask-*.test.*`),
and `docs/mar-873-handoff.md`.

**Read-only:** everything else. No other session is live.

## Start checks

```bash
git rev-parse --abbrev-ref HEAD
git status --short
git log --oneline -1
```

## Verification

From **PowerShell**.

```bash
pnpm typecheck
```

```bash
pnpm test
```

`tests/store-damage.test.ts` times out under parallel load and passes alone.
Known, not yours.

## Lifecycle exit state

`merged` when green. **Not `proven`.**

## The proof

`proven` = **on the installed build, open an agent that names no model, ask it
about its saved reports, and get an answer**, with the composer showing the
model came from your default. Screenshot plus the `broker_audit` row.

Build both, in order, before you look:

```bash
pnpm build:renderer
```

```bash
pnpm build:shell
```

`proof-scout-mar861` is the test subject and it has two saved reports. Do not
force-kill Electron.

## Evidence to write back

1. A comment on MAR-873: SHA, PR, whether the diagnosis held, what you ran.
2. `docs/mar-873-handoff.md` in the PR.

## Hard stop

When an agent with no model in its manifest answers a question using the fleet
default, and the tests pass: **stop.** Do not start the Settings cleanup
(MAR-874), do not touch scheduling. Write the handoff and end the session.
