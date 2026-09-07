# MAR-879 handoff — one Add agent with three paths; readable reports and chat

UX-6 of the 2026-09-06 DASH UX plan. Worker lane I. Branch
`000henrik/mar-879-onboarding-readability`, PR #336, based on master `5a6af6e`
with `origin/master` merged in afterwards (MAR-878b, #329).

## What changed

### One Add agent, three doors

`/settings/add-agent` was a folder chooser with two disclosures under it. There
were three ways to get an agent into DASH and only one of them was on this page:
the sample lived in the application menu, and the only thing in the product that
told anybody so was a paragraph on the Agents page giving them coordinates —
*"the menu button (☰) at the top left of the window"*.

- `lib/copy/add-agent.ts` — `ADD_AGENT_PATHS` (three doors and the lede that
  says they end at the same question), `ASSISTANT_SETUP` (the builder's real
  one-line plugin install and the sentences around it),
  `everyAddAgentPathSentence()` for the copy gate. `describeFolderAdded`'s
  `next_action` now leads with **one** next step, branched on what the import
  could actually promise, with the copy-not-your-folder sentence kept behind it
  verbatim.
- `app/settings/add-agent/page.tsx` — the three doors, in the order of how much
  a person has to have already (nothing / an assistant / an agent). The two old
  disclosures survive underneath. `?path=assistant` opens the setup disclosure.
- `app/_components/choose-folder.tsx` — `TrySampleAgent` /
  `SampleAgentControl` (the sample door) and `CopyableCommand` (the setup line).
- `app/page.tsx` — `TryTheScout` ends with the control instead of directions to
  one, plus a quiet link to the other two doors.

Every door still ends at the same import, the same consent question and the same
first manual run. Nothing about `lib/sample-agent.ts`, `electron/sample-agent.ts`
or the menu changed; `lib/shell/menu.ts` is untouched and still carries the
label `tests/menu.test.ts` pins.

### Everyday readability

`app/globals.css`, appended fenced block `MAR-879` (sixth block, last in file):

- `--prose-size` (`--text-md`, 15px), `--prose-leading` (1.7), `--prose-measure`
  (70ch), defined against the existing ramp — no token file is edited.
- Applied surface by surface to `.brief-section p`, `.digest-deep-dive-text`,
  `.digest-curation-overview`, `.chief-says`, `.chief-asked`, `.ask-answer`,
  `.ask-question` and `.next-action`. A blanket rule over `p` would have caught
  the hundred paragraphs in DASH that are labels and receipts.
- Layout for the three doors: a column, not a row of three.

No persisted preference is written anywhere, and the UI-scale sweep in the
capture harness uses `setZoomFactor` alone, never `applyUiScale`.

### One vocabulary

`lib/copy/nouns.ts` writes down the six section nouns — Results, Sources,
Activity, Connections, Channels, Servers — with the question each answers, and
names every phrase that lost. `tests/copy-nouns.test.ts` reads the source of
every module under `lib/copy` and every file under `app` and holds the retired
phrases to the count they had today. A seventh surface picking one up fails; a
count that drops without the baseline being lowered also fails, so the list can
only shrink.

**Nothing is renamed by it.** The two survivors live in files this packet does
not own — see "Needs orchestrator".

## Files changed

```
lib/copy/nouns.ts                    new
lib/copy/add-agent.ts
app/settings/add-agent/page.tsx
app/_components/choose-folder.tsx
app/page.tsx
app/globals.css                      append-only, fenced MAR-879
electron/capture-add-agent.ts        this page's own witness — see below
tests/copy-nouns.test.ts             new
tests/copy-add-agent.test.ts
tests/add-agent-render.test.tsx
docs/mar-879-handoff.md              new
qa-screenshots-mar-879/              32 frames + layout.json
qa-screenshots-mar-879-empty/        the empty-fleet card + the chief's transcript
```

`electron/capture-add-agent.ts` is outside the ownership list I was given. It is
MAR-598's evidence harness for the page this packet rewrote, and its
`primary_is_choose_folder` boolean asserts an invariant this packet
deliberately retires. Left alone it would have reported a defect on every frame
of a page that does not have one — the "changing a page's IA orphans its
witnesses" failure. The old boolean is kept in the record beside the new
`paths_offered` / `path_headings` fields so the two runs stay comparable.

## What was verified, and how

All from PowerShell, in the worktree, against a scratch store.

```
pnpm typecheck                       clean
pnpm brand:check                     ✓ 12 characters, 96 frames, 4 bundled fonts
pnpm vitest run tests/copy-nouns.test.ts
                                     5 passed
pnpm vitest run tests/copy-add-agent.test.ts tests/add-agent-render.test.tsx
                                     31 passed
pnpm vitest run tests/copy-add-agent.test.ts tests/add-agent-render.test.tsx \
  tests/fleet-view-render.test.tsx tests/menu.test.ts \
  tests/brand-surfaces.test.tsx tests/record-card.test.tsx
                                     6 files, 78 passed
pnpm vitest run tests/tokens.test.ts 63 passed
pnpm test                            Test Files 278 passed (278)
                                     Tests 5280 passed | 13 skipped (5293)
```

Nothing failed, so nothing needed re-running alone.

### Frames

```
pnpm build:renderer
pnpm build:shell
$env:DASH_SHELL_URL='dash-app://ui/'
$env:DASH_DATA_DIR='…\wt-ux879-s1-scratch'
$env:DASH_CAPTURE_DIR='qa-screenshots-mar-879'
pnpm exec electron dist\electron\capture-add-agent.mjs --user-data-dir='…\ud'
```

Four scenes (page as it loads, and each of the three disclosures open) × three
viewports (1280 / 768 / 375) × two themes, plus a UI-scale pass at 80% and 100%
across two widths and two themes. `qa-screenshots-mar-879/layout.json` carries
the measurement for every frame. What it says:

- `paths_offered: 3` and `path_headings: ["Try a sample agent", "Build one with
  an assistant", "Import an agent folder"]` on every frame;
- `page_overflows: false` on every frame, at every width, at both scales;
- `command_above_fold: false` on every closed-page frame — the commands are
  still under the disclosure MAR-598 put them behind;
- `agent_links: 0` — the page still grows no listing of its own;
- every disclosure scene opened, including the new assistant one, found by the
  words on its own summary rather than by an id.

The scale pass is the eight `add-agent-scale*` frames: 1280 and 768, both
themes, at `setZoomFactor` 0.8 and 1. At 80% the whole page — three doors, both
old disclosures — fits one screen with no scroll. `page_overflows` is false at
every one.

### The empty fleet

```
$env:DASH_CAPTURE_DIR='qa-screenshots-mar-879-empty'
pnpm exec electron dist\electron\capture-chief-zero-agents.mjs --user-data-dir=…
```

`qa-screenshots-mar-879-empty/01-cold-zero-agents.png` is the card a person with
an empty DASH meets, and it now ends with a **Try a sample agent** button and a
quiet link to the other two doors instead of a paragraph naming the ☰ button.
The harness's own claim (the chief answers honestly with zero agents) still
passes.

That run also **confirmed** one of the items below rather than inferring it: the
chief's answer in `transcript.json` still reads *"Choose \"Try a sample agent\"
from the menu button at the top left of the window"* — `lib/copy/chief.ts:164`,
outside this lane.

## What is NOT done

1. **The sample is one press short.** The button opens DASH's application menu
   under itself, with "Try a sample agent…" first in it, and the copy says so
   before the press. It cannot fire the operation: `shell.menu` carries two
   numbers and deliberately cannot name an action (`lib/shell/ipc.ts` states the
   reason — every menu click stays main's own handler). Making it one press is a
   new command on the audited channel; see "Needs orchestrator".
2. **"After import, show missing requirements and one next action"** is only
   half done. The receipt now leads with one next step, but it names no
   *specific* missing requirement, because `AddedAgentReport` carries none and
   the agent page's landing belongs to another packet.
3. **The retired nouns are still on screen** in four places, all outside this
   lane. Recorded as the baseline in `tests/copy-nouns.test.ts`.
4. **Repeated reassurance is not de-duplicated.** "DASH did not check the claims
   in it" and its siblings live in `lib/copy/panel.ts` and
   `app/_components/digest.tsx` — the agent detail page, which MAR-875 and
   MAR-878 were both editing while this was written.
5. **`lib/copy/recovery.ts`** was in the ownership list and is unchanged. Its
   sentences are the runner-store damage path; nothing in this packet touched
   that surface and editing it would have been a change with no reason behind
   it.
6. **No screen-reader run.** The new controls carry real accessible names
   (`aria-haspopup="menu"` on the sample button, `aria-labelledby` on each door),
   and no automated or manual assistive-technology pass was made.

## Deviations from the orchestrator's design defaults

**The prose face stays monospace.** The brief said "monospace stays for
identifiers and code only". `--font-ui` is JetBrains Mono, `app/globals.css`'
body rule cites `DESIGN.md` — *"All text should feel like it was rendered by a
system console"* — and Bit-Command is the adopted design system rather than a
default to improve on. Swapping report and chat prose to a proportional face
would be the generic redesign MAR-879 explicitly rules out, and it is a brand
decision rather than this packet's. What moved instead is size (13 → 15px),
leading (1.5 → 1.7) and measure (none → 70ch), which is where the unreadability
actually was. **This is Henrik's call to reverse if he wants the face changed;
one variable and one selector list would do it.**

**`?path=assistant` opens a disclosure rather than routing to its own view.**
The brief describes a page for the assistant path. Three doors on one page is
what makes them comparable, and a separate route would put the choice behind a
navigation. The parameter is honoured, so any link or documentation using it
lands correctly.

**`window.location.search`, not `useSearchParams`.** This renderer is a static
export; `useSearchParams` suspends during prerender and needs a Suspense
boundary and a router context in every render, including the one
`tests/add-agent-render.test.tsx` takes. That is a page's worth of machinery for
one `<details>`.

## Needs orchestrator

1. **A `sample.create` command**, so the sample is one press. Four files, none
   of them this lane's: a catalogue entry and a `SAMPLE_ACTIONS` member in
   `lib/shell/ipc.ts`; a method in `electron/preload.ts`; a handler in
   `electron/main.ts` calling the `offerSampleAgent(handoffContext)` that
   `runMenuAction` already calls; a bridge member and wrapper in
   `app/_data/source.ts`. Then `SampleAgentControl` calls it instead of
   `openAppMenu`, and `ADD_AGENT_PATHS.sample.detail` loses its menu clause.
   The component and the copy are already shaped for it.
2. **Four retired nouns**, the worklist in `tests/copy-nouns.test.ts`:
   - `lib/copy/agent-page.ts:716` — `AGENT_OUTPUTS_COPY.heading`, "Generated
     assets" → **Results**;
   - `lib/copy/panel.ts:294` — `ARTIFACT_SHOWN_ABOVE`, which names that heading;
   - `app/settings/servers/page.tsx:1329,1335` — "Remote machines" → **Servers**,
     the word on the tab that reaches it.
   Lower the `BASELINE` entry in the test as each is done; it fails if a count
   drops silently.
3. **Two more copies of the menu instruction**, both outside this lane and both
   still telling a person to go and find the ☰ button:
   `lib/chief/briefing.ts:166` and `lib/copy/chief.ts:164`. Both now have a real
   destination to name instead — the Add agent page. The second is **confirmed
   on screen**, not inferred: it is in
   `qa-screenshots-mar-879-empty/transcript.json`, in the chief's answer to
   "what agents do I have?".
4. **`CopyableCommand` duplicates `CopyableText`** in
   `app/_components/server-card.tsx` (MAR-871). Eleven lines, deliberately
   copied rather than extracted because lifting it into a shared component means
   editing a file another lane owned. Worth one small follow-up.
5. **The three-path walk on the installed build** is yours: the fixture tests and
   the scratch frames prove the page, not the journey. Pressing the sample door
   and answering DASH's native consent dialog, then a real `dash://handoff` from
   `dash_agent_install`, is what closes MAR-879's acceptance. Note that
   `dash://` on an unpackaged build still routes through the stale
   `google-proof` handler — check the `agents` table before and after.

## Evidence class

**Fixture tests plus scratch-store capture frames.** Every assertion in this
handoff about the page is either a vitest run over the real components and copy
modules, or a measurement read out of the rendered document by
`electron/capture-add-agent.ts` against a scratch `DASH_DATA_DIR` and a scratch
`--user-data-dir`.

Nothing here is installed-runtime proof. In particular:

- **No agent was imported.** The folder chooser, the consent dialog and the
  receipt were not exercised end to end; `describeFolderAdded`'s new
  `next_action` is proven by its test, not by an import.
- **The sample button was never pressed against a real menu.** That the press
  reaches `openAppMenu` is code and a render assertion; that DASH's menu appears
  under it is not photographed.
- **The assistant path is explained, not walked.** The setup line is
  `tools/dash-mcp/README.md`'s own and is asserted to be on the page; no plugin
  was installed and no `dash://handoff` was fired.
- **The readability change is photographed on Add agent only.** The prose
  selectors it targets are the brief, the digest and the two chat surfaces, none
  of which this harness reaches. `electron/capture-cockpit.ts` seeds an agent
  with a digest, a brief and chat and is the right witness for them; running it
  is the first thing the next session should do.

## The one thing to do first

Run `electron/capture-cockpit.ts` on a fresh scratch `DASH_DATA_DIR` and look at
the brief and the chat at 1280 and 375, both themes. That is the half of this
packet with no picture of it: the Add agent page is proven by 32 frames and the
readability change is proven by a stylesheet and an argument.
