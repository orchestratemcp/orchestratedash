/**
 * Finding a deep link in a process's arguments.
 *
 * Pure, and separate from `electron/main.ts`, because the platforms disagree
 * about how a `dash://` URL reaches a running application and the disagreement
 * is entirely about argument vectors:
 *
 * - **Windows** launches a *second* copy of the executable with the URL appended
 *   to its `argv`. The first copy learns about it through `second-instance`,
 *   which hands over that copy's whole argv. A cold start — DASH was not
 *   running — puts the URL in this process's own `process.argv` instead.
 * - **Linux** behaves the same way for a `.desktop` handler.
 * - **macOS** does not use argv at all: it fires `open-url` on the running app.
 *
 * So two of the three cases are "find the URL in a list of strings", and that
 * is a function worth being able to test without launching Electron.
 *
 * ## Why this does not validate the URL
 *
 * It matches on the scheme and nothing else. A malformed `dash://` link must
 * still reach `lib/handoff-flow.ts`, because that is the layer that produces a
 * user-facing refusal — and a link silently dropped here would look, to the
 * person who clicked it, exactly like DASH being broken.
 */

import { HANDOFF_SCHEME } from "../handoff";

const PREFIX = `${HANDOFF_SCHEME}://`;

/**
 * The deep link in an argument vector, or null.
 *
 * The **last** match wins. Windows appends the URL after whatever arguments the
 * executable was registered with, so on the developer path — where the
 * registration is `electron.exe <project> <url>` — an earlier argument could
 * plausibly be a path and a later one the real link. Preferring the last is
 * right in every case anyone has observed and wrong in none.
 */
export function findDeepLink(argv: readonly string[]): string | null {
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const candidate = argv[index];
    if (typeof candidate === "string" && candidate.toLowerCase().startsWith(PREFIX)) {
      return candidate;
    }
  }
  return null;
}
