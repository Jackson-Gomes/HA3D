/* HA3D robot runtime fixes.
 * - Robot floor_y remains independent from map overlay height.
 * - A temporarily unavailable map entity does not hide an already loaded map texture.
 * - Map controls remain authoritative in the current browser session.
 */
const Panel = customElements.get("ha3d-panel");
if (!Panel) throw new Error("HA3D panel was not registered");
const THREE = Panel.HA3D_THREE;
if (!THREE) throw new Error("HA3D Three.js runtime was not registered");
const proto = Panel.prototype;

const MAP_ENTITY = "image.xiaomi_robot_vacuum_h50_live_map";

function floorHeightAxis(plane = "xz") {
  return plane === "xy" ? "z" : plane === "yz" ? "x" : "y";
}

function enforceConfiguredRobotHeight(panel) {
  for (const entry of panel?._robotEntries?.values?.() || []) {
    const root = entry?.object || entry?.icon;
    const config = entry?.config;
    if (!root || !config) continue;
    const height = Number(config.floor_y);
    if (!Number.isFinite(height)) continue;
    const axis = floorHeightAxis(config.floor_plane || "xz");
    root.updateWorldMatrix?.(true, false);
    const world = root.getWorldPosition(new THREE.Vector3());
    world[axis] = height;
    const local = root.parent ? root.parent.worldToLocal(world.clone()) : world;
    root.position.copy(local);
    root.updateMatrixWorld?.(true);
  }
}

function preserveLoadedMapOnTemporaryOutage(panel) {
  const state = panel?._hass?.states?.[MAP_ENTITY];
  const picture = state?.attributes?.entity_picture;
  const unavailable = !state || ["unknown", "unavailable"].includes(state.state) || !picture;
  if (!unavailable) return;
  for (const entry of panel?._robotEntries?.values?.() || []) {
    const mesh = entry?.ha3dMapOverlay;
    if (!mesh || !mesh.material?.map) continue;
    // Keep last successfully loaded texture visible according to its existing
    // visibility flag. Do not force it off just because HA missed one refresh.
    mesh.visible = mesh.visible !== false;
  }
}

if (!proto.__ha3dRobotRuntimeFixV1) {
  proto.__ha3dRobotRuntimeFixV1 = true;

  const oldUpdate = proto._updateRobots;
  proto._updateRobots = function (...args) {
    const result = oldUpdate?.apply(this, args);
    enforceConfiguredRobotHeight(this);
    preserveLoadedMapOnTemporaryOutage(this);
    return result;
  };

  const oldRebuild = proto._rebuildRobots;
  proto._rebuildRobots = function (...args) {
    const result = oldRebuild?.apply(this, args);
    queueMicrotask(() => {
      enforceConfiguredRobotHeight(this);
      preserveLoadedMapOnTemporaryOutage(this);
    });
    return result;
  };

  const oldHassChanged = proto._hassChanged;
  if (oldHassChanged) {
    proto._hassChanged = function (...args) {
      const result = oldHassChanged.apply(this, args);
      enforceConfiguredRobotHeight(this);
      preserveLoadedMapOnTemporaryOutage(this);
      return result;
    };
  }
}
