/**
 * The roles an agent declares it accepts, as a page reads them (MAR-507).
 *
 * `lib/views/artifacts.ts` is the outputs half of the same journey; this is the
 * inputs half, and it is deliberately the smaller of the two. An output has a
 * receipt, an availability and a body DASH stored. A role has no state at all
 * until a person picks a file — it is a declaration, and what it becomes is a
 * conversation with the runner that happens one command at a time.
 *
 * So nothing here reads the store or the runner. It projects the manifest, and
 * that keeps `workspaceView` synchronous and keeps this testable against a
 * manifest fixture rather than against a live task.
 */

import { describeInputRole, type InputRoleCopy } from "../copy/inputs";

/** One declared role on the wire to the renderer. */
export interface InputRoleView extends InputRoleCopy {
  /**
   * The manifest's own `id`, e.g. `customer_brief`.
   *
   * Carried so a command can name which role a file is for, and **never
   * rendered** — `lib/copy/identifiers.ts` forbids it on a guided surface, and
   * `BrokerCapabilityView.id` travels for exactly the same reason.
   *
   * It is the only field here a page must not print, which is why the copy
   * fields are spread in beside it rather than nested under a `copy` key: a
   * renderer reaching for `role.label` cannot accidentally reach `role.id`
   * instead, because they do not look alike.
   */
  id: string;
  /** Whether the task can start without it. The sentence is in `requirement`. */
  required: boolean;
}

/**
 * The manifest's `agent_dom.task_inputs`, or an empty list.
 *
 * **Empty means the agent takes no files**, and that is different from "takes
 * anything". Every agent shipped before the block existed declares nothing, and
 * the schema's own description says absence must never be read as an
 * unrestricted agent. `INPUTS_PANEL_COPY.none_declared` is the sentence that
 * keeps that true on screen.
 *
 * Roles missing `id` or `label` are dropped rather than rendered with a
 * stand-in. A card headed with a raw id is the leak `lib/copy/identifiers.ts`
 * exists to prevent, and a card headed "Untitled" invites a person to hand a
 * document to something that could not describe what it wanted.
 */
export function buildInputRoles(manifest: unknown): InputRoleView[] {
  const declared = (
    manifest as { agent_dom?: { task_inputs?: unknown } } | null
  )?.agent_dom?.task_inputs;
  if (!Array.isArray(declared)) {
    return [];
  }

  const roles: InputRoleView[] = [];
  for (const candidate of declared) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const role = candidate as {
      id?: unknown;
      label?: unknown;
      description?: unknown;
      required?: unknown;
      min_count?: unknown;
      max_count?: unknown;
      media_types?: unknown;
      max_file_bytes?: unknown;
    };
    if (typeof role.id !== "string" || role.id.length === 0) {
      continue;
    }
    if (typeof role.label !== "string" || role.label.length === 0) {
      continue;
    }

    roles.push({
      id: role.id,
      // Absent is read as needed, which is the safe direction and the one the
      // schema argues for: a renderer guessing `false` lets a task start
      // missing the file it exists to read.
      required: role.required !== false,
      ...describeInputRole({
        label: role.label,
        description: typeof role.description === "string" ? role.description : undefined,
        required: role.required !== false,
        min_count: typeof role.min_count === "number" ? role.min_count : undefined,
        max_count: typeof role.max_count === "number" ? role.max_count : undefined,
        media_types: Array.isArray(role.media_types)
          ? role.media_types.filter((type): type is string => typeof type === "string")
          : undefined,
        max_file_bytes: typeof role.max_file_bytes === "number" ? role.max_file_bytes : undefined,
      }),
    });
  }
  return roles;
}

/**
 * The limits one declared role narrows the runner to.
 *
 * Read in **main**, from the manifest, at the moment a file is admitted — never
 * carried to the renderer and never accepted from it. `connection.connect` draws
 * the same line: the renderer names which thing it means and main supplies
 * everything that decides what happens.
 *
 * A renderer-supplied limit block could only ever be ignored or obeyed, and
 * both are bad. Obeyed, it lets a page widen what the agent declared; ignored,
 * it is a field on the wire that means nothing, which is the kind of field a
 * later reader believes.
 *
 * Null when the manifest declares no such role, which is the case a command
 * naming an unknown role must be refused on rather than admitted with the
 * runner's defaults.
 */
export function declaredLimitsFor(
  manifest: unknown,
  roleId: string,
): { max_count?: number; media_types?: string[]; max_file_bytes?: number; max_total_bytes?: number } | null {
  const declared = (
    manifest as { agent_dom?: { task_inputs?: unknown } } | null
  )?.agent_dom?.task_inputs;
  if (!Array.isArray(declared)) {
    return null;
  }
  for (const candidate of declared) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const role = candidate as Record<string, unknown>;
    if (role["id"] !== roleId) {
      continue;
    }
    const limits: {
      max_count?: number;
      media_types?: string[];
      max_file_bytes?: number;
      max_total_bytes?: number;
    } = {};
    if (typeof role["max_count"] === "number") limits.max_count = role["max_count"];
    if (typeof role["max_file_bytes"] === "number") limits.max_file_bytes = role["max_file_bytes"];
    if (typeof role["max_total_bytes"] === "number") limits.max_total_bytes = role["max_total_bytes"];
    if (Array.isArray(role["media_types"])) {
      limits.media_types = role["media_types"].filter(
        (type): type is string => typeof type === "string",
      );
    }
    return limits;
  }
  return null;
}
