# ADR 0009: The first pin is a person's decision, and DASH's key is a forced command

Status: Accepted

Date: 2026-08-08

Issue: MAR-572 (first-pin enrollment), MAR-573 (helper bootstrap). Related:
MAR-536 (the host command family, proven in the field for connect/probe),
MAR-489 (the attended proof this unblocks), ADR 0007 (the deploy transport),
ADR 0004 (release gates and third-party liveness).

## Decision

**Three things, decided together because the attended run found them together.**

1. **A never-seen host is enrolled by an explicit confirmation.** DASH fetches
   the host's key over its own dialer, shows the SHA256 fingerprint, and asks.
   Confirming writes DASH's `known_hosts` and sets `host_fingerprint`; refusing
   writes nothing. **There is no re-pin.** A changed key after pinning stays a
   hard refusal, and the only way to un-pin is to forget the server.

2. **A failure is classified into one of nine named problems**, from `ssh`'s own
   diagnostics, by a function whose return type is a closed union. The
   diagnostics themselves still never leave this machine.

3. **The helper arrives by one pasted snippet, and DASH's key is restricted to
   running it.** The allowed-keys line is
   `restrict,command="/opt/orchestratedash/dash-host" <key>`, so `sshd` runs the
   helper whatever the client asked for and puts the request in
   `SSH_ORIGINAL_COMMAND`. The verbs are not namespaced and are not on `PATH`.

## What happened, because it is the whole argument

On 2026-08-08 the MAR-536 wiring met a real host for the first time — a
Hostinger box, Ubuntu 24.04, provisioned an hour earlier. The runbook was
written before the run, per the MAR-468 promotion rule. It hit two walls that no
CI gate could have seen, because every fixture host in this repository is
already trusted and already has a helper on it.

**Wall one.** The wizard reached its final step, the public key was installed by
hand, and "check the connection" failed. The box's own `auth.log` recorded the
truth: DASH's probes arrived and aborted at **preauth**, with no publickey
attempt logged at all. `sshArgv` dials with `StrictHostKeyChecking=yes` against
a `known_hosts` that `createHostKey` writes **empty on purpose** — the strict
half of a design whose enrollment half was marked future and never built. Every
host DASH had not seen failed host-key verification forever, and the one refusal
sentence the wizard had could not name it.

**Wall two.** Once the key was pinned by hand, DASH authenticated — `Accepted
publickey for root … SHA256:FCU60rvm…`, DASH's own minted credential, distinct
from the operator's — and the host answered:

```
bash: line 1: status: command not found
```

`sshArgv` sends the verb as the remote command, so `host.probe` ran literally
`status` on the host. ADR 0007 says the helper travels *inside the bundle DASH
pushes*; pushing a bundle is the `install` verb, which also needs the helper. A
freshly rented server could therefore never reach a state where any verb
answered. Nothing in `docs/` described how the helper first arrives, because
nothing did.

Both walls were cleared by hand and the run passed. **That hand-work is what
this ADR turns into product**, and the two findings are one decision because the
first one's fix is what makes the second one's reachable.

## 1. Enrollment: what a confirmation is worth, said honestly

Trust on first use proves nothing. A fingerprint fetched over the same
connection it describes is self-consistent by construction, and a machine
impersonating the host would hand back its own key and its own fingerprint just
as smoothly. Any design here has that property; the question is what the product
does about it.

The answer taken is **attribution rather than proof**. The screen shows the
code, says where the provider shows the same code, and then says the sentence
most tools leave out:

> DASH cannot check this for you — anything answering at this address could say
> the same thing, so this is the one part only you can confirm.

A flow that showed a fingerprint and a Confirm button without that sentence
would be teaching people that clicking yes *is* a verification. It is not. It is
the moment the trust becomes theirs, and saying so is the entire value of the
step.

Three mechanics follow from taking that seriously:

- **`ssh-keyscan`, not `StrictHostKeyChecking=accept-new`.** `accept-new` writes
  a key into the file as a side effect of connecting, so the trust decision
  would be made by the connection, before anybody saw anything. The scan asks,
  shows, and writes nothing.
- **The fingerprint is computed from the bytes**, not scraped from
  `ssh-keygen -l`'s stdout, so the string a person compares is one this
  repository's tests pin against a vector OpenSSH produced.
- **The host is asked again at the moment of confirmation**, and the answer must
  match what was shown. The gap between showing and clicking is small, and it is
  precisely the gap this step exists to be careful about.

**One key is pinned, not all of them.** Writing every offered key would mean a
person confirmed one fingerprint and DASH trusted four, which is the shape of
consent the step exists to avoid.

### The refusal that must survive the new affordance

ADR 0007 requires a changed host key to fail closed, and an enrollment step is
exactly the kind of feature that quietly weakens that: the natural next commit
is a "confirm the new key" button, offered at the moment a person is most
inclined to press it. So the property is structural in three places at once —
`pinHostKey` has no argument that overwrites a line, `pinHostFingerprint`
updates only where the column is still null, and there is no sibling function in
either module that does either. Re-adding a genuinely rebuilt server means
forgetting it first, which removes DASH's key and its pin together.

## 2. Nine problems, and why parsing stderr became the honest option

`openSshChannel` carried a rule since MAR-484: do not read `ssh`'s stderr. The
reason was good — those messages name the account, the address, the port and the
local path of DASH's private key, and a transport that read them could
interpolate all four into an error message.

The rule was kept by *not looking*, and the attended run priced that. Three
completely different failures — an unconfirmed identity, a refused sign-in, a
server with no helper — arrived as one sentence: *"DASH could not sign in, or the
helper is not installed there."* The person was sent to check a key on a server
that had never been asked for one. The host's own log distinguished all three at
every step. **A surface that cannot tell apart what the server itself can is a
surface guessing on the user's behalf.**

So the rule is now kept a stronger way: `classifyHostFailure` takes the text and
can only return a member of `HostReachProblem`. There is no branch in it that
puts any of that text into its result, and a reviewer can check that by reading
the return type rather than by auditing call sites. The diagnostics still go
only to this machine's log.

`null` is a real return value and the important one. An unrecognised failure
keeps the generic sentence rather than being rounded to the nearest named
problem — a shrug sends nobody anywhere, and a wrong classification sends them
somewhere specific.

## 3. The bootstrap, and the two things it decides

### Verb resolution: forced command, not namespaced verbs

MAR-573's second finding is that for a bare verb to resolve, a host needs
executables literally named `install`, `start`, `stop`, `status`, `collect` and
`connect` on the default `PATH`. Three are ordinary English words and `install`
is one keystroke from something a sysadmin would expect to be a package tool.

Two answers were available.

**Namespacing** (`dash-status`, `dash-install`) solves the collision and nothing
else. The key DASH holds would remain a general shell credential.

**A forced command** (`command="…"` in `authorized_keys`) solves the collision by
removing the question — no `PATH` entries are created at all — and does something
the other cannot. ADR 0007 already promised that *DASH chooses which operation,
never what to run*, kept by `lib/deploy/verbs.ts` drawing every verb from a
closed array. That promise is about DASH's own code being unable to compose a
command. It says nothing about what the key could do in other hands. `command=`
moves the promise into the host's own configuration: `sshd` runs the helper
whatever the client asks for, so a key exfiltrated from this machine cannot open
a shell on the server. **The discipline becomes a property of the host.**

`restrict` accompanies it and does the boring half — no port forwarding, no
agent forwarding, no X11, no pty, no user rc file — each of which is a way a
forced-command key can still be used for something else. It is `restrict` rather
than a hand-written list so that whatever OpenSSH adds next release is off too.

The cost is one seam: `sshd` invokes the forced command with **no arguments**, so
`entry.ts` — which read `process.argv` — had to read `SSH_ORIGINAL_COMMAND` as
well. Argv still wins when present, which keeps every existing caller and the
local-child fixture proof behaving exactly as before. The variable is split on
whitespace and handed to the same `checkDeployRequest` as everything else; there
is no shell between the two, and a request longer than a verb and one identifier
is refused rather than truncated.

### The snippet: embedded, not downloaded

The helper is carried in the script as base64 — about twenty-five kilobytes —
rather than fetched.

1. **There is nowhere to fetch it from.** DASH has no server and is not getting
   one. A download URL is a hosting bill and an availability dependency for a
   product whose claim is that it runs on your own machine.
2. **The bytes are the ones this DASH shipped**, so "the host is running the
   build this DASH shipped" is true of the bootstrap by construction, exactly as
   it is of the deploy.
3. **It can be read before it is run.** A snippet whose interesting line is
   `curl … | sh` asks somebody to trust a URL. This one is long, and every action
   in it is visible in the text they are pasting.

The one thing it does download is Node, pinned at the version proven on the
2026-08-08 box, because Ubuntu 24.04 ships none new enough — `engines` requires
22.5.0 and the runner needs `node:sqlite`. It goes into `/opt/orchestratedash`
rather than `/usr/local/bin`, so "what did DASH leave behind" has a
one-directory answer and the script prints the command that removes it. A host
that already has a new-enough Node keeps it. The same Node serves the helper and
the runner the helper later starts, which is what makes one download enough.

The digest is checked against the release's own `SHASUMS256.txt`, fetched over
TLS from the same origin. That catches a truncated or corrupted download and a
mirror serving stale bytes. It does not, and cannot, prove nodejs.org was not
compromised — the same trust as installing from apt — and the script says so in
its own output rather than letting a checksum imply more than it proves.

### Line endings

The run's fourth finding: a script shipped from a Windows DASH arrived with CRLF
and the host's shell answered `$'\r': command not found`. The fix that matters is
that the generator emits `\n` and a test asserts no `\r` survives in the result —
that is the only place this repository controls. Inside the script, the embedded
payload is decoded through `tr -d '\r'`, because that is the one place a stray
carriage return would corrupt bytes silently instead of failing loudly, and the
header comment names the symptom and its one-line fix.

Producing a *pretty* error from a script that has already been mangled was
attempted and abandoned: every guard a shell could execute is itself broken by
the same carriage returns. Saying so here is better than shipping a guard that
looks like it works.

## What this does not prove

Nothing in CI runs the bootstrap. The tests parse it under a real POSIX shell —
Ubuntu's `dash`, which is the shell it will meet — and evaluate the allowed-keys
assignment to check the quotes `sshd` needs survive; that caught one real bug
before this shipped, where the forced command's quotes were being eaten by the
shell and would have produced a rejected key on a server somebody had just set
up. But parsing is not running, and a syntax check is not a proof.

ADR 0004's rule holds: the proof is an attended run on a genuinely fresh host,
and MAR-573's fourth acceptance bar names it. Until that run, both issues are
`merged`, not `proven`.

## Alternatives rejected

**Teach `ssh` to accept a new key on first connect.** This is `accept-new`, and
it is the one thing ADR 0007's transport comment already refuses by name: it
would make the first connection after an address change silently trust a new
key. It also makes the trust decision without a person in it, which is the whole
subject of decision 1.

**Keep one refusal sentence and log the details.** The sentence was accurate and
useless. "Could not sign in, or the helper is not installed" is true of five of
the nine states and actionable in none of them.

**Ship the helper inside the bundle only, and require the operator to install it
by hand first.** This is the status quo, and it is the circle MAR-573 named.

**A DASH-driven bootstrap over SSH.** DASH could send a one-time `sh -c` script
over the deploy channel once the bare key is installed. It would need DASH to
compose a command line, which is the one thing ADR 0007's verb set exists to
make impossible. Trading that property for a shorter snippet is a bad trade.

**Namespaced verbs on `PATH`.** See above: solves the smaller problem, leaves
DASH's key a general shell credential, and needs `PATH` entries on a machine
DASH does not administer.
