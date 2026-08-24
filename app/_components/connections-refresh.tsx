"use client";

import { useState, type ReactNode } from "react";

import { refreshConnections } from "../_data/source";

/**
 * *Refresh connections* — the worst-case recovery, on the AI tab (MAR-742).
 *
 * ## What it replaces
 *
 * Disconnect and re-add. That is what a person does today when the chief says
 * it has no model and the key is right there on the page, and it works by
 * destroying a credential in order to find out whether it was broken. On
 * 2026-08-24 the answer was that it was not: the vault had the key the whole
 * time, and the re-paste was the fix for a problem somewhere else entirely.
 *
 * So this asks the three questions that recovery skips — does the vault still
 * hand each credential back, does its provider still accept it, does the
 * background service have it — and answers each one **per connection**, because
 * the failure that prompted all of this was one connection failing while its
 * neighbour in the same folder was fine. A control that reported "connections
 * refreshed" would have erased the only fact that mattered.
 *
 * ## Why it lives above the page's own loading gate
 *
 * MAR-685, and it is a real trap rather than a style note. `useView` sets
 * `{ status: "loading" }` on every revision bump, so everything under that gate
 * **unmounts** while the view reloads — and a result held in state under it
 * would be destroyed by the very refresh that produced it. `app/settings/ai`
 * therefore mounts this beside the gate rather than inside it: the report
 * survives, and the cards below still re-read, so neither half has to be given
 * up for the other.
 *
 * ## Nothing here composes a sentence
 *
 * Every line rendered below arrives already worded from `lib/ai/refresh.ts` —
 * `ModelDefault`'s standing rule, for its reason: the plain-language gate holds
 * over the words, and this page cannot describe a credential differently from
 * the process that read it.
 *
 * The one exception is not a sentence. `path` is a folder, drawn as its own
 * element the way a model id is, and it is the whole of what this ticket added
 * to the page: when DASH says it found nothing stored, it now also says
 * **where it looked** — which is the question that took a night of filesystem
 * archaeology to answer the first time.
 */

/** One connection's row, as the trusted side flattened it. */
interface RefreshRow {
  provider_id: string;
  account_id: string;
  service: string;
  ok: boolean;
  headline: string;
  detail: string;
  next_action: string;
  path: string;
}

interface RefreshOutcome {
  /** Whether DASH could ask at all. A refused key is a finding, not a failure. */
  asked: boolean;
  summary: string;
  delivery_detail: string;
  rows: readonly RefreshRow[];
}

/**
 * Read the rows off the command result.
 *
 * Defensive rather than trusting, and not because the trusted side is
 * suspected: a shell one version behind answers this command with a `data`
 * shape that predates a field, and a page that destructured it blindly would
 * throw on a control somebody just pressed. Anything unreadable becomes no
 * rows, and the summary sentence — which is `detail`, and which every shell
 * that knows this command sends — still renders.
 */
function rowsFrom(data: unknown): RefreshRow[] {
  if (typeof data !== "object" || data === null) {
    return [];
  }
  const connections = (data as Record<string, unknown>)["connections"];
  if (!Array.isArray(connections)) {
    return [];
  }
  return connections.flatMap((entry): RefreshRow[] => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const row = entry as Record<string, unknown>;
    const text = (key: string): string => (typeof row[key] === "string" ? row[key] : "");
    return [
      {
        provider_id: text("provider_id"),
        account_id: text("account_id"),
        service: text("service"),
        ok: row["ok"] === true,
        headline: text("headline"),
        detail: text("detail"),
        next_action: text("next_action"),
        path: text("path"),
      },
    ];
  });
}

export function ConnectionsRefresh({
  canAct,
  onRefreshed,
}: {
  canAct: boolean;
  /**
   * Told after every press, successful or not.
   *
   * The page re-reads its own view with it, which is what keeps the cards below
   * from going on showing a check date this press has just replaced. It is
   * deliberately *not* what draws the report — see the docblock: the report is
   * held here, above the gate that bump unmounts.
   */
  onRefreshed: () => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RefreshOutcome | null>(null);

  async function refresh(): Promise<void> {
    setBusy(true);
    // Cleared on press rather than left underneath: a report from two minutes
    // ago sitting under a spinner reads as this press's answer, and the one
    // thing this control must never do is show a stale verdict about a
    // credential.
    setOutcome(null);
    const result = await refreshConnections();
    setBusy(false);
    setOutcome({
      asked: result.ok,
      summary: result.detail ?? "",
      delivery_detail:
        typeof result.data?.["delivery_detail"] === "string" ? result.data["delivery_detail"] : "",
      rows: rowsFrom(result.data),
    });
    onRefreshed();
  }

  return (
    <section className="section" aria-labelledby="connections-refresh">
      <h2 id="connections-refresh">If something has stopped working</h2>
      <p className="muted wrap">
        DASH will read every key it holds back out of this computer&rsquo;s vault, ask each service
        whether it still accepts it, and hand what still works to the background service. It changes
        no key and deletes nothing, so it is always safe to press.
      </p>

      <div className="button-row">
        <button
          type="button"
          className="button-secondary"
          disabled={busy || !canAct}
          onClick={() => void refresh()}
        >
          {busy ? "Checking" : "Refresh connections"}
        </button>
      </div>

      {outcome === null ? null : (
        <>
          {outcome.summary === "" ? null : (
            <p className={outcome.asked ? "notice-ok" : "notice-warn"} role="status">
              {outcome.summary}
            </p>
          )}

          {outcome.rows.length === 0 ? null : (
            <ul className="row-list">
              {outcome.rows.map((row) => (
                <li key={`${row.provider_id}:${row.account_id}`}>
                  {/* The service name and the account are the row's identity and
                      come from the connection, not from DASH's vocabulary. The
                      account is drawn only when there is more than one way to
                      read the row — a lone `account-1` beside a service name is
                      an id nobody asked to see. */}
                  <p className={row.ok ? "notice-ok" : "notice-warn"}>{row.headline}</p>
                  <p className="muted wrap">{row.detail}</p>
                  {row.path === "" ? null : (
                    <p className="muted wrap">
                      {/* Its own element, never inside a sentence: a filesystem
                          path is not prose, and the plain-language gate reads
                          the words around it rather than the path itself. */}
                      DASH looked in <code className="value">{row.path}</code>
                    </p>
                  )}
                  {row.next_action === "" ? null : <p className="wrap">{row.next_action}</p>}
                </li>
              ))}
            </ul>
          )}

          {outcome.delivery_detail === "" ? null : (
            <p className="muted wrap">{outcome.delivery_detail}</p>
          )}
        </>
      )}
    </section>
  );
}
