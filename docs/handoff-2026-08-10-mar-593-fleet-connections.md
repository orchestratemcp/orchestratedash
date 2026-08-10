# Handoff — MAR-593, fleet-level connections

Session 1 (LEAD) of the four the paused attended run
([`handoff-2026-08-10-attended-run-paused.md`](handoff-2026-08-10-attended-run-paused.md))
set up. Written at the end of the session, with the PR open and CI running.

| | |
| --- | --- |
| Branch | `000henrik/mar-593-fleet-connections`, cut from `origin/master` at `04dc346` |
| Worktree | `C:\Users\henri\Desktop\projekt\MCP\dash-mar593` |
| PR | [#126](https://github.com/orchestratemcp/orchestratedash/pull/126), targeting `master` |
| Commit | `e78d6ca` |
| ADR | [`docs/adr/0013-fleet-connections.md`](adr/0013-fleet-connections.md) |
| Linear | MAR-593, moved to In Review |

---

## The decision, in one paragraph

**A connection is a fleet-level thing and an agent's access to it is a
materialization of that.** A connection is an account or a key the person gave
DASH, recorded against a provider, existing with no agent present. An agent's
grant is unchanged — per-agent credential, per-agent receipt, per-agent
revocation — and is now written *from* the fleet connection rather than being the
only way one can exist.

Two records:

| | What it is | Keyed by | Answers |
| --- | --- | --- | --- |
| `fleet_connections` | the consent | provider | *did you give DASH this?* |
| `connection_secrets` + `broker_grants` | the grant | agent, connection, field | *may this agent use it?* |

**The broker was not touched.** `lib/broker/execute.ts` computes the same
per-agent vault name it always has, so "indistinguishable at the boundary" is a
property of not editing the read path.

---

## The manifest shape — MAR-596 is waiting on this

**The manifest does not change.** Nothing is added and nothing is widened. An
agent declares what it needs exactly as MAR-569 and MAR-582 already specify, and
DASH resolves that declaration against whatever fleet connections exist.

For the model provider F14 is about:

```json
"agent_dom": {
  "connections": [{
    "id": "model_provider",
    "provider": "openrouter",
    "label": "OpenRouter",
    "purpose": "Run the steps in this agent's plan that need a language model.",
    "ownership": "dash_managed",
    "capabilities": [
      { "id": "model.list", "label": "See which models this key can reach", "access": "read" }
    ],
    "fields": [
      { "id": "api_key", "label": "API key", "purpose": "…", "kind": "secret", "required": true }
    ]
  }],
  "connection_requirements": {
    "requirements_version": 1,
    "requirements": [{
      "id": "model_provider",
      "name": "A model provider",
      "connector_kind": "api_key",
      "connection_id": "model_provider"
    }]
  }
}
```

Four rules decide whether DASH takes custody, and all four predate this work:

1. `provider` must be one of `lib/ai/providers.ts`' by-value list —
   `openrouter`, `anthropic`, `openai`. Any other string is an agent-held key
   and DASH says so on the card.
2. `ownership` must be `dash_managed`.
3. The field must **not** declare `technical.environment_name` — refused at
   connect with `brokered_provider_delivery` (ADR 0002 amendment 5).
4. For Google: `provider` is `google-gmail`, the field's `kind` is
   `oauth_reauthorization`, and `technical.provider_scopes` must be inside
   `lib/oauth/providers.ts`' allowlist.

**An agent emitted this way needs no fleet-specific member.** It lights up
against a connection the person made before it existed, and degrades to the
per-agent flow when they have not made one. So MAR-596 can proceed on F4, F5,
F7, F10 and F14 exactly as filed.

---

## What was built

### New — `lib/fleet/`

| File | What it owns |
| --- | --- |
| `principal.ts` | The reserved name a fleet target stands under. **No imports at all**, because both `lib/shell/ipc.ts` (preload-safe) and `lib/fleet/actions.ts` (vault, database, three registries) need it. |
| `catalogue.ts` | What DASH can connect, assembled from `brokerProfileFor` / `oauthProviderFor` / `aiProviders` / `operationsForProvider`. Pure. |
| `grants.ts` | Which agents a connection reaches, and why each skipped one is skipped. Pure. |
| `store.ts` | `fleet_connections` and `fleet_grants`. The only impure module here. |
| `actions.ts` | connect / test / disconnect / share, plus materialization. |

### Changed

- `lib/db.ts` — migration 18: the two tables. `connection_secrets` untouched.
- `lib/connection-actions.ts` — delegates a fleet target; adopts a fleet
  credential on a per-agent connect; records the decision a per-agent connect or
  disconnect implies.
- `lib/shell/ipc.ts` — the `fleet.*` family, routed through the existing
  `connectionAction` dependency.
- `electron/preload.ts`, `app/_data/source.ts` — four named methods each.
- `lib/views/build.ts` + `types.ts` — `ConnectionsView.fleet`.
- `app/settings/page.tsx`, `app/_components/fleet-connector.tsx` — the page.

### Tests

`tests/fleet-connections.test.ts` (24) and `tests/fleet-connector-render.test.tsx`
(13).

**The load-bearing one** is *"resolves a grant indistinguishable from a direct
connect"*: it connects a fleet sign-in against a real vault with **no agents
imported**, imports one afterwards, shares it, and then drives
`connectionSecretName` and `resolveGrant` — the two functions
`lib/broker/execute.ts` itself runs — to a real grant for an agent nobody signed
in.

---

## Three decisions a reviewer should look at hardest

### 1. DASH now decides what to ask a provider for

A fleet sign-in has no manifest, so the scope set is DASH's. It is **derived**:
the union of `required_scopes` over the operations DASH has built for that
provider. That makes *DASH never asks for a scope no operation uses* true by
construction, and it is strictly narrower than the manifest-declared case ADR
0002 amendment 1 names as the one that lets an author widen their own access.
Two tests pin it, including a drift check against the provider's allowlist.

### 2. An agent imported afterwards is not connected silently

This is **stricter than MAR-570** on purpose. Henrik's ruling — *connecting Gmail
once lights up both agents that need it* — holds for every agent present when the
connection is made. An agent that arrives later is named on the card as waiting,
with one button (`fleet.share`) that gives it the consent DASH already holds,
asking for nothing and contacting nobody.

A consent given before a piece of software existed is not a consent to that
software. If Henrik would rather it were automatic, the change is one call at the
import path — but that path is in `electron/main.ts`, which this session did not
own.

### 3. The credential value exists in N+1 vault entries

Not new — MAR-570 shipped the N — and this adds the one that survives every agent
being deleted. It is the price of leaving the broker's read path untouched. The
alternative (the broker reads the fleet key directly) is considered and rejected
in ADR 0013 with the reason: it turns per-agent revocation into a deny row the
broker must consult, which is a second permission authority beside
`lib/broker/grant.ts`.

---

## Verification

From PowerShell, in the worktree:

| Gate | Result |
| --- | --- |
| `state:check` | valid, 0 drift warnings |
| `typecheck` | clean |
| `brand:check` | green |
| `test` | 142 files, 2848 passed, 10 skipped, **1 failed** |
| `verify:shell` | **85 PASS, 0 FAIL**, `[smoke] all proofs passed` |

The one failure is `tests/channel-secret.test.ts`'s *"re-narrows an ACL that was
widened after it was written"* under full parallel load; it passes 21/21 alone.
The recorded parallel-load flake, and nothing in this branch touches channel
secrets or the runner.

`verify:shell` reached a verdict rather than dying in cleanup — the full 85. Two
Electron processes were live throughout and **both were `runner.mjs`**, which
never holds the store lock.

---

## What is not proven, and must not be claimed

- **No installed proof visits this feature.** `electron/smoke.ts` does not
  connect a fleet connection. Its 85 proofs witness that nothing installed broke,
  not that this works.
- **A fleet sign-in to Google is not evidence that signing in to Google works.**
  `loopback-fixtures-cannot-refuse` still stands: DASH's OAuth has never worked
  against real Google. MAR-594 owns it. What this establishes is that a consent,
  once received, is recorded and resolved fleet-wide.
- **Nobody has used this.** No screenshots were captured and Henrik has not
  opened the page. The novice test — can somebody who has never seen DASH find
  where to connect Gmail — is unrun.
- **One account per provider.** A v1 limit, not a principle: the table is keyed
  on provider, and a second account is a second row plus a choice on every card.

---

## Left for somebody else

1. **The other three tabs still repeat their heading.** MAR-592's open question
   is resolved on Connections only (`<h1>` is now "Accounts and keys"). Servers,
   Notifications and Add agent still say their tab word twice, and **add-agent is
   under Henrik's hold** and must not be touched until the attended test.
2. **Materialization on import** — see decision 2 above. `electron/main.ts`.
3. **Screenshots.** No capture harness scene covers the fleet cards.
   `electron/capture-connectors.ts` is the obvious place, and per
   `capture-deploy-has-scenes` the move is to add a scene rather than a harness.
   Remember `capture-needs-both-builds`.
4. **A Discord webhook and a VPS server are already fleet-level** —
   `notify_discord` and `hosts` — and are *not* on this page; they are the
   Notifications and Servers tabs. Nothing in step 2 is blocked by that, but if
   Henrik expects all four in one place, that is a follow-up about the page's
   shape, not about this model.

---

## For the coordinator

Session 2 (the DASH bug batch: F12, F13, F15, F18, F9, F10/F7) is unblocked and
does not collide: this branch changed nothing in `electron/main.ts`,
`agent-kit/**`, `app/agents/**` or `runner/`. It **did** change
`lib/connection-actions.ts`, `lib/shell/ipc.ts`, `electron/preload.ts`,
`lib/views/build.ts` and `app/settings/page.tsx`, so session 2 should rebase on
`master` after #126 merges rather than cutting from `04dc346`.

Session 4 (MAR-596) is unblocked now — the manifest shape is above and it is
"unchanged".
