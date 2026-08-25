/**
 * What DASH holds about the LAB it may talk to, and what it tells a person
 * before they turn it on (MAR-479, ADR 0026).
 *
 * Pure. The record shape and the words live together for `lib/notify/
 * settings.ts`' reason — the words are *about* the record. "DASH holds the
 * token in this computer's vault" is a claim about `masked_hint` being the only
 * part that can be read back, and a copy file free to drift from the store
 * would be a claim nobody is holding.
 *
 * ## Off is the absence of a row, not a default value
 *
 * ADR 0026 decision 7, and MAR-479's first constraint: *off by default, not off
 * until you accept a banner*. `LAB_TELEMETRY_OFF` is what
 * `readLabTelemetrySettings` returns when the table is empty, and
 * `shouldSendTelemetry` refuses it before reading anything else. A person who
 * never opens the page sends nothing, forever, and nothing anywhere asks them
 * to.
 *
 * ## The claim this feature is allowed to make, and the one it is not
 *
 * `LAB_TELEMETRY_RECEIPT` is the important constant in this file. DASH can
 * prove what it composed and what it recorded posting — both are its own
 * records. It cannot prove that no *other* bytes left the machine; that is an
 * assertion about a network DASH's own product principle says it does not see,
 * the same honesty ADR 0004 keeps about `network: read` being "a declaration
 * DASH renders, not a boundary DASH enforces". So every sentence below is
 * worded as a record of DASH's own act, and none of them is a guarantee about
 * the interface.
 */

/* ---------------------------------------------------------------------- *
 * What the store holds
 * ---------------------------------------------------------------------- */

/** The vault name the bearer token lives under. The only place a token exists. */
export const LAB_TELEMETRY_SECRET_NAME = "lab.telemetry-token";

/**
 * Where LAB listens, by default.
 *
 * Loopback because LAB is local-only by its own AGENTS.md and binds
 * `127.0.0.1`. It is a default and not a boundary — see `isLoopbackEndpoint`.
 */
export const DEFAULT_LAB_ENDPOINT = "http://127.0.0.1:3000";

/** LAB's ingest route. Fixed: it is that repository's path, not a setting. */
export const LAB_INGEST_PATH = "/api/insights/ingest";

/**
 * What DASH holds. Never the token itself.
 *
 * `masked_hint` is four trailing characters and is the only part of the
 * credential outside the vault — `lib/secret-refs.ts`' arrangement for every
 * other connection in DASH. There is no field a value could be assigned to,
 * which is what makes "the token is never rendered back" a property of the type
 * rather than a rule a settings page has to remember.
 */
export interface LabTelemetrySettings {
  /** The one opt-in. False on every install nobody has configured. */
  enabled: boolean;
  /** Where DASH posts. Never a path — `LAB_INGEST_PATH` is appended at the send. */
  endpoint: string;
  /** `••••` plus four characters, or null when no token is stored. */
  masked_hint: string | null;
  /** DASH's own clock when the token was stored. Null when none is. */
  configured_at: string | null;
}

/** What DASH holds before anybody has set anything up. */
export const LAB_TELEMETRY_OFF: LabTelemetrySettings = {
  enabled: false,
  endpoint: DEFAULT_LAB_ENDPOINT,
  masked_hint: null,
  configured_at: null,
};

/**
 * Whether bytes may leave at all.
 *
 * Here rather than in the sender, so the switch a person set on a page and the
 * check that decides whether anything is posted are the same function —
 * `shouldSend`'s reason in `lib/notify/settings.ts`.
 *
 * Both halves are required: a token with the switch off sends nothing, and the
 * switch on without a token sends nothing, because there would be no
 * `Authorization` header to send it under. Neither is an error state; both are
 * a person part-way through setting this up.
 */
export function shouldSendTelemetry(
  settings: Pick<LabTelemetrySettings, "enabled" | "masked_hint">,
): boolean {
  return settings.enabled && settings.masked_hint !== null;
}

/**
 * Whether this endpoint is on the machine DASH is running on.
 *
 * Used to *say so*, never to refuse. ADR 0026 decision 4: DASH does not get to
 * decide where somebody's own LAB runs, and treating the loopback default as a
 * boundary would be the `network: read` mistake — a rule rendered as if it were
 * enforced. What DASH does instead is put the difference on the page, at the
 * moment it matters, in `describeEndpointReach`.
 */
export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    // Unparseable is not loopback. A string DASH cannot read the host of is one
    // it cannot promise anything about, and the cautious reading is the true one.
    return false;
  }
}

/** One sentence about how far the bytes go. Never a refusal. */
export function describeEndpointReach(endpoint: string): string {
  return isLoopbackEndpoint(endpoint)
    ? "That address is on this computer. Nothing DASH sends there crosses a network."
    : "That address is not on this computer. What DASH sends goes over your network to reach it.";
}

/* ---------------------------------------------------------------------- *
 * The words
 * ---------------------------------------------------------------------- */

/**
 * What is in the payload, said plainly before anybody switches this on.
 *
 * This is the disclosure that decides whether somebody opts in, so it is above
 * the switch rather than under it — `lib/notify/settings.ts`' ordering
 * argument, for the same reason. `lib/lab/observation.ts` is what makes each
 * line true.
 */
export const LAB_TELEMETRY_CONTENTS: readonly string[] = [
  "The list of build blocks in each of your agents' plans, in order, exactly as the plan names them.",
  "Whether that plan matched a ready-made recipe or was assembled from scratch, and the recipe's id when one matched.",
  "The date each agent ran. One entry per plan per day, however many times it ran.",
  "Nothing else. Not what you asked any agent to do, not its name, not what it read or wrote, not what anything cost.",
];

/**
 * What LAB is, before anything about what DASH tells it (MAR-742).
 *
 * The tab this page sits under is hidden until somebody has configured a LAB
 * address — `app/_components/settings-tabs.tsx` — so everybody who reaches
 * this page arrived on purpose. What they are not owed is a page that assumes
 * they already know what the word names. This is the one sentence that says
 * so, ahead of `LAB_TELEMETRY_PURPOSE`, which answers what DASH sends it
 * rather than what it is.
 */
export const LAB_TELEMETRY_INTRO =
  "LAB is a separate program — usually on this same computer, since that is where it defaults to listening — that turns patterns from many DASH installs into ready-made recipes.";

/**
 * The one sentence this feature is for, from ADR 0026 decision 1.
 *
 * On the page above the contents, because "what is this for" is the question
 * that decides whether the contents are acceptable, and a field list read
 * without it is a field list somebody has to guess the purpose of.
 */
export const LAB_TELEMETRY_PURPOSE =
  "It answers one question: which sequences of build blocks people keep assembling by hand, so a ready-made recipe can be written for one of them.";

/**
 * What the receipt is, and — the load-bearing half — what it is not.
 *
 * MAR-479 asks whether an opt-in a user cannot verify is worth having. These
 * three sentences are the answer as a person reads it: the first two say what
 * DASH can show, the third says what nobody should take this page to mean. The
 * temptation is to drop the third, and dropping it is the only way this page
 * could be dishonest.
 */
export const LAB_TELEMETRY_RECEIPT: readonly string[] = [
  "Before you switch it on, the box below shows exactly what DASH would send right now — the actual message, built from your actual agents.",
  "After every send, DASH keeps the message it posted, word for word, with what the other end answered. Failures are kept too.",
  "This is DASH's record of what DASH sent. It is not a promise about everything that leaves your computer, which DASH cannot see and does not claim to.",
];

/** What turning it off does, and the one thing it cannot do. ADR 0026 decision 7. */
export const LAB_TELEMETRY_REVOKE: readonly string[] = [
  "Switching it off stops the sending and deletes the token from this computer's vault.",
  "The records of what was already sent stay here. You most likely switched this off in order to check them, and deleting them at that moment would be the worst possible timing.",
  "What was already sent is on that LAB and DASH cannot take it back. Clearing it is done there.",
];

/** The prompt's own words, for the window `promptForSecret` opens. */
export const LAB_TELEMETRY_PROMPT = {
  service: "OrchestrateLab",
  field_label: "LAB ingest token",
  purpose:
    "So LAB can tell that a message came from this DASH. It is the value of LAB_DASH_INGEST_TOKEN in that LAB's .env file.",
  help: "In LAB: open .env, copy the value after LAB_DASH_INGEST_TOKEN=.",
} as const;

/* ---------------------------------------------------------------------- *
 * The status row
 * ---------------------------------------------------------------------- */

/**
 * The whole state of this feature as one row — `describeNotificationStanding`'s
 * shape, for its reasons: a person opens this page to answer *is it on?* and to
 * change it, and the first is answerable without reading.
 *
 * The four states are distinct on purpose. "Set up but switched off" and "on
 * but no token" are both part-way states, and folding either into "Off" would
 * leave somebody who thinks they configured this unable to see why nothing is
 * happening.
 *
 * ## Why the address is not in any of these sentences
 *
 * MAR-423's rule — no raw identifier anywhere in the guided path, checked by a
 * test over the rendered copy rather than by inspection — and a URL is an
 * identifier. It is a fact this page absolutely has to show, so it shows it
 * where an identifier belongs: in its own labelled field, and in a `<code>` for
 * the full ingest URL. "That LAB" in the sentence, the address beside it.
 */
export interface LabTelemetryStanding {
  /** Three words at most. What somebody reads without reading. */
  chip: string;
  /** Whether DASH is actually sending, for the page to colour it. */
  on: boolean;
  /** The one sentence under it. Never a token, and never a bare timestamp. */
  sentence: string;
}

export function describeLabTelemetryStanding(
  settings: LabTelemetrySettings,
  /** `plainDay(configured_at)`, resolved by the caller. Null when unreadable. */
  since: string | null,
): LabTelemetryStanding {
  const added = since === null ? "" : `, set up ${since}`;

  if (settings.masked_hint === null && !settings.enabled) {
    return {
      chip: "Not set up",
      on: false,
      sentence: "Nothing about your agents leaves this computer.",
    };
  }

  if (settings.masked_hint === null) {
    /*
     * Switched on with nothing to send under. Its own branch and its own
     * sentence, because the chip has to say the true thing rather than the
     * reassuring one: somebody who turned this on and sees "Sending" would have
     * no way to find out why their LAB is empty.
     */
    return {
      chip: "No token",
      on: false,
      sentence: "DASH is switched on to send and has no token to send under, so nothing is going.",
    };
  }

  if (!settings.enabled) {
    return {
      chip: "Switched off",
      on: false,
      sentence: `DASH holds a token for that LAB${added} and is not sending.`,
    };
  }

  return {
    chip: "Sending",
    on: true,
    sentence: `DASH sends to that LAB${added}, once a day per plan.`,
  };
}

/** Every sentence this module composes, for the plain-language check. */
export function everyLabTelemetrySentence(): string[] {
  const held: LabTelemetrySettings = {
    enabled: true,
    endpoint: DEFAULT_LAB_ENDPOINT,
    masked_hint: "••••abcd",
    configured_at: "2026-08-20T09:00:00.000Z",
  };
  const states: LabTelemetrySettings[] = [
    LAB_TELEMETRY_OFF,
    { ...LAB_TELEMETRY_OFF, enabled: true },
    { ...held, enabled: false },
    held,
    { ...held, endpoint: "http://lab.example:3000" },
  ];
  return [
    ...states.flatMap((settings) =>
      [null, "20 August 2026"].flatMap((since) => {
        const standing = describeLabTelemetryStanding(settings, since);
        return [standing.chip, standing.sentence];
      }),
    ),
    ...states.map((settings) => describeEndpointReach(settings.endpoint)),
    LAB_TELEMETRY_INTRO,
    LAB_TELEMETRY_PURPOSE,
    ...LAB_TELEMETRY_CONTENTS,
    ...LAB_TELEMETRY_RECEIPT,
    ...LAB_TELEMETRY_REVOKE,
  ];
}
