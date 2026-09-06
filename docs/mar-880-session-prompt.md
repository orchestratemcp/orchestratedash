# Lane E — MAR-880: one failed poll must not settle a live judgement

Tier: Sonnet (bounded, decided design, pure-logic module with existing tests).
Read `ux-lanes-common.md` beside this file first.

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-ux880-s1`
Branch: `000henrik/mar-880-judgement-poll-retry` (from origin/master 0e52211)
Issue: MAR-880 (https://linear.app/martini-home/issue/MAR-880). The full
diagnosis, with file:line references, is in the issue description — it is
reproduced here because you have no Linear access:

> Judgement 4 on Proof Scout's brief settled 25 s after the press as
> `failure: "abandoned"` with `open_tx` set and `submit_tx` null (died in
> `opening`), while Studionet finalized that open transaction in 6 s. Budgets
> in `lib/genlayer/client.ts:60-63` are 300×2 s and 200×3 s, so no timeout can
> fire before ten minutes. `genlayer-js@1.1.8` `dist/index.js:1465` calls
> `client.getTransaction` on every poll with no try/catch over a transport
> built with `retryCount: 0` (`index.js:2425`) that throws on `data.error`,
> any fetch rejection, a non-JSON body, and viem's `TransactionNotFoundError`
> when `eth_getTransactionByHash` returns null for a just-sent hash.
> `lib/genlayer/adjudicate.ts:253-259` catches with a bare `catch` and returns
> `"abandoned"`; nothing is logged or bound. `brief_adjudications` deliberately
> has no error column (`lib/db.ts:2181-2184`).

Before writing code, confirm the diagnosis yourself by reading those lines
and `docs/adr/0033-*.md` (the budget and the `abandoned` semantics).

## Design (decided)

1. `lib/genlayer/client.ts`: do not call the library's recursive
   `waitForTransactionReceipt` for the whole wait. Implement DASH's own poll
   loop in `waitFinalized` over `client.getTransaction({hash})` (or keep
   using `waitForTransactionReceipt` with `retries: 0` per single poll —
   choose whichever keeps the existing tests' shape) so that **each poll**
   that throws is retried up to `POLL_RETRY_LIMIT = 5` times with a short
   backoff (`1s, 2s, 4s, 8s, 8s`) before counting as lost. The ACCEPTED then
   FINALIZED semantics, the decided-state early return for ACCEPTED, and the
   total budget (300×2 s to accepted, 200×3 s to finalized) stay exactly as
   documented; add the retry budget on top, bounded.
2. `lib/genlayer/adjudicate.ts`: the wait returns a typed failure instead of
   throwing into a bare catch: `"abandoned"` when the budget is exhausted and
   the chain still had the transaction on the last successful poll;
   `"network_lost"` (new `AdjudicationFailure` member) when the retry budget
   is exhausted on consecutive errors. Bind the error and log one line via an
   injected `log` dep (add to the deps object `electron/adjudicate-host.ts`
   already builds; tests inject a recorder):
   `[dash] judgement <commission_id> stopped in <stage>: <error message>`.
   Never write the network's text into the row.
3. `lib/copy/genlayer.ts`: a `network_lost` receipt headline + body in plain
   language ("DASH lost the connection to the network while it was watching
   this judgement. The judgement may still be running there. Ask for it to be
   judged again.") — enumerated wherever `abandoned`'s copy is enumerated so
   the plain-language gate sees it. The `judged_by_unknown` line stays.
4. Do not touch `lib/genlayer/record.ts` stage vocabulary, `lib/genlayer/receipt.ts`,
   `lib/db.ts`, the contract, or `app/**` beyond what `AdjudicationFailure`
   widening forces in `app/_components/digest.tsx` (a new case in the failure
   copy switch is fine — that file is otherwise owned by lane A / MAR-875;
   keep your edit to the failure-copy mapping only and say so in the handoff).

## Tests (fixture only, no network)

`tests/genlayer-*.test.ts` (find the existing adjudicate/client tests and
their fake chain/deps): (a) a poll that throws once then succeeds → verdict
lands, no failure; (b) six consecutive throws → `network_lost`, log line
written once with stage name; (c) budget exhaustion with the chain still
answering → `abandoned`; (d) copy for both failures passes `expectPlainLanguage`;
(e) `electron/adjudicate-host.ts` still compiles with the injected log.

## Ownership (write)

`lib/genlayer/client.ts`, `lib/genlayer/adjudicate.ts`, `lib/copy/genlayer.ts`,
`electron/adjudicate-host.ts`, `app/_components/digest.tsx` (failure-copy
mapping only), `tests/genlayer-*.test.ts`, `docs/mar-880-handoff.md`.

Wait for `%TEMP%\wt-ux880-s1-install.done` to exist before running anything
that needs `node_modules` (poll every 30 s; it is a `pnpm install --offline`).

Stop condition: PR open (`fix(mar-880): retry a failed judgement poll before
settling`), typecheck + focused + full tests green, handoff written. The
installed proof is the orchestrator's.
