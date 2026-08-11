"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AgentComplianceChips } from "./_components/verdict";
import { AgentOrigin } from "./_components/agent-origin";
import { GlanceChips, OpenAgentButton } from "./_components/glance-chips";
import { TechnicalDetails } from "./_components/record-card";
import { OAvatar } from "./_components/o-avatar";
import { HostNotice, ViewFailed, ViewLoading } from "./_components/view-state";
import { checkRunnerStatus, retireRunnerStore } from "./_data/source";
import { useSightings } from "./_data/sightings";
import { useCanAct, useHost, useView } from "./_data/use-view";
import { describeAgentHosting } from "../lib/host-sighting";
import { sightingFor, type SightingLog } from "../lib/host-sightings";
import type { AgentHostedOnView } from "../lib/views/types";
import { agentWorkspaceHref } from "./_data/routes";
import { oFor } from "../lib/brand/o-cast";
import { describeRunnerStoreDamage, type RunnerStoreDamageKind } from "../lib/copy/recovery";
import { onWindowFocus } from "../lib/shell/focus-refresh";
import type { CommandResult } from "../lib/shell/ipc";

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
  const focusKey = useRefreshOnWindowFocus();
  const state = useView((source) => source.agents(), focusKey);
  const host = useHost();
  const canAct = useCanAct();
  const storeDamage = useRunnerStoreDamage(canAct);
  /*
   * MAR-606. What the Servers page saw, this window (ADR 0015).
   *
   * Empty until somebody has pressed Check somewhere, which is the honest
   * majority case and the one every card is worded for. This page never asks a
   * server anything — see `useView`'s own header on why it does not poll, and
   * ADR 0015 on why a sighting is not stored.
   */
  const log = useSightings();

  return (
    <>
      <h1>Agents</h1>
      <p className="lede">
        Every agent this DASH knows about, and where each one came from.
      </p>
      {/*
        The entrance "Add agent" lost when it stopped being a sidebar row
        (MAR-592).

        It is here rather than only inside the empty state below, and the
        difference is the whole reason this exists: the empty state is shown to
        somebody with *no* agents, and the person who needs this most is the one
        who has one and wants a second. Before this issue that person pressed a
        sidebar row; the row is now a tab inside Settings, and "add a thing" is
        not a question anybody thinks to ask a settings page.

        A link, not a button, and it goes to the same page the tab does. There is
        one add-agent surface and this is a second door onto it — the argument
        `lib/shell/menu.ts` made about its own menu item, which is why that item
        and this link and the tab are three entrances and one implementation.
      */}
      <div className="page-actions">
        <Link className="button-link" href="/settings/add-agent">
          Add agent
        </Link>
      </div>
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
                  <a href="/settings/add-agent">add an agent you built yourself</a>.
                </p>
              </div>
            )
          ) : (
        /*
          MAR-547's concept composition, taken (Henrik, 2026-08-09: "I want the
          fleet cards to fit like 3 in a row. And the avatar to be bigger").

          The list stays an `<ol>` and stays `.row-list` — what changes is the
          track it lays cards on, which is a `fleet-grid` modifier rather than a
          change to `.row-list` itself. The Runs and Connections pages use that
          class too, and their records are wide rows of prose rather than
          portraits; giving all three a three-column grid because one of them
          wanted it is how a shared class stops being shared.
        */
        <ol className="row-list fleet-grid">
          {state.data.agents.map((agent) => (
            <li key={agent.name}>
              <article className="row-card fleet-card">
                {/*
                  The concept's header band (MAR-528, `DESIGN.md` "Cards &
                  Panels"): a distinct top section with a bold monospace label
                  and one status slot on the right. The label is the agent's
                  name; the status is DASH's own verdict on its recent runs,
                  which is the nearest true thing to the concept's ACTIVE chip —
                  and unlike that chip it is a record rather than a reading.

                  The "Last N runs" eyebrow that used to sit above these chips is
                  gone, and nothing is lost with it: every chip carries its own
                  denominator ("5/5 clean", "2/5 gate violation"), which is the
                  fact the eyebrow was there to supply. In a card a third of the
                  page wide, a label explaining a number that is already on
                  screen is the "text that is not needed" MAR-547 names.
                */}
                <div className="card-head">
                  <h3>
                    <Link className="plain" href={agentWorkspaceHref(agent.name)}>
                      <code>{agent.name}</code>
                    </Link>
                  </h3>
                  <AgentComplianceChips compliance={agent.compliance} />
                </div>
                {/*
                  MAR-501's rule survives the move and is worth restating, since
                  the character is no longer beside the name: it must not be
                  aligned with the verdict. Here it is centred in a band of its
                  own, above the goal and below the name — recognition, in the
                  position the concept gives a portrait, and nowhere near the
                  compliance chips.

                  MAR-587, and Henrik's second pass at the same sentence: "it
                  would also be cool if we could animate the Os and make them
                  big… to make the fleet look more like a game and character
                  selection." So the tile is the card's hero at `size={200}` —
                  4× the 50px source, a whole multiple, because
                  `image-rendering: pixelated` upscales by nearest neighbour and
                  a "slightly bigger" sprite lands source pixels unevenly.

                  `action` draws the character's vendored idle loop where one
                  exists — three of eleven today. It is a literal rather than an
                  expression, and `scripts/brand-rules.mjs` fails anything else:
                  whether this surface animates is a decision about the surface,
                  never a fact about the agent. Everything the fleet actually
                  *knows* is in the chips below, in words.
                */}
                <div className="fleet-portrait">
                  <OAvatar name={agent.avatar} size={200} action />
                </div>
                <p className="muted wrap">{agent.goal}</p>
                {/*
                  MAR-491. One line of meta, and it is the two facts a person
                  can do something with: has this agent ever worked, and where
                  did it come from. The other four — plan source, build target,
                  planned steps, clearance — are DASH's own vocabulary and are
                  behind the disclosure below.

                  The cut is the issue's second option ("keep a subset primary,
                  with the rest behind a disclosure"), applied at every width
                  rather than under a breakpoint. `lib/copy/record-card.ts` has
                  the argument; the short version is that a width-conditional
                  card is two interfaces, and room is not a reason to show
                  something.
                */}
                {/*
                  MAR-586. The four questions, above the meta line and below the
                  goal: what an agent is *for* is why you keep it, and whether
                  something is waiting on you is why you look at it today. Both
                  come before DASH's own record of how many times it has run.

                  Every chip is a stored fact and links to where that fact is
                  answered — see `lib/copy/glance.ts` for MAR-547's ruling, which
                  is what keeps this a row of facts rather than a row of meters.
                */}
                <GlanceChips agent={agent.name} chips={agent.glance} />
                {/*
                  MAR-606. Where this agent runs, when that is anywhere but this
                  computer.

                  Below the glance chips rather than among them, and that is not
                  a layout preference. `lib/copy/glance.ts` reserves those four
                  for *things that need you*, and its tone scale has no success
                  colour at all — a card is a record of an agent at rest and has
                  nothing live to report. This does: a sighting is DASH having
                  just looked at a process on a machine and been told yes, which
                  is the exception that comment anticipated. Keeping it out of
                  `GlanceChip` is what stops emerald leaking into a scale built
                  on not having one.

                  Draws nothing for an agent DASH has never sent anywhere, which
                  is almost all of them.
                */}
                <AgentHosting agent={agent.name} hostedOn={agent.hosted_on} log={log} />
                <p className="card-meta">
                  <span className="value">{describeRunCount(agent.run_count)}</span>
                  <span aria-hidden="true"> · </span>
                  <AgentOrigin origin={agent.origin} />
                </p>
                {/*
                  MAR-586's second half, and MAR-547's "can't be clicked" from
                  the reader's side: a control they can see, rather than a
                  heading that turns out to have been a link.
                */}
                <div className="glance-actions">
                  <OpenAgentButton agent={agent.name} />
                </div>
                <TechnicalDetails>
                  <dl className="facts">
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
                  </dl>
                </TechnicalDetails>
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
 * Where one agent runs, when that is anywhere but this computer (MAR-606).
 *
 * Two sources, joined here because neither is complete on its own and only a
 * renderer holds both:
 *
 * - `hostedOn` is DASH's own deploy record, on the view, durable, and true on a
 *   cold start. It is what makes the indicator appear at all.
 * - `log` is what a server said when somebody last pressed Check, held for this
 *   window only (ADR 0015). It is what gives the indicator a colour.
 *
 * With no sighting the card says DASH sent this here and has not asked since,
 * which is honest and is the state a freshly opened window is always in. It is
 * never blank while a deploy record exists, because "we have not looked" and
 * "there is nothing to say" are different facts and only one of them is true.
 *
 * Exported so a render test can drive both halves without a store or a check.
 */
export function AgentHosting({
  agent,
  hostedOn,
  log,
}: {
  agent: string;
  hostedOn: readonly AgentHostedOnView[];
  log: SightingLog;
}): ReactNode {
  const first = hostedOn[0];
  if (first === undefined) {
    return null;
  }
  /*
   * The newest sighting across this agent's servers, or null when none has been
   * taken. Falls back to the newest *deploy*, which is `hostedOn[0]` — so an
   * unchecked agent still names a server rather than nothing.
   */
  const seen = sightingFor({ agent, sent_to: hostedOn, log });
  const server = seen?.label ?? first.label;
  const hosting = describeAgentHosting({
    agent,
    server,
    seen: seen?.seen ?? null,
    sent_on: hostedOn.find((one) => one.label === server)?.sent_on ?? first.sent_on,
    at: seen?.at ?? null,
  });
  if (hosting === null) {
    return null;
  }
  return (
    <p className="fleet-hosting">
      <span className={`chip chip-${hosting.tone}`}>{hosting.chip}</span>
      {/* The sentence carries the moment, which is what licenses the chip's
          colour at all — see ADR 0015. It is rendered rather than hidden in a
          title, for the reason `GlanceChip.meaning` is: a fact somebody has to
          discover by pointing at something is a fact most people never read. */}
      <span className="muted wrap">{hosting.sentence}</span>
      {hostedOn.length > 1 ? (
        <span className="muted wrap">
          DASH has sent it to {String(hostedOn.length)} servers. The Servers page lists them all.
        </span>
      ) : null}
    </p>
  );
}

/**
 * MAR-595 finding 13. Bumped every time the window regains OS focus, and
 * passed to `useView` as its `refreshKey` above, so this page rereads the
 * agents list rather than staying on whatever it read at mount — the case
 * that matters is `npm run open-in-dash`'s native consent dialog adding an
 * agent while this page was underneath it the whole time. See
 * `lib/shell/focus-refresh.ts` for why `focus` rather than a poll.
 */
function useRefreshOnWindowFocus(): number {
  const [key, setKey] = useState(0);
  useEffect(() => onWindowFocus(window, () => { setKey((value) => value + 1); }), []);
  return key;
}

/**
 * How many times this agent has worked, in a sentence rather than a number
 * (MAR-491).
 *
 * `0` under a `Runs` label is a fact a person has to assemble; "Not run yet" is
 * the same fact already assembled, and it is the one that belongs on a card
 * whose other line is what the agent is for. The plural is spelled out because
 * "1 runs" is the smallest possible way for a surface to look unfinished.
 */
export function describeRunCount(runs: number): string {
  if (runs <= 0) {
    return "Not run yet";
  }
  return runs === 1 ? "Run once" : `Run ${String(runs)} times`;
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
