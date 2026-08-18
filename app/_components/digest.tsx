import type { ReactNode } from "react";

import type { GroundingAnalysis } from "../../lib/analyze";
/* MAR-619. Value imports, and safe on the same terms as `lib/copy/when.ts`
   below: `lib/copy/curation.ts` imports nothing but types, so it reaches no
   Node builtin and drags nothing into the renderer bundle. */
import {
  CURATED_HEADING,
  CURATED_REMAINDER_HEADING,
  describeCuratedBy,
  describeNotCurated,
} from "../../lib/copy/curation";
import { citedItems } from "../../lib/brief/citations";
import type { BriefCitations } from "../../lib/brief/citations";
import {
  BRIEF_CITED_LABEL,
  BRIEF_UNCITED_LABEL,
  describeBriefAuthor,
  describeBriefCitations,
} from "../../lib/copy/brief";
import { humanizeAgentName } from "../../lib/copy/agent-name";
import { describeDigestGaps, describeSourceFailure } from "../../lib/copy/recovery";
/* A value import, and safe: `lib/copy/when.ts` has no imports at all, so it
   reaches no Node builtin and drags nothing into the renderer bundle — the rule
   `tests/client-bundle.test.ts` enforces over every component in `app/`. */
import { plainMoment } from "../../lib/copy/when";
import type { BriefArtifact, DigestArtifact, DraftArtifact } from "../../lib/contracts";

/**
 * A digest, with where each item came from (MAR-457).
 *
 * ## Uncited items are shown, not hidden
 *
 * The tempting rendering drops an item with no source, so the digest looks
 * clean. That is precisely how a grounded verdict becomes theatre: the run
 * scores well by concealing the evidence against it, and the user reads a
 * shorter digest with no idea anything was removed. An uncited item is marked
 * and kept.
 *
 * ## Links are named, never printed
 *
 * The link text is the headline. A bare address is unreadable, tells a person
 * nothing about where they are going, and — see `lib/copy/identifiers.ts` — is
 * the shape of thing the plain-language rule exists to keep out of the guided
 * path. The source's *name* is what the user recognises; its address is what
 * the anchor carries.
 */

export function Digest({
  artifact,
  grounding,
}: {
  artifact: DigestArtifact;
  grounding: GroundingAnalysis | null;
}): ReactNode {
  return (
    <section className="section" aria-labelledby="digest-heading">
      <div className="section-heading">
        <h2 id="digest-heading">{artifact.title}</h2>
        <GroundingChip grounding={grounding} />
      </div>
      <DigestBody artifact={artifact} grounding={grounding} />
    </section>
  );
}

/**
 * The digest itself, with no heading and no section of its own (MAR-434).
 *
 * Split out so the Outputs panel can put a digest inside a card that has
 * already named it, without a second copy of the title appearing underneath the
 * first and without an `h2` nested where an `h3` belongs. `Digest` above is now
 * the standalone framing — the agent workspace still opens on one of these on
 * its own, and nothing about that call site changed.
 */
export function DigestBody({
  artifact,
  grounding,
  agent,
  service,
}: {
  artifact: DigestArtifact;
  grounding: GroundingAnalysis | null;
  /**
   * What to call the agent in a sentence about it, or absent (MAR-619).
   *
   * Only the curation sentences name it, and they need the *display* name
   * rather than the id — `buildAgentAsk`'s note records what a packaged
   * screenshot caught when the two were confused, every sentence reading "Ask
   * answered about anything it has saved".
   *
   * **Defaulted through `humanizeAgentName` and never to the raw id.** A
   * default is what a call site gets when nobody thought about it, so it has to
   * be the safe answer rather than the convenient one: `artifact.agent` is a
   * slug, and `lib/copy/identifiers.ts` exists to keep slugs off a guided path.
   * The humanized form is less specific than the author's own `display_name`
   * and is never wrong.
   */
  agent?: string;
  /** The model provider's friendly name, for the same sentences. */
  service?: string;
}): ReactNode {
  const uncited = new Set(grounding?.uncited ?? []);
  const unsupported = new Set((grounding?.unsupported ?? []).map((entry) => entry.headline));
  const gap = describeDigestGaps(artifact.sources_fetched ?? []);
  const named = agent ?? humanizeAgentName(artifact.agent);

  /*
   * Which items the grouping placed, so the rest can be shown under DASH's own
   * heading rather than lost.
   *
   * Computed here and not in the agent, because it is a rendering question: the
   * artifact records what the model grouped, and what is left over is whatever
   * this build of DASH did not draw above. An artifact written by a future
   * agent that grouped everything simply produces an empty remainder.
   */
  const curation = artifact.curation;
  const grouped =
    curation?.state === "curated"
      ? new Set(curation.groups.flatMap((group) => group.items))
      : new Set<number>();

  return (
    <>
      {gap === null ? null : (
        <div className="notice notice-err" role="status">
          <p>
            <strong>{gap.headline}</strong>
          </p>
          <p>{gap.meaning}</p>
          <p>{gap.next_action}</p>
        </div>
      )}

      {/* MAR-619. What the digest adds up to, before the digest.

          Above the items for `OutputContent`'s reason one level up — on an
          agent whose entire purpose is a digest of the news, the first thing
          under its title should be what it found, and a grouped reading of it
          is more of that rather than less. The flat list survives underneath
          in every case, so nothing is hidden behind the grouping. */}
      <Curation
        artifact={artifact}
        agent={named}
        service={service}
        uncited={uncited}
        unsupported={unsupported}
      />

      {artifact.items.length === 0 ? (
        /* Not an error, and not worded as one. A run that read its sources and
           found nothing new did its job. */
        <p className="muted">Nothing new was found this time.</p>
      ) : (
        <>
          {/* The heading only appears when something above it took some of the
              items. Without a grouping this is the whole digest and needs no
              introduction, which is exactly what it was before MAR-619. */}
          {grouped.size === 0 || grouped.size === artifact.items.length ? null : (
            <h3 className="digest-remainder-heading">{CURATED_REMAINDER_HEADING}</h3>
          )}
          {/* Unnumbered once a grouping exists, and the packaged capture is why.

              The flat digest has always been a numbered list, and it reads
              correctly because there is one of them: item 3 is the third thing
              the agent found. A grouped digest is several lists on one page,
              each starting again at 1 — the first frame showed three different
              headlines all numbered "1.", which reads as a rendering fault
              rather than as a structure. The list stays an `ol` because the
              order is still newest-first and that is a fact about the document;
              what goes is the marker, which had stopped meaning anything.

              Only when a grouping exists, so an ordinary digest is pixel-for-
              pixel what it was before this issue. */}
          <ol className={grouped.size === 0 ? "digest-items" : "digest-items digest-items-plain"}>
            {artifact.items.map((item, index) =>
              grouped.has(index) ? null : (
                <li key={`${item.headline}:${String(index)}`}>
                  <DigestItem
                    item={item}
                    uncited={uncited}
                    unsupported={unsupported}
                  />
                </li>
              ),
            )}
          </ol>
        </>
      )}

      <SourceList artifact={artifact} />
    </>
  );
}

/**
 * One item, wherever it is drawn.
 *
 * Split out of `DigestBody` by MAR-619, when the same item started being drawn
 * in two places on one page — inside a group and in the remainder underneath.
 * One component rather than two loops, because the interesting part is the
 * grounding chips and a second copy of that logic is a second place for an
 * uncited item to quietly stop being marked.
 *
 * The heading level does not change between the two placements. A group's
 * label is not a heading — see `Curation` — precisely so that these stay at the
 * `h3` they have been since MAR-434 and the panel's own heading structure is
 * unchanged.
 */
function DigestItem({
  item,
  uncited,
  unsupported,
}: {
  item: DigestArtifact["items"][number];
  uncited: ReadonlySet<string>;
  unsupported: ReadonlySet<string>;
}): ReactNode {
  return (
    <>
      <h3>
        {item.item_url === undefined ? (
          item.headline
        ) : (
          <a href={item.item_url} rel="noreferrer noopener" target="_blank">
            {item.headline}
          </a>
        )}
      </h3>
      {item.summary === undefined ? null : <p className="wrap">{item.summary}</p>}
      <p className="muted">
        {item.source_name ?? "Source not named"}
        {publishedSuffix(item.published_at)}
        {uncited.has(item.headline) ? (
          <>
            {" · "}
            <span className="chip chip-warn">no source given</span>
          </>
        ) : unsupported.has(item.headline) ? (
          <>
            {" · "}
            <span
              className="chip chip-warn"
              title="This item names a source that this run did not report reading"
            >
              source not read in this run
            </span>
          </>
        ) : null}
      </p>
    </>
  );
}

/**
 * What a model made of this digest, or the honest account of why nothing did
 * (MAR-619).
 *
 * ## Three renders, and the first one is the important absence
 *
 * `curation` absent draws **nothing at all**. That is every digest written
 * before this existed and every agent that never declared a provider, and a
 * component that put "not summarised" on those would be annotating thousands
 * of perfectly good digests with a feature they were never part of.
 * `lib/contracts.ts` keeps absent and `not_curated` apart for exactly this.
 *
 * ## Why a group's label is not a heading
 *
 * It is a `<p>` in a group container, not an `<h3>` or an `<h4>`. Two reasons,
 * and the second is the one that decided it. A group's title is **written by a
 * model**, so promoting it into the document outline would let untrusted text
 * become the navigable structure of a DASH page — a person moving by heading
 * would be moving through a model's words. And the items inside are already
 * `h3`, from `DigestItem`, unchanged since MAR-434; making the label an `h3`
 * too would flatten the two into one level, and making it an `h2` would jump
 * above the section that contains it. `panel.tsx`'s own note on heading levels
 * is what this is keeping intact.
 */
function Curation({
  artifact,
  agent,
  service,
  uncited,
  unsupported,
}: {
  artifact: DigestArtifact;
  agent: string;
  service?: string;
  uncited: ReadonlySet<string>;
  unsupported: ReadonlySet<string>;
}): ReactNode {
  const { curation } = artifact;
  if (curation === undefined) {
    return null;
  }

  if (curation.state === "not_curated") {
    const recovery = describeNotCurated(curation.reason, {
      agent,
      /*
       * The provider's friendly name when the caller knows it, and a
       * description when it does not. Never an id: a surface naming a service
       * it could not resolve would otherwise print `openrouter` into a
       * sentence, which is what `lib/copy/identifiers.ts` exists to prevent.
       *
       * "its" and not "your", matching `describeUnavailable`'s own stand-in.
       * Every sentence in `describeNotCurated` is written to read with either
       * form — see the possessive rule stated there, which this string is the
       * reason for.
       */
      service: service ?? "its model provider",
    });
    return (
      <div className="notice" role="status">
        <p>
          <strong>{recovery.headline}</strong>
        </p>
        <p>{recovery.meaning}</p>
        <p className="next-action">{recovery.next_action}</p>
      </div>
    );
  }

  return (
    <section className="digest-curation" aria-label={CURATED_HEADING}>
      <h3>{CURATED_HEADING}</h3>
      {curation.overview === undefined ? null : (
        <p className="wrap digest-curation-overview">{curation.overview}</p>
      )}

      {curation.groups.map((group, index) => (
        <div className="digest-group" key={`${group.label}:${String(index)}`}>
          <p className="digest-group-label">
            <strong>{group.label}</strong>
          </p>
          {group.summary === undefined ? null : <p className="wrap">{group.summary}</p>}
          <ol className="digest-items digest-items-plain">
            {group.items.map((position) => {
              const item = artifact.items[position];
              // An index naming nothing draws nothing. The agent already
              // checked these against its own list, so reaching this means an
              // artifact from a build that disagreed with this one — and a
              // page a person is reading must not crash on the day they do.
              return item === undefined ? null : (
                <li key={`${group.label}:${String(position)}`}>
                  <DigestItem item={item} uncited={uncited} unsupported={unsupported} />
                </li>
              );
            })}
          </ol>
        </div>
      ))}

      {/* Who wrote this, on the surface, and no control beside it.

          The mechanism belongs behind `InfoNote` by `lib/copy/info-note.ts`'s
          rule and cannot go there: this component renders inside the
          declarative panel, and ADR 0008 bars any control from that region.
          `describeCuratedBy` carries the argument and the one clause of the
          mechanism that survives it. */}
      <p className="muted">{describeCuratedBy(curation.model ?? null)}</p>
    </section>
  );
}

/**
 * When an item was published, in DASH's own words — or nothing at all.
 *
 * This line used to interpolate `item.published_at` directly, so a digest item
 * read `Hacker News · 2026-08-05T09:00:00.000Z` on the guided path. MAR-533
 * named that class of defect and built `lib/copy/when.ts` for it — "a person who
 * has to read a machine's own spelling of something has been handed the
 * machine's problem" — and this call site was missed, so the raw instant kept
 * reaching three surfaces: the run detail page, the workspace Outputs area, and
 * (since MAR-554) the declarative panel's `report` and `outputs` sections. One
 * call site, because `SourceList` below renders no timestamp at all and
 * `ArtifactSource.fetched_at` is not drawn anywhere.
 *
 * **A timestamp DASH cannot read produces no segment, rather than the input.**
 * `lib/copy/when.ts` states that rule and it is the interesting half: echoing a
 * malformed value back would put the exact string this exists to remove onto the
 * screen, on the one path where nobody is watching. The separator goes with it —
 * a dangling " · " would advertise a missing value that a reader can do nothing
 * about, and the item's source name is a complete line on its own.
 *
 * The whole suffix rather than the moment alone, so the separator can never be
 * rendered by one branch and the value by another.
 */
function publishedSuffix(publishedAt: string | undefined): string {
  if (publishedAt === undefined) {
    return "";
  }
  const moment = plainMoment(publishedAt);
  return moment === null ? "" : ` · ${moment}`;
}

/**
 * Where the digest came from, and what did not work.
 *
 * Every source is listed, including the ones that worked. A list that showed
 * only failures would answer "what went wrong" while leaving "what did this
 * actually read" unanswered — and the second question is the one a person
 * checking a digest they are about to rely on is really asking.
 */
function SourceList({ artifact }: { artifact: DigestArtifact }): ReactNode {
  const sources = artifact.sources_fetched ?? [];
  if (sources.length === 0) {
    return null;
  }

  return (
    <details className="digest-sources">
      <summary>Where this came from ({sources.length})</summary>
      <ul>
        {sources.map((source) => {
          const recovery = describeSourceFailure(source);
          return (
            <li key={source.source_url}>
              <strong>{source.source_name}</strong>
              {source.item_count === undefined ? null : (
                <span className="muted">
                  {" "}
                  · {source.item_count} item{source.item_count === 1 ? "" : "s"}
                </span>
              )}
              {recovery === null ? null : (
                <div className={source.status === "empty" ? "notice" : "notice notice-err"}>
                  <p>
                    <strong>{recovery.headline}</strong>
                  </p>
                  <p>{recovery.meaning}</p>
                  <p>{recovery.next_action}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * A reply an agent wrote (MAR-458, MAR-469).
 *
 * ## The notice at the top is the whole component
 *
 * Everything else here is presentation. The notice is the honesty requirement,
 * and it is rendered before the draft rather than under it because a person
 * scanning this needs to know what it is *not* before they read what it says.
 *
 * ## Why there are now two notices
 *
 * MAR-458's version said "nothing has been sent, and it has not been saved to
 * your mail either", and both halves were true by construction: the broker had
 * two read operations and no way to reach a mailbox in the other direction.
 * MAR-469 built `gmail.draft.create`, and the second half became false for some
 * drafts while staying true for others.
 *
 * A safeguard sentence that is true of only some artifacts is not a safeguard,
 * so this branches on `placement` rather than softening one line to cover both.
 * The half that survives is the half that matters, and it survives in every
 * branch: **nothing here has been sent.** That is still true by construction
 * rather than by promise — no send operation exists in
 * `lib/broker/operations.ts` for anything to call, whatever Google's compose
 * permission would allow a token holder to do.
 *
 * `PROJECT_STATE.md` records the failure being avoided: `network: read` is "a
 * declaration DASH renders, not a boundary DASH enforces", and every surface has
 * to say which it is. The no-send claim is the enforced kind and is stated
 * flatly. The claim that a draft reached the mailbox is the *agent's* — DASH's
 * own record of what it performed is the broker audit trail — so that one is
 * attributed rather than asserted, exactly as `sources` is below.
 *
 * ## Why the body is plain text in a `pre`
 *
 * The draft is composed from message content, which ADR 0002 invariant 7 calls
 * untrusted data. React escapes it either way; a `pre` also stops a reply whose
 * body is one 20,000-character line from stretching the page, and keeps the
 * agent's own line breaks — which are part of what the user is reviewing.
 */
export function Draft({ artifact }: { artifact: DraftArtifact }): ReactNode {
  return (
    <section className="section" aria-labelledby="draft-heading">
      <div className="section-heading">
        <h2 id="draft-heading">{artifact.title}</h2>
        <DraftPlacementChip artifact={artifact} />
      </div>
      <DraftBody artifact={artifact} />
    </section>
  );
}

/**
 * Where this reply is, as a chip (MAR-434).
 *
 * Exported so the Outputs panel can carry it in a card header that has already
 * named the draft. It is a safety signal rather than decoration — "in your
 * drafts, not sent" is the difference between something sitting in a mailbox
 * and something that only exists in DASH — so a list of outputs that dropped it
 * would be hiding the one fact worth scanning for.
 */
export function DraftPlacementChip({ artifact }: { artifact: DraftArtifact }): ReactNode {
  return artifact.draft.placement.where === "provider_draft" ? (
    <span
      className="chip chip-warn"
      title="The agent reports saving this to your drafts. DASH has no operation that could send it."
    >
      in your drafts, not sent
    </span>
  ) : (
    <span
      className="chip chip-ok"
      title="DASH has no operation that could send this or save it to your mail"
    >
      held here only
    </span>
  );
}

/** The reply itself, with no heading and no section of its own (MAR-434). */
export function DraftBody({ artifact }: { artifact: DraftArtifact }): ReactNode {
  const { draft } = artifact;
  const recipients = draft.to ?? [];
  const sources = draft.sources ?? [];

  return (
    <>
      {draft.placement.where === "provider_draft" ? (
        <div className="notice" role="status">
          <p>
            <strong>Nothing has been sent.</strong> The agent reports saving this
            reply to your {draft.placement.service} drafts, where you can edit it,
            send it, or delete it yourself.
          </p>
          <p>
            DASH has no action that sends mail, so this cannot go out unless you
            send it. Saving a draft is the only change DASH will make to your
            mailbox — and what DASH actually did on your behalf is recorded on the
            Connections page, which is the record to check rather than this one.
          </p>
        </div>
      ) : (
        <div className="notice" role="status">
          <p>
            <strong>DASH is holding this reply. Nothing has been sent.</strong>
          </p>
          <p>
            It has not been saved to your mail either — this copy exists only in
            DASH. The agent can read the messages you approved and write a reply
            here, and DASH has no action that sends mail.
          </p>
        </div>
      )}

      <dl className="draft-headers">
        <dt>To</dt>
        <dd>{recipients.length === 0 ? <span className="muted">Not addressed</span> : recipients.join(", ")}</dd>
        <dt>Subject</dt>
        <dd>{draft.subject}</dd>
      </dl>

      <pre className="draft-body wrap">{draft.body}</pre>

      {sources.length === 0 ? null : (
        <details className="digest-sources">
          <summary>Messages it read to write this ({sources.length})</summary>
          <ul>
            {sources.map((source) => (
              <li key={source.message_id}>
                <strong>{source.subject ?? "No subject"}</strong>
                {source.from === undefined ? null : <span className="muted"> · {source.from}</span>}
              </li>
            ))}
          </ul>
          {/* The agent's own account of what it read. The broker's audit trail
              is the independent record, and it is on the Connections page
              rather than duplicated here — one place to check a claim is worth
              more than two that can disagree. */}
          <p className="muted">
            This is the agent&apos;s own account. What DASH actually let it read is on the
            Connections page.
          </p>
        </details>
      )}
    </>
  );
}

/**
 * Render whatever a run produced, by kind (MAR-458).
 *
 * One component both pages call, rather than a `kind` ternary repeated at each
 * call site. The reason is the same one that made `RunArtifact` a union: adding
 * a third kind should be a compile error in exactly one place, and a page that
 * forgot to handle it should not silently render nothing.
 *
 * `grounding` is only ever a digest's, which is why it is passed through rather
 * than looked up here — `lib/views/build.ts` already refuses to grade a draft.
 */
export function RunOutput({
  artifact,
  grounding,
}: {
  artifact: DigestArtifact | DraftArtifact;
  grounding: GroundingAnalysis | null;
}): ReactNode {
  switch (artifact.kind) {
    case "digest":
      return <Digest artifact={artifact} grounding={grounding} />;
    case "draft":
      return <Draft artifact={artifact} />;
    default: {
      const unreachable: never = artifact;
      throw new Error(`Unhandled artifact kind: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * The grounding verdict, as its own chip.
 *
 * Rendered beside the digest rather than beside the plan-vs-actual chips, and
 * never merged with them. See `lib/analyze.ts`: `compliant` means the run
 * honoured its safety contract, and a missing citation must not be able to
 * dilute what that word means.
 *
 * `unverifiable` is worded as an absence of evidence rather than as a fault,
 * because that is what it is — the artifact never said what it read, so DASH
 * has nothing to check and says so instead of guessing.
 */
export function GroundingChip({
  grounding,
}: {
  grounding: GroundingAnalysis | null;
}): ReactNode {
  if (grounding === null) {
    return null;
  }

  if (grounding.verdict === "unverifiable") {
    return (
      <span
        className="chip chip-muted"
        title="This digest did not say which sources it read, so DASH cannot check its citations"
      >
        sources not stated
      </span>
    );
  }

  if (grounding.verdict === "grounded") {
    return (
      <span
        className="chip chip-ok"
        title="Every item names a source this run reported reading. DASH checks the digest against its own report, not against the web."
      >
        every item sourced
      </span>
    );
  }

  const missing = grounding.uncited.length + grounding.unsupported.length;
  return (
    <span
      className="chip chip-warn"
      title="Some items do not name a source this run reported reading"
    >
      {missing} of {grounding.items_total} unsourced
    </span>
  );
}

/**
 * A written brief, and the accounting DASH can honestly put around it
 * (MAR-674, ADR 0025).
 *
 * ## What this draws that no other body does
 *
 * Everything inside `document` is model-authored prose. `DigestBody` draws an
 * agent's record of what it found; this draws a provider's writing about that
 * record, and the difference is why every string DASH adds around it comes from
 * `lib/copy/brief.ts` rather than from the artifact.
 *
 * ## Rendered as text, never as markup
 *
 * A heading is a `h3` because it is one, and a paragraph is a `p`. Nothing here
 * interprets the model's characters: `readBrief` already refused any paragraph
 * with an address in it, and React escapes the rest by construction. There is
 * no markdown step, and adding one would be handing a provider's output a way
 * to become elements on a privileged page.
 *
 * ## The citations come from DASH's list, never from the text
 *
 * A paragraph carries positions into the digest's `items`, and the link under
 * it is that item's own `item_url` — collected by the agent, checked against
 * the fingerprint, and never a string the model produced. When the join is not
 * sound `citedItems` returns nothing at all, so a paragraph shows no citation
 * rather than a wrong one.
 */
export function BriefBody({
  artifact,
  citations,
}: {
  artifact: BriefArtifact;
  citations: BriefCitations | null;
}): ReactNode {
  /*
   * A resolver was never run, so nothing is claimed either way.
   *
   * Not the same as `digest_missing`, which is a checked answer. This is the
   * state a card built by a caller that passed no resolver is in, and it draws
   * the document with no citations and no notice — the honest rendering of "DASH
   * has not looked", rather than a sentence asserting something it did not check.
   */
  const resolved: BriefCitations = citations ?? {
    state: "digest_missing",
    items: [],
    expected_count: artifact.derived_from.item_count,
    found_count: null,
  };
  const notice = citations === null ? null : describeBriefCitations(resolved);

  return (
    <>
      {notice === null ? null : (
        <div className="notice notice-err" role="status">
          <p>
            <strong>{notice.headline}</strong>
          </p>
          <p>{notice.meaning}</p>
          <p>{notice.next_action}</p>
        </div>
      )}

      {/* Whose writing this is, said before it rather than under it. A reader
          who reaches the attribution after the prose has already read the
          prose as DASH's. */}
      <p className="muted">{describeBriefAuthor(artifact.document.model)}</p>

      {artifact.document.sections.map((section, sectionIndex) => (
        <section key={`${section.heading}:${String(sectionIndex)}`} className="brief-section">
          <h3>{section.heading}</h3>
          {section.paragraphs.map((paragraph, paragraphIndex) => (
            <BriefParagraphBody
              key={`${String(sectionIndex)}:${String(paragraphIndex)}`}
              paragraph={paragraph}
              citations={resolved}
            />
          ))}
        </section>
      ))}
    </>
  );
}

/**
 * One paragraph and what it was written from.
 *
 * Its own component for `DigestItem`'s reason: the interesting part is the
 * citation line, and a second copy of that logic would be a second place for an
 * uncited paragraph to quietly stop being marked.
 *
 * The uncited label is shown rather than the line being omitted. A brief whose
 * unattributed sentences look exactly like its attributed ones reads as fully
 * grounded, which is the theatre `app/_components/digest.tsx` opens by refusing.
 */
function BriefParagraphBody({
  paragraph,
  citations,
}: {
  paragraph: BriefArtifact["document"]["sections"][number]["paragraphs"][number];
  citations: BriefCitations;
}): ReactNode {
  const cited = citedItems(paragraph.items, citations);

  return (
    <>
      <p className="wrap">{paragraph.body}</p>
      {cited.length === 0 ? (
        /* Silent when DASH withheld the citations rather than the model
           omitting them: under a mismatch every paragraph would wear this
           label, which would read as the model's failure when it is DASH's
           refusal to guess. The notice at the top has already said so once. */
        citations.state !== "matched" ? null : (
          <p className="muted brief-uncited">{BRIEF_UNCITED_LABEL}</p>
        )
      ) : (
        <p className="muted brief-cited">
          {BRIEF_CITED_LABEL}
          {": "}
          {cited.map((item, index) => (
            <span key={`${item.headline}:${String(index)}`}>
              {index === 0 ? null : " · "}
              {/* The headline is the link text and the address is what the
                  anchor carries — `DigestItem`'s rule, and the address here
                  came from the agent's own collected row rather than from
                  anything the model wrote. */}
              {item.item_url === undefined ? (
                item.headline
              ) : (
                <a href={item.item_url} rel="noreferrer noopener" target="_blank">
                  {item.headline}
                </a>
              )}
            </span>
          ))}
        </p>
      )}
    </>
  );
}
