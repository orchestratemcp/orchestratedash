# Planning panel — Phase 0 (or any big decision)

Three fixed roles, one round each. Do not add rounds; do not let anyone
merge by union.

- **Drafter A**: Claude (in the repo/workspace, with project context).
- **Drafter B**: a different provider (e.g. Codex/GPT), same prompt, no
  access to A's answer.
- **Reviewer C** (optional, high-stakes only): a third provider (e.g.
  Gemini), used in the ATTACK round only — never as a third drafter.
- **Decider**: always the in-workspace Claude session, because the
  decision must be checked against repo reality and recorded as
  spec/ADR/issues. The decider role never rotates.

## Round 1 — DRAFT (parallel, identical prompt)

> You are planning <PROJECT>. Goal: <one paragraph — the product, the
> user, the problem>. Constraints: <budget, platform, timeline, "$0
> recurring", team size>. Produce:
> 1. The MVP as ONE canonical user journey (a sentence a novice user
>    would say), plus the 3–5 capabilities it requires.
> 2. Explicit non-goals — what we will NOT build first, and why.
> 3. Epics with rough issue breakdown (each issue one-session sized,
>    each naming its own proof).
> 4. Top 5 risks, each with the cheapest experiment that retires it.
> 5. The walking skeleton: the thinnest end-to-end slice buildable in
>    week one.
> Format: markdown, under 800 words. Recommend, don't survey.

## Round 2 — ATTACK (swap, critique — never combine)

Give each drafter the other's plan with:

> Attack this plan. Do not merge it with yours. Answer only:
> 1. What breaks first if we build this? (concrete failure, not vibes)
> 2. What is missing that the user journey needs?
> 3. What is over-built — the top 3 things to CUT?
> 4. Where do you and this plan genuinely disagree, and what evidence
>    would settle it?

If Reviewer C is used, it gets BOTH plans and the same four questions,
fresh context.

## Round 3 — DECIDE (in-workspace Claude, once)

Give the decider both plans + all critiques:

> Decide the plan. Output:
> 1. The decided MVP journey, epics, and walking skeleton.
> 2. A disagreement table: each point where drafts/critiques conflicted,
>    what you chose, and why — in plain language, no jargon.
> 3. Questions for me: ONLY the calls that are genuinely mine (taste,
>    money, risk appetite, scope). For each: the options, your
>    recommendation first, and what choosing each costs me. Explain well
>    enough that my approval means something.
> 4. After my answers: write the spec into docs/, create the issues,
>    seed STATE.md — and file what was cut as explicit non-goals.

## Rules that keep it honest

- Drafts are independent; contamination kills the diversity that makes
  the panel worth running.
- Critique is destructive on purpose: "combine your answers" produces a
  bloated union of both plans; "attack" produces deletions and sharper
  choices. The union of two plans is almost never a better plan.
- One round of each. If the decider still can't decide, the missing
  thing is evidence, not another opinion — file the cheapest experiment
  instead of a fourth round.
- The human answers questions and approves; the human does not do the
  merging. If a question can't be explained plainly, it isn't ready to
  be asked.
