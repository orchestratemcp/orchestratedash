/**
 * Constraints the schema cannot express, checked at import (MAR-482).
 *
 * ADR 0006: "A manifest that asks for both is a contradiction DASH must refuse
 * at import, not discover at runtime." The both in question is a runtime
 * declared away from this computer and a connection DASH would have to manage
 * for it. The transport already makes the combination impossible — a brokered
 * request can only arrive through a child DASH's own runner spawned, over a
 * socket with no remote address — so this check widens nothing and narrows
 * nothing. It only stops DASH accepting a promise it will never keep, and a
 * user finding that out afterwards as a row under "What DASH cannot account
 * for".
 *
 * Two boundaries this module deliberately respects:
 *
 * - **The manifest's claim is copy, not gating.** ADR 0006 is explicit that
 *   `locations.runtime.kind` is the author's claim about their own agent, with
 *   the same standing as `draft.placement`: worth refusing a contradiction
 *   over, never worth handing a grant to. A manifest declaring `local` while
 *   the process runs elsewhere gets nothing extra from the lie, because the
 *   transport decides, not this check.
 * - **Import, not re-read.** This runs in the two doors a manifest enters
 *   DASH through — `lib/store.ts`'s `importManifest` and the handoff flow —
 *   and not in `validateManifest`, which `runner/supervisor.ts` and
 *   `lib/db.ts` also run over manifests imported long ago. A constraint that
 *   tightened retroactively would strand an already-imported agent in an
 *   unreadable row, which is a worse outcome than the one this check exists
 *   to prevent.
 *
 * The error string is technical register, like the Ajv strings it travels
 * beside — `lib/import-feedback.ts` recognises it and says the plain-language
 * version, which is the same division of labour `validateManifest`'s
 * unsupported-version sentence already uses.
 */

import type { AnyAgentManifest } from "./contracts";
import { isManifestV2 } from "./contracts";
import type { ManifestConnection } from "./connections";
// The phrase lives in `lib/import-feedback.ts` and is imported from it, not
// the reverse — that module is bundled into a client component and must not
// reach this one, which drags `lib/contracts.ts` and its `node:fs` reads in.
import { REMOTE_DASH_MANAGED_PHRASE } from "./import-feedback";

export { REMOTE_DASH_MANAGED_PHRASE };

/**
 * Everything wrong with an otherwise schema-valid manifest, as error strings.
 * Empty means importable. Shaped like `ValidationResult`'s errors so the two
 * kinds of refusal travel the same road to the same explanation layer.
 */
export function checkManifestConstraints(manifest: AnyAgentManifest): string[] {
  if (!isManifestV2(manifest)) {
    // v1 has no Agent DOM, so it has neither of the two fields whose
    // combination this refuses.
    return [];
  }

  // `agent_dom.locations` is outside the subset `AgentManifestV2` types,
  // because nothing else in lib/ reads it. Read defensively rather than
  // widening the interface for one consumer.
  const locations = manifest.agent_dom["locations"] as
    | { runtime?: { kind?: unknown } }
    | undefined;
  const runtimeKind = locations?.runtime?.kind;

  const connections: ManifestConnection[] = manifest.agent_dom.connections ?? [];
  const dashManaged = connections.filter(
    (connection) => connection.ownership === "dash_managed",
  );

  if (runtimeKind === "remote" && dashManaged.length > 0) {
    const named = dashManaged.map((connection) => connection.label).join(", ");
    return [
      `/agent_dom ${REMOTE_DASH_MANAGED_PHRASE} (${named}); ` +
        "an agent running away from this computer can never reach one (ADR 0006)",
    ];
  }

  return [];
}
