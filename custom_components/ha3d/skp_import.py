from __future__ import annotations

from functools import partial
import logging
import os
from pathlib import Path
from uuid import uuid4

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import MAX_MODEL_BYTES, MODEL_RELATIVE_PATH
from .storage import HA3DStore

_LOGGER = logging.getLogger(__name__)
_CHUNK_SIZE = 1024 * 1024


def _convert_skp_to_glb(source: Path, target: Path) -> None:
    """Convert an SKP file to GLB using OpenSKP."""
    from openskp import SkpFile
    from openskp.export import glb

    skp = SkpFile.open(str(source))
    glb.export(skp, str(target))


def _read_glb_header(path: Path) -> bytes:
    with path.open("rb") as handle:
        return handle.read(4)


class HA3DSkpUploadView(HomeAssistantView):
    """Upload a SketchUp SKP file, convert it locally, and install it as the HA3D model."""

    url = "/api/ha3d/model/skp"
    name = "api:ha3d:model:skp"
    requires_auth = True

    def __init__(self, hass: HomeAssistant, store: HA3DStore) -> None:
        self._hass = hass
        self._store = store

    async def post(self, request: web.Request) -> web.Response:
        if not request["hass_user"].is_admin:
            return self.json({"error": "admin_required"}, status=403)

        if not request.content_type.startswith("multipart/"):
            return self.json({"error": "multipart_required"}, status=400)

        try:
            reader = await request.multipart()
        except Exception:
            return self.json({"error": "invalid_multipart"}, status=400)

        file_field = None
        while field := await reader.next():
            if field.name == "file":
                file_field = field
                break

        if file_field is None or not file_field.filename:
            return self.json({"error": "file_required"}, status=400)
        if not file_field.filename.lower().endswith(".skp"):
            return self.json({"error": "skp_required"}, status=400)

        target = Path(self._hass.config.path(MODEL_RELATIVE_PATH))
        await self._hass.async_add_executor_job(
            partial(target.parent.mkdir, parents=True, exist_ok=True)
        )

        token = uuid4().hex
        source = target.parent / f".ha3d-{token}.skp"
        converted = target.parent / f".ha3d-{token}.glb"

        total = 0
        too_large = False
        handle = await self._hass.async_add_executor_job(open, source, "wb")
        try:
            while True:
                chunk = await file_field.read_chunk(size=_CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_MODEL_BYTES:
                    too_large = True
                    break
                await self._hass.async_add_executor_job(handle.write, chunk)
        finally:
            await self._hass.async_add_executor_job(handle.close)

        if too_large:
            await self._hass.async_add_executor_job(source.unlink, True)
            return self.json(
                {"error": "model_too_large", "max_bytes": MAX_MODEL_BYTES},
                status=413,
            )

        try:
            await self._hass.async_add_executor_job(_convert_skp_to_glb, source, converted)
        except ImportError:
            _LOGGER.exception("OpenSKP is unavailable")
            await self._hass.async_add_executor_job(source.unlink, True)
            await self._hass.async_add_executor_job(converted.unlink, True)
            return self.json({"error": "skp_converter_unavailable"}, status=503)
        except Exception as error:
            _LOGGER.exception("Failed to convert SketchUp model %s", file_field.filename)
            await self._hass.async_add_executor_job(source.unlink, True)
            await self._hass.async_add_executor_job(converted.unlink, True)
            message = str(error).strip()[:300] or error.__class__.__name__
            return self.json(
                {"error": "skp_conversion_failed", "message": message},
                status=400,
            )
        finally:
            if await self._hass.async_add_executor_job(source.exists):
                await self._hass.async_add_executor_job(source.unlink, True)

        if not await self._hass.async_add_executor_job(converted.is_file):
            return self.json({"error": "skp_conversion_no_output"}, status=500)

        converted_bytes = await self._hass.async_add_executor_job(lambda: converted.stat().st_size)
        if converted_bytes > MAX_MODEL_BYTES:
            await self._hass.async_add_executor_job(converted.unlink, True)
            return self.json(
                {"error": "converted_model_too_large", "max_bytes": MAX_MODEL_BYTES},
                status=413,
            )

        header = await self._hass.async_add_executor_job(_read_glb_header, converted)
        if header != b"glTF":
            await self._hass.async_add_executor_job(converted.unlink, True)
            return self.json({"error": "invalid_converted_glb"}, status=500)

        await self._hass.async_add_executor_job(os.replace, converted, target)
        data = await self._store.async_set_model_ready()
        return self.json(
            {
                "ok": True,
                "source_format": "skp",
                "source_bytes": total,
                "bytes": converted_bytes,
                "model_url": data["model_url"],
                "model_revision": data["model_revision"],
            }
        )
