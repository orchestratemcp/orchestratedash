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

/**
 * The one name a person reads for an agent (MAR-589, MAR-609).
 *
 * ## The ruling this encodes
 *
 * MAR-589 put two options to Henrik — the id is the name everywhere, or a
 * display name is a first-class field and the id becomes a *value*. He chose the
 * second. So every surface that labels an agent calls this, and every surface
 * that needs the id renders it in a monospace value slot instead, never as a
 * label. `humanizeAgentName` above is the fallback *inside* this function and is
 * no longer something a caller should reach for directly to make a title.
 *
 * ## Why a function and not a column, yet
 *
 * The author's `display_name` is the only name DASH holds. The `agents` table
 * has no name column of its own — it carries `name`, `manifest_version`,
 * `manifest_json`, `imported_at`, `avatar` — so a person cannot rename an agent
 * and there would be nowhere to put it if they could. That is the other half of
 * MAR-589 and it is filed rather than built here: the write path needs a
 * migration, an IPC command and a preload method, and the preload is owned by a
 * live session.
 *
 * Callers therefore get the *reading* half of the ruling now — one name, chosen
 * one way, in one place — and a stored name can be slotted into this function
 * later without touching a single surface. That is the whole reason the two
 * expressions this replaced could not stay inline: `lib/views/build.ts` spelled
 * `display_name ?? humanize(name)` twice, and a third caller wanting a title
 * would have written a third.
 */
export function agentDisplayName(agent: {
  name: string;
  display_name?: string | undefined;
}): string {
  const declared = agent.display_name?.trim() ?? "";
  return declared === "" ? humanizeAgentName(agent.name) : declared;
}
