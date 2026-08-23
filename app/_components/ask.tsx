"use client";

import Link from "next/link";
import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { AGENT_COCKPIT_COPY } from "../../lib/copy/agent-page";
import {
  ASK_ACTIVITY_LABEL,
  ASK_CLEAR,
  ASK_CLEAR_DETAIL,
  ASK_CLOSE,
  ASK_HEADING,
  ASK_MODEL_LABEL,
  describeAskActivity,
  describeChatSubject,
} from "../../lib/copy/ask";
import type { OName } from "../../lib/brand/o-cast";
import type { AgentAskView, AskExchangeView } from "../../lib/views/types";
import { agentStageHref } from "../_data/routes";
import { askAgentQuestion, submitConnectionCommand } from "../_data/source";
import { Composer, filterAfterClear, type ComposerClassNames } from "./composer";
import { useSingleFlight } from "./single-flight";
import { OAvatar } from "./o-avatar";

/**
 * This surface's own class-name table for `Composer` (MAR-711).
 *
 * A new vocabulary rather than the chief's: `.ask-history`, `.ask-turn` and
 * everything a citation or a charge line draws already existed for this
 * surface's transcript, so only the chrome `Composer` did not yet have a name
 * for is new here. See `composer.tsx`'s own header for why this is a lookup
 * table and not a `surface` string switched on internally.
 */
const ASK_COMPOSER_CLASSES: ComposerClassNames = {
  root: "ask-composer",
  room: "ask-room",
  roomHead: "ask-room-head",
  roomHeading: "ask-room-heading",
  roomActions: "ask-room-actions",
  roomClear: "ask-room-clear",
  roomClose: "ask-room-close",
  roomScroll: "ask-room-scroll",
  compose: "ask-compose",
  field: "ask-field",
  subject: "ask-subject",
  inputWrap: "ask-input-wrap",
  input: "ask-input",
  enterGlyph: "ask-enter-glyph",
};

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
 * cockpit, so ending it with the estimate keeps that literally true.
 *
 * MAR-711 removed the `children` slot this used to carry the composer through
 * for a caller that wanted the two in one section: nothing ever called it —
 * the cockpit pins the composer separately, and the composer now opens its
 * own room with this same content rather than needing to be handed this
 * section as a child. A dead prop the first sentence of
 * `app/agents/detail/page.tsx` already argues against.
 */
export function AskThread({
  ask,
  canAct,
  onAsked,
  setFeedback,
}: {
  ask: AgentAskView;
  canAct: boolean;
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
    </section>
  );
}

/**
 * The box you type a question into — and now the room that opens above it
 * (MAR-545, split out by MAR-641; adopted the fleet composer's own shape by
 * MAR-711).
 *
 * Renders nothing at all when there is nothing to ask with. That is not the
 * silence `AgentControls` was filed against: the reason is on screen directly
 * above, as the thread's fix-it card, and a disabled textarea under it would be
 * the dead input this component's own header refuses.
 *
 * ## MAR-711: one shape, adopted rather than copied
 *
 * Henrik, of this composer's old submit button beside the chief's: *"adopts
 * the fleet composer's look and behaviour."* The two used to diverge on every
 * axis the objective names — a button here and none there, a settings row that
 * swapped with the loader here and a model line always drawn there, a
 * navigation to a whole separate stage on focus here and an overlay that opens
 * in place there. All four are now `Composer`'s decisions, not this
 * component's: this file supplies `ASK_COMPOSER_CLASSES`, its own submit
 * function, its own room content (the purpose, the history and the estimate
 * this agent's questions have always shown), and nothing else.
 *
 * The room replaces the old *focus moves you to the Chat stage* behaviour —
 * `onChatStage` below is what keeps the two from ever drawing the same content
 * twice on one screen: on the Chat stage, `AskThread` already shows this exact
 * purpose/history/estimate in full, so the room stays closed there and this
 * composer draws only the field. Off that stage, the room is the quickest way
 * to see the same thing without leaving whatever a person is looking at —
 * `AgentChatBar`'s own reason for existing.
 *
 * `open`/`onOpen`/`onClose` are controlled props, `ChiefChat`'s own shape,
 * rather than state this component keeps to itself — `AgentChatBar` owns
 * them for the same reason `FleetList` owns the chief's: every render test
 * in this repository is `renderToStaticMarkup`, which never fires a focus
 * event, so a room only openable from inside this component would be a room
 * no test could ever put on screen open.
 */
export function AskComposer({
  agentAvatar = null,
  agentTitle = null,
  ask,
  canAct,
  onAsked,
  onChatStage = false,
  open,
  onOpen,
  onClose,
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
   * Whether the Chat stage is already on screen, showing this exact content
   * in full (`AskThread`). The room stays closed there rather than drawing
   * the same purpose, history and estimate a second time — the same argument
   * `AgentChatBar`'s own blocked branch already makes about this prop.
   */
  onChatStage?: boolean;
  /** Whether the room is showing. Owned by `AgentChatBar`. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /*
   * MAR-746. `ChiefChat`'s note, restated for this room with one difference
   * worth naming: `busy` here is unconditional rather than predicted, so it
   * already disabled the field and this surface never produced Henrik's three
   * turns. It is still not a guard. A `useState` flag is settled at the next
   * render, and the whole premise of MAR-746 is a burst arriving faster than a
   * render — so this surface gets the same closure the chief's does rather than
   * being left to rely on a race it happens to be winning. See `singleFlight`.
   */
  const { pending, start } = useSingleFlight();
  /*
   * MAR-711. Clear's own state, `ChiefChat`'s `clearedThroughId` restated for
   * this room: session-only, filtered here rather than deleted anywhere, so
   * DASH still keeps every exchange the next time this agent is asked
   * anything. See `filterAfterClear`'s own header.
   */
  const [clearedThroughId, setClearedThroughId] = useState<number | null>(null);

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
  const visible = filterAfterClear(ask.history, clearedThroughId);

  async function submit(): Promise<void> {
    if (question.trim().length === 0) {
      return;
    }
    if (!onChatStage) {
      onOpen();
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
      // asking again is one press rather than typing it out again — and the row
      // saying it failed is already in the history above.
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
    <Composer
      classes={ASK_COMPOSER_CLASSES}
      open={open && !onChatStage}
      onOpen={() => {
        if (!onChatStage) {
          onOpen();
        }
      }}
      onClose={onClose}
      heading={ASK_HEADING}
      closeLabel={ASK_CLOSE}
      clearLabel={ASK_CLEAR}
      clearTitle={ASK_CLEAR_DETAIL}
      clearDisabled={visible.length === 0}
      onClear={() => {
        const last = ask.history[ask.history.length - 1];
        if (last !== undefined) {
          setClearedThroughId(last.id);
        }
      }}
      scrollSignal={visible.length}
      /* The bar's own name, not the thread's opening sentence (MAR-646).
         This label used to be `ask.purpose.headline`, which is the paragraph
         the room now draws directly below it — one sentence in two places on
         one screen, and the hidden half is still in the markup, which is
         exactly the kind of duplication a copy gate reads straight past. A
         control's accessible name should say what the control is — and
         MAR-659 is why it is visible now rather than `visually-hidden`:
         naming *this* agent, not the fuller sentence about what it can
         answer, is the one thing this label says that nothing else on a
         non-Chat stage does. */
      subjectLabel={describeChatSubject(agentTitle)}
      placeholder={ask.placeholder}
      value={question}
      onChange={setQuestion}
      onSubmit={() => {
        start(submit);
      }}
      pending={pending}
      textareaDisabled={busy}
      modelLine={
        <div className="ask-model-line">
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
      }
    >
      <p className="wrap">{ask.purpose.headline}</p>
      <p className="muted wrap">{ask.purpose.detail}</p>

      <AskHistory exchanges={visible} sourcesHeading={ask.sources_heading} />

      <div className="ask-terms">
        {/* The estimate sits above the box, not under a button that no longer
            exists — it is the thing that could change what somebody types, and
            the room already opens directly above the field. */}
        <p className="ask-estimate wrap">{ask.estimate.headline}</p>
        <p className="muted wrap">{ask.estimate.detail}</p>
        <p className="muted wrap ask-custody">{ask.custody}</p>
        {ask.spent === null ? null : <p className="muted wrap">{ask.spent}</p>}
        {ask.reported === null ? null : <p className="muted wrap">{ask.reported}</p>}
      </div>

      {busy ? <AskActivity avatar={agentAvatar} elapsed={elapsed} model={model.model_id} /> : null}
    </Composer>
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
 *
 * ## MAR-711: no more `onEscape`/`onFocus`, and a room this bar now owns
 *
 * Both `onEscape`/`onFocus` existed for one reason — focusing the composer
 * used to navigate the whole cockpit to the Chat stage, and Escape had to put
 * the stage back. The composer now opens its own room in place instead
 * (`AskComposer`'s own header), so there is no stage to leave and none to
 * restore: `Composer` closes the room on Escape by itself, and the cockpit's
 * stage never moves because of anything typed here.
 *
 * `open` moved here from `AskComposer`, `FleetList`'s own shape for the
 * chief's room: whether the room is showing is now this bar's state, handed
 * down as a controlled prop, rather than something `AskComposer` decided for
 * itself. Nothing on this page dims for it the way the fleet's cards do, but
 * the state has to live somewhere a test can reach without a click —
 * `renderToStaticMarkup` fires none — and this bar is `AskComposer`'s one
 * caller either way.
 */
export function AgentChatBar({
  agent,
  agentAvatar = null,
  agentTitle = null,
  ask,
  canAct,
  onAsked,
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
  /**
   * Whether the Chat stage is already on screen.
   *
   * The blocked bar reads it for the reason recorded below; `AskComposer`
   * reads its own copy to keep its room from drawing the same purpose,
   * history and estimate `AskThread` already shows in full on that stage.
   */
  onChatStage?: boolean;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [open, setOpen] = useState(false);
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
          onChatStage={onChatStage}
          open={open}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
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
