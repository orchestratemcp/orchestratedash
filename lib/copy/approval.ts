/**
 * The words DASH uses to ask for an approval.
 *
 * The highest-stakes copy in the product: an approval is the moment a person
 * decides whether to trust the thing. MAR-423 owns the words and what is shown;
 * MAR-421 (DASH-17) owns where the question is delivered and how it reaches the
 * user. This module is the first half, deliberately separable from the second —
 * it is a pure function over an Agent DOM state snapshot, so the same question
 * is worded identically whether it arrives in a native dialog, the Chief chat,
 * or a page, and so the copy is testable without any of the three existing.
 *
 * ## The three rules it exists to enforce
 *
 * 1. **Ask about the change, never about the permission.** "Create invite and
 *    save Gmail draft: Tuesday at 10:00?" — never "approve `calendar_write` for
 *    component X". Everything in the question is text the agent's own author
 *    wrote; DASH assembles, and does not translate.
 * 2. **Render the actual content.** The proposed time comes out of the choice
 *    the approval was *caused by*, through `audit.causation_id`, which is the
 *    contract's own link between "the user picked Tuesday" and "may I now book
 *    it". Copy reviewed against a lorem fixture has not been reviewed, so the
 *    tests run against `examples/gmail-meeting-assistant.state.example.json`.
 * 3. **Declining is as easy to reach as approving.** Symmetric labels, no
 *    default, and `decline_effect` is a required field rather than an optional
 *    nicety — a question that does not say what "no" does is not finished.
 *
 * ## What it will not say
 *
 * Which accounts the action will touch. Nothing in the state links an action to
 * a connection, and inventing that link — "this will use Gmail", inferred from
 * the agent having a Gmail connection — would be exactly the overclaim
 * `lib/connections.ts` refuses to make about ownership. The connections belong
 * in the Connection Center, where they are declared.
 *
 * The agent's own name, either: `agent_id` is an identifier, and no manifest
 * field carries a human name for an agent. The surface showing the question
 * already knows which agent it is showing.
 */

/* ---------------------------------------------------------------------- *
 * The subset of agent-dom-state.schema.json this module reads
 *
 * Declared locally, exactly as `lib/connections.ts` declares its manifest
 * subset and for the same reason: `lib/contracts.ts` reads schema files off
 * disk at import time, and this module is deliberately I/O-free so it can be
 * called from anywhere, including a preload.
 * ---------------------------------------------------------------------- */

export interface ApprovalStateTask {
  id: string;
  label: string;
  detail?: string;
}

export interface ApprovalStateChoiceOption {
  id: string;
  label: string;
  detail?: string;
}

export interface ApprovalStateChoice {
  id: string;
  task_id: string;
  label: string;
  options: ApprovalStateChoiceOption[];
  selected_option_id?: string;
}

export interface ApprovalStateAction {
  id: string;
  task_id: string;
  label: string;
}

export interface ApprovalStateRequest {
  id: string;
  task_id: string;
  action_id: string;
  label: string;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  expires_at: string;
  runner_enforced: boolean;
  audit?: { correlation_id?: string; causation_id?: string };
}

export interface ApprovalSourceState {
  tasks?: ApprovalStateTask[];
  choices?: ApprovalStateChoice[];
  actions?: ApprovalStateAction[];
  approval_requests?: ApprovalStateRequest[];
}

/* ---------------------------------------------------------------------- *
 * What a surface renders
 * ---------------------------------------------------------------------- */

/** One fact about the proposed change, in the agent author's own words. */
export interface ApprovalFact {
  label: string;
  value: string;
}

export interface ApprovalQuestion {
  /** Calm, and never the agent's identifier. */
  title: string;
  /** The question. One sentence, about the change. */
  message: string;
  /** The actual content being proposed. Never empty. */
  content: ApprovalFact[];
  /** Supporting sentences, in the order they should be read. */
  detail: string[];
  /** What happens if the user says no. Required, never optional. */
  decline_effect: string;
  approve_label: string;
  decline_label: string;
}

/**
 * A pending approval that cannot be asked about, and why — in the same
 * what-happened / what-it-means / next-action shape every other failure takes.
 * See `lib/copy/recovery.ts`.
 */
export interface ApprovalUnavailable {
  headline: string;
  detail: string;
  next_action: string;
}

export type ApprovalCopy =
  | { ok: true; question: ApprovalQuestion }
  | { ok: false; reason: "unknown" | "settled" | "expired"; unavailable: ApprovalUnavailable };

/* ---------------------------------------------------------------------- *
 * The words
 * ---------------------------------------------------------------------- */

const SETTLED_WORDS: Record<string, string> = {
  approved: "You already said yes to this.",
  rejected: "You already said no to this.",
  expired: "This request expired before it was answered.",
  cancelled: "The agent withdrew this request.",
};

/**
 * Word the question for one approval.
 *
 * `now` is a parameter rather than a call to `Date.now()` so expiry reads the
 * same in a test as it does in front of a user, and so a surface that renders a
 * snapshot from a moment ago says how long is left *from that moment*.
 */
export function describeApproval(
  state: ApprovalSourceState,
  approvalId: string,
  now: Date,
): ApprovalCopy {
  const request = (state.approval_requests ?? []).find((entry) => entry.id === approvalId);
  if (request === undefined) {
    return {
      ok: false,
      reason: "unknown",
      unavailable: {
        headline: "This request is no longer there.",
        detail:
          "The agent may have finished it, or withdrawn it, since this was shown. Nothing was decided on your behalf.",
        next_action: "Check what the agent is doing now.",
      },
    };
  }

  if (request.status !== "pending") {
    return {
      ok: false,
      reason: request.status === "expired" ? "expired" : "settled",
      unavailable: {
        headline: SETTLED_WORDS[request.status] ?? "This request has already been answered.",
        detail: "It is kept in the agent's history, so what was decided stays visible.",
        next_action: "Check what the agent is doing now.",
      },
    };
  }

  const expiry = expiresIn(request.expires_at, now);
  if (expiry === "past") {
    return {
      ok: false,
      reason: "expired",
      unavailable: {
        headline: "This request expired before it was answered.",
        detail:
          "The agent set a time limit on it. Nothing was done, and nothing was decided on your behalf.",
        next_action: "Ask the agent to try again if you still want it.",
      },
    };
  }

  const task = (state.tasks ?? []).find((entry) => entry.id === request.task_id);
  const action = (state.actions ?? []).find((entry) => entry.id === request.action_id);
  // The author's label for the action is the truest description of the change;
  // the request's own label is the fallback, and they are usually the same.
  const change = action?.label ?? request.label;
  const chosen = causingChoice(state, request);

  const content: ApprovalFact[] = [{ label: "What happens", value: change }];
  if (task !== undefined) {
    content.push({ label: "Part of", value: task.label });
  }
  if (chosen !== null) {
    content.push({ label: chosen.label, value: chosen.value });
  }

  const detail: string[] = [];
  if (task?.detail !== undefined && task.detail !== "") {
    detail.push(task.detail);
  }
  if (request.runner_enforced) {
    // Worth saying plainly: it is the difference between a checkbox and a gate,
    // and it is the reassurance that makes "no" safe to choose.
    detail.push(
      "Nothing happens until you answer. The part of DASH that runs this agent checks your answer again before it does anything.",
    );
  }
  detail.push(`If you do not answer, this expires in ${expiry}.`);

  return {
    ok: true,
    question: {
      title: "The agent is waiting for your answer",
      message: chosen === null ? asQuestion(change) : asQuestion(`${change}: ${chosen.headline}`),
      content,
      detail,
      decline_effect:
        "Nothing is created and nothing is sent. The agent is told you said no, and it stops waiting.",
      // Symmetric on purpose. MAR-423: declining must be as easy to reach as
      // approving, which starts with it being as easy to read.
      approve_label: "Yes, do this",
      decline_label: "No, do not",
    },
  };
}

/**
 * The choice this approval came out of, if there is one.
 *
 * `audit.causation_id` first, because that is the contract's own statement of
 * what caused what. Falling back to "a decided choice on the same task" is a
 * guess, and a defensible one: a task with a settled choice and a pending
 * approval has exactly one story, and showing the user the time they picked is
 * worth more than the purity of only reading declared links. It is a guess about
 * *what to display*, never about what to do.
 */
function causingChoice(
  state: ApprovalSourceState,
  request: ApprovalStateRequest,
): { label: string; value: string; headline: string } | null {
  const choices = state.choices ?? [];
  const causing = request.audit?.causation_id;

  const candidate =
    choices.find((choice) => choice.id === causing) ??
    choices.find(
      (choice) => choice.task_id === request.task_id && choice.selected_option_id !== undefined,
    );

  if (candidate?.selected_option_id === undefined) {
    return null;
  }
  const option = candidate.options.find((entry) => entry.id === candidate.selected_option_id);
  if (option === undefined) {
    return null;
  }

  return {
    label: candidate.label,
    value: option.detail === undefined ? option.label : `${option.label} (${option.detail})`,
    // The question gets the option's label alone. Its `detail` — "30 minutes" —
    // is worth showing and is not worth carrying in the sentence a person reads
    // first; a question that grows a parenthesis stops being one sentence.
    headline: option.label,
  };
}

/** Turn a label into a question without doubling punctuation it already has. */
function asQuestion(label: string): string {
  const trimmed = label.trim().replace(/[.?!]+$/, "");
  return `${trimmed}?`;
}

/**
 * How long is left, in words a person uses.
 *
 * Relative rather than absolute, which is not a stylistic choice: an absolute
 * time has to be rendered in *some* timezone, and a copy layer that picks one
 * either lies to half its readers or makes its own tests depend on where CI
 * runs. "About a day" is both truer and portable.
 */
function expiresIn(expiresAt: string, now: Date): string | "past" {
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) {
    // An unparseable expiry is not an expired one. Saying "soon" keeps the
    // question askable and still tells the user not to sit on it.
    return "a short while";
  }

  const ms = deadline - now.getTime();
  if (ms <= 0) {
    return "past";
  }

  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) {
    return plural(Math.max(1, minutes), "minute");
  }
  const hours = Math.round(minutes / 60);
  if (hours < 36) {
    return plural(hours, "hour");
  }
  return plural(Math.round(hours / 24), "day");
}

function plural(count: number, unit: string): string {
  return count === 1 ? `about 1 ${unit}` : `about ${count} ${unit}s`;
}
