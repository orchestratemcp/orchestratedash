# Lane F5 — Stage 5: portable agent packages and passive ProofPacks with a standalone verifier

Tier: Opus (a file format with integrity semantics, a verifier that must not
trust its own input, and an import that must stay inert). Read
`ux-lanes-common.md` first; base is `codex/agent-foundation` after stages
1–3 merged (the orchestrator tells you the SHA at dispatch). No Linear id
exists for this stage (workspace limit) — refer to it as "MAR-886 stage 5".
Plan: `C:\Users\henri\Documents\DASH-agent-foundation-claude-plan.md`
"Etapp 5" (Swedish; acceptance repeated below) and the stage-8 dossier's
`docs/funding/security-and-operations.md` + `walrus-brief.md` (what the
dossier promised the format would be — read, do not over-promise back).

Worktree: `C:\Users\henri\AppData\Local\Temp\wt-f5-s1`
Branch: `000henrik/mar-886-proofpack`. PR targets `master`.

## Ground truth (verify)

- The agent folder is the unit of storage (ADR 0008): DASH keeps its own copy
  under `<dataDir>/agents/<id>/` with `code/`, the manifest, and per-run
  artifacts (`run_artifacts` table + files; `lib/agent-dom/artifact-bytes.ts`
  hashes artifact bytes; `lib/agent-dom/evidence.ts`). Runs and events in
  `runs` / `events` (`lib/db.ts`), spans in `run_spans` after stage 3.
  Grants/admissions/secrets live in `connection_secrets` / the vault
  (`lib/secret-refs.ts`, `lib/vault*`), broker audit in `broker_audit`.
- Folder import already exists (`lib/folder-import.ts`, `electron/folder-import.ts`,
  consent dialog, "imports stay idle"); `lib/folder-bundle.ts` /
  `tests/folder-bundle.test.ts` may already do packaging — read them first
  and build on them rather than beside them.
- The brief ↔ digest binding uses a canonical JSON + SHA-256 fingerprint
  (`lib/brief/fingerprint.ts`, `dash-agent-sdk.mjs` `canonicaliseItems` /
  `fingerprintItems`); GenLayer adjudication records (`lib/genlayer/record.ts`)
  carry tx hashes that a ProofPack can cite as external references.
- Dependencies allowed: node builtins (`node:crypto` SHA-256, Ed25519 via
  `crypto.sign`/`verify` with `ed25519` keys, `node:zlib`, `node:fs`) — no
  new npm dependency for the verifier; if a canonicalisation standard needs a
  library, prefer implementing RFC 8785 (JCS) in a small pure module with the
  RFC's test vectors over adding a dependency, and say which.

## Design (orchestrator decision)

1. **Two artefacts, one manifest format.** `dash-agent-package/1`
   (runnable export: definition, `code/` files, `agent.recipe.json`,
   `sdk_version`, selected artifacts, run evidence) and `dash-proofpack/1`
   (passive: definition summary, selected artifacts, run events + spans for
   the selected runs, artifact hashes, external references such as a
   GenLayer receipt — NO agent code, nothing executable). Both are a
   directory-or-zip with a single `MANIFEST.json` listing every file with
   `sha256` and byte size, canonicalised with JCS (RFC 8785), and a
   top-level `digest` = SHA-256 over the canonical manifest bytes. Filenames
   are NFC-normalised, forward-slash, relative, no `..`, no absolute, no
   symlinks; file order in the manifest is sorted bytewise; encoding UTF-8.
   Test vectors under `tests/fixtures/proofpack/` including the RFC 8785
   vectors and one pack whose digest is pinned by value.
2. **Exclusions are explicit and machine-readable.** `MANIFEST.json.excluded[]`
   lists what was not exported and why (`secrets`, `grants`, `admissions`,
   `vault`, `external_accounts`, `memory_not_supported`, `history_truncated`).
   Never tokens, private keys, grants or admissions. Imported history is
   imported as history (`runs`/`events`/`spans` rows tagged
   `origin: "imported"` + package digest) and never as live consent: every
   connection in an imported agent starts `not_connected`.
3. **Export with preview.** `lib/proofpack/export.ts`: `planExport(agentId, options)`
   returns the file list, sizes, sensitivity flags (which files carry
   evidence text vs code) BEFORE writing; the renderer shows the preview and
   the person chooses runs/artifacts and package vs ProofPack; the write is
   a second call. Add an "Export" control on the agent's Settings → Advanced
   (one button; the disclosure pattern already there) and a "Save ProofPack"
   on the Output stage's card footer beside Save as PDF. Keep ADR 0008 (no
   controls inside the author's panel).
4. **Import stays inert.** `lib/proofpack/import.ts`: validate schema,
   version, sizes (total and per file caps; refuse archive bombs by
   declared-vs-actual size and by decompression ratio), paths, symlinks,
   digest; refuse anything executable in a ProofPack; for a package, land
   it through the EXISTING folder-import consent path (the person reviews
   the agent; nothing runs; no install scripts). Settings → Add agent gains
   "Import a package" beside "Import a folder".
5. **Standalone verifier.** `tools/proofpack-verify/` — one ESM file,
   node builtins only, runnable as `node tools/proofpack-verify/verify.mjs <pack> [--expect-digest <hex>] [--trust <pubkey.pem>]`
   with no DASH, database or server; reports OK / changed files / missing
   files / extra files / digest mismatch / signature (`unsigned`, `valid by
   key <fingerprint>`, `invalid`, `unknown key`) / incomplete telemetry
   (runs whose event `seq` has gaps, spans with `dropped > 0`) — as data
   (JSON) and as plain text. It never fetches; the expected digest or the
   trusted key must be given out-of-band, and the README says why ("a
   verifier that takes bytes and their claimed hash from the same untrusted
   source proves nothing"). Copy the same module into `agent-kit/` as the
   kit's `verify` command only if it stays byte-identical (test).
6. **Signatures (optional, off by default).** Ed25519 over the manifest
   digest with domain separation (`"dash-proofpack/1\0" || digest`),
   version bound, key id = SHA-256 fingerprint of the public key; the
   exporter's key is DASH-local (generated under the data dir, never the
   vault's secrets, exportable public half); rotation = a new key id, old
   packs still verify with the old public key. Exporter, agent id, runner
   id and (absent) approver are separate manifest fields; the manifest
   says plainly that a signature attests the exporter's bytes at export
   time, not the truth or authenticity of every historical event.
7. **Storage adapter.** `lib/proofpack/storage.ts` with one interface
   (`put(bytes) → {ref, bytes, digest}`, `get(ref)`, `status(ref)`) and one
   implementation `LocalDiskStorage`; Walrus comes in stage 6. No general
   chain framework.
8. Copy in `lib/copy/proofpack.ts`, enumerated; no raw hashes in primary
   copy (behind details); tests are behaviour, not wording.

## Acceptance (from the plan)

Export from an isolated DASH instance imports into another clean instance:
supported data intact, permissions requiring fresh review; the separate
verifier accepts the original and detects one changed byte and one missing
file; a passive pack can be reviewed without code execution; exclusions
documented exactly.

## Ownership (write)

`lib/proofpack/**` (new), `tools/proofpack-verify/**` (new),
`contracts/proofpack.schema.json` (new; check `contract.lock.json`'s
treatment of new schemas), `lib/db.ts` (one migration for `origin`/package
digest columns — find the pin, report the index), `lib/store.ts` (import
tagging), `electron/proofpack-host.ts` (new; the IPC handlers), `lib/shell/ipc.ts`
(additive commands), `electron/preload.ts`, `app/_data/source.ts`
(additive), `app/_components/{proofpack-export,proofpack-import}.tsx` (new),
the one-button hooks in `app/_components/agent-settings.tsx` (Advanced),
`app/_components/outputs.tsx` (footer), `app/settings/add-agent/page.tsx`,
`lib/copy/proofpack.ts`, `lib/folder-import.ts` (only to accept a
validated package), tests (`tests/proofpack-*.test.ts`, fixtures),
`docs/adr/0035-a-proofpack-is-a-passive-verifiable-record.md` (number
0035 assigned; check it is free), `docs/foundation/stage-5-handoff.md`,
`agent-kit/README.md` (verify command). `app/globals.css` append-only.
NOT: `lib/broker/**`, `lib/vault*`, `lib/secret-refs.ts`, `runner/**`,
`contracts/agent.manifest.v2.schema.json`, telemetry v1.

## Verification

Typecheck; focused tests; full `pnpm test` from PowerShell; the two-instance
acceptance as a test that runs two scratch `DASH_DATA_DIR`s through the real
`ingest`/`importManifest` paths (no Electron needed) plus the verifier CLI
invoked as a child process on the real files (original OK; one byte changed
→ fails naming the file; one file removed → fails naming it). Then the
scratch-store shell smoke (add ONE proof: export a ProofPack of the sample's
run, verify it with the standalone CLI, mutate, verify fails) — paste the
lines and the tally; retire the runner. Evidence class: fixture tests +
installed-style shell on a scratch store.

Stop condition: PR open (`feat(mar-886/5): portable agent packages and
passive ProofPacks with a standalone verifier`), green, handoff with the
migration index, the ADR number, the exclusion list and what is NOT
portable. Wait for `%TEMP%\wt-f5-s1-install.done`.
