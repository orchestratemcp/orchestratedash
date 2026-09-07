"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * The chrome every DASH composer-with-a-room draws, factored out of the
 * chief's own (MAR-648, MAR-696) so the agent page's Ask surface can adopt it
 * exactly rather than copy it (MAR-711).
 *
 * ## What is shared, and what stays per surface
 *
 * A row of chips above the field, a rounded field with an enter glyph
 * standing in for a submit button, a room that expands **upward** above the
 * field on focus with its own heading, a pinned Close and Clear, and a
 * footer row — the model chip and a send hint — always drawn beneath the
 * field: that shape is this file, once, and both surfaces render through it.
 * What differs between a question to the fleet and a question to one agent
 * is everything the shape does not decide: what asking means, what a turn
 * looks like, which chips this surface has a fact for, whose model chip this
 * is (a control on the fleet's room, a link on the agent's), and whether
 * there is a costume perched on the field. Those stay in `chief-chat.tsx`
 * and `ask.tsx`, each supplying its own `children` (the transcript, in
 * whatever shape its turns take), its own `chips` and `modelChip`, and its
 * own `classes` — a per-surface class-name table rather than a per-surface
 * stylesheet, so `app/globals.css` states each rule once, against both a
 * surface's classes at once, and a restyle of one composer that forgot the
 * other fails the stylesheet-reading half of `tests/composer-shared.test.tsx`
 * the way `tests/fleet-view.test.ts` catches a view rule that forgot a track.
 *
 * ## MAR-742 roadmap item 1: the chip row replaces the full-width sentences
 *
 * Henrik, with a side-by-side screenshot of Claude Code's own composer:
 * *"Again your chat and layout and functions are the model... Can you mimic
 * it please."* Three named deltas — a compact model dropdown rather than a
 * boxed SWAP row, chips above the composer, tighter overall geometry — are
 * one delta seen from three sides: this file used to spend a full-width row
 * on every fact the reference spends a chip on. `docs/proposals/chief-chat-
 * composer-2026-08-24.md` is the design work this packet executes; see it
 * for the arithmetic and the annotated comparison.
 *
 * The old `.chief-subject`/`.ask-subject` visible line is gone — its words
 * move into the scope chip a caller passes through `chips`, and its
 * accessible-name job moves onto `subjectLabel`, now an `aria-label` on the
 * field's own `<label>` rather than a line a sighted reader had to parse
 * past. Nothing is deleted: `subjectLabel` still carries the same sentence a
 * caller supplies, and a reader who wants the fuller words gets them from the
 * chip's own `title`. `hidden text is still in the markup` is exactly what a
 * *removed* fact would risk; an `aria-label` is the ordinary, idiomatic way
 * to name a control, not that trap in a smaller costume.
 *
 * The old `modelLine` prop is `modelChip` now — still always drawn, still a
 * `ReactNode` a caller controls, but `chief-chat.tsx`'s picker no longer
 * pushes the row below it down: an anchored popover replaces the in-flow
 * `flex-basis: 100%` panel, and `app/globals.css`'s own rule says why the old
 * one cost `≈116px` at 375 every time somebody opened it.
 *
 * `classes` is a lookup table and not a `surface` string this component
 * switches on, on purpose: the chief's markup already shipped and is
 * machine-proven (MAR-696's own capture harness, `electron/capture-mar615.ts`,
 * reads `.chief-composer`/`.chief-room`/`.chief-input` by name), so this
 * keeps every one of those class names exactly as they were rather than
 * asking that harness to learn a new vocabulary for a component it does not
 * own. The agent's own classes are new names carrying the same shape.
 *
 * ## What this file owns behaviourally
 *
 * Four things neither surface has to reimplement: Escape closes the room
 * from anywhere in it, not only from the field (bound to `document`, not the
 * textarea — `ChiefChat`'s own MAR-683 reasoning: a person reading a turn has
 * not necessarily left focus in the textarea); the room scrolls to its
 * newest content when `scrollSignal` grows, honouring
 * `prefers-reduced-motion`; Enter sends while Shift+Enter is a newline; and
 * **a send in flight closes the field to further presses** (`pending`, below).
 * Each surface still owns its own `question` state, its own busy/elapsed
 * clock, and its own submit function — those are not chrome, they are what
 * "asking" means on that surface, and duplicating a few lines of
 * `useState`/`useEffect` per surface costs less than a generic async state
 * machine both surfaces would have to bend to fit.
 *
 * ## MAR-746: the in-flight guard, and why it is here rather than per surface
 *
 * Henrik, on the MAR-743 scratch instance: *"I pressed enter on chief chat and
 * it didn't instantly send the message. I had time to press enter 3 times
 * before any reaction and it sent the message three times."* Three turns, three
 * charges, one question — visible in `chief_messages` as three rows seconds
 * apart.
 *
 * Enter is this file's own key handler, so the surface that had no guard could
 * not have added one without reaching into chrome it does not own. `pending`
 * closes it in the one place both surfaces already share:
 *
 * - The textarea renders `disabled`, which is both the stop and the
 *   acknowledgment. MAR-746's own bar is that a press is acknowledged *within
 *   one frame* even when the work takes seconds, and a disabled field is a
 *   frame-one fact: React commits the attribute in the same discrete update as
 *   the press, before paint, with no round trip in between — measured at 7ms
 *   with main's own thread deliberately blocked for two seconds, against
 *   2018ms for the same press before this (`qa-lag-mar746/`). `aria-busy` on
 *   the root says the same thing to a screen reader, which cannot see the grey.
 * - `onKeyDown` refuses Enter anyway, **before** `onSubmit` is reached. A
 *   disabled textarea receives no key events at all, so this is deliberately
 *   the second lock and not the first: it is what holds if a surface ever
 *   passes `pending` without letting the field go disabled, and it is the arm a
 *   test can drive (`sendsOnEnter`) when no test in this repository can press a
 *   key.
 * - Focus comes back when the send finishes (the `pending` effect below).
 *   Disabling a focused element blurs it, so without that a person who asked
 *   one question would have to click back into the field to ask the next — the
 *   guard trading one defect for a smaller one. The restore is conditional on
 *   having had focus at the moment it was taken away, so somebody who
 *   deliberately clicked elsewhere while waiting does not get yanked back.
 *
 * `useSingleFlight` (`single-flight.ts`) is the other half, and the half a
 * test can drive.
 */

export interface ComposerClassNames {
  root: string;
  room: string;
  roomHead: string;
  roomHeading: string;
  roomActions: string;
  roomClear: string;
  roomClose: string;
  roomScroll: string;
  /** The row of chips above the field (MAR-742 roadmap item 1). */
  chips: string;
  compose: string;
  field: string;
  inputWrap: string;
  input: string;
  enterGlyph: string;
  /** The row below the field: the model chip, and the send hint. */
  foot: string;
  /** Wraps whatever `modelChip` renders — the chip button or link, plus the
   *  inherited-model companion chip when there is one. */
  modelChip: string;
  /** The `↵ to ask` hint, always drawn at the footer's right end. */
  hint: string;
}

export function Composer({
  classes,
  open,
  onOpen,
  onClose,
  heading,
  closeLabel,
  clearLabel,
  clearTitle,
  clearDisabled,
  onClear,
  children,
  scrollSignal,
  chips,
  subjectLabel,
  placeholder,
  value,
  onChange,
  onSubmit,
  pending,
  textareaDisabled,
  avatar = null,
  modelChip,
  recallQuestions,
}: {
  classes: ComposerClassNames;
  /** Whether the room is showing. Owned by the caller, which dims whatever it sits over. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The room's heading, and its accessible name. */
  heading: string;
  /** The X's accessible name. */
  closeLabel: string;
  /** Clear's own visible label — short, because every button here renders upper-case. */
  clearLabel: string;
  /** Clear's fuller, honest scope — `title`, not the visible label. */
  clearTitle: string;
  clearDisabled: boolean;
  onClear: () => void;
  /** The transcript, the busy line and the feedback line, in that order — rendered only while the room is open. */
  children: ReactNode;
  /** Grows when there is more to scroll to — the room scrolls to its own bottom when this changes. */
  scrollSignal: number;
  /**
   * Above the field, always (MAR-742 roadmap item 1): the scope chip, and
   * whatever else this surface has a fact for — the decisions chip on the
   * chief's own room, nothing extra on the agent's. See `composer.tsx`'s own
   * header for why this is per-surface content passed in rather than a
   * `surface` string switched on here.
   */
  chips: ReactNode;
  /** The composer's accessible name — `<label>`'s own `aria-label` now, not a
   *  visible line (the visible half moved into `chips`' own scope chip). */
  subjectLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter (not Shift+Enter). There is no submit button anywhere in this component. */
  onSubmit: () => void;
  /**
   * A send this surface has started and not yet finished (MAR-746).
   *
   * While true the field is disabled and Enter is refused before it can reach
   * `onSubmit`. Callers get this from `useSingleFlight` (`single-flight.ts`)
   * rather than inventing their own flag, so the thing that closes the field
   * and the thing that drops the duplicate call are the same fact.
   */
  pending: boolean;
  textareaDisabled: boolean;
  /** A costume perched on the field, positioned by `classes.inputWrap`. Absent draws none. */
  avatar?: ReactNode;
  /** Always drawn, open or closed — whose model this composer asks under, and how to change it. */
  modelChip: ReactNode;
  /**
   * The kept questions, oldest first, for `↑`/`↓` to walk (MAR-742 roadmap
   * item 1). The raw questions only — not a turn or an exchange type, which
   * differ per surface — so this file stays ignorant of what a turn is.
   */
  recallQuestions: readonly string[];
}): ReactNode {
  const thread = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  /*
   * MAR-746. Whether the caret was in this field at the moment the send took it
   * away, so the restore below can be conditional rather than a grab.
   *
   * A ref rather than state on purpose: nothing renders differently for it, and
   * a state update here would schedule a second render inside the effect that
   * reads it for no visible reason.
   */
  const hadFocus = useRef(false);
  /*
   * MAR-742 roadmap item 1. How many `↑`s deep the current recall walk is —
   * 0 means the field holds whatever was actually typed, not a recalled
   * question. `draftBeforeRecall` is what the first `↑` overwrote, so `↓`
   * walking past the newest question and `Escape` mid-walk both have
   * something honest to restore rather than leaving the field empty.
   */
  const [recallIndex, setRecallIndex] = useState(0);
  const draftBeforeRecall = useRef("");

  /*
   * MAR-746. Give the field back when the send finishes.
   *
   * `disabled` blurs whatever it lands on, so without this the guard would fix
   * "three questions asked" by costing a click before the next one — a trade a
   * person types their way straight into. The `pending` branch records rather
   * than restores, so the answer to "did they have focus" is taken at the
   * moment focus was taken, not seconds later when the reply lands and the
   * person may have clicked into something else entirely.
   */
  useEffect(() => {
    if (pending) {
      hadFocus.current = document.activeElement === field.current;
      return;
    }
    if (hadFocus.current) {
      hadFocus.current = false;
      field.current?.focus();
    }
  }, [pending]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocumentKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
        /*
         * MAR-742 roadmap item 1, §4.6 addition 2. Escape used to close the
         * room and leave focus wherever it was — a person reading a turn had
         * to click back into the field to type the next question. This
         * branch never fires for the recall's own Escape (that one is
         * handled, and stopped from bubbling here, in `onKeyDown` below),
         * so it only runs when Escape is genuinely closing the room.
         */
        field.current?.focus();
      }
    }
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || scrollSignal <= 0) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [open, scrollSignal]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    /*
     * MAR-742 roadmap item 1, §4.6 addition 1. `↑` recalls the previous
     * question on an *empty* field only — on a non-empty one it is an
     * ordinary caret move, because a recall that ate somebody's half-typed
     * question would be the MAR-746 defect in another costume. Once a walk
     * has started (`recallIndex > 0`) every further `↑`/`↓` belongs to it
     * regardless of what the field holds, since the field's own text is now
     * the recalled question rather than a draft.
     */
    if (event.key === "ArrowUp" && !event.shiftKey) {
      if (recallIndex === 0 && value !== "") {
        return;
      }
      event.preventDefault();
      const next = recallIndex + 1;
      if (recallIndex === 0) {
        draftBeforeRecall.current = value;
      }
      setRecallIndex(next);
      onChange(recallAt(recallQuestions, next, draftBeforeRecall.current));
      return;
    }
    if (event.key === "ArrowDown" && !event.shiftKey) {
      if (recallIndex === 0) {
        return;
      }
      event.preventDefault();
      const next = recallIndex - 1;
      setRecallIndex(next);
      onChange(recallAt(recallQuestions, next, draftBeforeRecall.current));
      return;
    }
    /*
     * MAR-742 roadmap item 1, §4.6 addition 1. Escape mid-walk restores the
     * pre-recall draft and stays in the field — it does not close the room.
     * `stopPropagation` is why: the room's own Escape handler is bound to
     * `document` (above), so without this an Escape meant to back out of a
     * recall would also collapse the room underneath it.
     */
    if (event.key === "Escape" && recallIndex > 0) {
      event.preventDefault();
      event.stopPropagation();
      setRecallIndex(0);
      onChange(draftBeforeRecall.current);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    /*
     * MAR-746. `preventDefault` before the guard, not after it: a refused Enter
     * must not fall through to the textarea's own newline either, or somebody
     * pressing it three times while waiting would find two blank lines in front
     * of their next question. Whether it *sends* is `sendsOnEnter` — pure and
     * exported so a test can drive the refusal without a DOM, and called here
     * rather than restated, so the tested condition is this condition.
     */
    event.preventDefault();
    if (sendsOnEnter(event, pending)) {
      setRecallIndex(0);
      onSubmit();
    }
  }

  return (
    <div
      className={open ? `${classes.root} is-open` : classes.root}
      /*
       * MAR-746. What the grey field says to somebody who cannot see it. On the
       * root rather than the textarea because the room below it is also waiting
       * — the whole composer is mid-send, not one control inside it.
       */
      aria-busy={pending}
    >
      {open ? (
        <div className={classes.room}>
          <div className={classes.roomHead} aria-label={heading}>
            <p className={classes.roomHeading}>{heading}</p>
            <div className={classes.roomActions}>
              <button
                type="button"
                className={classes.roomClear}
                title={clearTitle}
                disabled={clearDisabled}
                onClick={onClear}
              >
                {clearLabel}
              </button>
              <button type="button" className={classes.roomClose} aria-label={closeLabel} onClick={onClose}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>

          <div className={classes.roomScroll} ref={thread}>
            {children}
          </div>
        </div>
      ) : null}

      {/*
        MAR-742 roadmap item 1. Above the field, always — the reference's own
        placement for what it will send along with the message. Wraps
        unconditionally rather than truncating at 375: a chip nobody can act
        on for want of screen space is `unfindable-is-the-same-as-missing` in
        another costume.
      */}
      <div className={classes.chips}>{chips}</div>

      <div className={classes.compose}>
        <label className={classes.field} aria-label={subjectLabel}>
          <span className={classes.inputWrap}>
            <textarea
              ref={field}
              className={classes.input}
              rows={open ? 2 : 1}
              value={value}
              placeholder={placeholder}
              /*
               * MAR-746. The acknowledgment, and the reason it is `disabled`
               * rather than `readOnly`: read-only keeps the caret and the
               * ordinary colours, which is precisely the state Henrik could not
               * tell from a field that had ignored him. `disabled` is visible
               * in one frame and it is what stops the key press at the browser
               * rather than at a handler.
               */
              disabled={textareaDisabled || pending}
              onChange={(event) => {
                setRecallIndex(0);
                onChange(event.target.value);
              }}
              onFocus={onOpen}
              onKeyDown={onKeyDown}
            />
            {/* The affordance a submit button used to occupy — Enter already sends. */}
            <span className={classes.enterGlyph} aria-hidden="true">
              ↵
            </span>
            {avatar}
          </span>
        </label>
      </div>

      {/*
        MAR-742 roadmap item 1. The model chip and the send hint, replacing
        the old always-drawn model line — one compact row instead of a
        sentence, with the `.chip .value` rule keeping the model id itself
        uncased. `↵ to ask` is decorative chrome, `.chief-enter-glyph`'s own
        precedent: never a sentence a copy sweep has to hold, just the key
        this composer has always sent on.
      */}
      <div className={classes.foot}>
        <div className={classes.modelChip}>{modelChip}</div>
        <span className={classes.hint} aria-hidden="true">
          ↵ to ask
        </span>
      </div>
    </div>
  );
}

/**
 * What `↑`/`↓` should show in the field, given how many steps back from the
 * newest question the reader has already walked (MAR-742 roadmap item 1,
 * §4.6 addition 1).
 *
 * Pure, and exported for `sendsOnEnter`'s own reason: every render test here
 * is `renderToStaticMarkup`, which fires no key event, so the walk itself has
 * to be provable without one. `questions` is oldest-first — every view's own
 * order — and `index` is how many `↑`s deep the walk is: 0 means "not
 * recalling", still `draft`. Past the oldest question, further `↑`s keep
 * returning that same oldest one rather than wrapping or going blank —
 * `Math.min` clamps rather than modulo, because a repeat is a less surprising
 * floor than a walk that suddenly loops back to the newest.
 */
export function recallAt(questions: readonly string[], index: number, draft: string): string {
  if (index <= 0 || questions.length === 0) {
    return draft;
  }
  const clamped = Math.min(index, questions.length);
  return questions[questions.length - clamped] ?? draft;
}

/**
 * Whether this key press is a send (MAR-746).
 *
 * Pure, and exported for that reason: every render test in this repository is
 * `renderToStaticMarkup`, so no key press ever reaches `Composer`'s own
 * `onKeyDown`, and "the third Enter while the first is still in flight does
 * nothing" is exactly the claim a render cannot exercise. Testing the condition
 * directly is what proves the refusal, independent of whether a test harness can
 * ever press a key.
 *
 * Shift+Enter is a newline and is *not* a send — and, deliberately, is not
 * refused while pending either: a person composing the next paragraph while
 * waiting for the last answer is doing something reasonable, and the field
 * being disabled is what stops them rather than this.
 */
export function sendsOnEnter(
  event: { key: string; shiftKey: boolean },
  pending: boolean,
): boolean {
  return event.key === "Enter" && !event.shiftKey && !pending;
}

/**
 * What a session-only Clear filters out, shared by both composers' rooms
 * (MAR-696, generalized MAR-711).
 *
 * Pure, and exported for that reason: every render test in this repository is
 * `renderToStaticMarkup`, so no effect runs and no click reaches a room's own
 * `onClick` — the honesty of "empties what is drawn, and nothing DASH keeps"
 * is exactly the thing a render cannot exercise without testing the filter
 * directly.
 *
 * `items` is oldest-first and `id` only ever grows, so "greater than the
 * cleared boundary" is "asked after the clear". Neither surface deletes a row
 * for this — the chief still has `chief_messages`, an agent's exchanges still
 * live in the store — this only changes what a room draws.
 */
export function filterAfterClear<T extends { id: number }>(
  items: readonly T[],
  clearedThroughId: number | null,
): readonly T[] {
  return clearedThroughId === null ? items : items.filter((item) => item.id > clearedThroughId);
}
