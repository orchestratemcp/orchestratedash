/**
 * The sample agent DASH can create for itself.
 *
 * MAR-423: *"First run ends in a success, not a setup."* Everything DASH could
 * already do required a terminal — `create-dash-agent`, then `cd`, then
 * `npm run open-in-dash` — which is three prerequisites (a shell, Node, npm)
 * before the user has seen anything work at all. This is the same three steps
 * with the terminal taken out of them.
 *
 * ## It is the same path, not a shortcut past it
 *
 * The temptation is to have DASH write a registration directly: it knows what it
 * scaffolded, it is going to ask anyway, and the handoff machinery is right
 * there. That would be a second way to register an agent, and the second way is
 * always the one that quietly skips something — the nonce, the ledger row, the
 * idempotency check, or the consent itself.
 *
 * So this produces a **real handoff**, on disk, in the user's own folder, with a
 * real single-use nonce, and hands the resulting `dash://` URL to the same
 * `openHandoff` a link from a terminal goes through. The user sees the same
 * dialog and DASH takes the same seven ordered checks. The only thing that
 * changed is who ran the scaffolder.
 *
 * ## Why it does not need Node installed
 *
 * The scaffolded project is registered against `BUNDLED_NODE_COMMAND` rather
 * than `node`. See `lib/registration.ts` for why that is a sentinel and not a
 * path, and why storing a real interpreter path would break at the first MSIX
 * update.
 *
 * This is the one place that difference exists. An agent somebody creates with
 * the Agent Kit is still registered against `node`, because they demonstrably
 * have it, and because a project that only runs inside DASH is not the thing the
 * Kit is for.
 *
 * ## The second place that difference exists (MAR-603)
 *
 * `agent-kit/scaffold.ts` writes every step's `model_tier` as `none` — correct
 * for the plain template, which declares nothing DASH could act on until
 * somebody edits it. DASH's own sample is not that agent: it is the one
 * "Try a sample agent" hands a person with the promise, stated on the page
 * that offered it, that DASH's conversation feature (MAR-545) can answer
 * questions about what it found. That feature reads
 * `planned_route[].default_model_level` (ADR 0011) and a plan that declares
 * none is a plan DASH correctly refuses to ask under — *"Nothing to do here.
 * Whoever built it would have to give it one"* (finding 29,
 * `docs/mar-489-attended-run-2026-08-10-evening.md`). For DASH's own sample,
 * DASH is the one who built it.
 *
 * So `declareConversationModelLevel` is the one place this manifest is
 * amended after `planScaffold` returns rather than generalising the change
 * into the template every Agent Kit project starts from: an agent somebody
 * scaffolds by hand has made no promise about answering questions and should
 * not be told it needs a model it never asked for.
 *
 * ## And the third, which is the same argument about money (MAR-619)
 *
 * MAR-603 gave the digest step a level and stopped, because a level was all
 * the conversation feature read. MAR-619 asks the step itself to use a model —
 * *"can we update the AI news scout to acctually read the news, summarize, and
 * put together a curated summary of the latest news with links to its source?
 * We need an model provider for this i guess?"* — and a level names nothing to
 * reach one with.
 *
 * `declareModelProvider` adds the two blocks that do, on exactly the terms
 * above and with one thing at stake that a level did not have: a run of this
 * agent now spends the owner's money. That is why the declaration is DASH's own
 * and not the template's, and why it is `optional` — see the function.
 */

import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { planScaffold, type ScaffoldedFile, type TemplateSources } from "../agent-kit/scaffold";
import { DIGEST_WRITE_COMPONENT } from "./agent-sources";
import { curateOperationId } from "./broker/operations";
import {
  HANDOFF_FILE_NAME,
  HANDOFF_TTL_MS,
  buildHandoff,
  handoffUrl,
  type AgentHandoff,
} from "./handoff";
import { humanizeAgentName } from "./copy/agent-name";
import { BUNDLED_NODE_COMMAND } from "./registration";

/**
 * The sample's identity. One agent, deliberately: this is an onboarding, not a
 * gallery.
 *
 * MAR-457 replaced the folder digest rather than shipping AI News Scout beside
 * it. Two samples would mean two first journeys, two sets of copy and two smoke
 * proofs — and the one nobody demonstrates is the one that quietly rots. The
 * folder digest proved the loop; this one is a thing somebody would keep.
 */
export const SAMPLE_AGENT_ID = "ai-news-scout";
export const SAMPLE_DISPLAY_NAME = "AI News Scout";
export const SAMPLE_SUMMARY =
  "Reads the news sources you choose and writes you a short summary of what is new, with a link to where each item came from.";

/** The folder DASH offers to put it in, under the user's documents directory. */
export const SAMPLE_PARENT_FOLDER = "DASH agents";

/**
 * The scout's model-provider connection, by the three ids that address it
 * (MAR-619).
 *
 * Constants rather than literals for `lib/agent-sources.ts`'s reason: these
 * strings are read by the fleet fan-out, by the credential prompt, by the
 * Connections surface and by the agent's own program, and a literal typed into
 * any of them would be a contract with no single place to reconcile it.
 *
 * OpenRouter and not one of the other two profiles, and the choice is worth
 * stating: it is the only provider of the three that says what an answer cost
 * in the answer itself (`prices_its_own_answer`), so it is the only one on
 * which DASH can put a real figure beside a run without ever holding a price
 * list. For the agent shipped to somebody's first ten minutes with DASH, that
 * is the difference between "this cost you $0.0007" and "your bill is
 * somewhere else".
 */
export const MODEL_CONNECTION_ID = "model_provider";
export const MODEL_FIELD_ID = "api_key";
export const CURATE_OPERATION_ID = curateOperationId("openrouter");

export interface SamplePlan {
  /** The directory that will be created. Absolute. */
  directory: string;
  files: ScaffoldedFile[];
  handoff: AgentHandoff;
  /** The link to hand to `openHandoff`, exactly as a terminal would produce it. */
  url: string;
}

export interface SampleRequest {
  /** Where sample projects live — normally `<documents>/DASH agents`. */
  parentDir: string;
  sources: TemplateSources;
  kitVersion: string;
  now: Date;
  /** Injected so a test can assert the document; real callers pass random bytes. */
  ids: { handoff_id: string; nonce: string };
  /**
   * Directory names already taken, if the caller already knows. Left to
   * `createSampleAgent` to discover in the normal case; a parameter here keeps
   * the planning half free of I/O.
   */
  taken?: readonly string[];
}

export type SampleResult = { ok: true; value: SamplePlan } | { ok: false; problem: string };

/**
 * Give the sample's digest step a level, so the sample can talk (MAR-603).
 *
 * `agent-kit/scaffold.ts` writes `agent.manifest.json` honestly for a
 * template nobody has customised yet: two steps, neither needing a model,
 * because a blank scaffold makes no claim about what it will grow into. This
 * sample is not blank — it is shipped with the explicit promise that it can
 * be asked what it found — so the step that composes what gets written
 * (`DIGEST_WRITE_COMPONENT`) is the one step whose job that promise
 * describes, and it is declared here rather than left to whoever runs the
 * scaffolder to notice its manifest doesn't say what the page already claims.
 *
 * `cheap`, because turning saved headlines into an answer is exactly the
 * "pulls facts out of text already in front of it" case `levelMeaning`
 * describes — see `lib/copy/ask.ts`'s own reasoning for the same step.
 * `model_tier: "small"` is set alongside it because the two fields describe
 * the same fact for a manifest written after ADR-MAR-583's emitter, and
 * `tests/model-levels.test.ts` pins `small` as `cheap`'s only honest partner
 * — leaving `model_tier` at `none` beside a declared level would be two
 * disagreeing claims in the same document.
 *
 * Reads and rewrites only `agent.manifest.json`; every other scaffolded file
 * passes through untouched.
 */
function amendSampleManifest(files: readonly ScaffoldedFile[]): ScaffoldedFile[] {
  return files.map((file) => {
    if (file.path !== "agent.manifest.json") {
      return file;
    }
    const manifest = JSON.parse(file.contents) as Record<string, unknown>;
    declareConversationModelLevel(manifest);
    declareModelProvider(manifest);
    return { path: file.path, contents: `${JSON.stringify(manifest, null, 2)}\n` };
  });
}

/** MAR-603's amendment. See the block above for the whole argument. */
function declareConversationModelLevel(manifest: Record<string, unknown>): void {
  const route = manifest["planned_route"];
  for (const step of Array.isArray(route) ? (route as Array<Record<string, unknown>>) : []) {
    if (step["component_id"] === DIGEST_WRITE_COMPONENT) {
      step["model_tier"] = "small";
      step["default_model_level"] = "cheap";
    }
  }
}

/**
 * The connection that lets the scout summarise what it found (MAR-619).
 *
 * MAR-603 declared the digest step's *level* and stopped there, and its own
 * block said why that was as far as it went: the level was what the
 * conversation feature reads. MAR-619 is Henrik asking the obvious next
 * question — *"can we update the AI news scout to actually read the news,
 * summarize, and put together a curated summary… We need a model provider for
 * this i guess?"* — and the answer is that a level says how strong a model the
 * step needs and names nothing to reach one with.
 *
 * Two blocks, and they are two different documents that happen to be about one
 * connection. `agent_dom.connections` is the **inventory** — who holds the
 * credential, what fields it has, what it may be used for — and it is what
 * `connectableFields` and the fleet fan-out read, so it is the block that makes
 * the OpenRouter key Henrik already connected at fleet level reach this agent
 * at all (`fleetReach` matches on `connections[].provider` and nothing else).
 * `agent_dom.connection_requirements` is the **next action**, and it is what
 * puts a line with a Connect button on the Connections surface for somebody who
 * has not connected one yet. Declaring only the first would connect the agent
 * silently and never offer it; declaring only the second would offer a button
 * over an inventory that never mentioned the provider.
 *
 * ## Why this is here and not in the template
 *
 * `agent-kit/scaffold.ts` stays generic, on MAR-603's exact terms: an agent
 * somebody scaffolds by hand has made no promise about summarising anything and
 * must not be told it needs a provider it never asked for — and, sharper here
 * than it was for a level, must not be handed a declaration that would let a
 * run spend their money. DASH's own sample is the one shipped with the promise
 * on the page that offers it, so DASH is the one who declares what keeping it
 * costs.
 *
 * ## Why it is optional
 *
 * `optional: true`, and it is load-bearing rather than polite. The scout
 * without a model still fetches, still writes a digest, and still shows every
 * headline with its link — `agent-kit/template/agent.mjs` degrades to exactly
 * what it did before this issue and records why on the artifact. An agent that
 * declared this as required would be an agent DASH shows as broken on a machine
 * where it works perfectly well, and `ConnectionRequirementV1.optional`'s own
 * comment names this case: *"an agent that can run degraded is the one that
 * says so."*
 */
function declareModelProvider(manifest: Record<string, unknown>): void {
  const dom = manifest["agent_dom"];
  if (typeof dom !== "object" || dom === null) {
    return;
  }
  const agentDom = dom as Record<string, unknown>;

  agentDom["connections"] = [
    {
      id: MODEL_CONNECTION_ID,
      // The registry's own word for the provider, which is what selects the
      // profile in `lib/ai/providers.ts` and what `fleetReach` matches on.
      provider: "openrouter",
      label: "Your model provider",
      purpose:
        "Turns the headlines this agent collected into a short summary grouped by subject, " +
        "with every item still linked to where it came from.",
      // DASH holds the key and performs the call itself. The agent never
      // receives it — see `ask`'s own comment in the template on why there is
      // no token in its environment.
      ownership: "dash_managed",
      capabilities: [
        {
          id: CURATE_OPERATION_ID,
          label: "Turn what it found into a summary",
          // `spend` and not `write`: the person's own account is charged and
          // nothing appears anywhere. See the schema's own note on this enum.
          access: "spend",
        },
      ],
      fields: [
        {
          id: MODEL_FIELD_ID,
          label: "API key",
          purpose: "So DASH can reach OpenRouter on this agent's behalf.",
          kind: "secret",
          required: true,
          help: "Your OpenRouter account has a keys page; a key made there is what DASH needs.",
          // No `technical.environment_name`, deliberately.
          // `resolveCredentialTarget` refuses a delivery variable for a model
          // provider's key — DASH is a client for these three, so the key is
          // spent inside DASH and never handed to the child process.
        },
      ],
      validation_action: {
        id: "test_model_key",
        label: "Check the key",
        behavior: "test",
      },
    },
  ];

  agentDom["connection_requirements"] = {
    requirements_version: 1,
    requirements: [
      {
        id: MODEL_CONNECTION_ID,
        name: "Your model provider",
        connector_kind: "api_key",
        connection_id: MODEL_CONNECTION_ID,
        // `operations` omitted, which `ConnectionRequirementV1` documents as
        // "the whole connection's requested set". Naming one would be a second
        // list to keep in step with the registry, and this connection's whole
        // requested set is exactly what this agent and the chat on its page
        // both use.
        optional: true,
        why:
          "Without it the scout still collects the news and still links every item to its " +
          "source; it just cannot summarise what it found.",
      },
    ],
  };
}

/**
 * Decide everything, write nothing.
 *
 * Separated from the writing for the same reason `agent-kit/scaffold.ts` is: the
 * interesting failures — a name that cannot be an agent id, a handoff that does
 * not validate — are decidable without a disk, and a test that has to create
 * directories to check a sentence is a test people stop running.
 */
export function planSampleAgent(request: SampleRequest): SampleResult {
  if (!path.isAbsolute(request.parentDir)) {
    return { ok: false, problem: "DASH needs a full path for the folder to create the sample in." };
  }

  const folder = freeFolderName(SAMPLE_AGENT_ID, request.taken ?? []);
  const directory = path.join(request.parentDir, folder);

  const planned = planScaffold(
    {
      directory,
      // The *agent id* stays `folder-digest` even when the folder is
      // `folder-digest-2`. A second copy of the sample is a second agent, and
      // DASH would refuse the handoff as a conflicting registration if they
      // shared a name — so the id follows the folder.
      agent_id: folder,
      display_name: folder === SAMPLE_AGENT_ID ? SAMPLE_DISPLAY_NAME : humanizeAgentName(folder),
      summary: SAMPLE_SUMMARY,
      kit_version: request.kitVersion,
      now: request.now,
    },
    request.sources,
  );
  if (!planned.ok) {
    return { ok: false, problem: planned.problem };
  }

  // MAR-603 and MAR-619: the one place this template's manifest is amended
  // after the fact — see `amendSampleManifest`. Applied before the handoff is
  // built so the consent document and the bytes written to disk agree, which
  // matters more now than it did for a level: the connection declared here is
  // what the person is consenting to when they say yes.
  const files = amendSampleManifest(planned.files);

  const built = buildHandoff(
    {
      agent_id: folder,
      display_name: folder === SAMPLE_AGENT_ID ? SAMPLE_DISPLAY_NAME : humanizeAgentName(folder),
      summary: SAMPLE_SUMMARY,
      project_dir: directory,
      manifest_path: path.join(directory, "agent.manifest.json"),
      command: BUNDLED_NODE_COMMAND,
      args: ["agent.mjs"],
      files,
      produced_by: `DASH sample agent ${request.kitVersion}`,
    },
    request.ids,
    request.now,
    HANDOFF_TTL_MS,
  );
  if (!built.ok) {
    // The facts come from this module, so a failure here is DASH's bug and not
    // the user's. Saying which is what stops it being reported as "the sample
    // is broken on my machine".
    return { ok: false, problem: `DASH could not describe the sample agent: ${built.detail}` };
  }

  const handoffFile = path.join(directory, HANDOFF_FILE_NAME);

  return {
    ok: true,
    value: {
      directory,
      files: [
        ...files,
        { path: HANDOFF_FILE_NAME, contents: `${JSON.stringify(built.value, null, 2)}\n` },
      ],
      handoff: built.value,
      url: handoffUrl(handoffFile, built.value.nonce),
    },
  };
}

/**
 * Create the sample on disk and return the link that adds it.
 *
 * Never overwrites: `freeFolderName` is given what is already there, so a second
 * "Try a sample agent" produces a second folder rather than eating the first.
 * `agent-kit/cli.ts` refuses instead, which is right for a command somebody
 * typed a name into and wrong for a menu item — there is nothing here for a
 * novice to rename.
 */
export function createSampleAgent(
  request: Omit<SampleRequest, "taken">,
): SampleResult {
  let taken: string[] = [];
  try {
    taken = readdirSync(request.parentDir);
  } catch {
    // The parent does not exist yet, which is the ordinary first-run case.
  }

  const planned = planSampleAgent({ ...request, taken });
  if (!planned.ok) {
    return planned;
  }

  for (const file of planned.value.files) {
    const target = path.join(planned.value.directory, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    // The handoff is written 0600 for the same reason `open-in-dash` does it:
    // it carries no credential, but the nonce is what another local user would
    // need to put a proposal in front of this one.
    writeFileSync(
      target,
      file.contents,
      file.path === HANDOFF_FILE_NAME ? { encoding: "utf8", mode: 0o600 } : "utf8",
    );
  }

  return planned;
}

/** `folder-digest`, then `folder-digest-2`, and so on. Never a collision, never a prompt. */
function freeFolderName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) {
    return base;
  }
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${String(suffix)}`;
    if (!taken.includes(candidate)) {
      return candidate;
    }
  }
  // A thousand samples in one folder is not a case worth designing for, but
  // returning something colliding would be worse than a name with a timestamp.
  return `${base}-${String(Date.now())}`;
}
