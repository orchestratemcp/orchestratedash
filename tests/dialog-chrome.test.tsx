/**
 * A dialog is not a page of the app (MAR-534).
 *
 * `electron/credential-prompt.ts` and `electron/approval-popup.ts` each open a
 * separate `BrowserWindow` onto a route in DASH's own static export. They are one
 * question and one answer. Until this change they also got a title bar naming a
 * surface the window is not on, five links to places the window cannot navigate
 * to, a density control for a page with one field, and a skip link past all of
 * it — which was the first thing a keyboard user reached in a password prompt.
 *
 * `isSeparateWindowRoute` already existed and already did exactly this job for
 * the fleet strip. The chrome predates it by three issues and nobody joined them
 * up, which is the whole defect.
 *
 * ## Why this is a render test and not a screenshot
 *
 * Because the failure is *presence*, and a screenshot of a dialog with a
 * navigation bar in it looks like a screenshot of a dialog. `electron/capture.ts`
 * does not photograph either of these routes and could not usefully — the
 * credential prompt renders its read-only branch outside a real prompt window —
 * so an assertion about what is in the markup is the check that can exist.
 *
 * The two assertions that matter are the negative ones. The positive case is
 * here so that a component which started returning `null` everywhere would fail
 * rather than pass this file completely.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SEPARATE_WINDOW_ROUTES, SURFACES, isSeparateWindowRoute } from "../app/_data/routes";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/*
 * The route the component under test believes it is on. `usePathname` is a hook
 * into Next's router, which does not exist under `renderToStaticMarkup`; this is
 * the smallest possible stand-in and it is set per case below.
 */
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

describe("the app chrome on a route that is its own window", () => {
  it("has at least one such route to test, and they are the two dialogs", () => {
    // A deny-list that quietly emptied would make every assertion below pass by
    // testing nothing. See `app/_data/routes.ts` for why it is a deny-list.
    expect([...SEPARATE_WINDOW_ROUTES]).toEqual(["/credential-prompt", "/approval-popup"]);
  });

  for (const route of SEPARATE_WINDOW_ROUTES) {
    it(`renders nothing at all on ${route}`, () => {
      expect(markupAt(route)).toBe("");
    });
  }

  it("renders no navigation link to any surface from inside a dialog", () => {
    /*
     * The load-bearing one, and it is written against the surface list rather
     * than against the string "app-nav": a chrome that kept the links and lost
     * only its wrapper class would pass a check for the class name, and the
     * user-visible defect is the *links* — an exit the window cannot honour.
     */
    for (const route of SEPARATE_WINDOW_ROUTES) {
      const markup = markupAt(route);
      for (const surface of SURFACES) {
        expect(markup, `${surface.label} must not be offered inside ${route}`).not.toContain(
          surface.label,
        );
      }
    }
  });

  it("takes the skip link with it", () => {
    // It exists because six navigation links sit between the window and the
    // content. Where there are none it is a shortcut past nothing, and it would
    // be the first thing a keyboard user reaches in a one-question dialog.
    for (const route of SEPARATE_WINDOW_ROUTES) {
      expect(markupAt(route)).not.toContain("skip-link");
    }
  });
});

describe("the app chrome on an ordinary page", () => {
  it("still renders the bar, every surface and the skip link", () => {
    const markup = markupAt("/");
    expect(isSeparateWindowRoute("/")).toBe(false);
    expect(markup).toContain("app-chrome");
    expect(markup).toContain("skip-link");
    for (const surface of SURFACES) {
      expect(markup).toContain(surface.label);
    }
  });

  it("puts the skip link before the header, so it is the first thing focus reaches", () => {
    const markup = markupAt("/runs");
    expect(markup.indexOf("skip-link")).toBeGreaterThanOrEqual(0);
    expect(markup.indexOf("skip-link")).toBeLessThan(markup.indexOf("app-chrome"));
  });

  it("announces the active surface rather than only colouring it", () => {
    // MAR-528 replaced MAR-440's 2px active bar with a solid block of electric
    // blue. The bar was never what carried the state to somebody who cannot see
    // it; this attribute was, and it has to survive the restyle.
    expect(markupAt("/settings")).toContain('aria-current="page"');
  });
});

describe("the layout keeps its scrolling track when the bands are absent", () => {
  /*
   * The consequence of the fix, and the one thing it could have broken.
   *
   * `body` is a three-row grid. On a dialog route the chrome and the strip both
   * render nothing, so auto-placement would put `main` in row 1 — the `auto`
   * track — and `body`'s own `overflow: hidden` would clip a prompt taller than
   * its content height with no scroller anywhere. Naming the row costs an
   * ordinary page nothing, because an empty `auto` row collapses to zero.
   */
  const css = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8");

  function ruleFor(selector: string): string {
    const match = new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]*)\\}`).exec(css);
    if (match === null) {
      throw new Error(`app/globals.css has no rule for ${selector}`);
    }
    return match[1] as string;
  }

  it("names main's row explicitly", () => {
    expect(ruleFor("main")).toMatch(/grid-row:\s*2\s*;/);
  });

  it("names the two conditional bands' rows too", () => {
    expect(ruleFor("\\.app-chrome")).toMatch(/grid-row:\s*1\s*;/);
    expect(ruleFor("\\.fleet-strip")).toMatch(/grid-row:\s*3\s*;/);
  });
});
