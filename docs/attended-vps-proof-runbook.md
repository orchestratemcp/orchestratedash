# Runbook: the attended VPS proof (MAR-489)

Status: **attempted 2026-08-10 against `be90d84`, runner build
`da222f419086048178d2`, and NOT completed.** Part A reached `V-A1` only; **`V0`
through `V10` were not started.** The log is
[`mar-489-attended-run-2026-08-10.md`](mar-489-attended-run-2026-08-10.md), and
it promotes nothing — a green prefix is not a pass, which is this file's own
rule. The host was the **reinstalled** 2026-08-08 Hostinger box rather than a
newly rented one; the reasoning and the recorded caveat are in that log. Fifteen
findings came out of the attempt, three of which (the manifest blocks no producer
emits) make `V-A2`/`V-A3` unperformable as worded below.

Originally written 2026-08-09, before any run. Written first on
purpose — this is the MAR-468 promotion rule (`docs/real-google-proof-runbook.md`)
and ADR 0004's rule pointed at a host instead of at Google: a runbook is not a
run, and deciding what counts as pass *after* a green log is how a proof comes to
mean whatever the reader hoped for. When it is executed, the run's date, the two
commit ids, the VPS provider and spec, and every check's result are recorded per
the promotion rule at the bottom.

Read [ADR 0007](adr/0007-the-deploy-transport.md) and
[ADR 0009](adr/0009-first-pin-enrollment-and-the-forced-command.md) before
recording a result. This proof exists to turn several claims those two ADRs make
in prose into observations — the fingerprint compared out of band, the forced
command refusing a shell, the pull reconstructing a remote run — and the ADRs are
the judgment about what each observation is worth.

This is the epic's (MAR-481) closing proof and it is **attended, dated and
human-watched, permanently** — not until someone automates it. ADR 0004 forbids
a blocking release gate that depends on a machine that is not this repository and
this one, and a VPS is neither. So this file is a procedure a person follows once
and pastes the result of, and nothing in CI runs it.

---

## What this run proves, and what it explicitly does not

**Proves, if every check passes:**

- A **never-seen host** is enrolled by a person confirming its identity through
  the product, with the fingerprint compared against a source that did not travel
  DASH's own SSH connection — the trust-on-first-use gap ADR 0009 decision 1 names
  and which **no run has ever closed**.
- The **helper arrives by one pasted snippet** and DASH's key on that host is a
  **forced command**: `ssh -i <dash key> root@host 'cat /etc/shadow'` returns the
  helper's refusal rather than the file. This is the single observation that turns
  ADR 0009 decision 3's claim into evidence.
- A **fresh deploy from a clean DASH** puts the News Scout on the host, the
  standalone runner supervises it, a run completes **on the VPS**, and the
  installed DASH **pulls** it so the Runs row, verdict and artifact appear here —
  MAR-488's generalised drains exercised over real `ssh` for the first time
  (until now only a scripted channel has driven them).
- **Stop + remove leaves the VPS clean**, and the one-directory install
  (`/opt/orchestratedash`) has a one-command removal.
- The **local half of the journey** — build an agent that uses an MCP tool and an
  LLM, import it, connect its credentials through the declaration MAR-569 landed,
  run it locally — works end to end, **and the product refuses to deploy that
  credentialed agent to the host** (MAR-482), which is the boundary ADR 0006 and
  0007 spend their length keeping.

**Does not prove, and must never be read as proving:**

- Nothing here is a claim about an **unattended, always-on** VPS agent surviving
  reboots or DASH being closed for a week. Restart-on-boot and host retention are
  **undecided** (ADR 0007 follow-ups, unchanged), and the pull model means
  evidence is bounded by the host's retention and by when DASH last looked — a
  real gap, not a rendering delay (ADR 0007, "what stops being proven").
- A **credentialed agent is not deployed to the host.** ADR 0006's line holds: a
  process DASH's runner did not spawn gets no brokered credential, and MAR-482
  refuses a `remote` runtime beside a `dash_managed` connection at import. The
  deployed agent is the News Scout (`public_feed_fetch`, no credentials), exactly
  as MAR-489's non-goals require.
- **This is not a load test, a cadence test, or a security assessment of the
  host.** DASH holds a key that could run anything on that box; the forced command
  is a boundary against **DASH itself**, not against the operator, and ADR 0007
  says so plainly.

---

## Before you can run this at all — the two UI gates (BOTH NOW CLOSED)

> **Corrected 2026-08-10.** Both gates below have shipped and this section is
> kept for the reasoning, not as a current blocker. **MAR-579 merged** (PR #100):
> the wizard's key step shows the one-paste snippet and the restricted
> `authorized_keys` line rather than the bare key, `host_key_not_trusted` renders
> the fingerprint with a Confirm wired to `host.trust`, and `describeBootstrapGap`
> is deleted. **MAR-577 merged** (PR #101), so prefer its result surface and
> record that you did. **MAR-570 also merged** (PR #109), so the requirement card
> exists — but see the run log: no producer emits the
> `agent_dom.connection_requirements` block it renders, so `V-A2`/`V-A3` cannot be
> witnessed as worded regardless of the surface being present.


The deploy plane is complete from the IPC layer down (MAR-536, MAR-556, MAR-484,
MAR-487, MAR-497, MAR-488, all merged), and the Servers page renders a saved
server and its deploy control (MAR-574). **But one leg of the product journey has
no surface yet, and it is load-bearing for this run.**

### P1 — Enrollment has no surface (hard blocker: MAR-579)

First-pin enrollment and the bootstrap snippet are wired to the IPC layer and
called by no page. Concretely, on a fresh host today:

- `app/hosts/page.tsx`'s probe maps a `host_key_not_trusted` failure into a plain
  `unreachable` standing and **discards** the `fingerprint` / `key_type` /
  `offered_count` the probe returned. The `confirm_host_key` state, its copy, its
  chip and its copy-sweep test all exist (`lib/host-connect.ts`,
  `app/_components/server-card.tsx`) and **nothing sets it**. The person is never
  shown the code they are the only one who can confirm.
- No component calls `submitHostCommand("trust", …)` or `("setup", …)`. The
  channels, the `app/_data/source.ts` cases and the audited main-process plumbing
  all landed in PR #94 with no caller — the same shape as MAR-536 and MAR-577.
- The wizard's key step still prints the bare public key and asks the person to
  install it by hand. `host.create` now returns `authorized_keys_line` — the
  `restrict,command="/opt/orchestratedash/dash-host"` form — and it is never
  rendered, so **following the current UI installs DASH's key as a general shell
  credential**, which is the exact thing the forced command exists to prevent and
  which check `V6` below would then fail.

This must ship before the run. It is filed as **MAR-579** with the wiring both
MAR-572's and MAR-573's packet notes already specify verbatim. Until it does,
first-pin enrollment and the one-snippet bootstrap **cannot happen through the
product**, and doing them by hand would be re-running the 2026-08-08 hand-work
this proof exists to retire.

### P2 — Deploy result rendering is thin (soft gap: MAR-577)

MAR-574 shipped the "Put an agent here" control and the deploy panel, so deploy
**is** reachable from the manage card. MAR-577's remainder — an agent-side entry
point, deploy progress/result rendering, and the manifest-only refusal shown on a
real surface — is not a blocker for this run, but its absence means the deploy's
progress and outcome are read through the card's re-probe (`agents_running`)
rather than a dedicated result view. Note in the log which you relied on. If
MAR-577 has shipped by run time, prefer its result surface and record that.

If either of these has moved since this was written, correct this section in the
same pass that records the run — the pre-run-sentence correction every entry in
`PROJECT_STATE.md` receives.

---

## The host, and why it must be a new one

**Rent a fresh box. Do not reuse the 2026-08-08 Hostinger machine.** That box was
brought to a working state entirely by hand — the key pinned by hand, the helper
installed by hand, Node placed by hand — and it is the contaminated control this
proof is measured against. A run against it would prove that a host somebody
already set up by hand answers DASH, which is not the claim. The whole point of
`V2`–`V6` is that a person who has never touched the shell reaches a working host
**through the product**, and that is unobservable on a box where the walls were
already cleared.

- **Provider:** Hostinger is the one DASH has been proven against and is the one
  the Servers page recommends; another provider is fine and must be recorded.
- **Image:** Ubuntu 24.04. ADR 0007 amendment 1 pins the reason — the host
  supplies Node, Ubuntu 24.04 ships none new enough for `node:sqlite`, and the
  bootstrap installs the pinned Node the 2026-08-08 box proved (24.19.0).
- **Access:** you need the provider's **out-of-band console** (Hostinger's
  browser terminal, or the panel's SSH host-key display) for `V2`. That path must
  not be DASH's SSH connection — a fingerprint fetched over the connection it
  describes is self-consistent by construction and proves nothing (ADR 0009).
- Record the provider, region, spec and the hour it was created. "Provisioned an
  hour earlier" is part of what made the 2026-08-08 run a real first contact.

---

## Preconditions

1. **A clean DASH.** No host record for this box in the store. If you are reusing
   a DASH that connected the 2026-08-08 box, *forget* that server first (which
   removes DASH's key and its `known_hosts` line together — there is no re-pin),
   or run against a DASH profile that never saw it. Henrik's four duplicate rows
   for the old box (MAR-574) are evidence and stay; they are a different machine.
2. **The tree you are making a claim about.** `git rev-parse HEAD`, and `pnpm
   verify` green on it from PowerShell (the Windows shell smoke is part of that;
   Git Bash's `whoami` fakes channel-secret failures — run it from PowerShell).
   Record the commit. Record the runner-standalone build id too — run
   `pnpm build:runner-standalone`, which **prints** it (`runner_build=…`).
   (Corrected 2026-08-10: `scripts/runner-build-id.mjs` is a module with no CLI
   entry point, and it hashes `runner/`, `lib/` and `contracts/` rather than
   `dist/`, so the previous instruction here could not be followed.) `V7` checks
   the host reports the build this DASH shipped.
3. **The preflight for an orphan runner.** Before starting, confirm no leftover
   runner from an interrupted proof is holding a data directory — the MAR-520
   lesson, and the orphan **pid 44632** MAR-548's note already names may still be
   on this machine. Do not `Stop-Process`; AGENTS.md forbids it and a force-killed
   runner corrupted the real store once. A runner that recorded its own channel
   secret retires through its authenticated `/shutdown`; one that did not needs a
   single Windows restart.
4. **The local-journey agent, built but not yet imported.** For Part A you need an
   agent that genuinely uses an MCP tool and an LLM and declares a connection
   requirement (MAR-569). Build it with the Agent Kit
   (`pnpm build:agent-kit && node agent-kit/dist/cli.mjs <name>`) or export a
   build brief from orchestratekit-mcp. It must declare
   `agent_dom.connection_requirements` v1 with one `api_key` or
   `google_oauth_broker` kind, a `local` runtime, and the credential it needs. Do
   **not** give it `runtime.kind: remote` beside a `dash_managed` connection —
   that is the MAR-482 contradiction, and `V-A5` proves the refusal deliberately
   with a *separate* copy that does.
5. **The News Scout is the deployable agent.** It is what `DASH › Try a sample
   agent` scaffolds. No credentials, `public_feed_fetch`, three live sources. It
   is the only agent deployed to the host.

---

## Part A — the local journey, and the boundary at its end

This is the LAB journey folded in: build an agent that finds or acts on real
data, connect it, run it locally, and watch the product refuse to send a
credentialed agent to a machine DASH cannot supervise honestly. It exercises
MAR-569 end to end and asserts ADR 0006's line from the inside.

| check | what it establishes |
| --- | --- |
| `V-A1` | the MCP+LLM agent imports through the real `dash://handoff` consent dialog — the same seven ordered checks a terminal link takes (`docs/agent-handoff.md`), no registration written without consent |
| `V-A2` | its `connection_requirements` render on the Connections surface as one line per requirement with a standing chip and a **Connect** button that DASH can actually fire (MAR-570 — see the gap note below) |
| `V-A3` | connecting the credential through that flow moves the standing to `allowed`; the three-party intersection (DASH implements, manifest declares, provider issued) resolves on the connection the requirement names |
| `V-A4` | **Run now** locally produces the agent's output, and the run, verdict and artifact appear under Runs on this machine |
| `V-A5` | a *separate* manifest declaring `runtime.kind: remote` beside a `dash_managed` connection is **refused at import** with `remote_agent_dash_connections`, not discovered at runtime (MAR-482). The credentialed agent from `V-A1` is never offered to the host |

**Gap on `V-A2`/`V-A3`:** the Connections *card per agent* with the per-requirement
Connect button is **MAR-570**, which is `Backlog` and unbuilt (the schema and
resolver landed in MAR-569, the surface did not). If MAR-570 has not shipped by
run time, connect the credential through the existing Connection Center flow
(`connection.connect`) instead and record `V-A2` as **covered by the older
surface, requirement-card not exercised**. The requirement *declaration* is still
proven by import validation; only the per-line rendering is deferred. Do not let a
green Part A imply the requirement card was witnessed if it was not — that is the
`6j` mistake (asserting *a* verdict existed) pointed at this surface.

---

## Part B — the VPS proof

Everything below happens on the **fresh** host, through the product, with the two
P-gates satisfied. Numbered in the order a person hits the walls, which is the
order ADR 0009 found them in.

| check | what it establishes |
| --- | --- |
| `V0` | DASH is the clean one: no host record for this address, and `pnpm verify` green on the recorded commit |
| `V1` | **Add the server** through the Servers page: `host.create` mints the key and record, the card opens `awaiting_key_install`, and the record persists across a DASH restart (the MAR-574 finding — a saved server is no longer invisible) |
| `V2` | **First-pin enrollment.** Checking the server returns `host_key_not_trusted`; the product shows the SHA256 fingerprint, the key type, and how many keys the host offered. You compare that fingerprint against the provider's out-of-band console (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` in Hostinger's browser terminal), they match, and you confirm. **This is the check no run has ever performed.** |
| `V2b` | the confirmation screen carries the sentence that makes it honest — *"DASH cannot check this for you… this is the one part only you can confirm"* — and there is **no re-pin**: a later differing key is a hard refusal, un-pinnable except by forgetting the server |
| `V3` | after confirming, a re-check no longer fails on the host key. It now fails on `key_not_on_server` — DASH's key is pinned but not yet installed there. A different, later wall, correctly named |
| `V4` | **The bootstrap snippet.** The product gives you one pasteable snippet (`host.setup`). It states what it will do **before** it does it, installs the pinned Node where Ubuntu ships none new enough, writes the helper embedded as base64 (not downloaded), and adds the one `restrict,command=…` allowed-keys line. Everything lands in `/opt/orchestratedash`, and the snippet prints the command that removes it |
| `V5` | a re-check now reaches the host: `reachable`, `no_runner_there` (nothing deployed yet). The card's standing is the server's own report with an age, never a stored guess |
| `V6` | **The forced-command refusal** — the load-bearing observation. See the section below. `ssh -i <dash key> root@host 'cat /etc/shadow'` returns the helper's JSON refusal, **not** the file. A plain `ssh -i <dash key> root@host` (no command, no pty) does the same. `ssh -i <dash key> root@host status` returns the helper's `status` answer. The key does exactly one family of things and opening a shell is not among them |
| `V7` | **Deploy the News Scout** from the manage card ("Put an agent here"). The bundle installs, the standalone runner starts under the host's own Node, and a re-probe reports the runner build — matching the id recorded in precondition 2, so "the host runs the build this DASH shipped" is checked, not asserted (ADR 0007 amendment 1's `runner_build` fix) |
| `V7b` | a **manifest-only** agent (a migrated folder with no acquired build) is **refused locally** with `MANIFEST_ONLY_DEPLOY_REFUSAL` and sends nothing — the refusal reaches the surface, there is no half-bundle on the wire (MAR-556) |
| `V8` | **A run completes on the VPS.** Trigger the scout (manual trigger, the cadence MAR-457 already proved — no new cadence). The runner supervises it, it reads its three live sources and writes a digest **on the host** |
| `V9` | **DASH pulls it.** The installed DASH's poll loop, over the real `ssh` control channel, drains the remote runner's telemetry and artifacts (MAR-488, over real SSH for the first time). The Runs row appears here, the grounding verdict renders, and the digest artifact is retrievable and reads as it did on the host |
| `V9b` | the Runs page renders the **pull caveat** honestly: the evidence is as complete as the host retained and as fresh as DASH's last look, worded as a permanent caveat and never as a fault (MAR-488's copy rule). The `dropped` count, if any, is shown rather than a silent zero |
| `V10` | **Stop + remove leaves the VPS clean.** Stopping the agent goes through the runner's own authenticated `/shutdown` (the helper's `stop`, MAR-520 — no signal, no force-kill). Forgetting the server removes DASH's key and `known_hosts` line. The removal command the snippet printed clears `/opt/orchestratedash`. Confirm from the provider console that the directory is gone |

---

## `V6` in detail — the forced command is the proof

ADR 0009 decision 3 says DASH's key on the host is restricted to running the
helper: `restrict,command="/opt/orchestratedash/dash-host" <key>`. `sshd` runs the
helper whatever the client asks for and puts the client's request in
`SSH_ORIGINAL_COMMAND`; the helper reads it, finds no verb it performs, and
refuses. The value of that claim is entirely in observing it against a real
`sshd`, because every fixture host in the repository already trusts DASH and the
tests can only spawn a local child with the variable set by hand
(`tests/deploy-bridge.test.ts`), never a real forced command.

Locate DASH's minted private key for this host. On an installed Windows DASH it is
under `%APPDATA%\orchestratedash\hosts\<key_name>` (the `key_name` is the one
`host.create` reported; the renderer drops it, so read it from the create result
or the store). Then, from your own shell:

```bash
# 1. The proof. Ask for a shell command. Get the helper's refusal, not the file.
ssh -i "$DASH_KEY" -o IdentitiesOnly=yes root@"$HOST" 'cat /etc/shadow'
#   expect: {"ok":false,"problem":"unknown_verb","detail":"\"cat\" is not an operation this helper performs."}
#   NOT the contents of /etc/shadow, and no shell.

# 2. No command at all — still the helper, still no pty, still a refusal.
ssh -i "$DASH_KEY" -o IdentitiesOnly=yes root@"$HOST"
#   expect: {"ok":false,"problem":"unknown_verb","detail":"No operation was named."}

# 3. The intended verb works, and only it. The key is not inert — it is scoped.
ssh -i "$DASH_KEY" -o IdentitiesOnly=yes root@"$HOST" status
#   expect: {"ok":true,"verb":"status",...}
```

The three together are the statement: **a key exfiltrated from this machine cannot
open a shell on that server.** Paste all three, verbatim, into the log. If `cat
/etc/shadow` returns anything resembling `root:$…`, the run has **failed `V6`** and
must promote nothing — it means the key was installed without the forced command
(the P1 hand-install path, or a bug), and the finding becomes a new child before
any re-run.

A note on honesty, ADR 0009's own: this is a boundary against DASH, not against
you. You hold a key on your own machine that you could have installed without
`command=`; the proof is that the *product's* path installs it with the forced
command, so a DASH that is buggy or fed a hostile build brief cannot turn a deploy
into a remote shell. Do not record `V6` as "the host is secured."

---

## If the run fails partway

A stopped or partial run **must say which checks it did not run** — MAR-468's rule,
and MAR-489's own exit criterion. A green prefix is not a pass. Record every check
as `pass`, `fail`, or `not run`, and for a `fail`, the exact observation.

Clean up whatever a partial run left, and record it:

- If the helper was installed but deploy never happened, the box still has
  `/opt/orchestratedash`. Run the removal command the snippet printed, and confirm
  from the console.
- If a runner was started on the host and DASH cannot reach it, stop it through
  its authenticated route, not a signal. If it recorded no channel secret, it is
  the MAR-520 case — say so; do not force it.
- If DASH pinned the host key and you are abandoning the run, **forget the
  server** so the next attempt is a genuine first pin again. A left-behind pin
  makes the next `V2` a no-op that looks like a pass.
- Destroy and re-rent the box before any re-run. Every wall in `V2`–`V6` is a
  first-contact wall, and a second run on the same box is the contaminated case
  this runbook opened by refusing.

---

## Recording the result

Paste the whole log, with the date, into all three, each carrying the date:

1. the Linear issue (**MAR-489**), with commit ids (DASH + runner-standalone
   build id), the VPS provider/region/spec and the hour it was created, the run
   id, the artifact id, and screenshots of the Runs row and the receipt copy;
2. `.orchestrate/state.json`, in MAR-489's `note`;
3. `PROJECT_STATE.md`, in the remote-runtime section.

Then correct this file's status header to say the run happened, when, against
which commit and which box — building the runbook is not running it, the same
distinction every proof in this repository draws about itself.

## The promotion rule

A run in which **every** `V`-check passes promotes **MAR-489 from its current
state to `proven`** and, per its exit evidence, **closes the epic MAR-481**. The
`note` must say all of:

1. the date, the DASH commit, the runner-standalone build id, and the host
   provider/spec — because a proof of a remote deploy is a proof against a
   specific build and a specific machine, and stale on arrival without them;
2. that the deployed agent was the **News Scout, no credentials**, and that a
   credentialed agent was **refused** deployment by design (`V-A5`) — this run is
   not evidence any credentialed agent runs remotely, and ADR 0006 forbids that it
   ever will through DASH's broker;
3. that **restart-on-boot and host retention remain undecided**, so nothing here
   is a claim about an unattended box surviving a reboot or a week of DASH being
   closed;
4. that MAR-488's remote pull was exercised over **real `ssh` for the first
   time**, and which of `V-A2`/`V-A3` were covered by the requirement card
   (MAR-570) versus the older Connection Center surface.

A run that fails any check promotes nothing, and its findings become new children
before any re-run — MAR-489's own words. A run that was not performed promotes
nothing either, and **this file existing is not the run.**

---

## The live walk-through

This proof is attended by definition, so the last step is not a paste — it is
sitting with Henrik and running it together: adding the fresh box, comparing the
fingerprint against the Hostinger console side by side, pasting the snippet once,
watching `cat /etc/shadow` come back a refusal, deploying the scout, and watching
its first remote digest arrive in the installed DASH after a pull. The walk-through
is where the four ADRs stop being prose. Schedule it once P1 (MAR-579) ships and a
fresh box is rented; do not run it alone.
