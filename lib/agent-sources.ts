/**
 * What AI News Scout reads, and what the plan calls the steps that read it.
 *
 * ## Why the component ids live here rather than inline in the scaffold
 *
 * `lib/analyze.ts` matches a run's executed steps to its manifest's
 * `planned_route` by exact `component_id` string. Those strings are also the
 * OrchestrateKit registry's own component names, and the registry is a separate
 * repository on its own release cadence. A literal typed into the scaffold would
 * be a cross-repository contract with no single place to reconcile it — and the
 * failure it produces is quiet and terrible: every step renders as `unplanned`
 * drift, so the verdict surface fills with findings about an agent that did
 * exactly what it said it would.
 *
 * MAR-455 published `public_feed_fetch` (registry `fb93a92`) for precisely this
 * goal: anonymous RSS/Atom/JSON over a plain GET, no crawler account, no API
 * key, no billing relationship. That is the name below.
 *
 * ## Why `scheduled_trigger` is deliberately absent
 *
 * MAR-455's route is `public_feed_fetch -> scheduled_trigger -> audit_log`,
 * because the goal it was written for asks for a *daily* digest. MAR-457 ships
 * manual-run-first with cadence as a later, opt-in step, so a manifest declaring
 * a scheduled trigger would be a manifest promising a step that never runs —
 * `missing_step` drift on every single manual run of the flagship journey.
 *
 * The planned route therefore declares what this agent actually does today.
 * When cadence lands, the step is added at the same time as the schedule that
 * makes it true. Reconciling the two shapes is open on MAR-456's session; if the
 * registry's answer differs from this one, this module is the single place that
 * changes.
 */

/** Reading public feeds. The registry's name for it, not ours. */
export const FEED_FETCH_COMPONENT = "public_feed_fetch";

/** Writing the digest to the user's own disk. Shared with the older sample. */
export const DIGEST_WRITE_COMPONENT = "local_file_write";

/** The file a user edits to change what the scout watches. */
export const SOURCES_FILE_NAME = "sources.json";

export interface FeedSource {
  /** What the user reads. Never a URL, so a list of these is a list of names. */
  name: string;
  url: string;
  /**
   * Which parser answers this address.
   *
   * Declared rather than sniffed. Guessing from a response body means a source
   * that starts returning an error page gets parsed as whatever the error page
   * resembles, and the agent reports zero items instead of a failure — the
   * silent wrong answer this whole feature exists to avoid.
   */
  format: "rss" | "atom" | "hn_algolia";
}

/**
 * The names in a sources file, or null when this is not one (MAR-584).
 *
 * ## Why DASH reads inside one program file and not the others
 *
 * MAR-584 detects that an external editor changed an agent's folder and says
 * what changed. For most files the honest report is "this file changed": DASH
 * did not write it, does not know its grammar, and a diff invented from bytes
 * would be a guess dressed as a fact.
 *
 * `sources.json` is the exception, and the exception is narrow and principled:
 * **DASH's own scaffold wrote it**, in a shape declared thirty lines above this
 * one. Henrik's example of the whole feature — *"adds more sources that a News
 * agent scrapes"* — is a change to this file and to nothing else, so a detector
 * that could only say "a file changed" would fail the one sentence the issue
 * was opened for.
 *
 * Names and never addresses. `FeedSource.name` carries the comment "what the
 * user reads. Never a URL", and a change list saying *"added Ars Technica"* is
 * the report; the same list quoting a query string would be
 * `lib/copy/identifiers.ts`'s failure on a surface built to avoid it.
 *
 * ## Null is a real answer and the caller must keep it one
 *
 * Not-JSON, not an object, no `sources` array, or entries that are not objects
 * with a text name: all null, all meaning *DASH cannot read this as a sources
 * file*. That is not the same as an empty list, which means a file that
 * legitimately lists nothing, and a caller that collapsed the two would report
 * "every source was removed" over a file somebody reformatted into a shape DASH
 * does not know.
 *
 * Order is preserved rather than sorted. The caller compares as sets — a
 * reordered file is not a change worth a sentence — but preserving order keeps
 * this a faithful reading of the document rather than a normalisation of it.
 */
export function readSourceNames(json: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const listed = (parsed as { sources?: unknown }).sources;
  if (!Array.isArray(listed)) {
    return null;
  }

  const names: string[] = [];
  for (const entry of listed) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== "string" || name.length === 0) {
      return null;
    }
    names.push(name);
  }
  return names;
}

/**
 * The three the scout ships with.
 *
 * Chosen because MAR-455 names them as the credential-free set the proven
 * `ai-agent-news` agent already used: all three answer an anonymous GET, none
 * has a free tier to exhaust, and none asks the user for an account before they
 * have seen anything work. That is the whole argument for this being the first
 * useful agent rather than a demo.
 */
export const DEFAULT_SOURCES: readonly FeedSource[] = [
  {
    name: "Google News",
    url: "https://news.google.com/rss/search?q=%22AI+agents%22&hl=en-US&gl=US&ceid=US:en",
    format: "rss",
  },
  {
    name: "Hacker News",
    url: "https://hn.algolia.com/api/v1/search_by_date?query=AI%20agents&tags=story&hitsPerPage=15",
    format: "hn_algolia",
  },
  {
    name: "arXiv",
    url: "http://export.arxiv.org/api/query?search_query=all:%22AI+agents%22&sortBy=submittedDate&sortOrder=descending&max_results=15",
    format: "atom",
  },
];
