"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { agentStageHref } from "../_data/routes";
import { answerChief, type ChiefFleetAgent, type ChiefReply } from "../../lib/chief/reply";
import {
  CHIEF_CHAT_COPY,
  describeAmbiguous,
  describeChiefScope,
  describeMatch,
  describeRouted,
  describeStanding,
  describeUndeclared,
  type ChiefSentence,
} from "../../lib/copy/chief-chat";
import { CHIEF_NAME } from "../../lib/copy/chief";
import { describeFleetCardStatus } from "../../lib/copy/fleet-status";
import type { AgentRow } from "../../lib/views/types";

/**
 * The chief's composer, and the room it opens (MAR-648, closing MAR-419's
 * first half).
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
 * ## What it is allowed to say, which is nothing
 *
 * Every sentence comes from `lib/copy/chief-chat.ts` through `ChiefReply`, which
 * is `ask.tsx`'s rule and matters at least as much here: the chief is a
 * character that appears to be talking, and MAR-547's ruling against invented
 * facts applies hardest in a speech position because a sentence attributed to
 * somebody is the easiest place in an interface to smuggle a claim nobody can
 * source.
 *
 * The one exception proves it. An agent's `goal` is **its author's** sentence,
 * so it is rendered quoted and attributed rather than folded into the chief's
 * words — `ChiefSentence.quoted` exists for that and this component is where the
 * quotation marks are actually drawn.
 *
 * ## Why there is no loader here, and there is one on the agent page
 *
 * `answerChief` is a pure function of records already in this component's props.
 * It returns before the next frame. A spinner over a synchronous read would be
 * the same fabrication MAR-648 forbids on the agent side, wearing the opposite
 * costume — theatre asserting that work is happening when none is.
 *
 * The O at work lives on `AskComposer`, which really does await a provider over
 * a process boundary. When the chief gains a model, it gains the loader with it.
 *
 * ## The scrollback is not stored, and the surface says so
 *
 * `describeChiefScope` carries the sentence. The reasoning is in that function's
 * own header: the chief's answers are statements about how the fleet is doing
 * *now*, and a stored one would be a sentence that was true last Tuesday sitting
 * in a scrollback looking like a sentence about today. ADR 0012's argument for
 * storing every agent question does not reach it, because that conversation is
 * about material an agent saved and this one is about a standing that moves.
 */
export function ChiefChat({
  agents,
  open,
  onOpen,
  onClose,
}: {
  /** The fleet as the band already has it — filtered, in the list's own order. */
  agents: readonly AgentRow[];
  /** Whether the room is showing. Owned by `FleetList`, which dims the cards. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}): ReactNode {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<readonly ChiefTurn[]>([]);
  const thread = useRef<HTMLDivElement | null>(null);

  /*
   * The newest turn, scrolled to, and only when there is one to scroll to.
   *
   * `behavior` follows the reader's own setting rather than a preference this
   * component holds — the same read `FleetList.scrollTo` already does, for the
   * same reason: a person who asked their operating system to stop animating
   * things asked this one too.
   */
  useEffect(() => {
    if (!open || turns.length === 0) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [open, turns.length]);

  const fleet: ChiefFleetAgent[] = agents.map((agent) => ({
    name: agent.name,
    title: agent.title,
    goal: agent.goal,
    avatar: agent.avatar,
    capabilities: agent.capabilities,
    glance: agent.glance,
    status:
      describeFleetCardStatus({
        running: agent.running,
        run_count: agent.run_count,
        glance: agent.glance,
      })?.id ?? null,
  }));

  function ask(): void {
    const asked = question.trim();
    if (asked.length === 0) {
      return;
    }
    /*
     * Answered here and now, from the props this render already holds. There is
     * no request, so there is nothing to fail and nothing to wait for — see this
     * component's header on why that means no loader rather than a fast one.
     */
    setTurns((previous) => [...previous, { id: previous.length, question: asked, reply: answerChief(asked, fleet) }]);
    // Cleared on send, unlike `AskComposer`, and the asymmetry is the point:
    // that box keeps a failed question so the retry is one press, and this one
    // cannot fail. The question is in the scrollback a line above either way.
    setQuestion("");
    onOpen();
  }

  /*
   * Escape closes the room and never touches the box.
   *
   * `AskComposer` declined to bind this key at all, and its reason is right and
   * still holds: *"a key that discarded it would be a destructive control with
   * no confirmation."* Closing the room discards nothing — the question stays
   * typed, the scrollback stays where it is, and re-focusing the box brings both
   * back. What Escape means here is "put the cards back", which is what a person
   * pressing it on a surface that expanded over something expects.
   */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  }

  const scope = describeChiefScope();

  return (
    <div className="chief-chat">
      {open ? (
        <div className="chief-room" ref={thread}>
          <div className="chief-room-head">
            <h2>{CHIEF_CHAT_COPY.heading}</h2>
            <button type="button" className="button-link" onClick={onClose}>
              {CHIEF_CHAT_COPY.close}
            </button>
          </div>
          {turns.length === 0 ? (
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
            <ol className="chief-turns" aria-label={CHIEF_CHAT_COPY.thread_heading}>
              {turns.map((turn) => (
                <li key={turn.id} className="chief-turn">
                  <p className="chief-asked wrap">{turn.question}</p>
                  <ChiefReplyBody reply={turn.reply} />
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      <div className="chief-compose">
        <label className="chief-field">
          <span className="visually-hidden">{CHIEF_CHAT_COPY.label}</span>
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
          disabled={question.trim().length === 0}
          onClick={ask}
        >
          {CHIEF_CHAT_COPY.submit}
        </button>
      </div>

      {/*
        The settings row, and it carries what is true rather than what the
        screenshot had.

        MAR-648's own words about this row: affordances *"as they become real,
        never as dead chrome"*. The agent composer's row names the model it will
        ask under, because there is one and a person chose it. There is no model
        here, so a greyed model chip would be exactly the dead chrome that
        sentence refuses. What is true — and is the thing somebody most needs to
        know before typing — is where the answers come from and that they are
        free, so that is the row.
      */}
      <p className="chief-settings muted">{scope.headline}</p>
    </div>
  );
}

interface ChiefTurn {
  id: number;
  question: string;
  reply: ChiefReply;
}

/**
 * One reply, drawn.
 *
 * A `switch` over the union rather than a chain of truthiness checks, so a sixth
 * kind of reply stops this file compiling instead of silently rendering nothing
 * — the same guarantee `AgentStageView` gets from its record of stages.
 */
function ChiefReplyBody({ reply }: { reply: ChiefReply }): ReactNode {
  if (reply.kind === "nothing_asked") {
    return null;
  }

  if (reply.kind === "routed") {
    return (
      <div className="chief-reply">
        <Says sentence={describeRouted(reply.agent.title, reply.agent.goal)} />
        <Says sentence={describeMatch(reply.matched)} />
        <Link className="button-link" href={agentStageHref(reply.agent.name, "chat")}>
          {CHIEF_CHAT_COPY.open_chat}
        </Link>
      </div>
    );
  }

  if (reply.kind === "ambiguous") {
    return (
      <div className="chief-reply">
        <Says sentence={describeAmbiguous(reply.agents.map((agent) => agent.title))} />
        <ul className="chief-choices">
          {reply.agents.map((agent) => (
            <li key={agent.name}>
              <Link className="button-link" href={agentStageHref(agent.name, "chat")}>
                {agent.title}
              </Link>
            </li>
          ))}
        </ul>
        <Says sentence={describeMatch(reply.matched)} />
      </div>
    );
  }

  return (
    <div className="chief-reply">
      <Says
        sentence={
          reply.kind === "standing"
            ? describeStanding(reply.demands.length)
            : describeUndeclared(reply.declared)
        }
      />
      <p className="chief-standing wrap">{reply.summary}</p>
      {reply.demands.length === 0 ? null : (
        <ul className="chief-demands">
          {reply.demands.map((demand) => (
            <li key={demand.agent}>
              {/* The chip's own two words, then the chip's own whole sentence.
                  Neither is reworded here — `ChiefDemand` carries them straight
                  off `lib/copy/glance.ts`, so the line the chief says and the
                  chip on the card above cannot come to mean different things. */}
              <Link className="chief-demand-agent" href={agentStageHref(demand.agent, "overview")}>
                {demand.title}
              </Link>
              <span className="chip">{demand.label}</span>
              <span className="muted wrap"> {demand.meaning}</span>
            </li>
          ))}
        </ul>
      )}
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
        <span className="visually-hidden">{CHIEF_NAME}: </span>
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
