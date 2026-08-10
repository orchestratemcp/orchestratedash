# Handoff — after the second attended VPS run (2026-08-10 evening)

For the orchestrator. Written at the end of the attended MAR-489 run; the run's
own log is [`mar-489-attended-run-2026-08-10-evening.md`](mar-489-attended-run-2026-08-10-evening.md).

---

## Where things stand

**DASH `5ad6d70`, `pnpm verify` green from PowerShell** — 150 test files, 2911
passed, 0 failed; `verify:shell` 85 PASS / 0 FAIL. Runner-standalone build
`fa45e8715e790f8d6897`.

**MAR-489: `V0`–`V7` pass, `V8` FAIL, `V7b`/`V9`/`V9b`/`V10` not run. Promotes
nothing; MAR-481 does not close.** Two checks were performed for the first time
in the project's history: `V2` (first-pin fingerprint compared out of band
against Hostinger's console) and `V6` (the forced command refusing `cat
/etc/shadow`).

**MAR-594: two of three evidence rows exist, `broker_audit` does not.** Google
connected through the product and persisted for the first time. Still owed: one
real `gmail.search`.

**MAR-588: closed in practice** — the Discord webhook delivered a real message.

**Sixteen issues filed, MAR-600 → MAR-615.**

### The three that block everything

| issue | what |
| --- | --- |
| **MAR-600** | A stock Windows 11 cannot enrol a server. `ssh-keyscan` is resolved from `PATH`; Microsoft's 9.5p2 cannot key-exchange with Ubuntu 24.04's 9.6p1, and DASH renders it as *"Nothing answered at your address"* — blaming the user's server for a defect on their PC. |
| **MAR-601** | The obvious fix for MAR-600 crashes DASH: Git's GNU `whoami` shadows the Windows one the channel secret needs. Together, these leave a Windows user with **no discoverable way through**. |
| **MAR-602** | An agent deployed to a server can never be run or controlled there. This is why `V8` failed. Structural, not a screen bug. |

---

## The machine, as left

- **DASH is running** (`electron .`, pid 32000 at handoff), on the real store
  `%APPDATA%\orchestratedash`, with `pnpm dev` alive on `127.0.0.1:3000`.
- **DASH was launched with a non-default `PATH`** — three OpenSSH 10.3p1 binaries
  in a scratch directory, ahead of Windows' bundled 9.5p2, as MAR-600's
  workaround. **That dies with the process.** A DASH relaunched from an ordinary
  shell hits MAR-600 again at the first server check. Re-create with
  `ssh.exe`, `ssh-keyscan.exe`, `ssh-keygen.exe` + `msys-*.dll` from
  `C:\Program Files\Git\usr\bin`, or fix MAR-600 properly.
- **The VPS is enrolled and loaded, deliberately.** `186.240.156.166`
  (`srv1889370`): host key pinned, helper installed at `/opt/orchestratedash`,
  Node 24.19.0, `ai-news-scout-2` deployed and its runner alive (pid 3758).
  A follow-up can resume at `V8` without redoing enrollment.
- **Do not casually forget that server.** Forgetting deletes DASH's key and the
  pin, and there is no re-pin — the next `V2` would then need the box
  reinstalled to be a genuine first contact again.
- **Uncommitted:** `.orchestrate/state.json` (modified) and this run's two new
  docs. Nothing was committed or pushed; that is Henrik's call.

---

## Recommended next sessions, in priority order

### 1. The SSH pair — MAR-600 + MAR-601

```
claude --model sonnet
```

Repo `orchestratedash`, branch from `master` at `5ad6d70`, issues **MAR-600 and
MAR-601**, owns `electron/ssh-host.ts`, the channel-secret call site, and
`lib/host-connect.ts`'s `unreachable` copy. Read-write.

**Objective.** Make DASH resolve `ssh`, `ssh-keyscan`, `ssh-keygen` and `whoami`
explicitly instead of trusting `PATH`, and make the preflight prove *capability*
rather than presence.

**Evidence you have.** MAR-600 and MAR-601 carry the reproductions, the exact
`choose_kex` error, the exact `ChannelSecretError`, and the verified narrow fix.

**Non-goals.** Do not change the enrollment flow, the fingerprint UI, or the
bootstrap snippet. Do not bundle an OpenSSH.

**Verification.** `pnpm verify` from PowerShell (Git Bash's `whoami` fakes
channel-secret failures). Add a regression test that a `ssh-keyscan` returning
only a banner is reported as a tool problem, not as `no_answer`. A real host is
not required.

**Exit.** `merged`, with the Linear comment naming the commit. `proven` needs a
real host and belongs to the next attended run.

### 2. The remote-run decision — MAR-602

```
claude --model opus
```

Issue **MAR-602**. **Start with an ADR, not code.** The question: may a
start-a-run route cross the DASH↔host boundary? The run found that ADR 0006's
exclusion list is about *credentials* (`/broker/drain`, `/broker/responses`), and
a run trigger carries none — so this looks compatible rather than in tension.
That claim needs an ADR to settle it.

Weigh it against the cheaper alternative in the same ADR: a **schedulable
trigger** on the agent (Henrik asked for one in MAR-609) would make a remote
agent run with no new route at all. Pick one deliberately.

Non-goals: do not widen `EVIDENCE_ROUTES` to anything broker-shaped, and do not
implement before the ADR lands.

### 3. The agent page — MAR-609, with MAR-614 behind it

```
claude --model opus
```

Issues **MAR-609** (rebuild the agent page as a control surface) and **MAR-614**
(tighten the whole product). This is UX synthesis, which is the case for Opus
leading rather than reviewing.

Henrik's six asks are in MAR-609 verbatim. Two of them already exist and are not
findable or not working — chat (MAR-603) and remove (MAR-595) — so start by
finding out why, before building a third of anything. Size the design for the
**empty** agent first; that is the state every new user meets.

Use the capture harness and shoot both themes. Light mode is the part he said he
loves; a density pass that breaks it is a regression.

### 4. The avatars — MAR-615

```
claude --model opus
```

Henrik asked for a **long dedicated session**. Knight, Wizard, Ninja first, then
extend. Resolve early whether character animation is hand-authored or tooled —
PixelLab's `animate_image` degrades the cast, and that decision sets the whole
budget. The cast lives in `orchestrateweb`; DASH vendors it and must never
regenerate its own audit manifest.

---

## Coordination

Sessions 1 and 2 must not run together — both touch the deploy/host plane. 1 and
3 are safely parallel (different files entirely), as are 3 and 4 if 4 stays
inside the asset pipeline and 3 stays inside `app/agents/`.

Nothing here is blocked on Henrik except the merges themselves, which stay
human-gated.

---

## What the next attended run needs before it starts

1. **MAR-600 and MAR-601 fixed**, or the run is again measuring a workaround.
2. **MAR-602 decided**, or `V8`–`V10` are unperformable again — this is the
   whole remainder of the epic.
3. A decision on **the host**: resuming at `V8` on the current box is cheap and
   legitimate for `V8`–`V10`, since those are not first-contact walls. Re-proving
   `V2`–`V6` needs a genuinely fresh box, and the runbook's fresh-box rule should
   be honoured the next time those are claimed.
4. One real **`gmail.search`** through the broker, which is all MAR-594 still
   owes.
