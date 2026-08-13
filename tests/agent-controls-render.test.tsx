/**
 * MAR-621's visible contract: an idle manual agent has a local run verb, and
 * the machine/cost disclosures remain attached to that press.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentControls } from "../app/_components/agent-header";
import type { AgentControlView } from "../lib/views/agent-control";
import type { AgentDeployTarget } from "../lib/views/types";

const OBSERVED = "2026-08-13T08:00:00.000Z";
const SPEND =
  "Running AI News Scout sends what it finds to OpenRouter to be summarised, and your own OpenRouter account is charged.";

const HOST: AgentDeployTarget = {
  host_id: "host-1",
  label: "Hostinger",
  sent_at: OBSERVED,
  sent_on: "13 August 2026",
  comparable: true,
  behind: false,
};

function draw(options: {
  run?: AgentControlView["run"];
  hosts?: AgentDeployTarget[];
  hasFiles?: boolean;
  busy?: string | null;
  spend?: string | null;
} = {}): string {
  return renderToStaticMarkup(
    <AgentControls
      busy={options.busy ?? null}
      hasFiles={options.hasFiles ?? false}
      hosts={options.hosts ?? []}
      onCancelKey={(command, runId) => `${command}:${runId}`}
      onRun={() => undefined}
      onRunControl={() => undefined}
      onRunOnHost={() => undefined}
      run={
        options.run ?? {
          kind: "run_now",
          task_id: null,
          observed_at: OBSERVED,
        }
      }
      runSpend={options.spend === undefined ? SPEND : options.spend}
    />,
  );
}

describe("the taskless local run press", () => {
  it("draws Run now and its spend disclosure instead of an empty-queue refusal", () => {
    const html = draw();

    expect(html).toContain(">Run now<");
    expect(html).toContain(SPEND);
    expect(html).toContain("It runs only when you ask");
    expect(html).not.toContain("Nothing is waiting");
  });

  it("names this computer when a second copy makes the target ambiguous", () => {
    const html = draw({ hosts: [HOST] });

    expect(html).toContain("Run now uses the copy on this computer");
    expect(html).toContain("Run on Hostinger");
  });

  it("keeps the files-first label and the cost disclosure on the same control", () => {
    const html = draw({ hasFiles: true });

    expect(html).toContain("Send files and run now");
    expect(html).toContain(SPEND);
  });

  it("has a stable pressed state without a task id", () => {
    expect(draw({ busy: "run:new" })).toContain("Starting");
  });
});
