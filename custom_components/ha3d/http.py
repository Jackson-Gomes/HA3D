from __future__ import annotations

from functools import partial
import os
from pathlib import Path
import re
from typing import Any

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import MAX_MODEL_BYTES, MODEL_RELATIVE_PATH
from .storage import HA3DStore

_ENTITY_ID_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
_CHUNK_SIZE = 1024 * 1024


def _is_valid_bindings(value: Any) -> bool:
    if not isinstance(value, dict) or len(value) > 2000:
        return False
    for object_name, entity_id in value.items():
        if not isinstance(object_name, str) or not object_name or len(object_name) > 255:
            return False
        if not isinstance(entity_id, str) or not _ENTITY_ID_RE.fullmatch(entity_id):
            return False
    return True


class HA3DConfigView(HomeAssistantView):
    """Read and update generic HA3D configuration."""

    url = "/api/ha3d/config"
    name = "api:ha3d:config"
    requires_auth = True

    def __init__(self, store: HA3DStore) -> None:
        self._store = store

    async def get(self, request: web.Request) -> web.Response:
        data = await self._store.async_load()
        return self.json(data)

    async def post(self, request: web.Request) -> web.Response:
        if not request["hass_user"].is_admin:
            return self.json({"error": "admin_required"}, status=403)

        try:
            payload = await request.json()
        except ValueError:
            return self.json({"error": "invalid_json"}, status=400)

        changes: dict[str, Any] = {}
        if "auto_bind" in payload:
            if not isinstance(payload["auto_bind"], bool):
                return self.json({"error": "invalid_auto_bind"}, status=400)
            changes["auto_bind"] = payload["auto_bind"]

        if "bindings" in payload:
            if not _is_valid_bindings(payload["bindings"]):
                return self.json({"error": "invalid_bindings"}, status=400)
            changes["bindings"] = payload["bindings"]

        data = await self._store.async_update(changes)
        return self.json(data)


class HA3DModelUploadView(HomeAssistantView):
    """Upload one GLB model into Home Assistant's www directory."""

    url = "/api/ha3d/model"
    name = "api:ha3d:model"
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

        if not file_field.filename.lower().endswith(".glb"):
            return self.json({"error": "glb_required"}, status=400)

        target = Path(self._hass.config.path(MODEL_RELATIVE_PATH))
        temporary = target.with_name(f".{target.name}.upload")
        await self._hass.async_add_executor_job(
            partial(target.parent.mkdir, parents=True, exist_ok=True)
        )

        total = 0
        header = bytearray()
        too_large = False
        handle = await self._hass.async_add_executor_job(open, temporary, "wb")
        try:
            while True:
                chunk = await file_field.read_chunk(size=_CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_MODEL_BYTES:
                    too_large = True
                    break
                if len(header) < 4:
                    header.extend(chunk[: 4 - len(header)])
                await self._hass.async_add_executor_job(handle.write, chunk)
        finally:
            await self._hass.async_add_executor_job(handle.close)

        if too_large:
            await self._hass.async_add_executor_job(temporary.unlink, True)
            return self.json(
                {"error": "model_too_large", "max_bytes": MAX_MODEL_BYTES},
                status=413,
            )

        if bytes(header) != b"glTF":
            await self._hass.async_add_executor_job(temporary.unlink, True)
            return self.json({"error": "invalid_glb"}, status=400)

        await self._hass.async_add_executor_job(os.replace, temporary, target)
        data = await self._store.async_set_model_ready()
        return self.json(
            {
                "ok": True,
                "bytes": total,
                "model_url": data["model_url"],
            }
        )
