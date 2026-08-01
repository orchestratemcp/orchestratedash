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
