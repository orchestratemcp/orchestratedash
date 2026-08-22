"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/**
 * The chrome every DASH composer-with-a-room draws, factored out of the
 * chief's own (MAR-648, MAR-696) so the agent page's Ask surface can adopt it
 * exactly rather than copy it (MAR-711).
 *
 * ## What is shared, and what stays per surface
 *
 * A rounded field with an enter glyph standing in for a submit button, a room
 * that expands **upward** above the field on focus with its own heading, a
 * pinned Close and Clear, and a model line always drawn beneath the field —
 * that shape is this file, once, and both surfaces render through it. What
 * differs between a question to the fleet and a question to one agent is
 * everything the shape does not decide: what asking means, what a turn looks
 * like, whose model line this is, and whether there is a costume perched on
 * the field. Those stay in `chief-chat.tsx` and `ask.tsx`, each supplying its
 * own `children` (the transcript, in whatever shape its turns take), its own
 * `modelLine`, and its own `classes` — a per-surface class-name table rather
 * than a per-surface stylesheet, so `app/globals.css` states each rule once,
 * against both a surface's classes at once, and a restyle of one composer
 * that forgot the other fails the stylesheet-reading half of
 * `tests/composer-shared.test.tsx` the way `tests/fleet-view.test.ts` catches
 * a view rule that forgot a track.
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
 * Three things neither surface has to reimplement: Escape closes the room
 * from anywhere in it, not only from the field (bound to `document`, not the
 * textarea — `ChiefChat`'s own MAR-683 reasoning: a person reading a turn has
 * not necessarily left focus in the textarea); the room scrolls to its
 * newest content when `scrollSignal` grows, honouring
 * `prefers-reduced-motion`; and Enter sends while Shift+Enter is a newline.
 * Each surface still owns its own `question` state, its own busy/elapsed
 * clock, and its own submit function — those are not chrome, they are what
 * "asking" means on that surface, and duplicating a few lines of
 * `useState`/`useEffect` per surface costs less than a generic async state
 * machine both surfaces would have to bend to fit.
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
  compose: string;
  field: string;
  subject: string;
  inputWrap: string;
  input: string;
  enterGlyph: string;
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
  subjectLabel,
  placeholder,
  value,
  onChange,
  onSubmit,
  textareaDisabled,
  avatar = null,
  modelLine,
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
  /** Above the field, visible rather than announcement-only — whose composer this is. */
  subjectLabel: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter (not Shift+Enter). There is no submit button anywhere in this component. */
  onSubmit: () => void;
  textareaDisabled: boolean;
  /** A costume perched on the field, positioned by `classes.inputWrap`. Absent draws none. */
  avatar?: ReactNode;
  /** Always drawn, open or closed — whose model this composer asks under, and how to change it. */
  modelLine: ReactNode;
}): ReactNode {
  const thread = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocumentKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") {
        onClose();
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className={open ? `${classes.root} is-open` : classes.root}>
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

      <div className={classes.compose}>
        <label className={classes.field}>
          <span className={classes.subject}>{subjectLabel}</span>
          <span className={classes.inputWrap}>
            <textarea
              className={classes.input}
              rows={open ? 2 : 1}
              value={value}
              placeholder={placeholder}
              disabled={textareaDisabled}
              onChange={(event) => onChange(event.target.value)}
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

      {modelLine}
    </div>
  );
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
