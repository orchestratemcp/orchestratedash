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
            <Link href="/work">Work inbox</Link>
            <Link href="/runs">Runs</Link>
            <Link href="/connections">Connections</Link>
            <Link href="/agents/add">Add agent</Link>
          </nav>
          <span className="badge">local agent workspace &middot; audited controls</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
