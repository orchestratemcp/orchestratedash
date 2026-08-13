/**
 * A moment, in words (MAR-533).
 *
 * DASH stores every timestamp as an ISO-8601 instant, which is the right thing
 * for a record and the wrong thing for a sentence. The Connections page shipped
 * `2026-08-07T13:58:28.037Z` straight onto the screen — four times per lapse
 * row, twice per receipt, once per audit entry — and at 375px wide a single one
 * of them wrapped across two lines of a bullet.
 *
 * `lib/copy/identifiers.ts` forbids component ids, environment variable names
 * and raw scopes on the guided path for one reason: a person who has to read a
 * machine's own spelling of something has been handed the machine's problem. A
 * timestamp with a `T` and a `Z` in it is the same failure, and it slipped
 * through because it is not an identifier and no test was looking.
 *
 * ## Local time, and no relative time
 *
 * Local, because the user is in one place and UTC is a fact about a server they
 * do not have.
 *
 * **Absolute, never "2 hours ago"**, and that is a decision rather than an
 * omission. A relative phrase needs a clock at render, so the same component
 * produces different markup on two runs — which makes a render test assert
 * nothing and makes the packaged export's first paint disagree with its second.
 * More to the point, this page's timestamps are evidence: "6 August 2026" is
 * something a person can check against their own provider's account page, and
 * "yesterday" is not.
 *
 * ## Null is a real answer
 *
 * Every function here returns `null` for anything it cannot read, and no
 * function returns the input. A malformed timestamp echoed back would put the
 * exact string this module exists to remove onto the screen, on the one path
 * where nobody is watching — and the caller's "Not recorded" is both true and
 * more useful than a value nothing can interpret.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function parsed(iso: string): Date | null {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "7 August 2026", in this computer's own timezone. */
export function plainDay(iso: string): string | null {
  const at = parsed(iso);
  if (at === null) {
    return null;
  }
  return `${String(at.getDate())} ${MONTHS[at.getMonth()] as string} ${String(at.getFullYear())}`;
}

/**
 * "7 August 2026 at 14:58".
 *
 * 24-hour, because a receipt read beside a provider's own audit log should not
 * need the reader to work out which noon is meant. Seconds are dropped: they are
 * in the record, and nobody comparing a grant date needs them.
 */
export function plainMoment(iso: string): string | null {
  const at = parsed(iso);
  const day = plainDay(iso);
  if (at === null || day === null) {
    return null;
  }
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${day} at ${hours}:${minutes}`;
}

/**
 * "14:58:12" — a feed line's clock, with seconds.
 *
 * The live output feed is a stream of steps a few seconds apart, so a clock
 * that dropped seconds would make two lines look simultaneous. `plainMoment`
 * still drops them: a receipt compared against a provider's audit log does
 * not need them, and this function exists so that difference stays a
 * decision rather than a silent extra argument.
 *
 * Local, padded, 24-hour, and null rather than the input when unreadable —
 * the same three rules as `plainMoment`, pointed at a shorter slot.
 */
export function plainClock(iso: string): string | null {
  const at = parsed(iso);
  if (at === null) {
    return null;
  }
  const hours = String(at.getHours()).padStart(2, "0");
  const minutes = String(at.getMinutes()).padStart(2, "0");
  const seconds = String(at.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * A window, said once rather than twice.
 *
 * A lapse that began and ended on the same day should not print that day twice —
 * "7 August 2026 at 13:58 — 7 August 2026 at 13:59" is a sentence that makes a
 * ninety-second gap look like an event with a history. Same day collapses to one
 * date and two times; different days spell both out; an open window says so in
 * words rather than trailing an em dash into nothing.
 */
export function plainWindow(fromIso: string, untilIso: string | null): string | null {
  const from = plainMoment(fromIso);
  if (from === null) {
    return null;
  }
  if (untilIso === null || untilIso === fromIso) {
    return from;
  }
  const until = plainMoment(untilIso);
  if (until === null) {
    return from;
  }
  const sameDay = plainDay(fromIso) === plainDay(untilIso);
  if (!sameDay) {
    return `${from} until ${until}`;
  }
  // "at 13:58" → "13:58". The day is already in `from`.
  const clock = until.slice(until.lastIndexOf(" at ") + 4);
  return `${from} until ${clock}`;
}
