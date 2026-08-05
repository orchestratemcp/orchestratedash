import type { ReactNode } from "react";
import "./tokens.css";
import "./globals.css";
import { AppChrome } from "./_components/app-chrome";

export const metadata = {
  title: "OrchestrateDASH",
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
    <html lang="en">
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
