# Runbook: the attended real-Google proof (MAR-468)

Status: written 2026-08-03. **Not yet executed.**

This is the manual, dated proof that DASH's permission broker works against
Google's real API rather than against the loopback provider `electron/smoke.ts`
proof 7 binds. It is the step that promotes MAR-458 and MAR-469 from `merged` to
`proven` — and only as far as the promotion rule at the bottom of this file
allows, which is less far than "the broker is proven".

Read [ADR 0002 amendment 3](adr/0002-connection-permission-broker.md) before
recording a result. It is the judgment about what a passing run does and does not
earn, and it exists because a run that promotes more than it earned is worse than
no run at all.

## It is manual, and the code enforces that

ADR 0004's rule: **a blocking release gate may depend only on this repository and
this machine.** This proof depends on Google, on a Google account, and on a human
at a consent screen, so it can never be one.

That is not left to convention. `scripts/prove-google.mjs` exits before it builds
anything if `CI` is set or if no terminal is attached, and there is no
`package.json` script that names it. `pnpm verify` does not run it. `pnpm verify`
*does* typecheck it — `tsconfig.json` includes `scripts/google-proof` — which is
the intended split: a proof that rots silently between attended runs would be
worse than none, and typechecking a file is not executing it.

## What it will do to your account

- It **reads one message** that you plant yourself, by subject. It does not read
  anything else, and nothing it logs contains message content.
- It **creates one real draft in your real Drafts folder**, addressed and
  written, one human click from going out. Nothing in DASH sends it — there is no
  operation that could, and this proof must not become the reason one is built.
- It **cannot delete that draft**, for the same reason. You delete it in Gmail
  yourself, and the harness stops and asks you to confirm you have.
- It ends by **withdrawing the grant at Google** and deleting DASH's copy from
  this machine's vault, so no restricted-scope credential for a throwaway proof
  agent is left behind. That withdrawal is also check `G15`.

## Which regime this is performed under

**Testing mode, with your own account added as a named test user.** Record this
sentence in the evidence: it is not a claim about a public DASH connection and
must never be read as one.

Both scopes are **restricted**:

| scope | what it is |
| --- | --- |
| `https://www.googleapis.com/auth/gmail.readonly` | restricted |
| `https://www.googleapis.com/auth/gmail.compose` | restricted, and it can also send |

A public DASH-owned Gmail connection needs Google verification before any
non-test user can grant either. If restricted-scope data is ever stored on or
transmitted through servers, an annual independent CASA security assessment is
required as well. Neither applies to a Testing-mode run and neither is proven by
one.

**Testing-mode data-scope grants expire after seven days.** Both the consent and
the refresh token. So the evidence has a shelf life, and a record without a date
is stale on arrival.

## Before you start

1. **Google Cloud console**, on the project that owns the client id compiled into
   `lib/oauth/providers.ts`:
   - the **Gmail API** is enabled;
   - the OAuth consent screen is in **Testing**, and your account is listed under
     **Test users**;
   - both scopes above are added to the consent screen's scope list;
   - the client is a **Desktop app** client. A Web client rejects the ephemeral
     `http://127.0.0.1:<port>/callback` redirect this flow uses.
2. **Send yourself a message** whose subject contains exactly
   `DASH real-Google proof`, with a line or two of plain-text body. The agent
   searches for that subject, reads that message, and replies to it. A planted
   message rather than `is:unread` is deliberate: an empty inbox becomes a setup
   failure instead of a broker failure, and no third party's mail is read into a
   proof log.
3. **Close DASH.** The shell is single-instance (MAR-450) and this harness starts
   a real one. Leave the runner alone if one is running — it is adopted.
4. Confirm the tree is the one you mean to make a claim about:
   `git rev-parse HEAD`, and `pnpm verify` green on it.

## Running it

```bash
node scripts/prove-google.mjs
```

It stops and waits for you twice, and both stops are the point:

- **before the write** — type `draft` to go ahead. Anything else stops the run.
- **at the end** — type `deleted`, after you have opened Gmail, looked at the
  draft, and deleted it.

When you look at that draft, check the three things DASH claims about it and
Google decides:

- the **From** is your own address. DASH writes no `From` header at all; Google
  fills it from the account whose token DASH presented, which is what makes it
  impossible for an agent to compose a draft that appears to come from somebody
  else.
- there is **one recipient and no Bcc**.
- it is filed against the **thread of the message it replies to**.

## What the checks are

| check | what it establishes |
| --- | --- |
| `G0a` | the store is the one `electron .` uses, not `.../Roaming/Electron` |
| `G0b` | **no loopback provider is in force** — the run really is against `https://gmail.googleapis.com`. Everything below is worthless without it, so the run stops here if it fails |
| `G1` | the shipped meeting-assistant manifest imports, declaring both scopes |
| `G2` | a real Google sign-in through the real Connection Center action, stored in this machine's vault |
| `G3` | Google returned a refresh token and an id token DASH read an address out of |
| `G4` | the three-party intersection over a *real* consent grants exactly three operations, write first |
| `G5` | the capability card admits the granted permission is wider than the action |
| `G6` | the agent this harness wrote parses |
| `G7` | the runner started it as a real child process |
| `G8a` | Gmail answered both read operations through the broker |
| `G8b` | **DASH's projection found a subject, a sender and a plain-text body in real Gmail MIME.** The check most likely to fail, and the reason the proof is worth running: the loopback serves one flat `text/plain` part, and Gmail serves a tree |
| `G9` | Gmail accepted the message DASH composed and returned a draft id |
| `G10` | Google filed the draft against the thread the reply was to |
| `G11` | both send attempts refused as `unknown_operation` — against a credential that really carries `gmail.compose` |
| `G12a` | a recipient carrying CRLF refused as `invalid_input` before any request |
| `G12b` | every brokered call is audited, and no `.send` row is `allowed` |
| `G12c` | the audit holds no token, no query text, no message content |
| `G13` | no Google token is observable from the agent process or its environment, and `GMAIL_OAUTH_TOKEN` — which this manifest explicitly asked for — is absent entirely |
| `G14` | the artifact reached DASH saying the reply is at the provider |
| `G15a` | Google accepted the revocation |
| `G15b` | the agent's **next** request after it was refused as `revoked`, not as a generic failure |
| `G16` | you inspected and deleted the real draft |

### One check here is weaker than its counterpart in proof 7, and it is `G12b`

Proof 7's `7n` is stronger than anything this file can do. That harness *serves*
Gmail's two send endpoints and answers them with success, so "DASH never called a
send endpoint" is a statement about DASH rather than about the provider's
willingness to refuse. Google cannot be made willing, so `G12b` reads DASH's own
audit instead — which holds one row per brokered call on every path including
refusals.

That is a real difference and it runs in the other direction too: `G11` refuses a
send against a credential Google would actually have honoured, which no loopback
run can claim. **The two proofs are complementary and neither replaces the other.**
Do not delete proof 7 and do not describe this one as superseding it.

## Recording the result

Paste the whole log — it is written to be pasted — into:

1. the Linear issue (MAR-468), with the date;
2. `.orchestrate/state.json`, in MAR-468's `note`, and in MAR-458's and
   MAR-469's if the promotion rule below is satisfied;
3. `PROJECT_STATE.md`, in the Wave 2 section.

Every one of those three must carry **the date of the run**, because of the seven
days.

## The promotion rule

A green run promotes **MAR-458 and MAR-469 from `merged` to `proven`**, and the
`note` on each must say all four of these:

1. the date, and that Testing-mode grants expire seven days after it;
2. that the regime was Testing mode with a named test user, not a verified public
   connection;
3. that `G12b` is the weaker half of `7n` and proof 7 still owns the stronger one;
4. that ADR 0005's cases 1 and 3, and MAR-469's durable replay memory meeting a
   real restart, are **still unit tests only** and are not touched by this run.

A run that fails any check promotes nothing. A run that was not performed promotes
nothing either, and this file existing is not the run.
