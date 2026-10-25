/**
 * Node-side reader for the columnar "SGJB" tables written by the Python
 * pipeline (src/sgjb/export.py).
 *
 * This is a deliberate copy of the browser reader in web/src/lib/binary.ts
 * rather than an import: /server must not depend on /web, so that either can
 * be built, moved or deleted without touching the other. The format is frozen
 * (magic + version are checked below), so the duplication is ~60 lines that
 * will not drift.
 *
 * Layout:  "SGJB" | u32 version | u32 headerBytes | header JSON | pad to 8 | column bytes…
 * Columns are little-endian typed arrays at 8-byte-aligned offsets relative to
 * the start of the data section.
 */
import { readFileSync } from "node:fs";

export type DType =
  | "float32" | "float64" | "uint8" | "uint16"
  | "int16" | "uint32" | "int32" | "biguint64";

export interface ColumnSpec {
  name: string;
  dtype: DType;
  offset: number;
  length: number;
  /** Physical value = stored * scale. */
  scale?: number;
  /** Stored value representing "missing". */
  nodata?: number;
}

export interface TableHeader {
  rows: number;
  columns: ColumnSpec[];
  meta?: Record<string, unknown>;
}

export type TypedArray =
  | Float32Array | Float64Array | Uint8Array | Uint16Array
  | Int16Array | Uint32Array | Int32Array | BigUint64Array;

export interface Table {
  rows: number;
  meta: Record<string, unknown>;
  specs: Record<string, ColumnSpec>;
  raw: Record<string, TypedArray>;
}

const CTORS = {
  float32: Float32Array,
  float64: Float64Array,
  uint8: Uint8Array,
  uint16: Uint16Array,
  int16: Int16Array,
  uint32: Uint32Array,
  int32: Int32Array,
  biguint64: BigUint64Array,
} as const;

export function decodeTable(buf: ArrayBuffer): Table {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== "SGJB") throw new Error(`not an SGJB table (magic ${magic})`);
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new Error(`unsupported SGJB table version ${version}`);
  const headerBytes = dv.getUint32(8, true);
  const header: TableHeader = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, headerBytes)));
  const dataStart = Math.ceil((12 + headerBytes) / 8) * 8;
  const raw: Record<string, TypedArray> = {};
  const specs: Record<string, ColumnSpec> = {};
  for (const c of header.columns) {
    raw[c.name] = new CTORS[c.dtype](buf, dataStart + c.offset, c.length) as TypedArray;
    specs[c.name] = c;
  }
  return { rows: header.rows, meta: header.meta ?? {}, specs, raw };
}

export function readTable(path: string): Table {
  const b = readFileSync(path);
  // Copy out of the Buffer pool: Buffer views share a larger ArrayBuffer whose
  // byteOffset would break the 8-byte alignment the column offsets assume.
  return decodeTable(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
}

/**
 * One uint16 distance column as physical values, with `nodata` mapped to null.
 *
 * `nodata` (65535) means "no destination of this kind within the pipeline's
 * 60-minute search cap, or this cell is not on the walk network". It is NOT
 * zero, so it must never be stored as a number — null is the only honest
 * representation, and it keeps SQL aggregates (AVG, COUNT) correct for free.
 */
export function distanceColumn(t: Table, name: string): (number | null)[] {
  const spec = t.specs[name];
  const src = t.raw[name] as Uint16Array | undefined;
  if (!spec || !src) throw new Error(`missing column ${name}`);
  const nd = spec.nodata ?? 65535;
  const scale = spec.scale ?? 1;
  const out = new Array<number | null>(t.rows);
  for (let i = 0; i < t.rows; i++) out[i] = src[i] === nd ? null : src[i] * scale;
  return out;
}

/** H3 cell ids as the lowercase hex strings h3-js and deck.gl expect. */
export function h3Column(t: Table): string[] {
  const src = t.raw.h3 as BigUint64Array | undefined;
  if (!src) throw new Error("missing column h3");
  const out = new Array<string>(t.rows);
  for (let i = 0; i < t.rows; i++) out[i] = src[i].toString(16);
  return out;
}
