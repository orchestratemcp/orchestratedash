import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { generatePlaceholderPng } from "../lib/shell/placeholder-icon";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Walks the chunk list of a PNG buffer without trusting anything but length prefixes. */
function readChunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length; // length + type + data + crc
  }
  return chunks;
}

describe("generatePlaceholderPng", () => {
  it("starts with the PNG signature", () => {
    const png = generatePlaceholderPng(44, 44, { r: 10, g: 20, b: 30, a: 255 });
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it("declares the requested width and height in IHDR", () => {
    const png = generatePlaceholderPng(150, 44, { r: 1, g: 2, b: 3, a: 255 });
    const ihdr = readChunks(png).find((c) => c.type === "IHDR");
    expect(ihdr).toBeDefined();
    expect(ihdr!.data.readUInt32BE(0)).toBe(150);
    expect(ihdr!.data.readUInt32BE(4)).toBe(44);
    expect(ihdr!.data[8]).toBe(8); // bit depth
    expect(ihdr!.data[9]).toBe(6); // RGBA color type
  });

  it("round-trips every pixel back to the requested solid color", () => {
    const width = 12;
    const height = 9;
    const color = { r: 91, g: 12, b: 200, a: 128 };
    const png = generatePlaceholderPng(width, height, color);

    const idat = readChunks(png).find((c) => c.type === "IDAT");
    expect(idat).toBeDefined();
    const raw = inflateSync(idat!.data);

    const stride = width * 4;
    expect(raw.length).toBe((stride + 1) * height);

    for (let y = 0; y < height; y += 1) {
      const rowStart = y * (stride + 1);
      expect(raw[rowStart]).toBe(0); // filter byte
      for (let x = 0; x < width; x += 1) {
        const offset = rowStart + 1 + x * 4;
        expect([raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]]).toEqual([
          color.r,
          color.g,
          color.b,
          color.a,
        ]);
      }
    }
  });

  it("ends with an empty IEND chunk", () => {
    const png = generatePlaceholderPng(44, 44, { r: 0, g: 0, b: 0, a: 255 });
    const iend = readChunks(png).at(-1);
    expect(iend?.type).toBe("IEND");
    expect(iend?.data.length).toBe(0);
  });

  it("rejects non-positive or non-integer dimensions", () => {
    expect(() => generatePlaceholderPng(0, 44, { r: 0, g: 0, b: 0, a: 255 })).toThrow(/positive integer/);
    expect(() => generatePlaceholderPng(44, -1, { r: 0, g: 0, b: 0, a: 255 })).toThrow(/positive integer/);
    expect(() => generatePlaceholderPng(44.5, 44, { r: 0, g: 0, b: 0, a: 255 })).toThrow(/positive integer/);
  });
});
