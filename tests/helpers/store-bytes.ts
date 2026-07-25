/**
 * Read everything SQLite has actually written, as one string.
 *
 * The point of this helper is the `-wal` file. In WAL mode a just-committed row
 * usually lives in the write-ahead log and has not been checkpointed into the
 * main database yet, so a redaction test that reads only `dash.sqlite` can pass
 * while the value it is hunting for sits in plain sight next to it. Scanning
 * the whole set is the only version of this test that means anything.
 *
 * Decoded as latin1 rather than utf8: SQLite pages are binary, and utf8
 * decoding replaces invalid sequences with U+FFFD, which could swallow part of
 * the very string we are looking for. latin1 is byte-preserving, so an ASCII
 * secret survives intact and is found if it is there.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Encode an expected string the same way `readStoreBytes` decodes.
 *
 * Needed for anything non-ASCII. A masked hint is `••••` — U+2022, three bytes
 * each in UTF-8 — so searching the latin1-decoded haystack for the JavaScript
 * string finds nothing even when the row is right there. Secrets themselves are
 * ASCII and round-trip either way, which is exactly why this is easy to get
 * wrong in the direction that makes a redaction test pass for the wrong reason.
 */
export function asStoredText(value: string): string {
  return Buffer.from(value, "utf8").toString("latin1");
}

export function readStoreBytes(dataDir: string): string {
  const base = path.join(dataDir, "dash.sqlite");
  return [base, `${base}-wal`, `${base}-shm`]
    .map((file) => {
      try {
        return readFileSync(file).toString("latin1");
      } catch {
        // A missing -wal or -shm just means nothing is pending. Not an error.
        return "";
      }
    })
    .join("\n");
}
