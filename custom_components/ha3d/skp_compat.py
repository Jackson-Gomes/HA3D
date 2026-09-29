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

    end = pos + 2 * length
    if end > len(data):
        return None

    return data[pos:end].decode("utf-16-le", errors="replace"), end


def _plausible_applied_size(value: float) -> bool:
    return math.isfinite(value) and _MIN_APPLIED_SIZE <= abs(value) <= _MAX_APPLIED_SIZE


def find_legacy_texture_size_block(
    data: bytes,
    pos: int,
    *,
    max_scan: int = _MAX_TEXTURE_TAIL_SCAN,
) -> Optional[tuple[int, int, float, float, str]]:
    """Find a structurally valid legacy texture size/name block after *pos*.

    OpenSKP 1.3.0 only accepts the texture filename marker exactly 16 or
    20 bytes after the embedded CDib. Real legacy SKP files can contain an
    extra opaque/filler record there. Search farther ahead and only accept a
    candidate when the surrounding material-tail structure also validates.
    """
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
                    second_marker = after_filename + 9
                    second_record = _decode_utf16_record(data, second_marker)
                    if second_record is not None:
                        _, after_second = second_record
                        # blob:u32+u32 + opacity:f64 + use-opacity:u8
                        if after_second + 17 <= len(data):
                            return size_pos, marker, width, height, filename

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

        marker = r.data.find(_STR_MARKER, r.pos, r.pos + 28)
        delta = marker - r.pos
        if delta == 20:
            r.u32()
        elif delta != 16:
            recovered = find_legacy_texture_size_block(r.data, r.pos)
            if recovered is None:
                raise legacy.LegacyParseError(f"texture size block misaligned {r.ctx()}")

            size_pos, marker, width, height, filename = recovered
            skipped = size_pos - r.pos
            _LOGGER.warning(
                "HA3D recovered legacy SKP texture tail at %#x: skipped %d "
                "opaque bytes, applied size %.6g x %.6g, file=%r",
                r.pos,
                skipped,
                width,
                height,
                filename,
            )
            r.pos = size_pos

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
