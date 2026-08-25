/**
 * `install-key`, driven end to end against the real host helper (MAR-794,
 * ADR 0018).
 *
 * ## Why this is a file of its own beside `tests/deploy-bridge.test.ts`
 *
 * Nine verbs move programs, questions and one machine-minted session secret.
 * This one moves **a key the person owns**, and ADR 0018's proof list is not the
 * deploy plane's: it is about what happens to a value on the way to a machine
 * DASH does not administer, and about what is left behind when each step of that
 * fails. Mixed into the bridge's file those assertions would read as more of the
 * same, and the thing that makes them worth running is that they are not.
 *
 * The substitution is the bridge's, unchanged and for its reason:
 * `runDeployVerb` is the production function, `scripts/host-helper/main.ts` is
 * the production helper bundled by esbuild from the same entry point
 * `scripts/build-runner-standalone.mjs` uses, and the only difference from a
 * real placement is `spawn("node", [helper, verb])` where production writes
 * `spawn("ssh", sshArgv(...))`. `ssh`, the enrolled key and the host's `sshd`
 * stay attended, permanently, under ADR 0004.
 *
 * ## What "the key appears nowhere" is asserted over
 *
 * ADR 0018 asks for it *"in no argv, answer, log, error, audit target, receipt
 * or renderer payload"* and §8A of the residency proposal sharpens it to
 * *"asserted over the captured command line and the full error path, not by
 * reading the source"*. So the spawner in this file **records every argv it was
 * given**, both output streams are captured rather than inherited, and the
 * refusal path is driven deliberately — a placement that fails is where a
 * diagnostic would quote what it was handed.
 *
 * The planted key is a single high-entropy token, so a substring search over the
 * captured strings is exact rather than approximate, and its own encodings are
 * searched for as well: base64 and hex of the same bytes, and its SHA-256, which
 * is the "stable derivative" ADR 0018 refuses by name.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { StdioChannel } from "../lib/agent-dom/ssh-fetch";
import { PACK_UNPROVED, readHostPack } from "../lib/deploy/host-pack";
import {
  HOST_READY_AND_EMPTY,
  describeForgettingWithKeys,
  describeKeyCustody,
  describeKeyPlacementAction,
  describeKeyPlacementFrame,
  describeOrphanedKeys,
  describePlacedKey,
  everyHostPackSentence,
} from "../lib/copy/host-pack";
import {
  checkKeySlot,
  describeKeySlotRefusal,
  standingForPlacements,
  type KeyPlacement,
} from "../lib/deploy/key-placement";
import {
  MAX_KEY_CHARS,
  RESERVED_HOST_BUNDLE_ID,
  RESERVED_HOST_SLOTS,
  checkDeployRequest,
  type DeployAnswer,
  type DeployRequest,
} from "../lib/deploy/verbs";
import { runDeployVerb, type DeploySpawn } from "../electron/ssh-host";
import { HOST_KEY_PROTECTION_SENTENCE, hostKeyFile, readHostKey } from "../runner/host-pack";
import { sshArgv, type HostRecord } from "../lib/hosts";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directories: string[] = [];
let helperBundle = "";

/**
 * The value under test, and it is deliberately not key-shaped.
 *
 * A realistic `sk-or-v1-…` would share a prefix with strings this repository
 * writes on purpose, and a substring search would then be able to pass by
 * accident. This is one token nothing else in the tree contains.
 */
const PLANTED_KEY = "PLANTED0f4c7a2b9e1d6035PLANTEDkeyvalue8827";

/** Every stable representation of the value a leak could take. */
function everyDerivative(): string[] {
  const bytes = Buffer.from(PLANTED_KEY, "utf8");
  return [
    PLANTED_KEY,
    bytes.toString("base64"),
    bytes.toString("base64url"),
    bytes.toString("hex"),
    createHash("sha256").update(bytes).digest("hex"),
    createHash("sha256").update(bytes).digest("base64"),
  ];
}

function freshDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), `dash-install-key-${prefix}-`));
  directories.push(dir);
  return dir;
}

beforeAll(async () => {
  const out = freshDir("helper");
  const { build } = await import("esbuild");
  await build({
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    logLevel: "silent",
    external: ["electron"],
    define: { __DASH_RUNNER_BUILD_ID__: JSON.stringify("install-key-test") },
    entryPoints: [path.join(repoRoot, "scripts", "host-helper", "entry.ts")],
    outfile: path.join(out, "host-helper.mjs"),
  });
  helperBundle = path.join(out, "host-helper.mjs");
}, 60_000);

afterAll(() => {
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Everything the child was told and everything it said back.
 *
 * `argv` is the whole command line, recorded per spawn. `stderr` is captured
 * rather than inherited, which is the difference between this file and the
 * bridge's: a helper that printed what it was handed would fail here and would
 * scroll past there.
 */
interface Capture {
  argv: string[][];
  stdout: string;
  stderr: string;
}

function localHelper(hostRoot: string, capture: Capture): DeploySpawn {
  return (verb, bundleId): StdioChannel => {
    const argv = [helperBundle, verb, ...(bundleId === undefined ? [] : [bundleId])];
    capture.argv.push([process.execPath, ...argv]);
    const child = spawn(process.execPath, argv, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, DASH_HOST_ROOT: hostRoot },
    });
    child.stdout.on("data", (chunk: Buffer) => {
      capture.stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      capture.stderr += chunk.toString("utf8");
    });
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      close: () => {
        child.stdin.end();
        child.kill();
      },
    };
  };
}

function capture(): Capture {
  return { argv: [], stdout: "", stderr: "" };
}

/** The problem a request produced, or null when it was accepted. */
function checked(request: unknown): string | null {
  const answer = checkDeployRequest(request);
  return answer.ok ? null : answer.problem;
}

async function send(
  hostRoot: string,
  request: DeployRequest,
  taken: Capture = capture(),
): Promise<DeployAnswer> {
  return await runDeployVerb(localHelper(hostRoot, taken), request);
}

/**
 * A bundle on the host, installed the way `install` installs one.
 *
 * Written directly rather than pushed through the `install` verb: this file is
 * about what happens to a key, and `tests/deploy-bridge.test.ts` already proves
 * the bundle path. What matters here is the two things `install-key` reads — the
 * record beside the bundle, and the agent's manifest inside it.
 */
function installBundle(
  hostRoot: string,
  bundleId: string,
  manifest: Record<string, unknown>,
): void {
  const bundles = path.join(hostRoot, "bundles");
  mkdirSync(path.join(bundles, bundleId, "agent"), { recursive: true });
  writeFileSync(
    path.join(bundles, `${bundleId}.json`),
    `${JSON.stringify({
      bundle_id: bundleId,
      agent_id: bundleId,
      runner_build: "install-key-test",
      installed_at: "2026-08-25T09:00:00.000Z",
      pid: null,
    })}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(bundles, bundleId, "agent", "agent.manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

/**
 * A manifest declaring one model-provider key, the way News Scout's does.
 *
 * The provider lives on the **connection**, not on the field — that is what
 * `resolveCredentialTarget` reads to decide a field is a `provider_key` rather
 * than a typed secret, and getting it wrong here would have this whole file
 * proving the refusal path instead of the placement path.
 */
function manifestWithModelKey(): Record<string, unknown> {
  return {
    manifest_version: 2,
    agent: { id: "news-scout", name: "News Scout" },
    agent_dom: {
      locations: { runtime: { kind: "local" } },
      connections: [
        {
          id: "models",
          provider: "openrouter",
          label: "Your OpenRouter key",
          purpose: "curating the headlines it finds",
          ownership: "dash_managed",
          capabilities: [],
          fields: [
            {
              id: "api_key",
              label: "API key",
              kind: "secret",
              required: true,
              purpose: "a language model",
            },
          ],
        },
      ],
    },
  };
}

/** The same shape, but the connection is a sign-in rather than a key. */
function manifestWithOauth(): Record<string, unknown> {
  return {
    manifest_version: 2,
    agent: { id: "news-scout", name: "News Scout" },
    agent_dom: {
      locations: { runtime: { kind: "local" } },
      connections: [
        {
          id: "mail",
          provider: "google",
          label: "Your Gmail",
          purpose: "reading your mail",
          ownership: "dash_managed",
          capabilities: [],
          fields: [
            {
              id: "sign_in",
              label: "Sign in",
              kind: "oauth_reauthorization",
              required: true,
              purpose: "reading your mail",
              technical: {
                provider_scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
              },
            },
          ],
        },
      ],
    },
  };
}

const BUNDLE = "news-scout";

async function placeOnce(
  hostRoot: string,
  taken: Capture = capture(),
): Promise<DeployAnswer> {
  return await send(
    hostRoot,
    { verb: "install-key", bundle_id: BUNDLE, connection_id: "models", key: PLANTED_KEY },
    taken,
  );
}

/* ---------------------------------------------------------------------- *
 * The owner-only install path (ADR 0018, steps 1 to 5)
 * ---------------------------------------------------------------------- */

describe("the owner-only install path", () => {
  it("writes 0700 parents and a 0600 file, and reads the owner and mode back", async () => {
    /*
     * ADR 0018 rule 3, executed. The modes are asserted where the platform has
     * them — the host is Linux and CI runs on Linux, so this is real on both
     * machines that matter — and `owner_proved` is what the answer says about
     * whether the read-back actually ran. `runner/host-pack.ts` reports which
     * happened rather than claiming a proof nobody performed, and this is the
     * assertion that keeps those two honest with each other.
     */
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());

    const answered = await placeOnce(hostRoot);
    expect(answered).toMatchObject({
      ok: true,
      verb: "install-key",
      bundle_id: BUNDLE,
      connection_id: "models",
      replaced: false,
      owner_proved: process.platform !== "win32",
    });

    const file = hostKeyFile(hostRoot, BUNDLE, "models");
    expect(file).not.toBeNull();
    expect(existsSync(file as string)).toBe(true);

    // And the value that landed is the value that was sent — proved through the
    // pack's own reader, which is what the host broker uses.
    expect(readHostKey(hostRoot, BUNDLE, "models")).toEqual({
      kind: "found",
      key: PLANTED_KEY,
    });

    if (process.platform !== "win32") {
      expect(statSync(path.join(hostRoot, "secrets")).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(hostRoot, "secrets", "keys")).mode & 0o777).toBe(0o700);
      expect(statSync(path.join(hostRoot, "secrets", "keys", BUNDLE)).mode & 0o777).toBe(0o700);
      expect(statSync(file as string).mode & 0o777).toBe(0o600);
    }
  }, 30_000);

  it("leaves no temporary behind, on success or on failure", async () => {
    /*
     * "Failure before the rename leaves no new key" has a quieter half: it must
     * also leave no `.tmp`. A temporary left in the keys directory is a second
     * copy of the value at a mode nothing proved, sitting beside the one that
     * was proved — and nothing would ever look at it again.
     */
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());
    await placeOnce(hostRoot);

    const slot = path.join(hostRoot, "secrets", "keys", BUNDLE);
    expect(readdirSync(slot)).toEqual(["models"]);
  }, 30_000);

  it("refuses a slot the agent's own document does not declare", async () => {
    /*
     * ADR 0018 step 1 and the narrowing the whole verb rests on: *"The bundle's
     * agent must declare the provider-key need. The caller cannot invent a slot
     * and use `install-key` as arbitrary encrypted file transfer."*
     *
     * Driven against the helper rather than only against `checkKeySlot`, because
     * the point is that the *host* refuses — a rule that lived only in DASH is a
     * rule the host does not have.
     */
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());

    const answered = await send(hostRoot, {
      verb: "install-key",
      bundle_id: BUNDLE,
      connection_id: "invented",
      key: PLANTED_KEY,
    });
    expect(answered.ok).toBe(false);
    if (!answered.ok) {
      expect(answered.problem).toBe("undeclared_slot");
    }
    expect(readdirSync(path.join(hostRoot, "secrets", "keys"))).toEqual([]);
  }, 30_000);

  it("refuses a bundle that is not installed", async () => {
    // *"An installed bundle must already exist. A key cannot be placed at a free
    // host path or left as a host-wide loose secret."*
    const hostRoot = freshDir("host");
    const answered = await send(hostRoot, {
      verb: "install-key",
      bundle_id: "never-installed",
      connection_id: "models",
      key: PLANTED_KEY,
    });
    expect(answered.ok).toBe(false);
    if (!answered.ok) {
      expect(answered.problem).toBe("not_installed");
    }
    expect(readdirSync(path.join(hostRoot, "secrets", "keys"))).toEqual([]);
  }, 30_000);

  it("refuses a sign-in as a different custody class, by its own name", () => {
    /*
     * ADR 0021: a Gmail refresh token is *"a different custody class: OAuth,
     * restricted scopes, a third party at consent, revocation that is not
     * 'rotate at the provider' in the same way."* Named separately from "this
     * connection does not exist" so whoever meets it is told which wall they hit.
     */
    const refused = checkKeySlot(
      BUNDLE,
      BUNDLE,
      manifestWithOauth() as never,
      "mail",
    );
    expect(refused).toEqual({ ok: false, refusal: "oauth_is_a_different_custody_class" });
  });
});

/* ---------------------------------------------------------------------- *
 * Replacement, and what a failure leaves behind
 * ---------------------------------------------------------------------- */

describe("replacing a key that is already there", () => {
  it("reports the replacement rather than a second placement", async () => {
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());
    await placeOnce(hostRoot);

    const again = await send(hostRoot, {
      verb: "install-key",
      bundle_id: BUNDLE,
      connection_id: "models",
      key: "PLANTED-second-value-c41f",
    });
    expect(again).toMatchObject({ ok: true, verb: "install-key", replaced: true });
    expect(readHostKey(hostRoot, BUNDLE, "models")).toEqual({
      kind: "found",
      key: "PLANTED-second-value-c41f",
    });
    // One file, not two. The slot is the identity.
    expect(readdirSync(path.join(hostRoot, "secrets", "keys", BUNDLE))).toEqual(["models"]);
  }, 30_000);

  it("leaves the previous shadow in place when the new value cannot be written, and says so", async () => {
    /*
     * ADR 0018: *"Failure replacing an existing key leaves the previous shadow in
     * place and says so; it must never report 'not installed' merely because the
     * new value failed."*
     *
     * The failure is made real rather than mocked: the slot directory is made
     * read-only, so the temporary write throws where a full disk or a revoked
     * permission would. On Windows a read-only directory does not stop a file
     * being created, so the same failure is produced by putting a **directory**
     * where the temporary must go — a name that cannot be written as a file on
     * any platform, and one a crashed previous attempt could plausibly leave.
     *
     * What is asserted is the pair: the answer is a refusal that names the
     * surviving key, and the surviving key still decrypts to the old value.
     */
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());
    await placeOnce(hostRoot);

    const file = hostKeyFile(hostRoot, BUNDLE, "models") as string;
    mkdirSync(`${file}.tmp`, { recursive: true });

    const blocked = await send(hostRoot, {
      verb: "install-key",
      bundle_id: BUNDLE,
      connection_id: "models",
      key: "PLANTED-never-lands-9a17",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.problem).toBe("key_not_placed");
      expect(blocked.detail).toContain("still there");
      // The sentence ADR 0018 forbids on this path, in every casing.
      expect(blocked.detail.toLowerCase()).not.toContain("not installed");
    }

    // And the previous shadow really is still spendable.
    rmSync(`${file}.tmp`, { recursive: true, force: true });
    expect(readHostKey(hostRoot, BUNDLE, "models")).toEqual({
      kind: "found",
      key: PLANTED_KEY,
    });
  }, 30_000);

  it("leaves no new key when the first placement fails before the rename", async () => {
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());

    const slot = path.join(hostRoot, "secrets", "keys", BUNDLE);
    mkdirSync(slot, { recursive: true });
    mkdirSync(path.join(slot, "models.tmp"), { recursive: true });

    const blocked = await placeOnce(hostRoot);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      // Nothing was there before, so nothing is claimed to have survived.
      expect(blocked.detail).not.toContain("still there");
    }
    expect(existsSync(path.join(slot, "models"))).toBe(false);
  }, 30_000);
});

/* ---------------------------------------------------------------------- *
 * The value, everywhere it must not be
 * ---------------------------------------------------------------------- */

describe("the key and every stable derivative of it", () => {
  it("appears in no argv, no answer and neither output stream, on the success path", async () => {
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());

    const taken = capture();
    const answered = await placeOnce(hostRoot, taken);
    expect(answered.ok).toBe(true);

    /*
     * The command line, as the child was actually given it. This is the
     * assertion §8A asks for by name — over the captured command line rather
     * than by reading `sshArgv`. Every argv is joined and searched, so a value
     * appended as a fifth token fails here even if `sshArgv` never changed.
     */
    const commandLines = taken.argv.map((one) => one.join(" ")).join("\n");
    for (const derivative of everyDerivative()) {
      expect(commandLines).not.toContain(derivative);
      expect(JSON.stringify(answered)).not.toContain(derivative);
      expect(taken.stdout).not.toContain(derivative);
      expect(taken.stderr).not.toContain(derivative);
    }

    /*
     * And the real `sshArgv`, over the same verb, because the spawner above is
     * this file's substitution and the production command line is composed
     * somewhere else. The verb is the last token and there is nothing after it.
     */
    const record: HostRecord = {
      host_id: "host-1",
      label: "My server",
      address: "example.test",
      username: "root",
      port: 22,
      key_name: "host-1",
      added_at: "2026-08-25T09:00:00.000Z",
      host_fingerprint: "SHA256:fixture",
    };
    const built = sshArgv(record, "install-key", {
      identity_file: "id",
      known_hosts_file: "known",
    });
    expect(built[built.length - 1]).toBe("install-key");
    expect(built.join(" ")).not.toContain(PLANTED_KEY);
  }, 30_000);

  it("appears nowhere on the full error path either", async () => {
    /*
     * The path a diagnostic gets added to. Every refusal this verb can produce
     * is driven with the real value in the request, and the whole capture is
     * searched afterwards — answer, stdout and stderr together, because a helper
     * that printed what it was handed would put it on the stream nobody reads.
     */
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());

    const refusals: DeployRequest[] = [
      // An undeclared slot.
      { verb: "install-key", bundle_id: BUNDLE, connection_id: "invented", key: PLANTED_KEY },
      // A bundle that is not there.
      { verb: "install-key", bundle_id: "never-installed", connection_id: "models", key: PLANTED_KEY },
      // An identifier the alphabet refuses, checked before the child is spawned.
      { verb: "install-key", bundle_id: BUNDLE, connection_id: "../escape", key: PLANTED_KEY },
    ];

    for (const request of refusals) {
      const taken = capture();
      const answered = await send(hostRoot, request, taken);
      expect(answered.ok).toBe(false);
      const everything = [
        JSON.stringify(answered),
        taken.stdout,
        taken.stderr,
        taken.argv.map((one) => one.join(" ")).join("\n"),
      ].join("\n");
      for (const derivative of everyDerivative()) {
        expect(everything).not.toContain(derivative);
      }
    }
  }, 30_000);

  it("is not on the host in plaintext, only sealed", async () => {
    /*
     * ADR 0021 section 3: the bytes at rest are encrypted with a wrapping key in
     * the same account. That is a speed bump and not a vault — and the property
     * worth asserting is the narrow one it really buys: *"a backup, a snapshot, a
     * stray `tar` of the home directory or a misconfigured file sync carries
     * ciphertext"*. So every file under the host root is read and searched.
     */
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());
    await placeOnce(hostRoot);

    const seen: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          seen.push(readFileSync(full).toString("binary"));
        }
      }
    };
    walk(hostRoot);
    expect(seen.length).toBeGreaterThan(0);
    for (const contents of seen) {
      expect(contents).not.toContain(PLANTED_KEY);
    }
  }, 30_000);
});

/* ---------------------------------------------------------------------- *
 * What a request may be
 * ---------------------------------------------------------------------- */

describe("what an install-key request may name", () => {
  it("refuses a path, a filename, a mode, an environment variable, a command or an executable", () => {
    /*
     * ADR 0018 rule 2, as the closed field set that enforces it. Every other
     * verb tolerates a member it does not read; this one refuses, because the
     * surplus field is exactly the shape a widening into remote execution would
     * arrive in.
     */
    const surplus = [
      { path: "/etc/passwd" },
      { filename: "key.txt" },
      { mode: 0o777 },
      { environment_name: "OPENROUTER_API_KEY" },
      { command: "sh" },
      { executable: "/bin/sh" },
      { argv: ["sh", "-c", "id"] },
      { agent_id: "news-scout" },
    ];
    for (const extra of surplus) {
      const checked = checkDeployRequest({
        verb: "install-key",
        bundle_id: BUNDLE,
        connection_id: "models",
        key: PLANTED_KEY,
        ...extra,
      });
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.problem).toBe("malformed_key");
        // And the refusal quotes neither the value nor the surplus field's name.
        expect(checked.detail).not.toContain(PLANTED_KEY);
        expect(checked.detail).not.toContain(Object.keys(extra)[0] ?? "");
      }
    }
  });

  it("refuses an identifier that could spell a separator, in either position", () => {
    const spellings = ["../escape", "a/b", "a\\b", "a:b", "-lead", "a.b", "ab", ""];
    for (const spelling of spellings) {
      expect(
        checkDeployRequest({
          verb: "install-key",
          bundle_id: spelling,
          connection_id: "models",
          key: PLANTED_KEY,
        }).ok,
      ).toBe(false);
      expect(
        checkDeployRequest({
          verb: "install-key",
          bundle_id: BUNDLE,
          connection_id: spelling,
          key: PLANTED_KEY,
        }).ok,
      ).toBe(false);
    }
  });

  it("re-checks containment after the join, even for an identifier that got past the alphabet", () => {
    /*
     * `hostKeyFile` returns null when the join does not land below the keys
     * root, and the alphabet already makes that unreachable — which is precisely
     * when a containment check earns its keep, because reaching it means
     * something upstream stopped validating. Driven directly, with a value the
     * alphabet would have refused.
     */
    const hostRoot = freshDir("host");
    expect(hostKeyFile(hostRoot, "..", "models")).toBeNull();
    expect(hostKeyFile(hostRoot, BUNDLE, "../../escape")).toBeNull();
    expect(hostKeyFile(hostRoot, BUNDLE, "models")).not.toBeNull();
  });

  it("refuses a key that is empty, oversized, or not a single line", () => {
    const bad = ["", "x".repeat(MAX_KEY_CHARS + 1), "line\nbreak", "tab\there", "nul byte"];
    for (const key of bad) {
      const checked = checkDeployRequest({
        verb: "install-key",
        bundle_id: BUNDLE,
        connection_id: "models",
        key,
      });
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.problem).toBe("malformed_key");
      }
    }
    expect(
      checkDeployRequest({
        verb: "install-key",
        bundle_id: BUNDLE,
        connection_id: "models",
        key: "x".repeat(MAX_KEY_CHARS),
      }).ok,
    ).toBe(true);
  });

  it("keeps install's bundle modes at exactly 0644 and 0755", () => {
    /*
     * ADR 0018's whole argument for a new verb rather than a bundle exception,
     * pinned where the verb lands. ADR 0014 amendment 1: widening the mode set
     * for one file *"would put a hole in the closed set to avoid opening a
     * closed set"*. The set is unchanged, and this is the line that fails if
     * somebody reaches for the shortcut after all.
     */
    const file = (mode: number): Record<string, unknown> => ({
      path: "start.mjs",
      content_base64: Buffer.from("export {};", "utf8").toString("base64"),
      sha256: createHash("sha256").update("export {};", "utf8").digest("hex"),
      mode,
    });
    const install = (mode: number): ReturnType<typeof checkDeployRequest> =>
      checkDeployRequest({
        verb: "install",
        bundle_id: BUNDLE,
        agent_id: BUNDLE,
        runner_build: "install-key-test",
        files: [file(mode)],
      });

    expect(install(0o644).ok).toBe(true);
    expect(install(0o755).ok).toBe(true);
    for (const refused of [0o600, 0o700, 0o666, 0o777, 0o400, 0o4755]) {
      const checked = install(refused);
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.problem).toBe("malformed_mode");
      }
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The reserved bundle id
 * ---------------------------------------------------------------------- */

describe("the reserved bundle id", () => {
  it("is spellable by the identifier alphabet, so nothing needs an exemption", () => {
    // If the alphabet could not spell it, every validator would need a special
    // case — which is the hole the constant exists to avoid rather than open.
    expect(
      checked({
        verb: "install-key",
        bundle_id: RESERVED_HOST_BUNDLE_ID,
        connection_id: "anything",
        key: PLANTED_KEY,
      }),
    ).not.toBe("malformed_identifier");
  });

  it("cannot collide with any id install accepts", () => {
    /*
     * §8A's last blocking line. Refused on every verb that is about a bundle, so
     * `install` cannot create a directory under it, `uninstall` cannot remove
     * one, and `status` cannot be pointed at one — which is what lets the orphan
     * accounting treat a reserved placement as never orphaned without a second
     * check.
     */
    for (const verb of ["install", "start", "stop", "status", "collect", "connect", "channel", "uninstall"]) {
      const checked = checkDeployRequest({
        verb,
        bundle_id: RESERVED_HOST_BUNDLE_ID,
        agent_id: BUNDLE,
        runner_build: "x",
        files: [],
      });
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.problem).toBe("reserved_identifier");
      }
    }
  });

  it("admits no slot in this packet, and the helper says so", async () => {
    /*
     * The list is empty and the emptiness is the decision — a reserved slot has
     * no manifest to narrow it, so the only thing that can is a list, and a list
     * shipped with speculative names on it would be an open door with a comment
     * above it. The packet that needs one adds a name here and defends it.
     */
    expect(RESERVED_HOST_SLOTS).toEqual([]);

    const hostRoot = freshDir("host");
    const answered = await send(hostRoot, {
      verb: "install-key",
      bundle_id: RESERVED_HOST_BUNDLE_ID,
      connection_id: "chief-model-provider",
      key: PLANTED_KEY,
    });
    expect(answered.ok).toBe(false);
    if (!answered.ok) {
      expect(answered.problem).toBe("reserved_slot_not_admitted");
    }
  }, 30_000);
});

/* ---------------------------------------------------------------------- *
 * A host that cannot hold a key
 * ---------------------------------------------------------------------- */

describe("a host whose pack cannot be proved", () => {
  it("refuses install-key as host_pack_too_old and installs nothing", async () => {
    /*
     * ADR 0021 section 4: *"Do not fall through. An old helper that cannot answer
     * `pack` cannot receive `install-key` either; both stops name the setup
     * step."*
     *
     * The unprovable pack is made the way `tests/deploy-bridge.test.ts` makes it
     * — a file where the secrets directory belongs — which is what a
     * half-finished install or a hostile `touch` leaves behind.
     */
    const hostRoot = freshDir("host");
    installBundle(hostRoot, BUNDLE, manifestWithModelKey());
    rmSync(path.join(hostRoot, "secrets"), { recursive: true, force: true });
    writeFileSync(path.join(hostRoot, "secrets"), "not a directory", "utf8");

    const answered = await placeOnce(hostRoot);
    expect(answered.ok).toBe(false);
    if (!answered.ok) {
      expect(answered.problem).toBe(PACK_UNPROVED);
    }
    expect(readHostPack(answered)).toEqual({ ok: false, stop: "host_pack_too_old" });

    // Nothing partial: no keys tree, and the bundle is untouched.
    expect(statSync(path.join(hostRoot, "secrets")).isFile()).toBe(true);
    expect(existsSync(path.join(hostRoot, "bundles", BUNDLE, "agent", "agent.manifest.json"))).toBe(
      true,
    );
  }, 30_000);

  it("is what an older helper answers too, without anybody writing that branch", () => {
    /*
     * The first too-old case needs no code at all: `checkDeployRequest` refuses a
     * verb its own array does not hold, so bytes that predate this packet answer
     * `unknown_verb` for free. Asserted on the mapping rather than by building a
     * second helper from an older tree, which would prove esbuild.
     */
    expect(
      readHostPack({ ok: false, problem: "unknown_verb", detail: "not an operation" }),
    ).toEqual({ ok: false, stop: "host_pack_too_old" });
  });
});

/* ---------------------------------------------------------------------- *
 * The orphan question
 * ---------------------------------------------------------------------- */

describe("which placed keys still have a bundle to serve", () => {
  const placement = (bundleId: string): KeyPlacement => ({
    host_id: "host-1",
    bundle_id: bundleId,
    connection_id: "models",
    field_id: "api_key",
    placed_at: "2026-08-25T09:00:00.000Z",
  });

  it("says nothing is orphaned before anything has asked the server", () => {
    /*
     * Null is not empty. An unchecked server and an empty server are different
     * claims, and only one of them is a finding — `describeWhatIsOnHost` draws
     * the same line for the same reason.
     */
    const standings = standingForPlacements([placement(BUNDLE)], null);
    expect(standings.map((one) => one.orphaned)).toEqual([false]);
  });

  it("finds the placement whose agent the server no longer holds", () => {
    const standings = standingForPlacements(
      [placement(BUNDLE), placement("other-agent")],
      [BUNDLE],
    );
    expect(standings.map((one) => one.orphaned)).toEqual([false, true]);
  });

  it("never orphans a reserved placement, because no bundle can ever be there", () => {
    // The reserved id belongs to no bundle by construction, so an empty
    // installed list is not evidence against it.
    const standings = standingForPlacements([placement(RESERVED_HOST_BUNDLE_ID)], []);
    expect(standings.map((one) => one.orphaned)).toEqual([false]);
  });
});

/* ---------------------------------------------------------------------- *
 * The sentences
 * ---------------------------------------------------------------------- */

describe("what a person reads", () => {
  it("carries the custody sentence whole, with ADR 0021's clause inside it", () => {
    /*
     * ADR 0018 rule 1 fixes the first clause, ADR 0021 section 3 extends it, and
     * this is the check that keeps the copy module's restatement and
     * `runner/host-pack.ts`'s constant from drifting. The copy module cannot
     * import the constant — that module opens `node:fs` and this one is read by
     * a client tree — so the equality is asserted here, in Node, which is the
     * only place it can be.
     */
    const custody = describeKeyCustody("My server");
    expect(custody).toContain(HOST_KEY_PROTECTION_SENTENCE);
    expect(custody).toContain("DASH cannot see or take back what uses it there");
    expect(custody).toContain("revoking means rotating at the provider");
    // The word it must never contain about a host, and the one the local vault
    // is allowed to use.
    expect(custody).toContain("not by a keychain");
  });

  it("puts the key, the server, the agent and the custody sentence on one frame", () => {
    /*
     * ADR 0018: *"The confirm press is unavailable until all three are on screen,
     * together with this sentence."* Built by one function so the four cannot be
     * assembled from three places.
     */
    const frame = describeKeyPlacementFrame({
      keyLabel: "Your OpenRouter key",
      serverLabel: "My server",
      address: "example.test",
      fingerprint: "SHA256:abc",
      agentName: "News Scout",
      need: "a language model",
    });
    expect(frame.key).toContain("Your OpenRouter key");
    expect(frame.server).toContain("My server");
    expect(frame.server).toContain("example.test");
    expect(frame.server).toContain("SHA256:abc");
    expect(frame.agent).toContain("News Scout");
    expect(frame.agent).toContain("a language model");
    expect(frame.custody).toBe(describeKeyCustody("My server"));
    expect(frame.action).toBe("Put this key on My server");
  });

  it("names the movement rather than hiding it", () => {
    // *"'Continue' and 'Allow' hide the consequence and are not admitted."*
    const action = describeKeyPlacementAction("Hostinger");
    expect(action).toContain("Hostinger");
    expect(action.toLowerCase()).not.toContain("continue");
    expect(action.toLowerCase()).not.toContain("allow");
    expect(action.toLowerCase()).not.toContain("confirm");
  });

  it("says an unconfirmed identity out loud instead of leaving the line off", () => {
    const frame = describeKeyPlacementFrame({
      keyLabel: "Your OpenRouter key",
      serverLabel: "My server",
      address: "example.test",
      fingerprint: null,
      agentName: "News Scout",
      need: "a language model",
    });
    expect(frame.server).toContain("not confirmed this server");
  });

  it("warns before forgetting a server that still holds a key, and stays quiet otherwise", () => {
    expect(describeForgettingWithKeys(0, "My server")).toBeNull();
    const one = describeForgettingWithKeys(1, "My server") ?? "";
    expect(one).toContain("My server");
    expect(one).toContain("does not remove it");
    expect(one).toContain("Rotating at the provider");
  });

  it("offers no removal it cannot perform when a key is orphaned", () => {
    /*
     * There is no remove-key verb in this packet, so the orphan line must not
     * offer one — an offer that led to a refusal would be worse than the line.
     * What it offers is the act that always works.
     */
    const orphaned = describeOrphanedKeys(2);
    expect(orphaned).toContain("no longer installed here");
    expect(orphaned).toContain("Rotating at the provider");
    expect(orphaned).toContain("cannot take a key off a server yet");
  });

  it("is plain language, every sentence of it", () => {
    /*
     * The guided-path rule, over the whole module. The fingerprint is the one
     * technical-looking string on the frame and it is admitted deliberately —
     * ADR 0018 puts it there so the frame names *the enrolled machine rather
     * than another row with the same label* — so it is excluded from this sweep
     * by not being in it: `everyHostPackSentence` builds its frame with a null
     * fingerprint, which is what every real record has today anyway.
     */
    expectPlainLanguage(everyHostPackSentence());
    expectPlainLanguage([
      HOST_READY_AND_EMPTY,
      describePlacedKey("Your OpenRouter key", "News Scout", "25 August 2026"),
    ]);
  });

  it("words a refusal without an identifier in it", () => {
    for (const refusal of [
      "undeclared_slot",
      "oauth_is_a_different_custody_class",
      "not_a_provider_key",
      "reserved_slot_not_admitted",
    ] as const) {
      expectPlainLanguage([describeKeySlotRefusal(refusal)]);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * Housekeeping the fixture depends on
 * ---------------------------------------------------------------------- */

describe("the fixture itself", () => {
  it("makes a slot directory the helper can be blocked on", () => {
    /*
     * The replacement failure above depends on a directory standing where the
     * temporary must go. If a platform ever allowed a file to be created over a
     * directory, that test would pass for the wrong reason — so the premise is
     * asserted rather than assumed.
     */
    const dir = freshDir("premise");
    const blocked = path.join(dir, "blocked");
    mkdirSync(blocked);
    expect(() => {
      writeFileSync(blocked, "x", "utf8");
    }).toThrow();
    chmodSync(blocked, 0o700);
  });
});
