/**
 * The first launch on a data directory nobody has created yet (MAR-755).
 *
 * `ensureChannelSecret` writes `runner.key` into the data directory and does not
 * create it. On every ordinary launch that is invisible, because `lib/db.ts` has
 * already made the directory before anything asks for a runner — but a fresh
 * `DASH_DATA_DIR` reaches `ensureRunner` first, `writeFileSync` throws `ENOENT`,
 * and DASH reports `endpoint_refused`: *"The runner's channel credential could
 * not be prepared."* That sentence named neither the cause nor a next step on a
 * machine where nothing at all was wrong, and finding out what it meant cost a
 * session.
 *
 * Two assertions, and the second one is the more valuable: the directory is
 * made, **and** whatever goes wrong at this step says what it was.
 *
 * ## Why one test here takes ten seconds
 *
 * `ensureRunner` does not stop once the credential is in hand — it goes on to
 * spawn a runner, and under Vitest the entry it spawns (`electron/runner.mjs`)
 * is a build artifact that only exists under `dist/`, so the child exits at
 * once and `waitForEndpointFile` waits out its full ten-second deadline before
 * answering `never_listened`. That is the point: `never_listened` is proof that
 * the credential step was passed. Nothing is left running — the child is gone
 * before the deadline starts — and the wait is the honest cost of testing this
 * function rather than a reimplementation of it.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureRunner } from "../electron/runner-process";
import { channelSecretPath } from "../runner/channel-secret";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** A directory that exists, holding a path inside it that does not. */
function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "dash-first-launch-"));
  directories.push(directory);
  return directory;
}

describe("ensureRunner on a data directory that does not exist yet", () => {
  it(
    "creates it, mints the channel secret, and gets past the credential step",
    { timeout: 30_000 },
    async () => {
      const dataDir = path.join(scratch(), "never-created");
      expect(existsSync(dataDir)).toBe(false);

      const result = await ensureRunner(dataDir);

      expect(existsSync(dataDir)).toBe(true);
      expect(existsSync(channelSecretPath(dataDir))).toBe(true);
      // Whatever happened afterwards, it was not the credential being refused.
      // That is the whole regression: `endpoint_refused` here meant a machine
      // that could not host agents, and the machine was fine.
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).not.toBe("endpoint_refused");
      }
    },
  );

  it("says what went wrong when the directory genuinely cannot be made", async () => {
    /*
     * The other half of MAR-755 and the half that cost the time. A failure this
     * function did not anticipate used to be flattened into one sentence naming
     * no cause; now the underlying text is carried, so the next person reads
     * `ENOTDIR` instead of guessing.
     *
     * The scenario is a data directory whose parent is a file — a real thing
     * that happens when a path is typed by hand or a sync tool replaces a
     * folder. `mkdirSync` refuses it, and it is refused fast, so this test does
     * not reach the spawn the one above does.
     */
    const parent = path.join(scratch(), "not-a-directory");
    writeFileSync(parent, "");
    const dataDir = path.join(parent, "store");

    const result = await ensureRunner(dataDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("endpoint_refused");
      // The sentence a person can act on still comes first; the cause follows.
      expect(result.detail).toMatch(/channel credential could not be prepared/);
      expect(result.detail).toMatch(/ENOTDIR|EEXIST|ENOENT/);
    }
  });
});
