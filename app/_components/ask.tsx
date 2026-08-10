"use client";

import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import type { AgentAskView, AskExchangeView } from "../../lib/views/types";
import { askAgentQuestion, submitConnectionCommand } from "../_data/source";

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
export function AskAgent({
  ask,
  canAct,
  onAsked,
  setFeedback,
}: {
  ask: AgentAskView;
  canAct: boolean;
  /** Re-read the workspace, so the answer that just landed is drawn. */
  onAsked: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!ask.can_ask || question.trim().length === 0) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await askAgentQuestion({
      agent_id: ask.ask.agent_id,
      connection_id: ask.ask.connection_id,
      field_id: ask.ask.field_id,
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
        <>
          <p className="wrap">{ask.blocked.headline}</p>
          <p className="muted wrap">{ask.blocked.meaning}</p>
          {ask.connect === null || !canAct ? (
            <p className="ask-next wrap">{ask.blocked.next_action}</p>
          ) : (
            <button type="button" className="primary" disabled={busy} onClick={() => void connect()}>
              {ask.blocked.next_action}
            </button>
          )}
        </>
      )}

      <AskHistory exchanges={ask.history} sourcesHeading={ask.sources_heading} />

      {ask.can_ask ? (
        <div className="ask-compose">
          {/* The estimate sits above the box, not under the button. It is the
              thing that could change what somebody types — a narrower question
              sends fewer saved reports — and a sentence about cost placed under
              the control it applies to is a sentence read after the decision. */}
          <p className="ask-estimate wrap">{ask.estimate.headline}</p>
          <p className="muted wrap">{ask.estimate.detail}</p>
          {canAct ? (
            <>
              <label className="ask-field">
                <span className="visually-hidden">{ask.purpose.headline}</span>
                <textarea
                  className="ask-input"
                  rows={2}
                  value={question}
                  placeholder={ask.placeholder}
                  disabled={busy}
                  onChange={(event) => setQuestion(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="primary"
                // Disabled on an empty box rather than refused on press: there is
                // no sentence worth showing for "you typed nothing", and a button
                // that charges an account should not be pressable with nothing to
                // ask.
                disabled={busy || question.trim().length === 0}
                onClick={() => void submit()}
              >
                {busy ? ask.working : ask.submit}
              </button>
            </>
          ) : (
            /* Said rather than drawn disabled, `ModelChoice`'s reason: a greyed
               box would read as a claim about the agent, and the true statement
               is about which window this is. */
            <p className="muted wrap">Open the installed DASH app to ask this agent a question.</p>
          )}
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
