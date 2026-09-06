# MAR-876 — DASH MCP interviews the person before it builds an agent

Client: Claude Code, `claude --model opus`. Worktree
`C:\Users\henri\AppData\Local\Temp\wt-ux876-s1`, branch
`000henrik/mar-876-builder-interview`, cut off `origin/master` at `0e52211`
and stacked on lane B's `d174d01` (MAR-878a). Lane B merged as PR #320 while
this ran, so `origin/master` was merged in at `ccfe220` — no rebase, no
force-push. PR targets `master`.

Lane F of the 2026-09-06 UX wave. Scope was `tools/dash-mcp/**` only. Nothing
in `app/`, `lib/`, `electron/` or OrchestrateKit-MCP was touched, no ADR, no
migration, no manifest schema change.

## What changed

Two tools in front of the existing three, and the skill that tells a host
assistant to use them.

### New: `tools/dash-mcp/src/interview.ts` (pure, no disk, no model)

The whole state machine, in `scaffold.ts`'s shape — it decides, it touches no
disk, the tests assert on what it returns.

- **Question order** is the issue's: `outcome` → `sources` → `result_format` →
  `trigger` → `autonomy` → `destination` → `cloud`. `cloud` is applicable only
  when `trigger === "daily"` or `destination === "discord"` — the issue's "ask
  cloud location only when relevant", made a predicate rather than a habit.
- **One or two at a time.** The only pair is `trigger` + `autonomy`
  (`PAIRED_WITH`), because "when does it run" and "what may it do alone" are
  the same subject from the person's side. Everything else is asked alone, and
  a test pins that no turn ever returns more than two.
- **Reading a full request** (`readOpening`) is an explicit phrase table and
  nothing else. **A question matched by two different values is left
  unanswered and returned in `ambiguous`.** This is the safety property of the
  whole file: this server holds no credential and reaches no provider
  (ADR 0032 decision 7), so it must not acquire an LLM call, and the honest
  substitute for understanding is refusing to guess.
- **Unsupported is derived, never accumulated** (`unsupportedFor`). A note kept
  from an answer that has since been changed would tell somebody they cannot
  have a thing they stopped asking for — which both the `back` and the
  change-an-answer cases would have produced. Deriving it means a changed
  answer changes the notes with it.
- **`mergeAnswers` drops answers to questions that stopped applying.** Moving
  from "once a day" back to "only when I ask" removes the `cloud` answer and
  the `trigger_time`, so stale state cannot reach the recap and describe
  something nobody agreed to.
- `readTime` uses `lib/schedule/plan.ts`'s **`isLocalTime`**, not a second
  parser: a time DASH's schedule store would refuse is discarded rather than
  carried into a recap.
- `parseSources` turns an answer into feed entries by rule. A bare address is
  read as RSS, and that assumption is **stated in the recap** rather than
  hidden. Only one source can be named by name (Hacker News, because its URL is
  already `TEMPLATE_SOURCES[0]` — a fact about this repository rather than a
  guess about the internet); anything else must arrive as an address, and a
  named site with no address becomes a `will_not_do` line saying so.
- `planFromDraft` builds the recap **and** the exact `dash_agent_scaffold`
  arguments. The recap's `route` is read out of `scaffoldManifest`'s own
  `planned_route` — see "Route matches telemetry" below.

### `tools/dash-mcp/src/agent-tools.ts`

`interviewAgent` and `planAgent` — the two things that need a disk (finding and
saving the draft) plus the `refuseStagingDirectory` guard every path argument
in this package passes. The draft is written on **every** call, including the
first, so resuming needs nothing but the id.

`readDraft` re-checks every value it reads back rather than casting, on
`lib/schedule/store.ts`'s argument: the file is on the user's own disk and a
value that would not have been accepted going in must not become an answer on
the strength of having been written once. A test hand-corrupts a draft and
asserts the bad values are dropped.

Draft location: `<project>/.dash/interview-<draft_id>.json`, inside the
directory the **caller** named. Never DASH's data directory, never an installed
agent folder.

### `tools/dash-mcp/src/server.ts`

`dash_agent_interview` and `dash_agent_plan` with their schemas, first in
`TOOLS` — a model choosing a tool reads that list top down, and the failure
this packet exists to prevent is scaffolding before anybody was asked anything.
`readAnswers` / `readAction` check arguments rather than casting them. The
interview's description carries the ordering rule and the no-credential promise
in the description itself, because that is the only text a model reads before
choosing; two tests pin both.

### `tools/dash-mcp/src/scaffold.ts`

One line: `BRIEF_COMPOSE_COMPONENT` is now exported, so the recap's route
sentences key off the same constants the route is built from. Nothing else in
this file changed; the manifest it emits is byte-for-byte what it was.

### Docs

- `skills/building-a-dash-agent/SKILL.md` — the loop is now six steps starting
  at the interview; a new `# Interviewing` section covers how to run one turn
  (`AskUserQuestion` with `options`/`default`, plain-text fallback, answers
  passed back **verbatim**), resuming, what to do with an `unsupported` entry
  (say all three fields — "DASH cannot do that" alone is the sentence that
  makes people give up), the recap, and **two worked transcripts**. The rest of
  the file is unchanged.
- `README.md` — the tools table, a "The interview" section, and the layout
  block.

### Tests

- `tests/interview.test.ts` (new, 27) — vague, fully specified, ambiguity,
  changed answer via `back`, direct overwrite, `reset`, a question that stopped
  applying, resume from the file alone, a corrupted draft, a refused draft id,
  a relative directory, every unsupported answer the questions offer, and the
  small readers (`readTime`, `deriveDisplayName`, `parseSources`).
- `tests/interview-plan.test.ts` (new, 14) — route ↔ manifest by value, the
  request actually scaffolding through `scaffoldAgent`, sources agreeing
  between recap and request, refusal while unanswered, intent-not-activation
  (`trigger.type` stays `"manual"` for somebody who asked for 7am), no
  scheduled step in the route, no credential anywhere in the draft, a named
  provider carried through, and the agents-root refusal.
- `tests/server.test.ts` — the "exactly the three tools" assertion is now five,
  in order (the invariant it protected — a closed, schema'd tool list — is
  kept); four new tests over the wire.

## Route matches telemetry, and the bug that proves it needed a mechanism

The acceptance criterion is that the recap's stated route is the
`planned_route` the manifest declares. `lib/analyze.ts` grades a run by
matching executed steps to that array by exact `component_id`, so a recap
describing the steps in its own words could promise something the telemetry
will later call drift.

`planFromDraft` therefore reads `scaffoldManifest(request).planned_route` and
maps each `component_id` to a sentence; `interview-plan.test.ts` compares the
two by value.

The first version of the sentence map keyed off `feed_fetch` and `digest_write`
— retyped by hand. The real ids are `public_feed_fetch` and `local_file_write`
(`lib/agent-sources.ts`'s `FEED_FETCH_COMPONENT` / `DIGEST_WRITE_COMPONENT`),
so **two of the three steps silently fell back to "A step this agent runs."** A
fixture test asserting each sentence was over 20 characters passed over it; the
hand-driven server session is what showed it. The map is now keyed off the
constants, the fallback is exported as `UNDESCRIBED_STEP`, and the test asserts
it never appears and that the three sentences are distinct.

That is the same class as `lib/agent-sources.ts`'s own warning about restating
a registry id, and it is worth carrying: a recap that keeps working and stops
saying anything is not visible from inside the fixtures.

## Verified, and how

All from PowerShell, in the worktree, after merging `origin/master` (`ccfe220`).

- `pnpm typecheck` — clean, exit 0.
- `pnpm vitest run tools/dash-mcp/tests` — **10 files, 144 tests, all passed**
  (7 pre-existing, 1 from lane B, 2 new).
- `pnpm test` (whole suite, once) — exit 0:

  ```
   Test Files  270 passed (270)
        Tests  5087 passed | 13 skipped (5100)
     Duration  88.35s
  ```

  No failures at all this run. `template-run.test.ts`'s known EPERM cleanup
  flake did fire on one earlier focused run of `tools/dash-mcp/tests` (5 of 11
  tests, `EPERM ... rmSync` racing a live child) and passed 11/11 immediately
  when re-run alone — the shape MAR-878a's handoff and MEMORY's "EPERM on temp
  cleanup is a live child" both describe. That file was not modified here.

- **A real MCP server, driven by hand over stdio.** `node
  tools/dash-mcp/launch.mjs` with `DASH_DATA_DIR` and the project directory
  both under a scratch root, spoken to with newline-delimited JSON-RPC, exactly
  as Claude Code would. Both transcripts below are that server's actual output,
  not a fixture. It also found the route bug above and a second one (the derived
  name for the fully specified request was "Every morning at 7 read", because
  the temporal clause people lead with was not being stripped — fixed, with a
  test naming the sentence that produced it).

## The two worked transcripts

Both are the real server. `ASKS` / `CANNOT` lines are the tool's own output.

### Vague: "keep an eye on AI news for me"

```
TOOLS: dash_agent_interview, dash_agent_plan, dash_agent_scaffold, dash_agent_validate, dash_agent_install

> dash_agent_interview (start)
  ASKS  [outcome] In your own words, what do you want this agent to keep an eye on for you?
        why: Everything else can usually be read out of this answer, so the fuller it is the fewer questions there are.
  ready: false

> dash_agent_interview outcome="keep an eye on AI news for me"
  ASKS  [sources] Which sites should it read? Paste their feed addresses, one per line. Answer "the usual" to start with the Hacker News front page.
        why: This agent reads addresses you give it. It cannot search for a site or browse one that has no feed.
  ready: false

> dash_agent_interview sources="the usual"
  ASKS  [result_format] What should it hand you after each run?
        - A roundup of everything it found, plus a short summary that cites it (default)
        - A written document or report file, like a Word file or a PDF (NOT SUPPORTED)
        - A spreadsheet or a CSV (NOT SUPPORTED)
  ready: false

> dash_agent_interview result_format="roundup_and_summary"
  ASKS  [trigger] When should it run?
        why: A new agent always starts idle and runs when you press Run. Anything else is written down as what you wanted and switched on by you afterwards.
        - Only when I ask it to (default)
        - Once a day, at a time I choose
        - Every hour, or every few hours (NOT SUPPORTED)
        - Once a week (NOT SUPPORTED)
        - Whenever something happens somewhere else (NOT SUPPORTED)
  ASKS  [autonomy] And how much should it do on its own?
        - Just collect it and show me. I will decide what to do (default)
        - Do things for me, but ask me first (NOT SUPPORTED)
        - Act on it without asking (NOT SUPPORTED)
  ready: false

> dash_agent_interview trigger="manual" autonomy="tell_me"
  ASKS  [destination] Where do you want to see the results?
        why: Two of these work today. The rest are things DASH cannot send to, and the answer says what to use instead.
        - On this agent's page in DASH (default)
        - As a file saved in the agent's own folder
        - As a Discord message
        - In Slack (NOT SUPPORTED)
        - By email (NOT SUPPORTED)
        - Posted somewhere public (NOT SUPPORTED)
  ready: false

> dash_agent_interview destination="slack"
  CANNOT Sending results to Slack
        DASH has no Slack connection. Nothing it holds can send a message there.
        instead: A Discord message, once you connect Discord under Settings, or the results on the agent's own page in DASH.
  ready: true

> dash_agent_interview action=back
  ASKS  [destination] Where do you want to see the results?
        ...
  ready: false

> dash_agent_interview destination="dash"
  ready: true

> dash_agent_plan draft_id=draft-c243b064
{
  "name": "AI news",
  "agent_id": "ai-news",
  "summary": "Reads Hacker News front page and writes a roundup of what it found with a short summary of it.",
  "collects": ["Hacker News front page"],
  "how_often": "Only when you press Run. It never starts by itself.",
  "where_results_go": "On this agent's page in DASH, where the roundup, the summary and every item it found are shown.",
  "will_not_do": [
    "It starts idle. Nothing runs until you press Run in DASH.",
    "It reads the addresses you gave it and writes inside its own folder. It reaches nothing else and changes nothing anywhere."
  ],
  "route": [
    { "step": 1, "component_id": "public_feed_fetch", "does": "Reads each of the sources you listed." },
    { "step": 2, "component_id": "brief_compose", "does": "Writes a short summary of what came in, citing the items it is talking about." },
    { "step": 3, "component_id": "local_file_write", "does": "Saves the whole roundup, with every item's own address kept." }
  ],
  "model_provider": "openrouter",
  "model_provider_note": "This is only which provider the agent's optional model connection names, so the same key can cover it. No key is asked for here and none is stored. You hand it one in DASH, or not at all."
}

> dash_agent_scaffold (the request exactly as it stands)
{ "ok": true, "agent": "ai-news", "manifest_valid": true,
  "files": ["agent.manifest.json","package.json","agent.mjs","brief-fingerprint.mjs",
            "scripts/open-in-dash.mjs","sources.json","README.md",".gitignore"] }
```

Six questions for eight words, one of which prevented an agent that was never
going to reach Slack, and `back` un-answered the Slack choice cleanly — the
`unsupported` note disappeared with it, because it is derived.

### Fully specified

> Every morning at 7, read the Hacker News front page and
> https://techcrunch.com/feed/ and give me a roundup with a short summary.
> Alert me in Discord.

```
> dash_agent_interview outcome="Every morning at 7, read the Hacker News front page and https://techcrunch.com/feed/ and give me a roundup with a short summary. Alert me in Discord."
  ASKS  [autonomy] And how much should it do on its own?
  ready: false

> dash_agent_interview autonomy="tell_me"
  ASKS  [cloud] Should it keep working while this computer is off?
        why: You asked for something that happens while you are not watching, so it matters where the agent lives.
        - This computer is fine. Nothing runs while it is off (default)
        - It should run on a server, all the time (NOT SUPPORTED)
  ready: false

> dash_agent_interview cloud="this_computer"
  ready: true

> dash_agent_plan draft_id=draft-4ed713d9
{
  "name": "Hacker News front page",
  "agent_id": "hacker-news-front-page",
  "summary": "Reads Techcrunch and Hacker News front page and writes a roundup of what it found with a short summary of it. You asked for it once a day, which you switch on in DASH after its first run.",
  "collects": ["Techcrunch", "Hacker News front page"],
  "how_often": "You asked for once a day at 07:00. It is built to run only when you press Run, and that daily time is written down as what you wanted. You switch the schedule on in DASH yourself, after you have seen a run work.",
  "where_results_go": "On this agent's page in DASH. To get a Discord message as well, connect Discord under Settings once the agent is added; the agent itself sends nothing.",
  "will_not_do": [
    "It starts idle. Nothing runs until you press Run in DASH.",
    "It reads the addresses you gave it and writes inside its own folder. It reaches nothing else and changes nothing anywhere."
  ],
  "route": [ ...same three steps... ]
}

> scaffold_request
{ "directory": "...", "name": "hacker-news-front-page", "display_name": "Hacker News front page",
  "summary": "...", "sources": [
    { "name": "Techcrunch", "url": "https://techcrunch.com/feed/", "format": "rss" },
    { "name": "Hacker News front page", "url": "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20", "format": "hn_algolia" } ] }

> dash_agent_scaffold (the request exactly as it stands)
{ "ok": true, "agent": "hacker-news-front-page", "manifest_valid": true, "files": [ ...eight... ] }
```

Two questions instead of six. Both sources, the 07:00 daily trigger, the result
shape and Discord were all read out of the one sentence; `autonomy` and `cloud`
are what it did not say.

One variant worth recording: an opening ending **"Post it to Slack"** matches
both `slack` and `post` in the phrase table, so `destination` comes back in
`ambiguous` and is asked rather than decided. That is the design working, and
it is why the sentence above says "Alert me in Discord".

## What is NOT done

- **No host-side transcript.** Nobody ran a real Claude Code session with the
  plugin installed and answered these questions through `AskUserQuestion`. The
  skill tells the assistant how; whether it does is the orchestrator's proof.
- **No DASH import or first-run proof.** No agent built from an interview was
  imported into a running DASH, connected to a requirement, or manually run.
  That is the packet's stated orchestrator evidence.
- **No installed-runtime proof of anything.** `pnpm verify`, `pnpm shell`,
  `pnpm shell:smoke` and any Electron launch were deliberately not run; the
  real store was never touched.
- The interview is not offered anywhere in DASH's own UI. It is a tool a coding
  assistant holds (ADR 0032 decision 7), and nothing in `app/` changed.
- No schedule-activation path was built. "Switch the daily run on in DASH after
  the first run" is a sentence in a recap; whether that surface is easy to find
  is somebody else's packet.

## Surprises and contradictions

1. **The route sentences were silently wrong and the fixtures were happy.**
   See "Route matches telemetry" above. Worth generalising: any map from a
   registry id to prose in this repository should be keyed off the exported
   constant, and any test over it should assert the fallback is unused rather
   than that the string is long.

2. **`result_format` is a question with one supported answer.** That looks like
   a fake question and is not: the two unsupported options (a document, a
   spreadsheet) are how somebody learns, in ten seconds, that DASH agents do
   not write files for them — which is a thing Henrik has hit before ("DASH
   cannot write a document"). The same shape carries `autonomy` and `cloud`.
   If a later packet gives the template a second real output shape, this
   question already has somewhere to put it.

3. **DASH's schedule vocabulary is narrower than people's.**
   `lib/schedule/plan.ts`'s `ScheduleKind` is `"daily"` and nothing else, so
   "every hour" and "once a week" are both genuinely unsupported and both
   named. If a weekly or hourly kind ever lands, `unsupportedFor` and the
   `trigger` options are the two places to change, and nothing else.

4. **Discord is reachable but not by the agent.** `lib/notify/discord.ts` is
   DASH's sender, in the runner, not in the agent — so "alert me in Discord" is
   supported as a *DASH* setting and unsupported as an *agent step*. The recap
   draws that line explicitly ("the agent itself sends nothing"), because the
   version that just said "yes, Discord" would have been true and misleading.

5. **`answers` values are all strings, including `sources`.** A list of feeds
   is stored as the text a person typed (or, when read out of an opening
   sentence, as the *serialised reading* of it — `Name - url` lines, not the
   sentence). Storing the sentence was the first version and it was wrong: the
   recap re-parses `answers.sources` at plan time, and re-parsing prose reported
   every non-source clause ("every morning at 7") as a source it could not
   reach.

## Evidence class

**Fixture tests plus a hand-driven real MCP server.** The 41 new tests run the
state machine, the draft file and the plan over a real disk with a scratch
`DASH_DATA_DIR`, and one of them scaffolds the plan's own request through
`scaffoldAgent` so DASH's real `verdictForManifest` judges it twice. The two
transcripts above are `node tools/dash-mcp/launch.mjs` answering JSON-RPC on
stdin, which is the same process Claude Code spawns.

**Not** a host-side proof: no Claude Code session used the skill. **Not** an
installed-runtime proof: nothing was imported into DASH, no agent ran, no
schedule was switched on, no Discord message was sent. Both are the
orchestrator's per the packet.

## The one thing the next session should do first

Install the plugin in a real Claude Code session and say *"build me something
that keeps an eye on AI news"* — then watch whether the assistant calls
`dash_agent_interview` **first** or goes straight to `dash_agent_scaffold`. The
whole packet rests on a tool description and a skill persuading a model to ask
before it builds, and that is the one property no test in this repository can
check. If it skips the interview, the fix is in `server.ts`'s tool descriptions
(the interview's already says "Call this FIRST"), not in `interview.ts`.

Second, if it does interview: carry it through to `dash_agent_install`, press
Add in DASH, and confirm the agent imports, stays idle, shows its
`model_provider` requirement, and completes one manual run — which is the
acceptance clause this packet could not reach.

## Needs orchestrator

- **Nothing outside `tools/dash-mcp/**` was needed.** The design fitted the
  lane's ownership exactly; no file outside it was edited or wanted.
- `origin/master` moved to `ccfe220` mid-lane (lane B's #320 among others) and
  was merged in, not rebased. Head after merge is `23d049b` plus the handoff
  commit.
- Linear was not touched, per the lane's rules. MAR-876's lifecycle is
  `merged` when this PR is green; it is **not** `proven` until the two things
  above happen in a real session and a real DASH.
