// Stable HA3D frontend entrypoint.
// The static path is served with cache headers disabled, so a page/app reload
// is enough to pick up frontend-only changes without restarting Home Assistant.
import "./ha3d-graphics.js";
import "./ha3d-scene.js";
