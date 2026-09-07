"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AddAgentForm } from "../../_components/add-agent-form";
import { ChooseFolder, CopyableCommand, TrySampleAgent } from "../../_components/choose-folder";
import { useCanAct, useHost } from "../../_data/use-view";
import { ADD_AGENT_PATHS, ASSISTANT_SETUP, CHOOSE_FOLDER_COPY } from "../../../lib/copy/add-agent";
import { describeImportUnavailable } from "../../../lib/copy/host";

/**
 * Add agent (MAR-428, rewritten by MAR-598, opened up by MAR-879).
 *
 * ## What changed, and why the order is still the whole page
 *
 * MAR-428 put two terminal commands at the top, and MAR-598 inverted that:
 * choosing a folder became the page and the commands went behind a disclosure.
 * That fixed the wrong lede and left a different one. There were three ways to
 * get an agent into DASH and only one of them was here — the sample lived in
 * the application menu and was reachable only by reading a paragraph on the
 * Agents page that told you where the menu button was, and building one was a
 * developer disclosure at the bottom of this page. A person who had nothing
 * landed on a page whose only offer was "point me at the agent you already
 * have".
 *
 * So the page is now the choice itself: three doors at the same rank, in the
 * order of how much a person has to have already — nothing, an assistant, an
 * agent. `ADD_AGENT_PATHS`' own header carries the argument; what matters here
 * is that **none of them is a second import**. The sample opens the menu that
 * owns that operation, the assistant path explains a plugin that ends at
 * `dash://` and DASH's own consent dialog, and the folder path is
 * `ChooseFolder` exactly as MAR-598 shipped it. Every door ends at the same
 * question.
 *
 * ## Why the two old disclosures survive underneath
 *
 * Demoting a path and deleting it look identical in a screenshot of the top of
 * a page, and only one of them was ever asked for. `npx create-dash-agent` is
 * still the only way to make an agent with no assistant and no folder, and the
 * manifest form is still the only door for an agent built outside the Agent
 * Kit. Both keep their disclosures, below the three doors, labelled by who they
 * are for.
 *
 * ## Why there is no listing of existing agents here
 *
 * Because there never was one on this page. The "2 agents · Open …" text
 * MAR-598 asks to remove is `FleetStrip`, DASH's own band along the bottom of
 * *every* window (MAR-503) — a deliberate, app-wide, dismissible piece of
 * chrome rather than something this page renders.
 */
export default function AddAgentPage(): ReactNode {
  const host = useHost();
  const canAct = useCanAct();
  const unavailable = host === null ? null : describeImportUnavailable(host);
  const opened = useOpenedPath();

  return (
    <>
      <h1>{CHOOSE_FOLDER_COPY.heading}</h1>
      <p className="lede">{ADD_AGENT_PATHS.lede}</p>

      <div className="add-agent-paths">
        {/*
          The sample first, and it is the only door that needs nothing at all.
          Withheld until the host is known for `ChooseFolder`'s reason: a
          control that appears and then withdraws itself is worse than one that
          arrives a frame late.
        */}
        <section className="section add-agent-path" aria-labelledby="add-agent-sample">
          <h2 id="add-agent-sample">{ADD_AGENT_PATHS.sample.heading}</h2>
          <p className="wrap">{ADD_AGENT_PATHS.sample.means}</p>
          {host === null ? null : <TrySampleAgent canAct={canAct} />}
        </section>

        <section className="section add-agent-path" aria-labelledby="add-agent-assistant">
          <h2 id="add-agent-assistant">{ADD_AGENT_PATHS.assistant.heading}</h2>
          <p className="wrap">{ADD_AGENT_PATHS.assistant.means}</p>
          <p className="muted wrap">{ADD_AGENT_PATHS.assistant.detail}</p>
          {/*
            The setup line is a disclosure rather than a paragraph because it is
            the one thing on this page a person only ever does once. Open by
            default when a link asked for this path by name — `?path=assistant`
            is what a deep link or a piece of documentation points at, and
            landing on a closed disclosure would be arriving at the wrong page.
          */}
          <details open={opened === "assistant"}>
            <summary>{ASSISTANT_SETUP.intro}</summary>
            <CopyableCommand
              text={ASSISTANT_SETUP.command}
              label={ASSISTANT_SETUP.copy_action}
              copied={ASSISTANT_SETUP.copied}
              failed={ASSISTANT_SETUP.copy_failed}
            />
            <p className="muted wrap">{ASSISTANT_SETUP.after}</p>
          </details>
        </section>

        <section className="section add-agent-path" aria-labelledby="add-agent-folder">
          <h2 id="add-agent-folder">{ADD_AGENT_PATHS.folder.heading}</h2>
          <p className="wrap">{ADD_AGENT_PATHS.folder.means}</p>
          <p className="muted wrap">{ADD_AGENT_PATHS.folder.detail}</p>
          {/*
            Rendered only once the host is known, so neither the button nor the
            sentence that replaces it appears for one frame before the other
            does — `AddAgentForm` is withheld below for the same reason.
          */}
          {host === null ? null : <ChooseFolder canAct={canAct} />}
        </section>
      </div>

      <div className="section">
        <details>
          <summary>{CHOOSE_FOLDER_COPY.scaffold_summary}</summary>
          <p className="muted wrap">{CHOOSE_FOLDER_COPY.scaffold_detail}</p>
          {/*
            Verbatim from MAR-428, including `open-in-dash`, because this is the
            one audience for whom a command is the right affordance and the
            shortest path. What moved is where it sits, not what it says.
          */}
          <pre>
            <code>
              {"npx create-dash-agent my-first-agent\n"}
              {"cd my-first-agent\n"}
              {"npm run open-in-dash\n"}
            </code>
          </pre>
          <p className="muted wrap">
            DASH comes to the front and asks whether to add it. Say yes and it
            starts running, and it keeps running when you close this window.
          </p>
        </details>
      </div>

      <div className="section">
        <details>
          <summary>{CHOOSE_FOLDER_COPY.manifest_summary}</summary>
          {unavailable === null ? (
            <>
              <p className="muted wrap">
                For agents that were not built with the Agent Kit and have no
                folder to point at. DASH reads what the agent plans to do and
                what it needs to connect to. It does not run the agent this way,
                and it does not take custody of any credentials.
              </p>
              {/* Rendered only once the host is known, so the installed app
                  never shows a form for one frame before withdrawing it. */}
              {host === null ? null : <AddAgentForm />}
            </>
          ) : (
            <>
              <p className="muted wrap">{unavailable.headline}</p>
              <p className="muted wrap">{unavailable.meaning}</p>
            </>
          )}
        </details>
      </div>
    </>
  );
}

/**
 * Which door a link asked for, if any (MAR-879).
 *
 * ## Why `window.location` and not `useSearchParams`
 *
 * This renderer is a **static export** (`next.config.mjs`). `useSearchParams`
 * suspends during prerender, so a page using it needs a `<Suspense>` boundary
 * and a fallback — `app/runs/detail/page.tsx` carries exactly that scaffolding,
 * and it is worth it there because the whole page is about the run the
 * parameter names. Here the parameter decides one disclosure's open state.
 * Paying for a suspense boundary, a fallback and a router context in every
 * static render of this page — including the one
 * `tests/add-agent-render.test.tsx` takes with no router at all — would be
 * paying a page's worth of machinery for a `<details>`.
 *
 * So it is read from the document after mount, which is the one place the
 * question can be answered without a router. The static render answers "no
 * door was asked for", which is the correct answer for a page opened from the
 * Settings tab.
 */
function useOpenedPath(): "assistant" | null {
  const [opened, setOpened] = useState<"assistant" | null>(null);
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("path");
    setOpened(asked === "assistant" ? "assistant" : null);
  }, []);
  return opened;
}
