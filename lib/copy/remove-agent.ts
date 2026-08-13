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

/**
 * The gate Henrik asked for on the issue that became MAR-611, ADR 0017:
 *
 * > "If an agent lives on VPS - It should disconnect and delete/copy down to
 * > the local file... Then if you still want to delete the agent you delete
 * > it locally."
 *
 * Removing an agent from DASH has never touched a server — `removeAgent` and
 * `removeAgentKeepFiles` are local acts, and nothing about them was ever going
 * to reach a machine DASH connects to over SSH. What was missing was the
 * warning: a person removing an agent that is still sent somewhere had no way
 * to learn that from this screen, and would find out by the server still
 * answering to a name DASH no longer has any record of.
 */
export interface StrandedByRemovalCopy {
  headline: string;
  detail: string;
  bring_home_label: string;
  proceed_label: string;
}

/** How the server list reads in a sentence — one name, two names, or a list. */
function nameServers(servers: readonly string[]): string {
  if (servers.length === 1) {
    return servers[0] ?? "that server";
  }
  if (servers.length === 2) {
    return `${servers[0]} and ${servers[1]}`;
  }
  return `${servers.slice(0, -1).join(", ")}, and ${servers[servers.length - 1]}`;
}

export function describeStrandedByRemoval(
  displayName: string,
  servers: readonly string[],
): StrandedByRemovalCopy {
  const plural = servers.length > 1;
  const list = nameServers(servers);
  return {
    headline: `“${displayName}” is still on ${list}.`,
    detail:
      `Removing it here does not touch the copy ${plural ? "on those servers" : "on that server"} — ` +
      `it keeps running there, and once it is off this list DASH can no longer reach it to bring it ` +
      `home or take it off. Bring it home first if you want its files, and to take it off ` +
      `${plural ? "those servers" : "that server"} too.`,
    bring_home_label: "Bring it home first",
    proceed_label: `Remove here and leave ${plural ? "them" : "it"} there`,
  };
}

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
