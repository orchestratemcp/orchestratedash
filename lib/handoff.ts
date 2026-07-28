/**
 * The handoff: how an agent someone just built asks to be added to DASH.
 *
 * MAR-428's outcome is "a compatible agent appears in DASH without the user
 * writing a registration file, locating JSON, or using a file picker". This
 * module is the contract that makes that possible, and it is deliberately the
 * *only* place the shape is written down: the Agent Kit builds a handoff with
 * these functions and DASH reads one with the same functions, out of the same
 * bundle, so the producer and the consumer cannot drift.
 *
 * ## What a handoff is, and what it is not
 *
 * It is a **proposal**, not an instruction. Opening a handoff never starts a
 * process and never writes a registration; it asks DASH to show the user a
 * question. Everything below exists to make sure the question is asked about
 * something real, recent, and belonging to the person being asked.
 *
 * ## Why the URL carries a pointer and a nonce, and nothing else
 *
 * Registering an agent means telling the runner a command line to spawn. If a
 * `dash://` URL could *carry* that command line, then any web page the user
 * ever visits could hand DASH an arbitrary program to run, and the only thing
 * standing between a novice and a compromised machine would be their reading of
 * a dialog. So the URL names a file and proves the opener could read it:
 *
 * - **The command line is in the file, never in the URL.** A URL is attacker-
 *   authored by construction. A file at an absolute path is not: writing one
 *   requires already being able to write to that user's disk.
 * - **The nonce is proof of possession, not a credential.** It is generated
 *   with the handoff, stored inside the same file, single-use and short-lived.
 *   Presenting it proves the opener *read the file* — which is precisely the
 *   capability a drive-by page does not have. It authorises nothing beyond
 *   "show the user this proposal", which is why it can travel in a URL at all
 *   while the issue's rule that no secret or bearer token may is untouched.
 * - **Consent is still required afterwards.** The nonce narrows who may ask;
 *   the user decides. Neither replaces the other, and `lib/handoff-flow.ts`
 *   refuses to register without both.
 *
 * ## Why no credential value can be in here
 *
 * "Never place secrets or runner bearer tokens in a URL, manifest or
 * registration artifact" is an acceptance criterion, so it is enforced rather
 * than intended: `secretsInEnvironment` rejects a handoff whose environment
 * block carries a secret-shaped name, and `DASH_*` is refused outright because
 * those names belong to DASH and the runner. A handoff that wants to give an
 * agent a credential is a handoff DASH will not open.
 */

import { timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/** The document version. Bumped only for a breaking change to the shape. */
export const HANDOFF_VERSION = 1;

/** The URL scheme DASH registers with the OS. */
export const HANDOFF_SCHEME = "dash";

/**
 * The authority segment of a handoff URL, i.e. `dash://handoff?…`.
 *
 * A fixed word rather than a free-form path so that adding a second kind of
 * deep link later is a new authority with its own parser, rather than a change
 * to how this one is recognised.
 */
export const HANDOFF_HOST = "handoff";

/**
 * The file name a handoff must have.
 *
 * A cheap narrowing of what a crafted URL can aim DASH's reader at. The read is
 * size-capped and the parse is validated regardless, so this is not the
 * defence — it is the part of the defence that costs one line.
 */
export const HANDOFF_FILE_NAME = "dash-handoff.json";

/** Generous for a handoff, far too small to be a useful memory attack. */
export const MAX_HANDOFF_BYTES = 65_536;

/** How long a handoff stays openable. Long enough to read the terminal output. */
export const HANDOFF_TTL_MS = 30 * 60 * 1000;

/**
 * The identifier rules for an agent, which are stricter than the manifest's.
 *
 * `agent.name` in the manifest is any non-empty string, and it becomes a **file
 * name** here: the registration is `{data-dir}/agents/{agent_id}.json` and the
 * DASH-owned manifest copy is beside it. An id containing `..` or a separator
 * would write outside that directory, so this is a path-traversal boundary and
 * not a style preference.
 */
const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Nonce and handoff id: hex, long enough not to be guessed, bounded. */
const HEX_TOKEN = /^[0-9a-f]{32,128}$/;

/**
 * Environment names that look like they carry a credential.
 *
 * Deliberately broad and deliberately erring towards refusal. A registration is
 * a durable artifact on disk that DASH hands to a process supervisor; a false
 * positive costs an agent author one rename, and a false negative writes
 * somebody's API key into a JSON file DASH then owns forever.
 */
const SECRET_LOOKING_NAME =
  /(secret|token|password|passwd|api[_-]?key|apikey|credential|private[_-]?key|access[_-]?key|auth)/i;

export interface AgentHandoff {
  handoff_version: typeof HANDOFF_VERSION;
  /** Names this proposal. DASH records it so replaying a handoff is idempotent. */
  handoff_id: string;
  /** Proof of possession. See the module header for why this is not a credential. */
  nonce: string;
  created_at: string;
  expires_at: string;
  /** The agent's id, which is also its manifest's `agent.name`. */
  agent_id: string;
  /** What to call it in the consent prompt. Plain language, no ids. */
  display_name: string;
  /** One sentence a novice can read: what this agent does. */
  summary: string;
  /** The project the Agent Kit created. Absolute. */
  project_dir: string;
  /** The manifest to register. Absolute. DASH copies it rather than linking it. */
  manifest_path: string;
  /** The program the runner will spawn. Never a shell string. */
  command: string;
  args: string[];
  /** Extra child environment. No secrets, no `DASH_*`; see `secretsInEnvironment`. */
  env: Record<string, string>;
  /** Which tool wrote this, for the log and for support questions. */
  produced_by: string;
}

export type HandoffProblem =
  | "not_found"
  | "not_a_file"
  | "too_large"
  | "not_json"
  | "malformed"
  | "unsupported_version"
  | "unsafe_agent_id"
  | "relative_path"
  | "secret_in_environment"
  | "expired"
  | "nonce_mismatch";

export type HandoffResult<T> =
  | { ok: true; value: T }
  | { ok: false; problem: HandoffProblem; detail: string };

/* ---------------------------------------------------------------------- *
 * The URL
 * ---------------------------------------------------------------------- */

export interface HandoffPointer {
  /** Absolute path to the handoff document. */
  file: string;
  /** The nonce as presented by whoever opened the link. Not yet verified. */
  nonce: string;
}

/**
 * Build the URL that "Open in DASH" opens.
 *
 * `file` is percent-encoded by `URLSearchParams`, which matters on Windows
 * where a project path contains backslashes, spaces and a drive colon — all of
 * which a hand-built string would get wrong in a way that only shows up on
 * somebody else's machine.
 */
export function handoffUrl(file: string, nonce: string): string {
  const parameters = new URLSearchParams({
    v: String(HANDOFF_VERSION),
    file,
    nonce,
  });
  return `${HANDOFF_SCHEME}://${HANDOFF_HOST}?${parameters.toString()}`;
}

/**
 * Parse a URL the operating system handed us.
 *
 * Everything here is untrusted input from outside the process — on Windows it
 * arrives as an `argv` entry of a second launch, which is about as
 * attacker-adjacent as a string gets. So the checks are structural and refuse
 * anything they do not positively recognise.
 */
export function parseHandoffUrl(raw: string): HandoffResult<HandoffPointer> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, problem: "malformed", detail: "That link is not a URL DASH can read." };
  }

  if (url.protocol !== `${HANDOFF_SCHEME}:`) {
    return { ok: false, problem: "malformed", detail: "That link is not a DASH link." };
  }
  if (url.hostname !== HANDOFF_HOST) {
    return {
      ok: false,
      problem: "malformed",
      detail: "That DASH link is not an agent handoff.",
    };
  }
  if (url.searchParams.get("v") !== String(HANDOFF_VERSION)) {
    return {
      ok: false,
      problem: "unsupported_version",
      detail:
        "That link was made by a newer or older Agent Kit than this DASH understands. Update DASH, or re-run “Open in DASH” from the agent's folder.",
    };
  }

  const file = url.searchParams.get("file") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";

  if (file === "" || !path.isAbsolute(file)) {
    return {
      ok: false,
      problem: "relative_path",
      detail: "That link does not say where the agent is.",
    };
  }
  if (path.basename(file) !== HANDOFF_FILE_NAME) {
    return {
      ok: false,
      problem: "malformed",
      detail: `That link points at something other than a ${HANDOFF_FILE_NAME}.`,
    };
  }
  if (!HEX_TOKEN.test(nonce)) {
    return {
      ok: false,
      problem: "malformed",
      detail: "That link is incomplete. Re-run “Open in DASH” from the agent's folder.",
    };
  }

  return { ok: true, value: { file: path.normalize(file), nonce } };
}

/* ---------------------------------------------------------------------- *
 * The document
 * ---------------------------------------------------------------------- */

/**
 * Read and validate a handoff document.
 *
 * Reading is bounded before it starts: `statSync` decides whether to read at
 * all, so pointing DASH at a 4 GB file costs a stat rather than 4 GB of heap.
 */
export function readHandoff(file: string): HandoffResult<AgentHandoff> {
  let size: number;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) {
      return {
        ok: false,
        problem: "not_a_file",
        detail: "That handoff is not a file.",
      };
    }
    size = stats.size;
  } catch {
    return {
      ok: false,
      problem: "not_found",
      detail:
        "DASH could not find that agent's handoff. It may have been cleaned up — re-run “Open in DASH” from the agent's folder.",
    };
  }

  if (size > MAX_HANDOFF_BYTES) {
    return {
      ok: false,
      problem: "too_large",
      detail: "That handoff file is far larger than a handoff should be, so DASH did not read it.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {
      ok: false,
      problem: "not_json",
      detail: "That handoff file is damaged. Re-run “Open in DASH” from the agent's folder.",
    };
  }

  return validateHandoff(parsed);
}

/**
 * Check a parsed document against the contract.
 *
 * Separate from the reading so the Agent Kit can validate what it is about to
 * write with the same function DASH will use to read it. A producer that can
 * emit a document the consumer refuses is a producer with a bug, and this is
 * where it is caught — at build time on the author's machine rather than in a
 * dialog on a user's.
 */
export function validateHandoff(input: unknown): HandoffResult<AgentHandoff> {
  if (typeof input !== "object" || input === null) {
    return { ok: false, problem: "malformed", detail: "That handoff is not an object." };
  }
  const value = input as Partial<AgentHandoff>;

  if (value.handoff_version !== HANDOFF_VERSION) {
    return {
      ok: false,
      problem: "unsupported_version",
      detail:
        "That handoff was written by a different version of the Agent Kit than this DASH understands.",
    };
  }

  const strings: Array<[keyof AgentHandoff, unknown]> = [
    ["handoff_id", value.handoff_id],
    ["nonce", value.nonce],
    ["created_at", value.created_at],
    ["expires_at", value.expires_at],
    ["agent_id", value.agent_id],
    ["display_name", value.display_name],
    ["summary", value.summary],
    ["project_dir", value.project_dir],
    ["manifest_path", value.manifest_path],
    ["command", value.command],
    ["produced_by", value.produced_by],
  ];
  for (const [field, candidate] of strings) {
    if (typeof candidate !== "string" || candidate.length === 0) {
      return {
        ok: false,
        problem: "malformed",
        detail: `That handoff is missing "${field}".`,
      };
    }
  }

  if (!HEX_TOKEN.test(value.handoff_id as string) || !HEX_TOKEN.test(value.nonce as string)) {
    return {
      ok: false,
      problem: "malformed",
      detail: "That handoff's identifiers are not in the expected form.",
    };
  }

  if (!Array.isArray(value.args) || value.args.some((item) => typeof item !== "string")) {
    return {
      ok: false,
      problem: "malformed",
      detail: "That handoff's argument list is not a list of text.",
    };
  }

  const environment = value.env;
  if (
    typeof environment !== "object" ||
    environment === null ||
    Array.isArray(environment) ||
    Object.values(environment).some((item) => typeof item !== "string")
  ) {
    return {
      ok: false,
      problem: "malformed",
      detail: "That handoff's environment block is not a set of name/value text pairs.",
    };
  }

  if (!isSafeAgentId(value.agent_id as string)) {
    return {
      ok: false,
      problem: "unsafe_agent_id",
      detail:
        "That agent's name cannot be used as a file name. Agent names may use lowercase letters, digits, dots, dashes and underscores.",
    };
  }

  for (const [field, candidate] of [
    ["project_dir", value.project_dir],
    ["manifest_path", value.manifest_path],
  ] as const) {
    if (!path.isAbsolute(candidate as string)) {
      return {
        ok: false,
        problem: "relative_path",
        detail: `That handoff's "${field}" is not a full path, so DASH cannot resolve it.`,
      };
    }
  }

  const offending = secretsInEnvironment(environment as Record<string, string>);
  if (offending.length > 0) {
    return {
      ok: false,
      problem: "secret_in_environment",
      detail:
        `DASH will not store a handoff that carries ${offending.length === 1 ? "a setting" : "settings"} ` +
        `named like ${offending.length === 1 ? "a password" : "passwords"} (${offending.join(", ")}). ` +
        "Credentials belong in DASH's connection setup, not in an agent's registration.",
    };
  }

  return { ok: true, value: value as AgentHandoff };
}

export function isSafeAgentId(value: string): boolean {
  return AGENT_ID.test(value) && value !== "." && value !== "..";
}

/**
 * Environment names a registration may not carry.
 *
 * Two families, refused for different reasons. Anything secret-shaped, because
 * a registration is a durable plaintext artifact and the issue forbids it.
 * Anything `DASH_*`, because those names are DASH's and the runner's — the
 * supervisor already refuses to *start* a child holding one, and refusing to
 * *record* one means the failure lands at the point a person can act on it
 * rather than at the point an agent will not launch.
 */
export function secretsInEnvironment(environment: Record<string, string>): string[] {
  return Object.keys(environment).filter(
    (key) => SECRET_LOOKING_NAME.test(key) || key.toUpperCase().startsWith("DASH_"),
  );
}

/* ---------------------------------------------------------------------- *
 * Verification
 * ---------------------------------------------------------------------- */

/**
 * Does the presented nonce match the one inside the file?
 *
 * Constant time, for the same reason `runner/server.ts` compares its bearer
 * token that way: a naive `===` returns as soon as two bytes differ, and a
 * local process that can time DASH's refusals could walk a prefix out of it.
 * Lengths are compared first because `timingSafeEqual` throws on a mismatch,
 * and a length is not the secret.
 */
export function nonceMatches(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The full check: is this pointer allowed to open this document, right now?
 *
 * Order matters for what the user is told. An expired handoff is a normal,
 * recoverable thing that happens when someone gets distracted, and it deserves
 * its own message; a nonce mismatch is either a bug or somebody guessing, and
 * it deserves the same flat refusal in either case.
 */
export function verifyHandoff(
  handoff: AgentHandoff,
  pointer: HandoffPointer,
  now: Date = new Date(),
): HandoffResult<AgentHandoff> {
  const expiry = Date.parse(handoff.expires_at);
  if (Number.isNaN(expiry)) {
    return {
      ok: false,
      problem: "malformed",
      detail: "That handoff does not say when it expires, so DASH will not open it.",
    };
  }
  if (now.getTime() > expiry) {
    return {
      ok: false,
      problem: "expired",
      detail:
        "That link has expired. Run “Open in DASH” again from the agent's folder to get a fresh one — nothing is wrong with the agent.",
    };
  }
  if (!nonceMatches(handoff.nonce, pointer.nonce)) {
    return {
      ok: false,
      problem: "nonce_mismatch",
      detail:
        "That link does not match the agent's handoff file, so DASH did not open it. Run “Open in DASH” again from the agent's folder.",
    };
  }
  return { ok: true, value: handoff };
}

/* ---------------------------------------------------------------------- *
 * Producing one
 * ---------------------------------------------------------------------- */

export interface HandoffFacts {
  agent_id: string;
  display_name: string;
  summary: string;
  project_dir: string;
  manifest_path: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  produced_by: string;
}

/**
 * Compose a handoff document from what a build knows about itself.
 *
 * The randomness is injected rather than taken from `node:crypto` here so the
 * tests can assert on exact documents; every caller passes the real thing. The
 * result is validated before it is returned, so this function cannot produce a
 * document `readHandoff` would refuse.
 */
export function buildHandoff(
  facts: HandoffFacts,
  identifiers: { handoff_id: string; nonce: string },
  now: Date = new Date(),
  ttlMs: number = HANDOFF_TTL_MS,
): HandoffResult<AgentHandoff> {
  const candidate: AgentHandoff = {
    handoff_version: HANDOFF_VERSION,
    handoff_id: identifiers.handoff_id,
    nonce: identifiers.nonce,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    agent_id: facts.agent_id,
    display_name: facts.display_name,
    summary: facts.summary,
    project_dir: path.resolve(facts.project_dir),
    manifest_path: path.resolve(facts.manifest_path),
    command: facts.command,
    args: [...facts.args],
    env: { ...(facts.env ?? {}) },
    produced_by: facts.produced_by,
  };

  return validateHandoff(candidate);
}
