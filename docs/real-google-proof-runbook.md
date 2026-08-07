# Runbook: the attended real-Google proof (MAR-468)

Status: written 2026-08-03. **First executed 2026-08-06, and it failed at `G2`.**
It promoted nothing, which is what the promotion rule at the bottom of this file
requires of a run that fails any check.

The cause was a defect in DASH rather than in the procedure below: `lib/oauth/flow.ts`
sent no `client_secret`, and Google refused the token exchange outright with
`client_secret is missing.` — so no credential could reach the vault at all.
**MAR-508 is fixed**: `OAuthProvider` carries an optional `client_secret`, both
`exchangeAuthorizationCode` and `refreshAccessToken` send it when the provider
declares one, and it is supplied locally through `DASH_GOOGLE_CLIENT_SECRET` —
see step 1a below — never committed. The two harness defects found by the same
attempt (MAR-509) were fixed and merged first: it could not launch Electron, and
it spawned a runner that was never built beside it. **This run has not been
repeated yet.** The next attempt is the one that tells you whether the fix
actually works against Google, and step 1a is new since the run that failed.

Read the run's record on MAR-468 before running this again. The procedure below is
otherwise unchanged and was not at fault.

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
1a. **Set `DASH_GOOGLE_CLIENT_SECRET` in your shell, before you run anything below.**
   MAR-508: Google requires a client secret for this client type even though
   PKCE covers the rest of the flow, and DASH sends the token exchange without
   one until this variable is set. It is the client's own secret from the same
   Cloud console page as the client id above — never commit it, and it does not
   belong in any file this repository tracks:
   ```bash
   export DASH_GOOGLE_CLIENT_SECRET="the client secret from Cloud console"
   ```
   `lib/oauth/providers.ts` reads it fresh on every call, so setting it in the
   same shell you run `node scripts/prove-google.mjs` from is enough — nothing
   else needs restarting. Leaving it unset reproduces the exact MAR-508 failure:
   `client_secret is missing.` at `G2`.
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

## The preflight, and why you no longer perform it by hand (MAR-520)

`node scripts/prove-google.mjs` now runs a preflight before it builds anything.
It asks one question — **is a runner already holding the data directory this run
is about to write to** — and it exists because on 2026-08-07 the answer was yes
and nobody found out until the session was over.

That morning's run left a runner alive: `/health` answering, three agents
supervised, `runner.json` naming its pid and its pipe, and `401` to the
`runner.key` in that same directory. It was found by reading a process list. The
next run would have started a **second** runner over the same `runner.sqlite` —
the two-writers-one-store pattern MAR-506's corruption is suspected to have come
from — and nothing would have looked wrong until the store did.

The preflight prints one of three things and you do not have to do anything
about the first two:

- **nothing is holding it** — the ordinary case.
- **a runner is running and DASH can talk to it** — it is adopted, exactly as
  step 3 above says. Nothing is stopped.
- **a leftover was retired** — a runner that did not accept DASH's credential was
  asked to stop through *its own* authenticated shutdown route, using the
  credential it recorded for itself when it started. Nothing is force-killed.

If it **refuses** (exit 3), the run does not start, and the message names the
pid and the one remedy: **restart this computer once.** That is the honest
answer and not a workaround. Do not reach for `Stop-Process` — `AGENTS.md`
forbids it because a force-killed runner corrupted this project's real store
once already, and the runner it would kill is holding somebody's agent history.

A runner started **before this change landed** recorded no credential of its
own, so the preflight can only report it, not retire it. Those need the restart.

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
| `G7a` | the runner wrote an endpoint file |
| `G7b` | the runner started the agent as a real child process |
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

## If the run fails partway

The cleanup runs on every path, including the ones that die early. It withdraws
the grant at Google **before** deleting DASH's copy — deleting first would turn a
failed revocation into a live restricted-scope grant nobody can find — and it
prints the draft id if one was created, so a draft this harness made is never one
it failed to mention.

Two things to check anyway if a run ended badly:

- if the log says `COULD NOT withdraw the grant at Google`, remove DASH's access
  yourself under your Google account's third-party connections. Otherwise it
  stays live for the rest of its seven days.
- if a draft id was printed, delete that draft.

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
