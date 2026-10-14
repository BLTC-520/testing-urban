import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { column, decodeTable } from "./binary";

// Written by tests/test_export.py (Python) — this checks the cross-language contract.
const buf = readFileSync(new URL("./__fixtures__/table.bin", import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

describe("decodeTable (Python → TypeScript contract)", () => {
  const t = decodeTable(ab);

  it("reads header and metadata", () => {
    expect(t.rows).toBe(5);
    expect(t.meta.city).toBe("test");
  });

  it("decodes float, scaled and nodata columns", () => {
    expect(Array.from(column(t, "pop"))).toEqual([1.5, 0, 1234.25, 7, 0.5]);
    const d = column(t, "d_groceries");
    expect(d[0]).toBe(0);
    expect(d[1]).toBe(120);
    expect(d[2]).toBe(6553);
    expect(Number.isNaN(d[3])).toBe(true); // NaN in Python
    expect(Number.isNaN(d[4])).toBe(true); // overflow → nodata
    expect(Array.from(column(t, "minutes")).map((x) => Math.round(x * 10) / 10)).toEqual([0.5, 1, 2.5, 3, 4]);
  });

  it("decodes 64-bit H3 indexes", () => {
    const h3 = t.raw.h3 as BigUint64Array;
    expect(h3[0].toString(16)).toBe("8a65b56628a7fff");
  });
});
