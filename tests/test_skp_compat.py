"""Regression tests for the pure SKP legacy texture-tail recovery helpers."""

import importlib.util
from pathlib import Path
import struct
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "custom_components/ha3d/skp_compat.py"
SPEC = importlib.util.spec_from_file_location("ha3d_skp_compat", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)

find_block = MODULE.find_legacy_texture_size_block
find_sizeless = MODULE.find_legacy_texture_tail_without_size
MARKER = b"\xff\xfe\xff"


def string_record(value: str) -> bytes:
    encoded = value.encode("utf-16-le")
    if len(value) >= 0xFF:
        raise ValueError("test helper only supports short strings")
    return MARKER + bytes([len(value)]) + encoded


def material_tail(filename: str) -> bytes:
    average = b"\x80\x80\x80\xff\x00\x80\x80\x80\xff"
    blob = b"\x00" * 8
    return (
        string_record(filename)
        + average
        + string_record("")
        + blob
        + struct.pack("<d", 0.0)
        + b"\x00"
    )


class SkpCompatTests(unittest.TestCase):
    def test_skips_false_filler_marker_and_finds_real_texture_tail(self):
        data = (
            b"X" * 24
            + string_record("")
            + b"\x00" * 13
            + struct.pack("<dd", 12.5, 25.0)
            + material_tail("brick.jpg")
        )

        recovered = find_block(data, 0)
        self.assertIsNotNone(recovered)
        size_pos, marker_pos, width, height, filename = recovered
        self.assertEqual(marker_pos, size_pos + 16)
        self.assertEqual(width, 12.5)
        self.assertEqual(height, 25.0)
        self.assertEqual(filename, "brick.jpg")

    def test_recovers_real_failure_shape_without_applied_size_pair(self):
        # Exact byte shape observed in apto3071.skp immediately after the
        # embedded CDib on 2026-09-29. There is no plausible pair of f64
        # applied sizes before the real UTF-16 filename marker at +29.
        opaque = bytes.fromhex(
            "00 00 00 00 00 00 00 00 00 00 00 00 00 "
            "12 80 05 80 00 00 00 07 80 00 00 00 00 00 00 00"
        )
        self.assertEqual(len(opaque), 29)
        data = opaque + material_tail("texture.jpg")

        self.assertIsNone(find_block(data, 0))
        recovered = find_sizeless(data, 0)
        self.assertIsNotNone(recovered)
        marker_pos, filename = recovered
        self.assertEqual(marker_pos, 29)
        self.assertEqual(filename, "texture.jpg")

    def test_rejects_marker_without_valid_material_tail(self):
        data = b"\x00" * 32 + string_record("not-a-texture-tail")
        self.assertIsNone(find_block(data, 0))
        self.assertIsNone(find_sizeless(data, 0))

    def test_rejects_tail_with_invalid_opacity_flag(self):
        average = b"\x80\x80\x80\xff\x00\x80\x80\x80\xff"
        data = (
            b"X" * 29
            + string_record("brick.jpg")
            + average
            + string_record("")
            + b"\x00" * 8
            + struct.pack("<d", 0.0)
            + b"\x07"
        )
        self.assertIsNone(find_sizeless(data, 0))


if __name__ == "__main__":
    unittest.main()
