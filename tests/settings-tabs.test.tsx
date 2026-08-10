/**
 * Settings, and the four surfaces that moved into it (MAR-592).
 *
 * The screenshots answer what it looks like. These are the claims a photograph
 * cannot make, and every one of them is a way this change could be quietly
 * wrong while looking right:
 *
 * 1. **The tabs are real routes.** The whole justification for a nested layout
 *    over a `useState` tab switcher is that `dash://open` can name a surface,
 *    the capture harnesses photograph a path, and existing links point at
 *    pages. A tab whose route has no page file is a link to a blank window —
 *    and in a *static export* that failure appears at build time on somebody
 *    else's machine, not here.
 * 2. **Nothing was dropped in the move.** Four sidebar rows became four tabs.
 *    The test that four exist is worth little; the test that they are the same
 *    four, by label, is what catches a rename or a quiet deletion.
 * 3. **The title bar still says where you are.** `surfaceFor` has to resolve
 *    all four routes to Settings, or the window titles itself "Agents" on the
 *    Servers page — the exact class of two-sources-disagreeing defect
 *    `app/_data/routes.ts` was written to prevent.
 * 4. **The add-agent entrance survived leaving the sidebar.** It is under a
 *    hold and being tried by a person today. Losing the way in would not fail
 *    any other test here, because the page itself would still be perfect.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

import {
  SETTINGS_ROOT,
  SETTINGS_TABS,
  SURFACES,
  isSettingsRoute,
  settingsTabFor,
  surfaceFor,
} from "../app/_data/routes";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pathname = SETTINGS_ROOT;

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

const { SettingsTabs } = await import("../app/_components/settings-tabs");

function markupAt(route: string): string {
  pathname = route;
  return renderToStaticMarkup(<SettingsTabs />);
}

describe("every tab is a route with a page behind it", () => {
  it("has a page file for each tab, at the address the tab links to", () => {
    for (const tab of SETTINGS_TABS) {
      // `/settings` -> app/settings/page.tsx; `/settings/servers` ->
      // app/settings/servers/page.tsx. A static export builds exactly this.
      const segments = tab.href.replace(/^\//, "").split("/");
      const file = path.join(repoRoot, "app", ...segments, "page.tsx");
      expect(existsSync(file), `${tab.href} has no page at ${file}`).toBe(true);
    }
  });

  it("leaves no page behind at the four addresses these surfaces vacated", () => {
    // A stale copy would still build, still be reachable by an old link, and
    // would drift from the live one the first time either is edited.
    for (const stale of ["connections", "notifications", "hosts", path.join("agents", "add")]) {
      const file = path.join(repoRoot, "app", stale, "page.tsx");
      expect(existsSync(file), `${stale} still has a page`).toBe(false);
    }
  });

  it("puts every tab under Settings, so the strip is never rendered beside itself", () => {
    for (const tab of SETTINGS_TABS) {
      expect(isSettingsRoute(tab.href), `${tab.href} is not inside Settings`).toBe(true);
    }
  });
});

describe("nothing was dropped on the way in", () => {
  it("carries the four labels that used to be four sidebar rows", () => {
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "Connections",
      "Notifications",
      "Servers",
      "Add agent",
    ]);
  });

  it("leaves four destinations in the sidebar, Settings among them", () => {
    expect(SURFACES.map((surface) => surface.label)).toEqual([
      "Agents",
      "Work inbox",
      "Runs",
      "Settings",
    ]);
  });

  it("titles the window Settings on all four tabs, not just the first", () => {
    // The failure this catches: prefix matching that resolves
    // `/settings/servers` to the root surface, so the bar says "Agents" on a
    // page about servers.
    for (const tab of SETTINGS_TABS) {
      expect(surfaceFor(tab.href).label, `${tab.href} titles wrong`).toBe("Settings");
    }
  });
});

describe("which tab is current", () => {
  it("resolves each tab's own route to itself", () => {
    for (const tab of SETTINGS_TABS) {
      expect(settingsTabFor(tab.href).href, `${tab.href} resolves elsewhere`).toBe(tab.href);
    }
  });

  it("does not let the index tab swallow the other three", () => {
    // `/settings` prefixes every other tab. Exact-only matching is the whole
    // reason `settingsTabFor` is not a one-line `startsWith`, and this is the
    // assertion that would fail if somebody simplified it back.
    expect(settingsTabFor("/settings/servers").href).toBe("/settings/servers");
    expect(settingsTabFor("/settings/notifications").href).toBe("/settings/notifications");
    expect(settingsTabFor(SETTINGS_ROOT).href).toBe(SETTINGS_ROOT);
  });

  it("announces exactly one current tab, on every tab", () => {
    for (const tab of SETTINGS_TABS) {
      const markup = markupAt(tab.href);
      expect(markup.match(/aria-current="page"/g), `${tab.href}`).toHaveLength(1);
    }
  });

  it("renders links rather than an ARIA tablist", () => {
    // `role="tab"` promises arrow-key roving focus and a panel swapped in
    // place. These navigate. Claiming the role without the behaviour is worse
    // than claiming nothing — see the component's own note.
    const markup = markupAt(SETTINGS_ROOT);
    expect(markup).not.toContain('role="tab"');
    expect(markup).not.toContain('role="tablist"');
    for (const tab of SETTINGS_TABS) {
      expect(markup).toContain(`href="${tab.href}"`);
    }
  });
});

describe("the entrances that outlived the sidebar rows", () => {
  const fleet = path.join(repoRoot, "app", "page.tsx");

  it("keeps an Add agent link on the fleet, pointing at the tab", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(fleet, "utf8");
    expect(source).toContain('href="/settings/add-agent"');
  });
});
