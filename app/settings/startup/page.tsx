"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { STARTUP_COPY, describeAutostartRefusal } from "../../../lib/copy/startup";
import { parseAutostartState, type AutostartState } from "../../../lib/shell/autostart";
import { HostNotice, ViewLoading } from "../../_components/view-state";
import { checkAutostart, setAutostart } from "../../_data/source";
import { useCanAct, useHost } from "../../_data/use-view";

/**
 * Startup: what this computer does when nobody has opened DASH yet (MAR-785,
 * ADR 0030).
 *
 * ## Why a tab of its own
 *
 * `app/settings/preferences/page.tsx` opens with *"how DASH looks, not what it
 * does"*, and MAR-599 wrote that line as a boundary rather than a description.
 * This is the other kind of setting and the sharpest example of it in the
 * product: it decides what happens on a machine at a moment when the app is not
 * running and no person is present. A ninth row on Preferences would have put
 * "add DASH to my computer's startup list" into the inventory of how the window
 * looks.
 *
 * ## Why the state comes down the command channel rather than in a view
 *
 * Every `view.*` is a projection of `dash.sqlite`, built by `lib/views/build.ts`
 * and answerable from a Next route on the developer path. This page's whole
 * subject is a Windows registry value: not in the store, not knowable from a
 * browser tab, and changeable by a person in Task Manager while this page is on
 * screen. `checkRunnerStatus` faced the identical shape and took the identical
 * route — a `mutates: false` command, read fresh on every ask, cached nowhere.
 *
 * ## Why the literal command line is on the page
 *
 * `STARTUP_COPY.command_label` argues it and the argument is short: a control
 * that writes into somebody's startup list owes them the text of what it wrote,
 * before the press rather than after, in a form they can match against what
 * Windows shows them. It is also the only way to remove the entry if DASH is
 * ever deleted without being switched off first — ADR 0030's uninstall section,
 * where the honest answer is that no hook exists to catch that.
 */
export default function StartupPage(): ReactNode {
  const host = useHost();
  const canAct = useCanAct();
  const [state, setState] = useState<AutostartState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; detail: string } | null>(null);

  /**
   * Read the machine, not a cache.
   *
   * Re-read after every press rather than assumed, because `writeAutostart`
   * already reads back and can return `ok: false` with the value unchanged — a
   * managed machine, a group policy, an antivirus that owns the Run key. A page
   * that flipped its own switch optimistically would be showing a setting that
   * does not exist.
   */
  const load = useCallback(async () => {
    const result = await checkAutostart();
    const parsed = parseAutostartState(result.data);
    if (parsed === null) {
      setUnavailable(true);
      return;
    }
    setUnavailable(false);
    setState(parsed);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const press = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setOutcome(null);
    const result = await setAutostart(enabled);
    const parsed = parseAutostartState(result.data);
    if (parsed !== null) {
      setState(parsed);
    }
    setOutcome({
      ok: result.ok,
      detail: result.ok
        ? enabled
          ? STARTUP_COPY.enrolled
          : STARTUP_COPY.removed
        : STARTUP_COPY.failed,
    });
    setBusy(false);
  };

  return (
    <>
      <h1>{STARTUP_COPY.heading}</h1>
      <HostNotice host={host} />

      {unavailable ? (
        /*
         * A shell too old to answer. `HostNotice` above already covers a browser
         * tab; this says the other thing, and says it as a fact about the build
         * rather than as a refusal the person could act on. Keeping the two
         * apart is why `parseAutostartState` returns null instead of a defaulted
         * object — see its docblock.
         */
        <p className="muted wrap">
          This copy of DASH cannot answer questions about your startup list.
        </p>
      ) : state === null ? (
        <ViewLoading what="your startup setting" />
      ) : (
        <StartupSettings
          state={state}
          canAct={canAct}
          busy={busy}
          outcome={outcome}
          onPress={(enabled) => {
            void press(enabled);
          }}
        />
      )}
    </>
  );
}

/**
 * Everything on the page below the heading, as a function of the state.
 *
 * Split out for `AiSettings`' reason: a page whose body is reachable only
 * through a `useEffect` and a command channel is a page a test can photograph
 * and never render. Every branch here — enrolled, off, refused, disabled in
 * Task Manager, pointing at another copy — is a state a person will meet and
 * none of them is reachable from a fake data source, because the fact lives in
 * the registry rather than in the store.
 */
export function StartupSettings({
  state,
  canAct,
  busy,
  outcome,
  onPress,
}: {
  state: AutostartState;
  canAct: boolean;
  busy: boolean;
  outcome: { ok: boolean; detail: string } | null;
  onPress: (enabled: boolean) => void;
}): ReactNode {
  return (
    <>
      <section aria-labelledby="startup-switch">
        <h2 id="startup-switch">{STARTUP_COPY.toggle.label}</h2>
        <p className="wrap">{STARTUP_COPY.toggle.detail}</p>

        {state.available ? (
          <>
            {/*
              The whole state in one row, `NotificationSettings`' shape and its
              reasons: a chip that is the answer, and a sentence that is the
              consequence.
            */}
            <p className="notify-standing">
              <span className={state.enrolled ? "chip chip-ok" : "chip chip-muted"}>
                {state.enrolled ? "On" : "Off"}
              </span>{" "}
              {state.enrolled ? STARTUP_COPY.liveness_on[0] : STARTUP_COPY.liveness_off[0]}
            </p>

            {/*
              Windows' own switch, when it disagrees with DASH's. Only meaningful
              while enrolled — see `AutostartState.approved`, where the point is
              that Task Manager can disable a Run value without removing it, and
              a page reading only the value's existence would say On over a login
              that does nothing.
            */}
            {state.enrolled && !state.approved ? (
              <p className="notice-warn" role="status">
                {STARTUP_COPY.windows_disabled}
              </p>
            ) : null}

            {state.foreign ? (
              <p className="notice-warn" role="status">
                {STARTUP_COPY.foreign}
              </p>
            ) : null}

            <p className="muted wrap">{STARTUP_COPY.opt_in}</p>

            <div className="button-row">
              <button
                type="button"
                className={state.enrolled ? "button-secondary" : "button-primary"}
                disabled={!canAct || busy}
                onClick={() => {
                  onPress(!state.enrolled);
                }}
              >
                {state.enrolled ? STARTUP_COPY.toggle_off : STARTUP_COPY.toggle_on}
              </button>
            </div>

            {outcome !== null ? (
              <p className={outcome.ok ? "notice-ok" : "notice-warn"} role="status">
                {outcome.detail}
              </p>
            ) : null}
          </>
        ) : (
          <p className="notice-warn" role="status">
            {state.refusal === null ? STARTUP_COPY.failed : describeAutostartRefusal(state.refusal)}
          </p>
        )}
      </section>

      <section aria-labelledby="startup-liveness">
        <h2 id="startup-liveness">What happens, and what still does not</h2>
        {/*
          Both lists, always, and not only the one matching the switch. Somebody
          deciding whether to turn this on is deciding between two states and is
          owed both — and the third sentence of `liveness_on` is the one this
          page is judged on: turning it on does not make a window fire that came
          round while the machine was off. ADR 0029 decision 7, restated where
          the switch is.
        */}
        <ul className="plain-list">
          {STARTUP_COPY.liveness_on.map((sentence) => (
            <li key={sentence} className="wrap">
              {sentence}
            </li>
          ))}
        </ul>
        <p className="muted wrap">With it off:</p>
        <ul className="plain-list">
          {STARTUP_COPY.liveness_off.map((sentence) => (
            <li key={sentence} className="wrap">
              {sentence}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="startup-not-this">
        <h2 id="startup-not-this">What it does not do</h2>
        <ul className="plain-list">
          {STARTUP_COPY.not_this.map((sentence) => (
            <li key={sentence} className="wrap">
              {sentence}
            </li>
          ))}
        </ul>
      </section>

      {state.command === "" ? null : (
        <section aria-labelledby="startup-command">
          <h2 id="startup-command">{STARTUP_COPY.command_label}</h2>
          <pre className="wrap" aria-label={STARTUP_COPY.command_label}>
            {state.command}
          </pre>
          <p className="muted wrap">{STARTUP_COPY.command_note}</p>
        </section>
      )}
    </>
  );
}
