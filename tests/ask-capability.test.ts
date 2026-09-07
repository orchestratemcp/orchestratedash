/**
 * Truthful readiness: the six states, asserted as tuples (MAR-878, UX-5).
 *
 * ## The defect this file is the gate on
 *
 * Proof Scout's page showed a header chip reading **READY** beside a footer
 * reading *"Proof Scout has no way to answer questions."* — next to a button
 * labelled OPEN CHAT. Both sentences were true. They answer different
 * questions, and until MAR-878 the page had a word for only one of them:
 *
 * - **Runtime state** — can DASH make this agent run its own plan.
 *   `buildAgentControl` decides it and this file asserts it unchanged.
 * - **Capability** — can this agent be asked a question at all.
 * - **The unmet requirement** — the one thing that would change that.
 *
 * ## Why a tuple table and not six separate assertions
 *
 * The acceptance is not "each surface is reasonable"; it is that the four
 * surfaces **agree**. A test with one `expect` per surface passes just as
 * happily when they disagree. So every case here produces one
 * `(header, footer_sentence, action, chief_line)` tuple and the whole tuple is
 * asserted by value: a change that moves the footer's sentence without moving
 * the chief's line fails here, which is exactly the failure that shipped.
 *
 * `chief_line` is read out of `renderBriefing` — the string that actually goes
 * to the model — rather than off the row, so what is pinned is what is sent.
 *
 * ## Real store, real vault, real gate
 *
 * `tests/ai-key-connection.test.ts`' arrangement, for its reason: the questions
 * are "is a key held", "what did the provider say last time" and "what has this
 * agent saved", and a mocked store answers none of them. The provider and the
 * secret prompt are the two injected parts because the real ones make an HTTPS
 * request and open a window.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { ConnectionSourceManifest } from "../lib/connections";
import { buildAgentControl } from "../lib/views/agent-control";
import { renderBriefing, type ChiefBriefingRow } from "../lib/chief/briefing";
import { ASK_CHIEF_ENTRY, describeAskCapability } from "../lib/copy/ask";
import { Vault } from "../lib/vault";
import { FakeSafeStorage } from "./fakes/fake-safe-storage";
import { refusingOAuth } from "./fakes/oauth-operations";
import { scriptedAi } from "./fakes/ai-operations";
import { expectPlainLanguage } from "./helpers/plain-language";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-ask-capability-"));
process.env.DASH_DATA_DIR = dataDir;

const { closeDb } = await import("../lib/db");
const { performConnectionAction } = await import("../lib/connection-actions");
const { ingestArtifacts } = await import("../lib/store");
const { writeFleetModelDefault, clearFleetModelDefault } = await import("../lib/ai/model-store");
const { buildAgentAsk, askCapabilityFor } = await import("../lib/views/ask");
const { briefingFor } = await import("../lib/chief/briefing");

const KEY = "sk-or-v1-7f3Qd2LmZpX9RtVbNwEy";
const MODEL = { provider: "openrouter", model: "anthropic/claude-sonnet-5" };

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

/* ---------------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------------- */

/**
 * An agent whose author declared a model provider, the way a scaffold does
 * since #320.
 */
function declaresProvider(): ConnectionSourceManifest {
  return {
    agent_dom: {
      connections: [
        {
          id: "models",
          provider: "openrouter",
          label: "Your model provider",
          purpose: "Answer questions about what it saved",
          ownership: "dash_managed",
          capabilities: [{ id: "model.completion", label: "Write text", access: "write" }],
          fields: [
            {
              id: "key",
              label: "API key",
              purpose: "So DASH can reach the provider for this agent",
              kind: "secret",
              required: true,
            },
          ],
        },
      ],
    },
  } as unknown as ConnectionSourceManifest;
}

/**
 * An agent whose author declared no model provider at all.
 *
 * The population Proof Scout is in, and the one #320 fixed for *future*
 * scaffolds only — an existing agent keeps the empty declaration, which is why
 * this state is not a legacy curiosity but the commonest one on a real DASH.
 */
function declaresNothing(): ConnectionSourceManifest {
  return { agent_dom: { connections: [] } } as unknown as ConnectionSourceManifest;
}

function vault(): Vault {
  return new Vault({
    directory: path.join(dataDir, "vault"),
    safeStorage: new FakeSafeStorage(),
    platform: "win32",
  });
}

/** Connect a key for one agent, with the provider's answer scripted. */
async function connect(agent: string, status: number): Promise<void> {
  const manifest = declaresProvider();
  const result = await performConnectionAction(
    "connect",
    { agent_id: agent, connection_id: "models", field_id: "key" },
    {
      store: vault(),
      readManifest: () => manifest,
      promptForSecret: () => Promise.resolve(KEY),
      oauth: refusingOAuth(),
      ai: scriptedAi({ status, model_count: status === 200 ? 312 : null }),
    },
  );
  /* Not asserted `ok`. A 401 connect stores the key and reports the refusal as
     `revoked` — `lib/ai/actions.ts` maps the liveness record's `key_refused` to
     that word for the person reading it — and DASH holding a key the provider
     turned down is the whole of the lapsed case below. */
  expect(["connected", "revoked"]).toContain(result.state);
}

/** One digest for this agent, so there is something to answer from. */
function save(agent: string): void {
  const accepted = ingestArtifacts({
    artifact_version: 1,
    agent,
    run_id: `${agent}-run-1`,
    artifact_id: `${agent}-digest-1`,
    kind: "digest",
    title: "Today's findings",
    generated_at: "2026-09-06T09:00:00.000Z",
    sources_fetched: [
      {
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
        status: "ok",
        item_count: 1,
      },
    ],
    items: [
      {
        headline: "Something happened",
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
      },
    ],
  }).accepted;
  expect(accepted).toBe(1);
}

/* ---------------------------------------------------------------------- *
 * The runtime half
 * ---------------------------------------------------------------------- */

/**
 * The header's own answer, from the module that owns it.
 *
 * Called rather than restated, because half of what this file asserts is that
 * MAR-878 did **not** change it. A hard-coded "Ready" here would pass on a day
 * `buildAgentControl` started saying something else.
 */
function headerLabel(status: "ready" | "offline" | null): string {
  if (status === null) {
    return buildAgentControl(null, true, { startable: false }).status.label;
  }
  return buildAgentControl(
    {
      observed_at: "2026-09-06T09:00:00Z",
      overview: {
        status,
        status_detail: "…",
      },
      runs: [],
      tasks: [],
    } as never,
    true,
    { startable: true },
  ).status.label;
}

/* ---------------------------------------------------------------------- *
 * The table
 * ---------------------------------------------------------------------- */

interface Tuple {
  header: string;
  footer_sentence: string;
  action: string;
  chief_line: string;
}

/**
 * The chief's line about this agent, out of the text that is actually sent.
 *
 * `briefingFor` is handed the capability the page resolved — the same value,
 * not a second read — and `renderBriefing` turns the whole briefing into the
 * string the model sees. Pulling the `Questions:` line back out of that string
 * is what makes this an assertion about the wire rather than about a field.
 */
function chiefLine(agent: string, title: string, manifest: ConnectionSourceManifest): string {
  const row = {
    name: agent,
    title,
    goal: "Finds things and writes them down.",
    capabilities: [],
    plan_source: "manifest",
    build_target: "local",
    planned_steps: 1,
    automation_clearance: "manual",
    run_count: 1,
    last_run_at: null,
    origin: { kind: "manifest" },
    compliance: { level: "ok" },
    avatar: "wizard",
    deploy: { can_deploy: false },
    glance: [{ label: "all clear", meaning: "Nothing needs you.", tone: "calm" }],
    running: false,
    hosted_on: [],
    favourite: false,
  } as never;
  const rows: ChiefBriefingRow[] = briefingFor(
    [row],
    new Map([[agent, askCapabilityFor(agent, manifest, title)]]),
  );
  const line = renderBriefing(rows)
    .split("\n")
    .find((one) => one.startsWith("Questions: "));
  expect(line, `no Questions line for ${agent}`).toBeDefined();
  return line ?? "";
}

function tupleFor(
  agent: string,
  title: string,
  manifest: ConnectionSourceManifest,
  status: "ready" | "offline" | null,
): Tuple {
  const view = buildAgentAsk(agent, manifest, [], title);
  return {
    header: headerLabel(status),
    footer_sentence: view.capability.sentence,
    action: view.capability.action.label,
    chief_line: chiefLine(agent, title, manifest),
  };
}

describe("the three facts a page must keep apart (MAR-878)", () => {
  it("a non-chat agent is READY and says so without promising a conversation", async () => {
    const agent = "proof-scout";
    const manifest = declaresNothing();
    save(agent);

    expect(tupleFor(agent, "Proof Scout", manifest, "ready")).toEqual({
      header: "Ready",
      footer_sentence: "Proof Scout has no way to answer questions.",
      action: ASK_CHIEF_ENTRY,
      chief_line:
        "Questions: Proof Scout has no way to answer questions. " +
        "Nothing to do here. Whoever built Proof Scout would have to give it one.",
    });

    /*
     * The whole issue in one assertion. The runtime chip and the capability
     * sentence are both true and they are not the same fact, so the header must
     * not have been quietly relabelled to make the page look consistent —
     * MAR-878 separates the facts, it does not soften the good one.
     */
    const capability = askCapabilityFor(agent, manifest, "Proof Scout");
    expect(capability.reason).toBe("no_provider");
    expect(capability.action.kind).toBe("chief");
    await Promise.resolve();
  });

  it("declares a provider with no key: the same answer whether or not a fleet key exists", async () => {
    /*
     * **The state UX-5's acceptance is sharpest about.** DASH does not look for
     * a fleet key to soften an agent's own missing authorization: "never read a
     * fleet credential directly to conceal missing agent authorization". So
     * these two situations — a fleet default exists, and none does — produce
     * one tuple, deliberately, and this test exists to keep them that way.
     */
    const withFleet = "scout-with-fleet";
    const withoutFleet = "scout-without-fleet";
    const manifest = declaresProvider();

    clearFleetModelDefault();
    const alone = tupleFor(withoutFleet, "Scout", manifest, "ready");

    expect(writeFleetModelDefault(MODEL.provider, MODEL.model, "2026-09-06T09:00:00Z")).toBe(true);
    const beside = tupleFor(withFleet, "Scout", manifest, "ready");

    expect(beside).toEqual(alone);
    expect(alone).toEqual({
      header: "Ready",
      footer_sentence: "Scout can answer questions once Your model provider is connected.",
      action: "Connect Your model provider",
      chief_line:
        "Questions: Scout can answer questions once Your model provider is connected. " +
        "Connect Your model provider.",
    });
    clearFleetModelDefault();
    await Promise.resolve();
  });

  it("a connected key with no model named points at the picker, not at the key", async () => {
    const agent = "scout-no-model";
    const manifest = declaresProvider();
    clearFleetModelDefault();
    await connect(agent, 200);
    save(agent);

    expect(tupleFor(agent, "Scout", manifest, "ready")).toEqual({
      header: "Ready",
      footer_sentence: "Scout has not been told which model to answer with.",
      action: "Choose a model",
      chief_line:
        "Questions: Scout has not been told which model to answer with. " +
        "Pick a model further up this page.",
    });
  });

  it("a configured agent with nothing saved is asked to run, not to connect anything", async () => {
    const agent = "scout-empty";
    const manifest = declaresProvider();
    await connect(agent, 200);
    expect(writeFleetModelDefault(MODEL.provider, MODEL.model, "2026-09-06T09:00:00Z")).toBe(true);

    expect(tupleFor(agent, "Scout", manifest, "ready")).toEqual({
      header: "Ready",
      footer_sentence: "Scout has not saved anything yet.",
      action: "Run it once",
      chief_line:
        "Questions: Scout has not saved anything yet. Run Scout once, then come back and ask.",
    });
  });

  it("a lapsed key is a caution beside the capability and never a fifth refusal", async () => {
    /*
     * MAR-878 explicitly does not turn a stale liveness record into a gate.
     * `electron/ask-host.ts` is untouched and would still send the question, so
     * a page that refused here would refuse what main would answer — the
     * inverse of the rule the gate order exists for. The honest surface says
     * both things: you can ask, and the provider turned this key down last time.
     */
    const agent = "scout-lapsed";
    const manifest = declaresProvider();
    await connect(agent, 401);
    save(agent);
    expect(writeFleetModelDefault(MODEL.provider, MODEL.model, "2026-09-06T09:00:00Z")).toBe(true);

    const view = buildAgentAsk(agent, manifest, [], "Scout");
    expect(view.can_ask).toBe(true);
    expect(view.capability.reason).toBe("available");
    expect(view.capability.caution).toBe(
      "Your model provider turned this key down the last time DASH checked, " +
        "so a question may not get through.",
    );
    expect(tupleFor(agent, "Scout", manifest, "ready")).toEqual({
      header: "Ready",
      footer_sentence: "Scout can answer questions about what it has saved.",
      action: "Ask",
      chief_line:
        "Questions: Scout can answer questions about what it has saved. " +
        "Type a question in the box at the bottom of this page.",
    });
  });

  it("a stopped agent with saved output can still be asked, and the header still says stopped", async () => {
    /*
     * The pair that made the two facts obviously separate, in the other
     * direction from Proof Scout: the process is not running and the questions
     * work perfectly, because a question is answered from what the agent
     * already saved and starts nothing.
     */
    const agent = "scout-stopped";
    const manifest = declaresProvider();
    await connect(agent, 200);
    save(agent);
    expect(writeFleetModelDefault(MODEL.provider, MODEL.model, "2026-09-06T09:00:00Z")).toBe(true);

    const tuple = tupleFor(agent, "Scout", manifest, "offline");
    expect(tuple.header).toBe("Offline");
    expect(tuple).toEqual({
      header: "Offline",
      footer_sentence: "Scout can answer questions about what it has saved.",
      action: "Ask",
      chief_line:
        "Questions: Scout can answer questions about what it has saved. " +
        "Type a question in the box at the bottom of this page.",
    });
  });

  it("a fully configured agent says the same thing in all four places", async () => {
    const agent = "scout-configured";
    const manifest = declaresProvider();
    await connect(agent, 200);
    save(agent);
    expect(writeFleetModelDefault(MODEL.provider, MODEL.model, "2026-09-06T09:00:00Z")).toBe(true);

    const view = buildAgentAsk(agent, manifest, [], "Scout");
    expect(view.can_ask).toBe(true);
    expect(view.capability.caution).toBeNull();
    expect(tupleFor(agent, "Scout", manifest, "ready")).toEqual({
      header: "Ready",
      footer_sentence: "Scout can answer questions about what it has saved.",
      action: "Ask",
      chief_line:
        "Questions: Scout can answer questions about what it has saved. " +
        "Type a question in the box at the bottom of this page.",
    });
  });
});

describe("the chief is told the page's own recovery sentence (MAR-878)", () => {
  /*
   * ADR 0023's briefing rule is that every field on a row is a string DASH
   * already renders on a screen. This is that rule checked for the new field:
   * the chief's line about an agent it cannot hand a question to contains,
   * verbatim, the sentence the page shows and the action the page offers — so
   * an answer built from it cannot send somebody somewhere else.
   */
  const reasons = ["no_provider", "no_key", "no_model_chosen", "nothing_saved"] as const;

  it.each(reasons)("carries the page's words for %s", (reason) => {
    const capability = describeAskCapability(reason, {
      agent: "Proof Scout",
      service: "OpenRouter",
    });
    const rows = briefingFor(
      [
        {
          name: "proof-scout",
          title: "Proof Scout",
          goal: "Finds things.",
          capabilities: [],
          plan_source: "manifest",
          build_target: "local",
          planned_steps: 1,
          automation_clearance: "manual",
          run_count: 1,
          last_run_at: null,
          origin: { kind: "manifest" },
          compliance: { level: "ok" },
          avatar: "wizard",
          deploy: { can_deploy: false },
          glance: [{ label: "all clear", meaning: "Nothing needs you.", tone: "calm" }],
          running: false,
          hosted_on: [],
          favourite: false,
        } as never,
      ],
      new Map([["proof-scout", capability]]),
    );
    const text = renderBriefing(rows);
    expect(text).toContain(capability.sentence);
    expect(text).toContain(capability.recovery);
    // The id is DASH's key for the state, never prose — `renderBriefing`'s own
    // rule about `agent`, applied to the field beside it.
    expect(text).not.toContain(reason);
    expect(rows[0]?.ask?.reason).toBe(reason);
    expect(rows[0]?.ask?.available).toBe(false);
  });

  it("says nothing about questions for an agent nobody resolved a capability for", () => {
    const rows = briefingFor([
      {
        name: "proof-scout",
        title: "Proof Scout",
        goal: "Finds things.",
        capabilities: [],
        plan_source: "manifest",
        build_target: "local",
        planned_steps: 1,
        automation_clearance: "manual",
        run_count: 1,
        last_run_at: null,
        origin: { kind: "manifest" },
        compliance: { level: "ok" },
        avatar: "wizard",
        deploy: { can_deploy: false },
        glance: [{ label: "all clear", meaning: "Nothing needs you.", tone: "calm" }],
        running: false,
        hosted_on: [],
        favourite: false,
      } as never,
    ]);
    expect(rows[0]?.ask).toBeNull();
    expect(renderBriefing(rows)).not.toContain("Questions:");
  });
});

describe("the words themselves", () => {
  it("every capability sentence is plain language", async () => {
    const { everyAskCapabilitySentence } = await import("../lib/copy/ask");
    expectPlainLanguage(everyAskCapabilitySentence());
  });
});

/* ---------------------------------------------------------------------- *
 * The way the hosts actually build one
 * ---------------------------------------------------------------------- */

describe("the briefing the chief hosts send (MAR-878)", () => {
  /*
   * The gap this closes, and why a test on `briefingFor` alone did not.
   *
   * `briefingFor`’s capability lookup defaults to an empty map, so every
   * assertion that hands it one passes while the two call sites that actually
   * reach a model — `electron/chief-host.ts` and `electron/chief-discord.ts`
   * — send `ask: null`. This drives the composition those two files use,
   * end to end over a real store: `agentsView().agents`, then
   * `briefingFor(agents, askCapabilitiesFor(agents))`, then the render. If
   * either host stops passing the lookup, the argument is gone from one place
   * and this fails.
   *
   * The fixture is the shipped example manifest, which declares no model
   * provider — the `no_provider` state, which is Proof Scout’s and the
   * commonest one on a real DASH, since #320 fixed the template only for
   * agents scaffolded after it.
   */
  it("carries the page’s recovery sentence for an agent that cannot be asked anything", async () => {
    const { importManifest } = await import("../lib/store");
    const { agentsView } = await import("../lib/views/build");
    const { askCapabilitiesFor } = await import("../lib/views/chief");
    const example = JSON.parse(
      readFileSync(path.join(process.cwd(), "examples", "agent.manifest.example.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(importManifest(example)).toMatchObject({ ok: true });

    const agents = agentsView().agents;
    const subject = agents.find((one) => one.name === "email-lead-to-crm");
    expect(subject, "the example manifest did not become a fleet row").toBeDefined();

    // Exactly the two lines both hosts run.
    const rows = briefingFor(agents, askCapabilitiesFor(agents));
    const text = renderBriefing(rows);

    const capability = describeAskCapability("no_provider", {
      agent: subject?.title ?? "",
      service: null,
    });
    const row = rows.find((one) => one.agent === "email-lead-to-crm");
    expect(row?.ask?.reason).toBe("no_provider");
    expect(row?.ask?.available).toBe(false);
    expect(text).toContain(capability.sentence);
    expect(text).toContain(capability.recovery);
    // The id stays a value on the row and never reaches the wire.
    expect(text).not.toContain("no_provider");
  });
});
