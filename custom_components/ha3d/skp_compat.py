from __future__ import annotations

import logging
import math
import struct
from typing import Optional

_LOGGER = logging.getLogger(__name__)
_STR_MARKER = b"\xff\xfe\xff"
_MAX_TEXTURE_TAIL_SCAN = 4096
_MIN_APPLIED_SIZE = 1e-12
_MAX_APPLIED_SIZE = 1e12
_FALLBACK_APPLIED_SIZE = 1.0


def _decode_utf16_record(data: bytes, marker: int) -> Optional[tuple[str, int]]:
    """Decode one OpenSKP/MFC UTF-16 record without moving a parser cursor."""
    if marker < 0 or data[marker:marker + 3] != _STR_MARKER:
        return None

    pos = marker + 3
    if pos >= len(data):
        return None

    length = data[pos]
    pos += 1
    if length == 0xFF:
        if pos + 2 > len(data):
            return None
        length = struct.unpack_from("<H", data, pos)[0]
        pos += 2
        if length == 0xFFFF:
            if pos + 4 > len(data):
                return None
            length = struct.unpack_from("<I", data, pos)[0]
            pos += 4

    # A texture/source path can be long, but an absurd record length is a
    # strong sign that a random ff-fe-ff byte sequence was mistaken for a
    # string marker while scanning opaque legacy data.
    if length > 32768:
        return None

    end = pos + 2 * length
    if end > len(data):
        return None

    return data[pos:end].decode("utf-16-le", errors="replace"), end


def _plausible_applied_size(value: float) -> bool:
    return math.isfinite(value) and _MIN_APPLIED_SIZE <= abs(value) <= _MAX_APPLIED_SIZE


def _plausible_texture_filename(value: str) -> bool:
    if len(value) > 32768:
        return False
    return not any(ord(char) < 0x20 and char not in "\t\r\n" for char in value)


def _validate_material_tail_after_filename(
    data: bytes,
    after_filename: int,
) -> Optional[int]:
    """Validate the bytes following a legacy texture filename.

    The legacy material tail is unusually distinctive:
      RGBA + 00 + RGBA, one UTF-16 record, two u32 values, opacity:f64,
      use-opacity:u8.

    Returning the end position lets the caller distinguish a real filename
    marker from ff-fe-ff sequences that happen to occur inside opaque data.
    """
    if after_filename + 9 > len(data):
        return None

    average = data[after_filename:after_filename + 9]
    if average[4] != 0:
        return None
    # Real files store the colour twice. Alpha can differ on colorized
    # materials, so compare RGB only.
    if average[:3] != average[5:8]:
        return None

    second_marker = after_filename + 9
    second_record = _decode_utf16_record(data, second_marker)
    if second_record is None:
        return None

    _, after_second = second_record
    if after_second + 17 > len(data):
        return None

    try:
        opacity = struct.unpack_from("<d", data, after_second + 8)[0]
    except struct.error:
        return None
    use_opacity = data[after_second + 16]

    if not math.isfinite(opacity) or not -1e-6 <= opacity <= 1.000001:
        return None
    if use_opacity not in (0, 1):
        return None

    return after_second + 17


def find_legacy_texture_size_block(
    data: bytes,
    pos: int,
    *,
    max_scan: int = _MAX_TEXTURE_TAIL_SCAN,
) -> Optional[tuple[int, int, float, float, str]]:
    """Find a legacy texture filename preceded by two valid applied-size f64s."""
    if pos < 0 or pos >= len(data):
        return None

    scan_end = min(len(data), pos + max_scan)
    marker = data.find(_STR_MARKER, pos + 1, scan_end)

    while marker >= 0:
        size_pos = marker - 16
        if size_pos >= pos:
            try:
                width, height = struct.unpack_from("<dd", data, size_pos)
            except struct.error:
                width = height = 0.0

            if _plausible_applied_size(width) and _plausible_applied_size(height):
                filename_record = _decode_utf16_record(data, marker)
                if filename_record is not None:
                    filename, after_filename = filename_record
                    if (
                        _plausible_texture_filename(filename)
                        and _validate_material_tail_after_filename(data, after_filename)
                        is not None
                    ):
                        return size_pos, marker, width, height, filename

        marker = data.find(_STR_MARKER, marker + 1, scan_end)

    return None


def find_legacy_texture_tail_without_size(
    data: bytes,
    pos: int,
    *,
    max_scan: int = _MAX_TEXTURE_TAIL_SCAN,
) -> Optional[tuple[int, str]]:
    """Find a complete legacy texture tail even when applied size is absent.

    Some real SketchUp legacy files contain an opaque/object-reference record
    between CDib and the texture filename instead of OpenSKP's expected
    ``[optional u32] + width:f64 + height:f64`` sequence. In that case there
    is no safe way to invent the missing model-space tile size, but the rest
    of the material is still parseable and the embedded texture can be kept.
    """
    if pos < 0 or pos >= len(data):
        return None

    scan_end = min(len(data), pos + max_scan)
    marker = data.find(_STR_MARKER, pos + 1, scan_end)

    while marker >= 0:
        filename_record = _decode_utf16_record(data, marker)
        if filename_record is not None:
            filename, after_filename = filename_record
            if (
                _plausible_texture_filename(filename)
                and _validate_material_tail_after_filename(data, after_filename)
                is not None
            ):
                return marker, filename

        marker = data.find(_STR_MARKER, marker + 1, scan_end)

    return None


def install_openskp_legacy_texture_workaround() -> bool:
    """Patch OpenSKP 1.3.x's private legacy texture reader in-process."""
    from openskp import legacy

    current = getattr(legacy, "_texture_block", None)
    if current is None:
        return False
    if getattr(current, "__ha3d_texture_compat__", False):
        return True

    def _texture_block_compat(ar, r):
        r.raw(2 if ar.ver >= 17 else 1)  # texture flag pad
        slot, _, dib = ar.read_object(r, expect="CDib")
        if not (isinstance(dib, dict) and dib.get("k") == "dib"):
            raise legacy.LegacyParseError(f"texture object is not a dib {r.ctx()}")

        width: Optional[float] = None
        height: Optional[float] = None
        sizeless_recovery = False

        marker = r.data.find(_STR_MARKER, r.pos, r.pos + 28)
        delta = marker - r.pos
        if delta == 20:
            r.u32()
        elif delta != 16:
            recovered = find_legacy_texture_size_block(r.data, r.pos)
            if recovered is not None:
                size_pos, marker, width, height, filename = recovered
                skipped = size_pos - r.pos
                _LOGGER.warning(
                    "HA3D recovered legacy SKP texture size block at %#x: "
                    "skipped %d opaque bytes, applied size %.6g x %.6g, file=%r",
                    r.pos,
                    skipped,
                    width,
                    height,
                    filename,
                )
                r.pos = size_pos
            else:
                sizeless = find_legacy_texture_tail_without_size(r.data, r.pos)
                if sizeless is None:
                    raise legacy.LegacyParseError(f"texture size block misaligned {r.ctx()}")

                marker, filename = sizeless
                skipped = marker - r.pos
                width = _FALLBACK_APPLIED_SIZE
                height = _FALLBACK_APPLIED_SIZE
                sizeless_recovery = True
                _LOGGER.warning(
                    "HA3D recovered legacy SKP texture without applied-size pair "
                    "at %#x: skipped %d opaque bytes, file=%r. Using %.3g x %.3g "
                    "tile size; texture mapping scale may differ from SketchUp.",
                    r.pos,
                    skipped,
                    filename,
                    width,
                    height,
                )
                r.pos = marker

        if not sizeless_recovery:
            width = r.f64()
            height = r.f64()

        filename = r.utf16()
        average = r.raw(9)  # RGBA + 00 + RGBA
        r.utf16()
        blob = r.raw(8)  # u32 + u32 colorized flag
        opacity = r.f64()
        use_opacity = r.u8()
        colorized = bool(blob[4]) or average[3] == 0xFF

        return {
            "rgba": tuple(average[:4]),
            "opacity": opacity,
            "use_opacity": use_opacity,
            "tex_dib": slot,
            "tex_w": width,
            "tex_h": height,
            "tex_file": filename,
            "colorized": colorized,
        }

    _texture_block_compat.__ha3d_texture_compat__ = True
    legacy._texture_block = _texture_block_compat
    _LOGGER.info("HA3D enabled OpenSKP legacy texture compatibility reader")
    return True
