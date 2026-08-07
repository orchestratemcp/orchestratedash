/**
 * What `pnpm shell` is about to show you, checked before it shows you nothing.
 *
 * ## The pairing that is the defect
 *
 * `pnpm shell` is `pnpm build:shell && electron .`. It builds main, the preload
 * and the runner from the working tree, and then loads a renderer it has not
 * built and has not looked at:
 *
 * - On the developer path it loads `http://127.0.0.1:3000` — *whatever* is
 *   listening there. Not necessarily this repository's dev server, not
 *   necessarily one started since the last merge, not necessarily one that
 *   still works.
 * - With `DASH_SHELL_URL=dash-app://ui/` it loads `dist/electron/renderer/`,
 *   which `scripts/build-shell.mjs` copies from `out/` **if it happens to be
 *   there** and reports rather than builds. That is deliberate and the comment
 *   there explains why; what was missing is anybody checking how old it is.
 *
 * Both are a fresh shell paired with an unexamined renderer, and both fail into
 * a window rather than an error. This module is the check, and it is pure so
 * that the rules are unit-tested rather than trusted — the argument
 * `lib/shell/window.ts` makes about the renderer posture, pointed at the thing
 * the posture is applied to.
 *
 * ## Refusals, not warnings
 *
 * A warning printed above an Electron launch is a warning nobody reads, because
 * the window opens anyway and the window is what the developer is looking at.
 * Every verdict here that is not `ok` stops the launch, and says the one command
 * that fixes it.
 */

/**
 * The document title the renderer serves, and the title `app/layout.tsx`
 * declares.
 *
 * One constant with two importers, so "is the thing on port 3000 actually
 * DASH?" is a question about a value rather than about two strings somebody
 * kept in sync. The hazard is documented and has happened on this machine: port
 * 3000 is a popular default, and a shell that loaded a *different* local app's
 * page would hand that page the command bridge.
 */
export const RENDERER_TITLE = "OrchestrateDASH";

/** Which renderer `electron .` will load on this launch. */
export type ShellTarget =
  | { kind: "developer"; origin: string }
  | { kind: "packaged"; url: string };

/**
 * Read the target out of the environment, exactly as `electron/main.ts` does.
 *
 * Duplicated from `rendererUrl()` rather than imported because that function
 * lives inside the Electron main bundle and reads `app.isPackaged`; this runs in
 * plain Node before Electron exists. The duplication is one `??`, and the test
 * pins both branches.
 */
export function resolveShellTarget(shellUrl: string | undefined): ShellTarget {
  const url = shellUrl ?? "http://127.0.0.1:3000";
  return url.startsWith("dash-app://")
    ? { kind: "packaged", url }
    : { kind: "developer", origin: url };
}

/**
 * A refusal, in the shape every failure in this product takes.
 *
 * Three fields for the reason `Recovery` has three — a surface that renders two
 * of them always drops the next action, which is the only one that helps — but
 * deliberately **not** `Recovery` itself. That type is product copy written for
 * somebody who did not choose to be a developer today; this is a message to
 * whoever just typed `pnpm shell`, and it is allowed to name a command.
 */
export interface PreflightVerdict {
  ok: boolean;
  headline: string;
  meaning: string;
  next_action: string;
}

const LAUNCHING: PreflightVerdict = {
  ok: true,
  headline: "",
  meaning: "",
  next_action: "",
};

/** What was found at the developer origin. */
export interface DeveloperObservation {
  /** Null when nothing answered at all — a refused connection or a timeout. */
  status: number | null;
  /** The `<title>` of whatever answered, when there was one. */
  title: string | null;
  /** The transport-level reason nothing answered, for the message. */
  error: string | null;
}

/**
 * Judge the developer path.
 *
 * Three refusals, and they are three because they lead somewhere different —
 * the argument `lib/copy/recovery.ts` makes about credentials, applied to a
 * dev server. Nothing listening means start one. Something listening that is
 * not DASH means the port is taken and DASH must not be pointed at it. An
 * error status means this repository's dev server is up and unhappy, which is a
 * different fix again.
 *
 * What this deliberately does **not** claim is that the page will work. A dev
 * server can answer with a perfectly well-formed page whose renderer never
 * runs, which is precisely the failure that made this module necessary — and no
 * amount of HTTP probing distinguishes that from a healthy one. That question
 * belongs to `lib/shell/first-paint.ts`, which asks it of the real window
 * afterwards, and this comment exists so the next reader does not mistake a
 * green preflight for a working shell.
 */
export function judgeDeveloperTarget(
  origin: string,
  observation: DeveloperObservation,
): PreflightVerdict {
  if (observation.status === null) {
    return {
      ok: false,
      headline: `Nothing is answering at ${origin}.`,
      meaning:
        "DASH's developer path renders from the local Next dev server, so the window would " +
        `open empty and report a load failure to a console nobody is watching. (${observation.error ?? "no response"})`,
      next_action: "Run `pnpm dev` in this repository, then `pnpm shell` again.",
    };
  }

  if (observation.status >= 400) {
    return {
      ok: false,
      headline: `The dev server at ${origin} answered ${String(observation.status)}.`,
      meaning:
        "Something is listening and it could not serve DASH's first page, so the shell would " +
        "display whatever error body it returned.",
      next_action: "Read the output of `pnpm dev` and fix what it is reporting.",
    };
  }

  if (observation.title !== RENDERER_TITLE) {
    return {
      ok: false,
      headline: `${origin} is serving something that is not DASH.`,
      meaning:
        `Its page is titled ${observation.title === null ? "nothing at all" : `"${observation.title}"`}, ` +
        "and DASH will not point a window holding the audited command bridge at another " +
        "application's page.",
      next_action:
        "Stop whatever owns that port, or set DASH_SHELL_URL to the origin DASH's own dev server is on.",
    };
  }

  return LAUNCHING;
}

/** What was found where the packaged renderer should be. */
export interface PackagedObservation {
  /** Whether `dist/electron/renderer/index.html` exists. */
  entry_exists: boolean;
  /** When the export was written. Null when there is no export. */
  exported_at: number | null;
  /** The newest source file the export is built from, and when it changed. */
  newest_source: string | null;
  newest_source_at: number | null;
}

/**
 * Judge the packaged renderer.
 *
 * The staleness rule is the one that matters, and it is the literal form of the
 * pairing named at the top of this file: `pnpm build:shell` rebuilt main and the
 * preload from the working tree, so if the export predates a source file, the
 * launch pairs new main with old screens. That combination fails in the worst
 * available way — everything loads, nothing is missing, and the window shows a
 * version of DASH that no longer exists.
 *
 * A missing export is a separate and much louder failure; `assertRendererPresent`
 * already crashes a packaged launch on it. This catches it earlier, before an
 * Electron process starts, and names the same command.
 */
export function judgePackagedTarget(observation: PackagedObservation): PreflightVerdict {
  if (!observation.entry_exists) {
    return {
      ok: false,
      headline: "There is no exported renderer to load.",
      meaning:
        "`pnpm build:shell` copies the export from `out/` if it is there and does not build it, " +
        "so a tree that has never run the renderer build has no screens to show.",
      next_action: "Run `pnpm build:renderer`, then `pnpm shell` again.",
    };
  }

  if (
    observation.exported_at !== null &&
    observation.newest_source_at !== null &&
    observation.newest_source_at > observation.exported_at
  ) {
    return {
      ok: false,
      headline: "The exported renderer is older than the source it is built from.",
      meaning:
        `\`${observation.newest_source ?? "a source file"}\` changed after the export was written, ` +
        "so this launch would pair a shell built from the working tree with screens built before it. " +
        "Nothing would look broken; the window would simply be showing an older DASH.",
      next_action: "Run `pnpm build:renderer`, then `pnpm shell` again.",
    };
  }

  return LAUNCHING;
}
