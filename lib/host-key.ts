/**
 * The host's own key, as a thing DASH can show a person before trusting it
 * (MAR-572, ADR 0007).
 *
 * Pure. No `ssh`, no `ssh-keyscan`, no filesystem — `electron/ssh-host.ts` runs
 * the scanner and writes the file, and this decides what its output *means*.
 * The split is `lib/hosts.ts`'s and it earns its keep twice here: the
 * fingerprint a person is asked to compare is computed from bytes rather than
 * scraped from another program's stdout, and CI runs the whole of it on a
 * machine with no host and no network.
 *
 * ## Why this file exists at all
 *
 * `sshArgv` dials with `StrictHostKeyChecking=yes` against a `known_hosts` that
 * `createHostKey` writes **empty on purpose**, so that a first connection fails
 * closed rather than silently trusting whatever answered. That was half a
 * design: the strict half shipped and the half that puts a first key *into*
 * that file did not, so every never-seen host failed host-key verification
 * forever. The attended run on 2026-08-08 is where that was found, against a
 * real Ubuntu box whose `auth.log` recorded DASH's probe aborting at preauth
 * with no publickey attempt ever made.
 *
 * This module is the missing half's vocabulary: what a scanned key is, which
 * one of several DASH would actually check against, what its fingerprint is in
 * the form OpenSSH prints and a provider's console shows, and the exact line
 * that gets written if — and only if — a person says yes.
 *
 * ## The honest thing about trust on first use
 *
 * Nothing here verifies anything. A fingerprint fetched over the same
 * connection it describes proves only that the answer was self-consistent, and
 * a machine impersonating the host would hand back its own key and its own
 * fingerprint just as smoothly. What the enrollment step buys is not proof: it
 * is **attribution** — a person looked at a fingerprint, compared it with what
 * their provider showed them, and said yes. `lib/host-connect.ts` says that out
 * loud on the screen rather than implying a check DASH did not perform.
 *
 * That is why there is no re-pin function in this file and none in
 * `electron/ssh-host.ts`. A first pin is a decision; a *changed* key after
 * pinning is the one state ADR 0007 requires to fail closed, and the way to
 * keep it failing closed is to give the code no way to say yes a second time.
 */

import { createHash } from "node:crypto";

/* ---------------------------------------------------------------------- *
 * What a host key is
 * ---------------------------------------------------------------------- */

/**
 * The key types DASH will pin, in the order it prefers them.
 *
 * Order matters and is OpenSSH's own: Ed25519 first because it is what every
 * sshd worth connecting to has offered for a decade, then the NIST curves, then
 * RSA. `ssh-rsa` names the *key* here rather than a signature algorithm —
 * `rsa-sha2-256` and `rsa-sha2-512` are how that key is signed with and never
 * appear in a `known_hosts` line, so admitting them would be admitting a string
 * this file would then have to explain.
 *
 * Deliberately closed, and deliberately without `ssh-dss`: a host still
 * offering DSA is one whose fingerprint DASH should not be teaching somebody to
 * accept.
 */
export const HOST_KEY_TYPES = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "ssh-rsa",
] as const;

export type HostKeyType = (typeof HOST_KEY_TYPES)[number];

export function isHostKeyType(candidate: string): candidate is HostKeyType {
  return (HOST_KEY_TYPES as readonly string[]).includes(candidate);
}

/** One key a host offered, as it will be written down and as it will be read out. */
export interface ScannedHostKey {
  type: HostKeyType;
  /** The base64 blob exactly as the host presented it. Never re-encoded. */
  blob_base64: string;
  /** `SHA256:…`, the form OpenSSH prints and a provider's console shows. */
  fingerprint: string;
}

/**
 * What a person is shown, and it is a short list on purpose.
 *
 * A provider's console prints one fingerprint per key type and a novice cannot
 * be asked which of four they are looking at. `chooseHostKey` picks the one
 * DASH will actually check against; this type carries that one plus how many
 * others were on offer, so a surface can say "this server also offered two
 * others" without turning the decision into a menu.
 */
export interface HostKeyOffer {
  chosen: ScannedHostKey;
  /** Every key the host offered, chosen included, in the order scanned. */
  offered: ScannedHostKey[];
}

/* ---------------------------------------------------------------------- *
 * Reading what the scanner said
 * ---------------------------------------------------------------------- */

/**
 * The fingerprint OpenSSH prints, computed from the bytes rather than parsed
 * from another program's output.
 *
 * `SHA256:` followed by the base64 of the raw digest of the *decoded* key blob,
 * with the padding stripped — which is what `ssh-keygen -l` does, and doing it
 * here rather than by spawning `ssh-keygen -lf -` means the string a person is
 * asked to compare is one this repository's tests can assert against a known
 * vector instead of against whatever build of OpenSSH the machine has.
 */
export function hostKeyFingerprint(blobBase64: string): string {
  const digest = createHash("sha256").update(Buffer.from(blobBase64, "base64")).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
}

export type HostKeyScanProblem =
  /** The scanner printed nothing usable — no host key line at all. */
  | "no_key_offered"
  /** Every line was malformed, or named a type DASH will not pin. */
  | "no_supported_key";

export type HostKeyScan =
  | { ok: true; offer: HostKeyOffer }
  | { ok: false; problem: HostKeyScanProblem };

/**
 * Read `ssh-keyscan` output into keys, discarding anything that is not one.
 *
 * The scanner writes comment lines to stdout (`# host:22 SSH-2.0-OpenSSH_9.6`)
 * and its diagnostics to stderr, so a comment is skipped rather than treated as
 * a failure. Everything else must be exactly three fields, and each is checked:
 *
 * - the type against the closed list above;
 * - the blob as base64 that round-trips, so a truncated line cannot become a
 *   fingerprint of something nobody has;
 * - **the type named inside the blob against the type named beside it**. An SSH
 *   public key blob begins with a length-prefixed copy of its own algorithm
 *   name, so a line claiming `ssh-ed25519` while carrying an RSA key is a line
 *   this function can catch and does. That mismatch is not a thing an honest
 *   sshd produces; the check costs four lines and closes the gap where a
 *   fingerprint could describe one key while `known_hosts` learns another.
 *
 * The host field is ignored entirely. `knownHostsLine` composes the pattern
 * from the record DASH already validated, so what the far end called itself
 * never reaches a file.
 */
export function parseScannedHostKeys(output: string): HostKeyScan {
  const keys: ScannedHostKey[] = [];
  let sawLine = false;

  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    sawLine = true;
    const fields = line.split(/\s+/);
    if (fields.length !== 3) {
      continue;
    }
    const [, type, blob] = fields as [string, string, string];
    if (!isHostKeyType(type) || !isBlobFor(type, blob)) {
      continue;
    }
    keys.push({ type, blob_base64: blob, fingerprint: hostKeyFingerprint(blob) });
  }

  if (keys.length === 0) {
    return { ok: false, problem: sawLine ? "no_supported_key" : "no_key_offered" };
  }
  return { ok: true, offer: { chosen: chooseHostKey(keys), offered: keys } };
}

/**
 * Which of several offered keys DASH pins, and therefore which fingerprint a
 * person is asked about.
 *
 * One, not all of them. Writing every offered key into `known_hosts` would mean
 * a person confirmed one fingerprint and DASH trusted four, which is the shape
 * of consent this whole flow exists to avoid. `ssh` orders its host-key
 * proposal by what the `known_hosts` file already holds, so pinning the single
 * strongest key is also what the connection then uses.
 */
export function chooseHostKey(keys: readonly ScannedHostKey[]): ScannedHostKey {
  const ranked = [...keys].sort(
    (left, right) => HOST_KEY_TYPES.indexOf(left.type) - HOST_KEY_TYPES.indexOf(right.type),
  );
  // `parseScannedHostKeys` never calls this with an empty list, and a caller
  // that did would get a type error rather than an undefined at runtime.
  return ranked[0] as ScannedHostKey;
}

/**
 * Does this blob actually carry the algorithm the line claims?
 *
 * The wire format is `uint32 length` then that many bytes of the algorithm
 * name. Reading those two is enough — the rest of the blob is the key material
 * and its shape is `ssh`'s business, not DASH's.
 */
function isBlobFor(type: HostKeyType, blob: string): boolean {
  // Base64 with no whitespace and no stray characters. `Buffer.from` is
  // famously forgiving, so the shape is checked before it is decoded.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(blob) || blob.length < 24) {
    return false;
  }
  const bytes = Buffer.from(blob, "base64");
  if (bytes.byteLength < 8) {
    return false;
  }
  const nameLength = bytes.readUInt32BE(0);
  if (nameLength === 0 || nameLength > 64 || bytes.byteLength < 4 + nameLength) {
    return false;
  }
  return bytes.subarray(4, 4 + nameLength).toString("utf8") === type;
}

/* ---------------------------------------------------------------------- *
 * The line that gets written
 * ---------------------------------------------------------------------- */

/**
 * The `known_hosts` line for one host and one key.
 *
 * The pattern comes from `hostPattern` — the record's own address and port,
 * both already through `checkHostRecord` — rather than from the scanner's
 * output, so the only strings in DASH's `known_hosts` are ones DASH validated.
 *
 * No trailing newline. `pinHostKey` joins lines and owns the file's shape,
 * because a function that returned "a line, plus a newline sometimes" is how a
 * file ends up with a blank line in the middle of it.
 */
export function knownHostsLine(pattern: string, key: ScannedHostKey): string {
  return `${pattern} ${key.type} ${key.blob_base64}`;
}

/**
 * Which lines in a `known_hosts` file are about this host.
 *
 * Used to answer two questions with one function: "is this host already pinned"
 * and "which lines does re-pinning replace". Matching is on the pattern field
 * only — a `known_hosts` entry is `pattern keytype blob` and the pattern is
 * what `ssh` looks up.
 *
 * Hashed entries (`|1|…`) are therefore never reached in practice, and that is
 * deliberate rather than incidental: DASH composes the pattern from its own
 * record, which is a plain address, so a hashed line in this file did not come
 * from here and is left exactly where it is.
 */
export function knownHostsEntriesFor(contents: string, pattern: string): string[] {
  return contents
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0 && line.split(/\s+/)[0] === pattern);
}

/**
 * What this host is called in a `known_hosts` file.
 *
 * OpenSSH's own rule, and it has to be exactly its own rule or the file DASH
 * writes is a file `ssh` does not read: a host on port 22 is written bare, and
 * a host on any other port is written `[host]:port`. IPv6 arrives bracketed
 * from the record — that is how a person writes one — and is unwrapped first so
 * the brackets in the result are the port form's, not the address's.
 */
export function hostPattern(address: string, port: number): string {
  const bare = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  return port === 22 ? bare : `[${bare}]:${String(port)}`;
}
