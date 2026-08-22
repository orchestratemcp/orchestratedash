#!/usr/bin/env node
/**
 * Read rows out of a `dash.sqlite` that SQLite refuses to open (MAR-700).
 *
 * ## Why this exists at all
 *
 * On 2026-08-19 the installed store was left with a header claiming 474 pages
 * over a file holding 356 — the signature of a process killed part-way through a
 * WAL checkpoint, which is when SQLite is copying pages back into the database
 * and has already written page 1's new size. Every statement against it, down to
 * `PRAGMA user_version`, answers `database disk image is malformed`. DASH's own
 * `readTolerantly` in `lib/db.ts` cannot help: it degrades a bulk read to a
 * row-at-a-time walk, and that still asks SQLite to open the file.
 *
 * The usual answer is `sqlite3 damaged.db .recover`. There is no `sqlite3` CLI on
 * the machine DASH is developed on, and adding one is a per-machine install to
 * stand between a person and their own history. The format does not require it:
 * a b-tree is walkable with a file handle and the varint rules, and a page that
 * is gone costs only the rows on that page. Run against the 08-19 file this
 * recovers **1,773 rows across 32 tables, losing 17 pages** — out of a file
 * SQLite will not read one byte of.
 *
 * It is also the reason the store's damage is diagnosable at all: the first
 * thing printed is the header's page count beside the file's real one, and a
 * physical count below the header's *names the cause*. Nothing else in the repo
 * reports that, and on 2026-08-22 it was what showed that the live store was
 * healthy and the brief's page numbers described the preserved evidence instead.
 *
 * ## What it does not do
 *
 * It does not write to the store it is reading, ever — it opens the file for
 * reading and holds no SQLite connection, so it is safe against a copy of a
 * store another process has locked. It does not repair a database; it produces
 * rows. Grafting those back is a separate, deliberate act, because a partially
 * recovered run is not the same thing as a run and only a person can say whether
 * they want one in their history.
 *
 * ## Usage
 *
 *   node scripts/salvage-store.mjs <file.sqlite> [--json <out>] [--grep <text>]
 *
 * Copy the main `.sqlite` **alone**, without its `-wal`/`-shm`, before pointing
 * this at a store that may still be open — a triplet copied while DASH is
 * running reports "malformed" for a perfectly healthy store.
 */

import { readFileSync, statSync, writeFileSync } from "node:fs";

/* ---------------------------------------------------------------------- *
 * The two primitives the format is built from
 * ---------------------------------------------------------------------- */

/**
 * SQLite's variable-length integer: seven bits per byte, most significant
 * first, with a ninth byte contributing a full eight.
 */
export function readVarint(buf, offset) {
  let value = 0n;
  for (let i = 0; i < 8; i++) {
    const byte = buf[offset + i];
    if (byte === undefined) {
      throw new Error("varint ran off the end of the page");
    }
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return [value, i + 1];
    }
  }
  const last = buf[offset + 8];
  if (last === undefined) {
    throw new Error("varint ran off the end of the page");
  }
  return [(value << 8n) | BigInt(last), 9];
}

/** How many bytes a serial type occupies. Types 10 and 11 are reserved. */
function serialWidth(type) {
  if (type === 0n || type === 8n || type === 9n || type === 10n || type === 11n) return 0;
  if (type <= 4n) return Number(type);
  if (type === 5n) return 6;
  if (type === 6n || type === 7n) return 8;
  return Number((type - 12n) / 2n);
}

function readSerial(buf, offset, type, utf8) {
  if (type === 0n) return null;
  if (type === 8n) return 0;
  if (type === 9n) return 1;
  if (type === 7n) return buf.readDoubleBE(offset);
  const width = serialWidth(type);
  if (type >= 1n && type <= 6n) {
    let value = 0n;
    for (let i = 0; i < width; i++) {
      value = (value << 8n) | BigInt(buf[offset + i]);
    }
    const bits = BigInt(width * 8);
    if (value >= 1n << (bits - 1n)) {
      value -= 1n << bits;
    }
    return value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : value;
  }
  const slice = buf.subarray(offset, offset + width);
  // Even types from 12 are BLOB, odd from 13 are TEXT in the file's encoding.
  return type % 2n === 0n ? slice : slice.toString(utf8 ? "utf8" : "utf16le");
}

/* ---------------------------------------------------------------------- *
 * The file
 * ---------------------------------------------------------------------- */

export class SalvageFile {
  constructor(filePath) {
    this.path = filePath;
    this.bytes = readFileSync(filePath);
    if (this.bytes.subarray(0, 15).toString("latin1") !== "SQLite format 3") {
      throw new Error(`${filePath} does not begin with the SQLite file header`);
    }
    const declared = this.bytes.readUInt16BE(16);
    this.pageSize = declared === 1 ? 65536 : declared;
    // Reserved bytes at the end of every page. Zero in DASH's store, but the
    // overflow arithmetic below is wrong without it on a store that has them.
    this.usable = this.pageSize - this.bytes.readUInt8(20);
    this.headerPages = this.bytes.readUInt32BE(28);
    this.physicalPages = Math.floor(statSync(filePath).size / this.pageSize);
    this.utf8 = this.bytes.readUInt32BE(56) !== 2 && this.bytes.readUInt32BE(56) !== 3;
    this.userVersion = this.bytes.readUInt32BE(60);
  }

  /** Pages are numbered from 1. Null when the page is past the end of the file. */
  page(n) {
    if (!Number.isInteger(n) || n < 1 || n > this.physicalPages) {
      return null;
    }
    const start = (n - 1) * this.pageSize;
    return this.bytes.subarray(start, start + this.pageSize);
  }

  /**
   * The b-tree node on a page, or null when the page is gone or is not one.
   *
   * Page 1 carries the hundred-byte file header before its b-tree header, which
   * is the single most common way a hand-written parser reads the schema as
   * garbage.
   */
  node(n) {
    const page = this.page(n);
    if (page === null) {
      return null;
    }
    const base = n === 1 ? 100 : 0;
    const type = page[base];
    if (type !== 0x02 && type !== 0x05 && type !== 0x0a && type !== 0x0d) {
      return null;
    }
    const interior = type === 0x02 || type === 0x05;
    const count = page.readUInt16BE(base + 3);
    const pointers = base + (interior ? 12 : 8);
    if (pointers + count * 2 > this.pageSize) {
      return null;
    }
    const cells = [];
    for (let i = 0; i < count; i++) {
      const at = page.readUInt16BE(pointers + i * 2);
      if (at > 0 && at < this.usable) {
        cells.push(at);
      }
    }
    return { page, type, interior, cells, rightMost: interior ? page.readUInt32BE(base + 8) : 0 };
  }

  /** Follow an overflow chain, stopping at the first page that is gone. */
  overflow(first, want) {
    const parts = [];
    const seen = new Set();
    let next = first;
    let got = 0;
    while (next !== 0 && got < want) {
      if (seen.has(next)) break; // a corrupt chain that points at itself
      seen.add(next);
      const page = this.page(next);
      if (page === null) {
        return { bytes: Buffer.concat(parts), complete: false };
      }
      next = page.readUInt32BE(0);
      const take = Math.min(this.usable - 4, want - got);
      parts.push(page.subarray(4, 4 + take));
      got += take;
    }
    return { bytes: Buffer.concat(parts), complete: got >= want };
  }

  /** One table-leaf cell: its rowid and its payload, overflow included. */
  cell(page, at) {
    let cursor = at;
    const [size, sizeLen] = readVarint(page, cursor);
    cursor += sizeLen;
    const [rowid, rowidLen] = readVarint(page, cursor);
    cursor += rowidLen;
    const total = Number(size);
    const maxLocal = this.usable - 35;
    if (total <= maxLocal) {
      return { rowid, payload: page.subarray(cursor, cursor + total), complete: true };
    }
    const minLocal = Math.floor(((this.usable - 12) * 32) / 255) - 23;
    let local = minLocal + ((total - minLocal) % (this.usable - 4));
    if (local > maxLocal) {
      local = minLocal;
    }
    const rest = this.overflow(page.readUInt32BE(cursor + local), total - local);
    return {
      rowid,
      payload: Buffer.concat([page.subarray(cursor, cursor + local), rest.bytes]),
      complete: rest.complete,
    };
  }

  /** A record payload as an array of values. `undefined` where bytes are gone. */
  decode(payload) {
    const [headerSize, headerLen] = readVarint(payload, 0);
    const types = [];
    let cursor = headerLen;
    while (cursor < Number(headerSize)) {
      const [type, len] = readVarint(payload, cursor);
      cursor += len;
      types.push(type);
    }
    let at = Number(headerSize);
    return types.map((type) => {
      const width = serialWidth(type);
      const value = at + width > payload.length ? undefined : readSerial(payload, at, type, this.utf8);
      at += width;
      return value;
    });
  }

  /**
   * Every row under `root`, skipping pages that are gone.
   *
   * Iterative rather than recursive, and `seen`-guarded, because a corrupt
   * interior page can point back up its own tree and a stack overflow would lose
   * the rows that were already in hand.
   */
  walk(root, onRow) {
    const stats = { rows: 0, lostPages: 0, badCells: 0, truncated: 0 };
    const seen = new Set();
    const stack = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === 0 || seen.has(n)) continue;
      seen.add(n);
      const node = this.node(n);
      if (node === null) {
        stats.lostPages++;
        continue;
      }
      if (node.interior) {
        stack.push(node.rightMost);
        for (const at of node.cells) {
          try {
            stack.push(node.page.readUInt32BE(at));
          } catch {
            stats.badCells++;
          }
        }
        continue;
      }
      if (node.type !== 0x0d) continue; // an index leaf carries no table rows
      for (const at of node.cells) {
        try {
          const cell = this.cell(node.page, at);
          if (!cell.complete) stats.truncated++;
          onRow(cell.rowid, this.decode(cell.payload), n);
          stats.rows++;
        } catch {
          stats.badCells++;
        }
      }
    }
    return stats;
  }

  /** The schema, from the b-tree rooted at page 1. */
  schema() {
    const entries = [];
    this.walk(1, (_rowid, values) => {
      entries.push({
        type: values[0],
        name: values[1],
        tbl_name: values[2],
        rootpage: Number(values[3] ?? 0),
        sql: values[4],
      });
    });
    return entries;
  }

  /** Every table-leaf page in the file, whether or not a b-tree reaches it. */
  *leafPages() {
    for (let n = 1; n <= this.physicalPages; n++) {
      const node = this.node(n);
      if (node !== null && node.type === 0x0d) {
        yield [n, node];
      }
    }
  }
}

/* ---------------------------------------------------------------------- *
 * Column names
 * ---------------------------------------------------------------------- */

/**
 * The column names and rowid alias out of a `CREATE TABLE`.
 *
 * **Comments are stripped first, and that is not a nicety.** DASH's DDL is
 * heavily commented — `events` opens with `-- Arrival order, which is what the
 * JSON store's array index used to mean.` — and a splitter that does not remove
 * them takes `--` as the first column's name and shifts every label in the
 * output by one. That produces a report which looks like data and is a lie
 * about which value is which.
 *
 * An `INTEGER PRIMARY KEY` column is an alias for the rowid and is stored as
 * NULL in the record, so it is reported separately and filled in from the rowid.
 */
export function parseColumns(sql) {
  if (typeof sql !== "string") {
    return { columns: [], rowidAlias: null };
  }
  const clean = sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const open = clean.indexOf("(");
  if (open < 0) {
    return { columns: [], rowidAlias: null };
  }
  const body = clean.slice(open + 1, clean.lastIndexOf(")"));
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);

  const constraints = new Set(["primary", "unique", "check", "foreign", "constraint"]);
  const columns = [];
  let rowidAlias = null;
  for (const part of parts) {
    const trimmed = part.trim().replace(/\s+/g, " ");
    if (trimmed.length === 0) continue;
    const first = trimmed.split(" ")[0];
    if (constraints.has(first.toLowerCase())) continue;
    const name = first.replace(/^["'`[]|["'`\]]$/g, "");
    columns.push(name);
    if (/\bINTEGER\s+PRIMARY\s+KEY\b/i.test(trimmed)) {
      rowidAlias = name;
    }
  }
  return { columns, rowidAlias };
}

/* ---------------------------------------------------------------------- *
 * The command
 * ---------------------------------------------------------------------- */

/**
 * One positional path plus two valued options, in one left-to-right pass.
 *
 * A pass rather than `indexOf`, which finds the *first* occurrence of a value
 * and would mistake a filename that happens to equal an earlier option's
 * argument for the option itself.
 */
function parseArgv(argv) {
  const options = { target: null, jsonOut: null, needle: null };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--json" || argument === "--grep") {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`${argument} needs a value`);
      }
      if (argument === "--json") options.jsonOut = value;
      else options.needle = value;
      i++;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`unknown option ${argument}`);
    }
    if (options.target !== null) {
      throw new Error("only one file can be salvaged at a time");
    }
    options.target = argument;
  }
  return options;
}

function main(argv) {
  let target;
  let jsonOut;
  let needle;
  try {
    ({ target, jsonOut, needle } = parseArgv(argv));
  } catch (error) {
    console.error(`${error.message}`);
    target = null;
  }
  if (target === null) {
    console.error("usage: node scripts/salvage-store.mjs <file.sqlite> [--json <out>] [--grep <text>]");
    return 2;
  }

  const file = new SalvageFile(target);
  const missing = Math.max(0, file.headerPages - file.physicalPages);

  console.log(`file:         ${file.path}`);
  console.log(`page size:    ${file.pageSize}`);
  console.log(`user_version: ${file.userVersion}`);
  console.log(`pages:        header claims ${file.headerPages}, file holds ${file.physicalPages}`);
  if (missing > 0) {
    // The signature worth recognising on sight: page 1 carries the new size and
    // the pages it counts were never written. That is a checkpoint that was
    // interrupted, not a bad disk.
    console.log(`              *** ${missing} pages missing — truncated mid-checkpoint ***`);
  } else {
    console.log(`              (consistent — this file is not truncated)`);
  }

  const schema = file.schema();
  const tables = schema.filter((e) => e.type === "table" && e.rootpage > 0);
  console.log(`schema:       ${schema.length} entries, ${tables.length} tables\n`);

  const recovered = {};
  const hits = [];
  const reachable = new Set();
  let totalRows = 0;
  let totalLost = 0;

  console.log("table                              rows   lost pages   bad cells   truncated");
  console.log("-".repeat(78));
  for (const table of [...tables].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    const { columns, rowidAlias } = parseColumns(table.sql);
    const rows = [];
    const stats = file.walk(table.rootpage, (rowid, values, page) => {
      reachable.add(page);
      const named = {};
      columns.forEach((column, i) => {
        const value = values[i];
        named[column] =
          column === rowidAlias && (value === null || value === undefined)
            ? Number(rowid)
            : Buffer.isBuffer(value)
              ? { $blob_bytes: value.length }
              : typeof value === "bigint"
                ? value.toString()
                : value;
      });
      rows.push(named);
      if (needle !== null && values.some((v) => typeof v === "string" && v.includes(needle))) {
        hits.push({ table: table.name, row: named });
      }
    });
    recovered[table.name] = rows;
    totalRows += stats.rows;
    totalLost += stats.lostPages;
    console.log(
      `${String(table.name).padEnd(32)} ${String(stats.rows).padStart(6)} ${String(stats.lostPages).padStart(12)} ` +
        `${String(stats.badCells).padStart(11)} ${String(stats.truncated).padStart(11)}`,
    );
  }
  console.log("-".repeat(78));
  console.log(`TOTAL                          ${String(totalRows).padStart(6)} ${String(totalLost).padStart(12)}\n`);

  // Pages no root reached. A lost interior page orphans its leaves, and their
  // rows are still readable even though nothing points at them any more.
  let orphanPages = 0;
  let orphanRows = 0;
  for (const [n, node] of file.leafPages()) {
    if (reachable.has(n)) continue;
    orphanPages++;
    for (const at of node.cells) {
      try {
        file.decode(file.cell(node.page, at).payload);
        orphanRows++;
      } catch {
        /* an unreadable cell on a page nothing points at */
      }
    }
  }
  console.log(`orphan leaf pages: ${orphanPages} (rows on them: ${orphanRows})`);

  if (needle !== null) {
    console.log(`\nrows containing ${JSON.stringify(needle)}: ${hits.length}`);
    for (const hit of hits) {
      console.log(`  [${hit.table}] ${JSON.stringify(hit.row).slice(0, 400)}`);
    }
  }

  if (jsonOut !== null) {
    writeFileSync(
      jsonOut,
      `${JSON.stringify(
        {
          source: file.path,
          salvaged_from: {
            user_version: file.userVersion,
            header_pages: file.headerPages,
            physical_pages: file.physicalPages,
            missing_pages: missing,
          },
          total_rows: totalRows,
          lost_pages: totalLost,
          tables: recovered,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(`\nwrote ${totalRows} rows to ${jsonOut}`);
  }

  return 0;
}

process.exitCode = main(process.argv.slice(2));
