/**
 * The fingerprint a person is asked to compare, and the line that gets written
 * (MAR-572).
 *
 * The interesting assertion in this file is the first one, and it is worth
 * saying why. `hostKeyFingerprint` re-implements what `ssh-keygen -l` prints
 * rather than spawning it, so the string in the enrollment step is one this
 * repository computes. That is only safe if it is *identical* to OpenSSH's, so
 * the vector below was produced by OpenSSH itself:
 *
 * ```
 * $ ssh-keygen -q -t ed25519 -N "" -C vector -f hk
 * $ ssh-keygen -lf hk.pub
 * 256 SHA256:2Su8ZWuoW3XhTTa8bUjFLkevsVh3lqozGECLseaGbec vector (ED25519)
 * ```
 *
 * A change to that function that keeps the tests passing by changing the
 * expected string is a change that makes DASH show people a code their provider
 * will not show them.
 */

import { describe, expect, it } from "vitest";

import {
  HOST_KEY_TYPES,
  chooseHostKey,
  hostKeyFingerprint,
  hostPattern,
  knownHostsEntriesFor,
  knownHostsLine,
  parseScannedHostKeys,
  type ScannedHostKey,
} from "../lib/host-key";

/** An ed25519 host key and the fingerprint OpenSSH prints for it. */
const ED25519_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIEzfw+6qmw2XISBRAMGf2Gt1/sClsgY5tduInO/HiZtR";
const ED25519_FINGERPRINT = "SHA256:2Su8ZWuoW3XhTTa8bUjFLkevsVh3lqozGECLseaGbec";

/** An RSA one, from the same session, to prove the preference order is real. */
const RSA_BLOB =
  "AAAAB3NzaC1yc2EAAAADAQABAAABAQDovseXKp+g0PFTFoxW3B4BILmFFKhomcYlhyM7GU/jqwmVDALY1hTO" +
  "zsWCMXTseRmsa316QeROjj6SNysAfauafvT2j3t0VdHJdXz2JFa4kl6s82QNrMp0cm1Dng7t+XV8kHtLcLi8" +
  "EuV799Z5c8jxC05lk8eUm3XnwyCdx0ePdfaLwXqrnr0m/vwXylvwZEgQvHKjA2CnnQfXyotTUBRxFP54fHZn" +
  "quH3MXXcysHkGtNPkCF5U43YOz6YrRdXogw4W9QYj19JAY2yztpZ8TjZzOZMptXdSDArAPuFhvrLN4kxsu3+" +
  "/sLisvzhlRSYc/zsf654L+i2al9KjHAeG9J5";
const RSA_FINGERPRINT = "SHA256:TngzhI6vgeC3SIbOtzulAXLmWftKHpiUq6+0n4kckuM";

describe("hostKeyFingerprint", () => {
  it("prints what ssh-keygen prints", () => {
    expect(hostKeyFingerprint(ED25519_BLOB)).toBe(ED25519_FINGERPRINT);
    expect(hostKeyFingerprint(RSA_BLOB)).toBe(RSA_FINGERPRINT);
  });

  it("strips the base64 padding, as OpenSSH does", () => {
    // A digest is 32 bytes, whose base64 always ends in one `=`. A fingerprint
    // that kept it would differ by one character from every one a provider
    // shows — which is the difference between a person confirming a match and
    // a person deciding the mismatch is probably fine.
    expect(hostKeyFingerprint(ED25519_BLOB)).not.toContain("=");
  });
});

describe("parseScannedHostKeys", () => {
  it("reads what ssh-keyscan writes, comments and all", () => {
    const scan = parseScannedHostKeys(
      [
        "# 203.0.113.7:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5",
        `203.0.113.7 ssh-rsa ${RSA_BLOB}`,
        "# 203.0.113.7:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5",
        `203.0.113.7 ssh-ed25519 ${ED25519_BLOB}`,
        "",
      ].join("\n"),
    );

    expect(scan.ok).toBe(true);
    if (!scan.ok) {
      return;
    }
    expect(scan.offer.offered).toHaveLength(2);
    // Ed25519 wins over RSA no matter which order the host offered them in.
    expect(scan.offer.chosen.type).toBe("ssh-ed25519");
    expect(scan.offer.chosen.fingerprint).toBe(ED25519_FINGERPRINT);
  });

  it("says nothing answered differently from nothing usable", () => {
    // Two facts with two next actions: one sends somebody to check an address,
    // the other says this server offers no identity DASH knows how to check.
    expect(parseScannedHostKeys("")).toEqual({ ok: false, problem: "no_key_offered" });
    expect(parseScannedHostKeys("# only a comment\n")).toEqual({
      ok: false,
      problem: "no_key_offered",
    });
    expect(parseScannedHostKeys("host ssh-dss AAAAB3NzaC1kc3MAAACBAO\n")).toEqual({
      ok: false,
      problem: "no_supported_key",
    });
  });

  it("refuses a line whose blob is not the key it claims to be", () => {
    // The check nobody would think to write and the one that matters most: a
    // fingerprint must describe the key that gets pinned. An honest sshd never
    // produces this line, so admitting it would only ever help something that
    // is not one.
    const lying = parseScannedHostKeys(`203.0.113.7 ssh-ed25519 ${RSA_BLOB}`);
    expect(lying).toEqual({ ok: false, problem: "no_supported_key" });
  });

  it("refuses a truncated or non-base64 blob rather than fingerprinting it", () => {
    for (const blob of ["AAAA", "not base64 at all", `${ED25519_BLOB}!!`]) {
      expect(parseScannedHostKeys(`203.0.113.7 ssh-ed25519 ${blob}`).ok).toBe(false);
    }
  });
});

describe("chooseHostKey", () => {
  it("prefers the types in the order DASH declares them", () => {
    const keys: ScannedHostKey[] = [...HOST_KEY_TYPES]
      .reverse()
      .map((type) => ({ type, blob_base64: ED25519_BLOB, fingerprint: "SHA256:x" }));
    expect(chooseHostKey(keys).type).toBe("ssh-ed25519");
  });
});

describe("knownHostsLine and hostPattern", () => {
  it("writes the port form only when the port is not the default", () => {
    // OpenSSH's own rule, and it has to be exactly its own rule: a file written
    // any other way is one `ssh` does not read, and the failure would look
    // exactly like the unconfirmed-host wall this whole flow exists to remove.
    expect(hostPattern("example.com", 22)).toBe("example.com");
    expect(hostPattern("example.com", 2222)).toBe("[example.com]:2222");
  });

  it("unwraps a stored IPv6 address before deciding how to bracket it", () => {
    // The record stores IPv6 bracketed because that is how a person writes one.
    // The brackets in the port form are a different bracket doing a different
    // job, and doubling them would produce `[[::1]]:2222`.
    expect(hostPattern("[2001:db8::1]", 22)).toBe("2001:db8::1");
    expect(hostPattern("[2001:db8::1]", 2222)).toBe("[2001:db8::1]:2222");
  });

  it("composes a line ssh would recognise, from the record rather than the scan", () => {
    const line = knownHostsLine("example.com", {
      type: "ssh-ed25519",
      blob_base64: ED25519_BLOB,
      fingerprint: ED25519_FINGERPRINT,
    });
    expect(line).toBe(`example.com ssh-ed25519 ${ED25519_BLOB}`);
    expect(line).not.toContain("\n");
  });

  it("finds this host's entries and leaves everybody else's alone", () => {
    const file = [
      `other.example ssh-ed25519 ${ED25519_BLOB}`,
      `example.com ssh-ed25519 ${ED25519_BLOB}`,
      `|1|hashed+entry=|also+hashed= ssh-ed25519 ${ED25519_BLOB}`,
      "",
    ].join("\n");

    expect(knownHostsEntriesFor(file, "example.com")).toEqual([
      `example.com ssh-ed25519 ${ED25519_BLOB}`,
    ]);
    // A hashed entry did not come from DASH, which never hashes. Matching one
    // would mean quietly rewriting somebody's hand-edit.
    expect(knownHostsEntriesFor(file, "|1|hashed+entry=|also+hashed=")).toHaveLength(1);
    expect(knownHostsEntriesFor(file, "nobody.example")).toEqual([]);
  });
});
