# ADR 0013: A connection exists before an agent does

Status: Accepted

Date: 2026-08-10

## Decision

A connection is a **fleet-level** thing: an account or a key the person gave
DASH, recorded against a provider, existing with no agent present. An agent's
access to it stays exactly what it was — a per-agent credential, a per-agent
receipt, a per-agent revocation — and is now **materialized from** the fleet
connection rather than being the only place a connection can come from.

Two records, and the split is the whole decision:

| | What it is | Keyed by | Answers |
| --- | --- | --- | --- |
| `fleet_connections` | the consent | provider | *did you give DASH this?* |
| `connection_secrets` + `broker_grants` | the grant | agent, connection, field | *may this agent use it?* |

Nothing about the broker changes. `lib/broker/execute.ts` computes the same
per-agent vault name it always has, reads the same envelope, and resolves the
same three-party intersection. **Indistinguishable at the boundary is not a
property this had to be tested for; it is a property of not touching it.**

## Why

Henrik's test plan, step 2, in his own words: *"Configure dash — sign in to
Google, add OpenRouter, Discord webhook and VPS server."* Step 1 is *"clear dash
from all agents and settings."* So step 2 is performed on a DASH with no agents.

`lib/connections.ts` derives every connection row from `agent_dom.connections`
plus a model-provider row derived from `planned_route[].model_tier`.
`connection_secrets` is keyed by agent. `connectableFields` takes an agent id and
a manifest. With no agents there is no manifest, so there are no rows, so the
Connections page is empty — which is exactly what he hit on 2026-08-10, and it
is not a bug in the page. It is the page telling the truth about a model in which
**a connection is a thing an agent asked for.**

That model was right for what came before it. MAR-383 asked "what does this agent
still need connecting?", and every question after it — MAR-533's four answers,
MAR-570's tiles — kept the agent as the thing a connection hangs off. The model
survived three redesigns of the page because none of them changed the noun.

Two things then arrived that it cannot express:

- **F14, "nowhere to connect".** A model-provider key has no declared home. The
  only row a person sees is the *derived* one, whose own copy says "DASH shows
  this so the list is complete" — a disclosure with no button. There is nowhere
  to put an OpenRouter key because there is no agent to put it under.
- **MAR-570's fan-out.** *"Connecting Gmail once lights up both agents that need
  it."* That is already a fleet-level statement, implemented per-agent:
  `findGrantSharers` copies one received consent into every qualified agent's
  vault entry. The consent was already the unit; it just had nowhere to live, so
  it lived in whichever agent happened to be on screen when the person pressed
  the button.

This ADR does not introduce fleet-level consent. It gives the consent MAR-570
already receives somewhere to be recorded, and lets it be received when no agent
is on screen at all.

## The shape

### The catalogue: what DASH can connect, said by DASH

With no agent there is no manifest, so the list of connectable things cannot come
from one. `lib/fleet/catalogue.ts` is that list, and its membership rule is
`CONNECTOR_KINDS_V1`' rule verbatim: **an entry is here because DASH has built
the flow.** Not because a provider is popular, not because the emitter can name
it, not because it is planned. A catalogue entry is drawn as a card with a
Connect button, and a card DASH cannot fulfil is a lie on a button.

It is assembled from the registries that already decide these facts rather than
restating them — `brokerProfileFor` for the profile, `oauthProviderFor` for the
flow, `aiProviders` for the key-holding providers, `operationsForProvider` for
what DASH can actually do. A second table naming origins or scopes would be free
to disagree with the one the broker uses.

### The scopes DASH asks for are derived, not declared

This is the one genuinely new authority and it is worth stating plainly: for a
fleet sign-in there is no manifest, so **DASH decides what to ask the provider
for.** Previously that was the agent author's declaration
(`field.technical.provider_scopes`), checked against the provider's allowlist.

The answer is not a hand-written list. A catalogue entry's scope set is the union
of `required_scopes` over the operations DASH has built for that provider, which
makes a property true by construction that was previously only checked:

> **DASH never asks for a scope no operation uses.**

`unused_scopes` on a fleet grant is empty because there is nothing spare to ask
for, not because everything matched — and the derivation is what makes those two
the same sentence. Amendment 1 to ADR 0002 named the manifest-alone case as the
one that "lets an agent author widen its own access"; a scope set computed from
DASH's own frozen operation table is narrower than that, not wider.

`gmail.compose` is still the exception ADR 0002 amendment 2 describes: it is the
narrowest permission that can create a draft and it can also send. Nothing here
softens that. `wider_permission` renders before a sign-in as well as after, and a
fleet sign-in is a sign-in.

### Materialization: the fan-out, generalized

When a fleet connection is made, DASH writes the credential to every agent that
independently qualifies for it — the same three steps `shareGrant` already takes,
through the same gate `findGrantSharers` already applies
(`resolveCredentialTarget` per candidate, which refuses an agent whose manifest
declared no scopes, asked for access DASH does not offer, or named an
environment variable DASH will not use). A materialized agent is an agent that
**would have been allowed to run this sign-in itself.**

Materialization runs at three moments, and the third is where a decision was
made that MAR-570 did not have to make:

1. when a fleet connection is connected or re-keyed — every qualifying agent
   present at that moment, which is MAR-570's ruling exactly;
2. when a person presses Connect on one agent's own row and DASH already holds a
   fleet connection for that provider — the credential is adopted rather than a
   second consent screen being opened;
3. through `fleet.share`, for agents imported **after** the connection was made.

### An agent that arrives later is not connected silently

Moment 3 could have been automatic — materialize on import, and Henrik's
configure-then-import ordering would need no button at all. It is deliberately
not, and this is the one place this ADR is stricter than MAR-570 rather than a
generalization of it.

**A consent given before a piece of software existed is not a consent to that
software.** Quietly handing a newly imported agent access to somebody's mailbox
is the shape of consequence ADR 0002 amendment 2 exists to stop: the person would
learn about it from a receipt afterwards. So the card names the agents that are
waiting and offers one button that includes them, which asks for nothing, opens
no window and contacts no provider.

It is not a second sign-in either, which is the other wrong answer: making
somebody re-approve what they have already approved teaches them to click through
consent screens.

Moment 2 is what makes restoring a revoked agent ordinary — the button is the one
its own row has always had — and it is why no per-agent grant command was
invented. Disconnecting an agent from a connection DASH holds at fleet level
**is** withholding it; connecting it again is restoring it.

### Absence means granted; a withdrawal is remembered

`fleet_grants` records a per-agent decision against a fleet connection, and it
records **only decisions a person made**. No row means nobody has decided, which
materializes — that is Henrik's MAR-570 ruling ("connect once, every agent that
needs it lights up") and reversing the default would break it.

A `withheld` row is written when a person revokes one agent from a fleet
connection, and materialization skips it thereafter. Without this, importing a
second agent — or re-pasting a key — would silently re-grant an agent whose
access somebody deliberately took away, which is the failure
`CredentialState.revoked` already exists to prevent one level down: *"somebody
withdrew this access, and that somebody may have been the user on purpose."*

Revoking everywhere deletes the fleet credential, every materialization and every
receipt. The audit rows stay, for the reason ADR 0002 amendment 1 gives: they are
the record of what was done while the access existed, and a disconnect that
erased them would delete exactly the history a suspicious person disconnected in
order to check.

### What the person is told before they press

`describeSharedGrant` says, above the button, which agents one sign-in reaches.
That sentence is now generated from the same materialization list the connect
will actually walk, so a fleet card cannot promise a different set from the one
it writes. On a DASH with no agents it says nothing at all, because nothing is
shared — a warning about nobody is a warning people stop reading.

## What this costs, stated rather than designed around

**The credential value exists in N+1 vault entries** — the fleet's own, plus one
per materialized agent. This is not new: MAR-570 shipped the N, and this adds the
one that survives every agent being deleted. It is the price of leaving the
broker's read path untouched, and the alternative was considered and rejected:

> *Rejected — the broker reads the fleet key directly.* One copy, and it moves
> the vault-name decision into `lib/broker/execute.ts`, which would make "what
> the broker resolves for an agent is indistinguishable from today" a claim
> requiring proof rather than a consequence of not editing the file. It also
> turns per-agent revocation from "delete this agent's credential" into "add a
> deny row the broker must consult", which is a second permission authority
> beside `lib/broker/grant.ts` — the thing `lib/broker/store.ts`' own header
> forbids. The copy is the cheaper mistake.

**A re-key must re-materialize.** Pasting a new OpenRouter key updates N+1
entries, and an entry whose write fails leaves that agent on the old key. The
failure is per-agent, reported per-agent, and the agent reads as connected to
something that no longer works — which `connection.test` is the existing answer
to. It is not silently repaired.

**A fleet connection appears in `connection_secrets` under a reserved name.**
`CredentialTarget.agent_id` is not optional, so `FLEET_PRINCIPAL` fills it, and
the reference row lands under that name — which is what lets `alreadyHeld` in
`electron/main.ts` say "Replace" rather than "Connect" on a re-key without that
file learning anything about the fleet.

The row is a **label, not a lock**, and the distinction is worth being exact
about because agent names are unconstrained: nothing stops an author calling
their agent `dash.fleet`. What such an agent would get is a prompt with the wrong
word on it. What it could not get is the credential — `fleetSecretName` writes
into the `dash.fleet.` vault namespace and `connectionSecretName`, the only name
the broker ever computes, always emits `dash.connection.`, so the two namespaces
cannot meet whatever an agent is called. `tests/fleet-connections.test.ts` pins
that for the contrived names as well as the ordinary ones.

## What does not change

- **ADR 0002's three-party discipline, entirely.** DASH built the operation; the
  agent's *own manifest* declared the scopes it needs; the person granted it at
  the provider. The second party is still per-agent and still the manifest — a
  fleet connection grants an agent nothing its own manifest did not ask for, and
  an agent that asks for more than the consent issued still shows "you did not
  give this one" on those actions.
- **Amendment 5's missing third party.** A pasted key still has no consent
  screen, no scopes, and nothing to intersect; `describeKeyNarrowing` still says
  so. A fleet key is a key.
- **The manifest schema.** Nothing is added and nothing is widened — see below.
- **`connection_secrets`.** Not repurposed, not migrated, not written with a
  sentinel agent. It is still the per-agent table it always was.

## The manifest shape, for MAR-596

Session 4 is waiting on this, so it is stated here rather than in a handoff:
**the manifest does not change.** An agent declares what it needs exactly as
MAR-569 and MAR-582 already specify, and DASH resolves that declaration against
whatever fleet connections exist. Concretely, for the model provider F14 is about:

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

Four rules decide whether DASH takes custody, and all four predate this ADR:

1. `provider` must be one of `lib/ai/providers.ts`' by-value list —
   `openrouter`, `anthropic`, `openai`. Any other string is an agent-held key and
   DASH says so.
2. `ownership` must be `dash_managed`. Anything else refuses with
   `not_dash_managed`.
3. The field must **not** declare `technical.environment_name`. DASH holds model
   keys and does not hand them over; a manifest that names a delivery variable is
   refused at connect with `brokered_provider_delivery` (amendment 5).
4. For Google, `provider` is `google-gmail`, the field's `kind` is
   `oauth_reauthorization`, and `technical.provider_scopes` must be inside
   `lib/oauth/providers.ts`' allowlist.

An agent emitted this way needs **no fleet-specific member**. It lights up
against a connection the person made before it existed, and it degrades to the
per-agent flow when they have not.

## What is proven, and what is not

**Unit tests only**, and one of them carries most of the weight.
`tests/fleet-connections.test.ts` connects a fleet sign-in against a real vault
with **no agents imported at all**, imports one afterwards, shares it, and then
resolves a grant through `connectionSecretName` and `resolveGrant` — the two
functions `lib/broker/execute.ts` itself runs — for an agent nobody ever signed
in. That is the "indistinguishable at the boundary" claim, driven rather than
argued. The catalogue's derived scopes, the four skip reasons, the withheld
default and the store's masking gate are covered beside it;
`tests/fleet-connector-render.test.tsx` covers what is drawn.

**No installed proof.** `electron/smoke.ts` does not connect a fleet connection,
and nothing here has been exercised against a real Google consent screen — which
is MAR-594's, and `loopback-fixtures-cannot-refuse` is the standing record that
DASH's OAuth has never worked against real Google. **A fleet sign-in to Google is
not evidence that signing in to Google works.** What it is evidence of is that
the consent, once received, is recorded and resolved fleet-wide.

**Not attempted here:** more than one account per provider. One fleet connection
per provider is a v1 limit, not a principle — the table is keyed on provider and
a second account is a second row plus a choice on every card, which is a design
nobody has made.
