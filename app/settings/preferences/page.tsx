"use client";

import type { ReactNode } from "react";

import { DensityToggle } from "../../_components/density-toggle";
import { FleetStripToggle } from "../../_components/fleet-strip";
import { FleetViewToggle } from "../../_components/fleet-view-toggle";
import { ThemeToggle } from "../../_components/theme-toggle";
import { UiScaleControl } from "../../_components/ui-scale-control";
import { InfoNote } from "../../_components/info-note";
import { HostNotice } from "../../_components/view-state";
import { useHost } from "../../_data/use-view";

/**
 * Preferences: how DASH looks, not what it does (MAR-599).
 *
 * ## Where this came from
 *
 * MAR-592 shipped four of the five sections Henrik asked for when he scoped
 * Settings — Connections, Servers, Notifications, Add agent — and named the
 * fifth without building it: *"app preferences (dark mode etc.)"*
 * (`docs/handoff-2026-08-10-attended-run-paused.md`). This is that section,
 * added rather than folded into an existing tab, because it answers a
 * different question than the other four. Connections, Servers and
 * Notifications are all "what can DASH reach"; this is "how does DASH look",
 * and a person adjusting one has no reason to be looking at the other.
 *
 * ## Nothing new was built
 *
 * Both controls this page is about already exist. Density has had a working
 * toggle in the sidebar since MAR-420 — `DensityToggle` is imported here
 * unchanged, not reimplemented, so there is exactly one place that reads and
 * writes `dash.density`. Theme had no toggle anywhere in DASH: it followed
 * `nativeTheme.shouldUseDarkColors` end to end, and this page said so plainly
 * rather than drawing a control nothing behind it would answer to. Inventing
 * one was out of scope for that pass.
 *
 * ## Theme is a control now (MAR-642)
 *
 * `ThemeToggle` is the fourth setting on this page and the first one built for
 * it rather than moved to it. What made it cheap is that nothing about the
 * palette needed inventing: `app/tokens.css` has declared every token as
 * `light-dark(light, dark)` since MAR-528, with `:root[data-theme="light"]` and
 * `:root[data-theme="dark"]` at the bottom of the file resolving them — written
 * for a control that did not exist. What was missing was something to write the
 * attribute, and something to tell Electron, whose title bar and window
 * background are chosen in Node before a stylesheet exists.
 *
 * ## The third setting arrived the same way (MAR-612)
 *
 * `FleetViewToggle` is imported here unchanged too, and it lives primarily in
 * the agents page's right rail — where the thing it changes is. It is repeated
 * here because this page's job is to be the inventory of how DASH looks, and
 * an inventory missing an entry is worse than no inventory: it teaches a
 * reader that what is on this page is all there is.
 *
 * ## Two of these are now only here (MAR-634)
 *
 * Density and the bottom strip each used to have a second doorway in a corner
 * of the window — a button under the sidebar and a stub in the bottom-right —
 * and MAR-634 removed both as leftovers competing with the Agents page's right
 * rail. Neither setting was removed with them. That makes this page the only
 * way to reach two of the four, which raises the stakes on the paragraph
 * above: an inventory that is also the only door has to be complete, so a
 * later session adding a fifth view preference owes this page a row.
 */
export default function PreferencesPage(): ReactNode {
  const host = useHost();

  return (
    <>
      <h1>How DASH looks</h1>
      <HostNotice host={host} />

      <section aria-labelledby="preferences-density">
        <h2 id="preferences-density">Density</h2>
        {/*
          The claim stays, the explanation moves (MAR-614). "Nothing is hidden
          either way" is the load-bearing half — MAR-491 made it a rule that
          `data-density="compact"` may not hide anything, and this sentence is
          the promise a person is owed *before* they press a control that
          rearranges their screen. What compact does, and which one is the
          default, is what the toggle beside it demonstrates in one press.
        */}
        <p className="muted wrap">
          Nothing is hidden either way.
          <InfoNote>
            Comfortable is the default. Compact fits more rows and cards on
            screen — the same facts, closer together.
          </InfoNote>
        </p>
        <DensityToggle />
      </section>

      <section aria-labelledby="preferences-fleet-view">
        <h2 id="preferences-fleet-view">Fleet layout</h2>
        <p className="muted wrap">
          How your agents are arranged on the Agents page. Every card says the
          same things in all three; only the shape changes.
        </p>
        <FleetViewToggle />
      </section>

      <section aria-labelledby="preferences-fleet-strip">
        <h2 id="preferences-fleet-strip">Agents along the bottom</h2>
        {/*
          MAR-634. The control arrived here because it was removed from the
          bottom-right corner of every window, not because this page wanted a
          fourth row: when the strip was off, that corner held a lone "Show
          your agents" stub, which Henrik named as one of two leftovers
          competing with the Agents page's own right rail.

          It belongs on this page by the same argument as the two above it —
          this is the inventory of how DASH looks, and the strip is the most
          visible thing in the window that a person can turn off.
        */}
        <p className="muted wrap">
          The row of characters along the bottom edge of the window. Turning it
          off changes nothing about your agents.
        </p>
        <FleetStripToggle />
      </section>

      <section aria-labelledby="preferences-ui-scale">
        <h2 id="preferences-ui-scale">UI scale</h2>
        <p className="muted wrap">Make the whole DASH window smaller or larger.</p>
        <UiScaleControl />
      </section>

      <section aria-labelledby="preferences-theme">
        <h2 id="preferences-theme">Theme</h2>
        {/*
          MAR-642. What was here was a paragraph apologising for a missing
          control — "there is no separate switch in DASH yet" — above a palette
          that had been ready for one since MAR-528: every token in
          `app/tokens.css` is declared as `light-dark(light, dark)`, and the two
          `:root[data-theme]` rules that resolve them have been at the bottom of
          that file the whole time, written for a control nobody had built.

          The half of that paragraph that survives is the half still worth
          knowing, because System is the default and stays it: this follows the
          computer unless a person says otherwise.
        */}
        <p className="muted wrap">
          System follows this computer and changes when it does. Light and dark
          stay where you put them.
        </p>
        <ThemeToggle />
      </section>
    </>
  );
}
