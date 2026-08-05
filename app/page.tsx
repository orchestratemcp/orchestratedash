"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AgentComplianceChips } from "./_components/verdict";
import { AgentOrigin } from "./_components/agent-origin";
import { HostNotice, ViewFailed, ViewLoading } from "./_components/view-state";
import { useHost, useView } from "./_data/use-view";
import { agentWorkspaceHref } from "./_data/routes";
import { ROLLUP_RUN_COUNT } from "../lib/views/rollup";

/**
 * The agents list.
 *
 * A client component since MAR-432, like every page here. What it renders is
 * unchanged; where the data comes from is not. See `app/_data/source.ts`.
 */
export default function AgentsPage(): ReactNode {
  const state = useView((source) => source.agents());
  const host = useHost();

  return (
    <>
      <h1>Agents</h1>
      <p className="lede">
        Every agent this DASH knows about, and where each one came from.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="your agents" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <>
          {/*
            The page-level entrance `lib/shell/menu.ts` anticipated: *"MAR-423's
            page work may add a second entrance; this item is neither a
            substitute for that button nor a reason to implement the operation
            twice."* It is a second *entrance*, not a second implementation —
            main owns the operation, and both this and the menu item reach it.

            Shown only when there is nothing to look at. Once somebody has an
            agent, the list is what they came for, and an onboarding card that
            outstays its welcome is the thing every empty state gets wrong.
          */}
          {state.data.agents.length === 0 && state.data.damage === null ? (
            <TryTheScout />
          ) : null}
          {/*
            Above the list, not instead of it. Damage to one agent's record says
            nothing about the others, and hiding a working list behind a notice
            about a row that is gone would turn a partial loss into a total one
            on screen — which is the failure this whole change exists to undo.
          */}
          {state.data.damage !== null ? <ViewFailed recovery={state.data.damage} /> : null}
          {state.data.agents.length === 0 ? (
            /*
             * "No agents yet" is a claim about history, and it is false when the
             * agents are in the store and unreadable. The recovery above already
             * says what happened, so this says only what is true either way.
             */
            state.data.damage !== null ? null : (
              <div className="empty">
                <p>
                  Nothing here yet. Start with AI News Scout above, or{" "}
                  <a href="/agents/add">add an agent you built yourself</a>.
                </p>
              </div>
            )
          ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Goal</th>
                <th>Where it came from</th>
                <th>Plan source</th>
                <th>Build target</th>
                <th>Planned steps</th>
                <th>Clearance</th>
                <th>Runs</th>
                <th>Last {ROLLUP_RUN_COUNT} runs</th>
              </tr>
            </thead>
            <tbody>
              {state.data.agents.map((agent) => (
                <tr key={agent.name}>
                  <td>
                    <Link className="plain" href={agentWorkspaceHref(agent.name)}>
                      <code>{agent.name}</code>
                    </Link>
                  </td>
                  <td className="wrap">{agent.goal}</td>
                  <td>
                    <AgentOrigin origin={agent.origin} />
                  </td>
                  <td>{agent.plan_source}</td>
                  <td>{agent.build_target}</td>
                  <td>{agent.planned_steps}</td>
                  <td>{agent.automation_clearance}</td>
                  <td>{agent.run_count}</td>
                  <td>
                    <AgentComplianceChips compliance={agent.compliance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          )}
        </>
      )}
    </>
  );
}

/**
 * The first thing somebody with an empty DASH sees.
 *
 * It states what they will get and what it costs them, in that order, and the
 * cost is the interesting half: no account, no password, and nothing runs until
 * they ask. A first-run card that promised only the benefit would be the kind of
 * onboarding that makes people close the window.
 *
 * The button is a link to Add agent rather than a handler. Creating the sample
 * is main's operation — it writes a project, mints a real nonce and raises a
 * native consent dialog — and a renderer that reached past that would be the
 * second registration path `lib/sample-agent.ts` exists to argue against.
 */
function TryTheScout(): ReactNode {
  return (
    <section className="section try-sample" aria-labelledby="try-sample-heading">
      <p className="eyebrow">Start here</p>
      <h2 id="try-sample-heading">AI News Scout</h2>
      <p className="lede">
        It reads the news sources you choose and writes you a short summary of
        what is new, with a link to where each item came from.
      </p>
      <ul className="capability-list">
        <li>No account and no password.</li>
        <li>It runs only when you ask it to.</li>
        <li>You choose what it reads, and can change it at any time.</li>
      </ul>
      {/*
        MAR-440 made this sentence false and it is corrected here rather than in
        that issue's own files, because it is the only place in the product that
        told a user where the menu was.

        The old wording — "open the DASH menu" — described the native menu bar,
        which no longer exists. There is no menu *bar* to name any more, so the
        copy names the button instead, and describes it by where it is and what
        it looks like rather than by a word ("hamburger", "app menu") that a
        novice has no reason to know.
      */}
      <p>
        Choose <strong>Try a sample agent</strong> from the menu button
        (<span aria-hidden="true">☰</span>) at the top left of the window. DASH
        makes it, shows you what it will do, and asks before adding anything.
      </p>
    </section>
  );
}
