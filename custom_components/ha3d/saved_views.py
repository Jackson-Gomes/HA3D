from __future__ import annotations

import math
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView

from .storage import HA3DStore

_MAX_VIEWS = 100
_MAX_ID_LEN = 100
_MAX_NAME_LEN = 80


def _number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
        and abs(float(value)) < 1_000_000_000
    )


def _vec3(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 3 and all(_number(item) for item in value)


def _sanitize_zone(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or set(value) - {"x", "z", "y", "width", "depth", "show"}:
        return None
    for key in ("x", "z", "y", "width", "depth"):
        if not _number(value.get(key)):
            return None
    if float(value["width"]) <= 0 or float(value["depth"]) <= 0:
        return None
    if "show" in value and not isinstance(value["show"], bool):
        return None
    return {
        "x": float(value["x"]),
        "z": float(value["z"]),
        "y": float(value["y"]),
        "width": float(value["width"]),
        "depth": float(value["depth"]),
        "show": value.get("show", True),
    }


def _sanitize_view(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict) or set(item) - {"id", "name", "view", "zone", "quick_access"}:
        return None

    view_id = item.get("id")
    name = item.get("name")
    camera = item.get("view")

    if not isinstance(view_id, str) or not view_id or len(view_id) > _MAX_ID_LEN:
        return None
    if not isinstance(name, str):
        return None
    clean_name = name.strip()
    if not clean_name or len(clean_name) > _MAX_NAME_LEN:
        return None
    if not isinstance(camera, dict) or set(camera) - {"position", "target", "up"}:
        return None
    if not _vec3(camera.get("position")) or not _vec3(camera.get("target")):
        return None
    if "up" in camera and not _vec3(camera["up"]):
        return None

    clean_camera: dict[str, list[float]] = {
        "position": [float(value) for value in camera["position"]],
        "target": [float(value) for value in camera["target"]],
    }
    if "up" in camera:
        clean_camera["up"] = [float(value) for value in camera["up"]]

    result: dict[str, Any] = {"id": view_id, "name": clean_name, "view": clean_camera}

    if "zone" in item:
        zone = _sanitize_zone(item["zone"])
        if zone is None:
            return None
        result["zone"] = zone

    if "quick_access" in item:
        if not isinstance(item["quick_access"], bool):
            return None
        result["quick_access"] = item["quick_access"]

    return result


def _sanitize_views(value: Any) -> list[dict[str, Any]] | None:
    if not isinstance(value, list) or len(value) > _MAX_VIEWS:
        return None

    result: list[dict[str, Any]] = []
    ids: set[str] = set()
    for item in value:
        clean = _sanitize_view(item)
        if clean is None or clean["id"] in ids:
            return None
        ids.add(clean["id"])
        result.append(clean)
    return result


class HA3DSavedViewsView(HomeAssistantView):
    """Persist camera views and their floor shortcuts for every HA3D client."""

    url = "/api/ha3d/saved_views"
    name = "api:ha3d:saved_views"
    requires_auth = True

    def __init__(self, store: HA3DStore) -> None:
        self._store = store

    async def get(self, request: web.Request) -> web.Response:
        data = await self._store.async_load()
        views = _sanitize_views(data.get("saved_views", [])) or []
        return self.json({
            "saved_views": views,
            "initialized": bool(data.get("saved_views_initialized", False)),
            "layout_initialized": bool(data.get("saved_view_layout_initialized", False)),
        })

    async def post(self, request: web.Request) -> web.Response:
        try:
            payload = await request.json()
        except ValueError:
            return self.json({"error": "invalid_json"}, status=400)

        views = _sanitize_views(payload.get("saved_views"))
        if views is None:
            return self.json({"error": "invalid_saved_views"}, status=400)

        data = await self._store.async_load()
        has_layout = any("zone" in view or "quick_access" in view for view in views)
        layout_initialized = bool(data.get("saved_view_layout_initialized", False)) or has_layout

        await self._store.async_update({
            "saved_views": views,
            "saved_views_initialized": True,
            "saved_view_layout_initialized": layout_initialized,
        })
        return self.json({
            "saved_views": views,
            "initialized": True,
            "layout_initialized": layout_initialized,
        })
