/**
 * Give the proof harness the real app's identity, before anything reads it.
 *
 * Like `electron/data-dir.ts`, this module exists for its import position. It is
 * imported *first* by `electron/smoke.ts`, which makes it run before that file's
 * `import "./main.js"` and therefore before the store's location is decided.
 *
 * ## Why it is needed
 *
 * `app.getPath("userData")` is `<appData>/<app name>`, and Electron takes the
 * name from the package.json of the **app directory**. Under `electron .` that
 * is the repo root, so the name is `orchestratedash` and the store lands in
 * `.../Roaming/orchestratedash`. When a file is launched directly — which
 * `pnpm shell:smoke` does, so that the harness is not wired into the shipped
 * entry point — no package.json is consulted and the name falls back to
 * `Electron`, putting the store in `.../Roaming/Electron`.
 *
 * That difference is not cosmetic. MAR-424's third acceptance criterion is that
 * a command's refusal lands in `command_audit` **in the real user-data
 * directory**. A harness writing to `.../Roaming/Electron` would satisfy every
 * assertion in `smoke.ts` while proving it about a directory the installed app
 * never opens. Both launch paths have to agree about where the user's data
 * lives, or the proof is about the harness rather than the product.
 *
 * ## The shell now makes the same call (MAR-656)
 *
 * For two weeks this file was the only place in the repository that knew any of
 * the above, and the product it was proving did not. Every `dash://` deep link
 * launched `electron dist/electron/main.mjs`, became app name `Electron`, and
 * added the person's agent to `%APPDATA%\Electron`. `electron/data-dir.ts` now
 * calls `app.setName` for the shell, on the same reasoning and one import
 * earlier, so this module is a belt beside a brace rather than the only thing
 * holding the trousers up. It stays because `smoke.ts` must not depend on
 * `main.ts`'s import order to know who it is.
 *
 * The name is duplicated from the root package.json rather than read from it:
 * reading the file would mean resolving the repo root from a bundle, which is
 * the cwd-dependence this shell already has one instance of too many
 * (`lib/contracts.ts`). If the package name ever changes, `smoke.ts` fails its
 * own store-location check rather than quietly measuring the wrong thing.
 */

import { app } from "electron";

import { ALLOW_INSTALLED_STORE_ENV } from "../lib/shell/app-identity";

app.setName("orchestratedash");

/*
 * And say out loud that the real store is the point (MAR-700).
 *
 * Claiming the name above is what sends this harness to
 * `.../Roaming/orchestratedash`, and MAR-676's checkout guard refuses exactly
 * that from a checkout it cannot show is the installed one. The smoke ran from
 * worktrees regardless, because the guard was gated on a launch-form predicate
 * that happened to exclude it — an exemption nobody chose, sitting beside the
 * hole that let `pnpm shell` through as well. MAR-700 closes the hole by asking
 * about the destination instead, which would have taken the smoke's access with
 * it.
 *
 * So the exemption is stated rather than inherited. This is the one harness
 * whose proof is *about* the real user-data directory — MAR-424's third
 * acceptance criterion is that a command's refusal lands in `command_audit`
 * there — and `DASH_ALLOW_INSTALLED_STORE` is the switch that already means
 * "yes, the real one, on purpose".
 *
 * `??=`, so `pnpm verify:shell` against a scratch profile still wins: a
 * `DASH_DATA_DIR` on the way in is somebody choosing a different store, and this
 * must not overrule them.
 */
process.env[ALLOW_INSTALLED_STORE_ENV] ??= "1";
