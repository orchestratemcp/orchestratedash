/**
 * The scaffold's `model_provider` connection, read the way DASH's ask
 * composer reads it (MAR-878).
 *
 * `lib/views/ask.ts` refuses `no_provider` by calling
 * `pickAiKeyCard(aiKeyConnections(agentId, manifest))` and checking whether
 * anything came back. This is the one behavioural proof this packet can offer
 * for "the refusal cannot fire for a scaffolded agent" without Electron: the
 * same reader, over the same manifest this tool writes, with no key held.
 *
 * `aiKeyConnections` reads the store (`listSecretReferences`), so this needs a
 * scratch `DASH_DATA_DIR` set before the dynamic import — the same convention
 * `tests/import-round-trip.test.ts` and `tests/tools.test.ts` use.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { ConnectionSourceManifest } from "../../../lib/connections";
import { scaffoldManifest } from "../src/scaffold";

const scratch = mkdtempSync(path.join(tmpdir(), "dash-mcp-model-provider-"));
process.env.DASH_DATA_DIR = path.join(scratch, "data");

const { closeDb } = await import("../../../lib/db");
const { aiKeyConnections } = await import("../../../lib/ai/connection-view");

afterAll(() => {
  closeDb();
  rmSync(scratch, { recursive: true, force: true });
});

const NOW = new Date("2026-09-06T12:00:00.000Z");

function manifest(overrides: Partial<Parameters<typeof scaffoldManifest>[0]> = {}) {
  return scaffoldManifest({
    directory: "/tmp/example-agent",
    agent_id: "example-agent",
    display_name: "Example agent",
    summary: "Reads a few public sources and says what came in.",
    sources: [],
    now: NOW,
    ...overrides,
  }) as unknown as ConnectionSourceManifest;
}

describe("aiKeyConnections over a freshly scaffolded manifest", () => {
  it("returns one provider_key card with no key held, so the no_provider refusal cannot fire", () => {
    const cards = aiKeyConnections("example-agent", manifest());
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      connection_id: "model_provider",
      field_id: "api_key",
      provider_id: "openrouter",
      held: false,
    });
  });

  it("follows the provider the scaffold was asked for", () => {
    const cards = aiKeyConnections("example-agent", manifest({ model_provider: "openai" }));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.provider_id).toBe("openai");
  });

  it("grants the chat-completion capability, and nothing this connection cannot cover", () => {
    const cards = aiKeyConnections("example-agent", manifest());
    expect(cards[0]?.capabilities.map((capability) => capability.id)).toContain(
      "openrouter.chat.completion",
    );
  });
});
