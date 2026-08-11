/**
 * The hover note, and the one thing no other gate in this repository can see
 * (MAR-614).
 *
 * Every pinned-copy test in `tests/` asserts over rendered markup with
 * `toContain`. A sentence moved behind this affordance is *still in that
 * markup* — that is the property that makes the relocation honest, and it is
 * also the property that makes those gates blind to it. All of them stayed
 * green through this pass, and they would have stayed green if the pass had put
 * a consent disclosure behind a hover on the sign-in button.
 *
 * So this file exists to assert the two halves that nothing else does:
 *
 * 1. **the affordance works** — the explanation is attached to its marker for
 *    somebody who cannot see the layout, and the marker is reachable without a
 *    mouse;
 * 2. **the rule was applied the right way round** — on a connection DASH cannot
 *    revoke, the sentence saying so is on the surface and the mechanism is the
 *    part behind the note. That is `splitProof`'s whole argument, and it is one
 *    edit away from being backwards at any point in the future.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { InfoNote } from "../app/_components/info-note";
import { INFO_NOTE_COPY, splitGlance, splitProof } from "../lib/copy/info-note";
import { describeProof } from "../lib/connection-card";
import { GLANCE_ALL_CLEAR, describeGlance, type GlanceFacts } from "../lib/copy/glance";

function draw(node: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(node);
}

describe("the marker", () => {
  const html = draw(<InfoNote>Nothing here changes what the button does.</InfoNote>);

  it("names itself the same way on every surface", () => {
    // `lib/copy/record-card.ts`'s rule: a control named after itself is one a
    // person cannot decline, because they cannot tell what declining costs.
    expect(html).toContain(INFO_NOTE_COPY.label);
    expect(INFO_NOTE_COPY.label).not.toMatch(/more|learn|info/i);
  });

  it("is a real control rather than a hover target", () => {
    /*
     * A `<span>` with a `title` would satisfy a screenshot and nothing else: no
     * keyboard reaches it, and the operating system draws the text. The button
     * is what makes tab-then-read work, and `:focus-within` in
     * `app/globals.css` is what makes tap-then-read work on the 375px width
     * where hover does not exist at all.
     */
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
  });

  it("attaches the explanation to the marker for a reader who cannot see it", () => {
    /*
     * The load-bearing accessibility claim of the whole pass. `aria-describedby`
     * takes its text from the referenced element whether or not that element is
     * displayed, so the sentence is relocated in the layout and unmoved in the
     * accessibility tree. Without this, "moved behind a hover" would mean
     * "deleted" for anybody using a screen reader.
     */
    const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(described).toBeTruthy();
    expect(html).toContain(`id="${String(described)}"`);
    expect(html).toContain("Nothing here changes what the button does.");
  });

  it("keeps the explanation in the markup rather than in a title attribute", () => {
    // The `title` carries the *label*, deliberately. A native tooltip holding
    // the sentence would race the styled note under one pointer and win, in a
    // font and colour DASH does not choose.
    expect(html).toContain(`title="${INFO_NOTE_COPY.label}"`);
    expect(html).not.toContain(`title="Nothing here changes`);
  });
});

describe("which half of a connection's proof is allowed behind it", () => {
  /*
   * The review this pass exists to force, written down as four assertions
   * rather than as a paragraph in a handoff nobody re-reads.
   */

  it("keeps the limit on the surface where DASH cannot revoke a sign-in", () => {
    for (const kind of ["agent_holds", "held_elsewhere"] as const) {
      const proof = describeProof(kind, "Invoice records");
      const split = splitProof(kind, proof);
      expect(split.surface, kind).toContain(proof.cannot);
      expect(split.note, kind).not.toContain(proof.cannot);
    }
  });

  it("moves the mechanism, never the limit", () => {
    for (const kind of ["agent_holds", "held_elsewhere"] as const) {
      const proof = describeProof(kind, "Invoice records");
      expect(splitProof(kind, proof).note, kind).toContain(proof.can);
    }
  });

  it("moves the coupled pair whole, because half of it has no subject", () => {
    /*
     * `dash_brokered`'s limit begins "It cannot see…" and `handed_over`'s begins
     * "From that moment…". Either one alone on a surface is a dangling pronoun —
     * a sentence that is present and unreadable, which is worse than either
     * whole option. So the pair moves together and the tile shows the label.
     */
    for (const kind of ["dash_brokered", "handed_over"] as const) {
      const proof = describeProof(kind, "Gmail");
      const split = splitProof(kind, proof);
      expect(split.note, kind).toEqual([proof.can, proof.cannot]);
      expect(split.surface, kind).toEqual([proof.label]);
    }
  });

  it("never leaves a tile with nothing on its surface", () => {
    for (const kind of [
      "dash_brokered",
      "handed_over",
      "agent_holds",
      "held_elsewhere",
    ] as const) {
      const split = splitProof(kind, describeProof(kind, "Gmail"));
      expect(split.surface.length, kind).toBeGreaterThan(0);
      expect(split.surface.join("").trim(), kind).not.toBe("");
    }
  });

  it("loses no sentence anywhere — every part of the pair still renders", () => {
    /*
     * The honesty check, stated as the sum rather than as a placement: whatever
     * the split decides, all three of `describeProof`'s strings that were on
     * screen before this pass are still somewhere on the tile afterwards.
     */
    for (const kind of [
      "dash_brokered",
      "handed_over",
      "agent_holds",
      "held_elsewhere",
    ] as const) {
      const proof = describeProof(kind, "Gmail");
      const everything = [...splitProof(kind, proof).surface, ...splitProof(kind, proof).note];
      expect(everything, kind).toContain(proof.can);
      expect(everything, kind).toContain(proof.cannot);
    }
  });
});

describe("which of a fleet card's glance sentences is allowed behind it", () => {
  /*
   * The same review as above, for the surface Henrik actually photographed.
   *
   * Driven through `describeGlance` from facts rather than by naming the five
   * kinds directly, so a fifth question added to `lib/copy/glance.ts` without a
   * decision here is one these assertions meet rather than skip.
   */

  const NOTHING: GlanceFacts = {
    new_outputs: 0,
    total_outputs: 0,
    never_looked: false,
    approvals: 0,
    choices: 0,
    expired: 0,
    unconnected: 0,
    self_contradicting: 0,
    overdue: null,
  };

  /** Every set of facts that reaches a distinct branch of `describeGlance`. */
  const SCENES: GlanceFacts[] = [
    NOTHING,
    { ...NOTHING, approvals: 2 },
    { ...NOTHING, choices: 1 },
    { ...NOTHING, approvals: 1, expired: 1 },
    { ...NOTHING, unconnected: 3 },
    { ...NOTHING, unconnected: 1, self_contradicting: 1 },
    { ...NOTHING, overdue: { last_run_at: "2026-08-06T09:00:00.000Z", every_seconds: 86_400 } },
    { ...NOTHING, overdue: { last_run_at: null, every_seconds: 3_600 } },
    { ...NOTHING, new_outputs: 4, total_outputs: 9 },
    { ...NOTHING, new_outputs: 2, total_outputs: 2, never_looked: true },
  ];

  const everyChip = SCENES.flatMap((facts) => describeGlance(facts));

  it("keeps every sentence that names something waiting on you", () => {
    /*
     * The direction that matters. Four of the five questions describe a demand
     * on the reader — an approval, a missing connection, a missed run, something
     * new to read — and each sentence carries what the chip cannot: a count, a
     * deadline that passed, the interval the verdict was computed from, or the
     * fact that nobody has opened this agent at all.
     */
    for (const chip of everyChip.filter((one) => one.question !== "all_clear")) {
      const split = splitGlance(chip.question, chip.meaning);
      expect(split.surface, chip.label).toBe(chip.meaning);
      expect(split.note, chip.label).toBeNull();
    }
  });

  it("moves the sentence a healthy agent shows, and only that one", () => {
    /*
     * `GLANCE_ALL_CLEAR` is the card at rest, so it is the card a fleet with
     * nothing wrong draws once per agent — which is why it was the one on
     * Henrik's screen and why it is the one that moves.
     */
    const moved = everyChip.filter(
      (chip) => splitGlance(chip.question, chip.meaning).note !== null,
    );
    expect(moved.length).toBeGreaterThan(0);
    for (const chip of moved) {
      expect(chip.question).toBe("all_clear");
      expect(splitGlance(chip.question, chip.meaning).note).toBe(GLANCE_ALL_CLEAR.meaning);
    }
  });

  it("loses no sentence — every meaning is on the surface or in the note", () => {
    /*
     * The honesty check, as the sum rather than the placement. Whatever the
     * split decides for a question added later, the sentence has to come out
     * somewhere: a branch returning two nulls would delete copy while every
     * `toContain` gate in the repository stayed green.
     */
    for (const chip of everyChip) {
      const split = splitGlance(chip.question, chip.meaning);
      expect([split.surface, split.note], chip.label).toContain(chip.meaning);
      expect(
        split.surface === null || split.note === null,
        `${chip.label} is in two places at once`,
      ).toBe(true);
    }
  });
});
