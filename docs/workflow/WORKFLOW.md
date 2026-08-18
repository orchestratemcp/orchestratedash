# Orchestrated Delivery Workflow

A reusable playbook for building products with AI sessions: one human
product owner, one orchestrator session, N worker sessions. Distilled from
a month of DASH development (~800 commits, ~340 merges, 157 issues, 25
ADRs, 218 test files) plus published best practice.

## The shape

```
Phase 0  PRODUCT      spec, MVP, non-goals, UX bar, roadmap
Phase 1  WORKSPACE    repo, issue tracker, CI gates, AGENTS.md, templates
Phase 2  LOOP         orchestrator plans -> workers build -> orchestrator
                      reconciles -> repeat
Phase 3  CHECKPOINT   at each epic/clean break: re-read the spec, measure
                      proven-debt, rotate state, retro the workflow itself
```

## Phase 0 — Product (do this once, well)

Deliverables: product spec (who/what/why), MVP definition with the ONE
canonical user journey, explicit non-goals, feature list as epics/issues,
UX bar (name the products whose polish you're matching), roadmap.

Rules:
- The MVP is a journey, not a feature list. "A new user can X without Y."
- Non-goals are as load-bearing as goals; agents drift into adjacent work
  unless you name what NOT to build.
- Write the spec as files in the repo (docs/), not as chat history.

## Phase 1 — Workspace

- Repo + CI that actually gates (typecheck, tests, smoke). A merge gate is
  PASS on every check — "finished" is not a gate.
- Issue tracker seeded with epics/issues. Issues are the work queue.
- AGENTS.md (rules all agents follow) + CLAUDE.md pointing at it.
- STATE.md with a HEAD section (current truth) + archive convention.
- .orchestrate/state.json: one record per packet — id, lifecycle, commit,
  proof pointer. No narrative in JSON.
- Templates: session-prompt, handoff, ADR.
- Decide serial-number registries (ADR numbers, migration indexes) are
  orchestrator-assigned.

## Phase 2 — The loop

See SKILL.md for the orchestrator's operating manual. In short:

1. Orchestrator ingests handoffs, verifies claims against git, promotes
   lifecycles, critiques against the MVP, files follow-ups.
2. Orchestrator writes 1–3 session prompts (contract in the template):
   model choice, ownership, objective, proof, hard stop.
3. Workers build in their own worktrees/branches, verify, open PRs, append
   packet entries, write handoffs.
4. Human reviews at the checkpoint cadence, not every commit — but the
   human is the only one who merges to default (or explicitly delegates).

Key budgets:
- **Proven-debt budget:** merged-but-not-proven packets capped (~10). Over
  budget → next session proves instead of builds.
- **Session scope budget:** a packet must fit one context window including
  verification. If the prompt needs "and then", split it.
- **State budget:** STATE.md HEAD under ~200 lines; rotate at checkpoints.

## Phase 3 — Checkpoint

At every epic end or clean break:
1. Re-read spec + roadmap. Are we closer to the MVP journey working
   end-to-end? What would we cut?
2. Count proven-debt; schedule proving sessions.
3. Rotate STATE.md; archive the narrative.
4. Retro the workflow: what broke twice? Fix the workflow (a gate, a
   template line, an AGENTS.md rule), not just the instance.
5. Update memory/AGENTS.md with anything a session had to re-learn.

## Verification doctrine

- Tests prove code; only the packaged/deployed path proves the product.
- Screenshots find what measurements cannot — budget visual QA for UI work.
- Every "it works" claim names the command or artifact that showed it.
- End sessions with the app running and the change visible, not just green
  tests.

## Parallelism (multi-agent)

- Parallelize by ownership, not by hope: disjoint files/dirs per session,
  or read-only reviewers beside one writer.
- Worktree per session. Orchestrator assigns serial numbers at dispatch.
- Good parallel shapes: implement + independent audit; N bounded issues in
  disjoint areas; build + prove (different packets); background research
  beside foreground implementation.
- Bad parallel shapes: two writers in one area; parallel packets that both
  add migrations/ADRs; anything sharing a checkout.

## Team version

- Roles: product owner (human, owns spec + merges), orchestrator operator
  (human driving the orchestrator session — can be the same person),
  reviewers (humans or read-only agent sessions).
- The issue tracker is the interface between people. A person picks up an
  epic and runs their own worker sessions under the same AGENTS.md and
  prompt contract; handoffs land as issue comments + packet entries, so
  the orchestrator doesn't care whether a session was run by you or a
  teammate.
- CODEOWNERS + branch protection make the ownership rules mechanical.
- Weekly checkpoint is a human meeting with the checkpoint questions as
  the agenda.

## Practices borrowed from published sources

From Boris Cherny (Claude Code's creator) and Anthropic's engineering posts:

- **Give every agent a way to verify its work** (tests, builds, screenshots).
  This is the single highest-leverage practice — claimed 2–3x quality.
- **Compounding engineering:** every time an agent makes a mistake, the
  correction goes into AGENTS.md/CLAUDE.md so it cannot recur. Prune
  ruthlessly — a bloated rules file gets ignored. "Would removing this
  cause mistakes? If not, cut it."
- **Plan mode first, biggest model, permissions not YOLO.** Iterate on the
  plan, then execute; the strongest model needs less steering and is net
  faster.
- **Hooks for musts, instructions for shoulds.** Formatting, gates, and
  completion checks belong in deterministic hooks, not prose rules.
- **Slash commands / skills for every inner loop** (commit-push-PR, fix
  issue, prove packet), checked into the repo so agents can invoke them.
- **Fresh context beats long context.** After two failed corrections,
  restart with a better prompt. For multi-session work, durable external
  state (files, issues, specs) + fresh sessions beats one long session —
  the generalized "Ralph loop."
- **Failing-by-default checklists.** Feature lists start as failing and
  flip only on evidence; prevents premature victory declarations.
- **Decompose by shared context, not work type.** A feature and its tests
  stay in one session; splitting plan/implement/test across agents creates
  telephone-game loss. Multi-agent is justified only by context
  protection, true parallelism, or specialization — at 3–15x token cost.

Sources: Boris Cherny's "How I use Claude Code" (Jan 2026),
code.claude.com/docs/en/best-practices, Anthropic's multi-agent research
system and long-running-agent harness posts, ghuntley.com/ralph.

## When NOT to use this

One-shot or single-session work beats orchestration when: the deliverable
fits one context window, correctness is visible on sight (prototype,
script, landing page), or you can't yet write the proof for a packet. The
loop earns its overhead when the project outlives any single context
window, has real evidence requirements, or needs parallel hands. Start
one-shot; adopt phases 0–1 the moment a second session has to re-learn
something the first session knew.
