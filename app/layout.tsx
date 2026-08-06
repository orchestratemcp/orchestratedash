import type { ReactNode } from "react";
import "./tokens.css";
import "./globals.css";
import { AppChrome } from "./_components/app-chrome";
import { DensityScript } from "./_components/density-toggle";
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
      </head>
      <body>
        {/*
          A skip link, because the chrome now sits between the window and the
          content on every page. Six navigation links is not much to tab past
          once; it is a lot to tab past on every navigation, which is what a
          keyboard user actually does.
        */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <AppChrome />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
