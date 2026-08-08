/**
 * The present participle of what is happening right now (MAR-544).
 *
 * Henrik's ask is feedback while anything works — "Planning", "Searching" —
 * with the issue's own hard rule attached: **never invent a phase the system
 * isn't in.** DASH's runner reports statuses, not narrated phases, so what can
 * be said honestly is the plain-language reading of the status the store
 * actually holds. A component id could be dressed up as a participle
 * ("Searching…") and it would be `lib/copy/identifiers.ts`'s failure wearing
 * a costume: internal vocabulary, guessed into English, rendered as a fact.
 *
 * Returns a phase only for the states where work is genuinely in flight —
 * where an animated "alive" line tells the truth. The waiting-on-you and
 * finished states return null on purpose: an approval waiting on a person is
 * not the system working, and the surfaces already carry those as cards and
 * records. The fleet strip draws that distinction too (`fleet-motion.ts`'s
 * `waiting` vs `working`), and the two vocabularies must not disagree.
 */
export function describeWorkingPhase(status: string): string | null {
  switch (status) {
    case "queued":
      return "Waiting to start…";
    case "running":
      return "Working…";
    default:
      return null;
  }
}
