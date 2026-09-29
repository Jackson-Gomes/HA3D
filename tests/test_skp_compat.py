"""Regression tests for HA3D's OpenSKP legacy-material compatibility helpers."""

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
decode_solid = MODULE.decode_legacy_solid_material_tail
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

    def test_apto3071_image1_nonzero_texflag_has_solid_payload(self):
        # Exact payload after Image1's texflag in the uploaded apto3071.skp:
        # 7f 7f 7f ff = RGBA, followed by an empty UTF-16 texture path,
        # 8 zero bytes, opacity 0.0 and use-opacity 0. OpenSKP 1.3.0 sees
        # texflag=0x0100 and incorrectly enters _texture_block instead.
        data = (
            bytes.fromhex("7f 7f 7f ff")
            + string_record("")
            + b"\x00" * 8
            + struct.pack("<d", 0.0)
            + b"\x00"
            + b"\x12\x80"  # next CMaterial class-ref in the real file
        )
        decoded = decode_solid(data, 0)
        self.assertIsNotNone(decoded)
        rgba, path, opacity, use_opacity, end = decoded
        self.assertEqual(rgba, b"\x7f\x7f\x7f\xff")
        self.assertEqual(path, "")
        self.assertEqual(opacity, 0.0)
        self.assertEqual(use_opacity, 0)
        self.assertEqual(end, len(data) - 2)

    def test_real_textured_material_shape_is_not_misclassified_as_solid(self):
        # Image3 in apto3071.skp begins after texflag with texture-pad bytes
        # and a CDib object reference, not RGBA + UTF-16 path.
        data = bytes.fromhex("00 00 03 80 01 00 00 00 31 df 01 00")
        self.assertIsNone(decode_solid(data, 0))

    def test_recovers_generic_texture_tail_without_applied_size_pair(self):
        opaque = b"\x11" * 29
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
