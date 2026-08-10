# MAR-489 — the attended VPS proof, second attempt (2026-08-10 evening)

Status: **in progress at the time of writing.** This file is the log of the
second attended run on 2026-08-10, begun ~21:30 Europe/Stockholm, after the
morning attempt (`mar-489-attended-run-2026-08-10.md`) reached `V-A1` and
stopped. Attended by Henrik throughout; every product step was his press, and
every store read was taken directly from `dash.sqlite` rather than from a
screen.

Checks are recorded `pass`, `fail`, or `not run`, per the runbook's own rule. A
green prefix is not a pass.

---

## What this run is against

| | |
| --- | --- |
| DASH commit | `5ad6d70` (Merge PR #132, MAR-597's second wall) |
| runner-standalone build | `fa45e8715e790f8d6897` |
| Host | Hostinger VPS `186.240.156.166`, `srv1889370`, Ubuntu 24.04.4 LTS, kernel 6.8.0-137, OpenSSH 9.6p1 |
| Host provenance | **Reinstalled 2026-08-08, not newly rented.** Same deviation the morning log recorded and for the same reason. The reinstall regenerated host keys and wiped `/opt`, so both first-contact walls were genuinely restored — but this is not the "fresh box" the runbook demands, and the deviation is repeated here rather than quietly dropped. |
| DASH data directory | `C:\Users\henri\AppData\Roaming\orchestratedash` (`app_name=orchestratedash`), confirmed from the startup log on every launch |

### Preconditions

1. **`pnpm verify` green on `5ad6d70`, from PowerShell — pass.** `state:check`
   valid with 0 drift warnings; `typecheck` clean; `brand:check` green; **150
   test files, 2911 passed, 10 skipped, 0 failed**; `verify:shell` **85 PASS / 0
   FAIL**, closing with `[smoke] all proofs passed`. The full proof set, and it
   reported its own success line — not the short-count shape that means a
   mid-run death. The smoke *adopted* the already-live runner (pid 4996) rather
   than starting a second one, so there were never two writers on the store.
2. **No orphan Electron — pass, after one Windows restart.** At session start an
   orphan `dist/electron/runner.mjs` (pid 37844, parent dead) was live beside
   Henrik's DASH. Henrik restarted Windows rather than force-killing it, per
   `AGENTS.md`.
3. **DASH launched only as `electron .` — pass.** Store path confirmed from
   `[dash-shell] store:` on each of three launches.
4. **The five stale host records forgotten through the product — pass.** Henrik
   forgot all five `186.240.156.166` rows on the Servers tab. Verified: the
   `hosts` table dropped to zero, and all five private keys were removed from
   `%APPDATA%\orchestratedash\hosts\`. `known_hosts` was 0 bytes at the moment
   of the new record's creation, so the pin below is a genuine first pin.

---

## Part A — the local journey

| check | result | evidence |
| --- | --- | --- |
| `V-A1` | **not run this session** | proven in the morning log against `be90d84`; not repeated |
| `V-A2` | not run yet | |
| `V-A3` | not run yet | |
| `V-A4` | not run yet | |
| `V-A5` | not run yet | |

### The fleet connections (ADR 0013 / MAR-593) — the morning's F16 is half closed

Henrik connected **Google** and **OpenRouter** through the Connections tab, on a
DASH with **zero agents imported**. That is MAR-593's whole claim and it held:
the fleet cards exist before any manifest does. His morning complaints — *"I
find no spot for adding open router eighter"*, *"nowhere to connect"* — do not
reproduce.

**Google persisted, which it never has before.** The morning run's F16 was that
sign-in appeared to succeed and wrote nothing. Read from the store afterwards:

```
fleet_connections   google-gmail | sign_in | 00••••@gmail.com | os_keychain
                    scopes: gmail.compose, gmail.readonly | 2026-08-10T20:00:49Z
connection_secrets  dash.fleet / google-gmail / sign_in
                    synthetic-gmail-meeting-assistant / gmail   (fanned out)
                    dash.fleet / openrouter / api_key  (••••4c0c, 20:02:17Z)
broker_grants       synthetic-gmail-meeting-assistant / gmail
                    ops: gmail.search, gmail.message.read, gmail.draft.create
broker_audit        (no rows)
```

Two of the three evidence rows MAR-594 owes are present and real. **The third,
`broker_audit`, is empty** — an audit row is only written when an operation
actually runs, and no `gmail.search` has been performed. MAR-594's exit evidence
is therefore **not complete**, and this run must not be read as completing it.

The grant fan-out is visible in that table: one consent, written to the agent
that independently qualified for it, which is `findGrantSharers` doing what the
Connections page's copy promises.

---

## Part B — the VPS proof

| check | result | evidence |
| --- | --- | --- |
| `V0` | **pass** | verify green on `5ad6d70`; no host record for this address at the moment of creation |
| `V1` | **pass** | `host.create` minted `host-e3fa1674….key`/`.pub` and the record at 21:56; the card rendered it |
| `V2` | **pass** | see below — **the check no run in this project's history had ever performed** |
| `V2b` | partial | no re-pin exists in the code path (`pinHostKey` has no overwriting caller); the confirmation copy was not transcribed verbatim before pressing |
| `V3` | **pass** | after confirming, the re-check failed on a *different* wall: *"Hostinger has not been told about this key — the server is answering and would not let DASH in."* |
| `V4` | **pass** | one pasted snippet; states what it installs before installing; Node 24.19.0 downloaded with its published digest verified; helper embedded as base64 and SHA-256 checked after writing; one `restrict,command=` line |
| `V5` | **pass** | *"Hostinger is reachable, with nothing running on it… DASH signed in and found no agent runner there yet."* Standing carries its own timestamp (23:43), not a stored guess |
| `V6` | **pass** | see below — the load-bearing observation |
| `V7` | **pass** | the host's own `status` reports `runner_build: fa45e8715e790f8d6897` — identical to the id recorded in precondition 2, so "the host runs the build this DASH shipped" is checked rather than asserted |
| `V7b` | **not run** | no manifest-only agent was available; not attempted |
| `V8` | **FAIL** | no run has ever occurred on the host, and no path exists to cause one. See finding 30 and the evidence below |
| `V9` | **not run** | blocked by `V8`; `evidence_pulls` holds one row, `source=local`, and MAR-488's remote drain has never executed |
| `V9b` | **not run** | blocked by `V9` |
| `V10` | **not run** | the host was deliberately left as-is for a follow-up session; `/opt/orchestratedash` and the deployed bundle remain |

### `V7` — the deploy, and the double press

Henrik deployed twice, once from the server card and once from the agent page
(MAR-577's agent-side entry point and MAR-584's re-push both exist and both
work). The result was **one** bundle and **one** `agent_deploys` row: the second
install replaced the first rather than stacking beside it.

```
agent_deploys   ai-news-scout-2 → e3fa1674…  sent_at 2026-08-10T21:51:04.439Z
                manifest_sha256 ef9cef98…  files_sha256 8510d022…
host status     bundle ai-news-scout-2  running=true  pid=3758
                runner_build fa45e8715e790f8d6897   installed_at 21:51:04.721Z
```

The pre-press disclosure is honest and complete: the agent signs in itself and
DASH cannot limit what it does; DASH only sees what the server still has when it
looks; turning it off in DASH does not stop it; *"To stop it for certain, stop it
on Hostinger — DASH can ask, and the server is what decides."*

### `V8` — the failure, with both sides read at the same moment

Henrik pressed **Run now** several times. Afterwards:

```
LOCAL  runs            162cf5e5-5cf2-4e13-a172-01695ab4ce10  first_seen 2026-08-10T21:59:20.571Z
LOCAL  run_artifacts   digest-162cf5e5…  "News from 3 sources"  generated 21:59:21.196Z
LOCAL  evidence_pulls  source=local  kind=this_machine  observed 22:01:11  reached=1
HOST   status          ai-news-scout-2  running=true  pid=3758  installed 21:51:04
HOST   collect         {"ok":true,"verb":"collect","bundle_id":"ai-news-scout-2","log":[],"truncated":false}
```

The digest rendered in DASH was produced **on Henrik's PC**. The deployed copy
has been alive on the VPS for the whole session and has never run. The remote
runner's log is empty. This is finding 30 observed rather than inferred.

### Finding 17 is dead — the scout found real data

The morning log's finding 17 was that `ai-news-scout` emitted fixture rows
(*"DASH local rss item 3 6c87474c · Local RSS"*). This run's digest carries real,
current items:

- *"Agentic AI turning Zero Trust cybersecurity 'on its head'"* — Breaking
  Defense via Google News, 2026-08-10 23:43
- *"US House Democrats press Anthropic, OpenAI about rogue AI agents"* — Reuters
  via Google News, 21:48
- six further Hacker News items between 21:08 and 23:27

Every item sourced, timestamps within two hours of the run. **This is the first
run in this project's history in which its test agent found real data.**

It is also, as Henrik said, **only headlines**: *"No AI have touched it and
summarized it for us."* The agent gathered and did not synthesise, because
`default_model_level` is absent (finding 29). A digest with no digestion.

### `V2` — the first pin, confirmed out of band

The fingerprint reached Henrik by a path DASH does not control: Hostinger's own
browser terminal, on Hostinger's website.

```
Hostinger browser terminal (out of band):
  root@srv1889370:~# ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
  256 SHA256:SjJ57mMX3zVh7iIvu2BRUxp/1DQEAQ1VhsNv17mS6vo root@srv1889370 (ED25519)

DASH on screen:
  SHA256:SjJ57mMX3zVh7iIvu2BRUxp/1DQEAQ1VhsNv17mS6vo
```

They matched; Henrik confirmed. Written state afterwards:

```
hosts/known_hosts   exactly one line
  186.240.156.166 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMkiFEHNx0zOWh1D1t7esDpuS4QAflDjVTy4+9hyfvMZ
hosts.host_fingerprint
  SHA256:SjJ57mMX3zVh7iIvu2BRUxp/1DQEAQ1VhsNv17mS6vo
```

A scan taken from this Windows machine agreed with both, and is recorded here
only as a consistency check — the runbook is explicit that a fingerprint
travelling this machine's own SSH is **not** a valid out-of-band source, and it
was not used as one.

### `V6` — the forced command, verbatim

Run from a shell outside DASH, with DASH's own minted private key and DASH's
`known_hosts`:

```
$ ssh -i <dash key> -o IdentitiesOnly=yes root@186.240.156.166 'cat /etc/shadow'
{"ok":false,"problem":"unknown_verb","detail":"\"cat\" is not an operation this helper performs."}
exit=65

$ ssh -i <dash key> -o IdentitiesOnly=yes root@186.240.156.166
Pseudo-terminal will not be allocated because stdin is not a terminal.
{"ok":false,"problem":"unknown_verb","detail":"No operation was named."}
exit=64

$ ssh -i <dash key> -o IdentitiesOnly=yes root@186.240.156.166 status
{"ok":true,"verb":"status","bundles":[]}
exit=0
```

No `/etc/shadow`, no shell, no pty; the intended verb answers. Per ADR 0009's
own note, this is a boundary against **DASH**, not a claim the host is secured.

---

## Findings

Filed rather than fixed, per the run's own rule. Numbered continuing from the
morning log's eighteen.

### 19. DASH cannot enrol a host on a stock Windows 11 — blocker

`electron/ssh-host.ts` invokes `ssh`, `ssh-keyscan` and `ssh-keygen` as **bare
names resolved through `PATH`**, with no configuration point. On this machine
that resolved to Microsoft's bundled **OpenSSH 9.5p2**
(`C:\WINDOWS\System32\OpenSSH\`), whose `ssh-keyscan` cannot complete a key
exchange with **OpenSSH 9.6p1 on Ubuntu 24.04** — the exact pairing this
project's own runbook instructs a user to buy:

```
# 186.240.156.166:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.18
choose_kex: unsupported KEX method sntrup761x25519-sha512@openssh.com
```

Reproducible for `-t ed25519`, `-t rsa` and with no `-t` at all, with no
`~/.ssh/config` present. `ssh` itself succeeds against the same host from the
same machine, so this is specific to `ssh-keyscan`.

`scanHostKey` gets no key, returns `no_answer`, and the card renders **"Nothing
answered at Hostinger's address… The address or the port may be wrong, the
server may still be starting up, or its own firewall may not be letting this
computer in."** Every one of those guesses is wrong, and all of them point the
user at their server for a defect on their PC. TCP 22 was open and answering
throughout.

Compounding it: `probeSshTools` only runs `ssh -V`. It proves the tool is
**present**, never that it **works**, so DASH's own preflight passes and the
failure surfaces later wearing the wrong explanation.

**This blocks `V2`–`V10` entirely for a Windows user, at the first wall.**

### 20. The obvious fix for finding 19 crashes DASH — severe

Putting a newer OpenSSH ahead on `PATH` — the natural response, and the one a
support answer would give — makes DASH die instead. Git for Windows'
`usr/bin` also contains a GNU `whoami`, and DASH's channel-secret code shells
out to `whoami /user /fo csv /nh` to read the user's SID. GNU `whoami` rejects
those arguments and DASH surfaces:

```
Error invoking remote method 'dash:shell-command': ChannelSecretError:
The runner could not determine its own user SID: Command failed: whoami /user /fo csv /nh
whoami: extra operand '/user'
```

A raw exception in a Runtime Error overlay, naming neither the real cause nor a
next step. So finding 19 has no user-discoverable workaround: the fix for it
triggers this. The run proceeded by copying only `ssh.exe`, `ssh-keyscan.exe`,
`ssh-keygen.exe` and their MSYS DLLs into a scratch directory and putting *that*
first — which no user would ever devise.

Together these argue DASH should resolve these three binaries explicitly and
verify capability rather than presence.

### 21. The server card contradicts itself

On the same card, at the same moment: the chip reads **CANNOT REACH** while the
body reads **"The server is answering and would not let DASH in."** Both cannot
be true. The body was correct.

### 22. "1 server is connected" when none is

The Servers page summary counted a saved-but-unreachable server as connected.
This is the counted-not-asserted rule the codebase applies elsewhere, not
applied here.

### 23. The advertised undo does not undo everything

The setup snippet says *"To undo all of it later: `rm -rf /opt/orchestratedash`
(and remove the one line from the allowed keys file)"*, four lines after saying
it also leaves **"a folder in the account's home directory where agents you send
later keep their files"** — `~/.orchestratedash-host`, which that command does
not touch. Relevant to `V10`.

### 24. The `\r` advice cannot be followed as written

The snippet's header says to fix Windows line endings with
`sed -i "s/\r$//" thisfile`, while the instructions above it say to **paste**
the text rather than save it. There is no `thisfile`. (It did not bite on a
Hostinger paste, but the advice is unusable if it ever does.)

### 25. Removing an agent leaves its detail page rendered

Henrik, verbatim: **"once removed it still shows the agent profile. but clicking
agents show its removed."** The list is correct; the detail page keeps rendering
an agent that no longer exists.

### 26. Removing an agent leaves its runs behind

Henrik, verbatim: **"It doesnt clear runs tho."** The `runs` table holds 58 rows
pointing at agents including several that no longer exist
(`ai-news-scout-3`, `ai-news-scout-4`, `support-mail-digest`). Whether run
history *should* outlive its agent is a real design question — evidence
outliving the thing it describes is defensible — but it is currently neither
disclosed nor decided, and the removal copy promises "remove and delete all
files".

### 27. A credential is held for a connection that grants nothing

Connecting Google Calendar wrote `connection_secrets` for
`synthetic-gmail-meeting-assistant / calendar / calendar-account` and **no**
matching `broker_grants` row. Most likely correct — DASH implements no Calendar
operations, so it grants nothing — but the visible result is DASH holding a
credential it cannot use, with no surface saying so.

### 28. Nothing anywhere says an agent is live on a server

The only way to learn that a deployed agent is running is to open the server
card and press Check. The agent page shows *"DASH sent this agent to Hostinger
on 10 August 2026"* and, honestly, *"DASH has not asked Hostinger what is on it
now"* — but neither it nor the fleet card carries any live indicator. Henrik,
verbatim: **"there is no way to acctually see it is live and runs there. We
should add like a icon on the fleet card and inside the agent page."**

### 29. DASH's own sample agent cannot use DASH's conversation feature

*"Ai news scout 2 has no way to answer questions. Answering a question needs a
model, and this agent's description does not name one… Nothing to do here.
Whoever built Ai news scout 2 would have to give it one."* The agent in question
is what **Try a sample agent** scaffolds — the canonical first journey — and the
manifest confirms `agent.default_model_level` is **absent**. The refusal copy is
honest and well made; the problem is that the first agent a new user creates
cannot talk, and the fix is out of their hands by the message's own admission.
Same missing-producer story as morning findings 4, 5 and 14, now landing on
MAR-545.

### 30. An agent deployed to a server cannot be run there — structural

`V8` could not be performed, and the reason is not a bug in a screen.

- The remote channel admits only `EVIDENCE_ROUTES`: `/health`, `/agents`,
  `/telemetry/drain`, `/artifacts/drain`, `/workspace-artifacts`,
  `/registrations/reload`, `/shutdown`.
- The runner serves **no route that starts a run**. `GET /agents` reads;
  `POST /registrations/reload` deliberately *"does not even choose which"*
  registration to start.
- `DEPLOY_VERBS` is `install`, `start`, `stop`, `status`, `collect`, `connect` —
  no `run`. `start`/`stop` govern the runner process, not a run.
- The scout's trigger is `manual` (*"No schedule and no inbound event is
  configured"*), so nothing will ever start it on its own.
- "Run now" issues an agent control command (`retry`), which is not in the
  crossable set — and it targets the **local** copy, because a deployed agent is
  still imported here.

So: DASH can put an agent on a server, and then neither run it nor control it
there. For a manual-trigger agent that is terminal. The runbook's `V8`
("trigger the scout") assumed a path that does not exist.

**Architectural note, because it decides how expensive the fix is.** The reason
the channel is evidence-only is ADR 0006's boundary, and that boundary is about
**credentials** — `/broker/drain` and `/broker/responses` are excluded because a
runner that reaches them can reach the user's mailbox through DASH's grant. A
*run trigger carries no credential*. Admitting a start-a-run route would not
give a remote agent the broker, so Henrik's request below appears compatible
with ADR 0006 and 0007 rather than in tension with them. That is a claim for an
ADR to settle, not this log.

### 31. The deploy button does not change after a deploy

Once an agent is on a server the same surface still offers to send it, rather
than offering the actions that now make sense. Henrik, verbatim: **"ONce
connected the button should instead say disconnect this agent from the server or
something."**

---

## Henrik's friction notes, verbatim

Recorded exactly as written; these gate MAR-592's next phase.

- **"there is no way to acctually see it is live and runs there. We should add
  like a icon on the fleet card and inside the agent page."**
- **"ONce connected the button should instead say disconnect this agent from the
  server or something."**
- **"If an agent lives on VPS - It should disconnect and delete/copy down to the
  local file (say it has some output that its nice it follows "home". Then if
  you still want to delete the agent you delete it locally. So it lives on the
  VPS but can move home ;p"**
- **"Oh yeah so we need to be able to trigger and control the agent from DASH
  even tho it moved to the cloud ;o"**
- **"once removed it still shows the agent profile. but clicking agents show its
  removed."**
- **"It doesnt clear runs tho."**
- **"So basically i put the agent two times on the server. Once from the agent
  page and once from the server page."**

The third is a feature that does not exist in any form: **bring an agent home**
— disconnect it from the server, copy it and its outputs back down, and only
then decide whether to delete it locally. It is the symmetric other half of
deploy, and today deploy is one-way. Note it interacts with finding 26 (removal
leaves runs behind): "its output follows it home" is a claim about evidence
custody, which is the same question run history is already sitting in.

The fourth is finding 30 arrived at independently, from the outside, by the
person using it.

---

## Deviations from the runbook, stated plainly

1. **The host was not newly rented.** Same 2026-08-08 Hostinger box, reinstalled.
   Both first-contact walls were genuinely restored by the reinstall, and `V2`
   and `V4` were genuine first-contact events on regenerated keys and an empty
   `/opt`.
   It remains a deviation.
2. **DASH was run with a non-default `PATH`.** Three OpenSSH 10.3p1 binaries
   were placed ahead of Windows' bundled 9.5p2, for finding 19. Everything from
   `V2` onward was observed under that arrangement. What the run proves is that
   **DASH's logic works when given a working `ssh-keyscan`**; it separately
   proves a stock Windows 11 cannot reach `V2` at all.
3. **The developer shell, not a packaged install.** `pnpm shell` refuses without
   the Next dev server, so `pnpm dev` was running throughout. DASH logged
   `not claiming dash:// from .`, which will matter for any import step.
