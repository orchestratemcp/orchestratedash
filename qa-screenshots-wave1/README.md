# Wave 1 — the before-state (MAR-440, MAR-420, and MAR-491's evidence)

Taken **2026-08-05T21:14:35Z** by the design-pass session that landed PRs
[#41](https://github.com/orchestratemcp/orchestratedash/pull/41) and
[#42](https://github.com/orchestratemcp/orchestratedash/pull/42), with the first
version of `electron/capture.ts`. It photographed one surface — the fleet
monitor — at 1280/768/375 in both themes and both densities, plus the splash.

This directory sat untracked in the repository root for two days. It is
committed here rather than deleted, because it is the before-state MAR-491's fix
is argued against and **a before-state a reader cannot see is an argument they
have to take on trust**. The after-wave is `qa-screenshots-wave2-narrow/`.

## What it shows, and what it measured

`375-light-comfortable.png` is the picture MAR-491 was filed from: the agents
**table**, nine columns, scrolling horizontally inside the card that holds it,
with the agent's own name scrolling out of view before the reader reaches the
column they were looking for.

`layout.json` carries the chrome measurement rather than the table's. Its
`density_toggle` block records `fully_visible: false` at a 374px viewport, with
`nav.app-nav` scrolling 484px of content through 374 — the finding
PROJECT_STATE.md kept open as "the chrome, a different finding from MAR-491's
tables, wanting the same breakpoint decision rather than a patch". MAR-491's own
1425-inside-341 measurement of the table was taken by hand at the time and is
not in this file; `widest_scroller` in the wave-2 `layout.json` is that
measurement generalised so a later session can re-take it.

## Reproducing it is not possible, and that is fine

These images are of a build that no longer exists — the tables were replaced by
card lists in PR #45. Re-running the harness against this commit produces the
after-state, which is the point. What makes this directory evidence rather than
decoration is its date and the commit it was taken at, both of which are in
`layout.json` and in the git history of the change it argues about.
