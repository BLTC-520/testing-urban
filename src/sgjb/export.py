"""Writers for the static artifacts consumed by the web app (web/public/data).

Binary tables ("SGJB" format) are columnar, little-endian and 8-byte aligned so
the browser can view each column as a typed array without copying:

    b"SGJB" | u32 version | u32 header_bytes | header JSON | pad to 8 | columns…

The format is decoded by web/src/lib/binary.ts; tests/test_export.py writes a
fixture that web/src/lib/binary.test.ts reads back.
"""

from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

VERSION = 1
DTYPES = {
    "float32": np.float32, "float64": np.float64, "uint8": np.uint8, "uint16": np.uint16, "int16": np.int16,
    "uint32": np.uint32, "int32": np.int32, "biguint64": np.uint64,
}


@dataclass
class Col:
    values: np.ndarray
    dtype: str
    scale: float | None = None
    nodata: int | float | None = None


def quantize(values: np.ndarray, dtype: str, scale: float, nodata: int) -> np.ndarray:
    """Store ``values / scale`` rounded into an integer dtype; NaN/inf/overflow → nodata."""
    info = np.iinfo(DTYPES[dtype])
    v = np.asarray(values, dtype=np.float64) / scale
    ok = np.isfinite(v)
    q = np.where(ok, np.rint(v), nodata)
    q = np.where(ok & ((q < info.min) | (q > info.max) | (q == nodata)), nodata, q)
    return q.astype(DTYPES[dtype])


def write_table(path: Path, columns: dict[str, Col], meta: dict[str, Any] | None = None) -> int:
    rows = {len(c.values) for c in columns.values()}
    if len(rows) > 1:
        raise ValueError(f"columns differ in length: {rows}")
    n = rows.pop() if rows else 0
    specs, blobs, offset = [], [], 0
    for name, c in columns.items():
        arr = np.ascontiguousarray(c.values, dtype=DTYPES[c.dtype]).astype(np.dtype(DTYPES[c.dtype]).newbyteorder("<"))
        spec: dict[str, Any] = {"name": name, "dtype": c.dtype, "offset": offset, "length": int(len(arr))}
        if c.scale is not None:
            spec["scale"] = c.scale
        if c.nodata is not None:
            spec["nodata"] = c.nodata
        specs.append(spec)
        b = arr.tobytes()
        pad = (-len(b)) % 8
        blobs.append(b + b"\0" * pad)
        offset += len(b) + pad
    header = json.dumps({"rows": n, "columns": specs, "meta": meta or {}}, separators=(",", ":"),
                        allow_nan=False).encode()
    head = b"SGJB" + struct.pack("<II", VERSION, len(header)) + header
    head += b"\0" * ((-len(head)) % 8)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = head + b"".join(blobs)
    path.write_bytes(data)
    return len(data)


def write_json(path: Path, obj: Any) -> int:
    def clean(o):
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [clean(v) for v in o]
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating, float)):
            f = float(o)
            return None if not math.isfinite(f) else round(f, 6)
        if isinstance(o, np.ndarray):
            return clean(o.tolist())
        if isinstance(o, (np.bool_,)):
            return bool(o)
        return o

    path.parent.mkdir(parents=True, exist_ok=True)
    s = json.dumps(clean(obj), separators=(",", ":"), ensure_ascii=False)
    path.write_text(s, encoding="utf-8")
    return len(s)
