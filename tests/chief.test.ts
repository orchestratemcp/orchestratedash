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

import { CHIEF_NAME, CHIEF_WAITING, describeChief } from "../lib/copy/chief";
import { GLANCE_ALL_CLEAR, type GlanceChip } from "../lib/copy/glance";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chiefSource = readFileSync(path.join(repoRoot, "lib", "copy", "chief.ts"), "utf8");
const listSource = readFileSync(
  path.join(repoRoot, "app", "_components", "fleet-list.tsx"),
  "utf8",
);

/**
 * `ChiefBand`'s body, extracted from the file's own source rather than from a
 * render — the defect the two tests below guard against is somebody adding a
 * dead input to the markup, which is a fact about the source and not about a
 * particular render's state.
 *
 * `\r?\n` rather than `\n`: a Windows checkout of this repository has CRLF
 * line endings (`core.autocrlf`), and the plain `\n}\n` this used to be
 * written as never matches `...);\r\n}\r\n` — the `}` is followed by `\r`, not
 * directly by `\n` — so the match was silently `null` on every such checkout.
 */
function chiefBandMatch(): RegExpExecArray | null {
  return /export function ChiefBand\(([\s\S]*?)\r?\n}\r?\n/.exec(listSource);
}

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

  it("says the all-clear chip when that is the only true thing", () => {
    const line = describeChief({
      agent: "news-scout",
      runs: "Not run yet",
      glance: [GLANCE_ALL_CLEAR],
    });
    expect(line?.says).toBe(GLANCE_ALL_CLEAR.meaning);
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
    const band = chiefBandMatch();
    expect(band).not.toBeNull();
    const markup = band?.[1] ?? "";
    expect(markup).not.toMatch(/<input\b/);
    expect(markup).not.toMatch(/<textarea\b/);
    expect(markup).not.toMatch(/<form\b/);
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
    expect(chiefBandMatch()?.[1] ?? "").not.toContain("OAvatar");
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
