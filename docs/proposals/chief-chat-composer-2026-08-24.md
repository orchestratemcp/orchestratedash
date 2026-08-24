# The chief's composer, to the Claude Code standard — a proposal

**MAR-742, roadmap item 1.** Henrik, 2026-08-24, with a side-by-side screenshot:
*"Again your chat and layout and functions are the model. Very nice! Can you
mimic it please."* Named as visible in his comparison: **a compact model
dropdown** (not the boxed SWAP row), **attachment/context chips above the
composer**, and **tighter overall composer geometry**.

This document is a **proposal and nothing else**. The branch it lands on
(`design/chat-ui-proposal`) changes no product code: it carries the captures
under `qa-screenshots-chatui-proposal/` and this file. Every figure describing
**what exists today** is measured off those captures — from
`current-chief-geometry/layout.json`, the harness's own output, or by scanning
the PNGs themselves. Every figure describing **what is proposed** is arithmetic
on the design tokens, shown so it can be checked, and labelled as such.

## 0. What was captured, and what is missing

Two existing harnesses were run from a fresh worktree at `origin/master`
(3b6c390) — **neither was modified**, this branch touches no product code —
built renderer-first, PowerShell, visible window, unique `--user-data-dir` per
run. Each directory carries the harness's own stdout as `harness-run.log`,
including its self-checks. The third directory is composed from the first two.

| Directory | Harness | What it shows |
| --- | --- | --- |
| `current-chief-geometry/` | `electron/capture-mar615.ts` | the chief's composer collapsed and expanded, 375/768/1280 × light/dark, **plus `layout.json`** — every rectangle below comes from here |
| `current-both-surfaces/` | `electron/capture-ask.ts` | the agent page's Ask composer at three widths, and the four `composer-parity-*` frames that put both surfaces side by side |
| `annotated/` | composed from the two above | `side-by-side-1280.png` — the real capture cropped, above a drawing of the proposal at the same width and scale, with the callouts §3 refers to |

**The frames are curated, and that is stated rather than left to be noticed.**
Both harnesses shoot more than this proposal argues from: `capture-mar615.ts`
also photographs the bottom strip and the per-agent avatar picker, and
`capture-ask.ts` walks five key/model/provider states. Those frames were run —
each `harness-run.log` reports on all of them — and then deleted from this
branch, because a PR carrying 67 PNGs of which 43 support no claim here is
harder to review, not easier. **Both `layout.json` files are complete and
untrimmed**, so every measurement below can still be re-derived. Re-running
either harness reproduces the full set.

**The store in every frame is a scratch directory the harness seeded.** No
model provider was contacted and nobody was charged; the transcript visible in
the expanded frames was written by the harness. That is the standing disclosure
in both harness headers and it applies unchanged here.

**One thing this proposal could not check itself.** The roadmap comment says
Henrik attached a side-by-side screenshot, but **MAR-742 carries no attachment
and the comment body embeds no image** — `get_issue` returns `"attachments":
[]`. So the reference here is the *description* of it in the comment (compact
model dropdown, chips above the composer, tighter geometry) plus Claude Code's
composer as it actually behaves, not the pixels Henrik was pointing at. Where a
decision below turns on something only the screenshot could settle, it is
flagged as an open question in §8 rather than guessed.

Two frames are unusable and are kept in the directory rather than deleted:
`composer-expanded-1280-light` and `composer-expanded-768-dark` report
`composer_is_open: false`. That is the known non-interactive focus flake
(`capture-harness-needs-powershell-and-a-visible-window`) — the field genuinely
has focus, but a window that never became OS-focused dispatches no native
`focus` event, so React's `onFocus` never opens the room. Every width has at
least one good open frame. **No measurement in this document depends on those
two** — §4.3 reads the *collapsed* frames, and all four `composer-parity-*`
frames opened cleanly (`{"focused":true,"open":true}`, four for four).

## 1. Where the composer is today

Both surfaces already render through **one component** — `app/_components/composer.tsx`,
MAR-711 — with a per-surface class table (`.chief-*` / `.ask-*`) and
`tests/composer-shared.test.tsx` enforcing that every chrome rule in
`app/globals.css` is a *combined* selector. **That is the good news, and it is
what makes this proposal small:** the shape below is one component's markup, one
stylesheet's combined rules, and one test's `CHROME_PARTS` list — not two
surfaces to keep in step by hand.

What that component draws today, top to bottom, is **four stacked full-width
rows**:

```
  ┌ .chief-room ─────────────────────────────┐   (absolute, above; opens on focus)
  └──────────────────────────────────────────┘
    Ask the chief about your fleet               ← .chief-subject   a full sentence, its own line
  ╭──────────────────────────────────────────╮
  │ What needs me? Or: who reads the news?   │   ← .chief-input     rounded field
  │ Press Enter to ask.                    ↵ │
  ╰──────────────────────────────────────────╯
    The chief's own model: claude-opus-5  SWAP  ← .chief-model-line sentence + button
                                                  (SWAP opens .chief-model-picker,
                                                   a third full-width row: select +
                                                   "See what OpenRouter offers" + "Done")
    5 decisions recorded — see the log           ← app/page.tsx, a separate <p> under the fleet
```

Measured, in CSS px (`layout.json`; the PNGs are 2× DPI):

| Width | Viewport reports | Field box | Field height | Room |
| --- | --- | --- | --- | --- |
| 1280 | 1279 | x 264, w 751 | **48** | w 751, `max-height: min(24rem, 100vh − 10rem)` |
| 768 | 767 | x 63, w 680 | **48** | w 680, same |
| 375 | 374 | x 55, w 303 | **65** | w 303, same |

Four things those numbers say that the pictures alone do not:

1. **At 375 the field is 65px, not 48.** The placeholder is 58 characters and
   wraps to two lines in 303px. Nothing else on the composer grew — the copy
   did.
2. **At 375 the composer's stack is 150px of an 812px viewport** before the room
   opens — subject line, 65px field, model line, decisions link — against
   134.5px at both wider sizes (§4.3 has the measurements and how they were
   taken). `composer-collapsed-375-light.png` shows the cost: exactly one agent
   card is visible above it, cropped.
3. **The room is already well-behaved.** `max-height: min(24rem, calc(100vh -
   10rem))` with the head pinned (`flex: none`, MAR-706) and only
   `.chief-room-scroll` scrolling. It measured 384px in every frame because the
   seeded transcript overflows it, not because it is a fixed box. **No change is
   proposed to the room.**
4. **The margins are not symmetric at 768** — x 63 on the left, 24 on the right.
   That is the page's rail, not the composer, and it is out of this proposal's
   scope; noted so the next reader does not re-measure it.

The agent surface (`.ask-*`) is the same chrome with a different footer: `Asking
under `<code>`gpt-4o-mini`</code>` and a **"Change in Settings"** link out to the
agent's settings stage — no inline picker.

## 2. The reference, and what "mimic it" actually asks for

Claude Code's composer, structurally:

- one bordered field, and **no submit button** — the key is the affordance;
- **context above** the field, as small dismissible chips (what will be sent
  along with the message);
- **one compact status line below** the field carrying the model as a small
  dropdown-shaped control, plus key hints — not a sentence, not a boxed panel;
- **tight rhythm**: the chrome around the field is two short rows, not four
  full-width ones.

Henrik's three named deltas map onto that one-for-one, and all three are the
*same* delta seen from three sides: **DASH spends a full-width row on each fact
where the reference spends a chip.**

## 3. Side by side, annotated

`annotated/side-by-side-1280.png` puts the current chief composer (cropped from
`current-chief-geometry/composer-collapsed-1280-dark.png`) above the proposed
arrangement at the same width and scale. The callouts:

| # | Today | Proposed |
| --- | --- | --- |
| 1 | `.chief-subject` — "Ask the chief about your fleet", a full sentence on a line of its own | becomes the **first chip** in the row above the field: `FLEET · 5 AGENTS` |
| 2 | placeholder carries two examples **and** "Press Enter to ask." — 58 chars, wraps at 375 | examples only; the send hint moves to the footer row as `↵ TO ASK` |
| 3 | `.chief-model-line` — a sentence, then a **SWAP** button that opens a third full-width row | one **model chip**: `MODEL claude-opus-5 ▾`, opening an anchored popover |
| 4 | `5 decisions recorded — see the log` — a full-width link under the fleet, in `app/page.tsx` | a chip in the row above the field: `5 DECISIONS`, same destination |
| 5 | four stacked rows — measured 134.5px at 1280/768, 150px at 375 | two short rows around the field — ~100px, arithmetic in §4.3 |

## 4. The spec

### 4.1 The model control

**It becomes a chip that opens an anchored popover.** The chip is built from
vocabulary `app/globals.css` already ships, which is why it survives the
forced-caps rule without a fight:

```html
<button class="chip chip-model" aria-haspopup="dialog" aria-expanded="false"
        title="The chief's own model. Changing it here does not move the fleet default.">
  <span>Model</span> <span class="value">claude-opus-5</span> <span aria-hidden="true">▾</span>
</button>
```

- `.chip` is `--text-xs`, `4px 8px` padding, 1px `currentColor` border,
  `text-transform: uppercase`. It **beats the global `button` rule on
  specificity** (0-1-0 against 0-0-1), so the chip does not inherit the 8/16px
  button padding — this is the whole reason a compact control is possible here
  at all.
- `.chip .value` sets `text-transform: none; letter-spacing: 0; font-weight:
  400`. **The model id keeps its own case.** That rule exists for the masked
  credential hint and its docblock argues exactly the principle that applies
  here: *caps are typography for DASH's own vocabulary; anything that came from
  a provider keeps its own case.* `CLAUDE-OPUS-5` would be DASH restating a
  provider's identifier wrongly.
- The label word — `Model` — is DASH's vocabulary and is meant to shout.
  One short word, no long-label problem at any width.

**The fact the current sentence carries and the chip must not lose.** Today the
copy distinguishes *"The chief's own model:"* from *"Asking under DASH's fleet
default:"* (ADR 0023 amendment 1: `chief_model_choice` is read before
`fleet_model_default`). Moving that into a `title` alone would be the trap this
repository has hit before: hidden text is still in the markup, so the copy gate
stays green while the reader loses the fact. So: **when the model is inherited
rather than pinned, a
second chip appears beside it**, `.chip.chip-muted` reading `FLEET DEFAULT`.
Present only in the inherited case, absent in the ordinary one, and the
distinction is on screen rather than in an attribute.

**The popover** keeps `ChiefModelPicker`'s logic byte-for-byte — fetch on press,
never on mount (a panel that listed a provider's catalogue on every focus would
contact a third party on every focus), scoped to the provider already in force,
`setChiefModel` unchanged. What changes is only its **container**: from
`flex-basis: 100%` in the composer's flow — a third full-width row that pushes
everything below it — to `position: absolute; bottom: 100%` anchored to the
chip, opening upward, the same direction the room already opens, with its three
controls stacked. Escape closes it; so does a click outside; choosing a model
closes it.

**On the agent surface the same chip is a link, not a button.** It goes where
"Change in Settings" goes today — the agent's settings stage — because an inline
cross-agent picker is a different decision and not this packet's. The *chrome*
is shared and test-enforced; the *behaviour* is per-surface, exactly as
`modelLine` is a per-surface `ReactNode` today. That is the one-card-N-tracks
discipline applied: one component, one combined rule per part, N behaviours.

**When there is no model at all**, today's `No model set yet. Set one in
Settings` sentence becomes one chip: `.chip.chip-warn` reading `NO MODEL`,
linking to `/settings/ai`, with the full sentence as its `title`.

### 4.2 The chip row — what exists and what each carries

A `.chips` row (`display: flex; flex-wrap: wrap; gap: 4px` — already in the
stylesheet) **above** the field, matching the reference's placement. Every chip
below is a fact DASH already computes. **No chip here needs a chief capability
that does not exist**, which is the line MAR-744 owns and this proposal does not
cross.

| Chip | Carries | Source, already in the client | Surface |
| --- | --- | --- | --- |
| scope | `FLEET · 5 AGENTS` / on an agent page, that agent's title | `agents` prop (chief) / `describeChatSubject(agentTitle)` (agent) | both |
| decisions | `5 DECISIONS`, links `/decisions` | `FleetView.decisions.total` | chief only |
| no-model | `NO MODEL`, links `/settings/ai`, `.chip-warn` | `ChiefRoomView.model_id === null` | both |

**What is deliberately not here: attachments.** Henrik's words were
"attachment/context chips", and a chip carrying a file the user attached is a
new chief capability — reading something DASH did not put there. That is
MAR-744's lane and this proposal stays out of it. What this buys instead is the
**mechanism**: once the chief can accept an attached artifact, it arrives in a
row that already exists, already wraps, already has a vocabulary — no new
chrome, no second design pass. Naming the row now is the cheap half of the
feature.

### 4.3 Geometry at 375 / 768 / 1280

**Today, measured off the captures** — not estimated. Each figure is the ink-top
of the subject line to the ink-bottom of the row named, read straight out of
`composer-collapsed-*-dark.png` by scanning pixel rows inside the composer's own
column (the perched O is excluded by restricting the scan to the left of it):

| Width | Subject → model line (the composer itself) | Subject → decisions link | Field |
| --- | --- | --- | --- |
| 1280 | **96.5px** | **134.5px** | 48px |
| 768 | **96px** | **134.5px** | 48px |
| 375 | **113px** | **150px** | **65px** |

Proposed, by arithmetic on the tokens (chip = `4px 8px` padding around
`--text-xs`/`--leading-tight` ≈ 20px; `--space-1` = 4px; grid `gap` =
`--space-2` = 8px):

```
chip row 20 + 4 + field 48 + gap 8 + model chip row 20  =  ~100px
```

| Width | Today (incl. decisions link) | Proposed | Delta |
| --- | --- | --- | --- |
| 1280 | 134.5px | ~100px | **−35px** |
| 768 | 134.5px | ~100px | **−35px** |
| 375 | 150px | ~100px one chip line / ~124px if the chips wrap | **−50px to −26px** |

**Three honest notes about that table.**

1. **At 1280 the composer proper does not get shorter — it gets ~3px taller**
   (96.5 → ~100). A chip row is a hair taller than a text line. *Every pixel of
   the −35px comes from absorbing the decisions link* (§4.5). If the
   orchestrator drops §4.5, the 1280 and 768 saving goes to roughly zero and
   this proposal's case rests entirely on structure — four rows to parse
   becoming two — and on 375.
2. **At 375 the saving is real and it is mostly the copy change.** The field
   returns from 65px to 48px because the placeholder stops wrapping, and that
   costs exactly one string (§4.4).
3. **The largest win is not in this table at all**, because the seed these
   frames were shot against has no model, so the SWAP control never renders and
   the picker could not be photographed open. Derived from the rule rather than
   measured, and labelled as derived: `.chief-model-picker` is `flex-basis:
   100%` **in the composer's flow**, carrying a `<select>`, a "See what
   OpenRouter offers" button and a "Done" button. At 1280 those fit one ~36px
   row; at 375 they wrap to three, ≈116px — inserted below the field, pushing
   everything under it down, every time somebody opens it. The anchored popover
   costs zero flow height at every width. **A capture of that state is the first
   thing the packet should shoot**, against a seed that has a model.

Rules, stated as the packet would write them:

- Chip row: `.chief-composer-chips, .ask-composer-chips` — one combined
  selector, `display: flex; flex-wrap: wrap; gap: var(--space-1)`.
- At 375 the row wraps rather than truncating. **No `overflow: hidden`, no `+N`
  overflow chip.** A chip that hides itself at the width where screen space is
  scarcest is a chip nobody can act on, and this system's own rule is that
  unfindable is the same as missing.
- The model chip's popover is `max-width: 100%` and anchored `left: 0` at 375
  rather than to the chip, so a 303px-wide composer never draws a panel off the
  right edge.
- Nothing here touches `.chief-room` — §1, point 3.
- Nothing here touches the perched `.chief-composer-o`. Its `translateY(-84%)`
  is verified at `overlap_past_padding: -4` in this run's own `layout.json` at
  375, which is the number `capture-mar615.ts` exists to refuse. A composer
  restyle that moved the field must re-read it; this one does not move the
  field.

### 4.4 Copy changes, exactly

Two strings in `lib/copy/chief-chat.ts`:

```
placeholder:  "What needs me? Or: who reads the news? Press Enter to ask."
           →  "What needs me? Or: who reads the news?"
```

The trailing clause was load-bearing when it was written — MAR-696 removed the
submit button, and that clause was the only thing left saying how to send.
**It is replaced, not deleted:** the footer row gains a muted `↵ TO ASK` hint at
its right end, always drawn, which is where the reference puts its key hints and
where the `↵` glyph already sits. The hint is chrome, so it lives in
`composer.tsx` and is stated once for both surfaces.

```
label:  "Ask the chief about your fleet"   (the .chief-subject line)
     →  stays the composer's accessible name; the visible half becomes the
        scope chip's text
```

`label` is `.chief-subject`'s visible text *and* the composer's accessible name.
MAR-659 deliberately made it visible rather than `visually-hidden`. **The chip
keeps it visible** — this is a compaction, not a removal, and the packet must
prove that with a render assertion rather than a claim.

### 4.5 The "8 decisions recorded" link

(The count is whatever the store holds — 8 on Henrik's machine, 5 in the seeded
frames here. The copy already branches on singular.)

Today: a full-width `<p class="fleet-decisions-note">` with a `<Link
href="/decisions">` in `app/page.tsx`, mounted outside the agents-length branch
so an emptied fleet with history keeps its way in. It is MAR-679's *interim*
fix — the log used to be a five-screen section stacked under the fleet, and
Henrik's *"the fleet view is so cluttered now I can't even see the fleet"* is
what moved it.

**It becomes a chip in the composer's chip row**: `5 DECISIONS`, `.chip
.chip-link`, same `/decisions` destination, the full sentence as `title`, and
the singular/plural split preserved.

Three things the packet must handle, and they are the reason this is the
riskiest item here:

1. **It changes the page's IA**, and changing a page's IA orphans its
   witnesses. Whatever asserts on that `<p>` today — a copy gate, a render
   test, a capture scene reading the fleet page — must be found and moved, not
   left passing against markup that no longer exists in that position.
2. **It moves a fleet-page fact into a shared component.** The chief's composer
   would draw something the agent's does not. That is legitimate — the chip row
   is per-surface content — but it means `FleetView.decisions.total` has to
   reach `ChiefChat`, which today receives `view: ChiefRoomView`, not the fleet
   view. `FleetList` has both. One prop, passed down.
3. **MAR-679 owns the final answer**, not this packet. Its next slice is
   indicator-on-the-card with popups on interaction. A chip is closer to that
   destination than a full-width link is, and it is reversible. If the
   orchestrator would rather leave the link exactly where it is until MAR-679
   lands, **drop this item and the rest of the proposal is unaffected** — it is
   the only item here that touches a file outside the composer.

### 4.6 Keyboard

Everything today already does, unchanged, and stated so the packet does not
regress it: **Enter** sends and **Shift+Enter** is a newline (`sendsOnEnter`,
pure and tested because no test here can press a key); **Escape** closes the
room from anywhere in it, bound to `document` rather than the textarea, because
a person reading a turn has not necessarily left focus in the field; **focus**
on the field opens the room; **a send in flight disables the field** and refuses
Enter before `onSubmit` is reached (MAR-746 — measured at 7ms against 2018ms).
None of that moves.

Three additions, all of which need only what the client already holds:

1. **`↑` recalls the previous question.** On an empty field, `↑` fills it with
   the last question from `view.turns` — which is already in the client, already
   oldest-first, already keyed by a monotonic `id`. Repeated `↑` walks back;
   `↓` walks forward; `Escape` restores the draft that was there before the
   first `↑` and does **not** close the room on that press. On a non-empty
   field `↑` is an ordinary caret move — a recall that ate somebody's half-typed
   question would be the MAR-746 defect in another costume.
2. **Escape returns focus to the field.** Today `onClose` closes the room and
   leaves focus wherever it was; a person who pressed Escape while reading a
   turn has to click back into the field to type. One line, same reasoning as
   MAR-746's conditional focus restore.
3. **The popover traps nothing.** Escape closes it and returns focus to the
   model chip. It is `aria-haspopup="dialog"`/`aria-expanded`, not a listbox —
   it contains a select, a fetch button and a done button, which is not a
   listbox's contract.

Deliberately **not** added: `/` for commands and `@` for mentions. §5.

## 5. What I would not copy, and why

1. **`/` slash commands and `@` mentions.** They need a command surface and a
   namespace to mention *into*. The chief's tool surface is the declared command
   set and nothing constructed (MAR-742's own injection posture, inherited from
   MAR-419), and building a typed command grammar over it is MAR-744's lane, not
   a design packet's. Copying the affordance without the substrate would ship a
   `/` that opens an empty menu.
2. **File and image attachment.** New chief capability. §4.2.
3. **Token-by-token streaming and any typing animation.** Refused on this
   surface already and correctly: `ChiefActivity`'s own docblock argues it — the
   bridge is `invoke`-only, so a question is one awaited round trip and a
   component animating through step names *"would be reciting a script — right
   about the order, wrong about the timing, every time."* Bit-Command's fiction
   layer stays refused whole.
4. **A context/token meter.** Claude Code can show one because it knows its own
   context window. DASH states cost **per turn, from the provider's own stated
   figure**, and states nothing when the provider states nothing. A meter would
   be DASH making its own claim about somebody else's accounting — the one thing
   no surface in this product does.
5. **Claude Code's visual identity.** Its palette, its rounded chrome, its type.
   Bit-Command is deep navy, electric blue, zero corners, bundled pixel type,
   and `--radius-chief-composer: 20px` is the single declared exception, scoped
   and pinned by `tests/tokens.test.ts`. **This proposal adds no second
   exception** — every chip is `--radius-sm`, the system's own.
6. **A submit button.** Already removed on Henrik's own instruction ("No
   button."), and the reference agrees. The `↵` glyph names the key instead.
7. **An auto-growing composer that pushes the page.** The room overlays on
   purpose — MAR-615's band-anchoring defect is what a pushing composer
   reintroduces.

## 6. The constraints this was written against

- **ADR 0008 — no controls in the author's panel.** Nothing proposed here goes
  in the agent's authored panel. The chip row and the model chip are composer
  chrome; on the agent surface the composer is in `.cockpit-content`, beside the
  rail, not inside the panel. The one control that touches an agent's settings
  is a link *out* to the settings stage, which is what exists today.
- **One card, N tracks.** One component (`composer.tsx`), one combined
  `.chief-X, .ask-X` rule per chrome part, enforced by
  `tests/composer-shared.test.tsx`'s `CHROME_PARTS` loop — which the packet
  extends rather than works around.
- **Buttons force uppercase globally.** Handled by construction, not by
  exception: `.chip` beats `button` on specificity, `.chip .value` un-cases the
  model id, and every label word proposed here is one short word chosen to be
  shouted. §4.1.
- **No new chief capabilities.** Every chip carries a fact already in a view.
  Attachments, commands and mentions are named and declined. §4.2, §5.

## 7. Implementation packet sketch

Roughly one bounded session. `claude --model sonnet` is the right client — the
design judgment is spent here; what is left is bounded implementation against an
enforcing test.

**Files**

| File | Change |
| --- | --- |
| `app/_components/composer.tsx` | `ComposerClassNames` gains `chips`, `foot`, `modelChip`, `hint`. `Composer` draws the chip row above `.compose` and the footer row below it. New props: `chips: ReactNode`, replacing `modelLine` with `modelChip: ReactNode`. `↑`/`↓` recall and the Escape refocus land in the existing `onKeyDown`/effects. |
| `app/_components/chief-chat.tsx` | `CHIEF_COMPOSER_CLASSES` gains the four names. `ChiefModelLine` → `ChiefModelChip`; `ChiefModelPicker` keeps its logic, changes container. Supplies scope + decisions + no-model chips. |
| `app/_components/ask.tsx` | `ASK_COMPOSER_CLASSES` gains the same four. `.ask-model-line` → the chip-as-link. Supplies the agent's scope chip. |
| `app/_components/fleet-list.tsx` | passes `decisionsTotal` through to `ChiefChat`. |
| `app/page.tsx` | removes the `<p class="fleet-decisions-note">` link. **Only if §4.5 is accepted.** |
| `app/globals.css` | four new combined rules; `.chief-model-picker` from `flex-basis: 100%` to an anchored popover. |
| `lib/copy/chief-chat.ts` | the placeholder string; chip labels; the `↵ TO ASK` hint. |
| `lib/copy/ask.ts` | the agent chip's label; `ASK_MODEL_CHANGE` becomes the chip's text. |

**Tests**

- `tests/composer-shared.test.tsx` — add `composer-chips`, `composer-foot`,
  `model-chip`, `composer-hint` to `CHROME_PARTS`. This is the test that makes
  the packet safe: a rule that styled the chief's chip row and forgot the
  agent's fails before review.
- `tests/chief-chat-render.test.tsx` — the scope chip renders `label`'s words
  (the compaction-not-removal claim, §4.4); the `FLEET DEFAULT` chip appears
  when `model_is_own` is false and **not** when it is true; `NO MODEL` renders
  when `model_id` is null.
- New pure export in `composer.tsx`, tested directly, for the recall walk:
  `recallAt(turns, index, draft)`. Same reasoning as `sendsOnEnter` — every
  render test here is `renderToStaticMarkup`, so a key press is exactly what a
  render cannot exercise.
- `tests/tokens.test.ts` — unchanged, and that is the assertion: no second
  radius exception.
- Whatever asserts on the decisions link in `app/page.tsx` — found first, moved
  with it. §4.5, point 1.

**Capture scenes**

- `electron/capture-mar615.ts` — `measureComposer` gains `chips_box`,
  `model_chip_box` and `foot_box`, and the run re-reads
  `overlap_past_padding` to prove the perched O did not move. The
  before/after table in §4.3 is then a measured claim rather than an estimate.
- `electron/capture-ask.ts` — the two existing `composer-parity-*` frames are
  already the right scene and need no new harness; they simply re-shoot.
- **Do not add a new harness.** A new `electron/capture-*.ts` needs a
  `scripts/build-shell.mjs` entry and a pre-existing `DASH_DATA_DIR`, and gets
  neither for free.

**Order**: copy → `composer.tsx` + classes + CSS + `CHROME_PARTS` (one commit,
because the test gates it) → per-surface chips → recall/refocus → §4.5 last and
separably.

## 8. Open questions for Henrik

1. **The screenshot.** MAR-742 has no attachment (§0). If the comparison image
   showed something these three deltas do not cover, that is the gap — worth
   re-posting it on the issue before the packet runs.
2. **§4.5, the decisions link.** Move it into the chip row now, or leave it
   where MAR-679 put it until MAR-679's own slice lands? It is the only item
   here that touches a file outside the composer, and dropping it costs the rest
   of the proposal nothing.
3. **The scope chip's words.** `FLEET · 5 AGENTS` is proposed. It could be just
   `5 AGENTS`, or the fuller `ASK THE CHIEF ABOUT YOUR FLEET` compressed. The
   first is the tightest thing that still says what the question is *about*.
