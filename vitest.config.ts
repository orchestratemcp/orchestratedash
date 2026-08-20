import { defineConfig, configDefaults } from "vitest/config";

/**
 * What `pnpm test` is allowed to discover.
 *
 * There was no config here at all, and the default discovery walks the whole
 * repository — including `.claude/worktrees/`, which is Claude Code's per-session
 * scratch and is gitignored for exactly that reason. Three stale worktrees on
 * this machine turned a 166-file run into a 326-file one and 3,189 tests into
 * 6,284, and the extra half was **other branches' copies of these same files**.
 *
 * That is not a slow run, it is a wrong one. A worktree cut days ago fails on
 * work that has since landed, and the failure names a path a reader skims past
 * as if it were the repository's own — so `pnpm verify`, which AGENTS.md makes
 * the local gate, reports red for code nobody is working on. It also passes for
 * the opposite reason: a file deleted on master still runs from a worktree that
 * has it.
 *
 * No effect in CI, which has no `.claude/` — the divergence this fixes is one
 * only a developer's machine can have, which is why it survived so long.
 *
 * ## `maxWorkers` (MAR-702)
 *
 * The other divergence a developer's machine can have: more cores than the
 * suite can use without contending with itself. Unset, Vitest fills every
 * logical processor it finds — 22 on the machine MAR-702 was filed from — and
 * the suite's own numbers say that is oversubscription, not throughput: a
 * green run there logged `287.00s` of test time inside `34.74s` of wall
 * clock, roughly 8x. The files that lost a random 5s `testTimeout` were
 * always the ones that touch the filesystem or open SQLite in their first
 * `beforeEach` — `mkdtempSync`, `freshStore()` — which is exactly the
 * contention 22-wide oversubscription would produce, worsened by Windows
 * Defender scanning every one of the ~200 temp directories the suite creates
 * and tears down.
 *
 * `6` is not a guess. Measured on that same 22-core machine, immediately
 * before this change, three ways:
 *
 * | `maxWorkers` | test time | wall clock |
 * | -- | -- | -- |
 * | unset (≈22) | 310.77s | 40.65s |
 * | 6 | 154.76s | 46.50s |
 * | 3 | 135.17s | 85.72s |
 *
 * Going from unset to 6 roughly halves the test time — real contention coming
 * off, not fixed overhead — for a wall-clock cost of about 14%. Going from 6
 * to 3 buys almost no further reduction in test time (154.76s → 135.17s) for
 * nearly double the wall clock: past 6, the suite is CPU-bound on this
 * machine, not contention-bound, so a lower cap would only cost time without
 * addressing what MAR-702 is actually about. Raising `testTimeout` instead was
 * considered and rejected, per MAR-702: it hides the oversubscription rather
 * than removing it, and a 5s budget to open a scratch SQLite file is not
 * itself unreasonable — the timeout was never the defect, the width was.
 *
 * No measurable effect on CI's Linux `verify` job, which runs on far fewer
 * cores than this ever throttles down to.
 */
export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      // Claude Code's session worktrees. Gitignored scratch, and each one is a
      // full copy of the repository at whatever commit that session started
      // from.
      "**/.claude/**",
    ],
    maxWorkers: 6,
  },
});
