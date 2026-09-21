from __future__ import annotations

from functools import partial
import os
from pathlib import Path
import re
from typing import Any

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr, entity_registry as er

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


def _is_valid_object_map(value: Any, value_validator: Any) -> bool:
    return isinstance(value, dict) and len(value) <= 2000 and all(
        isinstance(name, str) and 0 < len(name) <= 255 and value_validator(item)
        for name, item in value.items()
    )


def _is_valid_position(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) - {"position", "rotation", "scale"}:
        return False
    return all(
        isinstance(vector, list) and len(vector) == 3
        and all(isinstance(number, (int, float)) and abs(number) < 1_000_000 for number in vector)
        for vector in value.values()
    )


def _is_valid_advanced_binding(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) - {"entity_id", "anchor", "marker_offset", "readings", "state_rules", "actions", "show_only_when_zoomed"}:
        return False
    entity_id = value.get("entity_id")
    if entity_id is not None and (not isinstance(entity_id, str) or not _ENTITY_ID_RE.fullmatch(entity_id)):
        return False
    if "anchor" in value and (not isinstance(value["anchor"], str) or not value["anchor"] or len(value["anchor"]) > 255):
        return False
    if "marker_offset" in value and (
        not isinstance(value["marker_offset"], list)
        or len(value["marker_offset"]) != 3
        or not all(isinstance(number, (int, float)) and abs(number) < 1_000_000 for number in value["marker_offset"])
    ):
        return False
    for key in ("readings", "state_rules"):
        if key in value and (not isinstance(value[key], list) or len(value[key]) > 20 or not all(isinstance(item, dict) for item in value[key])):
            return False
    return not ("actions" in value and not isinstance(value["actions"], dict)) and not (
        "show_only_when_zoomed" in value and not isinstance(value["show_only_when_zoomed"], bool)
    )


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

        if "object_positions" in payload:
            if not _is_valid_object_map(payload["object_positions"], _is_valid_position):
                return self.json({"error": "invalid_object_positions"}, status=400)
            changes["object_positions"] = payload["object_positions"]

        if "area_bindings" in payload:
            if not _is_valid_object_map(payload["area_bindings"], lambda value: isinstance(value, str) and 0 < len(value) <= 255):
                return self.json({"error": "invalid_area_bindings"}, status=400)
            changes["area_bindings"] = payload["area_bindings"]

        if "advanced_bindings" in payload:
            if not _is_valid_object_map(payload["advanced_bindings"], _is_valid_advanced_binding):
                return self.json({"error": "invalid_advanced_bindings"}, status=400)
            changes["advanced_bindings"] = payload["advanced_bindings"]

        data = await self._store.async_update(changes)
        return self.json(data)


class HA3DAreasView(HomeAssistantView):
    """Return Home Assistant Areas with their entities for the HA3D editor."""

    url = "/api/ha3d/areas"
    name = "api:ha3d:areas"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    async def get(self, request: web.Request) -> web.Response:
        areas = ar.async_get(self._hass)
        devices = dr.async_get(self._hass)
        entities = er.async_get(self._hass)
        payload = []
        for area in areas.async_list_areas():
            entity_ids = []
            for entry in entities.entities.values():
                device = devices.async_get(entry.device_id) if entry.device_id else None
                if entry.area_id == area.id or (device and device.area_id == area.id):
                    entity_ids.append(entry.entity_id)
            payload.append({"id": area.id, "name": area.name, "entities": sorted(entity_ids)})
        return self.json({"areas": sorted(payload, key=lambda item: item["name"].casefold())})


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
                "model_revision": data["model_revision"],
            }
        )
