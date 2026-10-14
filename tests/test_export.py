"""Binary table writer — also produces the fixture read by web/src/lib/binary.test.ts."""

import json
import struct
from pathlib import Path

import numpy as np

from sgjb.export import Col, quantize, write_table

FIXTURE = Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "__fixtures__" / "table.bin"


def make_fixture() -> Path:
    d = np.array([0.0, 120.4, 6553.0, np.nan, 70000.0])
    write_table(FIXTURE, {
        "h3": Col(np.array([0x8a65b56628a7fff, 0x8a65b5662887fff, 1, 2, 3], dtype=np.uint64), "biguint64"),
        "pop": Col(np.array([1.5, 0.0, 1234.25, 7.0, 0.5]), "float32"),
        "d_groceries": Col(quantize(d, "uint16", 1.0, 65535), "uint16", scale=1.0, nodata=65535),
        "minutes": Col(quantize(np.array([0.5, 1.0, 2.5, 3.0, 4.0]), "uint16", 0.1, 65535), "uint16", scale=0.1, nodata=65535),
    }, meta={"city": "test"})
    return FIXTURE


def test_header_and_alignment():
    p = make_fixture()
    b = p.read_bytes()
    assert b[:4] == b"SGJB"
    version, hlen = struct.unpack("<II", b[4:12])
    header = json.loads(b[12:12 + hlen])
    assert version == 1 and header["rows"] == 5
    data_start = -(-(12 + hlen) // 8) * 8
    for c in header["columns"]:
        assert (data_start + c["offset"]) % 8 == 0


def test_quantize_nodata_and_overflow():
    q = quantize(np.array([1.4, 1.6, np.nan, 1e9, -5]), "uint16", 1.0, 65535)
    assert q.tolist() == [1, 2, 65535, 65535, 65535]


def test_roundtrip_numpy():
    p = make_fixture()
    b = p.read_bytes()
    hlen = struct.unpack("<I", b[8:12])[0]
    header = json.loads(b[12:12 + hlen])
    start = -(-(12 + hlen) // 8) * 8
    col = {c["name"]: c for c in header["columns"]}
    pop = np.frombuffer(b, dtype="<f4", count=5, offset=start + col["pop"]["offset"])
    assert pop.tolist() == [1.5, 0.0, 1234.25, 7.0, 0.5]
