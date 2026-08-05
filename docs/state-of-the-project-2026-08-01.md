# State of the Project — 2026-08-01

Everything below was verified today on this machine, not recalled. Written to be
handed to a second model (Sol / Claude) for cross-review.

> **Corrected after cross-review (same day).** The first version of this
> document trusted Linear status and a stale README line over Git, and was
> wrong about MAR-426 and MAR-433 — both implementations are merged
> (`exportBuildBrief.ts` emits manifest v2 with pinned schema tests;
> `a527585`/#21 routes runner telemetry with a 323-line test file). The
> README's "runs are not visible yet" caveat was written at 11:38 on
> 2026-07-29 and the fix merged at 19:33 the same day; the caveat was never
> removed. Corrections are applied inline below and marked. The lesson is
> §8's argument made concrete: Git is implementation truth; Linear records
> intent; neither README claims nor issue status substitute for either.
> One distinction this document keeps that the cross-review blurred:
> **merged ≠ proven on the installed app.** MAR-433's code is merged and
> unit-tested; no live installed-app run has ever displayed runner-hosted
> telemetry, because the only real attempt died earlier, at registration
> (MAR-453). Three states, not two: planned → merged → proven.

---

## 1. Test results — all four repos

| Repo | Result | Notes |
| --- | --- | --- |
| orchestratedash | **green** — `pnpm verify` exit 0 (tsc + 1600+ tests) | Run from PowerShell (Git Bash fakes 5 channel-secret failures) |
| orchestratekit-mcp | **green with flakes** — 2036/2041; the 5 "failures" all pass in isolation | Timeout flakes under full parallel load; memory note saved so nobody chases them again |
| orchestratelab | **green** — 529/529 in 52 files | |
| orchestrateweb | not re-run (last commit MAR-359 cleared rules:check debt; deployed) | |

Git is clean everywhere except: untracked `.claude/` in dash (deliberate),
line-ending-only noise on `tests/fixtures/matcher-corpus.json` in MCP,
untracked steward briefings + QA screenshots in lab/web (harmless, but decide:
commit or gitignore).

**The headline test finding is not a test result.** DASH's 1635 vitest tests
were green while three shipped defects made the credential prompt physically
unable to open (MAR-454). The unit suite cannot see the Electron main process.
Until `pnpm shell:smoke` runs automatically, "verify is green" means less than
it appears to. This is the single most important engineering-hygiene fix.

---

## 2. Live proof: agent → DASH communication works

The user-visible loop was exercised end to end today with the canonical
`ai-agent-news` agent (no new agent needed — it already exists, is real, and
needs zero credentials):

1. Dev server started; manifest registered via `POST /api/agents` → `{"ok":true}`.
2. `node agent.mjs --once` with `DASH_INGEST_URL` pointed at DASH.
3. Agent fetched Google News RSS (100), Hacker News/Algolia (40), arXiv (30),
   filtered, wrote `reports/latest.md` — **74 new stories**.
4. DASH ingested 5 telemetry events, reconstructed the run, and judged it:
   `executed_route: news_fetch → news_filter → local_file_write`, drift [],
   gate_violations [], **compliant: true**.
5. The Runs page shows it as **"matches plan · completed · 5 events"**, one row
   above the demo gate-violation run — which is exactly the product thesis on
   one screen: same table, one agent honest, one agent caught.

Caveats that keep us honest:

- This proves the **web/dev path** (browser DASH, HTTP ingest). The **shell
  path** for the same agent is still broken by MAR-453: the handoff prompt sat
  unanswered, expired silently, left zero ledger rows — the installed app's
  store has **0 agents** today. The flow that failed is the flagship
  zero-file-picker flow.
- MAR-433 (runner-hosted telemetry never reaches DASH) is still open, so an
  agent the *runner* starts is invisible in Runs even when registration works.

---

## 3. DASH — roadmap, pipeline, biggest challenges

### Where the roadmap actually is

Done and real: contracts (telemetry v1 frozen, Agent DOM v2), local app with
SQLite + OS-vault credentials, Electron shell that runs, detached Agent Runner
with its own DB/audit/credential, agent-kit + `open-in-dash` handoff, Google
OAuth loopback+PKCE (MAR-446), store-damage survival (MAR-449), packaged
renderer (MAR-432), MSIX packaging proof.

The open Wave-0 pipeline, in dependency order:

1. **MAR-453 (Urgent)** — handoff prompt can wait forever, no ledger trace.
   The one that actually ate a real registration on a real machine.
2. **MAR-451 / MAR-452** — stale runner adopted forever; "stop runner" is
   `TerminateProcess` on the process holding SQLite open (the plausible cause
   of the original store corruption).
3. **MAR-454** — make the shell smoke run automatically (or make `verify`
   refuse to claim victory without it). This is the fix that prevents the
   next batch of MAR-449/450/453s.
4. **MAR-433** — *corrected:* the implementation merged in #21 (`a527585`,
   runner→DASH forwarding with tests). What remains is the proof on the
   installed app — which has never been observed live, and belongs in the
   MAR-454 smoke rather than in a reopened feature ticket. Linear status
   (Backlog) and the README caveat are both stale.
5. **MAR-363 (Urgent, In Progress, blocks MAR-355)** — the recorded demo.
   LAB's Chief has ranked "unblock MAR-363" the #1 decision. It is also 3 days
   stale. Everything above it is *for* this.

### The biggest challenge, named plainly

**The distance between "tests green" and "a novice succeeded" is where every
recent defect lived.** Store damage, protocol-handler theft, the eternal
prompt, the credential window that never opened — none were visible in vitest,
all were visible the moment someone used the installed app. The defect batch
from 2026-07-31/08-01 is actually excellent news: the honest-proof culture is
finding them *before* launch. But it means Wave-0's critical path is
reliability-of-the-first-run, not features.

### UI/UX read (from today's session)

The copy system is genuinely differentiated. The Connection Center reads:
"DASH holds these in this computer's credential vault and passes them to the
agent when it runs" / "declared · not connected yet" / "owner unknown — DASH
will ask" / "1 imported agent uses a v1 manifest, which cannot declare
connections: DASH does not guess what they need." No competitor writes like
this. The calm-default / density-opt-in decision and the tested
no-raw-identifier rule are holding on the guided path.

Still open on the design side (all filed, all Wave-1): app chrome (MAR-440),
splash (MAR-436), Command Center density view (MAR-420), artifacts panel
(MAR-434), The O's avatars (MAR-435). Henrik's design ideas live in these five
— they are coherent as a set and should be scheduled as one design pass rather
than five drive-bys.

---

## 4. OAuth — the honest assessment ("it says we need to pay")

### What the message actually is

Nobody has to pay to make OAuth *work*. The cost lives in one specific place:
**whose OAuth client ID is on Google's consent screen.** Gmail scopes
(`gmail.readonly`, `gmail.compose`) are *restricted* scopes. Google requires
the app that requests them to pass verification — privacy policy, verified
domain, demo video, and for restricted scopes a **CASA security assessment
(~$500+/yr, annual)**. That applies to the *client ID owner*, not to the code.
DASH's flow (loopback + PKCE + system browser + refresh token in the OS vault)
is already the correct, compliant architecture; Amendment 8 in ADR 0001
documents it.

### Why "I logged into DASH with Google" doesn't solve it

There is no DASH account (MAR-447, deliberately deferred), and even if there
were: sign-in (`openid email`) and API scopes (Gmail read) are separate grants
under separate verification regimes. Claude's Gmail connector works because
**Anthropic** owns a verified client and paid that cost. Someone always owns
the consent screen; the only question is who.

### The four real options

| Option | Recurring cost to us | Friction for user | Status |
| --- | --- | --- | --- |
| **A. Bring-your-own client ID** (user makes a free Google Cloud project, Testing mode) | $0 | High (one-time, ~10 min, scary console) | **Shipped** (MAR-446) — this is the decided path |
| **B. Our verified `dash_managed` client** | ~$500+/yr + re-assessment | Lowest | Deferred until revenue — same code path, so nothing is wasted |
| **C. Gmail/other MCP server as a declared connection kind** | $0 | Medium — user configures an MCP server the agent talks to | **MAR-438** — not built. The agent declares `kind: mcp`, the server owns auth |
| **D. Agent-managed** (agent does its own OAuth, e.g. via an existing tool's client) | $0 | Depends on the tool | Already supported in the contract |

Two honest gaps in Option A that should be written into the Connection Center
copy *before* a user hits them:

1. **Testing-mode refresh tokens expire after ~7 days** for external apps.
   The user will be silently signed out weekly and DASH should say why and
   offer reconnect in one click — otherwise this becomes a recurring "DASH is
   broken" impression. (Publishing the user's own app to Production without
   restricted-scope verification is not an escape hatch for Gmail scopes.)
2. **The guided path for creating the client doesn't exist yet.** Option A is
   only viable for novices if DASH walks them through the Cloud Console with
   screenshots and validates the pasted client ID. That is a UX ticket, not an
   auth ticket, and it is currently nobody's issue. → Suggest filing DASH-37:
   "BYO Google client: guided creation + weekly-expiry honesty."

### Recommendation

Stay on A as decided; make the two gaps above explicit UX work; treat **C
(MAR-438) as the strategic move** — it converts "DASH must solve every
provider's OAuth" into "DASH can watch any agent that talks to any MCP
server", which is also the OpenClaw/Hermes-watching play (MAR-443). B waits
for revenue, exactly per the standing constraint.

---

## 5. MCP — new standard, and UX/UI of the planning surface

### Protocol adoption: done, quietly ahead of schedule

- `#143` migrated to `@modelcontextprotocol` v2 packages (no wire change).
- `#144` serves **protocol revision 2026-07-28 alongside the 2025 era** —
  stateless core, the OAuth 2.1 tightening, versioned extensions. The server
  answers both eras.
- `health_check` today: 65 components, 156 edges, 12 playbooks, 12 routes,
  0 untested edges, 0 stale, `safe_to_demo: true`, fingerprints match release.
- Remaining: MAR-448 (follow the ecosystem's stateless cutover — mostly
  watching), and nothing else blocking.

This matters externally: the news cycle is full of "MCP goes stateless" and an
agent-security panic (OpenAI's escaped-agent story). We are *already serving
the new revision* — that is a credible public claim for the site and the demo.

### Planning UX: strong shape, two real findings (filed today)

The card-first flow works as designed: one-screen card, question rounds,
`hidden_when` coherence, honest availability labels, DASH runner reachable as
a `build_surface` option with correct offline semantics (MAR-427 delivered).
Grounding discipline (🟢 registry vs 🔵 suggestion, "the reading agent MUST NOT
present its own elaborations as registry-derived") remains the differentiator.

But a live test with the most natural first-agent goal ("watch public news
feeds, write me a daily digest file on my computer") produced:

- **MAR-455** — the plan demands **Firecrawl** (paid tier gotchas, secret
  manager advisory) for sources that answer an anonymous GET. Our own proven
  sample agent needs zero credentials for the identical goal. Registry gap:
  a `public_feed_fetch` component.
- **MAR-456** — the starred recommendation was **"Self-host hosted — needs a
  deploy, secrets and a bill"** even though the plan's own requirements said
  `must_run_while_computer_off: false` and the output is a local file. The
  DASH runner was present but not recommended in the one scenario that is its
  home turf. MAR-427 said "reachable *recommended* path" — recommended isn't
  done.

Both violate the $0-first constraint at the exact moment a novice clicks the
starred option. Small fixes, big first-impression leverage.

---

## 6. DASH × MCP — how prepared are we to build seamless agents?

The chain today: `plan_workflow` → `export_build_brief` (*corrected:* MAR-426
is **implemented and merged** — it emits a deterministic `agent.manifest.json`
conforming to dash's manifest-v2 schema, with pinned schema tests; Linear's
"Todo" is stale) → agent-kit scaffold → `open-in-dash` handoff → runner hosts
→ telemetry → plan-vs-actual verdict.

What's proven: contract compatibility end to end (the scaffolded agent's
manifest validates, its events reconstruct, `analyzeRun` judges against the
plan), and the planner already emits DASH's own observability env names
(`DASH_INGEST_URL` / `DASH_INGEST_TOKEN`) in every plan.

What's broken/missing, in order of pain (*corrected*):

1. **MAR-453 + the installed-app proof gap** — the last mile. Contract
   compatibility is done end to end; what no machine has ever witnessed is a
   handoff-registered agent's runner-hosted run appearing in the installed
   app's Runs page. One MAR-454-gated smoke covering that journey retires the
   whole class.
2. **MAR-438/439** — agents *reaching* MCP servers as a connection kind, and
   DASH *exposing* its agents as an MCP server. These two turn DASH from "a
   dashboard for our kit's agents" into "the supervision layer for the MCP
   ecosystem". Post-launch, but they are the moat.

Verdict (*corrected*): the browser happy path is **done**; the installed app
is a reliability-and-proof problem (MAR-453/451/452/454), not a contract
problem.

---

## 7. LAB — is the flywheel turning?

The *machinery* is turning; the *learning* has stalled (*sharpened after
cross-review*). Checked directly in `data/lab.db` today: no new rated
sessions since **2026-07-21** (11 days), and `chief_filed_issues` is **0** —
no Chief suggestion has ever been promoted through the DB workflow. Nightly
reports run on schedule, but the flywheel's input is sessions and its output
is filed decisions, and both ends are currently still. Details:

- **Chief report 2026-08-01** (this morning): all four sources current —
  flywheel current, journey **pass**, briefing current, Linear read 65 open
  issues. 8 ranked decisions, nothing auto-filed, LLM skipped → **$0 cost**,
  consistent with the standing constraint.
- 187 sessions, all rated. Route scores 52–75 recently.
- **Top decision:** unblock MAR-363 (the demo). #2/#3: MAR-380, MAR-426.
  The deterministic Chief and this analysis independently agree — that is the
  flywheel working.
- **Debt worth acting on:** rank-8 hygiene — 1 low-rated session shape
  (the repeated "watch my inbox for invoices and pay them" prompt, rated 2)
  has **no durable corpus contract**, so the same bad UX can silently return.
  Small, fully-specified fix; do it next LAB session.
- Two stale P2s (MAR-326, MAR-329, 25 days) need a close/re-scope decision —
  they are queue noise now.
- Housekeeping: `briefings/steward/*.md` are untracked in git — decide commit
  vs gitignore so the repo state stops looking dirty.

---

## 8. Codex ↔ Claude shared memory — proposal (not implemented)

Per the propose-first rule, this is a design, not a change.

**Problem:** Claude Code has auto-memory (13 files, this project only). Codex
reads `AGENTS.md`. LAB has an `AGENTS.md`; **dash and mcp have neither** — so
Codex starts cold in the two most active repos, and decisions live in three
places (Claude memory, Linear, ADRs) with no shared index.

**Proposal — "the repo is the shared brain", three layers:**

1. **Per-repo `AGENTS.md`** (committed, canonical, works for both models —
   Claude Code reads AGENTS.md too). Contents: the rules that are currently
   only in Claude's memory but are really *repo facts* — run verify from
   PowerShell; never force-kill Electron; port 3000 belongs to Lab; smoke
   needs the app closed; where the canonical test agent lives; UX-first and
   $0-first as standing constraints; **"decisions go to Linear, session
   evidence goes to the issue"**. A `CLAUDE.md` that says "Read AGENTS.md" —
   nothing else — so neither file drifts.
2. **Linear as the decision ledger** (already working — today's MAR-449–456
   descriptions are exactly the right genre: evidence, why, what to decide).
   Add one convention both models follow: every session ends by writing
   *evidence and decisions* into the issue it worked, and any cross-repo
   decision gets an ADR amendment (dash already does this well).
3. **Claude private memory stays for Claude-specific operational quirks**
   (tool-level things like "the Bash tool's whoami breaks tests" are
   meaningless to Codex).

Cost: ~1 session to write two AGENTS.md files by promoting existing memory.
No new tools, no sync jobs, nothing recurring. The failure mode it prevents:
Codex force-killing Electron and corrupting the store again — that rule
currently exists only where Codex cannot see it.

---

## 9. Unique angles worth leaning into

1. **"One agent honest, one agent caught" is the demo.** Today's Runs page —
   ai-agent-news "matches plan" directly above the gate-violation demo — is
   the whole pitch on one screen. Put it in MAR-363's script exactly like that.
2. **Plan-vs-actual is structurally uncopyable** by generic dashboards: it
   requires a planner that produced a deterministic, registry-grounded plan.
   OpenClaw/Hermes execute; nobody else can *judge* a run against a plan.
   Keep saying this sentence.
3. **The timing gift:** the news cycle is "agents escaped containment" +
   "MCP goes stateless". We ship: supervision, approval gates, audit trails,
   already serving the new MCP revision. The site should say this within a
   week while it's hot — it costs $0.
4. **The copy system as a product feature.** Plain-language consent
   ("Read meeting requests and save reply drafts" instead of scope URIs),
   enforced by tests, is a trust surface no competitor has. The BYO-OAuth
   guided path (DASH-37 proposal) should be written in the same voice.
5. **MCP-server connections (MAR-438) as the OAuth escape hatch** — and
   simultaneously the bridge that lets DASH watch OpenClaw/Hermes agents
   (MAR-443). One ticket, two strategic wins.
6. **The honesty culture is a marketing asset**, not just hygiene. "Our test
   harness found three shipped defects and we filed them in public detail" is
   a launch-week blog post that separates DASH from every agent product that
   claims perfection.

## 10. Linear — what I changed today, and the suggested rebase

Changed (all reversible): MAR-448–454 were floating without a project → all
attached to **OrchestrateKit & OrchestrateLab** with `dash-contract` /
`merge:human-gated` labels (wave-0 on MAR-453/454). Filed **MAR-455** and
**MAR-456** from live findings.

Suggested (needs your call, not done):

- **Close or re-scope** MAR-326 and MAR-329 (25 days stale, P2 — Chief flags
  them every night).
- The "Trading Strategy Research Bot" project is untouched since 2026-07-03 —
  park it explicitly (state: Paused) so the project list reflects reality.
- Consider a **"DASH Wave-0 hardening" milestone** grouping MAR-453, 451, 452,
  454, 433, 450 — they are one story ("the first run must survive") and
  reviewing them as one is how they should be scheduled.
- File **DASH-37** (BYO OAuth guided path + 7-day expiry honesty) per §4.

## 11. Suggested road ahead (ordered, with reasons)

1. **MAR-453** — the eternal prompt. Urgent, actually bit a real user (you),
   blocks the flagship flow. Small, well-specified.
2. **MAR-454** — automate the shell smoke. Prevents the whole defect class;
   everything after this is trustworthy again.
3. **MAR-451 + 452 together** — runner freshness + graceful stop. One session;
   452's hard-kill is the likely corruption mechanism, 451 is why it never
   gets stopped.
4. **MAR-433** — runner telemetry into DASH. After this, the *installed app*
   shows the news agent working, and the session ritual ("launch it and look
   at it") is finally satisfiable in the real product.
5. *(corrected — MAR-426 is merged; this step is now:)* **Reconcile Linear
   with Git** — mark MAR-426/432/448 Done, close or re-scope MAR-428/433/450
   with their proof gaps pointed at the MAR-454 smoke, so LAB's Chief stops
   ranking shipped work as blockers.
6. **MAR-363** — record the demo. Everything above exists to make this
   honest. LAB has ranked it #1 for a reason.
7. Then Wave-1 opens with the design pass (MAR-440/436/420/434/435 as one
   coherent effort) and MAR-438 (MCP connections) as the strategic feature.
8. Ongoing, cheap: MAR-455/456 (one registry + one policy fix), the LAB
   corpus-contract debt, the two stale P2 decisions, AGENTS.md per §8.

**What did not change on screen today** (session ritual): the dev server is
running with ai-agent-news registered and one compliant run visible under
Runs; the installed shell still shows zero agents until MAR-453 lands — that
is the gap between the two stores, and closing it is step 1 above.
