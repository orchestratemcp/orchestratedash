"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SURFACES, isSeparateWindowRoute, surfaceFor } from "../_data/routes";
import { DensityToggle } from "./density-toggle";
import { TitleBar } from "./title-bar";

/**
 * Everything above the page (MAR-440).
 *
 * The title bar and the navigation are one component because they are one
 * decision: the bar says which surface you are on and the nav is how you change
 * it, and a bar that had to be told the answer the nav already knows would be
 * two sources for one fact.
 *
 * This is where MAR-440 stops. The page-level command centre — the fixed
 * sidebar, the fleet grid, the density control — is MAR-420, and the issue is
 * explicit that it "should not be folded in here". So the nav below is the
 * existing horizontal one, restyled onto the tokens and no more: replacing it
 * with the sidebar in this change would make the chrome pass unreviewable,
 * because every screenshot would have changed for two reasons at once.
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
        <nav className="app-nav" aria-label="Sections">
          {SURFACES.map((surface) => {
            const active = surface.href === current.href;
            return (
              <Link
                key={surface.href}
                href={surface.href}
                className={active ? "app-nav-link is-active" : "app-nav-link"}
                /*
                 * The active surface is announced, not just coloured.
                 *
                 * MAR-528 replaced the 2px bar with a solid block of electric
                 * blue, which is a stronger visual answer and exactly as silent
                 * to anyone not looking at it. This attribute is what carries
                 * the state to them, and it was always the half that did.
                 */
                aria-current={active ? "page" : undefined}
              >
                {surface.label}
              </Link>
            );
          })}
          {/*
            At the end of the nav rather than in the title bar (MAR-420, not
            MAR-440). The title bar is the *window*: what it says is which
            application this is and which surface you are on. Density is a view
            preference about the page, so it belongs with the other things that
            change what the page shows.
          */}
          <span className="app-nav-spacer" />
          <DensityToggle />
        </nav>
      </header>
    </>
  );
}
