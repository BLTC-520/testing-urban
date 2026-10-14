/**
 * Columnar binary tables written by the pipeline (sgjb.export).
 *
 * Layout:  "SGJB" | u32 version | u32 headerBytes | header JSON | padding to 8 | column bytes…
 * Columns are little-endian typed arrays at 8-byte-aligned offsets relative to
 * the start of the data section, so they can be viewed without copying.
 */

export type DType = "float32" | "float64" | "uint8" | "uint16" | "int16" | "uint32" | "int32" | "biguint64";

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
  | Float32Array
  | Float64Array
  | Uint8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | BigUint64Array;

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
  const headerBytes = dv.getUint32(8, true);
  const header: TableHeader = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, headerBytes)));
  const dataStart = Math.ceil((12 + headerBytes) / 8) * 8;
  const raw: Record<string, TypedArray> = {};
  const specs: Record<string, ColumnSpec> = {};
  for (const c of header.columns) {
    const Ctor = CTORS[c.dtype];
    raw[c.name] = new Ctor(buf, dataStart + c.offset, c.length) as TypedArray;
    specs[c.name] = c;
  }
  return { rows: header.rows, meta: header.meta ?? {}, specs, raw };
}

/** Physical values of a numeric column as Float64 (nodata → NaN). */
export function column(t: Table, name: string): Float64Array {
  const spec = t.specs[name];
  const src = t.raw[name];
  if (!spec || !src) throw new Error(`missing column ${name}`);
  if (spec.dtype === "biguint64") throw new Error(`column ${name} is 64-bit; use raw access`);
  const out = new Float64Array(t.rows);
  const scale = spec.scale ?? 1;
  const nd = spec.nodata;
  const s = src as Exclude<TypedArray, BigUint64Array>;
  for (let i = 0; i < t.rows; i++) {
    const v = s[i];
    out[i] = nd !== undefined && v === nd ? NaN : v * scale;
  }
  return out;
}

export async function fetchTable(url: string, signal?: AbortSignal): Promise<Table> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return decodeTable(await res.arrayBuffer());
}
