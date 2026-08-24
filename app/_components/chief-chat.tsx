"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { agentStageHref } from "../_data/routes";
import { askChief, listProviderModels, setChiefModel } from "../_data/source";
import { Composer, filterAfterClear, type ComposerClassNames } from "./composer";
import { LinkOut } from "./link-out";
import { useSingleFlight } from "./single-flight";
import { OAvatar } from "./o-avatar";
import { aiProviderById } from "../../lib/ai/providers";
import { answeredFromRecords } from "../../lib/chief/records-answer";
import {
  CHIEF_CHAT_COPY,
  describeAmbiguous,
  describeChiefActivity,
  describeChiefModelLine,
  describeDecisionsChip,
  describeMatch,
  describeRouted,
  type ChiefSentence,
} from "../../lib/copy/chief-chat";
import { CHIEF_NAME } from "../../lib/copy/chief";
import type { AgentRow, ChiefRoomView, ChiefTurnView } from "../../lib/views/types";

/**
 * The chief's own class-name table for `Composer` (MAR-711).
 *
 * Every name here shipped with MAR-696 and is read by name in
 * `electron/capture-mar615.ts` (`measureComposer`, `measureRoomPin`) and in
 * `tests/chief-chat-render.test.tsx` — this table keeps them exactly as they
 * were rather than asking either to learn a new vocabulary. See
 * `composer.tsx`'s own header for why this is a lookup table and not a
 * `surface` string `Composer` switches on.
 */
const CHIEF_COMPOSER_CLASSES: ComposerClassNames = {
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

/**
 * The chief's composer, and the room it opens (MAR-648; given a model and a
 * memory by MAR-659, ADR 0023; reduced to a plain chat by MAR-683).
 *
 * Henrik, with a screenshot of Claude Code's composer: *"Can we just dedicate a
 * space at the bottom that looks like the screenshot… When you click the chat
 * text area the history or the chat room view shows… It doesn't matter if it is
 * the chief (in fleet view) or a specific agent. The chat is central and
 * important."*
 *
 * So this is the same shape as `AgentChatBar` on the agent page, one surface
 * along: a composer docked at the bottom of the chief's band, and a room that
 * opens above it on focus without the composer moving a pixel.
 *
 * ## MAR-683: a thread of turns and a composer, nothing standing between them
 *
 * The room used to carry three pieces of chrome that were on screen whether or
 * not anybody had asked anything: a scope note explaining what the chief could
 * answer and what it cost, a no-model notice that could never be dismissed, and
 * a settings line repeating the scope headline under the composer. Henrik's own
 * words: *"No buttons. Just like your chat here — it's all that is needed."*
 *
 * All three are gone rather than demoted, and none of the information they
 * carried is lost — it moved from *standing* to *reactive*:
 *
 * - The no-model notice only ever mattered to a question that needed a model.
 *   `performChiefAction` already puts its headline in `result.detail` on that
 *   exact path (`electron/chief-host.ts`'s `fromRecords`), which this component
 *   already surfaces as `feedback` after a press. Removing the standing block
 *   loses nothing a person asking such a question would not see anyway, and it
 *   is silent for everyone who never asks one — which is every DASH with no
 *   default model, all the time, today.
 * - The scope note's cost explanation is what `describeChiefReceipt` and the
 *   per-turn charge line already say, turn by turn, as soon as there is a turn
 *   to say it about.
 *
 * The room header's Clear and Close controls are gone too. Escape already
 * closed the room; it now does so from anywhere in the room, not only while the
 * composer has focus (see the effect below), so removing the visible Close
 * control loses no capability a keyboard already had. Clear has no keyboard
 * equivalent and nowhere else in DASH to live yet, so removing its button here
 * is a real gap — flagged rather than quietly dropped, for a later surface (most
 * likely Settings) to pick up.
 *
 * ## What MAR-648/659 built and MAR-683 did not touch
 *
 * Every question still goes to Electron main, which decides between DASH's own
 * records and the model, writes a row, and returns whether it was asked. The
 * conversation still arrives in `view.turns` with the rest of the fleet document
 * and is still there tomorrow.
 *
 * Every sentence still comes from `lib/copy/chief-chat.ts`, except the one the
 * model wrote — and that one is `turn.answer`, rendered as plain text, with the
 * exact records DASH read available beside it. MAR-547's ruling applies hardest
 * in a speech position, and the answer to a model speaking there is still not to
 * forbid it but to show its sources beside it — **`ChiefReceipt` below is now a
 * disclosure a person opens, never a table forced open on every turn, but it is
 * still there on every turn with an answer.** The receipt, not the prompt, is
 * the guarantee (ADR 0023 decision 5), and a plain chat does not get to mean a
 * chat with its sources hidden.
 *
 * An agent's `goal` is still **its author's** sentence, rendered quoted and
 * attributed rather than folded into anybody's words.
 *
 * ## The loader, and the one thing this component predicts
 *
 * MAR-648's honesty rule: no loader on a path that returns before the next
 * frame. A standing question is answered from records in main and comes back in
 * a millisecond; a model question waits on a provider. So the activity line is
 * shown only for the second, and `answeredFromRecords` is how this component
 * guesses which it is about to be.
 *
 * That guess is a **prediction about latency, not a decision about the answer**
 * — main decides, using the same function. If the two ever disagreed, the worst
 * case is a loader that was not needed or one missing for a moment.
 *
 * ## MAR-696, first pass: the last button leaves, and the room floats
 *
 * Henrik, with a screenshot of this composer's own Ask button and the band's
 * per-agent one beside it: *"remove all excess. I only want a floating chat
 * window. No button."* `ask()` already ran on Enter (`onKeyDown` below) —
 * pressing Ask only ever did what Enter already did — so removing the button
 * loses no capability. `CHIEF_CHAT_COPY.placeholder` carries the affordance the
 * button's label carried, which is `AskComposer`'s own rule applied here: a
 * control that disappears has to leave its instruction somewhere a reader still
 * finds it.
 *
 * ## MAR-696, corrected spec (2026-08-19): the first pass was refused on sight
 *
 * Henrik, seeing the floating window merged as `c058d9b`: *"the floating
 * textbox was a disaster. Thats not what I want at all."* And, of the big
 * bordered `ChiefBand` this composer used to live inside: *"This box Ive
 * asked you to remove manytimes."* That whole band is gone now — `FleetList`
 * renders this component directly under the cards, nothing wraps it, and
 * `ChiefBand`/`ChiefGlyph` no longer exist. In Henrik's own words: *"Its not
 * floating in the sense as we have it right now. Its incorporated in the
 * design."*
 *
 * So `.chief-composer` sits in the page's own layout rather than at
 * `position: fixed` — the reversal of the paragraph above — and `.chief-room`
 * is now the one piece that still overlays: it opens **above** the composer,
 * `position: absolute` from `.chief-composer`'s own box, so an open
 * conversation covers the cards above it without reflowing them (MAR-615's
 * band-anchoring defect is moot now that there is no band to anchor to or
 * shrink out from under it).
 *
 * Three pieces are new and none of them existed in the first pass:
 *
 * - **Rounded corners**, a declared exception to Bit-Command's zero-corner
 *   rule scoped to `--radius-chief-composer` alone (`app/tokens.css`,
 *   `tests/tokens.test.ts`) — Henrik's own call, named as one.
 * - **A perched O and an enter glyph**, replacing the Ask button's old
 *   position with a costume and a keyboard hint rather than a control —
 *   `ChiefComposerGlyph` below, sized through `OAvatar`'s `size` prop rather
 *   than a CSS override (see that component's own header on why a plain rule
 *   would either be silently overridden or crop the sprite instead of
 *   scaling it).
 * - **A model line and a swap control**, brought back rather than left
 *   removed — ADR 0023 amendment 1 records that the chief has a picker of
 *   its own now, `chief_model_choice`, read before `fleet_model_default`
 *   rather than instead of it. This is not `.chief-settings`, the standing
 *   scope note MAR-683 dropped: that was a paragraph explaining what the
 *   room could do, on screen whether or not the model mattered yet, and it
 *   stays gone. What is back is one line naming a fact and a control for
 *   changing it — a setting, not a preamble.
 *
 * And the room's **X and Clear**, dropped by MAR-683 as standing chrome
 * nobody could act on differently than Escape already let them, are back for
 * the same reason the model line is: `chief-chat-render.test.tsx`'s old
 * assertion that neither exists is deleted rather than kept passing, because
 * this is a different room. Clear is scoped deliberately narrower than
 * `chief.clear` (see `visibleChiefTurns` below) rather than reusing it.
 *
 * ## MAR-711: the chrome moves to `composer.tsx`, the words and the DOM do not
 *
 * The agent page's own Ask composer adopted this surface's look and
 * behaviour rather than a second implementation of it — rounded field, enter
 * glyph, no submit button, an expand-upward room with a pinned X and Clear.
 * Rather than let two composers drift, the chrome this file drew directly —
 * `.chief-composer`, `.chief-room` and everything inside `.chief-compose` —
 * moved into `Composer` (`composer.tsx`), which both surfaces now render
 * through with their own class-name table and their own `children`. Nothing
 * about *this* surface's markup, class names or behaviour changed: every
 * assertion in `chief-chat-render.test.tsx` and every rectangle
 * `electron/capture-mar615.ts` measures is unchanged, because
 * `CHIEF_COMPOSER_CLASSES` above is the same vocabulary MAR-696 shipped.
 * `tests/composer-shared.test.tsx` is the enforcement that a future edit
 * cannot fork this shape back apart without failing a test, the way
 * `tests/fleet-view.test.ts` enforces the fleet's one-card-three-tracks rule.
 */

/**
 * The turns Clear leaves on screen (MAR-696).
 *
 * Pure, and exported for that reason: every render test in this repository is
 * `renderToStaticMarkup`, so no click ever reaches `ChiefChat`'s own
 * `onClick`, and the honesty of "empties the visible transcript only" is
 * exactly the thing a render can't exercise without one. Testing this
 * function directly is what proves the *filter*, independent of whether a
 * test harness can ever press the button that sets `clearedThroughId`.
 *
 * `turns` is oldest-first (`chiefRoomView`'s own order) and `id` only ever
 * grows, so "greater than the cleared boundary" is "asked after the clear" —
 * the same ordering assumption `readChiefTurns`' own docblock states.
 */
export function visibleChiefTurns(
  turns: readonly ChiefTurnView[],
  clearedThroughId: number | null,
): readonly ChiefTurnView[] {
  return filterAfterClear(turns, clearedThroughId);
}

export function ChiefChat({
  agents,
  view,
  canAct,
  onAsked,
  open,
  onOpen,
  onClose,
  decisionsTotal = 0,
}: {
  /** The fleet as the band already has it — filtered, in the list's own order. */
  agents: readonly AgentRow[];
  /** The kept conversation and what the composer can do. */
  view: ChiefRoomView;
  /** False in a browser tab, where there is no bridge to ask through. */
  canAct: boolean;
  /** Ask the page to re-read the view, so a new turn appears. */
  onAsked: () => void;
  /** Whether the room is showing. Owned by `FleetList`, which dims the cards. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /**
   * `FleetView.decisions.total` (MAR-742 roadmap item 1, §4.5), for the
   * decisions chip. `FleetList` reaches this from the fleet page's own view
   * — one prop passed down, `fleet-list.tsx`'s own note on why. Defaulted to
   * 0 (chip hidden) rather than required, so the render tests that predate
   * this packet and hold no fleet view keep compiling.
   */
  decisionsTotal?: number;
}): ReactNode {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  /*
   * MAR-746. The send that is already happening, and why it is not `busy`.
   *
   * `busy` above is a *prediction about latency* — whether this question will
   * wait on a provider — and it is deliberately false for a question records
   * answer, because MAR-648's honesty rule forbids a loader on a path that
   * returns before the next frame. It was therefore never a guard, and using it
   * as one would have left the free path exactly as unguarded as it was: on the
   * measured before-run, five Enters inside one in-flight ask wrote five rows to
   * `chief_messages`, and every one of those questions was a free one.
   *
   * `pending` is the other fact — a send is in flight, whatever it costs and
   * however fast it returns — and it is what closes the field. See
   * `singleFlight`'s own header on why the guard behind it is a closure and not
   * this flag.
   */
  const { pending, start } = useSingleFlight();
  /*
   * MAR-696. The Clear button's own state, and the whole reason it is a
   * number here rather than a call into `lib/chief/store.ts`.
   *
   * `chief_messages` is the chief's memory and an audit surface (MAR-673) —
   * `chief.clear` already exists for genuinely forgetting it, and it deletes
   * rows, on purpose (`lib/chief/store.ts`'s own docblock). This is a
   * different, smaller promise: clear what is drawn in this window. Every
   * turn with an id at or below this one is filtered out of `visible` below;
   * nothing is asked of main, nothing is deleted, and the chief still has
   * every word of it the next time anybody asks. Session-only by construction
   * — plain `useState`, not a store write — so leaving the page and coming
   * back (or `onAsked` re-reading the view after a fresh question) is what
   * makes the transcript legible again, the same honesty `chiefRoomView`'s own
   * doc gives that return.
   */
  const [clearedThroughId, setClearedThroughId] = useState<number | null>(null);
  const visible = visibleChiefTurns(view.turns, clearedThroughId);

  /*
   * Whole seconds since the press — the one number on this surface the renderer
   * measured first-hand, which is why it is the one number MAR-648's honesty
   * rule lets it show while a question is in flight. `AskComposer` carries the
   * same clock for the same reason, read from `Date.now()` rather than counted
   * per tick so a throttled background tab does not under-report.
   */
  useEffect(() => {
    if (!busy) {
      return;
    }
    const started = Date.now();
    const tick = window.setInterval(() => {
      setElapsed((Date.now() - started) / 1000);
    }, 1000);
    return () => {
      window.clearInterval(tick);
    };
  }, [busy]);

  /*
   * MAR-711. The scroll-to-newest and the Escape-closes-the-room effects both
   * moved into `Composer`, which owns them once for every surface — see that
   * file's own header. `scrollSignal` below is what replaces this component's
   * own `[open, visible.length]` dependency array.
   */

  async function ask(): Promise<void> {
    const asked = question.trim();
    if (asked.length === 0) {
      return;
    }
    onOpen();
    setFeedback(null);
    setElapsed(0);
    // Only for a question that will really wait on a provider. See the header.
    const willWait = !answeredFromRecords(asked);
    setBusy(willWait);
    const result = await askChief({ question: asked });
    setBusy(false);
    if (result.ok) {
      // Cleared only on success, `AskComposer`'s rule: a question that failed is
      // still in the box, so retrying is one press rather than typing it again.
      setQuestion("");
    }
    // The one place the room's old standing "no model" notice still reaches the
    // screen: `performChiefAction` puts its headline here on the exact question
    // that needed one (`fromRecords`'s `blocked` argument), so removing the
    // standing block lost no information a person who asked such a question
    // would not see anyway.
    setFeedback(result.detail ?? null);
    // The answer is not in `result`. It is in the store, and it reaches this
    // component when the page re-reads the view — one path by which an answer
    // becomes something on screen, and the same one a reopened conversation
    // takes. See `DispatchContext.chiefAction`.
    onAsked();
  }

  return (
    <Composer
      classes={CHIEF_COMPOSER_CLASSES}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      heading={CHIEF_CHAT_COPY.heading}
      closeLabel={CHIEF_CHAT_COPY.collapse}
      clearLabel={CHIEF_CHAT_COPY.clear}
      clearTitle={CHIEF_CHAT_COPY.clear_detail}
      clearDisabled={visible.length === 0}
      onClear={() => {
        const last = view.turns[view.turns.length - 1];
        if (last !== undefined) {
          setClearedThroughId(last.id);
        }
      }}
      scrollSignal={visible.length}
      /*
       * MAR-659, carried by MAR-742 roadmap item 1. The subject of this room
       * — the whole fleet, never one agent — is still a fact this composer
       * states, now as the field's own accessible name (`composer.tsx`'s own
       * header) rather than a visible line; the words a sighted reader sees
       * are the scope chip's, in `chips` below.
       */
      subjectLabel={CHIEF_CHAT_COPY.label}
      chips={<ChiefChips decisionsTotal={decisionsTotal} />}
      placeholder={CHIEF_CHAT_COPY.placeholder}
      value={question}
      onChange={setQuestion}
      /*
       * MAR-746. Through the guard rather than straight at `ask` — `start`
       * drops a press that arrives while the last one is still in flight, and
       * flips `pending` for the field. `void ask()` is what used to be here and
       * is what let three Enters become three turns.
       */
      onSubmit={() => {
        start(ask);
      }}
      pending={pending}
      textareaDisabled={false}
      /*
       * MAR-696. Perched on the field itself rather than beside it —
       * `.chief-input-wrap` is this glyph's positioning parent so it anchors
       * to the rounded box a person actually sees, not to the taller
       * `.chief-field` the visible subject caption sits above.
       */
      avatar={<ChiefComposerGlyph />}
      modelChip={<ChiefModelChip view={view} canAct={canAct} onChanged={onAsked} />}
      recallQuestions={visible.map((turn) => turn.question)}
    >
      {visible.length === 0 ? null : (
        <ol className="chief-turns" aria-label={CHIEF_CHAT_COPY.thread_kept_heading}>
          {visible.map((turn) => (
            <li key={turn.id} className="chief-turn">
              <p className="chief-asked wrap">
                <span className="chief-speaker">{CHIEF_CHAT_COPY.you}</span>
                {turn.question}
              </p>
              <ChiefTurnBody agents={agents} turn={turn} />
            </li>
          ))}
        </ol>
      )}

      {busy ? <ChiefActivity elapsed={elapsed} model={view.model_id} /> : null}
      {feedback === null ? null : <p className="chief-feedback wrap">{feedback}</p>}
    </Composer>
  );
}

/**
 * The chief's costume, perched on the composer rather than standing beside
 * it (MAR-696).
 *
 * `size={50}` — a row's scale, `OAvatarProps.size`'s own vocabulary — because
 * this is an accent on a control now, not the portrait `ChiefBand` used to
 * give it at `size={100}`. Sized through the prop rather than a CSS rule for
 * that prop's own reason: `OAvatar` writes `--o-size` as an inline style, so
 * a plain `width`/`height` override on `.chief-composer-o` would either lose
 * the cascade to that inline value or, worse, still apply and crop one corner
 * of the action sheet's frame instead of shrinking the whole character —
 * `app/globals.css`'s `.chief-glyph` rule is the one place in this codebase
 * that already had to learn this the hard way.
 */
function ChiefComposerGlyph(): ReactNode {
  return <OAvatar name="chief" size={50} action label={CHIEF_NAME} className="chief-composer-o" />;
}

/**
 * The scope and decisions chips, above the field (MAR-742 roadmap item 1,
 * §4.2/§4.5).
 *
 * The scope chip carries no destination — it says *whose* composer this is,
 * the fact `subjectLabel` used to spend a whole line on — so it is a `<span>`
 * rather than a control. The decisions chip is `.chip-link` (this
 * stylesheet's own vocabulary for a chip that is a destination) to
 * `/decisions`, absorbed from `app/page.tsx`'s own link rather than waiting
 * on MAR-679's next slice (Henrik's ruling, not this proposal's own default
 * of leaving it in place).
 */
function ChiefChips({ decisionsTotal }: { decisionsTotal: number }): ReactNode {
  const decisions = decisionsTotal === 0 ? null : describeDecisionsChip(decisionsTotal);
  return (
    <>
      <span className="chip" title={CHIEF_CHAT_COPY.label}>
        {CHIEF_CHAT_COPY.scope}
      </span>
      {decisions === null ? null : (
        <Link className="chip chip-link" href="/decisions" title={decisions.title}>
          {decisions.text}
        </Link>
      )}
    </>
  );
}

/**
 * Whose model the chief is asking under, and a way to change it (MAR-696,
 * ADR 0023 amendment 1; compacted into a chip and an anchored popover by
 * MAR-742 roadmap item 1).
 *
 * Always drawn, open or closed — Henrik's own words, *"the chief's current
 * model and a swap control"*, under the field rather than inside the room, so
 * it is not something a person has to open a conversation to see. Not
 * `.chief-settings`, the standing scope paragraph MAR-683 dropped: this is
 * one fact and one control, not a paragraph explaining what the room can do.
 *
 * ## What used to be a sentence is now a chip's `title`
 *
 * `describeChiefModelLine`'s distinction — the chief's own pin versus the
 * fleet default it falls back to — is still said, but the *fact that a
 * fallback is happening at all* has to stay on screen rather than only in an
 * attribute (`hidden text is still in the markup`): the `FLEET DEFAULT`
 * companion chip carries that, present only when `model_is_own` is false.
 *
 * ## The popover: same logic, a different container
 *
 * `ChiefModelPicker` below is byte-for-byte what it was — fetch on press,
 * never on mount, scoped to the provider already in force. What changed is
 * only `.chief-model-picker`'s own CSS: `app/globals.css` moved it from
 * `flex-basis: 100%` in this composer's flow to `position: absolute` anchored
 * to `.chief-model-chip` (the wrapper `composer.tsx` already draws around
 * whatever this returns), opening upward the same direction the room does.
 * Escape and an outside click both close it (§4.6 addition 3) — neither did
 * before, because there was nothing to click outside of when the panel was
 * simply the next row in the flow.
 */
function ChiefModelChip({
  view,
  canAct,
  onChanged,
}: {
  view: ChiefRoomView;
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const popover = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocumentKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    function onDocumentPointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (trigger.current?.contains(target) === true || popover.current?.contains(target) === true) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("keydown", onDocumentKeyDown);
    document.addEventListener("mousedown", onDocumentPointerDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
      document.removeEventListener("mousedown", onDocumentPointerDown);
    };
  }, [open]);

  if (view.model_id === null || view.model_provider_id === null) {
    const title = canAct ? `${CHIEF_CHAT_COPY.no_model} ${CHIEF_CHAT_COPY.no_model_link}` : CHIEF_CHAT_COPY.no_model;
    return canAct ? (
      <Link className="chip chip-warn chip-link" href="/settings/ai" title={title}>
        {CHIEF_CHAT_COPY.no_model_chip}
      </Link>
    ) : (
      <span className="chip chip-warn" title={title}>
        {CHIEF_CHAT_COPY.no_model_chip}
      </span>
    );
  }

  const title = describeChiefModelLine(view.model_is_own);
  const label = (
    <>
      <span>{CHIEF_CHAT_COPY.model_chip_label}</span> <code className="value">{view.model_id}</code>
    </>
  );

  return (
    <>
      {canAct ? (
        <button
          ref={trigger}
          type="button"
          className="chip chip-model"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={title}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          {label} <span aria-hidden="true">▾</span>
        </button>
      ) : (
        <span className="chip chip-model" title={title}>
          {label}
        </span>
      )}
      {view.model_is_own ? null : (
        <span className="chip chip-muted" title={title}>
          {CHIEF_CHAT_COPY.fleet_default_chip}
        </span>
      )}
      {open ? (
        <ChiefModelPicker
          containerRef={popover}
          providerId={view.model_provider_id}
          modelId={view.model_id}
          onChanged={() => {
            setOpen(false);
            onChanged();
          }}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The swap panel itself, asked for on press rather than fetched on mount
 * (MAR-696) — `ModelDefault`'s own rule, restated: a page that loaded a
 * provider's catalogue every time somebody opened this box would contact a
 * third party on every focus. Scoped to the one provider already in force
 * rather than every provider DASH holds a key for: a cross-provider swap is
 * `ModelDefault`'s own job on the AI tab in Settings, and this is a narrower
 * one — *change what the chief is already asking under*, not *choose among
 * everything DASH could ask under*.
 *
 * `containerRef` is `ChiefModelChip`'s own outside-click detection (MAR-742
 * roadmap item 1, §4.6 addition 3) — attached to this component's own root
 * rather than a wrapper `<div>` around it, so an empty flex item never lands
 * in `.chief-model-chip`'s row for the one frame this panel is closed.
 */
function ChiefModelPicker({
  containerRef,
  providerId,
  modelId,
  onChanged,
  onClose,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  providerId: string;
  modelId: string;
  onChanged: () => void;
  onClose: () => void;
}): ReactNode {
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; detail: string } | null>(null);
  const service = aiProviderById(providerId)?.label ?? "this service";

  async function ask(): Promise<void> {
    setBusy(true);
    setOutcome(null);
    const result = await listProviderModels({ provider_id: providerId });
    setBusy(false);
    if (!result.ok) {
      setOutcome({ ok: false, detail: result.detail ?? "DASH could not ask which models are available." });
      return;
    }
    setModels(result.models ?? []);
    setOutcome({ ok: true, detail: result.detail ?? "" });
  }

  async function choose(nextModelId: string): Promise<void> {
    setBusy(true);
    setOutcome(null);
    const result =
      nextModelId === ""
        ? await setChiefModel()
        : await setChiefModel({ provider_id: providerId, model_id: nextModelId });
    setBusy(false);
    setOutcome({ ok: result.ok, detail: result.detail ?? "" });
    if (result.ok) {
      onChanged();
    }
  }

  const listed = models === null ? [modelId] : models.includes(modelId) ? models : [modelId, ...models];

  return (
    <div className="chief-model-picker" ref={containerRef}>
      <select
        className="field"
        value={modelId}
        disabled={busy}
        onChange={(event) => {
          void choose(event.target.value);
        }}
      >
        <option value="">{CHIEF_CHAT_COPY.swap_default}</option>
        {listed.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
      <button type="button" className="button-secondary" disabled={busy} onClick={() => void ask()}>
        {models === null ? `See what ${service} offers` : `Ask ${service} again`}
      </button>
      <button type="button" className="button-secondary" onClick={onClose}>
        Done
      </button>
      {outcome === null || outcome.ok ? null : (
        <p className="notice-warn" role="status">
          {outcome.detail}
        </p>
      )}
    </div>
  );
}

/**
 * What DASH is doing while a question is in flight.
 *
 * `AskActivity`'s shape and its argument, restated for this room: the preload
 * bridge is `invoke`-only, so a question is one awaited round trip and the steps
 * inside it are invisible from here. A component that animated through their
 * names would be reciting a script — right about the order, wrong about the
 * timing, every time.
 *
 * The character is `chief`, which is the one the cast already holds for this
 * role — not a persona invented here. Bit-Command's fiction layer stays refused
 * whole and ADR 0023 adds nothing to it: no invented personality, no typing
 * animation, no name beyond `CHIEF_NAME`. `action` is the literal `true`
 * `scripts/brand-rules.mjs` requires, and it is a decision about this surface
 * rather than a fact about anything — this element only exists while a provider
 * really is being waited on.
 */
function ChiefActivity({ elapsed, model }: { elapsed: number; model: string | null }): ReactNode {
  return (
    <div className="ask-activity">
      <span className="ask-activity-o">
        <OAvatar name="chief" size={50} action />
      </span>
      {/*
        `role="status"` so the wait is announced rather than only seen. The model
        id is inside the live region and the seconds are not: a counter in a live
        region would announce itself once a second forever, which is the
        accessibility failure that makes people turn the feature off.
      */}
      <p className="ask-activity-line" role="status">
        <span className="visually-hidden">{CHIEF_CHAT_COPY.activity_label}. </span>
        {describeChiefActivity(elapsed)}
        {model === null ? null : (
          <>
            {" "}
            <code className="value">{model}</code>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * One turn, drawn.
 *
 * Three parts and a strict order: what was said, who could say more about it,
 * and what DASH read before saying it. The receipt is last because it is the
 * thing a reader checks the answer *against* — putting it above would make
 * somebody read the evidence before the claim.
 */
function ChiefTurnBody({
  agents,
  turn,
}: {
  agents: readonly AgentRow[];
  turn: ChiefTurnView;
}): ReactNode {
  if (turn.answer === null) {
    return (
      <div className="chief-reply">
        <p className="chief-says wrap">
          <span className="chief-speaker">{CHIEF_NAME}</span>
          {turn.failure?.headline}
        </p>
        <p className="muted wrap">{turn.failure?.meaning}</p>
        <p className="wrap">{turn.failure?.next_action}</p>
      </div>
    );
  }

  return (
    <div className="chief-reply">
      {/*
        The answer as it arrived, as plain text and nothing else. Never parsed,
        no link followed out of it, no command derived from it — ADR 0012's
        structural guarantee, unchanged by the chief gaining a voice.
      */}
      <p className="chief-says wrap">
        <span className="chief-speaker">{CHIEF_NAME}</span>
        {turn.answer}
      </p>

      <ChiefHandoff agents={agents} turn={turn} />
      <ChiefReceipt turn={turn} />
    </div>
  );
}

/**
 * The agent this question is really for, when one declared the subject.
 *
 * MAR-648's hand-off, kept (ADR 0023 decision 8). The chief never answers *from*
 * an agent's saved material — the briefing carries counts and titles, never item
 * text — so a question about what one **found** is named and linked rather than
 * guessed at, and the link goes to the surface that can answer it and charge for
 * it properly.
 *
 * DASH supplies the link, from `routeRequest` over the fleet as it is now. The
 * model may or may not have mentioned the same agent in its own sentence; this
 * is not read out of that sentence, which is the same discipline the receipt
 * below follows and for the same reason.
 */
function ChiefHandoff({
  agents,
  turn,
}: {
  agents: readonly AgentRow[];
  turn: ChiefTurnView;
}): ReactNode {
  if (turn.handoffs.length === 0) {
    return null;
  }
  const known = new Set(agents.map((agent) => agent.name));
  const live = turn.handoffs.filter((one) => known.has(one.agent));
  if (live.length === 0) {
    // Every agent this question once routed to has been removed. Nothing is
    // drawn rather than a dead link — `ChiefHandoffView`'s own reason for being
    // recomputed instead of frozen.
    return null;
  }

  if (live.length === 1) {
    const one = live[0] as (typeof live)[number];
    return (
      <div className="chief-handoff">
        <Says sentence={describeRouted(one.title, one.goal)} />
        <Says sentence={describeMatch(turn.matched)} />
        <Link className="button-link" href={agentStageHref(one.agent, "chat")}>
          {CHIEF_CHAT_COPY.open_chat}
        </Link>
      </div>
    );
  }

  return (
    <div className="chief-handoff">
      <Says sentence={describeAmbiguous(live.map((one) => one.title))} />
      <ul className="chief-choices">
        {live.map((one) => (
          <li key={one.agent}>
            <Link className="button-link" href={agentStageHref(one.agent, "chat")}>
              {one.title}
            </Link>
          </li>
        ))}
      </ul>
      <Says sentence={describeMatch(turn.matched)} />
    </div>
  );
}

/**
 * What DASH read before it answered, listed from DASH's own records.
 *
 * **The receipt, not the prompt, is the guarantee** (ADR 0023 decision 5). Every
 * row here came out of the store on the way *in*; nothing is parsed out of the
 * answer text. A model that invents an agent cannot make that agent appear in
 * this table beside its sentence, and a person can check the phrasing above
 * against DASH's own list without leaving the room.
 *
 * What it does not do is named rather than designed around: a model can
 * attribute a fact to the wrong agent, omit an agent, or soften a definite fact
 * into a vague one. The receipt makes those visible; it does not make them
 * impossible. `describeChiefReceipt` says so in the sentence above the list.
 *
 * `stale` is DASH comparing two of its own records — the frozen rows against the
 * fleet now — and it says the fleet changed, never that the answer is wrong.
 *
 * ## A disclosure, not a table always open (MAR-683)
 *
 * What has to stay visible without a click is what a person needs before they
 * trust or spend on the next question: whether this one was free or charged,
 * under which model, and whether the fleet has moved since. What can wait for a
 * click is the detail that backs a check somebody was not necessarily about to
 * make — which agents, which fields, in what words. `<details>` is a native
 * disclosure rather than a component: no script decides whether it opens, and
 * nothing about "no buttons" is in tension with a control the browser itself
 * draws for exactly this. The empty-receipt case skips the disclosure
 * altogether — one reassuring sentence is not the table this is about.
 */
/**
 * What the chief read or fetched for this turn (MAR-744).
 *
 * Above the briefing receipt and below the answer, which is the same ordering
 * rule `ChiefTurnBody` states: the thing a reader checks the answer against goes
 * underneath the claim. Of the two receipts this is the closer one — a citation
 * backs a sentence in the answer directly, where a briefing row backs the fact
 * that the fleet was read at all.
 *
 * ## Every link here is DASH's own record
 *
 * `href` came out of a feed, through `lib/chief/evidence.ts`, into a column, and
 * back. It was never in the answer text and was never sent to the model —
 * `renderChiefItem` and `renderFetchedMaterial` both omit addresses on purpose,
 * so there is no path by which a model could put a link on this list. That is
 * the same grounding discipline `AskCitation` has, and it is the reason a
 * citation panel is worth showing at all.
 *
 * `LinkOut` rather than a bare anchor, for the reason that component exists: an
 * `<a href>` in DASH's window is denied by the navigation wall and reads to a
 * person as a dead link. It routes the press to main, which opens the person's
 * own browser.
 *
 * The list is open rather than behind a disclosure, unlike the briefing rows.
 * Henrik's bar for this packet is *"new fetched sources listed and linked"* —
 * a list nobody can see without a click is not that, and unlike the briefing it
 * is short by construction.
 */
function ChiefEvidence({ turn }: { turn: ChiefTurnView }): ReactNode {
  const evidence = turn.evidence;
  if (evidence === null) {
    return null;
  }

  return (
    <div className="chief-evidence">
      <p className="muted wrap">{evidence.note}</p>
      {evidence.sources.length === 0 ? null : (
        <ul className="chief-evidence-sources">
          {evidence.sources.map((source) => (
            <li key={source.name}>
              {source.name}
              {/* The outcome, in `lib/copy/chief-sources.ts`' words rather than
                  a status code. The ones that did not answer are listed too,
                  which is what stops a list of two implying DASH asked two. */}
              <span className="muted"> · {source.outcome}</span>
            </li>
          ))}
        </ul>
      )}
      {evidence.citations.length === 0 ? null : (
        <ol className="chief-citations">
          {evidence.citations.map((citation) => (
            <li key={`${String(turn.id)}-${String(citation.index)}`}>
              {/* The number the model was given, so a mention of "the second
                  one" in the answer above resolves to a row on screen. */}
              <span className="chief-cite-index">{citation.index}</span>{" "}
              {citation.href === null ? (
                <span className="wrap">{citation.headline}</span>
              ) : (
                <LinkOut className="wrap" href={citation.href}>
                  {citation.headline}
                </LinkOut>
              )}
              <span className="muted wrap"> · {citation.where}</span>
              {citation.agent === null ? null : (
                <>
                  {" "}
                  <Link
                    className="chief-demand-agent"
                    href={agentStageHref(
                      citation.agent,
                      "output",
                      citation.output === null ? {} : { output: citation.output },
                    )}
                  >
                    {CHIEF_CHAT_COPY.citation_report_link}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ChiefReceipt({ turn }: { turn: ChiefTurnView }): ReactNode {
  return (
    <div className="chief-receipt">
      {turn.stale ? <p className="chief-stale wrap">{CHIEF_CHAT_COPY.stale}</p> : null}
      <p className="muted chief-charge">
        {turn.charge ?? CHIEF_CHAT_COPY.free}
        {turn.model === null ? null : (
          <>
            {" "}
            <code className="value">{turn.model}</code>
          </>
        )}
      </p>
      <ChiefEvidence turn={turn} />
      {turn.receipt.length === 0 ? (
        /*
         * Silent when a tool ran (MAR-744, attended run).
         *
         * `describeChiefReceipt(0)` says "nothing from your records was used for
         * this one", which was true of every turn that could reach it before
         * this packet. A tool turn sends no briefing, so it lands here too --
         * and printed that sentence directly underneath a panel listing twelve
         * things read out of the person's own records. The evidence panel
         * carries its own accounting sentence, so the honest thing here is to
         * say nothing rather than to contradict it.
         */
        turn.evidence === null ? <p className="muted wrap">{turn.receipt_note}</p> : null
      ) : (
        <details className="chief-sources">
          <summary>{CHIEF_CHAT_COPY.receipt_heading}</summary>
          <p className="muted wrap">{turn.receipt_note}</p>
          <ul className="chief-receipt-rows">
            {turn.receipt.map((row) => (
              <li key={row.agent}>
                <Link className="chief-demand-agent" href={agentStageHref(row.agent, "overview")}>
                  {row.title}
                </Link>
                {/* Every one of these is a string DASH already prints on that
                    agent's own card, quoted rather than reworded — which is what
                    lets a reader check this list against the cards behind the
                    room without translating anything. */}
                <span className="chip">{row.place}</span>
                <span className="muted"> {row.runs}</span>
                {row.last_run === null ? null : <span className="muted"> · {row.last_run}</span>}
                <span className="muted wrap"> {row.standing}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted chief-when">{turn.asked}</p>
    </div>
  );
}

/**
 * One of the chief's sentences, with whatever travels beside it.
 *
 * The three fields are drawn three different ways and that is the whole reason
 * `ChiefSentence` has three: DASH's own words as prose, an author's words as an
 * attributed quotation, and identifiers as values in monospace. Flattening any
 * of them into the others is the mistake the type exists to make impossible.
 */
function Says({ sentence }: { sentence: ChiefSentence }): ReactNode {
  return (
    <>
      <p className="chief-says wrap">
        {/* MAR-659. Visible, and the one accent on this room's turns: it marks
            whose paragraph this is without a bar or a box around it. */}
        <span className="chief-speaker">{CHIEF_NAME}</span>
        {sentence.sentence}
      </p>
      {sentence.quoted === null ? null : (
        /* An author's sentence, marked as one. `<blockquote>` rather than a
           class, because the distinction being drawn — these are somebody
           else's words, not DASH's — is exactly what the element means. */
        <blockquote className="chief-quoted wrap">{sentence.quoted}</blockquote>
      )}
      {sentence.values.length === 0 ? null : (
        <ul className="chief-values">
          {sentence.values.map((value) => (
            <li key={value}>
              <code className="value">{value}</code>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
