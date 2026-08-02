# ADR 0002: Connection permission broker

Status: Accepted

Date: 2026-08-01

## Decision

DASH will separate account identity from connector authorization and will mediate
provider access through a permission broker. An agent receives narrow operations,
not a provider refresh token or a general OAuth access token.

The broker is the common boundary for native OAuth connections and authenticated
MCP servers. The Connection Center renders both as capabilities with the same
permission receipt, health, audit, revocation, and recovery model.

## Why

Signing in to DASH with Google would establish identity only. It would not grant
Gmail or Calendar access. Those data scopes require a separate affirmative grant
and remain subject to Google's scope and verification rules.

The current MAR-446 implementation correctly uses the system browser, loopback
redirect, PKCE, refresh-token rotation, revocation, and the OS vault. It also
mints a general provider access token at agent spawn and places it in the agent
environment. For `gmail.compose`, that token can send mail even when the manifest
declares only draft creation. The present draft-only boundary is therefore a
contract claim, not a technical firewall. It must not be promoted as proven.

The Google desktop client ID is currently compiled into DASH. A desktop client
ID is public rather than secret, but this means DASH's Google Cloud project owns
the consent screen. Bring-your-own Google OAuth client setup is not implemented.

## Invariants

1. Refresh tokens remain in the OS vault and never enter an agent process.
2. Provider access tokens remain on the trusted DASH side of the broker.
3. An agent invokes allowlisted operations with typed inputs; it never chooses a
   provider URL, HTTP method, or raw scope.
4. Every grant has a user-visible receipt: account, provider, capabilities,
   requesting agent, grant time, last use, and revoke action.
5. Every invocation is audited by operation name and safe metadata, never token
   or message content.
6. No Gmail send operation exists in the draft-only product profile. The fact
   that Google's `gmail.compose` scope can technically send does not enlarge the
   broker's operation set.
7. Provider content is untrusted data. It cannot create permissions, alter the
   operation allowlist, or authorize a side effect.
8. MCP connectors pass the same capability review. Installing a Gmail MCP server
   changes who owns token custody; it does not remove OAuth consent or permission
   review.

## Rollout

### 0. Prove the agent loop without OAuth

Extend the existing sample flow into AI News Scout using public RSS/HTTP sources.
Show live progress, a cited digest artifact, a verdict, and the permission receipt
(`network: read` only). This proves DASH-to-agent communication without mixing the
runner proof with Google verification.

### 1. Read-only Gmail broker

Add typed `gmail.search` and `gmail.message.read` operations. The first useful
output is a local draft artifact in DASH, not a sent message or provider draft.
The existing raw-token delivery path is denied for broker-managed OAuth fields.

### 2. Provider-side draft creation

Add `gmail.draft.create` behind the broker. DASH may need the restricted
`gmail.compose` scope, but the broker exposes no send operation. Add adversarial
tests proving an agent cannot substitute a send endpoint or escape the declared
account and grant.

### 3. MCP connector adapter

Add an authenticated MCP connection kind. Import server-advertised tools as
untrusted declarations, map approved tools to DASH capabilities, and show the
remote server and token custodian in the receipt. A hosted token broker such as
Vercel Connect can be an optional deployment choice; it is not required for the
local-first path.

## Google release path

- Development can use DASH's Google Cloud project in Testing mode with named test
  users. For data scopes, test grants and refresh tokens expire after seven days.
- A public DASH-owned Gmail connection requires Google verification. Both
  `gmail.readonly` and `gmail.compose` are restricted scopes. If restricted-scope
  data is stored on or transmitted through servers, an annual independent CASA
  security assessment is required. Google does not charge the assessment fee;
  the independent assessor sets it.
- A real BYO-client route remains possible, but only after DASH has settings,
  validation, guided setup, and honest weekly-expiry UX. It is not the default
  product experience.

## Consequences

The broker adds implementation work, but it creates the product distinction DASH
needs: users approve comprehensible actions rather than handing opaque tokens to
arbitrary agents. Native OAuth, MCP, and later hosted connectors can share one
UX without pretending they share token custody or trust.

## Amendment 1 (MAR-458): what the first slice established, and what it did not

Status: Accepted

Date: 2026-08-02

The rollout above described three numbered stages. This amendment records what
stage 1 actually built, and corrects two things the original text got slightly
wrong about the defect it was written to close.

### The rule that decides a grant

The ADR said an agent receives "narrow operations". It did not say who decides
which. The answer built here is that **three parties must all agree**, and the
grant is their intersection:

1. **DASH** — the operation exists in `lib/broker/operations.ts`.
2. **The agent's author** — every scope it needs is in the manifest's declared
   `provider_scopes`.
3. **The user, through the provider** — every scope it needs is in the credential
   the provider actually issued.

Any one of these alone is wrong in a way the other two catch. DASH alone ignores
what the user agreed to; the manifest alone lets an agent author widen its own
access; the credential alone is the raw-token model this ADR exists to end.

Invariant 6 becomes a property of step 1 rather than a promise: a credential
granting `gmail.compose` and nothing else grants **no operations at all**,
because no operation is built on that scope. The scope stays live at Google —
DASH cannot narrow what Google granted — and it is dead at the broker. The
capability card says so out loud rather than letting the checklist imply the
permission is narrower than it is.

### Two corrections to this ADR's account of the defect

**The raw-token path was narrower than described.** The ADR says DASH "mints a
general provider access token at agent spawn and places it in the agent
environment". True of the code, and it required one more condition than the
sentence implies: `deliverableFields` only ever listed a target whose manifest
declared `technical.environment_name`, and **no manifest in `examples/` declares
one for an OAuth field**. So the path was reachable and unexercised by anything
DASH ships. That makes the defect narrower and no less real — a manifest is a
third party's document, and that was the single line it had to contain. The
fixture proving the guard lives in `tests/broker-boundary.test.ts` rather than in
`examples/`, where it would be a sample asking for exactly what the broker
withholds.

**The compiled client id is disclosed, not removed.** The ADR names it as a
present-tense problem, and it remains one: `lib/oauth/providers.ts` still carries
the desktop client id, so DASH's Google Cloud project still owns the consent
screen. What changed is that the capability card now says which — `client_owner`
carries `dash_project` or `user_project` and `describeClientOwner` turns it into
a sentence a user reads. Bring-your-own-client *onboarding* stays where this
ADR's rollout put it: after settings, validation, guided setup and honest
weekly-expiry UX. Disclosure is not the fix; it is the smallest honest thing to
do before the fix.

### Where the broker runs, and what that costs

In Electron main, because `safeStorage` is only readable there. That turns
invariant 1 from a rule someone must follow into a fact about where the code can
run: the runner relays and could not mint a token if it wanted to.

The cost is stated rather than designed around. **When DASH is closed, the broker
is closed.** A hosted agent whose runtime declares `continues_when_dash_closed`
keeps running and its brokered calls stop being answered — they settle as
`broker_unavailable` at the agent's own timeout. That is the correct behaviour,
because the alternative is a process that can reach a user's mailbox while the
app they granted it through is not running.

### What is audited, and what deliberately is not

Invariant 5 says "safe metadata, never token or message content". Made concrete:
`broker_audit` stores the operation name, the *names* of the input fields an
agent supplied, a result count, a masked account and a duration. It does not
store the search query. A durable table of every phrase an agent searched a
user's mail for would be the single most sensitive table in the store, and the
rule is the one `command_audit.payload_keys` has held since MAR-417.

Disconnecting forgets the receipt and **keeps the audit rows**. The receipt
describes access DASH holds; the rows are the record of what was done while it
held it, and a disconnect that erased them would delete exactly the history a
suspicious user disconnected in order to check.

### The proof, and its one substitution

`electron/smoke.ts` proof 7 drives a real read → local-draft round trip on the
installed shell: a real vault read, a real refresh-for-access exchange over HTTP,
a real bearer header, a real child process the runner spawned, and a real
artifact arriving through the ingest a digest uses. The agent reports its own
environment and everything the broker sent it, and neither contains the token
DASH used on its behalf moments earlier.

The provider is a loopback HTTP server the harness binds, because Google cannot
be in an unattended proof — it needs an account, a human at a consent screen, and
the restricted-scope verification this ADR's "Google release path" describes. So
**what proof 7 establishes is the boundary, not Gmail's API.** The substitution is
gated by `loopbackProofOrigin()`, which requires a `DASH_`-namespaced variable
the runner refuses into every child environment, an `http:` scheme, a literal
`127.0.0.1` host, and a manifest naming a provider no real service uses.

### Stage 2 is not started, and one reason has hardened

Provider-side draft creation stays unbuilt. The `draft` artifact kind added here
is explicitly **local**: DASH holds it, nothing was sent, and nothing exists at
the provider. `contracts/run-artifact.schema.json` says so in the kind's own
description and `app/_components/digest.tsx` renders the sentence before the
draft rather than under it, because a person scanning it needs to know what it is
*not* before they read what it says.
