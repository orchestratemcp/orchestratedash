"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import {
  DENSITY_ATTRIBUTE,
  DENSITY_STORAGE_KEY,
  DEFAULT_DENSITY,
  describeDensity,
  nextDensity,
  parseDensity,
  type Density,
} from "../../lib/views/density";

/**
 * The density opt-in (MAR-420).
 *
 * One button, two states, and the whole of what it changes is spacing — see
 * `lib/views/density.ts` for why that constraint is the point rather than a
 * limitation.
 *
 * ## Why the attribute is written to the document, not held in React state
 *
 * `[data-density="compact"]` in `app/tokens.css` re-declares four custom
 * properties, and every rule in the app resolves against them. So one attribute
 * on `<html>` restyles the entire interface with no component knowing it
 * happened, and no page has to accept a density prop it would only pass
 * downwards. The React state here exists solely to label this button.
 *
 * ## The flash, and the script that prevents it
 *
 * The renderer is a **static export**: this component's first render is a build
 * artefact, produced on a machine that has never met the user. So the honest
 * sequence is comfortable-then-compact, and on a slow first paint that is a
 * visible jump of every row on the page.
 *
 * `DensityScript` below runs before the body renders and sets the attribute from
 * storage, so the first frame is already right. It is duplicated logic — the
 * same parse, in an inline script — and that is the accepted cost of a static
 * export having no server to ask.
 */
export function DensityToggle(): ReactNode {
  const [density, setDensity] = useState<Density>(DEFAULT_DENSITY);

  /*
   * Adopt whatever the pre-paint script already applied, rather than re-reading
   * storage and risking a different answer. The document is the source of truth
   * for the current density precisely because the script got there first.
   */
  useEffect(() => {
    setDensity(parseDensity(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)));
  }, []);

  const apply = (): void => {
    const next = nextDensity(density);
    document.documentElement.setAttribute(DENSITY_ATTRIBUTE, next);
    setDensity(next);
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next);
    } catch {
      /*
       * Storage can be unavailable — a locked-down profile, a quota, a user who
       * cleared it mid-session. The setting still applies to this window, which
       * is what they just asked for; it simply will not be there next time.
       * Failing the click over it would take away the thing that did work.
       */
    }
  };

  const copy = describeDensity(density);

  return (
    <button type="button" className="density-toggle" onClick={apply} title={copy.description}>
      {/*
        The glyph is decorative and the label is the accessible name. Two bars
        for roomy, four for dense — a picture of the thing rather than an
        abstract icon, which is the only kind of icon that works without a
        legend.
      */}
      <span aria-hidden="true" className="density-glyph">
        {density === "comfortable" ? "☰" : "≣"}
      </span>
      <span className="density-label">{copy.label}</span>
    </button>
  );
}

/**
 * Set the density before the first paint.
 *
 * Rendered into the document by `app/layout.tsx`. The string is ours end to end
 * — no value from storage is interpolated into it, only compared against a
 * literal — and it writes an attribute rather than markup.
 *
 * `suppressHydrationWarning` is not needed: this touches `<html>`'s attribute,
 * not any element React rendered.
 */
export function DensityScript(): ReactNode {
  const script = [
    "(function(){try{",
    `var v=window.localStorage.getItem(${JSON.stringify(DENSITY_STORAGE_KEY)});`,
    `if(v==="compact"){document.documentElement.setAttribute(${JSON.stringify(DENSITY_ATTRIBUTE)},"compact");}`,
    "}catch(e){}})()",
  ].join("");
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
