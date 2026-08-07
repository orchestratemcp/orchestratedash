"use client";

import { useState, type ReactNode } from "react";

import {
  capabilityStandings,
  classifyProof,
  describeAccount,
  describeParties,
  describeProof,
  describeStanding,
  summariseUse,
  type StandingCapability,
} from "../../lib/connection-card";
import { plainMoment, plainWindow } from "../../lib/copy/when";
import type { Recovery } from "../../lib/copy/recovery";
import type { BrokerLapseView, ConnectionRowWithCredential } from "../../lib/views/types";
import { useCanAct } from "../_data/use-view";

/**
 * One connection, as a capability card (MAR-533).
 *
 * This replaces `connection-checklist.tsx`, and the replacement is not a
 * restyle. That component answered MAR-383's question — *"what does this agent
 * still need connecting?"* — by grouping rows under **who holds the credential**:
 * "Connect through DASH", "Kept with the agent", "Managed elsewhere". Three
 * headings of DASH's own taxonomy, above a list of things that are mostly
 * already connected.
 *
 * A card here answers the four questions somebody actually arrives with, in
 * order: what can this reach, on whose account, since when, and what has it
 * actually been used for. The receipt is one click away rather than three
 * scrolls down.
 *
 * ## What moved to the top, and why each one earned it
 *
 * - **The permission card is the card.** It used to render *below* the Connect
 *   and Disconnect buttons, as detail under an action. It is the content; the
 *   buttons are the detail.
 * - **The three-party intersection is drawn** rather than described. It has been
 *   true in `lib/broker/execute.ts` since MAR-458 and has never been on a
 *   screen.
 * - **The wider-permission sentence is a banner**, not a paragraph among
 *   paragraphs. MAR-469 made it required and nullable so a future write could not
 *   ship without answering it; a person still had to read past a capability list
 *   to find it.
 * - **What DASH cannot show you** is on every card, including the ones where the
 *   answer is "nothing, ever". That contrast is the page's whole lesson and the
 *   old grouping stated its *cause* (custody) while leaving its *consequence*
 *   unsaid.
 *
 * No secret is rendered, which is unchanged and load-bearing. The strongest
 * thing here is a masked hint produced by `maskSecret` when the value was
 * stored, read from a table that cannot hold a raw value. Nothing on this page
 * ever reaches the vault.
 */

/** What one command left behind, shown under the card that caused it. */
interface RowOutcome {
  ok: boolean;
  detail?: string;
  recovery?: Recovery;
}

export interface ConnectionAct {
  (
    action: "connect" | "test" | "disconnect",
    target: { connection_id: string; field_id: string },
  ): Promise<RowOutcome>;
}

/* ---------------------------------------------------------------------- *
 * Section furniture
 * ---------------------------------------------------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="capability-section">
      <h4 className="label-caps">{title}</h4>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------------- *
 * 1. What can this reach?
 * ---------------------------------------------------------------------- */

/**
 * @param explain Whether to print the standing's sentence under this row.
 *
 * False when the row above it stands in exactly the same place. The chip is on
 * every row and always says which of the four states this is; what is dropped is
 * the *explanation*, and only where it would be the same sentence twice running.
 *
 * The first draft printed it on all of them, and a three-action Gmail card before
 * a sign-in read as "The agent has asked for this and nobody has signed in yet,
 * so it cannot." three times in eleven lines. Repetition on this page is not
 * neutral: it is a card whose job is to be read, and a reader who learns that the
 * small grey line under each row never changes stops reading it — including on
 * the card where the third row says something different from the first two, which
 * is the partial-consent case this whole design exists to make visible.
 */
function StandingRow({
  capability,
  explain,
}: {
  capability: StandingCapability;
  explain: boolean;
}): ReactNode {
  const standing = describeStanding(capability.standing);
  return (
    <li className={`standing standing-${capability.standing}`}>
      <div className="standing-head">
        <span className="standing-label">{capability.label}</span>
        <span className="chips">
          {capability.access === "write" ? (
            <span className="chip chip-warn">changes something</span>
          ) : null}
          <span
            className={
              capability.standing === "allowed" ? "chip chip-ok" : "chip chip-muted"
            }
          >
            {standing.label}
          </span>
        </span>
      </div>
      {explain ? <p className="standing-meaning wrap">{standing.meaning}</p> : null}
      {/* MAR-469, kept exactly where it was and for its reason: a write's label
          is a verb phrase, and the sentence saying where the result ends up and
          who can act on it is what a person needs before approving. A
          consequence you have to hover to find is one that gets approved
          unread. */}
      {capability.consequence === null ? null : (
        <p className="standing-consequence wrap">{capability.consequence}</p>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------------- *
 * The three parties
 * ---------------------------------------------------------------------- */

function Parties({
  broker,
  service,
}: {
  broker: NonNullable<ConnectionRowWithCredential["broker"]>;
  service: string;
}): ReactNode {
  const { heading, parties, timing } = describeParties(broker, service);
  return (
    <Section title={heading}>
      <ul className="party-list">
        {parties.map((party) => (
          <li key={party.claim} className={party.holds ? "party is-true" : "party is-false"}>
            {/*
              The mark is `aria-hidden` and the state is carried in words beside
              it. A tick that means "true" only to somebody who can see it is the
              exact failure `aria-current` was kept for in the navigation — and
              here the fact being conveyed is whether an agent may touch
              somebody's mail.
            */}
            <span className="party-mark" aria-hidden="true">
              {party.holds ? "■" : "□"}
            </span>
            <span className="wrap">
              <span className="visually-hidden">{party.holds ? "Yes: " : "No: "}</span>
              {party.claim}
              {party.otherwise === null ? null : (
                <span className="party-otherwise"> — {party.otherwise}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="party-timing wrap">{timing}</p>
    </Section>
  );
}

/* ---------------------------------------------------------------------- *
 * The card
 * ---------------------------------------------------------------------- */

function ConnectionCard({
  row,
  act,
  canAct,
}: {
  row: ConnectionRowWithCredential;
  act: ConnectionAct | null;
  canAct: boolean;
}): ReactNode {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RowOutcome | null>(null);
  const [hint, setHint] = useState<string | null>(row.masked_hint);

  const connected = hint !== null;
  // A row is actionable only when the manifest says DASH may hold it, the
  // manifest named which field, and this window can cause an effect at all. The
  // browser development path fails the last one, which is what keeps it
  // read-only without the page having to know why.
  const actionable = row.dash_can_hold && row.field_id !== null && canAct && act !== null;
  const proof = classifyProof(row);
  const proofCopy = describeProof(proof, row.service);

  async function run(action: "connect" | "test" | "disconnect"): Promise<void> {
    if (act === null || row.field_id === null) {
      return;
    }
    setBusy(action);
    setOutcome(null);
    const result = await act(action, { connection_id: row.connection_id, field_id: row.field_id });
    setBusy(null);
    setOutcome(result);
    // Only a definite outcome moves the hint. A failed test leaves the card
    // saying what it said before, because a locked vault is not evidence the
    // credential is gone — telling the user it disappeared would send them to
    // find a key they never lost.
    if (result.ok && action === "disconnect") {
      setHint(null);
    }
  }

  return (
    <article className="row-card connection-card">
      <div className="card-head">
        <h3>{row.service}</h3>
        <span className="chips">
          {connected ? (
            <span className="chip chip-ok">
              connected <span className="value">{hint}</span>
            </span>
          ) : row.dash_can_hold ? (
            <span className="chip chip-muted">not connected yet</span>
          ) : (
            <span className="chip chip-muted">{proofCopy.label}</span>
          )}
        </span>
      </div>

      {/* Why this agent wants it, before anything about what it is. The user
          asked for a checklist, not an inventory — MAR-383's rule, kept. */}
      <p className="connection-purpose wrap">{row.purpose}</p>

      {/* The same three-part shape `ViewFailed` uses, and for the reason it
          states: a surface that shows two of headline/meaning/next action always
          drops the third, and the third is the one that helps. */}
      {outcome !== null ? (
        <div
          className={outcome.ok ? "notice notice-ok" : "notice notice-err"}
          role={outcome.ok ? undefined : "alert"}
        >
          {outcome.recovery !== undefined ? (
            <>
              <p>
                <strong>{outcome.recovery.headline}</strong>
              </p>
              <p>{outcome.recovery.meaning}</p>
              <p>{outcome.recovery.next_action}</p>
            </>
          ) : (
            <p>{outcome.detail}</p>
          )}
        </div>
      ) : null}

      {row.broker === null ? (
        <UnbrokeredBody row={row} proofCopy={proofCopy} />
      ) : (
        <BrokeredBody row={row} broker={row.broker} />
      )}

      {actionable ? (
        <div className="button-row">
          <button
            type="button"
            className={connected ? "button-secondary" : "button-primary"}
            disabled={busy !== null}
            onClick={() => void run("connect")}
          >
            {/* A sign-in and a typed key are different acts, and the button
                should say which one is about to happen — "Connect" on a row that
                opens a browser gives no warning that the user is about to leave
                DASH (MAR-446). */}
            {busy === "connect"
              ? "Waiting…"
              : row.credential_kind === "oauth"
                ? connected
                  ? "Sign in again"
                  : "Sign in"
                : connected
                  ? "Replace"
                  : "Connect"}
          </button>
          {connected ? (
            <>
              <button
                type="button"
                className="button-secondary"
                disabled={busy !== null}
                onClick={() => void run("test")}
              >
                {busy === "test" ? "Checking…" : "Check"}
              </button>
              <button
                type="button"
                className="button-danger"
                disabled={busy !== null}
                onClick={() => void run("disconnect")}
              >
                {busy === "disconnect" ? "Removing…" : "Disconnect"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/* ---------------------------------------------------------------------- *
 * The brokered body — the four questions, in order
 * ---------------------------------------------------------------------- */

function BrokeredBody({
  row,
  broker,
}: {
  row: ConnectionRowWithCredential;
  broker: NonNullable<ConnectionRowWithCredential["broker"]>;
}): ReactNode {
  const standings = capabilityStandings(broker);
  const account = describeAccount(broker);
  const use = summariseUse(broker);

  return (
    <>
      <Section title="What it can reach">
        <ul className="standing-list">
          {standings.map((capability, at) => (
            <StandingRow
              key={capability.id}
              capability={capability}
              explain={standings[at - 1]?.standing !== capability.standing}
            />
          ))}
          {standings.length === 0 ? (
            <li className="standing">
              <p className="wrap">
                DASH has no actions for {row.service}, so this agent cannot reach it
                through DASH at all.
              </p>
            </li>
          ) : null}
        </ul>
      </Section>

      {/*
        The two disclosures, as banners rather than as paragraphs among
        paragraphs. Both render before a sign-in as well as after, because the
        person who has not granted anything yet is the one deciding — and a
        disclosure that arrives after the grant describes a window they were
        already inside (ADR 0002 amendment 2).
      */}
      {broker.wider_permission_sentence === null ? null : (
        <p className="disclosure wrap" role="note">
          {broker.wider_permission_sentence}
        </p>
      )}
      {broker.dash_closed_sentence === null ? null : (
        <p className="disclosure wrap" role="note">
          {broker.dash_closed_sentence}
        </p>
      )}

      <Section title="On whose account">
        <p className="account-line">
          <span className="value">{account.account}</span>
          {account.since === null ? null : (
            <span className="muted"> · since {account.since}</span>
          )}
        </p>
        <p className="wrap">
          <strong>{account.custody}</strong>
        </p>
        {broker.client_sentence === null ? null : (
          <p className="muted wrap">{broker.client_sentence}</p>
        )}
        {/* ADR 0002 opens on exactly this: signing in to DASH would establish
            identity only, and would not grant Gmail or Calendar access. */}
        <p className="muted wrap">
          This is separate from signing in to DASH. Signing in identifies you; this
          grants {row.service} access on its own.
        </p>
      </Section>

      <Section title="What it has been used for">
        <p className="wrap">{use.headline}</p>
        {use.last_used === null ? null : (
          <p className="muted">Last used {use.last_used}.</p>
        )}
        {broker.recent.length === 0 ? null : (
          <details className="permission-history">
            <summary>
              See the receipt
              {use.has_refusals ? " — including what DASH refused" : ""}
            </summary>
            <ul>
              {broker.recent.map((entry) => (
                <li key={`${entry.decided_at}:${entry.label}`} className="wrap">
                  <span
                    className={entry.decision === "allowed" ? "chip chip-ok" : "chip chip-warn"}
                  >
                    {entry.decision === "allowed" ? "allowed" : "refused"}
                  </span>{" "}
                  {entry.refusal_headline ?? entry.label}
                  {entry.decision === "allowed" && entry.result_count !== null ? (
                    <span className="muted">
                      {" "}
                      · {entry.result_count} result{entry.result_count === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <div className="muted">{plainMoment(entry.decided_at) ?? "Time not recorded"}</div>
                  {entry.undelivered ? (
                    // MAR-467. On the decision, not beside it: DASH made this
                    // call, and what it could not confirm is that the answer got
                    // back. "Could not confirm" rather than "did not arrive"
                    // because an acknowledgement DASH never received looks the
                    // same from here as one that was never sent.
                    <div className="muted wrap">
                      DASH could not confirm this answer reached the agent, so the agent
                      may have carried on as though it had asked for nothing.
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="muted wrap">{use.limit}</p>
      </Section>

      <Parties broker={broker} service={row.service} />
    </>
  );
}

/* ---------------------------------------------------------------------- *
 * The unbrokered body — the same four questions, honestly unanswerable
 * ---------------------------------------------------------------------- */

/**
 * A connection DASH does not broker.
 *
 * It gets the same card and the same headings, and three of the four answers are
 * an absence. That is the point: a page where only the brokered cards had a
 * "what has it been used for" section would let the reader assume the others
 * simply had not been used yet.
 *
 * The capability list here is the **manifest's** — the agent author's own words
 * about what it needs — and it is labelled as a claim rather than as a boundary,
 * because that is exactly what it is. Nothing checks it.
 */
function UnbrokeredBody({
  row,
  proofCopy,
}: {
  row: ConnectionRowWithCredential;
  proofCopy: { label: string; can: string; cannot: string };
}): ReactNode {
  return (
    <>
      <Section title="What it can reach">
        {row.capabilities.length === 0 ? (
          <p className="wrap muted">
            The agent did not say. DASH does not guess what a connection is for.
          </p>
        ) : (
          <ul className="capability-list">
            {row.capabilities.map((capability) => (
              <li key={capability.id}>
                {capability.label} <span className="muted">({capability.access})</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted wrap">
          {row.source === "declared_connection"
            ? "This is what the agent's author wrote down. DASH is not in the middle of these requests, so it is a claim rather than a limit."
            : "Nothing in the agent said this. DASH worked it out from the steps in the agent's plan, and it may be wrong."}
        </p>
      </Section>

      <Section title="What DASH can show you">
        <p className="wrap">{proofCopy.can}</p>
        <p className="disclosure wrap" role="note">
          {proofCopy.cannot}
        </p>
      </Section>

      {row.ownership_confirmed ? null : (
        <p className="muted wrap">
          Nothing in the agent says who holds this sign-in, so DASH will ask rather
          than assume.
        </p>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------- *
 * What the cards cannot account for
 * ---------------------------------------------------------------------- */

/**
 * MAR-467 and ADR 0005, kept — and kept *above* the cards, which was a
 * deliberate decision then and is still right: somebody who opened this page
 * because an agent did less than they expected is looking for exactly this.
 *
 * What changed is the shape. It used to be an open list of bullets, each ending
 * in two raw instants (`2026-08-07T13:58:28.037Z`), and at 375px a single window
 * wrapped over four lines — so a page about connections opened with a wall of
 * machine timestamps about something that did not happen. It is now one line
 * with a count, and the periods are behind a disclosure and in words.
 *
 * Still visually unlike a card, and still carrying no verdict-shaped chip. A
 * permission card's history is a list of decisions DASH made; these are requests
 * DASH never adjudicated. Putting them in one list — even styled differently —
 * would make the history a mixture of things DASH did and things DASH infers.
 */
export function BrokerLapseNotice({ lapses }: { lapses: BrokerLapseView[] }): ReactNode {
  if (lapses.length === 0) {
    return null;
  }

  return (
    <details className="broker-lapses">
      <summary>
        {lapses.length === 1
          ? "There is 1 period DASH cannot account for"
          : `There are ${lapses.length} periods DASH cannot account for`}
      </summary>
      <p className="muted wrap">
        These are not decisions. They are times this agent may have asked for
        something and DASH was not in a position to answer or to record it.
      </p>
      <ul>
        {lapses.map((lapse) => (
          <li key={`${lapse.kind}:${lapse.from_at}`} className="wrap">
            {lapse.sentence}
            <div className="muted">
              {plainWindow(lapse.from_at, lapse.until_at) ?? "Time not recorded"}
            </div>
            {lapse.qualifier === null ? null : (
              <div className="muted">{lapse.qualifier}</div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/* ---------------------------------------------------------------------- *
 * The list
 * ---------------------------------------------------------------------- */

/**
 * One agent's connections, as cards.
 *
 * Ungrouped, and that is the change. MAR-383 grouped by ownership because it was
 * building a checklist and ownership decided which rows had a Connect button.
 * Every card now says its own custody in its own words, in the place where it
 * changes the meaning of what is above it — so the headings were three pieces of
 * DASH's vocabulary standing between a person and the four answers they came
 * for.
 */
export function ConnectionCards({
  rows,
  act = null,
}: {
  rows: ConnectionRowWithCredential[];
  act?: ConnectionAct | null;
}): ReactNode {
  const canAct = useCanAct();

  if (rows.length === 0) {
    return (
      <p className="muted">
        This agent asked to reach nothing outside this computer, and its plan needs
        no model provider.
      </p>
    );
  }

  return (
    <ol className="row-list">
      {rows.map((row) => (
        <li key={row.connection_id}>
          <ConnectionCard row={row} act={act} canAct={canAct} />
        </li>
      ))}
    </ol>
  );
}
