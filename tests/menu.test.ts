/**
 * The application menu is a guided-path surface (MAR-423).
 *
 * It carries product copy in front of a novice, so the plain-language rule
 * applies to it exactly as it applies to a dialog — and a menu is the easiest
 * surface in any application to add a word to without anyone reviewing it.
 */

import { describe, expect, it } from "vitest";

import { applicationMenu, menuLabels, type MenuSpec } from "../lib/shell/menu";
import { expectPlainLanguage } from "./helpers/plain-language";

const PLATFORMS: NodeJS.Platform[] = ["win32", "darwin", "linux"];

function itemsOf(menus: MenuSpec[]): MenuSpec["items"] {
  return menus.flatMap((menu) => menu.items);
}

describe("the application menu", () => {
  it("puts the sample agent first, where an empty DASH has nothing else worth clicking", () => {
    for (const platform of PLATFORMS) {
      const first = applicationMenu(platform, "OrchestrateDASH")[0]?.items[0];
      expect(first?.action, platform).toBe("sample_agent");
      expect(first?.label, platform).toBe("Try a sample agent…");
    }
  });

  it("reads as plain language on every platform", () => {
    for (const platform of PLATFORMS) {
      // The ampersands are Windows accelerator markers, not words.
      const labels = menuLabels(applicationMenu(platform, "OrchestrateDASH")).map((label) =>
        label.replace(/&/g, ""),
      );
      expectPlainLanguage(labels);
    }
  });

  it("leaves the platform to word everything it already has a word for", () => {
    // Roles are translated by Electron. Our own "Zoom In" would be English in
    // front of somebody whose entire operating system is not.
    const items = itemsOf(applicationMenu("darwin", "OrchestrateDASH"));
    const authored = items.filter((item) => item.label !== undefined);
    expect(authored).toHaveLength(1);
    expect(authored[0]?.action).toBe("sample_agent");
  });

  it("gives every authored item an action, so nothing in the menu does nothing", () => {
    for (const platform of PLATFORMS) {
      for (const item of itemsOf(applicationMenu(platform, "OrchestrateDASH"))) {
        if (item.label !== undefined && item.separator !== true) {
          expect(item.action, item.label).toBeDefined();
        }
      }
    }
  });

  it("uses the app's own name for the first menu on macOS, and DASH elsewhere", () => {
    expect(applicationMenu("darwin", "OrchestrateDASH")[0]?.label).toBe("OrchestrateDASH");
    expect(applicationMenu("win32", "OrchestrateDASH")[0]?.label).toBe("&DASH");
  });
});
