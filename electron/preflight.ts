/**
 * The check `pnpm shell` runs before it starts Electron.
 *
 * **This runs under plain Node, not under Electron.** It is in `electron/`
 * because it is part of the shell's launch and is bundled by
 * `scripts/build-shell.mjs` along with everything else the launch needs, the
 * same way `runner/main.ts` is bundled here and then run as a Node process. It
 * imports nothing from `electron`, and it must not: it exists to fail *before*
 * a window can be created, because a window is exactly what makes this class of
 * failure invisible.
 *
 * Every rule is in `lib/shell/preflight.ts`, pure and unit-tested. What is left
 * here is the two observations those rules judge — one HTTP request, or a few
 * `stat` calls — and printing.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  judgeDeveloperTarget,
  judgePackagedTarget,
  resolveShellTarget,
  type DeveloperObservation,
  type PackagedObservation,
  type PreflightVerdict,
} from "../lib/shell/preflight";

/**
 * The repository root, from this bundle's own location.
 *
 * `dist/electron/preflight.mjs` → two levels up. `import.meta.url` rather than
 * `process.cwd()` for the reason `electron/renderer-host.ts` gives: it is the
 * one anchor that holds wherever the command was typed.
 */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Long enough for a cold Next dev server to compile the first page. */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * Everything the exported renderer is built from.
 *
 * `electron/` is deliberately absent: `pnpm build:shell` has just rebuilt it, so
 * it can never be stale relative to this launch, and including it would make
 * every shell launch after any edit demand a renderer build it does not need.
 */
const RENDERER_SOURCES = ["app", "lib", "next.config.mjs"];

function newestSource(): { file: string | null; at: number | null } {
  let file: string | null = null;
  let at: number | null = null;

  const consider = (candidate: string): void => {
    const stats = statSync(candidate);
    if (at === null || stats.mtimeMs > at) {
      at = stats.mtimeMs;
      file = path.relative(repoRoot, candidate).split(path.sep).join("/");
    }
  };

  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const entry = path.join(directory, name);
      if (statSync(entry).isDirectory()) {
        walk(entry);
      } else {
        consider(entry);
      }
    }
  };

  for (const source of RENDERER_SOURCES) {
    const target = path.join(repoRoot, source);
    if (!existsSync(target)) {
      continue;
    }
    if (statSync(target).isDirectory()) {
      walk(target);
    } else {
      consider(target);
    }
  }

  return { file, at };
}

function observePackaged(): PackagedObservation {
  /*
   * Two different files, and they answer two different questions.
   *
   * `dist/electron/renderer/index.html` is what a launch actually loads, so its
   * absence is what "there are no screens" means. Its *timestamp* is useless —
   * `scripts/build-shell.mjs` copies the export with `cpSync`, which stamps the
   * copy with the time of the copy, so it is always as new as the last
   * `pnpm build:shell` no matter how old the export inside it is. That is
   * precisely the pairing this check exists to catch, so asking the copy when it
   * was built would be asking the wrong file and always getting "just now".
   *
   * `out/index.html` is what `pnpm build:renderer` wrote, and its timestamp is
   * the real answer.
   */
  const entry = path.join(repoRoot, "dist", "electron", "renderer", "index.html");
  const exported = path.join(repoRoot, "out", "index.html");
  const newest = newestSource();

  return {
    entry_exists: existsSync(entry),
    exported_at: existsSync(exported) ? statSync(exported).mtimeMs : null,
    newest_source: newest.file,
    newest_source_at: newest.at,
  };
}

async function observeDeveloper(origin: string): Promise<DeveloperObservation> {
  /*
   * An unref'd timer on a controller, rather than `AbortSignal.timeout`.
   *
   * `AbortSignal.timeout` holds a ref'd libuv timer for its full duration, so a
   * probe that answered in 80ms would keep this process alive for the remaining
   * 30 seconds — and forcing it shut instead crashes Node on Windows with
   * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` from inside
   * `async.c`, which is what happened the first time this was run. A preflight
   * that aborts the launch by crashing is worse than no preflight, because the
   * message it leaves behind is about libuv rather than about the renderer.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  timer.unref?.();
  try {
    const response = await fetch(origin, {
      headers: { accept: "text/html" },
      signal: controller.signal,
    });
    const body = await response.text();
    // Not a parser. One tag, from a local development server, read only to tell
    // this application's page from another one's.
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? null;
    return { status: response.status, title, error: null };
  } catch (error: unknown) {
    return {
      status: null,
      title: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `process.exitCode`, never `process.exit()`.
 *
 * The difference matters here specifically: this process has just made an HTTP
 * request, and tearing the loop down under undici's open handles is what
 * produced the libuv assertion described above. Setting the code and letting the
 * loop drain ends the process just as promptly and only once nothing is mid-close.
 */
function report(verdict: PreflightVerdict): void {
  if (verdict.ok) {
    return;
  }
  console.error(`\n[shell] ${verdict.headline}`);
  console.error(`[shell] ${verdict.meaning}`);
  console.error(`[shell] ${verdict.next_action}\n`);
  process.exitCode = 1;
}

const target = resolveShellTarget(process.env.DASH_SHELL_URL);

if (target.kind === "packaged") {
  console.log(`[shell] renderer: ${target.url} (the exported screens)`);
  report(judgePackagedTarget(observePackaged()));
} else {
  console.log(`[shell] renderer: ${target.origin} (the dev server)`);
  report(judgeDeveloperTarget(target.origin, await observeDeveloper(target.origin)));
}
