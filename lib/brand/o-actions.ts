/**
 * The O's idle actions, as DASH holds them (MAR-587 Phase B).
 *
 * `lib/brand/o-actions.json` is the audit record — vendored from orchestrateweb,
 * hash-pinned, and measured by `pnpm brand:check` down to which rectangle of
 * which frame is allowed to differ from the still. This is the typed view a
 * component compiles against, and it stands to that file exactly as
 * `o-cast.ts` stands to `o-cast.json`: the JSON is truth, this is the shape the
 * renderer can hold, and `checkActionModule` fails the build when they drift.
 *
 * Parsing the manifest at runtime instead would be the obvious shortcut and is
 * the wrong one twice over. It is 233 lines of per-frame pixel counts that
 * exist to be audited, not shipped, and it would put an unvalidated `JSON.parse`
 * of a vendored file on the render path of the app's first screen.
 *
 * ## The rule this module exists to be unable to break
 *
 * **The idle action is costume flavour, never status.** A ninja tossing a
 * shuriken says "this is the ninja"; it does not say the agent is healthy, busy,
 * connected or late — MAR-586's glance chips say all of that, in words, from
 * stored facts. So the only input to `actionFor` is the character, which is
 * itself assigned once at creation from a seed and never from state
 * (`o-cast.ts`). There is no second argument for a status to arrive through, and
 * `checkCostume` refuses an `action={…}` expression on the JSX side so one
 * cannot be smuggled in at the call site either.
 *
 * That is also why a character with no sheet simply draws its still. A
 * stand-in animation for the other eight would make "does this O move?" a fact
 * about DASH's asset library that a reader would inevitably try to read as a
 * fact about their agent.
 *
 * ## Pure by construction
 *
 * No `node:fs`, no store, no React — `tests/client-bundle.test.ts`'s rule, and
 * the same one `o-cast.ts` obeys for the same reason: this has to be importable
 * from the renderer.
 */

import type { OName } from "./o-cast";

/**
 * Frames per sheet, and it is one number for the whole cast on purpose.
 *
 * `checkActions` fails a set of sheets that disagree about frame count, because
 * one `steps()` and one duration cover all of them — a per-sheet frame count
 * would mean a per-sheet duration, and a per-sheet duration is a number that can
 * be chosen, which is one step from a number that can be chosen *by something*.
 */
export const O_ACTION_FRAMES = 8;

/** One character's idle loop: which sheet, and what the prop does. */
export interface OAction {
  /**
   * The manifest key, which is also the file's basename under
   * `public/o/actions/`. One string rather than a name and a path, so a sheet
   * that exists under one and not the other cannot be described at all.
   */
  readonly key: string;
  readonly character: OName;
  /** What the character does with the prop. Recorded, never rendered as copy. */
  readonly action: string;
}

/**
 * The sheets that exist, in the manifest's order.
 *
 * Three of eleven, and that asymmetry is the state of the art library rather
 * than a decision about these three characters. `pnpm o:actions` in
 * orchestrateweb produces more; each arrives here as vendored bytes plus a
 * manifest entry plus a line in this array, and `checkActionModule` fails if
 * any of the three arrive without the others.
 */
export const O_ACTIONS: readonly OAction[] = [
  { key: "ninja-shuriken-toss", character: "ninja", action: "shuriken-toss" },
  { key: "knight-sword-swing", character: "knight", action: "sword-swing" },
  { key: "wizard-fireball", character: "wizard", action: "fireball" },
];

/**
 * The idle loop for a character, or `null` where there is no sheet.
 *
 * `null` rather than a fallback: the caller draws the audited still, which is
 * what every surface drew before this issue. See the header for why a stand-in
 * would be worse than nothing.
 */
export function actionFor(name: OName): OAction | null {
  return O_ACTIONS.find((action) => action.character === name) ?? null;
}

/**
 * Where a sheet is served from.
 *
 * Same shape as the stills' `/o/1x/{name}.png`, and same reasoning: the
 * renderer is served from inside the install over its own scheme, so this is a
 * same-origin read off local disk with no network behind it.
 */
export function oActionSrc(action: OAction): string {
  return `/o/actions/${action.key}.png`;
}
