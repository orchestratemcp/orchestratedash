/**
 * What DASH pushes to a host, and the two refusals in front of it (MAR-487,
 * ADR 0007).
 *
 * Pure over an in-memory file list: the caller reads bytes off disk, this
 * decides what may travel and turns it into an `install` request. That split is
 * `lib/hosts.ts`'s and it buys the same thing — the rules run in CI on a machine
 * with no host, no key and no network.
 *
 * ## What a bundle is
 *
 * ADR 0007 amendment 1 answered the question this file would otherwise have to:
 *
 * > **The remote process is this repository's runner, built as a standalone
 * > artifact. The host supplies the Node runtime; DASH does not ship one.**
 *
 * So a bundle is `dist/runner-standalone/` — entry point, runner, frozen
 * contracts, `package.json` — plus the agent's registration and manifest, plus
 * the host helper. Nothing is invented here; the artifact already exists and
 * `tests/runner-standalone.test.ts` already proves it starts under a plain Node
 * on a tree containing nothing but itself.
 *
 * ## The refusal MAR-487 asks for, before a byte ships
 *
 * The issue's own words: *"the bundle's manifest must be legal under MAR-482's
 * validator — a `remote` runtime with `dash_managed` connections is refused
 * before a byte ships."*
 *
 * That refusal already runs at both import doors. It runs **again** here, and
 * the repetition is deliberate rather than defensive: import happens once, a
 * deploy happens whenever somebody presses the button, and the manifest on the
 * agent could have been re-imported by a build of DASH that predates the
 * constraint. More decisively, this is the door where the consequence changes —
 * at import the cost of a contradiction is a lapse row, and here it is a
 * credential-shaped promise made on a machine DASH cannot reach.
 *
 * ## The receipt, which is not decoration
 *
 * ADR 0006's option-1 receipt is required **before the user confirms the push**,
 * and it is here rather than in a component so it is testable and so a renderer
 * that found it discouraging cannot drop it. An agent on a host holds its own
 * credentials: DASH cannot narrow what it does, cannot show what it did, and
 * cannot take it away. Every one of those three is a thing DASH says about
 * *itself*, which is what makes them checkable claims rather than reassurance.
 */

import { createHash } from "node:crypto";

import { checkManifestConstraints } from "../manifest-constraints";
import type { AnyAgentManifest } from "../contracts";
import { MAX_BUNDLE_BYTES, type BundleFile, type InstallRequest } from "./verbs";

/* ---------------------------------------------------------------------- *
 * Assembly
 * ---------------------------------------------------------------------- */

/** A file the caller read, before it is turned into something that travels. */
export interface SourceFile {
  /** Relative, `/`-separated, inside the bundle. */
  path: string;
  content: Uint8Array;
  /** True for an entry point. Everything else is data. */
  executable?: boolean;
}

export type BundleProblem =
  | "manifest_refused"
  | "no_entry_point"
  | "empty"
  | "too_large"
  | "malformed_path";

export type BundleResult =
  | { ok: true; request: InstallRequest; bytes: number }
  | { ok: false; problem: BundleProblem; detail: string };

/**
 * The one file a bundle cannot be without.
 *
 * `start.mjs` is what MAR-497's artifact documents as its entry point and what
 * the host helper's `start` verb runs — because *the helper* decided that, not
 * because a request says so. Requiring it here means a bundle that could not be
 * started is refused while somebody is still looking at DASH, rather than
 * installing cleanly and failing on a host at the next press.
 */
export const BUNDLE_ENTRY_POINT = "start.mjs";

export function assembleBundle(options: {
  bundle_id: string;
  agent_id: string;
  runner_build: string;
  manifest: AnyAgentManifest;
  files: SourceFile[];
}): BundleResult {
  /*
   * MAR-482's refusal, run again at the door where the consequence changes.
   * Before anything is hashed, so a contradictory manifest costs no work and,
   * more to the point, so nothing about the bundle exists to be sent by a later
   * branch that forgot to check.
   */
  const constraints = checkManifestConstraints(options.manifest);
  if (constraints.length > 0) {
    return {
      ok: false,
      problem: "manifest_refused",
      detail:
        `This agent cannot be put on a server: ${constraints[0] ?? "its manifest is contradictory"}. ` +
        `Nothing was sent.`,
    };
  }

  if (options.files.length === 0) {
    return { ok: false, problem: "empty", detail: "There was nothing to send." };
  }
  if (!options.files.some((file) => file.path === BUNDLE_ENTRY_POINT)) {
    return {
      ok: false,
      problem: "no_entry_point",
      detail: `A bundle must carry ${BUNDLE_ENTRY_POINT}, which is what the server runs.`,
    };
  }

  let bytes = 0;
  const files: BundleFile[] = [];
  for (const source of options.files) {
    if (source.path.length === 0 || source.path.startsWith("/") || source.path.includes("\\")) {
      // Backslashes are refused rather than normalised. A bundle is described in
      // one spelling — `/`-separated, relative — and a sender that quietly
      // rewrote paths would be a sender whose idea of a file name differs from
      // the helper's, which is where a containment check stops meaning anything.
      return {
        ok: false,
        problem: "malformed_path",
        detail: "A bundle file's name must be a relative path with forward slashes.",
      };
    }
    bytes += source.content.byteLength;
    if (bytes > MAX_BUNDLE_BYTES) {
      return {
        ok: false,
        problem: "too_large",
        detail: `A bundle is at most ${String(MAX_BUNDLE_BYTES / (1024 * 1024))} MB.`,
      };
    }
    const content = Buffer.from(source.content);
    files.push({
      path: source.path,
      content_base64: content.toString("base64"),
      sha256: createHash("sha256").update(content).digest("hex"),
      // Two values and no third. `lib/deploy/verbs.ts` refuses anything else on
      // arrival, and the reason is that a mode is a small closed choice here.
      mode: source.executable === true ? 0o755 : 0o644,
    });
  }

  return {
    ok: true,
    bytes,
    request: {
      verb: "install",
      bundle_id: options.bundle_id,
      agent_id: options.agent_id,
      runner_build: options.runner_build,
      files,
    },
  };
}


/* ---------------------------------------------------------------------- *
 * What the person is told before they press it
 *
 * Moved to `lib/deploy/receipt.ts` (MAR-498) and re-exported here so every
 * existing call site keeps working. The move is not tidiness: this module
 * imports `node:crypto` to hash bundle files, and the connect-a-server wizard
 * is a `"use client"` page that needs the receipt. Importing a value from here
 * put a Node builtin in the browser bundle and the packaged renderer stopped
 * hydrating altogether — every page drew its background colour and nothing
 * else, with no chrome, no agents and no error on screen.
 *
 * A client component must import from `./receipt` directly, which is the whole
 * point of it being a separate file.
 * ---------------------------------------------------------------------- */

export {
  describeDeployArrangement,
  describeDeployReceipt,
  type DeployReceipt,
} from "./receipt";
