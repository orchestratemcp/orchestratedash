/**
 * A dependency-free solid-color PNG encoder, for the MSIX tile assets MAR-429
 * needs (`Square44x44Logo`, `Square150x150Logo`, `StoreLogo`) and the repo has
 * never had — there is no DASH product icon yet, and this is a self-signed
 * test package, not a Store listing. Pulling in an image library for three
 * flat squares would be a strange kind of scope creep for "the smallest
 * private/test MSIX", so this writes the handful of PNG chunks by hand:
 * signature, `IHDR`, one `IDAT` (an 8-bit RGBA bitmap through
 * `zlib.deflateSync`, which is exactly what a PNG's compressed stream is),
 * `IEND`. When the real DASH icon exists, this whole module goes away and
 * `scripts/package-msix.mjs` points at the real asset instead.
 */

import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** The CRC-32 PNG's spec requires on every chunk's type + data. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * A flat `width` x `height` PNG, one solid color, 8-bit RGBA, no interlacing,
 * no filtering beyond "none" per scanline (filter type 0 — there is nothing
 * to gain from a smarter filter on a solid color, and "none" is the simplest
 * one to get right by hand).
 */
export function generatePlaceholderPng(width: number, height: number, color: RgbaColor): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(
      `generatePlaceholderPng needs positive integer dimensions, got ${String(width)}x${String(height)}.`,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type 6: truecolor with alpha
  ihdr[10] = 0; // compression method: the only one PNG defines
  ihdr[11] = 0; // filter method: the only one PNG defines
  ihdr[12] = 0; // interlace method: none

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // per-scanline filter type: none
    for (let x = 0; x < width; x += 1) {
      const offset = rowStart + 1 + x * 4;
      raw[offset] = color.r;
      raw[offset + 1] = color.g;
      raw[offset + 2] = color.b;
      raw[offset + 3] = color.a;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
