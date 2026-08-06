/**
 * The avatar, rendered (MAR-500).
 *
 * MAR-500's "proven" bar is a witnessed render in the installed shell at both
 * sizes, in both themes, with `prefers-reduced-motion` honoured. That is a
 * screenshot somebody takes, and it needs a surface — which is BRAND-03/04/05,
 * and out of this issue's scope. This is what can be checked without one, and
 * it is the half a screenshot is worst at anyway: the attributes.
 *
 * A picture of a 50px avatar looks exactly like a picture of a 50px avatar that
 * is decorative when it should be announced, or announced when it should be
 * silent. That difference is here.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OAvatar } from "../app/_components/o-avatar";

describe("OAvatar", () => {
  it("draws the vendored 1x file at its intrinsic size", () => {
    const html = renderToStaticMarkup(<OAvatar name="wizard" size={50} />);
    expect(html).toContain('src="/o/1x/wizard.png"');
    // The intrinsic box is always the real 50x50, whatever the rendered size:
    // it is what stops the page moving when the file arrives.
    expect(html).toContain('width="50"');
    expect(html).toContain('height="50"');
  });

  it.each([50, 100] as const)("renders at %spx through the size custom property", (size) => {
    const html = renderToStaticMarkup(<OAvatar name="ninja" size={size} />);
    expect(html).toContain(`--o-size:${size}px`);
    // The class is what `app/globals.css` hangs `image-rendering: pixelated` and
    // the width/height on. Losing it silently would give a 50x50 avatar drawn
    // smoothly, which reads as a broken image rather than as a style.
    expect(html).toContain('class="o-avatar"');
  });

  it("is silent by default", () => {
    const html = renderToStaticMarkup(<OAvatar name="chef" size={50} />);
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });

  it("takes an accessible name only when one is passed", () => {
    const html = renderToStaticMarkup(<OAvatar name="chef" size={100} label="Chef" />);
    expect(html).toContain('alt="Chef"');
    expect(html).not.toContain("aria-hidden");
  });

  it("keeps its own class when a caller adds one", () => {
    const html = renderToStaticMarkup(<OAvatar name="robot" size={50} className="fleet-portrait" />);
    expect(html).toContain('class="o-avatar fleet-portrait"');
  });

  it("loads eagerly, because there is no network behind the packaged renderer", () => {
    // SITE lazy-loads its sprites; DASH's renderer is served from inside the
    // install over its own scheme, where deferring a 700-byte read buys nothing
    // and can cost a frame. An explicit loading attribute here would be the bug.
    expect(renderToStaticMarkup(<OAvatar name="king" size={50} />)).not.toContain("loading=");
  });
});
