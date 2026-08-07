# Wave 2 — the cast gets somewhere to stand (MAR-501, MAR-502, MAR-503)

Produced by `electron/capture.ts`, which boots the real Electron shell through
the same `electron/smoke-identity.ts` and `electron/main.ts` the app uses, and
then only watches. Reproduce the whole wave with:

```
pnpm build:shell
DASH_CAPTURE_DIR=qa-screenshots-wave2-brand electron dist/electron/capture.mjs
```

Run it from PowerShell on Windows. Under Git Bash the runner cannot read its own
user SID (`whoami /user` is the GNU `whoami`, which takes no arguments) and
never starts.

## What is here, and what is not

The harness wrote **43 images across five surfaces** — agents, runs,
connections, work inbox and the agent workspace — at 1280/768/375 in both
themes, and both densities on the two surfaces where a density difference is
visible. Committed here are the **16 the pull request argues from**: the fleet
monitor and the workspace, three widths, both themes, plus the 1280 density
pair and the splash.

The rest are not committed and are not lost. `layout.json` carries the numbers
for **every** surface, width, theme and density in the run, including the three
this directory has no pictures of; and the command above re-takes the images in
about six minutes. A screenshot somebody took once is not evidence the next
person can refresh, which is the whole reason this is a script.

## What the pictures were taken of

The window is real and the theme moves through `nativeTheme.themeSource`, which
is the signal the operating system sends. Density moves by **clicking the real
control**, so each pair is a small proof as well as an image.

**The renderer was serving the developer origin**, not the packaged export, and
that is a caveat rather than a detail: it is the same renderer code, and the
data reached it over HTTP routes rather than over the IPC bridge. The reason is
that this machine's installed-style store holds no agents, and a picture of an
empty fleet proves nothing about avatars. An installed-shell witness is what
would move MAR-501/502/503 from `merged` to `proven`.

## The numbers worth reading in `layout.json`

* `widest_scroller` — the widest horizontally-scrolling element inside `main`,
  per surface per width. `null` everywhere in this wave, which is MAR-491's
  measurement generalised: the record lists reflow rather than scroll.
* `fleet_strip.overlaps_main` — false everywhere, at every width, in both
  themes. The strip is a grid track and not an overlay, which is MAR-503's hard
  rule checked rather than promised.
* `density_toggle.fully_visible` — **false at 375px**, with `nav.app-nav`
  scrolling 484px of content through 359. That is the chrome finding
  PROJECT_STATE.md records as open and separate from MAR-491's tables. It is
  unchanged by this work and is visible in `agents-375-*.png`.
