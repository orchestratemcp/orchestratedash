/**
 * The sidebar (MAR-546).
 *
 * Henrik overrode MAR-528's decision to keep the horizontal nav: the concept's
 * fixed left sidebar wins. These are the claims that decision rests on, written
 * so the ones a screenshot cannot answer are answered here — the capture matrix
 * answers the rest (what it looks like, and whether 375px stayed usable).
 *
 * The two load-bearing groups:
 *
 * 1. **Nothing is lost in the collapse.** The rail hides labels *visually*; a
 *    rule that switched to `display: none` would remove six accessible names at
 *    exactly the width where the icons become the only visible signal.
 * 2. **The grid stays honest when bands are absent.** The sidebar joined a grid
 *    whose rows are named because two of its children are conditional
 *    (MAR-534); the sidebar is a third, and the column must collapse the same
 *    way the rows do.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SEPARATE_WINDOW_ROUTES, SURFACES } from "../app/_data/routes";
import { hasSurfaceIcon } from "../app/_components/sidebar-icons";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: (): string => pathname,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }): ReactNode => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AppChrome } = await import("../app/_components/app-chrome");

function markupAt(route: string): string {
  pathname = route;
  return renderToStaticMarkup(<AppChrome />);
}

describe("every destination survives the move into the sidebar", () => {
  it("renders one sidebar link per surface, each with its label in a hideable span", () => {
    const markup = markupAt("/");
    for (const surface of SURFACES) {
      expect(markup).toContain(`href="${surface.href}"`);
      // The label must be inside .sidebar-label — that class is what the rail
      // query hides visually. A label rendered as bare link text would either
      // survive the collapse (breaking the rail) or force display:none
      // (removing the accessible name).
      expect(markup).toMatch(
        new RegExp(`sidebar-label[^>]*>${surface.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<`),
      );
    }
  });

  it("gives every surface a pixel glyph, so the rail never shows an unlabelled blank", () => {
    for (const surface of SURFACES) {
      expect(hasSurfaceIcon(surface.href), `${surface.href} has no icon`).toBe(true);
    }
  });

  it("keeps the icons silent — the accessible name is the label, once", () => {
    const markup = markupAt("/");
    const icons = markup.match(/<svg[^>]*class="sidebar-icon"[^>]*>/g) ?? [];
    expect(icons).toHaveLength(SURFACES.length);
    for (const icon of icons) {
      expect(icon).toContain('aria-hidden="true"');
    }
  });

  it("announces the active surface and only the active surface", () => {
    const markup = markupAt("/connections");
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("keeps the density control, at the bottom of the sidebar", () => {
    // The control the capture harness clicks (`button.density-toggle`) must
    // stay findable; the sidebar is its new home, after the links.
    const markup = markupAt("/");
    const nav = markup.slice(markup.indexOf("<nav"));
    expect(nav).toContain("density-toggle");
    expect(nav.indexOf("density-toggle")).toBeGreaterThan(nav.lastIndexOf("sidebar-link"));
  });

  it("hides the identity block from the accessibility tree — the title bar already says DASH", () => {
    const markup = markupAt("/");
    const identity = /<div[^>]*class="sidebar-identity"[^>]*>/.exec(markup);
    expect(identity).not.toBeNull();
    expect(identity?.[0]).toContain('aria-hidden="true"');
  });

  it("still renders nothing at all in a dialog window", () => {
    // MAR-534's rule, re-asserted against the new structure: the sidebar is
    // part of AppChrome, so the gate that removed five links from a password
    // prompt must remove six links and a rail too.
    for (const route of SEPARATE_WINDOW_ROUTES) {
      expect(markupAt(route)).toBe("");
    }
  });
});

describe("the grid the sidebar joined", () => {
  const css = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8");

  function ruleFor(selector: string): string {
    const match = new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`).exec(css);
    if (match === null) {
      throw new Error(`app/globals.css has no rule for ${selector}`);
    }
    return match[1] as string;
  }

  it("gives body a collapsible sidebar column and a shrinkable content column", () => {
    // `auto` is what lets an absent sidebar cost a dialog nothing;
    // `minmax(0, 1fr)` is MAR-491's hard-won line and must survive the move.
    expect(ruleFor("body")).toMatch(/grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s*;/);
  });

  it("names the sidebar's cell and main's column explicitly", () => {
    expect(ruleFor("\\.app-sidebar")).toMatch(/grid-row:\s*2\s*;/);
    expect(ruleFor("\\.app-sidebar")).toMatch(/grid-column:\s*1\s*;/);
    expect(ruleFor("main")).toMatch(/grid-column:\s*2\s*;/);
  });

  it("spans the chrome and the strip across both columns", () => {
    expect(ruleFor("\\.app-chrome")).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
    expect(ruleFor("\\.fleet-strip")).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
  });

  it("collapses the rail's labels visually, never with display: none", () => {
    const rail = /@media \(max-width: 900px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(rail).not.toBeNull();
    const block = rail?.[1] ?? "";
    const label = /\.sidebar-label\s*\{([^}]*)\}/.exec(block);
    expect(label, "the rail query must address .sidebar-label").not.toBeNull();
    expect(label?.[1]).toContain("clip-path");
    expect(label?.[1]).not.toContain("display");
  });

  it("scrolls the sidebar as its own band rather than growing past the window", () => {
    expect(ruleFor("\\.app-sidebar")).toMatch(/overflow-y:\s*auto\s*;/);
    expect(ruleFor("\\.app-sidebar")).toMatch(/min-height:\s*0\s*;/);
  });
});
