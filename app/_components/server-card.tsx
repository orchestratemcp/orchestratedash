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
  primaryServerAction,
  serverCardState,
  standingChip,
} from "../../lib/server-card";
import { agentStageHref } from "../_data/routes";
import { describeSetupRecipe, describeSetupStep } from "../../lib/host-wizard";
import {
  describeWhatIsOnHost,
  summariseWhatIsOnHost,
  type AgentHostStanding,
} from "../../lib/host-sighting";
import { describeBringHome } from "../../lib/copy/bring-home";
import {
  HOST_READY_AND_EMPTY,
  describeForgettingWithKeys,
  describeKeyPlacementFrame,
  describeOrphanedKeys,
  describePlacedKey,
} from "../../lib/copy/host-pack";
import { standingForPlacements } from "../../lib/deploy/key-placement";
import type { HostServiceReport } from "../../lib/deploy/service-unit";
import {
  RESIDENCY_COPY,
  describeResidency,
  describeResidencyRemoval,
  describeSchedulesTold,
} from "../../lib/copy/host-residency";
import type { AgentDeployChoice, KeyOfferView, SavedServerView } from "../../lib/views/types";

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
 *
 * ## MAR-871: one card, one state, one primary action
 *
 * The order above survived; the *quantity* did not. An attended run against a
 * real VPS on 2026-09-05 found a card that offered five controls at once — check
 * this server, ask the server, turn on, put an agent here, stop using this
 * server — with two of them (check, ask) both meaning "sign in and find out",
 * and one of them (put an agent here) expanding a list whose own text said the
 * thing you had just pressed happens somewhere else. Henrik's report of that
 * screen is that he could not tell what state his server was in or what he was
 * meant to press, which is the correct reading of a surface where every state
 * draws the same five buttons.
 *
 * So `serverCardState` folds the fifteen diagnoses into the seven situations a
 * *card* has to behave differently in, and `primaryServerAction` names the one
 * control each of them gets. Everything a person may still want — the setup
 * text for a server that is already set up, putting a second agent on a machine
 * that has one, disconnecting — moves into one overflow rather than being
 * deleted, because unfindable is the same as missing and this card has already
 * paid for learning that once.
 *
 * The sentences are unchanged and still come from `describeConnectState`. This
 * decides what the card *does* about a state, never what it says about one:
 * MAR-605's whole argument is that two places deciding one fact is how a chip
 * comes to contradict the paragraph under it, and a second set of state
 * sentences here would be that mistake with more words.
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
  /**
   * Put one key DASH holds on this server, for one agent copy (MAR-794, ADR 0018).
   *
   * Called only after `KeyPlacementCeremony` has been read and its affirmative
   * button pressed — the same shape `bringHome` has for its own confirmation,
   * and for a stronger reason: this is the one press on this card whose
   * consequence nothing in this product can undo.
   *
   * The fingerprint the frame displayed travels with it, so main can refuse when
   * the record has been re-pinned since. There is no key in this signature and
   * nowhere for one: the renderer has never held the value.
   */
  installKey(offer: { agent: string; connection_id: string; fingerprint: string }): void;
  /**
   * Turn it on, or off (MAR-795, ADR 0031).
   *
   * Answers with what the server said afterwards, never with what was asked —
   * ADR 0030 decision 2's rule about reading the system's own off state, so a
   * press that half-worked draws the half that is true.
   *
   * `readResidency` used to sit beside this and had its own button on the card.
   * MAR-871 removed both: reading the boot entry is part of what one **Check
   * now** does, so the page asks for it there and hands the answer down as
   * `residency` below. Two controls that both mean "sign in and find out" were
   * two controls a person had to tell apart before pressing either.
   */
  setResidency(on: boolean): Promise<HostServiceReport | null>;
}

export function ServerCard({
  server,
  standing,
  checkedAt,
  residency,
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
  /**
   * What the server itself last said about restarting, or null (MAR-871).
   *
   * Held by the page rather than by the restart section, because the one
   * **Check now** on this card is what asks for it — the section had its own
   * **Ask the server** button and its own state, which made two refreshes out
   * of one question. Null is the honest opening value and stays null for every
   * server DASH has not signed in to this session.
   */
  residency: HostServiceReport | null;
  /** Every agent in this DASH, with whether it can be sent. Empty is a real state. */
  agents: readonly AgentDeployChoice[];
  busy: boolean;
  /** Whatever the last command said when it failed. Null when nothing did. */
  notice: string | null;
  actions: ServerCardActions;
  canAct: boolean;
}): ReactNode {
  const [confirmForget, setConfirmForget] = useState(false);
  const [choosing, setChoosing] = useState(false);
  /**
   * Whether the setup recipe is open (MAR-871).
   *
   * The primary control of a server that is not set up opens it, rather than
   * fetching a snippet and dropping it on the page. The five steps are what a
   * person who has never signed in to a server needs *around* the snippet.
   */
  const [settingUp, setSettingUp] = useState(false);
  /**
   * The agent id a bring-home is being confirmed for, or null (MAR-611,
   * ADR 0017). One at a time, the same shape `confirmForget` already uses for
   * the card's other irreversible action.
   */
  const [confirmBringHome, setConfirmBringHome] = useState<string | null>(null);
  /**
   * The key placement being consented to, or null (MAR-794, ADR 0018).
   *
   * One at a time, like `confirmBringHome` beside it, and here the rule is
   * ADR 0018's rather than the card's: *"A second key or a second host is a
   * second ceremony."* Two frames open at once would be one press away from
   * being one ceremony for two keys.
   */
  const [placing, setPlacing] = useState<KeyOfferView | null>(null);

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

  /* MAR-871. What this card is for, and the one control it gets. */
  const cardState = serverCardState(standing);
  const primary = primaryServerAction(standing);
  /*
   * The next action, except where the primary control already *is* it.
   *
   * The rule the shipped card had for one state, applied to the four it is true
   * of: "Check this server" printed immediately above a control reading CHECK
   * NOW is noise, and noise directly above the thing a person is meant to press
   * is the worst place to put it. `in_use` has no next action of its own and
   * the unreachable states' next actions are guidance — install the tools,
   * check the address — which is not what the button does, so it stays.
   */
  const sayNextAction =
    copy.next_action !== null &&
    cardState !== "never_checked" &&
    cardState !== "up" &&
    cardState !== "needs_your_ok" &&
    cardState !== "not_set_up";
  /*
   * The only agent that could go here, when there is exactly one.
   *
   * MAR-871, and it is the whole of the D8 fix on the common path: a DASH with
   * one sendable agent has one destination, so **Put an agent here** goes
   * straight to it rather than opening a list of one for somebody to press
   * again. With none or several, the list is the choice and the control opens
   * it.
   */
  const sendable = agents.filter((agent) => agent.deploy.deployable);
  const onlyOne = sendable.length === 1 && canAct ? sendable[0] : undefined;
  /*
   * The restart section renders where it can say something true and actionable,
   * which is a server that named at least one agent. Asking a machine with no
   * runner on it what it does at boot is a question the helper answers with a
   * refusal, and a section that drew the refusal would be a warning about a
   * server that is fine.
   */
  const showResidency = cardState === "in_use";
  /* Same rule: the keys section says nothing worth a heading until there is a
     placement to name or an offer to press. */
  const showKeys = server.placed_keys.length > 0 || server.key_offers.length > 0;

  /*
   * Built once and rendered in one of two places (MAR-871).
   *
   * A card that is not set up opens the recipe from its primary control, so the
   * recipe belongs under it; every other card offers the same recipe from the
   * overflow, because the attended run's own finding is that an already-enrolled
   * server had **no route back to the setup text at all** — the only way to see
   * it again was to start enrolling a second record for the same machine, which
   * lands straight in the duplicate this page apologises for. Same for the
   * chooser. Composed here so the two placements cannot drift into two panels.
   */
  const setupPanel = (
    <SetupPanel
      server={server}
      busy={busy}
      canAct={canAct}
      fetchScript={actions.setup}
      onCheck={actions.check}
    />
  );
  const chooser = <SendAnAgentHere server={server} agents={agents} canAct={canAct} />;

  return (
    <article className={`row-card server-card is-${cardState.replaceAll("_", "-")}`}>
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
      {/* See `sayNextAction` — the button is the instruction wherever it can be. */}
      {sayNextAction ? <p className="next-action wrap">{copy.next_action}</p> : null}

      <p className="card-meta wrap">
        {describeSignIn(server)}. {describeAdded(server.added_at)}.
      </p>

      {/*
        What is on the server, when there is anything to say about it. An
        unchecked card's standing already says DASH has not looked, and a second
        sentence saying the same thing in different words — five times down a
        list — is the wall of text this page is trying not to be.

        MAR-871 added `up` to the states that stay quiet, for the same reason
        one rung along: *"DASH signed in and found no agent runner there yet"*
        already IS the standing on that card, and a second line reading "the
        server answered and had no agent runner on it" underneath it was the
        same fact twice on the one state a new server spends its first day in.
      */}
      {cardState === "never_checked" || cardState === "up" ? null : (
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
      {contents.length === 0 || cardState === "checking" ? null : (
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
        MAR-794, ADR 0018. What this server holds of yours, and the one press
        that puts something there.

        Below what is on the server and above the identity, which is the order a
        person reads the card in: an agent has to be here before a key can be
        placed for it, and the identity is the thing the ceremony below quotes.

        MAR-871 gated it on having something to say. The section used to draw a
        heading and *"this server is ready and holding nothing of yours"* on
        every card in DASH, including on a machine nobody has checked, where it
        is a heading announcing a feature the reader has not used —
        `FleetConnectors`' call and `ModelDefault`'s, one page over.
      */}
      {showKeys ? (
        <KeysOnThisServer
          server={server}
          standing={standing}
          busy={busy}
          canAct={canAct}
          onPlace={setPlacing}
        />
      ) : null}

      {/*
        MAR-795, ADR 0031. What this server does when it restarts.

        Below the keys and above the identity, which is the order the card is
        read in: an agent has to be here before there is anything to start, a key
        is what it needs to think, and this is what happens to both of them when
        nobody is watching.

        MAR-871: and only where there is an agent, which is what makes those
        sentences true. On a server with no runner the boot question has no
        subject, and the helper answers it with a refusal.
      */}
      {showResidency ? (
        <ResidencyOnThisServer
          server={server}
          report={residency}
          busy={busy}
          canAct={canAct}
          onSet={actions.setResidency}
        />
      ) : null}

      {placing === null ? null : (
        <KeyPlacementCeremony
          server={server}
          offer={placing}
          busy={busy}
          onKeep={() => {
            setPlacing(null);
          }}
          onConfirm={() => {
            /*
             * The fingerprint the frame displayed, carried back verbatim — the
             * shape `trust` uses. An unpinned record sends the empty string and
             * main refuses it, which is the correct outcome: ADR 0018 puts the
             * confirmed identity on the frame, and a record with none has not
             * had one confirmed.
             */
            actions.installKey({
              agent: placing.agent,
              connection_id: placing.connection_id,
              fingerprint: server.fingerprint ?? "",
            });
            setPlacing(null);
          }}
        />
      )}

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
        below carries a decision they have actually made rather than a blind yes.
      */}
      {cardState === "needs_your_ok" && standing.step === "confirm_host_key" ? (
        <pre className="public-key">{standing.fingerprint}</pre>
      ) : null}

      {/*
        The recipe, opened by the primary control (MAR-573, MAR-579, MAR-871).

        The snippet has been reachable since MAR-579 and the attended run still
        could not get past it: what was missing was everything *around* the
        snippet — which program to open on this computer, the line that signs
        you in to your own machine, and whose password the server will ask for.
        So the control opens five numbered steps with the snippet as step four,
        rather than a button that fetches a wall of shell script.
      */}
      {settingUp && cardState === "not_set_up" ? setupPanel : null}

      {/*
        One control, and it is the one this state is for (MAR-871).

        `probing` gets a disabled control saying what is happening rather than
        an empty row: the brief's rule is that nothing moves without saying it
        did, and a card that lost its button mid-check reads as one that broke.
      */}
      <div className="button-row">
        {primary === null ? (
          cardState === "checking" ? (
            <button type="button" className="button-primary" disabled>
              Checking...
            </button>
          ) : null
        ) : primary.kind === "put_agent" && onlyOne !== undefined ? (
          /*
           * One sendable agent, one destination. The press lands on the step
           * that sends it rather than on a list of one.
           */
          <Link className="button-primary" href={agentStageHref(onlyOne.name, "settings")}>
            {primary.label}
          </Link>
        ) : (
          <button
            type="button"
            className="button-primary"
            disabled={busy || !canAct}
            aria-expanded={
              primary.kind === "put_agent" ? choosing : primary.kind === "setup" ? settingUp : undefined
            }
            onClick={() => {
              switch (primary.kind) {
                case "check":
                  actions.check();
                  return;
                case "confirm":
                  if (standing.step === "confirm_host_key") {
                    actions.trust(standing.fingerprint);
                  }
                  return;
                case "setup":
                  setSettingUp((open) => !open);
                  return;
                case "put_agent":
                  setChoosing((open) => !open);
                  return;
              }
            }}
          >
            {busy && primary.kind === "confirm" ? "Confirming..." : primary.label}
          </button>
        )}
      </div>

      {/*
        MAR-642. The list of destinations, opened by the control above.
        `SendAnAgentHere` argues the demotion; what matters here is that the
        control kept its word — "put an agent here" still leads to putting an
        agent here, one press further on, on the page where that agent's own
        settings already are.
      */}
      {choosing && cardState === "up" ? chooser : null}

      {/*
        Everything else, once (MAR-871).
        `MoreAboutThisServer` argues why these are behind one summary.
      */}
      <MoreAboutThisServer
        pin={pin}
        fingerprint={server.fingerprint}
        busy={busy}
        canAct={canAct}
        /*
         * Not offered twice. Where the primary control already opens one of
         * these, the overflow does not repeat it — an overflow mirroring the
         * button above it is a second place to press for one act.
         */
        setUp={
          cardState === "not_set_up"
            ? null
            : {
                open: settingUp,
                panel: setupPanel,
                onToggle: () => {
                  setSettingUp((open) => !open);
                },
              }
        }
        putAgent={
          cardState === "up"
            ? null
            : {
                open: choosing,
                panel: chooser,
                onToggle: () => {
                  setChoosing((open) => !open);
                },
              }
        }
        onForget={() => {
          setConfirmForget(true);
        }}
      />

      {confirmForget ? (
        <ForgetConfirmation
          label={server.label}
          /*
           * MAR-794, ADR 0018. The unresolved-custody warning, said at the last
           * moment it can be true.
           *
           * ADR 0018 asks the forget flow to preserve it *after* the act; ADR
           * 0010 forbids the row that would carry it, because a record that
           * outlived the label could only render as a claim about a machine DASH
           * can no longer name. So it is said here instead — while the server
           * still has a name to put in the sentence and while the person can
           * still change their mind. ADR 0018 amendment 1 records the split.
           */
          placedKeys={server.placed_keys.length}
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
 * Everything that is not this card's one question (MAR-871).
 *
 * ## Why an overflow and not a deletion
 *
 * Four controls came off the face of this card and none of them stopped being
 * useful. A person with a working server still wants the setup text — the
 * attended run found there was **no route back to it at all** once a server was
 * enrolled, so the only way to read it again was to start adding the same
 * machine twice — still wants to put a second agent on a machine that has one,
 * and still wants to stop using it. Unfindable is the same as missing, and this
 * page has already paid once for learning that.
 *
 * So they are one summary line rather than four buttons competing with the one
 * the state is about. A closed disclosure is a control a person can see and
 * ignore, which is what "one primary action" means in practice.
 *
 * ## Why the identity is here now
 *
 * MAR-572's pin is a fact about which machine this is and every real record
 * still has none. It was its own disclosure on the face of the card, which put
 * a second summary line beside this one saying almost the same thing. It is
 * unchanged and one level in.
 *
 * `setUp` and `putAgent` are null where the card's own primary control already
 * opens them, so nothing is offered from two places at once.
 */
function MoreAboutThisServer({
  pin,
  fingerprint,
  busy,
  canAct,
  setUp,
  putAgent,
  onForget,
}: {
  pin: { headline: string; detail: string };
  fingerprint: string | null;
  busy: boolean;
  canAct: boolean;
  setUp: { open: boolean; panel: ReactNode; onToggle: () => void } | null;
  putAgent: { open: boolean; panel: ReactNode; onToggle: () => void } | null;
  onForget: () => void;
}): ReactNode {
  return (
    <details className="card-more server-more">
      <summary>More about this server</summary>

      {putAgent === null ? null : (
        <>
          <div className="button-row">
            <button
              type="button"
              className="button-secondary"
              disabled={busy || !canAct}
              aria-expanded={putAgent.open}
              onClick={putAgent.onToggle}
            >
              Put an agent here
            </button>
          </div>
          {putAgent.open ? putAgent.panel : null}
        </>
      )}

      {setUp === null ? null : (
        <>
          <div className="button-row">
            <button
              type="button"
              className="button-secondary"
              disabled={busy || !canAct}
              aria-expanded={setUp.open}
              onClick={setUp.onToggle}
            >
              Set up this server again
            </button>
          </div>
          {setUp.open ? setUp.panel : null}
        </>
      )}

      {/*
        MAR-572, rendered rather than hidden. Every real record has a null
        fingerprint, so this is the branch a person actually sees, and it is the
        one fact about *which machine this is* — the question the whole
        strict-host-key arrangement exists to answer and cannot yet.
      */}
      <section className="card-section">
        <h4>This server&rsquo;s identity</h4>
        <p className="wrap">
          <strong>{pin.headline}</strong>
        </p>
        <p className="wrap">{pin.detail}</p>
        {fingerprint === null ? null : <pre className="public-key">{fingerprint}</pre>}
      </section>

      <div className="button-row">
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !canAct}
          onClick={onForget}
        >
          Stop using this server
        </button>
      </div>
    </details>
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
  /*
   * Which display names are shared (MAR-871, D4).
   *
   * The attended run found **Meeting Assistant** listed twice with two
   * different refusal reasons, because two store rows carry a null display name
   * and both resolve to the same title from their manifests. The list rendered
   * no other fact, so the two were indistinguishable — and a person asked to
   * choose between two identical rows with contradictory explanations has been
   * asked an unanswerable question.
   *
   * The id is the fact that tells them apart and it is drawn the way this
   * codebase already draws an id: as a value, in its own element, never inside
   * a sentence — the rule the fingerprint and the public key are under, and
   * `WhatIsOnThisServer` next door does the same. Only where it is needed, so
   * MAR-589's ruling — a surface prints the name a person chose — still holds
   * everywhere it can.
   */
  const shared = new Map<string, number>();
  for (const agent of agents) {
    shared.set(agent.title, (shared.get(agent.title) ?? 0) + 1);
  }

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
                  {(shared.get(agent.title) ?? 0) > 1 ? (
                    <code className="send-here-id">{agent.name}</code>
                  ) : null}
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
                      Put it here
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
                  /*
                   * Two blocks, not one line (MAR-871, D4). The refusal's
                   * headline carries no full stop — `describeUndeployable`
                   * ends it on a noun so a caller may punctuate it — and the
                   * shipped row ran the two together into *"Meeting Assistant
                   * cannot be put on a server DASH cannot read what it saved"*.
                   * Separating them is a renderer's job; rewording the sentence
                   * would be reaching into `lib/deploy/deploying.ts` to fix a
                   * layout fault.
                   */
                  <span className="wrap muted send-here-refusal">
                    <strong>{refusal.headline}.</strong>
                    <span className="wrap">{refusal.detail}</span>
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
  server,
  busy,
  canAct,
  fetchScript,
  onCheck,
}: {
  server: SavedServerView;
  busy: boolean;
  canAct: boolean;
  fetchScript: () => Promise<string | null>;
  /** The card's one refresh, offered as the last step rather than named only. */
  onCheck: () => void;
}): ReactNode {
  const [script, setScript] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const copy = describeSetupStep(server.label);
  const recipe = describeSetupRecipe(server);
  return (
    <section className="setup-panel">
      <p className="wrap">
        <strong>{recipe.headline}</strong>
      </p>
      <p className="wrap">{copy.detail}</p>
      <p className="disclosure wrap" role="note">
        {copy.disclosure}
      </p>

      <ol className="setup-steps">
        {recipe.steps.map((step, index) => (
          <li key={step.text} className="setup-step">
            <span className="wrap">{step.text}</span>
            {step.command === null ? null : <CopyableText text={step.command} what="the line" />}
            {/*
              The snippet is step four's material and sits inside step four, not
              under the list. A person following numbered steps should not have
              to look elsewhere for the thing the step names.
            */}
            {index === 3 ? (
              script === null ? (
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
                <CopyableText text={script} what="the setup text" block />
              )
            ) : null}
            {/*
              And the last step is the control it names. The recipe's own final
              instruction is to come back and press Check now, so it is here —
              the alternative is a sentence pointing at a button somewhere else
              on a card the reader has scrolled away from.
            */}
            {index === recipe.steps.length - 1 ? (
              <button
                type="button"
                className="button-secondary"
                disabled={busy || !canAct}
                onClick={onCheck}
              >
                Check now
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A value, with a way to get it onto the clipboard (MAR-871).
 *
 * ## Why this is not a bridge method
 *
 * `electron/preload.ts` exposes no clipboard and does not need to: the value
 * here is already in the document, and copying it is the browser's own act on
 * text the person can see. Adding a main-process route would be adding an
 * audited command whose whole payload is a string the renderer composed.
 *
 * ## Why there are two attempts and a spoken failure
 *
 * `navigator.clipboard` is gated on a secure context, and DASH's pages are
 * served over a custom scheme in the packaged app and over loopback on the
 * developer path — so the modern route is the one to try and not the one to
 * rely on. The old selection route works in both. If neither does, the button
 * says so and the text is still on screen to select by hand, because a control
 * that silently did nothing is the failure this whole product is written
 * against — see `NoServerYet`, where a dead link is deliberately a sentence.
 */
function CopyableText({
  text,
  what,
  block = false,
}: {
  text: string;
  /** What the button is copying, for its own label. Two or three words. */
  what: string;
  /** True for a multi-line snippet, which gets the scrolling frame. */
  block?: boolean;
}): ReactNode {
  const [said, setSaid] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <span className="copyable">
      <pre className={block ? "setup-script" : "setup-line"}>{text}</pre>
      <button
        type="button"
        className="button-secondary"
        onClick={() => {
          void copyToClipboard(text).then((ok) => {
            setSaid(ok ? "copied" : "failed");
          });
        }}
      >
        {said === "copied"
          ? "Copied"
          : said === "failed"
            ? "Select it and copy"
            : `Copy ${what}`}
      </button>
    </span>
  );
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Falls through to the selection route below, which works without a secure
    // context. A refusal here is a permission answer, not a bug to report.
  }
  try {
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "");
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    document.body.appendChild(holder);
    holder.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(holder);
    return copied;
  } catch {
    return false;
  }
}

/**
 * Disconnecting, and the half of it that is easy to imply falsely.
 *
 * `describeDisconnect` is imported through the standing module rather than
 * reworded here: what it says — that anything already running on that server
 * keeps running and DASH can neither stop it nor show it — is a statement about
 * somebody's machine that a renderer must not be able to drop.
 */

/* ---------------------------------------------------------------------- *
 * Keys on this server (MAR-794, ADR 0018)
 * ---------------------------------------------------------------------- */

/**
 * What this server holds of yours, and what it could be given.
 *
 * Exported so a render test can drive it without a click, for
 * `WhatIsOnThisServer`'s reason and a sharper one: the custody sentences here
 * are the load-bearing part of a decision that cannot be undone, and a sentence
 * that disappeared when somebody tidied a component would take the disclosure
 * with it.
 *
 * ## The three states, and there is no fourth
 *
 * - **This server cannot run a broker yet** — the shipped `host_pack_too_old`
 *   sentence, whose exit is the setup control already on this card. Nothing is
 *   offered, because a key placed there could not be used.
 * - **Ready, and holding nothing of yours** — `HOST_READY_AND_EMPTY`, said out
 *   loud rather than left blank.
 * - **Holding these** — one line per placement, each with the moment DASH
 *   proved it, plus the orphan line when the server's own last answer says a
 *   placement has lost the agent it was for.
 *
 * A fourth state — the chief answering from this machine — is what ADR 0028's
 * host half will add, and it is not written here as an empty branch.
 */
export function KeysOnThisServer({
  server,
  standing,
  busy,
  canAct,
  onPlace,
}: {
  server: SavedServerView;
  standing: HostConnectState;
  busy: boolean;
  canAct: boolean;
  onPlace: (offer: KeyOfferView) => void;
}): ReactNode {
  /*
   * The host's own account of what is installed, or null when nothing has
   * asked. Null and empty are different claims — `standingForPlacements` treats
   * null as "nothing is orphaned" rather than "everything is", which is the same
   * distinction `describeWhatIsOnHost` draws one section up.
   */
  const installed =
    standing.step === "reachable" ? standing.agents_there.map((one) => one.agent_id) : null;
  const standings = standingForPlacements(
    server.placed_keys.map((key) => ({
      host_id: server.host_id,
      bundle_id: key.agent,
      connection_id: key.connection_id,
      field_id: "",
      placed_at: key.placed_at,
    })),
    installed,
  );
  const orphans = standings.filter((one) => one.orphaned).length;

  return (
    <section className="card-section">
      <h4>Keys on this server</h4>
      {server.placed_keys.length === 0 ? (
        <p className="wrap muted">{HOST_READY_AND_EMPTY}</p>
      ) : (
        <ul className="plain-list">
          {server.placed_keys.map((key) => (
            <li key={`${key.agent} ${key.connection_id}`} className="wrap">
              {describePlacedKey(key.service, key.agent, key.placed_on ?? "a date DASH cannot read")}
            </li>
          ))}
        </ul>
      )}
      {orphans === 0 ? null : (
        <p className="notice notice-warn wrap" role="status">
          {describeOrphanedKeys(orphans)}
        </p>
      )}
      {server.key_offers.length === 0 ? null : (
        <div className="button-row">
          {server.key_offers.map((offer) => (
            <button
              key={`${offer.agent} ${offer.connection_id}`}
              type="button"
              className="button-secondary"
              disabled={busy || !canAct}
              onClick={() => {
                onPlace(offer);
              }}
            >
              {offer.already_placed
                ? `Replace ${offer.service}`
                : `Put ${offer.service} here`}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The consent ceremony, before a byte moves (ADR 0018).
 *
 * ## Why the confirm press is not available until the frame is complete
 *
 * ADR 0018 rule 1: *"The confirm press is unavailable until all three are on
 * screen"* — the key, the server and the agent — *"together with this
 * sentence"*. The frame is one object built by one function
 * (`describeKeyPlacementFrame`), so the four facts arrive together or not at
 * all; there is no arrangement of this component that renders three of them.
 *
 * ## The action names the movement
 *
 * *"'Continue' and 'Allow' hide the consequence and are not admitted."* The
 * label is `describeKeyPlacementAction`, which is built from the server's own
 * displayed name. The other button says what it does too — keeping the key at
 * home is the outcome of not pressing, and a button that said "Cancel" would
 * describe the dialog rather than the decision.
 *
 * ## An unconfirmed identity is shown and not hidden
 *
 * Every real record has a null fingerprint today (MAR-572), and the frame says
 * so rather than omitting the line. Main refuses the press in that state — a key
 * does not cross to a machine nobody has identified — and a person reading the
 * frame should be able to see why before they press, not after.
 */
export function KeyPlacementCeremony({
  server,
  offer,
  busy,
  onKeep,
  onConfirm,
}: {
  server: SavedServerView;
  offer: KeyOfferView;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}): ReactNode {
  const frame = describeKeyPlacementFrame({
    keyLabel: offer.service,
    serverLabel: server.label,
    address: server.address,
    fingerprint: server.fingerprint,
    agentName: offer.agent,
    need: offer.need,
  });
  return (
    <section className="notice wrap" role="alert">
      <p>
        <strong>{frame.headline}</strong>
      </p>
      <p>{frame.key}</p>
      <p>{frame.server}</p>
      <p>{frame.agent}</p>
      <p>
        <strong>{frame.custody}</strong>
      </p>
      <p>{frame.scope}</p>
      <div className="button-row">
        <button type="button" className="button-secondary" disabled={busy} onClick={onKeep}>
          Keep it here
        </button>
        <button type="button" className="button-primary" disabled={busy} onClick={onConfirm}>
          {busy ? "Sending..." : frame.action}
        </button>
      </div>
    </section>
  );
}

function ForgetConfirmation({
  label,
  placedKeys,
  busy,
  onKeep,
  onForget,
}: {
  label: string;
  /** How many keys DASH has placed there and cannot take back (MAR-794). */
  placedKeys: number;
  busy: boolean;
  onKeep: () => void;
  onForget: () => void;
}): ReactNode {
  const copy = describeDisconnect(label);
  const custody = describeForgettingWithKeys(placedKeys, label);
  return (
    <section className="notice wrap" role="alert">
      <p>
        <strong>{copy.headline}</strong>
      </p>
      <p>{copy.detail}</p>
      {custody === null ? null : (
        <p>
          <strong>{custody}</strong>
        </p>
      )}
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

/**
 * What this server does when it restarts, and the one switch that changes it
 * (MAR-795, ADR 0031).
 *
 * ## Why the live state is fetched on a press rather than on render
 *
 * Asking costs an `ssh` round trip to somebody's server. A section that asked on
 * mount would reach every enrolled machine every time this page opened, which is
 * the polling ADR 0015 refuses and `lib/views/build.ts` refuses one function
 * over. So the card opens showing what DASH knows about its **own** acts —
 * whether this person turned it on, and when DASH last told the server anything
 * — and the server's own answer arrives when somebody asks for it.
 *
 * That split is the section's whole honesty. DASH's record can say *you turned
 * this on*; only the server can say *and it is still switched on here*, and
 * those two are drawn as two sentences rather than merged into one claim.
 *
 * ## Why the switch is one switch
 *
 * There is one runner per agent copy on the server and therefore one boot entry
 * each, but *"does this server come back by itself"* is one question. The
 * `service` verb reduces them — see `hostServiceReduction`, which under-claims
 * on purpose — and the press applies to all of them, so the control matches the
 * sentence beside it.
 */
export function ResidencyOnThisServer({
  server,
  report,
  busy,
  canAct,
  onSet,
}: {
  server: SavedServerView;
  /**
   * What the server itself last said, or null (MAR-871).
   *
   * Handed down rather than fetched here. The section used to own a **Ask the
   * server** button and this state, which put a second refresh on a card that
   * already had one — and asked a person to know which of the two signs in for
   * the standing and which signs in for the boot entry. One **Check now** does
   * both, and this is its second half arriving.
   */
  report: HostServiceReport | null;
  busy: boolean;
  canAct: boolean;
  onSet: (on: boolean) => Promise<HostServiceReport | null>;
}): ReactNode {
  /** What the *press* got back, which supersedes the check's answer. */
  const [pressed, setPressed] = useState<HostServiceReport | null>(null);
  const [asking, setAsking] = useState(false);
  /** True once a press came back with nothing, so the card can say so. */
  const [unreachable, setUnreachable] = useState(false);

  const asked = server.residency.asked_on !== null;
  const said = pressed ?? report;
  const live = said === null ? null : describeResidency(said.state, said.starts_at_boot);

  return (
    <section className="card-section residency-section">
      <h4>{RESIDENCY_COPY.heading}</h4>

      {/*
        One switch, and one sentence beside it (MAR-871).

        The sentence is the **server's own answer** wherever there is one, never
        an inference from the switch: a person can turn this on here and somebody
        can switch it off on the machine itself, and DASH's record would go on
        saying on. Until a check has asked, the section says exactly that rather
        than drawing DASH's record as if it were the machine's.
      */}
      <div className="residency-switch">
        <p className="wrap">
          <strong>{live === null ? RESIDENCY_COPY.toggle.label : live.headline}</strong>
        </p>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || asking || !canAct}
          onClick={() => {
            setAsking(true);
            void onSet(!asked).then((answer) => {
              setAsking(false);
              setUnreachable(answer === null);
              if (answer !== null) {
                setPressed(answer);
              }
            });
          }}
        >
          {asking ? "Asking..." : asked ? RESIDENCY_COPY.toggle_off : RESIDENCY_COPY.toggle_on}
        </button>
      </div>

      <p className="wrap">
        {live === null ? (asked ? RESIDENCY_COPY.not_asked : RESIDENCY_COPY.opt_in) : live.detail}
      </p>
      {/*
        What the switch is for, while there is no answer from the machine to put
        in its place. Once the server has spoken, its own account is the sentence
        and this one would be a second, weaker version of it.
      */}
      {live === null ? <p className="card-meta wrap">{RESIDENCY_COPY.toggle.detail}</p> : null}

      {unreachable ? (
        <p className="notice notice-warn wrap" role="status">
          DASH could not reach this server, so it cannot say what it does when it restarts.
        </p>
      ) : null}

      {/*
        Everything else this feature owes its reader, one level in (MAR-871).

        ADR 0030's rules are unchanged and every sentence they require is still
        rendered: both states described, the missed-window sentence, the sentence
        saying a run that starts this way cannot reach a model, the three things
        this switch does not do, and the two lines an operator types on the
        server to undo it with DASH gone. What changed is that they are behind a
        summary instead of nine lines between the switch and the next section —
        a card where every sentence is equally loud is a card where the one that
        matters is not.
      */}
      <details className="card-more">
        <summary>What this does, and what it does not</summary>
        <ul className="plain-list">
          {(asked ? RESIDENCY_COPY.liveness_on : RESIDENCY_COPY.liveness_off).map((line) => (
            <li key={line} className="wrap">
              {line}
            </li>
          ))}
          {RESIDENCY_COPY.not_this.map((line) => (
            <li key={line} className="wrap">
              {line}
            </li>
          ))}
        </ul>
        {/*
          MAR-795. When DASH last handed this server its scheduled times.

          Its own sentence rather than part of the standing above, because "when
          DASH last looked" and "when DASH last told it" are different facts, and
          a card that ran them together would let a fresh check imply a fresh
          instruction.
        */}
        <p className="card-meta wrap">
          {describeSchedulesTold(server.residency.told_count ?? 0, server.residency.told_on)}
        </p>
        {/*
          ADR 0030 decision 7's third answer, one machine over: somebody whose
          DASH is gone can still undo this from the server. Drawn only once the
          server has named its entries, because the lines are built from the
          names it gave — a card that guessed them would be handing out commands
          for files that may not exist.
        */}
        {said === null || said.units.length === 0 ? null : (
          <>
            <p className="wrap">
              <strong>{RESIDENCY_COPY.removal_label}</strong>
            </p>
            <p className="card-meta wrap">{RESIDENCY_COPY.removal_note}</p>
            {said.units.map((unit) => (
              <pre key={unit} className="setup-script">
                {describeResidencyRemoval(unit).join("\n")}
              </pre>
            ))}
          </>
        )}
      </details>
    </section>
  );
}
