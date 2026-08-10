/**
 * Turn a manifest's machine-readable agent id into something a person would
 * accept as a name, for the one moment DASH has nothing better.
 *
 * The normal source of a person-facing name is `agent.display_name`. Every
 * DASH-authored path emits one — the Agent Kit scaffold, the sample agent —
 * but the MCP planner does not (MAR-595 finding 4's sibling gap: it also omits
 * `default_model_level`), so an MCP-planned agent's manifest carries only
 * `agent.name`, a slug like `support-mail-digest`. Before this existed that
 * slug rendered verbatim wherever DASH shows an agent's title — finding 10.
 *
 * This does not invent a name DASH was not given. It only stops literally
 * showing the computer's spelling of one: `"support-mail-digest"` becomes
 * `"Support mail digest"`, sentence case rather than every word capitalised,
 * because a title is a name and not a heading.
 *
 * `lib/sample-agent.ts` had its own copy of this exact function (`titleCase`)
 * for the same reason — a folder name standing in for a display name — before
 * this module existed to hold the one definition both call.
 */
export function humanizeAgentName(value: string): string {
  const words = value.replace(/[-_.]+/g, " ").trim();
  if (words.length === 0) {
    return value;
  }
  return words[0].toUpperCase() + words.slice(1);
}
