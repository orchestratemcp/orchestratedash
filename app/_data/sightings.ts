"use client";

/**
 * The session's sightings, shared between the two pages that need them
 * (MAR-606, ADR 0015).
 *
 * `lib/host-sightings.ts` is the store and holds every decision in it. This is
 * the wiring: one instance for the window, and the hook that subscribes to it.
 *
 * A module-level singleton rather than a React context, and that is the whole
 * design rather than a shortcut. A context would have to be provided above both
 * `/` and `/settings/servers`, which is `app/layout.tsx` — a file this lane does
 * not own and which has no other reason to know that servers exist. The store is
 * already a subscribe/snapshot object, `useSyncExternalStore` is built for
 * exactly that, and the result is that a page reads it by importing it.
 *
 * It lives as long as the window and no longer. That is not an accident of the
 * implementation — it is ADR 0015's rule, and the store's own header explains
 * what persisting it would produce on the next cold start.
 */

import { useSyncExternalStore } from "react";

import { createSightingStore, type SightingLog } from "../../lib/host-sightings";

export const sightings = createSightingStore();

/**
 * Every sighting this window has taken.
 *
 * The server snapshot is a fixed empty log rather than the live one. The
 * developer path renders these pages on the server, where no check can have
 * happened and no `record` can ever have been called — and returning the same
 * frozen object keeps the two passes agreeing, which is what stops React
 * discarding the server HTML over a hydration mismatch on a page whose whole
 * job is to look settled.
 */
export function useSightings(): SightingLog {
  return useSyncExternalStore(sightings.subscribe, sightings.snapshot, () => EMPTY);
}

const EMPTY: SightingLog = {};
