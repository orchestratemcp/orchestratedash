# Lane I — MAR-879: unify agent onboarding and improve everyday readability (UX-6)

Tier: Opus (cross-surface copy and typography with a brand to preserve; three
entry paths converging on one import). Read `ux-lanes-common.md` first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux879-s1`
Branch: `000henrik/mar-879-onboarding-readability` — branched from
`origin/master` AFTER MAR-875 and MAR-877 merged (the orchestrator tells you
the base SHA at dispatch). Your PR targets `master`.
Issue: MAR-879 (https://linear.app/martini-home/issue/MAR-879):

> Add agent currently leads with folder selection; building is hidden behind
> terminal instructions. Offer Try a sample, Build with an assistant and
> Import an agent from Agents, converging on existing import/consent/first-run.
> Preserve canonical sample and deep links. After import show missing
> requirements and one next action. Standardize Results/Sources/Activity/
> Connections/Channels/Servers. Shorten repeated reassurance, hide precise
> IDs behind details, keep decision-relevant permission and verification
> information. Preserve avatars/brand; improve report/chat body typography,
> width and action readability. Audit baseline had 80% UI scale; verify at
> 100% too and do not silently change user settings. Avoid generic redesign
> and new unsupported connectors. Acceptance: all three entry paths
> demonstrated without terminal instructions inside DASH; beginner can
> identify result and next action. Keyboard/screen-reader labels; long and
> empty content; normal/narrow windows; 80% and 100% scale; both themes.

## Facts (orchestrator-verified)

Agents page `app/page.tsx` (`TryTheScout` :263 with the sentence "Choose
**Try a sample agent** from the menu button" :310); *Add agent* is a link in
`app/_components/fleet-rail.tsx:42` to `/settings/add-agent`, whose page
(`app/settings/add-agent/page.tsx`) is `AddAgentForm` + `ChooseFolder` with
copy in `lib/copy/add-agent.ts`. The sample is a menu action
(`lib/shell/menu.ts:59` "Try a sample agent…", `electron/sample-agent.ts`,
`lib/sample-agent.ts`) — `tests/menu.test.ts:25` pins the label and
`tests/brand-surfaces.test.tsx:257` pins `SAMPLE_AGENT_SEED === SAMPLE_AGENT_ID`.
Deep links: `lib/open-link.ts`, `lib/shell/deep-link.ts`, `lib/handoff*.ts`.
The builder is the DASH MCP plugin in `tools/dash-mcp/` (ADR 0032); it runs
in a coding assistant, not in DASH — "Build with an assistant" in DASH is an
explanation + copyable one-line setup + the handoff/deep-link that brings
the built agent back (`dash://handoff`, `agent-kit/open-in-dash.ts`), not
an in-app builder. Bit-Command is the adopted design system (deep navy,
electric blue, zero corners; bundled OFL fonts) — no generic redesign.
`.visually-hidden` clips itself (a `widest_overflow` of 150 in captures is
not a defect). Buttons render uppercase globally; `.chip` is the escape.

## Design (orchestrator defaults; record deviations)

1. **Add agent** on the Agents page becomes a three-way choice (a menu or a
   small chooser panel): *Try a sample agent* (fires the same command the
   menu fires — one code path), *Build with an assistant* (opens
   `/settings/add-agent?path=assistant`: what it is, the one-line install
   for Claude Code / Codex, and "when it's built, it opens here by itself" —
   the deep-link/handoff path; no terminal steps beyond that one line, and
   that line is copyable, not typed), *Import an agent folder* (today's
   chooser). All three converge on the existing import → consent → first
   manual run controls. After import: the agent page's landing shows missing
   requirements (from `connection_requirements`) and exactly one next action.
2. **Vocabulary**: Results / Sources / Activity (per MAR-875) / Connections /
   Channels / Servers as the section nouns everywhere; write the map into a
   small `lib/copy/nouns.ts` with a test that greps the copy modules for the
   retired synonyms (e.g. "Generated assets", "Remote machines",
   "Notifications" where Channels is meant) so drift is caught. Coordinate:
   if MAR-875's merged copy already renamed "Generated assets", follow it.
3. **Readability**: report and chat body text — larger measure-aware body
   size, a max line width (~70ch) for prose, more line-height for the brief
   and chief answers; monospace stays for identifiers and code only. Do it
   with tokens appended to `app/globals.css` (append-only block) scoped to
   `.brief-body`, `.digest-*`, `.chat-*` prose classes — not by changing
   `app/tokens.css` or the user's UI-scale preference. Verify at 80% and
   100% UI scale (the preference in Settings → Preferences) and both themes;
   never change the persisted preference.
4. **Repeated reassurance** ("DASH did not check the claims in it", "Written
   up from everything this agent collected", etc.) appears once per surface,
   not per section; raw ids move behind the developer `<details>`.

## Ownership (write)

`app/page.tsx`, `app/_components/{fleet-rail,add-agent-form,choose-folder}.tsx`,
`app/settings/add-agent/page.tsx`, `lib/copy/{add-agent,recovery,nouns}.ts`,
`lib/shell/menu.ts` only if the sample action is refactored to a shared
command (keep the label), `app/globals.css` append-only, and tests:
`tests/add-agent-render.test.tsx`, `tests/copy-add-agent.test.ts`,
`tests/fleet-view-render.test.tsx`, `tests/menu.test.ts`,
`tests/brand-surfaces.test.tsx`, `tests/record-card.test.tsx`, plus new.
NOT: the agent detail page, settings pages other than add-agent, servers,
`tools/dash-mcp/**` (MAR-876 owns it), `lib/sample-agent.ts` semantics.

## Verification / evidence

Typecheck, focused tests, `pnpm test` once, `pnpm brand:check`.
`electron/capture-add-agent.ts`, `electron/capture-fleet-views.ts`,
`electron/capture-ui-scale.ts` and `electron/capture-text-pass.ts` exist —
run the relevant ones from PowerShell on a scratch store (scratch
`DASH_DATA_DIR`, `DASH_CAPTURE_DIR`, `--user-data-dir`) at 80% and 100%
scale, both themes, 768 and 1280, and put frames under
`qa-screenshots-mar-879/`. Evidence class: fixture tests + scratch frames;
the three-path walk on the installed build is the orchestrator's.

Stop condition: PR open (`feat(mar-879): one Add agent with three paths;
readable reports and chat`), tests green, `docs/mar-879-handoff.md` written.
