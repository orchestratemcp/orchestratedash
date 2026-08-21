/**
 * What the chief says, and everything it is not allowed to say (MAR-612,
 * narrowed to fleet-only at MAR-669).
 *
 * The chief stands under the cards and gives a sentence about the fleet —
 * `docs/design-brief.md`'s "they should be able to ask, and get a sentence",
 * given without being asked. It spoke about the agent in the middle too,
 * until Henrik's MAR-669 screenshot asked for that removed: *"the chief band
 * speaks about the fleet as a whole and nothing else."* `describeChief` and
 * its per-agent cases went with it — this file's own tests for them went
 * too, on the same terms MAR-642 packet 4 deleted `DeployPanel`'s: every
 * claim they made is still made, just not by a function this module keeps.
 *
 * A character in a speech position is the easiest place in an interface to
 * smuggle a claim nobody can source, so most of what remains is about the
 * chief having nothing of its own to say: every string it returns either
 * arrived already worded or is a fixed literal.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHIEF_NAME, CHIEF_WAITING, describeFleetSummary } from "../lib/copy/chief";
import type { FleetCardStatus } from "../lib/copy/fleet-status";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A source file, with its line endings normalised to `\n`.
 *
 * The normalisation is the whole point and it is not cosmetic. This repository
 * has no `.gitattributes` and Git's `core.autocrlf` is `true` on Windows, so
 * every file in a Windows checkout is CRLF on disk and LF in CI. A pattern
 * anchored on `\n` therefore matches in CI and fails on the machine this
 * project is actually developed on — which is what happened to `chiefBand`
 * below, silently, from the day it was written.
 *
 * Normalising at the read rather than fixing each pattern is deliberate: it
 * makes every regex in this file line-ending agnostic at once, including the
 * ones somebody adds later without thinking about it.
 */
function source(...segments: string[]): string {
  return readFileSync(path.join(repoRoot, ...segments), "utf8").replace(/\r\n/g, "\n");
}

const chiefSource = source("lib", "copy", "chief.ts");
const listSource = source("app", "_components", "fleet-list.tsx");

/**
 * The body of `ChiefBand`, or a failure that says so.
 *
 * Taken once, at module scope, and **throwing rather than returning null** —
 * which is the half of this that was a real defect rather than a line-ending
 * quirk. Both cases below used to run the regex themselves and fall back to
 * `band?.[1] ?? ""`, so on Windows the second one asserted that the empty
 * string does not contain "OAvatar". It passed for years without reading a
 * single character of the component.
 *
 * An assertion built on an optional match is an assertion that reports success
 * when it has nothing to check. If this component is ever renamed or moved,
 * the honest outcome is a loud failure here, not four quiet passes.
 */
function chiefBand(): string {
  const matched = /export function ChiefBand\(([\s\S]*?)\n}\n/.exec(listSource);
  if (matched === null) {
    throw new Error(
      "ChiefBand could not be found in app/_components/fleet-list.tsx — " +
        "every assertion about what the band draws would be vacuous, so this fails instead",
    );
  }
  return matched[1] ?? "";
}

const BAND = chiefBand();

describe("the fleet summary, for when nothing is selected (MAR-639)", () => {
  const S = (status: FleetCardStatus | null): FleetCardStatus | null => status;

  it("counts what needs you and what is working, Henrik's own example", () => {
    expect(
      describeFleetSummary([S("needs_input"), S("needs_input"), S("working"), S("completed")]),
    ).toBe("2 need you, 1 working.");
  });

  it("keeps the verb singular for exactly one", () => {
    expect(describeFleetSummary([S("needs_input")])).toBe("1 needs you.");
  });

  it("says nothing needs you rather than an empty sentence when the fleet is calm", () => {
    expect(describeFleetSummary([S("completed"), S(null)])).toBe("Nothing needs you right now.");
  });

  it("falls back to the waiting line for a fleet with nothing in it", () => {
    // Not a state `FleetList` produces — `app/page.tsx` draws its own empty
    // state before this band ever mounts — kept as the honest answer to a
    // state that should not exist rather than deleted.
    expect(describeFleetSummary([])).toBe(CHIEF_WAITING);
  });
});

describe("the chief invents nothing", () => {
  it("has no clock and no store", () => {
    /*
     * MAR-547's ruling against `CPU LOAD 87%`, enforced at the module's edge: a
     * pure copy module that cannot reach a database or a clock cannot round a
     * missing answer up into a claim. `describeFleetSummary`'s only input is a
     * list of statuses somebody else already computed.
     */
    expect(chiefSource).not.toMatch(/\bnew Date\b|\bDate\.now\b|Math\.random/);
    expect(chiefSource).not.toMatch(/from "\.\.\/(db|store|views\/glance)"/);
  });
});

describe("the chief is not the Chief chat", () => {
  it("draws no input a person could type into and get nothing back from", () => {
    /*
     * `ChiefBand` itself renders no box — `<ChiefChat />` is a component
     * reference, not inline markup, and that component is where the real
     * textarea lives (MAR-648). `app/_components/ask.tsx`'s rule still holds
     * either way: never a dead input.
     *
     * Asserted against the band's source rather than against a render, because the
     * defect this prevents is somebody adding the box before the thing behind it
     * exists, and that arrives as markup rather than as a state.
     */
    expect(BAND).not.toMatch(/<input\b/);
    expect(BAND).not.toMatch(/<textarea\b/);
    expect(BAND).not.toMatch(/<form\b/);
  });

  it("draws no avatar inline, delegating the portrait to its own glyph function", () => {
    /*
     * `ChiefBand` itself never reaches for `OAvatar` — it renders `<ChiefGlyph
     * />` and stops, so a reviewer asking "does this component draw a costume
     * from state" gets a complete answer without also having to read the glyph.
     */
    expect(BAND).not.toContain("<OAvatar");
    expect(BAND).toContain("<ChiefGlyph");
  });

  it("draws the vendored chief, never an ordinary agent's costume (MAR-615)", () => {
    /*
     * Until MAR-615 the chief had no art of its own and this settled for
     * `currentColor` rects on the sidebar's 12×12 grid — MAR-544's boot glyph
     * idiom. He is cast now (`lib/brand/o-cast.ts`'s `O_NAMES`) but still not
     * fleet: `O_FLEET` excludes him (`tests/o-cast.test.ts`), so no ordinary
     * agent's `oFor()` seed can ever land in his costume, and a literal
     * `name="chief"` here — never an expression — is what keeps
     * `scripts/brand-rules.mjs`'s `checkCostume` able to prove that statically.
     */
    expect(listSource).toContain('name="chief"');
  });

  it("names the speaker, which is the one avatar-ish thing in DASH that is named", () => {
    /*
     * The inverse of `OAvatarProps.label`'s argument. A costume must be silent
     * because it is an agent's recognition and never a fact about it; the chief is
     * not a costume, it is who is talking, and a sentence attributed to nobody is
     * read as the page's own voice. `label=`, not a raw `aria-label=`, since
     * MAR-615: `OAvatar` is what turns a passed `label` into the accessible name,
     * and `scripts/brand-check.mjs`'s `LABEL_ALLOWLIST` is what lets this one file
     * pass it at all.
     */
    expect(CHIEF_NAME.length).toBeGreaterThan(0);
    expect(listSource).toContain("label={CHIEF_NAME}");
  });

  it("has a quiet state that does not become a second empty state", () => {
    // `app/page.tsx` already says "nothing here yet" where a person can act on
    // it. This says where the chief is and stops.
    expect(CHIEF_WAITING).toMatch(/chief/i);
    expect(CHIEF_WAITING).not.toMatch(/add|create|start/i);
  });
});
