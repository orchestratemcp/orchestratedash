"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import { explainImportFailure, explainNotJson } from "../../lib/import-feedback";
import type { ImportFailureExplanation } from "../../lib/import-feedback";

/**
 * Add agent — the import step of MAR-383's first-install journey.
 *
 * The acceptance criterion this exists for: a fresh user reaches the connection
 * checklist "without terminal, `.env`, component IDs or raw scopes". Before
 * this, importing a manifest meant a `curl` command, which fails that outright.
 *
 * Two ways in, both explicit user actions on a file the user chooses:
 * pick the exported `agent.manifest.json`, or paste its contents. Local folder
 * inspection is deliberately absent — MAR-383 scopes that as its own explicit,
 * separately-consented action, and it needs Henrik present.
 *
 * The file never leaves the machine: it goes to this DASH's own loopback API.
 * Manifests are forbidden from carrying credential values by the schema, so
 * nothing secret passes through here — and DASH still does not hold a
 * credential after a successful import, which the success message says plainly
 * rather than implying the agent is ready to run.
 */

interface ImportSuccess {
  agent: string;
  replaced: boolean;
}

type ImportState =
  | { status: "idle" }
  | { status: "importing" }
  | { status: "imported"; result: ImportSuccess }
  | { status: "failed"; explanation: ImportFailureExplanation };

export function AddAgentForm(): ReactNode {
  const [text, setText] = useState("");
  const [state, setState] = useState<ImportState>({ status: "idle" });

  async function submit(manifestText: string): Promise<void> {
    setState({ status: "importing" });

    // Parse locally first. A JSON syntax error is not a contract failure, and
    // sending it to the API would come back as a less useful message.
    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestText);
    } catch (error: unknown) {
      setState({
        status: "failed",
        explanation: explainNotJson(error instanceof Error ? error.message : String(error)),
      });
      return;
    }

    const response = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const body: unknown = await response.json();

    if (!response.ok) {
      const details = (body as { details?: unknown }).details;
      setState({
        status: "failed",
        explanation: explainImportFailure(
          Array.isArray(details) ? details.map(String) : [String((body as { error?: unknown }).error ?? "import failed")],
        ),
      });
      return;
    }

    setState({ status: "imported", result: body as ImportSuccess });
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (file === undefined) {
      return;
    }
    const contents = await file.text();
    // Show what was picked, so the user can see it before and after importing.
    setText(contents);
    await submit(contents);
  }

  return (
    <div className="add-agent">
      <div className="section">
        <label className="field-label" htmlFor="manifest-file">
          Choose the agent&rsquo;s <code>agent.manifest.json</code>
        </label>
        <input
          id="manifest-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            void onFileChange(event);
          }}
        />
        <p className="muted">
          The file is read on this machine and sent only to this local DASH.
        </p>
      </div>

      <div className="section">
        <label className="field-label" htmlFor="manifest-text">
          Or paste it
        </label>
        <textarea
          id="manifest-text"
          value={text}
          rows={10}
          spellCheck={false}
          onChange={(event) => setText(event.target.value)}
          placeholder={'{\n  "manifest_version": 2,\n  ...\n}'}
        />
        <button
          type="button"
          disabled={text.trim() === "" || state.status === "importing"}
          onClick={() => {
            void submit(text);
          }}
        >
          {state.status === "importing" ? "Importing…" : "Import agent"}
        </button>
      </div>

      {state.status === "imported" ? (
        <div className="notice notice-ok">
          <p>
            Imported <code>{state.result.agent}</code>
            {state.result.replaced ? " — replacing the plan already stored for it." : "."}
          </p>
          {/* Says what actually happened. The agent is not connected, and
              claiming otherwise is the overreach MAR-383 warns against. */}
          <p>
            DASH now knows what this agent plans to do. It does not hold any of
            its credentials. <a href="/connections">See what it needs to connect to</a>.
          </p>
        </div>
      ) : null}

      {state.status === "failed" ? (
        <div className="notice notice-err">
          <p>
            <strong>{state.explanation.headline}</strong>
          </p>
          {state.explanation.suggestion === "" ? null : <p>{state.explanation.suggestion}</p>}
          {state.explanation.raw.length > 0 ? (
            <details>
              <summary>What the validator reported</summary>
              <ul className="findings">
                {state.explanation.raw.map((line) => (
                  <li key={line}>
                    <code>{line}</code>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
