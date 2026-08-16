"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { agentStageHref } from "../_data/routes";
import { askChief, clearChiefThread } from "../_data/source";
import { OAvatar } from "./o-avatar";
import { answeredFromRecords } from "../../lib/chief/records-answer";
import {
  CHIEF_CHAT_COPY,
  describeAmbiguous,
  describeChiefActivity,
  describeChiefScope,
  describeMatch,
  describeRouted,
  type ChiefSentence,
} from "../../lib/copy/chief-chat";
import { CHIEF_NAME } from "../../lib/copy/chief";
import type { AgentRow, ChiefRoomView, ChiefTurnView } from "../../lib/views/types";

/**
 * The chief's composer, and the room it opens (MAR-648; given a model and a
 * memory by MAR-659, ADR 0023).
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
 * ## What changed, and what did not
 *
 * **Changed.** The answers no longer come from a pure function in this file.
 * Every question goes to Electron main, which decides between DASH's own records
 * and the model, writes a row, and returns whether it was asked. The
 * conversation arrives in `view.turns` with the rest of the fleet document and
 * is still there tomorrow, which is what Henrik's station-11 walk asked for: he
 * changed view, came back, and the thread was blank.
 *
 * **Not changed.** Every sentence still comes from `lib/copy/chief-chat.ts`,
 * except the one the model wrote — and that one is `turn.answer`, rendered as
 * plain text, with the exact records DASH read listed underneath it. MAR-547's
 * ruling applies hardest in a speech position, and the answer to a model
 * speaking there is not to forbid it but to show its sources beside it and mark
 * them when they go out of date.
 *
 * The one exception still proves the rule. An agent's `goal` is **its author's**
 * sentence, so it is rendered quoted and attributed rather than folded into
 * anybody's words — `ChiefSentence.quoted` exists for that, and the stored
 * answer text can never contain one because `recordsAnswer` never puts one in.
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
 */
export function ChiefChat({
  agents,
  view,
  canAct,
  onAsked,
  open,
  onOpen,
  onClose,
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
}): ReactNode {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement | null>(null);

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
   * The newest turn, scrolled to, and only when there is one to scroll to.
   *
   * `behavior` follows the reader's own setting rather than a preference this
   * component holds — the same read `FleetList.scrollTo` already does, for the
   * same reason: a person who asked their operating system to stop animating
   * things asked this one too.
   */
  useEffect(() => {
    if (!open || view.turns.length === 0) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [open, view.turns.length]);

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
    setFeedback(result.detail ?? null);
    // The answer is not in `result`. It is in the store, and it reaches this
    // component when the page re-reads the view — one path by which an answer
    // becomes something on screen, and the same one a reopened conversation
    // takes. See `DispatchContext.chiefAction`.
    onAsked();
  }

  async function clear(): Promise<void> {
    const result = await clearChiefThread();
    setFeedback(result.ok ? null : (result.detail ?? null));
    onAsked();
  }

  /*
   * Escape closes the room and never touches the box.
   *
   * `AskComposer` declined to bind this key at all, and its reason is right and
   * still holds: *"a key that discarded it would be a destructive control with
   * no confirmation."* Closing the room discards nothing — the question stays
   * typed, the conversation stays in the store, and re-focusing the box brings
   * both back.
   */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask();
    }
  }

  const scope = describeChiefScope();

  return (
    <div className="chief-chat">
      {open ? (
        <div className="chief-room" ref={thread}>
          <div className="chief-room-head">
            <h2>{CHIEF_CHAT_COPY.heading}</h2>
            <div className="chief-room-actions">
              {view.turns.length === 0 || !canAct ? null : (
                /* The person's own control over their own transcript, and the
                   reason `describeChiefScope` can promise the conversation is
                   kept: something kept until you say otherwise needs an
                   otherwise. Absent when there is nothing to clear rather than
                   drawn disabled — `ModelChoice`'s rule. */
                <button type="button" className="button-link" onClick={() => void clear()}>
                  {CHIEF_CHAT_COPY.clear}
                </button>
              )}
              <button type="button" className="button-link" onClick={onClose}>
                {CHIEF_CHAT_COPY.close}
              </button>
            </div>
          </div>

          {view.turns.length === 0 ? (
            /* The scope note is the room's empty state rather than a line that
               is always on screen. It answers the two questions somebody has the
               first time they meet this box — what can it tell me, and what does
               it cost — and then gets out of the way of the conversation. */
            <div className="chief-scope">
              <p className="wrap">
                <strong>{scope.headline}</strong>
              </p>
              <p className="muted wrap">{scope.meaning}</p>
            </div>
          ) : (
            <ol className="chief-turns" aria-label={CHIEF_CHAT_COPY.thread_kept_heading}>
              {view.turns.map((turn) => (
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

          {view.blocked === null ? null : (
            /*
               The chief with no model to ask (ADR 0023 decision 4).

               Last in the room, which puts it directly above the composer it is
               about — `ask-terms`' rule, that a sentence about what a control
               will do belongs where it is read *before* the decision rather than
               under the button. It is a standing fact about this DASH rather
               than about any one question, so it stays on screen with a full
               thread above it, and the box under it still works: the standing
               question is answered from records whatever this says.
            */
            <div className="chief-blocked">
              <p className="wrap">
                <strong>{view.blocked.headline}</strong>
              </p>
              <p className="muted wrap">{view.blocked.meaning}</p>
            </div>
          )}
        </div>
      ) : null}

      <div className="chief-compose">
        <label className="chief-field">
          {/*
            MAR-659. Visible rather than `visually-hidden`, so the subject of
            this room — the whole fleet, never one agent — is a fact a person
            reads rather than one this component just happens to be wired for.
          */}
          <span className="chief-subject">{CHIEF_CHAT_COPY.label}</span>
          <textarea
            className="chief-input"
            rows={2}
            value={question}
            placeholder={CHIEF_CHAT_COPY.placeholder}
            onChange={(event) => setQuestion(event.target.value)}
            onFocus={onOpen}
            onKeyDown={onKeyDown}
          />
        </label>
        <button
          type="button"
          className="primary"
          disabled={question.trim().length === 0 || busy}
          onClick={() => void ask()}
        >
          {CHIEF_CHAT_COPY.submit}
        </button>
      </div>

      {/*
        The settings row, and it carries what is true rather than what the
        screenshot had.

        MAR-648's own words about this row: affordances *"as they become real,
        never as dead chrome"*. There is a model now, so the row names it — the
        id as a value, `lib/copy/identifiers.ts`' rule and `AskModelView`'s note
        on why DASH holds no friendlier name to give. On a DASH with no default
        there is still no chip, because there is still nothing true to put in
        one; the blocked notice inside the room says why, where there is room
        for the sentence.
      */}
      <p className="chief-settings muted">
        {scope.headline}
        {view.model_id === null ? null : (
          <>
            {" "}
            <code className="value">{view.model_id}</code>
          </>
        )}
      </p>
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
 */
function ChiefReceipt({ turn }: { turn: ChiefTurnView }): ReactNode {
  return (
    <div className="chief-receipt">
      {turn.stale ? <p className="chief-stale wrap">{CHIEF_CHAT_COPY.stale}</p> : null}
      <p className="muted wrap">{turn.receipt_note}</p>
      {turn.receipt.length === 0 ? null : (
        <>
          <h3 className="chief-receipt-heading">{CHIEF_CHAT_COPY.receipt_heading}</h3>
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
        </>
      )}
      <p className="muted chief-charge">
        {turn.charge ?? CHIEF_CHAT_COPY.free}
        {turn.model === null ? null : (
          <>
            {" "}
            <code className="value">{turn.model}</code>
          </>
        )}
      </p>
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
