/**
 * The three tools, and each one refuses rather than advises (MAR-862,
 * ADR 0032 decision 5).
 *
 * `server.ts` is transport and holds no policy. Everything that decides
 * anything is here, as ordinary functions over ordinary values, so the suite
 * that runs on every push covers it rather than a hand-run MCP session
 * somebody has to remember to do. That split is `lib/folder-import.ts`'s and it
 * is deliberate that this reads like it.
 *
 * The shape every tool returns is the same and the sameness is the point: a
 * caller reads `ok` and, when it is false, `problems` — never prose it has to
 * parse. A coding agent that has to interpret a paragraph to find out what to
 * write is a coding agent that will guess.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

import { AI_PROVIDER_IDS, type AiProviderId } from "../../../lib/ai/providers";
import {
  isReady,
  mergeAnswers,
  nextQuestions,
  planFromDraft,
  resetDraft,
  stepBack,
  unsupportedFor,
  type InterviewAction,
  type InterviewDraft,
  type QuestionId,
} from "./interview";
import { refuseStagingDirectory, templateRoot } from "./paths";
import {
  DEFAULT_MODEL_PROVIDER,
  deriveAgentId,
  planScaffold,
  scaffoldManifest,
  type FeedSource,
  type ScaffoldedFile,
  type TemplateSources,
} from "./scaffold";
import { verdictForManifest, verdictForManifestJson, type ManifestVerdict } from "./validate";
import { handoffMinutes, openUrl, projectFiles, writeHandoff } from "./handoff";
import { repoRoot } from "./paths";

/** The manifest a DASH agent folder is recognised by. */
const MANIFEST_FILE = "agent.manifest.json";

/** The program file DASH's importer looks for before it writes a registration. */
const PROGRAM_FILE = "agent.mjs";

export interface ScaffoldInput {
  directory: string;
  name: string;
  display_name?: string;
  summary: string;
  sources?: readonly FeedSource[];
  /**
   * Which model provider the manifest's `model_provider` connection should
   * name (MAR-878). One of `lib/ai/providers.ts`'s closed list, by value —
   * `AI_PROVIDER_IDS` below. Defaults to `scaffoldManifest`'s own default
   * (currently OpenRouter) when omitted. An unrecognised value is refused
   * rather than passed through, the same rule `readSources` applies to a
   * malformed source: a caller told about its mistake writes a correct
   * manifest next time, a caller silently overridden does not.
   */
  model_provider?: string;
}

/** Is this string one of the providers DASH will hold a model key for? */
function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export type ToolResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; refusal: string; [key: string]: unknown };

/* ---------------------------------------------------------------------- *
 * scaffold
 * ---------------------------------------------------------------------- */

/**
 * Write the whole folder, and validate the manifest **before** any of it is
 * written.
 *
 * The order is the mechanism this packet exists for. Validating afterwards
 * would produce the loop being replaced with one fewer human in it: bytes on
 * disk, a refusal, and somebody editing a file a tool just wrote. Validating
 * first means a manifest this template could not produce correctly never
 * reaches a disk at all, and the caller is told why in the same breath.
 *
 * It is then validated a second time, from the bytes actually on disk. The two
 * checks are not redundant: the first judges the plan, the second judges the
 * write, and a serialiser that lost something between them is exactly the class
 * of defect a plan-only check cannot see.
 */
export function scaffoldAgent(input: ScaffoldInput, now: Date = new Date()): ToolResult {
  const staging = refuseStagingDirectory(input.directory);
  if (staging !== null) {
    return { ok: false, refusal: staging };
  }
  const directory = path.resolve(input.directory);

  let modelProvider: AiProviderId | undefined;
  if (input.model_provider !== undefined) {
    if (!isAiProviderId(input.model_provider)) {
      return {
        ok: false,
        refusal:
          `"${input.model_provider}" is not a model provider DASH holds a key for. ` +
          `Use one of: ${AI_PROVIDER_IDS.join(", ")}.`,
      };
    }
    modelProvider = input.model_provider;
  }

  const agentId = deriveAgentId(input.name);
  if (agentId !== input.name) {
    // Said rather than done silently: the caller asked for one name and is
    // getting another, and a coding agent that is not told will keep using the
    // name it asked for when it writes about this agent later.
    if (agentId.length === 0) {
      return {
        ok: false,
        refusal:
          `“${input.name}” has nothing in it that can be used as an agent name. ` +
          "Agent names are lowercase letters, digits, dots, dashes and underscores.",
      };
    }
  }

  const manifestPath = path.join(directory, MANIFEST_FILE);
  if (existsSync(manifestPath)) {
    return {
      ok: false,
      refusal:
        `${manifestPath} already exists, so there is already an agent here. ` +
        "Scaffolding over it would discard whatever it says. Pick an empty directory, " +
        "or use dash_agent_validate on this one.",
    };
  }

  const request = {
    directory,
    agent_id: agentId,
    display_name: (input.display_name ?? input.name).trim(),
    summary: input.summary.trim(),
    sources: input.sources ?? [],
    now,
    model_provider: modelProvider,
  };

  // Judged before written. See the docblock.
  const planned = verdictForManifest(scaffoldManifest(request));
  if (!planned.ok) {
    return {
      ok: false,
      refusal:
        "The manifest this scaffold would write does not pass DASH's own validator, so nothing " +
        "was written. This is a defect in the template rather than in the request — report it.",
      headline: planned.headline,
      problems: planned.problems,
    };
  }

  let templates: TemplateSources;
  try {
    templates = readTemplates();
  } catch (error) {
    return {
      ok: false,
      refusal:
        `The scaffold's own template files could not be read (${String(error)}). ` +
        `They live in ${templateRoot()}, and the bundled open-in-dash script is built ` +
        "by tools/dash-mcp/build.mjs — run it, or check the checkout this server was started from.",
    };
  }

  const plan = planScaffold(request, templates);
  if (!plan.ok) {
    return { ok: false, refusal: plan.problem };
  }

  try {
    writeFiles(directory, plan.files);
  } catch (error) {
    return { ok: false, refusal: `Could not write the agent folder: ${String(error)}` };
  }

  // Judged again, from the bytes on disk.
  const written = verdictForManifestJson(readFileSync(manifestPath, "utf8"));
  if (!written.ok) {
    return {
      ok: false,
      refusal:
        "The folder was written but its manifest does not validate when read back. " +
        "Do not install it; report this.",
      headline: written.headline,
      problems: written.problems,
    };
  }

  return {
    ok: true,
    agent: agentId,
    directory,
    renamed: agentId === input.name ? undefined : { asked: input.name, using: agentId },
    model_provider: modelProvider ?? DEFAULT_MODEL_PROVIDER,
    files: plan.files.map((file) => file.path),
    manifest_valid: true,
    emits: ["digest", "brief"],
    next: `Call dash_agent_install with directory "${directory}" to hand DASH the import. DASH asks before it stores anything.`,
  };
}

function readTemplates(): TemplateSources {
  const root = templateRoot();
  return {
    agent: readFileSync(path.join(root, "agent.mjs"), "utf8"),
    fingerprint: readFileSync(path.join(root, "brief-fingerprint.mjs"), "utf8"),
    openInDash: readFileSync(path.join(repoRoot(), "tools", "dash-mcp", "dist", "open-in-dash.mjs"), "utf8"),
  };
}

function writeFiles(directory: string, files: readonly ScaffoldedFile[]): void {
  for (const file of files) {
    const target = path.join(directory, ...file.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
  }
}

/* ---------------------------------------------------------------------- *
 * validate
 * ---------------------------------------------------------------------- */

export interface ValidateInput {
  /** A project directory, or the manifest file itself. */
  directory?: string;
  /** A manifest document, for a caller that has not written a file yet. */
  manifest?: unknown;
}

/**
 * Run DASH's import verdict over a manifest, wherever it currently lives.
 *
 * Accepting a document that is not yet a file is not a convenience. It is the
 * shortest possible loop — compose, check, correct, write — and it is the one
 * a coding agent should be in before it ever touches a disk.
 */
export function validateAgent(input: ValidateInput): ToolResult {
  if (input.manifest !== undefined) {
    return asResult(verdictForManifest(input.manifest), { source: "the manifest you passed" });
  }

  if (input.directory === undefined) {
    return {
      ok: false,
      refusal: "Give either a directory holding an agent.manifest.json, or a manifest to check.",
    };
  }

  const resolved = path.resolve(input.directory);
  const manifestPath = resolved.endsWith(".json") ? resolved : path.join(resolved, MANIFEST_FILE);

  let json: string;
  try {
    json = readFileSync(manifestPath, "utf8");
  } catch {
    return {
      ok: false,
      refusal:
        `There is no agent at ${manifestPath}. DASH recognises an agent folder by an ` +
        "agent.manifest.json at its root — run dash_agent_scaffold to make one.",
    };
  }

  const verdict = verdictForManifestJson(json);
  const directory = path.dirname(manifestPath);
  return asResult(verdict, {
    source: manifestPath,
    ...folderNotes(directory, verdict),
  });
}

/**
 * What DASH will and will not be able to do with this folder, beyond whether
 * the manifest is valid.
 *
 * A folder with no program is importable and **not startable**: DASH stores it
 * in ADR 0008's manifest-only standing, says plainly that it cannot run it, and
 * writes no registration. That is a legitimate outcome rather than an error, so
 * it is reported as a note and never as a refusal — but a caller that did not
 * mean it should find out here rather than from a greyed-out button.
 */
function folderNotes(directory: string, verdict: ManifestVerdict): Record<string, unknown> {
  const notes: string[] = [];

  if (!existsSync(path.join(directory, PROGRAM_FILE))) {
    notes.push(
      `There is no ${PROGRAM_FILE} in this folder. DASH will still store the agent and will ` +
        "say plainly that it cannot run it — no registration is written for a folder with no program.",
    );
  }
  if (!existsSync(path.join(directory, "brief-fingerprint.mjs"))) {
    notes.push(
      "There is no brief-fingerprint.mjs. An agent scaffolded by this tool imports it, and " +
        "one that emits a brief without it will fail on its first line.",
    );
  }
  if (verdict.ok && existsSync(path.join(directory, PROGRAM_FILE))) {
    notes.push(`${String(projectFiles(directory).length)} text files would be copied into DASH.`);
  }

  return notes.length === 0 ? {} : { notes };
}

function asResult(verdict: ManifestVerdict, extra: Record<string, unknown>): ToolResult {
  if (verdict.ok) {
    return { ok: true, agent: verdict.agent, manifest_version: verdict.manifest_version, ...extra };
  }
  return {
    ok: false,
    refusal: verdict.headline,
    suggestion: verdict.suggestion,
    problems: verdict.problems,
    agent: verdict.agent,
    ...extra,
  };
}

/* ---------------------------------------------------------------------- *
 * install
 * ---------------------------------------------------------------------- */

export interface InstallInput {
  directory: string;
  /** Skip opening the URL. For a machine with no DASH, and for tests. */
  open?: boolean;
}

/**
 * Stage the folder and hand DASH the import.
 *
 * Validates first and writes no handoff on a refusal, so an agent that would
 * not import leaves nothing behind for somebody to open later and be confused
 * by. What it produces is a proposal and a URL; DASH asks before it stores
 * anything, and this tool has no way to answer for the person.
 */
export function installAgent(input: InstallInput): ToolResult {
  const staging = refuseStagingDirectory(input.directory);
  if (staging !== null) {
    return { ok: false, refusal: staging };
  }
  const directory = path.resolve(input.directory);

  const checked = validateAgent({ directory });
  if (!checked.ok) {
    return {
      ...checked,
      refusal: `${String(checked.refusal)} Nothing was handed to DASH and no handoff was written.`,
    };
  }

  const written = writeHandoff(directory);
  if (!written.ok) {
    return { ok: false, refusal: written.problem };
  }

  if (input.open !== false) {
    openUrl(written.url);
  }

  return {
    ok: true,
    agent: written.handoff.agent_id,
    display_name: written.handoff.display_name,
    directory,
    handoff_file: written.file,
    url: written.url,
    files: written.handoff.files?.map((file) => file.path) ?? [],
    expires_in_minutes: handoffMinutes(),
    next:
      input.open === false
        ? "Open the URL above on the computer where DASH is installed. DASH will ask before it stores anything."
        : "DASH should be opening now and will ask before it stores anything. If nothing happens, DASH is probably not installed — open the URL above on the computer where it is.",
  };
}

/* ---------------------------------------------------------------------- *
 * interview
 * ---------------------------------------------------------------------- */

/**
 * The draft directory inside the author's own project folder.
 *
 * `<project>/.dash/interview-<id>.json`, and every word of that is a decision.
 * It is inside the directory the *caller* named, which is the only place this
 * package is allowed to write at all (ADR 0032 decision 1) — never DASH's data
 * directory, never an installed agent folder. It is dotted so it does not sit
 * beside the agent's own files, and it survives the machine being closed, which
 * is the whole of what "resumable" needs to mean here.
 */
const DRAFT_DIRECTORY = ".dash";

/** Draft ids are made here and read back; anything else is refused by shape. */
const DRAFT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{3,63}$/;

export interface InterviewInput {
  /** The project directory the agent will eventually be built in. */
  directory: string;
  /** Omit to start; pass the id back to resume, later or on another day. */
  draft_id?: string;
  /** Question ids to the person's answers, verbatim. */
  answers?: Record<string, string>;
  action?: InterviewAction;
}

function draftPath(directory: string, draftId: string): string {
  return path.join(directory, DRAFT_DIRECTORY, `interview-${draftId}.json`);
}

function newDraftId(): string {
  return `draft-${randomBytes(4).toString("hex")}`;
}

/**
 * Ask the next question, or say there are none left.
 *
 * All the deciding is in `interview.ts`, over values. What is here is the two
 * things that need a disk — finding the draft and saving it — plus the refusal
 * that guards every path argument this package takes.
 *
 * The draft is written on **every** call, including the first, so "resume"
 * needs nothing more than the id that came back: an interview that only
 * persisted once it was finished would lose exactly the conversations worth
 * resuming.
 */
export function interviewAgent(
  input: InterviewInput,
  now: Date = new Date(),
  makeId: () => string = newDraftId,
): ToolResult {
  const staging = refuseStagingDirectory(input.directory);
  if (staging !== null) {
    return { ok: false, refusal: staging };
  }
  const directory = path.resolve(input.directory);

  let draft: InterviewDraft;
  if (input.draft_id === undefined) {
    const id = makeId();
    draft = {
      draft_id: id,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      answers: {},
      answered_order: [],
    };
  } else {
    if (!DRAFT_ID_PATTERN.test(input.draft_id)) {
      return {
        ok: false,
        refusal:
          `"${input.draft_id}" is not a draft this tool made. Leave draft_id out to start a new ` +
          "interview, or pass back the one an earlier call returned.",
      };
    }
    const file = draftPath(directory, input.draft_id);
    let held: unknown;
    try {
      held = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return {
        ok: false,
        refusal:
          `There is no interview saved at ${file}. Leave draft_id out to start a new one; the ` +
          "answers from the old one are not recoverable.",
      };
    }
    const restored = readDraft(held, input.draft_id, now);
    if (restored === null) {
      return {
        ok: false,
        refusal: `${file} is not a draft this tool can read. Start a new interview without draft_id.`,
      };
    }
    draft = restored;
  }

  const action: InterviewAction = input.action ?? "next";
  let ambiguous: QuestionId[] = [];
  let ignored: string[] = [];

  if (action === "reset") {
    draft = resetDraft(draft, now);
  } else if (action === "back") {
    // Deliberately ignores `answers`: a call that both steps back and writes
    // forward has a result nobody can predict from reading it.
    draft = stepBack(draft, now);
  } else {
    const merged = mergeAnswers(draft, input.answers ?? {}, now);
    draft = merged.draft;
    ambiguous = merged.ambiguous;
    ignored = merged.ignored;
  }

  try {
    mkdirSync(path.join(directory, DRAFT_DIRECTORY), { recursive: true });
    writeFileSync(
      draftPath(directory, draft.draft_id),
      `${JSON.stringify(draft, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    return { ok: false, refusal: `The interview draft could not be saved: ${String(error)}` };
  }

  const ready = isReady(draft);
  const plan = ready ? planFromDraft(draft, directory, now) : null;

  return {
    ok: true,
    draft_id: draft.draft_id,
    draft_file: draftPath(directory, draft.draft_id),
    questions: nextQuestions(draft),
    answered: draft.answers,
    unsupported: unsupportedFor(draft.answers),
    ready,
    ...(ambiguous.length === 0
      ? {}
      : {
          ambiguous,
          ambiguous_note:
            "What was said could be read more than one way for these, so they are being asked rather than assumed.",
        }),
    ...(ignored.length === 0 ? {} : { ignored }),
    ...(plan !== null && plan.ok
      ? { recap: plan.recap, scaffold_request: plan.scaffold_request }
      : {}),
    next: ready
      ? "Show the recap to the person, let them change anything in it, then call dash_agent_plan."
      : "Ask the person the questions above, in the host's own question UI where there is one, and send their answers back with the same draft_id.",
  };
}

/**
 * A draft read back off disk, or null.
 *
 * Every value is re-checked rather than cast. `lib/schedule/store.ts` makes the
 * argument for this better than it could be made again here: the file is on the
 * user's own disk, an editor or a merge can have been through it, and a value
 * that would not have been accepted going in must not become an answer on the
 * strength of having been written once.
 */
function readDraft(held: unknown, draftId: string, now: Date): InterviewDraft | null {
  if (typeof held !== "object" || held === null || Array.isArray(held)) {
    return null;
  }
  const record = held as Record<string, unknown>;
  const answers: Record<string, string> = {};
  const heldAnswers = record["answers"];
  if (typeof heldAnswers === "object" && heldAnswers !== null) {
    for (const [key, value] of Object.entries(heldAnswers as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim().length > 0) {
        answers[key] = value;
      }
    }
  }
  const heldOrder = record["answered_order"];
  const order = Array.isArray(heldOrder)
    ? heldOrder.filter(
        (id): id is QuestionId => typeof id === "string" && answers[id] !== undefined,
      )
    : [];

  return {
    draft_id: draftId,
    created_at: typeof record["created_at"] === "string" ? record["created_at"] : now.toISOString(),
    updated_at: now.toISOString(),
    answers,
    answered_order: order,
  };
}

/* ---------------------------------------------------------------------- *
 * plan
 * ---------------------------------------------------------------------- */

export interface PlanInput {
  directory: string;
  draft_id: string;
}

/**
 * The finished interview, as the exact arguments `dash_agent_scaffold` takes
 * and one recap a person can read.
 *
 * It is a separate tool rather than a flag because it is a separate moment: the
 * host shows this, the person changes what they want, and only then is anything
 * written. Folding it into the interview would make "here is what I am about to
 * build" indistinguishable from "here is my next question", and the one press
 * this design asks a person for is the one on the recap.
 *
 * It adds no validation of its own. The request goes to `dash_agent_scaffold`,
 * which puts it through `verdictForManifest` before a byte is written, exactly
 * as it did before this tool existed (ADR 0032 decisions 4 and 5).
 */
export function planAgent(input: PlanInput, now: Date = new Date()): ToolResult {
  const staging = refuseStagingDirectory(input.directory);
  if (staging !== null) {
    return { ok: false, refusal: staging };
  }
  const directory = path.resolve(input.directory);

  if (!DRAFT_ID_PATTERN.test(input.draft_id)) {
    return {
      ok: false,
      refusal: `"${input.draft_id}" is not a draft this tool made. Run dash_agent_interview first.`,
    };
  }

  const file = draftPath(directory, input.draft_id);
  let held: unknown;
  try {
    held = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {
      ok: false,
      refusal: `There is no interview saved at ${file}. Run dash_agent_interview first.`,
    };
  }
  const draft = readDraft(held, input.draft_id, now);
  if (draft === null) {
    return { ok: false, refusal: `${file} is not a draft this tool can read.` };
  }

  const plan = planFromDraft(draft, directory, now);
  if (!plan.ok) {
    return {
      ok: false,
      refusal: plan.problem,
      remaining: plan.remaining,
      questions: nextQuestions(draft),
    };
  }

  return {
    ok: true,
    draft_id: draft.draft_id,
    recap: plan.recap,
    scaffold_request: plan.scaffold_request,
    unsupported: unsupportedFor(draft.answers),
    next:
      "Show the recap to the person and let them change anything in it before you build. Send a " +
      "changed name back as an agent_name answer to dash_agent_interview, then call this again. " +
      "When they are happy, call dash_agent_scaffold with scaffold_request exactly as it stands.",
  };
}
