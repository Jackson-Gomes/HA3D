from __future__ import annotations

import re
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView

from .storage import HA3DStore

_ENTITY_ID_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
_MAX_PANELS = 100
_MAX_URL = 4096


def _is_number(value: Any, minimum: float = -1_000_000, maximum: float = 1_000_000) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and minimum <= float(value) <= maximum
    )


def _is_vector3(value: Any, minimum: float = -1_000_000, maximum: float = 1_000_000) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(_is_number(item, minimum, maximum) for item in value)


def _is_text(value: Any, maximum: int, allow_empty: bool = True) -> bool:
    return isinstance(value, str) and len(value) <= maximum and (allow_empty or bool(value))


def _is_valid_media_panel(value: Any) -> bool:
    if not isinstance(value, dict):
        return False

    allowed = {
        "id",
        "name",
        "source_type",
        "entity_id",
        "power_entity_id",
        "image_attribute",
        "url",
        "position",
        "rotation",
        "scale",
        "width",
        "height",
        "opacity",
        "enabled",
        "double_sided",
        "muted",
        "loop",
        "autoplay",
    }
    if set(value) - allowed:
        return False

    panel_id = value.get("id")
    if not _is_text(panel_id, 100, allow_empty=False):
        return False
    if not _is_text(value.get("name", panel_id), 120, allow_empty=False):
        return False
    if value.get("source_type", "entity") not in {"entity", "image", "video", "mjpeg"}:
        return False

    entity_id = value.get("entity_id")
    if entity_id is not None and (not isinstance(entity_id, str) or not _ENTITY_ID_RE.fullmatch(entity_id)):
        return False

    power_entity_id = value.get("power_entity_id")
    if power_entity_id is not None and (
        not isinstance(power_entity_id, str) or not _ENTITY_ID_RE.fullmatch(power_entity_id)
    ):
        return False

    if not _is_text(value.get("image_attribute", ""), 120):
        return False
    if not _is_text(value.get("url", ""), _MAX_URL):
        return False

    if not _is_vector3(value.get("position")) or not _is_vector3(value.get("rotation")):
        return False
    if not _is_vector3(value.get("scale", [1, 1, 1]), 0.001, 10_000):
        return False
    if not _is_number(value.get("width", 1.6), 0.01, 100_000):
        return False
    if not _is_number(value.get("height", 0.9), 0.01, 100_000):
        return False
    if not _is_number(value.get("opacity", 1), 0, 1):
        return False

    for key in ("enabled", "double_sided", "muted", "loop", "autoplay"):
        if key in value and not isinstance(value[key], bool):
            return False

    return True


def _is_valid_media_panels(value: Any) -> bool:
    if not isinstance(value, list) or len(value) > _MAX_PANELS:
        return False
    ids: set[str] = set()
    for item in value:
        if not _is_valid_media_panel(item):
            return False
        panel_id = item["id"]
        if panel_id in ids:
            return False
        ids.add(panel_id)
    return True


class HA3DMediaPanelsView(HomeAssistantView):
    """Persist runtime-created image/video/MJPEG planes for the HA3D scene."""

    url = "/api/ha3d/media_panels"
    name = "api:ha3d:media_panels"
    requires_auth = True

    def __init__(self, store: HA3DStore) -> None:
        self._store = store

    async def get(self, request: web.Request) -> web.Response:
        data = await self._store.async_load()
        return self.json({"media_panels": data.get("media_panels", [])})

    async def post(self, request: web.Request) -> web.Response:
        if not request["hass_user"].is_admin:
            return self.json({"error": "admin_required"}, status=403)

        try:
            payload = await request.json()
        except ValueError:
            return self.json({"error": "invalid_json"}, status=400)

        panels = payload.get("media_panels")
        if not _is_valid_media_panels(panels):
            return self.json({"error": "invalid_media_panels"}, status=400)

        data = await self._store.async_update({"media_panels": panels})
        return self.json(data)
