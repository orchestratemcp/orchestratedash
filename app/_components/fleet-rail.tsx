"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { FleetViewToggle } from "./fleet-view-toggle";

/**
 * The agents page's right rail: add one, or change how they are laid out.
 *
 * The left sidebar is *where you go* (MAR-546). This column is *what you do
 * to the fleet you are looking at*. Those are different questions, and putting
 * both in the left list was how "Add agent" became a destination you visit
 * rather than an action on this page (MAR-592 had to rescue it from Settings).
 *
 * The layout control sits here for the same reason it used to sit above the
 * cards (MAR-612): a setting whose whole effect is on this page, kept only on
 * a settings screen two clicks away, is a setting nobody finds. Preferences
 * still inventories it; this is the copy that matters.
 *
 * A link, not a button, and it goes to the same page the Settings tab does.
 * There is one add-agent surface and this is a second door onto it — the
 * argument `lib/shell/menu.ts` made about its own menu item.
 */
export function FleetRail(): ReactNode {
  return (
    <aside className="fleet-rail" aria-label="Agent actions">
      <Link className="button-link" href="/settings/add-agent">
        Add agent
      </Link>
      <FleetViewToggle />
    </aside>
  );
}
