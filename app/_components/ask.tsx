"use client";

import Link from "next/link";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { AGENT_COCKPIT_COPY } from "../../lib/copy/agent-page";
import {
  ASK_ACTIVITY_LABEL,
  ASK_MODEL_LABEL,
  describeAskActivity,
  describeChatSubject,
} from "../../lib/copy/ask";
import type { OName } from "../../lib/brand/o-cast";
import type { AgentAskView, AskExchangeView } from "../../lib/views/types";
import { agentStageHref } from "../_data/routes";
import { askAgentQuestion, submitConnectionCommand } from "../_data/source";
import { OAvatar } from "./o-avatar";

/**
 * The conversation with one agent (MAR-545).
 *
 * ## What this component is allowed to say, which is nothing
 *
 * Every string a person reads here comes from `lib/copy/ask.ts` through the
 * view: the heading, the purpose, the placeholder, the button, the estimate, the
 * cost sentence under each answer, the reason a question failed and the reason
 * there is nothing to ask with. This file writes no sentence at all, which is
 * `ModelChoice`'s rule and matters more here than anywhere else in DASH —
 * MAR-545's acceptance is that somebody who has never heard the word *artifact*
 * can use this, and a page that composed its own words would be a page the copy
 * sweep never checks.
 *
 * ## Why an answer is a `<p>` and never anything else
 *
 * The text in `exchange.answer` came out of a model that was reading headlines
 * an agent collected off the open web. `lib/ai/ask.ts` states the boundary that
 * makes that safe and it is a structural one: **an answer drives nothing.** This
 * component is the last place that could break it, so it renders the text and
 * does nothing else with it — no markdown, no HTML, no link extraction, no
 * `dangerouslySetInnerHTML`, and nothing derived from it reaches a control.
 *
 * The links a person can click sit in the citation list underneath, and every
 * one of them is `lib/store.ts`'s record of an item the agent saved rather than
 * anything the answer wrote.
 *
 * ## Never a dead input
 *
 * The union in `AgentAskView` has no arm that draws a box a person can type in
 * and get nothing from. Four reasons resolve to a sentence plus the one action
 * that fixes them, and the one that is fixable from here — no key — carries the
 * connect flow so the fix is a button rather than an instruction to go and find
 * a page.
 */
/**
 * The conversation, without the box you type in (MAR-545, split by MAR-641).
 *
 * ## Why the two are separable at all
 *
 * The cockpit pins one chat bar to the bottom of a frame that never scrolls and
 * puts the thread on a stage that does. They are one feature in two bands of
 * the window, so they are two components.
 *
 * There was an `AskAgent` here that composed them back into the single section
 * this file used to export, kept through the rebuild so that no caller had to
 * know about the split. It is gone, because after the rebuild it had no caller
 * except its own test — and the first sentence of `app/agents/detail/page.tsx`
 * is about what a dead thing that looks alive costs the next person. The test
 * renders the composition directly, which is also what the cockpit does.
 *
 * ## The estimate stays with the thread, and that is the placement decision
 *
 * MAR-545's rule is that the cost sentence sits *above* the box: it is the
 * thing that could change what somebody types, and under the button it is read
 * after the decision. The thread is the last thing above the bar in the
 * cockpit, so ending it with the estimate keeps that literally true — and the
 * chat bar's own behaviour is what guarantees it, because focusing the bar
 * moves the stage to this thread.
 */
export function AskThread({
  ask,
  canAct,
  children,
  onAsked,
  setFeedback,
}: {
  ask: AgentAskView;
  canAct: boolean;
  /** The composer, for the caller that wants it inside the section. */
  children?: ReactNode;
  onAsked: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [busy, setBusy] = useState(false);

  async function connect(): Promise<void> {
    if (ask.can_ask || ask.connect === null) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    // The same flow the Connections page fires, reached from where the person
    // ran into the gap. `AiKeyFlow` carries the channel name so this component
    // never chooses one — see `lib/ai/connection-view.ts`.
    const result = await submitConnectionCommand("connect", {
      agent_id: ask.connect.agent_id,
      connection_id: ask.connect.connection_id,
      field_id: ask.connect.field_id,
    });
    setBusy(false);
    setFeedback({ ok: result.ok, message: result.detail ?? "" });
    if (result.ok) {
      onAsked();
    }
  }

  return (
    <section className="section ask" aria-labelledby="ask-agent">
      <h2 id="ask-agent">{ask.heading}</h2>

      {ask.can_ask ? (
        <>
          <p className="wrap">{ask.purpose.headline}</p>
          <p className="muted wrap">{ask.purpose.detail}</p>
        </>
      ) : (
        /*
         * MAR-641 asks for a blocked chat to render as **one fix-it action
         * card** in the stage, and this is it: the same three sentences this
         * component has always drawn, in a box that says it is the thing
         * standing between the person and a conversation. The card is a class
         * rather than a new component — the arm already had the headline, the
         * meaning and the one action that clears it, which is exactly what a
         * fix-it card is.
         */
        <div className="ask-blocked-card">
          <p className="wrap">
            <strong>{ask.blocked.headline}</strong>
          </p>
          <p className="muted wrap">{ask.blocked.meaning}</p>
          {ask.connect === null || !canAct ? (
            <p className="ask-next wrap">{ask.blocked.next_action}</p>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={() => void connect()}>
              {ask.blocked.next_action}
            </button>
          )}
        </div>
      )}

      <AskHistory exchanges={ask.history} sourcesHeading={ask.sources_heading} />

      {ask.can_ask ? (
        <div className="ask-terms">
          {/* The estimate sits above the box, not under the button. It is the
              thing that could change what somebody types — a narrower question
              sends fewer saved reports — and a sentence about cost placed under
              the control it applies to is a sentence read after the decision. */}
          <p className="ask-estimate wrap">{ask.estimate.headline}</p>
          <p className="muted wrap">{ask.estimate.detail}</p>
          <p className="muted wrap ask-custody">{ask.custody}</p>
          {ask.spent === null ? null : <p className="muted wrap">{ask.spent}</p>}
          {ask.reported === null ? null : <p className="muted wrap">{ask.reported}</p>}
        </div>
      ) : ask.reported === null ? null : (
        <p className="muted wrap">{ask.reported}</p>
      )}

      {children}
    </section>
  );
}

/**
 * The box you type a question into, and nothing else (MAR-545, split out by
 * MAR-641).
 *
 * Renders nothing at all when there is nothing to ask with. That is not the
 * silence `AgentControls` was filed against: the reason is on screen directly
 * above, as the thread's fix-it card, and a disabled textarea under it would be
 * the dead input this component's own header refuses.
 */
export function AskComposer({
  agentAvatar = null,
  agentTitle = null,
  ask,
  canAct,
  onAsked,
  onEscape,
  onFocus,
  setFeedback,
}: {
  /**
   * The character this agent wears, for the loader (MAR-648, MAR-615).
   *
   * Null draws no portrait beside the activity line and nothing else changes —
   * the reserved silence `AgentPortrait` already keeps for an agent whose row
   * DASH could not read, and for its reason: an invented character would be a
   * costume this agent might not be wearing on the card it came from.
   */
  agentAvatar?: OName | null;
  /**
   * This agent's own display name, for the composer's visible label
   * (`describeChatSubject`, MAR-659). Null falls back to a generic label —
   * see that function's own note on the one caller that has none to give.
   */
  agentTitle?: string | null;
  ask: AgentAskView;
  canAct: boolean;
  onAsked: () => void;
  /**
   * Called on Escape, so the cockpit can put back the stage somebody was on
   * (MAR-648).
   *
   * This component's own header refused to bind this key: *"`Escape` is
   * deliberately not bound: this box holds a question somebody typed, and a key
   * that discarded it would be a destructive control with no confirmation."*
   * That reasoning is right, and it is exactly why the binding is safe now —
   * **Escape does not touch the box.** It changes which stage is on screen and
   * leaves the question, the cursor and the scrollback where they are, so there
   * is nothing discarded and nothing to confirm.
   */
  onEscape?: () => void;
  /** Called when the box takes focus, so the cockpit can show the thread. */
  onFocus?: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  /*
   * Whole seconds since the press — the one number on this surface the renderer
   * measured first-hand, which is why it is the one number MAR-648's honesty
   * rule lets it show while a question is in flight. `describeAskActivity` is
   * where that argument is written down.
   *
   * A second is the right resolution rather than a compromise: this is a person
   * waiting, not a profiler, and a tenth-of-a-second counter under a loader
   * reads as instrumentation. It is also one repaint per second, which is the
   * cheapest honest way to show the surface is still alive.
   */
  const [elapsed, setElapsed] = useState(0);

  /*
   * Started on the press and cleared with it. Reading the clock rather than
   * counting ticks, because a browser throttles an interval in a background tab
   * and a counter that incremented per tick would under-report exactly when
   * somebody switched away and came back to check.
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

  if (!ask.can_ask) {
    return null;
  }

  const flow = ask.ask;
  const model = ask.model;

  async function submit(): Promise<void> {
    if (question.trim().length === 0) {
      return;
    }
    setElapsed(0);
    setBusy(true);
    setFeedback(null);
    const result = await askAgentQuestion({
      agent_id: flow.agent_id,
      connection_id: flow.connection_id,
      field_id: flow.field_id,
      question: question.trim(),
    });
    setBusy(false);
    if (result.ok) {
      // Cleared only on success. A question that failed is still in the box, so
      // pressing the button again is one press rather than typing it out again —
      // and the row saying it failed is already in the history below.
      setQuestion("");
    }
    setFeedback({ ok: result.ok, message: result.detail ?? "" });
    onAsked();
  }

  if (!canAct) {
    /* Said rather than drawn disabled, `ModelChoice`'s reason: a greyed box
       would read as a claim about the agent, and the true statement is about
       which window this is. */
    return (
      <div className="ask-compose">
        <p className="muted wrap">Open the installed DASH app to ask this agent a question.</p>
      </div>
    );
  }

  return (
    <div className="ask-compose">
      <label className="ask-field">
        {/* The bar's own name, not the thread's opening sentence (MAR-646).
            This label used to be `ask.purpose.headline`, which is the paragraph
            the thread draws directly above it on the Chat stage — one sentence
            in two places on one screen, and the hidden half is still in the
            markup, which is exactly the kind of duplication a copy gate reads
            straight past. A control's accessible name should say what the
            control is — and MAR-659 is why it is visible now rather than
            `visually-hidden`: naming *this* agent, not the thread's fuller
            sentence about what it can answer, is the one thing this label
            says that nothing else on a non-Chat stage does. */}
        <span className="ask-subject">{describeChatSubject(agentTitle)}</span>
        <textarea
          className="ask-input"
          rows={2}
          value={question}
          placeholder={ask.placeholder}
          disabled={busy}
          onChange={(event) => setQuestion(event.target.value)}
          onFocus={onFocus}
          /*
           * Enter sends, Shift+Enter is a new line — the wireframe's own
           * sentence for the pinned bar, and the convention of every chat box a
           * person has used.
           *
           * Escape puts back the stage somebody was on and **does not touch what
           * they typed** (MAR-648). See `onEscape`, which carries the argument
           * for why the refusal this comment used to record does not apply to a
           * key that discards nothing.
           */
          onKeyDown={(event) => {
            if (event.key === "Escape" && onEscape !== undefined) {
              event.preventDefault();
              onEscape();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </label>
      <button
        type="button"
        className="primary"
        // Disabled on an empty box rather than refused on press: there is no
        // sentence worth showing for "you typed nothing", and a button that
        // charges an account should not be pressable with nothing to ask.
        disabled={busy || question.trim().length === 0}
        onClick={() => void submit()}
      >
        {busy ? ask.working : ask.submit}
      </button>

      {/*
        The settings row (MAR-648), and the activity line in its place while a
        question is in flight.

        One band rather than two stacked, because they answer the same question
        at two moments — *what is about to happen* and *what is happening* — and
        a row that stayed put underneath a second row appearing above it would
        move the box a person is typing in. The composer never moves; that is
        the whole shape MAR-648 asked for.
      */}
      {busy ? (
        <AskActivity avatar={agentAvatar} elapsed={elapsed} model={model.model_id} />
      ) : (
        <div className="ask-settings">
          <span className="ask-setting">
            <span className="muted">{ASK_MODEL_LABEL}</span>{" "}
            {/* The provider's own id, as a value. `AskModelView` states why
                there is no friendlier name to give it and why inventing one
                would be ADR 0012's refused price table in another costume. */}
            <code className="value" title={model.note}>
              {model.model_id}
            </code>
            {/* Said, not only shown in a tooltip: whose decision this was is the
                fact that predicts what changing the fleet default will do here,
                and `BrokerCapabilityView.consequence` records what a hover costs
                — a fact somebody has to point at is a fact most people never
                read. */}
            <span className="visually-hidden">. {model.note}</span>
          </span>
          <Link className="ask-setting-change" href={agentStageHref(flow.agent_id, "settings")}>
            {model.change_label}
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * What DASH is doing while a question is in flight (MAR-648).
 *
 * Henrik asked for this twice: *"We always have some feedback while the model
 * thinks. It could be in text, currently reading xxx and/or a loader (maybe an O
 * doing some stuff)."*
 *
 * ## The line says one thing because DASH can only see one thing
 *
 * `describeAskActivity` carries the whole argument and it is the load-bearing
 * decision in this feature: the preload bridge is `invoke`-only, so a question
 * is one awaited round trip and the four real steps inside `performAskAction`
 * are invisible from here. A component that animated through their names would
 * be reciting a script — right about the order, wrong about the timing, every
 * time — which is what MAR-648 calls *a lie with a spinner on it*.
 *
 * So: the operation genuinely in flight, the model it is in flight against, and
 * a clock this component read itself. Nothing else is knowable and nothing else
 * is claimed.
 *
 * ## The O is at work, and `action` is a literal because it must be
 *
 * `scripts/brand-rules.mjs` fails `action={anything}` that is not `true` or
 * `false`, and the rule behind it is `lib/brand/o-actions.ts`': **an idle action
 * is costume flavour, never status.** This surface only exists while a question
 * is running, so the literal `true` is a decision about the surface — taken once,
 * in the source — rather than a fact about the agent, which is exactly the
 * distinction that rule protects.
 *
 * Eight of the eleven characters have no sheet vendored yet (MAR-615's DASH half
 * lands three of twelve). Those draw their audited still, which is what
 * `OAvatar` already does everywhere else and is deliberately not papered over
 * with a stand-in loop — see `actionFor`'s own note on why a borrowed animation
 * would be worse than none.
 */
function AskActivity({
  avatar,
  elapsed,
  model,
}: {
  avatar: OName | null;
  elapsed: number;
  model: string;
}): ReactNode {
  return (
    <div className="ask-activity">
      {avatar === null ? null : (
        <span className="ask-activity-o">
          <OAvatar name={avatar} size={50} action />
        </span>
      )}
      {/*
        `role="status"` so the wait is announced rather than only seen — the
        design brief's *"nothing moves or refreshes without saying it did"*
        applied to the one place DASH makes somebody wait. Polite by default, so
        it does not interrupt a screen reader mid-sentence.

        The model id is inside the live region and the seconds are not: a counter
        in a live region would announce itself once a second forever, which is
        the accessibility failure that makes people turn the feature off.
      */}
      <p className="ask-activity-line" role="status">
        <span className="visually-hidden">{ASK_ACTIVITY_LABEL}. </span>
        {describeAskActivity(elapsed)} <code className="value">{model}</code>
      </p>
    </div>
  );
}

/**
 * The chat bar pinned to the bottom of the cockpit (MAR-641).
 *
 * One band of the frame, on screen whatever stage is showing, and the reason it
 * is here rather than on the Chat stage is Henrik's: a person should be able to
 * say something to an agent from wherever they are looking at it.
 *
 * ## What it does when there is nothing to ask with
 *
 * It says so in one line and offers the way to the fix, which is on the Chat
 * stage as the thread's fix-it card. The bar deliberately does **not** carry
 * the connect button itself: `ask.blocked` is a headline, a meaning and a next
 * action, and a bar that showed the button without the two sentences would be
 * offering a consequence without its explanation.
 */
export function AgentChatBar({
  agent,
  agentAvatar = null,
  agentTitle = null,
  ask,
  canAct,
  onAsked,
  onEscape,
  onFocus,
  onChatStage = false,
  setFeedback,
}: {
  agent: string;
  /** This agent's character, for the loader on the composer (MAR-648). */
  agentAvatar?: OName | null;
  /**
   * This agent's own display name — `view.title`, not `agent` — for the
   * bar's visible subject and its region name (MAR-659). `agent` stays the
   * id: it drives the hand-off link below and `describeChatSubject` needs a
   * word a person reads, not the identifier that link is built from.
   */
  agentTitle?: string | null;
  ask: AgentAskView;
  canAct: boolean;
  onAsked: () => void;
  /** Escape, which changes the stage and never the box (MAR-648). */
  onEscape?: () => void;
  onFocus?: () => void;
  /**
   * Whether the thread is already the stage.
   *
   * Only the blocked bar reads it, and the first capture of this frame is why
   * it exists: the fix-it card and the bar drew the same sentence 800px apart
   * on one screen, which is exactly the defect MAR-609 removed a Status tile
   * for. The bar's blocked state is a *pointer* at the card, so on the card's
   * own stage there is nothing for it to point at and it draws nothing.
   */
  onChatStage?: boolean;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  if (!ask.can_ask && onChatStage) {
    return null;
  }
  return (
    <div className="cockpit-chat" aria-label={describeChatSubject(agentTitle)}>
      {ask.can_ask ? (
        <AskComposer
          agentAvatar={agentAvatar}
          agentTitle={agentTitle}
          ask={ask}
          canAct={canAct}
          onAsked={onAsked}
          onEscape={onEscape}
          onFocus={onFocus}
          setFeedback={setFeedback}
        />
      ) : (
        <div className="cockpit-chat-blocked">
          <p className="wrap">{ask.blocked.headline}</p>
          <Link className="button-link" href={agentStageHref(agent, "chat")}>
            {AGENT_COCKPIT_COPY.chat_open}
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * The scrollback, oldest first.
 *
 * Nothing at all when there is none, rather than an empty frame saying so: the
 * purpose sentence above already says what the box is for, and a "no questions
 * yet" notice would be DASH narrating an absence a person can see.
 */
function AskHistory({
  exchanges,
  sourcesHeading,
}: {
  exchanges: readonly AskExchangeView[];
  sourcesHeading: string;
}): ReactNode {
  if (exchanges.length === 0) {
    return null;
  }
  return (
    <ol className="ask-history">
      {exchanges.map((exchange) => (
        <li key={exchange.id} className="ask-turn">
          <p className="ask-question wrap">{exchange.question}</p>
          <p className="muted ask-when">{exchange.asked}</p>
          <p className="muted wrap ask-selection">{exchange.selection}</p>
          {exchange.answer === null ? (
            <div className="ask-failed">
              <p className="wrap">{exchange.failure?.headline}</p>
              <p className="muted wrap">{exchange.failure?.meaning}</p>
              <p className="wrap">{exchange.failure?.next_action}</p>
            </div>
          ) : (
            /* Plain text, deliberately. See this file's header. */
            <p className="ask-answer wrap">{exchange.answer}</p>
          )}
          <p className="muted wrap ask-charge">{exchange.charge}</p>
          {exchange.citations.length === 0 ? null : (
            <details className="ask-sources">
              <summary>{sourcesHeading}</summary>
              <ul>
                {exchange.citations.map((citation) => (
                  <li key={`${String(exchange.id)}-${String(citation.index)}`}>
                    <span className="ask-cite-index">{citation.index}</span>{" "}
                    {citation.item_url === null ? (
                      <span className="wrap">{citation.headline}</span>
                    ) : (
                      /* DASH's own record of a link the agent saved, not one the
                         answer produced. `noreferrer` for the reason every
                         outbound link in DASH carries it. */
                      <a
                        className="wrap"
                        href={citation.item_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {citation.headline}
                      </a>
                    )}
                    {citation.source_name === null ? null : (
                      <span className="muted"> · {citation.source_name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
