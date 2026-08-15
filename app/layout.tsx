import type { ReactNode } from "react";
import "./fonts.css";
import "./tokens.css";
import "./globals.css";
import { AppChrome } from "./_components/app-chrome";
import { DensityScript } from "./_components/density-toggle";
import { FleetStrip, FleetStripScript } from "./_components/fleet-strip";
import { FleetViewScript } from "./_components/fleet-view-toggle";
import { ThemeScript, ThemeSync } from "./_components/theme-toggle";
import { WindowVisibility } from "./_components/window-visibility";
import { RENDERER_TITLE } from "../lib/shell/preflight";

export const metadata = {
  /*
    The one place this string is written. `pnpm shell`'s preflight reads the
    `<title>` of whatever is answering on the developer origin to tell DASH's
    own dev server from another application that happened to take port 3000 —
    a hazard this machine has hit — and two copies of a string are two copies
    that can disagree. See `lib/shell/preflight.ts`.
  */
  title: RENDERER_TITLE,
  description: "Local monitor for agents planned with OrchestrateKit.",
};

/**
 * MAR-440. `tokens.css` is imported before `globals.css` and the order is not
 * cosmetic: every declaration in the second file resolves against custom
 * properties declared in the first, and a `var()` with no declaration is not an
 * error — it is a silently missing value, which is the worst way for a design
 * system to fail.
 */
export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    /*
      MAR-492, and the attribute is why `suppressHydrationWarning` is here.
      `DensityScript` below runs before hydration and sets `data-density` on
      this element, so React arrives to find an attribute the markup it built
      never had and reports a mismatch — correctly, because `<html>` is an
      element this layout renders and therefore an element React hydrates. The
      attribute is meant to be there; the report is the only thing that is not
      wanted. Suppressing it is React's own escape hatch for a preference
      restored from storage before paint, and it works one level deep: this
      element's own attributes, and nothing inside `<head>` or `<body>`.

      There is no server-rendered alternative. The packaged renderer is a static
      export built on a machine that has never met this user, which is the same
      reason the script exists at all.
    */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          MAR-420. Before the body, so the first frame already has the user's
          density. A static export's first render is a build artefact made on a
          machine that never met this user, so without this every row on the
          page visibly jumps once on a slow paint.
        */}
        <DensityScript />
        {/*
          MAR-503, beside `DensityScript` and for its reason exactly: a person
          who turned the fleet strip off would otherwise watch it appear and
          leave again on every navigation, because a static export's first
          render was built on a machine that never met them.
        */}
        <FleetStripScript />
        {/*
          MAR-612, and the third script here for the second time for the same
          reason. Somebody who chose Spotlight would otherwise watch a grid
          assemble and re-lay itself on every navigation — the fleet's cards are
          the largest things DASH draws, so this is the most visible instance of
          the flash the other two scripts exist to prevent.
        */}
        <FleetViewScript />
        {/*
          MAR-642, and the fourth script here for the third time for the same
          reason — with the largest consequence of the four. Density, the strip
          and the view each move things about; this one is the *palette*, so
          without it somebody who chose light watches a dark DASH paint and
          invert on every navigation. It is last because it is the newest, and
          the four are independent: nothing here reads what another wrote.
        */}
        <ThemeScript />
      </head>
      {/*
        Three bands and a left track: the chrome across the top, the sidebar
        beside the page (MAR-546), and the fleet strip along the bottom edge
        (MAR-503).

        A grid rather than normal flow because the strip has to sit at the
        bottom of the *window* on a short page and at the bottom of the
        *content* on a long one, and `1fr` on the middle row is what makes those
        the same rule. It is deliberately not a fixed or floating element: an
        overlay would cover approvals, forms and receipts — the surfaces DASH
        exists for — and MAR-435's whole non-goal here is that nothing is drawn
        over anything it does not own.
      */}
      <body>
        {/*
          The skip link moved into `AppChrome` (MAR-534), and it moved for a
          reason rather than for tidiness: it exists because the chrome sits
          between the window and the content, so on a route that has no chrome —
          the credential prompt, the approval popup — it is a shortcut past
          nothing and would be the first thing a keyboard user reaches in a
          one-question dialog. One check now removes both.
        */}
        {/*
          MAR-587. Renders nothing; it writes `data-window="hidden"` on the root
          while nobody can see the window, which is what stops the fleet's idle
          loops burning a core behind a maximised browser. It is in the layout
          rather than beside the sprites because visibility is a fact about the
          window, read once for everything inside it.
        */}
        <WindowVisibility />
        {/*
          MAR-642. Renders nothing; it tells main which theme this window is in,
          once, so the title bar and the window's own background match the
          palette the page is drawn in. It is here rather than beside the
          control because the correction is needed on every route — somebody who
          chose dark last week and opens DASH on the Agents page never visits
          Preferences.
        */}
        <ThemeSync />
        <AppChrome />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <FleetStrip />
      </body>
    </html>
  );
}
