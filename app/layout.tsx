import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "OrchestrateDASH",
  description: "Local monitor for agents planned with OrchestrateKit.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <html lang="en">
      <body>
        <header>
          <strong>OrchestrateDASH</strong>
          <nav>
            <Link href="/">Agents</Link>
            <Link href="/runs">Runs</Link>
            <Link href="/connections">Connections</Link>
          </nav>
          <span className="badge">monitor only &middot; never hosts agents</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
