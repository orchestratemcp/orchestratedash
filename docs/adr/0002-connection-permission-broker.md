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

*(Superseded by amendment 2. Stage 2 shipped; the `draft` kind no longer means
local by itself, and `draft.placement` is where it now says.)*

## Amendment 2 (MAR-469): the first operation that writes to somebody's account

Status: Accepted

Date: 2026-08-03

Stage 2 of the rollout above is built. `gmail.draft.create` puts a reply in the
user's own Drafts folder, and **there is still no send operation.**

### The argument that expired

Amendment 1 made invariant 6 "a property of step 1 rather than a promise": a
credential granting `gmail.compose` and nothing else granted **no operations at
all**, because nothing was built on that scope. That was a strong claim and it
was free. It is now spent. One thing is built on the scope that can send, so
every guard between an agent's request and a sent message is a real check that
can have a bug — which is exactly what this ADR's own stage 2 text anticipated
when it asked for "adversarial tests proving an agent cannot substitute a send
endpoint".

Nothing about invariant 6 changes. What changes is what makes it true.

### What replaces it: a field that is not there

The same move ADR 0005 used on `broker_lapses`, applied to the one irreversible
thing this product can do. **A write operation has no `plan`.** `ReadOperation`
returns a whole `ProviderCall` including a URL; `WriteOperation` cannot, because
the type declares no member that could carry one. It declares:

- `path`, a literal on the operation object, checked at module load against a
  frozen `WRITE_PATHS` and rejected if it is not rooted at this origin;
- `compose(input)`, which returns `{ json }` and nothing else.

`planCall` builds a POST's URL from `operation.path` and the profile's origin.
So a bug inside `compose`, of any severity, cannot produce a request to
`/gmail/v1/users/me/messages/send` — not because a check would catch it, but
because `compose` does not get to say where the request goes. The complete
answer to "what can this application do to my account?" is one frozen array,
readable in ten seconds, and `tests/broker-threat-model.test.ts` pins it **by
value**. Adding a send means editing that line, which is the conversation this
invariant exists to force.

The second half is the body, and it is the same argument applied one level down.
Gmail's `drafts.create` accepts `message.raw`: an entire opaque message, which if
passed through would let an agent choose recipients, `Bcc`, and every other
header. So there is no `raw` input. DASH composes the RFC 5322 message from four
typed fields, refuses any control character in a header value, and **writes no
`From`** — Gmail fills that from the account whose token DASH presented, so an
agent cannot compose a draft that appears to come from somebody else and DASH
does not have to check that it did not.

### The honesty problem this created, which is the harder half

A draft in Gmail is visible in the user's mailbox and one human click from going
out. That is not the risk of a local file, and three surfaces had to change to
stop under-describing it.

**Google has no drafts-only scope.** `gmail.compose` is the narrowest permission
that can create a draft, and it can also send. DASH cannot ask for a permission
incapable of sending, so the card must not imply the user granted one.

Until now that disclosure rode on `unused_scopes`: compose reached no operation,
so the card said DASH offers no action for it. Building something on it made it a
*used* scope — and the uncomfortable half would have **silently vanished from the
card at the exact moment it started to matter**. So `wider_permission` is a
required, nullable field on `WriteOperation`, and `CapabilityCard` and
`BrokerRowView` each carry a sentence built from it. Required-but-nullable rather
than optional, so a future write cannot ship without someone answering the
question. It renders before a sign-in as well as after, because the person who
has not yet granted the permission is the one it is for.

**A capability list can read like a read.** "Save a reply in your Gmail drafts"
is a verb phrase that says nothing about what will be sitting in the mailbox
afterwards, so `WriteOperation.consequence` is required too, travels on the
granted operation, and renders under the capability rather than in a tooltip.

**The `draft` artifact kind stopped meaning "local".** Amendment 1 recorded that
`contracts/run-artifact.schema.json` said so "in the kind's own description".
That sentence is now false for some drafts and true for others, which is worse
than either. `draft.placement` is a **required** tagged union — `dash_only` or
`provider_draft` — so no producer can leave it to a renderer to guess and no
renderer can default. A `dash_only` placement carrying a `draft_id` is refused,
because it asserts nothing exists at the provider while naming the thing that
does. The renderer branches; the half that survives every branch is *nothing has
been sent*, and it is still true by construction.

Note what `placement` is **not**: it is the agent's claim about its own work, the
same standing `sources_fetched` has for a digest. DASH's independent record of
what it actually performed is `broker_audit`, and the copy points there rather
than asserting.

### Replaying a write is not replaying a read

MAR-458 stated the replay guard's limit plainly — bounded per agent, dies with
the process — and justified it: "the durable protection against a repeated effect
is that every operation in this slice is a read." A replayed draft-create leaves
a second draft in somebody's mailbox and survives a restart, so the guard has to
as well.

Writes now also check `broker_audit`, which already holds every request id DASH
ever decided about, on every path including refusals. A query rather than a new
table: a separate "ids seen" store would be a second answer to a question the
audit already answers, free to disagree with it and no more durable. A failing
query reads as "not seen", because a sick table must not make an agent unable to
draft forever, and the cost of that direction is a duplicate draft rather than a
duplicate send — there being no send.

Writes also get their own budget of three per minute, beside the twenty-per-minute
call budget rather than inside it. Twenty reads a minute is a busy assistant;
twenty drafts a minute is a mailbox nobody can use.

### What is proven, and what is not

**Proven end to end on the installed shell** (proof 7, checks 7k–7n): the write.
A real agent the runner spawned drove a real POST carrying a real bearer token to
a real HTTP provider, and DASH's own composed message was read back out of what
the provider received.

**7n is the load-bearing one.** The harness *serves* Gmail's two send endpoints
and answers them with success, so "DASH never called a send endpoint" is a
statement about DASH rather than about a provider's willingness to refuse. Over a
run in which the agent explicitly asked to send twice, by two different names,
the paths DASH actually reached were `/token`, the two read paths, and
`/gmail/v1/users/me/drafts`. A negative proof whose subject is free to refuse is
a proof of the wrong party.

**Not proven, and unchanged from amendment 1: the provider is not Google.** It is
a loopback server, for the reasons that section gives, and MAR-468 still owns the
real-Google proof. Nothing here may be described as proven against Gmail's API —
including, and especially, that a draft appears in a real Drafts folder.

**Unit tests only**: the durable replay memory meeting a real DASH restart. The
query is tested against a real store and the broker's use of it is tested with
two brokers sharing one record — which is what a restart looks like from the
broker's side — but no installed proof restarts DASH between two halves of one
agent's work.

## Amendment 3 (MAR-468): what a real Google run can promote, and what it cannot

Status: Accepted

Date: 2026-08-03

Amendments 1 and 2 both end by saying MAR-468 owns the real-Google proof, and
neither says what promoting on it would actually be a claim about. This amendment
answers that **before the run**, on purpose: deciding afterwards, with a green log
in hand, is how a proof gets read as establishing whatever the reader hoped.

`scripts/google-proof/main.ts` is the harness and
`docs/real-google-proof-runbook.md` is the procedure. Neither has been executed.

### The two proofs differ in one variable, which is smaller than it looked

The obvious framing is that proof 7 is real-except-the-provider and this one is
real-including-the-provider, so between them everything is covered — a union
across two substrates, with seams wherever they fail to overlap. That framing
would have been right if the attended proof had been written as a standalone
script driving `lib/broker/` directly, which is the cheap way to build it.

It is not written that way, and that is the load-bearing decision here. The
attended harness boots the same shell, through the same
`electron/smoke-identity.ts` and the same `electron/main.ts`, writes to the same
user-data directory, uses the same OS vault, adopts the same runner, and spawns a
real child process that speaks the same broker protocol. **The only variable
between the two runs is which server answers**, plus one renderer surface the
attended run skips (the pre-consent summary window, which is not on the path any
provider request takes).

So there is no substrate seam to reason about. There is one seam, and it is a
single check.

### The seam is `7n`, and it is not closeable against Google

Proof 7's harness **serves** Gmail's two send endpoints and answers them with
success. That is what makes `7n` a statement about DASH rather than about a
provider's willingness to refuse, and it is the check that would notice a future
write operation reaching the wrong path with a live token attached.

Google cannot be made willing. So the attended run's equivalent, `G12b`, reads
DASH's own `broker_audit` — one row per brokered call on every path, refusals
included — and asserts no `.send` row was ever `allowed`. That is weaker in a
stated way: it would not distinguish a request DASH built and Google rejected
from a request DASH never built.

The asymmetry runs both ways, which is why neither proof is redundant. `G11`
refuses both send attempts against a credential Google would genuinely have
honoured them with — the exact condition invariant 6 is about, and one no
loopback run can create, because the loopback grant is a fixture the harness
wrote for itself.

**Both stay. Proof 7 is the one that runs on every commit; this one runs when
somebody is watching.**

### What a green run makes true

1. Google's Gmail API behaves as `lib/broker/operations.ts` models it — including
   the projection over a **real MIME tree**, which is the single most likely
   thing here to have been wrong. The loopback provider serves one flat
   `text/plain` part with two headers; Gmail serves `multipart/alternative` with
   the plain part nested and headers in whatever case it chooses, and
   `plainTextBody` and `header` had never been given a document Google wrote.
2. DASH's OAuth flow works against Google: PKCE, an ephemeral loopback redirect,
   `access_type=offline` and `prompt=consent` really do yield a refresh token, and
   `accountFromIdToken` really does read an address out of an id token Google
   signed.
3. The three-party intersection resolves the modelled operation set from a
   **real** consent rather than from a credential the harness minted for itself.
4. The negatives hold with a live restricted-scope credential in the vault.
5. `revoked` is a real classification and not a hoped-for one. Google's
   `invalid_grant` for a withdrawn refresh token reaches the agent as `revoked`,
   which is a MAR-446 acceptance criterion that until now had only ever been asked
   of a test server returning a hand-written body.
6. A draft really does appear in a real Drafts folder, with a `From` DASH never
   wrote, and a person looked at it.

### What stays false, and would stay false after ten green runs

- **"The broker is proven"**, unqualified. ADR 0005's cases 1 and 3 — DASH was
  closed, and the answer DASH could not confirm was delivered — are unit tests
  only, and MAR-469's durable replay memory meeting a real DASH restart is unit
  tests only. Nothing about a real provider touches any of the three.
- **Anything about a public DASH Gmail connection.** The run is Testing mode with
  a named test user. `gmail.readonly` and `gmail.compose` are both restricted, so
  no non-test user can grant either until Google verification; and if
  restricted-scope data ever crosses a server, an annual independent CASA
  assessment applies. A Testing-mode run is evidence about neither, and the note
  recording it has to say which regime it was performed under or it will be read
  as the other one.
- **The compiled client id.** Still disclosed rather than removed, still DASH's
  consent screen. Amendment 1's account of it is unchanged and MAR-471 still owns
  the fix.
- **That the evidence keeps.** A Testing-mode data-scope grant expires seven days
  after it is issued. What expires is the grant rather than the observation, but a
  `proven` claim resting on it must carry its date, and re-running means
  consenting again.

### The rule this leaves behind

A green attended run promotes **MAR-458 and MAR-469** to `proven` with the four
qualifications the runbook's promotion rule lists — date and expiry, regime,
`G12b` being the weaker half of `7n`, and the three things that remain unit tests
only. It promotes nothing else.

And the ordinary failure this is written against: **a runbook is not a run.**
MAR-468 is `merged` while this file, the harness and the procedure exist and
nobody has stood at the consent screen. The promotion is a separate, dated,
mechanical act afterwards.
