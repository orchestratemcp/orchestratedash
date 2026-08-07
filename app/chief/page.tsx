"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";

import { OAvatar } from "../_components/o-avatar";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { agentWorkspaceHref } from "../_data/routes";
import { useHost, useView } from "../_data/use-view";
import {
  describeAmbiguous,
  describeChiefLimits,
  describeEmpty,
  describeFleetCounts,
  describeNobody,
  describeRouted,
  type ChiefSentence,
} from "../../lib/copy/chief";
import { routeRequest, type ChiefAgent, type ChiefFleet } from "../../lib/chief/route";

/**
 * One conversation with the whole fleet (MAR-419, DASH-15).
 *
 * The composition is the concept screen's — a conversation surface,
 * agent-avatar attribution, a command input with an explicit submit — drawn in
 * MAR-528's Bit-Command tokens. What the concept's side rail shows is CPU load
 * and memory allocation, and MAR-528 refuses that layer by name, so this rail
 * shows three quantities DASH already holds and already renders elsewhere.
 *
 * ## What this slice is, said plainly
 *
 * It **routes and refuses. It runs nothing.** MAR-419's full scope is a model
 * with tools bound to the command channel, and DASH has no model integration;
 * a Chief written around one would be a mock of the interesting half. What the
 * issue *also* specifies, in its own sentence, is that routing is decided from
 * declared manifest goals and capabilities — a pure function, and the issue's
 * own first acceptance criterion. That is what runs here, against the real
 * fleet, with a real refusal when nobody declared the work.
 *
 * `describeChiefLimits` says so on the surface, where the running would have
 * happened, rather than leaving it to be discovered — MAR-536's honesty applied
 * to a capability that is missing from every build rather than from this window.
 *
 * ## Two kinds of sentence, never one
 *
 * A turn from the Chief is DASH's own words. An agent's `goal` is a sentence
 * **its author wrote**, and MAR-419's hard part is that agent-produced content
 * is data rather than instruction. So author text is never interpolated into a
 * composed sentence: it arrives in `ChiefSentence.quoted` and is rendered here
 * inside a `<blockquote>` attributed to the agent. A reader can always tell
 * which of the two is DASH speaking, and `tests/chief-copy.test.ts` asserts no
 * composed sentence contains it.
 *
 * ## The transcript lives in page state, and that is a stated gap
 *
 * MAR-419 asks for transcripts in the DASH-12 store, per session, deletable.
 * There is no such table and adding one is not this slice — so leaving the page
 * loses the conversation, which is said in the copy rather than left to be
 * found. A transcript half-persisted somewhere else would be worse: it would
 * look like a record.
 */

interface Turn {
  id: number;
  /** What the person typed, verbatim. Never matched against anything but the fleet. */
  asked: string;
  said: ChiefSentence;
  /** The agent this turn routed to, when it routed. */
  agent: ChiefAgent | null;
  /** The agents a tie was between, when it was a tie. */
  among: readonly ChiefAgent[];
}

export default function ChiefPage(): ReactNode {
  const state = useView((source) => source.chief());
  const host = useHost();

  return (
    <>
      <h1>Chief</h1>
      <p className="lede">
        Ask for something and I will tell you which of your agents was set up for it.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="your fleet" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <ChiefConversation fleet={state.data} />
      )}
    </>
  );
}

function ChiefConversation({ fleet }: { fleet: ChiefFleet }): ReactNode {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const limits = describeChiefLimits();

  /*
   * Explicit submit, per the concept and per the issue. Nothing routes on a
   * keystroke: a surface that answered as you typed would be answering
   * half-questions, and the half-answers would scroll past before the real one
   * arrived.
   */
  function ask(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const asked = draft.trim();
    if (asked === "") {
      return;
    }
    const answer = routeRequest(asked, fleet.agents);
    const turn: Turn =
      answer.kind === "routed"
        ? {
            id: turns.length,
            asked,
            said: describeRouted(answer.agent.name, answer.agent.goal),
            agent: answer.agent,
            among: [],
          }
        : answer.kind === "ambiguous"
          ? {
              id: turns.length,
              asked,
              said: describeAmbiguous(answer.agents.map((agent) => agent.name)),
              agent: null,
              among: answer.agents,
            }
          : answer.kind === "nobody"
            ? {
                id: turns.length,
                asked,
                said: describeNobody(answer.declared),
                agent: null,
                among: [],
              }
            : { id: turns.length, asked, said: describeEmpty(), agent: null, among: [] };

    setTurns([...turns, turn]);
    setDraft("");
  }

  return (
    <div className="chief">
      <section className="chief-thread" aria-label="Conversation">
        {turns.length === 0 ? (
          <div className="empty">
            <p>{limits.headline}</p>
            <p>{limits.meaning}</p>
            <p className="muted">
              This conversation is not saved. Leaving the page ends it.
            </p>
          </div>
        ) : (
          <ol className="chief-turns">
            {turns.map((turn) => (
              <li key={turn.id}>
                <article className="chief-turn is-asked">
                  <p className="eyebrow">You asked</p>
                  <p>{turn.asked}</p>
                </article>

                <article className="chief-turn is-said">
                  <p className="eyebrow">Chief</p>
                  <p>{turn.said.sentence}</p>

                  {/*
                    The author's own words, quoted and attributed — never folded
                    into the sentence above. See this file's header.
                  */}
                  {turn.said.quoted === null || turn.agent === null ? null : (
                    <figure className="chief-quote">
                      <blockquote>{turn.said.quoted}</blockquote>
                      <figcaption>
                        Written by whoever set up <code>{turn.agent.name}</code>. DASH is
                        repeating it, not vouching for it.
                      </figcaption>
                    </figure>
                  )}

                  {turn.agent === null ? null : (
                    <AgentHandoff agent={turn.agent} />
                  )}

                  {turn.among.length === 0 ? null : (
                    <ul className="chief-among">
                      {turn.among.map((agent) => (
                        <li key={agent.name}>
                          <AgentHandoff agent={agent} />
                        </li>
                      ))}
                    </ul>
                  )}

                  {turn.said.values.length === 0 || turn.agent !== null ||
                  turn.among.length > 0 ? null : (
                    <ul className="chief-values">
                      {turn.said.values.map((value) => (
                        <li key={value}>
                          <code>{value}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      <form className="chief-ask" onSubmit={ask}>
        <label htmlFor="chief-input">What do you want done?</label>
        <div className="chief-ask-row">
          <input
            id="chief-input"
            name="request"
            type="text"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Summarise today's AI news"
          />
          <button type="submit" className="primary" disabled={draft.trim() === ""}>
            Ask
          </button>
        </div>
        {/*
          Once, never twice. The empty state above already carries this
          sentence, and the first capture of this page printed both — the same
          defect MAR-533 found on the connections card, where one explanation
          appeared three times in eleven lines and taught the reader to stop
          reading the line that changes. It belongs here only once the empty
          state is gone, which is exactly when the reminder stops being
          redundant and starts being the only place it is said.
        */}
        {turns.length === 0 ? null : <p className="muted">{limits.meaning}</p>}
      </form>

      <aside className="chief-rail" aria-label="Your fleet right now">
        <h2>Right now</h2>
        {describeFleetCounts(fleet.counts).map((count) => (
          <div className="chief-count" key={count.label}>
            <p className="eyebrow">{count.label}</p>
            <p className="chief-count-value">{count.value}</p>
            <p className="muted">{count.meaning}</p>
          </div>
        ))}
      </aside>
    </div>
  );
}

/**
 * Where the person goes next, with the character that identifies the agent.
 *
 * A link and not a Run button. The Chief does not start work in this slice, and
 * a control here that looked like it would is the thing `describeChiefLimits`
 * exists to prevent. The agent's own page is where a run can be started next to
 * everything it is about to touch, which is where that decision belongs anyway.
 */
function AgentHandoff({ agent }: { agent: ChiefAgent }): ReactNode {
  return (
    <Link className="chief-agent" href={agentWorkspaceHref(agent.name)}>
      <OAvatar name={agent.avatar} size={50} />
      <span>
        <code>{agent.name}</code>
        <span className="muted">Open its page to start it</span>
      </span>
    </Link>
  );
}
