"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { SURFACES, surfaceFor } from "../_data/routes";
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
  const current = surfaceFor(pathname);

  return (
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
               * `aria-current` is what makes the 2px active bar mean something
               * to somebody who cannot see it — and the design system's own
               * rule is that no status is communicated by colour alone.
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
  );
}
