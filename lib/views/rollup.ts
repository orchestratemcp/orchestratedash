/**
 * How many recent runs the agents list rolls up.
 *
 * Its own module, with no imports, for one reason: the number appears in a
 * column heading ("Last 5 runs") and the page rendering that heading is a client
 * component. `lib/insights.ts`, where this used to live, reaches SQLite through
 * `lib/store.ts`, and a page importing it for a constant would drag `node:sqlite`
 * toward a browser bundle.
 *
 * One definition, imported by both sides — the alternative being a literal in
 * the heading that silently stops matching the rollup it describes.
 */
export const ROLLUP_RUN_COUNT = 5;
