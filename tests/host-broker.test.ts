/**
 * The broker on the host: its closed set, its refusals, and its allowance
 * (MAR-629, ADR 0021).
 *
 * ## What this file is the blocking half of
 *
 * ADR 0021 splits its proof obligations in two and ADR 0004 keeps the second
 * list attended permanently. This is the first list: the protocol, the closed
 * set, the refusal shapes, the allowance arithmetic and the secret discipline,
 * all of which are decided on values and are therefore provable on a machine
 * with no host, no key, no `ssh` and no network.
 *
 * What it does not prove, and no green run here may be read as proving:
 * Hostinger, `sshd`, a real filesystem's owners, or a provider. `186.240.156.166`
 * predates this pack and was not reached. The key crossing itself — ADR 0018's
 * `install-key` and its consent ceremony — is not in this pack at all, so the
 * store below is written by the pack's own primitive and not by a verb DASH can
 * send.
 *
 * ## Why the fetch is the only thing substituted
 *
 * `tests/deploy-bridge.test.ts` set the bar: the production function, the
 * production helper, one substitution. Here the broker is the production
 * `createHostBroker`, the operations are the production catalogue, the store is
 * the production `runner/host-pack.ts` on a real temporary directory, and the
 * planted key is read back through real AES-GCM. Only `fetchImpl` is a stand-in,
 * which is what lets the last assertion in this file be made from outside: a
 * value planted in the store appears in no answer, no audit row and no log line.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { AI_PROVIDER_IDS } from "../lib/ai/providers";
import {
  HOST_BROKER_OPERATIONS,
  isHostBrokerOperation,
} from "../lib/broker/host-operations";
import { BROKER_CALLS_PER_WINDOW, BROKER_WINDOW_MS } from "../lib/broker/execute";
import { SPEND_ALLOWANCE_CALLS, SPEND_ALLOWANCE_MS } from "../lib/broker/spend-allowance";
import type { ConnectionSourceManifest } from "../lib/connections";
import {
  createHostBroker,
  type HostBroker,
  type HostBrokerAuditRow,
} from "../runner/host-broker";
import { ensureHostPack, readHostKey, writeHostKey } from "../runner/host-pack";

const directories: string[] = [];

function freshHost(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "dash-host-broker-"));
  directories.push(directory);
  ensureHostPack(directory);
  return directory;
}

afterAll(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** The value planted in the store. Nothing this broker emits may contain it. */
const PLANTED_KEY = "sk-or-v1-PLANTEDdeadbeefPLANTEDdeadbeefPLANTED";
const AGENT = "scout";
const BUNDLE = "news-scout";

/** A manifest declaring one model-provider key, as `tests/broker-spend.ts` writes it. */
function keyManifest(provider: string): ConnectionSourceManifest {
  return {
    agent_dom: {
      connections: [
        {
          id: "models",
          provider,
          label: "Your model provider",
          purpose: "Answer questions about what this agent saved",
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
          validation_action: { id: "check", label: "Check", behavior: "test" },
        },
      ],
    },
  } as ConnectionSourceManifest;
}

const ANSWER_BODY = {
  choices: [{ message: { content: "Two reports mention tariffs." } }],
  model: "openai/gpt-5-mini",
  usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0002 },
};

const COMPLETION_INPUT = {
  model: "openai/gpt-5-mini",
  question: "What have you found about tariffs?",
  material: "[1] Tariffs rise again\nSource: Example Wire\nThe rate went up.",
  max_output_tokens: 700,
};

interface Harness {
  broker: HostBroker;
  audit: HostBrokerAuditRow[];
  calls: { url: string; headers: Record<string, string>; body: string | undefined }[];
  hostRoot: string;
  /** Every line the wiring would have logged. Searched for the planted key. */
  logs: string[];
  at: { value: number };
}

function harness(
  options: {
    provider?: string;
    manifest?: ConnectionSourceManifest | null;
    model?: string | null;
    placeKey?: boolean;
    status?: number;
    body?: unknown;
  } = {},
): Harness {
  const provider = options.provider ?? "openrouter";
  const hostRoot = freshHost();
  if (options.placeKey !== false) {
    const written = writeHostKey(hostRoot, BUNDLE, "models", PLANTED_KEY);
    expect(written.ok).toBe(true);
  }

  const audit: HostBrokerAuditRow[] = [];
  const calls: Harness["calls"] = [];
  const logs: string[] = [];
  const at = { value: Date.parse("2026-08-16T12:00:00.000Z") };

  const broker = createHostBroker({
    readManifest: () =>
      options.manifest === undefined ? keyManifest(provider) : options.manifest,
    readKey: (connectionId) => readHostKey(hostRoot, BUNDLE, connectionId),
    readModelChoice: () => (options.model === undefined ? "openai/gpt-5-mini" : options.model),
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: init.body as string | undefined,
      });
      return new Response(JSON.stringify(options.body ?? ANSWER_BODY), {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
    audit: (row) => {
      audit.push(row);
      logs.push(`[runner] host-broker-audit ${JSON.stringify(row)}`);
    },
    now: () => new Date(at.value),
  });

  return { broker, audit, calls, hostRoot, logs, at };
}

function ask(
  broker: HostBroker,
  operation: string,
  input: Record<string, unknown> = {},
  requestId = `req-${String(Math.random()).slice(2)}`,
  connectionId = "models",
): Promise<unknown> {
  return broker.adjudicate(AGENT, {
    request_id: requestId,
    connection_id: connectionId,
    operation,
    input,
  });
}

function refusalOf(answer: unknown): string | undefined {
  return (answer as { refusal?: string } | null)?.refusal;
}

/* ---------------------------------------------------------------------- *
 * The closed set
 * ---------------------------------------------------------------------- */

describe("the host broker's own operation set", () => {
  it("is exactly three operations per model provider, pinned by value", () => {
    /*
     * ADR 0021 rule 2: v1 is **narrower** than local DASH, not a copy of
     * `lib/broker/operations.ts` by inertia. This is that narrowing, countable.
     *
     * Pinned by value rather than derived in the assertion, for `DEPLOY_VERBS`'
     * reason: the one way this set can grow without somebody editing
     * `lib/broker/host-operations.ts` is a fourth model provider joining
     * `AI_PROVIDER_IDS`, and this line is where that widening becomes a diff
     * somebody reads.
     */
    expect([...HOST_BROKER_OPERATIONS]).toEqual([
      "openrouter.models.list",
      "openrouter.chat.completion",
      "openrouter.digest.curate",
      "anthropic.models.list",
      "anthropic.chat.completion",
      "anthropic.digest.curate",
      "openai.models.list",
      "openai.chat.completion",
      "openai.digest.curate",
    ]);
    expect(HOST_BROKER_OPERATIONS).toHaveLength(AI_PROVIDER_IDS.length * 3);
  });

  it("matches exactly, so no name can be widened into the set by shape", () => {
    /*
     * A suffix or prefix test would admit `gmail.chat.completion` and
     * `anything.models.list`, and an operation id arrives from a child process
     * this repository did not write.
     */
    expect(isHostBrokerOperation("openrouter.chat.completion")).toBe(true);
    for (const invented of [
      "gmail.chat.completion",
      "anything.models.list",
      "openrouter.chat.completion.extra",
      "OPENROUTER.CHAT.COMPLETION",
      "openrouter.chat.completions",
      "",
      "__proto__",
      "toString",
    ]) {
      expect(isHostBrokerOperation(invented)).toBe(false);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The refusals ADR 0021 names
 * ---------------------------------------------------------------------- */

describe("what the host broker refuses", () => {
  it("refuses Gmail by name, and never touches the store to do it", async () => {
    /*
     * ADR 0021's argued omission. A Gmail refresh token is a different custody
     * class — OAuth, restricted scopes, a third party at consent, and a
     * revocation that is not "rotate at the provider" — and putting one on a VPS
     * is a new ceremony rather than a reuse of `install-key`. So v1 refuses it,
     * and refusing to broker it is explicitly *not* permission to hand the agent
     * the token instead.
     *
     * `unknown_operation` is the same code an agent gets locally for a Gmail
     * name DASH never built, which is the vocabulary rule: the agent learns this
     * broker does not do that, not which machine it is standing on.
     */
    const kit = harness();
    for (const gmail of [
      "gmail.search",
      "gmail.message.read",
      "gmail.draft.create",
      "gmail.send",
      "gmail.message.delete",
    ]) {
      expect(refusalOf(await ask(kit.broker, gmail))).toBe("unknown_operation");
    }
    expect(kit.calls).toEqual([]);
    // Refused before the secrets tree is read, so an operation this host will
    // never perform cannot cause a key read by being asked for.
    expect(kit.audit.every((row) => row.decision === "refused")).toBe(true);
  });

  it("refuses MCP, which is the substrate ADR 0020 will ask admission on later", async () => {
    const kit = harness();
    for (const mcp of ["mcp.tools.call", "mcp.tools.list", "mcp.resources.read"]) {
      expect(refusalOf(await ask(kit.broker, mcp))).toBe("unknown_operation");
    }
    expect(kit.calls).toEqual([]);
  });

  it("has no field a caller could put a URL, a method or a header in", async () => {
    /*
     * ADR 0002 invariant 3, applied on the host. The request shape carries an
     * operation, a connection and typed input — there is no destination field to
     * be careless about — and this drives the point from the other side: an
     * agent that *invents* those names changes nothing about where the request
     * goes, because `planCall` builds the URL from the operation's frozen path
     * and the profile's origin.
     */
    const kit = harness();
    const answer = await ask(kit.broker, "openrouter.models.list", {
      url: "https://attacker.example/steal",
      method: "DELETE",
      path: "/v1/keys",
      headers: { authorization: "Bearer nope" },
      origin: "https://attacker.example",
    });
    expect((answer as { ok: boolean }).ok).toBe(true);
    expect(kit.calls).toHaveLength(1);
    expect(kit.calls[0]?.url).toBe("https://openrouter.ai/api/v1/models");
    // The names travelled into the audit, because names are what an audit
    // records. The values did not go anywhere at all.
    expect(kit.audit.at(-1)?.input_keys).toEqual([
      "headers",
      "method",
      "origin",
      "path",
      "url",
    ]);
  });

  it("refuses a connection the agent's own manifest does not declare", async () => {
    const kit = harness();
    expect(
      refusalOf(await ask(kit.broker, "openrouter.models.list", {}, "req-a", "invented")),
    ).toBe("unknown_connection");

    // And an agent this runner has no manifest for at all.
    const noManifest = harness({ manifest: null });
    expect(refusalOf(await ask(noManifest.broker, "openrouter.models.list"))).toBe(
      "unknown_connection",
    );
  });

  it("refuses an operation aimed at a connection belonging to another provider", async () => {
    /*
     * Written out on the host rather than left implicit in a grant resolution,
     * because the failure it prevents is worse here: an `openai.chat.completion`
     * against an `anthropic` connection would reach the wrong company's origin
     * with the wrong body, carrying somebody's key.
     */
    const kit = harness({ provider: "anthropic" });
    expect(refusalOf(await ask(kit.broker, "openai.models.list"))).toBe("not_granted");

    /*
     * And with a press open, so the mismatch is caught on its own merits rather
     * than by the allowance getting there first.
     *
     * That ordering is deliberate and is the local broker's: the spend gate is
     * the cheapest refusal in the sequence and runs before the manifest and
     * before the store, so an agent that may not spend at all does not cause a
     * key read by asking. It means a spend aimed at the wrong provider reads as
     * `needs_a_person` outside a run — correct, and worth pinning so nobody
     * "fixes" the order later.
     */
    expect(
      refusalOf(await ask(kit.broker, "openai.chat.completion", { ...COMPLETION_INPUT })),
    ).toBe("needs_a_person");
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    expect(
      refusalOf(await ask(kit.broker, "openai.chat.completion", { ...COMPLETION_INPUT })),
    ).toBe("not_granted");

    expect(kit.calls).toEqual([]);
  });

  it("refuses when no key was placed, and when the one placed cannot be opened", async () => {
    const empty = harness({ placeKey: false });
    expect(refusalOf(await ask(empty.broker, "openrouter.models.list"))).toBe("not_connected");
    expect(empty.calls).toEqual([]);

    /*
     * A file at the slot this pack cannot decrypt — a re-minted wrapping key, a
     * truncated write, something placed by hand. `revoked` is the honest code
     * because its next move is the right one: stop, and let a person place a
     * working key.
     */
    const damaged = harness();
    writeFileSync(
      path.join(damaged.hostRoot, "secrets", "keys", BUNDLE, "models"),
      "not a sealed key",
      "utf8",
    );
    expect(refusalOf(await ask(damaged.broker, "openrouter.models.list"))).toBe("revoked");
    expect(damaged.calls).toEqual([]);
  });

  it("cannot read a key placed for a different bundle", () => {
    /*
     * ADR 0021 refuses "a key placed for a different bundle" by name, and says
     * why it cannot be the account that separates them: the helper and every
     * runner share one uid, so `0600` is not isolation between two agents on one
     * host. The bundle id is, and it is captured in the wiring rather than
     * passed as an argument — so this asserts the store directly, which is the
     * layer that has to hold.
     */
    const hostRoot = freshHost();
    expect(writeHostKey(hostRoot, "news-scout", "models", PLANTED_KEY).ok).toBe(true);

    expect(readHostKey(hostRoot, "news-scout", "models")).toEqual({
      kind: "found",
      key: PLANTED_KEY,
    });
    expect(readHostKey(hostRoot, "other-bundle", "models")).toEqual({ kind: "absent" });

    /*
     * And moving the sealed file into another bundle's directory does not make
     * it that bundle's key: the slot is the additional authenticated data, so it
     * fails to open rather than being read as somebody else's credential. Without
     * that, the scope would be a check on a path — and a path is what an attacker
     * holding the account already has.
     */
    const sealed = readFileSync(path.join(hostRoot, "secrets", "keys", "news-scout", "models"));
    expect(writeHostKey(hostRoot, "other-bundle", "models", "placeholder").ok).toBe(true);
    writeFileSync(path.join(hostRoot, "secrets", "keys", "other-bundle", "models"), sealed);
    expect(readHostKey(hostRoot, "other-bundle", "models")).toEqual({ kind: "unusable" });
  });
});

/* ---------------------------------------------------------------------- *
 * Spend, and the press that opens it
 * ---------------------------------------------------------------------- */

describe("a Run on this host is what may spend on this host", () => {
  it("answers a read with no allowance open at all", async () => {
    /*
     * `.models.list` costs nothing, so requiring a press for it would burn an
     * allowance on a question. The gate is about spending and nothing else —
     * the same split the local broker keeps.
     */
    const kit = harness();
    const answer = await ask(kit.broker, "openrouter.models.list");
    expect((answer as { ok: boolean }).ok).toBe(true);
    expect(kit.audit.at(-1)).toMatchObject({
      decision: "allowed",
      operation: "openrouter.models.list",
      decided_on: "host",
    });
  });

  it("refuses a spend with no press, and answers the same request after one", async () => {
    const kit = harness();
    expect(
      refusalOf(await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT })),
    ).toBe("needs_a_person");
    expect(kit.calls).toEqual([]);

    // ADR 0014's remote Run now, arriving where the money is actually spent.
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));

    const answered = await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT });
    expect((answered as { ok: boolean; result?: Record<string, unknown> }).ok).toBe(true);
    expect(
      (answered as { result: Record<string, unknown> }).result["answer"],
    ).toBe("Two reports mention tariffs.");
    expect(kit.calls).toHaveLength(1);
    expect(new URL(kit.calls[0]?.url ?? "").pathname).toBe("/api/v1/chat/completions");
  });

  it("spends the press down and then refuses again, on attempts rather than successes", async () => {
    /*
     * `SPEND_ALLOWANCE_CALLS` is two: one for the run's curation step, one so a
     * step that failed on a torn connection can be retried inside the same run.
     * Read from the constant rather than written as `2`, so the day somebody
     * widens it this test widens with it and `tests/broker-spend.test.ts` is the
     * pin that fires.
     */
    const kit = harness();
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    for (let call = 0; call < SPEND_ALLOWANCE_CALLS; call += 1) {
      const answer = await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT });
      expect((answer as { ok: boolean }).ok).toBe(true);
    }
    expect(
      refusalOf(await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT })),
    ).toBe("needs_a_person");
  });

  it("lets the window close on its own clock", async () => {
    /*
     * A window rather than a close-on-run-end signal, and that is the honest
     * choice on a host as much as locally: run-end reaches anybody as an event
     * the agent emits, so closing on it would put the end of the budget in the
     * hands of the process being budgeted. A clock cannot be argued with.
     */
    const kit = harness();
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    kit.at.value += SPEND_ALLOWANCE_MS + 1;
    expect(
      refusalOf(await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT })),
    ).toBe("needs_a_person");
  });

  it("does not stack two presses into a bigger budget", async () => {
    const kit = harness();
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    for (let call = 0; call < SPEND_ALLOWANCE_CALLS; call += 1) {
      expect(
        ((await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT })) as {
          ok: boolean;
        }).ok,
      ).toBe(true);
    }
    expect(
      refusalOf(await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT })),
    ).toBe("needs_a_person");
  });

  it("keeps an allowance open after the DASH that opened it has gone", async () => {
    /*
     * ADR 0021 section 2's load-bearing sentence, driven: *"Closing DASH does not
     * close an allowance already open on the host, and does not open one."*
     *
     * There is nothing to mock, and that is the proof. This broker holds its
     * allowance in its own process on its own machine; no code path anywhere in
     * it consults DASH, reaches a socket, or asks whether anybody is listening.
     * So the way to drive "DASH closed" is to destroy every channel DASH could
     * have used — which is what a harness with no DASH in it already is — and
     * assert the spend still happens.
     */
    const kit = harness();
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    // Time passes, inside the window. Nothing reopens or refreshes anything.
    kit.at.value += SPEND_ALLOWANCE_MS - 1_000;
    const answer = await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT });
    expect((answer as { ok: boolean }).ok).toBe(true);
    expect(kit.calls).toHaveLength(1);
  });

  it("refuses a spend when the owner named no model", async () => {
    /*
     * ADR 0011 decision 1, on the machine where nobody is watching it get
     * billed. A person left the agent on *match each step*, which is a level
     * rather than a model, and this pack resolving one on their behalf would be
     * a second copy of the mapping ADR 0011 refuses to keep — deciding what
     * somebody's account gets charged for.
     */
    const kit = harness({ model: null });
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    expect(
      refusalOf(await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT })),
    ).toBe("no_model_chosen");
    expect(kit.calls).toEqual([]);
  });

  it("sends the owner's model and never the agent's", async () => {
    const kit = harness({ model: "anthropic/claude-haiku-4.5" });
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    await ask(kit.broker, "openrouter.chat.completion", {
      ...COMPLETION_INPUT,
      model: "openai/gpt-5-expensive",
    });
    const sent = JSON.parse(kit.calls[0]?.body ?? "{}") as { model?: string };
    expect(sent.model).toBe("anthropic/claude-haiku-4.5");
    expect(kit.calls[0]?.body).not.toContain("gpt-5-expensive");
  });
});

/* ---------------------------------------------------------------------- *
 * The audit row, and the value that never appears in one
 * ---------------------------------------------------------------------- */

describe("what the host writes down about its own decisions", () => {
  it("records names, counts, a verdict and the machine that decided", async () => {
    const kit = harness();
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    await ask(
      kit.broker,
      "openrouter.chat.completion",
      { ...COMPLETION_INPUT },
      "req-audited",
    );

    const row = kit.audit.at(-1);
    expect(row).toMatchObject({
      agent: AGENT,
      connection_id: "models",
      operation: "openrouter.chat.completion",
      request_id: "req-audited",
      decision: "allowed",
      refusal: null,
      result_count: 1,
      // A pasted key identifies nobody — the same null MAR-582 writes locally.
      account_hint: null,
      // The field that cannot be inferred at ingest. A pulled row is evidence
      // DASH observed a host decision, never DASH making one.
      decided_on: "host",
    });
    expect(row?.input_keys).toEqual([
      "material",
      "max_output_tokens",
      "model",
      "question",
    ]);
  });

  it("audits every refusal too, so the table is decisions and not successes", async () => {
    const kit = harness();
    await ask(kit.broker, "gmail.search", {}, "req-refused");
    expect(kit.audit).toHaveLength(1);
    expect(kit.audit[0]).toMatchObject({
      decision: "refused",
      refusal: "unknown_operation",
      request_id: "req-refused",
      result_count: null,
      decided_on: "host",
    });
  });

  it("refuses a replayed request id rather than answering it twice", async () => {
    const kit = harness();
    expect(((await ask(kit.broker, "openrouter.models.list", {}, "req-once")) as { ok: boolean }).ok).toBe(
      true,
    );
    expect(refusalOf(await ask(kit.broker, "openrouter.models.list", {}, "req-once"))).toBe(
      "duplicate_request",
    );
    expect(kit.calls).toHaveLength(1);
  });

  it("does not burn a request id on a rate-limited attempt", async () => {
    /*
     * The ordering `lib/broker/execute.ts` uses, pinned because a rewrite gets
     * it wrong silently and the symptom appears only on a host.
     *
     * A rate-limited request is one the agent is told to try again, and the
     * natural retry carries the same request id because it is the same logical
     * request. Remembering the id before the rate check would burn it — the
     * retry would come back `duplicate_request` forever, and an agent would be
     * permanently refused for having obeyed the first refusal. That request
     * succeeds locally, so it would be a divergence an agent can observe, which
     * ADR 0021 rule 2 forbids.
     */
    const kit = harness();
    for (let call = 0; call < BROKER_CALLS_PER_WINDOW; call += 1) {
      await ask(kit.broker, "openrouter.models.list", {}, `filler-${String(call)}`);
    }
    expect(refusalOf(await ask(kit.broker, "openrouter.models.list", {}, "req-retried"))).toBe(
      "rate_limited",
    );

    // The window rolls over; the same id is served rather than refused.
    kit.at.value += BROKER_WINDOW_MS + 1;
    const retried = await ask(kit.broker, "openrouter.models.list", {}, "req-retried");
    expect((retried as { ok: boolean }).ok).toBe(true);
  });

  it("puts the key in exactly one place: the authorization header of the call it authorises", async () => {
    /*
     * The assertion this whole file is arranged around, and it is made from
     * outside the broker on a value planted before it was constructed.
     *
     * ADR 0021's blocking obligation: *"key bytes, wrap-key bytes and stable
     * derivatives appear in no argv, answer, log, error, audit value, receipt or
     * renderer payload"*. Everything the broker emitted is searched, including
     * the request body it built and the log line the wiring would have written.
     */
    const kit = harness();
    kit.broker.allowRunSpend(AGENT, new Date(kit.at.value));
    const answer = await ask(kit.broker, "openrouter.chat.completion", { ...COMPLETION_INPUT });

    // It reached the provider, under the header that provider reads.
    expect(kit.calls[0]?.headers["authorization"]).toBe(`Bearer ${PLANTED_KEY}`);

    const wrappingKey = readFileSync(path.join(kit.hostRoot, "secrets", "wrap.key"));
    const everythingEmitted = [
      JSON.stringify(answer),
      JSON.stringify(kit.audit),
      kit.logs.join("\n"),
      kit.calls[0]?.body ?? "",
      // The URL is DASH's own, built from a frozen path — checked anyway,
      // because a key smuggled into a query string is the classic way one
      // reaches a log nobody was watching.
      kit.calls[0]?.url ?? "",
    ].join("\n");

    expect(everythingEmitted).not.toContain(PLANTED_KEY);
    // Nor a fragment of it. A stable derivative of a low-entropy or reused
    // credential is another identifier to protect — ADR 0018 refuses to log one.
    expect(everythingEmitted).not.toContain(PLANTED_KEY.slice(0, 16));
    expect(everythingEmitted).not.toContain(PLANTED_KEY.slice(-16));
    for (const encoding of ["base64", "hex"] as const) {
      expect(everythingEmitted).not.toContain(wrappingKey.toString(encoding));
    }
  });

  it("says nothing about the provider's own answer when the provider says no", async () => {
    /*
     * A provider's error text is a channel out of the boundary and a way for a
     * provider to write into an agent's reasoning — ADR 0002 invariant 7. So the
     * code crosses and nothing derived from the failure does.
     */
    const kit = harness({ status: 500, body: { error: { message: "quota for key sk-or-v1-PLANTED" } } });
    const answer = await ask(kit.broker, "openrouter.models.list");
    expect(refusalOf(answer)).toBe("provider_refused");
    expect(JSON.stringify(answer)).not.toContain("quota");
    expect(JSON.stringify(kit.audit)).not.toContain("quota");

    // 401 and 403 are the pair that must not read as transient: the key stopped
    // being honoured, and retrying will not undo that.
    const rejected = harness({ status: 401, body: {} });
    expect(refusalOf(await ask(rejected.broker, "openrouter.models.list"))).toBe("revoked");
  });
});
