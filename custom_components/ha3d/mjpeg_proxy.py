from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass, field
import ipaddress
import time
from urllib.parse import urlsplit

from aiohttp import ClientTimeout, web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .storage import HA3DStore

_MAX_FRAME_BYTES = 8 * 1024 * 1024
_IDLE_SECONDS = 45.0
_WAIT_FIRST_FRAME_SECONDS = 4.0
_RETRY_SECONDS = 1.0


@dataclass
class _StreamState:
    url: str
    frame: bytes | None = None
    sequence: int = 0
    last_access: float = field(default_factory=time.monotonic)
    event: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task[None] | None = None
    error: str | None = None


def _private_mjpeg_url(value: str) -> str | None:
    """Allow only literal private/local HTTP(S) destinations.

    The proxy intentionally refuses arbitrary public hosts so an authenticated
    browser cannot turn the HA endpoint into a generic server-side request tool.
    """
    try:
        parsed = urlsplit(str(value or "").strip())
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username or parsed.password:
        return None
    host = parsed.hostname
    if host == "localhost":
        return value
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return None
    if not (address.is_private or address.is_loopback or address.is_link_local):
        return None
    return value


class HA3DMjpegHub:
    """Keep one lightweight LAN MJPEG reader per configured URL."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._streams: dict[str, _StreamState] = {}

    async def async_get_frame(self, url: str) -> tuple[int, bytes]:
        state = self._streams.get(url)
        if state is None:
            state = _StreamState(url=url)
            self._streams[url] = state
        state.last_access = time.monotonic()
        if state.task is None or state.task.done():
            state.task = self._hass.async_create_task(self._reader(state), "ha3d_mjpeg_reader")
        if state.frame is None:
            try:
                await asyncio.wait_for(state.event.wait(), timeout=_WAIT_FIRST_FRAME_SECONDS)
            except TimeoutError as err:
                raise RuntimeError(state.error or "mjpeg_frame_timeout") from err
        if state.frame is None:
            raise RuntimeError(state.error or "mjpeg_no_frame")
        return state.sequence, state.frame

    async def async_close(self) -> None:
        tasks = [state.task for state in self._streams.values() if state.task and not state.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._streams.clear()

    async def _reader(self, state: _StreamState) -> None:
        session = async_get_clientsession(self._hass)
        timeout = ClientTimeout(total=None, sock_connect=5, sock_read=15)
        try:
            while time.monotonic() - state.last_access <= _IDLE_SECONDS:
                try:
                    async with session.get(state.url, timeout=timeout) as response:
                        response.raise_for_status()
                        buffer = bytearray()
                        state.error = None
                        async for chunk in response.content.iter_any():
                            if time.monotonic() - state.last_access > _IDLE_SECONDS:
                                return
                            if not chunk:
                                continue
                            buffer.extend(chunk)
                            while True:
                                start = buffer.find(b"\xff\xd8")
                                if start < 0:
                                    if len(buffer) > 1:
                                        del buffer[:-1]
                                    break
                                end = buffer.find(b"\xff\xd9", start + 2)
                                if end < 0:
                                    if start > 0:
                                        del buffer[:start]
                                    if len(buffer) > _MAX_FRAME_BYTES:
                                        buffer.clear()
                                    break
                                frame = bytes(buffer[start : end + 2])
                                del buffer[: end + 2]
                                if 4 <= len(frame) <= _MAX_FRAME_BYTES:
                                    state.frame = frame
                                    state.sequence += 1
                                    state.event.set()
                except asyncio.CancelledError:
                    raise
                except Exception as err:  # stream reconnect is intentional
                    state.error = str(err)
                    await asyncio.sleep(_RETRY_SECONDS)
        finally:
            state.task = None


class HA3DMjpegFrameView(HomeAssistantView):
    """Return the newest JPEG frame for one persisted MJPEG media panel."""

    url = "/api/ha3d/mjpeg/frame/{panel_id}"
    name = "api:ha3d:mjpeg_frame"
    requires_auth = True

    def __init__(self, store: HA3DStore, hub: HA3DMjpegHub) -> None:
        self._store = store
        self._hub = hub

    async def get(self, request: web.Request, panel_id: str) -> web.Response:
        data = await self._store.async_load()
        panel = next(
            (
                item
                for item in data.get("media_panels", [])
                if item.get("id") == panel_id and item.get("source_type") == "mjpeg"
            ),
            None,
        )
        if not panel:
            return self.json({"error": "mjpeg_panel_not_found"}, status=404)

        url = _private_mjpeg_url(panel.get("url", ""))
        if not url:
            return self.json({"error": "mjpeg_url_must_be_private_lan"}, status=400)

        try:
            sequence, frame = await self._hub.async_get_frame(url)
        except RuntimeError as err:
            return self.json({"error": str(err)}, status=502)

        return self.json(
            {
                "sequence": sequence,
                "content_type": "image/jpeg",
                "data": base64.b64encode(frame).decode("ascii"),
            }
        )
