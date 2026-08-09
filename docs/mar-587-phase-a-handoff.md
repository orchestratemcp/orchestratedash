# MAR-587 Phase A — idle-action sprite sheets, and what Phase B needs

Written 2026-08-09. Phase A touched no app code: the diff is assets, two
manifests, one authoring script, the brand-check extension, and its tests.

## What shipped

Three sheets, **8 frames each**, 50×50 per frame, laid out as a horizontal
strip (400×50), transparent background, whole-number pixel grid.

| character | action | file | bytes | prop box (x, y) |
| --- | --- | --- | --- | --- |
| ninja | `shuriken-toss` | `ninja-shuriken-toss.png` | 994 | 33–49, 10–37 |
| knight | `sword-swing` | `knight-sword-swing.png` | 1128 | 36–49, 13–37 |
| wizard | `fireball` | `wizard-fireball.png` | 1234 | 33–49, 16–37 |

**Frame count is 8 for all three, and `brand:check` fails if they ever
disagree.** One loop duration covers the whole fleet; a six-frame character
would either run at a different speed or be resampled in time.

Every loop returns to where it started, so frame 7 → frame 0 is not a cut.

Authored in **orchestrateweb** (`pnpm o:actions`), vendored into DASH. Byte
paths:

- author: `orchestrateweb/scripts/build-o-actions.mjs` → `apps/web/public/o/actions/`, `apps/web/components/brand/o-actions.json`
- vendor: `orchestratedash/public/o/actions/`, `lib/brand/o-actions.json`
- verify: `pnpm brand:check` (DASH), `pnpm o:actions:check` (SITE, inside `pnpm verify`)

## How the frames are made, and why it matters to Phase B

**The character layer is never redrawn.** Each frame is a byte copy of the
audited still with a prop stamped on top at a whole-pixel offset. Each action
declares the one rectangle its frames may differ from the still inside, and
`checkActions` re-derives that from the pixels rather than believing the
manifest.

That is not a tidiness property. It means **nothing outside the prop box can
change, so nothing outside the prop box can carry information** — "a costume is
recognition, never status" stopped being something a reviewer asserts about an
animation and became something the check measures. A sheet that tried to encode
health in the ninja's eyes fails `brand:check` without anyone having to notice.

Two more rules only an animation can break, both enforced:

- each sheet records the **sha256 of the still it was built from**, so a
  character re-vendored without its sheet cannot leave an animation of the old
  pixels playing over the new ones — both files stay individually valid, and
  nothing else would say so;
- **no frame may paint emerald** (within 40 of `--ok` in either scheme), checked
  on the pixels, not the CSS.

## What Phase B needs

1. **A `--motion-*` token for the loop.** There isn't one for this yet. The
   preview uses **1800ms**, which is `--motion-beckon` — 225ms per frame at 8
   frames, and it reads right. `--motion-stroll` (3600ms) is the slow option.
   Phase B should add `--motion-idle` or reuse `--motion-beckon`; either way
   `app/tokens.css` already zeroes it under `prefers-reduced-motion`, so
   stillness needs no per-surface code. Note `checkAvatarCss` **already fails**
   any avatar rule with a literal duration, so this must be a token.

2. **A typed view.** `lib/brand/o-cast.ts` is untouched — I own no existing
   file in `lib/`. Phase B wants something like `O_ACTIONS` and an
   `oActionFor(name)` returning `null` for the eight characters with no sheet,
   plus the `OSize` union extended if the fleet renders larger than 100px. The
   current union is `50 | 100`; **`checkSizeApi` rejects anything that is not a
   whole multiple of 50**, so "big" means 150/200, never 120.

3. **Rendering.** One `background-position` step, no second request:

   ```css
   .o-avatar--action {
     background-size: calc(var(--o-size) * 8) var(--o-size);
     animation: o-idle var(--motion-beckon) steps(8) infinite;
   }
   ```

   Keep `image-rendering: pixelated`. Pause when the window is hidden
   (`visibilitychange`) — the issue asks for it and nothing enforces it yet.

4. **Only three of eleven characters have sheets.** The fleet must degrade to
   the still for the other eight. `brand:check` deliberately does not require a
   sheet per character.

5. **The glance-status chips are a separate issue and still carry all actual
   meaning.** Nothing about these loops is allowed to become the status signal.

## What did not work, so it is not retried

PixelLab's `animate_image` was run on all three characters, twice (6 of 40 trial
generations), and rejected on evidence:

- **It redraws the whole 50×50 canvas each frame.** The ninja's hood silhouette,
  eye band and leg positions moved frame to frame; measured drift was ±2px on
  the bounding box and up to 12 off-palette pixels per frame against a 12-colour
  still. At fleet scale that reads as boiling, not animation.
- **It cannot invent a legible prop at this size.** "Swinging a sword" returned a
  red-flecked white blob; a re-roll returned a grey mitten. "Throwing a fireball"
  engulfed the whole character in flame — which would have read as an alarm
  state, the exact thing the issue forbids.
- Frame 0 does come back byte-identical, which is worth knowing if it is ever
  revisited.

What it **is** good at is drawing one clean object. The sword and the fireball
are its designs, generated against each character's own palette
(`color_image_base64`, `forced_palette: yes`), then redrawn at the size a 50px
grid can carry — a 22×24 sword on a 27px-wide body is a sword wearing a knight.
The shuriken was not designed at all: it is the ninja's own, read back out of the
audited pixels using the nerd's alpha as a stencil, the trick recorded in
`MCP/avatars/README.md`.

The account is a **trial: 40 generations, no card, $0 spent, 32 remaining.**

## Preview

`docs/mar-587-o-actions-preview.html` — self-contained, no server, no network.
Scale and loop-duration controls, the still beside each loop, the frame strip,
and every number read from the manifest. It honours `prefers-reduced-motion`.
