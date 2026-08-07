# Wave 2 — the narrow window, finished (MAR-491)

The after-state for `qa-screenshots-wave1/`, which is the before-state and is
committed beside it. Produced by `electron/capture.ts`:

```
pnpm build:shell
DASH_CAPTURE_DIR=qa-screenshots-wave2-narrow electron dist/electron/capture.mjs
```

Run it from PowerShell on Windows. Under Git Bash the runner cannot read its own
user SID and never starts.

The harness wrote **43 images across five surfaces** — agents, runs,
connections, work inbox and the agent workspace — at 1280/768/375 in both
themes. Committed here are the **18 this change is argued from**: the two
surfaces whose cards were re-cut, at three widths in both themes, plus the 1280
density pair and one 375px capture of each surface that was only measured.
`layout.json` carries every number from all 43.

## What the numbers say, and they are the point

Sixty measurements — five surfaces × three widths × two themes × two densities:

| | count |
| --- | --- |
| elements inside `main` scrolling horizontally (`widest_scroller`) | **0** |
| pages overflowing horizontally (`page_overflows`) | **0** |
| captures where the density control is off-screen | **0** |
| captures where `nav.app-nav` is a horizontal scroller | **0** |

The last two are the finding PROJECT_STATE.md carried as open since MAR-440
shipped: at 375px the nav scrolled 484px of content through 359, so two of five
destinations and the density control were off-screen at rest with a scrollbar as
the only hint they existed. `qa-screenshots-wave1/layout.json` records it as
`density_toggle: { fully_visible: false }`. The nav wraps now.

`widest_scroller` is MAR-491's own hand-taken measurement generalised. The issue
was filed with three numbers — a 341px container holding 1425px of table, taken
once by hand at one width on one page — and this is the form a later session can
re-take, on every surface, at every width, in both themes.

## What the pictures say that the numbers cannot

A card that stopped scrolling sideways and started scrolling downwards is not
fixed, and no measurement in wave 1 would have said so. Compare
`agents-375-light-comfortable.png` here with the same file in
`qa-screenshots-wave1/`: the nine columns are not nine stacked rows. The card is
a character, a name, a verdict, what the agent is for, and one line of meta —
with "Technical details" underneath for the four facts written in DASH's own
vocabulary.

Agent card at 375px: **over 700px tall → 284px**. Run card: **740px → 165px**
closed, 397px open.

## The caveat, stated rather than left to be discovered

The window is real and the theme moves through `nativeTheme.themeSource`, which
is the signal the operating system sends. Density moves by clicking the real
control, so each pair is a small proof as well as an image.

**The renderer was serving the developer origin.** Same renderer code, but the
data reached it over HTTP routes rather than the IPC bridge, because this
machine's installed-style store holds no agents and a picture of an empty list
proves nothing about how a list of records reflows.
