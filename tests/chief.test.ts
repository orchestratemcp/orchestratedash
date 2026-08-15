/**
 * What the chief says, and everything it is not allowed to say (MAR-612).
 *
 * The chief stands under the spotlight view and gives a sentence about the agent
 * in the middle — `docs/design-brief.md`'s "they should be able to ask, and get a
 * sentence", given without being asked.
 *
 * A character in a speech position is the easiest place in an interface to
 * smuggle a claim nobody can source, so most of these cases are about the chief
 * having nothing of its own to say: every string it returns either arrived
 * already worded or is a fixed literal, and the ranking it applies is one this
 * repository had already settled for the bottom strip.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHIEF_NAME, CHIEF_WAITING, describeChief, describeFleetSummary } from "../lib/copy/chief";
import { GLANCE_ALL_CLEAR, type GlanceChip } from "../lib/copy/glance";
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

function chip(over: Partial<GlanceChip> = {}): GlanceChip {
  return {
    question: "needs_you",
    label: "needs you",
    meaning: "One step is waiting for your approval.",
    tone: "warn",
    ...over,
  };
}

describe("the chief picks one thing to say", () => {
  it("says the whole sentence, not the chip's two words", () => {
    /*
     * `GlanceChip.label` is sized for a chip beside four others; `meaning` is the
     * sentence, and it is what a reader looking at one line rather than scanning a
     * row wants. Same reasoning `lib/copy/glance.ts` gives for rendering the
     * meaning under the chips instead of hiding it in a tooltip.
     */
    const line = describeChief({
      agent: "news-scout",
      runs: "Run 3 times",
      glance: [chip()],
    });
    expect(line?.says).toBe("One step is waiting for your approval.");
  });

  it("puts something waiting on you above something new to read", () => {
    /*
     * `lib/copy/glance.ts`'s tone scale, read top to bottom: amber is waiting on
     * you, blue is new to read, grey is neither. It is the same priority
     * `lib/views/fleet-motion.ts` settled for the bottom strip — waiting outranks
     * working, because the person is what the agent is blocked on — and two
     * vocabularies for one fleet must not disagree about what matters most.
     */
    const line = describeChief({
      agent: "news-scout",
      runs: "Run 3 times",
      glance: [
        chip({ question: "new_output", tone: "accent", meaning: "A new report arrived today." }),
        chip({ question: "needs_you", tone: "warn", meaning: "One step is waiting for you." }),
      ],
    });
    expect(line?.says).toBe("One step is waiting for you.");
  });

  it("puts something new to read above nothing at all", () => {
    const line = describeChief({
      agent: "news-scout",
      runs: "Run 3 times",
      glance: [
        GLANCE_ALL_CLEAR,
        chip({ question: "new_output", tone: "accent", meaning: "A new report arrived today." }),
      ],
    });
    expect(line?.says).toBe("A new report arrived today.");
  });

  it("is stable within a tone", () => {
    // The first chip of the winning tone, in the order `lib/views/glance.ts`
    // built them, so the sentence does not reshuffle between two renders that
    // read the same store.
    const glance = [
      chip({ question: "needs_you", tone: "warn", meaning: "First." }),
      chip({ question: "overdue", tone: "warn", meaning: "Second." }),
    ];
    expect(describeChief({ agent: "a", runs: "Run once", glance })?.says).toBe("First.");
  });

  it("says a short 'All clear.' for the all-clear chip, with the whole sentence behind it", () => {
    /*
     * MAR-639. The chip's own sentence enumerates four answered "no"s — DASH
     * showing its working about an agent with nothing to decide — and that is
     * exactly the sentence `lib/copy/info-note.ts` argues moves behind a note:
     * an absence, read once and never needed again. `says` carries the fact;
     * `note` carries the working.
     */
    const line = describeChief({
      agent: "news-scout",
      runs: "Not run yet",
      glance: [GLANCE_ALL_CLEAR],
    });
    expect(line?.says).toBe("All clear.");
    expect(line?.note).toBe(GLANCE_ALL_CLEAR.meaning);
  });

  it("carries no note for a chip that names something waiting on the reader", () => {
    // The four demands stay whole on `says`, per `splitGlance`'s own rule —
    // `note` is exclusively the all-clear chip's field.
    const line = describeChief({
      agent: "news-scout",
      runs: "Run once",
      glance: [chip()],
    });
    expect(line?.note).toBeNull();
  });
});

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
  it("passes the run sentence through rather than rebuilding it", () => {
    /*
     * The fleet card's own `describeRunCount` output arrives already worded. Two
     * copies of "Not run yet" is two copies that can disagree the day somebody
     * improves one of them — the argument `AgentTile.value` makes about a tile
     * never composing its own copy.
     */
    const line = describeChief({
      agent: "news-scout",
      runs: "Not run yet",
      glance: [GLANCE_ALL_CLEAR],
    });
    expect(line?.runs).toBe("Not run yet");
  });

  it("names the agent in the action, so the button's object is not a scroll position", () => {
    const line = describeChief({
      agent: "news-scout",
      runs: "Run once",
      glance: [GLANCE_ALL_CLEAR],
    });
    expect(line?.action).toBe("Ask news-scout");
    expect(line?.agent).toBe("news-scout");
  });

  it("says nothing at all about an agent with no chips", () => {
    /*
     * `AgentRow.glance` is documented as never empty, so this state is not
     * supposed to exist. The honest answer to a card DASH could not fill in is
     * silence rather than reassurance — a cheerful sentence over a record that
     * failed to load is the exact invention `lib/copy/glance.ts` refuses when it
     * declines to turn an absent fact into a chip.
     */
    expect(describeChief({ agent: "news-scout", runs: "Run once", glance: [] })).toBeNull();
  });

  it("has no clock, no store and no fourth fact", () => {
    /*
     * MAR-547's ruling against `CPU LOAD 87%`, enforced at the module's edge: a
     * pure copy module that cannot reach a database or a clock cannot round a
     * missing answer up into a claim. The chief's only inputs are three strings
     * somebody else already stood behind.
     */
    expect(chiefSource).not.toMatch(/\bnew Date\b|\bDate\.now\b|Math\.random/);
    expect(chiefSource).not.toMatch(/from "\.\.\/(db|store|views\/glance)"/);
  });
});

describe("the chief is not the Chief chat", () => {
  it("draws no input a person could type into and get nothing back from", () => {
    /*
     * MAR-419 is the Chief chat, it is unbuilt, and `app/_components/ask.tsx`
     * states the rule this band is held to: **never a dead input.** The band's
     * action is the truest thing in reach instead — MAR-545's per-agent Ask, on
     * the agent's own workspace.
     *
     * Asserted against the band's source rather than against a render, because the
     * defect this prevents is somebody adding the box before the thing behind it
     * exists, and that arrives as markup rather than as a state.
     */
    expect(BAND).not.toMatch(/<input\b/);
    expect(BAND).not.toMatch(/<textarea\b/);
    expect(BAND).not.toMatch(/<form\b/);
  });

  it("draws no character from the cast", () => {
    /*
     * The cast lives in orchestrateweb and DASH vendors it against a per-file
     * sha256 (`lib/brand/o-cast.ts`); a chief *character* is a sprite that repo
     * has to draw and audit first. MAR-544's boot glyph settles the interim: DASH's
     * own things are drawn as `currentColor` rects on the sidebar's 12×12 grid,
     * because "the cast are the agents' characters, and the thing booting here is
     * DASH."
     */
    expect(BAND).not.toContain("OAvatar");
  });

  it("names the speaker, which is the one avatar-ish thing in DASH that is named", () => {
    /*
     * The inverse of `OAvatarProps.label`'s argument. A costume must be silent
     * because it is an agent's recognition and never a fact about it; the chief is
     * not a costume, it is who is talking, and a sentence attributed to nobody is
     * read as the page's own voice.
     */
    expect(CHIEF_NAME.length).toBeGreaterThan(0);
    expect(listSource).toContain("aria-label={CHIEF_NAME}");
  });

  it("has a quiet state that does not become a second empty state", () => {
    // `app/page.tsx` already says "nothing here yet" where a person can act on
    // it. This says where the chief is and stops.
    expect(CHIEF_WAITING).toMatch(/chief/i);
    expect(CHIEF_WAITING).not.toMatch(/add|create|start/i);
  });
});
