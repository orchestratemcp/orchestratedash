/**
 * DASH's two removal actions, in the words a person reads before pressing
 * either one (MAR-595 finding 18).
 *
 * A function rather than a string in the component, for `describeDisconnect`'s
 * reason (`lib/host-connect.ts`): a renderer that found either sentence
 * inconvenient must not be able to drop it. The two modes say opposite things
 * about the one fact that matters — whether DASH's own copy of the agent's
 * files survives — and neither may imply the other's outcome.
 */

export interface RemoveAgentCopy {
  headline: string;
  detail: string;
  confirm_label: string;
}

export type RemoveAgentMode = "keep_files" | "delete_files";

export function describeAgentRemoval(displayName: string, mode: RemoveAgentMode): RemoveAgentCopy {
  if (mode === "keep_files") {
    return {
      headline: `Remove “${displayName}” from DASH?`,
      detail:
        "DASH will stop it and take it off this list. DASH's own copy of its code and " +
        "anything it wrote stays on this computer — this does not touch the project you built it in.",
      confirm_label: "Remove from DASH",
    };
  }
  return {
    headline: `Remove “${displayName}” and delete all its files?`,
    detail:
      "DASH will stop it, take it off this list, and delete DASH's own copy of its code " +
      "and everything it wrote. This does not touch the project you built it in, and it " +
      "cannot be undone.",
    confirm_label: "Remove and delete all files",
  };
}
