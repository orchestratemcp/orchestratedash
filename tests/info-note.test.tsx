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
import { INFO_NOTE_COPY, splitProof } from "../lib/copy/info-note";
import { describeProof } from "../lib/connection-card";

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
