/**
 * The bundle's entry point, and the only file that starts anything.
 *
 * `server.ts` exports `main` rather than calling it, so importing it from a
 * test does not attach a stdin listener to the test runner's own process. This
 * file is the one place that difference is spent.
 */

import { main } from "./server";

main();
