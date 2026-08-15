"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import {
  describeConnectState,
  describeDisconnect,
  type HostConnectState,
} from "../../lib/host-connect";
import { describeAskedAt, describeUndeployable } from "../../lib/deploy/deploying";
import {
  DEPLOY_LIVES_ON_THE_AGENT,
  describeAdded,
  describeDeployed,
  describePin,
  describeSameServer,
  describeSignIn,
  standingChip,
} from "../../lib/server-card";
import { agentStageHref } from "../_data/routes";
import { describeSetupStep } from "../../lib/host-wizard";
import {
  describeWhatIsOnHost,
  summariseWhatIsOnHost,
  type AgentHostStanding,
} from "../../lib/host-sighting";
import { describeBringHome } from "../../lib/copy/bring-home";
import type { AgentDeployChoice, SavedServerView } from "../../lib/views/types";

/**
 * A saved server, as a card you manage (MAR-574).
 *
 * The surface the Servers route did not have. `lib/server-card.ts` owns every
 * sentence here and `lib/host-connect.ts` owns the standing; this owns the
 * order, which is the answer to the question the page is open for read top to
 * bottom:
 *
 * 1. **What is it and does it work** — the label, and the standing in its own
 *    words. The chip beside the label is the same fact at a glance, and since
 *    MAR-605 that is literal rather than aspirational: `standingChip` moved into
 *    `lib/server-card.ts` and builds its label out of the standing's own
 *    `reach`, so this component no longer has the option of deciding how far
 *    DASH got. It had that option once, and used it to draw CANNOT REACH above
 *    a sentence reading "the server is answering".
 * 2. **How DASH reaches it, and since when** — the connection facts, which are
 *    what a person checks against their provider's own page.
 * 3. **What is on it** — reported by the server, never claimed by DASH.
 * 4. **Which machine it is** — the pinned identity, null on every real record
 *    today (MAR-572), and said rather than hidden.
 * 5. **What you can do** — check again, put an agent here, stop using it.
 *
 * The novice test this is written against: *someone who has never used SSH can
 * tell whether their server is working and what to do next.* Which is why the
 * standing is a sentence before it is a chip, why every failure carries its own
 * next action rather than one shared shrug, and why "nothing is running there"
 * is drawn as an ordinary state and not as a fault.
 */

/* ---------------------------------------------------------------------- *
 * The card
 * ---------------------------------------------------------------------- */

export interface ServerCardActions {
  check(): void;
  /*
   * MAR-642. There is no `deploy` here any more, and the absence is the packet.
   *
   * Henrik decided on 2026-08-15 that putting an agent on a server begins on
   * the agent, where its connections, its model and its folder already are.
   * This card can no longer start one — `SendAnAgentHere` links into the
   * agent's own Settings stage — so the action it would have needed does not
   * exist rather than being left wired to a control nobody presses.
   */
  forget(): void;
  /** Confirm the identity the card displayed (MAR-572). Carries it back verbatim. */
  trust(fingerprint: string): void;
  /** Fetch the one-paste bootstrap for this server (MAR-573). Null on failure. */
  setup(): Promise<string | null>;
  /**
   * Take this agent's copy back off this server (MAR-611, ADR 0017).
   *
   * Confirmed on the card first — see `confirmBringHome` — so this is only ever
   * called once a person has read `describeBringHome` and pressed the button
   * naming the act.
   */
  bringHome(agentId: string): void;
}

export function ServerCard({
  server,
  standing,
  checkedAt,
  agents,
  busy,
  notice,
  actions,
  canAct,
}: {
  server: SavedServerView;
  standing: HostConnectState;
  /**
   * When the server gave the standing above, or null before anything asked
   * (MAR-577).
   *
   * The card says what the server reported; this says when it said it. Without
   * it a count that was true ten minutes ago reads as one that is true now,
   * which is the failure this whole page was built against — see
   * `describeAskedAt`.
   */
  checkedAt: string | null;
  /** Every agent in this DASH, with whether it can be sent. Empty is a real state. */
  agents: readonly AgentDeployChoice[];
  busy: boolean;
  /** Whatever the last command said when it failed. Null when nothing did. */
  notice: string | null;
  actions: ServerCardActions;
  canAct: boolean;
}): ReactNode {
  const [confirmForget, setConfirmForget] = useState(false);
  const [deploying, setDeploying] = useState(false);
  /**
   * The agent id a bring-home is being confirmed for, or null (MAR-611,
   * ADR 0017). One at a time, the same shape `confirmForget` already uses for
   * the card's other irreversible action.
   */
  const [confirmBringHome, setConfirmBringHome] = useState<string | null>(null);

  const copy = describeConnectState(standing);
  const chip = standingChip(standing);
  const asked = describeAskedAt(checkedAt);
  const pin = describePin(server.fingerprint);
  const sameServer = describeSameServer(server.same_server_index, server.same_server_count);
  /*
   * The two accounts of what is on this machine, reconciled (MAR-606).
   *
   * `seen` is null until a check has actually answered — not an empty list,
   * which would mean "the server named nothing" and is a different claim
   * entirely. That distinction is the whole reason `describeWhatIsOnHost` takes
   * a nullable: an unchecked server and an empty server look identical to a
   * renderer and mean opposite things to a reader.
   */
  const contents = describeWhatIsOnHost({
    server: server.label,
    seen: standing.step === "reachable" ? standing.agents_there : null,
    sent: server.sent,
    at: checkedAt,
  });

  return (
    <article className="row-card server-card">
      <div className="card-head">
        <h2>{server.label}</h2>
        <span className={`chip ${chip.tone}`}>{chip.label}</span>
      </div>

      {/*
        Which of the identical records this is, and nothing more. The
        explanation is on the page, once — four cards each carrying the same
        three sentences is a wall of repeated text where the reader needed one
        fact per card.
      */}
      {sameServer === null ? null : <p className="card-meta">{sameServer}</p>}

      {/*
        The standing, as a sentence, above everything else on the card. A person
        who opened this page opened it to find out whether their server works,
        and the answer to that must not be a colour they have to interpret.
      */}
      <p className="wrap">
        <strong>{copy.headline}</strong>
      </p>
      <p className="wrap">{copy.detail}</p>
      {/*
        The next action, except where a button on this card already *is* it.
        "Check this server" printed immediately above a control reading CHECK
        THIS SERVER is noise, and noise directly above the thing a person is
        meant to press is the worst place to put it. Every other state's next
        action is guidance — copy the key onto the server, check the account
        name — and stays.
      */}
      {copy.next_action === null || standing.step === "not_checked" ? null : (
        <p className="next-action wrap">{copy.next_action}</p>
      )}

      <p className="card-meta wrap">
        {describeSignIn(server)}. {describeAdded(server.added_at)}.
      </p>

      {/*
        What is on the server, when there is anything to say about it. An
        unchecked card's standing already says DASH has not looked, and a second
        sentence saying the same thing in different words — five times down a
        list — is the wall of text this page is trying not to be.
      */}
      {standing.step === "not_checked" ? null : (
        <p className="card-meta wrap">
          {describeDeployed(standing)}
          {/* MAR-577. The moment the answer was given, beside the answer. Null
              until something has been asked, and null is right then: the
              standing already says DASH has not looked. */}
          {asked === null ? "" : ` ${asked}`}
        </p>
      )}

      {/*
        MAR-606 finding 3, and Henrik's own sentence: *"there is no way to see
        what agents are acctually on the server. As far as i can tell."*

        He was right, and the count above is why he was right — it said "1
        agent" after he had deployed the same agent by two different routes, and
        could not tell him whether that meant one copy or two. This is the same
        answer, unreduced, beside DASH's own record of what it put here.

        Drawn whenever either side has anything to say, including before any
        check: a person who has deployed to this server should see what DASH
        sent even when nothing has asked the machine yet. That state is what the
        list says it is, in words, rather than an absence.
      */}
      {contents.length === 0 ? null : (
        <WhatIsOnThisServer
          rows={contents}
          /*
           * MAR-611, ADR 0017. Bring-home only makes sense for an agent DASH
           * still holds on this computer — `bringAgentHomeFromHost` refuses
           * before starting anything otherwise — so the button is offered
           * exactly where that is true rather than for every row the server
           * happened to answer about.
           */
          knownLocally={new Set(agents.map((agent) => agent.name))}
          busy={busy}
          canAct={canAct}
          onBringHome={(agentId) => {
            setConfirmBringHome(agentId);
          }}
        />
      )}

      {confirmBringHome === null ? null : (
        <BringHomeConfirmation
          agent={confirmBringHome}
          label={server.label}
          busy={busy}
          onKeep={() => {
            setConfirmBringHome(null);
          }}
          onConfirm={() => {
            actions.bringHome(confirmBringHome);
            setConfirmBringHome(null);
          }}
        />
      )}

      {/*
        MAR-572, rendered rather than hidden. Every real record has a null
        fingerprint, so this is the branch a person actually sees, and it is the
        one fact on the card about *which machine this is* — the question the
        whole strict-host-key arrangement exists to answer and cannot yet.
      */}
      <details className="card-more">
        <summary>This server&rsquo;s identity</summary>
        <p className="wrap">
          <strong>{pin.headline}</strong>
        </p>
        <p className="wrap">{pin.detail}</p>
        {server.fingerprint === null ? null : (
          <pre className="public-key">{server.fingerprint}</pre>
        )}
      </details>

      {notice === null ? null : (
        <p className="notice notice-err wrap" role="alert">
          {notice}
        </p>
      )}

      {/*
        The enrollment moment on a saved record (MAR-572). Every real record is
        unpinned today, so the first check of a working server lands here: the
        code is shown, and confirming it is the one part only the person can do.
        The fingerprint they compare is on its own line above, so the button
        carries a decision they have actually made rather than a blind yes.
      */}
      {standing.step === "confirm_host_key" ? (
        <section className="enrollment-panel">
          <pre className="public-key">{standing.fingerprint}</pre>
          <button
            type="button"
            className="button-primary"
            disabled={busy || !canAct}
            onClick={() => {
              actions.trust(standing.fingerprint);
            }}
          >
            {busy ? "Confirming..." : "Yes, this is my server"}
          </button>
        </section>
      ) : null}

      {/*
        The bootstrap, reachable where it is needed (MAR-573, MAR-579). On a
        fresh box the walls arrive in order: the host key is confirmed first
        (above), then the sign-in fails because DASH's key and the helper are not
        on the server yet. Both are what the one-paste snippet installs, so the
        setup affordance is offered for `key_not_on_server` as well as
        `helper_not_installed` — the snippet is the single answer to "this server
        is not set up for DASH yet", whichever of the two the probe named.
      */}
      {standing.step === "unreachable" &&
      (standing.problem === "helper_not_installed" || standing.problem === "key_not_on_server") ? (
        <SetupPanel label={server.label} busy={busy} canAct={canAct} fetchScript={actions.setup} />
      ) : null}

      <div className="button-row">
        <button
          type="button"
          className="button-primary"
          disabled={busy || !canAct}
          onClick={() => {
            actions.check();
          }}
        >
          {standing.step === "probing" ? "Checking..." : "Check this server"}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !canAct}
          onClick={() => {
            setDeploying((open) => !open);
          }}
          aria-expanded={deploying}
        >
          Put an agent here
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !canAct}
          onClick={() => {
            setConfirmForget(true);
          }}
        >
          Stop using this server
        </button>
      </div>

      {/*
        MAR-642. The same button, opening a list of doorways rather than a
        deploy flow. `SendAnAgentHere` argues the demotion; what matters here is
        that the control kept its word — "put an agent here" still leads to
        putting an agent here, one press further on, on the page where that
        agent's own settings already are.
      */}
      {deploying ? <SendAnAgentHere server={server} agents={agents} canAct={canAct} /> : null}

      {confirmForget ? (
        <ForgetConfirmation
          label={server.label}
          busy={busy}
          onKeep={() => {
            setConfirmForget(false);
          }}
          onForget={actions.forget}
        />
      ) : null}
    </article>
  );
}

/**
 * What is on this server, from both accounts (MAR-606, ADR 0015).
 *
 * Exported so a render test can drive it without a click, the same reason
 * `DeployPanel` is: the sentences here are the ones that carry a timestamp, and
 * a timestamp that disappears when somebody tidies a component is the whole
 * failure ADR 0015 bounds against.
 *
 * Every row's sentence is complete on its own and carries its own moment, so
 * the section needs no shared "as of" header — which is deliberate rather than
 * repetitive. A header would be one clock over rows that can have been observed
 * at different times, and the first time those diverged the header would be
 * quietly wrong about most of the list.
 *
 * The chip is `lowercase` in the document. `app/globals.css` uppercases `.chip`
 * as typography, so what a screen reader announces is what is written here —
 * and a harness grepping for this copy must read the document rather than
 * `innerText`, which returns the uppercased form.
 */
export function WhatIsOnThisServer({
  rows,
  knownLocally,
  busy,
  canAct,
  onBringHome,
}: {
  rows: readonly AgentHostStanding[];
  /**
   * MAR-611, ADR 0017. Which of these agents DASH still holds on this
   * computer — the one precondition `bringAgentHomeFromHost` checks before
   * starting anything, so it is also the one gate for offering the button.
   */
  knownLocally: ReadonlySet<string>;
  busy: boolean;
  canAct: boolean;
  onBringHome: (agentId: string) => void;
}): ReactNode {
  return (
    <section className="host-contents">
      <h3 className="label-caps">What is on this server</h3>
      <p className="card-meta wrap">{summariseWhatIsOnHost(rows)}</p>
      <ul className="host-contents-list">
        {rows.map((row) => (
          <li key={row.agent} className="host-content">
            <span className="host-content-head">
              <code>{row.agent}</code>
              <span className={`chip chip-${row.tone}`}>{row.chip}</span>
            </span>
            <span className="wrap muted">{row.sentence}</span>
            {canAct && knownLocally.has(row.agent) ? (
              <div className="button-row">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => {
                    onBringHome(row.agent);
                  }}
                >
                  Bring it home
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The disclosure before a bring-home, and the two answers to it (MAR-611,
 * ADR 0017).
 *
 * `describeBringHome`'s three sentences, in the same two-step shape
 * `ForgetConfirmation` below already uses for this card's other irreversible
 * action: a person reads what will happen — including the half that is
 * deliberately *not* done — before either button is live.
 */
function BringHomeConfirmation({
  agent,
  label,
  busy,
  onKeep,
  onConfirm,
}: {
  agent: string;
  label: string;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}): ReactNode {
  const copy = describeBringHome(label);
  return (
    <section className="notice wrap" role="alert">
      <p>
        <strong>{copy.headline}</strong>
      </p>
      <p className="card-meta wrap">
        <code>{agent}</code>
      </p>
      <p>{copy.meaning}</p>
      <p className="disclosure wrap" role="note">
        {copy.afterwards}
      </p>
      <div className="button-row">
        <button type="button" className="button-secondary" disabled={busy} onClick={onKeep}>
          Not now
        </button>
        <button type="button" className="button-primary" disabled={busy} onClick={onConfirm}>
          {busy ? "Bringing it home…" : "Bring it home"}
        </button>
      </div>
    </section>
  );
}

/**
 * Where putting an agent here happens now (MAR-642).
 *
 * ## What this replaces, and why replacing it was the point
 *
 * `DeployPanel` was a picker, a receipt, four disclosures, a progress report
 * and two buttons — a whole deploy flow, on the card of the machine rather than
 * on the page of the agent. The agent's own Settings stage grew the same flow
 * in MAR-577, so DASH had two doors to one act, each with its own copy of the
 * ADR 0007 receipt, the travel notice and the refusal. MAR-624's own finding,
 * one surface along: *one need, surfaced by cards that did not acknowledge each
 * other.*
 *
 * Henrik decided the single home on 2026-08-15: **deploy begins on the agent.**
 * That is where the agent's connections, its model and its folder already are,
 * and it is where a person answering "should this thing run in the cloud?" is
 * already looking.
 *
 * ## Why this is a list of links rather than a sentence
 *
 * The affordance has to survive the move. "Unfindable is the same as missing" —
 * a card that simply lost its button would leave somebody on the Servers page
 * with a working server and no idea what to do with it, and the honest fix is
 * not a paragraph explaining that the control went somewhere else. It is the
 * control's *destination*, one press away, per agent.
 *
 * So every agent DASH could send is a link into its own Settings stage. What
 * this surface no longer does is initiate anything: there is no receipt here,
 * because nothing here deploys, and ADR 0007's while-closed sentence is said by
 * `DeployToServerPanel` before the deploy that actually happens.
 *
 * ## The refusals stay
 *
 * An agent that cannot be sent at all is drawn with its reason rather than
 * filtered out — `DeployPanel`'s own rule, and it matters more here than it did
 * there: a link is an invitation, and inviting somebody to walk to another page
 * to be told no is worse than telling them here.
 */
export function SendAnAgentHere({
  server,
  agents,
  canAct,
}: {
  server: SavedServerView;
  agents: readonly AgentDeployChoice[];
  canAct: boolean;
}): ReactNode {
  const sentHere = new Set(server.sent.map((one) => one.agent));

  return (
    <section className="send-here">
      <h3 className="label-caps">Put an agent here</h3>
      <p className="card-meta wrap">{DEPLOY_LIVES_ON_THE_AGENT}</p>

      {agents.length === 0 ? (
        <p className="wrap muted">
          There is no agent here to put on a server yet. Add one first and it will be offered
          here.
        </p>
      ) : (
        <ul className="send-here-list">
          {agents.map((agent) => {
            const refusal = agent.deploy.deployable
              ? null
              : describeUndeployable(agent.title, agent.deploy.refusal ?? "");
            return (
              <li key={agent.name} className="send-here-agent">
                <span className="send-here-head">
                  {/* MAR-589. The name a person picked this agent by, never the
                      id — the id is what the link's query carries and is not
                      what this row may say. */}
                  <span className="send-here-name">{agent.title}</span>
                  {sentHere.has(agent.name) ? (
                    <span className="chip chip-ok">already here</span>
                  ) : null}
                </span>
                {refusal === null ? (
                  canAct ? (
                    <Link
                      className="button-secondary"
                      href={agentStageHref(agent.name, "settings")}
                    >
                      Open its settings
                    </Link>
                  ) : (
                    /*
                     * Said rather than drawn as a dead link, `ConnectorTile`'s
                     * reason: a link that navigated to a page whose own control
                     * then refused would spend somebody's press on a wall they
                     * could have been told about here.
                     */
                    <span className="muted">Open the installed DASH app to put an agent here.</span>
                  )
                ) : (
                  <span className="wrap muted">
                    <strong>{refusal.headline}</strong> {refusal.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/*
 * MAR-642. The ADR 0007 receipt is not drawn here any more, and its absence is
 * as deliberate as its presence was.
 *
 * The rule is *"the while-closed sentence is said before the first deploy"*.
 * This card no longer performs one, so a receipt here would be a disclosure
 * about an act this surface cannot take — and, worse, a third copy of it
 * competing with the two that sit where deploys actually begin:
 * `DeployToServerPanel` on the agent's own Settings stage, and `CheckStep` in
 * the connect wizard at the moment a server first becomes reachable.
 *
 * `describeDeployArrangement` is untouched and still has two callers.
 */

/**
 * The one-paste bootstrap, reachable at last (MAR-573, MAR-579).
 *
 * This replaces `BootstrapGap`, which described the circular gap without a way
 * out of it — a sentence that said "your fresh server has nothing to answer
 * DASH" and then left the person there. The script is fetched on demand rather
 * than held in the card, because it is DASH's own public key and the helper's
 * bytes composed at request time: nothing about it is worth persisting, and a
 * card that carried it would be carrying it for every server whether or not this
 * one needs it.
 *
 * The disclosure copy comes from `describeSetupStep`, the same function the
 * wizard's key step uses, so the two surfaces cannot drift on what the snippet
 * promises.
 */
function SetupPanel({
  label,
  busy,
  canAct,
  fetchScript,
}: {
  label: string;
  busy: boolean;
  canAct: boolean;
  fetchScript: () => Promise<string | null>;
}): ReactNode {
  const [script, setScript] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const copy = describeSetupStep(label);
  return (
    <section className="setup-panel">
      <p className="wrap">
        <strong>{copy.headline}</strong>
      </p>
      <p className="wrap">{copy.detail}</p>
      {script === null ? (
        <button
          type="button"
          className="button-secondary"
          disabled={busy || loading || !canAct}
          onClick={() => {
            setLoading(true);
            void fetchScript().then((text) => {
              setLoading(false);
              if (text !== null) {
                setScript(text);
              }
            });
          }}
        >
          {loading ? "Writing the setup text..." : "Show the setup text"}
        </button>
      ) : (
        <>
          <p className="disclosure wrap" role="note">
            {copy.disclosure}
          </p>
          <pre className="setup-script">{script}</pre>
          <p className="next-action wrap">{copy.next_action}</p>
        </>
      )}
    </section>
  );
}

/**
 * Disconnecting, and the half of it that is easy to imply falsely.
 *
 * `describeDisconnect` is imported through the standing module rather than
 * reworded here: what it says — that anything already running on that server
 * keeps running and DASH can neither stop it nor show it — is a statement about
 * somebody's machine that a renderer must not be able to drop.
 */
function ForgetConfirmation({
  label,
  busy,
  onKeep,
  onForget,
}: {
  label: string;
  busy: boolean;
  onKeep: () => void;
  onForget: () => void;
}): ReactNode {
  const copy = describeDisconnect(label);
  return (
    <section className="notice wrap" role="alert">
      <p>
        <strong>{copy.headline}</strong>
      </p>
      <p>{copy.detail}</p>
      <div className="button-row">
        <button type="button" className="button-secondary" disabled={busy} onClick={onKeep}>
          Keep using it
        </button>
        <button type="button" className="button-primary" disabled={busy} onClick={onForget}>
          {busy ? "Disconnecting..." : "Disconnect"}
        </button>
      </div>
    </section>
  );
}
