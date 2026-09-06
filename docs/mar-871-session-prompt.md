# Lane D — MAR-871: the server page — one step, one button, one clear "your server is up" (UX-4)

Tier: Opus (state model across wizard, card and page; nine recorded defects to
retire without lying about runtime gaps). Read `ux-lanes-common.md` first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux871-s1`
Branch: `000henrik/mar-871-server-page` (from origin/master 0e52211)
Issue: MAR-871 (https://linear.app/martini-home/issue/MAR-871). Henrik's
verbatim complaint and his proposed shape are in the issue; the UX plan's
UX-4 (read it from the codex branch as the common rules say) extends it. The
scope is approved; implement the proposed shape.

## Facts you must keep true (verified by the orchestrator)

- MAR-865 enrolled and deployed to a real VPS (`root@78.141.221.121`, Vultr).
  Its handoff `docs/mar-865-handoff.md` lists NINE page defects; every one of
  them is in scope here. Read that list first and keep a checklist in the
  handoff mapping defect → fix → test.
- MAR-864: a deployed agent is never *started* on the host (needs an ADR;
  Henrik decides). MAR-872: `at_local` is read against the host's clock.
  Neither is yours. The page must not paper over them with optimistic copy:
  "running" is only said when the host reported it; a schedule on a remote
  host must not be described as if it fires at the local time.
- Distinct facts the card must not conflate: last contact (when DASH last
  heard from it), residency (which agents are on it), running state (what the
  host said is running), last successful job. "Unknown" stays unknown — never
  shown as healthy.
- Windows cannot `ssh-keyscan` (resolved since PR #137); the bootstrap and the
  verbs do not change. No new verbs, no transport change.

## Design (Henrik's proposed shape in the issue, adopted; orchestrator defaults for the rest)

One card, one state, one primary action:
1. **Not set up yet** → single button "Set up this server" opening the recipe
   as numbered steps: open PowerShell; `ssh root@<address>` (pre-filled from
   the record, with a copy button); sign in with the provider's password;
   paste the setup text (copy button); come back and press Check.
2. **Checking** → one sentence, no buttons.
3. **Your server is up** → success styling (not amber), one sentence, ONE
   button "Put an agent here". Nothing else on the card.
4. **With agents on it** → the running-state line from the host's own report,
   one "Check now" (replacing both "Ask the server" and "Check this server"),
   "Restart survival" as one switch with its one honesty sentence (linger on
   /off is the host's answer, not an inference), and "Stop using this server"
   in an overflow. Keys-on-this-server and reboot sections render only when
   they can say something true and actionable.
5. **Unreachable / never checked / stopped / duplicate records**: each a
   distinct state sentence + one action (Check now / Set up again / Merge or
   forget duplicates with the existing confirmation), never mixed.
Copy rule: every sentence on the card is one the person can act on right now.

Deployment wording: where the page today implies a deploy route that does not
exist, either link to the real route (the agent's Settings → "Put on <server>")
or render nothing — no promises. Preserve remote key-boundary explanations at
the decisions where they matter (behind "Why?" disclosures, not deleted).

## Ownership (write)

`app/settings/servers/page.tsx`, `app/_components/server-card.tsx`,
`lib/host-wizard.ts`, `lib/server-card.ts`, `lib/copy/host.ts`,
`lib/copy/host-pack.ts`, `lib/copy/host-residency.ts`, `lib/copy/bring-home.ts`,
`electron/capture-servers.ts`, and their tests: `tests/host-wizard*.test.ts(x)`,
`tests/server-card*.test.ts(x)`, `tests/copy-host.test.ts`, `tests/host-sighting-render.test.tsx`,
`tests/host-residency*.test.ts`, `tests/deploying.test.ts` if it pins copy you
move. `app/globals.css`: append-only block (the `.server-card` rules at ~:3574
may be *overridden* by your appended block, not edited in place).
`app/_components/deploy.tsx` (the agent page's server section) is NOT yours —
it imports `describeDeployed`/`describeSignIn` from `lib/server-card.ts`; keep
those exports' signatures stable, or add new functions and leave the old ones.
`electron/smoke.ts`: if a proof pins server-card copy you changed, update that
proof's expectation only (state which).

## Verification / evidence

Typecheck, focused tests, `pnpm test` once. `electron/capture-servers.ts`
photographs `.server-card` states from a scratch store — run it from
PowerShell with scratch `DASH_DATA_DIR`, `DASH_CAPTURE_DIR` and
`--user-data-dir`, after `pnpm build:renderer; pnpm build:shell` in your
worktree; extend its scenes to the six states above so each is a frame; put
frames under `qa-screenshots-mar-871/`. Evidence class: fixture tests +
scratch-store frames. The issue's proof line (a person who has never seen
DASH enrols a fresh server unaided) is attended and owner-run; you cannot do
it — say so.

Stop condition: PR open, tests green, `docs/mar-871-handoff.md` written with
the nine-defect checklist.
