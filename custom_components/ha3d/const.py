from __future__ import annotations

from typing import Final

DOMAIN: Final = "ha3d"
PANEL_URL_PATH: Final = "ha3d"
PANEL_ELEMENT: Final = "ha3d-panel"
PANEL_TITLE: Final = "HA3D"
PANEL_ICON: Final = "mdi:cube-scan"
STATIC_URL: Final = "/ha3d_static"
MODEL_PUBLIC_URL: Final = "/local/ha3d/models/model.glb"
MODEL_RELATIVE_PATH: Final = "www/ha3d/models/model.glb"
SCENE_ASSETS_PUBLIC_DIR: Final = "/local/ha3d/assets"
SCENE_ASSETS_RELATIVE_DIR: Final = "www/ha3d/assets"
STORE_KEY: Final = "ha3d"
STORE_VERSION: Final = 1
# Final GLB limit. This protects the browser/viewer from accidentally loading
# extremely large converted models.
MAX_MODEL_BYTES: Final = 250 * 1024 * 1024
# SKP files can be considerably larger than the GLB produced from them. Keep a
# separate streaming-upload limit so large SketchUp sources can still convert.
MAX_SKP_SOURCE_BYTES: Final = 1024 * 1024 * 1024
MAX_SCENE_ASSETS: Final = 50
