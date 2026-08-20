/**
 * "Repair this agent", asked (MAR-705).
 *
 * ## Why there is so little here
 *
 * Because the only thing this command needs Electron for is the question. The
 * reading, the validation, the two writes and the runner re-read are all DASH's
 * own store and DASH's own folder, so they live in `lib/folder-repair.ts` and
 * run in the suite on every push — every refusal, the external-registration
 * case, the manifest-only case and the repair itself, none of them behind a
 * native dialog somebody has to press on one developer's Windows box.
 *
 * That is `lib/handoff-flow.ts`'s split rather than `electron/folder-import.ts`'s:
 * the import door has to *read a folder somebody just named*, which is genuinely
 * an Electron job, and this door reads a folder DASH itself put there. The only
 * port is `confirm`, and this file is what fills it in.
 *
 * `main.ts` gains nothing at all. This rides `folderAction`, the dependency it
 * already injects, and that dependency is already handed the runner port — so a
 * fifth folder verb needed no line there.
 *
 * ## What crosses the boundary
 *
 * **Inward: an agent id.** The renderer cannot name a folder, a path or a
 * command — every location is resolved from that id by `lib/agent-folders`,
 * which is `folder.reveal`'s discipline.
 *
 * **Outward: sentences.** No path, no digest, no byte of any file.
 */

import { dialog } from "electron";

import { appWindow } from "./app-window";

import { repairHeldAgent } from "../lib/folder-repair";
import type { RunnerPort } from "../lib/handoff-flow";
import type { FolderActionResult } from "../lib/shell/ipc";

/**
 * Set one agent up again from the copy DASH already keeps.
 *
 * Async because a native dialog sits inside the flow it starts — the one thing
 * this command has in common with `folder.choose` and not with the other three.
 */
export async function repairAgent(
  dataDir: string,
  agent: string,
  runner: Pick<RunnerPort, "reload"> | null,
): Promise<FolderActionResult> {
  return repairHeldAgent(agent, {
    dataDir,
    now: () => new Date(),
    confirm: askUser,
    runner,
  });
}

/**
 * Ask the person, modally, on top of the DASH window if there is one.
 *
 * `cancelId` and `defaultId` both point at "no", for `chooseAgentFolder`'s
 * reason: a dialog that re-points what DASH will spawn when somebody hits Return
 * by reflex is not a consent dialog.
 *
 * **No expiry**, and the difference from the handoff's is the same real one: a
 * handoff is a proposal that arrived from somewhere else and may have been
 * sitting in a queue, while this question is about an agent the person is
 * looking at, in a window they are still in front of.
 */
async function askUser(prompt: {
  title: string;
  message: string;
  detail: string;
  confirm_label: string;
  cancel_label: string;
}): Promise<boolean> {
  const parent = appWindow();
  const options = {
    type: "question" as const,
    title: prompt.title,
    message: prompt.message,
    detail: prompt.detail,
    buttons: [prompt.confirm_label, prompt.cancel_label],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const answer =
    parent === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(parent, options);
  return answer.response === 0;
}
