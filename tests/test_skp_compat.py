"""Regression tests for the pure SKP legacy texture-tail recovery helper."""

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
MARKER = b"\xff\xfe\xff"


def string_record(value: str) -> bytes:
    encoded = value.encode("utf-16-le")
    if len(value) >= 0xFF:
        raise ValueError("test helper only supports short strings")
    return MARKER + bytes([len(value)]) + encoded


class SkpCompatTests(unittest.TestCase):
    def test_skips_false_filler_marker_and_finds_real_texture_tail(self):
        # Reproduces the important shape of the real failure: the first
        # marker after the CDib is not the texture filename. A later marker
        # is preceded by the real two-f64 applied-size block.
        data = (
            b"X" * 24
            + string_record("")
            + b"\x00" * 13
            + struct.pack("<dd", 12.5, 25.0)
            + string_record("brick.jpg")
            + b"\x80\x80\x80\xff\x00\x80\x80\x80\xff"
            + string_record("")
            + b"\x00" * 17
        )

        recovered = find_block(data, 0)
        self.assertIsNotNone(recovered)
        size_pos, marker_pos, width, height, filename = recovered
        self.assertEqual(marker_pos, size_pos + 16)
        self.assertEqual(width, 12.5)
        self.assertEqual(height, 25.0)
        self.assertEqual(filename, "brick.jpg")

    def test_rejects_marker_without_valid_material_tail(self):
        data = b"\x00" * 32 + string_record("not-a-texture-tail")
        self.assertIsNone(find_block(data, 0))


if __name__ == "__main__":
    unittest.main()
