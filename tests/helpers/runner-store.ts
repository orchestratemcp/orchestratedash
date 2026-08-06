/**
 * Open a runner store that is supposed to be healthy (MAR-506).
 *
 * `openRunnerStore` returns a union now, because a damaged store is a state the
 * product has copy and a repair for rather than an exception. Most tests are
 * about something else entirely and want the healthy branch, and unwrapping it
 * by hand in each of them would put the same three lines in five files.
 *
 * It throws on damage rather than returning null, and the message names the
 * classification: a suite whose fixture directory has somehow acquired a broken
 * database should say so, not fail twenty assertions later on an undefined.
 *
 * Deliberately a test helper rather than a second export from `runner/store.ts`.
 * Production has exactly one door, and it is the one that makes the caller
 * decide.
 */

import { openRunnerStore, type RunnerStore } from "../../runner/store";

export function openHealthyRunnerStore(directory: string): RunnerStore {
  const opened = openRunnerStore(directory);
  if (!opened.ok) {
    throw new Error(
      `expected a healthy runner store, got ${opened.damage.kind}: ${opened.damage.detail}`,
    );
  }
  return opened.store;
}
