# Operator's guide — how we actually use all this

Everything else in this folder is reference. This is the file you open
when you sit down to work.

## The pieces and where they live

| Piece | Where | You touch it when |
|---|---|---|
| Orchestrator skill | `~/.claude/skills/orchestrator/` | Never directly — it auto-loads in orchestrator sessions |
| Playbook (phases, budgets, doctrine) | `docs/workflow/WORKFLOW.md` | Onboarding someone, or arguing about process |
| Planning panel prompt | `docs/workflow/planning-panel-prompt.md` | New project, or any big contested decision |
| Checkpoint prompt | `docs/workflow/checkpoint-prompt.md` | Epic end, clean break, or "are we drifting?" |
| Dispatch template | `docs/workflow/session-prompt-template.md` | Never directly — the orchestrator fills it in |
| Project rules | `AGENTS.md` | An agent makes a mistake → add one line; prune monthly |
| Current truth | `PROJECT_STATE.md` (HEAD, <200 lines) | Read at session start; rotated at checkpoints |
| Packet index | `.orchestrate/state.json` | Never by hand — sessions append, orchestrator promotes |
| Starter kit for new projects | `Desktop\workflow-kit.zip` | Starting a new project |

## The daily loop (existing project)

1. **Open one Claude Code session in the repo.** Say what you want, or
   just "orchestrate" — the skill loads, it reads state, reconciles any
   handoffs since last time, and tells you where things stand.
2. **It hands you 1–3 session prompts.** Each names its model, its issue,
   its file ownership, its proof, and its hard stop. If it needs a call
   from you first, it asks in plain language with a recommendation.
3. **Paste each prompt into its own fresh worker session** (separate
   terminal tab or claude.ai/code session). Parallel workers are fine —
   the prompts already carry disjoint ownership.
4. **Workers finish with a handoff.** Paste each handoff back into the
   orchestrator session (or point it at the PR + Linear comment). It
   verifies claims against git, promotes lifecycles, files follow-ups,
   and hands you the next prompts.
5. **You merge PRs** — on green CI (PASS, not "finished"), with your
   explicit word. That is the one step that is always yours.

That's the whole loop. You are the product owner and the merge button;
the orchestrator is the project manager; workers are the hands.

## Starting a new project (~15 minutes)

1. Unzip `workflow-kit.zip`. Copy `seeds/` files into the new repo root
   (`CLAUDE.md`, `STATE.md`, `.orchestrate/state.json`) and
   `templates/AGENTS.md` as `AGENTS.md`. Copy the `templates/` and
   `WORKFLOW.md` into `docs/workflow/`.
2. Fill the AGENTS.md placeholders: product boundary (one paragraph),
   the canonical journey, process hazards, verify commands, model
   routing. Thin is fine — it grows by compounding.
3. `git init`, first commit, put that SHA in state.json's
   `evidence_base_commit`.
4. Create the Linear project (or GitHub issues).
5. Run the **planning panel** (below). The decider writes the spec,
   creates the issues, and seeds STATE.md.
6. Dispatch the first packet: always the walking skeleton — the thinnest
   end-to-end slice, proven on the real path, in week one.

## Planning (the panel)

For a new project or any big contested decision:

1. Paste Round 1 (DRAFT) from `planning-panel-prompt.md` into **two**
   sessions: Claude Code in the repo, and one other provider (SOL).
   Identical prompt. Don't show them each other's answers yet.
2. Round 2 (ATTACK): give each the other's draft with the four attack
   questions. High-stakes only: give a third model (Gemini) both drafts,
   same questions, fresh context.
3. Round 3 (DECIDE): give the in-repo Claude session everything. It
   produces the decided plan, a disagreement table, and questions only
   you can answer — each with a recommendation and what it costs you.
4. Answer, approve, and it writes spec + issues + state. One round of
   each, ever — unresolved disagreement becomes the cheapest experiment,
   not another debate round.

## Checkpoints (mid-work planning)

At every epic end or clean break — or whenever it *feels* drifty — paste
`checkpoint-prompt.md` into the orchestrator session. You get: a journey
check with citation, the proven-debt count, drift in both directions, a
cut list, the next wave, and the state files rotated. If the direction
itself is contested, export the checkpoint summary to one external model
as an attacker; the in-repo session stays the decider.

## Proving waves

`PROJECT_STATE.md` carries the lifecycle counts. When merged-but-unproven
packets exceed **10**, the next sessions prove instead of build — that
rule is in AGENTS.md and the orchestrator enforces it. A proving session
runs the packaged/deployed path, attaches evidence to Linear, and never
fixes what it finds — defects become new issues.

## With a team

Same loop, more hands. The issue tracker is the interface: a teammate
picks up an epic and runs their own worker sessions under the same
AGENTS.md and dispatch contract. Handoffs land as issue comments and
packet entries, so the orchestrator doesn't care who ran a session.
CODEOWNERS + branch protection make ownership mechanical. The weekly
checkpoint is a human meeting with the checkpoint questions as agenda.

## The cheat sheet

- **Merged is not proven.** Proven = the real path ran, with evidence.
- **CI gate is PASS**, never "finished"; "no checks" means master moved
  or the PR conflicts — investigate, don't wait.
- **One writer per file area.** Parallel sessions get disjoint ownership
  or one is read-only. Worktree per session; never share a checkout.
- **Serial numbers** (ADRs, migrations) come from the orchestrator.
- **Hard stops are real.** A worker that finished its packet writes the
  handoff and ends — adjacent work is a new packet.
- **Compounding:** every agent mistake becomes one AGENTS.md line;
  anything that broke twice is a workflow bug — fix the rule.
- **State stays small.** HEAD under 200 lines, no narrative in JSON;
  rotate at checkpoints. The moment reading state feels slow, rotate.

## When things go sideways

- **A handoff claims something git doesn't show** → git wins; the
  orchestrator records the contradiction and re-plans from git.
- **Two sessions touched the same files** → stop one, re-read state,
  never force-push; the orchestrator re-dispatches with clean ownership.
- **Your PR merged or changed while you worked** → normal here; re-read
  state and continue. Another session may have resolved your conflicts.
- **The orchestrator asks a question you don't understand** → say so.
  An approval given on jargon is not an approval; it must re-explain in
  plain language until your yes means something.
