/**
 * One press, one turn — MAR-746's own bar, stated as assertions.
 *
 * Henrik, on the MAR-743 scratch instance: *"I had time to press enter 3 times
 * before any reaction and it sent the message three times."* Three rows in
 * `chief_messages`, three answers, one question.
 *
 * ## What this file can prove, and what it deliberately hands to the harness
 *
 * Every render test in this repository is `renderToStaticMarkup`: no effect
 * runs, no event fires, and nothing here can press a key. So the claim is split
 * where it actually divides, rather than being weakened to fit:
 *
 * - **The guard** is `singleFlight`, a closure with no React in it, and *"N
 *   calls inside one in-flight window run the work once"* is an ordering fact
 *   about calls. This file drives it directly against a promise it controls,
 *   which is the only way to state that claim as an assertion.
 * - **The refusal at the key** is `sendsOnEnter`, pure for the same reason, and
 *   called by `Composer`'s own `onKeyDown` rather than restated there — so the
 *   condition tested is the condition shipped.
 * - **The acknowledgment** is markup: `disabled` on the field and `aria-busy` on
 *   the root, which a static render *can* see, given `pending`.
 * - **The wiring** — that each surface actually routes its submit through the
 *   guard — is read out of the source, `tests/composer-shared.test.tsx`'s own
 *   move: a future edit that went back to `onSubmit={() => void ask()}` would
 *   keep every other assertion here green and reintroduce the whole defect.
 * - **The real thing** — five OS key presses through Chromium's browser process
 *   producing one row in `chief_messages` — is `electron/capture-lag.ts`, and it
 *   is not something this file can or should imitate. Its before-run is the
 *   evidence that the defect was real (five presses, five turns); its after-run
 *   is the evidence that these assertions describe the shipped product.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { Composer, sendsOnEnter, type ComposerClassNames } from "../app/_components/composer";
import { singleFlight } from "../app/_components/single-flight";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const composerSource = readFileSync(path.join(repoRoot, "app", "_components", "composer.tsx"), "utf8");
const chiefSource = readFileSync(path.join(repoRoot, "app", "_components", "chief-chat.tsx"), "utf8");
const askSource = readFileSync(path.join(repoRoot, "app", "_components", "ask.tsx"), "utf8");
const detailSource = readFileSync(
  path.join(repoRoot, "app", "agents", "detail", "page.tsx"),
  "utf8",
);
const popupSource = readFileSync(
  path.join(repoRoot, "app", "approval-popup", "page.tsx"),
  "utf8",
);

/** A promise this test decides the timing of, so "still in flight" is not a race. */
function deferred(): { promise: Promise<void>; settle: () => void; fail: () => void } {
  let settle = (): void => {};
  let fail = (): void => {};
  const promise = new Promise<void>((resolve, reject) => {
    settle = () => {
      resolve();
    };
    fail = () => {
      reject(new Error("the send failed"));
    };
  });
  return { promise, settle, fail };
}

describe("singleFlight drops every press but the first", () => {
  it("runs the work once for five presses inside one in-flight window", async () => {
    const held = deferred();
    let runs = 0;
    const start = singleFlight(() => {});

    const accepted = [1, 2, 3, 4, 5].map(() =>
      start(() => {
        runs += 1;
        return held.promise;
      }),
    );

    // The five presses Henrik got in, and the one turn they must produce.
    expect(runs).toBe(1);
    expect(accepted).toEqual([true, false, false, false, false]);

    held.settle();
    await held.promise;
  });

  it("announces pending exactly once, and only for the press it accepted", async () => {
    const held = deferred();
    const announced: boolean[] = [];
    const start = singleFlight((pending) => announced.push(pending));

    start(() => held.promise);
    start(() => held.promise);
    start(() => held.promise);
    // A refused press must not re-announce: a surface counting announcements
    // would otherwise show one spinner per press.
    expect(announced).toEqual([true]);

    held.settle();
    await held.promise;
    // The `.then` inside the guard is one microtask behind this one.
    await Promise.resolve();
    expect(announced).toEqual([true, false]);
  });

  it("lets the next question through once the last one has settled", async () => {
    const first = deferred();
    const second = deferred();
    let runs = 0;
    const start = singleFlight(() => {});

    start(() => {
      runs += 1;
      return first.promise;
    });
    first.settle();
    await first.promise;
    await Promise.resolve();

    expect(
      start(() => {
        runs += 1;
        return second.promise;
      }),
    ).toBe(true);
    expect(runs).toBe(2);
    second.settle();
    await second.promise;
  });

  it("hands the field back when the send fails", async () => {
    const held = deferred();
    const announced: boolean[] = [];
    const start = singleFlight((pending) => announced.push(pending));

    start(() => held.promise);
    held.fail();
    await held.promise.catch(() => undefined);
    await Promise.resolve();

    // The alternative is a composer that is dead until the page is reloaded,
    // which is a worse failure than the one being fixed.
    expect(announced).toEqual([true, false]);
    expect(start(() => Promise.resolve())).toBe(true);
  });

  it("survives work that throws before it returns a promise", () => {
    const announced: boolean[] = [];
    const start = singleFlight((pending) => announced.push(pending));

    expect(() =>
      start(() => {
        throw new Error("synchronous");
      }),
    ).not.toThrow();
    expect(announced).toEqual([true, false]);
  });
});

describe("Enter is refused while a send is in flight", () => {
  it("sends on a plain Enter with nothing pending", () => {
    expect(sendsOnEnter({ key: "Enter", shiftKey: false }, false)).toBe(true);
  });

  it("refuses Enter while pending", () => {
    expect(sendsOnEnter({ key: "Enter", shiftKey: false }, true)).toBe(false);
  });

  it("never sends on Shift+Enter, pending or not", () => {
    expect(sendsOnEnter({ key: "Enter", shiftKey: true }, false)).toBe(false);
    expect(sendsOnEnter({ key: "Enter", shiftKey: true }, true)).toBe(false);
  });

  it("ignores every other key", () => {
    expect(sendsOnEnter({ key: "a", shiftKey: false }, false)).toBe(false);
    expect(sendsOnEnter({ key: "Escape", shiftKey: false }, false)).toBe(false);
  });

  it("is what Composer's own key handler asks, rather than a second copy of it", () => {
    expect(composerSource).toMatch(/if \(sendsOnEnter\(event, pending\)\) \{/);
    // Before the guard, the branch was `if (event.key === "Enter" && !event.shiftKey)`
    // inline. A future edit that inlined it back would pass every test above and
    // ship the defect.
    expect(composerSource).not.toMatch(/if \(event\.key === "Enter" && !event\.shiftKey\) \{\s*event\.preventDefault\(\);\s*onSubmit\(\)/);
  });
});

/* ---------------------------------------------------------------------- *
 * The acknowledgment, in the markup
 * ---------------------------------------------------------------------- */

const CLASSES: ComposerClassNames = {
  root: "chief-composer",
  room: "chief-room",
  roomHead: "chief-room-head",
  roomHeading: "chief-room-heading",
  roomActions: "chief-room-actions",
  roomClear: "chief-room-clear",
  roomClose: "chief-room-close",
  roomScroll: "chief-room-scroll",
  chips: "chief-composer-chips",
  compose: "chief-compose",
  field: "chief-field",
  inputWrap: "chief-input-wrap",
  input: "chief-input",
  enterGlyph: "chief-enter-glyph",
  foot: "chief-composer-foot",
  modelChip: "chief-model-chip",
  hint: "chief-composer-hint",
};

function draw(pending: boolean): string {
  return renderToStaticMarkup(
    <Composer
      classes={CLASSES}
      open
      onOpen={() => {}}
      onClose={() => {}}
      heading="Ask the chief"
      closeLabel="Close"
      clearLabel="Clear"
      clearTitle="Clear what is drawn here"
      clearDisabled
      onClear={() => {}}
      scrollSignal={0}
      chips={null}
      subjectLabel="The whole fleet"
      placeholder="Ask about your fleet…"
      value="How is the fleet doing?"
      onChange={() => {}}
      onSubmit={() => {}}
      pending={pending}
      textareaDisabled={false}
      modelChip={null}
      recallQuestions={[]}
    >
      {null}
    </Composer>,
  );
}

describe("a press is acknowledged in the markup, not by the answer arriving", () => {
  it("disables the field while a send is in flight", () => {
    expect(draw(true)).toMatch(/<textarea[^>]*\bdisabled\b/);
  });

  it("leaves the field open when nothing is in flight", () => {
    expect(draw(false)).not.toMatch(/<textarea[^>]*\bdisabled\b/);
  });

  it("says the same thing to a screen reader, which cannot see the grey", () => {
    expect(draw(true)).toMatch(/aria-busy="true"/);
    expect(draw(false)).toMatch(/aria-busy="false"/);
  });

  it("still disables for a surface that asked for it independently of pending", () => {
    // `textareaDisabled` predates MAR-746 and is a different fact — `AskComposer`
    // sets it from its own `busy` clock. Neither may cancel the other.
    const markup = renderToStaticMarkup(
      <Composer
        classes={CLASSES}
        open={false}
        onOpen={() => {}}
        onClose={() => {}}
        heading="Ask the chief"
        closeLabel="Close"
        clearLabel="Clear"
        clearTitle="Clear what is drawn here"
        clearDisabled
        onClear={() => {}}
        scrollSignal={0}
        chips={null}
        subjectLabel="The whole fleet"
        placeholder="Ask about your fleet…"
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        pending={false}
        textareaDisabled
        modelChip={null}
        recallQuestions={[]}
      >
        {null}
      </Composer>,
    );
    expect(markup).toMatch(/<textarea[^>]*\bdisabled\b/);
  });
});

/* ---------------------------------------------------------------------- *
 * The wiring — read out of the source, because a render cannot press anything
 * ---------------------------------------------------------------------- */

describe("both composers submit through the guard", () => {
  for (const [surface, source] of [
    ["chief-chat.tsx", chiefSource],
    ["ask.tsx", askSource],
  ] as const) {
    it(`${surface} takes its pending flag from useSingleFlight`, () => {
      expect(source).toMatch(/const \{ pending, start \} = useSingleFlight\(\);/);
      expect(source).toMatch(/pending=\{pending\}/);
    });

    it(`${surface} routes onSubmit through start, never straight at the async function`, () => {
      expect(source).toMatch(/onSubmit=\{\(\) => \{\s*start\((ask|submit)\);\s*\}\}/);
      expect(source).not.toMatch(/onSubmit=\{\(\) => void (ask|submit)\(\)\}/);
    });
  }
});

describe("a decision is acknowledged at the press, not after the first round trip", () => {
  /*
   * MAR-746's other half. Every control on the work inbox disabled on
   * `pending !== null`, which `issue` sets — but the Remember path went to main
   * and back through `setStandingAnswer` *before* reaching `issue`, leaving the
   * option buttons live and unacknowledged for that whole round trip. `held` is
   * the combined fact, set at the press.
   */
  it("holds the inbox controls on the card's own press as well as the page's command", () => {
    expect(detailSource).toMatch(/const \{ pending: answering, start \} = useSingleFlight\(\);/);
    expect(detailSource).toMatch(/const held = pending !== null \|\| answering;/);
  });

  it("puts every one of its presses through the guard rather than straight at the command", () => {
    const inbox = detailSource.slice(detailSource.indexOf("function InboxControl("));
    // Approve, Reject, and each option — three call sites, one guard.
    expect([...inbox.matchAll(/start\(\(\) =>/g)]).toHaveLength(3);
    expect(inbox).not.toMatch(/onClick=\{\(\) => void (chooseOption|issue)\(/);
    expect(inbox).not.toMatch(/onClick=\{\(\) =>\s*void issue\(/);
  });

  it("leaves no inbox control still reading pending directly", () => {
    const inbox = detailSource.slice(detailSource.indexOf("function InboxControl("));
    expect(inbox).not.toMatch(/disabled=\{pending !== null\}/);
  });

  /*
   * The popup is a second window drawing the same decision, and MAR-421's whole
   * point is that it goes through the ordinary command channel rather than a
   * path of its own. A guard that stopped at the workspace page would leave the
   * one surface a person actually meets under load — the window main raises in
   * front of them — as the only unguarded one.
   */
  it("guards the same decision in the popup window", () => {
    expect(popupSource).toMatch(/const \{ pending, start \} = useSingleFlight\(\);/);
    expect(popupSource).toMatch(/start\(\(\) => decide\("reject"\)\)/);
    expect(popupSource).toMatch(/start\(\(\) => decide\("approve"\)\)/);
    expect(popupSource).not.toMatch(/onClick=\{\(\) => void decide\(/);
  });
});
