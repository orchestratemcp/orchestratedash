# Checkpoint — state of the project (mid-work planning)

Run at every epic end or clean break, in the in-workspace orchestrator
session. This is a planning session, not a build session: no product code
changes.

> Checkpoint time. Read STATE.md (HEAD), .orchestrate/state.json, the
> product spec and roadmap, and the open issues. Then:
>
> 1. **Journey check**: can a new user reach the core value through the
>    canonical journey on the packaged/deployed build TODAY? Cite the
>    latest proof (command + date), not the latest merge.
> 2. **Proven-debt**: count merged-but-unproven packets. Over budget →
>    the next wave is a proving wave; name its targets.
> 3. **Drift**: what did we build that the MVP does not need? What did
>    the spec promise that nothing is working toward? List both.
> 4. **Broke twice**: anything that failed twice this epic is a workflow
>    bug — propose the rule/hook/template line that prevents the third
>    time.
> 5. **Cut list**: the 3 things you would cut or defer right now, with
>    what each cut buys us.
> 6. **Next wave**: 1–3 packets, each one-session sized with its proof
>    named, balanced against the proven-debt answer.
> 7. **Questions for me**: only genuine product calls, plain language,
>    your recommendation first.
>
> Then: rotate STATE.md (archive superseded entries, rewrite HEAD),
> update lifecycle counts, and prepare the session prompts for the next
> wave using the dispatch template.

## Second opinion (optional)

Only when the direction itself is contested — not every checkpoint —
export the checkpoint summary (not the whole repo) to one external model
with: "Attack this direction: what breaks first, what's missing, top 3
cuts, one thing you'd do instead." The in-workspace session stays the
decider and answers with evidence, not deference.
