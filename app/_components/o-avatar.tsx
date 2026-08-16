import type { CSSProperties, ReactNode } from "react";

import { O_ACTION_FRAMES, actionFor, oActionSrc } from "../../lib/brand/o-actions";
import type { OName, OSize } from "../../lib/brand/o-cast";

/**
 * One of the O's, drawn (MAR-500, MAR-435 Phase 2).
 *
 * The component every avatar surface sits on. It ships on no surface in this
 * issue — BRAND-03/04/05 are the surfaces — so what is here is the contract they
 * will share, and the rules `scripts/brand-check.mjs` enforces against them.
 *
 * ## A plain `<img>`, never an image optimizer
 *
 * Not `next/image`. Optimisation re-encodes and resamples, and resampling pixel
 * art is how it stops being pixel art: a 50×50 sprite served as a "responsive"
 * 63px WebP is a blurry sprite, which reads as a mistake rather than as a style.
 * These files are 645–905 bytes each; there is nothing for an optimiser to win.
 *
 * ## Why it loads eagerly, where SITE's sprite loads lazily
 *
 * SITE's `OSprite` defaults to `loading="lazy"` because a visitor over a network
 * pays for eleven sprites they may never scroll to. DASH's renderer is served
 * from inside the install over its own scheme (`lib/shell/renderer-scheme.ts`) —
 * there is no network, and deferring a 700-byte read off local disk buys nothing
 * and can cost a frame on the avatar beside a page title. So there is no
 * `priority` prop to get wrong, which is the version of that API DASH can have
 * and SITE cannot.
 *
 * ## What it deliberately does not do
 *
 * **No focus styling.** BRAND-05's clickable sprites need `--focus` and never
 * `--accent` (`app/tokens.css` says why: a focus ring matching the primary
 * button is invisible on the primary button). A ring baked in here would be a
 * ring that surface has to fight, so the avatar stays a picture and whatever
 * wraps it owns its own focus.
 *
 * **No character choosing.** `name` is a value the caller already holds — the
 * one persisted on the agent's record at creation. A costume is recognition,
 * never status: the brand check fails a `name={…}` that reads as a condition or
 * a status word.
 *
 * ## Motion arrived in MAR-587, and is opt-in per surface
 *
 * `action` opts a surface into the character's vendored idle loop — the ninja
 * tosses a shuriken, the knight swings, the wizard throws a fireball. Still
 * opt-in and never a default: a surface with nothing to say about an agent's
 * state (the header, the settings drawer, a picker option) has to ask for the
 * loop by name.
 *
 * ## Why the fleet strip can carry both loops (MAR-615)
 *
 * The bottom-edge strip is the one surface where a second motion system
 * already exists — `app/_components/fleet-strip.tsx` sets `.is-working`,
 * `.is-waiting` or `.is-walking` from real signals (MAR-544), and each of
 * those rules sets `animation` on `.o-avatar` directly. That used to be the
 * whole argument against opting the strip in here too: two rules writing the
 * same CSS property sounds like "one of them is lying."
 *
 * It is not, because of *which* rule wins. `.fleet-strip-o.is-working .o-avatar`
 * carries three classes of specificity against `.o-avatar.is-action`'s two, so
 * real state always overrides the costume loop the moment there is state to
 * show — the agent hops, beckons or paces on its still frame, exactly as
 * before MAR-615. Only `.is-sleeping`, which MAR-544 deliberately gives no
 * rule of its own, leaves nothing overriding `.is-action`, so a quiet agent
 * breathes its idle loop instead of standing dead still. `tests/fleet-motion.
 * test.tsx` pins the specificity ordering so a future stylesheet edit cannot
 * invert it without a test failing first.
 *
 * The loop rides `var(--motion-idle)` from `app/tokens.css`, which is zeroed
 * under `prefers-reduced-motion: reduce` — so stillness needs no per-surface
 * code, and the brand check refuses a literal duration on an avatar rule to
 * keep it that way. It also pauses whole while the window is hidden
 * (`WindowVisibility`), and it steps rather than eases: eight repaints per
 * cycle, no JavaScript per frame, no timer.
 */
export interface OAvatarProps {
  /**
   * Which character. Not chosen here and not chosen from state: an agent's
   * character is assigned once at creation and stored (`lib/store.ts`), and this
   * prop is that stored value travelling to a page.
   */
  name: OName;
  /**
   * Rendered size, in whole multiples of the 50px source.
   *
   * Required rather than defaulted. A default would be a size chosen by whoever
   * wrote this component for a surface that did not exist yet, and the two sizes
   * mean different things — 50 is a row, 100 is a portrait. Making it a decision
   * costs one prop and removes a class of "why is it small here" bug.
   */
  size: OSize;
  /**
   * Accessible name. **Omit it**, which is the common case.
   *
   * The avatar beside an agent's name repeats the agent's name, and a screen
   * reader announcing "wizard" there adds a costume nobody asked about — worse,
   * it is the one place where the costume could be mistaken for information
   * about the agent. Pass it only where the character genuinely *is* the
   * information — the fleet's chief band (MAR-615) is the one surface in DASH
   * that does, since nothing else there names who is speaking.
   * `scripts/brand-check.mjs`'s `LABEL_ALLOWLIST` names that one file, and
   * everywhere else the rule holds with no exceptions.
   */
  label?: string;
  className?: string;
  /**
   * Draw the character's idle loop where one has been vendored (MAR-587).
   *
   * **A literal, never an expression.** `scripts/brand-rules.mjs` fails
   * `action={anything}` that is not `true` or `false`, because the whole rule
   * this feature lives under is that an idle action is costume flavour and never
   * status — and `action={agent.isHealthy}` is precisely the shape that would
   * make "is it moving?" a fact about the agent. Whether a surface animates is a
   * decision about the surface, taken once, in the source.
   *
   * Where the character has no sheet — eight of the eleven, today — this changes
   * nothing at all and the audited still is drawn exactly as it was before. No
   * stand-in loop, and no reordering to put the animated ones first: both would
   * turn DASH's asset library into something a reader tries to read.
   */
  action?: boolean;
}

export function OAvatar({ name, size, label, className, action = false }: OAvatarProps): ReactNode {
  const decorative = label === undefined;
  const idle = action ? actionFor(name) : null;
  const classes = className === undefined ? "o-avatar" : `o-avatar ${className}`;

  if (idle !== null) {
    /*
     * A `<span>` painted with the sheet, not an `<img>` with a background: the
     * sprite has a transparent background and the still would show *through*
     * the frames, drawing the character twice a few pixels apart.
     *
     * The sheet is eight frames laid left to right, so the box stays one frame
     * wide and `.o-avatar.is-action` steps `background-position` across it.
     * Both numbers it needs travel as custom properties rather than being
     * written into the stylesheet — the frame count belongs to the manifest
     * `pnpm brand:check` audits, and a second copy of it in CSS is a second copy
     * that can disagree with the pixels.
     */
    return (
      <span
        className={`${classes} is-action`}
        style={
          {
            "--o-size": `${size}px`,
            "--o-frames": O_ACTION_FRAMES,
            "--o-action": `url(${oActionSrc(idle)})`,
          } as CSSProperties
        }
        /*
         * Decorative by default, like the still. `role="img"` only when a
         * caller passed a name — a background image has no `alt`, so the
         * accessible name has to be attached rather than inherited from the
         * markup, and an unnamed `role="img"` would announce "image" and
         * nothing else.
         */
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative ? true : undefined}
      />
    );
  }

  return (
    <img
      src={`/o/1x/${name}.png`}
      /*
       * The intrinsic size is the real 50×50, so the browser reserves the right
       * box before the file arrives and nothing on the page moves when it does.
       * The rendered size comes from `--o-size` below, which `.o-avatar` in
       * globals.css turns into width and height.
       */
      width={50}
      height={50}
      alt={decorative ? "" : label}
      aria-hidden={decorative ? true : undefined}
      className={classes}
      style={{ "--o-size": `${size}px` } as CSSProperties}
      decoding="async"
      draggable={false}
    />
  );
}
