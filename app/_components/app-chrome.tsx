"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SURFACES, isSeparateWindowRoute, surfaceFor } from "../_data/routes";
import { SurfaceIcon } from "./sidebar-icons";
import { TitleBar } from "./title-bar";

/**
 * Everything around the page: the title bar above it, the sidebar beside it.
 *
 * The title bar and the navigation are one component because they are one
 * decision: the bar says which surface you are on and the nav is how you change
 * it, and a bar that had to be told the answer the nav already knows would be
 * two sources for one fact.
 *
 * ## The nav is a sidebar now, and that is a decision with a history (MAR-546)
 *
 * MAR-440 built the horizontal nav and MAR-528 explicitly kept it, declining
 * the concept package's 240px sidebar on MAR-440's original reasoning. Henrik
 * overrode that on 2026-08-07: the concept screens all use the fixed left
 * sidebar, and the sidebar is what he wants. MAR-546 is that decision, made —
 * so the sentence that stood here, "the fixed sidebar … is MAR-420", is
 * superseded rather than quietly deleted.
 *
 * The sidebar owns the left track of `body`'s grid (see `globals.css`); the
 * title bar spans the full width above it, because the strip the window is
 * dragged by and the room Windows' caption buttons need are facts about the
 * *window*, not about a column of it.
 *
 * Below 900px the sidebar collapses to an icon rail rather than becoming an
 * overlay drawer: every destination stays one press away at every width, no
 * scrim ever covers an approval card (the constraint the fleet strip is built
 * under), and the labels are hidden visually rather than removed, so the
 * accessible names survive the collapse. MAR-491's narrow-width work is the
 * bar this must clear: the rail spends 40px of a 375px window and the content
 * column keeps `minmax(0, 1fr)`, so nothing it fixed regains a reason to
 * overflow.
 *
 * ## The sidebar is destinations, and only destinations (MAR-634)
 *
 * `DensityToggle` stood at the bottom of this column from MAR-420 until
 * MAR-634, on the argument that density is a view preference and belongs with
 * the things that change what the page shows. What changed is that MAR-630
 * built a right rail on the Agents page for exactly that job, and Henrik,
 * looking at the result: *"the fit more on screen thing we can remove"*. A
 * preference in the bottom-left corner of every window, competing with a rail
 * two columns away, is one control in two places.
 *
 * The control itself is not gone. MAR-599 already put `DensityToggle` on
 * Settings → Preferences — the same component, not a second implementation —
 * so `dash.density` still has exactly one reader and writer and the setting is
 * still reachable. What this removes is the second doorway, not the room.
 *
 * Nothing else left with it: the collapse to a rail is a media query rather
 * than a control, so there was no expand/collapse affordance in this column to
 * delete by mistake.
 */
export function AppChrome(): ReactNode {
  const pathname = usePathname() ?? "/";

  /*
   * A dialog is not a page of the app (MAR-534).
   *
   * `electron/credential-prompt.ts` and `electron/approval-popup.ts` each open a
   * separate `BrowserWindow` onto a route in this same static export. Until this
   * check they got the whole application on top of their one question: a title
   * bar naming a surface the window is not on, five links to places this window
   * cannot navigate to, and a density control for a page with one field.
   *
   * The argument is `fleet-strip.tsx`'s, and it is stronger here than it was
   * there — a row of characters along the bottom of a password field is
   * decoration in a dialog, and a *working navigation bar* in one is an exit
   * the window has no way to honour. The reason it was missed is ordinary:
   * `isSeparateWindowRoute` was written by MAR-503 for the strip, and the chrome
   * predates it by three issues.
   *
   * The skip link comes with it, and that is not tidiness either. It exists
   * because six navigation links sit between the window and the content on every
   * page — its own comment says so. Where there are none, it is a shortcut past
   * nothing, and it would be the first thing a keyboard user reaches in a
   * one-question dialog.
   */
  if (isSeparateWindowRoute(pathname)) {
    return null;
  }

  const current = surfaceFor(pathname);

  return (
    <>
      {/*
        Outside the `<header>` rather than inside it. `.app-chrome` is
        `position: sticky` and therefore a positioned ancestor, and this element
        is `position: absolute` with offsets measured against the window — moving
        it in would silently re-anchor it to the chrome, which is the class of
        defect MAR-440 already shipped once with this exact element.
      */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-chrome">
        <TitleBar surface={current.label} />
      </header>
      <nav className="app-sidebar" aria-label="Sections">
        {/*
          The concept's identity block, without the fiction. It repeats the
          wordmark the title bar already announces, so it is hidden from the
          accessibility tree — a screen reader would otherwise hear the
          application introduce itself twice on every page. "Agent command
          center" is the adopted concept's own name for what this surface is,
          not an invented status line.
        */}
        <div className="sidebar-identity" aria-hidden="true">
          <span className="sidebar-mark">DASH</span>
          <span className="sidebar-tag">Agent command center</span>
        </div>
        {SURFACES.map((surface) => {
          const active = surface.href === current.href;
          return (
            <Link
              key={surface.href}
              href={surface.href}
              className={active ? "sidebar-link is-active" : "sidebar-link"}
              /*
                The active surface is announced, not just coloured. The solid
                block of electric blue is the concept's answer and exactly as
                silent to anyone not looking at it; this attribute is what
                carries the state to them, and it was always the half that did.
              */
              aria-current={active ? "page" : undefined}
              /*
                In the rail the label is visually hidden, so the tooltip is the
                sighted-mouse answer to "which one is this". At full width it
                repeats the visible label, which a tooltip is allowed to do.
              */
              title={surface.label}
            >
              <SurfaceIcon href={surface.href} />
              <span className="sidebar-label">{surface.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
