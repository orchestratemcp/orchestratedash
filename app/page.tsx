"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AgentComplianceChips } from "./_components/verdict";
import { AgentOrigin } from "./_components/agent-origin";
import { OAvatar } from "./_components/o-avatar";
import { HostNotice, ViewFailed, ViewLoading } from "./_components/view-state";
import { checkRunnerStatus, retireRunnerStore } from "./_data/source";
import { useCanAct, useHost, useView } from "./_data/use-view";
import { agentWorkspaceHref } from "./_data/routes";
import { oFor } from "../lib/brand/o-cast";
import { describeRunnerStoreDamage, type RunnerStoreDamageKind } from "../lib/copy/recovery";
import type { CommandResult } from "../lib/shell/ipc";
import { ROLLUP_RUN_COUNT } from "../lib/views/rollup";

/**
 * The folder name `lib/sample-agent.ts` gives the sample agent, and therefore
 * the seed its character is assigned from.
 *
 * A literal here because that module imports `node:fs` and would drag it into
 * the renderer bundle. `tests/fleet-strip.test.ts` asserts this equals
 * `SAMPLE_AGENT_ID`, which is the only thing that keeps the teaser's character
 * and the created agent's character the same one.
 */
export const SAMPLE_AGENT_SEED = "ai-news-scout";

/**
 * The agents list.
 *
 * A client component since MAR-432, like every page here. What it renders is
 * unchanged; where the data comes from is not. See `app/_data/source.ts`.
 */
export default function AgentsPage(): ReactNode {
  const state = useView((source) => source.agents());
  const host = useHost();
  const canAct = useCanAct();
  const storeDamage = useRunnerStoreDamage(canAct);

  return (
    <>
      <h1>Agents</h1>
      <p className="lede">
        Every agent this DASH knows about, and where each one came from.
      </p>
      <HostNotice host={host} />
      {/*
        Above everything, including the loading state below: a damaged runner
        store is a fact about the whole runner, unrelated to whether DASH's own
        agents list has finished reading. AGENTS.md's UX principle names this
        page for exactly this question — "what needs my decision" — and nothing
        else asks it, since the runner supervises every agent and no per-agent
        surface can say so on its behalf.
      */}
      {storeDamage !== null ? <RunnerStoreDamageNotice kind={storeDamage} /> : null}

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
        <ol className="row-list">
          {state.data.agents.map((agent) => (
            <li key={agent.name}>
              <article className="row-card">
                <div className="section-heading">
                  {/*
                    MAR-501. The character sits beside the name — recognition
                    next to identity — and not in the block on the right, which
                    is where this card keeps its verdict. That placement is the
                    rule rather than a preference: a costume aligned with a
                    compliance chip reads as one unit, and then the costume is
                    saying something about how the agent behaved.
                  */}
                  <div className="agent-identity">
                    <OAvatar name={agent.avatar} size={50} />
                    <h3>
                      <Link className="plain" href={agentWorkspaceHref(agent.name)}>
                        <code>{agent.name}</code>
                      </Link>
                    </h3>
                  </div>
                  <div>
                    <p className="eyebrow">Last {ROLLUP_RUN_COUNT} runs</p>
                    <AgentComplianceChips compliance={agent.compliance} />
                  </div>
                </div>
                <p className="muted wrap">{agent.goal}</p>
                <dl className="facts">
                  <div>
                    <dt>Where it came from</dt>
                    <dd>
                      <AgentOrigin origin={agent.origin} />
                    </dd>
                  </div>
                  <div>
                    <dt>Plan source</dt>
                    <dd>{agent.plan_source}</dd>
                  </div>
                  <div>
                    <dt>Build target</dt>
                    <dd>{agent.build_target}</dd>
                  </div>
                  <div>
                    <dt>Planned steps</dt>
                    <dd>{agent.planned_steps}</dd>
                  </div>
                  <div>
                    <dt>Clearance</dt>
                    <dd>{agent.automation_clearance}</dd>
                  </div>
                  <div>
                    <dt>Runs</dt>
                    <dd>{agent.run_count}</dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ol>
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
      <div className="agent-identity">
        {/*
          MAR-501's optional case, taken. This is the one card a person with an
          empty DASH sees, and the character introduces the cast before there is
          a fleet to recognise anybody in.

          It is the character this agent *will* wear, not a decoration: `oFor`
          is the same default assignment `lib/store.ts` runs at creation, so the
          O standing here is the O that appears on the first card and in the
          bottom strip a minute later. That is the whole argument for showing
          one — it is a promise the next screen keeps.

          The seed is written out rather than imported from `lib/sample-agent.ts`,
          which reaches `node:fs` and cannot enter the client bundle
          (`tests/client-bundle.test.ts`). `tests/fleet-strip.test.ts` pins this
          literal against `SAMPLE_AGENT_ID` so the two cannot drift.
        */}
        <OAvatar name={oFor(SAMPLE_AGENT_SEED)} size={50} />
        <div>
          <p className="eyebrow">Start here</p>
          <h2 id="try-sample-heading">AI News Scout</h2>
        </div>
      </div>
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

/**
 * Read a `runner.status` reply for the one fact this page acts on.
 *
 * A pure function rather than inline in the effect below, so the parsing —
 * `data` is `Record<string, string | number | boolean>` on the wire and has
 * to be narrowed by hand — is testable without React, a bridge, or a runner.
 * Anything short of an exact, recognised kind is "not damaged" rather than a
 * guess: a status check that cannot fully explain itself must not put a
 * button in front of a user for a fault it cannot name.
 */
export function runnerStoreDamageFromStatus(result: CommandResult): RunnerStoreDamageKind | null {
  const damaged = result.data?.["store_damaged"] === true;
  const reported = result.data?.["damage_kind"];
  if (damaged && (reported === "malformed" || reported === "not_a_database" || reported === "unreadable")) {
    return reported;
  }
  return null;
}

/**
 * Ask, once, whether the runner's own store is damaged (MAR-518).
 *
 * Not `useView`/`useLiveView`: this is a command, not a document read, and it
 * asks the runner directly rather than DASH's own store — there is nothing in
 * `lib/store.ts` for a poller to have written, because the runner is a
 * separate process with its own database. Checked once on mount, like
 * `useHost` and `useCanAct` above it: this page does not otherwise poll, and a
 * damaged store does not self-repair between one render and the next.
 *
 * `canAct` gates it because a browser tab has no `dashShell` bridge at all —
 * `checkRunnerStatus` would refuse honestly either way, but there is no
 * reason to make the read-only path wait on a call that can only fail.
 */
function useRunnerStoreDamage(canAct: boolean): RunnerStoreDamageKind | null {
  const [kind, setKind] = useState<RunnerStoreDamageKind | null>(null);

  useEffect(() => {
    if (!canAct) {
      return;
    }
    let current = true;
    void checkRunnerStatus().then((result) => {
      if (!current) {
        return;
      }
      const reported = runnerStoreDamageFromStatus(result);
      if (reported !== null) {
        setKind(reported);
      }
    });
    return () => {
      current = false;
    };
  }, [canAct]);

  return kind;
}

/**
 * The runner-store recovery, with the one button that repairs it (MAR-518).
 *
 * `describeRunnerStoreDamage(kind, { can_retire: true })` is the same
 * function `lib/agent-dom/transport.ts` calls for the per-agent case — one
 * copy, never two that could disagree about what the same fault means. What
 * differs here is that this surface has somewhere to put the button the other
 * one does not.
 *
 * Rename-not-delete is final, and the copy says so before anything is
 * clicked: there is no second, more drastic option beside this one.
 */
export function RunnerStoreDamageNotice({ kind }: { kind: RunnerStoreDamageKind }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; detail?: string } | null>(null);
  const recovery = describeRunnerStoreDamage(kind, { can_retire: true });

  async function retire(): Promise<void> {
    setBusy(true);
    const result = await retireRunnerStore();
    setBusy(false);
    setOutcome({ ok: result.ok, detail: result.detail });
  }

  if (outcome?.ok === true) {
    return (
      <div className="notice notice-ok" role="status">
        <p>
          <strong>The damaged records are set aside.</strong>
        </p>
        <p>{outcome.detail ?? "A fresh store is open."}</p>
      </div>
    );
  }

  return (
    <div className="empty" role="alert">
      <p>
        <strong>{recovery.headline}</strong>
      </p>
      <p>{recovery.meaning}</p>
      <p>{recovery.next_action}</p>
      {outcome !== null && !outcome.ok ? (
        <p className="muted">{outcome.detail ?? "The runner could not set its store aside."}</p>
      ) : null}
      <div className="button-row">
        <button
          type="button"
          className="button-primary"
          disabled={busy}
          onClick={() => void retire()}
        >
          {busy ? "Setting aside…" : "Set records aside"}
        </button>
      </div>
    </div>
  );
}
