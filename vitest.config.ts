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
 * Only `exclude` is set. Every other default stays exactly as it was, because
 * the suite has always run against them and this file exists to remove a
 * directory rather than to start configuring the runner.
 *
 * No effect in CI, which has no `.claude/` — the divergence this fixes is one
 * only a developer's machine can have, which is why it survived so long.
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
  },
});
