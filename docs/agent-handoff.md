# The agent handoff

How an agent somebody just built gets into DASH without them writing a
registration file, locating JSON, or using a file picker.

- **Issue:** MAR-428 (DASH-11b)
- **Builds on:** MAR-415 (the detached runner), MAR-426 (manifest v2 from
  `export_build_brief`), MAR-430 (owner-only local IPC)
- **Contract:** [`lib/handoff.ts`](../lib/handoff.ts) — the only place the shape
  is written down

## The sequence

```
npx create-dash-agent folder-digest      # a project with a v2 manifest
cd folder-digest
npm run open-in-dash                     # writes dash-handoff.json, opens dash://…
                                         # DASH asks. You say yes.
                                         # It is registered, started, and stays running.
```

Four artifacts, in the order they exist:

| Artifact | Written by | Lives in | Contains |
| --- | --- | --- | --- |
| `agent.manifest.json` | the Agent Kit, or `export_build_brief` | the user's project | what the agent plans to do |
| `dash-handoff.json` | `npm run open-in-dash` | the user's project | what to run, and a single-use code |
| `dash://handoff?…` | the same command | nowhere — it is opened | a file path and that code |
| `{data-dir}/agents/{id}.json` | DASH, after consent | DASH's data directory | the registration the runner reads |

## Why the URL carries a pointer and not a command line

Registering an agent means telling the runner a command line to spawn. If a
`dash://` URL could *carry* that command line, then any web page a user ever
visits could hand DASH an arbitrary program to run, and the only thing between a
novice and a compromised machine would be their reading of a dialog.

So the URL names a file and proves the opener could read it:

- **The command line is in the file, never in the URL.** A URL is
  attacker-authored by construction. A file at an absolute path is not: writing
  one requires already being able to write to that user's disk.
- **The nonce is proof of possession, not a credential.** It is minted with the
  handoff, stored inside the same file, single-use, and expires in 30 minutes.
  Presenting it proves the opener *read the file*, which is exactly the
  capability a drive-by page does not have. It authorises one thing — showing
  the user a proposal — which is why it can travel in a URL at all while the
  issue's rule that no secret or bearer token may is untouched.
- **Consent is still required.** The nonce narrows who may ask; the user
  decides. There is no branch in `lib/handoff-flow.ts` that writes a
  registration without `confirm` having returned true.

The order of checks is the argument, and nothing before step 7 changes any
state:

1. Parse the URL.
2. Read the file it names, size-bounded, and validate its shape.
3. Verify the nonce, in constant time, against the file's own copy.
4. Read and validate the manifest, refusing anything that is not v2.
5. Check the manifest and the handoff agree about which agent this is.
6. Ask the user, in plain language, naming what will run.
7. Write.

## No secret reaches any of these artifacts

Enforced, not intended:

- `secretsInEnvironment` refuses a handoff whose environment block carries a
  name that looks like a credential — `*token*`, `*secret*`, `*password*`,
  `*api_key*`, `*credential*`, `*auth*` — and refuses `DASH_*` outright, because
  those names belong to DASH and the runner. Refusing to *record* one means the
  failure lands where a person can act on it, rather than at the point the
  runner's `assertNoRunnerSecrets` declines to start the agent.
- Runner-hosted telemetry does not create an exception. The agent emits each
  telemetry v1 candidate over its existing stdout NDJSON pipe; the runner
  buffers it, and DASH main drains it over the authenticated runner channel.
  `DASH_INGEST_URL` and `DASH_INGEST_TOKEN` therefore remain absent from the
  handoff, registration and child environment.
- The ledger in `agent_handoffs` has no column for the nonce and none for a
  command line.
- The manifest schema already forbids credential values, and `agent.manifest.v2`
  keeps provider scopes under `fields[].technical.provider_scopes` so the plain
  label can be shown on its own.

## Idempotency

**Sameness is decided on the material facts** — what would be spawned, in which
folder, with which settings, against which manifest content — and never on the
document, which carries a fresh id, a fresh nonce and a fresh timestamp on every
rebuild. A handoff whose facts match the existing registration writes *nothing*,
not identical bytes: "has this been touched since I approved it" stays a
question the filesystem can answer.

Re-opening a handoff still makes the end state true. An agent that is registered
and stopped is not "already added" in any sense a user means, so the idempotent
path still starts it.

A handoff whose facts *differ* is an update, and updates ask again — in the
language of an update, naming what changed ("what DASH would run has changed").

## Recovery paths

Every refusal produces a sentence a person can act on, and a ledger row so that
"nothing happened when I clicked that" is answerable later.

| What happened | What DASH says |
| --- | --- |
| The link expired | "That link has expired. Run *Open in DASH* again from the agent's folder — nothing is wrong with the agent." |
| The nonce does not match | "That link does not match the agent's handoff file, so DASH did not open it." |
| The handoff file is gone | "DASH could not find that agent's handoff. It may have been cleaned up — re-run *Open in DASH*." |
| The manifest is v1 | "*Name* was built for an older version of DASH." |
| The manifest names a different agent | "That handoff does not match the agent's own plan, so DASH did not add it." |
| An agent of that name was registered by hand | "An agent called *name* was already set up on this computer by hand. DASH will not overwrite it." |
| Already added, unchanged | "*Name* is already in DASH. Nothing was added twice." |
| No runner on this machine | "It is saved. DASH could not start it, because agents cannot be hosted on this computer." |

## DASH can be the one who runs the command (MAR-423)

There is a second producer of handoffs, and it is DASH. **DASH › Try a sample
agent** scaffolds a project into the user's documents folder, writes a real
`dash-handoff.json` with a real single-use nonce, and hands the resulting
`dash://` URL to the same `openHandoff` a terminal link goes through.

Writing a registration directly would have been shorter. It would also have been
a second way to register an agent, and the second way is always the one that
quietly skips the nonce, the ledger row, or the consent — so there is no branch
anywhere that does it. The user sees the same dialog and DASH takes the same
seven ordered checks.

One thing differs, and only for this producer: the sample is registered against
**`dash:node`**, a sentinel rather than a program.

| | Agent Kit | DASH's own sample |
| --- | --- | --- |
| `command` | `node`, resolved against `PATH` | `dash:node`, resolved at spawn |
| Needs Node installed | Yes, and the author demonstrably has it | No |
| Survives an MSIX update | Yes | Yes — nothing version-stamped is written down |

`lib/registration.ts::resolveSpawnCommand` turns the sentinel into the spawning
process's own `execPath` plus `ELECTRON_RUN_AS_NODE=1` — the same pair
`electron/runner-process.ts` already uses to launch the runner. It is resolved
at the moment of spawning and **never written to a file**, because
`docs/msix-lifecycle-evidence.md` measured the install root as version-stamped:
a registration holding a real path stops working at the first update.

It grants nothing. A registration may already name any command; this names
strictly one, and it is DASH's own binary rather than anything on disk. The
resolution is applied *after* the registration's own environment block, so a
registration cannot ask for DASH's interpreter and then unset the flag that
makes it one — which would spawn the shell itself, windows and all, with an
agent's script as its argument.

The consent dialog does not print `dash:node`. It is not a program on this
machine, and it would be DASH's own vocabulary in front of the reader least able
to parse it. The script is still named, because that is what is being approved.

## Ownership and cleanup

A registration written by DASH carries a `dash` block naming its owner, the
handoff it came from, and the project it points at. The runner ignores the block
entirely — it reads the fields it knows and carries the rest through — so
ownership costs nothing and needs no second file to fall out of sync with.

A registration *without* that block is treated as external, not as a defect: the
four-field file `runner/README.md` documents is a thing people have written, and
DASH must neither refuse it nor claim to own it.

Removing an agent DASH added, in this order:

1. **Stop the process.** Deleting a registration under a running agent leaves a
   child nobody has a record of.
2. **Delete the registration and DASH's copy of the manifest.**
3. **Forget DASH's current picture of it** — the imported manifest and the last
   state snapshot.
4. **Have the runner take a fresh reading.**

And it reports both halves. What was removed, and what was deliberately left
alone: the agent's own folder and everything in it, anything the agent itself
wrote, and the history of what it did, which stays under Runs. A monitor that
erased its own record of what happened, because the thing it happened to is
gone, would not be a monitor — and a removal dialog that stays silent about the
user's project folder invites exactly the anxiety it should be settling.

Removing an agent DASH did *not* add is refused, and the refusal names the file
so the person can do it themselves.

## Why DASH copies the manifest

The registration points at `{data-dir}/agents/manifests/{id}.manifest.json`,
written at the moment of consent, rather than at the author's file.

- The manifest DASH validated in the dialog is byte-for-byte the one the runner
  reads. Pointing into the project leaves a window between the question and the
  answer.
- Editing the manifest in the project does not silently change what an approved
  agent may be commanded to do. It takes another handoff, and another consent.
- Cleanup has something it unambiguously owns.

The copy lives in a subdirectory rather than beside the registration because the
runner loads *every* `.json` directly in `agents/` as a registration; a sibling
`*.manifest.json` would be skipped and warned about on every runner start,
forever.

## The runner learns about it without restarting

`POST /registrations/reload`, authenticated with the channel credential.

The route re-reads the directory itself and **ignores the request body
entirely**, so the caller chooses *when* the runner looks and never *what* it
finds. `runner/README.md`'s rule survives intact: the API chooses which
registration to start, never what to run — and this route does not even choose
which.

**A running agent is never disturbed.** Not restarted, not re-pointed at a
different command line, not forgotten because its file vanished. The runner's
claim to own lifecycle facts rests on having started the process; swapping the
registration under a live child would make its own record a guess. Changes to a
running agent are *deferred* and reported as deferred, and take effect the next
time it starts.

## Where the deep link comes from, per platform

| Platform | How the URL arrives |
| --- | --- |
| Windows, DASH already running | A second process launches with the URL in its `argv`; the single-instance lock hands that `argv` to the first through `second-instance`. |
| Windows, cold start | The URL is in this process's own `process.argv`. There is no event coming. |
| Linux | The same, via the `.desktop` handler. |
| macOS | `open-url` on the running app. `argv` is not involved. |

An installed DASH claims the scheme through the MSIX manifest's
`windows.protocol` extension;
`lib/shell/appx-manifest.ts::assertDeclaresHandoffProtocol` fails the packaging
build if that element ever stops naming the scheme the code listens for. The
developer path claims it through `app.setAsDefaultProtocolClient`, which in a
packaged app is a no-op that has already lost to the manifest.

Links that arrive before DASH is ready — including the one that started the
process — are queued rather than dropped, and are run one at a time, so an
impatient double click on *Open in DASH* cannot produce two dialogs racing in
front of one confused user.

## What this does not do

- **The Agent Kit is not published.** `create-dash-agent` is `private: true`, so
  `npx create-dash-agent` off the public registry does not work yet. Publishing
  is a decision about a name and a namespace, not something this issue should
  have made on anybody's behalf. Until then:
  `pnpm build:agent-kit && node agent-kit/dist/cli.mjs my-agent`.
- **The consent dialog is a native modal, not a DASH page.** A handoff arrives
  from outside the renderer and may be what starts DASH, before a page exists.
  The gate must survive a renderer that is slow, broken or compromised, and
  page content must not be able to imitate, suppress or approve it. MAR-432
  (DASH-20) replaced the packaged placeholder with the real UI; that made a page
  possible, but deliberately did not move this trust decision into one.
- **A sample agent's run is not visible yet.** It registers, it starts, and it
  keeps running — but MAR-433 (DASH-21) found that a runner-hosted agent's
  telemetry never reaches DASH at all, so its runs do not appear under Runs and
  plan-vs-actual never executes for it. Named here rather than left to be
  discovered as a bug in this feature.
- **No remote runner enrollment, no in-DASH agent builder, no hosted
  multi-tenant runtime, no multi-language Kit.** All four are MAR-428's explicit
  non-goals.
- **The MSIX protocol declaration has not been proven on a real install.**
  Installing and sideloading a package touches the certificate store, which is
  Henrik's step — see `docs/msix-test-signing.md`. The manifest content and its
  assertion are covered by tests; the end-to-end "click a link, DASH opens" on a
  packaged install is not, and is named here rather than assumed.
