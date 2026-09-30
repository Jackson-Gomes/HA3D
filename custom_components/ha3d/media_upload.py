from __future__ import annotations

from functools import partial
import os
from pathlib import Path
from uuid import uuid4

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

_CHUNK_SIZE = 1024 * 1024
_MAX_MEDIA_BYTES = 120 * 1024 * 1024
_MEDIA_RELATIVE_DIR = "www/ha3d/media"
_MEDIA_PUBLIC_DIR = "/local/ha3d/media"
_ALLOWED = {
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".webp": "image",
    ".gif": "image",
    ".avif": "image",
    ".mp4": "video",
    ".webm": "video",
    ".ogv": "video",
    ".ogg": "video",
}


class HA3DMediaUploadView(HomeAssistantView):
    """Upload an image/video file for a HA3D media panel."""

    url = "/api/ha3d/media/upload"
    name = "api:ha3d:media_upload"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

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

        extension = Path(file_field.filename).suffix.lower()
        media_type = _ALLOWED.get(extension)
        if media_type is None:
            return self.json(
                {
                    "error": "unsupported_media",
                    "allowed": sorted(_ALLOWED),
                },
                status=400,
            )

        media_id = uuid4().hex[:20]
        target_dir = Path(self._hass.config.path(_MEDIA_RELATIVE_DIR))
        target = target_dir / f"{media_id}{extension}"
        temporary = target.with_name(f".{target.name}.upload")
        await self._hass.async_add_executor_job(partial(target_dir.mkdir, parents=True, exist_ok=True))

        total = 0
        too_large = False
        handle = await self._hass.async_add_executor_job(open, temporary, "wb")
        try:
            while True:
                chunk = await file_field.read_chunk(size=_CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_MEDIA_BYTES:
                    too_large = True
                    break
                await self._hass.async_add_executor_job(handle.write, chunk)
        finally:
            await self._hass.async_add_executor_job(handle.close)

        if too_large:
            await self._hass.async_add_executor_job(temporary.unlink, True)
            return self.json({"error": "media_too_large", "max_bytes": _MAX_MEDIA_BYTES}, status=413)

        await self._hass.async_add_executor_job(os.replace, temporary, target)
        return self.json(
            {
                "ok": True,
                "bytes": total,
                "kind": media_type,
                "url": f"{_MEDIA_PUBLIC_DIR}/{target.name}",
                "filename": Path(file_field.filename).name,
            }
        )
