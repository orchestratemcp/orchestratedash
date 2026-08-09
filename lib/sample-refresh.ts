/**
 * An agent DASH scaffolded, whose saved document is older than DASH's own
 * template (MAR-576).
 *
 * ## The defect this exists for
 *
 * DASH ships one demo agent. `agent-kit/scaffold.ts` gives it a declared panel
 * — `report(digest)`, `metrics`, `table` — so a person who adds it today gets a
 * page that opens on the news it found. A person who added it *before* MAR-548
 * has a manifest with no `agent_dom.panel` in it, and MAR-553's migration
 * deliberately never rewrites an author's document, so nothing has ever
 * upgraded it and nothing ever will.
 *
 * The rule that migration follows is correct and is not being changed here.
 * What was missing is the other half: DASH knew the document was behind and
 * said nothing, so the product's only demo agent looked like an agent that
 * produces nothing. This module is what lets a surface say so, and what lets a
 * person do something about it in one press.
 *
 * ## Pure, and it has to stay that way
 *
 * No `node:fs`, no store. `describeManifestGap` runs inside `workspaceView`,
 * whose result crosses the IPC boundary into the renderer bundle, and
 * `refreshedManifest` is called from Electron main — but both are decisions
 * about a document, and a decision about a document is testable against a
 * fixture. The writing half is `importManifest`, which already exists and which
 * this deliberately does not reimplement.
 */

import { scaffoldManifest } from "../agent-kit/scaffold";
import { PANEL_PREDATES_CAPABILITY, type PanelCard } from "./copy/panel";

/**
 * The provenance DASH's own scaffold stamps on what it writes.
 *
 * Matched as a prefix because the version follows it —
 * `create-dash-agent 43.2.0`. Pinned as a constant rather than spelled inline at
 * the two comparison sites, so the day the scaffold renames itself there is one
 * place that stops agreeing rather than two places that quietly still do.
 */
export const SCAFFOLD_PROVENANCE_PREFIX = "create-dash-agent";

/**
 * What a surface needs in order to say the sentence and offer the action.
 *
 * The card is `PanelCard`, the shape the other two panel-state cards already
 * use, so a renderer draws this with the component it already has rather than
 * with a fourth notice layout.
 */
export interface ManifestGapView {
  card: PanelCard;
  /**
   * Whether DASH can actually repair this one itself.
   *
   * Separate from the card, because the sentence is true whether or not the
   * button is offered and the button must never be offered on a guess. Today it
   * is `true` exactly when the gap was detected, since detection *is* the
   * scaffold-provenance test — but a future gap DASH can describe and not fix
   * would set this `false` and get the sentence with no control, which is the
   * honest rendering rather than a dead button.
   */
  repairable: boolean;
}

/* ---------------------------------------------------------------------- *
 * Reading a stored document
 * ---------------------------------------------------------------------- */

interface ScaffoldShape {
  agent?: { name?: unknown; display_name?: unknown; goal?: unknown };
  provenance?: { generated_by?: unknown };
  agent_dom?: Record<string, unknown>;
}

/** Whether DASH's own scaffold wrote this document. */
export function isScaffoldedByDash(manifest: unknown): boolean {
  const generatedBy = (manifest as ScaffoldShape | null)?.provenance?.generated_by;
  return (
    typeof generatedBy === "string" && generatedBy.startsWith(SCAFFOLD_PROVENANCE_PREFIX)
  );
}

/**
 * Whether the stored document declares the panel DASH's template now declares.
 *
 * `hasOwnProperty` rather than a truthiness check, and rather than running
 * `resolvePanel`. The question here is not "is this panel drawable" — that is
 * `lib/panel-spec.ts`'s job and it has three answers of its own, two of which
 * are already reported by their own cards. The question is whether the author's
 * document has the key at all, which is the one thing that distinguishes "this
 * template predates the feature" from "this panel is broken". A manifest with a
 * malformed panel gets `PANEL_UNREADABLE` from the existing path and must not
 * also be told it is old, because it is not.
 */
function declaresPanel(manifest: unknown): boolean {
  const dom = (manifest as ScaffoldShape | null)?.agent_dom;
  return (
    typeof dom === "object" && dom !== null && Object.prototype.hasOwnProperty.call(dom, "panel")
  );
}

/**
 * The sentence to show for this agent, or null when there is nothing to say.
 *
 * Both conditions are required and the order is not an optimisation — it is the
 * whole argument for why this is not noise. An ordinary agent that declares no
 * panel gets nothing, because for that author the absence is a choice. Only a
 * document DASH itself generated can be *behind DASH's own template*, and only
 * then is the absence a gap rather than a decision.
 */
export function describeManifestGap(manifest: unknown): ManifestGapView | null {
  if (!isScaffoldedByDash(manifest) || declaresPanel(manifest)) {
    return null;
  }
  return { card: PANEL_PREDATES_CAPABILITY, repairable: true };
}

/* ---------------------------------------------------------------------- *
 * Producing the replacement
 * ---------------------------------------------------------------------- */

export interface RefreshRequest {
  /** The kit version to stamp into the new document's provenance. */
  kitVersion: string;
  now: Date;
}

export type RefreshResult =
  | { ok: true; manifest: Record<string, unknown> }
  | { ok: false; problem: string };

/**
 * The document DASH's template writes today, for an agent that already exists.
 *
 * ## Identity comes from the stored document, capability from the template
 *
 * That split is the entire design. `agent.name` must survive because it is the
 * store's primary key, the folder name and the seed the character is drawn
 * from — a refresh that changed it would not be a refresh, it would be a second
 * agent. `display_name` and `goal` survive because they are what the person
 * reads on the card they have learned to recognise, and because a user who
 * retitled their sample should not have DASH quietly rename it back.
 *
 * Everything else is taken from the template, deliberately and not
 * field-by-field. Patching in only the missing `panel` was the alternative and
 * was declined: it fixes exactly today's gap and leaves the next capability to
 * be discovered the same way this one was — by a user reporting that the
 * product's demo agent appears to do nothing. Regenerating means an agent DASH
 * scaffolded is never more than one press behind DASH itself.
 *
 * ## What this cannot do, and why the caller must gate it
 *
 * This will happily regenerate any manifest handed to it, so **the caller must
 * check `isScaffoldedByDash` first** — and `refreshSampleManifest` in
 * `electron/main.ts` is where that check lives, beside the store write it
 * guards. Running it over a document a human wrote would discard their work and
 * hand back DASH's template wearing their agent's name. The check is not here
 * because this function's job is to build a document, and a builder that also
 * decided whether it was allowed to would be two decisions in a place a test
 * can only reach one of them.
 *
 * `provenance.generated_at` and the kit version genuinely move, and that is
 * correct rather than incidental: the document really was written by this kit,
 * now. Backdating it would make the one field that records where a manifest
 * came from lie about which template produced it.
 */
export function refreshedManifest(
  stored: unknown,
  request: RefreshRequest,
): RefreshResult {
  const agent = (stored as ScaffoldShape | null)?.agent;
  const name = agent?.name;
  const displayName = agent?.display_name;
  const goal = agent?.goal;

  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, problem: "DASH could not read this agent's name from its saved setup." };
  }
  if (typeof goal !== "string" || goal.length === 0) {
    return { ok: false, problem: "DASH could not read this agent's goal from its saved setup." };
  }

  return {
    ok: true,
    manifest: scaffoldManifest({
      // Unread by `scaffoldManifest` — see its header. Named rather than left
      // as an empty string so a reader of this call is not left wondering which
      // directory an existing agent is supposed to be re-scaffolded into.
      directory: "",
      agent_id: name,
      display_name:
        typeof displayName === "string" && displayName.length > 0 ? displayName : name,
      summary: goal,
      kit_version: request.kitVersion,
      now: request.now,
    }),
  };
}
