/**
 * The four LAB-telemetry commands, on the trusted side (MAR-479, ADR 0026).
 *
 * `lib/shell/ipc.ts` names them and cannot perform them; this is where the
 * vault is opened, the credential window is raised, and the one outbound
 * request in this feature is made. The split is the one every command family in
 * DASH keeps, and here it earns its keep twice over — this module is the only
 * place in the product that holds a LAB ingest token in a variable, and the only
 * place that decides that bytes may leave the machine.
 *
 * ## The order of the two checks, which is the whole of "off by default"
 *
 * `sendPending` reads the settings and returns before composing anything unless
 * `shouldSendTelemetry` passes. So a DASH nobody has configured does not build a
 * payload, does not open the vault, and does not resolve a hostname — it does
 * nothing at all, which is MAR-479's first constraint implemented as an absence
 * rather than as a default value somebody could have set differently.
 *
 * ## Why the receipt is written before anything is marked sent
 *
 * `recordLabSend` runs on every attempt, including the failures; `markLabSent`
 * runs only after a fully-accepted batch. That order means the worst case is a
 * receipt for a batch DASH then re-sends — visible and honest — rather than a
 * batch marked sent that never arrived, which would be DASH silently losing
 * data while claiming it was delivered.
 *
 * ## Why a partial answer marks nothing
 *
 * LAB answers with counts (`{accepted, rejected}`), not with which entries
 * landed. After a 207 DASH does not know which half succeeded, so it marks none
 * — recording a fact it does not have would be exactly the mislabeling
 * AGENTS.md's grounded-prose rule refuses. The cost is a re-send LAB's own
 * per-day de-duplication absorbs.
 */

import type { BrowserWindow } from "electron";

import {
  describeLabTelemetryDisabled,
  describeLabTelemetryEnabled,
  describeLabTelemetryToken,
} from "../lib/copy/decisions";
import { fileDecision } from "../lib/fleet/decisions-store";
import {
  observationKey,
  payloadBody,
  pendingObservations,
  type LabObservation,
} from "../lib/lab/observation";
import {
  acceptedCount,
  describeSendOutcome,
  postObservations,
  type FetchLike,
  type SendOutcome,
} from "../lib/lab/send";
import {
  LAB_TELEMETRY_PROMPT,
  LAB_TELEMETRY_SECRET_NAME,
  shouldSendTelemetry,
} from "../lib/lab/settings";
import { maskSecret } from "../lib/secret-refs";
import { SecureStoreError, type SecureStore } from "../lib/secure-store";
import type { LabAction, LabActionResult } from "../lib/shell/ipc";
import {
  forgetLabTelemetryToken,
  markLabSent,
  readLabSentKeys,
  readLabTelemetrySettings,
  readStore,
  recordLabSend,
  recordLabTelemetryToken,
  setLabTelemetryEnabled,
} from "../lib/store";

/** The status a receipt carries when the attempt never got an answer. */
const NO_ANSWER = -1;

/**
 * What this module needs from main, injected for the reason every other port in
 * `electron/` is: so the whole of it can be exercised without launching
 * Electron, opening a real vault, or reaching a real LAB.
 */
export interface LabSendPorts {
  store: SecureStore;
  /** Injected so a test can drive the real send against a loopback listener. */
  fetchImpl?: FetchLike;
  /** DASH's own clock, injectable so a receipt's date is assertable. */
  now?(): Date;
}

/**
 * The send's ports plus the one thing only a command needs.
 *
 * Split so that `sendPending` — which `electron/main.ts` fires at startup, with
 * nobody at the keyboard — cannot be handed a way to raise a modal. A startup
 * path that could open the credential window would be a DASH that asks for a
 * password because it decided to phone home, which is the one interaction this
 * feature must never produce.
 */
export interface LabTelemetryPorts extends LabSendPorts {
  /** Raise the credential window. Resolves with what was typed, or null. */
  promptForSecret(request: {
    service: string;
    field_label: string;
    purpose: string;
    help: string | null;
    ai_provider_id: string | null;
  }): Promise<string | null>;
  /** The parent for the modal, or null when there is no window yet. */
  parent?: BrowserWindow | null;
}

function nowIso(ports: LabSendPorts): string {
  return (ports.now?.() ?? new Date()).toISOString();
}

/**
 * The standing this feature is in right now, in the shape every decision row
 * freezes and `currentOutcomeFor` compares against.
 *
 * One function so the write-site and the drift check cannot describe the same
 * state differently — ADR 0024 decision 3 only works if "what was decided" and
 * "what is true now" are the same vocabulary.
 */
function currentOutcome(): Record<string, unknown> {
  const settings = readLabTelemetrySettings();
  return {
    state: shouldSendTelemetry(settings) ? "sending" : "off",
    endpoint: settings.endpoint,
  };
}

/**
 * Run one LAB-telemetry command.
 *
 * Every branch returns a sentence, `performNotifyAction`'s rule: a settings
 * surface handed a bare `ok: false` would have to invent one, and the sentence
 * for "the vault is locked" is not something a page is in a position to write.
 */
export async function performLabAction(
  action: LabAction,
  target: { enabled?: boolean; endpoint?: string },
  ports: LabTelemetryPorts,
): Promise<LabActionResult> {
  switch (action) {
    case "connect":
      return connect(target, ports);
    case "disconnect":
      return disconnect(ports);
    case "set_enabled":
      return setEnabled(target, ports);
    case "send_now":
      return sendNow(ports);
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled LAB telemetry action: ${String(unreachable)}`);
    }
  }
}

async function connect(
  target: { endpoint?: string },
  ports: LabTelemetryPorts,
): Promise<LabActionResult> {
  const backing = ports.store.describeBacking();
  if (!backing.os_backed) {
    // Refused before the window opens, not after the person has pasted.
    // `connect` in `electron/notify-settings.ts` states the rule: asking
    // somebody for a credential and *then* saying there is nowhere to put it is
    // the one order this must never happen in.
    return {
      ok: false,
      refusal: "vault_unavailable",
      detail: `This computer has no credential vault available${
        backing.unavailable_reason === undefined ? "" : ` (${backing.unavailable_reason})`
      }, so DASH will not take a token it cannot protect.`,
    };
  }

  const endpoint = (target.endpoint ?? "").trim();
  if (endpoint.length === 0) {
    return { ok: false, refusal: "no_endpoint", detail: "DASH needs the address of a LAB first." };
  }
  try {
    // Parsed rather than pattern-matched, so a string that is not a URL at all
    // is refused here instead of at the first send, where the failure would
    // read as "that LAB is down".
    new URL(endpoint);
  } catch {
    return {
      ok: false,
      refusal: "bad_endpoint",
      detail: "That is not a web address DASH can read.",
    };
  }

  const typed = await ports.promptForSecret({
    service: LAB_TELEMETRY_PROMPT.service,
    field_label: LAB_TELEMETRY_PROMPT.field_label,
    purpose: LAB_TELEMETRY_PROMPT.purpose,
    help: LAB_TELEMETRY_PROMPT.help,
    ai_provider_id: null,
  });
  if (typed === null) {
    return { ok: false, refusal: "cancelled", detail: "Nothing was stored." };
  }

  const token = typed.trim();
  if (token.length === 0) {
    // The refusal describes the shape and never quotes the value — a string
    // pasted into a credential field is treated as a credential even once it
    // has turned out to be empty.
    return { ok: false, refusal: "empty_token", detail: "That was blank, so nothing was stored." };
  }

  try {
    await ports.store.set(LAB_TELEMETRY_SECRET_NAME, token);
  } catch (error: unknown) {
    return {
      ok: false,
      refusal: error instanceof SecureStoreError ? error.code : "vault_error",
      detail:
        error instanceof SecureStoreError
          ? error.message
          : "This computer's vault would not take the token.",
    };
  }

  // The row goes in after the vault write, never before. A row without a vault
  // entry is a DASH that says it is configured and has nothing to send under.
  const maskedHint = maskSecret(token);
  const at = nowIso(ports);
  recordLabTelemetryToken(maskedHint, endpoint, at);

  fileDecision({
    decided_at: at,
    subject_kind: "fleet",
    subject_id: null,
    kind: "lab_telemetry",
    topic: "",
    summary: describeLabTelemetryToken(endpoint),
    outcome: currentOutcome(),
    decided_by: "person",
    rule: null,
    reason: null,
    receipts: ["lab_telemetry 1"],
  });

  return {
    ok: true,
    masked_hint: maskedHint,
    detail:
      "DASH holds the token and is still not sending. Read what it would send, then switch it on.",
  };
}

async function disconnect(ports: LabTelemetryPorts): Promise<LabActionResult> {
  // The vault first, then the row — `disconnect` in `electron/notify-settings.ts`
  // and for its reason. A row surviving a deleted token says DASH is sending
  // when it cannot; a token surviving a deleted row is a value nothing in DASH
  // will ever read again, which is untidy rather than dishonest.
  try {
    await ports.store.delete(LAB_TELEMETRY_SECRET_NAME);
  } catch (error: unknown) {
    // `not_found` is success: there was nothing to remove and the caller wanted
    // there to be nothing. Anything else is reported, because a vault that
    // refused a delete still holds the token.
    if (!(error instanceof SecureStoreError) || error.code !== "not_found") {
      return {
        ok: false,
        refusal: error instanceof SecureStoreError ? error.code : "vault_error",
        detail:
          "This computer's vault would not remove the token, so DASH has left everything as it was.",
      };
    }
  }

  forgetLabTelemetryToken();

  fileDecision({
    decided_at: nowIso(ports),
    subject_kind: "fleet",
    subject_id: null,
    kind: "lab_telemetry",
    topic: "",
    summary: describeLabTelemetryDisabled(),
    outcome: currentOutcome(),
    decided_by: "person",
    rule: null,
    reason: null,
    receipts: ["lab_telemetry 1"],
  });

  return {
    ok: true,
    detail:
      "DASH has stopped and forgotten the token. What was already sent is on that LAB; clearing it is done there.",
  };
}

async function setEnabled(
  target: { enabled?: boolean },
  ports: LabTelemetryPorts,
): Promise<LabActionResult> {
  if (typeof target.enabled !== "boolean") {
    return { ok: false, refusal: "malformed", detail: "DASH could not read that switch." };
  }

  const before = readLabTelemetrySettings();
  if (before.enabled === target.enabled) {
    // Not a transition, so no decision row. `clearAgentModelChoice`'s rule: a
    // row for a change that did not happen would say something untrue about an
    // afternoon.
    return { ok: true, detail: "Nothing changed." };
  }

  setLabTelemetryEnabled(target.enabled);
  const after = readLabTelemetrySettings();

  fileDecision({
    decided_at: nowIso(ports),
    subject_kind: "fleet",
    subject_id: null,
    kind: "lab_telemetry",
    topic: "",
    summary: target.enabled
      ? describeLabTelemetryEnabled(after.endpoint)
      : describeLabTelemetryDisabled(),
    outcome: currentOutcome(),
    decided_by: "person",
    rule: null,
    reason: null,
    receipts: ["lab_telemetry 1"],
  });

  if (!target.enabled) {
    return { ok: true, detail: "DASH has stopped sending. The records of what it sent are kept." };
  }
  if (after.masked_hint === null) {
    return {
      ok: true,
      detail: "Switched on, and DASH has no token to send under yet, so nothing is going.",
    };
  }
  return { ok: true, detail: "DASH will send once a day per plan. Send now to do it immediately." };
}

async function sendNow(ports: LabTelemetryPorts): Promise<LabActionResult> {
  const result = await sendPending(ports);
  switch (result.kind) {
    case "not_configured":
      return {
        ok: false,
        refusal: "not_configured",
        detail: "DASH is not set up to send anything to a LAB.",
      };
    case "nothing_to_send":
      return {
        ok: true,
        sent: 0,
        detail: "There is nothing new to send. Every plan that has run has already been reported.",
      };
    case "sent":
      return {
        ok: result.outcome.kind === "accepted" || result.outcome.kind === "partial",
        sent: acceptedCount(result.outcome),
        detail: describeSendOutcome(result.outcome),
        refusal: result.outcome.kind === "accepted" ? undefined : result.outcome.kind,
      };
  }
}

/* ---------------------------------------------------------------------- *
 * The send itself
 * ---------------------------------------------------------------------- */

export type SendPendingResult =
  | { kind: "not_configured" }
  | { kind: "nothing_to_send" }
  | { kind: "sent"; outcome: SendOutcome; observations: LabObservation[] };

/**
 * Compose whatever has not been sent, post it once, and record what happened.
 *
 * Called at startup and by Send now. Exported so `electron/main.ts` can fire it
 * without going through the command dispatcher, and so a test can drive the
 * whole path against a loopback listener.
 *
 * **Nothing here throws and nothing here blocks.** ADR 0026 decision 6 and ADR
 * 0004's rule underneath it: LAB is not this repository and not this machine, so
 * a LAB that is down, that 404s because `LAB_DASH_INGEST_ENABLED` is off, or
 * that rejects the token is a receipt row with a status code and nothing else.
 * A caller that awaited this and ignored the result has behaved correctly.
 */
export async function sendPending(ports: LabSendPorts): Promise<SendPendingResult> {
  const settings = readLabTelemetrySettings();
  if (!shouldSendTelemetry(settings)) {
    return { kind: "not_configured" };
  }

  const observations = pendingObservations(readStore(), readLabSentKeys());
  if (observations.length === 0) {
    return { kind: "nothing_to_send" };
  }

  // The vault is opened here and not a line earlier: a DASH with nothing to say
  // never asks the operating system to unlock anything.
  let token: string;
  try {
    token = await ports.store.get(LAB_TELEMETRY_SECRET_NAME);
  } catch {
    // The store says it is configured and the vault disagrees. Recorded as a
    // receipt rather than thrown, because this is the shape of a profile move or
    // a locked vault, and neither is a reason to take a surface down.
    recordLabSend({
      sent_at: nowIso(ports),
      endpoint: settings.endpoint,
      body: "",
      outcome: "no_token",
      status: NO_ANSWER,
      detail: "This computer's vault would not give up the token, so nothing was sent.",
      accepted: 0,
    });
    return { kind: "not_configured" };
  }

  const body = payloadBody(observations);
  const outcome = await postObservations(settings.endpoint, token, body, ports.fetchImpl);
  const at = nowIso(ports);

  recordLabSend({
    sent_at: at,
    endpoint: settings.endpoint,
    body,
    outcome: outcome.kind,
    status: outcome.kind === "unreachable" ? NO_ANSWER : outcome.status,
    detail: describeSendOutcome(outcome),
    accepted: acceptedCount(outcome),
  });

  // Only a fully-accepted batch is marked. See the module docblock.
  if (outcome.kind === "accepted") {
    markLabSent(observations.map(observationKey), at);
  }

  return { kind: "sent", outcome, observations };
}
