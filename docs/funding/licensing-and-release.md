# Licensing and release

**Nothing here changes a licence and nothing here publishes a package.** This
is an inventory, a proposal, and a checklist. Written 2026-09-07 against
commit `620aa93`.

> **No licence change, no publish, without a separate decision by Henrik on a
> finished case.** This applies to every package, every repository, and every
> file named below. A grant agreement that appears to require publication is a
> conflict to catch before signing (see `applicant-checklist.md`), not a
> licence decision made by default.

## 1. Our own code — current state

Read from the repository on 2026-09-07:

| Fact | Value | Source |
|---|---|---|
| Root package name | `orchestratedash` | `package.json` |
| Root package version | 0.1.1 | `package.json` |
| Root package private | `true` | `package.json` |
| Root package licence field | **absent** | `package.json` |
| LICENSE file at repository root | **none** | `find . -maxdepth 2 -iname "LICENSE*"` returned nothing |
| Agent kit package name | `create-dash-agent` | `agent-kit/package.json` |
| Agent kit version | 0.1.1 | `agent-kit/package.json` |
| Agent kit private | `true` | `agent-kit/package.json` |
| Agent kit licence | `UNLICENSED` | `agent-kit/package.json` |
| Agent kit bin | `create-dash-agent` → `dist/cli.mjs` | `agent-kit/package.json` |
| Agent kit published to npm | **not published** — `private: true` prevents it, and no publish has occurred | repository state |

**What this means, said plainly.** `UNLICENSED` with no LICENSE file is not
open source. It is not "source available" either. Under default copyright, a
third party has no permission to copy, modify or redistribute any of it. If a
funding application implies that a deliverable is reusable by the ecosystem,
that implication is **false today**, and closing that gap is a decision, not a
formality.

**This is a gap, and both application drafts say so.**

### Name availability

`create-dash-agent` is a name we use locally. Whether it is available on the
public npm registry has **not been checked** — `to check` before any publish
discussion. The same applies to any name chosen for a public verifier or
adapter package.

## 2. Third-party dependencies

Read on 2026-09-07 from `node_modules` in the main checkout
(`C:\Users\henri\Desktop\projekt\MCP\orchestratedash\node_modules`),
read-only. Versions are the installed ones, which may be newer than the
declared range.

### Runtime dependencies

| Package | Declared | Installed | Licence |
|---|---|---|---|
| `ajv` | ^8.17.1 | 8.20.0 | MIT |
| `ajv-formats` | ^3.0.1 | 3.0.1 | MIT |
| `genlayer-js` | ^1.1.8 | 1.1.8 | MIT |
| `next` | ^16.2.10 | 16.2.10 | MIT |
| `react` | ^19.2.7 | 19.2.7 | MIT |
| `react-dom` | ^19.2.7 | 19.2.7 | MIT |

### Development dependencies

| Package | Declared | Installed | Licence |
|---|---|---|---|
| `@electron/packager` | ^20.0.4 | 20.0.4 | BSD-2-Clause |
| `@types/node` | ^22.0.0 | 22.20.0 | MIT |
| `@types/react` | ^19.2.17 | 19.2.17 | MIT |
| `@types/react-dom` | ^19.2.3 | 19.2.3 | MIT |
| `electron` | ^43.2.0 | 43.2.0 | MIT |
| `esbuild` | ^0.28.1 | 0.28.1 | MIT |
| `typescript` | ^5.8.0 | 5.9.3 | Apache-2.0 |
| `vitest` | ^4.1.0 | 4.1.9 | MIT |

**Findings.**

- The direct dependency surface is unusually small — six runtime packages —
  which makes a future licence decision much easier than it would be for a
  typical application.
- Every direct dependency is permissive: MIT, BSD-2-Clause, or Apache-2.0. No
  copyleft obligation is created by any direct dependency.
- **Transitive dependencies have not been audited.** These fourteen are the
  declared direct ones. A full transitive licence scan is `to check` before
  any publication, and Electron in particular bundles Chromium and Node.js,
  which carry their own notice obligations for a distributed binary.
- Electron ships with attribution requirements for the third-party components
  it embeds. Any distributed build needs a notices file. Whether the current
  packaged build has one is `to check`.

### Anticipated new dependencies

Stages 6 and 7 will add a Walrus client and a Starknet client. Their licences
must be checked **before** they are added, not after:

| Anticipated | Licence status |
|---|---|
| Walrus client/SDK | `to check`. The Walrus repository itself is Apache-2.0 (<https://github.com/MystenLabs/walrus>, read 2026-09-07); the client library we would use has not been chosen |
| Starknet client / account library | `to check`. Candidate ecosystem projects include MIT-licensed work such as `starkclaw` (<https://github.com/keep-starknet-strange/starkclaw>, read 2026-09-07) |

## 3. Proposed boundary: public component vs commercial product

A proposal for Henrik to accept, modify or reject. **Nothing below is
decided.**

The test for putting something on the public side is not "would it be nice to
open source this". It is: **does an outsider need it to verify our claims or
to interoperate?** If yes, keeping it closed makes the ecosystem pitch dishonest.
If no, publishing it is a maintenance cost with no return.

### Proposed public side

| Component | Why it must be public | State |
|---|---|---|
| **ProofPack format specification** + test vectors | A format nobody may implement is not a format. Its whole value is other tools adopting it | `planned` |
| **Standalone verifier** | The core claim is "verify without trusting the sender". A recipient who must run *our closed binary* to check *our pack* has not escaped trusting us | `planned` |
| **Storage adapters** (local disk, Walrus) | The ecosystem deliverable a funder would be paying for | `planned` |
| **Mandate adapter example** (Starknet) | Same | `planned` |
| **Agent SDK / build recipe schema** | Third parties write agents against it; a closed schema makes "open agent kit" untrue | exists as `create-dash-agent`, currently `UNLICENSED` |

Suggested licence for the public side: a permissive licence (MIT or
Apache-2.0), because the goal is adoption and because Apache-2.0 additionally
carries an explicit patent grant that reviewers of an ecosystem grant tend to
prefer. **Henrik decides.** Note that a verifier under a restrictive licence
would undercut its own purpose.

### Proposed commercial side

| Component | Why it stays closed |
|---|---|
| The DASH application: shell, UI, run inspector, fleet and host management | The product. Its value is the supervision experience, not the file format |
| The broker and its enforcement | Security-relevant and product-specific. Publishing it is a separate decision with its own threat analysis |
| Connections, chief, deploy and scheduling machinery | Product surface |
| The installed store, vault and their formats | Product internals, security-sensitive |

### The awkward middle

- **`create-dash-agent`.** It is the front door for anyone writing an agent.
  If the pitch is "an open agent kit", this package is the thing that has to
  be open, and it is `UNLICENSED` today. This is the single most important
  licensing decision on the list.
- **Contracts (`contracts/*.schema.json`, telemetry v1).** Schemas that
  external agents must satisfy. Arguably these are already public interfaces
  in everything but licence. Publishing the schemas without publishing the
  implementation is a coherent middle position.
- **Anything a grant funds.** Work paid for by an ecosystem grant should
  probably be on the public side. If it is not, say so in the application
  before the money moves, not after.

## 4. Release checklist — prepared, not executed

**None of these steps has been performed.** This exists so that if Henrik
decides to publish, the work is a checklist rather than a research project.

### Before any decision

- [ ] Decide the boundary in section 3. Written down, with reasons.
- [ ] Decide the licence for the public side, and whether one licence covers
      all of it.
- [ ] Confirm no grant agreement constrains the choice
      (`applicant-checklist.md`).
- [ ] Decide who holds copyright — Henrik personally, or a company.
- [ ] Full transitive dependency licence scan on whatever is to be published.
- [ ] Check the chosen package names are available on the registry.

### Before a first publish

- [ ] Add a LICENSE file with the chosen licence at the root of each published
      package.
- [ ] Remove `private: true` **only** from packages intended to be published.
      Leave it on everything else. A stray removal publishes the product.
- [ ] Replace `"license": "UNLICENSED"` with the chosen identifier in every
      published `package.json`.
- [ ] Add a NOTICE / third-party attributions file where dependency licences
      require it, including Electron's embedded components for any distributed
      binary.
- [ ] Confirm the published `files` list contains no secret, no store, no
      capture output, no `qa-screenshots-*` directory, and no path leaking a
      machine name.
- [ ] Confirm the built artifact contains no absolute path from a development
      machine.
- [ ] Verify the package installs and runs in a clean environment with no DASH
      present — for the verifier especially, since "works without DASH" is the
      claim.
- [ ] Decide the versioning and support commitment. `0.1.x` communicates
      "expect breaking changes"; if the ecosystem is asked to build on it,
      that expectation must be stated rather than implied.
- [ ] Decide security contact and disclosure process before publishing
      anything that verifies or signs
      (`security-and-operations.md`).
- [ ] Dry-run the publish. Inspect the tarball contents by hand.
- [ ] **Henrik presses publish.** Not an agent, not a CI job, not a session.

### After publishing

- [ ] Publishing is close to irreversible: unpublishing is restricted and
      other people may already depend on it. Treat the first publish as
      permanent.
- [ ] A published verifier is a security-relevant artifact. Its bugs are other
      people's false confidence.

## 5. Honest summary for an application

If a reviewer asks "is this open?", the true answer on 2026-09-07 is:

> Not yet. The repository is private and unlicensed, and no package has been
> published. The reusable components — the pack format, the standalone
> verifier, the storage and mandate adapters, and the agent kit — are proposed
> for a permissive licence, and that proposal is written down with its
> boundary and its checklist. The decision has not been made, and this
> application does not pretend it has.

Any wording softer than that would be a claim we cannot support.
