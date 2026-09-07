/**
 * The fleet route's own first paint must never be a fallback (MAR-882 redo).
 *
 * ## What broke, and why this file exists
 *
 * #349 gave the chief's composer a prefill by wrapping `AgentsPage`'s default
 * export in a `Suspense` boundary — the same shape `app/agents/detail/page.tsx`
 * already used — so an inner component could call `useSearchParams` for
 * `?ask=<agent>`. Its own CI was green: every render test in this repository
 * uses `renderToStaticMarkup`, which resolves synchronously and never shows a
 * `Suspense` fallback, so nothing here could have caught it.
 *
 * Master's own shell-smoke did, after the merge: `1. the UI renders:
 * {"headings":0}` at `dash-app://ui/`. In this app's static export, a
 * `Suspense` boundary above a page's `<h1>` makes the very first frame the
 * fallback — no heading, because the real tree that contains one has not
 * resolved yet — and that fallback is not a passing moment on a slow network,
 * it is what the exported HTML *is* until React hydrates and the boundary's
 * child suspends on `useSearchParams`. Reverted as #351.
 *
 * The redo (this packet) reads `?ask=` a different way — `ChiefChat` resolves
 * it from `window.location.search` directly, inside a mount effect, against
 * the `agents` prop it already receives; see that component's own header.
 * Nothing above `<h1>Agents</h1>` in `app/page.tsx` changed, and this file is
 * the guard that a future prefill idea cannot reintroduce the boundary that
 * broke it without failing a test first.
 *
 * ## Two proofs, because neither alone is enough
 *
 * A source grep for `Suspense` is the guard against the *literal* regression
 * — nobody can reach for `next/navigation`'s `useSearchParams` in this file
 * again without also importing the boundary it requires, and the import
 * itself is what this test forbids. But a grep proves nothing about what the
 * page actually renders, so the render assertion below is the other half:
 * `AgentsPage`, mounted the way `renderToStaticMarkup` mounts every page in
 * this suite — no effects fired, exactly the frame a static export serves
 * before hydration — must show the heading, not a loading placeholder.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import AgentsPage from "../app/page";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* Normalised at the read — a regex over source that anchors on a literal
   character is CRLF-blind, and a blind assertion here is a green one for the
   exact regression this file exists to catch. */
const pageSource = readFileSync(path.join(repoRoot, "app", "page.tsx"), "utf8").replace(
  /\r\n/g,
  "\n",
);

describe("the fleet route's first paint (MAR-882 redo)", () => {
  it("never wraps the page in Suspense, and never reads useSearchParams itself", () => {
    expect(pageSource).not.toMatch(/Suspense/);
    expect(pageSource).not.toMatch(/useSearchParams/);
  });

  it("renders the heading synchronously — the frame a static export actually serves", () => {
    // `renderToStaticMarkup` fires no effect, so `useView`'s own initial state
    // (`{ status: "loading" }`) is exactly what this renders — the same first
    // frame the packaged shell paints before its bridge ever answers. A
    // `Suspense` boundary above the heading would show its `fallback` here
    // instead, which is what `dash-app://ui/` proof 1 caught on master.
    const html = renderToStaticMarkup(<AgentsPage />);
    expect(html).toContain("<h1>Agents</h1>");
  });
});
