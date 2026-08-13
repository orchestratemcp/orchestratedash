/**
 * The local Run press at the join between a workspace task and an Agent DOM
 * retry (MAR-507, MAR-621).
 *
 * The two task concepts are deliberately not collapsed. `dispatchWorkspace`
 * owns any person-selected files and may have its own runner task id. `taskId`
 * below is the optional task the agent published in its state. The first must
 * finish before the retry leaves; the second is omitted when the agent has no
 * queue, rather than replaced with an empty workspace task.
 */

export type FreshRunTarget = { task_id?: string };

export async function startLocalRun(
  taskId: string | null,
  dispatchWorkspace: () => Promise<boolean>,
  retry: (target: FreshRunTarget) => Promise<void>,
): Promise<boolean> {
  if (!(await dispatchWorkspace())) {
    return false;
  }

  await retry(taskId === null ? {} : { task_id: taskId });
  return true;
}
