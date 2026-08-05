"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * DASH's own title bar (MAR-440).
 *
 * The native menu bar is hidden in `electron/main.ts`, so this is the strip the
 * window is dragged by and the only place the application menu can still be
 * reached with a mouse. The window buttons themselves stay Windows' own — see
 * `lib/shell/chrome.ts` for why — and this bar leaves room for them.
 *
 * ## Why this renders in the browser too
 *
 * The developer path (`pnpm dev` in a tab) has no shell, so there is no window
 * to drag and no menu to pop. The bar still renders, because a component that
 * only exists in one of the two hosts is a component nobody sees break in the
 * other, and MAR-432's whole argument is that the packaged renderer *is* the
 * real DASH UI. What changes is the menu button, which is not drawn at all when
 * there is no bridge to answer it — an inert button that looks like a control is
 * worse than an absent one.
 */

/*
 * `window.dashShell` is declared once, in `app/_data/source.ts`, beside the
 * other bridge. Redeclaring it here would be a second answer to a question that
 * already has one — and TypeScript merges global interfaces silently, so the
 * two would only be found to disagree when one of them changed.
 */

export interface TitleBarProps {
  /**
   * The surface the user is on, in the words the navigation uses.
   *
   * Named rather than derived from the path inside this component: a route is
   * DASH's vocabulary and a surface name is the user's, and turning one into
   * the other here would put the mapping somewhere no test would look for it.
   */
  surface: string;
}

export function TitleBar({ surface }: TitleBarProps): ReactNode {
  const [hasShell, setHasShell] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  /*
   * After mount, never during render.
   *
   * The renderer is a static export: this component is rendered once at build
   * time, where `window` does not exist and `dashShell` certainly does not.
   * Reading it during render would mean the build decided whether the user has
   * a shell, which it cannot know.
   */
  useEffect(() => {
    setHasShell(typeof window.dashShell?.openAppMenu === "function");
  }, []);

  /*
   * Reserve the room Windows needs for its own caption buttons.
   *
   * `titleBarOverlay` puts minimise/maximise/close inside our client area, and
   * their width is the operating system's business — it changes with display
   * scaling and it is not the same on every Windows build. Chromium exposes the
   * real geometry as `navigator.windowControlsOverlay`, so the inset is
   * measured rather than guessed. Guessing it is how a close button ends up
   * sitting on top of a control.
   */
  useEffect(() => {
    const overlay = (
      navigator as Navigator & {
        windowControlsOverlay?: {
          visible: boolean;
          getTitlebarAreaRect(): DOMRect;
          addEventListener(type: "geometrychange", listener: () => void): void;
          removeEventListener(type: "geometrychange", listener: () => void): void;
        };
      }
    ).windowControlsOverlay;
    if (overlay === undefined) {
      return;
    }
    /*
     * `visible` is checked, and the width is checked again after that.
     *
     * The API object **exists in every Chromium**, including an ordinary
     * browser tab and an Electron window on a platform with no overlay. When
     * the overlay is not showing, `getTitlebarAreaRect()` returns an all-zero
     * rect — so the obvious arithmetic, `innerWidth - rect.width - rect.x`,
     * reports the entire window as the space to reserve for buttons that are
     * not there.
     *
     * That is not hypothetical: it shipped in the first draft of this component
     * and put a 449px `padding-right` on a 375px-wide bar, pushing the whole
     * page 98px wider than the viewport. It was invisible at 1280 because the
     * bar had the room to absorb it, which is exactly why the acceptance
     * criterion is written at the narrow width.
     */
    const measure = (): void => {
      const rect = overlay.visible ? overlay.getTitlebarAreaRect() : null;
      const inset =
        rect === null || rect.width === 0
          ? 0
          : Math.max(0, Math.round(window.innerWidth - rect.width - rect.x));
      document.documentElement.style.setProperty("--window-controls-inset", `${String(inset)}px`);
    };
    measure();
    overlay.addEventListener("geometrychange", measure);
    window.addEventListener("resize", measure);
    return () => {
      overlay.removeEventListener("geometrychange", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  /*
   * Pop the menu under the button, not under the pointer.
   *
   * The coordinates come from the button's own rectangle so that a keyboard
   * activation — Enter or Space, where there is no pointer position — opens the
   * menu in the same place a click does. Passing the mouse event's coordinates
   * would make the keyboard path open a menu wherever the mouse happened to be
   * left, which is the sort of thing that is only ever found by someone who
   * cannot use a mouse.
   */
  const openMenu = (): void => {
    const rect = menuButton.current?.getBoundingClientRect();
    void window.dashShell?.openAppMenu?.(
      rect === undefined ? undefined : { x: Math.round(rect.left), y: Math.round(rect.bottom) },
    );
  };

  return (
    <div className="title-bar">
      {hasShell ? (
        <button
          ref={menuButton}
          type="button"
          className="title-bar-menu"
          onClick={openMenu}
          aria-haspopup="menu"
        >
          {/*
            Decorative: the accessible name is on the button. A screen reader
            that read both would announce the glyph and the label.
          */}
          <span aria-hidden="true" className="title-bar-glyph">
            ☰
          </span>
          <span className="visually-hidden">Menu</span>
        </button>
      ) : null}

      <span className="title-bar-mark">DASH</span>
      {/*
        The separator is drawn, not typed. A literal "·" between two spans is a
        character a screen reader reads out between the app's name and the page
        the user is already on, which is noise in the one place a blind user is
        orienting themselves.
      */}
      <span aria-hidden="true" className="title-bar-divider" />
      <span className="title-bar-surface">{surface}</span>
    </div>
  );
}
