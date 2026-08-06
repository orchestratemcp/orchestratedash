/**
 * The files a person hands an agent, in words (MAR-507, MAR-434).
 *
 * `lib/copy/artifacts.ts` is the other half of the same journey and this module
 * is written against it: outputs are what a run produced, inputs are what a
 * person gave it. The rules are the same rules and the reasons are the same
 * reasons, so where a decision here matches one there, it says so rather than
 * re-arguing it.
 *
 * ## The role's label comes from the manifest, and the id never appears
 *
 * A `taskInputRole` carries both: `id` is `customer_brief`, technical
 * vocabulary a command carries, and `label` is "Customer brief", which is what
 * a person reads. `lib/copy/identifiers.ts` forbids the first on a guided
 * surface, so `describeInputRole` renders `label` and this module has no branch
 * that can fall back to the id — a fallback is how one appears on screen the day
 * a manifest omits a label, which is exactly when nobody is looking.
 *
 * `describeArtifactRole` takes a `string` rather than a union for a reason that
 * applies here too and lands differently. There, the kind is DASH's own
 * vocabulary and an unknown one is a version skew. Here the role is the *agent
 * author's* vocabulary, so DASH has no table of expected values at all and
 * could not have one: the manifest is the only authority for what this agent
 * calls the things it accepts.
 *
 * ## Three states, because a person acts differently in each
 *
 * - **Selected** — the user picked it and DASH has not finished with it. A
 *   transient state, and it is named rather than hidden behind a spinner
 *   because a large file's copy is not instant and "nothing appears to have
 *   happened" is how a person clicks twice.
 * - **Copied** — the runner has it, hashed, inside the task workspace. This is
 *   the one that means something durable: the bytes are no longer the file on
 *   their disk, so moving or editing the original afterwards changes nothing.
 *   The copy says that, because it is the fact that makes the whole workspace
 *   design worth having and nobody would guess it.
 * - **Rejected** — the runner refused it, **in the runner's own words**. Not a
 *   rewording. `runner/workspace.ts` already answers with a plain sentence per
 *   refusal, and a second vocabulary here would be a second thing to keep true:
 *   the day the runner's limit changes, DASH's rewording is what stays wrong.
 *
 * There is no fourth state for "removed". The runner has no route that takes an
 * admitted input back out, deliberately — see `runner/server.ts`'s note on what
 * the task routes do not offer — so a control for it would be a control DASH
 * cannot honour. What a person does instead is not trigger the task.
 */

/** One role the manifest declares, reduced to what a card renders. */
export interface InputRoleCopy {
  /** The manifest's `label`. What a person reads, and never the id. */
  label: string;
  /**
   * The manifest's `description`, or null.
   *
   * Null rather than a generic stand-in. "Why this agent wants it" is a
   * question only the agent's author can answer, and DASH inventing a sentence
   * for it would be DASH attributing a purpose to somebody else's agent.
   */
  purpose: string | null;
  /**
   * Whether the task can start without it, as a sentence.
   *
   * The schema requires the flag rather than defaulting it, because a renderer
   * that had to guess would guess `false` and let a task start missing the file
   * it exists to read. This is that decision arriving on screen.
   */
  requirement: string;
  /**
   * What the agent says it accepts, or null when it narrowed nothing.
   *
   * Null is honest and is not "anything": the runner's own ceilings still
   * apply, and a role that declared no media types has simply not narrowed
   * them. Saying "any file" would promise a person that a 4 GiB video is
   * welcome.
   */
  accepts: string | null;
}

export type InputState = "selected" | "copied" | "rejected";

export const INPUTS_PANEL_COPY = {
  heading: "Files for this agent",
  /**
   * Shown for an agent whose manifest declares no `task_inputs` at all.
   *
   * Absence must never read as "this agent takes anything": every agent shipped
   * before the block existed declares nothing, and the schema's own note says
   * so. So the empty state is about the agent rather than about the user.
   */
  none_declared: "This agent does not take files.",
  choose: "Choose a file",
  choosing: "Choosing…",
  /**
   * On the copied state, and it is the sentence this whole panel exists for.
   * A person who does not know DASH took a copy will assume that editing the
   * original before the run changes what the agent sees.
   */
  copied_note: "DASH took its own copy. Changing or moving your file now will not change what the agent reads.",
  cancelled: "No file was chosen.",
  /**
   * What "Run now" does once files are attached. Said on the panel rather than
   * only on the button, because the button is elsewhere on the page.
   */
  dispatch_note: "Run now hands these files to the agent and starts it.",
} as const;

/**
 * One declared role, as a card reads it.
 *
 * Takes the manifest's own block. Every string returned is either the author's
 * or DASH's; nothing is derived from a file the user chose, and nothing is
 * derived from an id.
 */
export function describeInputRole(role: {
  label: string;
  description?: string;
  required: boolean;
  min_count?: number;
  max_count?: number;
  media_types?: readonly string[];
  max_file_bytes?: number;
}): InputRoleCopy {
  return {
    label: role.label,
    purpose: role.description === undefined || role.description === "" ? null : role.description,
    requirement: describeRequirement(role),
    accepts: describeAccepts(role.media_types),
  };
}

function describeRequirement(role: {
  required: boolean;
  min_count?: number;
  max_count?: number;
}): string {
  const max = role.max_count;
  if (!role.required) {
    return max === 1 || max === undefined
      ? "Optional. The agent runs without it."
      : `Optional, up to ${String(max)} files. The agent runs without them.`;
  }
  // "Needed" rather than "required": the second is a form-validation word, and
  // this is a sentence about what the agent cannot do rather than about what
  // the user has failed to provide.
  return max === 1 || max === undefined
    ? "Needed. The agent cannot start without it."
    : `Needed, up to ${String(max)} files. The agent cannot start without at least one.`;
}

/**
 * The declared media types, in words a person recognises.
 *
 * Mapped rather than printed. `application/pdf` is a technical identifier by
 * `lib/copy/identifiers.ts`'s own rule, and a card that printed it would be the
 * leak this project keeps a test for. An unmapped type is dropped rather than
 * shown raw — and when everything declared is unmapped the answer is null,
 * which reads as "not narrowed" rather than as "narrowed to nothing".
 *
 * The `.docx` caveat is the schema's own and is worth repeating where a person
 * can act on it: DASH does not open a ZIP container, so a manifest declaring
 * one Office format and not another has narrowed nothing between them.
 */
function describeAccepts(mediaTypes: readonly string[] | undefined): string | null {
  if (mediaTypes === undefined || mediaTypes.length === 0) {
    return null;
  }
  const names = new Set<string>();
  for (const type of mediaTypes) {
    const name = PLAIN_MEDIA_TYPES[type.toLowerCase()];
    if (name !== undefined) {
      names.add(name);
    }
  }
  if (names.size === 0) {
    return null;
  }
  const listed = [...names];
  const last = listed.pop() as string;
  return listed.length === 0
    ? `Accepts ${last} files.`
    : `Accepts ${listed.join(", ")} and ${last} files.`;
}

const PLAIN_MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "application/pdf": "PDF",
  "text/plain": "plain text",
  "text/csv": "spreadsheet (CSV)",
  "text/markdown": "Markdown",
  "text/html": "web page",
  "application/json": "JSON",
  // The schema's note, kept true: DASH sniffs bytes and does not open the
  // container, so every Office format arrives as a ZIP and they cannot be told
  // apart here. One name for the one thing DASH can actually recognise.
  "application/zip": "Office or zipped",
  "image/png": "PNG image",
  "image/jpeg": "JPEG image",
});

/**
 * What to say about one file the user selected.
 *
 * `detail` is the runner's own refusal sentence and is rendered verbatim. The
 * `state` decides the tone and the heading; the runner decides the reason.
 */
export function describeInputState(
  state: InputState,
  context: { detail?: string } = {},
): { label: string; sentence: string } {
  switch (state) {
    case "selected":
      return {
        label: "Copying",
        sentence: "DASH is taking its own copy of this file.",
      };

    case "copied":
      return {
        label: "Ready",
        sentence: INPUTS_PANEL_COPY.copied_note,
      };

    case "rejected":
      return {
        label: "Not accepted",
        // The runner's sentence, or a fallback that says DASH does not know
        // why rather than inventing a plausible reason. `describeSourceFailure`
        // makes the same call.
        sentence: context.detail ?? "The agent's runner would not take this file, and did not say why.",
      };
  }
}
