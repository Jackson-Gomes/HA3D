from __future__ import annotations

from aiohttp import web

from .const import MAX_MODEL_BYTES
from .http import HA3DModelUploadView as _BaseHA3DModelUploadView

# Home Assistant's HTTP server defaults to a 16 MiB request limit. HA3D allows
# GLBs up to 250 MiB, so raise the limit only for this authenticated upload
# endpoint, following the same per-request pattern used by HA upload views.
_UPLOAD_OVERHEAD_BYTES = 16 * 1024 * 1024


class HA3DModelUploadView(_BaseHA3DModelUploadView):
    """GLB upload view with a scoped request-size override for large models."""

    async def post(self, request: web.Request) -> web.Response:
        request._client_max_size = MAX_MODEL_BYTES + _UPLOAD_OVERHEAD_BYTES  # noqa: SLF001
        return await super().post(request)
