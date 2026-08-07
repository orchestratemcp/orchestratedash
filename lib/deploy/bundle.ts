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
 * ---------------------------------------------------------------------- */

export interface DeployReceipt {
  /** The heading. What is about to happen, in one line. */
  what: string;
  /**
   * ADR 0006's option-1 sentences, each a statement about what **DASH** cannot
   * do rather than about what the agent will do. That is what keeps them
   * checkable: DASH knows its own reach, and it does not know the agent's.
   */
  limits: string[];
  /** The revocation that actually works, which is the only one worth offering. */
  revocation: string;
}

/**
 * The receipt shown **before** the user confirms a push.
 *
 * Before, for ADR 0002 amendment 2's reason: a disclosure that arrives after
 * the grant describes a window the person was already inside. And plain
 * language throughout — no field names, no environment variable names, no
 * filenames — which is `lib/copy/identifiers.ts`'s rule and the test ADR 0007
 * sets for this whole plane: *a receipt that cannot describe the arrangement
 * honestly rules the option out.*
 *
 * The third limit is the unpleasant one and it is not softened. Turning a
 * connection off in DASH does not stop an agent that holds its own credentials
 * on a machine the user administers, and a sentence that implied otherwise
 * would be the exact dishonesty ADR 0006 spent its length refusing.
 */
export function describeDeployReceipt(agentName: string, hostLabel: string): DeployReceipt {
  return {
    what: `${agentName} will be copied to ${hostLabel} and run there.`,
    limits: [
      "This agent signs in itself, on the server where it runs. DASH does not hold its sign-ins and cannot limit what it does with them.",
      "DASH can only show you what the server still has when it looks. Anything the server discarded before then, DASH will never see.",
      "Turning this off in DASH does not stop it. The agent keeps running on the server whether DASH is open, closed, or uninstalled.",
    ],
    revocation:
      `To stop it for certain, stop it on ${hostLabel} — DASH can ask, and the server is what decides.`,
  };
}
