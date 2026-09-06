# Lane H — MAR-878b: truthful readiness, chat capability and recovery (UX-5, page + chief half)

Tier: Opus (three states that must agree across the header, the composer and
the chief; refusal semantics must not loosen). Read `ux-lanes-common.md`
first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux878b-s1`
Branch: `000henrik/mar-878b-readiness` — **stacked on lane A's branch**
`000henrik/mar-875-one-result-per-run` (its PR head). Your PR targets
`master`; merge `origin/master` in if lane A merges first. Lane G (MAR-874)
runs in parallel on the SAME page file: it owns the `settings:` stage entry
and the settings components; you own the `chat:` stage entry, the page
footer/composer line and the header's readiness. Keep your hunks inside
those regions so the two PRs merge cleanly; expect to merge master once.
Issue: MAR-878 (https://linear.app/martini-home/issue/MAR-878) — the
template prerequisite half is already PR #320 (lane B). This lane is the
rest:

> Proof Scout shows READY but says it cannot answer questions beside OPEN
> CHAT. Separate runtime state, supported capability and unmet requirement.
> Direct chat only when available; chief entry says "Ask the chief about
> this agent". Feed the chief the same refusal/capability facts and recovery
> action. Acceptance: non-chat, missing model grant, expired provider,
> stopped and configured states agree across page/chief. Broker refusals
> remain intact. Focused state/authorization tests plus real question proof
> (orchestrator's).

## Facts (orchestrator-verified, 2026-09-06 on the installed build)

Proof Scout's page: header chip READY, "LIVES ON Cloud"; footer line "Proof
Scout has no way to answer questions." beside an OPEN CHAT button. The
reason is `lib/views/ask.ts:120-128` returning `blocked(describeUnavailable("no_provider"…))`
because the manifest declares no `model_provider` connection (fixed for
future scaffolds by #320; existing agents keep the empty declaration).
Other blocked reasons in the same file: `no_key` (:129-136), `no_model_chosen`
(:149-156), `nothing_saved` (:157-164). The header's readiness comes from
`lib/views/agent-checklist.ts` / `lib/views/agent-control.ts` (read them);
the chief's briefing is built in `lib/chief/briefing.ts` and its copy in
`lib/copy/chief.ts`.

## Design (orchestrator defaults; record deviations)

1. **Three facts, three places.** Runtime state (READY / RUNNING / STOPPED /
   NEEDS INPUT) stays the header chip and means only "can it run its plan".
   Capability: the chat stage and the footer say one of: *Ask it a question*
   (composer shown), *Waiting for your key* (one action: the same adoption
   press MAR-874 puts on Settings — call the identical command; if lane G's
   helper is not merged yet, call the existing agent-row connect command
   directly), *Needs a model provider* (link to Settings → AI), *Built without
   a model* (no action; "Ask the chief about this agent" instead), *Nothing to
   ask about yet* (no saved output; one action: Run). Unmet requirements are
   sentences with the one action that meets them; never a generic error.
2. **Chief entry.** Where direct chat is unavailable, the button reads *Ask
   the chief about this agent* and opens the fleet composer with this agent
   in context; the chief's briefing for that turn carries the agent's ask
   availability, the exact reason id, and the same recovery sentence the page
   shows, so the chief's answer points to the same place (test: for each
   blocked reason, the briefing contains the page's recovery sentence).
3. **No gate loosening.** `lib/views/ask.ts` keeps its order and its refusals;
   you may enrich `describeUnavailable`'s output (reason id + recovery action
   descriptor) and add copy, not change what is refused. `electron/ask-host.ts`
   untouched. Broker untouched.
4. **States to cover in tests** (view-level, fixture agents): non-chat agent
   (no connection declared), declares + no key + fleet key exists,
   declares + no key + no fleet, provider key expired/lapsed (use the lapse
   view the broker already exposes), stopped agent with saved output, fully
   configured. Each yields a `(header, footer_sentence, action, chief_line)`
   tuple asserted by value.

## Ownership (write)

`app/_components/{agent-header,ask,agent-stage}.tsx` (ask: the composer
shell only — not the panel/outputs), the `chat:` stage entry and the footer
in `app/agents/detail/page.tsx`, `lib/views/ask.ts` (enrichment only),
`lib/views/agent-checklist.ts`, `lib/views/agent-control.ts`,
`lib/copy/ask.ts` (or wherever `describeUnavailable`'s copy lives — find it),
`lib/copy/chief.ts`, `lib/chief/briefing.ts`, and tests:
`tests/ask*.test.ts(x)`, `tests/agent-checklist.test.ts`,
`tests/agent-control*.test.ts`, `tests/chief-briefing*.test.ts`,
`tests/agent-cockpit-render.test.tsx` (header/footer expectations only),
plus new. `app/globals.css`: append-only block. NOT: settings components,
outputs/panel/digest, `electron/**`, `lib/broker/**`, `lib/fleet/**`.

## Verification / evidence

Typecheck, focused tests, `pnpm test` once. `electron/capture-ask.ts` exists
— extend it with the blocked states from a scratch store and shoot frames
under `qa-screenshots-mar-878/` (scratch `DASH_DATA_DIR`, `DASH_CAPTURE_DIR`,
`--user-data-dir`). Evidence class: fixture tests + scratch frames. The real
question on the installed build after adoption is the orchestrator's.

Stop condition: PR open (`feat(mar-878): readiness, chat capability and
recovery agree across page and chief`), tests green,
`docs/mar-878b-handoff.md` written.
