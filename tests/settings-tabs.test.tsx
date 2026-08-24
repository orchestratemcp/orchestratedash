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
 *
 * The generic checks below (routes exist, nothing dropped, headings, current
 * tab) all render the strip through `SettingsTabsStrip` with
 * `reportingConfigured: true` — a DASH that has configured a LAB, which is
 * the state where all seven tabs are the true membership. MAR-742's own gate
 * — Reporting is invisible until then — has its own describe block below,
 * against both booleans directly, since that is the one property the
 * hook-connected `SettingsTabs` cannot be asked for without a data source.
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

const { SettingsTabsStrip } = await import("../app/_components/settings-tabs");

/** Every generic check below assumes a DASH that has configured a LAB. */
function markupAt(route: string): string {
  pathname = route;
  return renderToStaticMarkup(<SettingsTabsStrip reportingConfigured={true} />);
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
  it("carries the four labels that used to be four sidebar rows, plus three later tabs", () => {
    // MAR-599's Preferences, and MAR-642's AI — which is second rather than
    // appended, because it is the tab a DASH holding no key most needs somebody
    // to find. The order is asserted and not just the membership: a tab that
    // quietly moved to the end would still pass a set comparison.
    //
    // MAR-479's Reporting is third, immediately after Notifications, and the
    // adjacency is the point rather than a preference: those two tabs are the
    // complete answer to "what does DASH send, and to whom", and somebody
    // auditing that should find the second without knowing it exists.
    expect(SETTINGS_TABS.map((tab) => tab.label)).toEqual([
      "Connections",
      "AI",
      "Notifications",
      "Reporting",
      "Servers",
      "Add agent",
      "Preferences",
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

/**
 * MAR-742: the tab a person who has never heard of LAB should never see.
 *
 * `SettingsTabsStrip` takes the decided boolean as a prop rather than reading
 * a view itself, so both states render synchronously here — no data source,
 * no `useEffect` to flush — the same split `ReportingSettings` uses so
 * `tests/reporting-render.test.tsx` can render it without one.
 */
describe("the reporting tab is invisible until a LAB is configured", () => {
  it("leaves it out of the strip on an unconfigured DASH", () => {
    pathname = SETTINGS_ROOT;
    const html = renderToStaticMarkup(<SettingsTabsStrip reportingConfigured={false} />);
    expect(html).not.toContain("/settings/reporting");
    expect(html).not.toContain(">Reporting<");
  });

  it("draws every other tab regardless", () => {
    pathname = SETTINGS_ROOT;
    const html = renderToStaticMarkup(<SettingsTabsStrip reportingConfigured={false} />);
    for (const tab of SETTINGS_TABS) {
      if (tab.href === "/settings/reporting") {
        continue;
      }
      expect(html, tab.label).toContain(`href="${tab.href}"`);
    }
  });

  it("draws it, in its usual place, once a LAB is configured", () => {
    pathname = SETTINGS_ROOT;
    const html = renderToStaticMarkup(<SettingsTabsStrip reportingConfigured={true} />);
    expect(html).toContain('href="/settings/reporting"');
    expect(html).toContain(">Reporting<");
  });

  it("still marks it current when it is the tab somebody is standing on", () => {
    const html = markupAt("/settings/reporting");
    expect(html).toContain('href="/settings/reporting" class="settings-tab is-active" aria-current="page"');
  });
});

describe("the entrances that outlived the sidebar rows", () => {
  it("keeps an Add agent link on the fleet, pointing at the tab", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(path.join(repoRoot, "app", "_components", "fleet-rail.tsx"), "utf8");
    expect(source).toContain('href="/settings/add-agent"');
  });
});

/**
 * The heading does not repeat the tab (MAR-593, generalised by MAR-599).
 *
 * MAR-593 fixed this for Connections alone — `<h1>Accounts and keys</h1>`
 * under a CONNECTIONS tab — and its own handoff left the other three as an
 * open item. MAR-599 fixed Servers and Notifications the same way. Add agent
 * is the one deliberate exception: it is under Henrik's hold and moved
 * verbatim by MAR-592, so its `<h1>Add agent</h1>` still says the tab word —
 * on purpose, not by oversight.
 *
 * A source scan rather than a full render: three of these five pages read
 * through `useView` and need a data source to render past their loading
 * state, and the fact under test — which literal string sits inside the
 * `<h1>` tag — is as visible in the source as it would be in the markup.
 */
describe("the heading does not repeat the tab it is under", () => {
  const HELD_VERBATIM = new Set(["Add agent"]);

  it("says what the surface is, not the word the tab already said", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const tab of SETTINGS_TABS) {
      if (HELD_VERBATIM.has(tab.label)) {
        continue;
      }
      const segments = tab.href.replace(/^\//, "").split("/");
      const file = path.join(repoRoot, "app", ...segments, "page.tsx");
      const source = await readFile(file, "utf8");
      const heading = /<h1>([^<]*)<\/h1>/.exec(source);
      expect(heading, `${tab.href} has no plain <h1>text</h1>`).not.toBeNull();
      expect(
        (heading as RegExpExecArray)[1],
        `${tab.href}'s <h1> repeats its tab label "${tab.label}"`,
      ).not.toBe(tab.label);
    }
  });
});
