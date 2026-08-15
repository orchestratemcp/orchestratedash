/**
 * Which part of an agent is on screen, as a value in the address bar
 * (MAR-641).
 *
 * ## Why a stage is a URL parameter and not a piece of React state
 *
 * The agent page is a fixed frame around one swappable centre. The obvious
 * implementation is `useState`, and it is the wrong one for the same three
 * reasons `SETTINGS_TABS` are five routes rather than five states of one page:
 *
 * 1. **The back button.** A person who presses Logs and then wants what they
 *    were looking at has one gesture for that, and it is the one the operating
 *    system gave them. State that a navigation cannot address makes Back leave
 *    the agent entirely.
 * 2. **Deep links.** `lib/open-link.ts` names a surface and asks for it to be
 *    shown, and MAR-586's fleet chip already points at `#waiting-work` on this
 *    page. A chip that means *go to the thing that needs you* has to be able to
 *    name both the agent and the part of it.
 * 3. **The capture harnesses.** `electron/capture-deploy.ts` photographs a
 *    *route*. A stage behind a click is a stage photographed by a harness that
 *    has to learn to click, and MAR-577's density note records what becomes of
 *    a harness that clicks: it mislabels half its images.
 *
 * The static export cannot answer `/agents/detail/logs`, which is why this is a
 * query parameter rather than a path segment — the same constraint that put the
 * agent id and the run id in query strings (see `app/_data/routes.ts`).
 *
 * ## Pure, and therefore importable by the page
 *
 * No clock, no store, no disk. This module is handed what the view already
 * built and returns a decision about it, so it can live in the `"use client"`
 * tree without dragging `node:fs` into the browser bundle — the rule
 * `lib/views/agent-control.ts` states and `tests/client-bundle` enforces.
 */

/**
 * Every part of an agent that has a view of its own.
 *
 * Seven were named in the wireframe and six are here. **Health is deliberately
 * absent**: it is the one stage that is not a rearrangement of something the
 * page already draws — it aggregates five recorded facts into a pass/warn/fail
 * list that nothing in this repository computes yet — so it arrives with its
 * own slice rather than as a name in a list that leads nowhere. A stage id that
 * resolves to an empty room is the dead control `lib/workspace.ts` forbids,
 * wearing a URL.
 */
export const AGENT_STAGES = [
  "overview",
  "run",
  "output",
  "chat",
  "settings",
  "logs",
] as const;

export type AgentStage = (typeof AGENT_STAGES)[number];

/** Whether a string names a stage this build can draw. */
export function isAgentStage(value: string | null): value is AgentStage {
  return value !== null && (AGENT_STAGES as readonly string[]).includes(value);
}

/**
 * The stage to draw, from what the address asked for and what the agent is
 * doing.
 *
 * ## An unknown stage is the overview, never an error
 *
 * A link from an older build, a typo in a hand-written URL, or the Health stage
 * before it exists all arrive here as a string this build does not know. The
 * answer is the default view of the agent, because the alternative — an error
 * page for a parameter — would turn a link that has aged into a dead end, and
 * because a person who followed a link to an agent wanted the agent.
 *
 * ## The run stage takes over only when nobody has chosen
 *
 * The wireframe asks for the Run view to *auto-take the stage while live*, and
 * taken literally that is a surface which yanks the page out from under a
 * reader: somebody reading last week's digest while a run starts would lose it
 * mid-sentence, and worse, would lose it again every time they navigated back.
 *
 * So the rule is narrower and, read out loud, is the same promise: **an address
 * that names no stage resolves to the run while one is going.** Arriving at the
 * agent during a run puts the run in front of you, pressing Trigger run puts
 * the run in front of you because that control names the stage, and an address
 * that says `output` is honoured for exactly as long as the person leaves it
 * there. Nothing on screen moves without somebody asking for it — the design
 * brief's rule, applied to the one part of this page that could move on its
 * own.
 */
export function resolveAgentStage(
  requested: string | null,
  facts: { running: boolean },
): AgentStage {
  if (isAgentStage(requested)) {
    return requested;
  }
  return facts.running ? "run" : "overview";
}
