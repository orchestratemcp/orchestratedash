# MAR-873 — the gate diagnosis holds, the fix does not reach the proof line

Client: Claude Code, `claude --model sonnet`. Worktree
`C:\Users\henri\AppData\Local\Temp\wt-mar873-default-model-d1`, branch
`000henrik/mar-873-default-model-fallthrough`, off `master` at `d4a9a19`.

**No code changed.** This session stopped before editing `lib/views/ask.ts`,
per the packet's own instruction: *"If the diagnosis below does not hold, STOP
AND HAND OFF rather than redesigning."* The gate-order diagnosis holds exactly
as written. A second, deeper gap does not, and reordering the gate cannot
close it without touching things the packet explicitly puts out of scope.

## What was confirmed

1. **The gate order is exactly as described.** `lib/views/ask.ts:120-156`
   checks `no_provider` (via `pickAiKeyCard(aiKeyConnections(...))`) strictly
   before `readEffectiveModelChoice`, so an agent whose manifest declares no
   model connection never reaches MAR-642's fleet-default rescue. Confirmed by
   reading the function; nothing about this part of the diagnosis is wrong.
2. **`readEffectiveModelChoice` runs fine without a provider id** — `applyFleetDefault`
   (`lib/ai/model-choice.ts:227`) accepts `agentProviderId: string | null` and
   `sameProvider` treats `null` as "no match" rather than throwing. So the
   reader itself is not the problem.

## The gap the packet did not anticipate

`proof-scout-mar861`'s real manifest — read directly from
`C:\Users\henri\Desktop\projekt\MCP\proof-scout-mar861\agent.manifest.json`,
the same agent the ticket's screenshot names — has:

```json
"agent_dom": { "connections": [] },
"planned_route": [
  { "step": 1, "component_id": "public_feed_fetch",  "model_tier": "none" },
  { "step": 2, "component_id": "brief_compose",        "model_tier": "none" },
  { "step": 3, "component_id": "local_file_write",     "model_tier": "none" }
],
"connection_requirements": null
```

Zero declared connections, and every planned step's `model_tier` is `"none"`
— this agent's own plan never needed a model, so `lib/connections.ts`'s
derived `model_provider` row (`modelProviderRow`) also never fires
(`usedTiers.length === 0`). The Connection Center shows this agent **nothing**
about a model, not even the informational derived row with no button.

That matters because `performAskAction` (`electron/ask-host.ts:64`) — the
function that actually spends money — does not ask "what model resolves for
this agent." It asks `resolveCredentialTarget(agentId, manifest, connection_id,
field_id)` for the `connection_id`/`field_id` the page hands back, and that
call (`lib/connection-credentials.ts:293`) resolves only against
`manifest.agent_dom.connections`. With that array empty, there is no
`connection_id` to hand back in the first place, `resolveCredentialTarget`
returns `unknown_connection` for anything invented, and `performAskAction`
refuses with `dash_error` — *"DASH could not ask the question... Something
went wrong on this computer before anything was sent."*

**Reordering the read-path gate in `lib/views/ask.ts` does not create that
`connection_id`.** Implemented as scoped, it would flip `can_ask` to `true`
and draw the composer with *"This is the model DASH uses when an agent has not
been given one of its own"* — and then every submitted question would fail
with the generic on-computer-fault message above. That is a worse outcome than
today's honest refusal: a promise the surface cannot keep.

## Why the key can't come from the fleet connection directly either

The obvious patch — let the broker read `fleet_connections`' own key for this
request — is not an oversight; it is a boundary this codebase already argued
about and rejected, twice:

- **ADR 0013** ("A connection exists before an agent does") considered *"the
  broker reads the fleet key directly"* and rejected it: it would move the
  vault-name decision into `lib/broker/execute.ts` and turn per-agent
  revocation into a second permission authority beside `lib/broker/grant.ts`.
  Its answer instead is **materialization**: DASH copies the fleet credential
  into a per-agent `connection_secrets` row when an agent's manifest
  *qualifies* — i.e., declares a matching `dash_managed` connection.
- **ADR 0023** ("The chief is a principal") restates the same boundary as an
  invariant enforced in code: `lib/broker/execute.ts:832-837` computes the
  vault secret name as `connectionSecretName(agent_id, ...)` for every
  non-chief principal, "never called for a chief," so that *"no agent, named
  anything at all, resolves to the fleet credential's vault key."*

So even granting the ask-gate a green light does not, by itself, produce
anything to spend against. ADR 0013 already describes the intended shape for
an agent that should light up against the fleet's key with no author
involvement — a manifest that **declares** a `model_provider` connection
(`dash_managed`, `api_key` field, provider `openrouter`) even though nothing
in its own plan needs one — and says explicitly: *"An agent emitted this way
needs no fleet-specific member. It lights up against a connection the person
made before it existed."* `proof-scout-mar861` was not emitted that way: its
manifest has no connections at all, model-needing or otherwise.

And declaring the connection is necessary but **not sufficient** on its own —
ADR 0013 also states that materialization for an agent imported *after* the
fleet connection was made is deliberately not automatic (moment 3, `fleet.share`):
it names the waiting agents and asks for one button press. That adoption
surface is explicitly MAR-874's territory, which this packet says not to
start.

## What this means for MAR-873

Henrik's ruling is right and the fleet-default *model* fallback (MAR-642) is
correctly built and correctly reachable once a key exists. The actual blocker
for "every agent talks out of the box" is one layer upstream of
`lib/views/ask.ts`:

1. An agent built with no model-needing steps is emitted with **no model
   connection declared at all**, so there is nothing for `aiKeyConnections` to
   find and nothing for materialization to ever reach — likely a gap in
   whatever emits `proof-scout-mar861`'s manifest (MAR-862's plugin path), not
   in DASH itself.
2. Even with the connection declared, a freshly-imported agent needs the
   adoption step ADR 0013 describes on purpose (MAR-874) before its per-agent
   secret exists.

Reordering `lib/views/ask.ts`'s gate is real and worth doing *once (1)
produces a manifest with a declared connection and (2) has a path to a held
key* — at that point the reorder is exactly MAR-642's own rescue, reachable
one refusal earlier. Doing it first, alone, produces a UI that lies.

## Recommendation (not a decision — none made here)

Two candidate follow-ups, sequenced before this packet's reorder:

- Check whether agents emitted by the MAR-862 plugin path should always carry
  the ADR-0013-shaped `model_provider` connection block regardless of their
  own plan's `model_tier` usage, since the **ask** feature's need for a model
  is universal and independent of what an agent's own steps need.
- MAR-874 (already filed) for the adoption/materialization surface a person
  needs to press once for an agent imported after its provider's fleet
  connection existed.

This session touched no other files, opened no PR with code changes, and
leaves `master` and the `no_provider` refusal exactly as they were.
