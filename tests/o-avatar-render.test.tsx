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
import { O_ACTION_FRAMES, O_ACTIONS, actionFor } from "../lib/brand/o-actions";
import { O_NAMES, type OName } from "../lib/brand/o-cast";

describe("OAvatar", () => {
  it("draws the vendored 1x file at its intrinsic size", () => {
    const html = renderToStaticMarkup(<OAvatar name="wizard" size={50} />);
    expect(html).toContain('src="/o/1x/wizard.png"');
    // The intrinsic box is always the real 50x50, whatever the rendered size:
    // it is what stops the page moving when the file arrives.
    expect(html).toContain('width="50"');
    expect(html).toContain('height="50"');
  });

  it.each([50, 100, 150, 200] as const)("renders at %spx through the size custom property", (size) => {
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

/**
 * The idle actions (MAR-587 Phase B).
 *
 * A screenshot cannot show motion, which is the whole reason these cases exist:
 * everything about the loop that can be wrong without a browser — which file,
 * how many frames, what happens to the eight characters that have no sheet — is
 * settled here, and the capture matrix is left with the question it is actually
 * good at.
 */
describe("OAvatar, animated", () => {
  it("paints the vendored sheet, one frame wide, when a surface asks for it", () => {
    const html = renderToStaticMarkup(<OAvatar name="ninja" size={200} action />);
    expect(html).toContain("--o-action:url(/o/actions/ninja-shuriken-toss.png)");
    // The frame count travels from the manifest rather than being written into
    // the stylesheet, so `background-size` and `steps()` cannot drift from the
    // pixels `pnpm brand:check` audits.
    expect(html).toContain(`--o-frames:${String(O_ACTION_FRAMES)}`);
    expect(html).toContain("--o-size:200px");
    expect(html).toContain('class="o-avatar is-action"');
  });

  it("animates every character in the cast, chef included, since MAR-615", () => {
    // Chef was one of the eight with no sheet before MAR-615 vendored the
    // rest of the library; asking it for `action` now draws its own loop
    // exactly like ninja, knight and wizard always did.
    const html = renderToStaticMarkup(<OAvatar name="chef" size={200} action />);
    expect(html).toContain("--o-action:url(/o/actions/chef-pancake-flip.png)");
    expect(html).toContain('class="o-avatar is-action"');
  });

  it("draws the still, exactly as before, for a character this build does not ship", () => {
    // No stand-in loop and no substitute character: "does this O move?" must
    // never become a fact about the agent, and it would be one the moment
    // DASH invented motion for a name it does not recognise. Every real
    // character has a sheet now, so this exercises the fallback the same way
    // `lib/store.ts`'s `storedAvatar` does for a row this build cannot read —
    // a name outside `OName` reaching the render path is the only way left to
    // hit it.
    const unknown = "pirate" as unknown as OName;
    const asked = renderToStaticMarkup(<OAvatar name={unknown} size={200} action />);
    const plain = renderToStaticMarkup(<OAvatar name={unknown} size={200} />);
    expect(asked).toBe(plain);
    expect(asked).toContain('src="/o/1x/pirate.png"');
    expect(asked).not.toContain("is-action");
  });

  it("is still by default, on every surface that has not asked", () => {
    for (const name of O_NAMES) {
      expect(renderToStaticMarkup(<OAvatar name={name} size={50} />)).not.toContain("is-action");
    }
  });

  it("stays silent, and takes a name only where one is passed", () => {
    const quiet = renderToStaticMarkup(<OAvatar name="wizard" size={200} action />);
    expect(quiet).toContain('aria-hidden="true"');
    expect(quiet).not.toContain("role=");

    // A background image has no alt, so an announced one has to carry the name
    // on the element itself rather than inherit it from the markup.
    const named = renderToStaticMarkup(<OAvatar name="wizard" size={200} action label="Wizard" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Wizard"');
    expect(named).not.toContain("aria-hidden");
  });

  it("keeps a caller's class beside its own", () => {
    expect(renderToStaticMarkup(<OAvatar name="knight" size={200} action className="x" />)).toContain(
      'class="o-avatar x is-action"',
    );
  });

  it("takes the character and nothing else", () => {
    // The strongest guarantee this feature has, and it is structural rather
    // than a promise: the loop is a function of the costume alone, so there is
    // no argument a status could arrive through even if a caller wanted one.
    for (const name of O_NAMES) {
      const action = actionFor(name);
      expect(action === null || action.character === name).toBe(true);
    }
    expect(O_ACTIONS.map((action) => action.character).sort()).toEqual([...O_NAMES].sort());
  });
});
