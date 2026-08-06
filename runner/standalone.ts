/**
 * The standalone runner's entry point (MAR-497).
 *
 * What starts on a host DASH was never installed on. `runner/main.ts` is
 * unchanged and is still the runner; this is the four things that were being
 * done *for* it by `electron/runner-process.ts` and by the MSIX install, done
 * by the artifact itself instead:
 *
 * 1. **Check the runtime before anything touches the store.** See
 *    `runner/host-runtime.ts` for why that is a refusal with a sentence in it
 *    rather than a stack trace out of SQLite.
 * 2. **Decide the data directory**, because there is no `app.getPath("userData")`
 *    here and `DASH_RUNNER_DATA_DIR` is required by `runner/main.ts` with a
 *    message — "the runner is started by DASH, not by hand" — that stopped
 *    being true the moment this file existed.
 * 3. **Create it and harden it owner-only**, which the Windows install got from
 *    the user profile's own ACL and a VPS home directory does not get from
 *    anything. It holds a person's inputs, their agents' outputs and the
 *    channel credential.
 * 4. **Hand over.** `runner.mjs` is imported rather than linked, so the module
 *    that fails to load when `node:sqlite` is missing is not this one.
 *
 * ## Why this is a second file and not a branch inside `runner/main.ts`
 *
 * Because of point 4, and it is the whole reason the split is worth a file.
 * `runner/main.ts` reaches `runner/store.ts`, which imports `node:sqlite` at
 * the top level. A preflight living in that module graph would run *after* the
 * import it exists to check, so on the host it is written for it would never
 * execute. The check has to be in a module that does not import the thing it is
 * checking, and the handover therefore has to be dynamic.
 *
 * The same split is what lets the artifact's start command be one command.
 * There is no wrapper shell script, nothing to `chmod +x`, and nothing that
 * behaves differently under a service manager than it does in a terminal.
 *
 * ## What this deliberately does not do
 *
 * **No restart policy, no service file, no boot integration.** `runner/README.md`
 * item 3 records that there is no restart policy anywhere in DASH on purpose,
 * and ADR 0007 names restart-on-boot as its own undecided question. A systemd
 * unit chosen in passing here would be DASH making a supervision claim about a
 * machine it cannot see, which is the one thing the whole of ADR 0006 is about
 * not doing. Starting this under a service manager is an operator's decision
 * and the artifact does not make it for them.
 *
 * **No exports.** This module runs when it is imported, so anything a test or
 * another module needs to know about the host convention — the data directory
 * default, the exit code for an unsuitable host — lives in
 * `runner/host-runtime.ts` instead. Importing an entry point to read a constant
 * out of it would start a runner.
 *
 * **No listener, and nothing dials in.** The endpoint is the same Unix socket
 * `runner/endpoint.ts` binds locally, for the same reason and with the same
 * 0700 runtime directory. ADR 0007's transport reaches it over `ssh` from the
 * user's machine; nothing about running on a host opens a port.
 */

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { hardenOwnerOnly } from "./channel-secret";
import {
  checkNodeVersion,
  defaultDataDir,
  describeMissingSqlite,
  HOST_UNSUITABLE_EXIT,
  type HostRuntimeRefusal,
} from "./host-runtime";

/** Both refusals reach an operator's terminal in the same shape. */
function refuse(refusal: HostRuntimeRefusal): never {
  console.error(`[runner] this host cannot run the agent runner (${refusal.problem}).`);
  console.error(`[runner] ${refusal.detail}`);
  process.exit(HOST_UNSUITABLE_EXIT);
}

/**
 * Prove the runtime can do the one thing the store needs, by doing it.
 *
 * Resolving the module is the check. A `try` around the import catches the
 * flagged-off case, the stripped-build case and the not-actually-Node case
 * without this file knowing which of them it is looking at, and the runtime's
 * own message is carried through rather than replaced — it is the only part of
 * the diagnosis this project did not write.
 */
async function assertSqlite(): Promise<void> {
  const version = process.versions.node;
  const tooOld = checkNodeVersion(version);
  if (tooOld !== null) {
    refuse(tooOld);
  }
  try {
    await import("node:sqlite");
  } catch (error: unknown) {
    refuse(
      describeMissingSqlite(version, error instanceof Error ? error.message : String(error)),
    );
  }
}

async function main(): Promise<void> {
  await assertSqlite();

  const configured = process.env["DASH_RUNNER_DATA_DIR"];
  const dataDir =
    configured !== undefined && configured.length > 0 ? path.resolve(configured) : defaultDataDir();

  const fresh = !existsSync(dataDir);
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    // The same guarantee `runner/channel-secret.ts` gives the credential and
    // `runner/workspace.ts` gives the task directories, applied to the
    // directory holding all three. A home directory on a shared host is
    // ordinarily world-readable, so this is the difference between "protected"
    // and "protected on the machine it was developed on".
    hardenOwnerOnly(dataDir, { directory: true });
  } catch (error: unknown) {
    console.error(
      `[runner] the data directory ${dataDir} could not be created owner-only: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      "[runner] this directory holds the runner's credential, its database and any files a " +
        "person handed to an agent. Refusing to start without it.",
    );
    process.exit(HOST_UNSUITABLE_EXIT);
  }

  // `runner/main.ts` reads this rather than taking an argument, so the one
  // place the decision is made is here and the runner keeps exactly one way of
  // being told where its state is.
  process.env["DASH_RUNNER_DATA_DIR"] = dataDir;

  console.warn(
    `[runner] standalone start: node=${process.versions.node} data=${dataDir}` +
      `${fresh ? " (created)" : ""}`,
  );

  /**
   * The handover, and the specifier is built rather than written.
   *
   * A literal `import("./runner.mjs")` would be a module esbuild tries to
   * resolve at build time and TypeScript tries to resolve at check time,
   * neither of which can see a file that only exists in the built artifact.
   * A URL built from `import.meta.url` is resolved by the runtime, which is
   * the only participant that knows where this file actually ended up.
   */
  await import(new URL("./runner.mjs", import.meta.url).href);
}

void main().catch((error: unknown) => {
  console.error(
    `[runner] the standalone entry point failed: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exit(1);
});
